import { Vector3 } from 'three';
import { audio } from '../engine/audio.js';

/** A vent's visible strip and its hit test use these exact dimensions. */
export function coolingVent(gate) {
  return { x: gate.room.x + gate.side * 3.5, z: gate.room.z, width: 4, length: 12 };
}
export function coolingVentContains(gate, pos) {
  const h = coolingVent(gate);
  return Math.abs(pos.x - h.x) <= h.width / 2 && Math.abs(pos.z - h.z) <= h.length / 2;
}

/** Sequential physical valves. Room completion remains owned by Battle so that
 * rewards, reinforcements and settlement cannot be duplicated by interaction. */
export class CoolingValves {
  #progress = 0;
  #hold = 0;
  #closed = false;
  #report = null;
  #lastHint = '';
  #markerT = 0;
  view = null;
  constructor(def, world) {
    this.def = def; this.world = world;
    const flow = world.buildFlow(world.startRoom.x, world.startRoom.z);
    this.gates = def.gates.map(({ roomId, label }, i) => {
      const room = world.rooms.find(r => r.id === roomId);
      if (!room || ['boss', 'start'].includes(room.type) || !flow ||
          typeof world.minX !== 'number' || typeof world.minZ !== 'number' || typeof world.cols !== 'number') {
        throw new RangeError(`냉각 밸브 ${roomId}의 이동 지도가 없습니다.`);
      }
      for (const dx of [0, -def.padOffset, def.padOffset]) {
        const index = Math.floor(room.z - world.minZ) * world.cols + Math.floor(room.x + dx - world.minX);
        if (!(flow[index] >= 0)) throw new RangeError(`냉각 밸브 ${roomId}에 봉인 밖 접근 경로가 없습니다.`);
      }
      room.label = label;
      room.objectiveProp = 'cooling-valve';
      return { room, label, ready: false, attuned: false, prepared: false, expected: 0, spawned: 0,
        side: i % 2 ? -1 : 1, phase: 'heat', age: 0, cycles: 0, ventHit: false, hits: 0,
        pos: new Vector3(room.x, 0, room.z), pad: new Vector3(room.x, 0, room.z) };
    });
    this.updatePad();
  }
  get progress() { return this.#progress; }
  get hold() { return this.#hold; }
  get complete() { return this.#progress === this.gates.length; }
  get closed() { return this.#closed || !!this.#report; }
  async prepareView(scene) {
    const [{ CoolingValveView }, { loadModel }] = await Promise.all([import('./cooling-valve-view.js'), import('../engine/assets.js')]);
    const gltf = await loadModel('tllCoolingValve');
    if (!this.closed) this.view = new CoolingValveView(scene, gltf, this);
  }
  autoRoom() { return this.closed ? null : this.gates[this.#progress]?.room || null; }
  autoPoint(room) {
    const gate = this.gates[this.#progress];
    return !this.closed && gate?.room === room && gate.ready ? gate.pad : null;
  }
  ownsHazards(room) { return this.gates.some(g => g.room === room); }
  interrupt() { this.#hold = 0; }
  stop() { this.#closed = true; this.interrupt(); this.view?.dispose(); this.view = null; }
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
  beforeClear(game, room) {
    const gate = this.gates.find(g => g.room === room);
    if (!gate || gate.attuned) return false;
    if (!this.closed && game.active && !game.paused && this.enemiesCleared(game, gate) && !gate.ready) {
      gate.ready = true;
      game.ui.toast(`${gate.label} 방어 완료 · 청록 조작판에서 2초 유지`, 'gold');
      this.refreshHint(game);
    }
    return true;
  }
  canUnseal() { return this.complete && this.world.rooms.every(r => ['start', 'boss'].includes(r.type) || r.cleared); }
  canWin() { return this.canUnseal() && !this.world.sealed && this.world.bossRoom.cleared; }
  updatePad() {
    for (const g of this.gates) g.pad.set(g.room.x - g.side * this.def.padOffset, 0, g.room.z);
  }
  hint() {
    const gate = this.gates[this.#progress], n = this.gates.length;
    if (!gate) return `냉각선 ${n}/${n} 복구 · ${this.canUnseal() ? '보스 처치' : '남은 구역 정화'}`;
    const vent = gate.phase === 'warning' ? '과열 예고' : gate.phase === 'vent' ? '증기 분출' : '가열 중';
    return `밸브 ${this.#progress}/${n} · ${gate.label} · ${vent} · ${gate.ready ? `청록판 2초 (${this.#hold.toFixed(1)}/2)` : '적과 증원 처치'}`;
  }
  refreshHint(game) {
    const hint = this.hint();
    if (hint !== this.#lastHint) { this.#lastHint = hint; game.ui.setObjective(this.world); }
  }
  step(game, gate, dt) {
    // Only the current, entered valve runs. Remote rooms cannot inflict damage.
    if (!gate.prepared || !gate.room.spawned) { this.interrupt(); return; }
    gate.age += dt;
    const duration = gate.phase === 'heat' ? this.def.heatSeconds
      : gate.phase === 'warning' ? this.def.warningSeconds : this.def.ventSeconds;
    if (gate.age + 1e-9 >= duration) {
      gate.age = Math.max(0, gate.age - duration);
      if (gate.phase === 'heat') {
        gate.phase = 'warning'; gate.ventHit = false;
        if (game.world.roomAt(game.player.pos.x, game.player.pos.z) === gate.room) audio.ting({ vol: .22, freq: 760 });
      } else if (gate.phase === 'warning') {
        gate.phase = 'vent';
        if (game.world.roomAt(game.player.pos.x, game.player.pos.z) === gate.room) audio.whoosh({ vol: .28, pitch: .65, dur: .3 });
      } else {
        gate.phase = 'heat'; gate.side *= -1; gate.cycles++; this.interrupt(); this.updatePad();
      }
    }
    if (gate.phase === 'vent' && !gate.ventHit && coolingVentContains(gate, game.player.pos)) {
      gate.ventHit = true; this.interrupt();
      const hit = game.player.hurt(game.player.maxHp * .06, { dirx: gate.side, dirz: 0, kb: 2, kind: 'magic' });
      if (hit) { gate.hits++; game.ui.toast('과열 피해 · 반대편 청록 조작판으로 이동', 'red'); }
    }
    if (!game.active || !game.player.alive) { this.interrupt(); return; }
    const inside = Math.hypot(game.player.pos.x - gate.pad.x, game.player.pos.z - gate.pad.z) <= this.def.radius;
    const stable = ['idle', 'move'].includes(game.player.state);
    this.#hold = inside && stable && gate.ready && this.enemiesCleared(game, gate) ? this.#hold + dt : 0;
    if (this.#hold + 1e-9 >= this.def.holdSeconds) {
      gate.attuned = true; gate.phase = 'cooled'; this.#progress++; this.interrupt();
      game.markCleared(gate.room); game.autoTarget = this.autoRoom();
      game.ui.toast(`${gate.label} 개방 · 냉각선 ${this.#progress}/${this.gates.length} 복구`, 'gold');
      audio.magic({ vol: .3, base: 330, notes: [0, 4, 7], step: .09 });
    }
  }
  update(game, dt) {
    if (this.closed || !game.active || game.paused || !game.player?.alive || game.bossDefeated || game.world !== this.world) {
      this.interrupt(); return;
    }
    if (!Number.isFinite(dt) || dt <= 0) return;
    // Bounded substeps preserve warnings and holds under deterministic app.step.
    const gate = this.gates[this.#progress];
    if (gate) {
      game.autoTarget = gate.room;
      for (let left = dt; left > 1e-9 && !gate.attuned && game.active && game.player.alive; left -= 1 / 30) {
        this.step(game, gate, Math.min(left, 1 / 30));
      }
    }
    this.#markerT -= dt;
    if (this.#markerT <= 0) {
      this.#markerT = 1.8;
      for (const [i, g] of this.gates.entries()) {
        if (!g.room.discovered || g.attuned || Math.hypot(game.player.pos.x - g.room.x, game.player.pos.z - g.room.z) > 22) continue;
        game.fx.damage(g.pos, 0, { text: i !== this.#progress ? `${i + 1}번 밸브 · 순서 대기` : g.ready ? '청록 조작판 · 2초' : '밸브 방어 · 증원 처치' });
      }
    }
    this.view?.update(this); this.refreshHint(game);
  }
  finish(win) {
    if (!this.#report) this.#report = Object.freeze({ id: this.def.id, complete: !!win && !this.#closed && this.canWin(),
      progress: this.#progress, target: this.gates.length, rooms: Object.freeze(this.gates.filter(g => g.attuned).map(g => g.room.id)),
      overheatHits: this.gates.reduce((n, g) => n + g.hits, 0) });
    return this.#report;
  }
}
