#!/usr/bin/env node
// RSI relative-performance check for predeclared, sequential paired samples.
// Every individual run must still pass every absolute PRD §2 band.
import { readFileSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { assessMetrics, REGRESSION } from './metrics-contract.mjs';

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

export function assessSeries(base, head) {
  const failures = [];
  if (!Array.isArray(base) || !Array.isArray(head) || base.length !== 5 || head.length !== 5)
    return { failures: ['exactly-five-paired-runs-required'], medians: null, pairs: [] };
  const choices = JSON.stringify(base[0]?._choices);
  const seed = base[0]?._seed;
  for (let i = 0; i < base.length; i++) {
    for (const [kind, run] of [['base', base[i]], ['head', head[i]]]) {
      if (!run || typeof run !== 'object') { failures.push(`${kind}-${i + 1}:missing`); continue; }
      for (const key of assessMetrics(run)) failures.push(`${kind}-${i + 1}:${key}`);
      if (!Number.isSafeInteger(run._seed) || run._seed !== seed) failures.push(`${kind}-${i + 1}:seed`);
      if (!Array.isArray(run._choices) || JSON.stringify(run._choices) !== choices) failures.push(`${kind}-${i + 1}:choices`);
      if (run._heroLevelStart !== 1 || !Number.isInteger(run._heroLevelEnd)) failures.push(`${kind}-${i + 1}:hero-level`);
    }
    if (base[i]?._heroLevelEnd !== head[i]?._heroLevelEnd) failures.push(`pair-${i + 1}:end-level`);
    const before = Date.parse(base[i]?._at), after = Date.parse(head[i]?._at);
    if (!Number.isFinite(before) || !Number.isFinite(after) || before >= after)
      failures.push(`pair-${i + 1}:order`);
    if (i > 0 && Date.parse(head[i - 1]?._at) >= before) failures.push(`pair-${i + 1}:order`);
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
  return { failures: [...new Set(failures)], mode: subMillisecond ? 'sub-ms-median' : 'per-pair', medians, pairs };
}

const sha = /^[a-f0-9]{40}$/;
export function loadSeriesManifest(path) {
  const raw = readFileSync(path);
  const manifest = JSON.parse(raw);
  const anchor = dirname(resolve(path));
  const manifestSha256 = createHash('sha256').update(raw).digest('hex');
  if (manifest.schema !== 1 || !/^[a-zA-Z0-9_-]{8,80}$/.test(manifest.seriesId || '')
    || !Number.isFinite(Date.parse(manifest.createdAt))) throw new Error('invalid series manifest');
  const read = file => JSON.parse(readFileSync(isAbsolute(file) ? file : resolve(anchor, file), 'utf8'));
  const extract = kind => {
    const section = manifest[kind], version = section && read(section.version);
    if (!sha.test(section?.sha || '') || version?.sha !== section.sha || version?.dirty !== false
      || !Number.isFinite(Date.parse(version?.builtAt))
      || Date.parse(manifest.createdAt) >= Date.parse(version.builtAt))
      throw new Error(`${kind}: exact clean dist/version.json is required`);
    if (!Array.isArray(section.runs) || section.runs.length !== 5) throw new Error(`${kind}: five runs required`);
    const seen = new Set();
    const reports = section.runs.map((file, i) => {
      const absolute = isAbsolute(file) ? file : resolve(anchor, file);
      if (seen.has(absolute)) throw new Error(`${kind}: duplicate report path`);
      seen.add(absolute);
      const report = read(absolute);
      if (!Number.isFinite(Date.parse(report._at)) || Date.parse(report._at) <= Date.parse(version.builtAt))
        throw new Error(`${kind}: report predates exact clean build`);
      if (report._runId !== `${manifest.seriesId}:${kind}-${i + 1}`
        || report._seriesManifestSha256 !== manifestSha256
        || JSON.stringify(report._build) !== JSON.stringify(version))
        throw new Error(`${kind}-${i + 1}: report does not match predeclared build/run`);
      return report;
    });
    return reports;
  };
  const base = extract('base'), head = extract('head');
  const allPaths = [...manifest.base.runs, ...manifest.head.runs].map(file => isAbsolute(file) ? file : resolve(anchor, file));
  if (new Set(allPaths).size !== allPaths.length) throw new Error('report path reused across base/head');
  return { ...assessSeries(base, head), baseCount: base.length, headCount: head.length,
    baseSha: manifest.base.sha, headSha: manifest.head.sha };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--manifest') throw new Error('usage: node tools/metrics-series.mjs --manifest paired-runs.json');
    const report = loadSeriesManifest(process.argv[3]);
    console.log(JSON.stringify(report, null, 2));
    if (report.failures.length) process.exitCode = 1;
  } catch (error) { console.error(String(error)); process.exitCode = 2; }
}
