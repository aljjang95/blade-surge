import { describe, expect, test } from 'bun:test';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import { AMBIGUOUS, FRAME, OBJECTIVE_PHRASE, analyzeBossOrbit, analyzeStrikes, bossResultLine, checkManualSegment, checkObjectiveSamples, checkPause, checkResultFields, checkResultLine,
  checkScreens, checkStateMachine, compareRuns, compareTargetsOk, drawCallIncrease, percentile, stepStats, summarizeBoss, warnRuns, zoneStatus } from '../tools/comet-boss-checks.mjs';

// 정의는 대상 프로젝트의 공유 정의에서 읽는다(도구와 같은 방식). 판정 함수는 값을 박지 않는다.
const DEF: any = (ROUTE_OBJECTIVES as any).comet_standard.boss;
const WARN_FRAMES = Math.round(DEF.warning / FRAME);

const baseRow = (over: any = {}) => ({ n: 0, t: 0, hp: 1000, alive: true, spn: false, st: 'idle', sp: null, seq: 0, cseq: 0, os: 'armed', ok: null, wl: 0, wt: DEF.warning, sk: 0, ck: 0, ht: 0, asw: 0,
  hr: 4, hhp: 100, hmax: 100, inb: true, inv: false, au: true, ah: false, ps: 'move', ...over });
const insideZone = (kind: string, r: number) => kind === 'outer' ? r >= DEF.outerMin && r <= DEF.outerMax : r <= DEF.safe;
const domOf = (kind: string, left: number) => '푸른 궤도선 ' + (kind === 'center' ? '중심 유성 ' + left.toFixed(1) + '초 · ' + OBJECTIVE_PHRASE.center : '바깥 유성 ' + left.toFixed(1) + '초 · ' + OBJECTIVE_PHRASE.outer);

interface Session { rows: any[]; ro: any; text: string; strikeIdx: number[] }
/**
 * 컨트롤러 계약(3.1)대로 움직이는 보스 구간 관측을 만든다. 1/60초 스텝마다 행 하나.
 * 부착(armed) → first 초 뒤 첫 예고 → warning 동안 warn → 낙하(armed 로 복귀, strikes++, 구역 안이면 hits++) → every − warning 대기 → 반복 → 처치 → ended.
 * radius 가 없으면 안전한 위치(outer 4.0, center 6.6)에서 맞는다.
 */
function session(opts: { strikes?: number; radius?: (k: number, kind: string) => number; cancel?: number[] } = {}): Session {
  const strikes = opts.strikes ?? 4, rows: any[] = [], strikeIdx: number[] = [];
  // ordinal 은 컨트롤러 순번(취소된 예고는 순번을 되돌린다), warnNo 는 예고 시작 횟수(cancel 옵션이 가리킨다).
  let t = 10, n = 0, sk = 0, ck = 0, ht = 0, ordinal = 0, warnNo = 0, seq = 0;
  const push = (over: any) => { rows.push(baseRow({ n: n++, t, sk, ck, ht, seq, hp: 1000 - rows.length, ...over })); t += FRAME; };
  push({ os: 'idle', spn: true });
  push({ os: 'idle' });
  for (let k = 0; k < Math.round(DEF.first / FRAME); k++) push({ os: 'armed', st: 'chase' });
  let k = 0;
  while (k < strikes) {
    ordinal++;
    warnNo++;
    const kind = ordinal % DEF.centerEvery === 0 ? 'center' : 'outer';
    const cancelled = (opts.cancel ?? []).includes(warnNo);
    const frames = cancelled ? 20 : WARN_FRAMES;
    for (let i = 0; i < frames; i++) {
      const left = DEF.warning - i * FRAME;
      push({ os: 'warn', ok: kind, wl: left, st: 'chase', ...(i * FRAME >= .25 && i % 6 === 0 ? { dom: domOf(kind, Math.ceil(left * 10 - 1e-9) / 10) } : {}) });
    }
    if (cancelled) { ordinal--; push({ os: 'armed', inb: false }); for (let i = 0; i < Math.round((DEF.every - DEF.warning) / FRAME); i++) push({ os: 'armed', st: 'chase' }); continue; }
    k++;
    const r = opts.radius ? opts.radius(k, kind) : kind === 'center' ? SAFE.center : SAFE.outer;
    sk++; if (kind === 'center') ck++;
    if (insideZone(kind, r)) ht++;
    strikeIdx.push(rows.length);
    push({ os: 'armed', hr: r });
    for (let i = 0; i < Math.round((DEF.every - DEF.warning) / FRAME); i++) push({ os: 'armed', st: 'chase' });
  }
  push({ alive: false, os: 'armed', hp: 0 });
  for (let i = 0; i < 4; i++) push({ alive: false, os: 'ended', hp: 0 });
  const ro = { id: 'comet_orbit_rings', complete: true, progress: 4, target: 4, bossMeteors: sk, bossCenterMeteors: ck, bossMeteorHits: ht };
  return { rows, ro, text: '원정 결과 ' + bossResultLine(sk, ht) + ' 전투 시간', strikeIdx };
}
const SAFE = { outer: 4.0, center: 6.6 };
const run = (s: Session, extra: any = {}, minStrikes = 1) => analyzeBossOrbit({ trace: s.rows, result: s.ro, resultText: s.text, win: true, finalOrbit: { state: 'ended' }, ...extra }, DEF, { minStrikes });
const failing = (a: any) => Object.entries(a.acceptance).filter(([, ok]) => !ok).map(([name]) => name);
const clone = (s: Session): Session => structuredClone(s);

describe('구역 판정(zoneStatus)', () => {
  test('outer 는 outerMin~outerMax 안이 피격이고 안쪽 선·바깥쪽은 안전하다', () => {
    expect(zoneStatus('outer', DEF.outerMin + .5, DEF).inside).toBe(true);
    expect(zoneStatus('outer', DEF.outerMax - .5, DEF).inside).toBe(true);
    expect(zoneStatus('outer', 4, DEF).inside).toBe(false);
    expect(zoneStatus('outer', DEF.outerMax + 1, DEF).inside).toBe(false);
  });
  test('center 는 safe 이내가 피격이고 선 밖은 안전하다', () => {
    expect(zoneStatus('center', 0, DEF).inside).toBe(true);
    expect(zoneStatus('center', DEF.safe - .5, DEF).inside).toBe(true);
    expect(zoneStatus('center', DEF.escape, DEF).inside).toBe(false);
  });
  test('경계 ±0.05 이내는 모호이고 그 밖은 아니다', () => {
    for (const [kind, edge] of [['outer', DEF.outerMin], ['outer', DEF.outerMax], ['center', DEF.safe]] as const) {
      expect(zoneStatus(kind, edge + AMBIGUOUS - .001, DEF).ambiguous).toBe(true);
      expect(zoneStatus(kind, edge - AMBIGUOUS + .001, DEF).ambiguous).toBe(true);
      expect(zoneStatus(kind, edge + AMBIGUOUS + .02, DEF).ambiguous).toBe(false);
      expect(zoneStatus(kind, edge - AMBIGUOUS - .02, DEF).ambiguous).toBe(false);
    }
  });
  test('알 수 없는 kind 나 숫자가 아닌 반지름은 valid false', () => {
    expect(zoneStatus(null as any, 4, DEF).valid).toBe(false);
    expect(zoneStatus('outer', NaN, DEF).valid).toBe(false);
  });
});

describe('정상 보스전(analyzeBossOrbit)', () => {
  test('모든 항목이 합격하고 낙하 수·kind 구성이 맞다', () => {
    const s = session({ strikes: 4 }), a = run(s);
    expect(failing(a)).toEqual([]);
    expect(a.ok).toBe(true);
    expect(a.observed).toEqual({ strikes: 4, centerStrikes: 1, hits: 0 });
    expect(a.kinds).toEqual({ outer: 3, center: 1 });
    expect(a.warns.map((w: any) => w.kind)).toEqual(['outer', 'outer', 'center', 'outer']);
    expect(a.warns.every((w: any) => Math.abs(w.duration - DEF.warning) <= FRAME + 1e-9)).toBe(true);
    expect(a.ambiguous.length).toBe(0);
  });
  test('실제로 맞은 낙하(구역 안에서 hits 증가)도 합격하고 결과 피격 수와 줄이 따라간다', () => {
    const s = session({ strikes: 3, radius: (k, kind) => kind === 'center' ? 3 : k === 1 ? 7 : SAFE.outer });
    const a = run(s);
    expect(failing(a)).toEqual([]);
    expect(a.observed.hits).toBe(2);
    expect(s.ro.bossMeteorHits).toBe(2);
    expect(s.text).toContain('푸른 궤도선 유성 3회 · 피격 2회');
  });
  test('1/60초 한 칸 어긋난 예고 길이(84·85·83 스텝)는 허용한다', () => {
    for (const delta of [-1, 1]) {
      const s = session({ strikes: 2 });
      const i = s.strikeIdx[0];
      s.rows.splice(i - 1, delta < 0 ? 1 : 0, ...(delta > 0 ? [{ ...s.rows[i - 1] }] : []));
      s.rows.forEach((r, k) => { r.t = 10 + k * FRAME; });
      expect(run(s).acceptance.warnDuration).toBe(true);
    }
  });
  test('취소된 예고(영웅이 보스방 밖)는 낙하로 세지 않고 순번도 쓰지 않는다', () => {
    const s = session({ strikes: 3, cancel: [2] });
    const a = run(s);
    expect(a.cancelled).toBe(1);
    expect(failing(a)).toEqual([]);
    // 두 번째 예고가 취소되면 같은 순번(2, outer)이 다시 오고, 세 번째로 떨어지는 유성이 center 다.
    expect(a.warns.map((w: any) => w.kind)).toEqual(['outer', 'outer', 'outer', 'center']);
    expect(a.warns.map((w: any) => w.outcome)).toEqual(['strike', 'cancelled', 'strike', 'strike']);
  });
  test('취소된 예고가 순번을 써 버린 관측(취소 뒤 바로 center)은 kind 순서 실패다', () => {
    const s = session({ strikes: 3, cancel: [2] });
    // 옛 규칙처럼 취소 뒤 세 번째 예고를 center 로 바꾸면 순번이 어긋난다.
    const warnStarts = warnRuns(s.rows);
    for (let i = warnStarts[2].start; i <= warnStarts[2].last; i++) s.rows[i].ok = 'center';
    expect(run(s).acceptance.kindOrder).toBe(false);
  });
});

describe('피격 = 구역 판정(hitMatchesZone)', () => {
  const strikeRow = (s: Session, k: number) => s.rows[s.strikeIdx[k - 1]];
  test('구역 안인데 hits 가 늘지 않으면 실패한다', () => {
    const s = session({ strikes: 2, radius: () => 7 });
    // 생성기는 hits 를 늘렸으므로 되돌려 미피격으로 만든다.
    s.rows.forEach((r, i) => { if (i >= s.strikeIdx[0]) r.ht = 0; });
    s.ro.bossMeteorHits = 0; s.text = '푸른 궤도선 유성 2회 · 피격 0회';
    const a = run(s);
    expect(a.acceptance.hitMatchesZone).toBe(false);
    expect(a.strikes[0].verdict).toBe('fail');
    expect(a.strikes[0].expectedHit).toBe(true);
  });
  test('구역 밖인데 hits 가 늘면 실패한다', () => {
    const s = session({ strikes: 2 });
    s.rows.forEach((r, i) => { if (i >= s.strikeIdx[0]) r.ht = 1; });
    s.ro.bossMeteorHits = 1; s.text = '푸른 궤도선 유성 2회 · 피격 1회';
    const a = run(s);
    expect(a.acceptance.hitMatchesZone).toBe(false);
    expect(a.strikes[0]).toMatchObject({ zoneInside: false, hit: true, verdict: 'fail' });
  });
  test('center 낙하에서 선 안쪽(r ≤ safe)이면 맞아야 하고, 선 밖이면 맞으면 안 된다', () => {
    const inside = session({ strikes: 3, radius: (k, kind) => kind === 'center' ? DEF.safe - .5 : SAFE.outer });
    expect(failing(run(inside))).toEqual([]);
    expect(run(inside).strikes[2]).toMatchObject({ kind: 'center', zoneInside: true, hit: true, verdict: 'ok' });
    const outside = session({ strikes: 3 });
    const i = outside.strikeIdx[2];
    outside.rows.forEach((r, k) => { if (k >= i) r.ht = 1; });
    outside.ro.bossMeteorHits = 1; outside.text = '푸른 궤도선 유성 3회 · 피격 1회';
    expect(run(outside).acceptance.hitMatchesZone).toBe(false);
  });
  test('경계 ±0.05 안의 낙하는 맞든 안 맞든 모호로 표시하고 실패로 세지 않는다', () => {
    for (const hit of [true, false]) {
      const s = session({ strikes: 1, radius: () => DEF.outerMin + .02 });
      s.rows.forEach((r, i) => { if (i >= s.strikeIdx[0]) r.ht = hit ? 1 : 0; });
      s.ro.bossMeteorHits = hit ? 1 : 0; s.text = bossResultLine(1, hit ? 1 : 0);
      const a = run(s);
      expect(a.acceptance.hitMatchesZone).toBe(true);
      expect(a.ambiguous.length).toBe(1);
      expect(a.strikes[0].verdict).toBe('ambiguous');
    }
  });
  test('무적 시간이 남은 영웅이 구역 안에서 맞지 않은 것은 면제로 표시한다(실패 아님)', () => {
    const s = session({ strikes: 1, radius: () => 7 });
    s.rows.forEach((r, i) => { if (i >= s.strikeIdx[0]) r.ht = 0; });
    s.rows[s.strikeIdx[0] - 1].inv = .5;
    s.ro.bossMeteorHits = 0; s.text = bossResultLine(1, 0);
    const a = run(s);
    expect(a.acceptance.hitMatchesZone).toBe(true);
    expect(a.excused.length).toBe(1);
  });
  test('낙하 스텝에 새로 붙은 무적(낙하 행만 inv)이나 한 스텝 안에 끝나는 무적은 면제하지 않는다', () => {
    for (const set of [(s: Session) => { strikeRow(s, 1).inv = 4; }, (s: Session) => { s.rows[s.strikeIdx[0] - 1].inv = FRAME / 2; }]) {
      const s = session({ strikes: 1, radius: () => 7 });
      s.rows.forEach((r, i) => { if (i >= s.strikeIdx[0]) r.ht = 0; });
      set(s);
      s.ro.bossMeteorHits = 0; s.text = bossResultLine(1, 0);
      const a = run(s);
      expect(a.acceptance.hitMatchesZone).toBe(false);
      expect(a.excused.length).toBe(0);
    }
  });
  test('이미 쓰러진 영웅은 구역 안이어도 맞지 않는 것이 맞다', () => {
    const s = session({ strikes: 1, radius: () => 7 });
    s.rows.forEach((r, i) => { if (i >= s.strikeIdx[0]) r.ht = 0; });
    s.rows[s.strikeIdx[0] - 1].hhp = 0;
    s.ro.bossMeteorHits = 0; s.text = bossResultLine(1, 0);
    expect(run(s).acceptance.hitMatchesZone).toBe(true);
  });
  test('한 낙하에서 hits 가 둘 늘거나 예고 없이 strikes 가 늘면 실패한다', () => {
    const twice = session({ strikes: 1, radius: () => 7 });
    twice.rows.forEach((r, i) => { if (i >= twice.strikeIdx[0]) r.ht = 2; });
    expect(run(twice).acceptance.hitMatchesZone).toBe(false);
    const sudden = session({ strikes: 2 });
    const i = sudden.strikeIdx[0];
    sudden.rows[i - 1].os = 'armed'; sudden.rows[i - 1].ok = null; sudden.rows[i - 1].wl = 0;
    expect(run(sudden).acceptance.hitMatchesZone).toBe(false);
  });
  test('궤도 반지름이 없는 행(hr null)은 구역 판정을 할 수 없어 실패한다', () => {
    const s = session({ strikes: 1 });
    s.rows[s.strikeIdx[0]].hr = null;
    expect(run(s).acceptance.hitMatchesZone).toBe(false);
  });
});

describe('예고 길이·kind 순서', () => {
  test('예고가 짧거나(80스텝) 길면(90스텝) 실패한다', () => {
    for (const frames of [80, 90]) {
      const s = session({ strikes: 2 });
      const i = s.strikeIdx[0], start = i - WARN_FRAMES;
      if (frames < WARN_FRAMES) s.rows.splice(start, WARN_FRAMES - frames);
      else s.rows.splice(i, 0, ...Array.from({ length: frames - WARN_FRAMES }, () => ({ ...s.rows[i - 1] })));
      s.rows.forEach((r, k) => { r.t = 10 + k * FRAME; });
      const a = run(s);
      expect(a.acceptance.warnDuration).toBe(false);
    }
  });
  test('예고 시작 warnLeft 가 warning 이 아니면 실패한다', () => {
    const s = session({ strikes: 1 });
    s.rows[s.strikeIdx[0] - WARN_FRAMES].wl = DEF.warning / 2;
    expect(run(s).acceptance.warnDuration).toBe(false);
  });
  test('세 번째 예고가 outer 이거나 두 번째가 center 면 kind 순서 실패', () => {
    const s = session({ strikes: 3 });
    const third = s.strikeIdx[2] - WARN_FRAMES;
    for (let i = third; i < s.strikeIdx[2]; i++) s.rows[i].ok = 'outer';
    expect(run(s).acceptance.kindOrder).toBe(false);
    const t = session({ strikes: 3 });
    for (let i = t.strikeIdx[1] - WARN_FRAMES; i < t.strikeIdx[1]; i++) t.rows[i].ok = 'center';
    expect(run(t).acceptance.kindOrder).toBe(false);
  });
  test('center 낙하에서 centerStrikes 가 늘지 않거나 outer 에서 늘면 centerStats 실패', () => {
    const s = session({ strikes: 3 });
    s.rows.forEach((r, i) => { if (i >= s.strikeIdx[2]) r.ck = 0; });
    expect(run(s).acceptance.centerStats).toBe(false);
    const t = session({ strikes: 3 });
    t.rows.forEach((r, i) => { if (i >= t.strikeIdx[0]) r.ck += 1; });
    expect(run(t).acceptance.centerStats).toBe(false);
  });
});

describe('예고 중 새 공격 없음(noAttackDuringWarn)', () => {
  test('예고 중 attackSequence 가 늘면 실패한다', () => {
    const s = session({ strikes: 2 });
    for (let i = s.strikeIdx[0] - 30; i < s.rows.length; i++) s.rows[i].seq = 1;
    const a = run(s);
    expect(a.acceptance.noAttackDuringWarn).toBe(false);
    expect(a.warnAttack.length).toBe(1);
  });
  test('attackStartsDuringWarn 관찰값이 0 이 아니면 실패한다', () => {
    const s = session({ strikes: 2 });
    for (let i = s.strikeIdx[0] - 10; i < s.rows.length; i++) s.rows[i].asw = 1;
    expect(run(s).acceptance.noAttackDuringWarn).toBe(false);
  });
  test('예고가 시작된 스텝에 보스가 이미 공격 중(state attack)이었으면 실패한다', () => {
    const s = session({ strikes: 2 });
    const start = s.strikeIdx[0] - WARN_FRAMES;
    s.rows[start - 1].st = 'attack'; s.rows[start].st = 'attack';
    expect(run(s).acceptance.noAttackDuringWarn).toBe(false);
  });
  test('영웅 타격으로 공격이 끊긴 스텝(직전 행 attack, 시작 행 hurt)에 시작한 예고는 합격이다', () => {
    // Battle 순서상 player 단계에서 보스가 hurt 로 바뀐 뒤 컨트롤러가 예고를 시작한다(BUNDLE-06 smoke-deep-auto-1 에서 관측).
    const s = session({ strikes: 2 });
    const start = s.strikeIdx[0] - WARN_FRAMES;
    s.rows[start - 1].st = 'attack'; s.rows[start].st = 'hurt';
    expect(run(s).acceptance.noAttackDuringWarn).toBe(true);
  });
  test('직전 행 attack 에서 시작 행 chase 로 바뀐 예고는 실패한다(공격이 enemies 단계에서 끝났다 = 공격 중 시작, 리뷰 P2-1)', () => {
    const s = session({ strikes: 2 });
    const start = s.strikeIdx[0] - WARN_FRAMES;
    s.rows[start - 1].st = 'attack'; s.rows[start].st = 'chase';
    expect(run(s).acceptance.noAttackDuringWarn).toBe(false);
  });
  test('예고 시작 스텝에 곧바로 새 공격이 시작돼도 실패한다', () => {
    const s = session({ strikes: 2 });
    for (let i = s.strikeIdx[0] - WARN_FRAMES; i < s.rows.length; i++) s.rows[i].seq = 1;
    expect(run(s).acceptance.noAttackDuringWarn).toBe(false);
  });
  test('낙하 스텝 이후에 시작된 공격은 허용한다(예고가 이미 끝났다)', () => {
    const s = session({ strikes: 2 });
    for (let i = s.strikeIdx[0]; i < s.rows.length; i++) s.rows[i].seq = 1;
    expect(run(s).acceptance.noAttackDuringWarn).toBe(true);
  });
  test('보스가 공격 중일 때 예고가 시작되지 않고 공격이 끝난 뒤 시작하는 것은 합격이다', () => {
    const s = session({ strikes: 2 });
    const start = s.strikeIdx[0] - WARN_FRAMES;
    for (let i = start - 30; i < start; i++) { s.rows[i].st = 'attack'; s.rows[i].seq = 1; }
    for (let i = start; i < s.rows.length; i++) s.rows[i].seq = 1;
    s.rows[start].st = 'attack';
    expect(run(s).acceptance.noAttackDuringWarn).toBe(false); // 시작 행까지 같은 공격이 이어지면 실패
    s.rows[start].st = 'chase';
    for (let i = start - 1; i < start; i++) s.rows[i].st = 'chase';
    expect(run(s).acceptance.noAttackDuringWarn).toBe(true);
  });
});

describe('처치 뒤 ended·낙하 수', () => {
  test('처치 뒤 행이 ended 가 아니면 실패한다', () => {
    const s = session({ strikes: 2 });
    s.rows.at(-1)!.os = 'armed';
    expect(run(s).acceptance.endedAfterDefeat).toBe(false);
  });
  test('처치 뒤 행이 없거나 전투 종료 뒤 읽은 orbit 가 ended 가 아니면 실패한다', () => {
    const s = session({ strikes: 2 });
    expect(run(s, { finalOrbit: { state: 'armed' } }).acceptance.endedAfterDefeat).toBe(false);
    const t = session({ strikes: 2 });
    t.rows = t.rows.filter(r => r.alive);
    expect(run(t).acceptance.endedAfterDefeat).toBe(false);
    expect(run(t).acceptance.bossObserved).toBe(false);
  });
  test('ended 가 된 뒤 다시 armed 로 돌아가면 상태 기계가 실패한다', () => {
    const s = session({ strikes: 2 });
    s.rows.at(-1)!.os = 'armed';
    expect(run(s).acceptance.stateMachine).toBe(false);
    expect(checkStateMachine(s.rows, DEF).violations[0].reason).toBe('illegal-transition');
  });
  test('처치 뒤 낙하가 있으면 실패한다', () => {
    const s = session({ strikes: 2 });
    s.rows.at(-1)!.sk = s.rows.at(-1)!.sk + 1;
    const a = run(s);
    expect(a.acceptance.noStrikeAfterDefeat).toBe(false);
  });
  test('낙하가 minStrikes 보다 적으면 실패한다(auto 1, orbit 3)', () => {
    const none = session({ strikes: 0 });
    expect(run(none).acceptance.strikeCount).toBe(false);
    expect(run(session({ strikes: 2 }), {}, 3).acceptance.strikeCount).toBe(false);
    expect(run(session({ strikes: 3 }), {}, 3).acceptance.strikeCount).toBe(true);
  });
});

describe('상태 기계(checkStateMachine)', () => {
  test('정상 세션은 합격하고 idle 로 되돌아가거나 알 수 없는 상태는 실패한다', () => {
    expect(checkStateMachine(session().rows, DEF).ok).toBe(true);
    const s = session({ strikes: 1 });
    s.rows[s.strikeIdx[0] + 3].os = 'idle';
    expect(checkStateMachine(s.rows, DEF).ok).toBe(false);
    const t = session({ strikes: 1 });
    t.rows[5].os = 'mystery';
    expect(checkStateMachine(t.rows, DEF).violations[0].reason).toBe('unknown-state');
  });
  test('warn 에 kind 가 없거나 warn 밖에 kind·warnLeft 가 남으면 실패한다', () => {
    const s = session({ strikes: 1 });
    s.rows[s.strikeIdx[0] - 5].ok = null;
    expect(checkStateMachine(s.rows, DEF).violations.some((v: any) => v.reason === 'warn-without-kind')).toBe(true);
    const t = session({ strikes: 1 });
    t.rows[3].ok = 'outer';
    expect(checkStateMachine(t.rows, DEF).violations.some((v: any) => v.reason === 'kind-outside-warn')).toBe(true);
    const u = session({ strikes: 1 });
    u.rows[3].wl = .5;
    expect(checkStateMachine(u.rows, DEF).violations.some((v: any) => v.reason === 'warn-left-outside-warn')).toBe(true);
  });
  test('warnLeft 가 거꾸로 늘거나 warning 을 넘으면 실패한다', () => {
    const s = session({ strikes: 1 });
    s.rows[s.strikeIdx[0] - 10].wl = DEF.warning;
    expect(checkStateMachine(s.rows, DEF).violations.some((v: any) => v.reason === 'warn-left-not-decreasing')).toBe(true);
    const t = session({ strikes: 1 });
    t.rows[t.strikeIdx[0] - 10].wl = DEF.warning + .5;
    expect(checkStateMachine(t.rows, DEF).violations.some((v: any) => v.reason === 'warn-left-range')).toBe(true);
  });
  test('카운터가 줄면 실패한다', () => {
    const s = session({ strikes: 2 });
    s.rows[s.strikeIdx[1] + 2].sk = 0;
    expect(checkStateMachine(s.rows, DEF).violations.some((v: any) => v.reason === 'counter-decreased')).toBe(true);
  });
  test('warnRuns 는 연속 warn 구간과 시작 순서를 돌려준다', () => {
    const runs = warnRuns(session({ strikes: 3 }).rows);
    expect(runs.map((r: any) => r.ordinal)).toEqual([1, 2, 3]);
    expect(runs.every((r: any) => r.last - r.start + 1 === WARN_FRAMES)).toBe(true);
  });
});

describe('목표창 표본(checkObjectiveSamples)', () => {
  test('outer 예고는 푸른 선 안쪽으로, center 예고는 푸른 선 밖으로 문구가 나와야 한다', () => {
    const s = session({ strikes: 3 }), info = analyzeStrikes(s.rows, DEF);
    const a = checkObjectiveSamples(s.rows, info.warns);
    expect(a.ok).toBe(true);
    expect(a.perWarn.every((w: any) => w.samples > 0 && w.wrong === 0)).toBe(true);
  });
  test('kind 와 다른 문구가 보이면 실패한다', () => {
    const s = session({ strikes: 3 });
    const doms = s.rows.filter(r => r.dom && r.ok === 'center');
    doms[0].dom = domOf('outer', 1);
    expect(run(s).acceptance.objectiveText).toBe(false);
    expect(run(s).objective.bad.length).toBe(1);
  });
  test('제목이 없거나 두 문구가 함께 있으면 실패한다', () => {
    const s = session({ strikes: 2 });
    s.rows.find(r => r.dom)!.dom = '바깥 유성 1.0초 · ' + OBJECTIVE_PHRASE.outer;
    expect(run(s).acceptance.objectiveText).toBe(false);
    const t = session({ strikes: 2 });
    t.rows.find(r => r.dom)!.dom = domOf('outer', 1) + ' ' + OBJECTIVE_PHRASE.center;
    expect(run(t).acceptance.objectiveText).toBe(false);
  });
  test('낙하한 예고에 표본이 하나도 없으면 실패한다', () => {
    const s = session({ strikes: 2 });
    for (const r of s.rows) delete r.dom;
    const a = run(s);
    expect(a.acceptance.objectiveText).toBe(false);
    expect(a.objective.missing.length).toBe(2);
  });
});

describe('결과 필드·줄', () => {
  const observed = { strikes: 4, centerStrikes: 1, hits: 1 };
  const ro = { complete: true, progress: 5, target: 5, bossMeteors: 4, bossCenterMeteors: 1, bossMeteorHits: 1 };
  test('관측 수와 같고 complete·progress = target 이면 합격', () => {
    expect(checkResultFields(ro, observed, true).ok).toBe(true);
  });
  test('낙하·중심·피격 수가 다르거나 숫자가 아니면 실패한다', () => {
    expect(checkResultFields({ ...ro, bossMeteors: 3 }, observed).meteors).toBe(false);
    expect(checkResultFields({ ...ro, bossCenterMeteors: 0 }, observed).centers).toBe(false);
    expect(checkResultFields({ ...ro, bossMeteorHits: 0 }, observed).hits).toBe(false);
    expect(checkResultFields({ ...ro, bossMeteors: undefined }, observed).ok).toBe(false);
    expect(checkResultFields({ ...ro, bossMeteors: '4' }, observed).ok).toBe(false);
    expect(checkResultFields(null, observed).ok).toBe(false);
  });
  test('complete 가 아니거나 progress ≠ target 이거나 패배면 실패한다', () => {
    expect(checkResultFields({ ...ro, complete: false }, observed).complete).toBe(false);
    expect(checkResultFields({ ...ro, progress: 4 }, observed).complete).toBe(false);
    expect(checkResultFields(ro, observed, false).complete).toBe(false);
  });
  test('결과 줄은 정확히 한 번 같은 문구여야 한다', () => {
    expect(checkResultLine('가나 ' + bossResultLine(4, 1) + ' 다라', 4, 1).ok).toBe(true);
    expect(checkResultLine(bossResultLine(4, 1) + '\n' + bossResultLine(4, 1), 4, 1).ok).toBe(false);
    expect(checkResultLine(bossResultLine(4, 0), 4, 1).ok).toBe(false);
    expect(checkResultLine('궤도 고리 연결 5/5', 4, 1).ok).toBe(false);
    expect(checkResultLine(undefined, 4, 1).ok).toBe(false);
  });
  test('전체 판정에서 결과 필드·줄이 어긋나면 해당 항목만 실패한다', () => {
    const s = session({ strikes: 3 });
    s.ro.bossMeteors = 2;
    expect(failing(run(s))).toEqual(['resultFields']);
    const t = session({ strikes: 3 });
    t.text = '푸른 궤도선 유성 2회 · 피격 0회';
    expect(failing(run(t))).toEqual(['resultLine']);
    const u = session({ strikes: 3 });
    u.ro.complete = false;
    expect(failing(run(u))).toEqual(['resultFields']);
    expect(failing(run(session({ strikes: 3 }), { win: false }))).toEqual(['resultFields']);
  });
});

describe('orbit 프로필 키보드 구간(checkManualSegment)', () => {
  /** 사전: 부착 뒤 키보드 구간. 구간 앞 행의 카운터는 0 이다. */
  const manual = (strikes = 4) => {
    const s = session({ strikes });
    const from = 3;
    s.rows.forEach((r, i) => { if (i >= from) { r.au = false; r.ps = 'move'; } });
    return { s, from, to: s.strikeIdx[strikes - 1] + 1 };
  };
  test('낙하 3회 이상(outer ≥ 1 · center ≥ 1)·피격 0·키보드만이면 합격', () => {
    const { s, from, to } = manual(3);
    const a = checkManualSegment(s.rows, from, to, { minStrikes: 3 });
    expect(a.ok).toBe(true);
    expect(a).toMatchObject({ strikes: 3, outer: 2, center: 1, hits: 0 });
    expect(checkManualSegment(s.rows, from, to, { minStrikes: 3, def: DEF }).ok).toBe(true);
  });
  test('def 가 있으면 낙하마다 영웅이 피격 구역 밖이어야 한다(무적으로 피한 낙하는 실패, 리뷰 P3-1)', () => {
    const { s, from, to } = manual(3);
    // 첫 낙하에서 바깥 고리 안(7.0)에 서 있었지만 무적으로 맞지 않았다.
    s.rows[s.strikeIdx[0]].hr = 7; s.rows[s.strikeIdx[0] - 1].inv = 1;
    const a = checkManualSegment(s.rows, from, to, { minStrikes: 3, def: DEF });
    expect(a.checks.noHits).toBe(true);
    expect(a.checks.safeZone).toBe(false);
    expect(a.ok).toBe(false);
    // 경계 모호(선 위)도 안전 증거가 아니다.
    const b = manual(3);
    b.s.rows[b.s.strikeIdx[2]].hr = DEF.safe + .01;
    expect(checkManualSegment(b.s.rows, b.from, b.to, { minStrikes: 3, def: DEF }).checks.safeZone).toBe(false);
  });
  test('낙하가 2회뿐이거나 center 가 없으면 실패한다', () => {
    const { s, from } = manual(4);
    expect(checkManualSegment(s.rows, from, s.strikeIdx[1] + 1, { minStrikes: 3 }).checks.strikes).toBe(false);
    const c = checkManualSegment(s.rows, from, s.strikeIdx[1] + 1, { minStrikes: 2 });
    expect(c.checks.center).toBe(false);
  });
  test('구간 안 궤도선 피격이 있으면 실패한다', () => {
    const { s, from, to } = manual(3);
    s.rows.forEach((r, i) => { if (i >= s.strikeIdx[0]) r.ht = 1; });
    const a = checkManualSegment(s.rows, from, to, { minStrikes: 3 });
    expect(a.checks.noHits).toBe(false);
    expect(a.ok).toBe(false);
  });
  test('영웅이 쓰러진 행이 있으면 실패한다', () => {
    const { s, from, to } = manual(3);
    s.rows[s.strikeIdx[1]].hhp = 0;
    expect(checkManualSegment(s.rows, from, to, { minStrikes: 3 }).checks.heroAlive).toBe(false);
  });
  test('AUTO 가 켜졌거나 공격 입력·공격 동작이 있으면 실패한다', () => {
    const base = manual(3);
    base.s.rows[base.from + 50].au = true;
    expect(checkManualSegment(base.s.rows, base.from, base.to, { minStrikes: 3 }).checks.keyboardOnly).toBe(false);
    const held = manual(3);
    held.s.rows[held.from + 50].ah = true;
    expect(checkManualSegment(held.s.rows, held.from, held.to, { minStrikes: 3 }).checks.keyboardOnly).toBe(false);
    const act = manual(3);
    act.s.rows[act.from + 50].ps = 'attack';
    expect(checkManualSegment(act.s.rows, act.from, act.to, { minStrikes: 3 }).checks.keyboardOnly).toBe(false);
  });
  test('AUTO 를 끈 직후 남은 동작(attack·skill·ult·dodge)은 처음 벗어난 행부터 센다', () => {
    const { s, from, to } = manual(3);
    for (let i = from; i < from + 5; i++) s.rows[i].ps = 'attack';
    s.rows[from + 5].ps = 'skill';
    const a = checkManualSegment(s.rows, from, to, { minStrikes: 3 });
    expect(a.ok).toBe(true);
    expect(a.leadSteps).toBe(6);
    // 동작이 끝나지 않고 이어지는 구간 중간에 다시 나오면 실패한다.
    s.rows[from + 80].ps = 'dodge';
    expect(checkManualSegment(s.rows, from, to, { minStrikes: 3 }).checks.keyboardOnly).toBe(false);
  });
  test('빈 구간은 실패한다', () => {
    expect(checkManualSegment(session().rows, 5, 5, { minStrikes: 3 }).ok).toBe(false);
  });
});

describe('pause 프로필(checkPause)', () => {
  const orbit = (over: any = {}) => ({ state: 'warn', kind: 'outer', warnLeft: .9, strikes: 1, centerStrikes: 0, hits: 0, asw: 0, ...over });
  const at = (elapsed: number, o: any = {}, seq = 3) => ({ elapsed, orbit: orbit(o), boss: { seq } });
  const good = () => ({ before: at(50), paused: at(50), still: at(50), resumed: at(50.5, { warnLeft: .9 - 30 * FRAME }), steps: 30 });
  test('정지 중 불변·재개 뒤 30스텝만큼만 줄면 합격', () => {
    const v = checkPause(good());
    expect(v.ok).toBe(true);
    expect(v.frozen).toBe(true);
    expect(v.resumedOk).toBe(true);
  });
  test('정지 중 warnLeft·strikes·게임 시간·attackSequence 가 변하면 실패한다', () => {
    for (const patch of [{ warnLeft: .8 }, { strikes: 2 }, { hits: 1 }, { asw: 1 }, { state: 'armed' }]) {
      const c = good(); c.still = at(50, patch);
      expect(checkPause(c).frozen).toBe(false);
    }
    const t = good(); t.still = at(51); expect(checkPause(t).frozen).toBe(false);
    const q = good(); q.paused = at(50, {}, 4); expect(checkPause(q).frozen).toBe(false);
  });
  test('재개 뒤 warnLeft 가 그대로이거나 정지 시간만큼 줄었으면 실패한다', () => {
    const none = good(); none.resumed = at(50.5, { warnLeft: .9 });
    expect(checkPause(none).resumedOk).toBe(false);
    const jump = good(); jump.resumed = at(50.5, { warnLeft: .9 - 90 * FRAME });
    expect(checkPause(jump).resumedOk).toBe(false);
  });
  test('재개 뒤 예고가 바뀌었거나 이미 낙하했으면 실패한다', () => {
    const kind = good(); kind.resumed = at(50.5, { warnLeft: .9 - 30 * FRAME, kind: 'center' });
    expect(checkPause(kind).resumedOk).toBe(false);
    const strike = good(); strike.resumed = at(50.5, { state: 'armed', warnLeft: 0, strikes: 2 });
    expect(checkPause(strike).resumedOk).toBe(false);
  });
  test('일시정지 전에 warn 이 아니거나 남은 시간이 너무 짧으면 검사 자체가 성립하지 않아 실패한다', () => {
    const idle = good(); idle.before = at(50, { state: 'armed', warnLeft: 0, kind: null });
    expect(checkPause(idle).warnBefore).toBe(false);
    const short = good(); short.before = at(50, { warnLeft: 10 * FRAME });
    expect(checkPause(short).ok).toBe(false);
  });
});

describe('screens 프로필(checkScreens)', () => {
  const labels = ['orbit-armed', 'orbit-outer-warn', 'orbit-center-warn'];
  test('모든 순간이 3개 화면 크기로 찍혔으면 합격', () => {
    const shots = labels.map(label => ({ label, reached: true, files: ['a', 'b', 'c'] }));
    expect(checkScreens(shots, labels, 3).ok).toBe(true);
  });
  test('도달하지 못한 순간이나 PNG 가 모자라면 실패한다', () => {
    const shots = labels.map(label => ({ label, reached: true, files: ['a', 'b', 'c'] }));
    expect(checkScreens(shots.slice(0, 2), labels, 3).ok).toBe(false);
    expect(checkScreens([{ ...shots[0], reached: false }, shots[1], shots[2]], labels, 3).ok).toBe(false);
    expect(checkScreens([{ ...shots[0], files: ['a'] }, shots[1], shots[2]], labels, 3).ok).toBe(false);
    expect(checkScreens([], [], 3).ok).toBe(false);
  });
});

describe('측정 보조', () => {
  test('percentile·stepStats', () => {
    expect(percentile([], .5)).toBeNull();
    expect(percentile([5, 1, 3], .5)).toBe(3);
    const stats = stepStats([1, 2, 60, 70, 3]);
    expect(stats).toMatchObject({ n: 5, max: 70, over: 2 });
    expect(stepStats([]).max).toBeNull();
  });
  test('summarizeBoss 는 첫 행과 처치 행 시각으로 보스전 길이를 낸다', () => {
    const s = session({ strikes: 1 }), sum = summarizeBoss(s.rows);
    expect(sum.observed).toBe(true);
    expect(sum.defeated).toBe(true);
    expect(sum.fightSeconds).toBeCloseTo(s.rows[sum.defeatIdx].t - s.rows[0].t, 9);
    expect(summarizeBoss([]).observed).toBe(false);
    const alive = summarizeBoss(s.rows.filter(r => r.alive));
    expect(alive.defeated).toBe(false);
    expect(alive.fightSeconds).toBeNull();
  });
  test('analyzeStrikes 는 낙하 순서·예고 길이를 낸다', () => {
    const info = analyzeStrikes(session({ strikes: 3 }).rows, DEF);
    expect(info.strikes.map((x: any) => x.n)).toEqual([1, 2, 3]);
    expect(info.strikes.map((x: any) => x.kind)).toEqual(['outer', 'outer', 'center']);
    expect(info.violations).toEqual([]);
  });
});

describe('기준선 비교(compareRuns)', () => {
  test('비교 대상 확인: 기준선은 궤도선 정의 없음, 후보는 정의·궤도선 판정 통과, 둘 다 pass 여야 한다(리뷰 P3-3)', () => {
    const c = { orbitDefinition: true, orbitOk: true, status: 'pass' }, b = { orbitDefinition: false, status: 'pass' };
    expect(compareTargetsOk(c, b)).toBe(true);
    expect(compareTargetsOk(b, c)).toBe(false);          // 뒤바뀜
    expect(compareTargetsOk(c, { ...c })).toBe(false);   // 후보끼리
    expect(compareTargetsOk({ ...c, orbitOk: false }, b)).toBe(false);
    expect(compareTargetsOk({ ...c, status: 'fail' }, b)).toBe(false);
    expect(compareTargetsOk(c, { ...b, status: 'fail' })).toBe(false);
  });
  const samples = (enter: number | null, ready: number | null) => [...(enter === null ? [] : [{ label: 'bossEnter', calls: enter }]), ...(ready === null ? [] : [{ label: 'bossReady', calls: ready }])];
  const base: any = { fight: 40, time: 200, samples: samples(60, 61), bossOver50: 1 };
  const cand = (over: any = {}) => ({ fight: 50, time: 230, samples: samples(62, 63), bossOver50: 2, ...over });
  test('비율·draw call 증가·느린 스텝이 모두 한도 안이면 합격', () => {
    const v = compareRuns(cand(), base);
    expect(v.ok).toBe(true);
    expect(v.bossEnter).toMatchObject({ increase: 2, matched: true, ok: true });
    expect(v.bossReady).toMatchObject({ increase: 2, ok: true });
    expect(v.slow.limit).toBe(3);
  });
  test('경계 값: 비 2.0·draw call 증가 3·느린 스텝 기준선 + 2 는 합격', () => {
    const v = compareRuns(cand({ fight: 80, time: 400, samples: samples(63, 64), bossOver50: 3 }), base);
    expect(v.fight.ratio).toBe(2);
    expect(v.ok).toBe(true);
  });
  test('보스전 시간 비·완주 시간 비가 2.0 을 넘으면 실패한다', () => {
    expect(compareRuns(cand({ fight: 81 }), base).fight.ok).toBe(false);
    expect(compareRuns(cand({ time: 401 }), base).time.ok).toBe(false);
    expect(compareRuns(cand({ fight: 81 }), base).ok).toBe(false);
  });
  test('완주 또는 처치 시간이 없으면(null) 실패한다', () => {
    expect(compareRuns(cand({ time: null }), base).time.ok).toBe(false);
    expect(compareRuns(cand({ fight: null }), base).fight.ok).toBe(false);
    expect(compareRuns(cand(), { ...base, time: null }).time.ok).toBe(false);
  });
  test('bossEnter·bossReady draw call 증가가 3 을 넘으면 실패한다', () => {
    expect(compareRuns(cand({ samples: samples(64, 63) }), base).bossEnter.ok).toBe(false);
    expect(compareRuns(cand({ samples: samples(62, 65) }), base).bossReady.ok).toBe(false);
  });
  test('짝이 없으면 실패한다(후보 또는 기준선 한쪽에 bossReady 가 없는 경우)', () => {
    expect(compareRuns(cand({ samples: samples(62, null) }), base).bossReady).toMatchObject({ matched: false, ok: false });
    expect(compareRuns(cand(), { ...base, samples: samples(60, null) }).bossReady.ok).toBe(false);
    expect(compareRuns(cand({ samples: samples(null, 63) }), base).bossEnter.ok).toBe(false);
    expect(compareRuns(cand({ samples: [] }), base).ok).toBe(false);
  });
  test('보스 구간 50ms 초과 수가 기준선 + 2 를 넘거나 값이 없으면 실패한다', () => {
    expect(compareRuns(cand({ bossOver50: 4 }), base).slow.ok).toBe(false);
    expect(compareRuns(cand({ bossOver50: null }), base).slow.ok).toBe(false);
    expect(compareRuns(cand(), { ...base, bossOver50: null }).slow.ok).toBe(false);
  });
  test('draw call 증가가 음수(감소)여도 합격', () => {
    expect(compareRuns(cand({ samples: samples(55, 55) }), base).ok).toBe(true);
    expect(drawCallIncrease([{ label: 'bossEnter', calls: 50 }], [{ label: 'bossEnter', calls: 60 }], 'bossEnter').increase).toBe(-10);
  });
});
