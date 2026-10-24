/**
 * 전운 굴리기 확률 공개 시트(설계도 blessing-odds). 숫자는 전부 blessing-core oddsTable() 에서 온다(손으로 쓴 확률 없음).
 * 준비 창 안에서 오른쪽 60%를 덮는 세로 시트로 열리고(세로 화면은 전체), 뒤 창은 어둡게만 보인다.
 */
import { oddsTable } from '../game/blessing-core.js';
import { FAMILY_BY_ID, glyphSvg } from './blessing-glyphs.js';

const safe = (/** @type {unknown} */ v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
const dots = (/** @type {number} */ n) => '<i></i>'.repeat(n);

/** 시트 HTML(테스트에서도 쓰려고 분리). */
export function blessingOddsHtml(table = oddsTable()) {
  const gradeHead = table.grades.map(g => `<th scope="col"><span class="blessing-odds-grade">${safe(g.label)}</span><span class="blessing-odds-dots">${dots(g.grade)}</span></th>`).join('');
  const families = table.families.map((f, fi) => {
    const fam = FAMILY_BY_ID[f.family], boons = table.perBoon.filter(b => b.family === f.family);
    const per = boons[0]?.grades || [];
    const sameAll = boons.every(b => b.grades.every((g, i) => g.text === per[i]?.text));
    const rows = boons.map(b => `<tr class="blessing-odds-boon" data-family-row="${fi}" hidden><th scope="row">${safe(b.name)}</th>${b.grades.map(g => `<td>${safe(g.text)}</td>`).join('')}</tr>`).join('');
    return `<tbody><tr class="blessing-odds-family"><th scope="row"><button type="button" aria-expanded="false" data-family-toggle="${fi}"><span class="blessing-odds-icon" data-family="${safe(f.family)}">${glyphSvg(f.family, `odds${fi}`)}</span><span>${safe(fam?.name || f.family)}</span><small>3종 ${sameAll ? '각각' : ''}</small></button></th>${per.map(g => `<td><span class="blessing-odds-dots">${dots(g.grade)}</span>${safe(g.text)}</td>`).join('')}</tr>${rows}</tbody>`;
  }).join('');
  const famTotals = table.families.map(f => `${safe(FAMILY_BY_ID[f.family]?.name || f.family)} ${Math.round(f.rate * 100)}%`).join(' · ');
  const famGrades = table.families[0]?.grades.map(g => `${g.label} ${g.text}`).join(' · ') || '';
  return `<header class="blessing-odds-head"><h3><span aria-hidden="true">✦</span> 전운 굴리기 확률</h3><button type="button" class="blessing-odds-close" data-odds-close>닫기</button></header>
  <div class="blessing-odds-scroll">
    <section><h4>1. 등급 <small>(후보 1칸)</small></h4><table class="blessing-odds-grades"><thead><tr>${gradeHead}</tr></thead><tbody><tr>${table.grades.map(g => `<td>${safe(g.text)}</td>`).join('')}</tr></tbody></table></section>
    <section><h4>2. 각인별 확률 <small>(후보 1칸 · 줄을 누르면 3종 이름)</small></h4><table class="blessing-odds-families"><thead><tr><th scope="col">가문</th>${table.grades.map(g => `<th scope="col">${safe(g.label)}</th>`).join('')}</tr></thead>${families}</table>
      <p class="blessing-odds-sub">가문별 합계: ${famTotals} (가문 하나 ${safe(famGrades)}) · 각인 ${table.perBoon.length}종 균등</p></section>
    <section><h4>3. 추가 규칙</h4><div class="blessing-odds-rule"><p><span aria-hidden="true">✦</span> 천장: ${safe(table.pity.text)}</p><p>한 굴림에서 III 1개 이상 <b>${safe(table.baseAtLeastOneIII.text)}</b>(천장 제외) · 천장 포함 약 <b>${safe(table.effective.atLeastOneIIIPerRoll.text)}</b></p><p>후보 1칸이 III일 실효 비율 약 ${safe(table.effective.iiiCandidateRate.text)}(천장 포함) · ${safe(table.notes[0])}</p></div></section>
    <section><h4>4. 이용 가격</h4><div class="blessing-odds-price"><p>${safe(table.prices.text)}</p></div><p class="blessing-odds-note">${safe(table.notes[2])}</p></section>
  </div>`;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 시트가 열린 동안 뒤 준비 영역(host 의 시트·그늘막 외 자식)을 inert 로 막는다. 반환값을 부르면 원래 상태로 되돌린다.
 * 원래 inert 였던 요소는 그대로 둔다.
 * @param {HTMLElement} host @param {Element[]} keep 막지 않을 요소(시트·그늘막)
 */
export function inertBackground(host, keep) {
  const touched = [...host.children].filter(el => !keep.includes(el) && !el.hasAttribute('inert'));
  touched.forEach(el => el.setAttribute('inert', ''));
  return () => touched.forEach(el => el.removeAttribute('inert'));
}

/** Tab/Shift+Tab 을 시트 안에서 순환시킨다. 처리했으면 true. */
export function trapTab(/** @type {{ key: string, shiftKey?: boolean, preventDefault: () => void }} */ e, /** @type {HTMLElement} */ sheet, active = /** @type {Element|null} */ (globalThis.document?.activeElement ?? null)) {
  if (e.key !== 'Tab') return false;
  const items = [...sheet.querySelectorAll(FOCUSABLE)].filter(el => !(/** @type {HTMLElement} */ (el)).hidden && !el.closest('[hidden]'));
  if (!items.length) { e.preventDefault(); return true; }
  const first = /** @type {HTMLElement} */ (items[0]), last = /** @type {HTMLElement} */ (items[items.length - 1]);
  const inside = !!active && sheet.contains(active);
  if (e.shiftKey && (!inside || active === first)) { e.preventDefault(); last.focus({ preventScroll: true }); return true; }
  if (!e.shiftKey && (!inside || active === last)) { e.preventDefault(); first.focus({ preventScroll: true }); return true; }
  return false;
}

/**
 * 시트를 연다. 반환값은 닫기 함수. onClose 는 닫힐 때 한 번 불린다.
 * @param {HTMLElement} host 준비 창(dialog)
 * @param {() => void} [onClose]
 */
export function openBlessingOdds(host, onClose) {
  const shade = document.createElement('div');
  shade.className = 'blessing-odds-shade';
  const sheet = document.createElement('section');
  sheet.className = 'blessing-odds'; sheet.setAttribute('role', 'region'); sheet.setAttribute('aria-label', '전운 굴리기 확률');
  sheet.innerHTML = blessingOddsHtml();
  let closed = false, restoreBackground = () => {};
  const close = () => {
    if (closed) return; closed = true;
    shade.remove(); sheet.remove(); host.removeEventListener('keydown', onKey, true); restoreBackground();
    onClose?.();
  };
  const onKey = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; } if (trapTab(e, sheet)) e.stopPropagation(); };
  shade.addEventListener('click', close);
  sheet.querySelector('[data-odds-close]')?.addEventListener('click', close);
  sheet.addEventListener('click', e => {
    const btn = /** @type {HTMLElement} */ (e.target)?.closest?.('[data-family-toggle]'); if (!btn) return;
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    sheet.querySelectorAll(`[data-family-row="${btn.dataset.familyToggle}"]`).forEach(row => { /** @type {HTMLElement} */ (row).hidden = !open; });
  });
  host.addEventListener('keydown', onKey, true);
  host.append(shade, sheet);
  restoreBackground = inertBackground(host, [shade, sheet]);
  /** @type {HTMLElement|null} */ (sheet.querySelector('[data-odds-close]'))?.focus({ preventScroll: true });
  return close;
}

