import { Vector3 } from 'three';
import { audio } from '../engine/audio.js';
import { angleDiff } from './comet-orbits.js';

const TAU = Math.PI * 2;
/** 판정 하위 단계. dt가 크거나 작아도 같은 단계 순서로 진행해 결과가 같다. */
const STEP = 1 / 30;
/** @typedef {{id:string, label:string, complete:boolean, progress:number, target:number, rooms:readonly number[], collapseFailures:number, stormHits:number}} DeepOrbitReport */
const PHASE_ORDER = Object.freeze({ locked: 0, ready: 1, collapse: 2, shelter: 3, storm: 4, connected: 5 });

/** 혜성 요새 심층의 원안: 궤도 고리 5개를 연결해야 기사단장의 봉인이 풀린다.
 * 흐름은 locked → ready → collapse(9초) → shelter(0.5초) → storm(3회) → connected 다.
 * 룬석 밀기 기하는 일반판 CometOrbits 와 같고, 첫 실제 밀기에서 붕괴 시계가 시작된다.
 * 시간 안에 못 맞추면 그 고리만 처음 위치로 돌아간다. 정렬 뒤 중심 쉼터에 머물면 연결되고,
 * 연결 직후 유성 폭풍이 세 번 떨어진다. 붉은 원 안에서는 청록 빈 원(쉼터)만 안전하다.
 * 방 정화·보상은 연결이 끝난 순간 한 번만 Battle.markCleared 로 넘기고, 봉인·승리는 Battle 이 소유한다.
 * 공명 제단은 이 목표로 교체된다(allowsAttunement / coexistsAttunement 가 false).
 * 읽기 상태(gates·current·progress 등)는 뷰·UI 가 읽기만 한다. */
export class CometDeepOrbits {
  #closed = false;
  /** @type {DeepOrbitReport|null} */
  #report = null;
  #settled = false;
  #connected = 0;
  #failures = 0;
  #stormHits = 0;
  /** 연결된 방 id 를 연결 순서대로 담는 고정 길이 버퍼. */
  #order;
  #here = null;
  /** AUTO 경로 계산용으로 마지막 영웅 위치를 기억한다(할당 없이 참조만). */
  #player = null;
  #hint = '';
  #hintSig = -1;
  /** 뷰에 넘기는 옵션 객체(재사용). */
  #opts = { reduced: false };
  view = null;
  constructor(def, world) {
    this.def = def; this.world = world;
    const { minX, minZ, cols } = world;
    if (typeof minX !== 'number' || typeof minZ !== 'number' || typeof cols !== 'number') throw new RangeError('궤도 고리 이동 지도가 준비되지 않았습니다.');
    const flow = world.buildFlow(world.startRoom.x, world.startRoom.z);
    const reach = (x, z) => !!flow && flow[Math.floor(z - minZ) * cols + Math.floor(x - minX)] >= 0;
    this.gates = def.gates.map(({ roomId, label, target, start }, i) => {
      const room = world.rooms.find(r => r.id === roomId);
      if (!room || room.type === 'boss' || room.type === 'start') throw new RangeError(`궤도 고리 ${roomId}는 전투 구역이 아닙니다.`);
      const at = (a, r) => new Vector3(room.x + Math.sin(a) * r, 0, room.z + Math.cos(a) * r);
      // 쉼터 세 곳: 방 중심, 별, 옆자리. 한 변이 track 인 정삼각형이다.
      const shelters = def.storm.shelters.map(name =>
        name === 'center' ? at(0, 0) : name === 'star' ? at(target, def.track) : at(target + Math.PI / 3, def.track));
      // 밀기 경로(track)와 쉼터 경로(중심·쉼터 반경·세 쉼터)가 모두 걸을 수 있어야 한다.
      for (let k = 0; k < 16; k++) {
        const a = k / 16 * TAU;
        for (const r of [def.track, def.shelterRadius]) {
          if (!reach(room.x + Math.sin(a) * r, room.z + Math.cos(a) * r)) throw new RangeError(`궤도 고리 ${roomId}에 봉인 밖 접근 경로가 없습니다.`);
        }
      }
      for (const s of shelters) if (!reach(s.x, s.z)) throw new RangeError(`궤도 고리 ${roomId}의 쉼터에 봉인 밖 접근 경로가 없습니다.`);
      room.label = label; room.objectiveProp = 'comet-orbit';
      return { room, label, index: i, phase: 'locked', present: false, prepared: false, expected: 0, spawned: 0,
        target, start, angle: start, lockT: 0, connectT: 0, clock: 0, slack: null, failures: 0, hits: 0,
        stormIndex: 0, stormT: 0, stormWarn: false, stormWarnT: 0, detour: false,
        center: at(0, 0), stone: new Vector3(), approach: new Vector3(), shelters, stormShelter: shelters[0].clone() };
    });
    this.#order = new Array(this.gates.length).fill(0);
    for (const g of this.gates) this.#place(g);
  }

  // ---------------- 읽기 상태 ----------------
  get progress() { return this.#connected; }
  get complete() { return this.#connected === this.gates.length; }
  get closed() { return this.#closed || !!this.#report; }
  get collapseFailures() { return this.#failures; }
  get stormHits() { return this.#stormHits; }
  /** 영웅이 있는 방(고리 방이 아니어도 된다). 방 밖이면 null. */
  get here() { return this.#here; }
  /** 공명 제단은 이 목표로 교체된다. */
  get coexistsAttunement() { return false; }
  /** @param {unknown} [_room] */
  allowsAttunement(_room) { return false; }
  /** 영웅이 있는 방의 활성 고리 → 첫 활성 고리 → 영웅이 있는 방의 미연결 고리 → 첫 미연결 고리 → null. */
  get current() {
    const gs = this.gates;
    for (let i = 0; i < gs.length; i++) if (gs[i].present && CometDeepOrbits.#active(gs[i])) return gs[i];
    for (let i = 0; i < gs.length; i++) if (CometDeepOrbits.#active(gs[i])) return gs[i];
    for (let i = 0; i < gs.length; i++) if (gs[i].present && gs[i].phase !== 'connected') return gs[i];
    for (let i = 0; i < gs.length; i++) if (gs[i].phase !== 'connected') return gs[i];
    return null;
  }
  static #active(g) { return g.phase === 'collapse' || g.phase === 'shelter' || g.phase === 'storm'; }
  /** 남은 정렬 각도(도). */
  offBy(g) { return Math.round(Math.abs(angleDiff(g.target, g.angle)) * 180 / Math.PI); }
  #gate(room) {
    for (let i = 0; i < this.gates.length; i++) if (this.gates[i].room === room) return this.gates[i];
    return null;
  }
  #place(g) { g.stone.set(g.room.x + Math.sin(g.angle) * this.def.track, 0, g.room.z + Math.cos(g.angle) * this.def.track); }

  // ---------------- 뷰 ----------------
  async prepareView(scene) {
    const { CometDeepOrbitView } = await import('./comet-deep-orbit-view.js');
    if (!this.closed) this.view = new CometDeepOrbitView(scene, this);
  }
  #refreshView(dt) { this.view?.update(this, dt, this.#opts); }

  // ---------------- Battle 인터페이스 ----------------
  autoRoom() { return this.closed ? null : this.current?.room ?? null; }
  #at(g, a, r) { return g.approach.set(g.room.x + Math.sin(a) * r, 0, g.room.z + Math.cos(a) * r); }
  /** AUTO: 밀기 단계는 룬석 바로 뒤(목표 반대쪽)에서 민다. 정렬되면 중심 쉼터, 폭풍에는 빈 원으로 간다.
   * 영웅이 룬석보다 밀기 방향 앞에 있으면 룬석 90° 뒤 안쪽 점으로 돌아 들어간다. 이 우회는 확실히 뒤로 돌아올 때까지 유지한다.
   * 실제 AUTO 는 1칸 격자 흐름장으로 걸어 각도가 흔들리므로, 반경 경계 하나로만 고르면 두 점 사이를 영원히 오간다(cand-auto-1 실패 표본). */
  autoPoint(room) {
    const g = this.#gate(room);
    if (this.closed || !g || this.current !== g || g.phase === 'locked') return null;
    if (g.phase === 'shelter') return g.approach.copy(g.center);
    if (g.phase === 'storm') return g.approach.copy(g.stormShelter);
    const d = this.def, p = this.#player?.pos;
    const off = angleDiff(g.target, g.angle), dir = Math.sign(off) || 1, gap = d.contact / d.track;
    if (Math.abs(off) <= d.tolerance * .6) { g.detour = false; return this.#at(g, g.angle, d.track - d.band - 1); }
    if (p) {
      const phi = Math.atan2(p.x - g.room.x, p.z - g.room.z), rel = angleDiff(phi, g.angle);
      const lead = rel * dir;
      if (!g.detour && lead > 0 && lead < Math.PI / 2 && Math.hypot(p.x - g.room.x, p.z - g.room.z) > d.track - d.band - .2) g.detour = true;
      else if (g.detour && (lead < -gap || lead >= Math.PI / 2)) g.detour = false;
      if (g.detour) return this.#at(g, g.angle - dir * Math.PI / 2, d.track - d.band - .9);
    }
    return this.#at(g, g.angle - dir * gap * .3, d.track);
  }
  /** locked 전투 중에는 기존 지역 위험을 유지하고, 고리가 열린 뒤부터 이 컨트롤러가 예고를 소유한다. */
  ownsHazards(room) {
    const g = this.#gate(room);
    return !this.closed && !!g && g.phase !== 'locked' && g.phase !== 'connected';
  }
  interrupt() { for (let i = 0; i < this.gates.length; i++) this.gates[i].connectT = 0; }
  stop() {
    this.#closed = true;
    this.#clearWarn();
    const view = this.view; this.view = null;
    view?.dispose();
  }
  #clearWarn() {
    for (let i = 0; i < this.gates.length; i++) { const g = this.gates[i]; g.stormWarn = false; g.connectT = 0; }
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
  /** 고리가 있는 방은 연결될 때까지 정화되지 않는다. */
  beforeClear(game, room) {
    const gate = this.#gate(room);
    if (!gate || gate.phase === 'connected') return false;
    if (gate.phase === 'locked' && !this.closed && game.active && !game.paused && this.enemiesCleared(game, gate)) this.#ready(game, gate);
    return true;
  }
  #ready(game, g) {
    g.phase = 'ready'; g.clock = 0;
    game.ui.toast(`${g.label} · 룬석을 밀면 궤도 붕괴 ${this.def.collapseSeconds}초가 시작됩니다`, 'gold');
    this.refreshHint(game);
  }
  canUnseal() {
    if (this.#connected !== this.gates.length) return false;
    const rooms = this.world.rooms;
    for (let i = 0; i < rooms.length; i++) if (rooms[i].type !== 'start' && rooms[i].type !== 'boss' && !rooms[i].cleared) return false;
    return true;
  }
  canWin() { return this.canUnseal() && !this.world.sealed && this.world.bossRoom.cleared; }

  // ---------------- 목표 문구 ----------------
  #buildSig() {
    const g = this.current;
    return this.#connected * 10000 + (g ? (g.index + 1) * 1000 + PHASE_ORDER[g.phase] * 10 + (g.present ? 1 : 0) : this.canUnseal() ? 1 : 0);
  }
  /** phase·진행이 바뀔 때만 문장을 새로 만든다(카운트다운은 넣지 않는다). */
  hint() {
    const sig = this.#buildSig();
    if (sig === this.#hintSig) return this.#hint;
    this.#hintSig = sig;
    const n = this.gates.length, g = this.current, head = `궤도 고리 ${this.#connected}/${n}`, d = this.def;
    if (!g) this.#hint = `${head} 연결 · ${this.canUnseal() ? '기사단장 처치' : '남은 구역 정화'}`;
    else if (g.phase === 'locked') this.#hint = `${head} · ${g.label} · 적 처치 후 룬석 밀기`;
    else if (g.phase === 'ready') this.#hint = `${head} · ${g.label} · 룬석을 밀면 붕괴 ${d.collapseSeconds}초 시작`;
    else if (g.phase === 'collapse') this.#hint = `${head} · ${g.label} · 붕괴 중 · 룬석을 별에 맞추기`;
    else if (g.phase === 'shelter') this.#hint = `${head} · ${g.label} · 중심 쉼터 ${d.connectSeconds}초 유지`;
    else this.#hint = g.present ? `${head} · 유성 폭풍 · 빈 원으로 이동` : `${head} · 유성 폭풍 중단 · 고리 구역으로 돌아가기`;
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
      // 일시정지는 마지막 화면을 유지한다. 그 밖의 종료 사유는 처음 한 번만 예고를 거두고 뷰를 갱신한다.
      if (!game.paused && !this.#settled) { this.#settled = true; this.#clearWarn(); this.#opts.reduced = !!game.app?.reducedMotion?.matches; this.#refreshView(0); }
      return;
    }
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.#settled = false;
    this.#player = player;
    const here = game.world.roomAt?.(player.pos.x, player.pos.z) || null;
    this.#here = here;
    const gs = this.gates;
    for (let i = 0; i < gs.length; i++) gs[i].present = gs[i].room === here;
    for (let i = 0; i < gs.length; i++) {
      const g = gs[i];
      if (g.phase === 'locked' && this.enemiesCleared(game, g)) this.#ready(game, g);
      if (g.phase === 'locked' || g.phase === 'connected') continue;
      // 고정 프레임 결정성: 1/30초 하위 단계로 밀기·시계·폭풍을 진행한다.
      for (let left = dt; left > 1e-9 && g.phase !== 'connected' && player.alive; left -= STEP) this.#tick(game, g, Math.min(left, STEP));
    }
    const cur = this.current;
    if (cur) game.autoTarget = cur.room;
    this.#opts.reduced = !!game.app?.reducedMotion?.matches;
    this.#refreshView(dt);
    this.refreshHint(game);
  }
  /** 한 하위 단계: 밀기 → 정렬 유지 → 쉼터 연결 → 시계 → 폭풍. 성공 판정이 시간 초과보다 먼저다. */
  #tick(game, g, step) {
    const d = this.def;
    if (g.phase === 'ready' || g.phase === 'collapse') {
      if (this.#push(game, g) && g.phase === 'ready') {
        g.phase = 'collapse'; g.clock = d.collapseSeconds; g.lockT = 0;
        game.ui.toast(`${g.label} · 궤도 붕괴 시작 · ${d.collapseSeconds}초 안에 룬석을 별에 맞추세요`, 'red');
      }
    }
    if (g.phase === 'collapse') {
      g.lockT = Math.abs(angleDiff(g.target, g.angle)) <= d.tolerance ? g.lockT + step : 0;
      if (g.lockT + 1e-9 >= d.lockSeconds) {
        g.phase = 'shelter'; g.lockT = 0; g.connectT = 0; g.angle = g.target; this.#place(g);
        game.fx.castCircle?.(g.center, 0x63e7dd, { radius: d.shelterRadius, life: 1.2 });
        audio.magic?.({ vol: .3, base: 392, notes: [0, 4, 7, 12], step: .08, type: 'triangle' });
        game.ui.toast(`${g.label} 정렬 · 중심 쉼터에 ${d.connectSeconds}초 머물러 연결`, 'gold');
      }
    }
    if (g.phase === 'shelter') {
      const p = game.player.pos;
      const inside = g.present && Math.hypot(p.x - g.center.x, p.z - g.center.z) <= d.shelterRadius;
      g.connectT = inside ? g.connectT + step : 0;
      if (g.connectT + 1e-9 >= d.connectSeconds) {
        g.slack = g.clock; g.clock = 0; g.connectT = 0; g.phase = 'storm';
        g.stormIndex = 0; g.stormT = 0; g.stormWarn = false; g.stormWarnT = 0;
        game.ui.toast(`${g.label} 연결 · 유성 폭풍 · 빈 원을 따라 이동`, 'gold');
      }
    }
    if (g.phase === 'collapse' || g.phase === 'shelter') {
      g.clock -= step;
      if (g.clock <= 1e-9) this.#fail(game, g);
    }
    if (g.phase === 'storm') this.#storm(game, g, step);
  }
  /** 영웅이 룬석에 닿으면 궤도를 따라 영웅 반대쪽으로 밀어낸다. 각이 실제로 바뀌었을 때만 true. */
  #push(game, g) {
    const p = game.player.pos, d = this.def;
    const dx = p.x - g.room.x, dz = p.z - g.room.z, r = Math.hypot(dx, dz);
    if (Math.abs(r - d.track) > d.band) return false;
    const phi = Math.atan2(dx, dz), gap = d.contact / d.track, diff = angleDiff(g.angle, phi);
    if (Math.abs(diff) >= gap) return false;
    const next = phi + Math.sign(diff || 1) * gap;
    if (Math.abs(angleDiff(next, g.angle)) <= 1e-4) return false;
    g.angle = Math.atan2(Math.sin(next), Math.cos(next)); this.#place(g);
    return true;
  }
  /** 시간 초과: 그 고리만 처음 위치로 돌아가 다시 민다. 방 정화·보상·피해는 없다. */
  #fail(game, g) {
    g.failures++; this.#failures++;
    g.angle = g.start; g.lockT = 0; g.connectT = 0; g.clock = 0; g.slack = null; g.phase = 'ready';
    g.stormIndex = 0; g.stormT = 0; g.stormWarn = false; g.stormWarnT = 0; g.detour = false;
    this.#place(g);
    game.fx.castCircle?.(g.center, 0xff6a5a, { radius: this.def.shelterRadius, life: .8 });
    audio.boom?.({ vol: .25, dur: .3 });
    game.ui.toast(`${g.label} 붕괴 · 룬석이 처음 위치로 돌아갔습니다`, 'red');
  }
  /** 폭풍 3회. 영웅이 그 방에 있을 때만 시간이 흐르고, 방을 벗어나면 그 회차는 처음부터 다시 시작한다. */
  #storm(game, g, step) {
    const s = this.def.storm;
    if (!g.present) { g.stormT = 0; g.stormWarn = false; g.stormWarnT = 0; return; }
    g.stormT += step;
    if (g.stormIndex < s.shelters.length) {
      const k = g.stormIndex, lead = k === 0 ? 0 : s.gap, span = lead + s.warning;
      if (!g.stormWarn && g.stormT + 1e-9 >= lead) {
        g.stormWarn = true; g.stormShelter.copy(g.shelters[k]);
        audio.ting?.({ vol: .22, freq: 700 });
      }
      if (g.stormT + 1e-9 >= span) {
        this.#strike(game, g);
        g.stormIndex++; g.stormT = Math.max(0, g.stormT - span); g.stormWarn = false; g.stormWarnT = 0;
      } else if (g.stormWarn) g.stormWarnT = span - g.stormT;
    }
    if (g.stormIndex >= s.shelters.length && g.stormT + 1e-9 >= s.tail) this.#connect(game, g);
  }
  /** 충돌 판정은 회차당 한 번: 반경 안이면서 빈 원 밖일 때만 피해를 준다. */
  #strike(game, g) {
    const d = this.def, s = d.storm, p = game.player.pos, sh = g.stormShelter;
    game.fx.castCircle?.(g.center, 0xff6a5a, { radius: s.radius, life: .5 });
    game.renderer?.shake?.(.25);
    audio.boom?.({ vol: .35, dur: .4 });
    if (!g.present || Math.hypot(p.x - g.center.x, p.z - g.center.z) > s.radius) return;
    const dx = p.x - sh.x, dz = p.z - sh.z, dist = Math.hypot(dx, dz);
    if (dist <= d.shelterRadius) return;
    const hit = game.player.hurt?.(game.player.maxHp * s.damage, { dirx: dx / dist, dirz: dz / dist, kb: 2, kind: 'magic' });
    if (hit !== false) {
      g.hits++; this.#stormHits++;
      game.ui.toast('유성 피격 · 붉은 원 안에서는 청록 빈 원만 안전합니다', 'red');
    }
  }
  /** 연결 완료: 이 순간에만 방을 정화한다(보상 1회). */
  #connect(game, g) {
    g.phase = 'connected'; g.stormWarn = false; g.stormWarnT = 0; g.stormT = 0;
    this.#order[this.#connected++] = g.room.id;
    this.#place(g);
    audio.magic?.({ vol: .3, base: 392, notes: [0, 4, 7, 12], step: .08, type: 'triangle' });
    game.markCleared(g.room);
    game.autoTarget = this.autoRoom();
    const n = this.#connected, total = this.gates.length;
    game.ui.toast(n === total ? `궤도 고리 ${total}개 연결 · 혜성 요새의 봉인이 흔들립니다` : `${g.label} 연결 완료 · ${n}/${total}`, 'gold');
    this.refreshHint(game);
  }

  /** 결과는 실제 연결만 센다. 패배를 완료로 바꾸지 않는다. 처음 만든 결과를 동결해 계속 돌려준다.
   * @param {boolean} win @returns {DeepOrbitReport} */
  finish(win) {
    if (!this.#report) {
      const complete = !!win && !this.#closed && this.canWin();
      this.#clearWarn();
      this.#report = Object.freeze({ id: this.def.id, label: '궤도 고리 연결', complete, progress: this.#connected, target: this.gates.length,
        rooms: Object.freeze(this.#order.slice(0, this.#connected)), collapseFailures: this.#failures, stormHits: this.#stormHits });
      this.#refreshView(0);
    }
    return /** @type {DeepOrbitReport} */ (this.#report);
  }
}
