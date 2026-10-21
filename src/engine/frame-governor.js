import { RESOLUTION_SCALE, decideResolutionStep, snapResolutionScale } from '../platform/mobile-display.js';

export const PERF_TIER_KEY = 'bladesurge_perf_tier_v1';
export const PERF_SCALE_KEY = 'bladesurge_perf_scale_v1';
const WINDOW_MS = 3000, SAMPLE_COUNT = 256;
const DOWN_MS = 5000, UP_MS = 60000, REMEMBER_MS = 60000;
// 동적 해상도: 과부하 2초 지속 시 한 단계 낮추고, 여유 10초 지속 시 한 단계 올린다(변경 사이 최소 2.5초).
// 올린 직후 20초 안에 다시 내려가면 올림 대기를 두 배로(최대 80초) 늘려 같은 단계를 계속 두드리지 않는다.
const RES_DOWN_MS = 2000, RES_UP_MS = 10000, RES_COOLDOWN_MS = 2500, RES_UP_MAX_MS = 80000, RES_FAILED_PROBE_MS = 20000, RES_HOLD_MS = 40000;
// 지속 부하 판단은 실제 렌더 fps 로 조금 더 민감하게 본다(목표의 90% 미만). 화면 주사율과 목표가 어긋나 생기는 양자화(45fps 목표 등)에
// 속지 않도록 놓친 프레임 비율이 아니라 평균 fps 를 쓴다. 여유는 목표의 97% 이상이고 큰 끊김이 없을 때만 인정한다.
const RES_FPS_OVERLOAD = 0.9, RES_FPS_ROOMY = 0.97, RES_EXCESS_ROOMY = 0.05;

/** 온도 추정 대신 실제 렌더 간격으로 지속 부하를 판단한다. 게임 저장에는 접근하지 않는다. */
export class FrameGovernor {
  /** @param {{ storage?: Pick<Storage, 'getItem' | 'setItem'> | null, scaleStorage?: Pick<Storage, 'getItem' | 'setItem'> | null }} [options] */
  constructor({ storage = null, scaleStorage = null } = {}) {
    this.storage = storage;
    this.scaleStorage = scaleStorage;
    // 동적 해상도 배율(0.6~1.0, 0.1 단계). 이전 실행에서 안정적이던 값을 이어받아 약한 기기가 매번 처음부터 버벅이지 않게 한다.
    this.resolutionScale = RESOLUTION_SCALE.max; this.savedScale = RESOLUTION_SCALE.max;
    this.resolutionLocked = false;
    try {
      const saved = JSON.parse(scaleStorage?.getItem(PERF_SCALE_KEY) ?? 'null');
      if (saved?.version === 1 && Number.isFinite(saved.scale)) {
        this.resolutionScale = snapResolutionScale(saved.scale); this.savedScale = this.resolutionScale;
      }
    } catch { /* 저장소가 차단되거나 손상됐어도 기본 배율로 시작한다. */ }
    this.resOverloadMs = 0; this.resHeadroomMs = 0; this.resSinceChangeMs = Infinity;
    this.resUpWaitMs = RES_UP_MS; this.resLastDir = 0; this.severeOverload = false;
    this.tier = 0;
    this.savedTier = -1;
    try {
      const saved = JSON.parse(storage?.getItem(PERF_TIER_KEY) ?? 'null');
      if (saved?.version === 1 && Number.isInteger(saved.tier) && saved.tier >= 0 && saved.tier <= 4) {
        this.tier = saved.tier; this.savedTier = saved.tier;
      }
    } catch { /* 저장소가 차단되거나 손상됐어도 기본 단계로 시작한다. */ }
    this.times = new Float64Array(SAMPLE_COUNT);
    this.intervals = new Float64Array(SAMPLE_COUNT);
    this.costs = new Float64Array(SAMPLE_COUNT);
    this.sorted = new Float64Array(SAMPLE_COUNT);
    this.index = 0; this.count = 0;
    this.lastStepAt = NaN; this.lastRenderAt = NaN;
    this.lastRafAt = NaN; this.refreshMs = 1000 / 60;
    this.mode = ''; this.renderAllowed = false; this.targetFps = 0;
    this.renderedFps = 0; this.p95FrameMs = 0; this.missRatio = 0;
    this.nextAt = NaN; this.lastEvaluation = NaN;
    this.overloadMs = 0; this.headroomMs = 0; this.stableMs = 0;
  }

  reset(now) {
    this.lastStepAt = now; this.nextAt = now;
    this.lastRafAt = now;
    this.lastRenderAt = NaN; this.lastEvaluation = NaN;
    this.count = 0; this.index = 0;
    this.overloadMs = 0; this.headroomMs = 0;
    this.resOverloadMs = 0; this.resHeadroomMs = 0;
    this.renderedFps = 0; this.p95FrameMs = 0; this.missRatio = 0;
  }

  suspend(now) {
    this.reset(now); this.renderAllowed = false; this.targetFps = 0;
  }

  /** 이전 실행 이후의 초를 반환한다. 건너뛴 rAF 시간도 포함하며 0이면 실행하지 않는다. */
  advance(now, mode = 'battle', renderAllowed = true, suspended = false) {
    if (!Number.isFinite(now)) return 0;
    if (suspended) { this.suspend(now); return 0; }
    const rafMs = now - this.lastRafAt;
    this.lastRafAt = now;
    if (rafMs > 0.5 && rafMs < 100) this.refreshMs += (Math.min(1000 / 60, rafMs) - this.refreshMs) * 0.1;
    const fps = mode === 'battle' ? (this.tier === 4 ? 45 : 60) : 30;
    const target = renderAllowed ? fps : 0;
    if (this.mode !== mode || this.targetFps !== target || this.renderAllowed !== renderAllowed) {
      // 화면 복귀·모드 전환의 대기 시간을 부하 표본에 섞지 않는다.
      this.lastRenderAt = NaN; this.lastEvaluation = NaN;
      this.count = 0; this.index = 0; this.overloadMs = 0; this.headroomMs = 0;
      this.resOverloadMs = 0; this.resHeadroomMs = 0;
      this.renderedFps = 0; this.p95FrameMs = 0; this.missRatio = 0;
      this.nextAt = now;
    }
    this.mode = mode; this.renderAllowed = renderAllowed; this.targetFps = target;
    if (!Number.isFinite(this.lastStepAt) || now < this.lastStepAt) { this.reset(now); return 0; }
    // 나머지는 마감 시각에만 이월한다. 게임 dt는 실제 실행 시각 사이의 차이다.
    const interval = 1000 / fps;
    if (now + 0.001 < this.nextAt || now <= this.lastStepAt) return 0;
    const dt = (now - this.lastStepAt) / 1000;
    this.lastStepAt = now;
    this.nextAt += Math.max(1, Math.floor((now - this.nextAt + 0.001) / interval) + 1) * interval;
    return dt;
  }

  /** 실제 렌더만 기록한다. 표본 배열은 처음에 확보하고 매 프레임 생성하지 않는다. */
  recordFrame(now, workMs = 0) {
    if (!this.renderAllowed || !Number.isFinite(now)) return;
    const elapsed = now - this.lastRenderAt;
    this.lastRenderAt = now;
    if (!Number.isFinite(elapsed) || elapsed <= 0) return;
    this.times[this.index] = now;
    this.intervals[this.index] = elapsed;
    this.costs[this.index] = Math.max(elapsed, Number.isFinite(workMs) ? workMs : 0);
    this.index = (this.index + 1) % SAMPLE_COUNT;
    this.count = Math.min(SAMPLE_COUNT, this.count + 1);
    this.stableMs += elapsed;
    if (this.stableMs >= REMEMBER_MS && this.savedTier !== this.tier) {
      try {
        this.storage?.setItem(PERF_TIER_KEY, JSON.stringify({ version: 1, tier: this.tier }));
        this.savedTier = this.tier;
      } catch { /* 용량 초과·차단은 플레이를 중단하지 않는다. 다음 안정 구간에 다시 시도한다. */ }
      this.stableMs = 0;
    }
    if (!Number.isFinite(this.lastEvaluation)) { this.lastEvaluation = now; return; }
    const evaluationMs = now - this.lastEvaluation;
    if (evaluationMs < 1000) return;
    this.lastEvaluation = now;
    this.sorted.fill(Infinity);
    let samples = 0, duration = 0, missed = 0, excessMissed = 0;
    const interval = 1000 / this.targetFps;
    const refreshTolerance = this.refreshMs * 0.5;
    for (let i = 0; i < this.count; i++) {
      if (now - this.times[i] > WINDOW_MS) continue;
      const dt = this.intervals[i];
      this.sorted[samples++] = this.costs[i];
      duration += dt;
      missed += Math.max(0, dt / interval - 1);
      excessMissed += Math.max(0, (dt - interval - refreshTolerance) / interval);
    }
    if (!samples || duration < 1000) return;
    this.sorted.sort();
    this.renderedFps = samples * 1000 / duration;
    this.p95FrameMs = this.sorted[Math.ceil(samples * 0.95) - 1];
    this.missRatio = Math.min(1, missed / (duration / interval));
    // 관측값에는 원래 놓친 비율을 남기고, 단계 판단만 화면 주사 간격의 양자화를 보정한다.
    const excessRatio = excessMissed / (duration / interval);
    const overloaded = (this.p95FrameMs > interval * 1.35 + refreshTolerance && excessRatio > 0.15) || excessRatio > 0.25;
    const comfortable = this.p95FrameMs < interval * 1.35 + refreshTolerance && excessRatio < 0.12;
    this.overloadMs = overloaded ? this.overloadMs + evaluationMs : 0;
    this.headroomMs = comfortable ? this.headroomMs + evaluationMs : 0;
    this.severeOverload = excessRatio > 0.25;
    this._adaptResolution(evaluationMs, this.renderedFps < this.targetFps * RES_FPS_OVERLOAD || overloaded,
      this.renderedFps >= this.targetFps * RES_FPS_ROOMY && excessRatio < RES_EXCESS_ROOMY);
    // 해상도를 더 낮출 수 있는 동안은 중간 정도의 과부하를 배율이 먼저 흡수한다(그림자·블룸을 끄기 전에 해상도부터).
    // 심한 과부하이거나 배율이 이미 최저면 기존대로 단계를 올린다.
    const tierMayRise = this.severeOverload || this.resolutionLocked || this.resolutionScale <= RESOLUTION_SCALE.min;
    if ((this.overloadMs >= DOWN_MS && this.tier < 4 && tierMayRise) || (this.headroomMs >= UP_MS && this.tier > 0)) {
      this.tier += this.overloadMs >= DOWN_MS ? 1 : -1;
      this.stableMs = 0; this.overloadMs = 0; this.headroomMs = 0;
      this.count = 0; this.index = 0; this.lastRenderAt = NaN;
    }
  }

  /** 1초마다 한 번 호출된다. 배열·객체를 만들지 않고 숫자 상태만 갱신한다. */
  _adaptResolution(evaluationMs, overloaded, roomy) {
    if (this.resolutionLocked) return;
    this.resOverloadMs = overloaded ? this.resOverloadMs + evaluationMs : 0;
    this.resHeadroomMs = roomy ? this.resHeadroomMs + evaluationMs : 0;
    this.resSinceChangeMs += evaluationMs;
    const step = decideResolutionStep({ scale: this.resolutionScale, overloadMs: this.resOverloadMs, headroomMs: this.resHeadroomMs,
      sinceChangeMs: this.resSinceChangeMs, downMs: RES_DOWN_MS, upMs: this.resUpWaitMs, cooldownMs: RES_COOLDOWN_MS });
    if (step) {
      // 올린 직후 곧 다시 내려갔다면 그 단계는 이 기기에 무거운 것이다 → 다음 올림은 더 오래 기다린다.
      if (step < 0 && this.resLastDir > 0 && this.resSinceChangeMs < RES_FAILED_PROBE_MS) this.resUpWaitMs = Math.min(RES_UP_MAX_MS, this.resUpWaitMs * 2);
      this.resolutionScale = snapResolutionScale(this.resolutionScale + step * RESOLUTION_SCALE.step);
      this.resLastDir = step; this.resSinceChangeMs = 0; this.resOverloadMs = 0; this.resHeadroomMs = 0;
      // 해상도가 바뀌기 전 표본은 새 부하를 대표하지 않는다.
      this.count = 0; this.index = 0; this.lastRenderAt = NaN;
      return;
    }
    // 올린 단계를 오래 유지했다면(시험 성공) 백오프를 풀고, 내려와 머무는 동안에는 늘어난 대기를 그대로 둔다.
    if (this.resLastDir > 0 && this.resSinceChangeMs >= RES_HOLD_MS && this.resUpWaitMs !== RES_UP_MS) this.resUpWaitMs = RES_UP_MS;
    if (this.scaleStorage && this.resSinceChangeMs >= REMEMBER_MS && this.savedScale !== this.resolutionScale) {
      try {
        this.scaleStorage.setItem(PERF_SCALE_KEY, JSON.stringify({ version: 1, scale: this.resolutionScale }));
        this.savedScale = this.resolutionScale;
      } catch { /* 용량 초과·차단은 플레이를 중단하지 않는다. */ }
    }
  }

  /** QA·진단용: 배율을 고정하고 자동 조절을 멈춘다. 일반 플레이에서는 호출하지 않는다. */
  lockResolution(scale = RESOLUTION_SCALE.max) {
    this.resolutionScale = snapResolutionScale(scale); this.resolutionLocked = true;
  }

  snapshot() {
    return { tier: this.tier, targetFps: this.targetFps, renderedFps: this.renderedFps,
      p95FrameMs: this.p95FrameMs, missRatio: this.missRatio };
  }
}

/** 메뉴에서는 렌더만 막는다. 전투 일시정지·시뮬레이션 규칙은 기존 담당이 유지한다. */
export function canRenderFrame(app, doc) {
  if (doc.hidden || app.expeditionUI?.opened) return false;
  // 로비는 기존 조건(쇼케이스가 보이거나 홈 탭)을 그대로 따른다. 영웅·장비 탭의 3D 미리보기를 끄지 않는다.
  if (app.mode === 'lobby' && !(app.lobbyVisible || app.meta.tab === 'home')) return false;
  // 화면 전체를 막는 모달만 렌더를 멈춘다. 비모달로 열린 dialog 는 뒤 장면이 보이므로 계속 그린다.
  return !doc.querySelector('dialog:modal, #modal.show, #pause-overlay.show, #result.show, #reveal.show');
}
