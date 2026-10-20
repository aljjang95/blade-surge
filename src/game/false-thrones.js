import { Vector3 } from 'three';
import { audio } from '../engine/audio.js';

/** 흑사막 환영 분지 일반의 원안: 가짜 왕좌 세 개를 부숴야 여왕의 본체가 드러난다.
 * 기존 목표(중심에서 n초 유지)와 다른 동사다. 왕좌는 실제 공격으로만 깎이며,
 * 보라 모래시계가 멈춘 동안에만 피해가 들어가고, 도는 동안 때리면 모래가 반사된다.
 * 방 정화·보상·봉인은 Battle 이 그대로 소유하고 이 클래스는 언제 정화를 허락할지만 정한다. */
export class FalseThrones {
  #closed = false;
  #report = null;
  #lastHint = '';
  #markerT = 0;
  #reflectCd = 0;
  #reflects = 0;
  #blocked = 0;
  view = null;
  constructor(def, world) {
    this.def = def; this.world = world;
    const { minX, minZ, cols } = world;
    if (typeof minX !== 'number' || typeof minZ !== 'number' || typeof cols !== 'number') throw new RangeError('가짜 왕좌 이동 지도가 준비되지 않았습니다.');
    const flow = world.buildFlow(world.startRoom.x, world.startRoom.z);
    const reach = (x, z) => !!flow && flow[Math.floor(z - minZ) * cols + Math.floor(x - minX)] >= 0;
    this.gates = def.gates.map(({ roomId, label }, i) => {
      const room = world.rooms.find(r => r.id === roomId);
      if (!room || room.type === 'boss' || room.type === 'start' || !reach(room.x, room.z) || !reach(room.x - def.standOff, room.z)) {
        throw new RangeError(`가짜 왕좌 ${roomId}에 봉인 밖 접근 경로가 없습니다.`);
      }
      room.label = label; room.objectiveProp = 'false-throne';
      return { room, label, index: i, ready: false, broken: false, prepared: false, expected: 0, spawned: 0,
        // 왕좌마다 위상이 달라 세 방이 똑같은 박자로 움직이지 않는다.
        phase: 'spin', age: i * .6, hits: 0, gap: 0, flash: 0,
        pos: new Vector3(room.x, 0, room.z), stand: new Vector3(room.x - def.standOff, 0, room.z) };
    });
  }
  get progress() { return this.gates.filter(g => g.broken).length; }
  get complete() { return this.gates.every(g => g.broken); }
  get closed() { return this.#closed || !!this.#report; }
  get reflects() { return this.#reflects; }
  get blocked() { return this.#blocked; }
  /** 아직 부수지 않은 왕좌 중 길 순서상 첫 번째. 순서 제약은 없고 AUTO 안내용이다. */
  get current() { return this.gates.find(g => !g.broken) || null; }
  async prepareView(scene) {
    const { FalseThroneView } = await import('./false-throne-view.js');
    if (!this.closed) this.view = new FalseThroneView(scene, this);
  }
  autoRoom() { return this.closed ? null : this.current?.room || null; }
  autoPoint(room) {
    const gate = this.current;
    return !this.closed && gate?.room === room && gate.ready ? gate.stand : null;
  }
  /** AUTO 는 모래시계가 멈춘 왕좌 옆에서만 공격한다(반사 벌칙을 일부러 밟지 않는다). @param {any} player */
  autoStrike(player) {
    const gate = this.current;
    // 멈춤이 곧 끝나면 휘두르지 않는다. 휘두른 타격이 회전 중에 닿아 반사되는 일을 막는다.
    if (this.closed || !gate?.ready || gate.phase !== 'still' || gate.age > this.def.stillSeconds - this.def.autoMargin) return null;
    const d = Math.hypot(player.pos.x - gate.pos.x, player.pos.z - gate.pos.z);
    return d <= this.def.standOff + .9 ? gate : null;
  }
  ownsHazards(room) { return this.gates.some(g => g.room === room && !g.broken); }
  interrupt() {}
  stop() { this.#closed = true; this.view?.dispose(); this.view = null; }
  prepareRoom(room, count) {
    const gate = this.gates.find(g => g.room === room);
    if (gate && !gate.prepared) { gate.prepared = true; gate.expected = count; }
  }
  spawn(room) { const gate = this.gates.find(g => g.room === room); if (gate) gate.spawned++; }
  enemiesCleared(game, gate) {
    return gate.prepared && gate.room.spawned && gate.spawned >= gate.expected &&
      !game.enemies.some(e => e.alive && e.homeRoom === gate.room) && !game.pending.some(n => n.room === gate.room);
  }
  combatPending(game, room) {
    const gate = this.gates.find(g => g.room === room);
    return !!gate && !this.enemiesCleared(game, gate);
  }
  /** 왕좌가 서 있는 방은 부서질 때까지 정화되지 않는다. */
  beforeClear(game, room) {
    const gate = this.gates.find(g => g.room === room);
    if (!gate || gate.broken) return false;
    if (!this.closed && game.active && !game.paused && this.enemiesCleared(game, gate) && !gate.ready) {
      gate.ready = true; gate.phase = 'spin'; gate.age = 0;
      game.ui.toast(`${gate.label} · 보라 모래시계가 멈출 때 공격`, 'gold');
      this.refreshHint(game);
    }
    return true;
  }
  canUnseal() { return this.complete && this.world.rooms.every(r => ['start', 'boss'].includes(r.type) || r.cleared); }
  canWin() { return this.canUnseal() && !this.world.sealed && this.world.bossRoom.cleared; }
  hint() {
    const n = this.gates.length, done = this.progress, gate = this.current;
    if (!gate) return `가짜 왕좌 ${n}/${n} 파괴 · ${this.canUnseal() ? '여왕 처치' : '남은 구역 정화'}`;
    if (!gate.ready) return `가짜 왕좌 ${done}/${n} · ${gate.label} · 적 처치 후 공격`;
    return `가짜 왕좌 ${done}/${n} · ${gate.label} · ${gate.phase === 'still' ? `모래시계 멈춤 · 지금 공격 ${gate.hits}/${this.def.hits}` : '모래시계 회전 · 공격하면 반사'}`;
  }
  refreshHint(game) {
    const hint = this.hint();
    if (hint !== this.#lastHint) { this.#lastHint = hint; game.ui.setObjective(this.world); }
  }
  /** 이 위치·범위의 아군 타격이 닿는 왕좌 하나를 찾는다. */
  #touched(x, z, reach) {
    for (const g of this.gates) {
      if (g.broken) continue;
      if (Math.hypot(x - g.pos.x, z - g.pos.z) <= reach + this.def.radius) return g;
    }
    return null;
  }
  /** Battle 의 근접·광역 판정이 부른다. 한 번의 판정은 왕좌 하나에 최대 1타.
   * 실제로 균열이 생기거나 반사됐을 때만 true 다(막힘·연타 간격은 타격으로 세지 않는다). @returns {boolean} */
  strike(game, x, z, reach) {
    if (this.closed || !game.active || game.paused || !game.player?.alive) return false;
    const gate = this.#touched(x, z, reach);
    if (!gate) return false;
    if (!gate.ready) {
      // 방의 적이 남아 있으면 모래 장막이 막는다. 벌칙은 없다.
      if (gate.gap <= 0) { gate.gap = this.def.hitGap; this.#blocked++; game.fx.damage?.(gate.pos, 0, { text: '모래 장막 · 적을 먼저 처치' }); }
      return false;
    }
    if (gate.gap > 0) return false;
    gate.gap = this.def.hitGap;
    if (gate.phase !== 'still') return this.#reflect(game, gate);
    gate.hits++; gate.flash = .18;
    game.fx.damage?.(gate.pos, 0, { text: `왕좌 균열 ${gate.hits}/${this.def.hits}` });
    audio.ting?.({ vol: .2, freq: 520 + gate.hits * 60 });
    if (gate.hits >= this.def.hits) this.#break(game, gate);
    else this.refreshHint(game);
    return true;
  }
  /** 투사체: 관통이 아니면 맞은 왕좌에서 소멸한다. 같은 투사체는 한 왕좌를 한 번만 친다. */
  strikeProjectile(game, p) {
    const gate = this.#touched(p.pos.x, p.pos.z, p.radius);
    if (!gate || p.hit.has(gate)) return false;
    p.hit.add(gate);
    return this.strike(game, gate.pos.x, gate.pos.z, 0);
  }
  #reflect(game, gate) {
    if (this.#reflectCd > 0) return false;
    this.#reflectCd = this.def.reflect.cooldown; this.#reflects++;
    const p = game.player, dx = p.pos.x - gate.pos.x, dz = p.pos.z - gate.pos.z, d = Math.hypot(dx, dz) || 1;
    p.hurt?.(p.maxHp * this.def.reflect.damage, { dirx: dx / d, dirz: dz / d, kb: 2.5, kind: 'magic' });
    game.fx.castCircle?.(gate.pos, this.def.spinColor, { radius: this.def.radius + 1, life: .6 });
    game.ui.toast(`${gate.label} · 모래시계가 도는 중 · 모래 반사`, 'red');
    return true;
  }
  #break(game, gate) {
    gate.broken = true; gate.phase = 'broken';
    this.view?.shatter(gate);
    game.fx.castCircle?.(gate.pos, this.def.stillColor, { radius: 4, life: 1.2 });
    game.renderer?.shake?.(.35);
    audio.magic?.({ vol: .32, base: 247, notes: [0, 3, 7, 12], step: .08, type: 'triangle' });
    game.markCleared(gate.room);
    game.autoTarget = this.autoRoom();
    const n = this.progress, total = this.gates.length;
    game.ui.toast(n === total ? `마지막 가짜 왕좌 파괴 · 환영 여왕의 본체가 드러납니다` : `${gate.label} 파괴 · ${n}/${total}`, 'gold');
    this.refreshHint(game);
  }
  update(game, dt) {
    if (this.closed || !game.active || game.paused || !game.player?.alive || game.bossDefeated || game.world !== this.world) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.#reflectCd = Math.max(0, this.#reflectCd - dt);
    for (const g of this.gates) {
      g.gap = Math.max(0, g.gap - dt); g.flash = Math.max(0, g.flash - dt);
      if (g.broken || !g.ready) continue;
      g.age += dt;
      const span = g.phase === 'still' ? this.def.stillSeconds : this.def.spinSeconds;
      if (g.age + 1e-9 >= span) {
        g.age -= span; g.phase = g.phase === 'still' ? 'spin' : 'still';
        if (g.phase === 'still' && game.world.roomAt?.(game.player.pos.x, game.player.pos.z) === g.room) audio.ting?.({ vol: .2, freq: 880 });
      }
    }
    const gate = this.current;
    if (gate) game.autoTarget = gate.room;
    this.#markerT -= dt;
    if (this.#markerT <= 0) {
      this.#markerT = 1.8;
      for (const g of this.gates) {
        if (g.broken || !g.room.discovered || Math.hypot(game.player.pos.x - g.pos.x, game.player.pos.z - g.pos.z) > 22) continue;
        game.fx.damage?.(g.pos, 0, { text: !g.ready ? `${g.index + 1}번 가짜 왕좌 · 적 처치` : g.phase === 'still' ? '모래시계 멈춤 · 공격' : '모래시계 회전 · 대기' });
      }
    }
    this.view?.update(this, dt); this.refreshHint(game);
  }
  /** 결과는 실제 파괴만 센다. 패배를 완료로 바꾸지 않는다. */
  finish(win) {
    if (!this.#report) this.#report = Object.freeze({ id: this.def.id, label: '가짜 왕좌 파괴', complete: !!win && !this.#closed && this.canWin(),
      progress: this.progress, target: this.gates.length, rooms: Object.freeze(this.gates.filter(g => g.broken).map(g => g.room.id)),
      sandReflects: this.#reflects });
    return this.#report;
  }
}
