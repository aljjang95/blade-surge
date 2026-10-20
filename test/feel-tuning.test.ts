import { expect, test } from 'bun:test';
import { FEEL, HitCrowd, KillChain, comboQueueOpen, dodgeCancelOpen, flashFor, hitWeight, killSlowmo, skillCancelOpen, weightedHitstop } from '../src/game/feel.js';
import { HITSTOP_CAP, ImpactClock } from '../src/game/combat-motion.js';
import { contactProfile } from '../src/game/combat-contact.js';

test('타격 무게: 큰 피해·군중·정예·결정타가 무게를 올리고 상한을 넘지 않는다', () => {
  expect(hitWeight()).toBe(0);
  expect(hitWeight({ dealt: 10, maxHp: 1000 })).toBeCloseTo(.02, 5);
  expect(hitWeight({ dealt: 600, maxHp: 1000 })).toBeCloseTo(FEEL.hitstop.shareCap, 5);   // 비율 상한
  expect(hitWeight({ dealt: 600, maxHp: 1000, killed: true })).toBeCloseTo(FEEL.hitstop.kill, 5);   // 결정타는 피해 비율 대신 고정 무게
  expect(hitWeight({ crowd: 4 })).toBeCloseTo(3 * FEEL.hitstop.crowdStep, 5);
  expect(hitWeight({ crowd: 99 })).toBeCloseTo(FEEL.hitstop.crowdCap, 5);
  expect(hitWeight({ dealt: 1e9, maxHp: 1, crowd: 99, elite: true })).toBeCloseTo(FEEL.hitstop.shareCap + FEEL.hitstop.crowdCap + FEEL.hitstop.elite, 5);
  expect(hitWeight({ dealt: 1e9, maxHp: 1, crowd: 99, elite: true })).toBeLessThanOrEqual(FEEL.hitstop.weightCap);
  expect(hitWeight({ dealt: NaN, maxHp: NaN, crowd: NaN })).toBe(0);
});

test('가중 히트스탑: 무게 0 은 기본값 그대로, 무거울수록 길지만 상한과 ImpactClock 상한 아래', () => {
  const base = FEEL.hitstop.base;
  expect(weightedHitstop(base.light, 0)).toBe(base.light);
  expect(weightedHitstop(base.light, .5)).toBeCloseTo(base.light * 1.5, 6);
  expect(weightedHitstop(base.light, 1)).toBeGreaterThan(weightedHitstop(base.light, .2));
  expect(weightedHitstop(base.finisher, FEEL.hitstop.weightCap)).toBe(FEEL.hitstop.max);
  expect(FEEL.hitstop.max).toBeLessThan(HITSTOP_CAP);
  expect(weightedHitstop(0, 1.5)).toBe(0);   // 동작 줄이기(기본 0)는 무게가 있어도 멈추지 않는다
  expect(weightedHitstop(-1, 1)).toBe(0);
});

test('타격 등급 기본 정지는 FEEL 표와 같고 동작 줄이기는 0', () => {
  const b = FEEL.hitstop.base;
  expect(contactProfile({}, false, false, false)!.stop).toBe(b.light);
  expect(contactProfile({ basic: true }, false, false, false)!.stop).toBe(b.basic);
  expect(contactProfile({ basic: true }, true, false, false)!.stop).toBe(b.crit);
  expect(contactProfile({ finisher: true }, false, false, false)!.stop).toBe(b.finisher);
  expect(contactProfile({ counter: true }, false, false, false)!.stop).toBe(b.counter);
  expect(contactProfile({ kb: 7 }, false, false, false)!.stop).toBe(b.heavy);
  expect(contactProfile({}, false, true, false)!.stop).toBe(b.boss);
  expect(contactProfile({ finisher: true }, true, false, true)!.stop).toBe(0);
});

test('섬광: 무게 0 은 기존 0.12초·배율 1, 무거워도 상한', () => {
  expect(flashFor(0)).toEqual({ sec: FEEL.flash.baseSec, gain: 1 });
  const heavy = flashFor(99);
  expect(heavy.sec).toBe(FEEL.flash.maxSec); expect(heavy.gain).toBe(FEEL.flash.gainMax);
  expect(flashFor(.5).sec).toBeGreaterThan(FEEL.flash.baseSec);
});

test('군중 동시 타격 수: 창 안에서 누적하고 창이 지나면 다시 센다', () => {
  const c = new HitCrowd(), w = FEEL.hitstop.crowdWindow;
  expect(c.hit(10)).toBe(1); expect(c.hit(10)).toBe(2); expect(c.hit(10 + w * .9)).toBe(3);
  expect(c.hit(10 + w * 2)).toBe(1);   // 새 창
  expect(c.hit(5)).toBe(1);            // 시간이 뒤로 가면(새 판) 초기화
  c.reset(); expect(c.hit(0)).toBe(1);
});

test('군중 동시 타격 수: 같은 적을 창 안에서 여러 번 때리면 하나로 센다', () => {
  const c = new HitCrowd(), a = {}, b = {};
  expect(c.hit(1, a)).toBe(1); expect(c.hit(1, a)).toBe(1); expect(c.hit(1.01, a)).toBe(1);
  expect(c.hit(1.02, b)).toBe(2); expect(c.hit(1.03, b)).toBe(2);
  expect(c.hit(1 + FEEL.hitstop.crowdWindow * 3, b)).toBe(1);   // 새 창은 다시 센다
});

test('ImpactClock 슬로우 ease: 끝에서 1 로 선형 복귀하고 총 적분이 해석값과 같다', () => {
  const dt = 1 / 120, sum = (clock: ImpactClock, n: number) => { let sim = 0; for (let i = 0; i < n; i++) sim += clock.step(dt); return sim; };
  // ease 없음(기존): 0.5초 동안 0.4 배율 → sim 0.2초
  const plain = new ImpactClock(); plain.slowmo(.4, .5);
  expect(sum(plain, 60)).toBeCloseTo(.2, 4);
  // ease .2: 0.3초는 0.4, 마지막 0.2초는 0.4→1 선형 → 0.12 + 0.2*(0.7) = 0.26
  const eased = new ImpactClock(); eased.slowmo(.4, .5, .2);
  expect(sum(eased, 60)).toBeCloseTo(.26, 4);
  expect(eased.slow).toBe(1); expect(eased.slowEase).toBe(0);
  // 복귀 구간의 배율은 단조 증가
  const c = new ImpactClock(); c.slowmo(.3, .4, .2);
  let prev = 0; const scales: number[] = [];
  for (let i = 0; i < 48; i++) { c.step(dt); scales.push(c.scale); }
  for (let i = 36; i < 48; i++) { expect(scales[i]).toBeGreaterThanOrEqual(prev - 1e-9); prev = scales[i]; }
  expect(scales[0]).toBeCloseTo(.3, 4);
  expect(scales[47]).toBeGreaterThan(.9);
});

test('ImpactClock: 프레임 크기와 무관하게 슬로우 적분이 같다(30·60·120fps)', () => {
  const total = (dt: number) => { const c = new ImpactClock(); c.slowmo(.35, .5, .25); let sim = 0; for (let i = 0; i < Math.round(.5 / dt); i++) sim += c.step(dt); return sim; };
  const a = total(1 / 30), b = total(1 / 60), d = total(1 / 120);
  expect(Math.abs(a - d)).toBeLessThan(.01); expect(Math.abs(b - d)).toBeLessThan(.005);
});

test('히트스탑과 슬로우가 겹쳐도 정지 상한을 지키고 슬로우는 정지 뒤에 이어진다', () => {
  const c = new ImpactClock(); c.slowmo(.5, .3, .1); c.hitstop(.15);
  let sim = 0, frozen = 0;
  for (let i = 0; i < 60; i++) { const s = c.step(1 / 120); sim += s; if (s === 0) frozen++; }
  expect(frozen).toBeLessThanOrEqual(Math.ceil(HITSTOP_CAP * 120) + 1);
  expect(sim).toBeGreaterThan(0);
});

test('묶음 처치: 창 안의 처치가 3·5·8·12 마리째에 단계 진입하고 창이 지나면 다시 센다', () => {
  const k = new KillChain(), steps: number[] = [];
  for (let i = 1; i <= 13; i++) { const e = k.kill(i * .1); expect(e.multi).toBe(i); if (e.step >= 0) steps.push(i * 1000 + e.step); }
  expect(steps).toEqual([3000 + 0, 5000 + 1, 8000 + 2, 12000 + 3].map((v, j) => [3, 5, 8, 12][j] * 1000 + j));
  // 같은 단계에서 더 죽여도 새 단계가 아니다
  expect(k.kill(1.4).step).toBe(-1);
  // 창(.7초) 뒤에는 1부터
  const e = k.kill(1.4 + FEEL.kill.multiWindow + .01);
  expect(e.multi).toBe(1); expect(e.step).toBe(-1);
});

test('묶음 처치: 느슨한 간격(창 밖)이면 단계에 못 닿는다', () => {
  const k = new KillChain(); let hit = false;
  for (let i = 0; i < 20; i++) if (k.kill(i * (FEEL.kill.multiWindow + .05)).step >= 0) hit = true;
  expect(hit).toBe(false);
});

test('방 정리·정예 슬로우: 조건·쿨다운·동작 줄이기·보스 제외', () => {
  const S = FEEL.slowmo;
  expect(killSlowmo({ roomEmptied: true, roomKills: S.minRoomKills, now: 10 })).toBe(S.roomClear);
  expect(killSlowmo({ roomEmptied: true, roomKills: S.minRoomKills - 1, now: 10 })).toBeNull();   // 소규모 방
  expect(killSlowmo({ elite: true, now: 10 })).toBe(S.eliteKill);
  expect(killSlowmo({ elite: true, roomEmptied: true, roomKills: 9, now: 10 })).toBe(S.roomClear);   // 방 정리가 우선
  expect(killSlowmo({ elite: true, now: 10, lastAt: 10 - S.cooldown + .1 })).toBeNull();
  expect(killSlowmo({ elite: true, now: 10, lastAt: 10 - S.cooldown - .1 })).toBe(S.eliteKill);
  expect(killSlowmo({ elite: true, now: 10, reduced: true })).toBeNull();
  expect(killSlowmo({ boss: true, elite: true, roomEmptied: true, roomKills: 9, now: 10 })).toBeNull();
  expect(killSlowmo({ elite: true, now: 1, lastAt: 50 })).toBe(S.eliteKill);   // 새 판에서 시계가 되감겨도 막히지 않는다
});

test('회피 취소 창: 선딜 [0.16, hitAt-0.04) 와 타격 뒤 [hitAt+0.12, min(0.92, hitAt+0.26))', () => {
  const hitAt = .4, I = FEEL.input;
  expect(dodgeCancelOpen(I.cancelEarly - .001, hitAt, false)).toBe(false);
  expect(dodgeCancelOpen(I.cancelEarly, hitAt, false)).toBe(true);
  expect(dodgeCancelOpen(hitAt - I.cancelBeforeHit - .001, hitAt, false)).toBe(true);
  expect(dodgeCancelOpen(hitAt - I.cancelBeforeHit, hitAt, false)).toBe(false);   // 타격 직전은 잠김
  expect(dodgeCancelOpen(hitAt, hitAt, true)).toBe(false);
  expect(dodgeCancelOpen(hitAt + I.cancelRecovery, hitAt, true)).toBe(true);
  expect(dodgeCancelOpen(hitAt + I.cancelRecoveryEnd - .001, hitAt, true)).toBe(true);
  expect(dodgeCancelOpen(hitAt + I.cancelRecoveryEnd, hitAt, true)).toBe(false);
  // 늦은 타격은 하드 상한 0.92 에서 닫힌다
  expect(dodgeCancelOpen(.91, .7, true)).toBe(true);
  expect(dodgeCancelOpen(.92, .7, true)).toBe(false);
});

test('콤보 예약 창과 스킬 취소 창', () => {
  const I = FEEL.input;
  expect(comboQueueOpen(.0, .5, false)).toBe(false);
  expect(comboQueueOpen(.37, .5, false)).toBe(false);   // max(.28, hitAt-.12=.38)
  expect(comboQueueOpen(.38, .5, false)).toBe(true);
  expect(comboQueueOpen(.29, .3, false)).toBe(true);    // 이른 타격은 .28 부터
  expect(comboQueueOpen(.01, .5, true)).toBe(true);   // 타격 뒤에는 언제나 열림
  expect(skillCancelOpen(.6, .5, false)).toBe(false);
  expect(skillCancelOpen(.5 + I.skillCancelAfterHit - .001, .5, true)).toBe(false);
  expect(skillCancelOpen(.5 + I.skillCancelAfterHit, .5, true)).toBe(true);
  expect(skillCancelOpen(I.skillCancelEnd, .5, true)).toBe(false);
});

test('입력 버퍼 시간과 회피 무적(0.26초)은 구르기 안쪽: 버퍼는 무적보다 짧다', async () => {
  const { DODGE_INVULN_SEC } = await import('../src/game/progression.js');
  expect(FEEL.input.attackBuffer).toBeGreaterThan(0); expect(FEEL.input.dodgeBuffer).toBeGreaterThan(0);
  expect(FEEL.input.dodgeBuffer).toBeLessThan(DODGE_INVULN_SEC);
  expect(DODGE_INVULN_SEC).toBeGreaterThan(.2); expect(DODGE_INVULN_SEC).toBeLessThan(.4);
});

test('실제 damageEnemy 경로: 큰 한 방·결정타가 작은 타격보다 오래 멈추고 같은 창의 군중 타격은 무게를 더한다', async () => {
  const THREE = await import('three');
  const { Battle } = await import('../src/game/rpg-battle.js');
  const make = () => {
    const stops: number[] = [], flashes: any[] = [];
    const player = { stats: { crit: 0, critDmg: 2, ultGain: 1 }, auto: true, addUlt() {}, def: {}, receiveStrikeRecoil() {} };
    const battle: any = Object.assign(Object.create(Battle.prototype), {
      active: true, paused: false, player, combo: 0, maxCombo: 0, dmgDealt: 0, elapsed: 5, app: { reducedMotion: { matches: false } }, ui: { setCombo() {} },
      fx: { dmgLayer: { children: [] }, damage() {}, flash() {}, directional() {}, contact() {} }, feedbackCount: 0,
      timeCtl: { hitstop: (s: number) => stops.push(s) },
    });
    const enemy = (hp: number, extra: any = {}) => {
      const e: any = { alive: true, spawning: false, pos: new THREE.Vector3(), def: { scale: 1 }, maxHp: 1000, flashT: 0, receiveImpact() {}, ...extra };
      e.flash = (color: number, sec: number, gain: number) => flashes.push({ sec, gain });
      e.hurt = (dmg: number) => { if (hp > 0) { e.alive = hp > dmg; } return dmg; };
      return e;
    };
    return { battle, stops, flashes, enemy };
  };
  const a = make();
  a.battle.damageEnemy(a.enemy(9999), 10, { basic: true });
  const small = a.stops[0];
  const b = make();
  b.battle.damageEnemy(b.enemy(9999), 300, { basic: true });
  expect(b.stops[0]).toBeGreaterThan(small);
  expect(b.flashes.length).toBe(1); expect(b.flashes[0].gain).toBeGreaterThan(1);
  // 같은 창에서 5명을 맞히면 마지막 타격의 정지가 처음보다 길다(예산 밖 타격도 센다)
  const c = make();
  for (let i = 0; i < 5; i++) c.battle.damageEnemy(c.enemy(9999), 10, { basic: true });
  expect(c.stops[4]).toBeGreaterThan(c.stops[0]);
  expect(Math.max(...c.stops)).toBeLessThanOrEqual(FEEL.hitstop.max);
  // 동작 줄이기: 정지도 섬광 증폭도 없다
  const d = make(); d.battle.app.reducedMotion.matches = true;
  d.battle.damageEnemy(d.enemy(9999), 300, { basic: true });
  expect(d.stops.length).toBe(0); expect(d.flashes.length).toBe(0);
});

test('feelOnKill: 묶음 3마리째에 보상·월드 위 문구, 동작 줄이기는 틴트만 끄고 보상은 유지, 느슨한 처치는 무반응', async () => {
  const THREE = await import('three');
  const { feelOnKill } = await import('../src/game/battle-base.js');
  const make = (reduced = false) => {
    const log = { ult: 0, mp: 0, text: [] as string[], flash: 0, rings: 0 };
    const player = { alive: true, auto: true, pos: new THREE.Vector3(), stats: { ultGain: 1 }, addUlt: (n: number) => { log.ult += n; }, addMp: (n: number) => { log.mp += n; } };
    const battle: any = Object.assign({}, {
      player, elapsed: 0, killStreak: 0, app: { reducedMotion: { matches: reduced } },
      renderer: { flashScreen: () => { log.flash++; } },
      fx: { shockTex: () => { log.rings++; }, damage: (_p: unknown, _v: number, o: any) => { log.text.push(o.text); }, dmgLayer: { children: [] } },
    });
    return { battle, log };
  };
  const enemy = () => ({ pos: new THREE.Vector3(), def: { scale: 1 } });
  const { battle, log } = make();
  for (let i = 1; i <= 3; i++) { battle.elapsed = i * .1; battle.killStreak = i; feelOnKill(battle, enemy()); }
  expect(log.text).toEqual(['3마리 격파']); expect(log.ult).toBe(FEEL.kill.multiSteps[0].ult); expect(log.flash).toBe(1); expect(log.rings).toBe(1);
  // 창 밖으로 느슨한 처치(누적 연속 처치가 이어져도)는 보상·문구 없음
  const m = make();
  for (let i = 1; i <= 10; i++) { m.battle.elapsed = i * 2; m.battle.killStreak = i; feelOnKill(m.battle, enemy()); }
  expect(m.log.text.length).toBe(0); expect(m.log.ult).toBe(0); expect(m.log.mp).toBe(0);
  // 동작 줄이기: 화면 틴트 없음
  const r = make(true);
  for (let i = 1; i <= 3; i++) { r.battle.elapsed = i * .1; r.battle.killStreak = i; feelOnKill(r.battle, enemy()); }
  expect(r.log.flash).toBe(0); expect(r.log.ult).toBe(FEEL.kill.multiSteps[0].ult);
  // 죽은 플레이어는 보상받지 않는다
  const d = make(); d.battle.player.alive = false;
  for (let i = 1; i <= 3; i++) { d.battle.elapsed = i * .1; d.battle.killStreak = i; feelOnKill(d.battle, enemy()); }
  expect(d.log.ult).toBe(0);
});

test('feelOnKill: 파티 원정은 살아 있는 파티원 모두에게 묶음 보상을 준다', async () => {
  const THREE = await import('three');
  const { feelOnKill } = await import('../src/game/battle-base.js');
  const member = (alive = true) => { const m = { alive, auto: true, stats: { ultGain: 1 }, ult: 0, mp: 0, addUlt(n: number) { m.ult += n; }, addMp(n: number) { m.mp += n; } }; return m; };
  const host = member(), guest = member(), fallen = member(false);
  const battle: any = { player: host, elapsed: 0, killStreak: 0, stage: { party: true }, app: { reducedMotion: { matches: true }, party: { livingPlayers: () => [host, guest, fallen].filter(m => m.alive) } } };
  const enemy = () => ({ pos: new THREE.Vector3(), def: { scale: 1 } });
  for (let i = 1; i <= 3; i++) { battle.elapsed = i * .1; feelOnKill(battle, enemy()); }
  const st = FEEL.kill.multiSteps[0];
  expect(host.ult).toBe(st.ult); expect(guest.ult).toBe(st.ult); expect(fallen.ult).toBe(0);
  expect(guest.mp).toBe(st.mp || 0);
  // 호스트가 쓰러져도 남은 파티원은 받는다
  const h2 = member(false), g2 = member();
  const b2: any = { player: h2, elapsed: 0, stage: { party: true }, app: { reducedMotion: { matches: true }, party: { livingPlayers: () => [g2] } } };
  for (let i = 1; i <= 3; i++) { b2.elapsed = i * .1; feelOnKill(b2, enemy()); }
  expect(g2.ult).toBe(st.ult); expect(h2.ult).toBe(0);
});
