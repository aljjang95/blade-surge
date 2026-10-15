import { describe, expect, test } from 'bun:test';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import { ALLOWED, FRAME, analyzeBells, analyzeCounter, buildAttempts, buildReplays, checkAnswerOrder, checkClears, checkCounterObjective, checkCounterPause, checkCounterStats,
  checkDamageMultiplier, checkDiscord, checkGuideText, checkPhaseTimeline, checkReplay, checkReplays, checkResult, checkResultLine, checkWindows, compareBoss, compareToBaseline,
  discordEvents, drawCallIncrease, isTrigger, missedOpens, mitigatedDamage, openRuns, percentile, reverseOrder, stepStats, summarizeBoss } from '../tools/bellfall-deep-checks.mjs';

// 정의는 대상 프로젝트의 데이터에서 읽는다(도구와 같은 방식). 판정 함수는 값을 박지 않는다.
const DEF: any = ROUTE_OBJECTIVES.bellfall_deep;
const ANSWER = reverseOrder(DEF.tollOrder);
const step = (seconds: number) => Math.round(seconds / FRAME) * FRAME;

const ctl = (t: number, from: string, to: string) => ({ kind: 'ctl', t, from, to });
const gate = (t: number, room: number, from: string, to: string) => ({ kind: 'gate', t, room, from, to });

/** 컨트롤러 계약(3.1)대로 움직이는 로그를 만든다. 불협 횟수만큼 오답 시도를 앞에 둔다. 단계 시각은 1/60 격자에 맞춘다. */
function session(discords = 0, opts: { lead?: number; gap?: number; tail?: number } = {}) {
  const { lead, gap, tail } = { ...DEF.toll, ...opts };
  const log: any[] = [];
  let t = 10;
  for (const gateDef of DEF.gates) { t += 3; log.push(gate(step(t), gateDef.roomId, 'locked', 'lit')); }
  let from = 'wake';
  for (let attempt = 0; attempt <= discords; attempt++) {
    log.push(ctl(step(t), from, 'toll'));
    const start = t;
    DEF.tollOrder.forEach((room: number, k: number) => log.push(gate(step(start + lead + k * gap), room, 'lit', 'dark')));
    const lastDark = start + lead + (DEF.tollOrder.length - 1) * gap;
    t = lastDark + tail;
    log.push(ctl(step(t), 'toll', 'answer'));
    if (attempt < discords) {
      t += DEF.holdSeconds + 3;
      log.push({ kind: 'discord', t: step(t) });
      DEF.tollOrder.forEach((room: number) => log.push(gate(step(t), room, 'dark', 'lit')));
      from = 'answer';
      continue;
    }
    for (const room of ANSWER) { t += DEF.holdSeconds + 1; log.push(gate(step(t), room, 'dark', 'resonated')); }
    log.push(ctl(step(t), 'answer', 'done'));
  }
  return { log, doneT: step(t) };
}

describe('phase 타임라인', () => {
  test('wake → toll → answer → done 이 합격하고 불협 재생(answer → toll)도 합격한다', () => {
    expect(checkPhaseTimeline(session(0).log).ok).toBe(true);
    const withDiscord = checkPhaseTimeline(session(2).log);
    expect(withDiscord.ok).toBe(true);
    expect(withDiscord.last).toBe('done');
  });
  test('단계 건너뛰기(wake → answer, toll → done, wake → done)는 실패한다', () => {
    for (const [from, to] of [['wake', 'answer'], ['wake', 'done'], ['toll', 'done'], ['toll', 'wake'], ['answer', 'wake']]) {
      const log = [ctl(1, 'wake', 'toll'), ...(from === 'wake' ? [] : [ctl(2, 'toll', 'answer')]), ctl(3, from, to)];
      // from 이 wake 가 아니면 이어지는 위치에서 건너뛰기를 시도하게 한다.
      const chain = from === 'wake' ? [ctl(1, from, to)] : from === 'toll' ? [ctl(1, 'wake', 'toll'), ctl(2, from, to)] : log;
      expect(checkPhaseTimeline(chain).ok).toBe(false);
    }
    const skip = checkPhaseTimeline([ctl(1, 'wake', 'answer')]);
    expect(skip.violations.some((v: any) => v.reason === 'illegal-step')).toBe(true);
  });
  test('전이가 이어지지 않거나 done 뒤에 더 전이하면 실패한다', () => {
    expect(checkPhaseTimeline([ctl(1, 'wake', 'toll'), ctl(2, 'answer', 'done')]).ok).toBe(false);
    expect(checkPhaseTimeline([...session(0).log, ctl(99, 'done', 'toll')]).ok).toBe(false);
  });
  test('허용표는 wake → toll → answer → (toll | done) 뿐이다', () => {
    expect(ALLOWED.wake).toEqual(['toll']);
    expect(ALLOWED.toll).toEqual(['answer']);
    expect(ALLOWED.answer).toEqual(['toll', 'done']);
    expect(ALLOWED.done).toEqual([]);
  });
});

describe('소등 재생', () => {
  test('정의의 순서·간격·tail 대로면 합격하고 불협마다 재생이 하나 늘어난다', () => {
    expect(buildReplays(session(0).log)).toHaveLength(1);
    expect(buildReplays(session(2).log)).toHaveLength(3);
    const result = checkReplays(session(2).log, DEF, 3);
    expect(result.ok).toBe(true);
    for (const row of result.rows) {
      expect(row.rooms).toEqual(DEF.tollOrder);
      expect(row.gaps.every((g: number) => Math.abs(g - DEF.toll.gap) <= FRAME + 1e-9)).toBe(true);
      expect(Math.abs(row.tailMeasured - DEF.toll.tail)).toBeLessThanOrEqual(FRAME + 1e-9);
    }
  });
  test('소등 순서가 정의와 다르면 실패한다', () => {
    const log = session(0).log.map((e: any) => e.kind === 'gate' && e.to === 'dark' ? { ...e, room: ANSWER[DEF.tollOrder.indexOf(e.room)] } : e);
    expect(checkReplays(log, DEF, 1).ok).toBe(false);
  });
  test('간격이 gap ± 1/60 를 넘으면 실패하고 안쪽이면 합격한다', () => {
    const shifted = (extra: number) => session(0).log.map((e: any, i: number, all: any[]) => {
      if (e.kind !== 'gate' || e.to !== 'dark') return e;
      const k = all.filter((x: any, j: number) => j < i && x.kind === 'gate' && x.to === 'dark').length;
      return k === 1 ? { ...e, t: e.t + extra } : e;
    });
    expect(checkReplays(shifted(FRAME * 1.5), DEF, 1).rows[0].gapOk).toBe(false);
    expect(checkReplays(shifted(FRAME * .5), DEF, 1).rows[0].gapOk).toBe(true);
    expect(checkReplays(shifted(.3), DEF, 1).ok).toBe(false);
  });
  test('answer 시작이 마지막 소등 + tail ± 1/60 밖이면 실패한다', () => {
    expect(checkReplays(session(0, { tail: DEF.toll.tail + .2 }).log, DEF, 1).rows[0].tailOk).toBe(false);
    expect(checkReplays(session(0, { tail: DEF.toll.tail - .2 }).log, DEF, 1).ok).toBe(false);
    expect(checkReplays(session(0, { tail: DEF.toll.tail + FRAME * .9 }).log, DEF, 1).rows[0].tailOk).toBe(true);
  });
  test('소등이 부족하거나 많으면 실패하고, 진행 중 재생은 앞부분만 본다', () => {
    const log = session(0).log, missing = log.filter((e: any, i: number) => !(e.kind === 'gate' && e.to === 'dark' && log.findIndex((x: any) => x.kind === 'gate' && x.to === 'dark') === i));
    expect(checkReplays(missing, DEF, 1).ok).toBe(false);
    const partial = { startT: 0, darks: [{ t: DEF.toll.lead, room: DEF.tollOrder[0] }], answerT: null };
    expect(checkReplay(partial, DEF).ok).toBe(true);
    expect(checkReplay({ ...partial, darks: [{ t: DEF.toll.lead, room: ANSWER[0] }] }, DEF).ok).toBe(false);
  });
  test('재생 횟수가 기대(1 + 불협)와 다르면 실패한다', () => {
    expect(checkReplays(session(1).log, DEF, 1).ok).toBe(false);
    expect(checkReplays(session(1).log, DEF, 2).ok).toBe(true);
  });
});

describe('역순 공명', () => {
  test('공명 순서가 tollOrder 의 역순이면 합격한다', () => {
    const result = checkAnswerOrder(session(0).log, DEF, 0);
    expect(result.ok).toBe(true);
    expect(result.attempts[0].rooms).toEqual(ANSWER);
    expect(result.answer).toEqual(ANSWER);
  });
  test('소등 순서 그대로 공명하면 실패한다', () => {
    const log = session(0).log.map((e: any) => e.kind === 'gate' && e.to === 'resonated' ? { ...e, room: DEF.tollOrder[ANSWER.indexOf(e.room)] } : e);
    expect(checkAnswerOrder(log, DEF, 0).ok).toBe(false);
  });
  test('유지 시간보다 빨리 공명하면 실패한다', () => {
    const log = session(0).log.map((e: any) => e.kind === 'gate' && e.to === 'resonated' ? { ...e, t: e.t - 2 } : e);
    expect(checkAnswerOrder(log, DEF, 0).attempts.every((a: any) => a.holdOk)).toBe(false);
  });
  test('불협으로 끝난 시도 수가 기대와 다르면 실패하고, 맞으면 시도들이 분리된다', () => {
    const log = session(2).log;
    expect(buildAttempts(log).map((a: any) => a.end)).toEqual(['discord', 'discord', 'done']);
    expect(checkAnswerOrder(log, DEF, 2).ok).toBe(true);
    expect(checkAnswerOrder(log, DEF, 1).ok).toBe(false);
    expect(checkAnswerOrder(log, DEF, 3).discordCountOk).toBe(false);
  });
  test('완료하지 못한 로그(done 없음)는 합격하지 않는다', () => {
    const log = session(0).log.filter((e: any) => !(e.kind === 'ctl' && e.to === 'done'));
    expect(checkAnswerOrder(log, DEF, 0).ok).toBe(false);
  });
});

describe('방 정화와 봉인', () => {
  const rooms = DEF.gates.map((g: any) => g.roomId);
  const { doneT } = session(0);
  test('done 이전에 세 종 방이 정화되지 않고 같은 스텝에 정화되면 합격한다', () => {
    const clears = [...rooms].sort((a: number, b: number) => a - b).map((room: number) => ({ t: doneT, room })).concat([{ t: doneT - 100, room: 99 }]);
    const result = checkClears({ clears, gateRooms: rooms, tollOrder: DEF.tollOrder, doneT, sealT: doneT + 3 });
    expect(result.ok).toBe(true);
    expect(result.orderObservable).toBe(false);
  });
  test('done 이전 정화는 실패한다', () => {
    const clears = rooms.map((room: number, i: number) => ({ t: i === 0 ? doneT - 2 : doneT, room }));
    const result = checkClears({ clears, gateRooms: rooms, tollOrder: DEF.tollOrder, doneT, sealT: doneT + 1 });
    expect(result.ok).toBe(false);
    expect(result.gateRoomsBeforeDone).toEqual([rooms[0]]);
  });
  test('봉인 해제가 done 보다 빠르면 실패한다', () => {
    const clears = rooms.map((room: number) => ({ t: doneT, room }));
    expect(checkClears({ clears, gateRooms: rooms, tollOrder: DEF.tollOrder, doneT, sealT: doneT - 1 }).ok).toBe(false);
    expect(checkClears({ clears, gateRooms: rooms, tollOrder: DEF.tollOrder, doneT, sealT: null }).ok).toBe(true);
  });
  test('purgePending 으로 다른 시각에 정화되면 정답 순서(역순)를 요구한다', () => {
    const inOrder = ANSWER.map((room: number, i: number) => ({ t: doneT + i * .5, room }));
    expect(checkClears({ clears: inOrder, gateRooms: rooms, tollOrder: DEF.tollOrder, doneT, sealT: null }).ok).toBe(true);
    const reversed = [...inOrder].reverse().map((c: any, i: number) => ({ ...c, t: doneT + i * .5 }));
    const result = checkClears({ clears: reversed, gateRooms: rooms, tollOrder: DEF.tollOrder, doneT, sealT: null });
    expect(result.orderOk).toBe(false);
    expect(result.ok).toBe(false);
  });
  test('정화가 빠졌거나 두 번 기록되거나 done 이 없으면 실패한다', () => {
    const base = rooms.map((room: number) => ({ t: doneT, room }));
    expect(checkClears({ clears: base.slice(1), gateRooms: rooms, tollOrder: DEF.tollOrder, doneT, sealT: null }).ok).toBe(false);
    expect(checkClears({ clears: [...base, base[0]], gateRooms: rooms, tollOrder: DEF.tollOrder, doneT, sealT: null }).ok).toBe(false);
    expect(checkClears({ clears: base, gateRooms: rooms, tollOrder: DEF.tollOrder, doneT: null, sealT: null }).ok).toBe(false);
  });
});

describe('불협', () => {
  // 실제 smoke(work/b04/diag/smoke-discord-1) 값: 최대 체력 30824, 방어 302.5 → round(30824 × .06 × (1 − 302.5/552.5)) = 837.
  const reductions = { tonicGuard: 0, sanctum: 0, aegis: 0 };
  const good: any = { discords: 1, discordsBefore: 0, hpBefore: 30824, hpAfter: 30824 - 837, maxHp: 30824, def: 302.5, reductions, prevHold: DEF.holdSeconds - FRAME,
    wrongRoom: DEF.tollOrder[0], expectedRoom: ANSWER[0], phaseAfter: 'toll', progressAfter: 0, gatesAfter: DEF.gates.map(() => 'lit') };
  test('정답 외 종에서 2초를 채우면 방어 경감을 적용한 6% 기준 피해·toll·progress 0·모든 종 lit 로 합격한다', () => {
    const result = checkDiscord(good, DEF);
    expect(result.ok).toBe(true);
    expect(result.expected).toBe(837);
    expect(mitigatedDamage(1000, .06, 0)).toBe(60);
    // 경감 상한 60%: 방어가 아무리 높아도 6% 기준의 40% 아래로 내려가지 않는다.
    expect(mitigatedDamage(1000, .06, 1e9)).toBe(24);
  });
  test('피해 비율·유지 시간·단계·초기화 중 하나라도 어긋나면 실패한다', () => {
    expect(checkDiscord({ ...good, hpAfter: 1000 }, DEF).damageOk).toBe(false);
    // 경감 없는 6%(1849)나 1 차이도 실패한다. 같은 스텝에 다른 피해가 섞이면 실패한다.
    expect(checkDiscord({ ...good, hpAfter: 30824 - 1849 }, DEF).damageOk).toBe(false);
    expect(checkDiscord({ ...good, hpAfter: 30824 - 838 }, DEF).damageOk).toBe(false);
    // 방어 기록이 없거나 다른 경감이 켜져 있으면 판정할 수 없으므로 합격하지 않는다.
    expect(checkDiscord({ ...good, def: undefined }, DEF).damageOk).toBe(false);
    expect(checkDiscord({ ...good, reductions: undefined }, DEF).damageOk).toBe(false);
    expect(checkDiscord({ ...good, reductions: { ...reductions, aegis: .2 } }, DEF).damageOk).toBe(false);
    expect(checkDiscord({ ...good, prevHold: .5 }, DEF).heldLongEnough).toBe(false);
    expect(checkDiscord({ ...good, wrongRoom: ANSWER[0] }, DEF).wrongGate).toBe(false);
    expect(checkDiscord({ ...good, phaseAfter: 'answer' }, DEF).ok).toBe(false);
    expect(checkDiscord({ ...good, progressAfter: 1 }, DEF).ok).toBe(false);
    expect(checkDiscord({ ...good, gatesAfter: ['lit', 'lit', 'resonated'] }, DEF).allLit).toBe(false);
    expect(checkDiscord({ ...good, discords: 2 }, DEF).countStep).toBe(false);
  });
});

describe('discordEvents', () => {
  test('불협 사건에 그 시점 정답 방을 붙인다(공명한 수만큼 역순 정답을 센다)', () => {
    const events = discordEvents(session(2).log, DEF);
    expect(events).toHaveLength(2);
    expect(events.every((e: any) => e.expectedRoom === ANSWER[0])).toBe(true);
    // 첫 종을 공명한 뒤 불협이면 정답은 두 번째 방이다.
    const log = [ctl(1, 'wake', 'toll'), ctl(2, 'toll', 'answer'), gate(3, ANSWER[0], 'dark', 'resonated'), { kind: 'discord', t: 4 }, ctl(4, 'answer', 'toll')];
    expect(discordEvents(log, DEF)[0].expectedRoom).toBe(ANSWER[1]);
    expect(discordEvents([], DEF)).toEqual([]);
  });
});

describe('목표창 정답 노출', () => {
  const label = DEF.gates.find((g: any) => g.roomId === ANSWER[0]).label;
  test('불협 guideAfter 회 미만이면 다음·정답 label 이 보이면 안 된다', () => {
    for (const discords of [0, DEF.guideAfter - 1]) {
      expect(checkGuideText('종문 역순 공명 0/3 마지막에 꺼진 종부터 중심 2초', { discords, guideAfter: DEF.guideAfter, expectedLabel: label }).ok).toBe(true);
      expect(checkGuideText('종문 역순 공명 0/3 다음 ' + label + ' · 중심 2초', { discords, guideAfter: DEF.guideAfter, expectedLabel: label }).ok).toBe(false);
      expect(checkGuideText('종문 역순 공명 ' + label, { discords, guideAfter: DEF.guideAfter, expectedLabel: label }).ok).toBe(false);
    }
  });
  test('guideAfter 회 이상이면 다음 + 정답 label 이 보여야 한다', () => {
    const args = { discords: DEF.guideAfter, guideAfter: DEF.guideAfter, expectedLabel: label };
    expect(checkGuideText('종문 역순 공명 0/3 다음 ' + label + ' · 중심 2초', args).ok).toBe(true);
    expect(checkGuideText('종문 역순 공명 0/3 마지막에 꺼진 종부터 중심 2초', args).ok).toBe(false);
    const other = DEF.gates.find((g: any) => g.roomId === ANSWER[1]).label;
    expect(checkGuideText('종문 역순 공명 0/3 다음 ' + other + ' · 중심 2초', args).ok).toBe(false);
  });
});

describe('결과', () => {
  const ro = (discords: number, extra: any = {}) => ({ id: DEF.id, label: '종문 역순 공명', complete: true, progress: 3, target: 3, rooms: ANSWER, discords, tolls: discords + 1, ...extra });
  test('complete·progress 3·rooms 역순·discords·tolls 가 기대와 같으면 합격한다', () => {
    expect(checkResult(ro(0), DEF, { discords: 0 }).ok).toBe(true);
    expect(checkResult(ro(2), DEF, { discords: 2 }).ok).toBe(true);
  });
  test('미완료·부족한 progress·정순 rooms·불협 수 불일치는 실패한다', () => {
    expect(checkResult(ro(0, { complete: false }), DEF, { discords: 0 }).ok).toBe(false);
    expect(checkResult(ro(0, { progress: 2 }), DEF, { discords: 0 }).ok).toBe(false);
    expect(checkResult(ro(0, { rooms: DEF.tollOrder }), DEF, { discords: 0 }).ok).toBe(false);
    expect(checkResult(ro(1), DEF, { discords: 0 }).ok).toBe(false);
    expect(checkResult(ro(0), DEF, { discords: 0, win: false }).ok).toBe(false);
    expect(checkResult(undefined, DEF, { discords: 0 }).ok).toBe(false);
  });
  test('결과 줄은 한 번만 나오고 routeObjective 와 같아야 한다', () => {
    expect(checkResultLine('정산\n종문 역순 공명 3/3 · 불협 0회 · 완료\n보상', ro(0)).ok).toBe(true);
    expect(checkResultLine('종문 역순 공명 3/3 · 불협 2회 · 완료', ro(2)).ok).toBe(true);
    expect(checkResultLine('종문 역순 공명 3/3 · 불협 0회 · 완료\n종문 역순 공명 3/3 · 완료', ro(0)).ok).toBe(false);
    expect(checkResultLine('종문 역순 공명 3/3 · 완료', ro(0)).ok).toBe(false);
    expect(checkResultLine('종문 역순 공명 3/3 · 불협 1회 · 완료', ro(0)).ok).toBe(false);
    expect(checkResultLine('종문 역순 공명 3/3 · 불협 0회', ro(0)).ok).toBe(false);
    expect(checkResultLine('종문 역순 공명 2/3 · 불협 1회', ro(1, { complete: false, progress: 2 })).ok).toBe(true);
  });
});

describe('analyzeBells', () => {
  const doneOf = (discords: number) => session(discords).doneT;
  const obs = (discords: number, patch: any = {}) => ({ log: session(discords).log, clears: DEF.gates.map((g: any) => ({ t: doneOf(discords), room: g.roomId })), sealT: doneOf(discords) + 2,
    result: { id: DEF.id, label: '종문 역순 공명', complete: true, progress: 3, target: 3, rooms: ANSWER, discords, tolls: discords + 1 },
    resultText: '종문 역순 공명 3/3 · 불협 ' + discords + '회 · 완료', expectedDiscords: discords, ...patch });
  test('정상 완주(불협 0·2)는 모든 acceptance 가 true 다', () => {
    for (const discords of [0, 2]) {
      const result = analyzeBells(obs(discords), DEF);
      expect(result.acceptance).toEqual({ phaseOrderValid: true, reachedDone: true, litAllBeforeToll: true, tollSequence: true, reverseAnswer: true,
        clearedOnlyAfterDone: true, resultObjective: true, resultLine: true });
      expect(result.ok).toBe(true);
    }
  });
  test('항목 하나가 어긋나면 해당 acceptance 만 false 가 된다', () => {
    expect(analyzeBells(obs(0, { sealT: 1 }), DEF).acceptance.clearedOnlyAfterDone).toBe(false);
    expect(analyzeBells(obs(0, { resultText: '결과' }), DEF).acceptance.resultLine).toBe(false);
    expect(analyzeBells(obs(0, { expectedDiscords: 1 }), DEF).ok).toBe(false);
    expect(analyzeBells(obs(0, { log: [ctl(1, 'wake', 'answer')] }), DEF).acceptance.phaseOrderValid).toBe(false);
    const early = obs(0).clears.map((c: any, i: number) => i === 0 ? { ...c, t: c.t - 5 } : c);
    expect(analyzeBells(obs(0, { clears: early }), DEF).acceptance.clearedOnlyAfterDone).toBe(false);
    const noLit = session(0).log.filter((e: any) => !(e.kind === 'gate' && e.to === 'lit'));
    expect(analyzeBells(obs(0, { log: noLit }), DEF).acceptance.litAllBeforeToll).toBe(false);
  });
});

describe('측정 보조', () => {
  test('percentile·stepStats 는 p50/p95/max 와 50ms 초과 개수를 낸다', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, .5)).toBe(51);
    expect(percentile([], .5)).toBeNull();
    expect(stepStats(values)).toEqual({ n: 100, p50: 51, p95: 96, max: 100, over: 50 });
    expect(stepStats([1, 2, 3]).over).toBe(0);
    expect(stepStats([]).max).toBeNull();
  });
  test('drawCallIncrease 는 짝이 있는 표본의 증가가 모두 12 이하일 때만 합격한다', () => {
    const base = [{ label: 'enter:room2', calls: 100 }, { label: 'enter:room3', calls: 110 }, { label: 'enter:room8', calls: 200 }];
    const cand = [{ label: 'enter:room2', calls: 108, room: 2 }, { label: 'enter:room3', calls: 122, room: 3 }];
    expect(drawCallIncrease(cand, base).ok).toBe(true);
    expect(drawCallIncrease([{ label: 'enter:room2', calls: 113, room: 2 }], base).ok).toBe(false);
    // firstDark 는 같은 후보 실행의 그 방 첫 진입과 비교한다(기준선 최댓값 200 과 비교하지 않는다).
    expect(drawCallIncrease([...cand, { label: 'firstDark', calls: 134, room: 3 }], base).ok).toBe(true);
    expect(drawCallIncrease([...cand, { label: 'firstDark', calls: 135, room: 3 }], base).ok).toBe(false);
    // 짝이 없으면 실패한다: 후보 실행에 그 방 첫 진입이 없거나 기준선에 같은 라벨이 없을 때.
    expect(drawCallIncrease([...cand, { label: 'firstDark', calls: 100, room: 5 }], base).ok).toBe(false);
    expect(drawCallIncrease([{ label: 'enter:room5', calls: 90, room: 5 }], base).ok).toBe(false);
    expect(drawCallIncrease([], base).ok).toBe(false);
  });
  test('compareToBaseline 은 완주 시간 2배 이하와 draw call 판정을 함께 요구하고, 종문 구간 50ms 초과를 따로 센다', () => {
    const base = { time: 100, samples: [{ label: 'enter:room2', calls: 100 }], slow: [{ t: 0, ms: 3000, phase: null }] };
    const cand = { time: 150, samples: [{ label: 'enter:room2', calls: 105, room: 2 }],
      slow: [{ t: 0, ms: 4000, phase: 'wake' }, { t: 50, ms: 60, phase: 'answer' }] };
    const result = compareToBaseline(cand, base);
    expect(result.ok).toBe(true);
    expect(result.over50).toMatchObject({ cand: 2, base: 1, featureWindow: 1 });
    expect(compareToBaseline({ ...cand, time: 201 }, base).ok).toBe(false);
    expect(compareToBaseline({ ...cand, samples: [{ label: 'enter:room2', calls: 113, room: 2 }] }, base).ok).toBe(false);
    expect(compareToBaseline(cand, { ...base, time: 0 }).ok).toBe(false);
    // 전체 스텝 ms 배열이 있으면 잘린 slow 목록 대신 그것으로 센다.
    expect(compareToBaseline({ ...cand, stepMs: [1, 51, 70], renderMs: [80] }, base).over50.cand).toBe(3);
  });
});
// ---------- BUNDLE-05 합창 장막(counter) 판정 ----------
const CDEF: any = ROUTE_OBJECTIVES.bellfall_deep.counter;
const SIG: string = CDEF.signature;
const LAST = 3.05; // bell_toll 의 마지막 고리(1.35 + 2 × 0.85)
const ATTACK_ROWS = Math.ceil((LAST + 1.05) / FRAME);
const TRIGGER_ROW = Math.ceil(LAST / FRAME - 1e-9);
const WINDOW_STEPS = Math.round(CDEF.window / FRAME);

/**
 * counter 계약(PLAN 3.1)대로 움직이는 보스 관측 행을 만든다: 등장 연출 → 장막 → 조종 개시 → 마지막 고리(트리거) 다음 행에서 열림 → window 뒤 장막 → … → 처치 → ended 4행.
 * 컨트롤러는 enemies update 앞에서 돌기 때문에 열린 행은 트리거 행의 다음 행이다(openAfter = 1).
 */
function fightTrace(opts: { windows?: number; openAfter?: number; windowSteps?: number; neverOpen?: boolean; signature?: string; startWindowLeft?: number } = {}) {
  const { windows = 2, openAfter = 1, windowSteps = WINDOW_STEPS, neverOpen = false, signature = SIG, startWindowLeft = CDEF.window } = opts;
  const rows: any[] = [];
  let wins = 0, seq = 0;
  const push = (over: any) => rows.push({ n: rows.length + 1, t: 10 + rows.length * FRAME, hp: 1000, alive: true, spn: false, seq, st: 'chase', sp: null, plan: null, age: null, last: null,
    cs: 'veiled', wl: 0, wins, brk: 0, vh: 0, oh: 0, vd: 0, od: 0, mul: CDEF.veil, ...over });
  for (let i = 0; i < 30; i++) push({ spn: true, st: 'spawn', cs: 'idle', mul: 1 });
  for (let w = 0; w < windows; w++) {
    for (let i = 0; i < 30; i++) push({});
    seq++;
    const openStart = TRIGGER_ROW + openAfter;
    for (let i = 0; i < openStart + windowSteps + 30; i++) {
      const attacking = i < ATTACK_ROWS, inWindow = !neverOpen && i >= openStart && i < openStart + windowSteps;
      if (!neverOpen && i === openStart) wins++;
      push({ seq, st: attacking ? 'attack' : 'chase', sp: attacking ? signature : null, plan: attacking ? signature : null, age: attacking ? i * FRAME : null, last: attacking ? LAST : null,
        cs: inWindow ? 'open' : 'veiled', wl: inWindow ? (i === openStart ? startWindowLeft : CDEF.window - (i - openStart) * FRAME) : 0, wins, mul: inWindow ? CDEF.open : CDEF.veil });
    }
  }
  push({ alive: false, hp: 0, st: 'dead' });
  for (let i = 0; i < 4; i++) push({ alive: false, hp: 0, st: 'dead', cs: 'ended', mul: 1 });
  return rows;
}
const clone = (rows: any[]) => rows.map(r => ({ ...r }));
const resultLineText = (windows: number) => '종문 역순 공명 3/3 · 불협 0회 · 반격 창 ' + windows + '회 · 완료';
const analyze = (rows: any[], windows = 2, over: any = {}) => analyzeCounter({ trace: rows, result: { counterWindows: windows }, resultText: resultLineText(windows), finalCounter: { state: 'ended' }, ...over }, CDEF);
const failed = (a: any) => Object.entries(a.acceptance).filter(([, ok]) => !ok).map(([name]) => name);

describe('보스 반격 창 판정(analyzeCounter)', () => {
  test('계약대로 움직이는 2창 보스전은 모든 acceptance 가 true 다', () => {
    const a = analyze(fightTrace());
    expect(failed(a)).toEqual([]);
    expect(a.ok).toBe(true);
    expect(a.observedWindows).toBe(2);
    expect(a.fullWindows).toBe(2);
    expect(a.windows.every((w: any) => w.delaySteps === 1 && w.lengthOk === true)).toBe(true);
    expect(a.summary.defeated).toBe(true);
    expect(a.post.states).toEqual(['ended']);
  });
  test('트리거 행과 같은 행·다음 행에서 열리면 합격하고 3스텝 늦게 열리면 실패한다', () => {
    expect(failed(analyze(fightTrace({ openAfter: 0 })))).toEqual([]);
    expect(failed(analyze(fightTrace({ openAfter: 1 })))).toEqual([]);
    const late = analyze(fightTrace({ openAfter: 3 }));
    expect(failed(late)).toEqual(['openTiming']);
    expect(late.windows[0].reasons).toContain('late-open');
  });
  test('마지막 고리 전에 열리면 실패한다(noEarlyOpen)', () => {
    const early = analyze(fightTrace({ openAfter: -5 }));
    expect(failed(early)).toContain('noEarlyOpen');
    expect(early.windows[0].cause).toBe('before-last-strike');
  });
  test('bell_toll 이 아닌 시그니처에서 열리면 실패한다', () => {
    const wrong = analyze(fightTrace({ signature: 'bell_clap' }));
    expect(failed(wrong)).toContain('noEarlyOpen');
    expect(wrong.windows[0].cause).toBe('wrong-signature');
  });
  test('창 길이가 window ± 1/60 를 벗어나면 실패하고 경계(± 1스텝)는 합격한다', () => {
    expect(failed(analyze(fightTrace({ windowSteps: WINDOW_STEPS + 1 })))).toEqual([]);
    expect(failed(analyze(fightTrace({ windowSteps: WINDOW_STEPS - 1 })))).toEqual([]);
    for (const steps of [WINDOW_STEPS - 10, WINDOW_STEPS + 3, WINDOW_STEPS + 30]) {
      const a = analyze(fightTrace({ windowSteps: steps }));
      expect(failed(a)).toEqual(['windowLength']);
      expect(a.windows[0].lengthOk).toBe(false);
    }
  });
  test('열린 직후 windowLeft 가 window 가 아니거나 창 중 windowLeft 가 늘면 실패한다', () => {
    expect(failed(analyze(fightTrace({ startWindowLeft: CDEF.window - 0.5 })))).toEqual(['windowLength']);
    const rows = clone(fightTrace({ windows: 1 }));
    const open = rows.findIndex(r => r.cs === 'open');
    rows[open + 20].wl += 0.5;
    expect(failed(analyze(rows, 1))).toEqual(['windowLength']);
  });
  test('창 동안 attackSequence 가 늘면 실패한다', () => {
    const rows = clone(fightTrace({ windows: 1 }));
    const open = rows.findIndex(r => r.cs === 'open');
    for (let i = open + 50; i < rows.length; i++) if (rows[i].cs === 'open') rows[i].seq += 1;
    const a = analyze(rows, 1);
    expect(failed(a)).toContain('noNewAttack');
  });
  test('한 조종(attackSequence)에 창이 두 번 열리면 실패한다', () => {
    const rows = clone(fightTrace({ windows: 2 }));
    for (const r of rows) if (r.seq === 2) r.seq = 1;
    expect(failed(analyze(rows))).toContain('openTiming');
  });
  test('트리거가 지나도 열리지 않으면 실패한다(창 0회, 누락)', () => {
    const a = analyze(fightTrace({ neverOpen: true }), 0);
    expect(failed(a)).toEqual(['windowCount', 'noMissedOpen']);
    expect(a.missed.length).toBe(2);
  });
  test('조종이 마지막 고리 전에 끊기면 창이 안 열려도 누락이 아니다', () => {
    const rows = clone(fightTrace({ windows: 1 }));
    const broken = rows.map(r => ({ ...r, cs: r.cs === 'open' ? 'veiled' : r.cs, wl: 0, wins: 0, mul: r.cs === 'ended' ? 1 : r.cs === 'idle' ? 1 : CDEF.veil }));
    // 조종을 lastStrike 직전(2초)에 끊는다: attack 행을 chase 로 바꾼다.
    for (const r of broken) if (r.st === 'attack' && r.age >= 2) { r.st = 'chase'; r.sp = null; r.plan = null; r.age = null; r.last = null; }
    expect(missedOpens(broken, CDEF)).toEqual([]);
    expect(checkWindows(broken, CDEF)).toEqual([]);
  });
  test('veiled 행의 damageMul 이 veil 이 아니거나 open 행이 open 이 아니면 실패한다', () => {
    const veil = clone(fightTrace()); veil.find(r => r.cs === 'veiled' && r.st === 'chase' && !r.spn).mul = 1;
    expect(failed(analyze(veil))).toEqual(['damageMultiplier']);
    const open = clone(fightTrace()); open.find(r => r.cs === 'open').mul = CDEF.veil;
    expect(failed(analyze(open))).toEqual(['damageMultiplier']);
    const ended = clone(fightTrace()); ended.at(-1).mul = CDEF.veil;
    expect(checkDamageMultiplier(ended, CDEF).ok).toBe(false);
  });
  test('보스 처치 뒤 counter 가 ended 가 아니거나 처치 뒤 행이 없으면 실패한다', () => {
    const notEnded = clone(fightTrace()); notEnded.at(-1).cs = 'veiled';
    expect(failed(analyze(notEnded))).toContain('endedAfterDefeat');
    const noPost = fightTrace().slice(0, -4);
    expect(failed(analyze(noPost))).toContain('endedAfterDefeat');
    expect(failed(analyze(fightTrace(), 2, { finalCounter: { state: 'veiled' } }))).toEqual(['endedAfterDefeat']);
    expect(failed(analyze(fightTrace(), 2, { finalCounter: null }))).toEqual([]);
  });
  test('처치로 잘린 창은 길이를 보지 않고 fullWindows 에 세지 않는다', () => {
    const full = fightTrace({ windows: 1 });
    const open = full.findIndex(r => r.cs === 'open');
    const rows = clone(full.slice(0, open + 50));
    rows.push({ ...rows.at(-1), n: 0, t: rows.at(-1).t + FRAME, alive: false, hp: 0, st: 'dead' });
    for (let i = 0; i < 4; i++) rows.push({ ...rows.at(-1), t: rows.at(-1).t + FRAME, cs: 'ended', wl: 0, mul: 1 });
    const a = analyze(rows, 1);
    expect(failed(a)).toEqual([]);
    expect(a.windows[0].truncated).toBe(true);
    expect(a.windows[0].lengthOk).toBe(null);
    expect(a.fullWindows).toBe(0);
  });
  test('보스가 살아 있는데 창이 veiled 가 아닌 상태로 닫히면 실패한다', () => {
    const rows = clone(fightTrace({ windows: 1 }));
    const last = rows.map((r, i) => r.cs === 'open' ? i : -1).filter(i => i >= 0).at(-1) as number;
    rows[last + 1].cs = 'idle';
    expect(failed(analyze(rows, 1))).toContain('windowLength');
  });
  test('windows/hits/damage 가 줄거나 windows 가 한 스텝에 2 이상 늘면 실패한다', () => {
    const shrink = clone(fightTrace()); shrink.at(-6).oh = 5; shrink.at(-5).oh = 3;
    expect(checkCounterStats(shrink).ok).toBe(false);
    const jump = clone(fightTrace()); jump.find(r => r.wins === 1).wins = 2;
    expect(checkCounterStats(jump).ok).toBe(false);
    expect(failed(analyze(jump))).toContain('counterStats');
    expect(checkCounterStats(fightTrace()).windows).toBe(2);
  });
  test('counter.windows 와 관측한 창 수가 다르면 실패한다', () => {
    const rows = clone(fightTrace());
    for (const r of rows) if (r.cs !== 'idle') r.wins += 1;
    expect(failed(analyze(rows))).toContain('windowsConsistent');
  });
  test('결과 counterWindows 가 관측과 다르거나 결과 줄에 반격 창 w회가 없으면 실패한다', () => {
    expect(failed(analyze(fightTrace(), 2, { result: { counterWindows: 3 } }))).toEqual(['resultWindows']);
    expect(failed(analyze(fightTrace(), 2, { result: {} }))).toEqual(['resultWindows']);
    expect(failed(analyze(fightTrace(), 2, { result: { counterWindows: '2' } }))).toEqual(['resultWindows']);
    expect(failed(analyze(fightTrace(), 2, { resultText: '종문 역순 공명 3/3 · 불협 0회 · 완료' }))).toEqual(['resultLine']);
    expect(failed(analyze(fightTrace(), 2, { resultText: resultLineText(3) }))).toEqual(['resultLine']);
    expect(failed(analyze(fightTrace(), 2, { resultText: resultLineText(2) + ' ' + resultLineText(2) }))).toEqual(['resultLine']);
  });
  test('보스를 관측하지 못했거나 처치하지 못하면 bossObserved 가 실패한다', () => {
    expect(failed(analyze([], 0)).includes('bossObserved')).toBe(true);
    const alive = fightTrace().filter(r => r.alive);
    expect(failed(analyze(alive)).includes('bossObserved')).toBe(true);
  });
  test('isTrigger / openRuns 는 마지막 고리 조건과 열린 구간을 정확히 잘라낸다', () => {
    const row = { st: 'attack', sp: SIG, plan: SIG, age: LAST, last: LAST };
    expect(isTrigger(row, CDEF)).toBe(true);
    expect(isTrigger({ ...row, age: LAST - 0.01 }, CDEF)).toBe(false);
    expect(isTrigger({ ...row, sp: 'bell_clap' }, CDEF)).toBe(false);
    expect(isTrigger({ ...row, plan: null }, CDEF)).toBe(false);
    expect(isTrigger({ ...row, st: 'chase' }, CDEF)).toBe(false);
    const runs = openRuns(fightTrace());
    expect(runs.length).toBe(2);
    expect(runs.every((run: any) => run.endIdx - run.startIdx + 1 === WINDOW_STEPS && run.closedBy === 'veiled')).toBe(true);
  });
});

describe('보스 요약·목표창·일시정지', () => {
  test('summarizeBoss 는 등장·연출 끝·처치 시각과 보스전 길이를 낸다', () => {
    const rows = fightTrace({ windows: 1 });
    const s = summarizeBoss(rows);
    expect(s.appearT).toBe(rows[0].t);
    expect(s.readyT).toBe(rows[30].t);
    expect(s.defeated).toBe(true);
    expect(s.fightSeconds).toBeCloseTo(rows[s.defeatIdx].t - rows[0].t, 9);
    expect(summarizeBoss([]).observed).toBe(false);
    expect(summarizeBoss(rows.filter(r => r.alive)).defeated).toBe(false);
  });
  test('기준선 빌드(cs 없음) 행도 보스 요약이 나온다', () => {
    const base = fightTrace({ windows: 1 }).map(r => ({ ...r, cs: null, wl: null, wins: null, mul: null }));
    expect(summarizeBoss(base).fightSeconds).toBeGreaterThan(0);
    expect(checkDamageMultiplier(base, CDEF).ok).toBe(true);
  });
  test('veiled 목표창은 제목·문구·받는 피해 70% 감소가 있고 반격 창 숫자가 없어야 한다', () => {
    const text = '합창 장막 마지막 울림 직후에만 장막이 걷힘 · 받는 피해 ' + Math.round((1 - CDEF.veil) * 100) + '% 감소';
    const read = (t: string) => ({ dom: { text: t }, counter: { state: 'veiled', windowLeft: 0, windowTotal: CDEF.window } });
    expect(checkCounterObjective(read(text), CDEF).ok).toBe(true);
    expect(checkCounterObjective(read('종문 역순 공명 3/3'), CDEF).ok).toBe(false);
    expect(checkCounterObjective(read(text.replace('70%', '30%')), CDEF).ok).toBe(false);
    expect(checkCounterObjective(read(text + ' 반격 창 3.5초'), CDEF).ok).toBe(false);
  });
  test('open 목표창은 반격 창 n.n초가 windowLeft 와 맞고 받는 피해 130% 가 있어야 한다', () => {
    const read = (t: string, windowLeft: number, state = 'open') => ({ dom: { text: t }, counter: { state, windowLeft, windowTotal: CDEF.window } });
    const text = (sec: string) => '합창 장막 반격 창 ' + sec + '초 · 받는 피해 ' + Math.round(CDEF.open * 100) + '%';
    expect(checkCounterObjective(read(text('3.5'), 3.5), CDEF).ok).toBe(true);
    expect(checkCounterObjective(read(text('2.4'), 2.31), CDEF).ok).toBe(true); // 올림 + 10Hz 갱신 지연
    expect(checkCounterObjective(read(text('3.5'), 1.2), CDEF).ok).toBe(false); // 너무 오래된 값
    expect(checkCounterObjective(read(text('1.0'), 2.0), CDEF).ok).toBe(false); // 현재 값보다 작음
    expect(checkCounterObjective(read(text('4.0'), 3.9), CDEF).ok).toBe(false); // 창 길이보다 큼
    expect(checkCounterObjective(read('합창 장막 반격 창 3초 · 받는 피해 130%', 3), CDEF).ok).toBe(false); // n.n 형식 아님
    expect(checkCounterObjective(read(text('3.5').replace('130%', '100%'), 3.5), CDEF).ok).toBe(false);
    expect(checkCounterObjective(read('마지막 울림 직후에만 장막이 걷힘', 3.5), CDEF).ok).toBe(false);
    expect(checkCounterObjective(read(text('3.5'), 0, 'idle'), CDEF).ok).toBe(false);
  });
  test('반격 창 중 일시정지: 정지 중 값이 같고 재개 뒤 게임 시간만큼만 줄면 합격한다', () => {
    const snap = (elapsed: number, windowLeft: number, state = 'open') => ({ elapsed, counter: { state, windowLeft, windows: 1 }, boss: { seq: 4 } });
    const before = snap(50, 3.0), paused = snap(50, 3.0), still = snap(50, 3.0);
    expect(checkCounterPause({ before, paused, still, resumed: snap(51, 2.0), steps: 60 }).ok).toBe(true);
    // 슬로모션으로 60스텝 동안 게임 시간이 0.5초만 흘러도 windowLeft 가 그만큼 줄었으면 합격
    expect(checkCounterPause({ before, paused, still, resumed: snap(50.5, 2.5), steps: 60 }).ok).toBe(true);
    // 정지 중에 줄어든 경우
    expect(checkCounterPause({ before, paused, still: snap(50, 2.9), resumed: snap(51, 1.9), steps: 60 }).ok).toBe(false);
    expect(checkCounterPause({ before, paused: snap(50, 2.99), still, resumed: snap(51, 2.0), steps: 60 }).ok).toBe(false);
    // 재개 뒤 windowLeft 가 게임 시간과 다르게 줄었거나(정지 시간 반영) 창이 닫힘
    expect(checkCounterPause({ before, paused, still, resumed: snap(51, 0.5), steps: 60 }).ok).toBe(false);
    expect(checkCounterPause({ before, paused, still, resumed: snap(51, 2.0, 'veiled'), steps: 60 }).ok).toBe(false);
    // 재개 뒤 시간이 흐르지 않음 / 60스텝보다 훨씬 많이 흐름
    expect(checkCounterPause({ before, paused, still, resumed: snap(50, 3.0), steps: 60 }).ok).toBe(false);
    expect(checkCounterPause({ before, paused, still, resumed: snap(53, 0.0), steps: 60 }).ok).toBe(false);
    // 일시정지 중 새 attackSequence
    expect(checkCounterPause({ before, paused, still, resumed: { ...snap(51, 2.0), boss: { seq: 5 } }, steps: 60 }).ok).toBe(false);
  });
});

describe('기준선 비교(compareBoss)', () => {
  const sample = (calls: number, label = 'bossEnter') => ({ label, calls, room: 6 });
  const run = (over: any = {}) => ({ fight: 60, time: 300, samples: [sample(100)], bossOver50: 2, ...over });
  test('보스전 2.0배·완주 2.0배·draw call +3·50ms 기준선 +2 는 경계에서 합격한다', () => {
    const r = compareBoss(run({ fight: 120, time: 600, samples: [sample(103)], bossOver50: 4 }), run());
    expect(r.ok).toBe(true);
    expect(r.fight.ratio).toBe(2);
    expect(r.draw.max).toBe(3);
  });
  test('보스전 시간 비가 2.0 을 넘으면 실패한다', () => {
    const r = compareBoss(run({ fight: 121 }), run());
    expect(r.ok).toBe(false);
    expect(r.fight.ok).toBe(false);
    expect(r.time.ok).toBe(true);
  });
  test('완주 시간 비가 2.0 을 넘으면 실패한다', () => {
    const r = compareBoss(run({ time: 601 }), run());
    expect(r.ok).toBe(false);
    expect(r.time.ok).toBe(false);
  });
  test('보스방 첫 진입 draw call 이 4 늘면 실패하고 짝이 없으면 실패한다', () => {
    expect(compareBoss(run({ samples: [sample(104)] }), run()).draw.ok).toBe(false);
    const noPair = compareBoss(run({ samples: [sample(100, 'bossReady')] }), run());
    expect(noPair.draw.ok).toBe(false);
    expect(noPair.ok).toBe(false);
    expect(compareBoss(run({ samples: [] }), run()).ok).toBe(false);
    expect(compareBoss(run(), run({ samples: [] })).ok).toBe(false);
    // 다른 라벨의 표본은 짝 판정에 끼지 않는다.
    expect(compareBoss(run({ samples: [sample(103), sample(999, 'counterOpen'), sample(5, 'firstDark')] }), run({ samples: [sample(100), sample(1, 'bossReady')] })).draw.ok).toBe(true);
  });
  test('보스 구간 50ms 초과가 기준선 + 2 를 넘으면 실패하고 값이 없으면 실패한다', () => {
    expect(compareBoss(run({ bossOver50: 5 }), run()).slow.ok).toBe(false);
    expect(compareBoss(run({ bossOver50: 4 }), run()).slow.ok).toBe(true);
    expect(compareBoss(run({ bossOver50: null }), run()).ok).toBe(false);
    expect(compareBoss(run(), run({ bossOver50: null })).ok).toBe(false);
  });
  test('시간이 없는 실행(미완주)은 비율이 null 이라 실패한다', () => {
    expect(compareBoss(run({ fight: null }), run()).ok).toBe(false);
    expect(compareBoss(run(), run({ time: null })).ok).toBe(false);
  });
});

describe('결과 줄(반격 창)', () => {
  const ro = { progress: 3, target: 3, discords: 1, complete: true, counterWindows: 2 };
  test('counterWindows 가 숫자면 불협 뒤·완료 앞에 반격 창 w회가 붙어야 한다', () => {
    expect(checkResultLine('종문 역순 공명 3/3 · 불협 1회 · 반격 창 2회 · 완료', ro).ok).toBe(true);
    expect(checkResultLine('종문 역순 공명 3/3 · 불협 1회 · 완료', ro).ok).toBe(false);
    expect(checkResultLine('종문 역순 공명 3/3 · 불협 1회 · 완료 · 반격 창 2회', ro).ok).toBe(false);
    expect(checkResultLine('종문 역순 공명 3/3 · 불협 1회 · 반격 창 0회 · 완료', { ...ro, counterWindows: 0 }).ok).toBe(true);
  });
  test('counterWindows 가 없는 기준선 결과는 기존 줄 그대로 합격한다', () => {
    const { counterWindows, ...old } = ro;
    expect(checkResultLine('종문 역순 공명 3/3 · 불협 1회 · 완료', old).ok).toBe(true);
  });
});
