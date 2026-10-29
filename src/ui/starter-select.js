// 첫 실행 시작 영웅 선택(정책 2). 새 저장에서 튜토리얼·로비보다 먼저 한 번 뜬다. 고른 영웅이 무료 소유 영웅이 되고 바꿀 수 없다.
// 설계도: work/blueprint/starter-select (2026-10-29 C안 "전장 쇼케이스" + A안 룬 서클·빛기둥 등장). 대표님 피드백 "고르는 맛".
// 왼쪽 세로 영웅 탭 · 가운데 전신 일러스트 무대(직업색 조명·안개·불씨로 전환) · 오른쪽 아래 정보 카드 · 아래 시작 버튼.
// 막대 수치는 src/data/hero-traits.js 에서 계산한다.
import { HERO_UNLOCK_VIA_GACHA } from '../data/hero-roster.js';
import { HEROES, HERO_ORDER } from '../data/heroes.js';
import { heroCompare, DIFFICULTY_MAX } from '../data/hero-traits.js';
import { audio } from '../engine/audio.js';
import { EVENT_SOUNDS } from '../engine/combat-sound-library.js';
import { MUSIC_MIX, STARTER_SELECT_MUSIC } from '../data/music.js';

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

/** 배경 제거한 전신 일러스트(원본 *-original-v1 에서 잘라 냄). 없으면 초상으로 대신한다. */
export const STAGE_ART = Object.freeze({ knight: '/img/tll/stage/knight-stage-v1.webp', barbarian: '/img/tll/stage/barbarian-stage-v1.webp', mage: '/img/tll/stage/mage-stage-v1.webp', rogue: '/img/tll/stage/rogue-stage-v1.webp', ranger: '/img/tll/stage/ranger-stage-v1.webp' });

const SIGIL = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 3l4.6 15.4L44 24l-15.4 5.6L24 45l-4.6-15.4L4 24l15.4-5.6z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><circle cx="24" cy="24" r="4.2" fill="currentColor"/></svg>';

/** 선택 화면에 올릴 카드 모델. 순수 함수라 DOM 없이 시험한다. */
export function starterChoices() {
  // 소환 전용 영웅(gachaOnly)은 시작 영웅 후보가 아니다.
  return HERO_ORDER.filter((id) => HEROES[id] && !HEROES[id].gachaOnly).map((id) => {
    const cmp = /** @type {NonNullable<ReturnType<typeof heroCompare>>} */ (heroCompare(id));
    // 대표 스킬 3개(기본 스킬 앞 두 개 + 궁극기). 정보 카드 아이콘에 쓴다.
    const skills = HEROES[id].skills || [];
    const picks = [...skills.filter((sk) => !sk.unlock && !sk.ult).slice(0, 2), ...skills.filter((sk) => sk.ult).slice(0, 1)];
    return { ...cmp, stage: STAGE_ART[id] || cmp.portrait, skills: picks.map((sk) => ({ name: sk.name, icon: sk.icon, ult: !!sk.ult })) };
  });
}

/** 정책 2 이고 아직 시작 영웅을 고르지 않았으면 true. */
export function needsStarterSelect(eco) {
  const roster = eco?.s?.roster;
  return !!roster && roster.policy === 2 && roster.starterChosen === false;
}

const RUNE = '<svg viewBox="0 0 200 200" aria-hidden="true"><g fill="none" stroke="currentColor"><circle cx="100" cy="100" r="96" stroke-width="2.4"/><circle cx="100" cy="100" r="84" stroke-width="1.2" stroke-dasharray="3 6"/><circle cx="100" cy="100" r="58" stroke-width="1.8"/><path d="M100 16L172 142H28z" stroke-width="1.6"/><path d="M100 184L28 58h144z" stroke-width="1.6"/></g><g fill="currentColor">' + Array.from({ length: 16 }, (_, i) => `<rect x="98" y="8" width="4" height="9" rx="1" transform="rotate(${i * 22.5} 100 100)"/>`).join('') + '</g></svg>';

/** 불씨 캔버스: 화면이 떠 있는 동안만 돈다. 직업색으로 떠오르고 동작 줄이기 설정이면 멈춘 채 둔다. */
function emberField(canvas) {
  const ctx = canvas.getContext?.('2d');
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!ctx) return { color() {}, burst() {}, stop() {} };
  const N = 46, P = Array.from({ length: N }, () => ({ x: 0, y: 0, v: 0, s: 0, a: 0, w: 0 }));
  let rgb = [255, 200, 90], raf = 0, last = 0, boost = 0, w = 0, h = 0, seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const reset = (p, any) => { p.x = rnd() * w; p.y = any ? rnd() * h : h + 6; p.v = 18 + rnd() * 46; p.s = .8 + rnd() * 2.2; p.a = .25 + rnd() * .65; p.w = rnd() * 6.28; };
  const fit = () => { const r = canvas.getBoundingClientRect(), d = Math.min(2, globalThis.devicePixelRatio || 1); w = Math.max(1, r.width); h = Math.max(1, r.height); canvas.width = w * d; canvas.height = h * d; ctx.setTransform(d, 0, 0, d, 0, 0); };
  fit(); for (const p of P) reset(p, true);
  const frame = (t) => {
    const dt = Math.min(.05, last ? (t - last) / 1000 : .016); last = t; boost = Math.max(0, boost - dt * 1.6);
    ctx.clearRect(0, 0, w, h); ctx.globalCompositeOperation = 'lighter';
    for (const p of P) {
      p.y -= p.v * dt * (1 + boost * 2.5); p.w += dt * 1.7; p.x += Math.sin(p.w) * 12 * dt;
      if (p.y < -8) reset(p, false);
      const k = Math.min(1, p.y / h + .2);
      ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(p.a * k * (1 + boost)).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (1 + boost * .6), 0, 6.283); ctx.fill();
    }
    raf = requestAnimationFrame(frame);
  };
  if (!reduce) raf = requestAnimationFrame(frame); else frame(0), cancelAnimationFrame(raf);
  addEventListener('resize', fit);
  return {
    color(hex) { const n = parseInt(String(hex).replace('#', ''), 16); if (Number.isFinite(n)) rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; },
    burst() { boost = 1; },
    stop() { cancelAnimationFrame(raf); removeEventListener('resize', fit); },
  };
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
    // 다른 영웅으로 넘길 때 첫 프레임이 비지 않게 전신 그림을 미리 받는다.
    for (const src of ['/img/tll/stage/stage-bg-v1.webp', ...choices.map((c) => c.stage)]) { const img = new Image(); img.decoding = 'async'; img.src = src; }
    const el = root.createElement('div');
    el.id = 'starter-select'; el.className = 'starter-select'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'ss-title');
    const tab = (c) => `<button type="button" class="ss-card" role="radio" aria-checked="false" data-hero="${esc(c.id)}" style="--hc:${esc(c.color)}"><span class="ss-art"><img src="${esc(c.portrait)}" alt="" onerror="this.style.visibility='hidden'"></span><span class="ss-info"><b>${esc(c.name)}</b><small>${esc(c.role)}</small></span></button>`;
    el.innerHTML = `<div class="ss-stage" aria-hidden="true"><div class="ss-bg"></div><div class="ss-tint"></div><div class="ss-light"></div><div class="ss-fog ss-fog-a"></div><div class="ss-fog ss-fog-b"></div><div class="ss-floor"></div><canvas class="ss-embers"></canvas><div class="ss-vignette"></div></div>
      <h2 id="ss-title" class="ss-title">시작 영웅 선택<small>${HERO_UNLOCK_VIA_GACHA ? '한 명은 무료 · 나머지는 영웅 소환에서(첫 소환권 지급)' : '한 명은 무료 · 나머지는 나중에 해금'}</small></h2>
      <div class="ss-list" role="radiogroup" aria-labelledby="ss-title">${choices.map(tab).join('')}</div>
      <div class="ss-show" aria-live="polite"><div class="ss-rune">${RUNE}</div><div class="ss-pillar"></div><img class="ss-hero" src="" alt=""><img class="ss-hero ss-hero-out" src="" alt="" aria-hidden="true"></div>
      <div class="ss-detail"><div class="ss-dtext"><h3></h3><span class="ss-drole"></span><p></p></div><div class="ss-skills"></div><div class="ss-bars"></div></div>
      <div class="ss-foot"><p class="ss-note" role="status" aria-live="polite"></p><button type="button" class="ss-go" disabled>이 영웅으로 시작</button></div>
      <div class="ss-flash" aria-hidden="true"></div>`;
    root.body.appendChild(el);
    let picked = null, confirmed = false, pickSerial = 0;
    const cards = [...el.querySelectorAll('.ss-card')], go = el.querySelector('.ss-go'), note = el.querySelector('.ss-note');
    const show = el.querySelector('.ss-show'), [hero, heroOut] = show.querySelectorAll('.ss-hero');
    const detail = el.querySelector('.ss-detail');
    const embers = emberField(el.querySelector('.ss-embers'));
    // 고르는 순간: 무대 조명이 직업색으로 바뀌고, 발밑 룬 서클·빛기둥이 터지며 영웅이 올라선다. 영웅 목소리와 카드 소리.
    const select = (id, { focus = false, quiet = false } = {}) => {
      if (confirmed || id === picked) return;
      picked = id; const c = choices.find((x) => x.id === id), serial = ++pickSerial;
      for (const card of cards) { const on = card.dataset.hero === id; card.classList.toggle('on', on); card.setAttribute('aria-checked', String(on)); card.tabIndex = on ? 0 : -1; if (on && focus) card.focus({ preventScroll: true }); }
      el.style.setProperty('--hc', c.color); embers.color(c.color);
      if (hero.getAttribute('src')) { heroOut.src = hero.src; heroOut.classList.remove('out'); void heroOut.offsetWidth; heroOut.classList.add('out'); }
      hero.alt = c.name; hero.classList.remove('in'); hero.onerror = () => { hero.onerror = null; hero.src = c.portrait; };
      hero.src = c.stage; void hero.offsetWidth; hero.classList.add('in');
      show.classList.remove('summon'); void show.offsetWidth; show.classList.add('summon');
      detail.querySelector('h3').textContent = c.name; detail.querySelector('.ss-drole').textContent = `${c.title} · ${c.role}`; detail.querySelector('p').textContent = c.line;
      detail.querySelector('.ss-skills').innerHTML = c.skills.map((sk) => `<span class="ss-skill${sk.ult ? ' ult' : ''}" title="${esc(sk.name)}"><img src="${esc(sk.icon)}" alt="" onerror="this.style.visibility='hidden'"><em>${esc(sk.name)}</em></span>`).join('');
      detail.querySelector('.ss-bars').innerHTML = `${difficultyStarsHtml(c.difficulty)}${compareBarsHtml(c)}`;
      detail.classList.remove('swap'); void detail.offsetWidth; detail.classList.add('swap');
      go.disabled = false; note.textContent = '';
      embers.burst();
      if (!quiet) {
        audio.play('card_place', { vol: .5, min: .03 });
        // 연타로 넘길 때 목소리가 겹치지 않게 잠깐 머문 영웅만 말한다.
        setTimeout(() => { if (serial === pickSerial && !confirmed) audio.bark(`hero_${id}_select`, { vol: .95, min: .4 }); }, 160);
      }
    };
    cards.forEach((card, i) => {
      card.addEventListener('click', () => select(card.dataset.hero));
      card.addEventListener('keydown', (event) => {
        const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
        if (!step) return;
        event.preventDefault(); select(cards[(i + step + cards.length) % cards.length].dataset.hero, { focus: true });
      });
    });
    go.addEventListener('click', () => {
      if (!picked || confirmed) return;
      const result = eco.chooseStarter(picked);
      if (!result?.ok) { note.textContent = result?.reason === 'storage' ? '저장하지 못했습니다. 저장 공간을 확인한 뒤 다시 눌러 주세요.' : '선택하지 못했습니다. 다시 시도해 주세요.'; return; }
      // 확정 연출(0.9초): 빛기둥이 크게 솟고 직업색 섬광 뒤 사라진다. 다시 눌러도 두 번 고르지 않는다.
      confirmed = true; go.disabled = true; el.classList.add('confirm'); embers.burst();
      audio.play(EVENT_SOUNDS.gachaRevealSr, { vol: .7, min: .2 }); audio.play('ui_confirm', { vol: .5 });
      setTimeout(() => el.classList.add('leaving'), 620);
      setTimeout(() => { embers.stop(); el.remove(); }, 900);
      resolve(picked);
    });
    audio.playMusic?.(STARTER_SELECT_MUSIC, { ...MUSIC_MIX, volume: .48 });
    requestAnimationFrame?.(() => el.classList.add('show'));
    select(choices[0].id, { quiet: true }); cards[0].focus({ preventScroll: true });
  });
}
