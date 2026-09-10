import { beforeEach, afterEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { HEROES } from '../src/data/heroes.js';
import { Meta } from '../src/ui/meta.js';
import { audio } from '../src/engine/audio.js';

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

test('all five base classes can be chosen on a fresh save without currency changes', () => {
  const eco = new Economy();
  expect(Object.keys(eco.s.heroes)).toEqual(Object.keys(HEROES));
  expect([eco.s.gold,eco.s.gems,eco.s.tickets]).toEqual([12000,1500,5]);
  expect(Object.values(eco.s.heroes).every((h:any)=>h.level===1&&h.star===1&&h.shards===0)).toBe(true);
});

test('legacy roster migration adds missing classes and preserves trained hero and selected mage', () => {
  const eco = new Economy(), raw = eco.fresh();
  delete raw.heroes.barbarian; delete raw.heroes.rogue;
  raw.selected = 'mage'; Object.assign(raw.heroes.mage,{level:24,exp:83,star:3,shards:17,skills:[4,3,2,1,2,1]});
  raw.gold=321; raw.gems=87; raw.tickets=2;
  const result=eco.migrate(raw);
  expect(Object.keys(result.heroes)).toEqual(Object.keys(HEROES));
  expect(result.heroes.mage).toEqual(raw.heroes.mage);
  expect(result.selected).toBe('mage');
  expect([result.gold,result.gems,result.tickets]).toEqual([321,87,2]);
  expect(result.heroes.barbarian.level).toBe(1);
});

test('hero choice updates persisted launch identity, showcased model and reload selection', () => {
  const eco = new Economy(), shown:string[]=[];
  const meta=Object.create(Meta.prototype);
  Object.assign(meta,{eco,app:{showcaseHero:(id:string)=>shown.push(id)},ui:{toast:()=>{}},renderHeroes:()=>{}});
  for (const id of Object.keys(HEROES)) {
    expect(meta.selectHero(id)).toBe(true);
    expect(eco.s.selected).toBe(id);
    expect(meta.heroSel).toBe(id);
    expect(new Economy().s.selected).toBe(id);
  }
  expect(shown).toEqual(['barbarian','mage','rogue','ranger']);
  expect(meta.selectHero('missing')).toBe(false);
  expect(eco.s.selected).toBe('ranger');
});

test('every skill has a unique art identity including the six ranger abilities', () => {
  const icons=Object.values(HEROES).flatMap(h=>h.skills.map(s=>s.icon));
  expect(new Set(icons).size).toBe(30);
});

test('keyboard selection restores focus to the replacement card, pointer selection does not', () => {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const events:string[]=[];
  let replacement:{focus:(options:{preventScroll:boolean})=>void};
  const meta=Object.create(Meta.prototype);
  Object.assign(meta,{eco:new Economy(),app:{showcaseHero:()=>{}},ui:{toast:()=>{}},renderHeroes:()=>{
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
