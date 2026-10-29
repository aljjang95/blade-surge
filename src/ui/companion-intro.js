// 전투 동료 '네브' 정체성 표시(대표님 2026-10-29): 머리 위 이름표, 첫 등장 소개 카드, 일시정지 메뉴 동료 줄.
// 이름표는 요소 하나를 재사용하고 프레임마다 위치만 바꾼다(할당 없음). 카드는 저장에 한 번만 뜨며 플레이 영역 중앙을 가리지 않는다.
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
    this.card.addEventListener('click', () => this.hideCard());
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

  /** 프레임당 한 번(실시간 dt). actor 는 네브 몸체, renderer 는 카메라 보유자. */
  update(actor, renderer, realDt) {
    if (!this.active) return;
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
    const phase = introPhase(this.getSeen(), this.elapsed);
    if (phase === 'show' && this.cardState === 'idle') { this.cardState = 'shown'; this.showCard(); this.markSeen(); }
    else if (phase === 'done' && this.cardState === 'shown') { this.cardState = 'done'; this.hideCard(); }
  }

  /** 카드는 왼쪽 가장자리 띠. 시점 버튼 오른쪽, 영웅 카드·안내 카드 아래에서 시작하고 화면 가운데(주인공)는 넘지 않는다. */
  showCard() {
    const hud = this.hud, box = hud?.getBoundingClientRect(); if (!box?.width) return;
    const player = hud.querySelector('.hud-player')?.getBoundingClientRect();
    const cam = (document.querySelector('.oath-camera-details') || document.getElementById('battle-camera-controls'))?.getBoundingClientRect();
    const left = Math.round((cam?.width ? cam.right + 6 : box.left + 14) - box.left);
    const width = Math.round(Math.min(280, Math.max(150, box.width * 0.5 - 40 - left)));
    let top = (player?.bottom ?? 0) + 6;
    for (const el of document.querySelectorAll(TOP_BLOCKERS)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.top < box.top + box.height * 0.45 && r.right > box.left + left && r.left < box.left + left + width && r.bottom + 4 > top) top = r.bottom + 4;
    }
    this.card.style.setProperty('--neb-left', left + 'px');
    this.card.style.setProperty('--neb-top', Math.round(top - box.top) + 'px');
    this.card.style.setProperty('--neb-w', width + 'px');
    this.card.hidden = false;
  }
  hideCard() { this.card.hidden = true; }

  dispose() { this.tag.remove(); this.card.remove(); }
}
