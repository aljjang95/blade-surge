import { afterEach, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AudioSys, MASTER_LIMITER, MASTER_OUT_GAIN, SFX_SUM_GAIN } from '../src/engine/audio.js';
import { BGM_CROSSFADE, BGM_LOOPS, BOSS_CUE_PLAN, MUSIC_TRACKS, bgmTrimGain, bossIntroKind, musicForScene } from '../src/data/music.js';
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

test('지역별 보스곡 생성 대기 칸은 배송된 대체 곡으로 풀리고, 모든 곡 파일이 실제로 있다', () => {
  expect(BOSS_CUE_PLAN.length).toBe(12);
  expect(new Set(BOSS_CUE_PLAN.map(c => c.id)).size).toBe(12);
  for (const cue of BOSS_CUE_PLAN) expect(cue.status).toBe('external-gui-pending');
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

// ---------- 사건 효과음 ----------
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BOSS_INTRO, EVENT_SOUNDS, EVENT_SOUND_FILES, FX_SOUND_FILES, lootSound, sfxUrl } from '../src/engine/combat-sound-library.js';
import { RARITIES } from '../src/data/items.js';

test('사건 효과음 파일은 모두 배송되고 매니페스트 SHA·출처와 일치한다', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'public/sfx/mirelo-v1/event/manifest.json'), 'utf8'));
  expect(manifest.model ?? manifest.generator).toContain('mirelo');
  for (const name of EVENT_SOUND_FILES) {
    const url = sfxUrl(name), file = join(root, 'public', url);
    expect(existsSync(file), url).toBe(true);
    const asset = manifest.assets.find((a: any) => a.path === url);
    expect(asset, url).toBeDefined();
    expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(asset.sha256);
    expect(asset.taskUUID).toMatch(/^[0-9a-f-]{36}$/);
    expect(asset.decodedPeak).toBeLessThanOrEqual(0.95); // -1dBFS 정규화 + MP3 디코드 오버슈트(기존 라이브러리 0.94 이하와 같은 기준)
  }
});

test('전리품 희귀도와 가챠 등급은 서로 다른 소리로 올라가고 전설만 BGM 을 낮춘다', () => {
  const names = RARITIES.map(r => lootSound(r).sound);
  expect(names[0]).toBe('ui_drop');
  expect(new Set(names).size).toBe(4);
  expect(lootSound('L').sound).toBe(EVENT_SOUNDS.lootLegend);
  expect(lootSound('SSR').sound).toBe(EVENT_SOUNDS.lootLegend);
  expect(lootSound('SR').sound).toBe(EVENT_SOUNDS.lootEpic);
  expect(lootSound('R').sound).toBe(EVENT_SOUNDS.lootRare);
  expect(RARITIES.filter(r => lootSound(r).duck > 0)).toEqual(['L']);
  const vols = RARITIES.slice(1).map(r => lootSound(r).vol);
  expect([...vols].sort((a, b) => a - b)).toEqual(vols);
});

function sfxFixture() {
  const s: any = new AudioSys();
  s.ctx = { currentTime: 5, state: 'running', createGain: () => new Node(), createBufferSource: () => Object.assign(new Node(), { playbackRate: new Param(), start() {}, stop() {}, onended: null, buffer: null }), createMediaElementSource: () => new Node() };
  s.sfxGain = new Node(); s.voiceGain = new Node(); s.musicGain = new Node(); s.musicDuckGain = new Node();
  for (const name of [...EVENT_SOUND_FILES, ...FX_SOUND_FILES, 'jingle_legend', 'ui_bong', 'card_place', 'ui_drop']) s.buffers[name] = { name, duration: 1 };
  return s;
}
const playing = (s: any) => [...s._voices].map((v: any) => v.src.buffer?.name).filter((n: string) => !n.includes('/fx/'));

test('보스 등장 스팅어는 최종/중간 보스를 구분하고 BGM 을 덕킹한다', () => {
  const finale = sfxFixture();
  finale.bossIntro(stageDef(1, 10));
  expect(playing(finale)).toEqual([BOSS_INTRO.finale.sound]);
  expect(Math.min(...finale.musicDuckGain.gain.events.map((e: any) => e.v))).toBeCloseTo(BOSS_INTRO.finale.duck, 6);
  const mid = sfxFixture();
  mid.bossIntro(stageDef(2, 5));
  expect(playing(mid)).toEqual([BOSS_INTRO.midboss.sound]);
  const gate = sfxFixture();
  gate.bossIntro(stageDef(3, 7));
  expect(playing(gate)).toEqual([BOSS_INTRO.midboss.sound]);
  // 샘플이 아직 없으면 예전 뿔피리 합성음으로 대신한다(소리가 비지 않는다).
  const cold = sfxFixture(); cold.buffers = {}; let horn = 0; cold.waveHorn = () => { horn++; };
  expect(cold.bossIntro(stageDef(1, 10))).toBeNull(); expect(horn).toBe(1);
  // SFX 를 끈 사용자는 스팅어도 덕킹도 받지 않는다.
  const muted = sfxFixture(); muted.mix.sfx = 0; muted.bossIntro(stageDef(1, 10));
  expect(playing(muted)).toEqual([]); expect(muted.musicDuckGain.gain.events.length).toBe(0);
});

test('가챠 연출은 충전 → 최고 등급 공개 → 카드별 등급음 순서로 서로 다른 소리를 낸다', () => {
  const s = sfxFixture();
  s.gachaCharge(); expect(playing(s)).toContain(EVENT_SOUNDS.gachaCharge);
  const sr = sfxFixture(); sr.gachaReveal('SR'); expect(playing(sr)).toContain(EVENT_SOUNDS.gachaRevealSr);
  const ssr = sfxFixture(); ssr.gachaReveal('SSR'); expect(playing(ssr)).toContain('jingle_legend');
  expect(Math.min(...ssr.musicDuckGain.gain.events.map((e: any) => e.v))).toBeLessThan(0.5);
  const r = sfxFixture(); r.gachaReveal('R'); expect(playing(r)).toEqual(['ui_bong']);
  const cards = sfxFixture(); cards.gachaCard('R'); cards.gachaCard('SR'); expect(playing(cards)).toEqual(['card_place', EVENT_SOUNDS.gachaRevealSr]);
});

test('보스의 큰 기술 예고에만 경보음을 얹고 3초 안에 다시 울리지 않는다', () => {
  const s = sfxFixture();
  s.enemyTelegraph({ kind: 'melee', boss: true }); expect(playing(s)).not.toContain(EVENT_SOUNDS.bossWarning);
  s.enemyTelegraph({ kind: 'slam', boss: true }); expect(playing(s).filter((n: string) => n === EVENT_SOUNDS.bossWarning).length).toBe(1);
  s.ctx.currentTime += 1; s.enemyTelegraph({ kind: 'fan', boss: true });
  expect(playing(s).filter((n: string) => n === EVENT_SOUNDS.bossWarning).length).toBe(1);
  s.ctx.currentTime += 3; s.enemyTelegraph({ kind: 'soulrain', boss: true });
  expect(playing(s).filter((n: string) => n === EVENT_SOUNDS.bossWarning).length).toBe(2);
  const mob = sfxFixture(); mob.enemyTelegraph({ kind: 'slam', boss: false }); expect(playing(mob)).not.toContain(EVENT_SOUNDS.bossWarning);
});

test('사건 효과음 첫 로드가 실패해도 다음 사건 때 다시 불러오고, 그 사이에는 대체음을 낸다', async () => {
  const s = sfxFixture(); delete s.buffers[BOSS_INTRO.finale.sound];
  let calls = 0; const decoded = { name: BOSS_INTRO.finale.sound, duration: 3 };
  const realFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => { calls++; return { arrayBuffer: async () => ({}) }; };
  s.ctx.decodeAudioData = async () => decoded;
  let horn = 0; s.waveHorn = () => { horn++; };
  try {
    expect(s.bossIntro(stageDef(1, 10))).toBeNull(); expect(horn).toBe(1);
    s.bossIntro(stageDef(1, 10)); expect(calls).toBe(1); // 같은 파일을 겹쳐 받지 않는다
    await s._loadSfx(BOSS_INTRO.finale.sound);
    s.ctx.currentTime += 2; s.bossIntro(stageDef(1, 10));
    expect(playing(s)).toEqual([BOSS_INTRO.finale.sound]);
  } finally { (globalThis as any).fetch = realFetch; }
});

test('마스터 마지막 안전 클립은 작은 신호는 그대로 두고 어떤 입력도 -1dBFS 아래로 묶는다', async () => {
  const { masterClipCurve } = await import('../src/engine/audio.js');
  const c = masterClipCurve(2049), at = (x: number) => c[Math.round((x + 1) / 2 * 2048)];
  expect(at(0.5)).toBeCloseTo(0.5, 3);
  expect(at(-0.6)).toBeCloseTo(-0.6, 3);
  expect(Math.max(...c)).toBeLessThan(Math.pow(10, -1 / 20));
  for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
});
