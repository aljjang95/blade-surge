import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { devNull } from 'node:os';
import { deploymentQuery, wranglerLeaseQuery } from '../tools/deploy-wrangler-oauth.mjs';
import { acquireDeploymentLease } from '../tools/deploy-control.mjs';
import config from '../tools/release-config.json';

const head = 'a'.repeat(40), owner = '12345678-1234-4123-8123-123456789abc';
const select = 'SELECT session FROM rsi_claim WHERE repo = ? AND axis = ?';
const insert = 'INSERT INTO rsi_claim (repo, axis, session, base_sha, started_at, note) VALUES (?, ?, ?, ?, ?, ?)';
const del = 'DELETE FROM rsi_claim WHERE repo = ? AND axis = ? AND session = ?';
const key = [config.repository, config.leaseAxis];
const values = () => [...key, owner, head, '2026-09-15T01:02:03.000Z', '검증된 배포 전환 잠금'];
const info = { uuid: config.leaseDatabaseId, name: 'apex-rsi' };
const ok = (changes = 0, results: unknown[] = []) => [{ success: true, results, meta: { changes } }];
function fixture(response: unknown = ok(), dbInfo: unknown = info) {
  const calls: { file: string; args: string[]; options: any }[] = [];
  const runner = (file: string, args: string[], options: any) => {
    calls.push({ file, args, options });
    return JSON.stringify(args[2] === 'info' ? dbInfo : response);
  };
  return { calls, query: wranglerLeaseQuery({ head, owner, env: {}, runner }) };
}

test('explicit OAuth uses fixed installed CLI, verified UUID, bounded no-shell commands', async () => {
  const f = fixture();
  expect(await f.query(select, key)).toEqual(ok()[0]);
  expect(f.calls[0].args.slice(1)).toEqual(['d1', 'info', 'apex-rsi', '--json', '--env-file', devNull]);
  expect(f.calls[1].args.slice(1)).toEqual(['d1', 'execute', config.leaseDatabaseId, '--remote', '--json', '--command',
    "SELECT session FROM rsi_claim WHERE repo = 'aljjang95/blade-surge' AND axis = 'DEPLOY-blade-surge'", '--env-file', devNull]);
  for (const call of f.calls) {
    expect(call.file).toBe(process.execPath);
    expect(call.args[0].replaceAll('\\', '/')).toEndWith('/node_modules/wrangler/bin/wrangler.js');
    expect(call.options).toMatchObject({ shell: false, timeout: 15000, maxBuffer: 1048576, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  }
});

test('default token route stays fail-closed; explicit token route never invokes runner', () => {
  const runner = () => { throw new Error('must not run'); };
  for (const env of [{}, { CLOUDFLARE_API_TOKEN: 'fake' }, { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) },
    { CLOUDFLARE_ACCOUNT_ID: 'invalid', CLOUDFLARE_API_TOKEN: 'fake' }]) {
    expect(() => deploymentQuery({ env, head, owner, runner })).toThrow();
  }
  expect(typeof deploymentQuery({ env: { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'fake' }, runner })).toBe('function');
});

test('OAuth rejects partial, complete, empty or alternate auth overrides and invalid flags', () => {
  for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CF_API_TOKEN', 'CF_ACCOUNT_ID', 'APEX_RSI_DB', 'WRANGLER_PROFILE']) {
    for (const value of ['', 'fake']) expect(() => deploymentQuery({ args: ['--auth=wrangler'], env: { [name]: value }, head, owner })).toThrow();
  }
  for (const args of [['--auth'], ['--auth=other'], ['--auth=wrangler', '--auth=wrangler']])
    expect(() => deploymentQuery({ args, env: {}, head, owner })).toThrow();
});

test('database mismatch and malformed info reject before SQL', async () => {
  for (const dbInfo of [null, [], {}, { ...info, uuid: owner }, { ...info, name: 'other' }, { result: info, success: true }]) {
    const f = fixture(ok(), dbInfo);
    await expect(f.query(select, key)).rejects.toThrow();
    expect(f.calls.length).toBe(1);
  }
});

test('unsupported SQL and missing/extra/nonstring bindings never start a child', async () => {
  for (const [sql, params] of [[select + '; DROP TABLE rsi_claim', key], ['select session FROM rsi_claim WHERE repo = ? AND axis = ?', key],
    [del.replace(' AND session = ?', ''), key], [select, undefined], [select, [...key, owner]], [insert, key], [select, [null, config.leaseAxis]],
    [select, [42, config.leaseAxis]], [select, 'not-array']]) {
    const f = fixture();
    await expect(f.query(sql, params)).rejects.toThrow(); expect(f.calls.length).toBe(0);
  }
});

test('dangerous strings, alternate scope/owner/head and invalid time/note are rejected before child', async () => {
  for (const bad of ["x'); DELETE FROM rsi_claim;--", '$(whoami)', '`whoami`', '\u0000', '\n', '?', 'x'.repeat(129), '']) {
    for (let index = 0; index < 6; index++) {
      const params = values(); params[index] = bad;
      const f = fixture(); await expect(f.query(insert, params)).rejects.toThrow(); expect(f.calls.length).toBe(0);
    }
  }
  for (const [index, bad] of [[0, 'other/repo'], [1, 'OTHER'], [2, crypto.randomUUID()], [3, 'b'.repeat(40)],
    [4, '2026-02-30T01:02:03.000Z'], [5, 'another note']] as const) {
    const params = values(); params[index] = bad;
    const f = fixture(); await expect(f.query(insert, params)).rejects.toThrow(); expect(f.calls.length).toBe(0);
  }
  const f = fixture(); await expect(f.query(del, [...key, crypto.randomUUID()])).rejects.toThrow(); expect(f.calls.length).toBe(0);
  for (const bad of ['HEAD', 'a'.repeat(39), owner, null]) expect(() => wranglerLeaseQuery({ head: bad, owner, env: {} })).toThrow();
  for (const bad of ['intruder', 'a'.repeat(36), null]) expect(() => wranglerLeaseQuery({ head, owner: bad, env: {} })).toThrow();
});

test('JSON success, result and changes validation is strict', async () => {
  for (const response of [null, {}, [], [...ok(), ...ok()], [{ results: [], meta: { changes: 0 } }],
    [{ success: false, results: [], meta: { changes: 0 } }], [{ success: true, results: {} , meta: { changes: 0 } }],
    [{ success: true, results: [] }], ok(-1), ok(2), ok(0.5), [{ success: true, results: [], meta: { changes: '0' } }],
    ok(1), ok(0, [{ session: 'bad' }]), ok(0, [{ session: owner, extra: true }]), ok(0, [{ session: owner }, { session: owner }])]) {
    await expect(fixture(response).query(select, key)).rejects.toThrow();
  }
  await expect(fixture(ok(0)).query(insert, values())).rejects.toThrow();
  await expect(fixture(ok(1, [{ session: owner }])).query(del, [...key, owner])).rejects.toThrow();
  expect((await fixture(ok(0)).query(del, [...key, owner])).meta.changes).toBe(0);
});

test('failed/timeout/invalid JSON errors do not expose child output and have no retries', async () => {
  for (const stage of ['info', 'execute']) for (const mode of ['failure', 'timeout', 'json']) {
    let calls = 0;
    const query = wranglerLeaseQuery({ head, owner, env: {}, runner: (_file: string, args: string[]) => {
      calls++;
      if (args[2] !== stage) return JSON.stringify(info);
      if (mode === 'json') return 'SECRET raw output';
      throw Object.assign(new Error('SECRET raw output'), { code: mode === 'timeout' ? 'ETIMEDOUT' : 'FAILED', stderr: 'SECRET', stdout: 'SECRET' });
    } });
    try { await query(select, key); throw new Error('unexpected success'); }
    catch (error) { expect(String(error)).toBe('Error: Wrangler lease command failed or returned invalid JSON.'); }
    expect(calls).toBe(stage === 'info' ? 1 : 2);
  }
});

test('real lease templates round-trip through SQLite fake; lost INSERT response reconciles ownership', async () => {
  for (const lostResponse of [false, true]) {
    const db = new Database(':memory:');
    db.run('CREATE TABLE rsi_claim (repo TEXT, axis TEXT, session TEXT, base_sha TEXT, started_at TEXT, note TEXT, PRIMARY KEY(repo, axis))');
    const query = wranglerLeaseQuery({ head, owner, env: {}, runner: (_file: string, args: string[]) => {
      if (args[2] === 'info') return JSON.stringify(info);
      const sql = args[args.indexOf('--command') + 1];
      if (sql.startsWith('SELECT')) return JSON.stringify(ok(0, db.query(sql).all()));
      const changes = db.query(sql).run().changes;
      if (lostResponse && sql.startsWith('INSERT')) throw new Error('lost response');
      return JSON.stringify(ok(changes));
    } });
    try {
      const lease = await acquireDeploymentLease(query, { head, owner });
      await lease.assertHeld();
      const resumed = await acquireDeploymentLease(query, { head, owner, mustExist: true });
      await resumed.release();
      expect(db.query('SELECT * FROM rsi_claim').all()).toEqual([]);
    } finally { db.close(); }
  }
});

test('guarded build uses native config loader and preserves control integration', () => {
  const source = readFileSync(new URL('../tools/deploy.mjs', import.meta.url), 'utf8');
  expect(source).toContain("['build', '--configLoader', 'native']");
  expect(source).toContain('await guard(preflight.live)');
  expect(source).toContain('canReleaseDeploymentLease(receipt)');
});
