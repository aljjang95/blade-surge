#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { devNull, homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import config from './release-config.json' with { type: 'json' };

const rootDirectory = fileURLToPath(new URL('..', import.meta.url));
const repository = 'aljjang95/blade-surge';
const sha = /^[a-f0-9]{40}$/;
const providers = {
  cloudflare: [], runware: ['RUNWARE_API_KEY'], runway: ['RUNWAYML_API_SECRET', 'RUNWAY_API_SECRET'],
  'fish-audio': ['FISH_API_KEY', 'FISH_AUDIO_API_KEY'],
};
const credentialKeys = Object.values(providers).flat();
const systemKeys = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'windir', 'COMSPEC', 'ComSpec',
  'PATHEXT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA'];
const commands = ['bind', 'doctor', 'check', 'build', 'deploy', 'reconcile', 'media-auth', 'probe-media', 'password-metadata'];
const messages = {
  REQUEST: 'Command, route or expected HEAD is invalid.',
  PROFILE: 'Local profile is missing, invalid or not private.',
  BINDING: 'Checkout path or canonical remote does not match.',
  HEAD: 'Checkout HEAD differs from expected HEAD.',
  DIRTY: 'Deployment requires clean tracked and untracked source.',
  ROUTE: 'The explicitly selected credential route is unavailable.',
  SOURCE: 'Configured credential source is unavailable or invalid.',
  CHILD: 'Local command failed or returned an invalid response.',
};
class BridgeError extends Error {
  constructor(code) { super(messages[code]); this.code = code; }
}
const fail = (code) => { throw new BridgeError(code); };
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, allowed) => object(value) && Object.keys(value).every((key) => allowed.includes(key));
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const absolutePath = (value) => typeof value === 'string' && isAbsolute(value) && !/[\x00-\x1f]/.test(value);

// 시스템 경로만 이름으로 읽는다. 부모 환경의 인증 값과 실행기 옵션을 상속하지 않는다.
/** @returns {Record<string, string>} */
export function childEnvironment(parent = process.env) {
  const env = {};
  for (const key of systemKeys) if (typeof parent[key] === 'string') env[key] = parent[key];
  env.WRANGLER_SEND_METRICS = 'false';
  return env;
}

export function parseRequest(args) {
  if (!Array.isArray(args) || !commands.includes(args[0])) fail('REQUEST');
  /** @type {Record<string, string>} */
  const request = { command: args[0] };
  const flags = { '--expected-head': 'expectedHead', '--route': 'route', '--provider': 'provider', '--profile': 'profilePath',
    '--fish-dpapi': 'fishDpapiPath', '--password-csv': 'passwordCsvPath' };
  for (let i = 1; i < args.length; i++) {
    const [flag, ...parts] = args[i].split('=');
    const key = flags[flag];
    if (!key || Object.hasOwn(request, key)) fail('REQUEST');
    const value = parts.length ? parts.join('=') : args[++i];
    if (typeof value !== 'string' || !value || value.startsWith('--')) fail('REQUEST');
    request[key] = value;
  }
  if (!sha.test(request.expectedHead ?? '') || (request.profilePath && !absolutePath(request.profilePath))) fail('REQUEST');
  if (request.fishDpapiPath !== undefined || request.passwordCsvPath !== undefined) {
    if (request.command !== 'bind' || (request.fishDpapiPath !== undefined && !absolutePath(request.fishDpapiPath))
      || (request.passwordCsvPath !== undefined && !absolutePath(request.passwordCsvPath))) fail('REQUEST');
  }
  const required = ['doctor', 'deploy', 'reconcile'].includes(request.command) ? 'wrangler'
    : request.command === 'password-metadata' ? 'chrome' : 'local';
  if (['media-auth', 'probe-media'].includes(request.command)) {
    if (!['dotenv', 'dpapi'].includes(request.route) || !Object.hasOwn(providers, request.provider ?? '') || request.provider === 'cloudflare') fail('REQUEST');
  } else if (request.route !== required || request.provider !== undefined) fail('REQUEST');
  return request;
}

export function validateProfile(profile) {
  if (!exactKeys(profile, ['version', 'repository', 'checkout', 'providers', 'passwordCsvPath'])
    || profile.version !== 1 || profile.repository !== repository || !absolutePath(profile.checkout)
    || !exactKeys(profile.providers, Object.keys(providers))
    || (profile.passwordCsvPath !== undefined && !absolutePath(profile.passwordCsvPath))) fail('PROFILE');
  for (const [alias, entry] of Object.entries(profile.providers)) {
    if (alias === 'cloudflare') {
      if (!exactKeys(entry, ['route']) || entry.route !== 'wrangler') fail('PROFILE');
    } else if (!exactKeys(entry, ['route', 'path', 'keys']) || !['dotenv', 'dpapi'].includes(entry.route)
      || !absolutePath(entry.path) || !Array.isArray(entry.keys) || entry.keys.length === 0
      || entry.keys.length !== new Set(entry.keys).size || entry.keys.some((key) => !providers[alias].includes(key))
      || (entry.route === 'dpapi' && entry.keys.length !== 1)) fail('PROFILE');
  }
  return profile;
}

// 단순 KEY=value만 지원한다. 중복, 보간, 셸 문법, 멀티라인과 알 수 없는 키는 거부한다.
export function parseDotenv(text, selected) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65536 || !Array.isArray(selected)
    || selected.length === 0 || selected.some((key) => !credentialKeys.includes(key)) || new Set(selected).size !== selected.length) fail('SOURCE');
  const values = {};
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || !credentialKeys.includes(match[1]) || Object.hasOwn(values, match[1])) fail('SOURCE');
    let value = match[2];
    if (value.startsWith('"') || value.startsWith("'")) {
      if (value.length < 3 || value.at(-1) !== value[0]) fail('SOURCE');
      value = value.slice(1, -1);
    } else if (/\s/.test(value)) fail('SOURCE');
    if (!value || /[\x00-\x1f\x7f$`\\'"#]/.test(value)) fail('SOURCE');
    values[match[1]] = value;
  }
  if (selected.some((key) => !values[key])) fail('SOURCE');
  return Object.fromEntries(selected.map((key) => [key, values[key]]));
}

export function runBridge(args, options = {}) {
  try {
    const request = parseRequest(args);
    const root = realpathSync(options.root ?? rootDirectory);
    if (!samePath(root, realpathSync(options.cwd ?? process.cwd()))) fail('BINDING');
    const parent = options.env ?? process.env;
    const env = childEnvironment(parent);
    const runner = options.runner ?? execFileSync;
    const run = (file, argv, childEnv = env, input, timeout = 15000) => {
      try {
        const output = runner(file, argv, { cwd: root, env: childEnv, input, encoding: 'utf8', shell: false,
          stdio: ['pipe', 'pipe', 'pipe'], timeout, maxBuffer: 1048576, windowsHide: true });
        if (typeof output !== 'string' || Buffer.byteLength(output) > 1048576) fail('CHILD');
        return output;
      } catch { fail('CHILD'); }
    };
    const git = (...argv) => run('git', argv).trim();
    const profilePath = request.profilePath ?? resolve(homedir(), '.apex/pc-bridge/profiles.local.json');
    const privateFile = (path, code, mustExist = true) => {
      if (!absolutePath(path)) fail(code);
      const relativePath = relative(root, path);
      if (relativePath === '' || (!relativePath.startsWith('..' + sep) && relativePath !== '..' && !isAbsolute(relativePath))) {
        if (git('ls-files', '--', relativePath) !== '') fail(code);
        try { git('check-ignore', '--', relativePath); } catch { fail(code); }
      }
      try {
        if (!samePath(resolve(path), realpathSync(path)) || !statSync(path).isFile()) fail(code);
        return true;
      } catch (error) {
        if (!mustExist && error.code === 'ENOENT') return false;
        fail(code);
      }
    };
    const boundedRead = (path, code) => {
      privateFile(path, code);
      try { if (statSync(path).size > 65536) fail(code); return readFileSync(path, 'utf8'); }
      catch { fail(code); }
    };
    // 스키마가 잘못된 프로필은 Git나 인증 명령을 시작하기 전에 거부한다.
    let profile, existingProfile = true;
    try {
      if (statSync(profilePath).size > 65536) fail('PROFILE');
      profile = validateProfile(JSON.parse(readFileSync(profilePath, 'utf8')));
    } catch (error) {
      if (request.command !== 'bind' || error.code !== 'ENOENT') fail('PROFILE');
      existingProfile = false;
      profile = { version: 1, repository, checkout: root, providers: { cloudflare: { route: 'wrangler' } } };
    }
    if (request.command !== 'bind') {
      try { if (!samePath(root, realpathSync(profile.checkout))) fail('BINDING'); }
      catch { fail('BINDING'); }
    }
    const remotes = ['https://github.com/aljjang95/blade-surge', 'https://github.com/aljjang95/blade-surge.git',
      'git@github.com:aljjang95/blade-surge.git', 'ssh://git@github.com/aljjang95/blade-surge.git'];
    if (!samePath(root, realpathSync(git('rev-parse', '--show-toplevel')))
      || !remotes.includes(git('remote', 'get-url', '--all', 'origin'))
      || !remotes.includes(git('remote', 'get-url', '--push', '--all', 'origin'))) fail('BINDING');
    privateFile(profilePath, 'PROFILE', existingProfile);
    const head = git('rev-parse', 'HEAD');
    if (!sha.test(head) || head !== request.expectedHead) fail('HEAD');
    const requireClean = () => { if (git('status', '--porcelain=v1', '--untracked-files=all') !== '') fail('DIRTY'); };
    const result = { ok: true, command: request.command, repository, head, route: request.route };
    if (request.command === 'bind') {
      const next = { ...profile, checkout: root, providers: { ...profile.providers } };
      if (request.fishDpapiPath) {
        privateFile(request.fishDpapiPath, 'SOURCE');
        next.providers['fish-audio'] = { route: 'dpapi', path: request.fishDpapiPath, keys: ['FISH_API_KEY'] };
      }
      if (request.passwordCsvPath) {
        privateFile(request.passwordCsvPath, 'SOURCE');
        next.passwordCsvPath = request.passwordCsvPath;
      }
      validateProfile(next);
      const directory = dirname(profilePath);
      try {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        if (!samePath(resolve(directory), realpathSync(directory))) fail('PROFILE');
        const backup = profilePath + '.' + randomUUID() + '.backup.local.json';
        const temporary = profilePath + '.' + randomUUID() + '.tmp.local.json';
        if (existingProfile) {
          privateFile(backup, 'PROFILE', false);
          writeFileSync(backup, JSON.stringify(profile, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        }
        privateFile(temporary, 'PROFILE', false);
        writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        renameSync(temporary, profilePath);
      } catch { fail('PROFILE'); }
      return { ...result, profileBound: true, backupCreated: existingProfile };
    }
    const json = (text) => { try { return JSON.parse(text); } catch { fail('CHILD'); } };
    const node = (file, argv = [], childEnv = env, timeout = 15000) => run(process.execPath, [resolve(root, file), ...argv], childEnv, undefined, timeout);
    if (['doctor', 'deploy', 'reconcile'].includes(request.command)) {
      if (profile.providers.cloudflare?.route !== 'wrangler') fail('ROUTE');
      if (request.command !== 'doctor') {
        requireClean();
        // 항상 기존 lease/guard/reconciliation 도구로만 진입한다.
        node('tools/deploy.mjs', ['--auth=wrangler', ...(request.command === 'reconcile' ? ['--reconcile'] : [])], env, 300000);
        return { ...result, completed: true };
      }
      const wrangler = (argv) => json(node('node_modules/wrangler/bin/wrangler.js', [...argv, '--env-file', devNull]));
      const checks = { whoami: 'failed', database: 'failed', leaseRead: 'not-probed' };
      let leaseHeld = null;
      try {
        const who = wrangler(['whoami', '--json']);
        if (!object(who) || !Array.isArray(who.accounts) || who.accounts.length === 0
          || who.accounts.some((account) => !object(account) || !/^[a-f0-9]{32}$/.test(account.id))) fail('CHILD');
        checks.whoami = 'passed';
      } catch { /* 고정 상태만 기록하고 독립 D1 검사를 계속한다. */ }
      try {
        const info = wrangler(['d1', 'info', 'apex-rsi', '--json']);
        if (!object(info) || info.uuid !== config.leaseDatabaseId || info.name !== 'apex-rsi') fail('CHILD');
        checks.database = 'passed';
        checks.leaseRead = 'failed';
        const lease = wrangler(['d1', 'execute', config.leaseDatabaseId, '--remote', '--json', '--command',
          "SELECT session FROM rsi_claim WHERE repo = 'aljjang95/blade-surge' AND axis = 'DEPLOY-blade-surge'"]);
        if (!Array.isArray(lease) || lease.length !== 1 || lease[0]?.success !== true || lease[0]?.meta?.changes !== 0
          || !Array.isArray(lease[0]?.results) || lease[0].results.length > 1
          || lease[0].results.some((row) => !exactKeys(row, ['session']) || typeof row.session !== 'string'
            || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(row.session))) fail('CHILD');
        leaseHeld = lease[0].results.length === 1;
        checks.leaseRead = 'passed';
      } catch { /* 인증 값, SQL 결과와 예외 원문은 반환하지 않는다. */ }
      const ok = Object.values(checks).every((value) => value === 'passed');
      return { ...result, ok, ...(ok ? {} : { code: 'CHILD', message: messages.CHILD }), checks,
        authenticated: checks.whoami === 'passed', leaseDatabaseVerified: checks.database === 'passed', leaseHeld,
        providers: Object.fromEntries(Object.keys(providers).map((alias) => [alias, {
          configured: Boolean(profile.providers[alias]),
          status: alias === 'cloudflare' ? (checks.whoami === 'passed' ? 'authenticated' : 'failed')
            : (profile.providers[alias] ? 'not-probed' : 'unavailable'),
        }])) };
    }
    if (request.command === 'check' || request.command === 'build') {
      // package.json의 기존 Bun 스크립트만 사용한다. 임의 argv나 셸을 받지 않는다.
      run('bun', ['run', request.command], env, undefined, 300000);
      return { ...result, completed: true };
    }
    if (request.command === 'password-metadata') {
      if (!profile.passwordCsvPath) fail('ROUTE');
      return { ...result, available: privateFile(profile.passwordCsvPath, 'SOURCE', false), contentsRead: false, passwordUse: 'device-chrome-manager' };
    }
    const entry = profile.providers[request.provider];
    if (!entry || entry.route !== request.route) fail('ROUTE');
    if (request.command === 'probe-media' && request.provider !== 'fish-audio') fail('ROUTE');
    privateFile(entry.path, 'SOURCE');
    let readiness;
    if (entry.route === 'dotenv') {
      const selected = parseDotenv(boundedRead(entry.path, 'SOURCE'), entry.keys);
      const childEnv = { ...env, ...selected };
      try {
        const probe = request.command === 'probe-media'
          ? 'const keys=JSON.parse(process.argv[1]);let httpStatus=null;try{const r=await fetch("https://api.fish.audio/model?page_size=1&self=true",{headers:{Authorization:"Bearer "+process.env[keys[0]]},redirect:"error",signal:AbortSignal.timeout(8000)});httpStatus=r.status;await r.body?.cancel();}catch{}process.stdout.write(JSON.stringify({selectedKeyCount:keys.length,providerSuccess:httpStatus>=200&&httpStatus<300,httpStatus}));'
          : 'const keys=JSON.parse(process.argv[1]);process.stdout.write(JSON.stringify({selectedKeyCount:keys.filter(k=>Boolean(process.env[k])).length,providerSuccess:false}));';
        readiness = json(run(process.execPath, ['-e', probe, JSON.stringify(entry.keys)], childEnv));
      } finally { for (const key of entry.keys) { delete childEnv[key]; delete selected[key]; } }
    } else {
      if (process.platform !== 'win32') fail('ROUTE');
      // DPAPI 키는 PowerShell 자식 안에서만 해독/주입하고 stdout에는 개수만 돌려준다.
      const powershell = resolve(parent.SystemRoot ?? parent.SYSTEMROOT ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
      readiness = json(run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', resolve(root, 'tools/pc-bridge-dpapi.ps1')],
        env, JSON.stringify({ path: entry.path, keys: entry.keys, provider: request.provider, action: request.command })));
    }
    if (!exactKeys(readiness, ['selectedKeyCount', 'providerSuccess', 'dpapiReadable', 'httpStatus']) || readiness.selectedKeyCount !== entry.keys.length
      || (entry.route === 'dpapi' && readiness.dpapiReadable !== true)) fail('CHILD');
    if (request.command === 'probe-media') {
      const status = readiness.httpStatus;
      if (status !== null && (!Number.isInteger(status) || status < 100 || status > 599)) fail('CHILD');
      if (readiness.providerSuccess !== (status !== null && status >= 200 && status < 300)) fail('CHILD');
      return { ...result, provider: request.provider, selectedKeyCount: entry.keys.length, dpapiReadable: entry.route === 'dpapi',
        providerSuccess: readiness.providerSuccess, httpStatus: status, ok: readiness.providerSuccess,
        ...(readiness.providerSuccess ? {} : { code: 'CHILD', message: messages.CHILD }) };
    }
    if (readiness.providerSuccess !== false || readiness.httpStatus !== undefined) fail('CHILD');
    return { ...result, provider: request.provider, selectedKeyCount: entry.keys.length,
      dpapiReadable: entry.route === 'dpapi', providerSuccess: false };
  } catch (error) {
    const code = error instanceof BridgeError ? error.code : 'CHILD';
    return { ok: false, code, message: messages[code] };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = runBridge(process.argv.slice(2));
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}
