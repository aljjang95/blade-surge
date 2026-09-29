#!/usr/bin/env node
// RSI relative-performance check for predeclared, sequential paired samples.
// Every individual run must still pass every absolute PRD §2 band.
import { readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { assessMetrics, REGRESSION } from './metrics-contract.mjs';

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

export function assessSeries(base, head, { allowBaseDrawCallFailure = false } = {}) {
  const failures = [];
  const baselineExceptions = [];
  if (!Array.isArray(base) || !Array.isArray(head) || base.length !== 5 || head.length !== 5)
    return { failures: ['exactly-five-paired-runs-required'], medians: null, pairs: [], baselineExceptions };
  const choices = JSON.stringify(base[0]?._choices);
  const seed = base[0]?._seed;
  for (let i = 0; i < base.length; i++) {
    for (const [kind, run] of [['base', base[i]], ['head', head[i]]]) {
      if (!run || typeof run !== 'object') { failures.push(`${kind}-${i + 1}:missing`); continue; }
      for (const key of assessMetrics(run)) {
        if (allowBaseDrawCallFailure && kind === 'base' && key === 'drawCalls')
          baselineExceptions.push({ run: `base-${i + 1}`, band: key, value: run.drawCalls });
        else failures.push(`${kind}-${i + 1}:${key}`);
      }
      if (!Number.isSafeInteger(run._seed) || run._seed !== seed) failures.push(`${kind}-${i + 1}:seed`);
      if (!Array.isArray(run._choices) || JSON.stringify(run._choices) !== choices) failures.push(`${kind}-${i + 1}:choices`);
      if (run._heroLevelStart !== 1 || !Number.isInteger(run._heroLevelEnd)) failures.push(`${kind}-${i + 1}:hero-level`);
    }
    if (base[i]?._heroLevelEnd !== head[i]?._heroLevelEnd) failures.push(`pair-${i + 1}:end-level`);
    const baseStart = Date.parse(base[i]?._startedAt), before = Date.parse(base[i]?._at);
    const headStart = Date.parse(head[i]?._startedAt), after = Date.parse(head[i]?._at);
    if (![baseStart, before, headStart, after].every(Number.isFinite)
      || baseStart >= before || before >= headStart || headStart >= after)
      failures.push(`pair-${i + 1}:order`);
    if (i > 0 && Date.parse(head[i - 1]?._at) >= baseStart) failures.push(`pair-${i + 1}:order`);
  }
  const pairs = base.map((run, i) => ({
    index: i + 1,
    avgFrameMs: [run?.avgFrameMs, head[i]?.avgFrameMs],
    drawCalls: [run?.drawCalls, head[i]?.drawCalls],
    individualRelativeFailures: Object.entries(REGRESSION).filter(([key, limit]) =>
      Number.isFinite(run?.[key]) && run[key] > 0 && Number.isFinite(head[i]?.[key]) && head[i][key] > run[key] * limit).map(([key]) => key),
  }));
  const medians = {};
  const subMillisecond = median(base.map(run => run?.avgFrameMs)) < 1;
  for (const key of Object.keys(REGRESSION)) {
    const b = base.map(run => run?.[key]), h = head.map(run => run?.[key]);
    if (![...b, ...h].every(Number.isFinite)) { failures.push(`${key}:missing`); continue; }
    medians[key] = { base: median(b), head: median(h) };
    if (medians[key].base <= 0 || (subMillisecond && medians[key].head > medians[key].base * REGRESSION[key]))
      failures.push(`${key}:median-regression`);
  }
  if (!subMillisecond) for (const pair of pairs) for (const key of pair.individualRelativeFailures)
    failures.push(`pair-${pair.index}:${key}-regression`);
  return { failures: [...new Set(failures)], mode: subMillisecond ? 'sub-ms-median' : 'per-pair', medians, pairs, baselineExceptions };
}

const sha = /^[a-f0-9]{40}$/;
const runNames = Array.from({ length: 5 }, (_, i) => [`base-${i + 1}`, `head-${i + 1}`]).flat();
const reportPath = (anchor, file) => isAbsolute(file) ? file : resolve(anchor, file);
function readManifest(path) {
  const raw = readFileSync(path);
  const manifest = JSON.parse(raw);
  if (![2, 3].includes(manifest.schema) || !/^[a-zA-Z0-9_-]{8,80}$/.test(manifest.seriesId || '')
    || !Number.isFinite(Date.parse(manifest.createdAt))
    || manifest.measurement?.seed !== 20260905 || manifest.measurement?.renderEvery !== 3
    || manifest.measurement?.timeoutSec !== 600)
    throw new Error('invalid series manifest or measurement settings');
  for (const kind of ['base', 'head']) {
    const section = manifest[kind];
    if (!sha.test(section?.sha || '') || !Array.isArray(section.runs) || section.runs.length !== 5
      || !section.runs.every(file => typeof file === 'string' && file.endsWith('.json')))
      throw new Error(`${kind}: invalid predeclared paths or SHA`);
  }
  const anchor = dirname(resolve(path));
  if (manifest.schema === 3) {
    const repair = manifest.repair;
    if (repair?.kind !== 'preexisting-drawcalls' || repair.baselineSha !== manifest.base.sha
      || !/^[a-f0-9]{64}$/.test(repair.reportSha256 || '') || typeof repair.report !== 'string')
      throw new Error('repair series requires exact baseline identity and prior failure evidence');
    const rawReport = readFileSync(reportPath(anchor, repair.report));
    const observed = JSON.parse(rawReport);
    if (createHash('sha256').update(rawReport).digest('hex') !== repair.reportSha256
      || observed?._build?.sha !== manifest.base.sha || observed?._status !== 'completed'
      || !Number.isFinite(observed.drawCalls) || observed.drawCalls <= 420)
      throw new Error('preexisting draw-call failure evidence mismatch');
  } else if (manifest.repair != null) throw new Error('strict series cannot carry a repair exception');
  const paths = runNames.map(name => {
    const [kind, index] = name.split('-');
    return reportPath(anchor, manifest[kind].runs[Number(index) - 1]);
  });
  if (new Set(paths).size !== paths.length) throw new Error('report path reused across base/head');
  return { manifest, paths, digest: createHash('sha256').update(raw).digest('hex'), anchor,
    allowBaseDrawCallFailure: manifest.schema === 3 };
}

function verifyReport(report, { manifest, digest, name, version }) {
  if (report._status !== 'completed' || report._runId !== `${manifest.seriesId}:${name}`
    || report._seriesManifestSha256 !== digest || JSON.stringify(report._build) !== JSON.stringify(version)
    || report._renderEvery !== manifest.measurement.renderEvery
    || report._timeoutSec !== manifest.measurement.timeoutSec || report._seed !== manifest.measurement.seed
    || report._dryRewardSource !== 'frame-collected-gold-stones-fragments-gear-v3')
    throw new Error(`${name}: report does not match predeclared build/run/settings`);
  const start = Date.parse(report._startedAt), end = Date.parse(report._at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= Date.parse(version.builtAt) || end <= start)
    throw new Error(`${name}: invalid execution interval or report predates exact clean build`);
  return { start, end };
}

export function loadSeriesManifest(path) {
  const { manifest, paths, digest, allowBaseDrawCallFailure } = readManifest(path);
  const read = file => JSON.parse(readFileSync(file, 'utf8'));
  const versions = {};
  const extract = kind => {
    const section = manifest[kind], version = section && read(section.version);
    if (!sha.test(section?.sha || '') || version?.sha !== section.sha || version?.dirty !== false
      || !Number.isFinite(Date.parse(version?.builtAt))
      || Date.parse(manifest.createdAt) >= Date.parse(version.builtAt))
      throw new Error(`${kind}: exact clean dist/version.json is required`);
    versions[kind] = version;
    return section.runs.map((_, i) => read(paths[runNames.indexOf(`${kind}-${i + 1}`)]));
  };
  const base = extract('base'), head = extract('head');
  let previousEnd = -Infinity;
  for (const name of runNames) {
    const [kind, index] = name.split('-');
    const report = (kind === 'base' ? base : head)[Number(index) - 1];
    const interval = verifyReport(report, { manifest, digest, name, version: versions[kind] });
    if (interval.start <= previousEnd) throw new Error(`${name}: overlapping or reordered execution`);
    previousEnd = interval.end;
  }
  return { ...assessSeries(base, head, { allowBaseDrawCallFailure }),
    gate: allowBaseDrawCallFailure ? 'preexisting-drawcalls-repair' : 'strict',
    baseCount: base.length, headCount: head.length, baseSha: manifest.base.sha, headSha: manifest.head.sha };
}

// Reserve the result before launching Vite. A failed or interrupted attempt stays on disk,
// so an operator must create a new manifest/series instead of selecting successful retries.
export function reserveSeriesRun(path, runName, project) {
  const { manifest, paths, digest, anchor, allowBaseDrawCallFailure } = readManifest(path);
  const index = runNames.indexOf(runName);
  if (index < 0) throw new Error('invalid series run');
  const [kind] = runName.split('-');
  if (resolve(manifest[kind].version) !== resolve(project, 'dist/version.json')) throw new Error('series project/version path mismatch');
  const version = JSON.parse(readFileSync(manifest[kind].version, 'utf8'));
  if (version.sha !== manifest[kind].sha || version.dirty !== false
    || Date.parse(manifest.createdAt) >= Date.parse(version.builtAt)) throw new Error('series requires exact clean build after manifest');
  const lock = resolve(anchor, 'series.lock');
  const owner = randomUUID();
  const fd = openSync(lock, 'wx');
  let reserved = false;
  try {
    writeFileSync(fd, JSON.stringify({ owner, pid: process.pid, runName }));
    let previousEnd = -Infinity;
    for (let i = 0; i < paths.length; i++) {
      if (i >= index) {
        if (existsSync(paths[i])) throw new Error(`${runNames[i]}: attempt already exists or runs are out of order`);
        continue;
      }
      if (!existsSync(paths[i])) throw new Error(`${runNames[i]}: previous run missing`);
      const [prevKind] = runNames[i].split('-');
      const priorVersion = JSON.parse(readFileSync(manifest[prevKind].version, 'utf8'));
      const report = JSON.parse(readFileSync(paths[i], 'utf8'));
      const interval = verifyReport(report, { manifest, digest, name: runNames[i], version: priorVersion });
      const bad = assessMetrics(report).filter(key => !(allowBaseDrawCallFailure && prevKind === 'base' && key === 'drawCalls'));
      if (interval.start <= previousEnd || bad.length) throw new Error(`${runNames[i]}: previous run failed or overlaps`);
      previousEnd = interval.end;
    }
    const out = paths[index], startedAt = new Date().toISOString();
    if (Date.parse(startedAt) <= previousEnd) throw new Error('new run overlaps previous run');
    const identity = { _status: 'running', _runId: `${manifest.seriesId}:${runName}`,
      _seriesManifestSha256: digest, _startedAt: startedAt,
      _renderEvery: manifest.measurement.renderEvery, _timeoutSec: manifest.measurement.timeoutSec,
      _seed: manifest.measurement.seed, _build: version };
    writeFileSync(out, JSON.stringify(identity, null, 2), { flag: 'wx' });
    reserved = true;
    let finished = false;
    const release = () => {
      if (finished) return;
      finished = true;
      closeSync(fd);
      try { if (JSON.parse(readFileSync(lock, 'utf8')).owner === owner) unlinkSync(lock); } catch {}
      process.off('exit', abort);
    };
    const finalize = (status, data = {}) => {
      if (finished) return;
      writeFileSync(out, JSON.stringify({ ...data, ...identity, _status: status, _at: new Date().toISOString() }, null, 2));
      release();
    };
    const abort = () => finalize('failed', { _failure: 'process exited before completed report' });
    process.once('exit', abort);
    return { ...identity, out, shots: out.replace(/\.json$/, '-shots'), expectedSha: manifest[kind].sha,
      createdAt: manifest.createdAt, finalize };
  } catch (error) {
    if (!reserved) { closeSync(fd); try { if (JSON.parse(readFileSync(lock, 'utf8')).owner === owner) unlinkSync(lock); } catch {} }
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--manifest') throw new Error('usage: node tools/metrics-series.mjs --manifest paired-runs.json');
    const report = loadSeriesManifest(process.argv[3]);
    console.log(JSON.stringify(report, null, 2));
    if (report.failures.length) process.exitCode = 1;
  } catch (error) { console.error(String(error)); process.exitCode = 2; }
}
