import { Vector3 } from 'three';
import { routeObjectiveForStage } from '../data/route-objectives.js';
import { CoolingValves } from './cooling-valves.js';

/** @typedef {{id:number, x:number, z:number, type:string, label:string, spawned:boolean, cleared:boolean, discovered:boolean}} Room */
/** @typedef {{rooms:Room[], startRoom:Room, bossRoom:Room, sealed?:boolean, minX?:number, minZ?:number, cols?:number, buildFlow:(x:number,z:number)=>Int32Array|null|undefined}} World */
/** @typedef {{world:World, active:boolean, paused:boolean, bossDefeated:boolean, player:{alive:boolean,pos:Vector3}, enemies:{alive:boolean,homeRoom:Room}[], pending:{room:Room}[], autoTarget:Room|null, fx:{castCircle:Function,damage:Function}, ui:{setObjective:Function,toast:Function}, markCleared:(room:Room)=>void}} Game */
/** @typedef {{id:string, complete:boolean, progress:number, target:number, rooms:readonly number[]}} Report */

/** @param {any} stage @param {World} world */
export function createRouteObjectives(stage, world) {
  const def = routeObjectiveForStage(stage);
  return def ? ('kind' in def && def.kind === 'cooling' ? new CoolingValves(def, world) : new RouteObjectives(def, world)) : null;
}

// Combat-cleared gates remain unfinished rooms until their ordered hold is done.
// This keeps the existing AUTO explorer and room rewards on their normal path.
export class RouteObjectives {
  #progress = 0;
  #hold = 0;
  #closed = false;
  /** @type {Report|null} */
  #report = null;
  #markerT = 0;
  #lastHint = '';

  /** @param {NonNullable<ReturnType<typeof routeObjectiveForStage>>} def @param {World} world */
  constructor(def, world) {
    this.def = def; this.world = world;
    const { minX, minZ, cols } = world;
    if (typeof minX !== 'number' || typeof minZ !== 'number' || typeof cols !== 'number') throw new RangeError('종문 이동 지도가 준비되지 않았습니다.');
    const flow = world.buildFlow(world.startRoom.x, world.startRoom.z);
    this.gates = def.gates.map(({ roomId, label }) => {
      const room = world.rooms.find(r => r.id === roomId);
      if (!room || room.type === 'boss' || room.type === 'start' || !flow ||
          flow[Math.floor(room.z - minZ) * cols + Math.floor(room.x - minX)] < 0) {
        throw new RangeError(`종문 ${roomId}에 봉인 밖 접근 경로가 없습니다.`);
      }
      room.label = label;
      return { room, label, ready: false, attuned: false, expected: 0, spawned: 0, prepared: false };
    });
  }
  get progress() { return this.#progress; }
  get hold() { return this.#hold; }
  get complete() { return this.#progress === this.gates.length; }
  autoRoom() { return this.#closed || this.#report ? null : this.gates[this.#progress]?.room || null; }
  interrupt() { this.#hold = 0; }
  stop() { this.#closed = true; this.interrupt(); }

  /** @param {Room} room @param {number} count */
  prepareRoom(room, count) {
    const gate = this.gates.find(g => g.room === room);
    if (gate && !gate.prepared) { gate.prepared = true; gate.expected = count; }
  }
  /** @param {Room} room */
  spawn(room) { const gate = this.gates.find(g => g.room === room); if (gate) gate.spawned++; }
  /** @param {Game} game @param {typeof this.gates[number]} gate */
  enemiesCleared(game, gate) {
    return gate.prepared && gate.room.spawned && gate.spawned >= gate.expected &&
      !game.enemies.some(e => e.alive && e.homeRoom === gate.room) && !game.pending.some(n => n.room === gate.room);
  }
  combatPending(game, room) {
    const gate = this.gates.find(g => g.room === room);
    return !!gate && !this.enemiesCleared(game, gate);
  }
  /** Return true while this room must wait for its bell, including out-of-order clears.
   * @param {Game} game @param {Room} room */
  beforeClear(game, room) {
    const gate = this.gates.find(g => g.room === room);
    if (!gate || gate.attuned) return false;
    if (!this.#closed && !this.#report && game.active && !game.paused && this.enemiesCleared(game, gate)) {
      if (!gate.ready) {
        gate.ready = true;
        game.ui.toast(`${gate.label} 정화 · ${this.hint()}`, 'gold');
        this.refreshHint(game);
      }
    }
    return true;
  }
  canUnseal() {
    return this.complete && this.world.rooms.every(r => r.type === 'start' || r.type === 'boss' || r.cleared);
  }
  canWin() { return this.canUnseal() && !this.world.sealed && this.world.bossRoom.cleared; }
  hint() {
    const gate = this.gates[this.#progress];
    if (!gate) return `종문 3/3 조율 완료 · ${this.canUnseal() ? '보스 처치' : '남은 구역 정화'}`;
    return `종문 ${this.#progress}/3 · 다음 ${gate.label} · ${gate.ready ? `중심 2초 유지 (${this.#hold.toFixed(1)}/2)` : '적 처치 후 중심 2초'}`;
  }
  /** @param {Game} game */
  refreshHint(game) {
    const hint = this.hint();
    if (hint !== this.#lastHint) { this.#lastHint = hint; game.ui.setObjective(this.world); }
  }
  /** @param {Game} game @param {number} dt */
  update(game, dt) {
    if (this.#closed || this.#report || !game.active || game.paused || !game.player?.alive ||
        game.bossDefeated || game.world !== this.world) { this.interrupt(); return; }
    if (!Number.isFinite(dt) || dt <= 0) return;
    const gate = this.gates[this.#progress];
    if (gate) {
      game.autoTarget = gate.room;
      const inside = Math.hypot(game.player.pos.x - gate.room.x, game.player.pos.z - gate.room.z) <= this.def.radius;
      this.#hold = inside && gate.ready && this.enemiesCleared(game, gate) ? this.#hold + dt : 0;
      if (this.#hold + 1e-9 >= this.def.holdSeconds) {
        gate.attuned = true; this.#progress++; this.interrupt(); this.#markerT = 0;
        game.markCleared(gate.room);
        game.autoTarget = this.autoRoom();
        game.ui.toast(`${gate.label} 조율 완료 · ${this.#progress}/3`, 'gold');
      }
    }
    // Existing shipped magic circle and pooled text; no new asset/mesh ownership.
    this.#markerT -= dt;
    if (this.#markerT <= 0) {
      this.#markerT = 1.8;
      for (const [i, cue] of this.gates.entries()) {
        const room = cue.room;
        if (cue.attuned || !room.discovered || Math.hypot(game.player.pos.x - room.x, game.player.pos.z - room.z) > 22) continue;
        const next = i === this.#progress;
        const pos = new Vector3(room.x, 0, room.z);
        game.fx.castCircle(pos, next ? 0xffd060 : 0x8394ac, { radius: this.def.radius, life: 2 });
        game.fx.damage(pos, 0, { text: `${i + 1}번 종문 · ${next ? cue.ready ? '중심 2초' : '적 정화' : '순서 대기'}` });
      }
    }
    this.refreshHint(game);
  }
  /** A result never manufactures missing holds or turns a loss into completion.
   * @param {boolean} win */
  finish(win) {
    if (!this.#report) this.#report = Object.freeze({ id: this.def.id, complete: !!win && !this.#closed && this.canWin(),
      progress: this.#progress, target: this.gates.length, rooms: Object.freeze(this.gates.slice(0, this.#progress).map(g => g.room.id)) });
    return this.#report;
  }
}
