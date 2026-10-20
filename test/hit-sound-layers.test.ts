import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { AudioSys } from '../src/engine/audio.js';
import {
  COMBAT_SOUND_FILES, COMBO_STINGERS, HERO_BY_WEAPON, HIT_PRIORITY, HIT_SOUND_FILES, HIT_TIERS, HIT_VARIANTS, KILL_SOUND, SFX_LIBRARY,
  comboSoundName, hitLayers, hitSoundName, hitTier, isPremiumHit, sfxUrl,
} from '../src/engine/combat-sound-library.js';
import { HEROES } from '../src/data/heroes.js';

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

const manifest = JSON.parse(readFileSync(new URL('../public/sfx/mirelo-v1/manifest.json', import.meta.url), 'utf8'));
const assetById = new Map<string, any>(manifest.assets.map((asset: any) => [asset.id, asset]));
const asset = (id: string) => { const found = assetById.get(id); expect(found).toBeDefined(); return found; };
/** 레이어가 실제로 낼 수 있는 변형 파일들(영웅 접촉 레이어는 그 영웅의 hit_0·hit_1). */
const layerAssets = (layer: any): any[] => layer.role === 'hero'
  ? [0, 1].map(i => asset(`hero/${layer.hero}/hit_${i}`))
  : Array.from({ length: HIT_VARIANTS[layer.id as keyof typeof HIT_VARIANTS] }, (_, i) => asset(`hit/${layer.id}_${i}`));

test('Mirelo 타격 라이브러리: 타격·처치·콤보 파일이 manifest 와 1:1이고 변형끼리 다른 소리이며 접촉 레이어가 2ms 안에 시작한다', () => {
  const hitAssets = manifest.assets.filter((a: any) => a.id.startsWith('hit/'));
  expect(hitAssets.map((a: any) => SFX_LIBRARY + a.id).sort()).toEqual([...HIT_SOUND_FILES].sort());
  for (const name of HIT_SOUND_FILES) expect(existsSync(new URL('../public' + sfxUrl(name), import.meta.url))).toBe(true);
  // 같은 id 의 변형은 복사본이 아니다(연속 반복 회피가 실제로 다른 소리를 낸다).
  for (const [id, count] of Object.entries(HIT_VARIANTS))
    expect(new Set(Array.from({ length: count }, (_, i) => asset(`hit/${id}_${i}`).sha256)).size).toBe(count);
  for (const a of hitAssets) {
    expect(a.provider).toBe('runware'); expect(a.model).toBe('mirelo:1@1'); expect(a.taskUUID).toBeTruthy();
    expect(a.decodedRms).toBeGreaterThan(.01); expect(a.onsetMs).toBeLessThanOrEqual(2);
    // 접촉 레이어는 짧아서 몹몰이에서 보이스 상한을 오래 붙잡지 않는다.
    if (a.id.startsWith('hit/t_')) expect(a.durationSec).toBeLessThanOrEqual(1);
  }
  for (const hero of Object.values(HEROES)) for (const i of [0, 1]) expect(asset(`hero/${hero.id}/hit_${i}`).onsetMs).toBeLessThanOrEqual(2);
});

test('모든 이벤트·등급은 트랜지언트와 바디 2레이어를 내고 등급별 파일이 구분된다', () => {
  const sizes = new Map<string, Set<string>>();
  for (const tier of HIT_TIERS) for (const kind of ['slash', 'blunt', 'magic']) for (const crit of [false, true]) {
    const layers = layersOf(kind, tier, { crit });
    expect(layers.some(layer => layer.role === 'transient')).toBe(true); expect(layers.filter(layer => layer.role === 'body')).toHaveLength(1);
    for (const layer of layers) {
      expect(Object.hasOwn(HIT_VARIANTS, layer.id)).toBe(true); expect(layer.priority).toBe(HIT_PRIORITY[tier as keyof typeof HIT_PRIORITY]);
      expect(layer.vol).toBeGreaterThan(0); expect(layer.vol).toBeLessThanOrEqual(.85);
    }
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

test('무기가 주어지면 그 무기 영웅의 전용 접촉 레이어가 하나 붙고 공용 접촉음은 절반 이하로 줄어든다', () => {
  for (const hero of Object.values(HEROES)) for (const tier of HIT_TIERS) for (const crit of [false, true]) {
    const plain = layersOf('slash', tier, { crit }), armed = layersOf('slash', tier, { weapon: hero.weapon, crit });
    const heroLayers = armed.filter(layer => layer.role === 'hero');
    expect(heroLayers).toHaveLength(1); expect(heroLayers[0].hero).toBe(hero.id);
    expect(heroLayers[0].priority).toBe(HIT_PRIORITY[tier as keyof typeof HIT_PRIORITY]);
    expect(heroLayers[0].vol).toBeGreaterThan(0); expect(heroLayers[0].vol).toBeLessThanOrEqual(.85);
    // 영웅 접촉음은 공용·등급·치명타 접촉음보다 커서 강타에서도 영웅마다 다른 소리로 들린다.
    for (const layer of armed) if (layer.role === 'transient') expect(heroLayers[0].vol).toBeGreaterThan(layer.vol);
    expect(armed[0].role).toBe('transient'); expect(armed[0].vol).toBeLessThanOrEqual(plain[0].vol * .5 + 1e-9);
    expect(armed.filter(layer => layer.role === 'body')).toHaveLength(1);
  }
  expect(Object.keys(HERO_BY_WEAPON).sort()).toEqual(Object.values(HEROES).map(hero => hero.weapon).sort());
  for (const weapon of ['', 'blade', '__proto__']) expect(layersOf('slash', 'basic', { weapon }).some(layer => layer.role === 'hero')).toBe(false);
});

test('레이어 피크 합(모든 레이어 피크가 한 순간에 겹치는 최악)은 영웅 접촉 레이어를 포함해 1.75 아래다', () => {
  // 산술 상한이다. 실제 렌더 피크는 tools/audio/measure-hit-mix.py·measure-hit-chain.mjs 로 잰다.
  const over: string[] = [];
  for (const weapon of ['', ...Object.keys(HERO_BY_WEAPON)]) for (const tier of HIT_TIERS) for (const kind of ['slash', 'blunt', 'magic']) for (const crit of [false, true]) {
    const bound = layersOf(kind, tier, { weapon, crit }).reduce((sum, layer) => sum + layer.vol * Math.max(...layerAssets(layer).map(a => a.decodedPeak)), 0);
    if (!(bound < 1.75)) over.push(`${weapon || '무기없음'}/${tier}/${kind}${crit ? '/crit' : ''}=${bound.toFixed(3)}`);
  }
  expect(over).toEqual([]);
});

test('등급 판정: 카운터 > 마무리(보스면 boss) > 강타/치명타 > 혼잡 시 light > basic, 프리미엄은 3음 대상', () => {
  expect(hitTier({ counter: true, finisher: true })).toBe('counter');
  expect(hitTier({ finisher: true })).toBe('finisher'); expect(hitTier({ finisher: true, boss: true })).toBe('boss');
  expect(hitTier({ heavy: true })).toBe('heavy'); expect(hitTier({ crit: true })).toBe('heavy');
  expect(hitTier({ crowd: true })).toBe('light'); expect(hitTier({ crowd: true, crit: true })).toBe('heavy'); expect(hitTier({})).toBe('basic');
  expect(HIT_TIERS.filter(isPremiumHit)).toEqual(['counter', 'finisher', 'boss']);
});

test('Mirelo 타격은 한 번에 트랜지언트+바디를 재생하고 오디오 전용 RNG 만 쓴다', () => {
  const rng = spyOn(Math, 'random').mockImplementation(() => { throw new Error('게임 난수 사용'); });
  const audio = fixture(); audio.hit('slash', {});
  const played = names(audio);
  expect(played).toHaveLength(2); expect(played[0]).toMatch(/^mirelo-v1\/hit\/t_slash_/); expect(played[1]).toMatch(/^mirelo-v1\/hit\/b_basic_/);
  const voices = [...audio._voices] as any[]; expect(voices.every(voice => voice.priority === HIT_PRIORITY.basic)).toBe(true);
  // 변형은 같은 id 가 연달아 반복되지 않는다.
  const bodies = new Set<string>(); let last = '';
  for (let i = 0; i < 12; i++) { audio.ctx.currentTime += 1; audio._voices.clear(); audio.hit('blunt', {}); const body = names(audio).find(n => n.includes('/b_'))!; expect(body).not.toBe(last); last = body; bodies.add(body); }
  expect(bodies.size).toBe(2); expect(rng).not.toHaveBeenCalled();
});

test('타격은 무기를 받거나 직전 휘두름의 무기로 그 영웅의 전용 접촉음을 얹고, 접촉음 변형은 연달아 반복되지 않는다', () => {
  const rng = spyOn(Math, 'random').mockImplementation(() => { throw new Error('게임 난수 사용'); });
  for (const hero of Object.values(HEROES)) {
    const own = (n: string) => n.startsWith(`mirelo-v1/hero/${hero.id}/hit_`), anyHero = (n: string) => /^mirelo-v1\/hero\/[a-z]+\/hit_/.test(n);
    // 1) 호출부가 무기를 넘기는 경로(rpg-battle).
    const direct = fixture(); direct.hit('slash', { weapon: hero.weapon });
    expect(names(direct)).toHaveLength(3); expect(names(direct).filter(anyHero)).toHaveLength(1); expect(names(direct).filter(own)).toHaveLength(1);
    // 2) 무기를 넘기지 않는 경로(battle-base·스킬): 직전 휘두름(attackRelease)의 무기를 쓴다.
    const swung = fixture(); swung.attackRelease({ weapon: hero.weapon, ranged: 'ranged' in hero && hero.ranged });
    swung.ctx.currentTime += .1; swung.hit('slash', {});
    expect(names(swung).filter(anyHero)).toHaveLength(1); expect(names(swung).filter(own)).toHaveLength(1);
    // 같은 영웅 접촉음 변형은 연달아 반복되지 않는다.
    let last = '';
    for (let i = 0; i < 6; i++) {
      direct.ctx.currentTime += 1; direct._voices.clear(); direct.hit('blunt', { weapon: hero.weapon });
      const contact = names(direct).find(own)!; expect(contact).toBeDefined(); expect(contact).not.toBe(last); last = contact;
    }
  }
  // 휘두름 전·모르는 무기의 타격에는 영웅 접촉음이 없다.
  const bare = fixture(); bare.hit('slash', { weapon: 'blade' });
  expect(names(bare).some(n => n.includes('/hero/'))).toBe(false);
  expect(rng).not.toHaveBeenCalled();
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
  const audio = fixture(); const ui = audio.play(comboSoundName(COMBO_STINGERS[0]!), { priority: 4, min: 0 }), counter = audio.play(hitSoundName('t_counter', 0), { priority: 4, min: 0 });
  expect(ui).toBeDefined(); expect(counter).toBeDefined();
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
  const [c10, c25, c50] = COMBO_STINGERS.map(comboSoundName);
  expect(fired()).toEqual([c10, c25, c50]);
  for (const name of [c10, c25, c50]) expect(existsSync(new URL('../public' + sfxUrl(name!), import.meta.url))).toBe(true);
  const again = fixture(); again.comboStep(26); expect(names(again).filter(n => n.includes('/c_'))).toEqual([c25]);
  again.comboStep(27); again.comboStep(50); expect(names(again).filter(n => n.includes('/c_'))).toEqual([c25, c50]);
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
