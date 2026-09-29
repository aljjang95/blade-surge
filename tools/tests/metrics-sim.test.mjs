import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { simulateSunbreaker } from '../sunbreaker-sim.mjs';

const tool = fileURLToPath(new URL('../metrics.mjs', import.meta.url));

test('Sunbreaker geometry simulation is seeded, bounded and honestly scoped', () => {
  const first = simulateSunbreaker({ iterations: 2000, seed: 20260929 });
  const second = simulateSunbreaker({ iterations: 2000, seed: 20260929 });
  expect(first).toEqual(second);
  expect(first.failures).toEqual([]);
  expect(first.headToOldRatio.median).toBeGreaterThan(.8);
  expect(first.headToOldRatio.median).toBeLessThan(1.2);
  expect(first.maxPerTarget).toBeLessThanOrEqual(1.75);
  expect(first.limitation).toContain('Live DPS');
});

test('sim CLI rejects missing or unsupported skill instead of running floor metrics', () => {
  for (const args of [['--sim', '20'], ['--sim', '20', '--skill', 'unknown'], ['--skill', 'sunbreaker']]) {
    const run = spawnSync('node', [tool, ...args], { encoding: 'utf8', timeout: 5000 });
    expect(run.status).toBe(2);
    expect(run.stdout).not.toContain('층 클리어');
  }
});

test('sim CLI writes a reproducible report without opening the browser metric path', () => {
  const output = join(tmpdir(), `blade-surge-sim-${randomUUID()}.json`);
  try {
    const run = spawnSync('node', [tool, '--sim', '2000', '--skill', 'sunbreaker', '--out', output],
      { encoding: 'utf8', timeout: 10000 });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('기하 시뮬 2000회');
    expect(run.stdout).not.toContain('층 클리어');
    const report = JSON.parse(readFileSync(output, 'utf8'));
    expect(report.iterations).toBe(2000);
    expect(report.failures).toEqual([]);
    expect(report.baselineSha).toBe('b7d92f8141dc1ccc59e2e2653e453d4ca5812c0f');
  } finally {
    try { unlinkSync(output); } catch {}
  }
});
