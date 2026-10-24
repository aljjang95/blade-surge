// 첫 실행 시작 영웅 선택(정책 2). 새 저장에서 튜토리얼·로비보다 먼저 한 번 뜬다. 고른 영웅이 무료 소유 영웅이 되고 바꿀 수 없다.
import { HEROES, HERO_ORDER } from '../data/heroes.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

/** 카드에 쓰는 한 줄 특징. 새 영웅이 데이터에 생기면 title 로 대신한다. */
export const STARTER_TRAITS = Object.freeze({
  knight: { role: '기사', line: '방패와 성검 · 균형 잡힌 근접' },
  barbarian: { role: '야만전사', line: '큰 도끼 · 단단한 광역 근접' },
  mage: { role: '마법사', line: '원거리 마법 · 넓은 폭발' },
  rogue: { role: '도적', line: '빠른 단검 · 급소 치명타' },
  ranger: { role: '궁수', line: '활 · 거리를 두고 안전하게' },
});

/** 선택 화면에 올릴 카드 모델. 순수 함수라 DOM 없이 시험한다. */
export function starterChoices() {
  return HERO_ORDER.filter((id) => HEROES[id]).map((id) => {
    const def = HEROES[id], trait = STARTER_TRAITS[id];
    return { id, name: def.name, title: def.title, portrait: def.portrait || '', color: def.color, role: trait?.role || def.title, line: trait?.line || def.title };
  });
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
    el.innerHTML = `<div class="ss-head"><h2 id="ss-title">함께할 영웅을 골라 주세요</h2><p>고른 영웅으로 시작하며 나중에 바꿀 수 없습니다. 다른 영웅은 영웅 탭에서 플레이로 모은 보석으로 하나씩 열 수 있어요.</p></div>
      <div class="ss-grid" role="radiogroup" aria-labelledby="ss-title">${choices.map((c) => `<button type="button" class="ss-card" role="radio" aria-checked="false" data-hero="${esc(c.id)}" style="--hc:${esc(c.color)}"><span class="ss-art"><img src="${esc(c.portrait)}" alt="" onerror="this.style.visibility='hidden'"></span><span class="ss-info"><b>${esc(c.name)}</b><small>${esc(c.role)}</small><em>${esc(c.line)}</em></span></button>`).join('')}</div>
      <div class="ss-foot"><p class="ss-note" role="status" aria-live="polite"></p><button type="button" class="btn btn-gold ss-go" disabled>영웅을 선택하세요</button></div>`;
    root.body.appendChild(el);
    let picked = null;
    const cards = [...el.querySelectorAll('.ss-card')], go = el.querySelector('.ss-go'), note = el.querySelector('.ss-note');
    const select = (id, focus = false) => {
      picked = id;
      for (const card of cards) { const on = card.dataset.hero === id; card.classList.toggle('on', on); card.setAttribute('aria-checked', String(on)); card.tabIndex = on ? 0 : -1; if (on && focus) card.focus({ preventScroll: true }); }
      go.disabled = false; go.textContent = `${HEROES[id].name} 선택하고 시작`; note.textContent = '';
    };
    cards.forEach((card, i) => {
      card.tabIndex = i === 0 ? 0 : -1;
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
    cards[0].focus({ preventScroll: true });
  });
}
