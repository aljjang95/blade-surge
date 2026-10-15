import { Vector3 } from 'three';
import { routeObjectiveForStage } from '../data/route-objectives.js';
import { CoolingValves } from './cooling-valves.js';
import { NightglassRecords } from './nightglass-records.js';
import { AstralConstellations } from './astral-constellations.js';
import { FalseThrones } from './false-thrones.js';
import { CometOrbits } from './comet-orbits.js';
import { CometDeepOrbits } from './comet-deep-orbits.js';
import { BellfallDeepBells } from './bellfall-deep-bells.js';
import { defineVerdigrisDeepAltars } from './verdigris-deep-altars.js';

/** @typedef {{id:number, x:number, z:number, type:string, label:string, spawned:boolean, cleared:boolean, discovered:boolean}} Room */
/** @typedef {{rooms:Room[], startRoom:Room, bossRoom:Room, sealed?:boolean, minX?:number, minZ?:number, cols?:number, buildFlow:(x:number,z:number)=>Int32Array|null|undefined}} World */
/** @typedef {{world:World, active:boolean, paused:boolean, bossDefeated:boolean, player:{alive:boolean,pos:Vector3}, enemies:{alive:boolean,homeRoom:Room}[], pending:{room:Room}[], autoTarget:Room|null, fx:{castCircle:Function,damage:Function}, ui:{setObjective:Function,toast:Function}, markCleared:(room:Room)=>void}} Game */
/** @typedef {{id:string, complete:boolean, progress:number, target:number, rooms:readonly number[]}} Report */

/** @param {any} stage @param {World} world */
export function createRouteObjectives(stage, world) {
  const def = routeObjectiveForStage(stage);
  if (!def) return null;
  if ('kind' in def && def.kind === 'constellations') return new AstralConstellations(def, world);
  if ('kind' in def && def.kind === 'records') return new NightglassRecords(def, world);
  if ('kind' in def && def.kind === 'thrones') return new FalseThrones(def, world);
  if ('kind' in def && def.kind === 'orbits') return new CometOrbits(def, world);
  if ('kind' in def && def.kind === 'deep-orbits') return new CometDeepOrbits(def, world);
  if ('kind' in def && def.kind === 'reverse-bells') return new BellfallDeepBells(def, world);
  // 녹청 심층은 RouteObjectives 를 상속하므로 클래스를 정의 함수로 만든다(순환 가져오기 때문, verdigris-deep-altars.js 설명 참고).
  if ('kind' in def && def.kind === 'spore-altars') return new (defineVerdigrisDeepAltars())(def, world);
  return 'kind' in def && def.kind === 'cooling' ? new CoolingValves(def, world) : new RouteObjectives(def, world);
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
  #wrongT = 0;
  #burstCooldown = 0;
  #bursts = 0;
  /** 뷰에 넘기는 옵션 객체(재사용, 프레임 루프 무할당). */
  #opts = { reduced: false };
  /** 역류 밸브 물줄기 뷰(def.view === 'backflow-valves' 이고 뷰 파일이 준비됐을 때만). 없어도 규칙은 그대로다. */
  view = null;

  /** @param {NonNullable<ReturnType<typeof routeObjectiveForStage>>} def @param {World} world */
  constructor(def, world) {
    this.def = def; this.world = world;
    const { minX, minZ, cols } = world;
    if (typeof minX !== 'number' || typeof minZ !== 'number' || typeof cols !== 'number') throw new RangeError(`${def.noun || '종문'} 이동 지도가 준비되지 않았습니다.`);
    const flow = world.buildFlow(world.startRoom.x, world.startRoom.z);
    this.gates = def.gates.map(({ roomId, label }) => {
      const room = world.rooms.find(r => r.id === roomId);
      if (!room || room.type === 'boss' || room.type === 'start' || !flow ||
          flow[Math.floor(room.z - minZ) * cols + Math.floor(room.x - minX)] < 0) {
        throw new RangeError(`${def.noun || '종문'} ${roomId}에 봉인 밖 접근 경로가 없습니다.`);
      }
      room.label = label;
      return { room, label, ready: false, attuned: false, expected: 0, spawned: 0, prepared: false };
    });
  }
  get progress() { return this.#progress; }
  get hold() { return this.#hold; }
  get complete() { return this.#progress === this.gates.length; }
  /** 종문·역류 밸브처럼 같은 순차 유지 규칙을 쓰는 목표의 이름. */
  get noun() { return this.def.noun || '종문'; }
  get verb() { return this.def.verb || '조율'; }
  get bursts() { return this.#bursts; }
  autoRoom() { return this.#closed || this.#report ? null : this.gates[this.#progress]?.room || null; }
  interrupt() { this.#hold = 0; }
  stop() { this.#closed = true; this.interrupt(); this.view?.dispose(); this.view = null; }

  /** 연출 전용: def.view 가 있는 정의에서만 뷰를 만든다. 가져오기·생성 실패는 규칙에 영향을 주지 않는다. @param {any} scene */
  async prepareView(scene) {
    if (this.def.view !== 'backflow-valves') return;
    try {
      const { BackflowValveView } = await import('./backflow-valve-view.js');
      if (!this.#closed && !this.view) this.view = new BackflowValveView(scene, this);
    } catch { /* 뷰가 없거나 만들 수 없어도 규칙은 그대로 동작한다. */ }
  }

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
    const gate = this.gates[this.#progress], n = this.gates.length, hold = this.def.holdSeconds;
    if (!gate) return `${this.noun} ${n}/${n} ${this.verb} 완료 · ${this.canUnseal() ? '보스 처치' : '남은 구역 정화'}`;
    return `${this.noun} ${this.#progress}/${n} · 다음 ${gate.label} · ${gate.ready ? `중심 ${hold}초 유지 (${this.#hold.toFixed(1)}/${hold})` : `적 처치 후 중심 ${hold}초`}`;
  }
  /** @param {Game} game */
  refreshHint(game) {
    const hint = this.hint();
    if (hint !== this.#lastHint) { this.#lastHint = hint; game.ui.setObjective(this.world); }
  }
  /** @param {Game} game @param {number} dt */
  update(game, dt) {
    this.#updateRules(game, dt);
    // 뷰는 규칙을 갱신한 뒤 같은 스텝의 상태(유지량·봉인)를 그린다(앞에서 그리면 한 스텝 늦다 — smoke-screens-1).
    // 규칙의 조기 반환(보스 처치·결과 등)과 상관없이 마지막 상태를 이어서 그린다. 일시정지에는 갱신하지 않는다.
    if (this.view && !game.paused && Number.isFinite(dt) && dt > 0) {
      this.#opts.reduced = !!game.app?.reducedMotion?.matches;
      this.view.update(this, dt, this.#opts);
    }
  }
  /** 스텝 안에서 규칙 갱신 뒤 바뀐 표시 입력(방 발견)을 시간 진행 없이 뷰에 반영한다(BUNDLE-07 b07-cand-screens 한 스텝 지연). @param {any} game */
  syncView(game) {
    if (!this.view || game?.paused) return;
    this.#opts.reduced = !!game.app?.reducedMotion?.matches;
    this.view.update(this, 0, this.#opts);
  }
  /** @param {Game} game @param {number} dt */
  #updateRules(game, dt) {
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
        game.ui.toast(`${gate.label} ${this.verb} 완료 · ${this.#progress}/${this.gates.length}`, 'gold');
      }
    }
    this.wrongStepUpdate(game, dt);
    // Existing shipped magic circle and pooled text; no new asset/mesh ownership.
    this.#markerT -= dt;
    if (this.#markerT <= 0) {
      this.#markerT = 1.8;
      for (const [i, cue] of this.gates.entries()) {
        const room = cue.room;
        if (cue.attuned || !room.discovered || Math.hypot(game.player.pos.x - room.x, game.player.pos.z - room.z) > 22) continue;
        const next = i === this.#progress;
        const pos = new Vector3(room.x, 0, room.z);
        const danger = !next && cue.ready && !!this.def.wrongStep;
        game.fx.castCircle(pos, next ? this.def.cueColor ?? 0xffd060 : danger ? this.def.wrongStep.color : 0x8394ac, { radius: this.def.radius, life: 2 });
        // 순서를 숨기는 정의(녹청 심층)는 번호 없이 지금 켜진 제단만 알린다.
        game.fx.damage(pos, 0, { text: this.def.hiddenOrder
          ? next ? cue.ready ? `뿌리 빛 · 중심 ${this.def.holdSeconds}초` : '뿌리 빛 · 적 정화' : danger ? '빛 없음 · 밟으면 포자 폭발' : '빛 없음'
          : `${i + 1}번 ${this.noun} · ${next ? cue.ready ? `중심 ${this.def.holdSeconds}초` : '적 정화' : danger ? '차례 아님 · 밟으면 포자 폭발' : '순서 대기'}` });
      }
    }
    this.refreshHint(game);
  }
  /** 정화됐지만 차례가 아닌 목표 중심에 머물면 피해를 준다(정의에 wrongStep이 있을 때만). @param {Game} game @param {number} dt */
  wrongStepUpdate(game, dt) {
    const ws = this.def.wrongStep;
    if (!ws) return;
    this.#burstCooldown = Math.max(0, this.#burstCooldown - dt);
    const pos = game.player.pos;
    const wrong = this.gates.find((g, i) => i > this.#progress && g.ready && !g.attuned &&
      Math.hypot(pos.x - g.room.x, pos.z - g.room.z) <= this.def.radius);
    this.#wrongT = wrong && this.#burstCooldown <= 0 ? this.#wrongT + dt : 0;
    if (!wrong || this.#wrongT + 1e-9 < ws.seconds) return;
    this.#wrongT = 0; this.#burstCooldown = ws.cooldown; this.#bursts++; this.interrupt();
    const dx = pos.x - wrong.room.x, dz = pos.z - wrong.room.z, d = Math.hypot(dx, dz) || 1;
    game.player.hurt?.(game.player.maxHp * ws.damage, { dirx: dx / d, dirz: dz / d, kb: 2, kind: 'magic' });
    game.fx.castCircle(new Vector3(wrong.room.x, 0, wrong.room.z), ws.color, { radius: this.def.radius, life: .8 });
    game.ui.toast(`${wrong.label} · 차례가 아닌 ${this.noun} · 포자 폭발`, 'red');
  }
  /** A result never manufactures missing holds or turns a loss into completion.
   * @param {boolean} win */
  finish(win) {
    if (!this.#report) this.#report = Object.freeze({ id: this.def.id, label: `${this.noun} ${this.verb}`, complete: !!win && !this.#closed && this.canWin(),
      ...(this.def.wrongStep ? { sporeBursts: this.#bursts } : {}),
      progress: this.#progress, target: this.gates.length, rooms: Object.freeze(this.gates.slice(0, this.#progress).map(g => g.room.id)) });
    return this.#report;
  }
}

// RouteObjectives 가 정의된 뒤에 녹청 심층 클래스를 미리 만들어 둔다(verdigris-deep-altars.js 의 VerdigrisDeepAltars 가 채워진다).
defineVerdigrisDeepAltars();
