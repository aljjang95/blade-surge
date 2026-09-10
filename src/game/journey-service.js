import { normalizeJourney, refreshPeriods, journeySteps, contractRows, claimJourneyStep, claimContract, setTargetRecipe } from './journey-core.js';
import { DUNGEONS, RECIPES } from '../data/expansion.js';
import { ITEM_BY_ID } from '../data/items.js';

/** New grants share the workshop's save, rollback and recovery receipt boundary. */
export class JourneyService {
  constructor(app) { this.app = app; this.ensure(); }
  ensure() {
    if (this.state !== this.app.eco.s) {
      this.state = this.app.eco.s; this.state.journey = normalizeJourney(this.state.journey);
    }
    refreshPeriods(this.state.journey, Date.now()); return this.state.journey;
  }
  get s() { return this.ensure(); }
  snapshot() { const s = this.s; return { steps: journeySteps(this.app.eco.s), contracts: contractRows(s, Date.now()), target: this.target(), autoBattle: s.autoBattle }; }
  transact(fn, duringBattle = false) {
    if (this.app.stageStarting || (!duringBattle && (this.app.battle?.active || this.app.expeditionUI?.result?.saveError))) return { ok: false, error: '전투와 전리품 정산을 마친 뒤 이용해 주세요.' };
    return this.app.expedition.transact(() => fn(this.s));
  }
  grant(result) {
    if (!result.ok) return result;
    const r = result.rewards || {};
    this.app.expedition.reward(r);
    for (const key of ['stones', 'stones2', 'stones3', 'sweep']) this.app.eco.s[key] += r[key] || 0;
    return result;
  }
  claimStep(id) { return this.transact(s => this.grant(claimJourneyStep(s, this.app.eco.s, id))); }
  claim(kind, id) { return this.transact(s => this.grant(claimContract(s, kind, id))); }
  track(id) { return this.transact(s => setTargetRecipe(s, id)); }
  setAuto(value) { return this.transact(s => { s.autoBattle = !!value; return { ok: true }; }, true); }
  target() {
    const recipe = RECIPES.find(r => r.id === this.s.targetRecipeId && r.itemId);
    if (!recipe) return null;
    const eco = this.app.eco, item = ITEM_BY_ID[recipe.itemId];
    const owned = eco.s.inventory.filter(i => i.id === item.id).sort((a, b) => b.enh - a.enh)[0];
    const owner = owned && Object.keys(eco.s.heroes).find(id => Object.values(eco.s.heroes[id].equip).includes(owned.uid));
    const materials = Object.entries(recipe.materials).map(([id, need]) => {
      const have = eco.s.expedition.materials[id] || 0, dungeon = DUNGEONS.find(d => d.rewards.materials[id]);
      return { id, need, have, missing: Math.max(0, need - have), dungeonId: dungeon?.id, runs: Math.ceil(Math.max(0, need - have) / (dungeon?.rewards.materials[id] || 1)) };
    });
    return { recipe, item, owned: owned ? { ...owned } : null, owner, equipped: owner === eco.s.selected,
      materials, goldMissing: Math.max(0, recipe.gold - eco.s.gold), ready: eco.s.gold >= recipe.gold && materials.every(m => !m.missing) };
  }
  equipTarget() {
    const target = this.target();
    if (!target?.owned) return { ok: false, error: '목표 장비를 먼저 제작해 주세요.' };
    return this.transact(() => {
      const eco = this.app.eco, slot = target.item.slot, uid = target.owned.uid;
      for (const h of Object.values(eco.s.heroes)) if (h.equip[slot] === uid) h.equip[slot] = null;
      eco.s.heroes[eco.s.selected].equip[slot] = uid; return { ok: true, uid };
    });
  }
}
