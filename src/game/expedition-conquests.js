import { conquestForRun } from '../data/expedition-conquests.js';

// A report copied out of a save, another start, or UI state is not a combat
// receipt. This is local flow integrity, not a server anti-cheat boundary.
const outcomes = new WeakMap();
export function readConquestOutcome(report, ticket, win) {
  const proof = report && typeof report === 'object' ? outcomes.get(report) : null;
  return proof?.ticket === ticket && proof.win === win && report.id === ticket?.conquestId ? report : null;
}

export class ConquestRun {
  constructor(stage, world, ticket) {
    this.def = conquestForRun(stage.expedition?.id, stage.expedition?.depth, stage.expedition?.conquestId);
    if (!this.def || this.def.id !== ticket?.conquestId) throw new RangeError('전술 공략 출격 정보가 맞지 않습니다.');
    this.ticket = ticket; this.world = world; this.progress = 0; this.failed = false;
    this.altars = []; this.rooms = new Map(); this.seenDeaths = new WeakSet(); this.report = null; this.markerT = 0;
    if (this.def.kind === 'altars') { world.rooms[2].conquestLabel = 'A'; world.rooms[3].conquestLabel = 'B'; }
  }
  prepareRoom(room, roster) {
    if (this.def.kind !== 'priority' || room.type !== 'elite' || this.rooms.has(room)) return;
    this.rooms.set(room, { targetType: roster[0], expected: roster.length, spawned: 0, deaths: 0, target: null, success: false });
  }
  enemyDefinition(type, def, room) {
    const state = this.rooms.get(room);
    return state && !state.target && type === state.targetType
      ? { ...def, name: `${this.def.priority === 'first' ? '표식 신호수' : '표식 운반책'} · ${def.name}` } : def;
  }
  spawn(enemy, type, room) {
    const state = this.rooms.get(room);
    if (!state || state.spawned >= state.expected) return;
    state.spawned++; enemy.conquestInitial = true;
    if (!state.target && type === state.targetType) { state.target = enemy; enemy.conquestTarget = true; }
  }
  death(enemy) {
    const state = this.rooms.get(enemy.homeRoom);
    if (this.report || !state || !enemy.conquestInitial || enemy.alive || this.seenDeaths.has(enemy)) return false;
    this.seenDeaths.add(enemy);
    if (enemy === state.target) {
      state.success = state.deaths === (this.def.priority === 'first' ? 0 : state.expected - 1);
      if (state.success) this.progress++; else this.failed = true;
    }
    state.deaths++;
    return enemy === state.target;
  }
  attune(room) {
    if (this.report || this.def.kind !== 'altars' || this.altars.includes(room.id)) return false;
    const expected = this.def.order[this.altars.length];
    this.altars.push(room.id);
    if (room.id !== expected) this.failed = true;
    if (!this.failed) this.progress = this.altars.length;
    return true;
  }
  bossPattern() {
    if (this.def.kind !== 'altars' || !this.altars.length) return null;
    return this.altars[0] === 2 ? ['slam', 'spin'] : ['summon', 'soulrain', 'slam'];
  }
  reinforcementWaves(room, base) { return this.rooms.get(room)?.success ? 0 : base; }
  bossHit(enemy, { broke, opening, direct }) {
    if (this.report || !enemy.isBoss || !direct) return false;
    if ((this.def.kind === 'breaks' && broke) || (this.def.kind === 'openings' && opening)) {
      this.progress = Math.min(this.def.target, this.progress + 1); return true;
    }
    return false;
  }
  autoRoom() {
    if (this.def.kind !== 'altars' || this.failed) return null;
    return this.world.rooms[this.def.order[this.altars.length]] || null;
  }
  autoEnemy(list) {
    if (this.def.kind !== 'priority') return null;
    for (const state of this.rooms.values()) {
      if (!state.target?.alive) continue;
      const candidates = list.filter(e => e.homeRoom === state.target.homeRoom);
      if (!candidates.length) continue;
      return this.def.priority === 'first' ? candidates.find(e => e === state.target) || candidates[0]
        : candidates.find(e => e !== state.target) || candidates[0];
    }
    return null;
  }
  precisionNeeded(enemy) {
    const state = this.rooms.get(enemy?.homeRoom);
    return !!state?.target?.alive && state.deaths < state.expected - 1 && (this.def.priority === 'last' || state.deaths === 0);
  }
  // 소환수의 자동 공격만 처치 순서를 따른다. 직접 공격의 피해·실패 규칙은 바꾸지 않는다.
  allowsSummonTarget(enemy) {
    const state = this.rooms.get(enemy?.homeRoom);
    if (this.def.kind !== 'priority' || this.failed || this.report || !state || (state.target && !state.target.alive)) return true;
    return this.def.priority === 'first'
      ? state.deaths > 0 || enemy === state.target
      : enemy !== state.target || state.deaths >= state.expected - 1;
  }
  hint() {
    if (this.failed) return '전술 조건 미달 · 원정은 계속 진행';
    if (this.progress >= this.def.target) return '전술 조건 달성 · 보스 처치 후 기록';
    if (this.def.kind === 'altars') return `전술 · ${this.def.order.map(id => id === 2 ? 'A' : 'B').join(' → ')} 제단 · ${this.progress}/2`;
    if (this.def.kind === 'priority') return `전술 · 표식 ${this.def.priority === 'first' ? '먼저' : '마지막'} 처치 · ${this.progress}/2`;
    return `전술 · ${this.def.kind === 'breaks' ? '보스 BREAK' : 'BREAK 중 명중'} · ${this.progress}/${this.def.target}`;
  }
  update(game, dt) {
    this.markerT -= dt;
    if (this.markerT > 0) return;
    this.markerT = 2;
    const target = [...this.rooms.values()].find(s => s.target?.alive && !s.target.spawning)?.target;
    if (target) game.fx.castCircle(target.pos, 0xf3c56e, { radius: 1.7, life: 1.8 });
  }
  finish(win) {
    if (!this.report) {
      this.report = Object.freeze({ id: this.def.id, complete: !!win && !this.failed && this.progress >= this.def.target,
        progress: this.progress, target: this.def.target, failed: this.failed, hint: this.hint(),
        altars: Object.freeze([...this.altars]), cancelledWaves: [...this.rooms.values()].filter(s => s.success).length });
      outcomes.set(this.report, { ticket: this.ticket, win });
    }
    return this.report;
  }
}
