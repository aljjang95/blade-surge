#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as http from 'node:http';

const execute = promisify(execFile);
const sourceDefault = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const providers = {
  cloudflare: {
    variables: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'],
    requirements: ['Account ID: 32 hexadecimal characters.', 'Account Workers Scripts read permission.',
      'HTTP 200 verifies only this endpoint authentication; deployment and cloud proxy substitution remain unverified.'],
  },
  fish: {
    variables: ['FISH_API_KEY'],
    requirements: ['Access to the authenticated model listing endpoint.',
      'HTTP 200 verifies only this endpoint authentication; media generation and cloud proxy substitution remain unverified.'],
  },
};

class SafeError extends Error {}
function refuse(code) { throw new SafeError(code); }
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
async function statOrMissing(target) {
  try { return await fs.lstat(target); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// Include the volume-root ancestry: Windows junctions above the repo are unsafe too.
async function safeParents(target) {
  const absolute = path.resolve(target);
  const root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await statOrMissing(current);
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isDirectory()) refuse('UNSAFE_DIRECTORY');
    if (path.relative(current, await fs.realpath(current)) !== '') refuse('UNSAFE_DIRECTORY');
  }
}

// Capture every regular file before writing; later writes never follow source paths.
async function snapshot(root) {
  await safeParents(root);
  const canonical = await fs.realpath(root);
  const entries = new Map();
  async function visit(directory, relative = '') {
    for (const name of (await fs.readdir(directory)).sort()) {
      const target = path.join(directory, name);
      const key = path.join(relative, name);
      if (!inside(canonical, target)) refuse('SOURCE_TRAVERSAL');
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink()) refuse('UNSAFE_SOURCE');
      if (!inside(canonical, await fs.realpath(target))) refuse('SOURCE_TRAVERSAL');
      if (stat.isDirectory()) {
        entries.set(key, null);
        await visit(target, key);
      } else if (stat.isFile()) {
        const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const opened = await handle.stat();
          if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) refuse('SOURCE_CHANGED');
          const bytes = await handle.readFile();
          const after = await handle.stat();
          if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || bytes.length !== opened.size) refuse('SOURCE_CHANGED');
          entries.set(key, bytes);
        } finally { await handle.close(); }
      } else refuse('UNSAFE_SOURCE');
    }
  }
  await visit(canonical);
  if (!entries.has('SKILL.md') || entries.get('SKILL.md') === null) refuse('MISSING_SKILL');
  return entries;
}

function identical(left, right) {
  return left.size === right.size && [...left].every(([key, bytes]) => {
    const other = right.get(key);
    return bytes === null ? right.has(key) && other === null : Buffer.isBuffer(other) && bytes.equals(other);
  });
}

export async function install(repo, apply, sourceRoot = sourceDefault) {
  if (!repo || !path.isAbsolute(repo)) refuse('ABSOLUTE_REPO_REQUIRED');
  repo = path.resolve(repo);
  await safeParents(repo);
  let root;
  try {
    const result = await execute('git', ['-C', repo, 'rev-parse', '--show-toplevel'],
      { shell: false, windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 });
    root = await fs.realpath(result.stdout.trim());
  } catch { refuse('GIT_ROOT_REQUIRED'); }
  if (path.relative(repo, root) !== '') refuse('GIT_ROOT_REQUIRED');
  const destination = path.join(root, '.agents', 'skills', 'cloud-api-skill');
  if (!inside(root, destination)) refuse('DESTINATION_OUTSIDE_REPO');
  await safeParents(path.dirname(destination));
  const source = await snapshot(path.resolve(sourceRoot));
  const existing = await statOrMissing(destination);
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) refuse('DESTINATION_CONFLICT');
    if (!identical(source, await snapshot(destination))) refuse('DESTINATION_CONFLICT');
    return { command: 'install', result: 'UNCHANGED' };
  }
  if (!apply) return { command: 'install', result: 'DRY_RUN' };

  // Exclusive mkdir reserves the final directory. Rename can replace somebody
  // else's empty directory on POSIX, so never publish using that operation.
  let current = root;
  for (const name of ['.agents', 'skills']) {
    current = path.join(current, name);
    await safeParents(current);
    try { await fs.mkdir(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await safeParents(current);
  }
  await safeParents(path.dirname(destination));
  await fs.mkdir(destination); // Refuse concurrent installers, even an empty directory.
  for (const [relative, bytes] of source) {
    const target = path.join(destination, relative);
    await safeParents(path.dirname(target));
    if (bytes === null) await fs.mkdir(target);
    else await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
  }
  // I/O failures retain partial files for inspection; no recursive cleanup.
  return { command: 'install', result: 'INSTALLED' };
}

function present(env, name) { return typeof env[name] === 'string' && env[name] !== ''; }
export async function check(names, live, { env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const rows = [];
  let restore;
  let proxyFailed = false;
  if (live && fetchImpl === globalThis.fetch && env.NODE_USE_ENV_PROXY === '1') {
    try {
      if (typeof http.setGlobalProxyFromEnv !== 'function') proxyFailed = true;
      else restore = http.setGlobalProxyFromEnv(env);
    } catch { proxyFailed = true; }
  }
  try {
    for (const provider of names) {
      if (!Object.hasOwn(providers, provider)) refuse('UNKNOWN_PROVIDER');
      const spec = providers[provider];
      if (!live) {
        rows.push({ provider, variables: spec.variables.map(name => ({ name, status: present(env, name) ? 'PRESENT' : 'MISSING' })),
          requirements: spec.requirements });
        continue;
      }
      const row = { provider, httpStatus: null, result: 'INCONCLUSIVE' };
      rows.push(row);
      if (proxyFailed || !spec.variables.every(name => present(env, name))) continue;
      const account = env.CLOUDFLARE_ACCOUNT_ID;
      if (provider === 'cloudflare' && (account.length !== 32 || !/^[a-fA-F0-9]{32}$/.test(account))) continue;
      const url = provider === 'cloudflare'
        ? `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts`
        : 'https://api.fish.audio/model?page_size=1&self=true';
      const token = env[provider === 'cloudflare' ? 'CLOUDFLARE_API_TOKEN' : 'FISH_API_KEY'];
      try {
        const response = await fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` },
          redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
        if (Number.isInteger(response.status) && response.status >= 100 && response.status <= 599) {
          row.httpStatus = response.status;
          row.result = response.status === 200 ? 'PASS'
            : [401, 403].includes(response.status) ? 'FAIL' : 'INCONCLUSIVE';
        }
        // Discard the stream without reading or logging bodies or headers.
        try { await response.body?.cancel(); } catch { /* no provider diagnostics */ }
      } catch { /* fixed safe result for network errors, redirects and timeouts */ }
    }
  } finally { restore?.(); }
  return rows;
}

function parse(args) {
  const [command, ...rest] = args;
  const options = { command, apply: false, live: false, names: ['cloudflare', 'fish'] };
  const seen = new Set();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (seen.has(flag)) refuse('INVALID_ARGUMENTS');
    seen.add(flag);
    if (command === 'install' && flag === '--apply') options.apply = true;
    else if (command === 'install' && flag === '--repo') options.repo = rest[++i];
    else if (command === 'check' && flag === '--live') options.live = true;
    else if (command === 'check' && flag === '--providers') {
      const value = rest[++i];
      options.names = value?.split(',');
      if (!options.names?.length || options.names.some(name => !Object.hasOwn(providers, name))
          || new Set(options.names).size !== options.names.length) refuse('UNKNOWN_PROVIDER');
    } else refuse('INVALID_ARGUMENTS');
  }
  if (!['install', 'check'].includes(command)) refuse('INVALID_COMMAND');
  return options;
}

export async function main(args, { write = line => console.log(line), ...dependencies } = {}) {
  try {
    const options = parse(args);
    const rows = options.command === 'install'
      ? [await install(options.repo, options.apply, dependencies.sourceRoot)]
      : await check(options.names, options.live, dependencies);
    for (const row of rows) write(JSON.stringify(row));
    return rows.some(row => row.result === 'FAIL' || row.variables?.some(variable => variable.status === 'MISSING'))
      ? 1 : rows.some(row => row.result === 'INCONCLUSIVE') ? 2 : 0;
  } catch (error) {
    write(JSON.stringify({ result: 'ERROR', code: error instanceof SafeError ? error.message : 'OPERATION_FAILED' }));
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
