import { afterEach, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AudioSys, MASTER_LIMITER, MASTER_OUT_GAIN, SFX_SUM_GAIN } from '../src/engine/audio.js';
import { BGM_CROSSFADE, BGM_LOOPS, BOSS_CUE_PLAN, MUSIC_TRACKS, TOWN_CUES, bgmTrimGain, bossIntroKind, musicForScene } from '../src/data/music.js';
import { CHAPTERS, stageDef } from '../src/data/stages.js';
import { DUNGEONS } from '../src/data/expansion.js';

const root = join(import.meta.dir, '..');

test('캠페인 최종 보스·중간 보스·수문장은 서로 다른 보스곡, 대장과 원정 보스는 기존 보스곡', () => {
  for (const chapter of CHAPTERS) {
    const at = (st: number) => musicForScene({ stage: stageDef(chapter.id, st), boss: true });
    expect(at(10)).toBe('regions/boss');
    expect(at(5)).toBe('expansion/flow-combat');
    expect(at(3)).toBe('expansion/flow-combat');
    expect(at(7)).toBe('expansion/flow-combat');
    expect(at(1)).toBe('regions/boss');
    expect(at(5)).not.toBe(at(10));
    expect(bossIntroKind(stageDef(chapter.id, 10))).toBe('finale');
    expect(bossIntroKind(stageDef(chapter.id, 5))).toBe('midboss');
    expect(bossIntroKind(stageDef(chapter.id, 1))).toBe('boss');
  }
  for (const dungeon of DUNGEONS) {
    const stage = { ...dungeon.stage, encounter: { rank: 'midboss' }, expedition: { kind: 'dungeon', id: dungeon.id } };
    expect(musicForScene({ stage, boss: true })).toBe('regions/boss');
    expect(bossIntroKind(stage)).toBe('boss');
  }
});

test('지역별 보스곡·마을곡 생성 대기 칸은 배송된 대체 곡으로 풀리고, 모든 곡 파일이 실제로 있다', () => {
  expect(BOSS_CUE_PLAN.length).toBe(12);
  expect(new Set(BOSS_CUE_PLAN.map(c => c.id)).size).toBe(12);
  for (const cue of BOSS_CUE_PLAN) expect(cue.status).toBe('external-gui-pending');
  expect(Object.keys(TOWN_CUES).sort()).toEqual(['emberport', 'oathhold', 'starcrest']);
  for (const town of Object.keys(TOWN_CUES)) expect(musicForScene({ scene: 'town', stage: { townId: town } })).toBe('regions/lobby');
  expect(musicForScene({ scene: 'town' })).toBe('regions/lobby');
  for (const name of MUSIC_TRACKS) expect(existsSync(join(root, 'public/bgm', name + '.mp3')), name).toBe(true);
  for (const chapter of CHAPTERS) for (let st = 1; st <= 10; st++) for (const boss of [false, true]) {
    expect(MUSIC_TRACKS).toContain(musicForScene({ stage: stageDef(chapter.id, st), boss }));
  }
});

test('모든 곡에 루프 지점과 음량 보정이 있고 크로스페이드보다 충분히 길다', () => {
  for (const name of MUSIC_TRACKS) {
    const loop = BGM_LOOPS[name as keyof typeof BGM_LOOPS];
    expect(loop, name).toBeDefined();
    expect(loop.loopEnd - loop.loopStart).toBeGreaterThan(BGM_CROSSFADE * 10);
    expect(Math.abs(loop.trimDb)).toBeLessThanOrEqual(6);
  }
  // 측정값: 가챠 -15.5, 중간 보스곡 -13.9 LUFS 를 지역곡 -18 LUFS 에 맞춘다.
  expect(bgmTrimGain('bgm_gacha')).toBeCloseTo(Math.pow(10, -2.5 / 20), 6);
  expect(bgmTrimGain('expansion/flow-combat')).toBeLessThan(bgmTrimGain('bgm_gacha'));
  expect(bgmTrimGain('regions/garden')).toBe(1);
  expect(bgmTrimGain('unknown')).toBe(1);
});

test('마스터 리미터 출력 이득은 압축기 자동 메이크업을 되돌려 천장을 0dBFS 아래에 둔다', () => {
  const { threshold, ratio } = MASTER_LIMITER;
  const makeupDb = -0.6 * (threshold - threshold / ratio);
  // 임계 위 입력은 비율 20 으로 눌리므로 출력 천장은 대략 임계값 + 메이크업 + 출력 이득이다.
  const ceilingDb = threshold + makeupDb + 20 * Math.log10(MASTER_OUT_GAIN);
  expect(ceilingDb).toBeLessThan(-1);
  expect(SFX_SUM_GAIN).toBeLessThan(1);
});

// ---------- BGM 루프 크로스페이드 ----------
class Param {
  value = 1; events: { t: number, v: number, kind: string }[] = [];
  setValueAtTime(v: number, t: number) { this.value = v; this.events.push({ t, v, kind: 'set' }); }
  linearRampToValueAtTime(v: number, t: number) { this.events.push({ t, v, kind: 'ramp' }); }
  cancelScheduledValues(t: number) { this.events = this.events.filter(e => e.t < t); }
}
class Node { gain = new Param(); disconnected = false; connect() {} disconnect() { this.disconnected = true; } }
class FakeAudio {
  static made: FakeAudio[] = [];
  src: string; currentSrc: string; loop = false; crossOrigin = ''; preload = ''; currentTime = 0; ended = false; paused = true;
  ontimeupdate: (() => void) | null = null; onended: (() => void) | null = null;
  constructor(src: string) { this.src = src; this.currentSrc = 'http://x' + src; FakeAudio.made.push(this); }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}
const realAudio = (globalThis as any).Audio;
afterEach(() => { (globalThis as any).Audio = realAudio; FakeAudio.made = []; });
function fixture() {
  (globalThis as any).Audio = FakeAudio;
  const s: any = new AudioSys();
  s.ctx = { currentTime: 10, state: 'running', createGain: () => new Node(), createMediaElementSource: () => new Node() };
  s.musicGain = new Node(); s.musicDuckGain = new Node();
  return s;
}

test('지역곡은 끝 여운 전 loopEnd 에서 loopStart 로 한 번만 겹쳐 넘어가고, 이전 재생은 정리된다', () => {
  const s = fixture(), loop = BGM_LOOPS['regions/forge'];
  s.playMusic('regions/forge', { fade: 0.7, volume: 0.55 });
  const first = s.music, el = FakeAudio.made[0];
  expect(el.loop).toBe(false);
  el.currentTime = loop.loopEnd - BGM_CROSSFADE - 1; el.ontimeupdate?.();
  expect(FakeAudio.made.length).toBe(1);
  el.currentTime = loop.loopEnd - BGM_CROSSFADE + 0.1; el.ontimeupdate?.(); el.ontimeupdate?.();
  expect(FakeAudio.made.length).toBe(2);
  const next = FakeAudio.made[1];
  expect(next.src).toBe(`http://x/bgm/regions/forge.mp3#t=${loop.loopStart}`);
  expect(next.paused).toBe(false);
  expect(s.music).not.toBe(first);
  expect(s.musicName).toBe('regions/forge');
  expect(first.gain.gain.events.at(-1)).toEqual({ t: 10 + BGM_CROSSFADE, v: 0, kind: 'ramp' });
  expect(s.music.gain.gain.events.at(-1)).toEqual({ t: 10 + BGM_CROSSFADE, v: 0.55, kind: 'ramp' });
  // 다른 장면으로 바뀐 뒤 늦게 온 시간 이벤트는 새 재생을 만들지 않는다.
  s.playMusic('regions/lobby');
  next.currentTime = 9999; next.ontimeupdate?.();
  expect(FakeAudio.made.length).toBe(3);
});

test('가챠곡은 측정 라우드니스만큼 낮춰 페이드인하고 끝나면(시간 이벤트 누락) 바로 이어 붙인다', () => {
  const s = fixture();
  s.playMusic('bgm_gacha', { fade: 1, volume: 0.55 });
  expect(s.music.gain.gain.events.at(-1).v).toBeCloseTo(0.55 * bgmTrimGain('bgm_gacha'), 6);
  const el = FakeAudio.made[0]; el.ended = true; el.onended?.();
  expect(FakeAudio.made.length).toBe(2);
  expect(s.music.gain.gain.events.at(-1).t).toBeCloseTo(10.05, 6);
});
