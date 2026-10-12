import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { AudioSys } from '../src/engine/audio.js';
import {
  COMBAT_SOUND_FILES, COMBO_STINGERS, HIT_PRIORITY, HIT_SOUND_FILES, HIT_TIERS, HIT_VARIANTS, KILL_SOUND,
  hitLayers, hitSoundName, hitTier, isPremiumHit,
} from '../src/engine/combat-sound-library.js';

class Param {
  value = 1; events: { t: number, v: number }[] = [];
  setValueAtTime(v: number, t: number) { this.value = v; this.events.push({ t, v }); }
  linearRampToValueAtTime(v: number, t: number) { this.events.push({ t, v }); }
  cancelScheduledValues(t: number) { this.events = this.events.filter(e => e.t < t); }
  at(t: number) {
    let prev = { t: 0, v: 1 };
    for (const e of this.events) { if (e.t > t) return prev.v + (e.v - prev.v) * (t - prev.t) / (e.t - prev.t); prev = e; }
    return prev.v;
  }
}
class Node {
  gain = new Param(); playbackRate = new Param(); buffer: any;
  onended: (() => void) | null = null; stopped = false;
  connect() {} disconnect() {} start() {} stop() { this.stopped = true; this.onended?.(); }
}
function fixture() {
  const audio: any = new AudioSys();
  audio.ctx = { currentTime: 1, state: 'running', createGain: () => new Node(), createBufferSource: () => new Node() };
  audio.sfxGain = new Node(); audio.musicDuckGain = new Node();
  for (const name of [...HIT_SOUND_FILES, ...COMBAT_SOUND_FILES]) audio.buffers[name] = { name, duration: .3 };
  audio.vibe = () => {};
  return audio;
}
const layersOf = (...args: unknown[]): any[] => [...(hitLayers as any)(...args)];
const names = (audio: any) => [...audio._voices].map((voice: any) => voice.src.buffer.name as string);
afterEach(() => mock.restore());

const manifest = JSON.parse(readFileSync(new URL('../public/sfx/hit-v2/manifest.json', import.meta.url), 'utf8'));

test('hit-v2 manifest: 모든 배송 파일의 SHA·크기·피크·온셋·출처가 CC0 계약과 맞고 총량이 1.5MB 아래다', () => {
  expect(manifest.license).toBe('CC0-1.0'); expect(manifest.voicesModified).toBe(false);
  expect(manifest.assets.map((a: any) => `hit-v2/${a.id}`).sort()).toEqual([...HIT_SOUND_FILES].sort());
  let bytes = 0;
  for (const asset of manifest.assets) {
    const data = readFileSync(new URL('../public' + asset.path, import.meta.url));
    expect(createHash('sha256').update(data).digest('hex')).toBe(asset.sha256); expect(data.length).toBe(asset.bytes);
    expect(asset.decodedPeak).toBeLessThan(.98); expect(asset.decodedRms).toBeGreaterThan(.01);
    expect(asset.decodedSamples / manifest.sampleRate).toBeCloseTo(asset.durationSec, 6);
    // 첫 사용 지연 없는 타격감: 접촉 레이어는 첫 1ms 안에 시작하고 짧다.
    if (asset.id.startsWith('t_')) { expect(asset.onsetMs).toBeLessThan(1); expect(asset.durationSec).toBeLessThanOrEqual(.6); }
    if (asset.id.startsWith('b_') || asset.id.startsWith('k_')) expect(asset.onsetMs).toBeLessThan(2);
    bytes += data.length;
  }
  expect(bytes).toBeLessThan(1_500_000); expect(bytes).toBe(manifest.assets.reduce((sum: number, a: any) => sum + a.bytes, 0));
  expect(existsSync(new URL('../public/sfx/hit-v2/LICENSE.txt', import.meta.url))).toBe(true);
  // 원본은 Kenney CC0 두 팩이며 zip SHA256 과 원본 ogg 해시가 모두 기록된다.
  expect(manifest.derivedFrom.map((s: any) => s.id).sort()).toEqual(['impact', 'rpg']);
  for (const source of manifest.derivedFrom) { expect(source.license).toBe('CC0-1.0'); expect(source.zipSha256).toMatch(/^[0-9a-f]{64}$/); }
  for (const file of Object.values(manifest.sourceFiles) as any[]) expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
});

test('모든 이벤트·등급은 트랜지언트와 바디 2레이어를 내고 등급별 파일이 구분되며 레이어 합의 이득 상한을 지킨다', () => {
  const sizes = new Map<string, Set<string>>();
  for (const tier of HIT_TIERS) for (const kind of ['slash', 'blunt', 'magic']) for (const crit of [false, true]) {
    const layers = layersOf(kind, tier, { crit });
    expect(layers.some(layer => layer.role === 'transient')).toBe(true); expect(layers.filter(layer => layer.role === 'body')).toHaveLength(1);
    for (const layer of layers) {
      expect(Object.hasOwn(HIT_VARIANTS, layer.id)).toBe(true); expect(layer.priority).toBe(HIT_PRIORITY[tier as keyof typeof HIT_PRIORITY]);
      expect(layer.vol).toBeGreaterThan(0); expect(layer.vol).toBeLessThanOrEqual(.85);
    }
    // 피크 합의 산술 상한(모든 레이어 피크가 같은 순간에 겹친다고 가정). 실제 렌더 피크는 tools/audio/measure-hit-mix.py.
    const bound = layers.reduce((sum, layer) => sum + layer.vol * manifest.assets.find((a: any) => a.id === `${layer.id}_0` || a.id === layer.id).decodedPeak, 0);
    expect(bound).toBeLessThan(1.75);
    sizes.set(tier, (sizes.get(tier) ?? new Set()).add(layers.map(layer => layer.id).join('+')));
  }
  const bodyOf = (tier: string) => layersOf('slash', tier).find(layer => layer.role === 'body')!.id;
  expect(new Set(HIT_TIERS.map(bodyOf)).size).toBe(HIT_TIERS.length);
  expect(layersOf('slash', 'basic', { weapon: 'bow' })[0]!.id).toBe('t_pierce');
  expect(layersOf('slash', 'basic', { weapon: '2h' }).find(layer => layer.role === 'body')!.id).toBe('b_heavy');
  expect(layersOf('slash', 'basic', { weapon: 'dual' }).find(layer => layer.role === 'body')!.id).toBe('b_light');
  expect(layersOf('magic', 'basic').find(layer => layer.role === 'body')!.id).toBe('b_magic');
  expect(layersOf('slash', 'nonsense').map(layer => layer.id)).toEqual(layersOf('slash', 'basic').map(layer => layer.id));
});

test('등급 판정: 카운터 > 마무리(보스면 boss) > 강타/치명타 > 혼잡 시 light > basic, 프리미엄은 3음 대상', () => {
  expect(hitTier({ counter: true, finisher: true })).toBe('counter');
  expect(hitTier({ finisher: true })).toBe('finisher'); expect(hitTier({ finisher: true, boss: true })).toBe('boss');
  expect(hitTier({ heavy: true })).toBe('heavy'); expect(hitTier({ crit: true })).toBe('heavy');
  expect(hitTier({ crowd: true })).toBe('light'); expect(hitTier({ crowd: true, crit: true })).toBe('heavy'); expect(hitTier({})).toBe('basic');
  expect(HIT_TIERS.filter(isPremiumHit)).toEqual(['counter', 'finisher', 'boss']);
});

test('hit-v2 타격은 한 번에 트랜지언트+바디를 재생하고 오디오 전용 RNG 만 쓴다', () => {
  const rng = spyOn(Math, 'random').mockImplementation(() => { throw new Error('게임 난수 사용'); });
  const audio = fixture(); audio.hit('slash', {});
  const played = names(audio);
  expect(played).toHaveLength(2); expect(played[0]).toMatch(/^hit-v2\/t_slash_/); expect(played[1]).toMatch(/^hit-v2\/b_basic_/);
  const voices = [...audio._voices] as any[]; expect(voices.every(voice => voice.priority === HIT_PRIORITY.basic)).toBe(true);
  // 변형은 같은 id 가 연달아 반복되지 않는다.
  const bodies = new Set<string>(); let last = '';
  for (let i = 0; i < 12; i++) { audio.ctx.currentTime += 1; audio._voices.clear(); audio.hit('blunt', {}); const body = names(audio).find(n => n.includes('/b_'))!; expect(body).not.toBe(last); last = body; bodies.add(body); }
  expect(bodies.size).toBe(2); expect(rng).not.toHaveBeenCalled();
});

test('50ms 창당 최대 2음: 세 번째 일반 타격은 대기하고 창이 열리면 대기 중 가장 센 하나만 재생된다', () => {
  const callbacks: Array<() => void> = [], delays: number[] = [];
  spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, delay: number) => { callbacks.push(fn); delays.push(delay); return 7; }) as any);
  const audio = fixture();
  audio.hit('slash', {}); audio.ctx.currentTime += .01; audio.hit('blunt', {});
  expect(audio._voices.size).toBe(4); expect(audio._hitRecent).toHaveLength(2);
  // 세 번째·네 번째·다섯 번째: 강타가 일반 타격을 대체하고 지연 타이머는 하나뿐이다.
  audio.ctx.currentTime += .01; audio.hit('slash', {}); audio.hit('slash', { crit: true, heavy: true }); audio.hit('magic', {});
  expect(audio._voices.size).toBe(4); expect(callbacks).toHaveLength(1);
  expect(delays[0]).toBeGreaterThanOrEqual(30); expect(delays[0]).toBeLessThanOrEqual(31);
  audio.ctx.currentTime = 1.05; callbacks[0]!();
  const later = names(audio).slice(4); expect(later.some(n => n.includes('/b_heavy_'))).toBe(true); expect(later.some(n => n.includes('/t_crit_'))).toBe(true);
  expect(audio.getDiagnostics().hitDropped).toBeGreaterThan(0);
  audio.setSfxOn(false);
});

test('마무리·보스·카운터는 창이 차도 3번째 음으로 즉시 재생된다', () => {
  spyOn(globalThis, 'setTimeout').mockImplementation((() => 7) as any);
  const audio = fixture();
  audio.hit('slash', {}); audio.hit('slash', {}); audio.hit('slash', { finisher: true, heavy: true });
  expect(audio._hitRecent).toHaveLength(3); expect(names(audio).some(n => n.includes('/b_finisher_'))).toBe(true);
  audio.hit('slash', { counter: true }); expect(names(audio).some(n => n.includes('/t_counter_'))).toBe(false); // 4번째는 대기
  audio.setSfxOn(false);
});

test('몹몰이 혼잡 시 일반 타격은 light 로 내려가고 보이스 상한 16 에서 가벼운 타격이 먼저 밀려난다', () => {
  spyOn(globalThis, 'setTimeout').mockImplementation((() => 7) as any);
  const audio = fixture(); const ui = audio.play('hit-v2/c_10', { priority: 4, min: 0 }), counter = audio.play('hit-v2/t_counter_0', { priority: 4, min: 0 });
  for (let i = 0; i < 80; i++) { audio.ctx.currentTime += .004; audio._hitRecent = []; audio.hit('slash', {}); }
  expect(audio._voices.size).toBe(16); expect(ui.stopped).toBe(false); expect(counter.stopped).toBe(false);
  expect(names(audio).some(n => n.includes('/b_light_'))).toBe(true);
  audio.setSfxOn(false); expect(audio._voices.size).toBe(0);
});

test('처치 확정음: 80ms 창당 2음, 5킬이 몰리면 대량 처치음 한 번, 정예·보스는 항상 들린다', () => {
  const audio = fixture();
  for (let i = 0; i < 4; i++) { audio.ctx.currentTime += .002; audio.kill(); }
  expect(names(audio).filter(n => n.includes('/k_pop_'))).toHaveLength(2);
  audio.ctx.currentTime += .002; audio.kill(); // 5번째 → mass
  expect(names(audio).filter(n => n.includes('/k_elite_'))).toHaveLength(1);
  audio.ctx.currentTime += .002; audio.kill(); expect(names(audio).filter(n => n.includes('/k_elite_'))).toHaveLength(1);
  audio.kill({ boss: true }); audio.kill({ elite: true });
  expect(names(audio)).toContain(hitSoundName('k_boss', 0)); expect(names(audio).filter(n => n.includes('/k_elite_'))).toHaveLength(2);
  const boss = [...audio._voices].find((voice: any) => voice.src.buffer.name === hitSoundName('k_boss', 0)) as any;
  expect(boss.priority).toBe(KILL_SOUND.boss.priority);
  audio.setSfxOn(false); expect(audio.kill()).toBeNull();
});

test('콤보 스팅어: 10/25/50 에서 각각 한 번, 점프해도 가장 높은 단계 하나, 콤보가 끊기면 다시 장전된다', () => {
  const audio = fixture(); const fired = () => names(audio).filter(n => /\/c_\d+$/.test(n));
  for (let n = 1; n <= 60; n++) { audio.ctx.currentTime += .1; audio.comboStep(n); audio.comboStep(n); }
  expect(fired()).toEqual(COMBO_STINGERS.map(s => `hit-v2/${s.id}`));
  const again = fixture(); again.comboStep(26); expect(names(again).filter(n => n.includes('/c_'))).toEqual(['hit-v2/c_25']);
  again.comboStep(27); again.comboStep(50); expect(names(again).filter(n => n.includes('/c_'))).toEqual(['hit-v2/c_25', 'hit-v2/c_50']);
  again.comboStep(1); again.comboStep(10); expect(names(again).filter(n => n.includes('/c_10'))).toHaveLength(1);
  expect(again.comboStep(NaN)).toBeNull();
  // 뮤트 중에도 상태는 갱신되어 다시 켰을 때 늦은 스팅어가 터지지 않는다.
  const quiet = fixture(); quiet.setSfxOn(false); quiet.comboStep(30); quiet.setSfxOn(true); quiet.comboStep(31);
  expect(names(quiet).filter(n => n.includes('/c_'))).toHaveLength(0);
});

test('궁극기 BGM 덕킹: 빠르게 눌러 유지하고 S 곡선으로 복귀하며 약한 덕이 깊은 덕을 지우지 않는다', () => {
  const audio = fixture(); const gain = audio.musicDuckGain.gain;
  audio.ultimateDuck();
  expect(gain.at(1)).toBe(1); expect(gain.at(1.06)).toBeCloseTo(.12, 6); expect(gain.at(1.5)).toBeCloseTo(.12, 6); expect(gain.at(1.96)).toBeCloseTo(.12, 2);
  // 복귀: 단조 증가, 중간은 선형보다 늦게/빠르게 S 모양, 끝에서 1.
  const end = 1 + .06 + .9 + 1.6; let previous = 0;
  for (let t = 1.96; t <= end; t += .05) { const v = gain.at(t); expect(v + 1e-6).toBeGreaterThanOrEqual(previous); previous = v; }
  expect(gain.at(end + .01)).toBeCloseTo(1, 6);
  const mid = gain.at(1.96 + .8); expect(mid).toBeGreaterThan(.12 + (1 - .12) * .4); expect(mid).toBeLessThan(.12 + (1 - .12) * .6);
  audio.ctx.currentTime = 1.3; audio.duck(.8, .4);
  expect(gain.at(1.4)).toBeCloseTo(.12, 6);
  // 실제 궁극기 release 경로가 덕킹을 건다.
  const real = fixture(); real.skillRelease({ ult: true, school: 'meteor', hero: 'mage' }); expect(real.musicDuckGain.gain.at(1.5)).toBeCloseTo(.12, 6);
  const normal = fixture(); normal.skillRelease({ school: 'meteor', hero: 'mage' }); expect(normal.musicDuckGain.gain.events).toHaveLength(0);
});
