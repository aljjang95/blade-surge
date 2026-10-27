// 전설 수련 판(영웅 Lv.80 이후 끝없는 성장 축, docs/SPEC_720H.md 3.1). 영웅 화면의 '전설 수련' 버튼으로 여는 로비 위 오버레이다.
// 규칙은 모두 Economy(legendState/legendAllocate/legendRespec/legendRespecCost)와 legend-rank.js 가 맡고, 이 화면은 순수 모델(game/legend-ui-model.js)이 만든 값을 그리기만 한다.
// 점수 재분배는 골드가 들므로 앱 안 확인창(ui.confirm)을 거친다(confirm() 금지).
import { HEROES } from '../data/heroes.js';
import { legendBoard } from '../game/legend-ui-model.js';
import { LEGEND_NODES } from '../game/legend-rank.js';
import { GrowthOverlay, el, btn, num, playSfx } from './skill-tree.js';
import { maxHeroLevel } from './legend-pane.js';
import './legend-rank.css';

const ALLOC_FAIL = { points: '남은 점수가 부족합니다', max: '이 노드는 최대 단계입니다', node: '알 수 없는 노드입니다', amount: '찍을 수 있는 점수가 아닙니다', state: '저장 상태를 읽지 못했습니다', storage: '저장하지 못해 되돌렸습니다' };
const RESPEC_FAIL = { empty: '되돌릴 점수가 없습니다', gold: '골드가 부족합니다', state: '저장 상태를 읽지 못했습니다', storage: '저장하지 못해 재분배를 취소했습니다' };

export class LegendView extends GrowthOverlay {
  constructor(meta) {
    super(meta, 'lg', '전설 수련');
    this.branch = 'blade'; this.nodeId = null; this.focusKey = null; this.keys = new Map(); this.model = null;
  }
  /** 가설 전설 상태에서의 출전 영웅 전투력(저장·이벤트 없이 잠시 바꿨다가 되돌린다). */
  powerWith(state) {
    const eco = this.eco, id = eco.s.selected, saved = eco.s.legend;
    try { eco.s.legend = state; const p = eco.heroPower(id); return Number.isFinite(p) ? p : null; } catch { return null; } finally { eco.s.legend = saved; }
  }
  /** 미리보기는 지금 보는 갈래의 선택 노드(없으면 첫 노드) 하나만 계산한다. */
  selectedNodeId() {
    const nodes = LEGEND_NODES.filter((n) => n.branch === this.branch);
    return (nodes.find((n) => n.id === this.nodeId) || nodes[0])?.id || null;
  }
  readModel() { return legendBoard(this.eco.legendState(), { maxHeroLevel: maxHeroLevel(this.eco), gold: this.eco.s.gold, selectedNodeId: this.selectedNodeId(), power: (state) => this.powerWith(state) }); }
  open(trigger) {
    const model = this.readModel(); this.model = model;
    const spentBranch = model.branches.find((b) => b.spent > 0) || model.branches[0];
    if (!model.branches.some((b) => b.id === this.branch)) this.branch = spentBranch.id;
    this.nodeId = null; this.focusKey = 'tab-' + this.branch;
    this.show(trigger); this.render(); return true;
  }
  currentBranch(model) { return model.branches.find((b) => b.id === this.branch) || model.branches[0]; }
  currentNode(branch) { return branch.nodes.find((n) => n.id === this.nodeId) || branch.nodes[0]; }

  render() {
    if (!this.root) return;
    this.setShowcaseHidden(true);
    const model = this.model = this.readModel(), keys = new Map();
    const key = (k, node) => { node.dataset.key = k; keys.set(k, node); return node; };
    const branch = this.currentBranch(model), node = this.currentNode(branch); this.branch = branch.id; this.nodeId = node.id;
    const hero = HEROES[this.eco.s.selected];
    this.root.replaceChildren();
    this.root.dataset.locked = String(model.locked);

    // ---- 왼쪽: 단계 · EXP · 남은 점수 · 재분배
    const left = el('div', 'gx-col lg-summary');
    const card = el('div', 'gx-card lg-card');
    card.append(el('div', 'gx-ribbon', '전설 수련'));
    const rank = el('div', 'lg-rank'); rank.setAttribute('role', 'status'); rank.setAttribute('aria-label', '전설 ' + num(model.rank) + '단계');
    rank.append(el('small', '', '전설'), el('b', 'lg-rank-num', num(model.rank)), el('small', '', '단계'));
    const exp = el('div', 'lg-exp'); const bar = el('progress', 'lg-exp-bar'); bar.max = Math.max(1, model.need); bar.value = Math.min(model.exp, model.need);
    bar.setAttribute('aria-label', '다음 단계까지 경험치 ' + model.expText);
    exp.append(bar, el('span', 'lg-exp-text', model.expText + ' · ' + model.pct + '%'));
    const points = el('div', 'lg-points'); points.setAttribute('role', 'status'); points.setAttribute('aria-label', '남은 전설 점수 ' + model.points);
    points.append(el('small', '', '남은 점수'), el('b', 'lg-points-num', String(model.points)));
    card.append(rank, exp, points);
    const respec = key('respec', btn('btn btn-ghost gx-outline lg-respec', ''));
    const cost = el('span', 'st-price lg-cost'); cost.append(el('i', 'ic ic-gold'), el('span', '', num(model.respec.cost)));
    respec.append(el('span', 'lg-respec-name', '재분배'), model.respec.spent > 0 ? cost : el('span', 'lg-cost-none', '찍은 점수 없음'));
    respec.disabled = !model.respec.enabled;
    respec.setAttribute('aria-label', '점수 재분배, ' + (model.respec.spent > 0 ? '돌려받는 점수 ' + model.respec.spent + ', 골드 ' + num(model.respec.cost) : model.respec.reason));
    respec.onclick = () => this.respec();
    card.append(respec);
    if (model.respec.spent > 0 && model.respec.reason) { const why = el('p', 'lg-reason is-short', model.respec.reason); why.id = 'lg-respec-reason'; respec.setAttribute('aria-describedby', 'lg-respec-reason'); card.append(why); }
    if (model.locked) { const lock = el('p', 'lg-lock', model.lockReason); lock.setAttribute('role', 'note'); card.append(lock); }
    card.append(el('p', 'lg-next-keystone', model.upcomingText));
    left.append(card);

    // ---- 가운데: 갈래 탭 + 노드 그리드
    const board = el('div', 'gx-panel lg-board');
    const head = el('header', 'gx-head'); head.append(el('h2', 'gx-title', '전설 수련 판'), this.closeButton());
    const tabs = el('div', 'lg-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '갈래');
    for (const b of model.branches) {
      const tab = key('tab-' + b.id, btn('lg-tab' + (b.id === branch.id ? ' is-on' : ''), '', b.name + ' ' + b.spent + '점'));
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(b.id === branch.id)); tab.tabIndex = b.id === branch.id ? 0 : -1; tab.dataset.branch = b.id;
      tab.append(el('b', 'lg-tab-name', b.name), el('small', 'lg-tab-sub', b.spent + '점'));
      tab.onclick = () => { this.branch = b.id; this.nodeId = null; this.focusKey = 'tab-' + b.id; playSfx('ui_click', 0.35); this.render(); };
      tab.onkeydown = (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault(); const i = model.branches.findIndex((x) => x.id === b.id), next = model.branches[(i + (event.key === 'ArrowRight' ? 1 : model.branches.length - 1)) % model.branches.length];
        this.branch = next.id; this.nodeId = null; this.focusKey = 'tab-' + next.id; this.render();
      };
      tabs.append(tab);
    }
    const sub = el('p', 'lg-branch-sub'); sub.append(el('b', '', branch.tagline), el('span', '', ' · 키스톤 ' + branch.openKeystones + '/' + branch.keystones.length));
    const grid = el('div', 'lg-grid'); grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', branch.name + ' 노드');
    for (const n of branch.nodes) grid.append(this.nodeCell(n, node, key));
    board.append(head, tabs, sub, grid);

    // ---- 오른쪽: 선택 노드 상세 · 찍기 · 키스톤
    const detail = el('div', 'gx-panel lg-detail'); detail.setAttribute('aria-live', 'polite');
    const dh = el('div', 'lg-detail-head'); dh.append(el('h3', 'lg-node-name', node.name), el('span', 'lg-node-lv', 'Lv ' + node.level + '/' + node.max));
    const rows = el('dl', 'lg-rows');
    const row = (label, now, next, delta) => { const dd = el('dd'); dd.append(el('span', 'st-now', now)); if (next) dd.append(el('span', 'st-to', '➜'), el('span', 'st-next', next), ...(delta ? [el('span', 'lg-delta', delta)] : [])); dd.setAttribute('aria-label', label + ' ' + now + (next ? ', 다음 점수 ' + next : '')); rows.append(el('dt', '', label), dd); };
    row(node.statLabel, node.valueText, node.maxed ? '' : node.nextText, node.deltaText);
    detail.append(dh, rows);
    if (node.capText) detail.append(el('p', 'lg-cap', node.capText));
    if (hero && (node.previewOne || node.previewFive)) {
      const p = node.previewFive || node.previewOne, n = node.previewFive ? 5 : 1;
      detail.append(el('p', 'lg-power', '전투력 ' + num(p.before) + ' ➜ ' + num(p.after) + (p.delta ? ' (' + (p.delta > 0 ? '+' : '') + num(p.delta) + ')' : '') + ' · +' + n + '점'));
    }
    const acts = el('div', 'lg-acts'); acts.setAttribute('role', 'group'); acts.setAttribute('aria-label', node.name + ' 점수 찍기');
    const add = (k, label, n, enabled) => { const b = key(k, btn('btn btn-gold lg-add', label, node.name + ' ' + n + '점 찍기')); b.disabled = !enabled; b.onclick = () => this.allocate(node, n, k); acts.append(b); return b; };
    add('add1', '+1', 1, node.canOne); add('add5', '+5', 5, node.canFive);
    const maxButton = add('addmax', '최대', node.maxN, node.canMax);
    if (node.canMax) maxButton.append(el('small', 'lg-add-sub', '+' + node.maxN));
    detail.append(acts);
    const why = model.locked ? model.lockReason : node.reason;
    if (why) { const p = el('p', 'lg-reason is-short', why); p.id = 'lg-reason'; acts.setAttribute('aria-describedby', 'lg-reason'); detail.append(p); }
    // 키스톤: 이 갈래의 5개. 열린 것은 효과 설명, 닫힌 것은 열리는 단계와 남은 단계.
    const ks = el('section', 'lg-keystones'); ks.setAttribute('aria-label', branch.name + ' 키스톤');
    ks.append(el('h4', '', branch.name + ' 키스톤 ' + branch.openKeystones + '/' + branch.keystones.length));
    const list = el('ul', 'lg-ks-list');
    for (const k of branch.keystones) {
      const li = el('li', 'lg-ks' + (k.open ? ' is-open' : '')); li.dataset.keystone = k.id;
      const state = k.open ? '열림' : k.remaining + '단계 남음';
      li.setAttribute('aria-label', k.name + ', ' + k.unlockRank + '단계 키스톤, ' + (k.open ? '열림. ' + k.effect : '아직 닫힘, ' + state));
      li.append(el('b', 'lg-ks-name', k.name), el('span', 'lg-ks-rank', k.unlockRank + '단계 · ' + state), el('span', 'lg-ks-effect', k.effect));
      list.append(li);
    }
    ks.append(list); detail.append(ks);

    this.root.append(left, board, detail);
    this.columns = [left, board, detail]; this.keys = keys;
    this.fit();
    const target = keys.get(this.focusKey);
    (target && !target.disabled ? target : keys.get('tab-' + branch.id))?.focus?.({ preventScroll: true });
  }

  nodeCell(n, selected, key) {
    const cell = key('node-' + n.id, btn('lg-node' + (n.id === selected.id ? ' is-selected' : '') + (n.level > 0 ? ' has-points' : '') + (n.maxed ? ' is-max' : ''), '', n.name + ', ' + n.level + '단계 중 ' + n.max + ', ' + n.statLabel + ' ' + n.valueText));
    cell.setAttribute('aria-pressed', String(n.id === selected.id)); cell.dataset.node = n.id;
    const bar = el('i', 'lg-node-bar'); const fill = el('u'); fill.style.width = Math.round(n.level / n.max * 100) + '%'; bar.append(fill);
    cell.append(el('b', 'lg-node-title', n.name), el('span', 'lg-node-level', n.level + '/' + n.max), bar,
      el('span', 'lg-node-value', n.level > 0 ? n.valueText : '1점 ' + n.nextText), el('small', 'lg-node-stat', n.statLabel));
    cell.onclick = () => { this.nodeId = n.id; this.focusKey = 'node-' + n.id; playSfx('ui_click', 0.35); this.render(); };
    return cell;
  }

  allocate(node, n, focusKey) {
    this.focusKey = focusKey;
    const res = this.eco.legendAllocate(node.id, n) || { ok: false, error: 'storage' };
    if (res.ok) { playSfx('jingle_win1', 0.4); this.meta.ui?.toast?.(node.name + ' Lv.' + res.level + ' (+' + n + ')', 'gold'); }
    else { playSfx('ui_error', 0.35); this.meta.ui?.toast?.(ALLOC_FAIL[res.error] || ALLOC_FAIL.storage, 'red'); }
    this.render(); return res;
  }

  async respec() {
    const ui = this.meta.ui, eco = this.eco; this.focusKey = 'respec';
    const model = this.model || this.readModel(), r = model.respec;
    if (!r.enabled) return null;
    if (!r.canAfford) { ui.toast?.(r.reason, 'red'); playSfx('ui_error', 0.35); return null; }
    const body = '찍은 전설 점수 ' + r.spent + '점을 모두 되돌려 받습니다.<br>골드 ' + num(r.cost) + '이(가) 듭니다 (보유 ' + num(eco.s.gold) + ').';
    if (!await ui.confirm('점수 재분배', body, { ok: '재분배 · 골드 ' + num(r.cost), okCls: 'btn-red' })) { this.render(); return null; }
    const res = eco.legendRespec() || { ok: false, error: 'storage' };
    if (res.ok) { playSfx('ui_confirm', 0.55); ui.toast?.('점수 ' + res.refunded + '점을 돌려받았습니다 (골드 -' + num(res.cost) + ')', 'gold'); }
    else { playSfx('ui_error', 0.35); ui.toast?.(RESPEC_FAIL[res.error] || RESPEC_FAIL.storage, 'red'); }
    this.render(); return res;
  }
}
