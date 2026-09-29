import { test, expect } from 'bun:test';
import { assessSeries, loadSeriesManifest, reserveSeriesRun } from '../metrics-series.mjs';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, rmdirSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function run(avgFrameMs, drawCalls, minute) {
  return {
    errors: 0, bootMs: 3000, floorClearSec: 180, killsPerFloor: 190,
    maxAliveSeen: 23, dropsPerFloor: 40, longestDryStreakSec: 18,
    hitTakenRatio: .2, avgFrameMs, p95FrameMs: 2, rhythmBeats: 7, drawCalls,
    _won: true, _seed: 20260905, _choices: ['boon:storm_eye'],
    _heroLevelStart: 1, _heroLevelEnd: 4,
    _at: new Date(Date.UTC(2026, 8, 29, 5, minute)).toISOString(),
    _startedAt: new Date(Date.UTC(2026, 8, 29, 5, minute) - 30000).toISOString(),
    _status: 'completed', _renderEvery: 3, _timeoutSec: 600,
    _dryRewardSource: 'frame-collected-gold-stones-fragments-gear-v3',
  };
}

const sample = () => ({
  base: [run(.45, 393, 0), run(.47, 391, 2), run(.53, 383, 4), run(.45, 386, 6), run(.51, 378, 8)],
  head: [run(.44, 386, 1), run(.52, 372, 3), run(.61, 384, 5), run(.57, 382, 7), run(.46, 396, 9)],
});

test('five predeclared pairs keep strict bands but use median relative performance', () => {
  const { base, head } = sample();
  const report = assessSeries(base, head);
  expect(report.failures).toEqual([]);
  expect(report.medians.avgFrameMs).toEqual({ base: .47, head: .52 });
  expect(report.medians.drawCalls).toEqual({ base: 386, head: 384 });
  expect(report.pairs[2].individualRelativeFailures).toContain('avgFrameMs');
  expect(report.pairs[3].individualRelativeFailures).toContain('avgFrameMs');
  expect(report.mode).toBe('sub-ms-median');
});

test('one absolute band miss in any run fails even if all medians pass', () => {
  const { base, head } = sample();
  head[3].drawCalls = 421;
  expect(assessSeries(base, head).failures).toContain('head-4:drawCalls');
});

test('a preexisting draw-call repair records only baseline draw-call exceptions', () => {
  const { base, head } = sample();
  base[4].drawCalls = 434;
  expect(assessSeries(base, head).failures).toContain('base-5:drawCalls');
  const repaired = assessSeries(base, head, { allowBaseDrawCallFailure: true });
  expect(repaired.failures).toEqual([]);
  expect(repaired.baselineExceptions).toEqual([{ run: 'base-5', band: 'drawCalls', value: 434 }]);
  base[3].longestDryStreakSec = 36;
  expect(assessSeries(base, head, { allowBaseDrawCallFailure: true }).failures).toContain('base-4:longestDryStreakSec');
  base[3].longestDryStreakSec = 18;
  head[4].drawCalls = 421;
  expect(assessSeries(base, head, { allowBaseDrawCallFailure: true }).failures).toContain('head-5:drawCalls');
});

test('median frame regression and a mismatched choice trace both fail', () => {
  const { base, head } = sample();
  for (const report of head) report.avgFrameMs = 1;
  head[2]._choices = ['boon:other'];
  const failures = assessSeries(base, head).failures;
  expect(failures).toContain('avgFrameMs:median-regression');
  expect(failures).toContain('head-3:choices');
});

test('a missing, reordered, or shortened series cannot pass', () => {
  const { base, head } = sample();
  expect(assessSeries(base.slice(0, 4), head.slice(0, 4)).failures).toContain('exactly-five-paired-runs-required');
  head[1]._at = new Date(Date.UTC(2026, 8, 29, 4, 0)).toISOString();
  expect(assessSeries(base, head).failures).toContain('pair-2:order');
});

test('overlapping start times fail even when completion timestamps are ordered', () => {
  const { base, head } = sample();
  head[0]._startedAt = base[0]._startedAt;
  expect(assessSeries(base, head).failures).toContain('pair-1:order');
  const second = sample();
  second.base[1]._startedAt = second.head[0]._startedAt;
  expect(assessSeries(second.base, second.head).failures).toContain('pair-2:order');
});

test('the series exception cannot hide a 20ms to 40ms regression', () => {
  const { base, head } = sample();
  for (const report of base) report.avgFrameMs = 20;
  head.forEach((report, i) => { report.avgFrameMs = i < 3 ? 20 : 40; });
  const result = assessSeries(base, head);
  expect(result.mode).toBe('per-pair');
  expect(result.failures).toContain('pair-4:avgFrameMs-regression');
  expect(result.failures).toContain('pair-5:avgFrameMs-regression');
});

test('manifest loader binds every run to the observed clean build and run id', () => {
  const directory = mkdtempSync(join(tmpdir(), 'blade-series-'));
  const files = [];
  const save = (name, value) => {
    const file = join(directory, name);
    writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
    files.push(file);
    return file;
  };
  try {
    const { base, head } = sample();
    const versions = {
      base: { sha: 'a'.repeat(40), dirty: false, builtAt: '2026-09-29T04:00:00.000Z' },
      head: { sha: 'b'.repeat(40), dirty: false, builtAt: '2026-09-29T04:00:00.000Z' },
    };
    const manifest = {
      schema: 2, seriesId: 'pr84test01', createdAt: '2026-09-29T03:00:00.000Z',
      measurement: { seed: 20260905, renderEvery: 3, timeoutSec: 600 },
      base: { sha: versions.base.sha, version: save('base-version.json', versions.base), runs: base.map((_, i) => join(directory, `base-${i + 1}.json`)) },
      head: { sha: versions.head.sha, version: save('head-version.json', versions.head), runs: head.map((_, i) => join(directory, `head-${i + 1}.json`)) },
    };
    const raw = JSON.stringify(manifest);
    const manifestPath = save('manifest.json', raw);
    const digest = createHash('sha256').update(raw).digest('hex');
    for (const kind of ['base', 'head']) {
      const reports = kind === 'base' ? base : head;
      reports.forEach((report, i) => {
        report._build = versions[kind];
        report._runId = `${manifest.seriesId}:${kind}-${i + 1}`;
        report._seriesManifestSha256 = digest;
        save(`${kind}-${i + 1}.json`, report);
      });
    }
    expect(loadSeriesManifest(manifestPath).failures).toEqual([]);
    head[0]._renderEvery = 1000000;
    writeFileSync(manifest.head.runs[0], JSON.stringify(head[0]));
    expect(() => loadSeriesManifest(manifestPath)).toThrow('report does not match predeclared build/run/settings');
    head[0]._renderEvery = 3;
    writeFileSync(manifest.head.runs[0], JSON.stringify(head[0]));
    head[0]._startedAt = base[0]._startedAt;
    writeFileSync(manifest.head.runs[0], JSON.stringify(head[0]));
    expect(() => loadSeriesManifest(manifestPath)).toThrow('overlapping or reordered execution');
    head[0]._startedAt = new Date(Date.UTC(2026, 8, 29, 5, 1) - 30000).toISOString();
    writeFileSync(manifest.head.runs[0], JSON.stringify(head[0]));
    writeFileSync(manifest.base.runs[1], JSON.stringify(base[0]));
    expect(() => loadSeriesManifest(manifestPath)).toThrow('report does not match predeclared build/run');
    writeFileSync(manifest.base.runs[1], JSON.stringify(base[1]));
    writeFileSync(manifest.head.version, JSON.stringify({ ...versions.head, sha: 'c'.repeat(40) }));
    expect(() => loadSeriesManifest(manifestPath)).toThrow('exact clean dist/version.json is required');
  } finally {
    for (const file of files.reverse()) unlinkSync(file);
    rmdirSync(directory);
  }
});

test('a failed or interrupted attempt reserves its run id and cannot be retried', () => {
  const directory = mkdtempSync(join(tmpdir(), 'blade-series-reserve-'));
  try {
    const project = join(directory, 'base');
    mkdirSync(join(project, 'dist'), { recursive: true });
    const version = { sha: 'a'.repeat(40), dirty: false, builtAt: new Date(Date.now() - 1000).toISOString() };
    const versionPath = join(project, 'dist', 'version.json');
    writeFileSync(versionPath, JSON.stringify(version));
    const manifest = {
      schema: 2, seriesId: 'pr84reserve01', createdAt: new Date(Date.now() - 2000).toISOString(),
      measurement: { seed: 20260905, renderEvery: 3, timeoutSec: 600 },
      base: { sha: version.sha, version: versionPath, runs: Array.from({ length: 5 }, (_, i) => join(directory, `base-${i + 1}.json`)) },
      head: { sha: 'b'.repeat(40), version: join(directory, 'head-version.json'), runs: Array.from({ length: 5 }, (_, i) => join(directory, `head-${i + 1}.json`)) },
    };
    const file = join(directory, 'manifest.json');
    writeFileSync(file, JSON.stringify(manifest));
    const attempt = reserveSeriesRun(file, 'base-1', project);
    expect(existsSync(manifest.base.runs[0])).toBe(true);
    expect(() => reserveSeriesRun(file, 'base-1', project)).toThrow();
    attempt.finalize('failed', { _failure: 'boot timeout' });
    expect(existsSync(join(directory, 'series.lock'))).toBe(false);
    expect(JSON.parse(readFileSync(manifest.base.runs[0], 'utf8'))._status).toBe('failed');
    expect(() => reserveSeriesRun(file, 'base-1', project)).toThrow('attempt already exists');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('real process exit preserves a failed attempt and releases only its series lock', () => {
  const directory = mkdtempSync(join(tmpdir(), 'blade-series-exit-'));
  try {
    const project = join(directory, 'base');
    mkdirSync(join(project, 'dist'), { recursive: true });
    const version = { sha: 'a'.repeat(40), dirty: false, builtAt: new Date(Date.now() - 1000).toISOString() };
    const versionPath = join(project, 'dist', 'version.json');
    writeFileSync(versionPath, JSON.stringify(version));
    const manifest = {
      schema: 2, seriesId: 'pr84exit001', createdAt: new Date(Date.now() - 2000).toISOString(),
      measurement: { seed: 20260905, renderEvery: 3, timeoutSec: 600 },
      base: { sha: version.sha, version: versionPath, runs: Array.from({ length: 5 }, (_, i) => join(directory, `base-${i + 1}.json`)) },
      head: { sha: 'b'.repeat(40), version: join(directory, 'head-version.json'), runs: Array.from({ length: 5 }, (_, i) => join(directory, `head-${i + 1}.json`)) },
    };
    const file = join(directory, 'manifest.json');
    writeFileSync(file, JSON.stringify(manifest));
    const code = `import { reserveSeriesRun } from ${JSON.stringify(new URL('../metrics-series.mjs', import.meta.url).href)}; reserveSeriesRun(${JSON.stringify(file)}, 'base-1', ${JSON.stringify(project)}); process.exit(7);`;
    const child = spawnSync('node', ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 5000 });
    expect(child.status).toBe(7);
    expect(JSON.parse(readFileSync(manifest.base.runs[0], 'utf8'))._status).toBe('failed');
    expect(existsSync(join(directory, 'series.lock'))).toBe(false);
    expect(() => reserveSeriesRun(file, 'base-1', project)).toThrow('attempt already exists');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('repair mode requires a hashed failing report from its exact baseline SHA', () => {
  const directory = mkdtempSync(join(tmpdir(), 'blade-series-repair-'));
  try {
    const project = join(directory, 'base');
    mkdirSync(join(project, 'dist'), { recursive: true });
    const version = { sha: 'a'.repeat(40), dirty: false, builtAt: new Date(Date.now() - 1000).toISOString() };
    const versionPath = join(project, 'dist', 'version.json');
    writeFileSync(versionPath, JSON.stringify(version));
    const evidence = join(directory, 'prior-failure.json');
    const raw = JSON.stringify({ _status: 'completed', _build: version, drawCalls: 434 });
    writeFileSync(evidence, raw);
    const manifest = {
      schema: 3, seriesId: 'pr84repair01', createdAt: new Date(Date.now() - 2000).toISOString(),
      measurement: { seed: 20260905, renderEvery: 3, timeoutSec: 600 },
      repair: { kind: 'preexisting-drawcalls', baselineSha: version.sha, report: evidence,
        reportSha256: createHash('sha256').update(raw).digest('hex') },
      base: { sha: version.sha, version: versionPath, runs: Array.from({ length: 5 }, (_, i) => join(directory, `base-${i + 1}.json`)) },
      head: { sha: 'b'.repeat(40), version: join(directory, 'head-version.json'), runs: Array.from({ length: 5 }, (_, i) => join(directory, `head-${i + 1}.json`)) },
    };
    const file = join(directory, 'manifest.json');
    writeFileSync(file, JSON.stringify(manifest));
    writeFileSync(evidence, JSON.stringify({ _status: 'completed', _build: version, drawCalls: 420 }));
    expect(() => reserveSeriesRun(file, 'base-1', project)).toThrow('preexisting draw-call failure evidence mismatch');
    writeFileSync(evidence, raw);
    const attempt = reserveSeriesRun(file, 'base-1', project);
    attempt.finalize('failed', { _failure: 'test fixture' });
    expect(existsSync(join(directory, 'series.lock'))).toBe(false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
