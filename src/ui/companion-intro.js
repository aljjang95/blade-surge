// 전투 동료 '네브' 정체성 표시(대표님 2026-10-29): 머리 위 이름표, 첫 등장 소개 카드, 일시정지 메뉴 동료 줄.
// 이름표는 요소 하나를 재사용하고 프레임마다 위치만 바꾼다(할당 없음). 카드는 저장에 한 번만 뜨며 가장자리 띠에만 두고, 주인공 둘레·HUD와 겹치는 자리밖에 없으면 띄우지 않는다.
import * as THREE from 'three';
import './companion-intro.css';
import { collectHudBlockers, placeOutside, HUD_BLOCKER_SELECTORS } from './hud-clearance.js';

export const NEB_ROLE = '지원 마법 — 가까운 적을 마법으로 견제하고, 수호 전술이면 위급할 때 회복해요';
export const NEB_ROUTE = '이야기 동료 · 처음부터 함께(무료) · 로비 네브 버튼으로 대화·전술 변경';
export const INTRO_DELAY_SEC = 1.5;
export const INTRO_SHOW_SEC = 6;
export const TACTIC_NAME = Object.freeze({ gather: '몰이', guard: '수호', break: '파쇄' });
/** 일시정지 메뉴 한 줄에 쓰는 요약. 전술별 실제 동작은 combatant.js 기준이다. */
export function pauseSummary(tactic) {
  return '네브(여섯 번째 증인) · ' + NEB_ROLE + '. 지금 전술: ' + (TACTIC_NAME[tactic] || '몰이')
    + '(몰이 적 모으기 · 파쇄 정예·보스 기절 · 수호 체력 56% 미만일 때 최대 체력 9% 회복, 12초마다). ' + NEB_ROUTE + '.';
}

/** 소개 카드를 지금 보여 줄 때인가(순수). seen 은 저장된 '이미 봄' 값. */
export function introPhase(seen, elapsed) {
  if (seen) return 'none';
  if (elapsed < INTRO_DELAY_SEC) return 'wait';
  return elapsed < INTRO_DELAY_SEC + INTRO_SHOW_SEC ? 'show' : 'done';
}

const _head = new THREE.Vector3();
const TAG_W = 44, TAG_H = 16, TAG_SHIFT = 36, TAG_LIFT = 2.15;
const BLOCKER_REFRESH_SEC = 2;
const TAG_BLOCKERS = Object.freeze([...HUD_BLOCKER_SELECTORS, '#battle-tutorial > :not([hidden])', '.neb-intro', '#btn-bag', '#battle-bag']);
const TOP_BLOCKERS = '#objective, #bossbar, #battle-tutorial > :not([hidden]), #map-tactics-context';
/** 소개 카드가 피해야 할 HUD. 표식용 목록에 가방·지도·튜토리얼 안내를 더한다. */
const CARD_BLOCKERS = Object.freeze([...HUD_BLOCKER_SELECTORS, '#battle-tutorial > :not([hidden])', '#btn-bag', '#battle-bag', '#map-tactics-context', '.hud-top button']);
/** 주인공 둘레(플레이 영역): 화면 짧은 변의 22%. tools/qa/inapp-touch.mjs 의 판정과 같은 값. */
export const HERO_CLEAR_RATIO = 0.22;
const _hero = new THREE.Vector3();
const CARD_GAP = 6;

/** 카드 자리용 HUD 사각형. 크기는 있어도 지금 안 보이는 요소(연속 처치 표시처럼 opacity 0 대기)는 뺀다. 카드를 띄울 때 한 번만 부른다. */
function visibleBlockers(selectors) {
  const out = [];
  for (const selector of selectors) {
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, id: el.id || selector });
    }
  }
  return out;
}

/** 사각형이 원(주인공 둘레)과 겹치는가(순수). */
export function rectHitsCircle(r, cx, cy, radius) {
  const dx = Math.max(r.left - cx, 0, cx - r.right), dy = Math.max(r.top - cy, 0, cy - r.bottom);
  return Math.hypot(dx, dy) < radius;
}

/**
 * 후보 자리 중 화면 안에 있고 HUD·주인공 둘레와 겹치지 않는 첫 자리(순수). 없으면 null.
 * slots: [{left, top, width, height}] 화면 좌표. hero: {x, y, r} 또는 null.
 */
export function pickCardSlot(slots, blockers, hero, viewW, viewH) {
  for (const s of slots) {
    const r = { left: s.left, top: s.top, right: s.left + s.width, bottom: s.top + s.height };
    if (r.left < 0 || r.top < 0 || r.right > viewW || r.bottom > viewH) continue;
    if (hero && rectHitsCircle(r, hero.x, hero.y, hero.r)) continue;
    if (blockers.some(b => r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top)) continue;
    return s;
  }
  return null;
}

export class CompanionPresence {
  /**
   * @param {{ hud?: HTMLElement|null, getSeen: () => boolean, markSeen: () => void, getTactic: () => string }} opt
   */
  constructor({ hud = document.getElementById('hud'), getSeen, markSeen, getTactic }) {
    this.hud = hud; this.getSeen = getSeen; this.markSeen = markSeen; this.getTactic = getTactic;
    this.tag = document.createElement('div'); this.tag.className = 'neb-tag'; this.tag.hidden = true; this.tag.setAttribute('aria-hidden', 'true'); this.tag.textContent = '네브';
    hud?.append(this.tag);
    this.card = document.createElement('button'); this.card.type = 'button'; this.card.className = 'neb-intro'; this.card.hidden = true;
    this.card.setAttribute('aria-label', '동료 네브 소개. 누르면 닫힘');
    this.card.innerHTML = '<span class="neb-intro-mark" aria-hidden="true">N</span><span class="neb-intro-copy"><b>네브 · 여섯 번째 증인</b><span class="neb-intro-role"></span><small class="neb-intro-route"></small></span>';
    this.card.querySelector('.neb-intro-role').textContent = NEB_ROLE;
    this.card.querySelector('.neb-intro-route').textContent = NEB_ROUTE;
    hud?.append(this.card);
    this.card.addEventListener('click', () => { this.cardState = 'done'; this.card.blur(); this.hideCard(); });
    // 일시정지 메뉴의 동료 줄(다시 보기). 네브가 있는 전투에서만 보인다.
    this.pauseRow = document.getElementById('battle-companion-info');
    this.blockers = []; this.blockerT = 0; this.bounds = { left: 0, top: 0, right: 0, bottom: 0 }; this.placed = { dx: 0, dy: 0, hidden: false };
    this.elapsed = 0; this.cardState = 'idle'; this.active = false; this.lastTactic = '';
  }

  start() {
    this.active = true; this.elapsed = 0; this.cardState = 'idle'; this.blockerT = 0;
    if (this.pauseRow) { this.pauseRow.hidden = false; this.refreshPauseRow(); }
  }
  stop() {
    this.active = false; this.tag.hidden = true; this.hideCard(); this.cardState = 'idle';
    if (this.pauseRow) this.pauseRow.hidden = true;
  }
  refreshPauseRow() {
    const text = this.pauseRow?.querySelector('.battle-companion-text');
    if (text) text.textContent = pauseSummary(this.getTactic());
  }

  /**
   * 프레임당 한 번(실시간 dt). actor 는 네브 몸체, renderer 는 카메라 보유자, player 는 주인공(카드가 피할 플레이 영역).
   * @param {any} actor @param {any} renderer @param {number} realDt @param {{ pos: { x: number, y?: number, z: number } } | null} [player]
   */
  update(actor, renderer, realDt, player = null) {
    if (!this.active) return;
    this.renderer = renderer; this.player = player;
    const tactic = this.getTactic(); if (tactic !== this.lastTactic) { this.lastTactic = tactic; this.refreshPauseRow(); }
    this.updateTag(actor, renderer, realDt);
    this.updateCard(realDt);
  }

  updateTag(actor, renderer, dt) {
    const cam = renderer?.camera, w = renderer?._width || innerWidth, h = renderer?._height || innerHeight;
    if (!actor || actor.disposed || !cam) { this.tag.hidden = true; return; }
    _head.set(actor.pos.x, actor.pos.y + TAG_LIFT * 0.82, actor.pos.z).project(cam);
    if (_head.z > 1 || _head.x < -1 || _head.x > 1 || _head.y < -1 || _head.y > 1) { this.tag.hidden = true; return; }
    const x = Math.round((_head.x + 1) * 0.5 * w), y = Math.round((1 - _head.y) * 0.5 * h);
    this.blockerT -= dt;
    if (this.blockerT <= 0) { this.blockerT = BLOCKER_REFRESH_SEC; this.blockers = collectHudBlockers(document.body, TAG_BLOCKERS); }
    const bounds = this.bounds; bounds.right = w; bounds.bottom = h;
    const placed = placeOutside(this.placed, x - TAG_W / 2, y - TAG_H, x + TAG_W / 2, y, this.blockers, bounds, TAG_SHIFT);
    if (placed.hidden) { this.tag.hidden = true; return; }
    this.tag.hidden = false;
    this.tag.style.transform = 'translate3d(' + Math.round(x + placed.dx) + 'px,' + Math.round(y + placed.dy) + 'px,0) translate(-50%,-100%)';
  }

  updateCard(dt) {
    this.elapsed += dt;
    // 이미 띄운 카드는 저장된 '봄' 값과 무관하게 시간으로만 닫는다(띄우는 순간 markSeen 이 seen 을 true 로 바꾼다).
    if (this.cardState === 'shown') { if (introPhase(false, this.elapsed) === 'done') { this.cardState = 'done'; this.hideCard(); } return; }
    const phase = introPhase(this.getSeen(), this.elapsed);
    // 플레이 영역을 가리지 않는 자리가 없으면(세로 좁은 화면 등) 이번 전투에서는 띄우지 않고 본 기록도 남기지 않는다.
    if (phase === 'show' && this.cardState === 'idle') {
      if (this.showCard() === false) { this.cardState = 'done'; return; }
      this.cardState = 'shown'; this.markSeen();
    }
  }

  /** 주인공을 화면에 투영한 점과 둘레 반지름. 카메라·주인공이 없으면 null. */
  heroCircle(w, h) {
    const cam = this.renderer?.camera, p = this.player;
    if (!cam || !p?.pos) return null;
    _hero.set(p.pos.x, (p.pos.y ?? 0) + 1, p.pos.z).project(cam);
    if (_hero.z > 1) return null;
    return { x: (_hero.x + 1) * 0.5 * w, y: (1 - _hero.y) * 0.5 * h, r: Math.min(w, h) * HERO_CLEAR_RATIO };
  }

  /**
   * 카드는 가장자리 띠에만 둔다(대표님 규칙: 주인공·앞길·적 위 팝업 금지). 후보: ① 왼쪽 띠(시점 버튼 오른쪽, 영웅 카드 아래)
   * ② 위쪽 띠(영웅 카드·목표 아래, 오른쪽 지도 열 앞까지, 경로 줄 생략) ③ 주인공 둘레 왼쪽까지 줄인 왼쪽 띠. 실제 크기를 재서 HUD·주인공 둘레와
   * 겹치지 않는 첫 자리를 쓰고, 없으면 false 를 돌려준다.
   */
  showCard() {
    const hud = this.hud, box = hud?.getBoundingClientRect(); if (!box?.width) return false;
    const viewW = innerWidth, viewH = innerHeight;
    const player = hud.querySelector('.hud-player')?.getBoundingClientRect();
    const cam = (document.querySelector('.oath-camera-details') || document.getElementById('battle-camera-controls'))?.getBoundingClientRect();
    const blockers = visibleBlockers(CARD_BLOCKERS);
    const hero = this.heroCircle(viewW, viewH);
    const topBelow = (left, width) => {
      let top = (player?.bottom ?? box.top) + CARD_GAP;
      for (const el of document.querySelectorAll(TOP_BLOCKERS)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.top < box.top + box.height * 0.45 && r.right > left && r.left < left + width && r.bottom + 4 > top) top = r.bottom + 4;
      }
      return Math.round(top);
    };
    const sideLeft = Math.round(cam?.width ? cam.right + CARD_GAP : box.left + 14);
    const sideW = Math.round(Math.min(280, box.width * 0.5 - 40 - (sideLeft - box.left)));
    // 위쪽 띠의 오른쪽 끝: 화면 위쪽 절반에서 오른쪽에 붙은 HUD(지도·가방·일시정지)의 왼쪽 가장자리.
    let topRight = box.right - 14;
    for (const b of blockers) if (b.top < box.top + box.height * 0.45 && b.left > box.left + box.width * 0.5) topRight = Math.min(topRight, b.left - CARD_GAP);
    const topLeft = Math.round(box.left + 14), topW = Math.round(Math.min(360, topRight - topLeft));
    const candidates = [];
    if (sideW >= 150) candidates.push({ left: sideLeft, width: sideW, compact: false });
    if (topW >= 200) candidates.push({ left: topLeft, width: topW, compact: true });
    // ③ 왼쪽 띠를 주인공 둘레 왼쪽 끝까지만(가로 화면에서 ①이 둘레에 걸칠 때).
    const narrowW = hero ? Math.floor(Math.min(280, hero.x - hero.r - CARD_GAP - sideLeft)) : 0;
    if (narrowW >= 150) candidates.push({ left: sideLeft, width: narrowW, compact: true });
    const slots = [];
    this.card.style.visibility = 'hidden'; this.card.hidden = false;
    for (const c of candidates) {
      const top = topBelow(c.left, c.width);
      this.applySlot(c.left - box.left, top - box.top, c.width, c.compact);
      slots.push({ left: c.left, top, width: c.width, height: Math.ceil(this.card.getBoundingClientRect().height), compact: c.compact });
    }
    const pick = pickCardSlot(slots, blockers, hero, viewW, viewH);
    // QA(tools/qa/inapp-touch.mjs)가 자리 선택 근거를 읽는다. 카드를 띄울 때 한 번만 갱신된다.
    this.lastPlacement = { hero, slots, blockers: blockers.map(b => [b.id, Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]), picked: pick ? slots.indexOf(pick) : -1 };
    this.card.style.visibility = '';
    if (!pick) { this.card.hidden = true; return false; }
    this.applySlot(pick.left - box.left, pick.top - box.top, pick.width, pick.compact);
    return true;
  }
  applySlot(left, top, width, compact) {
    this.card.style.setProperty('--neb-left', Math.round(left) + 'px');
    this.card.style.setProperty('--neb-top', Math.round(top) + 'px');
    this.card.style.setProperty('--neb-w', Math.round(width) + 'px');
    this.card.classList.toggle('compact', !!compact);
  }
  hideCard() { this.card.hidden = true; }

  dispose() { this.tag.remove(); this.card.remove(); }
}
