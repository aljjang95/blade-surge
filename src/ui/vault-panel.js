// 금고 화면(docs/GEAR_OWNERSHIP_VAULT.md 6절). 영웅 → 금고 → 다른 영웅으로 장비를 옮기는 유일한 통로.
// 규칙은 Economy(vaultState·vaultWithdrawQuote·vaultDeposit·vaultWithdraw·vaultExpand)가 정하고 여기서는 보여 주기만 한다.
import './vault.css';
import { fmt } from './ui.js';
import { audio } from '../engine/audio.js';
import { HEROES } from '../data/heroes.js';
import { ITEM_BY_ID, SLOT_NAME, RARITY_INFO, RARITY_COLOR, rarityRank } from '../data/items.js';
import { itemIconHtml } from './item-presentation.js';
import { tierName } from '../game/item-tier-label.js';

const esc = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const short = (heroId) => HEROES[heroId]?.name.split(' ').pop() || '';
const FREE_TEXT = { return: '되돌리기 무료', kin: '같은 계열 무료', legacy: '공유 시절 장비 · 첫 이동 무료' };
const FAIL_TEXT = { daily: '오늘 유료 꺼내기를 모두 썼습니다 (05:00 초기화)', gold: '골드가 부족합니다', hero: '해금한 영웅에게만 꺼낼 수 있습니다', item: '금고에 없는 장비입니다', full: '금고가 가득 찼습니다', max: '더 늘릴 수 없습니다' };
const sortItems = (list) => list.slice().sort((a, b) => rarityRank(ITEM_BY_ID[b.id].rarity) - rarityRank(ITEM_BY_ID[a.id].rarity) || (b.enh || 0) - (a.enh || 0) || b.uid - a.uid);

/** 화면 없는 모델(테스트 대상): 금고 칸·견적과 맡길 수 있는 가방 장비. */
export function vaultModel(eco, heroId) {
  const v = eco.vaultState();
  const stored = sortItems(v.items).map((inst) => ({ inst, def: ITEM_BY_ID[inst.id], quote: eco.vaultWithdrawQuote(inst.uid, heroId) }));
  const worn = new Set(Object.values(eco.hero(heroId)?.equip || {}));
  const bag = sortItems(eco.heroBag(heroId)).map((inst) => ({ inst, def: ITEM_BY_ID[inst.id], worn: worn.has(inst.uid) }));
  return { ...v, heroId, stored, bag, full: v.used >= v.slots };
}

function tile(inst, def, heroId, tag, selected, attr) {
  return '<button type="button" class="vault-tile rar-' + def.rarity + '" ' + attr + '="' + inst.uid + '" aria-pressed="' + selected + '" aria-label="' + esc(tierName(def.name, inst)) + ' +' + inst.enh + ', ' + RARITY_INFO[def.rarity].name + ', ' + esc(tag.replace(/<[^>]+>/g, '')) + '">' +
    '<span class="vault-art">' + itemIconHtml(def, ' decoding="async"', { heroId }) + '</span><span class="vault-name">' + esc(tierName(def.name, inst)) + ' <b>+' + inst.enh + '</b></span><span class="vault-tag">' + tag + '</span></button>';
}

/** 금고 모달을 연다. tab: 'vault'(꺼내기) | 'bag'(맡기기). */
export function openVault(meta, heroId, { tab = 'vault', selected = null } = {}) {
  const { eco, ui } = meta;
  const m = vaultModel(eco, heroId), name = HEROES[heroId]?.name || '';
  const pick = tab === 'vault' ? m.stored.find((row) => row.inst.uid === selected) : m.bag.find((row) => row.inst.uid === selected);
  const list = tab === 'vault'
    ? m.stored.map(({ inst, def, quote }) => tile(inst, def, heroId, (quote.free ? '<em class="vault-free">무료</em>' : '<i class="ic ic-gold"></i>' + fmt(quote.gold)) + (inst.from ? ' · ' + esc(short(inst.from)) + ' 맡김' : ''), inst.uid === selected, 'data-vault-uid')).join('')
      || '<p class="vault-empty">금고가 비어 있습니다. 영웅 가방의 장비를 맡기면 다른 영웅이 꺼내 쓸 수 있습니다.</p>'
    : m.bag.map(({ inst, def, worn }) => tile(inst, def, heroId, worn ? '착용 중 · 맡기면 해제' : SLOT_NAME[def.slot], inst.uid === selected, 'data-bag-uid')).join('')
      || '<p class="vault-empty">' + esc(name) + '의 가방이 비어 있습니다.</p>';
  let action = '<p class="vault-hint">' + (tab === 'vault' ? '장비를 고르면 ' + esc(short(heroId)) + '에게 꺼낼 수 있습니다.' : '맡길 장비를 고르세요. 맡기기는 무료입니다.') + '</p>';
  if (pick && tab === 'vault') {
    const q = pick.quote, cost = q.free ? FREE_TEXT[q.free] : '골드 ' + fmt(q.gold);
    action = '<div class="vault-pick"><span style="color:' + RARITY_COLOR[pick.def.rarity] + '">' + esc(tierName(pick.def.name, pick.inst)) + ' +' + pick.inst.enh + '</span><small>' + esc(cost) + ' · 강화·룬 그대로 이동</small>' + (q.ok ? '' : '<small class="vault-fail">' + esc(FAIL_TEXT[q.reason] || '꺼낼 수 없습니다') + '</small>') + '</div>' +
      '<button type="button" class="btn btn-gold" id="v-take"' + (q.ok ? '' : ' disabled') + '>' + esc(short(heroId)) + '에게 꺼내기</button>';
  } else if (pick && tab === 'bag') {
    action = '<div class="vault-pick"><span style="color:' + RARITY_COLOR[pick.def.rarity] + '">' + esc(tierName(pick.def.name, pick.inst)) + ' +' + pick.inst.enh + '</span><small>' + (pick.worn ? '착용 중 — 맡기면 해제됩니다' : '맡긴 뒤 ' + esc(short(heroId)) + '에게 되돌리면 무료') + '</small>' + (m.full ? '<small class="vault-fail">' + FAIL_TEXT.full + '</small>' : '') + '</div>' +
      '<button type="button" class="btn btn-blue" id="v-put"' + (m.full ? ' disabled' : '') + '>금고에 맡기기</button>';
  }
  const expand = m.expandGold === null ? '<span class="vault-max">최대 ' + m.slots + '칸</span>'
    : '<button type="button" class="btn btn-ghost btn-sm" id="v-expand"' + (eco.s.gold < m.expandGold ? ' disabled' : '') + ' aria-label="금고 10칸 늘리기, 골드 ' + fmt(m.expandGold) + '">+10칸 <i class="ic ic-gold"></i>' + fmt(m.expandGold) + '</button>';
  ui.modal('<div class="vault-sheet" data-tab="' + tab + '">' +
    '<header class="vault-head"><div><h2>장비 금고</h2><p>' + esc(name) + ' · 금고 <b>' + m.used + '/' + m.slots + '</b>칸 · 오늘 유료 꺼내기 <b>' + m.dailyLeft + '/' + m.dailyMax + '</b></p></div>' + expand + '<button type="button" class="btn btn-ghost btn-sm" id="v-close" aria-label="닫기">✕</button></header>' +
    '<div class="vault-tabs" role="tablist" aria-label="금고"><button type="button" role="tab" data-vault-tab="vault" aria-selected="' + (tab === 'vault') + '">금고에서 꺼내기 <small>' + m.used + '</small></button><button type="button" role="tab" data-vault-tab="bag" aria-selected="' + (tab === 'bag') + '">' + esc(short(heroId)) + ' 가방에서 맡기기 <small>' + m.bag.length + '</small></button></div>' +
    '<div class="vault-grid" role="list">' + list + '</div>' +
    '<footer class="vault-actions">' + action + '</footer>' +
    '<p class="vault-rules">맡기기 무료 · 맡긴 영웅에게 되돌리기와 같은 무기 계열은 무료 · 그 밖에는 등급·강화에 비례한 골드(하루 ' + m.dailyMax + '회)</p></div>', {
    onClose: () => { meta.renderHeroes?.(); },
    onOpen: (b) => {
      const again = (next) => openVault(meta, heroId, { tab, selected: null, ...next });
      b.querySelector('#v-close').onclick = () => ui.closeModal();
      b.querySelectorAll('[data-vault-tab]').forEach((el) => el.onclick = () => { audio.play('ui_click', { vol: 0.4 }); again({ tab: el.dataset.vaultTab }); });
      b.querySelectorAll('[data-vault-uid]').forEach((el) => el.onclick = () => again({ selected: +el.dataset.vaultUid }));
      b.querySelectorAll('[data-bag-uid]').forEach((el) => el.onclick = () => again({ selected: +el.dataset.bagUid }));
      const take = b.querySelector('#v-take');
      if (take) take.onclick = () => {
        const r = eco.vaultWithdraw(selected, heroId);
        if (!r.ok) { ui.toast(FAIL_TEXT[r.reason] || '꺼낼 수 없습니다', 'red'); audio.play('ui_error'); return; }
        audio.play('ui_confirm', { vol: 0.5 }); ui.toast(esc(short(heroId)) + '에게 꺼냄' + (r.gold ? ' · 골드 -' + fmt(r.gold) : ' · 무료'), r.gold ? 'gold' : '');
        meta.refreshTop?.(); again({});
      };
      const put = b.querySelector('#v-put');
      if (put) put.onclick = () => {
        const r = eco.vaultDeposit(selected);
        if (!r.ok) { ui.toast(FAIL_TEXT[r.reason] || '맡길 수 없습니다', 'red'); audio.play('ui_error'); return; }
        audio.play('ui_confirm', { vol: 0.5 }); ui.toast('금고에 맡김');
        if (heroId === eco.s.selected) meta.app?.showcaseHero?.(heroId);
        again({});
      };
      const grow = b.querySelector('#v-expand');
      if (grow) grow.onclick = async () => {
        const gold = m.expandGold;
        if (!await ui.confirm('금고 확장', '골드 ' + fmt(gold) + '로 금고를 10칸 늘릴까요? (' + m.slots + ' → ' + (m.slots + 10) + '칸)')) { again({}); return; }
        const r = eco.vaultExpand();
        if (!r.ok) ui.toast(FAIL_TEXT[r.reason] || '늘릴 수 없습니다', 'red'); else { ui.toast('금고 ' + r.slots + '칸', 'gold'); meta.refreshTop?.(); }
        again({});
      };
      b.onkeydown = (event) => { if (event.key === 'Escape') { event.preventDefault(); ui.closeModal(); } };
      (b.querySelector('#v-take, #v-put') || b.querySelector('[data-vault-tab][aria-selected="true"]'))?.focus({ preventScroll: true });
    },
  });
}
