// 현상금 의뢰판 화면(docs/BOUNTY_BOARD.md). 허브/메뉴의 모달이며 전투 화면 위에는 열리지 않는다.
// 규칙은 eco.bounties()/startBounty()/buyBounty() 가 정본이고 여기서는 보여 주고 출발만 시킨다.
import { audio } from '../engine/audio.js';
import { HUNTER_TITLES, BOUNTY_SHOP } from '../data/bounties.js';
import './journey.css';
import './bounty.css';

const node = (tag, cls = '', text = '') => { const e = document.createElement(tag); e.className = cls; e.textContent = text; return e; };
const fmt = (v) => Math.round(v || 0).toLocaleString('ko-KR');
const button = (text, fn, key, cls = 'journey-action') => { const e = node('button', cls, text); e.type = 'button'; e.dataset.control = key; e.addEventListener('click', fn); return e; };
const WHY = { locked: '아직 열리지 않은 의뢰입니다.', done: '이미 끝낸 의뢰입니다.', unknown: '의뢰를 다시 확인해 주세요.', marks: '증표가 모자랍니다.', rank: '사냥꾼 등급이 모자랍니다.', weekly: '이번 주 구매 한도입니다.', owned: '이미 가지고 있습니다.' };

export class BountyView {
  constructor(app) {
    this.app = app; this.tab = 'board';
    this.dialog = node('dialog', 'journey-dialog bounty-dialog'); this.dialog.id = 'bounty'; this.dialog.setAttribute('aria-labelledby', 'bounty-title');
    const header = node('header', 'journey-header'), title = node('div');
    title.append(node('small', 'journey-eyebrow', '에너지 없이 받는 고유 의뢰'));
    const h = node('h2', '', '현상금 의뢰판'); h.id = 'bounty-title'; title.append(h);
    header.append(title, button('닫기', () => this.close(), 'close', 'journey-close'));
    this.nav = node('nav', 'journey-tabs bounty-tabs'); this.nav.setAttribute('aria-label', '현상금 메뉴');
    for (const [id, label] of [['board', '의뢰판'], ['shop', '현상금 상인']]) this.nav.append(button(label, () => { this.tab = id; this.render(); }, `tab-${id}`, ''));
    this.notice = node('p', 'journey-notice'); this.notice.setAttribute('role', 'status');
    this.content = node('div', 'journey-content');
    this.dialog.append(header, this.nav, this.notice, this.content); document.body.append(this.dialog);
    this.dialog.addEventListener('cancel', (e) => { e.preventDefault(); this.close(); });
    this.dialog.addEventListener('close', () => { if (this.trigger?.isConnected) this.trigger.focus({ preventScroll: true }); });
    app.eco.onChange(() => { if (this.dialog.open) this.render(); });
  }
  get blocked() { return !!(this.app.battle?.active || this.app.stageStarting); }
  open(tab = 'board') {
    if (this.blocked || this.app.mode === 'boot') return false;
    this.tab = tab === 'shop' ? 'shop' : 'board'; if (!this.dialog.open) this.trigger = document.activeElement;
    this.notice.textContent = ''; this.render();
    if (!this.dialog.open) this.dialog.showModal();
    return true;
  }
  close() { if (this.dialog.open) this.dialog.close(); }
  render() {
    const sum = this.app.eco.bountySummary();
    for (const b of this.nav.children) b.setAttribute('aria-pressed', String(b.dataset.control === `tab-${this.tab}`));
    this.content.replaceChildren(this.hunterCard(sum));
    if (!sum.open) { this.content.append(node('p', 'journey-muted', '1장 지역 보스(1-10)를 클리어하면 의뢰판이 열립니다.')); return; }
    this.content.append(this.tab === 'shop' ? this.shopList() : this.boardList(sum));
  }
  hunterCard(sum) {
    const st = this.app.eco.s.bounty, card = node('section', 'journey-card bounty-hunter');
    const titleId = (st?.titles || []).slice(-1)[0], title = HUNTER_TITLES.find((t) => t.id === titleId);
    const top = node('div', 'bounty-hunter-top');
    top.append(node('b', 'bounty-rank', `사냥꾼 ${sum.rank}등급`), node('span', 'bounty-title', title ? title.name : '칭호 없음'), node('span', 'bounty-marks', `증표 ${fmt(sum.marks)}`));
    const bar = document.createElement('progress'); bar.max = Math.max(1, sum.need); bar.value = sum.need ? sum.xp : 1; bar.setAttribute('aria-label', '사냥꾼 경험치');
    // 산 깃발은 사냥꾼 카드에 걸린다(표시 전용 장식).
    const flags = BOUNTY_SHOP.filter((x) => x.grant.cosmetic && (st?.owned || []).includes(x.grant.cosmetic));
    if (flags.length) { const row = node('div', 'bounty-flags'); for (const f of flags) row.append(node('span', `bounty-flag ${f.grant.cosmetic}`, f.name.replace('사냥꾼 깃발: ', '🚩 '))); top.append(row); }
    card.append(top, bar, node('small', 'journey-muted', sum.need ? `다음 등급까지 ${fmt(sum.need - sum.xp)} · 완료한 의뢰 ${fmt(sum.completed)}건` : `최고 등급 · 완료한 의뢰 ${fmt(sum.completed)}건`));
    return card;
  }
  boardList(sum) {
    const wrap = node('div', 'bounty-list'), list = this.app.eco.bounties(8);
    if (!list.length) { wrap.append(node('p', 'journey-muted', '지금 받을 수 있는 의뢰를 모두 끝냈습니다. 더 높은 난이도로 관문을 클리어하면 새 의뢰가 열립니다.')); return wrap; }
    wrap.append(node('p', 'journey-muted', `받을 수 있는 의뢰 ${sum.available}건 · 에너지 소모 없음, 한 번만 받을 수 있습니다.`));
    for (const d of list) {
      const row = node('article', `journey-card bounty-row tier-${d.tier}`); row.dataset.bounty = d.id;
      const head = node('div', 'bounty-row-head');
      head.append(node('span', 'bounty-tier', d.tierName), node('b', 'bounty-stage', d.key), node('span', 'bounty-kind', d.kindName), node('span', 'bounty-min', `약 ${d.minutes}분`));
      const rw = node('div', 'bounty-rewards');
      rw.append(node('span', '', `골드 ${fmt(d.rewards.gold)}`), node('span', '', `증표 ${d.rewards.marks}`), node('span', '', `사냥꾼 경험치 ${d.rewards.xp}`));
      row.append(head, node('p', 'bounty-cond', d.trial ? `조건 · ${d.trial.label}` : d.description), rw,
        button('출발', () => this.go(d.id), `go-${d.id}`, 'journey-action bounty-go'));
      wrap.append(row);
    }
    return wrap;
  }
  shopList() {
    const wrap = node('div', 'bounty-list');
    for (const it of this.app.eco.bountyShop()) {
      const row = node('article', 'journey-card bounty-row'); row.dataset.item = it.id;
      const head = node('div', 'bounty-row-head'); head.append(node('b', 'bounty-stage', it.name), node('span', 'bounty-min', `증표 ${it.cost}`));
      const sub = it.soldOut ? '구매 완료' : it.locked ? `${it.locked} 필요` : it.weekly ? `이번 주 ${it.weekly - it.bought}회 남음` : '1회 구매';
      const b = button(it.soldOut ? '구매 완료' : '교환', () => this.buy(it.id), `buy-${it.id}`, 'journey-action bounty-go'); b.disabled = !it.canBuy;
      row.append(head, node('p', 'bounty-cond', sub), b); wrap.append(row);
    }
    wrap.append(node('p', 'journey-muted', '고정가 교환입니다. 유료·무작위 요소는 없습니다.'));
    return wrap;
  }
  buy(id) {
    const r = this.app.eco.buyBounty(id);
    this.notice.textContent = r.ok ? `${r.item.name} 교환 완료${r.saveError ? ' (저장 실패: 저장 공간을 확인해 주세요)' : ''}` : (WHY[r.reason] || '교환할 수 없습니다.');
    if (r.ok) audio.play('ui_glass', { vol: .4 });
    this.render();
  }
  async go(id) {
    if (this.blocked) { this.notice.textContent = '전투를 마친 뒤 출발할 수 있습니다.'; return false; }
    const check = this.app.eco.startBounty(id);
    if (!check.ok) { this.notice.textContent = WHY[check.reason] || '받을 수 없는 의뢰입니다.'; return false; }
    this.close();
    return this.app.startStage(check.stage);
  }
}
