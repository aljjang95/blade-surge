import { HERO_ORDER } from '../data/heroes.js';
import { SLOTS, ITEM_BY_ID } from '../data/items.js';
import { COMBAT_ARTS } from '../data/combat-arts.js';
import { PATHS, CHALLENGES } from '../data/masterworks.js';
import { JOBS } from '../data/jobs.js';

const record = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
export const DEFAULT_MIX = { music: .55, sfx: .9, voice: 1 };
export const normalizeMix = raw => Object.fromEntries(Object.entries(DEFAULT_MIX).map(([k,v]) => [k,Number.isFinite(raw?.[k]) ? Math.max(0,Math.min(1,raw[k])) : v]));
export const validArt = id => COMBAT_ARTS.some(a => a.id === id) ? id : 'rupture';
export function normalizeArsenal(raw) {
  const r=record(raw), heroes=record(r.heroes);
  return {version:1,mix:normalizeMix(r.mix),heroes:Object.fromEntries(HERO_ORDER.map(id=>{
    const h=record(heroes[id]);
    const presets=[0,1,2].map(index=>{
      const p=record(Array.isArray(h.presets)?h.presets[index]:null);
      if(!Object.keys(p).length)return null;
      return {name:typeof p.name==='string'?p.name.trim().slice(0,20)||`구성 ${index+1}`:`구성 ${index+1}`,
        artId:validArt(p.artId),pathId:PATHS.some(x=>x.id===p.pathId)?p.pathId:'balanced',
        jobId:JOBS.some(j=>j.id===p.jobId&&j.baseHero===id)?p.jobId:null,
        challengeIds:CHALLENGES.filter(c=>Array.isArray(p.challengeIds)&&p.challengeIds.includes(c.id)).map(c=>c.id),
        equipment:Object.fromEntries(SLOTS.map(slot=>{const e=record(p.equipment?.[slot]);return [slot,Number.isSafeInteger(e.uid)&&e.uid>0&&ITEM_BY_ID[e.id]?.slot===slot?{uid:e.uid,id:e.id}:null];}))};
    });
    return [id,{artId:validArt(h.artId),presets}];
  }))};
}
