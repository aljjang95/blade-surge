import {expect,test} from 'bun:test';
import {JOURNEY_STEPS} from '../src/data/journey.js';
import {DUNGEONS,RECIPES} from '../src/data/expansion.js';
import {ITEM_BY_ID} from '../src/data/items.js';
import {normalizeJourney,periodAt,refreshPeriods,journeySteps,contractRows,recordJourneyWin,claimJourneyStep,claimContract,setTargetRecipe} from '../src/game/journey-core.js';

const MONDAY=Date.parse('2026-09-06T20:00:00.000Z'),DAY=86400000;
const itemById=ITEM_BY_ID as Record<string,{slot:string}>;
function current(now=MONDAY){const s=normalizeJourney(null);refreshPeriods(s,now);return s;}
function win(s:any,id:string,dungeonId=DUNGEONS[0].id,period={day:s.day,week:s.week}){return recordJourneyWin(s,{receiptId:id,dungeonId,...period});}
function readySave(){
  const armor=RECIPES.find((r:any)=>r.itemId&&itemById[r.itemId].slot==='armor')!;
  return {selected:'knight',heroes:{knight:{equip:{armor:1}}},inventory:[{uid:1,id:armor.itemId,enh:1}],
    expedition:{claimed:['first_oath'],stats:{glass_garden:1,crafts:1}},masterworks:{unlocked:['assault_1']},journey:normalizeJourney(null)};
}

test('Korea 05:00 daily boundary and Monday 05:00 weekly boundary use explicit timestamps',()=>{
  const before=periodAt(MONDAY-1),at=periodAt(MONDAY);
  expect(at.day).toBe(before.day+1);expect(at.week).toBe(before.week+1);
  expect(before.nextResetAt).toBe(MONDAY);expect(before.nextWeekResetAt).toBe(MONDAY);
  expect(at.nextResetAt).toBe(MONDAY+DAY);expect(at.nextWeekResetAt).toBe(MONDAY+7*DAY);
  expect(periodAt(MONDAY+DAY-1).day).toBe(at.day);expect(periodAt(MONDAY+DAY).week).toBe(at.week);
  expect(periodAt(NaN)).toEqual(periodAt(0));expect(Number.isFinite(periodAt(Infinity).day)).toBe(true);
});

test('period refresh resets only advancing periods and clock rollback cannot reopen claims',()=>{
  const s=current();win(s,'first');claimContract(s,'daily','first_dungeon');
  const before=structuredClone(s);refreshPeriods(s,MONDAY-DAY);expect(s).toEqual(before);
  refreshPeriods(s,MONDAY+DAY);expect(s.daily.wins).toBe(0);expect(s.daily.claimed).toEqual([]);expect(s.weekly.wins).toBe(1);
  refreshPeriods(s,MONDAY+7*DAY);expect(s.weekly.wins).toBe(0);expect(s.receipts).toEqual(['first']);
  expect(win(s,'first').ok).toBe(false);
});

test('legacy and malicious saves normalize without unknown targets, itemless recipes or unbounded arrays',()=>{
  expect(normalizeJourney(null)).toEqual(normalizeJourney({}));
  const s=normalizeJourney({day:NaN,week:-1,autoBattle:'true',targetRecipeId:'brew_tonic',claimedSteps:['oath','oath','fake'],
    daily:{wins:Infinity,targets:{glass_garden:99999999,__proto__:999},claimed:['first_dungeon','first_dungeon','fake']},
    weekly:{wins:-10,targets:{star_archive:5}},receipts:[...Array.from({length:300},(_,i)=>`run:${i}`),'bad space','__proto__']});
  expect(s.day).toBe(0);expect(s.week).toBe(0);expect(s.autoBattle).toBe(false);expect(s.targetRecipeId).toBeNull();
  expect(s.claimedSteps).toEqual(['oath']);expect(s.daily.wins).toBe(0);expect(s.daily.targets.glass_garden).toBe(1000000);
  expect(Object.keys(s.daily.targets)).toEqual(DUNGEONS.map(d=>d.id));expect(s.daily.claimed).toEqual(['first_dungeon']);
  expect(s.weekly.wins).toBe(0);expect(s.receipts).toHaveLength(256);expect(s.receipts[0]).toBe('run:44');
  expect(normalizeJourney(s)).toEqual(s);
});

test('journey completion derives from real selected equipment and enh, while claims stay sequential',()=>{
  const save=readySave(),s=save.journey;const rows=journeySteps(save);expect(rows.every(r=>r.complete)).toBe(true);
  expect(rows.filter(r=>r.ready).map(r=>r.id)).toEqual(['oath']);expect(claimJourneyStep(s,save,'mastery').ok).toBe(false);
  const golds=[500,1000,1500,1000,1500,2000];
  JOURNEY_STEPS.forEach((d,i)=>{expect(claimJourneyStep(s,save,d.id)).toEqual({ok:true,rewards:{gold:golds[i],stones:10}});expect(claimJourneyStep(s,save,d.id).ok).toBe(false);});
  expect(s).not.toHaveProperty('gold');expect(normalizeJourney(s).claimedSteps).toHaveLength(6);
  save.heroes.knight.equip.armor=999;expect(journeySteps(save).find(r=>r.id==='equip')?.complete).toBe(false);
  expect(journeySteps(save).find(r=>r.id==='enhance')?.complete).toBe(false);
  save.heroes.knight.equip.armor=1;save.inventory[0].enh=0;(save.inventory[0] as any).enhance=10;
  expect(journeySteps(save).find(r=>r.id==='enhance')?.complete).toBe(false);
  save.selected='missing';expect(journeySteps(save).find(r=>r.id==='equip')?.complete).toBe(false);
  expect(journeySteps({}).every(r=>!r.complete&&!r.ready)).toBe(true);
});

test('unselected or incorrectly slotted equipment cannot satisfy equipment milestones',()=>{
  const save=readySave();const weapon=RECIPES.find((r:any)=>r.itemId&&itemById[r.itemId].slot==='weapon')!;
  save.inventory[0].id=weapon.itemId;expect(journeySteps(save).find(r=>r.id==='equip')?.complete).toBe(false);
  expect(journeySteps(save).find(r=>r.id==='enhance')?.complete).toBe(false);
});

test('daily rotation cycles three authored dungeons and resolves the matching material reward',()=>{
  const rotations=new Set();for(let i=0;i<3;i++){
    const s=current(MONDAY+i*DAY),r=contractRows(s,MONDAY+i*DAY);rotations.add(r.rotationDungeonId);
    const d=DUNGEONS.find(d=>d.id===r.rotationDungeonId)!;win(s,`rotation:${i}`,d.id);
    const award=claimContract(s,'daily','rotation');expect(award.ok).toBe(true);
    expect(award).toMatchObject({rewards:{gold:800,materials:Object.fromEntries(Object.keys(d.rewards.materials).map(k=>[k,2]))}});
    expect(claimContract(s,'daily','rotation').ok).toBe(false);
  }expect(rotations.size).toBe(3);
});

test('unique real-dungeon receipts count daily and weekly thresholds without applying currency',()=>{
  const s=current();expect(win(s,'bad','rookie').ok).toBe(false);expect(win(s,'bad','invented').ok).toBe(false);
  for(let i=0;i<7;i++)expect(win(s,`win:${i}`,DUNGEONS[i%3].id).ok).toBe(true);
  expect(win(s,'win:0').ok).toBe(false);expect(s.daily.wins).toBe(7);expect(s.weekly.wins).toBe(7);
  const rows=contractRows(s,MONDAY);expect(rows.daily.every(r=>r.ready)).toBe(true);expect(rows.weekly.every(r=>r.ready)).toBe(true);
  expect(rows.weekly.find(r=>r.id==='diverse_dungeons')?.cur).toBe(3);
  expect(claimContract(s,'weekly','seven_dungeons').ok).toBe(true);expect(claimContract(normalizeJourney(s),'weekly','seven_dungeons').ok).toBe(false);
  expect(claimContract(s,'daily','fake').ok).toBe(false);expect(claimContract(s,'monthly','rotation').ok).toBe(false);expect(s).not.toHaveProperty('gold');
});

test('late wins never roll into new periods and their receipts cannot be replayed',()=>{
  const s=current(),start={day:s.day,week:s.week};refreshPeriods(s,MONDAY+DAY);
  expect(win(s,'late-day',DUNGEONS[0].id,start)).toEqual({ok:true,daily:false,weekly:true});
  expect(s.daily.wins).toBe(0);expect(s.weekly.wins).toBe(1);
  refreshPeriods(s,MONDAY+7*DAY);
  expect(win(s,'late-week',DUNGEONS[1].id,start)).toEqual({ok:true,daily:false,weekly:false});
  expect(s.daily.wins).toBe(0);expect(s.weekly.wins).toBe(0);expect(win(s,'late-week').ok).toBe(false);
  expect(win(s,'bad-period',DUNGEONS[0].id,{day:s.day,week:s.week+1}).ok).toBe(false);
});

test('contract preview is read-only and offers tomorrow only after the caller refreshes storage',()=>{
  const s=current();win(s,'today');claimContract(s,'daily','first_dungeon');const before=structuredClone(s);
  const tomorrow=contractRows(s,MONDAY+DAY);expect(tomorrow.daily.every(r=>!r.ready&&!r.claimed)).toBe(true);expect(s).toEqual(before);
  expect(contractRows(s,MONDAY-DAY).daily.find(r=>r.id==='first_dungeon')?.claimed).toBe(true);
});

test('target recipes require real craftable gear and can be cleared without touching progress',()=>{
  const s=current(),gear=RECIPES.find(r=>r.itemId)!;
  expect(setTargetRecipe(s,gear.id).ok).toBe(true);expect(normalizeJourney(s).targetRecipeId).toBe(gear.id);
  expect(setTargetRecipe(s,'brew_tonic').ok).toBe(false);expect(s.targetRecipeId).toBe(gear.id);
  expect(setTargetRecipe(s,null).ok).toBe(true);expect(s.targetRecipeId).toBeNull();
});
