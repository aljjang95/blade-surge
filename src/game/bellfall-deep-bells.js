import { Vector3 } from 'three';
import { audio } from '../engine/audio.js';

/** 판정 하위 단계. dt가 크거나 작아도 같은 단계 순서로 진행해 결과가 같다. */
const STEP = 1 / 60;
const EPS = 1e-9;
/** 종 하나가 소등될 때 들려주는 높이. 종문 번호마다 달라 소리만으로도 순서를 기억할 수 있다. */
const TOLL_FREQ = Object.freeze([523, 659, 784]);
const PHASE_ORDER = Object.freeze({ wake: 0, toll: 1, answer: 2, done: 3 });
/** @typedef {{id:string, label:string, complete:boolean, progress:number, target:number, rooms:readonly number[], discords:number, tolls:number}} BellReport */

/** 종락 회랑 심층의 원안: 종문 3개 역순 공명.
 * 흐름은 wake(점등 대기) → toll(소등 재생) → answer(역순 공명) → done 이다.
 * 방의 적을 처치하면 그 종이 켜지고(lit), 세 종이 모두 켜지면 def.tollOrder 순서로 하나씩 꺼진다(dark).
 * 소등이 끝나면 마지막에 꺼진 종부터 거꾸로 종 중심(radius)에 holdSeconds 머물러 공명한다(resonated).
 * 틀린 종에서 holdSeconds 를 채우면 불협이다. 최대 체력 discord.damage 피해를 주고, 모든 종을 다시 켜서 소등을 처음부터 들려준다.
 * 불협이 guideAfter 회 이상이면 목표창이 다음 종을 알려준다. 정답 순서는 guide·autoRoom 으로만 드러난다.
 * 방 정화·보상은 3/3 공명 순간에 정답 순서대로 한 번씩만 Battle.markCleared 로 넘기고, 봉인·승리는 Battle 이 소유한다.
 * 그 순간 방에 적·대기 소환이 남아 거부되면 purgePending 으로 기억했다가 그 방 적이 정리된 첫 프레임에 다시 넘긴다.
 * 공명 제단은 이 목표로 교체된다(allowsAttunement / coexistsAttunement 가 false).
 * 읽기 상태(gates·phase·progress 등)는 뷰·UI 가 읽기만 한다. */
export class BellfallDeepBells {
  #closed = false;
  /** @type {BellReport|null} */
  #report = null;
  #settled = false;
  #phase = 'wake';
  #progress = 0;
  #discords = 0;
  #tolls = 0;
  #hold = 0;
  #holdGate = null;
  #tollIndex = 0;
  #tollClock = 0;
  #lastToll = null;
  #lastDiscord = null;
  #discordT = Infinity;
  #here = null;
  /** 소등 순서와 그 역순(정답). 밖으로 내보내지 않는다. */
  #tollGates;
  #answer;
  /** 이번 시도에서 공명한 방 id 를 공명 순서대로 담는 고정 길이 버퍼. */
  #order;
  #hint = '';
  #hintSig = -1;
  /** 뷰에 넘기는 옵션 객체(재사용). */
  #opts = { reduced: false };
  view = null;

  constructor(def, world) {
    this.def = def; this.world = world;
    const { minX, minZ, cols } = world;
    if (typeof minX !== 'number' || typeof minZ !== 'number' || typeof cols !== 'number') throw new RangeError('종문 이동 지도가 준비되지 않았습니다.');
    const flow = world.buildFlow(world.startRoom.x, world.startRoom.z);
    this.gates = def.gates.map(({ roomId, label }, i) => {
      const room = world.rooms.find(r => r.id === roomId);
      if (!room || room.type === 'boss' || room.type === 'start' || !flow ||
          flow[Math.floor(room.z - minZ) * cols + Math.floor(room.x - minX)] < 0) {
        throw new RangeError(`종문 ${roomId}에 봉인 밖 접근 경로가 없습니다.`);
      }
      room.label = label; room.objectiveProp = 'bellfall-bell';
      return { room, label, index: i, number: i + 1, phase: 'locked', prepared: false, expected: 0, spawned: 0,
        purgePending: false, center: new Vector3(room.x, 0, room.z) };
    });
    const order = def.tollOrder;
    if (!Array.isArray(order) || order.length !== this.gates.length) throw new RangeError('종문 소등 순서가 종문 수와 다릅니다.');
    this.#tollGates = order.map(roomId => {
      const gate = this.gates.find(g => g.room.id === roomId);
      if (!gate) throw new RangeError(`종문 소등 순서의 방 ${roomId}는 종문이 아닙니다.`);
      return gate;
    });
    if (new Set(this.#tollGates).size !== this.gates.length) throw new RangeError('종문 소등 순서가 종문을 한 번씩 담지 않습니다.');
    this.#answer = this.#tollGates.slice().reverse();
    this.#order = new Array(this.gates.length).fill(0);
  }

  // ---------------- 읽기 상태 ----------------
  get phase() { return this.#phase; }
  /** 이번 시도에서 공명한 종 수(0..3). 불협이면 0으로 돌아간다. */
  get progress() { return this.#progress; }
  /** 켜진 적이 있는(locked 가 아닌) 종 수. */
  get lit() {
    let n = 0;
    for (let i = 0; i < this.gates.length; i++) if (this.gates[i].phase !== 'locked') n++;
    return n;
  }
  get complete() { return this.#phase === 'done'; }
  get closed() { return this.#closed || !!this.#report; }
  get discords() { return this.#discords; }
  get tolls() { return this.#tolls; }
  get hold() { return this.#hold; }
  get holdGate() { return this.#holdGate; }
  get tollIndex() { return this.#tollIndex; }
  get tollClock() { return this.#tollClock; }
  /** 이번 재생에서 가장 최근 꺼진 종. 소등 재생 밖에서는 null. */
  get lastToll() { return this.#phase === 'toll' ? this.#lastToll : null; }
  get lastDiscord() { return this.#lastDiscord; }
  /** 마지막 불협 뒤 경과 초(불협이 없으면 Infinity). */
  get discordT() { return this.#discordT; }
  /** 불협이 guideAfter 회 이상이면 공명 단계에서 다음 정답 종을 알려준다. */
  get guide() {
    return this.#phase === 'answer' && this.#discords >= this.def.guideAfter ? this.#answer[this.#progress] ?? null : null;
  }
  /** 영웅이 있는 방(종문 방이 아니어도 된다). 방 밖이면 null. */
  get here() { return this.#here; }
  /** 공명 제단은 이 목표로 교체된다. */
  get coexistsAttunement() { return false; }
  /** @param {unknown} [_room] */
  allowsAttunement(_room) { return false; }
  #gate(room) {
    for (let i = 0; i < this.gates.length; i++) if (this.gates[i].room === room) return this.gates[i];
    return null;
  }

  // ---------------- 뷰 ----------------
  async prepareView(scene) {
    const { BellfallDeepBellView } = await import('./bellfall-deep-bell-view.js');
    if (!this.closed) this.view = new BellfallDeepBellView(scene, this);
  }
  #refreshView(dt) { this.view?.update(this, dt, this.#opts); }

  // ---------------- Battle 인터페이스 ----------------
  /** AUTO: 점등 대기에는 첫 미점등 종문 방, 소등·공명에는 다음 정답 종문 방. */
  autoRoom() {
    if (this.closed || this.#phase === 'done') return null;
    if (this.#phase === 'wake') {
      for (let i = 0; i < this.gates.length; i++) if (this.gates[i].phase === 'locked') return this.gates[i].room;
      return null;
    }
    return this.#answer[this.#progress]?.room ?? null;
  }
  interrupt() { this.#hold = 0; this.#holdGate = null; }
  stop() {
    this.#closed = true;
    this.interrupt();
    const view = this.view; this.view = null;
    view?.dispose();
  }
  prepareRoom(room, count) {
    const gate = this.#gate(room);
    if (gate && !gate.prepared) { gate.prepared = true; gate.expected = count; }
  }
  spawn(room) { const gate = this.#gate(room); if (gate) gate.spawned++; }
  enemiesCleared(game, gate) {
    if (!gate.prepared || !gate.room.spawned || gate.spawned < gate.expected) return false;
    const enemies = game.enemies, pending = game.pending;
    for (let i = 0; i < enemies.length; i++) if (enemies[i].alive && enemies[i].homeRoom === gate.room) return false;
    for (let i = 0; i < pending.length; i++) if (pending[i].room === gate.room) return false;
    return true;
  }
  combatPending(game, room) {
    const gate = this.#gate(room);
    return !!gate && !this.enemiesCleared(game, gate);
  }
  /** 종문 방은 3/3 공명 전까지 정화되지 않는다. 적이 모두 정리된 첫 시점에 그 종이 켜진다. */
  beforeClear(game, room) {
    const gate = this.#gate(room);
    if (!gate || this.#phase === 'done') return false;
    if (gate.phase === 'locked' && !this.closed && game.active && !game.paused && this.enemiesCleared(game, gate)) this.#light(game, gate);
    return true;
  }
  canUnseal() {
    if (this.#phase !== 'done') return false;
    const rooms = this.world.rooms;
    for (let i = 0; i < rooms.length; i++) if (rooms[i].type !== 'start' && rooms[i].type !== 'boss' && !rooms[i].cleared) return false;
    return true;
  }
  canWin() { return this.canUnseal() && !this.world.sealed && this.world.bossRoom.cleared; }

  // ---------------- 목표 문구 ----------------
  #buildSig() {
    const gs = this.gates;
    let mask = 0;
    for (let i = 0; i < gs.length; i++) if (gs[i].phase !== 'locked') mask |= 1 << i;
    const guide = this.guide;
    return ((((this.#discords * 4 + PHASE_ORDER[this.#phase]) * 8 + mask) * 4 + this.#tollIndex) * 4 + this.#progress) * 8
      + (guide ? guide.number : 0) + (this.#phase === 'done' && this.canUnseal() ? 4 : 0);
  }
  /** 단계·진행이 바뀔 때만 문장을 새로 만든다(카운트다운은 넣지 않는다). */
  hint() {
    const sig = this.#buildSig();
    if (sig === this.#hintSig) return this.#hint;
    this.#hintSig = sig;
    const n = this.gates.length, d = this.def, tail = this.#discords ? ` · 불협 ${this.#discords}회` : '';
    if (this.#phase === 'wake') {
      let next = null;
      for (let i = 0; i < n && !next; i++) if (this.gates[i].phase === 'locked') next = this.gates[i];
      this.#hint = `종문 점등 ${this.lit}/${n} · ${next ? `다음 ${next.label} · 적 처치` : '점등 대기'}`;
    } else if (this.#phase === 'toll') this.#hint = `종문 소등 ${this.#tollIndex}/${n} · 꺼지는 순서를 기억하세요${tail}`;
    else if (this.#phase === 'answer') {
      const guide = this.guide;
      this.#hint = `종문 역순 공명 ${this.#progress}/${n} · ${guide ? `다음 ${guide.label}` : '마지막에 꺼진 종부터'} · 중심 ${d.holdSeconds}초${tail}`;
    } else this.#hint = `종문 ${n}/${n} 역순 공명 완료 · ${this.canUnseal() ? '보스 처치' : '남은 구역 정화'}${tail}`;
    return this.#hint;
  }
  refreshHint(game) {
    const before = this.#hintSig;
    this.hint();
    if (this.#hintSig !== before) game.ui.setObjective(this.world);
  }

  // ---------------- 프레임 ----------------
  update(game, dt) {
    const player = game.player;
    if (this.closed || !game.active || game.paused || !player?.alive || game.bossDefeated || game.world !== this.world) {
      this.interrupt();
      // 일시정지는 마지막 화면을 유지한다. 그 밖의 종료 사유는 처음 한 번만 뷰를 갱신한다.
      if (!game.paused && !this.#settled) { this.#settled = true; this.#opts.reduced = !!game.app?.reducedMotion?.matches; this.#refreshView(0); }
      return;
    }
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.#settled = false;
    this.#here = game.world.roomAt?.(player.pos.x, player.pos.z) || null;
    const gs = this.gates;
    for (let i = 0; i < gs.length; i++) {
      const g = gs[i];
      if (g.phase === 'locked' && this.enemiesCleared(game, g)) this.#light(game, g);
      // 완료 순간 적·대기 소환이 남아 markCleared 가 거부됐다면, 그 방 적이 정리된 첫 프레임에 한 번 더 정화한다.
      if (g.purgePending && this.enemiesCleared(game, g)) { game.markCleared(g.room); g.purgePending = g.room.cleared !== true; }
    }
    // 고정 프레임 결정성: 1/60초 하위 단계로 소등·공명을 진행한다. 큰 dt 도 같은 사건 순서를 만든다.
    for (let left = dt; left > EPS && player.alive && this.#phase !== 'done'; left -= STEP) this.#tick(game, Math.min(left, STEP));
    if (this.#phase !== 'done') game.autoTarget = this.autoRoom();
    this.#opts.reduced = !!game.app?.reducedMotion?.matches;
    this.#refreshView(dt);
    this.refreshHint(game);
  }
  /** 한 하위 단계. 소등 재생 중에는 유지 시간이 쌓이지 않는다. */
  #tick(game, step) {
    this.#discordT += step;
    if (this.#phase === 'toll') { this.#toll(game, step); return; }
    if (this.#phase !== 'answer') return;
    const d = this.def, p = game.player.pos;
    let inside = null;
    for (let i = 0; i < this.gates.length; i++) {
      const g = this.gates[i];
      if (g.phase === 'dark' && Math.hypot(p.x - g.center.x, p.z - g.center.z) <= d.radius) { inside = g; break; }
    }
    if (!inside) { this.#hold = 0; this.#holdGate = null; return; }
    // 다른 종으로 옮기면 유지 시간은 처음부터 다시 쌓인다.
    if (inside !== this.#holdGate) { this.#holdGate = inside; this.#hold = 0; }
    this.#hold += step;
    if (this.#hold + EPS < d.holdSeconds) return;
    if (inside === this.#answer[this.#progress]) this.#resonate(game, inside);
    else this.#discord(game, inside);
  }
  #light(game, g) {
    g.phase = 'lit';
    const n = this.gates.length, lit = this.lit;
    audio.ting?.({ vol: .25, freq: 900 });
    game.ui.toast(`${g.label} 점등 · 종 ${lit}/${n}`, 'gold');
    if (lit === n) this.#startToll(game);
    this.refreshHint(game);
  }
  /** 소등 재생을 처음부터 시작한다(첫 점등 완료와 불협 뒤 모두). */
  #startToll(game) {
    this.#phase = 'toll'; this.#tolls++;
    this.#tollClock = 0; this.#tollIndex = 0; this.#lastToll = null;
    this.#progress = 0; this.interrupt();
    game.ui.toast('종이 울립니다 · 꺼지는 순서를 기억하세요', 'gold');
  }
  #toll(game, step) {
    const t = this.def.toll, n = this.#tollGates.length;
    this.#tollClock += step;
    while (this.#tollIndex < n && this.#tollClock + EPS >= t.lead + this.#tollIndex * t.gap) {
      const g = this.#tollGates[this.#tollIndex++];
      g.phase = 'dark'; this.#lastToll = g;
      audio.ting?.({ vol: .3, freq: TOLL_FREQ[g.index % TOLL_FREQ.length] });
    }
    if (this.#tollIndex === n && this.#tollClock + EPS >= t.lead + (n - 1) * t.gap + t.tail) {
      this.#phase = 'answer'; this.#hold = 0; this.#holdGate = null;
      game.ui.toast(`종문 역순 공명 · 마지막에 꺼진 종부터 중심 ${this.def.holdSeconds}초`, 'gold');
    }
  }
  #resonate(game, g) {
    g.phase = 'resonated';
    this.#order[this.#progress++] = g.room.id;
    this.interrupt();
    audio.magic?.({ vol: .26, base: 392, notes: [0, 4, 7], step: .07, type: 'triangle' });
    game.fx.castCircle?.(g.center, 0x88dfc3, { radius: this.def.radius, life: 1 });
    const n = this.gates.length;
    if (this.#progress === n) { this.#complete(game); return; }
    game.ui.toast(`${g.label} 공명 · ${this.#progress}/${n}`, 'gold');
  }
  /** 3/3 공명 순간에만 세 방을 정답 순서대로 정화한다(보상 1회). */
  #complete(game) {
    this.#phase = 'done';
    audio.magic?.({ vol: .32, base: 392, notes: [0, 4, 7, 12], step: .08, type: 'triangle' });
    for (let i = 0; i < this.#answer.length; i++) {
      const g = this.#answer[i];
      game.markCleared(g.room);
      g.purgePending = g.room.cleared !== true;
    }
    game.autoTarget = null;
    game.ui.toast(`종문 ${this.gates.length}개 역순 공명 · 종락 회랑의 봉인이 흔들립니다`, 'gold');
    this.refreshHint(game);
  }
  /** 틀린 종에서 유지 시간을 채웠다: 피해를 주고 모든 종을 다시 켜서 소등을 처음부터 들려준다. */
  #discord(game, wrong) {
    const d = this.def, p = game.player;
    this.#discords++; this.#lastDiscord = wrong; this.#discordT = 0;
    for (let i = 0; i < this.gates.length; i++) this.gates[i].phase = 'lit';
    this.#startToll(game);
    audio.boom?.({ vol: .3, dur: .35 });
    game.fx.castCircle?.(wrong.center, 0xb06cff, { radius: d.radius, life: .8 });
    game.ui.toast(`${wrong.label} · 불협 · 소등을 처음부터 다시 듣습니다`, 'red');
    const dx = p.pos.x - wrong.center.x, dz = p.pos.z - wrong.center.z, dist = Math.hypot(dx, dz) || 1;
    p.hurt?.(p.maxHp * d.discord.damage, { dirx: dx / dist, dirz: dz / dist, kb: 2, kind: 'magic' });
  }

  /** 결과는 실제 공명만 센다. 패배를 완료로 바꾸지 않는다. 처음 만든 결과를 동결해 계속 돌려준다.
   * @param {boolean} win @returns {BellReport} */
  finish(win) {
    if (!this.#report) {
      this.#report = Object.freeze({ id: this.def.id, label: '종문 역순 공명', complete: !!win && !this.#closed && this.canWin(),
        progress: this.#progress, target: this.gates.length, rooms: Object.freeze(this.#order.slice(0, this.#progress)),
        discords: this.#discords, tolls: this.#tolls });
      this.interrupt();
      this.#refreshView(0);
    }
    return /** @type {BellReport} */ (this.#report);
  }
}
