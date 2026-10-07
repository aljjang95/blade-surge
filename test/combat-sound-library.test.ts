import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AudioSys } from '../src/engine/audio.js';
import { COMBAT_SOUND_FILES, attackSound, skillSound, ULTIMATE_SOUND } from '../src/engine/combat-sound-library.js';
import { HEROES } from '../src/data/heroes.js';

class Param {
  value = 1;
  setValueAtTime(value: number) { this.value = value; }
}
class Node {
  gain = new Param(); playbackRate = new Param(); buffer: any;
  onended: (() => void) | null = null; stopped = false; disconnected = false;
  connect() {} disconnect() { this.disconnected = true; } start() {}
  stop() { this.stopped = true; this.onended?.(); }
}
function fixture() {
  const audio: any = new AudioSys();
  audio.ctx = { currentTime: 1, state: 'running', createGain: () => new Node(), createBufferSource: () => new Node() };
  audio.sfxGain = new Node();
  for (const name of COMBAT_SOUND_FILES) audio.buffers[name] = { name, duration: .5 };
  audio.vibe = () => {};
  return audio;
}
afterEach(() => mock.restore());

test('12개 배송 MP3는 제작 manifest의 SHA·크기와 일치하고 짧은 비음성 파형 증거를 유지한다', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/sfx/crafted/combat-v1/manifest.json', import.meta.url), 'utf8'));
  expect(manifest.license).toBe('CC0-1.0'); expect(manifest.voicesModified).toBe(false);
  expect(manifest.assets).toHaveLength(COMBAT_SOUND_FILES.length);
  let bytes = 0;
  for (const asset of manifest.assets) {
    const data = readFileSync(new URL('../public' + asset.path, import.meta.url));
    expect(createHash('sha256').update(data).digest('hex')).toBe(asset.sha256); expect(data.length).toBe(asset.bytes);
    expect(asset.durationSec).toBeGreaterThanOrEqual(.2); expect(asset.durationSec).toBeLessThan(.7);
    expect(asset.decodedPeak).toBeLessThan(.98); expect(asset.decodedRms).toBeGreaterThan(.015);
    expect(asset.decodedSamples / manifest.sampleRate).toBeCloseTo(asset.durationSec, 6); bytes += data.length;
  }
  expect(bytes).toBeLessThan(100000);
});

test('모든 실제 영웅·40 스킬은 배송 라이브러리로 연결되고 마법 원소·무기 계열이 구별된다', () => {
  const assets = new Set(COMBAT_SOUND_FILES);
  for (const hero of Object.values(HEROES)) {
    expect(assets.has(attackSound(hero.weapon, 'ranged' in hero && hero.ranged))).toBe(true);
    for (const skill of hero.skills) expect(assets.has(skillSound(skill.id, hero.id))).toBe(true);
  }
  expect(new Set(Object.values(HEROES).map(hero => attackSound(hero.weapon, 'ranged' in hero && hero.ranged))).size).toBe(5);
  expect(new Set(['fireball', 'chain', 'blizzard', 'chrono_seal'].map(id => skillSound(id, 'mage'))).size).toBe(4);
  expect(skillSound('unlisted', 'rogue')).toEndWith('/shadow'); expect(skillSound('__proto__', '__proto__')).toEndWith('/arcane');
});

test('실제 release 경로는 직업 샘플을 재생하고 글로벌 RNG·타이머·실시간 합성을 쓰지 않는다', () => {
  const rng = spyOn(Math, 'random').mockImplementation(() => { throw new Error('게임 난수 사용'); });
  const timer = spyOn(globalThis, 'setTimeout').mockImplementation((() => { throw new Error('release 타이머 사용'); }) as any);
  const audio = fixture();
  for (const hero of Object.values(HEROES)) {
    audio.ctx.currentTime += .2;
    audio.attackRelease({ weapon: hero.weapon, ranged: 'ranged' in hero && hero.ranged });
    audio.ctx.currentTime += .12;
    audio.skillRelease({ school: hero.skills[0]!.id, hero: hero.id });
  }
  const active: any[] = [...audio._voices];
  expect(active).toHaveLength(10);
  expect(new Set(active.map(voice => voice.src.buffer.name)).size).toBeGreaterThanOrEqual(8);
  expect(active.every(voice => voice.group === 'sfx')).toBe(true); expect(rng).not.toHaveBeenCalled(); expect(timer).not.toHaveBeenCalled();
  audio.setSfxOn(false);
});

test('혼전 sample 한도를 지키고 궁극기·기합을 보존하며 반복 mute 뒤 예약·노드가 남지 않는다', () => {
  const audio = fixture(); audio.voiceGain = new Node(); audio.voiceBuf.original = { name: 'original', duration: 1 };
  const bark = audio.bark('original');
  audio.skillRelease({ ult: true, school: 'meteor', hero: 'mage' });
  const ultimate = [...audio._voices].find((voice: any) => voice.src.buffer.name === ULTIMATE_SOUND);
  for (let i = 0; i < 100; i++) {
    audio.ctx.currentTime += .08; audio.attackRelease({ weapon: 'dual' });
  }
  expect(audio.getDiagnostics().voices).toEqual({ sfx: 16, bark: 1, narration: 0 });
  expect(ultimate.src.stopped).toBe(false); expect(bark.stopped).toBe(false);
  const active: any[] = [...audio._voices].filter((voice: any) => voice.group === 'sfx');
  audio.setSfxOn(false); audio.setSfxOn(false);
  expect(audio.getDiagnostics().voices).toEqual({ sfx: 0, bark: 1, narration: 0 });
  expect(active.every(voice => voice.src.stopped && voice.src.disconnected && voice.gain.disconnected)).toBe(true);
  audio.attackRelease({ weapon: '1h' }); audio.skillRelease({ school: 'fireball' }); expect(audio._voices.size).toBe(1);
  expect(audio._hitPending).toBeNull(); expect(audio._hitTimer).toBeNull();
  audio.setSfxOn(true); audio.ctx.currentTime += 1; audio.attackRelease({ weapon: 'bow' }); expect(audio._voices.size).toBe(2);
  audio.setSfxOn(false); audio.setVoiceOn(false); expect(audio._voices.size).toBe(0);
});
