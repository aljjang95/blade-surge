import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ENCOUNTER_ART} from '../src/data/encounter-art.js';
import {ENEMIES,CHAPTERS,stageDef} from '../src/data/stages.js';
import {ARENA_RIVALS} from '../src/data/expansion.js';
import {buildExpeditionStage} from '../src/game/expedition-combat.js';
// stages.js adds authored encounter keys at module initialization.
const enemyById=ENEMIES as unknown as Record<string,{portrait:string}>;

test('all campaign encounter and arena identities retain distinct portrait files',()=>{
  const paths=Object.values(ENCOUNTER_ART);
  expect(paths).toHaveLength(30);expect(new Set(paths).size).toBe(30);
  const hashes=paths.map(path=>createHash('sha256').update(readFileSync(`public${path}`)).digest('hex'));
  expect(new Set(hashes).size).toBe(30);
  for(const ch of CHAPTERS) for(const rank of ['captain','warden','midboss','finalboss']){
    const id=`${ch.encounterPrefix||ch.theme}_${rank}`;
    expect(enemyById[id].portrait).toBe(ENCOUNTER_ART[id]);
  }
  for(const rival of ARENA_RIVALS){
    const stage=buildExpeditionStage('arena',rival.id,{});
    expect(rival.portrait).toBe(ENCOUNTER_ART[`arena_${rival.id}`]);
    expect(stage.expeditionEnemy.portrait).toBe(rival.portrait);
  }
  for(const id of ['boss_warlord','boss_demon','boss_dragon']) expect(enemyById[id].portrait).toBe(ENCOUNTER_ART[id]);
  expect(enemyById[stageDef(6,10).encounter.enemyId].portrait).toBe(ENCOUNTER_ART.homecoming_finalboss);
});
