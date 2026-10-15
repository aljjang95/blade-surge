import { Vector3 } from 'three';
import { audio } from '../engine/audio.js';
import { AstralConstellations } from './astral-constellations.js';

const EPS = 1e-9;
const CALM = 'calm', WARNING = 'warning', BURST = 'burst';

/** 봉인 밖 거리장 위의 한 점이 이동 가능한지(부모의 판 검사와 같은 방식). */
function reachableAt(world, flow, x, z) {
  if (!flow || !Number.isFinite(world.minX) || !Number.isFinite(world.minZ) || !Number.isInteger(world.cols)) return false;
  const cx = Math.floor(x - world.minX), cz = Math.floor(z - world.minZ);
  return cx >= 0 && cx < world.cols && cz >= 0 && cz * world.cols + cx < flow.length && flow[cz * world.cols + cx] >= 0;
}

/** 성운 첨탑 심층(BUNDLE-12)의 원안: 성좌 4곳 복원과 성좌 외곽 고리 정화.
 * 성좌 규칙(단서 읽기·판 선택·오답 재시도·혼전 숨김·행동/피격/일시정지 초기화·복원 순서 대기)은 부모 AstralConstellations 가 그대로 소유한다.
 * 이 클래스는 4/4 와 시작·보스방을 뺀 모든 구역 정화 뒤 보스 앞 정예방에 외곽 고리를 열고,
 * 고리 위 성표를 모두 정화하면 보스 봉인을 풀게 한다(canUnseal).
 * 파편 집결에 맞거나 시간이 다 되어도 피해만 입고 진행은 막지 않는다(거울 미궁·포자 수로와 같은 구조).
 * 읽기 상태(ring)는 뷰·UI·QA 가 읽기만 한다. */
export class AstralDeepConstellations extends AstralConstellations {
  #reported = null;
  /** 이미 본 progress. 4/4 가 되는 순간 토스트를 한 번만 내기 위한 값. */
  #seen = 0;
  /** 영웅 위치(참조). AUTO 가 가장 가까운 성표를 고를 때만 읽는다. */
  #hero = null;
  /** 마지막으로 피해를 준 집결 번호. 같은 집결의 피해는 한 번이다. */
  #hitCycle = -1;
  /** 뷰 갱신 옵션 객체(재사용, 프레임 루프 무할당). */
  #viewOpts = { reduced: false };
  #ringLoading = false;
  #hintKey = -1;
  #hintText = '';
  ringView = null;
  /** 고리 상태. 생성 때 한 번 만들고 필드만 바꾼다. */
  ring;

  constructor(def, world) {
    super(def, world);
    this.ring = this.#createRing(def.ring, world);
  }

  #createRing(c, world) {
    if (!c) throw new RangeError('성좌 외곽 고리 정의가 없습니다.');
    const room = world.rooms.find(r => r.id === c.roomId);
    if (!room || room.type === 'start' || room.type === 'boss' || this.gates.some(g => g.room === room)) {
      throw new RangeError('성좌 외곽 고리 방 ' + c.roomId + '이(가) 올바르지 않습니다.');
    }
    const hx = room.w / 2, hz = room.h / 2, flow = world.buildFlow(world.startRoom.x, world.startRoom.z);
    if (!c.marks?.length) throw new RangeError('성좌 외곽 고리에 성표가 없습니다.');
    const marks = c.marks.map(([dx, dz], i) => {
      const pos = new Vector3(room.x + dx, 0, room.z + dz);
      // 성표 원 전체가 방 안에 들어야 하고, 성표 판정 원과 걸어서 닿는 여유(+.6)가 막히지 않아야 한다.
      if (Math.abs(dx) + c.markRadius > hx || Math.abs(dz) + c.markRadius > hz || !reachableAt(world, flow, pos.x, pos.z)) {
        throw new RangeError('성표 ' + (i + 1) + '에 접근할 수 없습니다.');
      }
      for (let k = 0; k < 8; k++) {
        const angle = k * Math.PI / 4, margin = c.markRadius + .6;
        if (!reachableAt(world, flow, pos.x + Math.cos(angle) * margin, pos.z + Math.sin(angle) * margin)) {
          throw new RangeError('성표 ' + (i + 1) + '의 판정 영역이 막혀 있습니다.');
        }
      }
      return { pos, hold: 0, done: false };
    });
    room.label = c.label;
    return { phase: 'idle', room, center: new Vector3(room.x, 0, room.z),
      minX: room.x - hx, maxX: room.x + hx, minZ: room.z - hz, maxZ: room.z + hz,
      clock: 0, left: c.limit, limit: c.limit, elapsed: 0, collapses: 0, shardHits: 0, purified: 0, held: -1,
      marks, shard: { state: CALM, age: 0, cycle: -1 } };
  }

  async prepareView(scene) {
    await super.prepareView(scene);
    if (this.closed || this.ringView || this.#ringLoading) return;
    this.#ringLoading = true;
    try {
      const { AstralDeepRingView } = await import('./astral-deep-ring-view.js');
      if (!this.closed && !this.ringView) this.ringView = new AstralDeepRingView(scene, this);
    } catch { /* 뷰가 없거나 만들 수 없어도 규칙은 그대로 동작한다. */ }
    finally { this.#ringLoading = false; }
  }
  stop() { this.#hero = null; super.stop(); this.ringView?.dispose(); this.ringView = null; }

  /** 성좌가 정화한 방은 부모 규칙을 따르고, 고리가 열려 있거나 도는 동안은 고리 방에서도 일반 위험 연출을 막는다. */
  ownsHazards(room) {
    const ring = this.ring;
    return super.ownsHazards(room) || (!this.closed && room === ring.room && (ring.phase === 'open' || ring.phase === 'running'));
  }
  canUnseal() { return super.canUnseal() && this.ring.phase === 'done'; }

  hint() {
    const ring = this.ring;
    if (ring && this.complete && !this.closed) {
      if (ring.phase === 'open') return '외곽 고리 정화 · 성좌 외곽 고리로 이동';
      if (ring.phase === 'running') {
        // 문자열은 성표 수나 남은 초(올림)가 바뀔 때만 새로 만든다.
        const left = Math.max(0, Math.ceil(ring.left - EPS)), key = ring.purified * 1000 + left;
        if (key !== this.#hintKey) {
          this.#hintKey = key;
          this.#hintText = '외곽 고리 정화 · 성표 ' + ring.purified + '/' + ring.marks.length + ' · 파편이 모이면 중심 밖으로 · ' + left + '초';
        }
        return this.#hintText;
      }
    }
    return super.hint();
  }

  /** AUTO 가 향할 지점: 고리가 열렸거나 도는 동안 가장 가까운 미정화 성표(같은 거리면 배열 순서 앞). 그 밖은 null. */
  autoGoal() {
    const ring = this.ring;
    if (this.closed || (ring.phase !== 'open' && ring.phase !== 'running')) return null;
    const hero = this.#hero;
    let best = null, bestD = Infinity;
    for (let i = 0; i < ring.marks.length; i++) {
      const mark = ring.marks[i];
      if (mark.done) continue;
      const d = hero ? Math.hypot(mark.pos.x - hero.x, mark.pos.z - hero.z) : i;
      if (d < bestD) { best = mark.pos; bestD = d; }
    }
    return best;
  }

  update(game, dt) {
    if (game.player?.pos) this.#hero = game.player.pos;
    super.update(game, dt);
    // 부모가 일찍 끝나는 조건(닫힘·일시정지·보스 처치·월드 교체·영웅 사망·dt 무효)에서는 고리도 진행하지 않는다.
    if (this.closed || !game.active || game.paused || !game.player?.alive || game.bossDefeated || game.world !== this.world) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.#stepRing(game, dt);
    this.refreshHint(game);
    this.#updateView(game, dt);
  }

  /** 4/4 와 시작·보스방을 뺀 모든 구역 정화가 끝났는지. 프레임마다 불러도 할당하지 않는다. */
  #zonesCleared() {
    for (const r of this.world.rooms) if (r.type !== 'start' && r.type !== 'boss' && !r.cleared) return false;
    return true;
  }

  #stepRing(game, dt) {
    const ring = this.ring, c = this.def.ring;
    if (this.progress !== this.#seen) {
      this.#seen = this.progress;
      if (this.complete) {
        // 부모의 '… 복원 완료 · 4/4' 토스트 바로 뒤에 한 번. 이 스텝에는 고리를 열지 않고 다음 update 에서 연다.
        game.ui.toast('모든 별자리 복원 · 모든 구역을 정화하면 성좌 외곽 고리가 열립니다', 'gold');
        return;
      }
    }
    if (ring.phase === 'done') return;
    if (ring.phase === 'idle') {
      if (!this.complete || !this.#zonesCleared()) return;
      // 열리는 스텝에는 시간이 흐르지 않는다.
      ring.phase = 'open'; ring.clock = 0; ring.left = ring.limit; ring.elapsed = 0; this.#hitCycle = -1;
      this.#updateShard();
      game.ui.toast('성좌 외곽 고리 개방 · 고리 위 성표 4개를 정화하세요', 'gold');
      return;
    }
    const hero = game.player.pos, wasRunning = ring.phase === 'running';
    ring.clock += dt;
    this.#updateShard();
    if (!wasRunning) {
      if (hero.x >= ring.minX && hero.x <= ring.maxX && hero.z >= ring.minZ && hero.z <= ring.maxZ) {
        // 시작 스텝에도 시간과 성표 유지는 흐르지 않는다.
        ring.phase = 'running'; ring.elapsed = 0; ring.left = ring.limit;
        game.ui.toast('외곽 고리 정화 시작 · ' + ring.limit + '초', 'gold');
      }
      this.#shardHit(game, hero);
      return;
    }
    ring.elapsed += dt; ring.left -= dt;
    let held = -1;
    for (let i = 0; i < ring.marks.length; i++) {
      const mark = ring.marks[i];
      if (mark.done) continue;
      if (Math.hypot(hero.x - mark.pos.x, hero.z - mark.pos.z) <= c.markRadius + EPS) { mark.hold += dt; held = i; }
      else mark.hold = 0;
      if (mark.hold + EPS >= c.holdSeconds) {
        mark.done = true; mark.hold = c.holdSeconds; ring.purified++; held = -1;
        // 마지막 성표는 아래 완료 토스트 하나로 알린다(같은 순간 두 번 알리지 않는다).
        if (ring.purified < ring.marks.length) game.ui.toast('성표 정화 · ' + ring.purified + '/' + ring.marks.length, 'gold');
      }
    }
    ring.held = held;
    // 같은 스텝에서는 완료가 집결 피해와 붕괴보다 먼저다.
    if (ring.purified === ring.marks.length) {
      ring.phase = 'done'; ring.held = -1;
      game.ui.toast('외곽 고리 정화 · 레비아탄의 봉인이 풀립니다', 'gold');
      audio.magic?.({ vol: .32, base: 247, notes: [0, 3, 7, 12], step: .08, type: 'triangle' });
      // unsealBoss 는 canUnseal 을 다시 확인하므로 phase 를 바꾼 뒤에 부른다.
      game.unsealBoss?.();
      return;
    }
    this.#shardHit(game, hero);
    if (ring.left <= EPS) {
      ring.collapses++;
      for (let i = 0; i < ring.marks.length; i++) { ring.marks[i].done = false; ring.marks[i].hold = 0; }
      ring.purified = 0; ring.held = -1; ring.left = ring.limit;
      game.player.hurt?.(game.player.maxHp * c.collapseDamage, { kb: 0, kind: 'magic' });
      game.ui.toast('외곽 고리 붕괴 · 성표가 흐려졌습니다 · 다시 ' + ring.limit + '초', 'red');
    }
  }

  /** 집결 상태를 clock 에서 계산한다(경계 부동소수 오차는 EPS 로 흡수). */
  #updateShard() {
    const ring = this.ring, c = this.def.ring, shard = ring.shard, u = ring.clock - c.first + EPS;
    if (u < 0) { shard.state = CALM; shard.age = ring.clock; shard.cycle = -1; return; }
    const cycle = Math.floor(u / c.period), m = u - cycle * c.period;
    shard.cycle = cycle;
    if (m < c.warning) { shard.state = WARNING; shard.age = m; }
    else if (m < c.warning + c.burst) { shard.state = BURST; shard.age = m - c.warning; }
    else { shard.state = CALM; shard.age = m - c.warning - c.burst; }
  }

  /** 터지는 동안 중심 반경 안(경계 포함)의 영웅에게 집결마다 한 번 피해를 준다. */
  #shardHit(game, hero) {
    const ring = this.ring, c = this.def.ring, shard = ring.shard;
    if (shard.state !== BURST || this.#hitCycle === shard.cycle) return;
    if (Math.hypot(hero.x - ring.center.x, hero.z - ring.center.z) > c.core + EPS) return;
    this.#hitCycle = shard.cycle; ring.shardHits++;
    game.player.hurt?.(game.player.maxHp * c.damage, { kb: 0, kind: 'magic' });
    game.ui.toast('파편 집결 피격 · 파편이 모이면 중심 밖으로', 'red');
  }

  #updateView(game, dt) {
    if (!this.ringView) return;
    this.#viewOpts.reduced = !!game.app?.reducedMotion?.matches;
    this.ringView.update(this, dt, this.#viewOpts);
  }
  /** 시간 진행 없이 고리 뷰를 맞춘다. 일시정지에는 갱신하지 않는다. */
  syncView(game) {
    if (!this.ringView || game?.paused) return;
    this.#viewOpts.reduced = !!game.app?.reducedMotion?.matches;
    this.ringView.update(this, 0, this.#viewOpts);
  }

  /** 결과는 실제 값만 센다. 패배를 완료로 바꾸지 않고 한 번 만든 보고는 바뀌지 않는다. */
  finish(win) {
    if (!this.#reported) {
      const base = super.finish(win), ring = this.ring;
      this.#reported = Object.freeze({ ...base, ring: Object.freeze({ purified: ring.phase === 'done', marks: ring.purified,
        collapses: ring.collapses, shardHits: ring.shardHits, seconds: Math.round(ring.elapsed * 100) / 100 }) });
    }
    return this.#reported;
  }
}
