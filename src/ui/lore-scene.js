// 챕터 입장 장면 플레이어(docs/WORLD_BIBLE.md 5장). 말풍선 한 개씩, 약 3초 자동 진행, 탭=다음, 건너뛰기 상시.
// 상태 머신(createSceneRun)은 DOM 없이 돌아 단위 테스트가 가능하고, playChapterScene 이 오버레이를 입힌다.
import './lore.css';
import { CHAPTERS } from '../data/stages.js';
import * as lore from '../data/lore.js';

export const LORE_SEEN_KEY = 'bladesurge_lore_seen_v1';
export const LINE_MS = 3000;

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function defaultStorage() {
  try { const s = globalThis.localStorage; return s && typeof s.getItem === 'function' ? s : null; } catch { return null; }
}

/** 본 장 번호 집합. 저장소가 없거나 깨져 있어도 빈 집합으로 동작한다. */
/** @param {any} [storage] */
export function loadLoreSeen(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(LORE_SEEN_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((n) => Number.isSafeInteger(n) && n >= 1 && n <= 20) : []);
  } catch { return new Set(); }
}
/** @param {number} ch @param {any} [storage] */
export const hasSeenLore = (ch, storage) => loadLoreSeen(storage).has(ch);
/** @param {number} ch @param {any} [storage] */
export function markLoreSeen(ch, storage = defaultStorage()) {
  try {
    const seen = loadLoreSeen(storage); seen.add(ch);
    storage?.setItem(LORE_SEEN_KEY, JSON.stringify([...seen].sort((a, b) => a - b)));
    return true;
  } catch { return false; }
}

/** 그 장의 장면 대사. lore.chapterSceneLines 가 있으면 그것을, 없으면 CHAPTER_LORE 의 scene 을 쓴다. */
export function sceneLinesFor(ch) {
  let rows = null;
  try { rows = typeof lore.chapterSceneLines === 'function' ? lore.chapterSceneLines(ch) : lore.chapterLore?.(ch)?.scene; } catch { rows = null; }
  return Array.isArray(rows) ? rows.filter((r) => r && typeof r.line === 'string' && r.line) : [];
}

/** 장면을 지금 자동 재생해야 하는가: 그 장이 열려 있고 대사가 있고 아직 안 봤을 때. */
/** @param {number} ch @param {{ unlocked?: boolean, storage?: any }} [opts] */
export const shouldAutoPlayScene = (ch, { unlocked, storage } = {}) => !!unlocked && sceneLinesFor(ch).length > 0 && !hasSeenLore(ch, storage);

/**
 * 시간 없는 장면 진행기. next()=탭, skip()=건너뛰기, tick(ms)=자동 진행.
 * track(name, payload) 로 view/skip/done/replay 를 남긴다(실패해도 진행).
 */
/**
 * @param {number} ch @param {any[]} lines
 * @param {{ replay?: boolean, storage?: any, track?: Function, onLine?: Function, onEnd?: Function, lineMs?: number }} [opts]
 */
export function createSceneRun(ch, lines, { replay = false, storage, track, onLine, onEnd, lineMs = LINE_MS } = {}) {
  let index = 0, elapsed = 0, ended = false;
  const emit = (act, line) => { try { track?.('lore_scene', line === undefined ? { ch, act } : { ch, act, line }); } catch { /* 계측 실패는 무시 */ } };
  const finish = (act) => {
    if (ended) return; ended = true;
    if (!replay) markLoreSeen(ch, storage);
    if (act === 'skip') emit('skip', Math.min(10, index)); else emit('done');
    onEnd?.(act);
  };
  const run = {
    get index() { return index; }, get ended() { return ended; }, get line() { return lines[index] || null; }, get total() { return lines.length; },
    start() {
      if (!lines.length) { finish('done'); return run; }
      // 처음 보는 장면은 본 것으로 기록하고(중간에 앱이 닫혀도 반복하지 않는다) 다시 보기는 replay 로 구분한다.
      if (!replay) markLoreSeen(ch, storage);
      emit(replay ? 'replay' : 'view');
      onLine?.(lines[0], 0);
      return run;
    },
    next() {
      if (ended) return; elapsed = 0; index += 1;
      if (index >= lines.length) { index = lines.length - 1; finish('done'); return; }
      onLine?.(lines[index], index);
    },
    skip() { if (!ended) finish('skip'); },
    tick(ms) { if (ended) return; elapsed += ms; if (elapsed >= lineMs) run.next(); },
  };
  return run;
}

let active = null;
export const isScenePlaying = () => !!active;

/**
 * 장면을 전체 화면 오버레이로 재생한다. replay=true 면 본 기록을 건드리지 않는다.
 * @param {number} ch
 * @param {{ replay?: boolean, track?: Function, storage?: any, onEnd?: Function, art?: string }} [opts]  art = 지역 아트 URL(없으면 장 색 그라데이션만)
 */
export function playChapterScene(ch, { replay = false, track, storage, onEnd, art } = {}) {
  const lines = sceneLinesFor(ch);
  if (!lines.length || typeof document === 'undefined' || active) return false;
  const chapter = CHAPTERS[ch - 1] || {};
  const color = /^#[0-9a-f]{3,8}$/i.test(chapter.color || '') ? chapter.color : '#87cbb0';
  const reduced = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const root = document.createElement('div');
  root.className = 'lore-scene'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', `${esc(chapter.name || '')} 장면`);
  root.style.setProperty('--lore-color', color);
  if (reduced) root.classList.add('reduced');
  if (typeof art === 'string' && /^\/[\w./-]+$/.test(art)) root.style.setProperty('--lore-art', `url("${art}")`);
  root.innerHTML = `<div class="lore-scene-art" aria-hidden="true"></div><div class="lore-scene-title"><small>REGION 0${ch}</small><b>${esc(chapter.name || '')}</b></div>
    <button type="button" class="lore-scene-skip" aria-label="장면 건너뛰기">건너뛰기</button>
    <div class="lore-scene-stage"><div class="lore-bubble" aria-live="polite"></div></div>
    <div class="lore-scene-hint" aria-hidden="true">화면을 누르면 다음</div><div class="lore-scene-dots" aria-hidden="true">${lines.map(() => '<i></i>').join('')}</div>`;
  const bubble = root.querySelector('.lore-bubble'), dots = [...root.querySelectorAll('.lore-scene-dots i')];
  let timer = 0, last = 0;
  const run = createSceneRun(ch, lines, {
    replay, storage, track,
    onLine(row, i) {
      const sp = lore.LORE_SPEAKERS?.[row.who] || lore.LORE_SPEAKERS?.narrator || { name: '', color: '#d8d2c4' };
      bubble.style.setProperty('--speaker', sp.color);
      bubble.dataset.who = row.who; bubble.classList.toggle('narration', !sp.name);
      bubble.innerHTML = `${sp.name ? `<span class="lore-name">${esc(sp.name)}</span>` : ''}<p>${esc(row.line)}</p>`;
      bubble.classList.remove('pop'); void bubble.offsetWidth; bubble.classList.add('pop');
      dots.forEach((d, n) => d.classList.toggle('on', n <= i));
    },
    onEnd(act) {
      clearInterval(timer); active = null;
      root.classList.add('out'); setTimeout(() => root.remove(), reduced ? 0 : 220);
      try { onEnd?.(act); } catch { /* 닫힘 콜백 실패는 무시 */ }
    },
  });
  root.addEventListener('click', (event) => { if (event.target.closest('.lore-scene-skip')) run.skip(); else run.next(); });
  document.body.append(root); active = root;
  run.start();
  last = Date.now();
  timer = setInterval(() => { const now = Date.now(); run.tick(Math.min(500, now - last)); last = now; }, 200);
  root.querySelector('.lore-scene-skip').focus({ preventScroll: true });
  return true;
}

/** 보스 등장 띠에 붙일 `칭호 · 이름` + 외침 한 줄 HTML. 문구가 없으면 빈 문자열(기존 띠 그대로). */
export function bossLoreHtml(stage) {
  let row = null;
  try { row = typeof lore.bossLore === 'function' ? lore.bossLore(stage) : null; } catch { row = null; }
  if (!row) return '';
  return `<span class="boss-intro-lore"><b>${esc(row.title)} · ${esc(row.name)}</b><em>“${esc(row.shout)}”</em></span>`;
}
