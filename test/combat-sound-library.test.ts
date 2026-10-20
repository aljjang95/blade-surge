import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AudioSys } from '../src/engine/audio.js';
import {
  COMBAT_SOUND_FILES, FX_SOUND_FILES, HIT_SOUND_FILES, SFX_LIBRARY, UI_SOUND_NAMES,
  attackSound, heroHitSound, sfxUrl, skillSound, ultimateSound,
} from '../src/engine/combat-sound-library.js';
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

const manifest = JSON.parse(readFileSync(new URL('../public/sfx/mirelo-v1/manifest.json', import.meta.url), 'utf8'));
const byPath = new Map<string, any>(manifest.assets.map((asset: any) => [asset.path, asset]));
/** 게임이 재생하는 버퍼 이름 → 실제로 배송된 manifest 항목(없으면 undefined). 로더와 같은 sfxUrl 로 찾는다. */
const shipped = (name: string) => byPath.get(sfxUrl(name));
const ALL_SOUNDS = [...UI_SOUND_NAMES, ...FX_SOUND_FILES, ...HIT_SOUND_FILES, ...COMBAT_SOUND_FILES];

test('게임이 불러오는 Mirelo 효과음 178개는 manifest 와 1:1이고 SHA·크기·RMS·온셋·Runware 출처가 맞으며 총량이 3MB 아래다', () => {
  expect(manifest.library).toBe('mirelo-v1'); expect(SFX_LIBRARY).toBe('mirelo-v1/');
  expect(manifest.sampleRate).toBe(44100); expect(manifest.channels).toBe(1);
  // 코드가 부르는 모든 이름이 서로 다른 배송 파일 하나로 가고, 배송됐지만 아무도 부르지 않는 파일도 없다.
  const urls = ALL_SOUNDS.map(sfxUrl);
  expect(new Set(urls).size).toBe(urls.length);
  expect([...urls].sort()).toEqual(manifest.assets.map((asset: any) => asset.path).sort());
  expect(manifest.assets).toHaveLength(178);
  let bytes = 0;
  for (const asset of manifest.assets) {
    expect(asset.path).toBe(`/sfx/mirelo-v1/${asset.id}.mp3`);
    const data = readFileSync(new URL('../public' + asset.path, import.meta.url));
    expect(createHash('sha256').update(data).digest('hex')).toBe(asset.sha256); expect(data.length).toBe(asset.bytes);
    // 짧은 효과음: 음악·긴 앰비언스가 섞여 들어오지 않는다(모바일 메모리).
    expect(asset.durationSec).toBeGreaterThan(.03); expect(asset.durationSec).toBeLessThanOrEqual(3.5);
    // 무음·거의 무음 파일 금지, 앞 무음 없이 2ms 안에 소리가 시작한다(첫 타격 지연 없음).
    expect(asset.decodedRms).toBeGreaterThan(.01);
    expect(asset.onsetMs).toBeGreaterThanOrEqual(0); expect(asset.onsetMs).toBeLessThanOrEqual(2);
    // 출처: Runware Mirelo SFX 1.5 생성 작업 하나와 그 원본 WAV 해시, 생성 프롬프트.
    expect(asset.provider).toBe('runware'); expect(asset.model).toBe('mirelo:1@1');
    expect(asset.taskUUID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(asset.sourceSha256).toMatch(/^[0-9a-f]{64}$/); expect(asset.prompt.length).toBeGreaterThan(10);
    bytes += data.length;
  }
  // 파일마다 별도 생성 작업이고, 같은 내용을 이름만 바꿔 여러 번 싣지 않았다.
  expect(new Set(manifest.assets.map((asset: any) => asset.taskUUID)).size).toBe(manifest.assets.length);
  expect(new Set(manifest.assets.map((asset: any) => asset.sha256)).size).toBe(manifest.assets.length);
  expect(bytes).toBeLessThan(3_000_000); expect(bytes).toBe(manifest.assets.reduce((sum: number, asset: any) => sum + asset.bytes, 0));
});

test('모든 배송 효과음의 디코딩 피크는 0.98 미만이다(MP3 디코드 오버슈트로 0dBFS 를 넘는 파일 금지)', () => {
  const over = manifest.assets.filter((asset: any) => !(asset.decodedPeak < .98)).map((asset: any) => `${asset.id}=${asset.decodedPeak}`);
  expect(over).toEqual([]);
});

test('다섯 영웅의 휘두름·마무리·접촉·궁극기와 40 스킬은 모두 배송 파일이고 75개가 서로 다른 소리다', () => {
  const heroes = Object.values(HEROES);
  expect(heroes.map(hero => hero.id).sort()).toEqual(['barbarian', 'knight', 'mage', 'ranger', 'rogue']);
  const sha = (name: string): string => { const asset = shipped(name); expect(asset).toBeDefined(); return asset.sha256; };
  const swings = new Set<string>(), finishers = new Set<string>(), hits = new Set<string>(), ults = new Set<string>(), skills = new Set<string>();
  let skillCount = 0;
  for (const hero of heroes) {
    const ranged = 'ranged' in hero && !!hero.ranged, own = `${SFX_LIBRARY}hero/${hero.id}/`;
    // 호출부는 무기만 넘긴다. 무기만으로 그 영웅 자신의 폴더를 골라야 한다.
    for (let variant = 0; variant < 3; variant++) {
      const swing = attackSound(hero.weapon, ranged, { variant }); expect(swing.startsWith(own)).toBe(true); swings.add(sha(swing));
    }
    const finisher = attackSound(hero.weapon, ranged, { finisher: true }); expect(finisher.startsWith(own)).toBe(true); finishers.add(sha(finisher));
    for (let variant = 0; variant < 2; variant++) hits.add(sha(heroHitSound(hero.id, variant)));
    ults.add(sha(ultimateSound(hero.id)));
    for (const skill of hero.skills) {
      const file = skillSound(skill.id, hero.id);
      expect(file.startsWith(own)).toBe(true); expect(file).not.toBe(finisher); // 실제 스킬은 마무리음으로 대체되지 않는다.
      skills.add(sha(file)); skillCount++;
    }
  }
  expect(swings.size).toBe(15); expect(finishers.size).toBe(5); expect(hits.size).toBe(10); expect(ults.size).toBe(5);
  expect(skillCount).toBe(40); expect(skills.size).toBe(40);
  expect(new Set([...swings, ...finishers, ...hits, ...ults, ...skills]).size).toBe(75);
  // 목록에 없는 스킬은 그 영웅의 마무리음으로, 프로토타입 키·모르는 영웅은 기본 영웅으로 내려가고 배송되지 않은 경로를 만들지 않는다.
  expect(skillSound('unlisted', 'rogue')).toBe(attackSound('dual', false, { finisher: true }));
  for (const name of [skillSound('__proto__', '__proto__'), attackSound('__proto__'), attackSound('blade', false, { variant: -7 }), ultimateSound('constructor'), heroHitSound('toString', 7)])
    expect(shipped(name)).toBeDefined();
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
  const ultimate = [...audio._voices].find((voice: any) => voice.src.buffer.name === ultimateSound('mage'));
  const cast = [...audio._voices].find((voice: any) => voice.src.buffer.name === skillSound('meteor', 'mage'));
  expect(ultimate).toBeDefined(); expect(cast).toBeDefined();
  for (let i = 0; i < 100; i++) {
    audio.ctx.currentTime += .08; audio.attackRelease({ weapon: 'dual' });
  }
  expect(audio.getDiagnostics().voices).toEqual({ sfx: 16, bark: 1, narration: 0 });
  expect(ultimate.src.stopped).toBe(false); expect(cast.src.stopped).toBe(false); expect(bark.stopped).toBe(false);
  const active: any[] = [...audio._voices].filter((voice: any) => voice.group === 'sfx');
  audio.setSfxOn(false); audio.setSfxOn(false);
  expect(audio.getDiagnostics().voices).toEqual({ sfx: 0, bark: 1, narration: 0 });
  expect(active.every(voice => voice.src.stopped && voice.src.disconnected && voice.gain.disconnected)).toBe(true);
  audio.attackRelease({ weapon: '1h' }); audio.skillRelease({ school: 'fireball' }); expect(audio._voices.size).toBe(1);
  expect(audio._hitPending).toBeNull(); expect(audio._hitTimer).toBeNull();
  audio.setSfxOn(true); audio.ctx.currentTime += 1; audio.attackRelease({ weapon: 'bow' }); expect(audio._voices.size).toBe(2);
  audio.setSfxOn(false); audio.setVoiceOn(false); expect(audio._voices.size).toBe(0);
});

test('궁극기 release 는 시전한 영웅의 스킬음과 그 영웅 전용 충격음을 내고 다른 영웅의 충격음은 내지 않는다', () => {
  const played = new Set<string>();
  for (const hero of Object.values(HEROES)) {
    const audio = fixture(), ult = hero.skills.at(-1)!.id;
    audio.skillRelease({ ult: true, school: ult, hero: hero.id });
    const heard = [...audio._voices].map((voice: any) => voice.src.buffer.name as string);
    expect(heard).toContain(skillSound(ult, hero.id)); expect(heard).toContain(ultimateSound(hero.id));
    expect(heard.filter(name => name.endsWith('/ult_impact'))).toEqual([ultimateSound(hero.id)]);
    played.add(ultimateSound(hero.id));
    // 일반 스킬은 충격음 없이 스킬음만 낸다.
    const normal = fixture(); normal.skillRelease({ school: hero.skills[0]!.id, hero: hero.id });
    expect([...normal._voices].map((voice: any) => voice.src.buffer.name)).toEqual([skillSound(hero.skills[0]!.id, hero.id)]);
  }
  expect(played.size).toBe(5);
});
