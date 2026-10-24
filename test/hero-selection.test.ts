import { beforeEach, afterEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { HEROES } from '../src/data/heroes.js';
import { Meta } from '../src/ui/meta.js';
import { audio } from '../src/engine/audio.js';
import { grandfather } from './helpers/legacy-roster';

const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const voice = audio.voice;
beforeEach(() => {
  const values = new Map<string,string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable:true, value:{
    getItem:(key:string)=>values.get(key)??null,
    setItem:(key:string,value:string)=>values.set(key,value),
    removeItem:(key:string)=>values.delete(key),
  }});
  audio.voice = async () => {};
});
afterEach(() => {
  audio.voice = voice;
  if (oldStorage) Object.defineProperty(globalThis,'localStorage',oldStorage);
  else Reflect.deleteProperty(globalThis,'localStorage');
});

test('a fresh save keeps all five hero records but owns only the chosen starter, and choosing changes no currency', () => {
  const eco = new Economy();
  expect(Object.keys(eco.s.heroes)).toEqual(Object.keys(HEROES));
  expect([eco.s.gold,eco.s.gems,eco.s.tickets]).toEqual([12000,1500,5]);
  expect(Object.values(eco.s.heroes).every((h:any)=>h.level===1&&h.star===1&&h.shards===0)).toBe(true);
  expect(eco.ownedHeroIds()).toEqual(['knight']);
  // 다섯 직업 모두 시작 영웅으로 고를 수 있다(저장을 새로 만들어 하나씩). 소환 전용(gachaOnly)은 시작 영웅이 아니다 — 거절은 blackcat-wiring 시험.
  for (const id of Object.keys(HEROES).filter((h) => !(HEROES as any)[h].gachaOnly)) {
    const e = new Economy(); e.s.roster.starterChosen = false;
    expect(e.chooseStarter(id).ok).toBe(true);
    expect(e.ownedHeroIds()).toEqual([id]); expect(e.s.selected).toBe(id);
    expect([e.s.gold,e.s.gems,e.s.tickets]).toEqual([12000,1500,5]);
  }
});

test('legacy roster migration adds missing classes and preserves trained hero and selected mage', () => {
  const eco = new Economy(), raw = eco.fresh();
  delete raw.heroes.barbarian; delete raw.heroes.rogue; delete (raw as any).roster;
  raw.selected = 'mage'; Object.assign(raw.heroes.mage,{level:24,exp:83,star:3,shards:17,skills:[4,3,2,1,2,1]});
  raw.gold=321; raw.gems=87; raw.tickets=2;
  const result=eco.migrate(raw);
  expect(Object.keys(result.heroes)).toEqual(Object.keys(HEROES));
  expect(result.heroes.mage).toMatchObject({level:24,exp:83,star:3,shards:17,skills:[4,3,2,1,2,1,1,1],skillLoadout:[4,5]});
  expect(result.selected).toBe('mage');
  expect([result.gold,result.gems,result.tickets]).toEqual([321,87,2]);
  expect(result.heroes.barbarian.level).toBe(1);
});

test('hero choice updates persisted launch identity, showcased model and reload selection', () => {
  const eco = grandfather(new Economy()), shown:string[]=[];
  const meta=Object.create(Meta.prototype);
  Object.assign(meta,{eco,app:{showcaseHero:(id:string)=>shown.push(id)},ui:{toast:()=>{}},renderHeroes:()=>{}});
  for (const id of Object.keys(HEROES)) {
    expect(meta.selectHero(id)).toBe(true);
    expect(eco.s.selected).toBe(id);
    expect(meta.heroSel).toBe(id);
    expect(new Economy().s.selected).toBe(id);
  }
  expect(shown).toEqual(['barbarian','mage','rogue','ranger','blackcat','werewolf']);
  expect(meta.selectHero('missing')).toBe(false);
  expect(eco.s.selected).toBe('werewolf');
});

test('original six abilities per hero keep their unique art identity while advanced skills reuse compatible art', () => {
  const icons=Object.values(HEROES).flatMap(h=>h.skills.slice(0,6).map(s=>s.icon));
  expect(new Set(icons).size).toBe(30);
  expect(Object.values(HEROES).every(h=>h.skills.length===8)).toBe(true);
});

test('keyboard selection restores focus to the replacement card, pointer selection does not', () => {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const events:string[]=[];
  let replacement:{focus:(options:{preventScroll:boolean})=>void};
  const meta=Object.create(Meta.prototype);
  Object.assign(meta,{eco:grandfather(new Economy()),app:{showcaseHero:()=>{}},ui:{toast:()=>{}},renderHeroes:()=>{
    events.push('render');
    replacement={focus:options=>{expect(options.preventScroll).toBe(true);events.push('focus');}};
  }});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:(id:string)=>{
    expect(id).toBe('hero-list');
    return {querySelector:(selector:string)=>{expect(selector).toBe('[data-hero-id="mage"]');return replacement;}};
  }}});
  try {
    meta.selectHero('mage',true);
    expect(events).toEqual(['render','focus']);
    events.length=0;
    meta.selectHero('ranger');
    expect(events).toEqual(['render']);
  } finally {
    if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);
    else Reflect.deleteProperty(globalThis,'document');
  }
});
