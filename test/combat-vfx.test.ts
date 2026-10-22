import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { CombatVfx, VfxRng, enemyPalette } from '../src/engine/combat-vfx.js';
import { FEEL, shardCount, slowAccentFor, slowAccentLevel, waveParams, killSlowmo } from '../src/game/feel.js';
import { Battle, feelOnKill } from '../src/game/battle-base.js';

const S = FEEL.vfx.shards;
const enemy = (over: any = {}) => ({
  pos: new THREE.Vector3(2, 0, -1), kb: new THREE.Vector3(6, 0, 0), def: { scale: 1 },
  mats: [{ color: new THREE.Color(0x3a8a4a) }], isBoss: false, isElite: false, ...over,
});
const make = () => new CombatVfx(new THREE.Scene());

test('파편 풀: 고정 용량으로 가장 오래된 칸부터 재활용하고 배열·메시를 새로 만들지 않는다', () => {
  const v = make(), ring = v.shards, arrays = Object.values(ring.a);
  expect(ring.capacity).toBe(S.capacity); expect(ring.mesh.isInstancedMesh).toBe(true);
  expect(ring.mesh.visible).toBe(false);
  // 한 프레임 상한(frameBudget)이 있어 프레임을 나눠 256칸 이상을 낸다.
  let total = 0;
  for (let f = 0; f < 12; f++) { for (let k = 0; k < 4; k++) total += v.shatter(enemy()); v.update(1 / 600); }
  expect(total).toBeGreaterThan(S.capacity);
  expect(ring.live(v.clock)).toBe(S.capacity);        // 가득 찬 뒤에도 용량을 넘지 않는다
  expect(ring.mesh.count).toBe(S.capacity); expect(ring.mesh.visible).toBe(true);
  expect(ring.cursor).toBe(total % S.capacity);       // 링 버퍼가 한 바퀴 돌아 앞쪽 칸을 덮었다
  expect(Object.values(ring.a)).toEqual(arrays);       // 같은 Float32Array(할당·재생성 없음)
  for (const a of arrays) expect(a.length % S.capacity).toBe(0);
  // 오래된 칸이 덮였는지: 가장 먼저 쓴 칸의 spawn 시계가 나중 값으로 바뀌었다
  expect(ring.a.aLife[0]).toBeGreaterThan(0);
  // 수명(~0.5초)이 지나면 모두 죽고 메시는 숨는다
  v.update(1); expect(ring.live(v.clock)).toBe(0); expect(ring.mesh.visible).toBe(false); expect(ring.mesh.count).toBe(0);
});

test('파편: 프레임 상한을 넘기지 않고 다음 프레임에 상한이 돌아온다', () => {
  const v = make();
  let spawned = 0;
  for (let i = 0; i < 40; i++) spawned += v.shatter(enemy({ isBoss: true }));
  expect(spawned).toBe(S.frameBudget);
  expect(v.shatter(enemy())).toBe(0);
  v.update(.016);
  expect(v.shatter(enemy())).toBe(shardCount({}));
});

test('파편 인자: 넉백 방향·팔레트·수명·중력 하강, 등급별 개수', () => {
  const v = make(), a = v.shards.a;
  const n = v.shatter(enemy());
  expect(n).toBe(S.count.minion);
  let mean = 0, vx = 0;
  for (let i = 0; i < n; i++) {
    vx += a.aVel[i * 3]; mean += a.aVel[i * 3 + 1];
    expect(a.aLife[i * 2 + 1]).toBeGreaterThanOrEqual(S.life * (1 - S.lifeJitter) - 1e-6);
    expect(a.aLife[i * 2 + 1]).toBeLessThanOrEqual(S.life * (1 + S.lifeJitter) + 1e-6);
    expect(Math.hypot(a.aSpin[i * 4], a.aSpin[i * 4 + 1], a.aSpin[i * 4 + 2])).toBeCloseTo(1, 4);   // 회전축은 단위 벡터
    expect(a.aOrigin[i * 3 + 1]).toBeGreaterThan(.3);                                                 // 몸 높이에서 터진다
  }
  expect(vx / n).toBeGreaterThan(2);       // +x 넉백 쪽으로 평균 속도
  expect(mean / n).toBeGreaterThan(S.up);  // 위로 솟구친다
  // 팔레트: 초록 몸 → 파편 색은 초록이 지배(g > r, g > b) — 어두운 쪽도 같은 색조
  let green = 0; for (let i = 0; i < n; i++) if (a.aColor[i * 3 + 1] > a.aColor[i * 3] && a.aColor[i * 3 + 1] > a.aColor[i * 3 + 2]) green++;
  expect(green).toBe(n);
  // 등급별 개수
  expect(shardCount({ elite: true })).toBe(S.count.elite); expect(shardCount({ boss: true })).toBe(S.count.boss);
  expect(S.count.boss).toBeGreaterThan(S.count.elite); expect(S.count.elite).toBeGreaterThan(S.count.minion);
  // 팔레트 도우미는 모델 재질이 없으면 보스/정예 기본색을 쓴다
  const base = new THREE.Color(), accent = new THREE.Color();
  enemyPalette({ isBoss: true }, base, accent); expect(base.r).toBeGreaterThan(base.b);
  expect(accent.getHSL({ h: 0, s: 0, l: 0 }).l).toBeGreaterThan(base.getHSL({ h: 0, s: 0, l: 0 }).l);
});

test('파편: 시계는 update 로 들어온 sim dt 뿐이다(정지 중 멈춤) + 전투 난수·Date 를 쓰지 않고 시드가 같으면 같은 모양', () => {
  const a = make(), b = make(), c = new CombatVfx(new THREE.Scene(), { seed: 7 });   // three 의 UUID 난수는 생성에만 쓰이므로 먼저 만든다
  const realRandom = Math.random, realNow = Date.now;
  Math.random = () => { throw new Error('combat RNG used'); }; Date.now = () => { throw new Error('Date used'); };
  try {
    a.shatter(enemy()); b.shatter(enemy());
    for (const k of Object.keys(a.shards.a)) expect(a.shards.a[k]).toEqual(b.shards.a[k]);
    a.update(0); a.update(NaN); a.update(-1); expect(a.clock).toBe(0);   // 히트스톱(dt 0)·잘못된 값은 시간을 흘리지 않는다
    a.update(.016); expect(a.clock).toBeCloseTo(.016, 6); expect(a.uTime.value).toBeCloseTo(.016, 6);
    b.update(.016);
    a.wave(new THREE.Vector3(), 1); b.wave(new THREE.Vector3(), 1);
    for (const k of Object.keys(a.waves.a)) expect(a.waves.a[k]).toEqual(b.waves.a[k]);
    // 다른 시드는 다른 모양, clear 는 처음 값으로 되돌린다
    c.shatter(enemy());
    expect(c.shards.a.aVel).not.toEqual(b.shards.a.aVel);
    a.clear(); expect(a.clock).toBe(0); expect(a.shards.live(0)).toBe(0); expect(a.waves.live(0)).toBe(0);
    a.shatter(enemy()); expect(a.shards.a.aVel.slice(0, 27)).toEqual(b.shards.a.aVel.slice(0, 27));
  } finally { Math.random = realRandom; Date.now = realNow; }
  const r = new VfxRng(1), q = new VfxRng(1);
  expect([r.next(), r.next(), r.next()]).toEqual([q.next(), q.next(), q.next()]);
});

test('충격파: 단계가 높을수록 크고 길고 줄기가 많으며, 반지름은 multiSteps ring 한 곳에서 온다', () => {
  const ps = FEEL.kill.multiSteps.map((_, i) => waveParams(i)!);
  for (let i = 0; i < ps.length; i++) {
    expect(ps[i].radius).toBe(FEEL.kill.multiSteps[i].ring);
    if (i) for (const k of ['radius', 'life', 'gain', 'rays', 'rayGain', 'edge'] as const) expect(ps[i][k]).toBeGreaterThan(ps[i - 1][k]);
  }
  expect(waveParams(4)).toBeNull(); expect(waveParams(-1)).toBeNull();
  const v = make(), A = v.waves.a;
  expect(v.wave(new THREE.Vector3(3, 0, 4), 2)).toBe(true);
  expect(A.aCenter[0]).toBe(3); expect(A.aCenter[1]).toBeCloseTo(FEEL.vfx.wave.height, 6); expect(A.aCenter[2]).toBe(4);
  expect(A.aParams[0]).toBeCloseTo(FEEL.kill.multiSteps[2].ring, 5);
  expect(A.aShape[2]).toBe(FEEL.vfx.wave.steps[2].rays);
  expect(A.aLife[1]).toBeCloseTo(FEEL.vfx.wave.steps[2].life, 6);
  expect(v.wave(new THREE.Vector3(), 9)).toBe(false);
  // 파면 풀도 고정 용량 링 버퍼
  for (let i = 0; i < 20; i++) v.wave(new THREE.Vector3(), 0);
  expect(v.waves.live(v.clock)).toBe(FEEL.vfx.wave.capacity);
  v.update(2); expect(v.waves.mesh.visible).toBe(false);
});

test('낮은 화질·동작 줄이기: 파편 절반, 줄기 없음, 파면은 짧고 어둡게, 꺼 두면 아무것도 내지 않는다', () => {
  const full = shardCount({}), lite = shardCount({}, { lite: true }), calm = shardCount({}, { reduced: true });
  expect(lite).toBe(Math.round(full * S.liteScale)); expect(calm).toBe(Math.round(full * S.reducedScale));
  expect(shardCount({}, { lite: true, reduced: true })).toBeLessThan(lite);
  const normal = waveParams(3)!, reduced = waveParams(3, { reduced: true })!, low = waveParams(3, { lite: true })!;
  expect(normal.rays).toBeGreaterThan(0);
  expect(reduced.rays).toBe(0); expect(reduced.rayGain).toBe(0); expect(low.rays).toBe(0);
  expect(reduced.life).toBeLessThan(normal.life); expect(reduced.gain).toBeLessThan(normal.gain); expect(low.gain).toBeLessThan(normal.gain);
  const v = make(); v.setQuality('low'); expect(v.lite).toBe(true);
  expect(v.shatter(enemy())).toBe(lite);
  v.update(.016);
  expect(v.shatter(enemy(), { reduced: true })).toBe(Math.round(full * S.liteScale * S.reducedScale));
  v.enabled = false; v.update(.016);
  expect(v.shatter(enemy())).toBe(0); expect(v.wave(new THREE.Vector3(), 0)).toBe(false);
});

test('마지막 적 속도선: 중앙 램프·끝 복귀 곡선, accent 슬로우만, 동작 줄이기는 켜지지 않는다', () => {
  const { sec, ease } = FEEL.slowmo.roomClear, V = FEEL.vfx.speedLines;
  expect(slowAccentLevel(sec, sec, ease)).toBe(0);                          // 시작 직후 0
  expect(slowAccentLevel(sec - V.rampIn, sec, ease)).toBeCloseTo(V.peak, 5);  // 램프 끝에서 최대
  expect(slowAccentLevel(ease / 2, sec, ease)).toBeLessThan(V.peak);          // 끝 ease 구간에서 내려간다
  expect(slowAccentLevel(0, sec, ease)).toBe(0);
  for (let t = sec; t >= 0; t -= .01) { const l = slowAccentLevel(t, sec, ease); expect(l).toBeGreaterThanOrEqual(0); expect(l).toBeLessThanOrEqual(V.peak + 1e-9); }
  expect(V.peak).toBeLessThanOrEqual(1);
  expect(slowAccentLevel(NaN, sec, ease)).toBe(0); expect(slowAccentLevel(.2, 0, 0)).toBe(0);
  // 방의 마지막 적 슬로우만 accent, 정예 슬로우는 아니다
  const room = killSlowmo({ roomEmptied: true, roomKills: 6, now: 30 }), elite = killSlowmo({ elite: true, now: 30 });
  expect(slowAccentFor(room)).toEqual({ sec, ease });
  expect(slowAccentFor(elite)).toBeNull(); expect(slowAccentFor(null)).toBeNull();
  expect(slowAccentFor(room, true)).toBeNull();   // 동작 줄이기
});

test('전투 연결: driveSlowAccent 가 남은 슬로우로 렌더러 세기를 내리고 끝나면 스스로 닫는다', () => {
  const levels: number[] = [];
  const b: any = { slowAccent: { sec: .5, ease: .28 }, timeCtl: { slowT: .5 }, renderer: { setSpeedAccent: (l: number) => levels.push(l) } };
  (Battle.prototype as any).driveSlowAccent.call(b);
  expect(levels.at(-1)).toBe(0); expect(b.slowAccent).not.toBeNull();
  b.timeCtl.slowT = .3; (Battle.prototype as any).driveSlowAccent.call(b); expect(levels.at(-1)!).toBeGreaterThan(.5);
  b.timeCtl.slowT = .05; (Battle.prototype as any).driveSlowAccent.call(b); expect(levels.at(-1)!).toBeLessThan(levels[1]);
  b.timeCtl.slowT = 0; (Battle.prototype as any).driveSlowAccent.call(b); expect(levels.at(-1)).toBe(0); expect(b.slowAccent).toBeNull();
});

test('feelOnKill: 단계 진입마다 충격파 풀에 단계·동작 줄이기 여부를 넘기고, 풀이 없으면 기존 링으로 대신한다', () => {
  const calls: any[] = [];
  const make2 = (reduced: boolean, withWave = true) => {
    const fx: any = { shockTex: () => calls.push('ring'), damage: () => {}, dmgLayer: { children: [] } };
    if (withWave) fx.multiKillWave = (_p: unknown, step: number, o: any) => calls.push([step, o.reduced]);
    return { player: { alive: true, auto: true, pos: new THREE.Vector3(), stats: {}, addUlt() {}, addMp() {} }, elapsed: 0, killStreak: 0, app: { reducedMotion: { matches: reduced } }, renderer: { flashScreen() {} }, fx } as any;
  };
  const e = { pos: new THREE.Vector3(), def: { scale: 1 } };
  const run = (b: any, n: number) => { for (let i = 1; i <= n; i++) { b.elapsed = i * .05; feelOnKill(b, e); } };
  run(make2(false), 5); expect(calls).toEqual([[0, false], [1, false]]);   // 3마리·5마리 진입에서만
  calls.length = 0; run(make2(true), 3); expect(calls).toEqual([[0, true]]);
  calls.length = 0; run(make2(false, false), 3); expect(calls).toEqual(['ring']);
});

test('shardCount: 런타임 Enemy 필드(isBoss/isElite)로 정예·보스 개수를 고른다', () => {
  const real = enemy({ isElite: true }), boss = enemy({ isBoss: true });
  expect(shardCount(real)).toBe(S.count.elite); expect(shardCount(boss)).toBe(S.count.boss);
  expect(shardCount({ isBoss: true, isElite: true })).toBe(S.count.boss);
  expect(shardCount(enemy())).toBe(S.count.minion);
  const v = make(); expect(v.shatter(boss)).toBe(Math.min(S.count.boss, S.frameBudget));
  v.update(.016); expect(v.shatter(real)).toBe(S.count.elite);
});

test('준비 구간 setWarm: 두 메시가 보이는 순회에 잡히고 끝나면 원래 숨김·count 0 으로 돌아온다', () => {
  const scene = new THREE.Scene(), v = new CombatVfx(scene);
  const seen = () => { const out: THREE.Object3D[] = []; scene.traverseVisible(o => { if ((o as any).isInstancedMesh) out.push(o); }); return out; };
  expect(seen()).toEqual([]);
  v.setWarm(true);
  expect(seen()).toEqual([v.shards.mesh, v.waves.mesh]); expect(v.shards.mesh.count).toBeGreaterThanOrEqual(1);
  v.setWarm(false);
  expect(seen()).toEqual([]); expect(v.shards.mesh.count).toBe(0);
  v.shatter(enemy()); v.setWarm(true); v.setWarm(false);   // 살아 있는 파편이 있으면 계속 보인다
  expect(v.shards.mesh.visible).toBe(true); expect(v.shards.mesh.count).toBe(v.shards.high);
});

test('setWarm 겹침: 새 준비가 이전 준비를 대체해도 마지막 준비가 끝날 때까지 보이고, update 도 숨기지 않는다', () => {
  const scene = new THREE.Scene(), v = new CombatVfx(scene);
  v.setWarm(true); v.setWarm(true);   // 두 번째 준비 시작
  v.setWarm(false);                  // 첫 준비가 먼저 끝남
  v.update(1 / 60);
  expect(v.waves.mesh.visible).toBe(true); expect(v.shards.mesh.visible).toBe(true);
  v.setWarm(false);
  expect(v.waves.mesh.visible).toBe(false); expect(v.waves.mesh.count).toBe(0);
  v.setWarm(false); expect(v.warm).toBe(0);   // 넘쳐 내려가지 않는다
});

test('충격파 재질은 양면을 한 번에 그린다(forceSinglePass)', () => {
  const v = new CombatVfx(new THREE.Scene());
  expect((v.waves.mesh.material as THREE.Material).forceSinglePass).toBe(true);
});

test('FX.update: 전투 일시정지 동안에는 전투 VFX 시계가 흐르지 않고 재개하면 이어진다', async () => {
  const { FX } = await import('../src/engine/fx.js');
  const pool = { update() {} };
  const fx: any = Object.create(FX.prototype);
  Object.assign(fx, { sparks: pool, glow: pool, smoke: pool, items: [], impactLights: { update() {} }, trails: [], vfx: make() });
  fx.update(.1, false); expect(fx.vfx.clock).toBeCloseTo(.1, 6);
  fx.update(.1, true); fx.update(.1, true); expect(fx.vfx.clock).toBeCloseTo(.1, 6);
  fx.update(.1); expect(fx.vfx.clock).toBeCloseTo(.2, 6);
  // 메인 루프가 일시정지 상태를 그대로 넘기는지(Battle.update 가 시간을 멈추는 상태와 같은 값)
  const main = (await import('node:fs')).readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  expect(main).toContain('this.fx.update(dt, !!this.battle.paused)');
  expect(main).toContain('this.renderer.update(dt, realDt, !!this.battle.paused)');
});

test('렌더를 건너뛴 sim 프레임에 쓴 칸도 다음 업로드 구간에 남는다(업로드 뒤에만 구간을 비운다)', () => {
  const v = make(), ring = v.shards, name = Object.keys(ring.defs)[0], size = ring.defs[name];
  const attribute: any = ring.geometry.attributes[name];
  ring.claim(10); ring.flush();
  ring.cursor = 40; ring.claim(10); ring.flush();
  expect(attribute.updateRanges.length).toBe(1);
  expect(attribute.updateRanges[0].start).toBe(0);
  expect(attribute.updateRanges[0].count).toBe(41 * size);
  attribute.onUploadCallback();
  ring.cursor = 7; ring.claim(10); ring.flush();
  expect(attribute.updateRanges[0].start).toBe(7 * size);
  expect(attribute.updateRanges[0].count).toBe(size);
  v.dispose?.();
});
