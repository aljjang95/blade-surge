import { expect, test } from 'bun:test';
import { GOAL_METRICS, comparableRunContext, normalizePersonalGoal, summarizePersonalRuns, personalGoalTarget, choosePersonalGoal, capturePersonalGoal, evaluatePersonalGoal } from '../src/game/run-personal-goals.js';

const campaign = (difficultyId: unknown = 'story', id = '1-1') => ({ kind: 'campaign', id, difficultyId });
const dungeon = (id = 'glass_garden', depth = 'standard', conquestId: unknown = null, riftId: unknown = null) => ({ kind: 'dungeon', id, depth, conquestId, riftId });
const details = (overrides: Record<string, unknown> = {}) => ({ route: campaign(), heroId: 'knight', heroLevel: 3, control: 'manual', timeSec: 12.5, perfects: 2, breaks: 1, ...overrides });
const run = (runId: unknown, overrides: Record<string, unknown> = {}) => ({ runId, outcome: 'victory', floor: 1, boonIds: [], details: details(), ...overrides });
const context = () => comparableRunContext(details())!;
const error = { ok: false, error: '비교할 수 있는 출격 기록을 확인해 주세요.' };

test('metric catalog and comparable contexts retain only authored, observed departure conditions', () => {
  expect(GOAL_METRICS).toEqual([{ id: 'time', label: '시간 단축' }, { id: 'perfects', label: '정확 회피' }, { id: 'breaks', label: '균형 붕괴' }]);
  expect(Object.isFrozen(GOAL_METRICS)).toBe(true);
  for (const metric of GOAL_METRICS) expect(Object.isFrozen(metric)).toBe(true);
  const raw = details({ displayName: '<script>', reward: 999999, timeSec: Infinity });
  expect<unknown>(comparableRunContext(raw)).toEqual({ route: campaign(), heroId: 'knight', heroLevel: 3, control: 'manual' });
  expect(comparableRunContext(context())).toEqual(context());
  for (const control of ['manual', 'auto', 'mixed']) expect(comparableRunContext(details({ control }))?.control).toBe(control);
  for (const value of [null, [], {}, details({ route: null }), details({ route: campaign(null) }), details({ route: campaign('__proto__') }),
    details({ route: campaign('story', '01-1') }), details({ route: { kind: 'arena', id: 'rookie' } }),
    details({ heroId: '__proto__' }), details({ heroLevel: 0 }), details({ heroLevel: 81 }), details({ heroLevel: '3' }),
    details({ control: 'unknown' }), details({ control: true })]) expect(comparableRunContext(value)).toBeNull();
});

test('personal goal migration rejects malicious identities and never copies arbitrary saved fields', () => {
  const raw = { context: details({ route: { ...campaign(), name: '<img onerror=alert(1)>' } }), metric: 'perfects', target: -999, reward: 1000000, runId: 6 };
  const before = JSON.stringify(raw);
  expect(normalizePersonalGoal(raw)).toEqual({ context: context(), metric: 'perfects' });
  expect(JSON.stringify(raw)).toBe(before);
  const normalized = normalizePersonalGoal(raw)!;
  raw.context.route.difficultyId = 'nightmare';
  expect<unknown>(normalized.context.route).toEqual(campaign());
  for (const value of [undefined, null, [], {}, { context: context(), metric: '__proto__' }, { context: context(), metric: 'toString' },
    { context: context(), metric: ['time'] }, { context: details({ control: 'unknown' }), metric: 'time' },
    { context: details({ route: campaign(null) }), metric: 'time' }]) expect(normalizePersonalGoal(value)).toBeNull();
});

test('best values use complete same-condition victories, preserve zeroes and never use a fast defeat', () => {
  const history = [run(1, { details: details({ timeSec: 9.876, perfects: 0, breaks: 0 }) }),
    run(2, { details: details({ timeSec: 12, perfects: 5, breaks: 2 }) }),
    run(3, { outcome: 'defeat', details: details({ timeSec: 0, perfects: 999, breaks: 999 }) })];
  const before = JSON.stringify(history);
  expect(summarizePersonalRuns(history, context())).toEqual({ context: context(), count: 2, best: { timeSec: 9.876, perfects: 5, breaks: 2 }, runIds: [1, 2] });
  expect(JSON.stringify(history)).toBe(before);
  expect(summarizePersonalRuns([run(4, { details: details({ timeSec: 0, perfects: 0, breaks: 0 }) })], context()).best).toEqual({ timeSec: 0, perfects: 0, breaks: 0 });
  expect(summarizePersonalRuns([history[2]], context())).toEqual({ context: context(), count: 0, best: null, runIds: [] });
  expect(summarizePersonalRuns(history, null)).toEqual({ context: null, count: 0, best: null, runIds: [] });
});

test('campaign difficulty, destination, hero, departure level and control each establish a separate comparison', () => {
  const changed = [details({ route: campaign('adept') }), details({ route: campaign('story', '1-2') }), details({ route: dungeon() }),
    details({ heroId: 'mage' }), details({ heroLevel: 4 }), details({ control: 'auto' }), details({ control: 'mixed' })];
  const history = [run(1), ...changed.map((value, index) => run(index + 2, { details: value }))];
  expect(summarizePersonalRuns(history, context()).runIds).toEqual([1]);
  for (const [index, value] of changed.entries()) expect(summarizePersonalRuns(history, comparableRunContext(value)).runIds).toEqual([index + 2]);
});

test('basic, deep, conquest, rift and same-floor destinations remain independent', () => {
  const routes = [dungeon(), dungeon('bellfall_crypt'), dungeon('glass_garden', 'deep'),
    dungeon('glass_garden', 'deep', 'garden_dawn'), dungeon('glass_garden', 'deep', 'garden_dusk'),
    dungeon('glass_garden', 'standard', null, 'iron'), dungeon('glass_garden', 'standard', null, 'fury')];
  const history = routes.map((route, index) => run(index + 1, { details: details({ route }) }));
  for (const [index, route] of routes.entries()) {
    const selected = comparableRunContext(details({ route }));
    expect(selected).not.toBeNull();
    expect(summarizePersonalRuns(history, selected).runIds).toEqual([index + 1]);
  }
  for (const route of [dungeon('glass_garden', 'standard', 'garden_dawn'), dungeon('ember_vault', 'deep', 'garden_dawn'),
    dungeon('glass_garden', 'deep', null, 'iron'), dungeon('glass_garden', 'standard', null, '__proto__')]) expect(comparableRunContext(details({ route }))).toBeNull();
});

test('legacy or incomplete observations cannot compete through an invented zero or partial metric', () => {
  const invalid = [null, {}, details({ route: campaign(null) }), details({ heroId: null }), details({ heroLevel: null }), details({ control: 'unknown' }),
    ...[undefined, null, NaN, Infinity, -1, '2', 1000001, 1.5].map(perfects => details({ perfects })),
    ...[undefined, null, NaN, Infinity, -1, '2', 1000001, 1.5].map(breaks => details({ breaks })),
    ...[undefined, null, NaN, Infinity, -1, '2', 86400.01].map(timeSec => details({ timeSec }))];
  const history = invalid.map((value, index) => run(index + 1, { details: value }));
  expect(summarizePersonalRuns(history, context())).toEqual({ context: context(), count: 0, best: null, runIds: [] });
  for (const [index, value] of invalid.entries()) {
    const state: any = { history: [run(index + 1, { details: value })], personalGoal: null };
    expect(choosePersonalGoal(state, index + 1, 'time')).toEqual(error);
    expect(state.personalGoal).toBeNull();
  }
});

test('the original last twenty terminal entries bound comparisons before invalid observations are removed', () => {
  const records = Array.from({ length: 23 }, (_, index) => run(index + 1));
  const pending = Array.from({ length: 30 }, (_, index) => run(100 + index, { outcome: 'running' }));
  const history = [run(4), ...records, ...pending];
  expect(summarizePersonalRuns(history, context()).runIds).toEqual(Array.from({ length: 20 }, (_, index) => index + 4));
  const state: any = { history, personalGoal: null };
  expect(choosePersonalGoal(state, 3, 'time')).toEqual(error);
  expect(choosePersonalGoal(state, 4, 'time')).toEqual({ ok: true });
  const hiddenOldWin = [run(1), ...Array.from({ length: 20 }, (_, index) => run(index + 2, { details: null }))];
  expect(summarizePersonalRuns(hiddenOldWin, context()).count).toBe(0);
  expect(choosePersonalGoal({ history: hiddenOldWin }, 1, 'time')).toEqual(error);
  for (const history of [undefined, null, {}, 'history']) expect(summarizePersonalRuns(history, context()).count).toBe(0);
});

test('duplicates are excluded together even when the second receipt is a defeat, another context or invalid', () => {
  const history = [run(1), run(1), run(2), run(2, { outcome: 'defeat' }), run(3), run(3, { details: details({ control: 'auto' }) }),
    run(4), run(4, { details: null }), run(5)];
  expect(summarizePersonalRuns(history, context()).runIds).toEqual([5]);
  expect(summarizePersonalRuns(history, comparableRunContext(details({ control: 'auto' }))).count).toBe(0);
  for (const runId of [1, 2, 3, 4]) {
    const state: any = { history, personalGoal: { previous: true } }, before = JSON.stringify(state);
    expect(choosePersonalGoal(state, runId, 'breaks')).toEqual(error);
    expect(JSON.stringify(state)).toBe(before);
  }
});

test('only positive safe unique run identities qualify; malformed and nonterminal receipts never qualify', () => {
  const invalid = [0, -1, 1.5, '1', null, undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1];
  const history = [...invalid.map(runId => run(runId)), run(Number.MAX_SAFE_INTEGER), run(2, { outcome: 'running' })];
  expect(summarizePersonalRuns(history, context()).runIds).toEqual([Number.MAX_SAFE_INTEGER]);
  for (const runId of [...invalid, 2]) expect(choosePersonalGoal({ history }, runId, 'time')).toEqual(error);
  expect(choosePersonalGoal({ history }, Number.MAX_SAFE_INTEGER, 'time')).toEqual({ ok: true });
});

test('targets floor one second improvements to two decimal places and stop at observed limits', () => {
  const summary = (timeSec: unknown = 12.5, perfects: unknown = 0, breaks: unknown = 2) => ({ context: context(), count: 1, best: { timeSec, perfects, breaks }, runIds: [1] });
  expect(personalGoalTarget(summary(12.509), 'time')).toEqual({ metric: 'time', baseline: 12.509, target: 11.5 });
  expect(personalGoalTarget(summary(1.14), 'time')).toEqual({ metric: 'time', baseline: 1.14, target: 0.14 });
  expect(personalGoalTarget(summary(1.009999), 'time')?.target).toBe(0);
  expect(personalGoalTarget(summary(111.11), 'time')?.target).toBe(110.11);
  expect(personalGoalTarget(summary(86400), 'time')?.target).toBe(86399);
  for (const baseline of [0.5, 0.001, 1e-8, 1]) expect(personalGoalTarget(summary(baseline), 'time')).toEqual({ metric: 'time', baseline, target: 0 });
  expect(personalGoalTarget(summary(), 'perfects')).toEqual({ metric: 'perfects', baseline: 0, target: 1 });
  expect(personalGoalTarget(summary(), 'breaks')).toEqual({ metric: 'breaks', baseline: 2, target: 3 });
  expect(personalGoalTarget(summary(12.5, 999999), 'perfects')?.target).toBe(1000000);
  for (const baseline of [0, -1, NaN, Infinity, '12', 86400.01]) expect(personalGoalTarget(summary(baseline), 'time')).toBeNull();
  for (const baseline of [-1, NaN, Infinity, 1.5, '2', 1000000, 1000001]) {
    expect(personalGoalTarget(summary(12.5, baseline), 'perfects')).toBeNull();
    expect(personalGoalTarget(summary(12.5, 0, baseline), 'breaks')).toBeNull();
  }
  for (const value of [null, {}, { best: null }]) expect(personalGoalTarget(value, 'time')).toBeNull();
  expect(personalGoalTarget(summary(), '__proto__')).toBeNull();
});

test('choosing a fully observed victory or defeat changes only the goal and does not share the receipt route', () => {
  for (const outcome of ['victory', 'defeat']) {
    const receipt = run(8, { outcome, details: details({ timeSec: 0, perfects: 0, breaks: 0 }) });
    const state: any = { history: [receipt], runSeq: 8, gold: 123, gems: 9, energy: 5, renown: 12, earnedRenown: 12,
      rewards: { paid: true }, personalGoal: null };
    const before = { ...state }, history = state.history, reward = state.rewards, originalHistory = JSON.stringify(state.history);
    expect(choosePersonalGoal(state, 8, 'breaks')).toEqual({ ok: true });
    expect(state).toEqual({ ...before, personalGoal: { context: context(), metric: 'breaks' } });
    expect(state.history).toBe(history); expect(state.rewards).toBe(reward);
    expect(JSON.stringify(state.history)).toBe(originalHistory);
    expect(state.personalGoal.context.route).not.toBe((receipt.details as any).route);
    (receipt.details as any).route.difficultyId = 'nightmare';
    expect(state.personalGoal.context.route).toEqual(campaign());
  }
});

test('failed selections leave the previous goal and every state field intact', () => {
  const state: any = { history: [run(1)], runSeq: 99, gold: 123, personalGoal: { context: context(), metric: 'perfects' } };
  const before = JSON.stringify(state), priorGoal = state.personalGoal;
  for (const [runId, metric] of [[1, '__proto__'], [1, 'unknown'], ['1', 'time'], [2, 'time'], [1, ['time']]]) {
    expect(choosePersonalGoal(state, runId, metric)).toEqual(error);
    expect(JSON.stringify(state)).toBe(before); expect(state.personalGoal).toBe(priorGoal);
  }
  for (const value of [null, [], {}]) expect(choosePersonalGoal(value, 1, 'time')).toEqual(error);
});

test('departure captures a deeply frozen baseline without writing the save or moving it with later records', () => {
  const state: any = { history: [run(1)], personalGoal: { context: context(), metric: 'time' }, gold: 123, runSeq: 1 };
  const before = JSON.stringify(state), receipt = capturePersonalGoal(state)!;
  expect(receipt).toEqual({ context: context(), metric: 'time', baseline: 12.5, target: 11.5 });
  expect(JSON.stringify(state)).toBe(before);
  expect(Object.isFrozen(receipt)).toBe(true); expect(Object.isFrozen(receipt.context)).toBe(true); expect(Object.isFrozen(receipt.context.route)).toBe(true);
  expect(receipt.context).not.toBe(state.personalGoal.context); expect(receipt.context.route).not.toBe(state.personalGoal.context.route);
  state.history.push(run(2, { details: details({ timeSec: 5 }) }));
  state.runSeq = 2;
  expect(capturePersonalGoal(state)).toMatchObject({ baseline: 5, target: 4 });
  expect(evaluatePersonalGoal(receipt, details({ timeSec: 11.5 }), 'victory')).toEqual({ eligible: true, achieved: true, metric: 'time', baseline: 12.5, target: 11.5, value: 11.5 });
  state.personalGoal.context.route.difficultyId = 'nightmare';
  expect(receipt.context.route).toEqual(campaign());
});

test('capturing requires an eligible observed win and an attainable bounded target', () => {
  for (const metric of ['time', 'perfects', 'breaks']) {
    const state: any = { history: [run(1, { outcome: 'defeat' })], personalGoal: { context: context(), metric } };
    expect(capturePersonalGoal(state)).toBeNull();
  }
  for (const [metric, values] of [['time', { timeSec: 0 }], ['perfects', { perfects: 1000000 }], ['breaks', { breaks: 1000000 }]] as const) {
    expect(capturePersonalGoal({ history: [run(1, { details: details(values) })], personalGoal: { context: context(), metric } })).toBeNull();
  }
  for (const value of [null, [], {}, { personalGoal: { context: context(), metric: 'time' } },
    { history: [run(1)], personalGoal: { context: context(), metric: '__proto__' } }]) expect(capturePersonalGoal(value)).toBeNull();
});

test('goal outcomes use the captured metric threshold and observed values without awarding anything', () => {
  const state: any = { history: [run(1)], runSeq: 1, gold: 50, gems: 3, energy: 4, renown: 6, personalGoal: null };
  for (const metric of ['time', 'perfects', 'breaks']) {
    state.personalGoal = { context: context(), metric };
    const receipt = capturePersonalGoal(state)!, before = JSON.stringify(state);
    const atTarget = details({ [metric === 'time' ? 'timeSec' : metric]: receipt.target });
    const result = evaluatePersonalGoal(receipt, atTarget, 'victory')!;
    expect(result).toEqual({ eligible: true, achieved: true, metric, baseline: receipt.baseline, target: receipt.target, value: receipt.target });
    expect(Object.isFrozen(result)).toBe(true);
    const missed = receipt.target + (metric === 'time' ? 0.001 : -1);
    expect(evaluatePersonalGoal(receipt, details({ [metric === 'time' ? 'timeSec' : metric]: missed }), 'victory')).toMatchObject({ eligible: true, achieved: false, value: missed });
    const exceeded = receipt.target + (metric === 'time' ? -0.001 : 1);
    expect(evaluatePersonalGoal(receipt, details({ [metric === 'time' ? 'timeSec' : metric]: exceeded }), 'victory')).toMatchObject({ eligible: true, achieved: true, value: exceeded });
    expect(JSON.stringify(state)).toBe(before);
  }
});

test('different departure conditions, incomplete observations and defeat cannot achieve the captured goal', () => {
  const receipt = capturePersonalGoal({ history: [run(1)], personalGoal: { context: context(), metric: 'perfects' } })!;
  const changed = [details({ route: campaign('nightmare') }), details({ route: campaign('story', '1-2') }), details({ route: dungeon() }),
    details({ heroId: 'mage' }), details({ heroLevel: 4 }), details({ control: 'mixed' }), details({ breaks: null }), details({ timeSec: Infinity }), null];
  for (const value of changed) {
    expect(evaluatePersonalGoal(receipt, value, 'victory')).toEqual({ eligible: false, achieved: false, metric: 'perfects', baseline: 2, target: 3, value: null, reason: 'conditions' });
  }
  const defeat = evaluatePersonalGoal(receipt, details({ perfects: 999 }), 'defeat')!;
  expect(defeat).toEqual({ eligible: false, achieved: false, metric: 'perfects', baseline: 2, target: 3, value: null, reason: 'defeat' });
  expect(Object.isFrozen(defeat)).toBe(true);
  expect(evaluatePersonalGoal(receipt, details(), 'running')).toMatchObject({ reason: 'conditions' });
});

test('receipt validation rejects missing, nonfinite, impossible and inconsistent captured targets', () => {
  const receipt = capturePersonalGoal({ history: [run(1)], personalGoal: { context: context(), metric: 'time' } })!;
  const invalid = [null, [], {}, { ...receipt, metric: '__proto__' }, { ...receipt, context: details({ control: 'unknown' }) },
    { ...receipt, context: details({ route: campaign(null) }) }, { ...receipt, baseline: 0, target: 0 }, { ...receipt, baseline: NaN },
    { ...receipt, baseline: Infinity }, { ...receipt, baseline: '12.5' }, { ...receipt, baseline: -1 }, { ...receipt, baseline: 86401 },
    { ...receipt, target: NaN }, { ...receipt, target: Infinity }, { ...receipt, target: '11.5' }, { ...receipt, target: 10.5 },
    { ...receipt, baseline: 8 }, { ...receipt, metric: 'perfects', baseline: 1.5, target: 2.5 },
    { ...receipt, metric: 'perfects', baseline: 1000000, target: 1000001 }, { ...receipt, metric: 'breaks', baseline: -1, target: 0 }];
  for (const value of invalid) expect(evaluatePersonalGoal(value, details({ timeSec: 0, perfects: 100, breaks: 100 }), 'victory')).toBeNull();
  const before = JSON.stringify(receipt), observed = details({ timeSec: 11.5 }), beforeDetails = JSON.stringify(observed);
  expect(evaluatePersonalGoal(receipt, observed, 'victory')?.achieved).toBe(true);
  expect(JSON.stringify(receipt)).toBe(before); expect(JSON.stringify(observed)).toBe(beforeDetails);
});

test('normalization, comparison, capture and evaluation accept frozen inputs without rewriting their evidence', () => {
  const route = Object.freeze(campaign()), observed = Object.freeze(details({ route }));
  const receipt = Object.freeze(run(7, { details: observed })), history = Object.freeze([receipt]);
  const goal = Object.freeze({ context: Object.freeze({ ...context(), route }), metric: 'breaks' });
  const state = Object.freeze({ history, personalGoal: goal, runSeq: 7, gold: 99 });
  const before = JSON.stringify(state);
  expect<unknown>(normalizePersonalGoal(goal)).toEqual(goal);
  expect(summarizePersonalRuns(history, goal.context)).toMatchObject({ count: 1, runIds: [7] });
  const captured = capturePersonalGoal(state)!;
  expect(captured).toMatchObject({ metric: 'breaks', baseline: 1, target: 2 });
  expect(evaluatePersonalGoal(captured, Object.freeze(details({ breaks: 2 })), 'victory')).toMatchObject({ eligible: true, achieved: true, value: 2 });
  expect(JSON.stringify(state)).toBe(before);
});
