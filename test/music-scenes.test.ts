import { expect, test } from 'bun:test';
import { musicForScene, musicAfterIntro, MUSIC_MIX, FLOWMUSIC_CUE_PLAN, flowMusicBriefForRoute } from '../src/data/music.js';
import { CHAPTERS, stageDef } from '../src/data/stages.js';
import { DUNGEONS, ARENA_RIVALS } from '../src/data/expansion.js';
import { EXPEDITION_DEPTHS, depthStage } from '../src/data/expedition-depths.js';

test('lobby, gacha and all authored campaign regions resolve exact AudioSys paths', () => {
  expect(`/bgm/${musicForScene({scene:'lobby'})}.mp3`).toBe('/bgm/regions/lobby.mp3');
  expect(musicForScene({scene:'gacha'})).toBe('bgm_gacha');
  const expected=['garden','forge','frost','tide','crown','homecoming'];
  for(const chapter of CHAPTERS) {
    expect(`/bgm/${musicForScene({stage:stageDef(chapter.id,1)})}.mp3`).toBe(`/bgm/regions/${expected[chapter.id-1]}.mp3`);
  }
  expect(MUSIC_MIX.volume).toBe(0.55);
});

test('expeditions inherit their region and arena retains its cue through boss and revival states', () => {
  for(const dungeon of DUNGEONS) {
    const stage={...dungeon.stage,expedition:{kind:'dungeon',id:dungeon.id}};
    expect(musicForScene({stage})).toBe(`regions/${dungeon.theme}`);
    expect(musicForScene({stage,boss:true})).toBe('regions/boss');
  }
  for(const rival of ARENA_RIVALS) {
    const stage={...rival.stage,expedition:{kind:'arena',id:rival.id}};
    expect(musicForScene({stage})).toBe('regions/arena');
    expect(musicForScene({stage,boss:true})).toBe('regions/arena');
    expect(musicForScene({stage:JSON.parse(JSON.stringify(stage)),boss:true})).toBe('regions/arena');
  }
});

test('battle resumes are deterministic and boss flags describe the current encounter, not stage metadata', () => {
  const stage=stageDef(6,10);
  expect(stage.boss).toBe(true);
  expect(musicForScene({stage})).toBe('regions/homecoming');
  expect(musicForScene({stage,boss:true})).toBe('regions/boss');
  const restored=JSON.parse(JSON.stringify(stage));
  expect(musicForScene({stage:restored,boss:true})).toBe('regions/boss');
  expect(musicForScene({stage:restored,boss:false})).toBe('regions/homecoming');
  expect(musicForScene({scene:'lobby',stage:restored,boss:true})).toBe('regions/lobby');
});

test('explicit stage theme and homecoming prefix override inherited theme with a safe unknown fallback', () => {
  expect(musicForScene({stage:{theme:'tide',chapter:{theme:'garden'}}})).toBe('regions/tide');
  expect(musicForScene({stage:{encounterPrefix:'homecoming',theme:'garden'}})).toBe('regions/homecoming');
  expect(musicForScene({stage:{chapter:{encounterPrefix:'homecoming',theme:'garden'}}})).toBe('regions/homecoming');
  expect(musicForScene({stage:{theme:'unknown'}})).toBe('regions/garden');
  expect(musicForScene()).toBe('regions/garden');
});

test('a completed intro resumes only its still-active battle and uses the current boss state', () => {
  const stage={...stageDef(2,1),expedition:{kind:'dungeon'}};
  const current={mode:'battle',active:true,stage,expectedStage:stage,boss:false};
  expect(musicAfterIntro(current)).toBe('regions/forge');
  expect(musicAfterIntro({...current,boss:true})).toBe('regions/boss');
  expect(musicAfterIntro({...current,mode:'lobby'})).toBeNull();
  expect(musicAfterIntro({...current,active:false})).toBeNull();
  expect(musicAfterIntro({...current,stage:null})).toBeNull();
  // A new run of the same dungeon is a different battle, even with the same code.
  expect(musicAfterIntro({...current,stage:{...stage}})).toBeNull();
  const arena={...stage,expedition:{kind:'arena'}};
  expect(musicAfterIntro({...current,stage:arena,expectedStage:arena,boss:true})).toBe('regions/arena');
});

test('new seasonal routes carry a distinct FlowMusic brief with a verified fallback cue', () => {
  expect(FLOWMUSIC_CUE_PLAN.length).toBeGreaterThanOrEqual(15);
  for (const route of EXPEDITION_DEPTHS.map(depth => depth.id)) {
    const brief = flowMusicBriefForRoute(route);
    expect(brief?.status).toBe('external-gui-pending');
    expect(brief?.fallback).toMatch(/^regions\//);
    expect(brief?.target).toBeTruthy();
  }
});

test('every deep expedition uses its explicit cue slot while boss state keeps the boss mix', () => {
  for (const depth of EXPEDITION_DEPTHS) {
    const stage = { ...depthStage(depth.id), expedition: { kind: 'dungeon', id: depth.id, depth: 'deep' } };
    const brief = flowMusicBriefForRoute(depth.id);
    if (!brief) throw new Error(`missing FlowMusic cue for ${depth.id}`);
    expect(musicForScene({ stage })).toBe(brief.fallback);
    expect(musicForScene({ stage, boss: true })).toBe('regions/boss');
  }
});
