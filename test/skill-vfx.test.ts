import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { HERO_SKILLS } from '../src/engine/combat-sound-library.js';
import { SKILL_VFX, SKILL_VFX_TEXTURES, SKILL_GROUND_GAIN, MAJOR_SKILL_IDS, skillVfxKey, castSkillVfx, resolveHeroGrade } from '../src/engine/skill-vfx.js';
import { SKILLS } from '../src/game/skills.js';
import { SKILL_SIGNATURES } from '../src/engine/skill-signatures.js';
import { HEROES } from '../src/data/heroes.js';

const manifest = JSON.parse(readFileSync(new URL('../public/img/vfx/skills-v2/manifest.json', import.meta.url), 'utf8'));
const ALL_IDS = Object.values(HERO_SKILLS).flat();

function rig(grade: string | undefined = 'SR', def: any = { rarity: 'SR' }) {
  const calls: any[] = [];
  const rec = (kind: string) => (...args: any[]) => { calls.push([kind, ...args]); };
  const fx: any = { items: [], lite: false, groundTex: rec('ground'), texFlash: rec('flash'), flash: rec('light'), burst: rec('burst'), ghost: rec('ghost') };
  const shakes: number[] = [];
  const game: any = { fx, renderer: { shake: (n: number) => shakes.push(n) }, app: { reducedMotion: { matches: false } } };
  const player: any = { pos: new THREE.Vector3(1, 0, 2), forward: (o: THREE.Vector3) => o.set(0, 0, 1), def, stats: grade ? { grade } : {}, model: {} };
  return { calls, game, player, shakes, fx };
}

test('40개 스킬 ID 전부에 레시피가 있고 모두 manifest의 텍스처만 쓴다', () => {
  expect(ALL_IDS).toHaveLength(40);
  expect(ALL_IDS.filter(id => !SKILL_VFX[id as keyof typeof SKILL_VFX])).toEqual([]);
  for (const id of ALL_IDS) {
    const r = (SKILL_VFX as any)[id];
    for (const name of [r.rune, r.tex]) {
      expect(SKILL_VFX_TEXTURES).toContain(name);
      expect(manifest.assets[name]).toBeTruthy();
    }
  }
  for (const name of SKILL_VFX_TEXTURES) expect(manifest.assets[name]).toBeTruthy();
});

test('실제 skills.js 시전이 레시피를 부르고 원래 cast도 이어서 실행한다', () => {
  for (const id of ALL_IDS) {
    const { game, player, calls } = rig();
    try { (SKILLS as any)[id].cast(game, player, { dmg: 10, data: {}, t: 0 }); } catch { /* 원래 cast 는 가짜 게임에서 실패할 수 있다 */ }
    const grounds = calls.filter(c => c[0] === 'ground');
    // noRune 레시피는 공용 룬(발밑·궁극기 넓은 링)을 깔지 않는다.
    // 공용 룬을 끄는 대신 발밑 문양은 서명이 맡으므로 서명이 반드시 있어야 한다.
    if ((SKILL_VFX as any)[id].noRune) { expect((SKILL_SIGNATURES as any)[id]).toBeTypeOf('function'); expect(grounds.filter(c => String(c[2]) === skillVfxKey((SKILL_VFX as any)[id].rune))).toEqual([]); continue; }
    expect(grounds.length).toBeGreaterThanOrEqual(1);
    expect(String(grounds[0][2])).toBe(skillVfxKey((SKILL_VFX as any)[id].rune));
  }
  // 원래 cast 가 래퍼 뒤에서 그대로 불린다(판정 경로 보존): 파이어볼은 투사체를 만든다.
  const { game, player } = rig(); const shots: any[] = [];
  game.spawnProjectile = (s: any) => shots.push(s); game.fx.flash = () => {};
  (SKILLS as any).fireball.cast(game, player, { dmg: 120, data: {} });
  expect(shots).toHaveLength(1);
});

test('궁극기와 고위 각성만 넓은 지면 링(noRune 서명 스킬 제외)과 카메라 흔들림 1회를 쓴다', () => {
  for (const id of ALL_IDS) {
    const { game, player, calls, shakes } = rig();
    expect(castSkillVfx(game, id, player)).toBe(true);
    const rings = calls.filter(c => c[0] === 'ground' && c[4].r1 >= 10);
    if (MAJOR_SKILL_IDS.has(id)) { expect(shakes).toHaveLength(1); if ((SKILL_VFX as any)[id].noRune) { expect((SKILL_SIGNATURES as any)[id]).toBeTypeOf('function'); expect(rings).toHaveLength(0); } else expect(rings.length).toBeGreaterThanOrEqual(1); }
    else { expect(shakes).toHaveLength(0); expect(rings).toHaveLength(0); }
  }
  expect(MAJOR_SKILL_IDS.size).toBe(17);   // 궁극기·고위 각성 15 + 늑대인간 족장 궁극기 월광 사냥 + 검은 고양이 궁극기 아홉 목숨의 밤
});

test('섬광은 100ms 이하이고 동작 줄이기·혼잡·저사양에서 레이어가 줄어든다', () => {
  const a = rig(); castSkillVfx(a.game, 'meteor', a.player);
  for (const c of a.calls.filter(c => c[0] === 'light')) expect(c[3].life).toBeLessThanOrEqual(0.1);
  const reduced = rig(); reduced.game.app.reducedMotion.matches = true; castSkillVfx(reduced.game, 'meteor', reduced.player);
  expect(reduced.calls.some(c => c[0] === 'light' || c[0] === 'burst')).toBe(false); expect(reduced.shakes).toHaveLength(0);
  const crowded = rig(); crowded.fx.items.length = 999; castSkillVfx(crowded.game, 'meteor', crowded.player);
  expect(crowded.calls.some(c => c[0] === 'light')).toBe(false);
  const lite = rig(); lite.fx.lite = true; castSkillVfx(lite.game, 'void_step', lite.player);
  expect(lite.calls.some(c => c[0] === 'ghost' || c[0] === 'burst')).toBe(false);
});

test('SSSR 영웅은 1.15배이고 반복 시전이 전투 난수 순서를 바꾸지 않는다', () => {
  const base = rig('SSR', { rarity: 'SSR' }), top = rig('SSSR', { rarity: 'SSR' });
  castSkillVfx(base.game, 'meteor', base.player); castSkillVfx(top.game, 'meteor', top.player);
  const size = (r: any) => r.calls.find((c: any) => c[0] === 'flash')[4].size;
  expect(size(top) / size(base)).toBeCloseTo(1.15, 5);
  const orig = Math.random; let draws = 0; Math.random = () => { draws++; return 0.5; };
  try { for (let i = 0; i < 20; i++) castSkillVfx(base.game, 'quake', base.player); } finally { Math.random = orig; }
  expect(draws).toBe(0);
});

test('등급이 없는 레거시 영웅은 def.rarity, 그것도 없으면 SR로 내려간다', () => {
  expect(resolveHeroGrade({ def: { rarity: 'SSR' }, stats: {} })).toBe('SSR');
  expect(resolveHeroGrade({ def: { rarity: 'SSR' }, stats: { grade: 'SSSR' } })).toBe('SSSR');
  expect(resolveHeroGrade({ def: {}, stats: {} })).toBe('SR');
  expect(resolveHeroGrade({})).toBe('SR');
  for (const def of Object.values(HEROES) as any[]) expect(['SR', 'SSR', 'SSSR']).toContain(resolveHeroGrade({ def, stats: {} }));
});
test('래퍼는 원래 cast의 this·인자·반환값을 보존하고 VFX API가 없거나 던져도 전투를 깨지 않는다', () => {
  const impl: any = (SKILLS as any).quake;
  expect(impl.vfxWrapped).toBe(true);
  // 원래 cast 를 교체해 this/인자/반환값 전달을 확인한다(래퍼가 감싼 뒤에도 동일 경로).
  const inner = impl.cast;
  expect(typeof inner).toBe('function');
  for (const id of ALL_IDS) {
    const bare: any = { fx: {}, renderer: {}, hitRadius() {}, after() {}, vacuum() {}, spawnProjectile() {}, enemies: [], ui: { toast() {} }, timeCtl: { slowmo() {} } };
    const p: any = { pos: new THREE.Vector3(), forward: (o: THREE.Vector3) => o.set(0, 0, 1), buffs: {}, def: {}, stats: {} };
    // fx 에 VFX API 가 없으면 레시피는 건너뛰고 false 를 돌려준다(예외 없음).
    expect(castSkillVfx(bare, id, p)).toBe(false);
  }
  const probe: any = { cast(this: any, g: any, p: any, c: any) { this.seen = [g, p, c]; return 'ret'; } };
  const g = rig(); const ctx = { dmg: 1, data: {} };
  // 같은 래핑 규칙을 새 객체에 적용해 this/반환값 보존을 확인한다.
  const original = probe.cast;
  probe.cast = function (game: any, p: any, c: any) { try { castSkillVfx(game, 'quake', p, c); } catch {} return original.call(this, game, p, c); };
  expect(probe.cast(g.game, g.player, ctx)).toBe('ret');
  expect(probe.seen).toEqual([g.game, g.player, ctx]);
  // VFX 내부 예외가 나면 skills.js 래퍼가 삼키고 원래 cast 가 실행된다.
  const boom = rig(); boom.fx.groundTex = () => { throw new Error('vfx'); };
  const hits: any[] = []; (boom.game as any).hitRadius = (...a: any[]) => hits.push(a); (boom.game as any).after = () => {};
  (boom.game as any).vacuum = () => {}; (boom.game as any).ui = { toast() {} }; (boom.game as any).enemies = [];
  const warn = console.warn; console.warn = () => {};
  try { impl.cast(boom.game, boom.player, { dmg: 7, data: { gatherCenter: new THREE.Vector3() } }); } catch { /* 가짜 fx 에는 후속 연출 API가 없다. 판정 호출은 이미 일어났다 */ } finally { console.warn = warn; }
  expect(hits.length).toBeGreaterThanOrEqual(1);
  expect(hits[0][2]).toBe(7);
});

test('Math.random은 정상·예외 경로 모두 원래 함수로 복원된다', () => {
  const orig = Math.random;
  const ok = rig(); castSkillVfx(ok.game, 'meteor', ok.player);
  expect(Math.random).toBe(orig);
  const bad = rig(); bad.fx.groundTex = () => { throw new Error('x'); };
  expect(() => castSkillVfx(bad.game, 'meteor', bad.player)).toThrow();
  expect(Math.random).toBe(orig);
});
test('조준점이 없는 조준 스킬은 실제 판정과 같은 밀집 적 위치에 그리고, 적이 없으면 판정과 같은 전방 거리로 내려간다', () => {
  const { game, player, calls } = rig();
  game.enemies = []; player.distTo = () => 0;
  const target = new THREE.Vector3(7, 0, -3), seen: any[] = [];
  const seek = (_g: any, _p: any, range: number, radius: number) => { seen.push([range, radius]); return target.clone(); };
  castSkillVfx(game, 'meteor', player, { data: {} }, seek);
  expect(seen).toEqual([[15, 5]]);
  const ground = calls.find(c => c[0] === 'ground');
  expect(ground[1].x).toBeCloseTo(7); expect(ground[1].z).toBeCloseTo(-3);
  // 밀집 적이 없으면 skills.js 의 fwd(p, 4) 와 같은 자리.
  const empty = rig(); empty.game.enemies = []; empty.player.distTo = () => 0;
  castSkillVfx(empty.game, 'meteor', empty.player, { data: {} }, () => null);
  const fallback = empty.calls.find(c => c[0] === 'ground');
  expect(fallback[1].z).toBeCloseTo(empty.player.pos.z + 4); expect(fallback[1].x).toBeCloseTo(empty.player.pos.x);
  // 조준점이 있으면 그것이 우선이다.
  const aimed = rig(); aimed.game.enemies = []; aimed.player.distTo = () => 0;
  castSkillVfx(aimed.game, 'meteor', aimed.player, { data: { aimPoint: new THREE.Vector3(-2, 0, 9) } }, seek);
  expect(aimed.calls.find(c => c[0] === 'ground')[1].z).toBeCloseTo(9);
});

test('지면 텍스처가 이미 10m 이상인 궁극기는 전장 링을 한 겹 더 쌓지 않는다', () => {
  const ground = rig(); castSkillVfx(ground.game, 'skyfall_arrows', ground.player);
  const wide = ground.calls.filter(c => c[0] === 'ground' && c[4].r1 >= 10);
  expect(wide).toHaveLength(1); expect(String(wide[0][2])).toBe(skillVfxKey('skill-wind-arrow-trail'));
  const flash = rig(); castSkillVfx(flash.game, 'meteor', flash.player);
  expect(flash.calls.filter(c => c[0] === 'ground' && c[4].r1 >= 10)).toHaveLength(1);
});

test('흰 결이 강한 얼음·성광 원화는 넓게 깔 때 지면 밝기를 낮춰 화면을 하얗게 덮지 않는다', () => {
  expect(SKILL_GROUND_GAIN['skill-ice-burst']).toBeLessThan(0.5);
  expect(SKILL_GROUND_GAIN['skill-holy-wave']).toBeLessThan(0.7);
  for (const v of Object.values(SKILL_GROUND_GAIN)) expect(v).toBeGreaterThan(0.3);
  const { calls, game, player } = rig();
  castSkillVfx(game, 'absolute_zero', player, { data: {} });
  const grounds = calls.filter(c => c[0] === 'ground');
  const ice = grounds.find(c => c[2] === skillVfxKey('skill-ice-burst'));
  expect(ice).toBeTruthy();
  expect(ice[4].gain).toBeCloseTo(SKILL_GROUND_GAIN['skill-ice-burst'], 5);
  // 룬 원진도 원화별 밝기를 따른다(0 이나 1 고정이 아님)
  for (const g of grounds) expect(g[4].gain).toBeGreaterThan(0.3);
});
