/**
 * 전운 굴리기 칸(원정 준비 창 안 1곳). 설계: docs/RUNE_AND_BLESSING_DESIGN.md 3장, 설계도 blessing-roll·blessing-pick.
 * - 굴림 결과는 economy.blessingRoll() 이 회전 시작 전에 정하고 저장한다. 릴은 그 결과를 보여 주기만 한다.
 * - 연출은 requestAnimationFrame + transform 만 쓴다. 칸 높이는 굴림 시작 때 한 번만 잰다.
 * - 전투 화면·HUD 에는 아무것도 띄우지 않는다. 알림은 이 칸 안의 띠로만(confirm/alert 없음).
 */
import './blessing-reel.css';
import { audio } from '../engine/audio.js';
import { EVENT_SOUNDS } from '../engine/combat-sound-library.js';
import { BLESSING_PITY } from '../data/blessing.js';
import { planReels, cellsForReel, reelAt, eventsBetween, shouldTick, stopVibration, stripOffset } from './blessing-reel-timeline.js';
import { BOON_BY_ID, FAMILY_BY_ID, GRADE_LABEL, glyphSvg, boonEffectText, gradeDots } from './blessing-glyphs.js';
import { openBlessingOdds } from './blessing-odds.js';

const SHORT_KEY = 'bladesurge_blessing_short_reel';
/** 설정 "전운 연출 짧게"(0.6초). 저장은 다른 UI 전용 설정처럼 세이브와 분리된 localStorage 키 하나. */
export const readShortReel = () => { try { return globalThis.localStorage?.getItem(SHORT_KEY) === '1'; } catch { return false; } };
export const writeShortReel = (/** @type {boolean} */ on) => { try { globalThis.localStorage?.setItem(SHORT_KEY, on ? '1' : '0'); } catch { /* 저장소 차단 시 이번 접속만 유지 */ } };

const FAMILIES = ['ember', 'tide', 'storm', 'stone'];
const safe = (/** @type {unknown} */ v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
let uidSeq = 0;
const nextUid = () => (++uidSeq).toString(36);

/** 각인 이름 + 등급(예: "잿불 칼날 II"). */
export const boonTitle = (/** @type {{id: string, grade: number}} */ c) => `${BOON_BY_ID[c.id]?.name || c.id} ${GRADE_LABEL[c.grade] || ''}`.trim();

/** 비용 문구: 무료 / 부적 1 / 보석 30. */
export function costLabel(cost) {
  if (!cost) return '';
  return cost.kind === 'free' ? '무료' : cost.kind === 'charm' ? '부적 1' : `보석 ${cost.gems}`;
}

function tileHtml(c, { label = false } = {}) {
  const boon = BOON_BY_ID[c.id], fam = boon?.family || 'ember';
  return `<span class="blessing-tile" data-family="${safe(fam)}">${glyphSvg(fam, nextUid())}<span class="blessing-dots" data-grade="${c.grade}">${gradeDots(c.grade)}</span>${label ? `<b class="blessing-tile-name">${safe(boonTitle(c))}</b>` : ''}</span>`;
}
function blankTileHtml(fam) {
  return `<span class="blessing-tile" data-family="${fam}">${glyphSvg(fam, nextUid())}</span>`;
}

export class BlessingSlot {
  /** @param {any} app @param {{ dialog?: HTMLElement|null }} [options] */
  constructor(app, { dialog = null } = {}) {
    this.app = app; this.dialog = dialog;
    this.spin = null; this.raf = 0; this.confirmArmed = false; this.closeOdds = null;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const el = this.el = document.createElement('section');
    el.className = 'blessing-slot'; el.setAttribute('aria-label', '전운 굴리기');
    el.innerHTML = `<svg class="blessing-defs" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute"><filter id="blessing-vblur" x="-5%" y="-25%" width="110%" height="150%"><feGaussianBlur stdDeviation="0 6"/></filter></svg><header class="blessing-head"><h3><span aria-hidden="true">✦</span> 전운 굴리기</h3><p class="blessing-sub"></p><p class="blessing-notice" role="status" aria-live="polite" hidden></p><label class="blessing-short"><input type="checkbox" data-blessing-short> 연출 짧게</label></header>
      <div class="blessing-main"><div class="blessing-stage"><div class="blessing-machine" role="group" aria-label="전운 릴 3개">
        <span class="blessing-gem" style="--x:0"></span><span class="blessing-gem" style="--x:1"></span><span class="blessing-gem" style="--x:2"></span><span class="blessing-gem" style="--x:3"></span>
        ${[0, 1, 2].map(i => `<div class="blessing-reel" data-reel="${i}"><div class="blessing-window"><div class="blessing-strip"><div class="blessing-strip-inner"></div></div><span class="blessing-flash" aria-hidden="true"></span><span class="blessing-sparks" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span></div><button type="button" class="blessing-card" data-blessing-pick="${i}" hidden></button></div>`).join('')}
      </div><p class="blessing-skip" aria-hidden="true">탭하여 건너뛰기</p></div>
      <aside class="blessing-side"><span class="blessing-chip"></span><button type="button" class="blessing-roll" data-blessing-roll><span class="blessing-roll-icon" aria-hidden="true"></span><span data-blessing-roll-label></span></button><button type="button" class="blessing-odds-open" data-blessing-odds>확률 보기 <span aria-hidden="true">›</span></button><div class="blessing-pity"><span data-blessing-pity></span><span class="blessing-pity-bar" aria-hidden="true">${'<i></i>'.repeat(BLESSING_PITY)}</span></div><p class="blessing-held" data-blessing-held hidden></p></aside></div>
`;
    this.machine = /** @type {HTMLElement} */ (el.querySelector('.blessing-machine'));
    this.reels = [...el.querySelectorAll('.blessing-reel')].map(reel => ({
      root: /** @type {HTMLElement} */ (reel), win: /** @type {HTMLElement} */ (reel.querySelector('.blessing-window')),
      strip: /** @type {HTMLElement} */ (reel.querySelector('.blessing-strip')), inner: /** @type {HTMLElement} */ (reel.querySelector('.blessing-strip-inner')),
      card: /** @type {HTMLButtonElement} */ (reel.querySelector('.blessing-card')),
    }));
    // 회전 중 탭 = 건너뛰기. 같은 탭의 click 이 막 나타난 카드를 고르지 않게 잠깐 선택을 막는다.
    this.skipTapUntil = 0;
    this.machine.addEventListener('pointerdown', event => { if (this.spin) { event.preventDefault(); this.skipTapUntil = performance.now() + 450; this.skip(); } });
    this.machine.addEventListener('click', event => {
      const button = /** @type {HTMLElement} */ (event.target)?.closest?.('[data-blessing-pick]');
      if (!button || this.spin || performance.now() < this.skipTapUntil) return;
      this.pick(Number(/** @type {HTMLElement} */ (button).dataset.blessingPick));
    });
    el.querySelector('[data-blessing-roll]')?.addEventListener('click', () => this.roll());
    el.querySelector('[data-blessing-odds]')?.addEventListener('click', event => this.openOdds(/** @type {HTMLElement} */ (event.currentTarget)));
    const short = /** @type {HTMLInputElement} */ (el.querySelector('[data-blessing-short]'));
    short.checked = readShortReel();
    short.addEventListener('change', () => writeShortReel(short.checked));
  }

  get eco() { return this.app?.eco; }
  get lite() { return this.app?.renderer?.quality === 'low' || this.app?.eco?.s?.settings?.quality === 'low'; }

  /** 원정 단계 칸 바로 뒤에 붙인다. */
  mount(after) { after.after(this.el); this.refresh({ restore: true }); return this; }

  quote() { try { return this.eco?.blessingQuote?.() || null; } catch { return null; } }

  notice(text, tone = 'info') {
    const n = /** @type {HTMLElement} */ (this.el.querySelector('.blessing-notice'));
    // 알림은 제목 줄(부제 자리)에 띄워 낮은 가로 화면에서도 스크롤 없이 보인다.
    n.textContent = text || ''; n.title = text || ''; n.hidden = !text; n.dataset.tone = tone;
    /** @type {HTMLElement} */ (this.el.querySelector('.blessing-sub')).hidden = !!text;
  }

  /** 견적·천장·보관 표시를 다시 그린다. restore 면 마지막 결과를 멈춘 카드로 복원한다. */
  refresh({ restore = false } = {}) {
    const q = this.quote(), el = this.el;
    if (!q) { el.hidden = true; return; }
    el.hidden = false;
    const offer = q.offer, held = q.held;
    el.querySelector('.blessing-sub').textContent = offer ? '하나를 골라 이번 원정에 가져갑니다.' : '레버를 당겨 각인 후보 3개 중 하나를 고릅니다.';
    const chip = /** @type {HTMLElement} */ (el.querySelector('.blessing-chip'));
    chip.textContent = q.cost.kind === 'free' ? '✦ 오늘 무료 1회' : q.charms > 0 ? `✦ 전운 부적 ${q.charms}개` : `보유 보석 ${Number(q.gems || 0).toLocaleString('ko-KR')}`;
    chip.dataset.kind = q.cost.kind;
    const roll = /** @type {HTMLButtonElement} */ (el.querySelector('[data-blessing-roll]'));
    roll.dataset.kind = q.cost.kind;
    const capped = !q.cost.allowed;
    roll.querySelector('[data-blessing-roll-label]').textContent = capped ? '오늘 보석 굴림 끝' : `${offer ? '다시 굴리기' : '전운 굴리기'} · ${costLabel(q.cost)}`;
    roll.disabled = capped; roll.setAttribute('aria-disabled', String(capped || !!this.spin));
    roll.dataset.short = String(!q.affordable && !capped);
    const left = q.pityLeft, used = BLESSING_PITY + 1 - left;
    el.querySelector('[data-blessing-pity]').innerHTML = left <= 1 ? '다음 굴림 <b>III 확정</b>' : `III 보장까지 <b>${left}회</b>`;
    el.querySelectorAll('.blessing-pity-bar i').forEach((bar, i) => bar.classList.toggle('on', i < used));
    const heldLine = /** @type {HTMLElement} */ (el.querySelector('[data-blessing-held]'));
    const heldShownOnCard = !!(offer && offer.picked >= 0 && held && offer.candidates[offer.picked]?.id === held.id && offer.candidates[offer.picked]?.grade === held.grade);
    heldLine.hidden = !held || heldShownOnCard;
    if (held) heldLine.innerHTML = `<span>보관 중</span> <b>${safe(boonTitle(held))}</b> · 전운 각인 · 이번 원정만`;
    this.syncGoIcon(held);
    if (restore && !this.spin) {
      if (offer) this.showCards(offer.candidates, offer.picked);
      else this.showIdle();
    }
  }

  /** 원정 시작 버튼 안 가져가는 각인 작은 아이콘. */
  syncGoIcon(held) {
    const go = /** @type {HTMLElement|null} */ (this.dialog?.querySelector('.citadel-hub-go') || null);
    if (!go) return;
    if (!held) { delete go.dataset.blessingFamily; go.style.removeProperty('--blessing-go-icon'); return; }
    const fam = BOON_BY_ID[held.id]?.family || 'ember';
    go.dataset.blessingFamily = fam;
    go.style.setProperty('--blessing-go-icon', `url("data:image/svg+xml,${encodeURIComponent(glyphSvg(fam, 'go').replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '))}")`);
    go.setAttribute('aria-description', `전운 각인 ${boonTitle(held)} 적용`);
  }

  /** 굴리기 전: 흐린 문양 3칸. */
  showIdle() {
    this.machine.classList.remove('is-spinning', 'is-ready', 'has-pick');
    this.machine.classList.add('is-idle');
    this.reels.forEach((r, i) => {
      r.root.className = 'blessing-reel'; r.card.hidden = true; r.strip.hidden = false;
      const fams = [FAMILIES[(i + 3) % 4], FAMILIES[i], FAMILIES[(i + 1) % 4]];
      r.inner.innerHTML = fams.map(f => `<div class="blessing-cell">${blankTileHtml(f)}</div>`).join('');
      r.strip.style.transform = '';
    });
  }

  /** 멈춘 결과 카드 3장(선택 가능). picked 는 보관된 카드 번호(-1 없음). */
  showCards(candidates, picked = -1) {
    this.machine.classList.remove('is-spinning', 'is-idle');
    this.machine.classList.add('is-ready');
    this.machine.classList.toggle('has-pick', picked >= 0);
    candidates.forEach((c, i) => {
      const r = this.reels[i]; if (!r) return;
      r.root.classList.add('is-lit');
      r.root.classList.toggle('is-gold', c.grade === 3);
      r.root.classList.toggle('is-picked', i === picked);
      r.strip.hidden = true; r.card.hidden = false;
      r.card.setAttribute('aria-pressed', String(i === picked));
      r.card.setAttribute('aria-label', `${boonTitle(c)} · ${boonEffectText(c.id, c.grade)}${i === picked ? ' · 선택됨' : ''}`);
      r.card.innerHTML = `${tileHtml(c)}<b class="blessing-card-name">${safe(boonTitle(c))}</b><small class="blessing-card-effect">${safe(boonEffectText(c.id, c.grade))}</small><span class="blessing-ribbon" aria-hidden="true">선택됨 · 이번 원정만</span>`;
    });
  }

  roll() {
    if (this.spin) { this.skip(); return; }
    const q = this.quote(); if (!q) return;
    if (!q.cost.allowed) { this.notice('오늘 보석 굴림 30회를 모두 썼습니다. 내일 05:00에 다시 굴릴 수 있습니다.', 'warn'); return; }
    if (!q.affordable) {
      audio.play('ui_error');
      this.notice(`보석이 부족합니다. 보석 ${q.cost.gems}개가 필요합니다(보유 ${Number(q.gems || 0).toLocaleString('ko-KR')}).`, 'warn');
      return;
    }
    const res = this.eco.blessingRoll();
    if (!res?.ok) {
      const why = res?.reason || res?.error;
      this.notice(why === 'gems' ? '보석이 부족합니다.' : why === 'daily-cap' ? '오늘 보석 굴림을 모두 썼습니다.' : why === 'storage' ? '저장 공간에 쓰지 못해 굴리지 않았습니다. 보석은 그대로입니다.' : '지금은 굴릴 수 없습니다.', 'warn');
      return;
    }
    this.notice(''); this.confirmArmed = false;
    this.refresh();
    this.startSpin(res.candidates);
  }

  /** 릴 회전. 결과(candidates)는 이미 저장됐다. */
  startSpin(candidates) {
    this.stopLoop();
    const short = readShortReel();
    audio.play(EVENT_SOUNDS.blessingLever, { vol: 0.9, vary: 0.02, priority: 4 });
    if (this.reduced) {
      // 동작 줄이기: 회전 없이 바로 결과. 소리·진동은 멈춤 한 번만.
      const iii = candidates.some(c => c.grade === 3);
      audio.play(EVENT_SOUNDS.blessingStop, { vol: 0.9, vary: 0, priority: 4, delay: 0.12 });
      if (iii) audio.play(EVENT_SOUNDS.blessingGold, { vol: 0.85, vary: 0, priority: 4, delay: 0.2 });
      this.vibrate(stopVibration(iii ? 3 : 1));
      this.showCards(candidates, -1); this.refresh(); return;
    }
    const plan = planReels({ short });
    this.machine.classList.remove('is-idle', 'is-ready', 'has-pick');
    this.machine.classList.add('is-spinning');
    this.machine.classList.toggle('is-lite', this.lite);
    // 칸 높이: 창 높이에서 한 번만 읽는다(레이아웃 읽기는 시작 때 1회).
    const viewH = this.reels[0].win.getBoundingClientRect().height || 140;
    const cell = Math.round(viewH * 0.68);
    this.machine.style.setProperty('--blessing-cell', `${cell}px`);
    const geo = this.reels.map((r, i) => {
      const c = candidates[i], cells = cellsForReel(plan, i), fin = plan.reels[i].final;
      const resultFam = BOON_BY_ID[c.id]?.family || 'ember';
      let prev = resultFam, html = '';
      // DOM 위에서부터 칸 번호가 큰 순서. 결과 칸 위·아래는 결과와 다른 가문으로 두어 멈춤이 또렷하다.
      for (let s = cells - 1; s >= 0; s--) {
        if (s === fin) { html += `<div class="blessing-cell is-result">${tileHtml(c, { label: true })}</div>`; prev = resultFam; continue; }
        let f = FAMILIES[Math.floor(Math.random() * 4)];
        if (f === prev || ((s === fin + 1 || s === fin - 1) && f === resultFam)) f = FAMILIES[(FAMILIES.indexOf(f) + 1 + (f === resultFam ? 1 : 0)) % 4];
        if (f === resultFam && (s === fin + 1 || s === fin - 1)) f = FAMILIES[(FAMILIES.indexOf(f) + 2) % 4];
        html += `<div class="blessing-cell">${blankTileHtml(f)}</div>`; prev = f;
      }
      r.root.className = 'blessing-reel'; r.card.hidden = true; r.strip.hidden = false;
      r.inner.innerHTML = html;
      r.root.classList.toggle('is-blur', !this.lite);
      r.strip.style.transform = `translate3d(0,${stripOffset(0, cells, cell, viewH)}px,0)`;
      return { cells, cell, viewH, lastCell: 0, blur: !this.lite };
    });
    const states = this.reels.map(() => ({ pos: 0, velocity: 0, phase: 'spin', stopped: false }));
    this.spin = { plan, candidates, geo, states, t0: performance.now(), last: 0, skipAt: /** @type {number|null} */ (null), lastTick: -1, frames: 0, stopsAt: /** @type {number[]} */ ([]), readyAt: -1,
      // QA 계측: 전역 플래그가 있을 때만 프레임 시각을 모은다(평소엔 할당 없음).
      trace: /** @type {number[]|null} */ (globalThis.__blessingTrace ? [] : null) };
    this.refresh();
    const frame = (/** @type {number} */ now) => { this.raf = 0; if (this.frame(now)) this.raf = requestAnimationFrame(frame); };
    this.raf = requestAnimationFrame(frame);
  }

  /** 한 프레임. false 를 돌려주면 루프 끝. */
  frame(now) {
    const sp = this.spin; if (!sp) return false;
    const t = Math.max(0, (now - sp.t0) / 1000); sp.frames++;
    if (sp.trace) sp.trace.push(t);
    // 짧은 레버 소리(0.22초) 위에 째깍을 바로 겹쳐 회전 시작의 손맛을 채운다.
    for (let i = 0; i < this.reels.length; i++) {
      const r = this.reels[i], g = sp.geo[i], st = reelAt(sp.plan.reels[i], t, sp.skipAt, sp.states[i]);
      r.strip.style.transform = `translate3d(0,${stripOffset(st.pos, g.cells, g.cell, g.viewH)}px,0)`;
      const whole = Math.floor(st.pos + 0.5);
      if (whole !== g.lastCell && !st.stopped) {
        g.lastCell = whole;
        if (shouldTick(t, sp.lastTick)) { sp.lastTick = t; audio.play(EVENT_SOUNDS.blessingTick, { vol: 0.42, vary: 0.06, min: 0.07, priority: 2 }); }
      }
      // 감속에 들어가면 흐림을 걷어 문양이 또렷하게 들어온다.
      const blur = !this.lite && st.phase === 'spin';
      if (blur !== g.blur) { g.blur = blur; r.root.classList.toggle('is-blur', blur); }
    }
    const events = eventsBetween(sp.plan, sp.last, t, sp.skipAt);
    if (events.length) this.handleEvents(events, t);
    sp.last = t;
    if (sp.readyAt >= 0) { this.finish(); return false; }
    return true;
  }

  handleEvents(events, t) {
    const sp = this.spin; if (!sp) return;
    const stops = events.filter(e => e.type === 'stop');
    if (stops.length) {
      let iii = false;
      for (const e of stops) {
        const i = /** @type {number} */ (e.reel), c = sp.candidates[i], r = this.reels[i];
        r.root.classList.add('is-lit'); sp.stopsAt[i] = t;
        if (c.grade === 3) { iii = true; r.root.classList.add('is-gold'); if (!this.lite) r.root.classList.add('is-flash'); }
      }
      // 건너뛰기로 여러 릴이 한꺼번에 멈추면 소리·진동은 한 번만.
      audio.play(EVENT_SOUNDS.blessingStop, { vol: 0.92, vary: 0.03, min: 0.05, priority: 4 });
      if (iii) audio.play(EVENT_SOUNDS.blessingGold, { vol: 0.85, vary: 0, priority: 4 });
      this.vibrate(stopVibration(iii ? 3 : 1));
    }
    if (events.some(e => e.type === 'ready')) sp.readyAt = t;
  }

  vibrate(pattern) {
    // 진동 끄기 설정(audio.haptics)과 미지원 기기를 따른다. III 패턴 [40,30,80] 은 설계값 그대로 보낸다.
    try {
      if (!audio.haptics || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
      if (typeof document !== 'undefined' && document.hidden) return false;
      return navigator.vibrate(pattern);
    } catch { return false; }
  }

  /** 릴 어디든 탭: 남은 릴 즉시 멈춤 → 선택 가능 상태(결과는 그대로). */
  skip() {
    const sp = this.spin; if (!sp || sp.skipAt !== null) return;
    sp.skipAt = Math.max(sp.last + 1e-4, (performance.now() - sp.t0) / 1000);
    // 다음 프레임을 기다리지 않고 바로 반영한다.
    this.stopLoop(false);
    this.frame(sp.t0 + sp.skipAt * 1000 + 0.5);
  }

  finish() {
    const sp = this.spin; if (!sp) return;
    this.stopLoop(false);
    this.lastRun = { frames: sp.frames, stopsAt: sp.stopsAt.slice(), readyAt: sp.readyAt, skipped: sp.skipAt !== null, skipAt: sp.skipAt, short: sp.plan.short, trace: sp.trace };
    this.spin = null;
    const q = this.quote();
    this.showCards(sp.candidates, q?.offer?.picked ?? -1);
    this.refresh();
  }

  pick(index) {
    const q = this.quote(); if (!q?.offer || q.offer.picked === index) return;
    const res = this.eco.blessingPick(index);
    if (!res?.ok) { this.notice('선택을 저장하지 못했습니다. 다시 눌러 주세요.', 'warn'); return; }
    audio.play(EVENT_SOUNDS.blessingPick, { vol: 0.85, vary: 0.02, priority: 4 });
    this.vibrate(15);
    this.confirmArmed = false; this.notice('');
    this.showCards(q.offer.candidates, index);
    this.refresh();
  }

  /** 원정 시작 직전 확인. 후보를 굴리고 아직 고르지 않았으면 창 안 띠로 한 번 묻는다. */
  confirmDeparture() {
    const q = this.quote(); if (!q) return true;
    if (this.spin) this.skip();
    if (q.offer && q.offer.picked < 0 && !q.held && !this.confirmArmed) {
      this.confirmArmed = true;
      this.notice('각인 없이 출발할까요? 원정 시작을 한 번 더 누르면 출발합니다.', 'ask');
      return false;
    }
    return true;
  }

  openOdds(trigger) {
    this.closeOdds?.();
    const host = this.dialog || this.el;
    this.closeOdds = openBlessingOdds(host, () => { this.closeOdds = null; trigger?.focus?.({ preventScroll: true }); });
  }

  stopLoop(clear = true) {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (clear && this.spin) {
      // 회전 중 창이 닫히면 결과는 이미 저장돼 있으므로 다시 열 때 멈춘 카드로 보인다.
      this.spin = null;
    }
  }

  dispose() { this.stopLoop(); this.closeOdds?.(); this.el.remove(); }
}

/** 원정 준비 창에 전운 칸을 붙인다. 경제에 전운 API 가 없으면(테스트 픽스처 등) 붙이지 않는다. */
export function mountBlessingSlot(app, dialog, after) {
  if (!after || typeof app?.eco?.blessingQuote !== 'function' || typeof document === 'undefined') return null;
  return new BlessingSlot(app, { dialog }).mount(after);
}
