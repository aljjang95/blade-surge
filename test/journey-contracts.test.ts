import {expect,test} from 'bun:test';
import {DAILY_CONTRACTS,WEEKLY_CONTRACTS,JOURNEY_ACTION_STATS} from '../src/data/journey.js';
import {DUNGEONS} from '../src/data/expansion.js';
import {normalizeJourney,refreshPeriods,contractRows,recordJourneyAction,recordJourneyWin,claimContract} from '../src/game/journey-core.js';

const MONDAY=Date.parse('2026-09-06T20:00:00.000Z'),DAY=86400000;
const REWARD_KEYS=['gold','stones','materials','consumables'];
const CONSUMABLES=['hp_tonic','overdrive','aegis'];
function current(now=MONDAY){const s=normalizeJourney(null);refreshPeriods(s,now);return s;}
function act(s:any,id:string,stat:string,amount=1,period={day:s.day,week:s.week}){return recordJourneyAction(s,{receiptId:id,stat,amount,...period});}
const row=(s:any,kind:'daily'|'weekly',id:string,now=MONDAY)=>contractRows(s,now)[kind].find((r:any)=>r.id===id)!;

test('every action stat has one daily and one weekly contract with rewards the journey grant path can pay',()=>{
  for(const stat of JOURNEY_ACTION_STATS){
    expect(DAILY_CONTRACTS.filter(d=>d.stat===stat)).toHaveLength(1);expect(WEEKLY_CONTRACTS.filter(d=>d.stat===stat)).toHaveLength(1);
    const daily=DAILY_CONTRACTS.find(d=>d.stat===stat)!,weekly=WEEKLY_CONTRACTS.find(d=>d.stat===stat)!;
    expect(weekly.target).toBeGreaterThan(daily.target);
  }
  const all=[...DAILY_CONTRACTS,...WEEKLY_CONTRACTS];expect(new Set(all.map(d=>d.id)).size).toBe(all.length);
  for(const def of all){
    expect(Number.isSafeInteger(def.target)&&def.target>0).toBe(true);
    expect(Object.keys(def.rewards).every(k=>REWARD_KEYS.includes(k))).toBe(true);
    expect(Object.keys((def.rewards as any).consumables||{}).every(k=>CONSUMABLES.includes(k))).toBe(true);
  }
});

test('actions count only their own stat and a ten-pull fills the daily pull contract',()=>{
  const s=current();
  expect(act(s,'pull:1','pulls',10)).toEqual({ok:true,daily:true,weekly:true});
  expect(row(s,'daily','daily_pulls')).toMatchObject({cur:10,ready:true});expect(row(s,'weekly','weekly_pulls')).toMatchObject({cur:10,ready:false});
  expect(row(s,'daily','daily_upgrades').cur).toBe(0);expect(row(s,'daily','daily_boss').cur).toBe(0);
  expect(row(s,'daily','first_dungeon').cur).toBe(0);expect(s.daily.wins).toBe(0);expect(s.receipts).toEqual([]);
  for(let i=0;i<3;i++)act(s,`enh:${i}`,'upgrades');act(s,'boss:1','bossAttempts');
  expect(row(s,'daily','daily_upgrades').ready).toBe(true);expect(row(s,'daily','daily_boss').ready).toBe(true);
  expect(claimContract(s,'daily','daily_pulls')).toEqual({ok:true,rewards:{gold:700,stones:5}});
  expect(claimContract(s,'daily','daily_pulls')).toEqual({ok:false,error:'claimed'});
  expect(claimContract(s,'weekly','weekly_pulls')).toEqual({ok:false,error:'incomplete'});expect(s).not.toHaveProperty('gold');
});

test('dungeon wins never advance action contracts',()=>{
  const s=current();for(let i=0;i<5;i++)recordJourneyWin(s,{receiptId:`dungeon:${i}`,dungeonId:DUNGEONS[0].id,day:s.day,week:s.week});
  for(const stat of JOURNEY_ACTION_STATS){expect(s.daily.actions[stat]).toBe(0);expect(contractRows(s,MONDAY).weekly.find((r:any)=>r.stat===stat)!.cur).toBe(0);}
});

test('receipts are idempotent, bounded, and kept separate from dungeon receipts',()=>{
  const s=current();expect(act(s,'shared:1','bossAttempts').ok).toBe(true);
  expect(act(s,'shared:1','bossAttempts')).toEqual({ok:false,error:'duplicate'});expect(act(s,'shared:1','pulls')).toEqual({ok:false,error:'duplicate'});
  expect(s.daily.actions.bossAttempts).toBe(1);expect(s.daily.actions.pulls).toBe(0);
  // A reused id from another namespace does not block a dungeon win.
  expect(recordJourneyWin(s,{receiptId:'shared:1',dungeonId:DUNGEONS[0].id,day:s.day,week:s.week}).ok).toBe(true);
  const saved=structuredClone(s);expect(act(normalizeJourney(saved),'shared:1','bossAttempts').ok).toBe(false);
  for(let i=0;i<300;i++)act(s,`pull:${i}`,'pulls');
  expect(s.actionReceipts).toHaveLength(256);expect(s.receipts).toEqual(['shared:1']);expect(s.daily.actions.pulls).toBe(300);
});

test('invalid stats, amounts, ids and periods are rejected without mutation',()=>{
  const s=current(),before=structuredClone(s);
  const bad=[{stat:'wins'},{stat:'gold'},{stat:'__proto__'},{amount:0},{amount:-1},{amount:1.5},{amount:101},{amount:NaN},{receiptId:'bad space'},{receiptId:''},
    {day:-1},{week:s.week+1},{day:NaN}];
  for(const b of bad)expect(recordJourneyAction(s,{receiptId:'ok:1',stat:'pulls',amount:1,day:s.day,week:s.week,...b} as any)).toEqual({ok:false,error:'invalid'});
  expect(recordJourneyAction(s,undefined as any)).toEqual({ok:false,error:'invalid'});
  expect(s).toEqual(before);expect(act(s,'max','upgrades',100).ok).toBe(true);
});

test('daily and weekly boundaries reset action counters and late actions stay in their own period',()=>{
  const s=current(),monday={day:s.day,week:s.week};act(s,'pull:a','pulls',10);claimContract(s,'daily','daily_pulls');
  refreshPeriods(s,MONDAY+DAY);expect(s.daily.actions).toEqual({pulls:0,upgrades:0,bossAttempts:0});expect(s.daily.claimed).toEqual([]);
  expect(s.weekly.actions.pulls).toBe(10);
  // An action paid on Monday but saved on Tuesday counts only toward this week.
  expect(act(s,'pull:late','pulls',10,monday)).toEqual({ok:true,daily:false,weekly:true});
  expect(s.daily.actions.pulls).toBe(0);expect(s.weekly.actions.pulls).toBe(20);
  refreshPeriods(s,MONDAY+7*DAY);expect(s.weekly.actions).toEqual({pulls:0,upgrades:0,bossAttempts:0});
  expect(act(s,'boss:late','bossAttempts',1,monday)).toEqual({ok:true,daily:false,weekly:false});
  expect(s.weekly.actions.bossAttempts).toBe(0);expect(act(s,'pull:a','pulls').ok).toBe(false);
  const before=structuredClone(s);refreshPeriods(s,MONDAY);expect(s).toEqual(before);
});

test('version 1 saves migrate to zeroed counters and hostile counters are clamped',()=>{
  const v1={version:1,day:5,week:1,daily:{wins:2,targets:{glass_garden:2},claimed:['first_dungeon','daily_pulls']},weekly:{wins:2,targets:{}},receipts:['dungeon:1']};
  const s=normalizeJourney(v1);
  expect(s.version).toBe(2);expect(s.daily.actions).toEqual({pulls:0,upgrades:0,bossAttempts:0});expect(s.weekly.actions).toEqual({pulls:0,upgrades:0,bossAttempts:0});
  expect(s.actionReceipts).toEqual([]);expect(s.daily.wins).toBe(2);expect(s.receipts).toEqual(['dungeon:1']);
  expect(s.daily.claimed).toEqual(['first_dungeon','daily_pulls']);
  const hostile=normalizeJourney({daily:{actions:{pulls:Infinity,upgrades:-4,bossAttempts:99999999,__proto__:{pulls:9},gold:5}},weekly:{actions:[1,2]},
    actionReceipts:['ok:1','ok:1','bad space',...Array.from({length:300},(_,i)=>`a:${i}`)]});
  expect(hostile.daily.actions).toEqual({pulls:0,upgrades:0,bossAttempts:1000000});expect(hostile.weekly.actions).toEqual({pulls:0,upgrades:0,bossAttempts:0});
  expect(hostile.actionReceipts).toHaveLength(256);expect(normalizeJourney(hostile)).toEqual(hostile);
  const capped=current();capped.daily.actions.pulls=999990;act(capped,'cap','pulls',100);expect(capped.daily.actions.pulls).toBe(1000000);
});

test('contract preview stays read-only for action counters across a pending reset',()=>{
  const s=current();act(s,'enh:1','upgrades',3);const before=structuredClone(s);
  expect(row(s,'daily','daily_upgrades',MONDAY+DAY)).toMatchObject({cur:0,ready:false});expect(s).toEqual(before);
  expect(row(s,'daily','daily_upgrades').ready).toBe(true);
});
