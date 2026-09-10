import { describe, expect, test } from 'bun:test';
import { BOONS, MASTERY_NODES } from '../src/data/masterworks.js';
import { normalizeMasterworks, boonChoices, boonEffects, unlockMastery, grantRenown, choosePath, masteryEffects, toggleChallenge, difficultyEffects, recordProgress, claimBounty, recordDiscovery, resolveStory } from '../src/game/masterworks-core.js';

describe('masterworks progression contracts',()=>{
  test('legacy and malicious input produce bounded whitelisted state without free unlocks',()=>{
    expect(normalizeMasterworks(null).renown).toBe(0);
    const s=normalizeMasterworks({renown:99999,earnedRenown:6,unlocked:MASTERY_NODES.map(n=>n.id),path:'__proto__',challengeIds:['iron','iron','bad'],activePreset:999,presets:[{name:'a'.repeat(90),unlocked:['assault_3']}],discoveries:['room:51:1','campaign:50','__proto__'],story:{lantern:'fake'},history:[{outcome:'fake'}]});
    expect(s.unlocked).toEqual(['assault_1']);expect(s.renown).toBe(0);expect(s.path).toBe('balanced');expect(s.presets).toHaveLength(3);expect(s.presets[0].name).toHaveLength(24);expect(s.presets[0]).not.toHaveProperty('unlocked');expect(s.challengeIds).toEqual(['iron']);expect(s.discoveries).toEqual(['campaign:50']);expect(s.story).toEqual({});expect(s.history).toEqual([]);
    expect(normalizeMasterworks({unlocked:['assault_1'],renown:999}).unlocked).toEqual([]);
  });
  test('mastery purchase is atomic, sequential, and remains purchased after migration',()=>{
    const s=normalizeMasterworks(null);grantRenown(s,20);const before=JSON.stringify(s);
    expect(unlockMastery(s,'assault_2')).toEqual({ok:false,error:'prerequisite'});expect(JSON.stringify(s)).toBe(before);
    expect(unlockMastery(s,'assault_1').ok).toBe(true);expect(s.renown).toBe(14);expect(unlockMastery(s,'assault_1').ok).toBe(false);
    expect(unlockMastery(s,'assault_2').ok).toBe(true);expect(unlockMastery(s,'assault_3').ok).toBe(false);expect(normalizeMasterworks(s)).toEqual(s);
    choosePath(s,'vanguard');expect(masteryEffects(s).atk).toBeCloseTo(.1);choosePath(s,'hunter');expect(masteryEffects(s).atk).toBeCloseTo(.02);
  });
  test('draft is deterministic and unique, excludes maximum rank, and exhausts cleanly',()=>{
    const a=boonChoices(42,{},2);expect(boonChoices(42,{},2)).toEqual(a);expect(new Set(a.map(b=>b.id)).size).toBe(3);
    const picked=Object.fromEntries(BOONS.map(b=>[b.id,3]));expect(boonChoices(42,picked,2)).toEqual([]);picked.ember_edge=2;expect(boonChoices(42,picked,2).map(b=>b.id)).toEqual(['ember_edge']);
  });
  test('ranks add, duo requires two families, and behavior caps hold',()=>{
    expect(boonEffects({ember_edge:2}).atk).toBeCloseTo(.1);
    expect(boonEffects(['ember_edge','storm_eye']).atk).toBeCloseTo(.12);
    const e=boonEffects({storm_eye:100,tide_guard:100,stone_plate:2,ember_hunt:2});expect(e.chain).toBe(2);expect(e.perfectHeal).toBeCloseTo(.03);expect(e.breakPower).toBeCloseTo(.24);expect(e.finisher).toBeCloseTo(.16);expect(e.cooldown).toBeCloseTo(.08);
  });
  test('bounties track only known activity, pay once, and persist receipts',()=>{
    const s=normalizeMasterworks(null);recordProgress(s,'money',1000);expect(s.renown).toBe(0);expect(claimBounty(s,'first_hunt').ok).toBe(false);
    recordProgress(s,'kills',30);expect(s.renown).toBe(0);expect(claimBounty(s,'first_hunt')).toEqual({ok:true,renown:8});expect(claimBounty(s,'first_hunt').ok).toBe(false);expect(s.earnedRenown).toBe(8);
    const migrated=normalizeMasterworks({...s,bounties:{claimed:['first_hunt']}});expect(claimBounty(migrated,'first_hunt').ok).toBe(false);
  });
  test('discoveries validate campaign and expedition ranges and pay once after reload',()=>{
    const s=normalizeMasterworks(null);expect(recordDiscovery(s,'room:1:21').ok).toBe(false);expect(recordDiscovery(s,'expedition:fake:1').ok).toBe(false);
    expect(recordDiscovery(s,'expedition:glass_garden:0').ok).toBe(true);expect(recordDiscovery(s,'campaign:1').ok).toBe(true);expect(recordDiscovery(normalizeMasterworks(s),'campaign:1').ok).toBe(false);expect(s.renown).toBe(6);
  });
  test('story returns a one-time heal or settled renown with permanent consequence',()=>{
    const s=normalizeMasterworks(null);const r=resolveStory(s,'lantern','guide');expect(r.ok).toBe(true);if(!('effects' in r))throw new Error('Expected story settlement');expect(r.renown).toBe(6);expect(r.effects).toEqual({heal:0});expect(resolveStory(s,'lantern','mend').ok).toBe(false);
    const repair=resolveStory(s,'bridge','repair');if(!('effects' in repair))throw new Error('Expected healing');expect(repair.effects).toEqual({heal:.4});expect(resolveStory(normalizeMasterworks(s),'bridge','repair').ok).toBe(false);expect(s.renown).toBe(6);
  });
  test('stacked risks are deduplicated and all counters are capped',()=>{
    const s=normalizeMasterworks(null);toggleChallenge(s,'iron');toggleChallenge(s,'iron');expect(s.challengeIds).toEqual([]);expect(toggleChallenge(s,'fake').ok).toBe(false);
    const d=difficultyEffects(['iron','fury','siege','siege']);expect(d.enemyHp).toBeCloseTo(1.25);expect(d.enemyAtk).toBeCloseTo(1.2);expect(d.rewardMul).toBeCloseTo(1.32);
    grantRenown(s,99999999);grantRenown(s,100);recordProgress(s,'kills',99999999);expect(s.earnedRenown).toBe(1000000);expect(s.renown).toBe(1000000);expect(s.bounties.counts.kills).toBe(1000000);grantRenown(s,NaN);expect(s.renown).toBe(1000000);
  });
});
