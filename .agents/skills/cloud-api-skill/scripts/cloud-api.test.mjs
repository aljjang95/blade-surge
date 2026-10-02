import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { check, main } from './cloud-api.mjs';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('./cloud-api.mjs', import.meta.url));
// Select a bounded task-owned temporary root when the system volume is full.
const tempRoot = path.resolve(process.env.CLOUD_API_TEST_TMP
  ?? tmpdir());
await fs.mkdir(tempRoot, { recursive: true });
const fakeEnv = { CLOUDFLARE_API_TOKEN: 'test-cf-credential-marker',
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), FISH_API_KEY: 'test-fish-credential-marker' };
const childEnv = {
  PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
  TEMP: tempRoot, TMP: tempRoot, TMPDIR: tempRoot,
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
};

async function fixture({ git = true } = {}) {
  const root = await fs.mkdtemp(path.join(tempRoot, 'cloud-api-'));
  const repo = path.join(root, 'repo with spaces');
  const source = path.join(root, 'source');
  await fs.mkdir(repo);
  if (git) await execute('git', ['init', '--quiet', '--template=', repo], { env: childEnv, windowsHide: true });
  await fs.mkdir(path.join(source, 'assets', 'nested'), { recursive: true });
  await fs.mkdir(path.join(source, 'empty'));
  await fs.writeFile(path.join(source, 'SKILL.md'), '---\nname: cloud-api-skill\n---\n클라우드API스킬\n');
  await fs.writeFile(path.join(source, 'assets', 'nested', 'binary.bin'), Buffer.from([0, 255, 17, 128]));
  await fs.writeFile(path.join(source, '.hidden'), 'full enclosing folder\n');
  return { root, repo, source, destination: path.join(repo, '.agents', 'skills', 'cloud-api-skill') };
}

async function run(args, deps = {}) {
  const lines = [];
  const code = await main(args, { env: {}, write: line => lines.push(line), ...deps });
  const output = lines.join('\n');
  for (const value of Object.values(fakeEnv)) assert.equal(output.includes(value), false, 'credential marker leaked');
  return { code, rows: lines.map(line => JSON.parse(line)), output };
}
async function exists(target) {
  try { await fs.lstat(target); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

test('offline missing requested variables fails without fetching or printing values', async () => {
  const missing = await run(['check', '--providers', 'fish'], {
    env: {}, fetchImpl: () => assert.fail('unexpected fetch'),
  });
  assert.equal(missing.code, 1);
  assert.equal(missing.rows[0].variables[0].status, 'MISSING');
  const ready = await run(['check', '--providers', 'fish'], { env: fakeEnv });
  assert.equal(ready.code, 0);
  assert.equal(ready.rows[0].variables[0].status, 'PRESENT');
});
async function linkOrSkip(t, target, link, directory = true) {
  try { await fs.symlink(target, link, directory ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(error.code)) {
      t.skip('Host does not allow this symlink type.');
      return false;
    }
    throw error;
  }
  return true;
}

test('install defaults to dry-run and leaves even missing parent directories absent', async () => {
  const f = await fixture();
  const result = await run(['install', '--repo', f.repo], { sourceRoot: f.source });
  assert.equal(result.code, 0);
  assert.deepEqual(result.rows, [{ command: 'install', result: 'DRY_RUN' }]);
  assert.equal(await exists(path.join(f.repo, '.agents')), false);
});

test('apply copies full snapshot, nested/binary/hidden files and empty directories; identical is no-op', async () => {
  const f = await fixture();
  await fs.mkdir(path.join(f.repo, '.agents', 'skills', 'other-skill'), { recursive: true });
  await fs.writeFile(path.join(f.repo, '.agents', 'skills', 'other-skill', 'keep'), 'owned by someone else');
  const first = await run(['install', '--repo', f.repo, '--apply'], { sourceRoot: f.source });
  assert.equal(first.rows[0].result, 'INSTALLED');
  assert.deepEqual(await fs.readFile(path.join(f.destination, 'assets', 'nested', 'binary.bin')), Buffer.from([0, 255, 17, 128]));
  assert.equal(await fs.readFile(path.join(f.destination, '.hidden'), 'utf8'), 'full enclosing folder\n');
  assert.deepEqual(await fs.readdir(path.join(f.destination, 'empty')), []);
  const before = await fs.stat(path.join(f.destination, 'SKILL.md'));
  const second = await run(['install', '--repo', f.repo, '--apply'], { sourceRoot: f.source });
  assert.equal(second.rows[0].result, 'UNCHANGED');
  assert.equal((await fs.stat(path.join(f.destination, 'SKILL.md'))).mtimeMs, before.mtimeMs);
  assert.equal((await run(['install', '--repo', f.repo], { sourceRoot: f.source })).rows[0].result, 'UNCHANGED');
  assert.equal(await fs.readFile(path.join(f.repo, '.agents', 'skills', 'other-skill', 'keep'), 'utf8'), 'owned by someone else');
});

for (const conflict of ['different-file', 'extra-file', 'empty-directory', 'destination-file', 'parent-file']) {
  test(`preflight refuses ${conflict} without changing existing content`, async () => {
    const f = await fixture();
    if (conflict === 'parent-file') await fs.writeFile(path.join(f.repo, '.agents'), 'keep');
    else {
      await fs.mkdir(path.dirname(f.destination), { recursive: true });
      if (conflict === 'destination-file') await fs.writeFile(f.destination, 'keep');
      else if (conflict === 'empty-directory') await fs.mkdir(f.destination);
      else {
        await fs.cp(f.source, f.destination, { recursive: true });
        await fs.writeFile(path.join(f.destination, conflict === 'different-file' ? 'SKILL.md' : 'extra'), 'keep');
      }
    }
    const sentinel = conflict === 'parent-file' ? path.join(f.repo, '.agents')
      : conflict === 'destination-file' ? f.destination
        : path.join(f.destination, conflict === 'different-file' ? 'SKILL.md' : 'extra');
    const result = await run(['install', '--repo', f.repo, '--apply'], { sourceRoot: f.source });
    assert.equal(result.code, 1);
    if (conflict === 'empty-directory') assert.deepEqual(await fs.readdir(f.destination), []);
    else assert.equal(await fs.readFile(sentinel, 'utf8'), 'keep');
  });
}

test('refuses nonrepo, relative path, missing path and Git subdirectory', async () => {
  const f = await fixture({ git: false });
  assert.equal((await run(['install', '--repo', f.repo, '--apply'], { sourceRoot: f.source })).code, 1);
  await execute('git', ['init', '--quiet', '--template=', f.repo], { env: childEnv, windowsHide: true });
  const subdir = path.join(f.repo, 'child');
  await fs.mkdir(subdir);
  for (const repo of [subdir, 'relative', path.join(f.root, 'absent')]) {
    assert.equal((await run(['install', '--repo', repo, '--apply'], { sourceRoot: f.source })).code, 1);
  }
  assert.equal(await exists(path.join(f.repo, '.agents')), false);
});

test('source must have a regular SKILL.md before any repo writes', async () => {
  const f = await fixture();
  const empty = path.join(f.root, 'incomplete-source');
  await fs.mkdir(empty);
  const result = await run(['install', '--repo', f.repo, '--apply'], { sourceRoot: empty });
  assert.equal(result.code, 1);
  assert.equal(result.rows[0].code, 'MISSING_SKILL');
  assert.equal(await exists(path.join(f.repo, '.agents')), false);
});

for (const location of ['.agents', '.agents/skills', '.agents/skills/cloud-api-skill']) {
  test(`refuses linked destination or parent ${location}`, async t => {
    const f = await fixture();
    const outside = path.join(f.root, 'outside');
    await fs.mkdir(outside);
    const link = path.join(f.repo, location);
    await fs.mkdir(path.dirname(link), { recursive: true });
    if (!await linkOrSkip(t, outside, link)) return;
    assert.equal((await run(['install', '--repo', f.repo, '--apply'], { sourceRoot: f.source })).code, 1);
    assert.deepEqual(await fs.readdir(outside), []);
    assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
  });
}

test('refuses repo reached through symlink/junction ancestor', async t => {
  const f = await fixture();
  const link = path.join(f.root, 'alias');
  if (!await linkOrSkip(t, f.repo, link)) return;
  assert.equal((await run(['install', '--repo', link, '--apply'], { sourceRoot: f.source })).code, 1);
  assert.equal(await exists(path.join(f.repo, '.agents')), false);
});

test('refuses source directory link escaping snapshot', async t => {
  const f = await fixture();
  const outside = path.join(f.root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'private'), 'do not copy');
  if (!await linkOrSkip(t, outside, path.join(f.source, 'assets', 'escape'))) return;
  assert.equal((await run(['install', '--repo', f.repo, '--apply'], { sourceRoot: f.source })).code, 1);
  assert.equal(await exists(path.join(f.repo, '.agents')), false);
});

test('refuses file symlink even when its target is inside source', async t => {
  const f = await fixture();
  if (!await linkOrSkip(t, path.join(f.source, 'SKILL.md'), path.join(f.source, 'alias.md'), false)) return;
  assert.equal((await run(['install', '--repo', f.repo, '--apply'], { sourceRoot: f.source })).code, 1);
  assert.equal(await exists(path.join(f.repo, '.agents')), false);
});

test('refuses source root junction/symlink', async t => {
  const f = await fixture();
  const link = path.join(f.root, 'linked-source');
  if (!await linkOrSkip(t, f.source, link)) return;
  assert.equal((await run(['install', '--repo', f.repo, '--apply'], { sourceRoot: link })).code, 1);
  assert.equal(await exists(path.join(f.repo, '.agents')), false);
});

test('two installers cannot overwrite one another', async () => {
  const f = await fixture();
  const results = await Promise.all([run(['install', '--repo', f.repo, '--apply'], { sourceRoot: f.source }),
    run(['install', '--repo', f.repo, '--apply'], { sourceRoot: f.source })]);
  assert.equal(results.filter(result => result.rows[0].result === 'INSTALLED').length, 1);
  assert.equal(await fs.readFile(path.join(f.destination, '.hidden'), 'utf8'), 'full enclosing folder\n');
  assert.equal((await run(['install', '--repo', f.repo, '--apply'], { sourceRoot: f.source })).rows[0].result, 'UNCHANGED');
});

test('offline default checks only presence and never fetches, including whitespace placeholders', async () => {
  let fetched = false;
  const result = await run(['check'], { env: { ...fakeEnv, FISH_API_KEY: ' ', CLOUDFLARE_API_TOKEN: '' },
    fetchImpl: () => { fetched = true; throw new Error('unexpected'); } });
  assert.equal(result.code, 1);
  assert.equal(fetched, false);
  assert.deepEqual(result.rows[0].variables, [
    { name: 'CLOUDFLARE_API_TOKEN', status: 'MISSING' }, { name: 'CLOUDFLARE_ACCOUNT_ID', status: 'PRESENT' }]);
  assert.deepEqual(result.rows[1].variables, [{ name: 'FISH_API_KEY', status: 'PRESENT' }]);
  assert.equal(result.rows[0].requirements.some(text => text.includes('deployment')), true);
  assert.equal(result.rows[1].requirements.some(text => text.includes('cloud proxy substitution')), true);
});

test('requested provider selects only its variables; missing env is safe offline', async () => {
  const result = await run(['check', '--providers', 'fish']);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].variables, [{ name: 'FISH_API_KEY', status: 'MISSING' }]);
  assert.equal(result.output.includes('CLOUDFLARE'), false);
});

test('live sends fixed GETs, Bearer placeholders, redirect:error and timeout; never reads headers/body', async () => {
  const calls = [];
  let cancelled = 0;
  const result = await run(['check', '--providers', 'cloudflare,fish', '--live'], {
    env: { ...fakeEnv, NODE_USE_ENV_PROXY: '1' }, fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { status: 200, body: { cancel: async () => { cancelled++; } },
        get headers() { throw new Error('headers must not be read'); },
        text() { throw new Error('body must not be read'); }, json() { throw new Error('body must not be read'); } };
    },
  });
  assert.equal(result.code, 0);
  assert.deepEqual(result.rows, [
    { provider: 'cloudflare', httpStatus: 200, result: 'PASS' }, { provider: 'fish', httpStatus: 200, result: 'PASS' }]);
  assert.equal(calls[0].url, `https://api.cloudflare.com/client/v4/accounts/${fakeEnv.CLOUDFLARE_ACCOUNT_ID}/workers/scripts`);
  assert.equal(calls[1].url, 'https://api.fish.audio/model?page_size=1&self=true');
  for (const [index, { options }] of calls.entries()) {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.signal instanceof AbortSignal, true);
    assert.deepEqual(options.headers, { Authorization: `Bearer ${index === 0 ? fakeEnv.CLOUDFLARE_API_TOKEN : fakeEnv.FISH_API_KEY}` });
  }
  assert.equal(cancelled, 2);
});

for (const status of [401, 403, 302, 404, 429, 500, 201]) {
  test(`HTTP ${status} has a bounded result and exit code`, async () => {
    const result = await run(['check', '--providers', 'fish', '--live'], {
      env: fakeEnv, fetchImpl: async () => ({ status }),
    });
    const failed = [401, 403].includes(status);
    assert.deepEqual(result.rows, [{ provider: 'fish', httpStatus: status, result: failed ? 'FAIL' : 'INCONCLUSIVE' }]);
    assert.equal(result.code, failed ? 1 : 2);
  });
}

for (const account of ['../evil', 'a'.repeat(31), 'g'.repeat(32), `${'a'.repeat(32)}\n`, `a${'a'.repeat(31)}/scripts`]) {
  test('invalid Cloudflare account cannot create an injected request', async () => {
    let calls = 0;
    const result = await run(['check', '--providers', 'cloudflare', '--live'], {
      env: { ...fakeEnv, CLOUDFLARE_ACCOUNT_ID: account }, fetchImpl: async () => { calls++; },
    });
    assert.equal(calls, 0);
    assert.deepEqual(result.rows, [{ provider: 'cloudflare', httpStatus: null, result: 'INCONCLUSIVE' }]);
    assert.equal(result.code, 2);
  });
}

test('live missing credentials skips network and isolates providers', async () => {
  const calls = [];
  const result = await run(['check', '--live'], {
    env: { FISH_API_KEY: fakeEnv.FISH_API_KEY }, fetchImpl: async url => { calls.push(url); return { status: 200 }; },
  });
  assert.equal(calls.length, 1);
  assert.equal(result.code, 2);
  assert.equal(result.rows[0].result, 'INCONCLUSIVE');
  assert.equal(result.rows[1].result, 'PASS');
});

test('network/redirect exception messages and response diagnostics never appear in output', async () => {
  const result = await run(['check', '--live'], { env: fakeEnv, fetchImpl: async () => {
    throw new Error(`redirect Authorization Bearer ${fakeEnv.FISH_API_KEY} https://sensitive.invalid`);
  } });
  assert.equal(result.code, 2);
  assert.equal(result.output.includes('sensitive.invalid'), false);
  assert.deepEqual(result.rows.map(row => row.result), ['INCONCLUSIVE', 'INCONCLUSIVE']);
});

test('malformed native proxy config fails closed without leaking proxy credentials or fetching', async () => {
  // Invalid bracketed host makes the native proxy setter throw before fetch;
  // the real fetch function is selected only to exercise proxy setup, never called.
  const result = await run(['check', '--live'], {
    env: { ...fakeEnv, NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: `http://[${fakeEnv.FISH_API_KEY}` },
  });
  assert.equal(result.code, 2);
  assert.deepEqual(result.rows, [
    { provider: 'cloudflare', httpStatus: null, result: 'INCONCLUSIVE' },
    { provider: 'fish', httpStatus: null, result: 'INCONCLUSIVE' },
  ]);
});

test('timeout signal aborts mocked request with safe INCONCLUSIVE output', async () => {
  const timer = setTimeout(() => {}, 1000); // Keep Node alive while AbortSignal's unref timer fires.
  try {
    const result = await run(['check', '--providers', 'fish', '--live'], {
      env: fakeEnv, timeoutMs: 5, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error(fakeEnv.FISH_API_KEY)), { once: true });
      }),
    });
    assert.equal(result.code, 2);
    assert.deepEqual(result.rows, [{ provider: 'fish', httpStatus: null, result: 'INCONCLUSIVE' }]);
  } finally { clearTimeout(timer); }
});

test('malformed response and stream cancellation errors are not logged', async () => {
  assert.deepEqual(await check(['fish'], true, { env: fakeEnv, fetchImpl: async () => ({ status: '200' }) }),
    [{ provider: 'fish', httpStatus: null, result: 'INCONCLUSIVE' }]);
  const result = await run(['check', '--providers', 'fish', '--live'], {
    env: fakeEnv, fetchImpl: async () => ({ status: 200, body: { cancel: async () => { throw new Error(fakeEnv.FISH_API_KEY); } } }),
  });
  assert.equal(result.code, 0);
});

test('argument errors never reflect caller input and never invoke fetch', async () => {
  for (const args of [[], ['unknown'], ['check', '--providers'], ['check', '--providers', 'runway'],
    ['check', '--providers', 'fish,fish'], ['check', '--providers', '__proto__'], ['check', '--apply'],
    ['install', '--repo'], ['install', '--live'], ['check', '--live', '--live'],
    ['check', fakeEnv.FISH_API_KEY]]) {
    const result = await run(args, { fetchImpl: () => assert.fail('unexpected fetch') });
    assert.equal(result.code, 1);
    assert.equal(result.rows[0].result, 'ERROR');
  }
});

test('portable CLI works from copied enclosing folder in a fresh repo and returns safe stdout', async () => {
  const f = await fixture();
  await fs.mkdir(path.join(f.source, 'scripts'));
  await fs.copyFile(script, path.join(f.source, 'scripts', 'cloud-api.mjs'));
  const entry = path.join(f.source, 'scripts', 'cloud-api.mjs');
  for (const [flags, expected] of [[[], 'DRY_RUN'], [['--apply'], 'INSTALLED'], [['--apply'], 'UNCHANGED']]) {
    const result = await execute(process.execPath, [entry, 'install', '--repo', f.repo, ...flags],
      { env: childEnv, windowsHide: true });
    assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).result, expected);
  }
  const result = await execute(process.execPath,
    [path.join(f.destination, 'scripts', 'cloud-api.mjs'), 'check', '--providers', 'fish'],
    { env: { ...childEnv, FISH_API_KEY: fakeEnv.FISH_API_KEY }, windowsHide: true });
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes(fakeEnv.FISH_API_KEY), false);
  assert.deepEqual(JSON.parse(result.stdout).variables, [{ name: 'FISH_API_KEY', status: 'PRESENT' }]);
});

// Fixtures remain confined to tempRoot. No recursive delete of any directory,
// source package, existing destination or another worker's files is performed.
