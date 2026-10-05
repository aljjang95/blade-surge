import { normalizeRunDetails } from './run-history.js';

export const GOAL_METRICS = Object.freeze([
  Object.freeze({ id: 'time', label: '시간 단축' }),
  Object.freeze({ id: 'perfects', label: '정확 회피' }),
  Object.freeze({ id: 'breaks', label: '균형 붕괴' }),
]);

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validRunId = value => Number.isSafeInteger(value) && value > 0;
const validMetric = value => GOAL_METRICS.some(metric => metric.id === value);
const invalidSelection = () => ({ ok: false, error: '비교할 수 있는 출격 기록을 확인해 주세요.' });

/** Missing departure conditions cannot establish a comparable personal record. */
export function comparableRunContext(value) {
  const details = normalizeRunDetails(value);
  if (!details?.route || !details.heroId || !details.heroLevel || details.control === 'unknown') return null;
  if (details.route.kind === 'campaign' && details.route.difficultyId === null) return null;
  return { route: details.route, heroId: details.heroId, heroLevel: details.heroLevel, control: details.control };
}

export function normalizePersonalGoal(value) {
  if (!object(value) || !validMetric(value.metric)) return null;
  const context = comparableRunContext(value.context);
  return context ? { context, metric: value.metric } : null;
}

function sameContext(a, b) {
  if (a.heroId !== b.heroId || a.heroLevel !== b.heroLevel || a.control !== b.control) return false;
  const left = a.route, right = b.route;
  if (left.kind !== right.kind || left.id !== right.id) return false;
  return left.kind === 'campaign'
    ? left.difficultyId === right.difficultyId
    : left.depth === right.depth && left.conquestId === right.conquestId && left.riftId === right.riftId
      && (left.encounterVersion ?? null) === (right.encounterVersion ?? null);
}

/** Invalid observations still occupy their original slot in the terminal history. */
function terminalWindow(history) {
  return Array.isArray(history)
    ? history.filter(run => object(run) && ['victory', 'defeat'].includes(run.outcome)).slice(-20)
    : [];
}

function uniqueTerminalRuns(history) {
  const window = terminalWindow(history), counts = new Map();
  for (const run of window) if (validRunId(run.runId)) counts.set(run.runId, (counts.get(run.runId) || 0) + 1);
  // Count duplicates before checking context, outcome or observations: no survivor is authoritative.
  return window.filter(run => validRunId(run.runId) && counts.get(run.runId) === 1);
}

function observedRun(value) {
  const details = normalizeRunDetails(value), context = comparableRunContext(details);
  if (!context || details.timeSec === null || details.perfects === null || details.breaks === null) return null;
  return { context, details };
}

/** Each best value comes only from fully observed victories with identical departure conditions. */
export function summarizePersonalRuns(history, value) {
  const context = comparableRunContext(value), runIds = [];
  let best = null;
  if (context) for (const run of uniqueTerminalRuns(history)) {
    if (run.outcome !== 'victory') continue;
    const observed = observedRun(run.details);
    if (!observed || !sameContext(context, observed.context)) continue;
    const { timeSec, perfects, breaks } = observed.details;
    runIds.push(run.runId);
    best = best
      ? { timeSec: Math.min(best.timeSec, timeSec), perfects: Math.max(best.perfects, perfects), breaks: Math.max(best.breaks, breaks) }
      : { timeSec, perfects, breaks };
  }
  return { context, count: runIds.length, best, runIds };
}

export function personalGoalTarget(summary, metric) {
  if (!object(summary?.best) || !validMetric(metric)) return null;
  const baseline = summary.best[metric === 'time' ? 'timeSec' : metric];
  if (metric === 'time') {
    if (!Number.isFinite(baseline) || baseline <= 0 || baseline > 86400) return null;
    // Truncate decimal cents before subtracting one exact second, avoiding 1.14 becoming 0.13.
    const [whole, fraction = ''] = String(baseline).split('.');
    const cents = baseline <= 1 ? 0 : Number(whole) * 100 + Number(fraction.slice(0, 2).padEnd(2, '0'));
    return { metric, baseline, target: Math.max(0, cents - 100) / 100 };
  }
  if (!Number.isSafeInteger(baseline) || baseline < 0 || baseline >= 1000000) return null;
  return { metric, baseline, target: baseline + 1 };
}

/** Choosing a reminder never charges, settles, rewards or rewrites a run. */
export function choosePersonalGoal(state, runId, metric) {
  if (!object(state) || !validRunId(runId) || !validMetric(metric)) return invalidSelection();
  const run = uniqueTerminalRuns(state.history).find(candidate => candidate.runId === runId);
  const observed = run && observedRun(run.details);
  if (!observed) return invalidSelection();
  state.personalGoal = { context: observed.context, metric };
  return { ok: true };
}

function frozenContext(context) {
  return Object.freeze({ ...context, route: Object.freeze({ ...context.route }) });
}

/** A departure captures its existing baseline; later history cannot move that run's goal. */
export function capturePersonalGoal(state) {
  if (!object(state)) return null;
  const goal = normalizePersonalGoal(state.personalGoal);
  if (!goal) return null;
  const summary = summarizePersonalRuns(state.history, goal.context), target = personalGoalTarget(summary, goal.metric);
  return target ? Object.freeze({ context: frozenContext(goal.context), ...target }) : null;
}

function validatedReceipt(value) {
  if (!object(value) || !validMetric(value.metric)) return null;
  const context = comparableRunContext(value.context);
  if (!context || typeof value.target !== 'number' || !Number.isFinite(value.target)) return null;
  const target = personalGoalTarget({ best: { [value.metric === 'time' ? 'timeSec' : value.metric]: value.baseline } }, value.metric);
  return target && target.target === value.target ? { context, ...target } : null;
}

/** Read only observed results against the captured conditions, without settlement authority. */
export function evaluatePersonalGoal(receipt, details, outcome) {
  const captured = validatedReceipt(receipt);
  if (!captured) return null;
  const { metric, baseline, target } = captured, observed = observedRun(details);
  if (!observed || !sameContext(captured.context, observed.context) || !['victory', 'defeat'].includes(outcome)) {
    return Object.freeze({ eligible: false, achieved: false, metric, baseline, target, value: null, reason: 'conditions' });
  }
  if (outcome === 'defeat') return Object.freeze({ eligible: false, achieved: false, metric, baseline, target, value: null, reason: 'defeat' });
  const value = observed.details[metric === 'time' ? 'timeSec' : metric];
  return Object.freeze({ eligible: true, achieved: metric === 'time' ? value <= target : value >= target, metric, baseline, target, value });
}
