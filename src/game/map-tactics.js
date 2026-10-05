import { mapTacticsForStage } from '../data/map-tactics.js';
import { audio } from '../engine/audio.js';

export function createMapTactics(stage, world) {
  const def = mapTacticsForStage(stage);
  return def ? new MapTactics(def, world) : null;
}

// 선택과 제어 대상의 유일한 권한. 렌더와 HUD는 읽기 전용 스냅샷만 소비한다.
export class MapTactics {
  #selected = null;
  #phase = 'ready';
  #remaining = 0;
  #used = false;
  #closed = false;
  #affected = new Set();
  #report = null;
  #snapshot = null;
  #viewPromise = null;
  view = null;

  constructor(def, world) {
    this.def = def; this.world = world;
    this.room = world.rooms.find(room => room.id === def.roomId);
    if (!this.room || this.room.type !== 'normal') throw new RangeError('환경 제어 전투방이 없습니다.');
    const flow = world.buildFlow(world.startRoom.x, world.startRoom.z);
    const reachable = point => {
      if (!flow || !Number.isFinite(world.minX) || !Number.isFinite(world.minZ) || !Number.isInteger(world.cols)) return false;
      const x = Math.floor(point.x - world.minX), z = Math.floor(point.z - world.minZ);
      return x >= 0 && x < world.cols && z >= 0 && z < world.rows && flow[z * world.cols + x] >= 0;
    };
    const room = this.room;
    this.nodes = Object.freeze(def.options.map(option => {
      const operator = Object.freeze({ x: room.x + option.side * Math.min(4.5, room.w * .25), y: 0, z: room.z - 2.5 });
      const anchor = Object.freeze({ x: operator.x, y: 0, z: operator.z + 2 });
      // 영웅 반경까지 포함한 조작판 전체와 당김 종착점은 봉인 밖 이동 영역 안에 둔다.
      for (const point of [operator, anchor]) {
        if (!reachable(point)) throw new RangeError('환경 제어 지점에 접근할 수 없습니다.');
        for (let i = 0; i < 8; i++) {
          const angle = i * Math.PI / 4, margin = point === operator ? def.operatorRadius + .6 : .9;
          if (!reachable({ x: point.x + Math.cos(angle) * margin, z: point.z + Math.sin(angle) * margin })) {
            throw new RangeError('환경 제어 조작판의 이동 영역이 막혀 있습니다.');
          }
        }
      }
      return Object.freeze({ ...option, roomId: room.id, operator, anchor,
        operatorRadius: def.operatorRadius, effectRadius: def.effectRadius, innerRadius: option.id === 'gather' ? .8 : 0 });
    }));
    room.mapTacticsId = def.id;
  }
  get selectedId() { return this.#selected?.id || null; }
  get phase() { return this.#closed ? 'closed' : this.#phase; }
  get used() { return this.#used; }
  get affectedCount() { return this.#affected.size; }

  eligible(enemy, node) {
    if (!enemy?.alive || enemy.spawning || enemy.isBoss || enemy.homeRoom !== this.room) return false;
    const dx = enemy.pos.x - node.anchor.x, dz = enemy.pos.z - node.anchor.z;
    const distanceSquared = dx * dx + dz * dz;
    return distanceSquared <= node.effectRadius * node.effectRadius && distanceSquared >= node.innerRadius * node.innerRadius;
  }
  targetCount(game, node) {
    if (!node || game.world !== this.world) return 0;
    let count = 0;
    for (const enemy of game.enemies) if (this.eligible(enemy, node)) count++;
    return count;
  }
  nearbyNode(game) {
    if (game.world !== this.world || !game.player?.pos) return null;
    const pos = game.player.pos;
    for (const node of this.nodes) {
      const dx = pos.x - node.operator.x, dz = pos.z - node.operator.z;
      if (dx * dx + dz * dz <= node.operatorRadius * node.operatorRadius) return node;
    }
    return null;
  }
  blockedReason(game, node, targetCount) {
    if (this.#closed || this.#report) return 'closed';
    if (this.#used) return 'spent';
    if (game.world !== this.world) return 'wrong-world';
    if (!game.active) return 'inactive';
    if (game.paused) return 'paused';
    if (game.player?.auto) return 'auto';
    if (!game.player?.alive) return 'dead';
    if (game.bossDefeated) return 'boss-defeated';
    if (this.world.roomAt(game.player.pos.x, game.player.pos.z) !== this.room) return 'outside-room';
    if (!this.room.spawned || this.room.cleared) return 'room-not-active';
    if (!node) return 'out-of-range';
    if (!targetCount) return 'no-targets';
    return null;
  }
  snapshot(game) {
    const node = this.nearbyNode(game), targetCount = this.targetCount(game, node);
    const blockedReason = this.blockedReason(game, node, targetCount);
    // 표시용 시계만 0.1초로 묶는다. 실제 예고·충격 계산은 원래 dt를 유지한다.
    const remainingSeconds = Math.ceil(Math.max(0, this.#remaining) * 10 - 1e-9) / 10;
    const prior = this.#snapshot, phase = this.phase, nearbyId = node?.id || null;
    if (prior && prior.phase === phase && prior.nearbyId === nearbyId && prior.targetCount === targetCount &&
        prior.blockedReason === blockedReason && prior.remainingSeconds === remainingSeconds &&
        prior.affectedCount === this.#affected.size && prior.roomDiscovered === !!this.room.discovered) return prior;
    const snapshot = Object.freeze({ id: this.def.id, roomId: this.room.id, nodes: this.nodes,
      roomDiscovered: !!this.room.discovered, selectedId: this.selectedId, phase,
      actionable: blockedReason === null, blockedReason, nearbyId, targetCount,
      affectedCount: this.#affected.size, used: this.#used, remainingSeconds });
    this.#snapshot = snapshot;
    return snapshot;
  }
  interact(game) {
    const node = this.nearbyNode(game), count = this.targetCount(game, node);
    const blocked = this.blockedReason(game, node, count);
    if (blocked) {
      if (blocked === 'no-targets') game.ui?.toast('범위 안 적 없음', 'gold');
      return false;
    }
    // 한 입력에서 먼저 예약한다. 같은 프레임의 F·터치·반복 입력은 다시 소비할 수 없다.
    this.#used = true; this.#selected = node; this.#phase = 'windup'; this.#remaining = this.def.windupSeconds;
    game.ui?.toast(`${node.label} 예고 · 이 방에서 1회`, 'gold');
    this.view?.update(this.snapshot(game));
    return true;
  }
  cancel() {
    if (this.#phase !== 'windup' && this.#phase !== 'active') return;
    this.#phase = 'canceled'; this.#remaining = 0;
  }
  #gather(game, dt) {
    const node = this.#selected;
    for (const enemy of game.enemies) {
      if (!this.eligible(enemy, node)) continue;
      enemy.pull(node.anchor.x, node.anchor.z, this.def.gatherForce * dt);
      this.#affected.add(enemy);
    }
  }
  #release(game) {
    const node = this.#selected;
    for (const enemy of game.enemies) {
      if (!this.eligible(enemy, node)) continue;
      const dx = enemy.pos.x - node.anchor.x, dz = enemy.pos.z - node.anchor.z;
      const atCenter = dx * dx + dz * dz < 1e-12;
      enemy.knockback(atCenter ? node.side : dx, atCenter ? 0 : dz,
        this.def.releaseForce * (enemy.isElite ? .5 : 1) * (enemy.def?.armor ? .6 : 1));
      this.#affected.add(enemy);
    }
  }
  update(game, dt) {
    if (this.#closed || this.#report) return;
    if (!game.active || !game.player?.alive || game.bossDefeated || game.world !== this.world ||
        this.world.roomAt(game.player.pos.x, game.player.pos.z) !== this.room) this.cancel();
    // 일시정지는 이미 예약한 행동의 남은 시간을 동결한다.
    if (game.paused) return;
    if (Number.isFinite(dt) && dt > 0 && this.#phase === 'windup') {
      const consume = Math.min(dt, this.#remaining); this.#remaining -= consume; dt -= consume;
      if (this.#remaining <= 1e-9) {
        if (this.#selected.id === 'gather') {
          this.#phase = 'active'; this.#remaining = this.def.gatherSeconds;
          audio.suck({ vol: .25, dur: this.def.gatherSeconds });
        } else {
          this.#release(game); this.#phase = 'spent'; this.#remaining = 0;
          audio.boom({ vol: .3, dur: .3, low: 95 });
        }
      }
    }
    if (Number.isFinite(dt) && dt > 0 && this.#phase === 'active') {
      const consume = Math.min(dt, this.#remaining);
      this.#gather(game, consume); this.#remaining -= consume;
      if (this.#remaining <= 1e-9) { this.#phase = 'spent'; this.#remaining = 0; }
    }
    this.view?.update(this.snapshot(game));
  }
  async prepareView(scene, game) {
    if (this.#closed || this.view) return;
    if (!this.#viewPromise) this.#viewPromise = (async () => {
      const { MapTacticsView } = await import('./map-tactics-view.js');
      if (!this.#closed) { this.view = new MapTacticsView(scene, this.nodes, this.room, this.world); this.view.update(this.snapshot(game)); }
    })().finally(() => { this.#viewPromise = null; });
    await this.#viewPromise;
  }
  finish() {
    if (this.#report) return this.#report;
    this.cancel();
    const report = Object.freeze({ id: this.def.id, roomId: this.room.id,
      selectedId: this.selectedId, label: this.#selected?.label || null,
      affectedCount: this.#affected.size, phase: this.#phase, used: this.#used, canceled: this.#phase === 'canceled' });
    this.#report = report;
    return report;
  }
  stop() {
    this.finish(); this.#closed = true;
    this.view?.dispose(); this.view = null;
  }
}
