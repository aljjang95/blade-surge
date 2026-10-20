export const PERF_TIER_KEY = 'bladesurge_perf_tier_v1';
const WINDOW_MS = 3000, SAMPLE_COUNT = 256;
const DOWN_MS = 5000, UP_MS = 60000, REMEMBER_MS = 60000;

/** 온도 추정 대신 실제 렌더 간격으로 지속 부하를 판단한다. 게임 저장에는 접근하지 않는다. */
export class FrameGovernor {
  /** @param {{ storage?: Pick<Storage, 'getItem' | 'setItem'> | null }} [options] */
  constructor({ storage = null } = {}) {
    this.storage = storage;
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
    if ((this.overloadMs >= DOWN_MS && this.tier < 4) || (this.headroomMs >= UP_MS && this.tier > 0)) {
      this.tier += this.overloadMs >= DOWN_MS ? 1 : -1;
      this.stableMs = 0; this.overloadMs = 0; this.headroomMs = 0;
      this.count = 0; this.index = 0; this.lastRenderAt = NaN;
    }
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
