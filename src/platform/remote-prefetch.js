// 다음 지역 자산 사전 내려받기 정책.
//  - 현재 지역 X 의 X-8 에 도달하면(해금 번호 기준) 다음 지역(X+1) 묶음을 네트워크 종류와 상관없이(데이터 절약 모드만 제외) 받아 둔다.
//  - 와이파이(또는 유선)에서 로비에 머무는 동안에는 남은 묶음을 우선순위대로 하나씩 한가할 때 받아 둔다.
import { CHAPTERS, STAGES_PER_CHAPTER } from '../data/stages.js';

export const PREFETCH_STAGE = 8;
/** 와이파이에서 한가할 때 받는 순서(앞쪽이 먼저). 다음 지역 묶음은 항상 맨 앞이다. */
/** 1지역 보스·중간 보스 곡: 첫 보스(1-3) 전에 도착하도록 로비에 들어오면 네트워크 종류와 상관없이(데이터 절약 모드만 제외) 바로 받는다. */
export const EARLY_GROUP = 'early-music';
export const IDLE_GROUP_ORDER = Object.freeze(['heroes-t2', 'expeditions', 'avatars', 'arena', 'heroes-t3', 'cinematic', 'bgm-extra']);

export function connectionKind(nav = globalThis.navigator) {
  const c = nav?.connection;
  if (!c) return { saveData: false, unmetered: false, known: false };
  const unmetered = c.type === 'wifi' || c.type === 'ethernet';
  return { saveData: c.saveData === true, unmetered, known: typeof c.type === 'string' };
}

/** 해금 번호 -> { chapter, stage }. */
export function frontier(progress) {
  const floors = CHAPTERS.length * STAGES_PER_CHAPTER;
  const unlocked = Number.isSafeInteger(progress?.unlocked) ? Math.max(1, Math.min(floors, progress.unlocked)) : 1;
  return { chapter: Math.ceil(unlocked / STAGES_PER_CHAPTER), stage: ((unlocked - 1) % STAGES_PER_CHAPTER) + 1 };
}

/** 사전 내려받기를 시작해야 하는 다음 지역 묶음 이름(없으면 null). */
export function nextRegionGroup(progress) {
  const { chapter, stage } = frontier(progress);
  return stage >= PREFETCH_STAGE && chapter < CHAPTERS.length ? `region-${chapter + 1}` : null;
}

/**
 * @param {ReturnType<import('./remote-assets.js').createRemoteAssets>} assets
 * @param {{nav?: Navigator, idle?: (fn: () => void) => void, now?: () => number}} [options]
 */
export function createPrefetcher(assets, { nav = globalThis.navigator, idle = (fn) => (globalThis.requestIdleCallback ? globalThis.requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1500)), now = () => Date.now() } = {}) {
  let running = false;
  const started = new Set();
  const backoff = new Map();   // 묶음 -> { until, step } 실패한 묶음은 30초에서 시작해 두 배씩(최대 10분) 쉬었다가 다시 받는다(로비에 들어올 때마다 재시도하지 않게)
  const run = async (group) => {
    if (!assets.enabled || assets.groupCached(group) || started.has(group) || (backoff.get(group)?.until || 0) > now()) return;
    started.add(group);
    const fail = () => { started.delete(group); const step = Math.min(600000, (backoff.get(group)?.step || 15000) * 2); backoff.set(group, { until: now() + step, step }); };
    try { const result = await assets.prefetchGroup(group); if (result.failed.length) fail(); else backoff.delete(group); } catch { fail(); }
  };
  return {
    /** 로비에 들어올 때마다 부른다. 진행도 변화(X-8 도달)와 와이파이 한가함을 함께 본다. */
    onLobby(progress) {
      if (!assets.enabled) return;
      const net = connectionKind(nav);
      if (net.saveData) return;
      void run(EARLY_GROUP);
      const next = nextRegionGroup(progress);
      if (next) void run(next);
      if (!net.unmetered || running) return;
      running = true;
      idle(async () => {
        try {
          const { chapter } = frontier(progress);
          const order = [chapter < CHAPTERS.length ? `region-${chapter + 1}` : null, ...IDLE_GROUP_ORDER].filter(Boolean);
          for (const group of order) { if (connectionKind(nav).saveData) break; await run(group); }
        } finally { running = false; }
      });
    },
  };
}
