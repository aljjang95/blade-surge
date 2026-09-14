import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ENCOUNTER_ART,MOB_ART} from '../src/data/encounter-art.js';
import {ENEMIES,CHAPTERS,stageDef} from '../src/data/stages.js';
import {ARENA_RIVALS} from '../src/data/expansion.js';
import {buildExpeditionStage} from '../src/game/expedition-combat.js';
// stages.js adds authored encounter keys at module initialization.
const enemyById=ENEMIES as unknown as Record<string,{portrait:string}>;

test('all campaign encounter and arena identities retain distinct portrait files',()=>{
  const paths=Object.values(ENCOUNTER_ART);
  const expected=6+11+CHAPTERS.length*4;
  expect(paths).toHaveLength(expected);expect(new Set(paths).size).toBe(expected);
  const hashes=paths.map(path=>createHash('sha256').update(readFileSync(`public${path}`)).digest('hex'));
  expect(new Set(hashes).size).toBe(expected);
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
  for(const id of ['verdigris_sentinel','sable_mirage_empress','comet_bastion']) expect(enemyById[id].portrait).toBe(ENCOUNTER_ART[`boss_${id}`]);
  for(const id of ['cinder_chain_executor','nightglass_archivist']) expect(enemyById[id].portrait).toBe(ENCOUNTER_ART[`boss_${id}`]);
  expect(enemyById[stageDef(6,10).encounter.enemyId].portrait).toBe(ENCOUNTER_ART.homecoming_finalboss);
});

test('seasonal roster portraits are local, readable and never fall back to hero art',()=>{
  const hashes=[];
  for(const [id,path] of Object.entries(MOB_ART)){
    expect((enemyById as Record<string,{portrait?:string}>)[id]?.portrait).toBe(path);
    const bytes=readFileSync(`public${path}`);expect(bytes.byteLength).toBeGreaterThan(10000);
    hashes.push(createHash('sha256').update(bytes).digest('hex'));
  }
  expect(new Set(hashes).size).toBe(Object.keys(MOB_ART).length);
  const bossArt={obsidian_hydra:'boss_obsidian_hydra',ash_colossus:'boss_ash_colossus',astral_leviathan:'boss_astral_leviathan'};
  for(const [id,artId] of Object.entries(bossArt)) expect(enemyById[id].portrait).toBe(ENCOUNTER_ART[artId]);
});
