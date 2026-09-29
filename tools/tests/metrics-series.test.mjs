import { test, expect } from 'bun:test';
import { assessSeries, loadSeriesManifest } from '../metrics-series.mjs';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function run(avgFrameMs, drawCalls, minute) {
  return {
    errors: 0, bootMs: 3000, floorClearSec: 180, killsPerFloor: 190,
    maxAliveSeen: 23, dropsPerFloor: 40, longestDryStreakSec: 18,
    hitTakenRatio: .2, avgFrameMs, p95FrameMs: 2, rhythmBeats: 7, drawCalls,
    _won: true, _seed: 20260905, _choices: ['boon:storm_eye'],
    _heroLevelStart: 1, _heroLevelEnd: 4,
    _at: new Date(Date.UTC(2026, 8, 29, 5, minute)).toISOString(),
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
      schema: 1, seriesId: 'pr84test01', createdAt: '2026-09-29T03:00:00.000Z',
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
