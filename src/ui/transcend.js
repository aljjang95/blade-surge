// 영웅 초월 화면(설계도 transcend-screen). SR → SSR → SSSR 결정, 초월 전후 능력치, 재료와 초월하기·초월 패키지.
// 숫자는 Economy 계약 eco.transcendQuote(heroId) 의 before/after(heroStats)만 쓰고, 실행은 eco.transcend 만 부른다.
import { HEROES } from '../data/heroes.js';
import { GRADE_ORDER, gradeRank } from '../data/hero-grades.js';
import { resourceArt } from './illustrated.js';
import { GrowthOverlay, el, btn, num, playSfx } from './skill-tree.js';
import './transcend.css';

const pct = (v) => Math.round(v * 100);
const up = (text) => '▲ ' + text;
/** 능력치 비교표의 행. before/after 는 heroStats. after 가 없으면(최고 등급) 다음 값과 증가폭을 비운다. */
export function transcendRows(before, after) {
  const rows = [
    { key: 'atk', label: '공격력', now: num(before.atk), next: after && num(after.atk), delta: after && up(Math.round((after.atk / Math.max(1, before.atk) - 1) * 100) + '%') },
    { key: 'hp', label: '체력', now: num(before.hp), next: after && num(after.hp), delta: after && up(Math.round((after.hp / Math.max(1, before.hp) - 1) * 100) + '%') },
    { key: 'skill', label: '스킬 피해', now: pct(before.skillMul) + '%', next: after && pct(after.skillMul) + '%', delta: after && up(pct(after.skillMul) - pct(before.skillMul) + '%p') },
    { key: 'cd', label: '재사용 대기', now: '-' + pct(1 - before.cdMul) + '%', next: after && '-' + pct(1 - after.cdMul) + '%', delta: after && up(pct(before.cdMul) - pct(after.cdMul) + '%p') },
    { key: 'ult', label: '궁극기 충전', now: String(pct(before.ultGain)), next: after && String(pct(after.ultGain)), delta: after && up(Math.round((after.ultGain / Math.max(0.01, before.ultGain) - 1) * 100) + '%') },
  ];
  return rows.map((r) => ({ ...r, next: r.next || null, delta: r.delta || null }));
}
/** 재료 행: 보유 / 필요, 부족 여부. */
export function transcendMaterials(q) {
  const have = q.have || {}, cost = q.cost;
  return [
    { key: 'shards', label: '영웅 조각', have: have.shards || 0, need: cost ? cost.shards : null },
    { key: 'transcendStones', label: '초월석', have: have.transcendStones || 0, need: cost ? cost.transcendStones : null },
    { key: 'gold', label: '골드', have: have.gold || 0, need: cost ? cost.gold : null },
  ].map((m) => ({ ...m, short: m.need !== null && m.have < m.need }));
}
const FAIL = { max: '이미 최고 등급입니다', shards: '영웅 조각이 부족합니다', stones: '초월석이 부족합니다', gold: '골드가 부족합니다', storage: '저장하지 못해 초월을 취소했습니다' };

export class TranscendView extends GrowthOverlay {
  constructor(meta, { portrait } = {}) {
    super(meta, 'tc', '영웅 초월');
    this.portrait = portrait || ((img, id) => { img.src = HEROES[id]?.portrait || ''; });
    this.heroId = null; this.focusKey = 'go'; this.keys = new Map();
  }
  open(heroId = this.eco.s?.selected, trigger) {
    if (!HEROES[heroId] || !this.eco.hero(heroId)) return false;
    this.heroId = heroId; this.focusKey = 'go'; this.show(trigger); this.render(); return true;
  }
  quote() { return typeof this.eco.transcendQuote === 'function' ? this.eco.transcendQuote(this.heroId) : null; }
  render() {
    if (!this.root || !this.heroId) return;
    const id = this.heroId, def = HEROES[id], q = this.quote(), keys = new Map();
    const key = (k, node) => { node.dataset.key = k; keys.set(k, node); return node; };
    this.root.replaceChildren();
    if (!q || !q.before) {
      const box = el('div', 'gx-panel tc-empty'); const head = el('header', 'gx-head'); head.append(el('h2', 'gx-title', '영웅 초월'), this.closeButton());
      box.append(head, el('p', '', '초월 정보를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.'));
      this.root.append(box); this.columns = [box]; this.keys = keys; this.fit(); return;
    }
    // ---- 왼쪽: 초월 전후 능력치 비교
    const stats = el('div', 'gx-panel tc-stats');
    const sh = el('header', 'gx-head'); sh.append(el('h2', 'gx-title', '초월 전후 능력치 비교')); stats.append(sh);
    const table = el('table', 'tc-table'); table.append(el('caption', 'tc-sr', def.name + ' ' + q.grade + (q.next ? ' → ' + q.next : ' 최고 등급') + ' 능력치'));
    const thead = el('thead'), hr = el('tr');
    for (const [t, c] of [['', 'tc-th-label'], ['현재', ''], ['', 'tc-th-arrow'], ['초월 후', 'tc-after'], ['', '']]) { const th = el('th', c, t); th.setAttribute('scope', 'col'); hr.append(th); }
    thead.append(hr); table.append(thead);
    const tbody = el('tbody');
    for (const r of transcendRows(q.before, q.after)) {
      const tr = el('tr', 'tc-row tc-row-' + r.key);
      const th = el('th', 'tc-label'); th.setAttribute('scope', 'row'); th.append(el('i', 'tc-ico tc-ico-' + r.key), el('span', '', r.label));
      const arrow = el('td', 'tc-arrow', r.next ? '›' : ''); arrow.setAttribute('aria-hidden', 'true');
      tr.append(th, el('td', 'tc-now', r.now), arrow, el('td', 'tc-next', r.next || '—'), el('td', 'tc-delta', r.delta || ''));
      tbody.append(tr);
    }
    table.append(tbody); stats.append(table);

    // ---- 가운데: SR → SSR → SSSR 결정과 제단 위 영웅
    const center = el('div', 'gx-col tc-center');
    const crystals = el('div', 'tc-crystals'); crystals.setAttribute('role', 'img');
    crystals.setAttribute('aria-label', '등급 단계 SR, SSR, SSSR. 현재 ' + q.grade + (q.next ? ', 다음 ' + q.next : ', 최고 등급'));
    const cur = gradeRank(q.grade);
    GRADE_ORDER.forEach((g, i) => {
      if (i > 0) { const a = el('span', 'tc-chev' + (i <= cur + 1 ? ' is-lit' : ''), '»'); a.setAttribute('aria-hidden', 'true'); crystals.append(a); }
      const state = i < cur ? 'is-past' : i === cur ? 'is-current' : i === cur + 1 ? 'is-next' : 'is-future';
      const c = el('div', 'tc-gem-wrap ' + state); c.dataset.grade = g; c.setAttribute('aria-hidden', 'true');
      c.append(el('i', 'tc-gem tc-gem-' + g), el('b', 'tc-plinth', g));
      crystals.append(c);
    });
    const hero = el('div', 'tc-hero'); const img = el('img', 'gx-portrait'); img.alt = ''; img.setAttribute('aria-hidden', 'true');
    const portraits = [[img, id]];
    hero.append(el('i', 'tc-altar'), img);
    center.append(crystals, hero);

    // ---- 오른쪽: 재료 · 초월하기 · 초월 패키지
    const mats = el('div', 'gx-panel tc-mats');
    const mh = el('header', 'gx-head'); mh.append(el('h2', 'gx-title', '초월에 필요한 재료'), this.closeButton()); mats.append(mh);
    const list = el('ul', 'tc-mat-list'), materials = transcendMaterials(q);
    for (const m of materials) {
      const li = el('li', 'tc-mat' + (m.short ? ' is-short' : ''));
      let icon;
      if (m.key === 'shards') { icon = el('img', 'tc-mat-ico tc-mat-hero'); portraits.push([icon, id]); }
      else if (m.key === 'gold') { icon = el('img', 'tc-mat-ico'); icon.src = resourceArt('gold'); }
      else icon = el('i', 'tc-mat-ico tc-gem tc-gem-stone');
      icon.alt = ''; icon.setAttribute('aria-hidden', 'true');
      const amount = el('span', 'tc-amount');
      if (m.key === 'gold') amount.append(el('b', m.short ? 'is-short' : '', num(m.need === null ? m.have : m.need)));
      else { amount.append(el('b', m.short ? 'is-short' : '', num(m.have))); if (m.need !== null) amount.append(el('span', '', ' / ' + num(m.need))); }
      li.setAttribute('aria-label', m.label + ' 보유 ' + num(m.have) + (m.need !== null ? ', 필요 ' + num(m.need) : '') + (m.short ? ', 부족' : ''));
      li.append(icon, el('span', 'tc-mat-name', m.label), amount);
      list.append(li);
    }
    mats.append(list);
    const go = key('go', btn('btn btn-red tc-go', q.next ? '초월하기' : '최고 등급'));
    go.disabled = !q.next || !q.ok || typeof this.eco.transcend !== 'function';
    if (q.next) go.setAttribute('aria-label', '초월하기, ' + q.grade + '에서 ' + q.next + '로' + (q.ok ? '' : ', 재료 부족'));
    go.onclick = () => this.transcend();
    const pack = key('pack', btn('btn btn-ghost gx-outline tc-pack', '', '초월 패키지, 상점 패키지 탭으로 이동'));
    pack.append(el('span', 'tc-pack-name', '초월 패키지'), el('span', 'tc-pack-go', '›'));
    pack.onclick = () => this.toPackage();
    mats.append(go, pack);
    if (q.next && !q.ok) {
      const short = materials.filter((m) => m.short).map((m) => m.label).join(', ');
      const why = el('p', 'tc-reason', (short || '재료') + ' 부족 · 초월 패키지나 소환으로 모을 수 있습니다'); why.id = 'tc-reason'; go.setAttribute('aria-describedby', 'tc-reason'); mats.append(why);
    }

    this.root.append(stats, center, mats);
    this.columns = [stats, center, mats]; this.keys = keys;
    this.bindPortraits(portraits);
    this.fit();
    const target = keys.get(this.focusKey);
    (target && !target.disabled ? target : keys.get('pack'))?.focus?.({ preventScroll: true });
  }
  async transcend() {
    const id = this.heroId, def = HEROES[id], q = this.quote(), ui = this.meta.ui; this.focusKey = 'go';
    if (!q?.next || !q.ok || typeof this.eco.transcend !== 'function') return null;
    const body = def.name + '을(를) ' + q.grade + ' → ' + q.next + '로 초월합니다.<br>영웅 조각 ' + num(q.cost.shards) + ' · 초월석 ' + num(q.cost.transcendStones) + ' · 골드 ' + num(q.cost.gold) + '을(를) 사용합니다.';
    if (!await ui.confirm('영웅 초월', body, { ok: '초월하기', okCls: 'btn-red' })) return null;
    const r = this.eco.transcend(id) || { ok: false, reason: 'storage' };
    if (r.ok) {
      this.meta.trackFunnel?.('upgrade', { kind: 'hero_grade', grade: r.grade });
      playSfx('jingle_legend', 0.7); ui.toast?.(def.name + ' ' + r.grade + ' 초월 성공!', 'gold');
    } else {
      playSfx('ui_error', 0.35); ui.toast?.(FAIL[r.reason] || FAIL.storage, 'red');
      if (r.reason === 'gold') this.meta.offerGold?.();
    }
    this.render(); return r;
  }
  toPackage() { this.close({ rerender: false, restoreFocus: false }); this.meta.openTab?.('shop', 'pack'); }
}
