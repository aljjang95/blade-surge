import * as THREE from 'three';
import './loot-labels.css';
import { ITEM_BY_ID, RARITY_COLOR } from '../data/items.js';
import { tierName } from '../game/item-tier-label.js';
import { collectHudBlockers, placeOutside, rectsOverlap } from './hud-clearance.js';

// 대표님 2026-10-30: "템이 뜨면 어떤 템인지 그 명칭 이름이 보여야". 땅에 떨어진 장비 위에 등급 색 이름표를 붙인다.
// 루팅 라벨 관례(짧은 이름 · 고등급은 테두리 · 빛 강조 · 겹치면 위로 쌓기 · 멀거나 오래되면 흐림)를 따른다.
// 표시 층 전용이다: 드랍 판정 · 난수 · 저장에는 손대지 않고, 레이아웃은 읽지 않는다(글자 폭은 추정치).
export const LOOT_LABEL = Object.freeze({
  max: 8,          // 동시에 보이는 이름표 최대 수
  maxCommon: 3,    // 그중 노말(N) 등급 최대 수 — 많을 때 저등급부터 줄인다
  height: 17,      // 이름표 높이(px)
  gap: 2,          // 쌓을 때 간격
  stackLimit: 64,  // 위로 쌓을 수 있는 최대 거리(px). 넘으면 그 이름표는 이번 프레임 숨김
  far: 9,          // 이 거리(월드) 밖이면 흐림
  oldAfter: 12,    // 떨어진 지 이만큼 지나면 흐림(초)
  lift: .42,       // 드랍 모델 대기 높이 위로 띄우는 높이(월드)
  blockerRefresh: .5, // HUD·안내 띠 사각형을 다시 재는 간격(초)
});
/** #hud 밖에서 이름표가 피해야 하는 안내 띠. */
export const NOTICE_SELECTORS = Object.freeze(['.toast']);
export const RARITY_RANK = Object.freeze({ N: 0, S: 1, E: 2, U: 3, L: 4 });
const _p = new THREE.Vector3();
const UNLIMITED = Object.freeze({ max: Infinity, maxCommon: Infinity });
/** @param {{ left: number, top: number, right: number, bottom: number }} r @param {Array<{ left: number, top: number, right: number, bottom: number }>} list */
export const hitsAny = (r, list) => { for (let i = 0; i < list.length; i++) if (rectsOverlap(r, list[i])) return true; return false; };

/** 글자 폭 추정(10px 굵은 서체): 한글 약 10.4px, 영문·숫자 약 5.8px. */
export const estimateLabelWidth = text => {
  let w = 14;
  for (let i = 0; i < text.length; i++) w += text.charCodeAt(i) > 255 ? 10.4 : 5.8;
  return Math.min(168, Math.max(36, w));
};
/** 표시 이름: 고통 단계 접두 + 장비 이름. 이름을 모르는 장비는 등급 이름표를 만들지 않는다. */
export const lootLabelText = payload => { const def = ITEM_BY_ID[payload?.id]; return def?.name ? tierName(def.name, payload) : ''; };

/**
 * 순수 판단: 보여 줄 드랍과 순서. 고등급 → 가까운 순. 노말은 maxCommon 개까지만.
 * items 는 DropSystem.items 와 같은 모양, out 은 재사용 배열.
 * @param {any[]} items @param {any} player @param {any[]} [out] @param {{ max?: number, maxCommon?: number }} [options]
 */
export function pickLootLabels(items, player, out = [], { max = LOOT_LABEL.max, maxCommon = LOOT_LABEL.maxCommon } = {}) {
  out.length = 0;
  if (!player?.pos) return out;
  for (const it of items) {
    if (it.kind !== 'item' || it.state !== 'idle' || !(it.land >= 0)) continue;
    it._labelDist = Math.hypot(player.pos.x - it.mesh.position.x, player.pos.z - it.mesh.position.z);
    out.push(it);
  }
  out.sort((a, b) => (RARITY_RANK[b.rarity] ?? 0) - (RARITY_RANK[a.rarity] ?? 0) || a._labelDist - b._labelDist || a.serial - b.serial);
  let common = 0, n = 0;
  for (const it of out) {
    if ((RARITY_RANK[it.rarity] ?? 0) === 0 && ++common > maxCommon) continue;
    if (n >= max) break;
    out[n++] = it;
  }
  out.length = n;
  return out;
}

/** 이름표 사각형을 이미 놓인 것들과 겹치지 않게 위로 쌓는다. 쌓을 거리가 limit 를 넘으면 false.
 * @param {{ left: number, top: number, right: number, bottom: number }} rect @param {Array<{ left: number, top: number, right: number, bottom: number }>} placed
 * @param {number} count @param {{ gap?: number, limit?: number }} [options] */
export function stackUp(rect, placed, count, { gap = LOOT_LABEL.gap, limit = LOOT_LABEL.stackLimit } = {}) {
  const top0 = rect.top;
  for (let guard = 0; guard <= count; guard++) {
    let hit = null;
    for (let i = 0; i < count; i++) if (rectsOverlap(rect, placed[i])) { hit = placed[i]; break; }
    if (!hit) return true;
    const h = rect.bottom - rect.top;
    rect.bottom = hit.top - gap; rect.top = rect.bottom - h;
    if (top0 - rect.top > limit) return false;
  }
  return false;
}

export class LootLabels {
  constructor(hud = document.getElementById('hud')) {
    this.root = document.createElement('div'); this.root.className = 'loot-labels'; this.root.setAttribute('aria-hidden', 'true');
    hud?.append(this.root);
    this.hud = hud; this.toastLayer = null; this.blockers = []; this.blockerT = 0; this.picked = []; this.bounds = { left: 0, top: 0, right: 0, bottom: 0 };
    this.placedOut = { dx: 0, dy: 0, hidden: false }; this.hero = { left: 0, top: 0, right: 0, bottom: 0 };
    this.rects = Array.from({ length: LOOT_LABEL.max }, () => ({ left: 0, top: 0, right: 0, bottom: 0 }));
    this.slots = Array.from({ length: LOOT_LABEL.max }, () => {
      const el = document.createElement('span'); el.className = 'loot-label'; el.hidden = true; this.root.append(el);
      return { el, serial: -1, x: NaN, y: NaN, dim: false };
    });
    this.stats = { shown: 0, stacked: 0, dimmed: 0 };
  }
  hideFrom(i) { for (; i < this.slots.length; i++) { const s = this.slots[i]; if (!s.el.hidden) s.el.hidden = true; s.serial = -1; } }
  update(battle, renderer, dt = 0, mode = 'battle') {
    const drops = battle?.drops, player = battle?.player, cam = renderer?.camera;
    if (mode !== 'battle' || !battle?.active || battle.result || !drops?.items?.length || !cam || !player) { this.stats.shown = 0; this.hideFrom(0); return; }
    const w = renderer?._width || innerWidth, h = renderer?._height || innerHeight;
    this.blockerT -= Number.isFinite(dt) ? dt : 0;
    if (this.blockerT <= 0) {
      // 전투 안내 띠(#toast-layer, 예: 1-1 '환경 장치 · 공명종…')는 #hud 밖에 있고 수시로 생겼다 사라지므로 함께 모으고 자주 다시 잰다.
      this.blockerT = LOOT_LABEL.blockerRefresh; this.blockers = collectHudBlockers(this.hud);
      for (const r of collectHudBlockers(this.toastLayer ||= document.getElementById('toast-layer'), NOTICE_SELECTORS)) this.blockers.push(r);
    }
    this.bounds.right = w; this.bounds.bottom = h;
    // 영웅 몸 사각형(발~머리). 이름표가 올라타면 흐리게 해 주인공을 가리지 않는다.
    _p.set(player.pos.x, player.pos.y || 0, player.pos.z).project(cam);
    const footY = (1 - _p.y) * .5 * h, cx = (_p.x + 1) * .5 * w;
    _p.set(player.pos.x, (player.pos.y || 0) + 1.9, player.pos.z).project(cam);
    const headY = (1 - _p.y) * .5 * h, bodyH = Math.max(8, footY - headY);
    const hero = this.hero; hero.top = headY; hero.bottom = footY; hero.left = cx - bodyH * .28; hero.right = cx + bodyH * .28;

    // 한도(전체 · 노말)는 화면에 실제로 놓인 이름표에만 센다. 화면 밖 고등급 드랍이 보이는 장비의 자리를 먹지 않게 한다.
    const list = pickLootLabels(drops.items, player, this.picked, UNLIMITED);
    let n = 0, common = 0, stacked = 0, dimmed = 0;
    for (const it of list) {
      const isCommon = (RARITY_RANK[it.rarity] ?? 0) === 0;
      if (isCommon && common >= LOOT_LABEL.maxCommon) continue;
      const m = it.mesh;
      _p.set(m.position.x, (it.restY || .7) + LOOT_LABEL.lift, m.position.z).project(cam);
      if (_p.z > 1 || _p.x < -1.05 || _p.x > 1.05 || _p.y < -1.05 || _p.y > 1.05) continue;
      const slot = this.slots[n], el = slot.el;
      if (slot.serial !== it.serial) {
        slot.serial = it.serial; slot.x = slot.y = NaN;
        const text = it._labelText ??= lootLabelText(it.payload);
        if (!text) { slot.serial = -1; continue; }
        el.textContent = text; it._labelWidth ??= estimateLabelWidth(text); el.style.width = it._labelWidth + 'px';
        el.className = 'loot-label is-' + (RARITY_RANK[it.rarity] === undefined ? 'N' : it.rarity); slot.dim = false;
        el.style.setProperty('--rc', RARITY_COLOR[it.rarity] || RARITY_COLOR.N);
      }
      const x = (_p.x + 1) * .5 * w, y = (1 - _p.y) * .5 * h, half = it._labelWidth / 2;
      const r = this.rects[n]; r.left = x - half; r.right = x + half; r.bottom = y; r.top = y - LOOT_LABEL.height;
      const placed = placeOutside(this.placedOut, r.left, r.top, r.right, r.bottom, this.blockers, this.bounds, 40);
      if (placed.hidden) { slot.serial = -1; continue; }
      r.left += placed.dx; r.right += placed.dx; r.top += placed.dy; r.bottom += placed.dy;
      const top0 = r.top;
      if (!stackUp(r, this.rects, n)) { slot.serial = -1; continue; }
      if (r.top !== top0) {
        // 쌓아 올린 자리가 HUD 나 화면 위 가장자리에 걸리면 이번 프레임은 숨긴다.
        if (r.top < 0 || hitsAny(r, this.blockers)) { slot.serial = -1; continue; }
        stacked++;
      }
      const dim = rectsOverlap(r, hero) || it._labelDist > LOOT_LABEL.far || it.t > LOOT_LABEL.oldAfter;
      if (dim) dimmed++;
      if (dim !== slot.dim) { slot.dim = dim; el.classList.toggle('is-dim', dim); }
      const px = Math.round(r.left), py = Math.round(r.top);
      if (px !== slot.x || py !== slot.y) { slot.x = px; slot.y = py; el.style.transform = 'translate3d(' + px + 'px,' + py + 'px,0)'; }
      if (el.hidden) el.hidden = false;
      n++; if (isCommon) common++;
      if (n >= this.slots.length) break;
    }
    this.hideFrom(n);
    this.stats.shown = n; this.stats.stacked = stacked; this.stats.dimmed = dimmed;
  }
  /** QA 하네스용: 보이는 이름표의 화면 사각형과 글자. */
  snapshot() {
    const out = [];
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]; if (s.el.hidden) continue;
      const r = this.rects[i]; out.push({ text: s.el.textContent, left: r.left, top: r.top, right: r.right, bottom: r.bottom, dim: s.dim });
    }
    return out;
  }
  dispose() { this.root.remove(); }
}
