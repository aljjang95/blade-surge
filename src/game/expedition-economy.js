import { DUNGEONS, ARENA_RIVALS, MATERIALS, MATERIAL_REFINING, CONSUMABLES, JOBS, RECIPES, EXPEDITION_QUESTS, accountLevelXp } from '../data/expansion.js';
import { ITEM_BY_ID } from '../data/items.js';
const find = (list, id) => list.find(x => x.id === id);
const obj = x => x && typeof x === 'object' && !Array.isArray(x) ? x : {};
const num = (x, fallback = 0) => Number.isSafeInteger(x) && x >= 0 ? Math.min(x, 100000000) : fallback;
const counts = (defs, raw) => Object.fromEntries(defs.map(x => [x.id, num(obj(raw)[x.id])]));
const statKeys = ['welcome', 'campaignWins', 'dungeonWins', 'arenaWins', 'crafts', 'consumed', ...DUNGEONS.map(x => x.id)];
export function normalizeExpedition(raw) {
  const r = obj(raw), unlockedJobs = JOBS.filter(j => Array.isArray(r.unlockedJobs) && r.unlockedJobs.includes(j.id)).map(j => j.id);
  const p = obj(r.pending);
  return { version: 1, level: Math.max(1, Math.min(50, num(r.level, 1))), xp: num(r.xp), rating: num(r.rating),
    materials: counts(MATERIALS, r.materials), consumables: raw ? counts(CONSUMABLES, r.consumables) : { hp_tonic: 3, overdrive: 1, aegis: 1 },
    stats: Object.fromEntries(statKeys.map(k => [k, k === 'welcome' ? 1 : num(obj(r.stats)[k])])),
    claimed: EXPEDITION_QUESTS.filter(q => Array.isArray(r.claimed) && r.claimed.includes(q.id)).map(q => q.id), unlockedJobs,
    selectedJob: unlockedJobs.includes(r.selectedJob) ? r.selectedJob : null, seq: num(r.seq),
    campaignReceipts: [...new Set((Array.isArray(r.campaignReceipts) ? r.campaignReceipts : []).filter(x => typeof x === 'string' && x.length <= 120))],
    pending: Number.isSafeInteger(p.id) && p.id > 0 && ['dungeon', 'arena'].includes(p.kind) && find(p.kind === 'dungeon' ? DUNGEONS : ARENA_RIVALS, p.target) ? { id: p.id, kind: p.kind, target: p.target, energy: p.kind === 'dungeon' ? 4 : 0 } : null };
}
export class ExpeditionEconomy {
  constructor(eco) {
    this.eco = eco; this.receipts = new WeakSet();
    eco.s.expedition = normalizeExpedition(eco.s.expedition);
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
  dungeonAccess(id) { const d = find(DUNGEONS, id); return { ok: !!d && this.s.level >= d.minLevel, error: !d ? '알 수 없는 던전입니다.' : this.s.level < d.minLevel ? `탐험 레벨 ${d.minLevel} 필요` : null }; }
  begin(kind, id) {
    const d = find(kind === 'dungeon' ? DUNGEONS : kind === 'arena' ? ARENA_RIVALS : [], id);
    if (!d) return { ok: false, error: '알 수 없는 전투입니다.' };
    if (this.s.pending) return { ok: false, error: '진행 중인 전투를 먼저 마쳐 주세요.' };
    if (this.s.level < d.minLevel) return { ok: false, error: `탐험 레벨 ${d.minLevel} 필요` };
    return this.transact(() => {
      this.eco.tickEnergy();
      if (this.eco.s.energy < d.energy) return { ok: false, error: '에너지가 부족합니다.' };
      if (this.eco.s.energy >= this.eco.energyMax) this.eco.s.energyT = Date.now();
      this.eco.s.energy -= d.energy;
      const ticket = { id: ++this.s.seq, kind, target: id, energy: d.energy, heroId: this.eco.s.selected };
      this.s.pending = ticket;
      return { ok: true, ticket: { ...ticket } };
    });
  }
  valid(ticket) { const p = this.s.pending; return !!p && p.id === ticket?.id && p.kind === ticket?.kind && p.target === ticket?.target; }
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
    return this.transact(() => {
      const p = this.s.pending, def = find(p.kind === 'dungeon' ? DUNGEONS : ARENA_RIVALS, p.target);
      this.s.pending = null;
      if (!result.win) return { ok: true, win: false, rewards: {} };
      this.s.stats[p.kind === 'dungeon' ? 'dungeonWins' : 'arenaWins']++;
      if (p.kind === 'dungeon') this.s.stats[p.target]++;
      const rewards = this.reward(def.rewards);
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
    if (!/^[1-5]-(?:[1-9]|10)$/.test(code)) return { ok: false, error: '캠페인 스테이지가 아닙니다.' };
    const id = typeof result.receiptId === 'string' && result.receiptId.length > 0 && result.receiptId.length <= 100 ? `run:${result.receiptId}` : `first:${code}`;
    if (this.s.campaignReceipts.includes(id)) return { ok: false, error: '이미 기록한 승리입니다.' };
    const out = this.transact(() => { this.s.campaignReceipts.push(id); this.s.stats.campaignWins++; return { ok: true, rewards: this.reward({ xp: 35 }) }; });
    if (out.ok) this.receipts.add(result);
    return out;
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
