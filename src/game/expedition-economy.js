import { DUNGEONS, ARENA_RIVALS, MATERIALS, MATERIAL_REFINING, CONSUMABLES, JOBS, RECIPES, EXPEDITION_QUESTS, accountLevelXp } from '../data/expansion.js';
import { ITEM_BY_ID } from '../data/items.js';
import { CHAPTERS, STAGES_PER_CHAPTER } from '../data/stages.js';
import { normalizeJourney, refreshPeriods, recordJourneyWin } from './journey-core.js';
import { riftForDay, riftBonus } from './journey-rifts.js';
import { EXPEDITION_DEPTHS, expeditionDepth } from '../data/expedition-depths.js';
import { EXPEDITION_CONQUESTS, expeditionConquest, conquestForRun } from '../data/expedition-conquests.js';
import { readConquestOutcome } from './expedition-conquests.js';
const find = (list, id) => list.find(x => x.id === id);
const obj = x => x && typeof x === 'object' && !Array.isArray(x) ? x : {};
const num = (x, fallback = 0) => Number.isSafeInteger(x) && x >= 0 ? Math.min(x, 100000000) : fallback;
const counts = (defs, raw) => Object.fromEntries(defs.map(x => [x.id, num(obj(raw)[x.id])]));
const mode = depth => depth === undefined ? 'standard' : depth;
const validDepth = depth => ['standard', 'deep'].includes(mode(depth));
function depthRewards(def, firstClear) {
  const rewards = structuredClone(def.rewards);
  if (firstClear) for (const [key, value] of Object.entries(def.firstRewards)) {
    if (key === 'materials' || key === 'consumables') {
      rewards[key] ||= {};
      for (const [id, amount] of Object.entries(value)) rewards[key][id] = (rewards[key][id] || 0) + amount;
    } else rewards[key] = (rewards[key] || 0) + value;
  }
  return rewards;
}
const statKeys = ['welcome', 'campaignWins', 'dungeonWins', 'arenaWins', 'crafts', 'consumed', ...DUNGEONS.map(x => x.id)];
export function normalizeExpedition(raw) {
  const r = obj(raw), unlockedJobs = JOBS.filter(j => Array.isArray(r.unlockedJobs) && r.unlockedJobs.includes(j.id)).map(j => j.id);
  const p = obj(r.pending), depth = mode(p.depth);
  const pendingDef = depth === 'deep' && p.kind === 'dungeon' ? expeditionDepth(p.target) : depth === 'standard' ? find(p.kind === 'dungeon' ? DUNGEONS : ARENA_RIVALS, p.target) : null;
  return { version: 1, level: Math.max(1, Math.min(50, num(r.level, 1))), xp: num(r.xp), rating: num(r.rating),
    materials: counts(MATERIALS, r.materials), consumables: raw ? counts(CONSUMABLES, r.consumables) : { hp_tonic: 3, overdrive: 1, aegis: 1 },
    stats: Object.fromEntries(statKeys.map(k => [k, k === 'welcome' ? 1 : num(obj(r.stats)[k])])),
    depthWins: counts(EXPEDITION_DEPTHS, r.depthWins),
    conquests: EXPEDITION_CONQUESTS.filter(c => Array.isArray(r.conquests) && r.conquests.includes(c.id)).map(c => c.id),
    claimed: EXPEDITION_QUESTS.filter(q => Array.isArray(r.claimed) && r.claimed.includes(q.id)).map(q => q.id), unlockedJobs,
    selectedJob: unlockedJobs.includes(r.selectedJob) ? r.selectedJob : null, seq: num(r.seq),
    campaignReceipts: [...new Set((Array.isArray(r.campaignReceipts) ? r.campaignReceipts : []).filter(x => typeof x === 'string' && x.length <= 120))],
    pending: Number.isSafeInteger(p.id) && p.id > 0 && ['dungeon', 'arena'].includes(p.kind) && pendingDef && !(depth === 'deep' && p.riftId) && (p.conquestId == null || conquestForRun(p.target, depth, p.conquestId)) ? { id: p.id, kind: p.kind, target: p.target, depth, energy: pendingDef.energy, ...(p.conquestId ? { conquestId: p.conquestId } : {}) } : null };
}
export class ExpeditionEconomy {
  constructor(eco) {
    this.eco = eco; this.receipts = new WeakSet(); this.conquestTickets = new WeakSet();
    eco.s.expedition = normalizeExpedition(eco.s.expedition);
    eco.s.journey = normalizeJourney(eco.s.journey);
    // A page reload cancels an unfinished start once; no durable payable ticket survives.
    if (this.s.pending) { this.s.seq = Math.max(this.s.seq, this.s.pending.id); this.eco.s.energy += this.s.pending.energy; this.s.pending = null; this.eco.rollbackEnergy({ energy: eco.s.energy, energyT: eco.s.energyT }); }
  }
  get s() { return this.eco.s.expedition; }
  snapshot() {
    return { ...structuredClone(this.s), nextXp: accountLevelXp(this.s.level), quests: EXPEDITION_QUESTS.map(q => ({ ...q, cur: this.s.stats[q.stat], ready: this.s.stats[q.stat] >= q.target && !this.s.claimed.includes(q.id), claimed: this.s.claimed.includes(q.id) })) };
  }
  transact(fn) {
    const before = structuredClone(this.eco.s);
    let result;
    try { result = fn(); } catch (err) { this.eco.s = before; throw err; }
    if (!result.ok) { this.eco.s = before; return result; }
    if (!this.eco.save()) { this.eco.s = before; return { ok: false, error: '저장 공간을 확인해 주세요.' }; }
    // Keep the recovery slot on the same receipt state so corrupt-primary recovery
    // cannot resurrect an already settled/refunded ticket or a claimed quest.
    if (!this.eco.rollbackEnergy({ energy: this.eco.s.energy, energyT: this.eco.s.energyT })) result.storageWarning = '진행은 저장됐지만 복구 백업을 갱신하지 못했습니다.';
    for (const listener of this.eco.listeners) listener(this.eco.s);
    return result;
  }
  dungeonAccess(id, { depth = 'standard' } = {}) {
    if (!validDepth(depth)) return { ok: false, error: '알 수 없는 원정 단계입니다.' };
    const d = depth === 'deep' ? expeditionDepth(id) : find(DUNGEONS, id);
    const error = !d ? '알 수 없는 던전입니다.' : this.s.level < d.minLevel ? `탐험 레벨 ${d.minLevel} 필요`
      : depth === 'deep' && !(Number(this.eco.s.progress?.stars?.[d.unlockCode]) >= 1) ? `캠페인 ${d.unlockCode} 클리어 필요`
      : depth === 'deep' && !this.s.stats[id] ? '기본 원정을 먼저 클리어해 주세요.' : null;
    return { ok: !error, error };
  }
  conquestAccess(conquestId) {
    const c = expeditionConquest(conquestId);
    if (!c) return { ok: false, error: '알 수 없는 전술 공략입니다.' };
    const access = this.dungeonAccess(c.dungeonId, { depth: 'deep' });
    if (!access.ok) return access;
    const error = !this.s.depthWins[c.dungeonId] ? '이 지역의 심층 원정 클리어 필요'
      : c.previous && !this.s.conquests.includes(c.previous) ? `먼저 「${expeditionConquest(c.previous).name}」 달성` : null;
    return { ok: !error, error };
  }
  /** @param {string} kind @param {string} id @param {{rift?: boolean, depth?: string, conquestId?: string|null}} [options] */
  begin(kind, id, { rift = false, depth = 'standard', conquestId = null } = {}) {
    if (!validDepth(depth) || (depth === 'deep' && (kind !== 'dungeon' || rift))) return { ok: false, error: '지원하지 않는 원정 단계 조합입니다.' };
    if (conquestId !== null) {
      if (kind !== 'dungeon' || rift || !conquestForRun(id, depth, conquestId)) return { ok: false, error: '전술 공략과 원정 정보가 맞지 않습니다.' };
      const access = this.conquestAccess(conquestId); if (!access.ok) return access;
    }
    const d = depth === 'deep' ? expeditionDepth(id) : find(kind === 'dungeon' ? DUNGEONS : kind === 'arena' ? ARENA_RIVALS : [], id);
    if (!d) return { ok: false, error: '알 수 없는 전투입니다.' };
    if (this.s.pending) return { ok: false, error: '진행 중인 전투를 먼저 마쳐 주세요.' };
    if (kind === 'dungeon') { const access = this.dungeonAccess(id, { depth }); if (!access.ok) return access; }
    if (this.s.level < d.minLevel) return { ok: false, error: `탐험 레벨 ${d.minLevel} 필요` };
    const started = this.transact(() => {
      const period = refreshPeriods(this.eco.s.journey, Date.now());
      const rotation = DUNGEONS[((period.day % 3) + 3) % 3].id;
      if (rift && (kind !== 'dungeon' || id !== rotation)) return { ok: false, error: '오늘의 회전 던전에서 균열에 도전해 주세요.' };
      this.eco.tickEnergy();
      if (this.eco.s.energy < d.energy) return { ok: false, error: '에너지가 부족합니다.' };
      if (this.eco.s.energy >= this.eco.energyMax) this.eco.s.energyT = Date.now();
      this.eco.s.energy -= d.energy;
      const ticket = { id: ++this.s.seq, kind, target: id, depth, energy: d.energy, heroId: this.eco.s.selected };
      if (conquestId) ticket.conquestId = conquestId;
      ticket.journeyPeriod = { day: period.day, week: period.week };
      if (rift) ticket.riftId = riftForDay(period.day).id;
      this.s.pending = ticket;
      return { ok: true, ticket: { ...ticket } };
    });
    if (started.ok && conquestId) this.conquestTickets.add(started.ticket);
    return started;
  }
  valid(ticket) { const p = this.s.pending; return !!p && p.id === ticket?.id && p.kind === ticket?.kind && p.target === ticket?.target && validDepth(ticket?.depth) && mode(p.depth) === mode(ticket?.depth) && (p.conquestId ?? null) === (ticket?.conquestId ?? null) && (!p.conquestId || this.conquestTickets.has(ticket)); }
  abandon(ticket) {
    if (!this.valid(ticket)) return { ok: false, error: '이미 종료된 전투입니다.' };
    return this.transact(() => { this.eco.s.energy += this.s.pending.energy; this.s.pending = null; return { ok: true }; });
  }
  reward(rewards) {
    const r = structuredClone(rewards);
    this.eco.s.gold += r.gold || 0;
    for (const key of ['materials', 'consumables']) for (const [id, value] of Object.entries(r[key] || {})) this.s[key][id] += value;
    this.s.xp += r.xp || 0; this.s.rating += r.rating || 0;
    const oldLevel = this.s.level;
    while (this.s.level < 50 && this.s.xp >= accountLevelXp(this.s.level)) { this.s.xp -= accountLevelXp(this.s.level); this.s.level++; this.eco.s.gold += 150; }
    if (this.s.level === 50) this.s.xp = Math.min(this.s.xp, accountLevelXp(50));
    return { ...r, levelsGained: this.s.level - oldLevel, levelGold: (this.s.level - oldLevel) * 150 };
  }
  settle(ticket, result) {
    if (!this.valid(ticket)) return { ok: false, error: '이미 종료된 전투입니다.' };
    if (typeof result?.win !== 'boolean') return { ok: false, error: '전투 결과가 필요합니다.' };
    const conquest = this.s.pending.conquestId ? expeditionConquest(this.s.pending.conquestId) : null;
    const outcome = conquest ? readConquestOutcome(result.conquest, ticket, result.win) : null;
    if (conquest && result.win && !outcome) return { ok: false, error: '이 출격의 전술 공략 결과가 필요합니다.' };
    return this.transact(() => {
      const p = this.s.pending, deep = p.depth === 'deep', def = deep ? expeditionDepth(p.target) : find(p.kind === 'dungeon' ? DUNGEONS : ARENA_RIVALS, p.target);
      this.s.pending = null;
      if (!result.win) return { ok: true, win: false, rewards: {} };
      this.s.stats[p.kind === 'dungeon' ? 'dungeonWins' : 'arenaWins']++;
      if (p.kind === 'dungeon') this.s.stats[p.target]++;
      const firstClear = deep && this.s.depthWins[p.target] === 0;
      let payout = deep ? depthRewards(def, firstClear) : def.rewards;
      const firstConquest = !!outcome?.complete && !this.s.conquests.includes(conquest.id);
      if (firstConquest) { payout = depthRewards({ rewards: payout, firstRewards: conquest.firstRewards }, true); this.s.conquests.push(conquest.id); }
      const rewards = this.reward(payout);
      if (conquest) rewards.conquest = { id: conquest.id, complete: outcome.complete, firstClear: firstConquest, mark: conquest.mark };
      rewards.firstClear = firstClear;
      if (deep) this.s.depthWins[p.target]++;
      if (p.kind === 'dungeon') {
        refreshPeriods(this.eco.s.journey, Date.now());
        recordJourneyWin(this.eco.s.journey, { receiptId: `dungeon:${p.id}`, dungeonId: p.target, ...p.journeyPeriod });
        if (p.riftId) {
          const bonus = this.reward(riftBonus(p.target)); rewards.gold += bonus.gold;
          for (const [key, count] of Object.entries(bonus.materials)) rewards.materials[key] = (rewards.materials[key] || 0) + count;
          rewards.riftId = p.riftId;
        }
      }
      // Field gear is allocated by Battle.rollDrop already. Only collected field
      // currency is paid here; bounded inputs cannot produce NaN/negative grants.
      // Free AI practice never pays campaign boss drops, even if an old or
      // incorrectly wired battle renderer supplies them in the outcome.
      const field = p.kind === 'dungeon' ? obj(result.fieldRewards) : {}, got = [];
      const limits = { fieldGold: ['gold', 50000], fieldStones: ['stones', 200], fieldStones2: ['stones2', 100], fieldStones3: ['stones3', 50], fieldFragments: ['fragments', 100] };
      for (const [source, [key, cap]] of Object.entries(limits)) {
        const n = Math.min(num(field[source]), cap);
        this.eco.s[key] = (this.eco.s[key] || 0) + n;
        rewards[key] = (rewards[key] || 0) + n;
      }
      for (const key of ['gold', 'stones', 'stones2', 'stones3', 'fragments']) {
        const n = (rewards[key] || 0) + (key === 'gold' ? rewards.levelGold : 0);
        if (n) got.push({ k: key, n });
      }
      const seen = new Set(), inventory = new Map(this.eco.s.inventory.map(item => [item.uid, item]));
      const loot = (p.kind === 'dungeon' && Array.isArray(result.fieldLoot) ? result.fieldLoot : []).filter(item => {
        const stored = inventory.get(item?.uid);
        if (!stored || stored.id !== item.id || seen.has(item.uid)) return false;
        seen.add(item.uid); return true;
      }).map(item => ({ ...inventory.get(item.uid) }));
      const heroId = this.eco.s.heroes[p.heroId] ? p.heroId : this.eco.s.selected;
      const heroExp = def.rewards.xp;
      const ups = this.eco.addHeroExp(heroId, heroExp, { silent: true });
      return { ok: true, win: true, rewards: { ...rewards, got, loot, heroExp, ups, heroId } };
    });
  }
  recordCampaign(result, stage) {
    if (!result || typeof result !== 'object' || result.win !== true || this.receipts.has(result)) return { ok: false, error: '기록할 새 승리가 없습니다.' };
    const code = stage?.code || `${stage?.ch}-${stage?.st}`;
    const match = typeof code === 'string' && /^([1-9]\d*)-([1-9]\d*)$/.exec(code);
    if (!match || match[0] !== code || !CHAPTERS.some(ch => ch.id === Number(match[1])) || Number(match[2]) > STAGES_PER_CHAPTER || stage?.expedition) return { ok: false, error: '캠페인 스테이지가 아닙니다.' };
    const id = typeof result.receiptId === 'string' && result.receiptId.length > 0 && result.receiptId.length <= 100 ? `run:${result.receiptId}` : `first:${code}`;
    if (this.s.campaignReceipts.includes(id)) return { ok: false, error: '이미 기록한 승리입니다.' };
    const out = this.transact(() => { this.s.campaignReceipts.push(id); this.s.stats.campaignWins++; return { ok: true, rewards: this.reward({ xp: 35 }) }; });
    if (out.ok) this.receipts.add(result);
    return out;
  }
  sweepPreview(id, count = 1) {
    const d = find(DUNGEONS, id);
    if (!d || !Number.isInteger(count) || count < 1 || count > 3) return { ok: false, error: '소탕 횟수는 1~3회입니다.' };
    if (!this.s.stats[id]) return { ok: false, error: '이 던전을 실전에서 먼저 클리어해 주세요.' };
    if (this.s.pending) return { ok: false, error: '진행 중인 전투를 먼저 마쳐 주세요.' };
    const rewards = { gold: d.rewards.gold * count, xp: d.rewards.xp * count,
      materials: Object.fromEntries(Object.entries(d.rewards.materials).map(([k, v]) => [k, v * count])),
      consumables: Object.fromEntries(Object.entries(d.rewards.consumables).map(([k, v]) => [k, v * count])) };
    return { ok: true, id, count, energy: d.energy * count, tickets: count, rewards,
      affordable: this.eco.s.energy >= d.energy * count && this.eco.s.sweep >= count };
  }
  sweepDungeon(id, count = 1) {
    return this.transact(() => {
      this.eco.tickEnergy();
      const p = this.sweepPreview(id, count);
      if (!p.ok) return p;
      if (!p.affordable) return { ok: false, error: '에너지 또는 소탕권이 부족합니다.' };
      if (this.eco.s.energy >= this.eco.energyMax) this.eco.s.energyT = Date.now();
      this.eco.s.energy -= p.energy; this.eco.s.sweep -= p.tickets;
      const rewards = this.reward(p.rewards);
      // Supply runs pay fixed materials, account XP and consumables only.
      // No field rolls, hero XP, combat contracts, story or mastery progress.
      return { ok: true, count, energy: p.energy, tickets: p.tickets, rewards };
    });
  }
  claimQuest(id) {
    const q = find(EXPEDITION_QUESTS, id);
    if (!q || this.s.claimed.includes(id) || this.s.stats[q.stat] < q.target) return { ok: false, error: '아직 받을 수 없는 보상입니다.' };
    return this.transact(() => { this.s.claimed.push(id); return { ok: true, rewards: this.reward(q.rewards) }; });
  }
  unlockJob(id) {
    const job = find(JOBS, id);
    if (!job || this.s.unlockedJobs.includes(id) || !this.s.claimed.includes(job.questId)) return { ok: false, error: '직업 해금 퀘스트 보상을 먼저 받아 주세요.' };
    return this.transact(() => { this.s.unlockedJobs.push(id); if (!this.eco.s.heroes[job.heroId]) this.eco.grantHero(job.heroId); return { ok: true }; });
  }
  selectJob(id) {
    if (id !== null && !this.s.unlockedJobs.includes(id)) return { ok: false, error: '잠긴 직업입니다.' };
    return this.transact(() => { this.s.selectedJob = id; if (id) this.eco.s.selected = find(JOBS, id).heroId; return { ok: true }; });
  }
  craft(id) {
    const r = find(RECIPES, id);
    if (!r || this.eco.s.gold < r.gold || Object.entries(r.materials).some(([k, v]) => this.s.materials[k] < v)) return { ok: false, error: '제작 재료 또는 골드가 부족합니다.' };
    return this.transact(() => {
      this.eco.s.gold -= r.gold; for (const [k, v] of Object.entries(r.materials)) this.s.materials[k] -= v;
      let item = null;
      if (r.itemId) { const def = ITEM_BY_ID[r.itemId]; item = this.eco.addItem(def.rarity, def.slot); item.id = def.id; }
      if (r.consumables) this.reward({ consumables: r.consumables });
      this.s.stats.crafts++; return { ok: true, item, consumables: r.consumables || {} };
    });
  }
  refineMaterial(id) {
    const recipe = find(MATERIAL_REFINING, id);
    if (this.s.pending) return { ok: false, error: '전투를 마친 뒤 재료를 정련해 주세요.' };
    if (!recipe || this.s.materials[id] < 1 || this.eco.s.gold < recipe.gold) return { ok: false, error: '정련 재료 또는 골드가 부족합니다.' };
    return this.transact(() => {
      this.s.materials[id]--; this.eco.s.gold -= recipe.gold;
      const got = [];
      for (const key of ['stones', 'stones2', 'stones3']) if (recipe[key]) {
        this.eco.s[key] = (this.eco.s[key] || 0) + recipe[key]; got.push({ k: key, n: recipe[key] });
      }
      return { ok: true, got, materialId: id, materialSpent: 1, goldSpent: recipe.gold };
    });
  }
  consume(id) {
    const c = find(CONSUMABLES, id);
    if (!c || this.s.consumables[id] < 1) return { ok: false, error: '소모품이 부족합니다.' };
    return this.transact(() => { this.s.consumables[id]--; this.s.stats.consumed++; return { ok: true, effect: { ...c.effect } }; });
  }
}
