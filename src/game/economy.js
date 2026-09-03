// 경제·진행 상태 (localStorage 저장). 결제는 전부 목업.
import { HEROES, HERO_ORDER, levelExp, levelGold, starShards, skillUpGold, heroStats } from '../data/heroes.js';
import { ITEM_POOL, ITEM_BY_ID, SLOTS, SETS, itemStats, enhanceCost, enhanceStones, enhanceChance, destroyChance, ENH_MAX, RARITY_WEIGHT_STAGE, RARITY_WEIGHT_GACHA , STONE_KEY, enhanceStoneTier, craftable, CRAFT_COST, GACHA_ITEM_RARITY, RARITY_INFO, enhanceDown} from '../data/items.js';
import { SKUS, GACHA, BATTLE_PASS, ENERGY, DAILY_REWARDS, PASS_TRACK } from '../data/shop.js';
import { stageDef, STAGES_PER_CHAPTER, CHAPTERS } from '../data/stages.js';

const KEY = 'bladesurge_save_v1';
const now = () => Date.now();
const pickWeighted = (w) => { const tot = Object.values(w).reduce((a, b) => a + b, 0); let r = Math.random() * tot; for (const k in w) { r -= w[k]; if (r <= 0) return k; } return Object.keys(w)[0]; };

export class Economy {
  constructor() { this.s = this.load(); this.listeners = []; this.tickEnergy(); }
  onChange(fn) { this.listeners.push(fn); }
  emit() { this.save(); for (const f of this.listeners) f(this.s); }
  fresh() {
    return {
      created: now(), name: '보스', gold: 12000, gems: 1500, energy: ENERGY.max, energyT: now(), tickets: 5, ssrTickets: 0, sweep: 3, stones: 12, stones2: 0, stones3: 0, fragments: 0, protect: 1, bless: 1,
      heroes: { knight: { level: 1, exp: 0, star: 1, shards: 0, skills: [1, 1, 1, 1, 1, 1], equip: { weapon: null, armor: null, ring: null, boots: null } } },
      selected: 'knight', inventory: [], invSeq: 1,
      progress: { unlocked: 1, stars: {} }, // stars['1-1'] = 3
      pity: 0, totalPulls: 0, firstPurchaseUsed: {}, purchases: [], spentKRW: 0, vip: 0, vipUntil: 0, monthlyUntil: 0, monthlyClaimed: 0,
      pass: { xp: 0, premium: false, claimedFree: [], claimedPrem: [] },
      daily: { day: 0, last: 0 }, mail: [{ id: 1, title: '환영합니다, 보스님!', body: '사전등록 보상이 도착했습니다.', rewards: { gems: 500, tickets: 3 }, read: false }],
      quests: { kills: 0, stages: 0, pulls: 0, claimed: [] }, settings: { sfx: true, music: true, haptics: true, voice: true, quality: 'auto', camera: 'auto' }, limitedStart: now(),
    };
  }
  load() { try { const raw = localStorage.getItem(KEY); if (raw) { const s = JSON.parse(raw); return this.migrate({ ...this.fresh(), ...s }); } } catch (e) {} return this.fresh(); }
  /** 구 세이브 보정 — 각성 슬롯이 늘어나면 스킬 레벨 배열도 늘려 준다 */
  migrate(s) {
    for (const id in s.heroes) { const h = s.heroes[id]; const need = (HEROES[id]?.skills.length) || 4; if (!Array.isArray(h.skills)) h.skills = []; while (h.skills.length < need) h.skills.push(1); }
    return s;
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch (e) {} }
  reset() { localStorage.removeItem(KEY); this.s = this.fresh(); this.emit(); }

  // ---------- 화폐 ----------
  get isVip() { return this.s.vipUntil > now(); }
  get energyMax() { return ENERGY.max + (this.isVip ? 50 : 0); }
  tickEnergy() {
    const s = this.s; const max = this.energyMax; if (s.energy >= max) { s.energyT = now(); return; }
    const gained = Math.floor((now() - s.energyT) / (ENERGY.regenSec * 1000));
    if (gained > 0) { s.energy = Math.min(max, s.energy + gained); s.energyT += gained * ENERGY.regenSec * 1000; if (s.energy >= max) s.energyT = now(); }
  }
  energyTimer() { const s = this.s; if (s.energy >= this.energyMax) return ''; const left = ENERGY.regenSec * 1000 - (now() - s.energyT) % (ENERGY.regenSec * 1000); const m = Math.floor(left / 60000), sec = Math.floor((left % 60000) / 1000); return `${m}:${sec.toString().padStart(2, '0')}`; }
  spendEnergy(n) { this.tickEnergy(); if (this.s.energy < n) return false; if (this.s.energy >= this.energyMax) this.s.energyT = now(); this.s.energy -= n; this.emit(); return true; }
  addRewards(r, opts = {}) {
    const s = this.s; const got = [];
    if (r.gold) { const g = Math.floor(r.gold * (this.isVip ? 1.3 : 1)); s.gold += g; got.push({ k: 'gold', n: g }); }
    if (r.gems) { s.gems += r.gems; got.push({ k: 'gems', n: r.gems }); }
    if (r.energy) { s.energy = Math.min(this.energyMax + 200, s.energy + r.energy); got.push({ k: 'energy', n: r.energy }); }
    if (r.tickets) { s.tickets += r.tickets; got.push({ k: 'tickets', n: r.tickets }); }
    if (r.ssrTicket) { s.ssrTickets += r.ssrTicket; got.push({ k: 'ssrTicket', n: r.ssrTicket }); }
    if (r.sweep) { s.sweep += r.sweep; got.push({ k: 'sweep', n: r.sweep }); }
    if (r.stones) { s.stones += r.stones; got.push({ k: 'stones', n: r.stones }); }
    if (r.stones2) { s.stones2 = (s.stones2 || 0) + r.stones2; got.push({ k: 'stones2', n: r.stones2 }); }
    if (r.stones3) { s.stones3 = (s.stones3 || 0) + r.stones3; got.push({ k: 'stones3', n: r.stones3 }); }
    if (r.fragments) { s.fragments = (s.fragments || 0) + r.fragments; got.push({ k: 'fragments', n: r.fragments }); }
    if (r.protect) { s.protect += r.protect; got.push({ k: 'protect', n: r.protect }); }
    if (r.bless) { s.bless += r.bless; got.push({ k: 'bless', n: r.bless }); }
    if (r.monthly) { s.monthlyUntil = Math.max(now(), s.monthlyUntil) + r.monthly * 86400000; got.push({ k: 'monthly', n: r.monthly }); }
    if (r.vipDays) { s.vipUntil = Math.max(now(), s.vipUntil) + r.vipDays * 86400000; s.vip = Math.max(s.vip, 1); got.push({ k: 'vip', n: r.vipDays }); }
    if (r.ssrGear) { for (let i = 0; i < r.ssrGear; i++) { const it = this.addItem('SSR'); got.push({ k: 'item', item: it }); } }
    if (!opts.silent) this.emit();
    return got;
  }
  // ---------- 영웅 ----------
  hero(id = this.s.selected) { return this.s.heroes[id]; }
  ownHero(id) { return !!this.s.heroes[id]; }
  heroEquipBonus(id) {
    const h = this.hero(id); const b = { atk: 0, hp: 0, def: 0, crit: 0, atkPct: 0, hpPct: 0, critDmg: 0, ultGain: 0, sets: {}, procs: [] };
    for (const sl of SLOTS) { const iid = h.equip[sl]; const inst = this.s.inventory.find((x) => x.uid === iid); if (inst) { const st = itemStats(inst); b.atk += st.atk; b.hp += st.hp; b.def += st.def; b.crit += st.crit; const set = ITEM_BY_ID[inst.id].set; b.sets[set] = (b.sets[set] || 0) + 1; } }
    b.active = [];
    for (const sid in b.sets) {
      const n = b.sets[sid]; const S = SETS[sid]; if (!S) continue;
      const apply = (o, tier) => { b.atkPct += o.atk || 0; b.hpPct += o.hp || 0; b.crit += o.crit || 0; b.critDmg += o.critDmg || 0; b.ultGain += o.ultGain || 0; for (const pr of o.procs || []) if (!b.procs.includes(pr)) b.procs.push(pr); b.active.push({ set: S, tier, n }); };
      if (n >= 4) apply(S.four, 4); else if (n >= 2) apply(S.two, 2);
    }
    return b;
  }
  /** 출전 영웅에게 켜진 세트 효과 수 (하네스 setProgress 박자) */
  setCount() { return this.heroEquipBonus(this.s.selected).active.length; }
  /** 세트 조각으로 테마 세트 장비 제작 */
  craftSetItem(setId, slot) {
    const def = craftable(setId, slot); if (!def) return { ok: false, reason: 'none' };
    if ((this.s.fragments || 0) < CRAFT_COST) return { ok: false, reason: 'fragments' };
    this.s.fragments -= CRAFT_COST;
    const inst = { uid: this.s.invSeq++, id: def.id, enh: 0 }; this.s.inventory.push(inst); this.emit(); return { ok: true, inst };
  }
  /** 슬롯별 장착 인스턴스 (외형용) */
  heroEquipInsts(id) { const h = this.hero(id); const o = {}; for (const sl of SLOTS) o[sl] = this.s.inventory.find((x) => x.uid === h.equip[sl]) || null; return o; }
  heroPower(id) { return heroStats(HEROES[id], this.hero(id), this.heroEquipBonus(id)).power; }
  addHeroExp(id, exp) { const h = this.hero(id); h.exp += exp; let ups = 0; while (h.exp >= levelExp(h.level) && h.level < 80) { h.exp -= levelExp(h.level); h.level++; ups++; } this.emit(); return ups; }
  levelUpHero(id) { const h = this.hero(id); const cost = levelGold(h.level); if (this.s.gold < cost || h.level >= 80) return false; this.s.gold -= cost; h.level++; this.emit(); return true; }
  promoteHero(id) { const h = this.hero(id); const need = starShards(h.star); if (h.shards < need || h.star >= 5) return false; h.shards -= need; h.star++; this.emit(); return true; }
  upgradeSkill(id, i) { const h = this.hero(id); const cost = skillUpGold(h.skills[i]); if (this.s.gold < cost || h.skills[i] >= 10) return false; this.s.gold -= cost; h.skills[i]++; this.emit(); return true; }
  grantHero(id) { if (this.s.heroes[id]) { this.s.heroes[id].shards += 10; return { dup: true }; } this.s.heroes[id] = { level: 1, exp: 0, star: 1, shards: 0, skills: [1, 1, 1, 1, 1, 1], equip: { weapon: null, armor: null, ring: null, boots: null } }; return { dup: false }; }
  // ---------- 장비 ----------
  addItem(rarity, slot = null) {
    slot = slot || SLOTS[Math.floor(Math.random() * SLOTS.length)];
    if (GACHA_ITEM_RARITY[rarity]) rarity = GACHA_ITEM_RARITY[rarity];   // 가챠 등급(R/SR/SSR) → 장비 등급
    const pool = ITEM_POOL[slot].filter((x) => x.rarity === rarity);
    const def = pool.length ? pool[Math.floor(Math.random() * pool.length)] : ITEM_POOL[slot][0];
    const inst = { uid: this.s.invSeq++, id: def.id, enh: 0 }; this.s.inventory.push(inst); return inst;
  }
  equip(heroId, uid) { const inst = this.s.inventory.find((x) => x.uid === uid); if (!inst) return; const slot = ITEM_BY_ID[inst.id].slot; for (const hid in this.s.heroes) { const e = this.s.heroes[hid].equip; if (e[slot] === uid) e[slot] = null; } this.hero(heroId).equip[slot] = uid; this.emit(); }
  unequip(heroId, slot) { this.hero(heroId).equip[slot] = null; this.emit(); }
  /** 강화: +8까지 100%, 이후 확률/파괴. protect=보호주문서(파괴 방지), bless=축복(성공률 +20%) */
  enhance(uid, { protect = false, bless = false } = {}) {
    const inst = this.s.inventory.find((x) => x.uid === uid); if (!inst || inst.enh >= ENH_MAX) return { ok: false, reason: 'max' };
    const lv = inst.enh; const cost = enhanceCost(lv), stones = enhanceStones(lv);
    if (this.s.gold < cost) return { ok: false, reason: 'gold' };
    const sk = STONE_KEY[enhanceStoneTier(lv)];
    if ((this.s[sk] || 0) < stones) return { ok: false, reason: 'stones', tier: enhanceStoneTier(lv) };
    if (protect && this.s.protect <= 0) return { ok: false, reason: 'protect' };
    if (bless && this.s.bless <= 0) return { ok: false, reason: 'bless' };
    this.s.gold -= cost; this.s[sk] -= stones; if (protect) this.s.protect--; if (bless) this.s.bless--;
    let chance = enhanceChance(lv) + (bless ? 0.2 : 0); const success = Math.random() < chance;
    let destroyed = false, down = 0;
    if (success) inst.enh++;
    else {
      if (!protect && Math.random() < destroyChance(lv)) { destroyed = true; this.s.inventory.splice(this.s.inventory.indexOf(inst), 1); for (const hid in this.s.heroes) { const e = this.s.heroes[hid].equip; for (const sl of SLOTS) if (e[sl] === uid) e[sl] = null; } }
      else if (enhanceDown(lv)) { down = enhanceDown(lv); inst.enh -= down; }
    }
    this.s.quests.enh = (this.s.quests.enh || 0) + 1;
    this.emit(); return { ok: true, success, destroyed, down, enh: destroyed ? lv : inst.enh, chance };
  }
  sellItem(uid) { const i = this.s.inventory.findIndex((x) => x.uid === uid); if (i < 0) return; const inst = this.s.inventory[i]; const r = ITEM_BY_ID[inst.id].rarity; const gold = RARITY_INFO[r]?.sell || 200; for (const hid in this.s.heroes) { const e = this.s.heroes[hid].equip; for (const sl of SLOTS) if (e[sl] === uid) e[sl] = null; } this.s.inventory.splice(i, 1); this.s.gold += gold; this.emit(); return gold; }
  /** 필드 드랍 아이템 (즉시 인벤토리) */
  fieldDrop(rarity) { const it = this.addItem(rarity); this.save(); return it; }
  // ---------- 스테이지 ----------
  stageKey(ch, st) { return `${ch}-${st}`; }
  stageIndex(ch, st) { return (ch - 1) * STAGES_PER_CHAPTER + st; }
  isUnlocked(ch, st) { return this.stageIndex(ch, st) <= this.s.progress.unlocked; }
  nextStage() { const idx = Math.min(this.s.progress.unlocked, CHAPTERS.length * STAGES_PER_CHAPTER); const ch = Math.ceil(idx / STAGES_PER_CHAPTER), st = ((idx - 1) % STAGES_PER_CHAPTER) + 1; return stageDef(ch, st); }
  completeStage(stage, stars, { double = false, fieldGold = 0, fieldStones = 0, fieldStones2 = 0, fieldStones3 = 0, fieldFragments = 0, fieldLoot = [] } = {}) {
    const s = this.s; const key = this.stageKey(stage.ch, stage.st); const first = !s.progress.stars[key];
    s.progress.stars[key] = Math.max(s.progress.stars[key] || 0, stars);
    if (stage.idx >= s.progress.unlocked) s.progress.unlocked = Math.min(CHAPTERS.length * STAGES_PER_CHAPTER, stage.idx + 1);
    const m = double ? 2 : 1; const r = stage.rewards; const loot = [];
    // 필드 드랍(전투 중 획득한 골드/강화석)은 여기서 정산. 장비는 이미 인벤토리에 들어감.
    const got = this.addRewards({ gold: r.gold * m + fieldGold * m, gems: first ? r.firstGems : 0, stones: (r.stones || 0) * m + fieldStones, stones2: fieldStones2 * m, stones3: fieldStones3 * m, fragments: fieldFragments * m + (stage.boss ? 5 : 0) }, { silent: true });
    for (const l of fieldLoot) loot.push(l);
    if (double && Math.random() < r.dropChance) { loot.push(this.addItem(pickWeighted(RARITY_WEIGHT_STAGE))); }
    if (stage.boss && Math.random() < 0.3) { s.tickets += 1; got.push({ k: 'tickets', n: 1 }); }
    const prevLv = this.hero(s.selected).level;
    const ups = this.addHeroExp(s.selected, r.exp * m);
    const nowLv = this.hero(s.selected).level;
    // 이번 판에 넘긴 각성 구간
    const awakened = (HEROES[s.selected].skills || []).filter((k) => k.unlock && prevLv < k.unlock && nowLv >= k.unlock);
    const passUps = this.addPassXp(r.bp);
    s.quests.stages++; this.emit();
    return { got, loot, ups, passUps, first, exp: r.exp * m, awakened };
  }
  sweep(stage) { const s = this.s; if (s.sweep <= 0 || (s.progress.stars[this.stageKey(stage.ch, stage.st)] || 0) < 3) return null; if (!this.spendEnergy(stage.energy)) return null; s.sweep--; return this.completeStage(stage, 3); }
  // ---------- 가챠 ----------
  pull(n) {
    const s = this.s; const cost = n === 10 ? GACHA.ten : GACHA.single;
    if (n === 1 && s.tickets > 0) s.tickets--; else if (n === 10 && s.tickets >= 10) s.tickets -= 10; else { if (s.gems < cost) return null; s.gems -= cost; }
    const results = []; let srGuaranteed = false;
    for (let i = 0; i < n; i++) {
      s.pity++; s.totalPulls++; s.quests.pulls++;
      let rar; const soft = s.pity > GACHA.softPity ? (s.pity - GACHA.softPity) * 6 : 0;
      if (s.pity >= GACHA.pity) rar = 'SSR'; else rar = pickWeighted({ R: RARITY_WEIGHT_GACHA.R, SR: RARITY_WEIGHT_GACHA.SR, SSR: RARITY_WEIGHT_GACHA.SSR + soft });
      if (n === 10 && i === 9 && !srGuaranteed && rar === 'R') rar = 'SR';
      if (rar !== 'R') srGuaranteed = true;
      if (rar === 'SSR') s.pity = 0;
      results.push(this.rollResult(rar));
    }
    this.emit(); return results;
  }
  pullSSR() { const s = this.s; if (s.ssrTickets <= 0) return null; s.ssrTickets--; const r = this.rollResult('SSR', true); this.emit(); return [r]; }
  rollResult(rar, heroOnly = false) {
    // SSR: 50% 픽업 영웅, 25% 다른 SSR 영웅, 25% SSR 장비 / SR: 50% 영웅, 50% 장비 / R: 장비
    const heroesOf = (r) => HERO_ORDER.filter((h) => HEROES[h].rarity === r);
    if (rar === 'SSR') { const r = Math.random(); if (heroOnly || r < 0.75) { const id = (r < 0.5 || heroOnly) ? GACHA.featured : heroesOf('SSR')[Math.floor(Math.random() * heroesOf('SSR').length)]; const g = this.grantHero(id); return { type: 'hero', rar, id, dup: g.dup, name: HEROES[id].name, img: HEROES[id].portrait }; } return { type: 'item', rar, item: this.addItem('SSR') }; }
    if (rar === 'SR') { if (Math.random() < 0.5) { const hs = heroesOf('SR'); const id = hs[Math.floor(Math.random() * hs.length)]; const g = this.grantHero(id); return { type: 'hero', rar, id, dup: g.dup, name: HEROES[id].name, img: HEROES[id].portrait }; } return { type: 'item', rar, item: this.addItem('SR') }; }
    return { type: 'item', rar: 'R', item: this.addItem('R') };
  }
  // ---------- 상점 (목업 결제) ----------
  sku(id) { return SKUS.find((x) => x.id === id); }
  limitedLeft(sku) { if (!sku.limited) return 0; const end = this.s.limitedStart + sku.hours * 3600000; return Math.max(0, end - now()); }
  purchase(id) {
    const sku = this.sku(id); const s = this.s; if (!sku) return null;
    if (sku.kind === 'gem') { if (s.gems < sku.price) return { ok: false, reason: 'gems' }; s.gems -= sku.price; const got = this.addRewards(sku.rewards); return { ok: true, got }; }
    if (sku.once && s.purchases.includes(id)) return { ok: false, reason: 'once' };
    // cash (목업): 첫 결제 2배 보너스
    s.purchases.push(id); s.spentKRW += sku.price;
    const vipBefore = s.vip; s.vip = s.spentKRW >= 300000 ? 5 : s.spentKRW >= 100000 ? 4 : s.spentKRW >= 50000 ? 3 : s.spentKRW >= 20000 ? 2 : s.spentKRW > 0 ? 1 : 0;
    let got;
    if (sku.gems) { const first = !s.firstPurchaseUsed[id]; s.firstPurchaseUsed[id] = true; got = this.addRewards({ gems: sku.gems + (first ? sku.bonus : Math.floor(sku.gems * 0.1)) }); got.first = first; }
    else got = this.addRewards(sku.rewards);
    this.emit(); return { ok: true, got, vipUp: s.vip > vipBefore ? s.vip : 0 };
  }
  claimMonthly() { const s = this.s; if (s.monthlyUntil < now()) return false; const day = Math.floor(now() / 86400000); if (s.monthlyClaimed === day) return false; s.monthlyClaimed = day; this.addRewards({ gems: 100 }); return true; }
  // ---------- 배틀패스 ----------
  get passLevel() { return Math.min(BATTLE_PASS.maxLevel, Math.floor(this.s.pass.xp / BATTLE_PASS.xpPerLevel) + 1); }
  addPassXp(xp) { const before = this.passLevel; this.s.pass.xp += xp; return this.passLevel - before; }
  buyPass() { this.s.pass.premium = true; this.s.spentKRW += BATTLE_PASS.price; this.s.purchases.push('pass'); this.emit(); }
  claimPass(lv, prem) { const p = this.s.pass; const arr = prem ? p.claimedPrem : p.claimedFree; if (arr.includes(lv) || lv > this.passLevel || (prem && !p.premium)) return null; arr.push(lv); const r = PASS_TRACK[lv - 1][prem ? 'prem' : 'free']; return this.addRewards(r); }
  passClaimable() { const p = this.s.pass; let n = 0; for (let lv = 1; lv <= this.passLevel; lv++) { if (!p.claimedFree.includes(lv)) n++; if (p.premium && !p.claimedPrem.includes(lv)) n++; } return n; }
  // ---------- 출석 ----------
  dailyAvailable() { const d = Math.floor(now() / 86400000); return this.s.daily.last !== d; }
  claimDaily() { if (!this.dailyAvailable()) return null; const s = this.s; const d = Math.floor(now() / 86400000); s.daily.last = d; const idx = s.daily.day % DAILY_REWARDS.length; s.daily.day++; return { idx, got: this.addRewards(DAILY_REWARDS[idx]) }; }
  // ---------- 우편 ----------
  claimMail(id) { const m = this.s.mail.find((x) => x.id === id); if (!m || m.read) return null; m.read = true; return this.addRewards(m.rewards); }
  unreadMail() { return this.s.mail.filter((m) => !m.read).length; }
  // ---------- 임무 ----------
  quests() {
    const q = this.s.quests; return [
      { id: 'k30', name: '적 30마리 처치', cur: q.kills, max: 30, r: { gems: 100 } }, { id: 'k100', name: '적 100마리 처치', cur: q.kills, max: 100, r: { gems: 300, tickets: 1 } },
      { id: 's3', name: '스테이지 3회 클리어', cur: q.stages, max: 3, r: { gold: 20000 } }, { id: 's10', name: '스테이지 10회 클리어', cur: q.stages, max: 10, r: { gems: 200, sweep: 3 } },
      { id: 'p10', name: '소환 10회', cur: q.pulls, max: 10, r: { tickets: 3 } },
    ].map((x) => ({ ...x, done: x.cur >= x.max, claimed: q.claimed.includes(x.id) }));
  }
  claimQuest(id) { const q = this.quests().find((x) => x.id === id); if (!q || !q.done || q.claimed) return null; this.s.quests.claimed.push(id); return this.addRewards(q.r); }
  questClaimable() { return this.quests().filter((q) => q.done && !q.claimed).length; }
}

export const REWARD_LABEL = { gold: ['골드', '/img/icon_gold.webp'], gems: ['보석', '/img/icon_gem.webp'], energy: ['에너지', '/img/icon_energy.webp'], tickets: ['소환권', '/img/icon_ticket.webp'], ssrTicket: ['SSR 확정권', '/img/icon_ticket_ssr.webp'], sweep: ['소탕권', '/img/icon_sweep.webp'], stones: ['강화석', '/img/icon_stone_1.webp'], stones2: ['상급 강화석', '/img/icon_stone_2.webp'], stones3: ['전설 강화석', '/img/icon_stone_3.webp'], fragments: ['세트 조각', '/img/icon_fragment.webp'], protect: ['보호 주문서', '/img/icon_protect.webp'], bless: ['축복 주문서', '/img/icon_bless.webp'], monthly: ['월정액(일)', '/img/icon_gem.webp'], vip: ['VIP(일)', '/img/icon_vip.webp'] };
