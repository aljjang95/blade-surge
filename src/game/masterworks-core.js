import { BOONS, SYNERGIES, MASTERY_NODES, PATHS, CHALLENGES, STORY_EVENTS, BOUNTIES } from '../data/masterworks.js';
const MAX = 1000000;
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const int = (v, max = MAX) => Number.isSafeInteger(v) ? Math.min(max, Math.max(0,v)) : 0;
const list = v => Array.isArray(v) ? v : [];
const ids = (v, defs) => [...new Set(list(v).filter(id => defs.some(d=>d.id===id)))];
const pathId = v => PATHS.some(p=>p.id===v) ? v : 'balanced';
const stats = ['kills','clears','eliteKills','perfects'];
const discoveryKey = key => typeof key === 'string' && (/^campaign:([1-9]|[1-4][0-9]|50)$/.test(key) || /^room:([1-9]|[1-4][0-9]|50):([0-9]|1[0-9]|20)$/.test(key) || /^expedition:(glass_garden|ember_vault|star_archive):([0-9]|1[0-9]|20)$/.test(key));
const err = error => ({ok:false,error});

export function normalizeMasterworks(raw) {
  const r = obj(raw) ? raw : {};
  const earnedRenown = int(r.earnedRenown);
  let spent = 0;
  const unlocked = [];
  // Catalog order is prerequisite order. Invalid / unaffordable nodes never survive migration.
  for (const node of MASTERY_NODES) {
    if (!list(r.unlocked).includes(node.id) || spent + node.cost > earnedRenown) continue;
    if (node.tier > 1 && !unlocked.includes(`${node.path}_${node.tier-1}`)) continue;
    unlocked.push(node.id); spent += node.cost;
  }
  const counts = Object.fromEntries(stats.map(key=>[key,int(r.bounties?.counts?.[key])]));
  const claimed = ids(r.bounties?.claimed,BOUNTIES);
  // Retain receipts even if old counters were missing; never allow an already paid claim again.
  for (const id of claimed) { const b = BOUNTIES.find(b=>b.id===id); counts[b.stat] = Math.max(counts[b.stat],b.target); }
  const story = {};
  for (const event of STORY_EVENTS) if (event.choices.some(c=>c.id===r.story?.[event.id])) story[event.id]=r.story[event.id];
  return {
    version:1, earnedRenown, renown:Math.min(int(r.renown),earnedRenown-spent), unlocked,
    path:pathId(r.path), presets:Array.from({length:3},(_,i)=>({name:typeof r.presets?.[i]?.name === 'string' ? r.presets[i].name.replace(/[\x00-\x1f]/g,'').slice(0,24) : `준비 ${i+1}`,path:pathId(r.presets?.[i]?.path),challengeIds:ids(r.presets?.[i]?.challengeIds,CHALLENGES)})),
    activePreset:int(r.activePreset,2), challengeIds:ids(r.challengeIds,CHALLENGES), bounties:{counts,claimed},
    discoveries:[...new Set(list(r.discoveries).filter(discoveryKey))].slice(0,1200), story,
    history:list(r.history).filter(h=>obj(h)&&['victory','defeat'].includes(h.outcome)).slice(-20).map(h=>({runId:int(h.runId),floor:Math.max(1,int(h.floor,50)),outcome:h.outcome,boonIds:ids(h.boonIds,BOONS)})),runSeq:int(r.runSeq),
  };
}
function ranks(picked) {
  const result = {};
  for (const boon of BOONS) result[boon.id] = Array.isArray(picked) ? Math.min(3,picked.filter(p=>(typeof p==='string'?p:p?.id)===boon.id).length) : int(picked?.[boon.id],3);
  return result;
}
export function boonChoices(seed,picked,round=0) {
  let hash=2166136261;
  for (const c of `${String(seed).slice(0,200)}:${int(round)}`) hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;
  const rank=ranks(picked), pool=BOONS.filter(b=>rank[b.id]<b.maxRank).slice();
  for (let i=pool.length-1;i>0;i--) { hash=(Math.imul(hash,1664525)+1013904223)>>>0; const j=hash%(i+1); [pool[i],pool[j]]=[pool[j],pool[i]]; }
  return pool.slice(0,3);
}
function sumEffects(parts) {
  /** @type {Record<string, number>} */
  const out={};
  for (const part of parts) for (const [k,v] of Object.entries(part)) out[k]=(out[k]||0)+v;
  if(out.chain) out.chain=Math.min(2,out.chain);
  if(out.cooldown) out.cooldown=Math.min(.35,out.cooldown);
  if(out.perfectHeal) out.perfectHeal=Math.min(.06,out.perfectHeal);
  if(out.healOnKill) out.healOnKill=Math.min(.05,out.healOnKill);
  return out;
}
export function boonEffects(picked) {
  const rank=ranks(picked), families=new Set(BOONS.filter(b=>rank[b.id]>0).map(b=>b.family));
  return sumEffects([...BOONS.map(b=>Object.fromEntries(Object.entries(b.effects).map(([k,v])=>[k,v*rank[b.id]]))),...SYNERGIES.filter(s=>s.families.every(f=>families.has(f))).map(s=>s.effects)]);
}
export function masteryEffects(state) { const s=normalizeMasterworks(state); return sumEffects([...MASTERY_NODES.filter(n=>s.unlocked.includes(n.id)).map(n=>n.effects),PATHS.find(p=>p.id===s.path)?.effects||{}]); }
export function unlockMastery(state,id) {
  const node=MASTERY_NODES.find(n=>n.id===id); if(!node)return err('unknown');
  if(state.unlocked.includes(id))return err('owned');
  if(node.tier>1&&!state.unlocked.includes(`${node.path}_${node.tier-1}`))return err('prerequisite');
  if(state.renown<node.cost)return err('renown');
  state.renown-=node.cost;state.unlocked.push(id);return {ok:true};
}
export function choosePath(state,id) {if(!PATHS.some(p=>p.id===id))return err('unknown');state.path=id;return {ok:true};}
export function toggleChallenge(state,id) {if(!CHALLENGES.some(c=>c.id===id))return err('unknown');state.challengeIds=state.challengeIds.includes(id)?state.challengeIds.filter(c=>c!==id):[...state.challengeIds,id];return {ok:true};}
export function grantRenown(state,amount) {const gained=Math.min(int(amount),MAX-int(state.earnedRenown));state.earnedRenown+=gained;state.renown=Math.min(MAX,state.renown+gained);return gained;}
export function recordProgress(state,event,amount=1) {if(!stats.includes(event))return 0;state.bounties.counts[event]=Math.min(MAX,int(state.bounties.counts[event])+int(amount));return state.bounties.counts[event];}
export function claimBounty(state,id) {
  const b=BOUNTIES.find(b=>b.id===id);if(!b)return err('unknown');
  if(state.bounties.claimed.includes(id))return err('claimed');if(state.bounties.counts[b.stat]<b.target)return err('incomplete');
  state.bounties.claimed.push(id);return {ok:true,renown:grantRenown(state,b.reward)};
}
export function recordDiscovery(state,key) {
  if(!discoveryKey(key))return err('unknown');if(state.discoveries.includes(key))return err('discovered');
  state.discoveries.push(key);return {ok:true,renown:grantRenown(state,3)};
}
export function resolveStory(state,eventId,choiceId) {
  const event=STORY_EVENTS.find(e=>e.id===eventId),choice=event?.choices.find(c=>c.id===choiceId);
  if(!choice)return err('unknown');if(Object.hasOwn(state.story,eventId))return err('resolved');
  state.story[eventId]=choiceId;const renown=grantRenown(state,choice.effects.renown||0);
  // Renown is settled here; heal must be applied once by the battle caller.
  return {ok:true,effects:{heal:choice.effects.heal||0},renown,consequence:choice.consequence};
}
export function difficultyEffects(challengeIds) {
  const effects=sumEffects(CHALLENGES.filter(c=>ids(challengeIds,CHALLENGES).includes(c.id)).map(c=>c.effects));
  return {enemyHp:Math.min(1.5,1+(effects.enemyHp||0)),enemyAtk:Math.min(1.4,1+(effects.enemyAtk||0)),rewardMul:Math.min(1.5,1+(effects.rewardMul||0))};
}
