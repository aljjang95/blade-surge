import { JOURNEY_STEPS, DAILY_CONTRACTS, WEEKLY_CONTRACTS } from '../data/journey.js';
import { DUNGEONS, RECIPES } from '../data/expansion.js';
import { ITEM_BY_ID, SLOTS } from '../data/items.js';
import { MASTERY_NODES } from '../data/masterworks.js';

const DAY_MS=86400000, OFFSET=4*3600000, MAX=1000000, MAX_DAY=100000000;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const list=v=>Array.isArray(v)?v:[];
const integer=(v,max=MAX)=>Number.isSafeInteger(v)?Math.max(0,Math.min(max,v)):0;
const ids=(values,defs)=>[...new Set(list(values).filter(id=>defs.some(d=>d.id===id)))];
const receiptId=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9:_.\/-]{0,127}$/.test(id);
const validRecipe=id=>RECIPES.some(r=>r.id===id&&r.itemId&&Object.hasOwn(ITEM_BY_ID,r.itemId));
const empty=()=>({wins:0,targets:Object.fromEntries(DUNGEONS.map(d=>[d.id,0])),claimed:[]});
const normalizeTrack=(raw,defs)=>({wins:integer(raw?.wins),targets:Object.fromEntries(DUNGEONS.map(d=>[d.id,integer(raw?.targets?.[d.id])])),claimed:ids(raw?.claimed,defs)});
const fail=error=>({ok:false,error});

export function normalizeJourney(raw) {
  const r=object(raw)?raw:{};
  return {version:1,day:integer(r.day,MAX_DAY),week:integer(r.week,Math.floor((MAX_DAY+3)/7)),
    daily:normalizeTrack(r.daily,DAILY_CONTRACTS),weekly:normalizeTrack(r.weekly,WEEKLY_CONTRACTS),
    claimedSteps:ids(r.claimedSteps,JOURNEY_STEPS),targetRecipeId:validRecipe(r.targetRecipeId)?r.targetRecipeId:null,
    receipts:[...new Set(list(r.receipts).filter(receiptId))].slice(-256),autoBattle:r.autoBattle===true};
}

/** Epoch day shifted to Korea 05:00. Monday is epoch day 4. No ambient clock dependency. */
export function periodAt(nowMs) {
  const time=Number.isSafeInteger(nowMs)?Math.max(0,Math.min(8640000000000000,nowMs)):0;
  const day=Math.floor((time+OFFSET)/DAY_MS),week=Math.floor((day+3)/7);
  return {day,week,nextResetAt:(day+1)*DAY_MS-OFFSET,nextWeekResetAt:((week+1)*7-3)*DAY_MS-OFFSET};
}
export function refreshPeriods(state,nowMs) {
  const p=periodAt(nowMs);
  if(p.day>state.day){state.day=p.day;state.daily=empty();}
  if(p.week>state.week){state.week=p.week;state.weekly=empty();}
  return {day:state.day,week:state.week,nextResetAt:(state.day+1)*DAY_MS-OFFSET,nextWeekResetAt:((state.week+1)*7-3)*DAY_MS-OFFSET};
}

function equippedItems(save) {
  const hero=save?.heroes?.[save.selected];
  return SLOTS.map(slot=>{
    const uid=hero?.equip?.[slot];if(!Number.isSafeInteger(uid)||uid<1)return null;
    return list(save.inventory).find(item=>item?.uid===uid&&Object.hasOwn(ITEM_BY_ID,item.id)&&ITEM_BY_ID[item.id].slot===slot)||null;
  }).filter(Boolean);
}
export function journeySteps(save) {
  const s=object(save)?save:{},items=equippedItems(s),claimed=ids(s.journey?.claimedSteps,JOURNEY_STEPS);
  const completed={oath:list(s.expedition?.claimed).includes('first_oath'),garden:integer(s.expedition?.stats?.glass_garden)>=1,
    craft:integer(s.expedition?.stats?.crafts)>=1,equip:items.some(i=>ITEM_BY_ID[i.id].slot==='armor'),
    enhance:items.some(i=>integer(i.enh)>=1),mastery:ids(s.masterworks?.unlocked,MASTERY_NODES).length>=1};
  return JOURNEY_STEPS.map((def,i)=>({...def,rewards:structuredClone(def.rewards),complete:completed[def.id],claimed:claimed.includes(def.id),
    ready:completed[def.id]&&!claimed.includes(def.id)&&JOURNEY_STEPS.slice(0,i).every(previous=>claimed.includes(previous.id))}));
}
export function claimJourneyStep(state,save,id) {
  const row=journeySteps({...save,journey:state}).find(r=>r.id===id);
  if(!row)return fail('unknown');if(row.claimed)return fail('claimed');if(!row.complete)return fail('incomplete');if(!row.ready)return fail('prerequisite');
  state.claimedSteps.push(id);return {ok:true,rewards:row.rewards};
}

function rows(state,kind) {
  const defs=kind==='daily'?DAILY_CONTRACTS:WEEKLY_CONTRACTS,track=state[kind],rotation=DUNGEONS[state.day%3];
  return defs.map(def=>{
    const cur=def.stat==='rotation'?track.targets[rotation.id]:def.stat==='distinct'?DUNGEONS.filter(d=>track.targets[d.id]>0).length:track.wins;
    const claimed=track.claimed.includes(def.id),rewards=structuredClone(def.rewards);
    if(def.rotationMaterials)rewards.materials=Object.fromEntries(Object.keys(rotation.rewards.materials).map(key=>[key,def.rotationMaterials]));
    return {...def,cur,complete:cur>=def.target,claimed,ready:cur>=def.target&&!claimed,rewards,...(def.stat==='rotation'?{dungeonId:rotation.id}:{})};
  });
}
/** Read only: callers refresh state inside their durable transaction before displaying/claiming. */
export function contractRows(state,nowMs) {
  const view=normalizeJourney(state);const p=refreshPeriods(view,nowMs);
  return {daily:rows(view,'daily'),weekly:rows(view,'weekly'),rotationDungeonId:DUNGEONS[view.day%3].id,nextResetAt:p.nextResetAt};
}
export function recordJourneyWin(state,{receiptId:id,dungeonId,day,week}={}) {
  if(!receiptId(id)||!DUNGEONS.some(d=>d.id===dungeonId)||!Number.isSafeInteger(day)||day<0||!Number.isSafeInteger(week)||week<0||week!==Math.floor((day+3)/7))return fail('invalid');
  if(state.receipts.includes(id))return fail('duplicate');
  // Retain late receipts too: a delayed result may not migrate into tomorrow's contracts.
  state.receipts.push(id);state.receipts=state.receipts.slice(-256);
  const daily=day===state.day,weekly=week===state.week;
  for(const kind of ['daily','weekly'])if(kind==='daily'?daily:weekly){const track=state[kind];track.wins=Math.min(MAX,track.wins+1);track.targets[dungeonId]=Math.min(MAX,track.targets[dungeonId]+1);}
  return {ok:true,daily,weekly};
}
export function claimContract(state,kind,id) {
  if(!['daily','weekly'].includes(kind))return fail('unknown');
  const row=rows(state,kind).find(r=>r.id===id);if(!row)return fail('unknown');if(row.claimed)return fail('claimed');if(!row.ready)return fail('incomplete');
  state[kind].claimed.push(id);return {ok:true,rewards:row.rewards};
}
export function setTargetRecipe(state,id) {if(id!==null&&!validRecipe(id))return fail('unknown');state.targetRecipeId=id;return {ok:true};}
