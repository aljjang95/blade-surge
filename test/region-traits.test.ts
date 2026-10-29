import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { REGION_SPECIES_VERBS, REGION_TRAITS, RegionTraits, SKELETAL, isSkeletalSpecies, regionSpeciesVerb, regionTheme } from '../src/game/region-traits.js';

const noop: any = new Proxy(() => {}, { get: () => noop, apply: () => undefined });
const fxProxy: any = new Proxy({}, { get: () => () => {} });

function makeHero(x = 0, z = 0) {
  return {
    alive: true, state: 'idle', maxHp: 200, slow: 0, slowT: 0, stun: 0, pos: new THREE.Vector3(x, 0, z), hurts: [] as any[],
    hurt(dmg: number, opts: any) { this.hurts.push({ dmg, opts }); },
  } as any;
}
function makeGame(theme: string | null, hero: any) {
  const afters: { t: number; fn: () => void }[] = [];
  const game: any = {
    active: true, fx: fxProxy, ui: { toast() {} }, player: hero, enemies: [] as any[], afters, spawned: [] as any[], settled: [] as any[],
    stage: theme ? { st: 2, chapter: { id: 1, theme } } : null,
    after(t: number, fn: () => void) { afters.push({ t, fn }); },
    spawnEnemy(type: string, _a: any, room: any, pos: any) {
      const r: any = { type, room, pos, maxHp: 100, hp: 100, pack: null, xpReward: 5, reactT: 1 };
      game.spawned.push(r); return r;
    },
    settleRoomSpawn(room: any) { game.settled.push(room); },
  };
  return game;
}
function makeEnemy(game: any, x = 0, z = 0, extra: any = {}) {
  const e: any = {
    alive: true, spawning: false, isBoss: false, isElite: false, summoned: false, packId: 0, pack: null, runtimeSpeciesId: 'skeleton',
    def: { name: '적', model: 'Skeleton_Vanguard' }, pos: new THREE.Vector3(x, 0, z), maxHp: 100, hp: 100, atk: 10, packId0: 0,
    game, player: game.player, homeRoom: { spawnsDue: 0, cleared: false },
    distTo(o: any) { return Math.hypot(this.pos.x - o.pos.x, this.pos.z - o.pos.z); },
    ...extra,
  };
  game.enemies.push(e);
  return e;
}
function setup(theme: string) {
  const hero = makeHero(), game = makeGame(theme, hero), rt = new RegionTraits(game);
  return { hero, game, rt };
}

test('regionTheme: 캠페인 stage 는 chapter.theme, chapter 7 은 crypt, 원정·파티·st 없음은 null', () => {
  expect(regionTheme({ st: 3, chapter: { id: 2, theme: 'forge' } })).toBe('forge');
  expect(regionTheme({ st: 3, chapter: { id: 7, theme: 'garden' } })).toBe('crypt');
  expect(regionTheme({ st: 3, chapter: { id: 2, theme: 'forge' }, expedition: true })).toBeNull();
  expect(regionTheme({ st: 3, chapter: { id: 2, theme: 'forge' }, party: true })).toBeNull();
  expect(regionTheme({ chapter: { id: 2, theme: 'forge' } })).toBeNull();
  expect(regionTheme({ st: 1.5, chapter: { id: 2, theme: 'forge' } })).toBeNull();
  expect(regionTheme({ st: 1, chapter: { id: 2, theme: 'forge' } })).toBeNull();   // 1관문은 기본 적 학습(지역 특성은 2관문부터)
  expect(regionTheme(null)).toBeNull();
  expect(regionTheme(undefined)).toBeNull();
});

test('RegionTraits: 테마 없으면 비활성, 있으면 REGION_TRAITS 연결', () => {
  const hero = makeHero();
  const off = new RegionTraits(makeGame(null, hero));
  expect(off.active).toBe(false);
  off.update(1); off.announce(); off.onDeath(makeEnemy(makeGame(null, hero)), null);
  const on = new RegionTraits(makeGame('frost', hero));
  expect(on.active).toBe(true);
  expect(on.trait).toBe(REGION_TRAITS.frost);
  expect(new RegionTraits(makeGame('crypt', hero)).trait!.id).toBe('echo');
});

test('echo: 해골 평타 처치는 spawnsDue +1, 1.6초 뒤 40% 체력 부활체(echoed)와 settleRoomSpawn', () => {
  const { game, rt } = setup('garden');
  const e = makeEnemy(game, 3, 4);
  rt.onDeath(e, null);
  expect(e.homeRoom.spawnsDue).toBe(1);
  expect(game.afters.length).toBe(1);
  expect(game.afters[0].t).toBe(1.6);
  expect(game.spawned.length).toBe(0);
  game.afters[0].fn();
  expect(game.spawned.length).toBe(1);
  const r = game.spawned[0];
  expect(r.type).toBe('skeleton');
  expect(r.echoed).toBe(true);
  expect(r.hp).toBeCloseTo(r.maxHp * 0.4);
  expect(r.pos.x).toBe(3); expect(r.pos.z).toBe(4);
  expect(game.settled).toEqual([e.homeRoom]);
});

test('echo: flair 객체(마무리·치명·스킬)·echoed·summoned·정예·비해골·보스면 부활 없음', () => {
  const { game, rt } = setup('garden');
  const cases: [any, any][] = [
    [makeEnemy(game), { finisher: true }],
    [makeEnemy(game, 0, 0, { echoed: true }), null],
    [makeEnemy(game, 0, 0, { summoned: true }), null],
    [makeEnemy(game, 0, 0, { isElite: true }), null],
    [makeEnemy(game, 0, 0, { def: { name: '오크', model: 'Orc_Grunt' } }), null],
    [makeEnemy(game, 0, 0, { isBoss: true }), null],
  ];
  for (const [e, flair] of cases) rt.onDeath(e, flair);
  expect(game.afters.length).toBe(0);
  for (const [e] of cases) expect(e.homeRoom.spawnsDue).toBe(0);
});

test('echo: 방이 이미 클리어됐으면 부활 없이 settleRoomSpawn 만 호출', () => {
  const { game, rt } = setup('garden');
  const e = makeEnemy(game);
  rt.onDeath(e, null);
  e.homeRoom.cleared = true;
  game.afters[0].fn();
  expect(game.spawned.length).toBe(0);
  expect(game.settled.length).toBe(1);
});

test('slag: packId%4===0 일 때만 쇳물, 0.9초 예고 뒤에만 1.3 안 영웅을 0.5초마다 maxHp*0.01 데운다', () => {
  const { hero, game, rt } = setup('forge');
  rt.onDeath(makeEnemy(game, 0, 0, { packId: 1 }), null);
  rt.update(0.1);
  expect(hero.hurts.length).toBe(0);
  rt.onDeath(makeEnemy(game, 0, 0, { packId: 4 }), null);
  rt.update(0.5); rt.update(0.3);
  expect(hero.hurts.length).toBe(0);   // 예고 중
  rt.update(0.2);
  expect(hero.hurts.length).toBe(1);
  expect(hero.hurts[0].dmg).toBeCloseTo(200 * 0.01);
  rt.update(0.3);
  expect(hero.hurts.length).toBe(1);
  rt.update(0.3);
  expect(hero.hurts.length).toBe(2);
});

test('slag: 영웅이 1.5 밖이면 피해 없음, 소환체는 웅덩이 없음', () => {
  const { hero, game, rt } = setup('forge');
  hero.pos.set(2, 0, 0);
  rt.onDeath(makeEnemy(game, 0, 0, { packId: 0 }), null);
  rt.update(1.0); rt.update(0.1);
  expect(hero.hurts.length).toBe(0);
  hero.pos.set(0, 0, 0);
  rt.onDeath(makeEnemy(game, 9, 9, { packId: 0, summoned: true }), null);
  hero.pos.set(9, 0, 9);
  rt.update(0.1);
  expect(hero.hurts.length).toBe(0);
});

test('chill: 세 번 맞으면 stun>=0.7 이고 chill 0, 한 번이면 slow 0.5·slowT>=1.6', () => {
  const { hero, game, rt } = setup('frost');
  const e = makeEnemy(game);
  rt.onPlayerHit(e, hero);
  expect(rt.chill).toBe(1);
  expect(hero.slow).toBe(0.5);
  expect(hero.slowT).toBeGreaterThanOrEqual(1.6);
  expect(hero.stun).toBe(0);
  rt.onPlayerHit(e, hero); rt.onPlayerHit(e, hero);
  expect(hero.stun).toBeGreaterThanOrEqual(0.7);
  expect(rt.chill).toBe(0);
});

test('chill: 영웅 dodge 상태면 update 에서 chill 0, 보스·다른 대상 공격은 무시, 4초 지나면 소멸', () => {
  const { hero, game, rt } = setup('frost');
  const e = makeEnemy(game);
  rt.onPlayerHit(e, hero); rt.onPlayerHit(e, hero);
  expect(rt.chill).toBe(2);
  hero.state = 'dodge';
  rt.update(0.016);
  expect(rt.chill).toBe(0);
  hero.state = 'idle';
  rt.onPlayerHit(makeEnemy(game, 0, 0, { isBoss: true }), hero);
  rt.onPlayerHit(e, makeHero());
  expect(rt.chill).toBe(0);
  rt.onPlayerHit(e, hero);
  rt.update(4.1);
  expect(rt.chill).toBe(0);
});

test('undertow: packId 짝수 사망은 1.2초간 반경 5 안 적(보스 제외)에게 gather', () => {
  const { game, rt } = setup('tide');
  const calls: any[] = [];
  const gather = (tag: string) => (x: number, z: number) => calls.push({ tag, x, z });
  const near = makeEnemy(game, 3, 0, { gather: gather('near') });
  const far = makeEnemy(game, 9, 0, { gather: gather('far') });
  const boss = makeEnemy(game, 1, 0, { isBoss: true, gather: gather('boss') });
  const dead = makeEnemy(game, 0, 0, { packId: 2 });
  rt.onDeath(dead, null);
  rt.update(0.5);
  expect(calls.map((c) => c.tag)).toEqual(['near']);
  expect(calls[0].x).toBe(0); expect(calls[0].z).toBe(0);
  rt.update(0.5); rt.update(0.5);
  const n = calls.length;
  rt.update(0.5);
  expect(calls.length).toBe(n);
  expect(calls.some((c) => c.tag === 'far' || c.tag === 'boss')).toBe(false);
  void near; void far; void boss;
});

test('undertow: packId 홀수·소환체 사망은 소용돌이 없음', () => {
  const { game, rt } = setup('tide');
  let n = 0;
  makeEnemy(game, 1, 0, { gather: () => n++ });
  rt.onDeath(makeEnemy(game, 0, 0, { packId: 1 }), null);
  rt.onDeath(makeEnemy(game, 0, 0, { packId: 2, summoned: true }), null);
  rt.update(0.5);
  expect(n).toBe(0);
});

test('decree: line 첫 멤버가 기수, 같은 분대 filter 는 0.65배(생존·8 안), 사망 후·8 밖·기수 자신은 원래 피해', () => {
  const { game, rt } = setup('crown');
  const pack: any = {};
  const herald = makeEnemy(game, 0, 0, { pack });
  const m2 = makeEnemy(game, 3, 0, { pack });
  const far = makeEnemy(game, 9, 0, { pack });
  rt.attach(herald, 'line');
  expect(herald.herald).toBe(true);
  expect(pack.herald).toBe(herald);
  rt.attach(m2, 'line');
  expect(m2.herald).toBeFalsy();
  expect(pack.herald).toBe(herald);
  expect(rt.filter(m2, 100)).toBeCloseTo(65);
  expect(rt.filter(far, 100)).toBe(100);
  expect(rt.filter(herald, 100)).toBe(100);
  herald.alive = false;
  expect(rt.filter(m2, 100)).toBe(100);
});

test('decree: line 이 아닌 역할·분대 없는 적·정예는 기수가 못 되고, 다른 분대는 영향 없음', () => {
  const { game, rt } = setup('crown');
  const pack: any = {};
  const flank = makeEnemy(game, 0, 0, { pack });
  rt.attach(flank, 'flank');
  expect(pack.herald).toBeUndefined();
  rt.attach(makeEnemy(game, 0, 0, { pack: null }), 'line');
  rt.attach(makeEnemy(game, 0, 0, { pack, isElite: true }), 'line');
  expect(pack.herald).toBeUndefined();
  const other = makeEnemy(game, 1, 0, { pack: {} });
  expect(rt.filter(other, 50)).toBe(50);
});

test('종 동사: tide squidle 은 tether, crown ninja 는 blink, 다른 종은 없음', () => {
  expect(REGION_SPECIES_VERBS.tide.squidle.key).toBe('tether');
  expect(REGION_SPECIES_VERBS.crown.ninja.key).toBe('blink');
  const tide = setup('tide');
  const sq = makeEnemy(tide.game, 0, 0, { runtimeSpeciesId: 'squidle' });
  tide.rt.attach(sq, 'line');
  expect(sq.affixes.has.tether).toBe(true);
  expect(sq.regionVerb).toBe('촉수 낚아채기');
  const other = makeEnemy(tide.game, 0, 0, { runtimeSpeciesId: 'skeleton' });
  tide.rt.attach(other, 'line');
  expect(other.affixes).toBeUndefined();
  const crown = setup('crown');
  const ninja = makeEnemy(crown.game, 0, 0, { runtimeSpeciesId: 'ninja' });
  crown.rt.attach(ninja, 'flank');
  expect(ninja.affixes.has.blink).toBe(true);
  // 다른 지역에서는 붙지 않는다.
  const forge = setup('forge');
  const ninja2 = makeEnemy(forge.game, 0, 0, { runtimeSpeciesId: 'ninja' });
  forge.rt.attach(ninja2, 'flank');
  expect(ninja2.affixes).toBeUndefined();
});

test('종 동사: 정예·보스·summoned 에는 붙지 않는다', () => {
  const { game, rt } = setup('tide');
  for (const extra of [{ isElite: true }, { isBoss: true }, { summoned: true }]) {
    const e = makeEnemy(game, 0, 0, { runtimeSpeciesId: 'squidle', ...extra });
    rt.attach(e, 'line');
    expect(e.affixes).toBeUndefined();
  }
});

test('망각의 잔향은 1장 일반 방 주력(전용 Tripo 몸 갈래)에도 걸린다', async () => {
  const { ENEMIES, CHAPTER_SPECIES } = await import('../src/data/stages.js');
  for (const id of Object.values(CHAPTER_SPECIES[1]) as string[]) expect(SKELETAL.test((ENEMIES as any)[id].model), id).toBe(true);
});

test('종 동사: 4장 전용 몸(부유 촉수 → 따개비 수부)도 촉수 낚아채기를 이어받는다', async () => {
  const { CHAPTER_SPECIES } = await import('../src/data/stages.js');
  const id = CHAPTER_SPECIES[4].squidle;
  expect(id).toBe('ch4_drowned');
  expect(regionSpeciesVerb('tide', id)?.key).toBe('tether');
  expect(regionSpeciesVerb('tide', 'ch4_lurer')).toBeNull();
  expect(regionSpeciesVerb('forge', id)).toBeNull();
  expect(regionSpeciesVerb(null, id)).toBeNull();
  const tide = setup('tide');
  const sq = makeEnemy(tide.game, 0, 0, { runtimeSpeciesId: id });
  tide.rt.attach(sq, 'line');
  expect(sq.affixes.has.tether).toBe(true);
  expect(sq.regionVerb).toBe('촉수 낚아채기');
  const summoned = makeEnemy(tide.game, 0, 0, { runtimeSpeciesId: id, summoned: true });
  tide.rt.attach(summoned, 'line');
  expect(summoned.affixes).toBeUndefined();
});

test('종 동사: 5장 전용 몸(그림자 닌자 → 새벽 가면 닌자)도 그림자 걸음을 이어받는다', async () => {
  const { CHAPTER_SPECIES } = await import('../src/data/stages.js');
  const id = CHAPTER_SPECIES[5].ninja;
  expect(id).toBe('ch5_dawnninja');
  expect(regionSpeciesVerb('crown', id)?.key).toBe('blink');
  // 같은 닌자 몸이지만 원본이 임프·심연 폭탄인 갈래는 동사가 없다.
  expect(regionSpeciesVerb('crown', CHAPTER_SPECIES[5].imp)).toBeNull();
  expect(regionSpeciesVerb('crown', CHAPTER_SPECIES[5].bomb_abyss)).toBeNull();
  const crown = setup('crown');
  const nj = makeEnemy(crown.game, 0, 0, { runtimeSpeciesId: id });
  crown.rt.attach(nj, 'flank');
  expect(nj.affixes.has.blink).toBe(true);
  expect(nj.regionVerb).toBe('그림자 걸음');
});

test('다른 장 Tripo 몸 갈래는 원본 종이 해골일 때만 망각의 잔향으로 되살아난다', async () => {
  const { CHAPTER_SPECIES, ENEMIES, speciesSourceId } = await import('../src/data/stages.js');
  for (const ch of [3, 5, 6, 7]) for (const id of Object.values((CHAPTER_SPECIES as any)[ch] || {}) as string[]) {
    const src = speciesSourceId(id);
    expect(isSkeletalSpecies((ENEMIES as any)[id].model, id), id).toBe(SKELETAL.test((ENEMIES as any)[src].model));
  }
  expect(isSkeletalSpecies('Ch6_Witness', 'homecoming_midboss')).toBe(false);
});

test('망각의 잔향: 7장 해골 시민·굽쇠 주술사는 원본 종이 해골일 때만 되살아난다', async () => {
  const { ENEMIES, CHAPTER_SPECIES } = await import('../src/data/stages.js');
  const E = ENEMIES as Record<string, any>;
  const sw = CHAPTER_SPECIES[7] as Record<string, string>;
  for (const src of ['skel_minion', 'skel_rogue', 'skel_shield', 'bone_orc', 'skel_mage', 'skel_priest', 'ghost_skull']) expect(isSkeletalSpecies(E[sw[src]].model, sw[src]), src).toBe(true);
  // 원령·폭탄 슬라임 자리는 몸이 해골이어도 교체 전처럼 되살아나지 않는다(난이도 체감 유지).
  for (const src of ['ghost', 'bomb_slime']) expect(isSkeletalSpecies(E[sw[src]].model, sw[src]), src).toBe(false);
});
