import { Vector3 } from 'three';
import { audio } from '../engine/audio.js';

const TAU = Math.PI * 2;
/** 부호 있는 각도 차(-π~π). */
export const angleDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

/** 혜성 요새 일반의 원안: 궤도 고리 4개를 정렬해야 기사단장의 봉인이 풀린다.
 * 동사는 '밀기'다. 고리 궤도 위 룬석은 영웅이 몸으로 밀어야만 궤도를 따라 움직이고,
 * 별 표식과 각도가 맞으면 고리가 정렬된다. 지나치면 반대편으로 돌아가 되밀어야 한다.
 * 정렬 중에는 유성이 떨어진다. 평소엔 궤도 밖 고리에만 떨어져 푸른 궤도선 안쪽이 안전하지만,
 * 세 번째마다 중심 유성이 안쪽 전체를 덮으므로 그때는 바깥으로 피해야 한다.
 * 방 정화·보상·봉인은 Battle 이 그대로 소유한다. */
export class CometOrbits {
  #closed = false;
  #report = null;
  #lastHint = '';
  #markerT = 0;
  #meteorHits = 0;
  /** AUTO 경로 계산용으로 마지막 영웅 위치를 기억한다(할당 없이 참조만). */
  #player = null;
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
      // 밀기 경로와 바깥 대피 위치가 모두 걸을 수 있어야 한다.
      for (let k = 0; k < 16; k++) {
        const a = k / 16 * TAU;
        for (const r of [def.track, def.escape]) {
          if (!reach(room.x + Math.sin(a) * r, room.z + Math.cos(a) * r)) throw new RangeError(`궤도 고리 ${roomId}에 봉인 밖 접근 경로가 없습니다.`);
        }
      }
      room.label = label; room.objectiveProp = 'comet-orbit';
      return { room, label, index: i, ready: false, aligned: false, prepared: false, expected: 0, spawned: 0,
        target, angle: start, start, lockT: 0, pushes: 0, meteorT: 0, meteorN: 0, warn: null, warnT: 0, hits: 0,
        center: new Vector3(room.x, 0, room.z), stone: new Vector3(), approach: new Vector3() };
    });
    for (const g of this.gates) this.#place(g);
  }
  get progress() { return this.gates.filter(g => g.aligned).length; }
  get complete() { return this.gates.every(g => g.aligned); }
  get closed() { return this.#closed || !!this.#report; }
  get meteorHits() { return this.#meteorHits; }
  /** 아직 정렬하지 않은 고리 중 길 순서상 첫 번째(순서 제약은 없다). */
  get current() { return this.gates.find(g => !g.aligned) || null; }
  async prepareView(scene) {
    const { CometOrbitView } = await import('./comet-orbit-view.js');
    if (!this.closed) this.view = new CometOrbitView(scene, this);
  }
  #place(g) { g.stone.set(g.room.x + Math.sin(g.angle) * this.def.track, 0, g.room.z + Math.cos(g.angle) * this.def.track); }
  autoRoom() { return this.closed ? null : this.current?.room || null; }
  /** AUTO: 중심 유성 예고 중이면 바깥 대피 지점으로 간다. 그 밖에는 룬석 바로 뒤(목표 반대쪽)에서 민다.
   * 영웅이 룬석 앞쪽에 있으면 궤도 안쪽으로 돌아 들어가 반대로 밀지 않게 하고, 별에 거의 닿으면 손을 뗀다. */
  autoPoint(room) {
    const g = this.current;
    if (this.closed || g?.room !== room || !g.ready) return null;
    const d = this.def, p = this.#player?.pos;
    if (g.warn === 'center') {
      const a = p ? Math.atan2(p.x - g.room.x, p.z - g.room.z) : g.angle;
      return g.approach.set(g.room.x + Math.sin(a) * d.escape, 0, g.room.z + Math.cos(a) * d.escape);
    }
    const off = angleDiff(g.target, g.angle), dir = Math.sign(off) || 1, gap = d.contact / d.track;
    const at = (a, r) => g.approach.set(g.room.x + Math.sin(a) * r, 0, g.room.z + Math.cos(a) * r);
    if (Math.abs(off) <= d.tolerance * .6) return at(g.angle, d.track - d.band - 1);
    if (p) {
      const phi = Math.atan2(p.x - g.room.x, p.z - g.room.z), rel = angleDiff(phi, g.angle);
      const ahead = Math.sign(rel) === dir && Math.abs(rel) < Math.PI / 2;
      if (ahead && Math.hypot(p.x - g.room.x, p.z - g.room.z) > d.track - d.band - .2) return at(g.angle - dir * gap * 1.2, d.track - d.band - 1.1);
    }
    return at(g.angle - dir * gap * .3, d.track);
  }
  ownsHazards(room) { return this.gates.some(g => g.room === room && !g.aligned); }
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
  /** 고리가 있는 방은 정렬될 때까지 정화되지 않는다. */
  beforeClear(game, room) {
    const gate = this.gates.find(g => g.room === room);
    if (!gate || gate.aligned) return false;
    if (!this.closed && game.active && !game.paused && this.enemiesCleared(game, gate) && !gate.ready) {
      gate.ready = true; gate.meteorT = 0;
      game.ui.toast(`${gate.label} · 룬석을 밀어 별 표식에 맞추세요`, 'gold');
      this.refreshHint(game);
    }
    return true;
  }
  canUnseal() { return this.complete && this.world.rooms.every(r => ['start', 'boss'].includes(r.type) || r.cleared); }
  canWin() { return this.canUnseal() && !this.world.sealed && this.world.bossRoom.cleared; }
  /** 남은 정렬 각도(도). */
  offBy(g) { return Math.round(Math.abs(angleDiff(g.target, g.angle)) * 180 / Math.PI); }
  hint() {
    const n = this.gates.length, g = this.current;
    if (!g) return `궤도 고리 ${n}/${n} 정렬 · ${this.canUnseal() ? '기사단장 처치' : '남은 구역 정화'}`;
    if (!g.ready) return `궤도 고리 ${this.progress}/${n} · ${g.label} · 적 처치 후 룬석 밀기`;
    if (g.warn === 'center') return `궤도 고리 ${this.progress}/${n} · 중심 유성 · 푸른 선 밖으로`;
    return `궤도 고리 ${this.progress}/${n} · ${g.label} · 룬석 밀기 (별까지 ${this.offBy(g)}°)`;
  }
  refreshHint(game) {
    const hint = this.hint();
    if (hint !== this.#lastHint) { this.#lastHint = hint; game.ui.setObjective(this.world); }
  }
  /** 영웅이 룬석에 닿으면 궤도를 따라 영웅 반대쪽으로 밀어낸다. */
  #push(game, g) {
    const p = game.player.pos, d = this.def;
    const dx = p.x - g.room.x, dz = p.z - g.room.z, r = Math.hypot(dx, dz);
    if (Math.abs(r - d.track) > d.band) return;
    const phi = Math.atan2(dx, dz), gap = d.contact / d.track, diff = angleDiff(g.angle, phi);
    if (Math.abs(diff) >= gap) return;
    const next = phi + Math.sign(diff || 1) * gap;
    if (Math.abs(angleDiff(next, g.angle)) > 1e-4) { g.angle = Math.atan2(Math.sin(next), Math.cos(next)); g.pushes++; this.#place(g); }
  }
  #meteor(game, g, dt) {
    const d = this.def.meteor;
    if (!g.warn) {
      g.meteorT += dt;
      if (g.meteorT + 1e-9 < d.every) return;
      g.meteorT = 0; g.meteorN++;
      // 세 번째마다 중심 유성. 나머지는 궤도 밖 고리에 떨어진다.
      g.warn = g.meteorN % d.centerEvery === 0 ? 'center' : 'outer'; g.warnT = d.warning;
      if (game.world.roomAt?.(game.player.pos.x, game.player.pos.z) === g.room) audio.ting?.({ vol: .22, freq: g.warn === 'center' ? 620 : 900 });
      if (g.warn === 'center') game.ui.toast(`${g.label} · 중심 유성 예고 · 푸른 선 밖으로`, 'red');
      return;
    }
    g.warnT -= dt;
    if (g.warnT > 1e-9) return;
    const p = game.player.pos, r = Math.hypot(p.x - g.room.x, p.z - g.room.z), m = this.def;
    const inside = g.warn === 'center' ? r <= m.safe : r >= m.outerMin && r <= m.outerMax;
    game.fx.castCircle?.(g.center, 0x9fd0ff, { radius: g.warn === 'center' ? m.safe : m.outerMax, life: .5 });
    game.renderer?.shake?.(.25);
    audio.boom?.({ vol: .35, dur: .4 });
    if (inside && game.player.alive) {
      const dx = p.x - g.room.x, dz = p.z - g.room.z, l = Math.hypot(dx, dz) || 1;
      const hit = game.player.hurt?.(game.player.maxHp * d.damage, { dirx: dx / l, dirz: dz / l, kb: 2, kind: 'magic' });
      if (hit !== false) { g.hits++; this.#meteorHits++; game.ui.toast(`유성 충돌 · ${g.warn === 'center' ? '중심 유성은 푸른 선 밖으로' : '바깥 유성은 푸른 선 안쪽이 안전'}`, 'red'); }
    }
    g.warn = null;
  }
  update(game, dt) {
    if (this.closed || !game.active || game.paused || !game.player?.alive || game.bossDefeated || game.world !== this.world) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.#player = game.player;
    const cur = this.current;
    if (cur) game.autoTarget = cur.room;
    // 순서는 자유다. 준비된 모든 고리를 진행하되, 유성은 영웅이 서 있는 고리 방에만 떨어진다.
    const here = game.world.roomAt?.(game.player.pos.x, game.player.pos.z) || null;
    for (const g of this.gates) {
      if (!g.ready || g.aligned) continue;
      // 고정 프레임 결정성: 1/30초 하위 단계로 예고와 정렬 유지를 진행한다.
      for (let left = dt; left > 1e-9 && !g.aligned && game.player.alive; left -= 1 / 30) {
        const step = Math.min(left, 1 / 30);
        this.#push(game, g);
        if (g.room === here) this.#meteor(game, g, step);
        else if (g.warn) g.warn = null;
        const ok = Math.abs(angleDiff(g.target, g.angle)) <= this.def.tolerance;
        g.lockT = ok ? g.lockT + step : 0;
        if (g.lockT + 1e-9 >= this.def.lockSeconds) this.#align(game, g);
      }
    }
    this.#markerT -= dt;
    if (this.#markerT <= 0) {
      this.#markerT = 1.8;
      for (const x of this.gates) {
        if (x.aligned || !x.room.discovered || Math.hypot(game.player.pos.x - x.room.x, game.player.pos.z - x.room.z) > 22) continue;
        game.fx.damage?.(x.stone, 0, { text: !x.ready ? `${x.index + 1}번 궤도 고리 · 적 처치` : `룬석 · 별까지 ${this.offBy(x)}°` });
      }
    }
    this.view?.update(this, dt); this.refreshHint(game);
  }
  #align(game, g) {
    g.aligned = true; g.warn = null; g.lockT = 0; g.angle = g.target; this.#place(g);
    game.fx.castCircle?.(g.center, 0x9fd0ff, { radius: this.def.safe, life: 1.2 });
    audio.magic?.({ vol: .3, base: 392, notes: [0, 4, 7, 12], step: .08, type: 'triangle' });
    game.markCleared(g.room);
    game.autoTarget = this.autoRoom();
    const n = this.progress, total = this.gates.length;
    game.ui.toast(n === total ? '궤도 고리 4개 정렬 · 혜성 요새의 봉인이 흔들립니다' : `${g.label} 정렬 · ${n}/${total}`, 'gold');
    this.refreshHint(game);
  }
  /** 결과는 실제 정렬만 센다. 패배를 완료로 바꾸지 않는다. */
  finish(win) {
    if (!this.#report) this.#report = Object.freeze({ id: this.def.id, label: '궤도 고리 정렬', complete: !!win && !this.#closed && this.canWin(),
      progress: this.progress, target: this.gates.length, rooms: Object.freeze(this.gates.filter(g => g.aligned).map(g => g.room.id)),
      meteorHits: this.#meteorHits });
    return this.#report;
  }
}
