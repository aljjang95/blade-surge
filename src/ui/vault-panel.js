// 금고 화면(docs/GEAR_OWNERSHIP_VAULT.md 6절, docs/GEAR_VAULT_INHERIT.md 4절). 영웅 → 금고 → 다른 영웅으로 장비를 옮기는 유일한 통로.
// 규칙은 Economy(vaultState·vaultWithdrawQuote·vaultRitualQuote·vaultDeposit·vaultWithdraw·vaultRitual·gearDexClaim·vaultExpand)가 정하고 여기서는 보여 주기만 한다.
import './vault.css';
import { fmt } from './ui.js';
import { audio } from '../engine/audio.js';
import { HEROES } from '../data/heroes.js';
import { ITEM_BY_ID, SLOT_NAME, RARITY_INFO, RARITY_COLOR, rarityRank } from '../data/items.js';
import { itemIconHtml } from './item-presentation.js';
import { tierName } from '../game/item-tier-label.js';
import { GEAR_DEX_MILESTONES, dexCount, milestoneClaimed, milestoneReached } from '../game/gear-dex.js';
import { VAULT_INHERIT } from '../game/gear-vault.js';
import { gearDexClaimable } from '../game/reward-badges.js';


const esc = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const short = (heroId) => HEROES[heroId]?.name.split(' ').pop() || '';
const FREE_TEXT = { return: '되돌리기 무료', kin: '같은 계열 무료', legacy: '공유 시절 장비 · 첫 이동 무료' };
const FAIL_TEXT = { daily: '오늘 유료 꺼내기를 모두 썼습니다 (05:00 초기화)', gold: '골드가 부족합니다', hero: '해금한 영웅에게만 꺼낼 수 있습니다', item: '금고에 없는 장비입니다', full: '금고가 가득 찼습니다', max: '더 늘릴 수 없습니다', bound: '계승 의식으로만 옮길 수 있어요' };
/** 계승 의식 거부 사유(서버 reason 그대로) + UI 전용 battle. */
export const RITUAL_FAIL_TEXT = { bound: '계승 의식으로만 옮길 수 있어요', same: '맡긴 영웅에게는 의식 없이 되돌릴 수 있어요', daily: '오늘 계승 의식을 모두 했어요 (05:00 초기화)', gold: '골드가 부족합니다', sigil: '계승 문장이 부족합니다', hero: '해금한 영웅에게만 의식을 치를 수 있어요', item: '금고에 없는 장비입니다', battle: '전투 중에는 의식을 치를 수 없어요', error: '의식을 마치지 못했어요. 다시 시도해 주세요', server: '서버가 의식을 받아들이지 않았어요. 금고를 다시 열어 확인해 주세요', pending: '서버 응답을 기다리는 중이에요. 잠시 뒤 금고를 다시 열어 확인해 주세요' };
const REWARD_NAME = { gold: '골드', gems: '보석', stones: '강화석', stones2: '상급 강화석', stones3: '전설 강화석', fragments: '세트 조각', runeDust: '룬 가루', transcendStones: '초월석', lineageSigil: '계승 문장', protect: '보호 주문서', bless: '축복 주문서' };
const SLOT_ORDER = ['weapon', 'armor', 'ring', 'boots'];
const sortItems = (list) => list.slice().sort((a, b) => rarityRank(ITEM_BY_ID[b.id].rarity) - rarityRank(ITEM_BY_ID[a.id].rarity) || (b.enh || 0) - (a.enh || 0) || b.uid - a.uid);

/** 전투 중이거나 출격 중이면 의식을 열지 않는다(화면 밖 규칙: 전투 중 의식 비활성). */
/**
 * 계승 의식 실행. 로컬 전용·그림자 계정은 지금처럼 즉시 결과. 서버 권위 계정은 로컬에 반영한 뒤 그 명령의 서버 결과를 기다리고,
 * 성공일 때만 ok(연출), 거부·시간 초과면 사유를 돌려준다(거부되면 명령 큐가 서버 문서로 되돌린다).
 */
export async function performRitual(meta, uid, heroId) {
  const eco = meta.eco, acct = meta.app?.account, q = acct?.queue;
  const before = q?.lastCid, r = eco.vaultRitual(uid, heroId);
  if (!r.ok || acct?.authority !== 'server' || !q || q.lastCid === before) return r;
  const res = await q.settled(q.lastCid);
  return res.ok ? r : { ok: false, reason: res.timeout ? 'pending' : 'server' };
}
export const inBattle = (meta) => !!(meta?.app?.battle?.active || meta?.app?.stageStarting);

/** 보상 표를 "상급 강화석 5 · 계승 문장 1"처럼 읽을 수 있게. */
export function rewardText(rewards) {
  return Object.entries(rewards || {}).filter(([, n]) => n > 0).map(([k, n]) => (REWARD_NAME[k] || k) + ' ' + fmt(n)).join(' · ');
}

/** 화면 없는 모델(테스트 대상): 금고 칸·견적과 맡길 수 있는 가방 장비. */
export function vaultModel(eco, heroId) {
  const v = eco.vaultState();
  const stored = sortItems(v.items).map((inst) => ({ inst, def: ITEM_BY_ID[inst.id], quote: eco.vaultWithdrawQuote(inst.uid, heroId) }));
  const worn = new Set(Object.values(eco.hero(heroId)?.equip || {}));
  const bag = sortItems(eco.heroBag(heroId)).map((inst) => ({ inst, def: ITEM_BY_ID[inst.id], worn: worn.has(inst.uid) }));
  return { ...v, heroId, stored, bag, full: v.used >= v.slots };
}

/**
 * 계승 의식 시트 모델(테스트 대상). 견적은 Economy.vaultRitualQuote 그대로이고, 전투 중이면 UI 사유 battle 이 앞선다.
 * @returns {{ ok: boolean, reason: string|null, text: string, gold: number, sigil: number, haveSigil: number, left: number, max: number, hops: number, enh: number }}
 */
export function ritualModel(eco, uid, heroId, { battle = false } = {}) {
  const q = eco.vaultRitualQuote(uid, heroId), inst = eco.s.inventory.find((x) => x.uid === uid);
  const reason = battle ? 'battle' : q.ok ? null : q.reason;
  return { ok: !battle && q.ok, reason, text: reason ? (RITUAL_FAIL_TEXT[reason] || RITUAL_FAIL_TEXT.error) : '', gold: q.gold, sigil: q.sigil, haveSigil: Number.isSafeInteger(eco.s.lineageSigil) ? eco.s.lineageSigil : 0,
    left: q.daily.left, max: VAULT_INHERIT.ritualPerDay, hops: inst?.hops || 0, enh: inst?.enh || 0 };
}

const dropTotal = () => Object.keys(ITEM_BY_ID).length;
/** 영웅별 도감 모델(테스트 대상): 드랍·계승 도감 수, 슬롯별 수, 마일스톤 상태(locked·ready·claimed). */
export function dexModel(eco, heroId) {
  const s = eco.s, dropIds = s.gearDex?.drop?.[heroId] || [], kinIds = s.gearDex?.kin?.[heroId] || [], total = dropTotal();
  const slots = SLOT_ORDER.map((slot) => {
    const all = Object.values(ITEM_BY_ID).filter((d) => d.slot === slot);
    return { slot, n: all.filter((d) => dropIds.includes(d.id)).length, total: all.length };
  });
  const milestones = GEAR_DEX_MILESTONES.map((m) => {
    const claimed = milestoneClaimed(s, heroId, m.id), reached = milestoneReached(s, heroId, m.id);
    const have = m.kind === 'drop' ? Math.floor(dexCount(s, 'drop', heroId) * 100 / total) : dexCount(s, 'kin', heroId);
    return { id: m.id, kind: m.kind, need: m.need, have: Math.min(have, m.need), label: m.kind === 'drop' ? '드랍 도감 ' + m.need + '%' : '계승 도감 ' + m.need + '종', rewards: m.rewards, rewardText: rewardText(m.rewards), title: m.title || '', state: claimed ? 'claimed' : reached ? 'ready' : 'locked' };
  });
  return { heroId, drop: { n: dropIds.length, total, pct: Math.floor(dropIds.length * 100 / total) }, kin: { n: kinIds.length, ids: kinIds }, slots, milestones, titles: milestones.filter((m) => m.state === 'claimed' && m.title).map((m) => m.title) };
}

function tile(inst, def, heroId, tag, selected, attr) {
  return '<button type="button" class="vault-tile rar-' + def.rarity + '" ' + attr + '="' + inst.uid + '" aria-pressed="' + selected + '" aria-label="' + esc(tierName(def.name, inst)) + ' +' + inst.enh + ', ' + RARITY_INFO[def.rarity].name + ', ' + esc(tag.replace(/<[^>]+>/g, '')) + '">' +
    '<span class="vault-art">' + itemIconHtml(def, ' decoding="async"', { heroId }) + '</span><span class="vault-name">' + esc(tierName(def.name, inst)) + ' <b>+' + inst.enh + '</b></span><span class="vault-tag">' + tag + '</span></button>';
}

const reduceMotion = () => { try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** 의식 연출 단계(ms). 합 약 6.4초, 건너뛰어도 결과는 이미 확정이라 같다. */
export const RITE_PHASES = Object.freeze([['send', 0], ['glow', 1700], ['arrive', 3700], ['done', 5600]]);

function riteHtml(rite, battle) {
  const def = ITEM_BY_ID[rite.itemId], fromId = rite.from || null, hero = HEROES[rite.heroId];
  return '<div class="vault-rite" data-phase="send" data-reduce="' + (rite.reduce ? 1 : 0) + '">' +
    '<div class="rite-stage" id="rite-stage" role="button" tabindex="0" aria-label="계승 의식, 누르면 건너뜁니다">' +
      '<div class="rite-hero rite-from">' + (fromId && HEROES[fromId] ? '<img src="' + esc(HEROES[fromId].portrait || '') + '" alt="" decoding="async">' : '<i class="rite-vault-glyph" aria-hidden="true"></i>') + '<span>' + esc(fromId ? short(fromId) : '금고') + '</span></div>' +
      '<div class="rite-gear" data-rar="' + def.rarity + '">' + itemIconHtml(def, ' decoding="async"', { heroId: rite.heroId }) + '<i class="rite-bar" aria-hidden="true"></i></div>' +
      '<div class="rite-hero rite-to">' + (hero ? '<img src="' + esc(hero.portrait || '') + '" alt="" decoding="async">' : '') + '<span>' + esc(short(rite.heroId)) + '</span></div>' +
    '</div>' +
    '<div class="rite-result" id="rite-result" aria-live="polite"><b style="color:' + RARITY_COLOR[def.rarity] + '">' + esc(tierName(def.name, { id: rite.itemId, enh: rite.enh })) + ' +' + rite.enh + '</b>' +
      '<span class="rite-badge">계승 ' + rite.hops + '</span>' +
      '<small>' + esc(short(rite.heroId)) + '에게 계승 완료 · 강화·룬 그대로 · 골드 -' + fmt(rite.gold) + ' · 계승 문장 -' + rite.sigil + '</small></div>' +
    '<div class="vault-actions"><p class="vault-hint" id="rite-hint">' + (rite.reduce ? '' : '화면을 누르면 건너뜁니다') + '</p><button type="button" class="btn btn-gold" id="rite-ok">확인</button></div></div>';
}

/**
 * 금고 모달을 연다. tab: 'vault'(꺼내기) | 'bag'(맡기기) | 'dex'(도감). view: 'list' | 'ritual' | 'rite'.
 * @param {any} meta @param {string} heroId
 * @param {{ tab?: string, selected?: number|null, view?: string, rite?: any, dexHero?: string|null }} [opts]
 */
export function openVault(meta, heroId, { tab = 'vault', selected = null, view = 'list', rite = null, dexHero = null } = {}) {
  const { eco, ui } = meta;
  const m = vaultModel(eco, heroId), name = HEROES[heroId]?.name || '';
  const battle = inBattle(meta);
  const head = (sub, extra = '') => '<header class="vault-head"><div><h2>' + sub + '</h2><p>' + esc(name) + ' · 금고 <b>' + m.used + '/' + m.slots + '</b>칸 · 오늘 유료 꺼내기 <b>' + m.dailyLeft + '/' + m.dailyMax + '</b> · 계승 문장 <b>' + (Number.isSafeInteger(eco.s.lineageSigil) ? eco.s.lineageSigil : 0) + '</b></p></div>' + extra + '<button type="button" class="btn btn-ghost btn-sm" id="v-close" aria-label="닫기">✕</button></header>';
  const common = (b) => {
    b.querySelector('#v-close').onclick = () => ui.closeModal();
    b.onkeydown = (event) => { if (event.key === 'Escape' && view !== 'rite') { event.preventDefault(); ui.closeModal(); } };
  };
  const again = (next) => openVault(meta, heroId, { tab, selected: null, ...next });
  const onClose = () => { meta.renderHeroes?.(); };

  // ---------- 계승 의식 연출(서버 응답 뒤 재생) ----------
  if (view === 'rite' && rite) {
    ui.modal('<div class="vault-sheet" data-tab="rite">' + head('계승 의식') + riteHtml(rite, battle) + '</div>', {
      onClose,
      onOpen: (b) => {
        b.querySelector('#v-close').onclick = () => finish();
        const root = b.querySelector('.vault-rite'), stage = b.querySelector('#rite-stage');
        const timers = [];
        let ended = false;
        const setPhase = (p) => { root.dataset.phase = p; };
        function end() { if (ended) return; ended = true; timers.forEach(clearTimeout); setPhase('done'); const hint = b.querySelector('#rite-hint'); if (hint) hint.textContent = ''; b.querySelector('#rite-ok')?.focus({ preventScroll: true }); }
        function finish() { end(); again({ tab: 'vault' }); }
        if (rite.reduce) end(); else for (const [p, at] of RITE_PHASES) { if (p === 'done') timers.push(setTimeout(end, at)); else if (at === 0) setPhase(p); else timers.push(setTimeout(() => setPhase(p), at)); }
        stage.onclick = end;
        stage.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); end(); } };
        b.querySelector('#rite-ok').onclick = finish;
        b.onkeydown = (event) => { if (event.key === 'Escape') { event.preventDefault(); if (ended) finish(); else end(); } };
        stage.focus({ preventScroll: true });
      },
    });
    return;
  }

  // ---------- 계승 의식 시트(견적) ----------
  if (view === 'ritual') {
    const row = m.stored.find((r) => r.inst.uid === selected);
    if (!row) { openVault(meta, heroId, { tab: 'vault' }); return; }
    const q = ritualModel(eco, selected, heroId, { battle });
    const tint = '<span style="color:' + RARITY_COLOR[row.def.rarity] + '">' + esc(tierName(row.def.name, row.inst)) + ' +' + row.inst.enh + '</span>';
    ui.modal('<div class="vault-sheet" data-tab="ritual">' + head('계승 의식') +
      '<div class="ritual-body">' +
        '<div class="ritual-item vault-tile rar-' + row.def.rarity + '"><span class="vault-art">' + itemIconHtml(row.def, ' decoding="async"', { heroId }) + '</span><span class="vault-name">' + tint + '</span><span class="vault-tag">' + (q.hops ? '계승 ' + q.hops : '계승 전') + (row.inst.from ? ' · ' + esc(short(row.inst.from)) + ' 맡김' : '') + '</span></div>' +
        '<dl class="ritual-quote">' +
          '<div><dt>받는 영웅</dt><dd>' + esc(short(heroId)) + '</dd></div>' +
          '<div><dt>골드</dt><dd><i class="ic ic-gold"></i>' + fmt(q.gold) + '</dd></div>' +
          '<div><dt>계승 문장</dt><dd class="' + (q.reason === 'sigil' ? 'vault-fail' : '') + '">' + q.sigil + '개 <small>(보유 ' + q.haveSigil + ')</small></dd></div>' +
          '<div><dt>오늘 남은 횟수</dt><dd class="' + (q.left <= 0 ? 'vault-fail' : '') + '">' + q.left + '/' + q.max + '</dd></div>' +
        '</dl>' +
        '<p class="ritual-note">확률 없이 반드시 성공합니다. 강화·룬·초월은 그대로 이동하고, 골드와 계승 문장만 듭니다. 일반 꺼내기 횟수와는 따로 셉니다.</p>' +
      '</div>' +
      '<footer class="vault-actions"><div class="vault-pick">' + (q.reason ? '<small class="vault-fail" id="ritual-fail" role="alert">' + esc(q.text) + '</small>' : '<small>준비됐어요. 의식을 시작하면 되돌릴 수 없습니다.</small>') + '</div>' +
        '<button type="button" class="btn btn-ghost" id="ritual-back">돌아가기</button><button type="button" class="btn btn-gold" id="ritual-go"' + (q.ok ? '' : ' disabled') + '>계승 의식 시작</button></footer></div>', {
      onClose,
      onOpen: (b) => {
        common(b);
        b.querySelector('#ritual-back').onclick = () => again({ tab: 'vault', selected });
        const go = b.querySelector('#ritual-go');
        go.onclick = () => {
          if (inBattle(meta)) { ui.toast(RITUAL_FAIL_TEXT.battle, 'red'); audio.play('ui_error'); return; }
          go.disabled = true;
          const before = eco.s.inventory.find((x) => x.uid === selected), from = before?.from || null, itemId = before?.id, enh = before?.enh || 0;
          performRitual(meta, selected, heroId).then((r) => {
            if (!r.ok) { ui.toast(RITUAL_FAIL_TEXT[r.reason] || RITUAL_FAIL_TEXT.error, 'red'); audio.play('ui_error'); again({ tab: 'vault', selected, view: 'ritual' }); return; }
            audio.play('ui_confirm', { vol: 0.5 }); meta.refreshTop?.();
            openVault(meta, heroId, { tab: 'vault', view: 'rite', rite: { itemId, enh, from, heroId, hops: r.hops, gold: r.gold, sigil: r.sigil, reduce: reduceMotion() } });
          });
        };
        (b.querySelector('#ritual-go:not([disabled])') || b.querySelector('#ritual-back')).focus({ preventScroll: true });
      },
    });
    return;
  }

  // ---------- 도감 ----------
  if (tab === 'dex') {
    const dh = dexHero && eco.ownHero(dexHero) ? dexHero : heroId, d = dexModel(eco, dh);
    const heroChips = eco.ownedHeroIds().map((id) => '<button type="button" class="dex-chip" data-dex-hero="' + id + '" aria-pressed="' + (id === dh) + '">' + esc(short(id)) + '</button>').join('');
    const bars = '<div class="dex-bars"><div class="dex-bar"><span>드랍 도감 <b>' + d.drop.n + '/' + d.drop.total + '</b> (' + d.drop.pct + '%)</span><i style="--p:' + Math.min(100, d.drop.pct) + '%"></i></div>' +
      '<div class="dex-bar"><span>계승 도감 <b>' + d.kin.n + '종</b></span><i style="--p:' + Math.min(100, Math.floor(d.kin.n * 100 / 30)) + '%"></i></div></div>' +
      '<p class="dex-slots">' + d.slots.map((x) => SLOT_NAME[x.slot] + ' ' + x.n + '/' + x.total).join(' · ') + '</p>';
    const rows = d.milestones.map((x) => '<li class="dex-ms" data-state="' + x.state + '"><div><b>' + esc(x.label) + '</b><small>' + (x.rewardText ? esc(x.rewardText) : '보상 준비 중') + (x.title ? ' · 칭호 「' + esc(x.title) + '」' : '') + '</small></div>' +
      '<button type="button" class="btn btn-sm ' + (x.state === 'ready' ? 'btn-gold' : 'btn-ghost') + '" data-dex-claim="' + x.id + '"' + (x.state === 'ready' ? '' : ' disabled') + '>' + (x.state === 'claimed' ? '받음' : x.state === 'ready' ? '받기' : x.kind === 'drop' ? x.have + '/' + x.need + '%' : x.have + '/' + x.need) + '</button></li>').join('');
    const kinNames = d.kin.ids.slice(0, 12).map((id) => '<span class="dex-kin rar-' + ITEM_BY_ID[id].rarity + '">' + esc(ITEM_BY_ID[id].name) + '</span>').join('');
    ui.modal('<div class="vault-sheet" data-tab="dex">' + head('장비 도감') +
      '<div class="vault-tabs" role="tablist" aria-label="금고">' + tabsHtml('dex', m, heroId) + '</div>' +
      '<div class="dex-body"><div class="dex-chips" role="group" aria-label="영웅 선택">' + heroChips + '</div>' + bars +
        (d.titles.length ? '<p class="dex-titles">칭호 ' + d.titles.map((t) => '「' + esc(t) + '」').join(' ') + '</p>' : '') +
        '<ul class="dex-list" aria-label="도감 마일스톤">' + rows + '</ul>' +
        (kinNames ? '<p class="dex-kin-head">계승으로 받은 장비</p><div class="dex-kins">' + kinNames + '</div>' : '') +
        '<p class="vault-rules">드랍 도감은 그 영웅이 직접 얻은 장비만, 계승 도감은 의식으로 받은 장비만 올라갑니다. 일반 꺼내기·장착으로는 올라가지 않습니다. 보상에 능력치는 없습니다.</p></div></div>', {
      onClose,
      onOpen: (b) => {
        common(b); bindTabs(b);
        b.querySelectorAll('[data-dex-hero]').forEach((el) => el.onclick = () => openVault(meta, heroId, { tab: 'dex', dexHero: el.dataset.dexHero }));
        b.querySelectorAll('[data-dex-claim]').forEach((el) => el.onclick = () => {
          const r = eco.gearDexClaim(dh, el.dataset.dexClaim);
          if (!r.ok) { ui.toast('받을 수 없습니다', 'red'); audio.play('ui_error'); return; }
          audio.play('ui_confirm', { vol: 0.5 }); ui.toast('도감 보상 · ' + (r.got.map((g) => (REWARD_NAME[g.k] || g.k) + ' ' + g.n).join(' · ') || '받음'), 'gold');
          meta.refreshTop?.(); openVault(meta, heroId, { tab: 'dex', dexHero: dh });
        });
        (b.querySelector('[data-dex-claim]:not([disabled])') || b.querySelector('[data-vault-tab][aria-selected="true"]'))?.focus({ preventScroll: true });
      },
    });
    return;
  }

  function tabsHtml(cur, mm, hid) {
    return '<button type="button" role="tab" data-vault-tab="vault" aria-selected="' + (cur === 'vault') + '">금고에서 꺼내기 <small>' + mm.used + '</small></button><button type="button" role="tab" data-vault-tab="bag" aria-selected="' + (cur === 'bag') + '">' + esc(short(hid)) + ' 가방에서 맡기기 <small>' + mm.bag.length + '</small></button><button type="button" role="tab" data-vault-tab="dex" aria-selected="' + (cur === 'dex') + '">도감' + (gearDexClaimable(meta.eco.s, meta.eco.ownedHeroIds()) > 0 ? ' <em class="dot on vault-tab-dot" aria-label="받을 보상 있음"></em>' : '') + '</button>';
  }
  function bindTabs(b) {
    b.querySelectorAll('[data-vault-tab]').forEach((el) => el.onclick = () => { audio.play('ui_click', { vol: 0.4 }); openVault(meta, heroId, { tab: el.dataset.vaultTab, dexHero }); });
  }

  // ---------- 금고 / 가방 ----------
  const pick = tab === 'vault' ? m.stored.find((row) => row.inst.uid === selected) : m.bag.find((row) => row.inst.uid === selected);
  const list = tab === 'vault'
    ? m.stored.map(({ inst, def, quote }) => tile(inst, def, heroId, (quote.reason === 'bound' ? '<em class="vault-bound">의식 필요</em>' : quote.free ? '<em class="vault-free">무료</em>' : '<i class="ic ic-gold"></i>' + fmt(quote.gold)) + (inst.hops ? ' · 계승 ' + inst.hops : '') + (inst.from ? ' · ' + esc(short(inst.from)) + ' 맡김' : ''), inst.uid === selected, 'data-vault-uid')).join('')
      || '<p class="vault-empty">금고가 비어 있습니다. 영웅 가방의 장비를 맡기면 다른 영웅이 꺼내 쓸 수 있습니다.</p>'
    : m.bag.map(({ inst, def, worn }) => tile(inst, def, heroId, worn ? '착용 중 · 맡기면 해제' : SLOT_NAME[def.slot], inst.uid === selected, 'data-bag-uid')).join('')
      || '<p class="vault-empty">' + esc(name) + '의 가방이 비어 있습니다.</p>';
  let action = '<p class="vault-hint">' + (tab === 'vault' ? '장비를 고르면 ' + esc(short(heroId)) + '에게 꺼낼 수 있습니다.' : '맡길 장비를 고르세요. 맡기기는 무료입니다.') + '</p>';
  if (pick && tab === 'vault') {
    const q = pick.quote, bound = q.reason === 'bound', cost = q.free ? FREE_TEXT[q.free] : '골드 ' + fmt(q.gold);
    const rq = ritualModel(eco, pick.inst.uid, heroId, { battle });
    const hint = bound ? '<small class="vault-fail" id="bound-note">' + esc(FAIL_TEXT.bound) + '</small>' : (q.ok ? '' : '<small class="vault-fail">' + esc(FAIL_TEXT[q.reason] || '꺼낼 수 없습니다') + '</small>');
    action = '<div class="vault-pick"><span style="color:' + RARITY_COLOR[pick.def.rarity] + '">' + esc(tierName(pick.def.name, pick.inst)) + ' +' + pick.inst.enh + '</span><small>' + (bound ? '레전드리는 다른 계열에게 계승 의식으로 옮겨요' : esc(cost) + ' · 강화·룬 그대로 이동') + '</small>' + hint + '</div>' +
      '<button type="button" class="btn btn-gold" id="v-take"' + (q.ok ? '' : ' disabled') + '>' + esc(short(heroId)) + '에게 꺼내기</button>' +
      '<button type="button" class="btn btn-blue" id="v-ritual"' + (rq.reason === 'battle' || rq.reason === 'item' || rq.reason === 'hero' ? ' disabled' : '') + ' title="' + esc(rq.reason === 'battle' ? RITUAL_FAIL_TEXT.battle : '') + '">계승 의식</button>';
  } else if (pick && tab === 'bag') {
    action = '<div class="vault-pick"><span style="color:' + RARITY_COLOR[pick.def.rarity] + '">' + esc(tierName(pick.def.name, pick.inst)) + ' +' + pick.inst.enh + '</span><small>' + (pick.worn ? '착용 중 — 맡기면 해제됩니다' : '맡긴 뒤 ' + esc(short(heroId)) + '에게 되돌리면 무료') + '</small>' + (m.full ? '<small class="vault-fail">' + FAIL_TEXT.full + '</small>' : '') + '</div>' +
      '<button type="button" class="btn btn-blue" id="v-put"' + (m.full ? ' disabled' : '') + '>금고에 맡기기</button>';
  }
  const expand = m.expandGold === null ? '<span class="vault-max">최대 ' + m.slots + '칸</span>'
    : '<button type="button" class="btn btn-ghost btn-sm" id="v-expand"' + (eco.s.gold < m.expandGold ? ' disabled' : '') + ' aria-label="금고 10칸 늘리기, 골드 ' + fmt(m.expandGold) + '">+10칸 <i class="ic ic-gold"></i>' + fmt(m.expandGold) + '</button>';
  ui.modal('<div class="vault-sheet" data-tab="' + tab + '">' + head('장비 금고', expand) +
    '<div class="vault-tabs" role="tablist" aria-label="금고">' + tabsHtml(tab, m, heroId) + '</div>' +
    '<div class="vault-grid" role="list">' + list + '</div>' +
    '<footer class="vault-actions">' + action + '</footer>' +
    '<p class="vault-rules">맡기기 무료 · 맡긴 영웅에게 되돌리기와 같은 무기 계열은 무료 · 그 밖에는 등급·강화에 비례한 골드(하루 ' + m.dailyMax + '회) · 레전드리는 다른 계열에게 계승 의식으로만</p></div>', {
    onClose,
    onOpen: (b) => {
      common(b); bindTabs(b);
      b.querySelectorAll('[data-vault-uid]').forEach((el) => el.onclick = () => again({ selected: +el.dataset.vaultUid }));
      b.querySelectorAll('[data-bag-uid]').forEach((el) => el.onclick = () => again({ selected: +el.dataset.bagUid }));
      const take = b.querySelector('#v-take');
      if (take) take.onclick = () => {
        const r = eco.vaultWithdraw(selected, heroId);
        if (!r.ok) { ui.toast(FAIL_TEXT[r.reason] || '꺼낼 수 없습니다', 'red'); audio.play('ui_error'); return; }
        audio.play('ui_confirm', { vol: 0.5 }); ui.toast(esc(short(heroId)) + '에게 꺼냄' + (r.gold ? ' · 골드 -' + fmt(r.gold) : ' · 무료'), r.gold ? 'gold' : '');
        meta.refreshTop?.(); again({});
      };
      const ritual = b.querySelector('#v-ritual');
      if (ritual) ritual.onclick = () => {
        if (inBattle(meta)) { ui.toast(RITUAL_FAIL_TEXT.battle, 'red'); audio.play('ui_error'); return; }
        audio.play('ui_click', { vol: 0.4 }); openVault(meta, heroId, { tab: 'vault', selected, view: 'ritual' });
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
      (b.querySelector('#v-take:not([disabled]), #v-put:not([disabled]), #v-ritual:not([disabled])') || b.querySelector('[data-vault-tab][aria-selected="true"]'))?.focus({ preventScroll: true });
    },
  });
}
