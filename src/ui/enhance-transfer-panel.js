// 강화 전승 화면. 규칙·비용은 data/enhance-transfer.js(Economy.enhanceTransferQuote·enhanceTransfer)가 정하고 여기서는 고르고 미리 보여 주기만 한다.
// 공개 진입점: meta.openTransfer(uid, heroId) — 그 장비를 원본(옮길 강화가 있으면) 또는 대상으로 미리 고른 채 연다.
import './enhance-transfer.css';
import { fmt } from './ui.js';
import { audio } from '../engine/audio.js';
import { ITEM_BY_ID, SLOT_NAME, RARITY_INFO, RARITY_COLOR, rarityRank, STONE_NAME } from '../data/items.js';
import { TRANSFER_MIN_ENH } from '../data/enhance-transfer.js';
import { tierName } from '../game/item-tier-label.js';
import { inBattle } from './vault-panel.js';

const esc = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
/** 거절 사유(Economy reason 그대로) + UI 전용 battle·pending·server. */
export const TRANSFER_FAIL_TEXT = {
  same: '같은 장비끼리는 전승할 수 없어요', item: '장비를 찾을 수 없어요', slot: '같은 부위끼리만 전승할 수 있어요', owner: '같은 영웅이 가진 장비끼리만 전승할 수 있어요 (금고 장비 불가)',
  locked: '해금한 영웅의 장비만 전승할 수 있어요', worn: '다른 영웅이 착용 중인 장비예요', rarity: '같거나 더 높은 등급으로만 전승할 수 있어요', min: '+' + TRANSFER_MIN_ENH + ' 이상 장비만 전승할 수 있어요',
  gain: '대상의 지금 강화가 전승 결과보다 높거나 같아요', gold: '골드가 부족합니다', stones: '강화석이 부족합니다', scroll: '전승 보호 주문서가 없습니다',
  battle: '전투 중에는 전승할 수 없어요', pending: '서버 응답을 기다리는 중이에요 — 잠시 뒤 다시 확인해 주세요', server: '서버가 전승을 거절했습니다',
};
/** 견적 사유 중 "목록에는 보이되 지금은 못 함"(재화 부족) 인 것. 나머지는 짝이 될 수 없다. */
const LISTABLE = new Set(['gold', 'stones', 'scroll']);
const pairable = (q) => q.ok || LISTABLE.has(q.reason);
const byBest = (a, b) => rarityRank(ITEM_BY_ID[b.id].rarity) - rarityRank(ITEM_BY_ID[a.id].rarity) || (b.il || 0) - (a.il || 0) || (b.enh || 0) - (a.enh || 0) || b.uid - a.uid;

/**
 * 화면 없는 모델(테스트 대상). uid 를 원본으로 쓸 짝이 있으면 원본, 아니면 대상으로 미리 고른다.
 * @param {any} eco @param {number} uid @param {{ srcUid?: number, dstUid?: number, scroll?: boolean }} [pick]
 */
export function transferModel(eco, uid, pick = {}) {
  const s = eco.s, inst = s.inventory.find((x) => x.uid === uid), def = ITEM_BY_ID[inst?.id];
  if (!def) return null;
  const scroll = !!pick.scroll;
  const owner = inst.owner ?? s.selected;
  const peers = s.inventory.filter((x) => x.uid !== uid && ITEM_BY_ID[x.id]?.slot === def.slot && (x.owner ?? s.selected) === owner);
  // 고를 수 있는 짝은 주문서 사용 여부와 무관하게 판정한다(주문서를 켜면 결과가 +1 이라 짝이 늘 수 있다: 둘 중 하나라도 되면 보인다).
  const can = (a, b) => pairable(eco.enhanceTransferQuote(a, b)) || pairable(eco.enhanceTransferQuote(a, b, { scroll: true }));
  const asSourceTargets = peers.filter((x) => can(uid, x.uid)).sort(byBest);
  const asTargetSources = peers.filter((x) => can(x.uid, uid)).sort(byBest);
  const role = pick.srcUid === uid ? 'source' : pick.dstUid === uid ? 'target' : asSourceTargets.length ? 'source' : asTargetSources.length ? 'target' : null;
  if (!role) return { uid, role: null, slot: def.slot, sources: [], targets: [], srcUid: null, dstUid: null, quote: null, scroll, scrolls: s.transferScroll || 0 };
  const sources = role === 'source' ? [inst] : asTargetSources, targets = role === 'source' ? asSourceTargets : [inst];
  const srcUid = role === 'source' ? uid : (sources.find((x) => x.uid === pick.srcUid) || sources[0]).uid;
  const dstUid = role === 'target' ? uid : (targets.find((x) => x.uid === pick.dstUid) || targets[0]).uid;
  const quote = eco.enhanceTransferQuote(srcUid, dstUid, { scroll });
  const src = s.inventory.find((x) => x.uid === srcUid), dst = s.inventory.find((x) => x.uid === dstUid);
  const preview = quote.from === undefined ? null : {
    srcName: tierName(ITEM_BY_ID[src.id].name, src), dstName: tierName(ITEM_BY_ID[dst.id].name, dst),
    from: quote.from, to: quote.to, targetEnh: quote.targetEnh, loss: quote.loss, gold: quote.gold, stones: quote.stones, stoneKey: quote.stoneKey,
    stoneName: STONE_NAME[quote.stoneTier] || '강화석', haveStones: s[quote.stoneKey] || 0, haveGold: s.gold, swapEquip: quote.swapEquip,
  };
  return { uid, role, slot: def.slot, sources, targets, srcUid, dstUid, quote, preview, scroll, scrolls: s.transferScroll || 0,
    ok: quote.ok, reasonText: quote.ok ? '' : TRANSFER_FAIL_TEXT[quote.reason] || '전승할 수 없습니다' };
}
/** 이 장비로 전승을 시작할 수 있는가(원본 또는 대상으로 짝이 하나라도 있음). 시트의 버튼 노출 판정. */
export const canTransfer = (eco, uid) => !!transferModel(eco, uid)?.role;

/**
 * 전승 실행. 로컬·그림자 계정은 즉시 결과, 서버 권위 계정은 그 명령의 서버 결과를 기다려 성공일 때만 ok(vault-panel performRitual 과 같은 방식).
 */
export async function performTransfer(meta, srcUid, dstUid, scroll) {
  const eco = meta.eco, acct = meta.app?.account, q = acct?.queue;
  const before = q?.lastCid, r = eco.enhanceTransfer(srcUid, dstUid, { scroll });
  if (!r.ok || acct?.authority !== 'server' || !q || q.lastCid === before) return r;
  const res = await q.settled(q.lastCid);
  return res.ok ? r : { ok: false, reason: res.timeout ? 'pending' : 'server' };
}

const itemButton = (inst, kind, on) => {
  const def = ITEM_BY_ID[inst.id];
  return '<button type="button" class="et-item' + (on ? ' on' : '') + '" data-' + kind + '="' + inst.uid + '" aria-pressed="' + on + '"><b style="color:' + RARITY_COLOR[def.rarity] + '">' + esc(tierName(def.name, inst)) + '</b><span>+' + (inst.enh || 0) + ' · ' + RARITY_INFO[def.rarity].name + (inst.il ? ' · Lv.' + inst.il : '') + '</span></button>';
};

/** 전승 시트. heroId 는 닫은 뒤 돌아갈 영웅 시트. */
export function openTransferSheet(meta, uid, heroId = meta.eco.s.selected, pick = {}) {
  const { eco, ui } = meta;
  let state = { srcUid: pick.srcUid, dstUid: pick.dstUid, scroll: !!pick.scroll }, confirming = false, busy = false;
  const render = () => {
    const m = transferModel(eco, uid, state);
    if (!m) { ui.toast(TRANSFER_FAIL_TEXT.item, 'red'); return; }
    state = { srcUid: m.srcUid, dstUid: m.dstUid, scroll: m.scroll };
    const p = m.preview;
    const body = !m.role ? '<p class="et-empty">' + esc(SLOT_NAME[m.slot]) + ' 부위에 전승할 짝이 없습니다. +' + TRANSFER_MIN_ENH + ' 이상 장비의 강화를 같은 영웅의 같거나 더 높은 등급 장비로 옮길 수 있어요.</p>'
      : '<div class="et-cols"><section aria-label="원본"><h3>원본 <small>강화를 내줌 → +0</small></h3><div class="et-list">' + m.sources.map((x) => itemButton(x, 'src', x.uid === m.srcUid)).join('') + '</div></section>' +
        '<section aria-label="대상"><h3>대상 <small>강화를 받음</small></h3><div class="et-list">' + m.targets.map((x) => itemButton(x, 'dst', x.uid === m.dstUid)).join('') + '</div></section></div>' +
        (p ? '<div class="et-preview" aria-live="polite"><div><span>원본</span><b>' + esc(p.srcName) + '</b> +' + p.from + ' → <b>+0</b></div>' +
          '<div><span>대상</span><b>' + esc(p.dstName) + '</b> +' + p.targetEnh + ' → <b class="stat-up">+' + p.to + '</b></div>' +
          '<div><span>손실</span>' + (p.loss ? '<b class="stat-down">−' + p.loss + '단계</b>' : '<b class="stat-up">없음 (전승 보호 주문서)</b>') + (p.targetEnh ? ' · 대상의 기존 +' + p.targetEnh + ' 은 사라집니다' : '') + '</div>' +
          '<div class="et-cost"><span class="' + (p.haveGold < p.gold ? 'lack' : '') + '"><i class="ic ic-gold"></i> ' + fmt(p.gold) + '</span><span class="' + (p.haveStones < p.stones ? 'lack' : '') + '">' + esc(p.stoneName) + ' ' + fmt(p.stones) + ' <small>(보유 ' + fmt(p.haveStones) + ')</small></span></div>' +
          (p.swapEquip ? '<p class="et-note">원본을 착용 중이라 전승 뒤 대상이 그 자리에 장착됩니다.</p>' : '') + '</div>' : '') +
        '<button type="button" class="enh-opt et-scroll' + (m.scroll ? ' on' : '') + '" id="et-scroll" aria-pressed="' + m.scroll + '"><span>전승 보호 주문서 사용 · 손실 없음</span><span class="cnt">×' + m.scrolls + '</span></button>' +
        (m.ok ? '' : '<p class="et-reason stat-down">' + esc(m.reasonText) + '</p>') +
        (confirming ? '<div class="et-confirm" role="alert"><p>' + (p?.targetEnh ? '대상의 기존 +' + p.targetEnh + ' 강화는 사라집니다. ' : '') + '원본은 +0 이 됩니다. 진행할까요?</p><div class="modal-btns"><button type="button" class="btn btn-ghost" id="et-no">취소</button><button type="button" class="btn btn-gold" id="et-yes">확인</button></div></div>'
          : '<button type="button" class="btn btn-blue" id="et-go"' + (m.ok ? '' : ' disabled') + '>전승</button>');
    ui.modal('<div class="enh-transfer"><header class="vault-head"><div><h2>강화 전승</h2><p>' + esc(SLOT_NAME[m.slot]) + ' · 같은 영웅 · 같거나 높은 등급으로 강화 단계를 옮깁니다 (원본은 파괴되지 않고 +0, 룬·내구도는 각 장비에 남음)</p></div><button type="button" class="btn btn-ghost btn-sm" id="et-close" aria-label="닫기">✕</button></header>' + body + '</div>', {
      onOpen: (b) => {
        const back = () => { ui.closeModal(); meta.showItem?.(uid, heroId); };
        b.querySelector('#et-close').onclick = back;
        b.onkeydown = (event) => { if (event.key === 'Escape') { event.preventDefault(); back(); } };
        b.querySelectorAll('[data-src]').forEach((el) => el.onclick = () => { state.srcUid = +el.dataset.src; confirming = false; audio.play('ui_click', { vol: 0.4 }); render(); });
        b.querySelectorAll('[data-dst]').forEach((el) => el.onclick = () => { state.dstUid = +el.dataset.dst; confirming = false; audio.play('ui_click', { vol: 0.4 }); render(); });
        const sc = b.querySelector('#et-scroll');
        if (sc) sc.onclick = () => {
          if (!state.scroll && !(eco.s.transferScroll > 0)) { ui.toast(TRANSFER_FAIL_TEXT.scroll, 'red'); audio.play('ui_error'); meta.offerScroll?.('transfer'); return; }
          state.scroll = !state.scroll; confirming = false; audio.play('ui_click', { vol: 0.4 }); render();
        };
        const go = b.querySelector('#et-go');
        if (go) go.onclick = () => { if (inBattle(meta)) { ui.toast(TRANSFER_FAIL_TEXT.battle, 'red'); return; } confirming = true; audio.play('ui_click', { vol: 0.4 }); render(); };
        const no = b.querySelector('#et-no'); if (no) no.onclick = () => { confirming = false; render(); };
        const yes = b.querySelector('#et-yes');
        if (yes) yes.onclick = async () => {
          if (busy) return;
          if (inBattle(meta)) { ui.toast(TRANSFER_FAIL_TEXT.battle, 'red'); return; }
          busy = true; yes.disabled = true;
          const { srcUid, dstUid, scroll } = state;
          const r = await performTransfer(meta, srcUid, dstUid, scroll);
          busy = false; confirming = false;
          if (!r.ok) { ui.toast(TRANSFER_FAIL_TEXT[r.reason] || '전승할 수 없습니다', 'red'); audio.play('ui_error'); render(); return; }
          audio.play('ui_confirm', { vol: 0.6 });
          ui.toast('강화 전승 완료! +' + r.to, 'gold');
          meta.trackFunnel?.('upgrade', { kind: 'item_transfer', level: r.to, success: true });
          meta.refreshTop?.(); ui.closeModal(); meta._sheetDirty = false; meta.renderHeroes?.();
          if (r.equipped && heroId === eco.s.selected) meta.app?.showcaseHero?.(heroId);
          meta.showItem?.(dstUid, heroId);
        };
        (b.querySelector('#et-yes') || b.querySelector('#et-go') || b.querySelector('#et-close'))?.focus({ preventScroll: true });
      },
    });
  };
  render();
}
