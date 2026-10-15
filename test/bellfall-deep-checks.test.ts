import { describe, expect, test } from 'bun:test';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';
import { ALLOWED, FRAME, analyzeBells, buildAttempts, buildReplays, checkAnswerOrder, checkClears, checkDiscord, checkGuideText, checkPhaseTimeline,
  checkReplay, checkReplays, checkResult, checkResultLine, discordEvents, drawCallIncrease, percentile, reverseOrder, stepStats } from '../tools/bellfall-deep-checks.mjs';

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
  const good: any = { discords: 1, discordsBefore: 0, hpBefore: 1000, hpAfter: 1000 - 1000 * DEF.discord.damage, maxHp: 1000, prevHold: DEF.holdSeconds - FRAME,
    wrongRoom: DEF.tollOrder[0], expectedRoom: ANSWER[0], phaseAfter: 'toll', progressAfter: 0, gatesAfter: DEF.gates.map(() => 'lit') };
  test('정답 외 종에서 2초를 채우면 피해 6%·toll·progress 0·모든 종 lit 로 합격한다', () => {
    const result = checkDiscord(good, DEF);
    expect(result.ok).toBe(true);
    expect(result.ratio).toBeCloseTo(DEF.discord.damage, 6);
  });
  test('피해 비율·유지 시간·단계·초기화 중 하나라도 어긋나면 실패한다', () => {
    expect(checkDiscord({ ...good, hpAfter: 1000 }, DEF).damageOk).toBe(false);
    expect(checkDiscord({ ...good, hpAfter: 1000 - 300 }, DEF).damageOk).toBe(false);
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
  test('drawCallIncrease 는 같은 라벨 증가가 12 이하일 때만 합격한다', () => {
    const base = [{ label: 'enter:room 2', calls: 100 }, { label: 'enter:room 3', calls: 110 }];
    expect(drawCallIncrease([{ label: 'enter:room 2', calls: 108 }, { label: 'enter:room 3', calls: 122 }], base).ok).toBe(true);
    expect(drawCallIncrease([{ label: 'enter:room 2', calls: 113 }], base).ok).toBe(false);
    expect(drawCallIncrease([{ label: 'firstDark', calls: 120 }], base).ok).toBe(true);
    expect(drawCallIncrease([{ label: 'firstDark', calls: 123 }], base).ok).toBe(false);
    expect(drawCallIncrease([], base).ok).toBe(false);
  });
});
