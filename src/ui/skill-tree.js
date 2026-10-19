// 스킬 트리 화면(설계도 skill-tree-screen). 영웅 레벨로 받은 스킬 포인트(SP)로 스킬을 배우고 올리며, 잘못 찍으면 초기화한다.
// 로비 위에 뜨는 오버레이다. 상단 재화 바와 내비는 그대로 두고 그 사이 공간만 쓴다(패널 사이로 로비가 보인다).
// SP·습득·초기화는 Economy 계약(skillPoints/learnSkill/skillResetQuote/resetSkills)만 호출한다.
import { HEROES } from '../data/heroes.js';
import { SKILL_MAX_LV, spCostForLevel, skillRequiredLevel, spEarned, spSpent } from '../data/skill-tree.js';
import { gradeRules, heroGrade } from '../data/hero-grades.js';
import { audio } from '../engine/audio.js';
import './skill-tree.css';

// ------------------------------------------------------------------ 공용 오버레이 도우미(초월 화면도 쓴다)
export const el = (tag, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== '') e.textContent = text; return e; };
export const btn = (cls, text, label) => { const b = el('button', cls, text); b.type = 'button'; if (label) b.setAttribute('aria-label', label); return b; };
export const num = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR');
export const playSfx = (id, vol) => { try { audio.play(id, { vol }); } catch { /* 소리 실패가 화면을 막지 않는다 */ } };

/** 오버레이를 상단 바 아래, 내비 바깥에 맞춘다. 가로 레일(왼쪽)과 하단 알약 내비를 모두 지원한다. */
export function fitOverlay(root, columns = []) {
  const meta = document.getElementById?.('meta');
  const rect = (n) => (n && typeof n.getBoundingClientRect === 'function' ? n.getBoundingClientRect() : null);
  const top = rect(meta?.querySelector?.('.topbar')), nav = rect(meta?.querySelector?.('.bottomnav'));
  const H = typeof innerHeight === 'number' ? innerHeight : 0;
  const t = top && top.height > 0 ? top.bottom + 4 : 8;
  const railNav = !!nav && nav.width > 0 && nav.height > nav.width;
  const l = railNav ? nav.right + 6 : 8;
  const navLift = !railNav && nav && nav.height > 0 ? Math.max(0, H - nav.top + 6) : 0;
  root.style?.setProperty?.('--gx-top', t + 'px');
  root.style?.setProperty?.('--gx-left', l + 'px');
  // 하단 알약 내비와 가로로 겹치는 열만 내비 위로 올린다(시안: 가운데 패널만 짧고 양쪽 패널은 바닥까지).
  for (const col of columns) {
    col.style?.setProperty?.('--gx-lift', '0px');
    const r = rect(col);
    const overlap = navLift > 0 && !!r && r.right > nav.left && r.left < nav.right;
    col.style?.setProperty?.('--gx-lift', (overlap ? navLift : 0) + 'px');
  }
}

/** 로비 위 오버레이 한 장의 열기·닫기·포커스·내비 연동을 맡는다. */
export class GrowthOverlay {
  constructor(meta, kind, title) {
    this.meta = meta; this.kind = kind; this.title = title; this.root = null; this.columns = []; this.isOpen = false;
    this.onResize = () => { if (this.isOpen) this.fit(); };
  }
  get eco() { return this.meta.eco; }
  mount() {
    if (this.root) return this.root;
    const root = el('section', 'gx-layer ' + this.kind + '-layer'); root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', this.title);
    root.addEventListener?.('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault?.(); this.close(); } });
    const host = document.getElementById?.('meta') || document.body;
    host.append(root);
    // 내비·상단 바를 누르면 다른 화면으로 가므로 오버레이를 먼저 닫는다.
    host.addEventListener?.('click', (event) => {
      if (!this.isOpen || root.contains?.(event.target)) return;
      if (event.target?.closest?.('.bottomnav, .topbar')) this.close({ rerender: false, restoreFocus: false });
    }, true);
    this.eco.onChange?.(() => { if (this.isOpen) this.render(); });
    this.root = root; return root;
  }
  show(trigger) {
    this.mount(); this.trigger = trigger || document.activeElement || null;
    this.isOpen = true; this.root.hidden = false;
    document.getElementById?.('meta')?.classList?.add('gx-open');
    this.meta.app?.wardrobe?.hide?.();
    globalThis.addEventListener?.('resize', this.onResize);
    playSfx('ui_open', 0.45);
  }
  close({ rerender = true, restoreFocus = true } = {}) {
    if (!this.isOpen) return;
    this.isOpen = false; this.root.hidden = true;
    document.getElementById?.('meta')?.classList?.remove('gx-open');
    globalThis.removeEventListener?.('resize', this.onResize);
    playSfx('ui_close', 0.35);
    if (rerender && this.meta.tab === 'heroes') this.meta.renderHeroes?.();
    if (restoreFocus && this.trigger?.isConnected) this.trigger.focus?.({ preventScroll: true });
  }
  closeButton() { const b = btn('btn btn-ghost gx-close', '×', this.title + ' 닫기'); b.onclick = () => this.close(); return b; }
  fit() { if (this.root) fitOverlay(this.root, this.columns); }
}

// ------------------------------------------------------------------ 스킬 계산(표시용, 전투 Player 와 같은 식)
const lvOf = (v) => Math.max(0, Math.min(SKILL_MAX_LV, Math.floor(Number(v) || 0)));
/** 피해 배율: dmg × (1+(lv-1)×0.12) × 등급 skillMul — Player 와 같은 식. */
export const skillDamage = (skill, level, skillMul = 1) => (skill?.dmg || 0) * (1 + (Math.max(1, level) - 1) * 0.12) * skillMul;
/** 재사용 대기: cd × 등급 cdMul. 궁극기는 게이지로 쓰므로 null. */
export const skillCooldown = (skill, cdMul = 1) => (skill?.ult ? null : (skill?.cd || 0) * cdMul);
const fx = (v) => v.toFixed(1) + 'x';
const sec = (v) => v.toFixed(1) + '초';

export function heroSkillPoints(eco, id) {
  const r = typeof eco?.skillPoints === 'function' ? eco.skillPoints(id) : null;
  if (r && Number.isFinite(r.available)) return r;
  const def = HEROES[id], h = eco?.hero?.(id) || {}, earned = spEarned(h.level), spent = spSpent(def, h.skills);
  return { earned, spent, available: Math.max(0, earned - spent) };
}

/** 칸 하나의 상태. state: locked(레벨 미달) | ready(습득 가능) | unlearned(SP 부족) | learned | max */
export function skillCell(def, h, i, sp) {
  const skill = def.skills[i], level = lvOf(h?.skills?.[i]), need = skillRequiredLevel(skill), heroLv = h?.level || 1;
  const locked = heroLv < need, max = level >= SKILL_MAX_LV, cost = max ? 0 : spCostForLevel(skill, level + 1);
  const canUp = !locked && !max && sp.available >= cost;
  const state = locked ? 'locked' : max ? 'max' : level === 0 ? (canUp ? 'ready' : 'unlearned') : 'learned';
  const loadout = Array.isArray(h?.skillLoadout) ? h.skillLoadout : [4, 5];
  const slot = i >= 4 ? (loadout[0] === i ? 'Q' : loadout[1] === i ? 'E' : null) : null;
  return { i, skill, level, need, heroLv, locked, max, cost, canUp, state, slot, awaken: !!skill.unlock };
}

/** 오른쪽 상세 영역 숫자와 버튼 문구. */
export function skillDetail(def, h, i, sp) {
  const cell = skillCell(def, h, i, sp), rules = gradeRules(heroGrade(def, h)), { skill, level } = cell;
  const damage = { now: level >= 1 ? fx(skillDamage(skill, level, rules.skillMul)) : '미습득', next: cell.max ? null : fx(skillDamage(skill, level + 1, rules.skillMul)) };
  const cd = skillCooldown(skill, rules.cdMul);
  const cooldown = cd === null ? { now: '궁극기 게이지 100', next: null } : { now: sec(cd), next: cell.max ? null : sec(cd) };
  const action = cell.locked ? 'Lv.' + cell.need + '에 해금' : cell.max ? '최대 레벨' : (level === 0 ? '습득' : '강화') + ' (SP ' + cell.cost + ')';
  const reason = cell.locked ? '캐릭터 Lv.' + cell.need + ' 달성 시 습득할 수 있습니다 (현재 Lv.' + cell.heroLv + ')'
    : cell.max ? '최대 레벨에 도달했습니다'
    : !cell.canUp ? '스킬 포인트가 부족합니다 (필요 ' + cell.cost + ' · 보유 ' + sp.available + ')' : '';
  const kind = skill.ult ? '궁극기' : skill.unlock ? '각성' : '액티브';
  return { ...cell, damage, cooldown, action, reason, kind, grade: rules.id };
}

/** 칸을 스크린리더가 읽는 문장. 잠긴 칸은 이유를 함께 읽는다. */
export function cellLabel(cell) {
  const base = cell.skill.name;
  if (cell.state === 'locked') return base + ', 잠김, 캐릭터 Lv.' + cell.need + ' 필요';
  if (cell.state === 'ready') return base + ', 습득 가능, 스킬 포인트 ' + cell.cost;
  if (cell.state === 'unlearned') return base + ', 미습득, 스킬 포인트 ' + cell.cost + ' 필요';
  return base + ', Lv.' + cell.level + '/' + SKILL_MAX_LV + (cell.slot ? ', ' + cell.slot + ' 장착' : '');
}

const LEARN_FAIL = { level: (r) => '캐릭터 Lv.' + (r.need || '') + '에 해금됩니다', sp: () => '스킬 포인트가 부족합니다', max: () => '이미 최대 레벨입니다', storage: () => '저장하지 못해 스킬 포인트를 되돌렸습니다', skill: () => '스킬을 찾을 수 없습니다' };
const RESET_FAIL = { scroll: '스킬 초기화서가 없습니다', gems: '보석이 부족합니다', storage: '저장하지 못해 초기화를 취소했습니다' };

// ------------------------------------------------------------------ 화면
export class SkillTreeView extends GrowthOverlay {
  constructor(meta, { portrait } = {}) {
    super(meta, 'st', '스킬 트리');
    this.portrait = portrait || ((img, id) => { img.src = HEROES[id]?.portrait || ''; });
    this.heroId = null; this.sel = 0; this.focusKey = null; this.keys = new Map();
  }
  open(heroId = this.eco.s?.selected, index = 0, trigger) {
    if (!HEROES[heroId] || !this.eco.hero(heroId)) return false;
    this.heroId = heroId; this.sel = Number.isInteger(index) && HEROES[heroId].skills[index] ? index : 0; this.focusKey = 'cell-' + this.sel;
    this.show(trigger); this.render(); return true;
  }
  render() {
    if (!this.root || !this.heroId) return;
    const eco = this.eco, id = this.heroId, def = HEROES[id], h = eco.hero(id); if (!h) { this.close(); return; }
    const sp = heroSkillPoints(eco, id), keys = new Map();
    const key = (k, node) => { node.dataset.key = k; keys.set(k, node); return node; };
    this.root.replaceChildren();

    // ---- 왼쪽: 영웅 초상 · 이름/레벨 · SP 원 · 초기화
    const left = el('div', 'gx-col st-hero');
    const portrait = el('img', 'gx-portrait'); portrait.alt = ''; portrait.setAttribute('aria-hidden', 'true'); this.portrait(portrait, id);
    const card = el('div', 'gx-card st-hero-card');
    card.append(el('div', 'gx-ribbon', def.name + ' · Lv.' + (h.level || 1)));
    const ring = el('div', 'st-sp'); ring.setAttribute('role', 'status'); ring.setAttribute('aria-label', '남은 스킬 포인트 ' + sp.available);
    ring.append(el('small', '', 'SP'), el('b', 'st-sp-num', String(sp.available)));
    card.append(ring, el('p', 'st-sp-label', '남은 스킬 포인트'), this.resetButton(id, sp, key));
    left.append(portrait, card);

    // ---- 가운데: 기본 4 → 금색 화살표 → 각성 4
    const tree = el('div', 'gx-panel st-tree');
    const head = el('header', 'gx-head'); head.append(el('h2', 'gx-title', '스킬 트리'), this.closeButton());
    const grid = el('div', 'st-grid'); grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', '스킬 목록. 위는 기본 스킬, 아래는 레벨 관문 각성 스킬');
    const cells = def.skills.map((_, i) => skillCell(def, h, i, sp));
    const basics = cells.filter((c) => !c.awaken), awakens = cells.filter((c) => c.awaken);
    for (const c of basics) grid.append(this.cellNode(c, key));
    for (let n = 0; n < basics.length; n++) { const a = el('span', 'st-arrow' + (awakens[n] && !awakens[n].locked ? ' is-open' : '')); a.setAttribute('aria-hidden', 'true'); grid.append(a); }
    for (const c of awakens) grid.append(this.cellNode(c, key));
    tree.append(head, grid);

    // ---- 오른쪽: 선택 스킬 상세
    const d = skillDetail(def, h, this.sel, sp);
    const detail = el('div', 'gx-panel st-detail'); detail.setAttribute('aria-live', 'polite');
    const dh = el('div', 'st-detail-head'); const icon = el('span', 'st-icon st-icon-lg is-' + d.state); const img = el('img'); img.src = d.skill.icon; img.alt = ''; icon.append(img);
    if (d.locked) icon.append(el('i', 'st-lock'));
    const names = el('div', 'st-names'); names.append(el('h3', 'st-name', d.skill.name), el('p', 'st-lv', 'Lv ' + d.level + '/' + SKILL_MAX_LV), el('span', 'st-kind', d.kind));
    dh.append(icon, names);
    const stats = el('dl', 'st-stats');
    const row = (label, v) => { const dd = el('dd'); dd.append(el('span', 'st-now', v.now)); if (v.next) dd.append(el('span', 'st-to', '➜'), el('span', 'st-next', v.next)); dd.setAttribute('aria-label', label + ' ' + v.now + (v.next ? ', 다음 레벨 ' + v.next : '')); stats.append(el('dt', '', label), dd); };
    row('피해 배율', d.damage); row('재사용 대기시간', d.cooldown);
    const req = el('div', 'st-req'); req.append(el('h4', '', '필요 조건'));
    req.append(el('p', d.locked ? 'is-short' : 'is-met', '캐릭터 레벨 Lv.' + d.need + (d.locked ? ' (현재 Lv.' + d.heroLv + ')' : '')));
    req.append(el('p', d.max || d.locked || d.canUp ? 'is-met' : 'is-short', d.max ? '스킬 포인트 —' : '스킬 포인트 ' + d.cost + ' (보유 ' + sp.available + ')'));
    detail.append(dh, el('p', 'st-desc', d.skill.desc || ''), stats, req);
    if (d.awaken && d.level >= 1) detail.append(this.equipRow(d, key));
    const learn = key('learn', btn('btn btn-gold st-learn', d.action)); learn.disabled = !d.canUp;
    learn.onclick = () => this.learn(this.sel, 'learn');
    detail.append(learn);
    if (d.reason) { const why = el('p', 'st-reason', d.reason); why.id = 'st-reason'; learn.setAttribute('aria-describedby', 'st-reason'); detail.append(why); }

    this.root.append(left, tree, detail);
    this.columns = [left, tree, detail]; this.keys = keys;
    this.fit();
    const target = keys.get(this.focusKey);
    (target && !target.disabled ? target : keys.get('cell-' + this.sel))?.focus?.({ preventScroll: true });
  }
  cellNode(c, key) {
    const wrap = el('div', 'st-cell is-' + c.state + (c.i === this.sel ? ' is-selected' : '') + (c.awaken ? ' is-awaken' : ''));
    const icon = key('cell-' + c.i, btn('st-icon is-' + c.state, '', cellLabel(c)));
    icon.setAttribute('aria-pressed', String(c.i === this.sel));
    const img = el('img'); img.src = c.skill.icon; img.alt = ''; icon.append(img);
    if (c.state === 'locked') icon.append(el('i', 'st-lock'));
    if (c.slot) icon.append(el('b', 'st-slot', c.slot));
    icon.onclick = () => { this.sel = c.i; this.focusKey = 'cell-' + c.i; playSfx('ui_click', 0.35); this.render(); };
    const pill = el('div', 'st-pill');
    if (c.awaken && c.level === 0) { const gate = el('span', 'st-gate', c.state === 'ready' ? '습득 가능' : 'Lv.' + c.need); gate.setAttribute('aria-hidden', 'true'); pill.append(gate); }
    else {
      pill.append(el('span', 'st-count', c.level + '/' + SKILL_MAX_LV));
      const plus = key('plus-' + c.i, btn('st-plus', '+', c.skill.name + (c.level === 0 ? ' 습득' : ' 강화') + ', 스킬 포인트 ' + c.cost));
      plus.disabled = !c.canUp; plus.onclick = () => { this.sel = c.i; this.learn(c.i, 'plus-' + c.i); };
      pill.append(plus);
    }
    wrap.append(icon, pill);
    return wrap;
  }
  equipRow(d, key) {
    const row = el('div', 'st-equip'); row.append(el('span', '', '전투 슬롯'));
    for (const [slot, name] of [[0, 'Q'], [1, 'E']]) {
      const b = key('equip-' + name, btn('st-equip-btn' + (d.slot === name ? ' is-on' : ''), name, d.skill.name + ' ' + name + ' 슬롯에 장착'));
      b.setAttribute('aria-pressed', String(d.slot === name));
      b.onclick = () => {
        this.focusKey = 'equip-' + name;
        if (d.slot === name) return;
        if (this.eco.setSkillLoadout?.(this.heroId, slot, d.i)) { playSfx('ui_confirm', 0.5); this.meta.ui?.toast?.(name + ' · ' + d.skill.name + ' 장착', 'gold'); this.render(); }
        else this.meta.ui?.toast?.('습득한 각성 스킬만 장착할 수 있습니다', 'red');
      };
      row.append(b);
    }
    return row;
  }
  learn(i, focusKey) {
    const id = this.heroId, sk = HEROES[id].skills[i]; this.focusKey = focusKey;
    if (typeof this.eco.learnSkill !== 'function') { this.meta.ui?.toast?.('스킬 습득을 준비 중입니다', 'red'); return null; }
    const r = this.eco.learnSkill(id, i) || { ok: false, reason: 'storage' };
    if (r.ok) {
      this.meta.trackFunnel?.('upgrade', { kind: 'skill', level: r.level });
      playSfx('jingle_win1', 0.5); this.meta.ui?.toast?.(sk.name + (r.level === 1 ? ' 습득!' : ' Lv.' + r.level + '!'), 'gold');
    } else { playSfx('ui_error', 0.35); this.meta.ui?.toast?.((LEARN_FAIL[r.reason] || LEARN_FAIL.storage)(r), 'red'); }
    this.render(); return r;
  }
  resetButton(id, sp, key) {
    const q = typeof this.eco.skillResetQuote === 'function' ? this.eco.skillResetQuote(id) : null;
    const refund = q ? q.refund : sp.spent;
    const b = key('reset', btn('btn btn-ghost gx-outline st-reset', ''));
    const scroll = el('i', 'gx-scroll'); scroll.setAttribute('aria-hidden', 'true');
    const price = el('span', 'st-price');
    let say;
    if (!q) { price.textContent = '준비 중'; say = '준비 중'; }
    else if (q.free) { price.textContent = '무료'; say = '무료'; }
    else if (q.scrolls > 0) { price.textContent = '보유 ' + q.scrolls; say = '스킬 초기화서 1개 사용, 보유 ' + q.scrolls + '개'; }
    else { price.append(el('i', 'ic ic-gem'), el('span', '', num(q.gemPrice))); say = '보석 ' + num(q.gemPrice); }
    b.append(scroll, el('span', 'st-reset-name', '스킬 초기화'), price);
    b.disabled = !q || refund <= 0;
    b.setAttribute('aria-label', '스킬 초기화, ' + (refund > 0 ? '돌려받는 스킬 포인트 ' + refund + ', ' + say : '돌려받을 스킬 포인트가 없습니다'));
    b.onclick = () => this.reset();
    return b;
  }
  async reset() {
    const id = this.heroId, eco = this.eco, ui = this.meta.ui; this.focusKey = 'reset';
    const q = eco.skillResetQuote?.(id); if (!q || q.refund <= 0) return null;
    let useGems = false;
    const body = '사용한 스킬 포인트 ' + q.refund + '을(를) 모두 돌려받고 각성 스킬은 미습득으로 돌아갑니다.';
    if (q.free) { if (!await ui.confirm('스킬 초기화', body + '<br>Lv.20 미만이라 무료입니다.', { ok: '무료 초기화' })) return null; }
    else if (q.scrolls > 0) { if (!await ui.confirm('스킬 초기화', body + '<br>스킬 초기화서 1개를 사용합니다 (보유 ' + q.scrolls + '개).', { ok: '초기화서 사용' })) return null; }
    else if ((eco.s?.gems || 0) >= q.gemPrice) { if (!await ui.confirm('스킬 초기화서가 없습니다', body + '<br>보석 ' + num(q.gemPrice) + '개로 바로 초기화할 수 있습니다.', { ok: '보석 ' + num(q.gemPrice) + '개로 초기화' })) return null; useGems = true; }
    else { if (await ui.confirm('스킬 초기화서가 없습니다', '상점에서 스킬 초기화서를 구할 수 있습니다. (초기화서 1개 또는 보석 ' + num(q.gemPrice) + '개 필요)', { ok: '상점 보기' })) this.toShop(); return null; }
    const r = eco.resetSkills(id, { useGems }) || { ok: false, reason: 'storage' };
    if (r.ok) { playSfx('ui_confirm', 0.55); ui.toast?.('스킬 포인트 ' + r.refunded + '을(를) 돌려받았습니다', 'gold'); }
    else {
      playSfx('ui_error', 0.35); ui.toast?.(RESET_FAIL[r.reason] || RESET_FAIL.storage, 'red');
      if (r.reason === 'scroll' || r.reason === 'gems') { this.toShop(); return r; }
    }
    this.render(); return r;
  }
  // 스킬 초기화서는 상점 '강화' 탭에 있다(shop.js skill_reset1/5).
  toShop() { this.close({ rerender: false, restoreFocus: false }); this.meta.openTab?.('shop', 'enh'); }
}
