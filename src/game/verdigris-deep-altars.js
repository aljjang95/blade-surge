import { Vector3 } from 'three';
import { audio } from '../engine/audio.js';
import { RouteObjectives } from './route-objectives.js';

// 순환 가져오기 주의: route-objectives.js 가 이 파일을 가져오고 이 파일도 RouteObjectives 를 가져온다.
// 그래서 클래스는 모듈 평가 때가 아니라 defineVerdigrisDeepAltars() 를 부를 때 만든다
// (route-objectives.js 가 RouteObjectives 를 정의한 뒤 맨 아래에서 한 번, 이후 createRouteObjectives 가 다시 부른다).
// 클래스 본문과 정의 함수는 이 파일의 const 를 평가 시점에 읽지 않는다.

const EPS = 1e-9;
const CALM = 'calm', WARNING = 'warning', BURST = 'burst';
/** AUTO 가 띠 상태를 살피기 시작하는, 진행 방향 앞 띠 가장자리까지의 거리(m). 영웅 이동은 즉시 멈추므로 한 스텝 이동량(최대 약 0.2m)보다 충분히 크다. */
const APPROACH = 1;
/** 분출까지 이만큼(초) 이상 남아야 AUTO 가 띠를 건넌다. 가장 느린 영웅(5.6m/s)이 접근 거리와 띠 폭(2.2m)을 건너는 데 약 0.57초 걸린다. */
const SAFE_LEAD = .8;

/** 조사 '으로/로'를 붙인다(받침 없음·ㄹ 받침은 '로'). */
function toward(label) {
  const code = label.charCodeAt(label.length - 1) - 0xac00;
  const tail = code >= 0 && code < 11172 ? code % 28 : 0;
  return label + (tail === 0 || tail === 8 ? '로' : '으로');
}

/** 만들어 둔 클래스. 처음 부를 때 한 번만 만든다. */
export var VerdigrisDeepAltars;

/** 녹청 성역 심층의 클래스를 만들어 돌려준다(여러 번 불러도 같은 클래스). */
export function defineVerdigrisDeepAltars() {
  if (!VerdigrisDeepAltars) VerdigrisDeepAltars = createClass(RouteObjectives);
  return VerdigrisDeepAltars;
}

function createClass(Base) {
  /** 녹청 성역 심층의 원안: 생명 제단 4곳 정화와 포자 수로 돌파.
   * 제단 규칙(순차 유지·차례 아닌 제단의 포자 폭발·방 정화)은 부모 RouteObjectives 가 그대로 소유한다.
   * 이 클래스는 (1) 뿌리 빛(점등)이 정화마다 길 순서와 다른 다음 제단으로 옮겨 가는 읽기 상태를 만들고,
   * (2) 4곳 정화와 시작·보스방을 뺀 모든 구역 정화 뒤 보스 앞 정예방에 포자 수로를 연다.
   * 수로는 서쪽 출발선 안쪽에서 시작해 제한 시간 안에 동쪽 도착선을 넘으면 보스 봉인을 풀고(canUnseal),
   * 포자 띠에 맞거나 시간이 다 되어도 피해만 입고 진행은 막지 않는다(거울 미궁과 같은 구조).
   * 읽기 상태(lit·litMoves·litT·channel)는 뷰·UI·QA 가 읽기만 한다. */
  return class VerdigrisDeepAltars extends Base {
    #stopped = false;
    /** @type {any} */
    #reported = null;
    #seen = 0;
    #litMoves = 0;
    #litT = 0;
    /** 영웅 위치(참조). AUTO 가 수로에서 기다릴지 정할 때만 읽는다. */
    #hero = null;
    /** 도착 지점(출구)까지의 거리장. 수로 방 구조는 바뀌지 않으므로 한 번만 만든다. */
    #flow = null;
    /** 띠마다 마지막으로 피해를 준 분출 번호. 같은 분출의 피해는 한 번이다. */
    #hitCycle = null;
    /** 뷰 갱신 옵션 객체(재사용, 프레임 루프 무할당). */
    #viewOpts = { reduced: false };
    #dirty = false;
    /** 포자 수로 상태. 생성 때 한 번 만들고 필드만 바꾼다. */
    channel;

    constructor(def, world) {
      super(def, world);
      this.channel = this.#createChannel(def.channel, world);
      this.#hitCycle = new Int32Array(this.channel.bands.length).fill(-1);
    }

    #createChannel(c, world) {
      if (!c) throw new RangeError('포자 수로 정의가 없습니다.');
      const room = world.rooms.find(r => r.id === c.roomId);
      if (!room || room.type === 'boss' || room.type === 'start' || this.gates.some(g => g.room === room)) {
        throw new RangeError('포자 수로 방 ' + c.roomId + '이(가) 올바르지 않습니다.');
      }
      const hx = room.w / 2, hz = room.h / 2;
      const first = c.bands[0], last = c.bands[c.bands.length - 1];
      // 출발선·도착선·띠·입구·출구가 방 안에 순서대로 놓여야 한다(서 → 동).
      const ordered = c.bands.every((x, i) => i === 0 || x - c.bandHalf > c.bands[i - 1] + c.bandHalf);
      if (!c.bands.length || !ordered || -hx > c.entry[0] || c.exit[0] > hx || Math.abs(c.entry[1]) > hz || Math.abs(c.exit[1]) > hz ||
          !(c.entry[0] <= c.startLine && c.startLine < first - c.bandHalf && last + c.bandHalf < c.finishLine && c.finishLine <= c.exit[0])) {
        throw new RangeError('포자 수로 배치가 방 안에 맞지 않습니다.');
      }
      const entry = new Vector3(room.x + c.entry[0], 0, room.z + c.entry[1]);
      const exit = new Vector3(room.x + c.exit[0], 0, room.z + c.exit[1]);
      const reach = world.buildFlow(world.startRoom.x, world.startRoom.z);
      for (const p of [entry, exit]) {
        const i = this.#cellIndex(p.x, p.z);
        if (i < 0 || world.inner?.[i] !== 1 || !reach || !(reach[i] >= 0)) throw new RangeError('포자 수로 입구·출구에 봉인 밖 접근 경로가 없습니다.');
      }
      this.#flow = world.buildFlow(exit.x, exit.z);
      if (!this.#flow) throw new RangeError('포자 수로 출구 거리장을 만들 수 없습니다.');
      room.label = c.label;
      return { phase: 'idle', room, entry, exit, minX: room.x - hx, maxX: room.x + hx, minZ: room.z - hz, maxZ: room.z + hz,
        startX: room.x + c.startLine, finishX: room.x + c.finishLine, clock: 0, left: 0, limit: 0, elapsed: 0, floods: 0, sporeHits: 0,
        bands: c.bands.map(x => ({ x: room.x + x, half: c.bandHalf, state: CALM, age: 0, cycle: -1 })) };
    }
    /** 월드 좌표의 이동 지도 칸 번호. 지도 밖이면 -1. */
    #cellIndex(x, z) {
      const { minX, minZ, cols, rows } = this.world;
      const cx = Math.floor(x - minX), cz = Math.floor(z - minZ);
      return cx < 0 || cz < 0 || cx >= cols || cz >= rows ? -1 : cz * cols + cx;
    }

    /** 지금 켜진 제단. 4곳을 모두 정화했거나 목표가 끝났으면 null. */
    get lit() { return this.complete || this.closed ? null : this.gates[this.progress] || null; }
    /** 뿌리 빛이 다음 제단으로 옮겨 간 횟수(정화마다 +1, 마지막 정화에는 옮겨 갈 곳이 없다). */
    get litMoves() { return this.#litMoves; }
    /** 마지막 점등 이동 뒤 지난 게임 초. */
    get litT() { return this.#litT; }
    get closed() { return this.#stopped || !!this.#reported; }
    /** 공명 제단은 이 목표로 교체된다. */
    allowsAttunement() { return false; }
    get coexistsAttunement() { return false; }

    async prepareView(scene) {
      if (this.#stopped || this.view) return;
      try {
        const { VerdigrisDeepView } = await import('./verdigris-deep-view.js');
        if (!this.#stopped && !this.view) this.view = new VerdigrisDeepView(scene, this);
      } catch { /* 뷰가 없거나 만들 수 없어도 규칙은 그대로 동작한다. */ }
    }
    stop() { this.#stopped = true; this.#hero = null; super.stop(); }

    ownsHazards(room) {
      const ch = this.channel;
      return room === ch.room && (ch.phase === 'open' || ch.phase === 'running') && !this.closed;
    }
    canUnseal() { return super.canUnseal() && this.channel.phase === 'done'; }

    hint() {
      const ch = this.channel;
      if (ch && this.complete) {
        if (ch.phase === 'open') return '포자 수로 돌파 · 서쪽 입구에서 포자 물결을 피해 동쪽 출구로';
        if (ch.phase === 'running') return '포자 수로 돌파 · 포자 물결이 지나간 뒤 동쪽 출구로 · ' + Math.ceil(ch.left) + '초';
      }
      return super.hint();
    }

    /** 제단 방이 준비된 스텝(Battle.markCleared)에 시간 진행 없이 뷰를 맞춘다. */
    beforeClear(game, room) {
      const gate = this.gates.find(g => g.room === room), ready = gate?.ready;
      const result = super.beforeClear(game, room);
      if (gate && gate.ready !== ready) this.syncView(game);
      return result;
    }

    /** AUTO 가 향할 지점: 열렸으면 서쪽 입구, 도는 동안은 동쪽 출구. 진행 방향 앞 띠를 지금 건너면 위험하면 제자리(영웅 위치)를 돌려줘 멈춘다. */
    autoGoal() {
      const ch = this.channel;
      if (this.closed) return null;
      const target = ch.phase === 'open' ? ch.entry : ch.phase === 'running' ? ch.exit : null;
      if (!target) return null;
      const hero = this.#hero;
      return hero && this.#mustWait(hero, target) ? hero : target;
    }
    /** 영웅이 방 안에서 진행 방향(x) 앞 띠 가장자리 APPROACH 안에 있고 그 띠를 지금 건너면 위험한지. 띠 안이면 앞으로 빠진다. */
    #mustWait(hero, target) {
      const ch = this.channel, dir = target.x > hero.x ? 1 : target.x < hero.x ? -1 : 0;
      if (!dir || hero.x < ch.minX || hero.x > ch.maxX || hero.z < ch.minZ || hero.z > ch.maxZ) return false;
      for (let i = 0; i < ch.bands.length; i++) {
        const band = ch.bands[i];
        const gap = ((dir > 0 ? band.x - band.half : band.x + band.half) - hero.x) * dir;
        if (gap > 0 && gap <= APPROACH && this.#burstLead(i) < SAFE_LEAD) return true;
      }
      return false;
    }
    /** 띠 i 가 다음에 분출하기까지 남은 초. 분출 중이면 0. */
    #burstLead(i) {
      const ch = this.channel, c = this.def.channel, band = ch.bands[i];
      if (band.state === BURST) return 0;
      if (band.state === WARNING) return c.warning - band.age;
      return band.cycle < 0 ? c.first + i * c.lag + c.warning - ch.clock : c.period - (band.age + c.warning + c.burst) + c.warning;
    }

    update(game, dt) {
      if (game.player?.pos) this.#hero = game.player.pos;
      super.update(game, dt);
      if (this.closed || !game.active || game.paused || !game.player?.alive || game.bossDefeated || game.world !== this.world) return;
      if (!Number.isFinite(dt) || dt <= 0) return;
      this.#dirty = false;
      this.#litT += dt;
      this.#trackLit(game);
      this.#stepChannel(game, dt);
      this.refreshHint(game);
      // 부모가 뷰를 그린 뒤에 바뀐 점등 이동·수로 상태를 시간 진행 없이 한 번 더 맞춘다.
      if (this.#dirty) this.syncView(game);
    }

    /** 정화로 progress 가 늘면 뿌리 빛이 다음 제단으로 옮겨 간다. */
    #trackLit(game) {
      const p = this.progress, n = this.gates.length;
      if (p === this.#seen) return;
      this.#seen = p; this.#dirty = true;
      const done = this.gates[p - 1];
      if (p < n) {
        this.#litMoves = p; this.#litT = 0;
        game.ui.toast(done.label + ' 정화 · ' + p + '/' + n + ' · 뿌리 빛이 ' + toward(this.gates[p].label) + ' 옮겨 갑니다', 'gold');
        audio.ting?.({ vol: .25, freq: 660 });
      } else {
        this.#litMoves = n - 1;
        game.ui.toast(done.label + ' 정화 · ' + p + '/' + n + ' · 모든 구역을 정화하면 포자 수로가 열립니다', 'gold');
      }
    }

    /** 4곳 정화와 시작·보스방을 뺀 모든 구역 정화가 끝났는지. 프레임마다 불러도 할당하지 않는다. */
    #zonesCleared() {
      for (const r of this.world.rooms) if (r.type !== 'start' && r.type !== 'boss' && !r.cleared) return false;
      return true;
    }
    #resetLimit(pos) {
      const ch = this.channel, c = this.def.channel, i = this.#cellIndex(pos.x, pos.z);
      let dist = this.#flow && i >= 0 ? this.#flow[i] : -1;
      if (!(dist >= 0)) dist = Math.hypot(pos.x - ch.exit.x, pos.z - ch.exit.z) * 1.5;
      ch.limit = ch.left = Math.ceil(dist / c.pace + c.grace);
    }

    #stepChannel(game, dt) {
      const ch = this.channel, c = this.def.channel;
      if (ch.phase === 'done') return;
      if (ch.phase === 'idle') {
        if (!this.complete || !this.#zonesCleared()) return;
        // 열리는 스텝에는 시간이 흐르지 않는다.
        ch.phase = 'open'; ch.clock = 0; this.#dirty = true;
        this.#updateBands(game);
        game.ui.toast('포자 수로 개방 · 서쪽 입구에서 포자 물결을 피해 동쪽 출구로', 'gold');
        game.fx.castCircle?.(ch.entry, c.color, { radius: 2.5, life: 1.2 });
        return;
      }
      const wasRunning = ch.phase === 'running', p = game.player.pos;
      ch.clock += dt;
      this.#updateBands(game);
      const inside = p.x >= ch.minX && p.x <= ch.maxX && p.z >= ch.minZ && p.z <= ch.maxZ;
      if (!wasRunning) {
        if (inside && p.x <= ch.startX + EPS) {
          ch.phase = 'running'; ch.elapsed = 0; this.#resetLimit(p); this.#dirty = true;
          game.ui.toast('포자 수로 돌파 시작 · ' + ch.limit + '초', 'gold');
        }
        return;
      }
      ch.elapsed += dt; ch.left -= dt;
      // 같은 스텝에서는 도착이 범람보다 먼저다.
      if (inside && p.x >= ch.finishX - EPS) {
        ch.phase = 'done'; this.#dirty = true;
        game.ui.toast('포자 수로 돌파 · 녹청 거수의 봉인이 풀립니다', 'gold');
        game.fx.castCircle?.(ch.exit, c.color, { radius: 4, life: 1.2 });
        audio.magic?.({ vol: .32, base: 247, notes: [0, 3, 7, 12], step: .08, type: 'triangle' });
        // unsealBoss 는 canUnseal 을 다시 확인하므로 phase 를 바꾼 뒤에 부른다.
        game.unsealBoss?.();
        return;
      }
      if (ch.left <= EPS) {
        ch.floods++; this.#dirty = true;
        game.player.hurt?.(game.player.maxHp * c.floodDamage, { kb: 0, kind: 'magic' });
        this.#resetLimit(p);
        game.ui.toast('포자 수로 범람 · 다시 ' + ch.limit + '초', 'red');
      }
    }

    /** 띠 상태를 clock 에서 계산하고, 분출 중인 띠 안의 영웅에게 분출당 한 번 피해를 준다. */
    #updateBands(game) {
      const ch = this.channel, c = this.def.channel, p = game.player.pos;
      const inside = p.x >= ch.minX && p.x <= ch.maxX && p.z >= ch.minZ && p.z <= ch.maxZ;
      for (let i = 0; i < ch.bands.length; i++) {
        const band = ch.bands[i], u = ch.clock - c.first - i * c.lag + EPS;
        let state, age, cycle;
        if (u < 0) { state = CALM; age = ch.clock; cycle = -1; }
        else {
          cycle = Math.floor(u / c.period);
          const m = u - cycle * c.period;
          if (m < c.warning) { state = WARNING; age = m; }
          else if (m < c.warning + c.burst) { state = BURST; age = m - c.warning; }
          else { state = CALM; age = m - c.warning - c.burst; }
        }
        if (band.state !== state) this.#dirty = true;
        band.state = state; band.age = age; band.cycle = cycle;
        if (state === BURST && inside && Math.abs(p.x - band.x) <= band.half + EPS && this.#hitCycle[i] !== cycle) {
          this.#hitCycle[i] = cycle; ch.sporeHits++; this.#dirty = true;
          game.player.hurt?.(game.player.maxHp * c.damage, { kb: 0, kind: 'magic' });
          game.ui.toast('포자 물결 피격 · 물결이 지나간 뒤 건너기', 'red');
        }
      }
    }

    /** 규칙을 갱신한 뒤 시간 진행 없이 뷰를 맞춘다. 일시정지에는 갱신하지 않는다. */
    syncView(game) {
      if (!this.view || game?.paused) return;
      this.#viewOpts.reduced = !!game.app?.reducedMotion?.matches;
      this.view.update(this, 0, this.#viewOpts);
    }

    /** 결과는 실제 값만 센다. 패배를 완료로 바꾸지 않고 한 번 만든 보고는 바뀌지 않는다. */
    finish(win) {
      if (!this.#reported) {
        const base = super.finish(win), ch = this.channel;
        this.#reported = Object.freeze({ ...base, channel: Object.freeze({ crossed: ch.phase === 'done', floods: ch.floods,
          sporeHits: ch.sporeHits, seconds: Math.round(ch.elapsed * 100) / 100 }) });
      }
      return this.#reported;
    }
  };
}
