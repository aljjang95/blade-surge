// 첫 실행 시작 영웅 선택(정책 2). 새 저장에서 튜토리얼·로비보다 먼저 한 번 뜬다. 고른 영웅이 무료 소유 영웅이 되고 바꿀 수 없다.
// 설계도 시안: 상단 상세 판 + 비교 목록(공격·생존·난이도). 막대 수치는 src/data/hero-traits.js 에서 계산한다.
import { HEROES, HERO_ORDER } from '../data/heroes.js';
import { heroCompare, DIFFICULTY_MAX } from '../data/hero-traits.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const pct = (v) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;

/** 난이도 별 3개(채움/빈칸). 영웅 탭 잠금 상세도 같이 쓴다. */
export function difficultyStarsHtml(difficulty) {
  return `<span class="hc-stars" role="img" aria-label="난이도 ${difficulty}/${DIFFICULTY_MAX}">${Array.from({ length: DIFFICULTY_MAX }, (_, i) => `<i class="${i < difficulty ? 'on' : ''}">★</i>`).join('')}</span>`;
}

/** 공격·생존·난이도 막대 3줄. 시작 선택 목록과 영웅 탭 잠금 상세가 같은 계산·같은 마크업을 쓴다. */
export function compareBarsHtml(cmp) {
  const bar = (key, label, value, text) => `<span class="hc-bar hc-${key}" role="img" aria-label="${label} ${text}"><em>${label}</em><b><u style="width:${pct(value)}"></u></b></span>`;
  return `<span class="hc-bars">${bar('atk', '공격', cmp.attack, pct(cmp.attack))}${bar('def', '생존', cmp.survival, pct(cmp.survival))}${bar('dif', '난이도', cmp.difficultyBar, `${cmp.difficulty}/${DIFFICULTY_MAX}`)}</span>`;
}

const SIGIL = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 3l4.6 15.4L44 24l-15.4 5.6L24 45l-4.6-15.4L4 24l15.4-5.6z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><circle cx="24" cy="24" r="4.2" fill="currentColor"/></svg>';

/** 선택 화면에 올릴 카드 모델. 순수 함수라 DOM 없이 시험한다. */
export function starterChoices() {
  return HERO_ORDER.filter((id) => HEROES[id]).map((id) => /** @type {NonNullable<ReturnType<typeof heroCompare>>} */ (heroCompare(id)));
}

/** 정책 2 이고 아직 시작 영웅을 고르지 않았으면 true. */
export function needsStarterSelect(eco) {
  const roster = eco?.s?.roster;
  return !!roster && roster.policy === 2 && roster.starterChosen === false;
}

/**
 * 시작 영웅 선택 화면을 띄우고 고를 때까지 기다린다. 이미 골랐거나 정책 1(기존 저장)이면 바로 끝난다.
 * @param {{ eco: any }} app @param {{ root?: Document }} [options]
 * @returns {Promise<string|null>} 고른 영웅 id(건너뛰면 null)
 */
export function runStarterSelect(app, { root = document } = {}) {
  const eco = app.eco;
  if (!needsStarterSelect(eco)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const choices = starterChoices();
    const el = root.createElement('div');
    el.id = 'starter-select'; el.className = 'starter-select'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'ss-title');
    const row = (c) => `<button type="button" class="ss-card" role="radio" aria-checked="false" data-hero="${esc(c.id)}" style="--hc:${esc(c.color)}"><span class="ss-sigil">${SIGIL}</span><span class="ss-art"><img src="${esc(c.portrait)}" alt="" onerror="this.style.visibility='hidden'"></span><span class="ss-info"><b>${esc(c.name)}</b><small>${esc(c.role)}</small>${difficultyStarsHtml(c.difficulty)}</span>${compareBarsHtml(c)}</button>`;
    el.innerHTML = `<div class="ss-panel"><div class="ss-head"><h2 id="ss-title">시작 영웅 선택</h2><p>처음 함께할 영웅 한 명을 고르세요. 나머지 영웅은 나중에 해금할 수 있어요.</p></div>
      <div class="ss-detail" aria-live="polite"><img class="ss-hero" src="" alt="" onerror="this.style.visibility='hidden'"><div class="ss-dtext"><h3></h3><span class="ss-drole"></span><p></p></div></div>
      <div class="ss-list" role="radiogroup" aria-labelledby="ss-title">${choices.map(row).join('')}</div>
      <div class="ss-foot"><p class="ss-note" role="status" aria-live="polite"></p><button type="button" class="ss-go" disabled>이 영웅으로 시작</button><span class="ss-free">시작 영웅 1명 무료 선택</span></div></div>`;
    root.body.appendChild(el);
    let picked = null;
    const cards = [...el.querySelectorAll('.ss-card')], go = el.querySelector('.ss-go'), note = el.querySelector('.ss-note');
    const detail = el.querySelector('.ss-detail'), dimg = detail.querySelector('.ss-hero');
    const select = (id, focus = false) => {
      picked = id; const c = choices.find((x) => x.id === id);
      for (const card of cards) { const on = card.dataset.hero === id; card.classList.toggle('on', on); card.setAttribute('aria-checked', String(on)); card.tabIndex = on ? 0 : -1; if (on && focus) card.focus({ preventScroll: true }); }
      detail.style.setProperty('--hc', c.color); dimg.src = c.portrait; dimg.alt = c.name; dimg.style.visibility = '';
      detail.querySelector('h3').textContent = c.name; detail.querySelector('.ss-drole').textContent = c.role; detail.querySelector('p').textContent = c.line;
      go.disabled = false; note.textContent = '';
    };
    cards.forEach((card, i) => {
      card.addEventListener('click', () => select(card.dataset.hero));
      card.addEventListener('keydown', (event) => {
        const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
        if (!step) return;
        event.preventDefault(); select(cards[(i + step + cards.length) % cards.length].dataset.hero, true);
      });
    });
    go.addEventListener('click', () => {
      if (!picked) return;
      const result = eco.chooseStarter(picked);
      if (!result?.ok) { note.textContent = result?.reason === 'storage' ? '저장하지 못했습니다. 저장 공간을 확인한 뒤 다시 눌러 주세요.' : '선택하지 못했습니다. 다시 시도해 주세요.'; return; }
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 280);
      resolve(picked);
    });
    requestAnimationFrame?.(() => el.classList.add('show'));
    select(choices[0].id); cards[0].focus({ preventScroll: true });
  });
}
