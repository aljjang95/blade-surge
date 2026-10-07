import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { devNull } from 'node:os';
import { childEnvironment, parseDotenv, parseRequest, runBridge, validateProfile } from '../tools/pc-bridge.mjs';
import release from '../tools/release-config.json';

const workspace = realpathSync(resolve(import.meta.dir, '..'));
const tempRoot = resolve(workspace, 'work/pc-bridge-fixtures');
// Windows/Bun의 cwd 핸들은 종료까지 남을 수 있다. 합성 fixture는 ignored work/에
// 보존하며 테스트 프로세스 종료 후 부모가 범위를 확인해 별도로 정리한다.
function fixture() {
  mkdirSync(tempRoot, { recursive: true });
  const root = realpathSync(mkdtempSync(resolve(tempRoot, 'case-')));
  const env = childEnvironment(process.env);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }).trim();
  git('init', '--quiet');
  git('remote', 'add', 'origin', 'https://github.com/aljjang95/blade-surge.git');
  writeFileSync(resolve(root, '.gitignore'), '.apex/\n*.local.json\n*.dpapi\n.env*\nwork/\n');
  writeFileSync(resolve(root, 'source.txt'), 'baseline');
  git('add', '.');
  git('-c', 'user.name=Bridge Test', '-c', 'user.email=bridge@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture');
  const head = git('rev-parse', 'HEAD');
  const profilePath = resolve(root, '.apex/pc-bridge/profiles.local.json');
  mkdirSync(dirname(profilePath), { recursive: true });
  const profile: any = { version: 1, repository: 'aljjang95/blade-surge', checkout: root, providers: { cloudflare: { route: 'wrangler' } } };
  const save = () => writeFileSync(profilePath, JSON.stringify(profile));
  save();
  if (process.cwd() !== workspace) throw new Error('Fixture changed process cwd');
  const calls: { file: string; args: string[]; options: any }[] = [];
  const runner = (file: string, args: string[], options: any) => {
    calls.push({ file, args, options: { ...options, env: { ...options.env } } });
    if (file === 'git') return execFileSync(file, args, options) as string;
    if (args.includes('whoami')) return JSON.stringify({ email: 'PRIVATE@example.invalid', accounts: [{ id: 'a'.repeat(32), name: 'PRIVATE' }] });
    if (args.includes('info')) return JSON.stringify({ uuid: release.leaseDatabaseId, name: 'apex-rsi', account_id: 'PRIVATE' });
    if (args.includes('execute')) return JSON.stringify([{ success: true, results: [], meta: { changes: 0 } }]);
    return 'PRIVATE child output';
  };
  const args = (command: string, route = 'wrangler', extra: string[] = []) => [command, '--expected-head', head, '--route', route, '--profile', profilePath, ...extra];
  const run = (command: string, route = 'wrangler', extra: string[] = [], override: any = {}) => runBridge(args(command, route, extra), { root, cwd: root, env, runner, ...override });
  const children = () => calls.filter((call) => call.file !== 'git');
  return { root, env, git, head, profilePath, profile, save, calls, runner, args, run, children };
}

test('strict command/route/head parser rejects bypasses and duplicate flags before execution', () => {
  const f = fixture();
  for (const args of [[], ['login'], f.args('deploy').concat('--force'), f.args('deploy').concat('--route=wrangler'),
    f.args('deploy').concat('--auth=token'), f.args('deploy').concat('--command=whoami'),
    ['deploy', '--route=wrangler', '--expected-head=HEAD'], ['deploy', '--route=wrangler', '--expected-head=' + 'a'.repeat(39)],
    ['deploy', '--route=wrangler', '--expected-head=' + 'A'.repeat(40)], ['deploy', '--expected-head=' + f.head],
    f.args('build', 'wrangler'), f.args('doctor', 'local'), f.args('deploy').concat('--fish-dpapi=' + f.profilePath)]) {
    expect(runBridge(args, { root: f.root, cwd: f.root, runner: f.runner }).ok).toBe(false);
  }
  expect(f.calls).toHaveLength(0);
  expect(parseRequest(f.args('deploy')).route).toBe('wrangler');
});

test('canonical remote including push URL, exact checkout and cwd are bound', () => {
  const f = fixture();
  f.profile.checkout = dirname(f.root); f.save();
  expect(f.run('doctor')).toMatchObject({ ok: false, code: 'BINDING' });
  f.profile.checkout = f.root; f.save();
  expect(f.run('doctor', 'wrangler', [], { cwd: workspace })).toMatchObject({ ok: false, code: 'BINDING' });
  f.git('remote', 'set-url', 'origin', 'https://github.com/other/blade-surge.git');
  expect(f.run('doctor')).toMatchObject({ ok: false, code: 'BINDING' });
  f.git('remote', 'set-url', 'origin', 'https://github.com/aljjang95/blade-surge.git');
  f.git('remote', 'set-url', '--push', 'origin', 'https://github.com/other/blade-surge.git');
  expect(f.run('doctor')).toMatchObject({ ok: false, code: 'BINDING' });
  expect(f.children()).toHaveLength(0);
});

test('exact-head mismatch blocks authentication and deployment before children', () => {
  const f = fixture();
  for (const command of ['doctor', 'deploy', 'reconcile']) {
    const args = f.args(command); args[2] = 'f'.repeat(40);
    expect(runBridge(args, { root: f.root, cwd: f.root, runner: f.runner })).toMatchObject({ ok: false, code: 'HEAD' });
  }
  expect(f.children()).toHaveLength(0);
});

test('tracked modifications, staged edits and all untracked source block deploy and reconcile', () => {
  const f = fixture();
  for (const command of ['deploy', 'reconcile']) {
    writeFileSync(resolve(f.root, 'source.txt'), 'changed');
    expect(f.run(command)).toMatchObject({ ok: false, code: 'DIRTY' });
    f.git('add', 'source.txt');
    expect(f.run(command)).toMatchObject({ ok: false, code: 'DIRTY' });
    f.git('restore', '--staged', 'source.txt'); f.git('restore', 'source.txt');
    mkdirSync(resolve(f.root, 'nested'), { recursive: true });
    writeFileSync(resolve(f.root, 'nested/untracked.txt'), 'untracked');
    expect(f.run(command)).toMatchObject({ ok: false, code: 'DIRTY' });
    rmSync(resolve(f.root, 'nested/untracked.txt'));
  }
  expect(f.children()).toHaveLength(0);
});

test('clean deployment enters only existing guard with explicit Wrangler auth; reconcile flag is fixed', () => {
  const f = fixture();
  expect(f.run('deploy')).toMatchObject({ ok: true, completed: true });
  expect(f.run('reconcile')).toMatchObject({ ok: true, completed: true });
  expect(f.children().map((call) => call.args)).toEqual([
    [resolve(f.root, 'tools/deploy.mjs'), '--auth=wrangler'],
    [resolve(f.root, 'tools/deploy.mjs'), '--auth=wrangler', '--reconcile'],
  ]);
  for (const call of f.children()) expect(call.options).toMatchObject({ shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], timeout: 300000, maxBuffer: 1048576 });
});

test('missing profile, absent provider or conflicting route has no authentication fallback', () => {
  const f = fixture();
  delete f.profile.providers.cloudflare; f.save();
  expect(f.run('deploy')).toMatchObject({ ok: false, code: 'ROUTE' });
  expect(f.run('media-auth', 'dotenv', ['--provider=runware'])).toMatchObject({ ok: false, code: 'ROUTE' });
  f.profile.providers.runware = { route: 'dotenv', path: resolve(f.root, '.env.media'), keys: ['RUNWARE_API_KEY'] }; f.save();
  expect(f.run('media-auth', 'dpapi', ['--provider=runware'])).toMatchObject({ ok: false, code: 'ROUTE' });
  rmSync(f.profilePath);
  expect(f.run('doctor')).toMatchObject({ ok: false, code: 'PROFILE' });
  expect(f.children()).toHaveLength(0);
});

test('tampered profile and unexpected keys reject before any runner invocation', () => {
  const f = fixture();
  for (const profile of [{ ...f.profile, token: 'PRIVATE' }, { ...f.profile, repository: 'other/repo' },
    { ...f.profile, providers: { other: { route: 'dotenv' } } },
    { ...f.profile, providers: { cloudflare: { route: 'token' } } },
    { ...f.profile, providers: { runware: { route: 'dotenv', path: f.profilePath, keys: ['NODE_OPTIONS'] } } },
    { ...f.profile, providers: { runware: { route: 'dotenv', path: '.env', keys: ['RUNWARE_API_KEY'] } } },
    { ...f.profile, providers: { runware: { route: 'dpapi', path: f.profilePath, keys: ['RUNWARE_API_KEY', 'RUNWARE_API_KEY'] } } }]) {
    writeFileSync(f.profilePath, JSON.stringify(profile));
    expect(f.run('doctor')).toMatchObject({ ok: false, code: 'PROFILE' });
  }
  expect(f.calls).toHaveLength(0);
});

test('tracked profiles and nonignored inside-checkout sources are rejected', () => {
  const f = fixture();
  f.profile.providers.runware = { route: 'dotenv', path: resolve(f.root, 'public-keys.txt'), keys: ['RUNWARE_API_KEY'] };
  writeFileSync(f.profile.providers.runware.path, 'RUNWARE_API_KEY=synthetic'); f.save();
  expect(f.run('media-auth', 'dotenv', ['--provider=runware'])).toMatchObject({ ok: false, code: 'SOURCE' });
  f.git('add', '-f', f.profilePath);
  expect(f.run('doctor')).toMatchObject({ ok: false, code: 'PROFILE' });
  expect(f.children()).toHaveLength(0);
});

test('doctor uses installed Wrangler JSON read commands only and suppresses identities', () => {
  const f = fixture();
  const result = f.run('doctor');
  expect(result).toMatchObject({ ok: true, authenticated: true, leaseDatabaseVerified: true, leaseHeld: false,
    providers: { runware: { configured: false, status: 'unavailable' }, runway: { status: 'unavailable' }, 'fish-audio': { status: 'unavailable' } } });
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  const args = f.children().map((call) => call.args.slice(1));
  expect(args[0]).toEqual(['whoami', '--json', '--env-file', devNull]);
  expect(args[1]).toEqual(['d1', 'info', 'apex-rsi', '--json', '--env-file', devNull]);
  expect(args[2]).toEqual(['d1', 'execute', release.leaseDatabaseId, '--remote', '--json', '--command',
    "SELECT session FROM rsi_claim WHERE repo = 'aljjang95/blade-surge' AND axis = 'DEPLOY-blade-surge'", '--env-file', devNull]);
});

test('doctor preserves independent failure and missing-provider states; never reads SQL after DB mismatch', () => {
  const f = fixture();
  const runner = (file: string, args: string[], options: any) => {
    if (args.includes('whoami')) throw new Error('PRIVATE TOKEN');
    if (args.includes('info')) return JSON.stringify({ uuid: 'wrong', name: 'apex-rsi' });
    return f.runner(file, args, options);
  };
  const result = f.run('doctor', 'wrangler', [], { runner });
  expect(result).toMatchObject({ ok: false, checks: { whoami: 'failed', database: 'failed', leaseRead: 'not-probed' },
    providers: { cloudflare: { status: 'failed' }, runware: { status: 'unavailable' } } });
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(f.children()).toHaveLength(0);
});

test('child failures, timeout and stdout cannot leak token or raw exception into CLI result', () => {
  const f = fixture();
  for (const value of ['error', 'timeout', 'oversized']) {
    const runner = (file: string, args: string[], options: any) => {
      if (file === 'git') return f.runner(file, args, options);
      if (value === 'oversized') return 'SECRET'.repeat(200000);
      throw Object.assign(new Error('SECRET token cfut_secret'), { stdout: 'SECRET', stderr: 'SECRET', code: value === 'timeout' ? 'ETIMEDOUT' : 'FAILED' });
    };
    expect(f.run('deploy', 'wrangler', [], { runner })).toEqual({ ok: false, code: 'CHILD', message: 'Local command failed or returned an invalid response.' });
  }
});

test('dotenv syntax rejects interpolation, unknown/duplicate keys and missing selected keys', () => {
  for (const source of ['NODE_OPTIONS=x', 'RUNWARE_API_KEY=$TOKEN', 'RUNWARE_API_KEY=`whoami`', 'export RUNWARE_API_KEY=x',
    'RUNWARE_API_KEY=x\nRUNWARE_API_KEY=y', 'RUNWARE_API_KEY="unterminated', 'RUNWARE_API_KEY=x y', 'RUNWARE_API_KEY=',
    'RUNWARE_API_KEY=a\\nb', 'RUNWAYML_API_SECRET=x', 'RUNWARE_API_KEY=x\u0000']) {
    expect(() => parseDotenv(source, ['RUNWARE_API_KEY'])).toThrow('Configured credential source is unavailable or invalid.');
  }
  expect(parseDotenv('# comment\nRUNWARE_API_KEY="synthetic"\nRUNWAYML_API_SECRET=other', ['RUNWARE_API_KEY'])).toEqual({ RUNWARE_API_KEY: 'synthetic' });
});

test('invalid dotenv rejects before any credential child; alternate provider keys do not leak', () => {
  const f = fixture();
  const path = resolve(f.root, '.env.media');
  f.profile.providers.runware = { route: 'dotenv', path, keys: ['RUNWARE_API_KEY'] }; f.save();
  writeFileSync(path, 'RUNWARE_API_KEY=$PRIVATE');
  expect(f.run('media-auth', 'dotenv', ['--provider=runware'])).toMatchObject({ ok: false, code: 'SOURCE' });
  expect(f.children()).toHaveLength(0);
});

test('real dotenv child sees only selected key, leaves parent unset, and returns counts only', () => {
  const f = fixture();
  const path = resolve(f.root, '.env.media');
  writeFileSync(path, 'RUNWARE_API_KEY=synthetic-key\nRUNWAYML_API_SECRET=not-selected');
  f.profile.providers.runware = { route: 'dotenv', path, keys: ['RUNWARE_API_KEY'] }; f.save();
  const parent = { ...f.env, RUNWAYML_API_SECRET: 'ambient', CLOUDFLARE_API_TOKEN: 'ambient', NODE_OPTIONS: '--invalid', BUN_OPTIONS: 'ambient' };
  let received: any;
  const runner = (file: string, args: string[], options: any) => {
    if (file === 'git') return f.runner(file, args, options);
    received = { ...options.env };
    expect(JSON.stringify(args)).not.toContain('synthetic-key');
    return execFileSync(file, args, options) as string;
  };
  const result = f.run('media-auth', 'dotenv', ['--provider=runware'], { env: parent, runner });
  expect(result).toMatchObject({ ok: true, selectedKeyCount: 1, providerSuccess: false, dpapiReadable: false });
  expect(received.RUNWARE_API_KEY).toBe('synthetic-key');
  for (const name of ['RUNWAYML_API_SECRET', 'CLOUDFLARE_API_TOKEN', 'NODE_OPTIONS', 'BUN_OPTIONS']) expect(received[name]).toBeUndefined();
  expect((parent as any).RUNWARE_API_KEY).toBeUndefined();
  expect(parent.RUNWAYML_API_SECRET).toBe('ambient');
  expect(JSON.stringify(result)).not.toContain('synthetic');
});

test('Fish operational probe fixes scoped URL, no redirects, timeout and selected child env', () => {
  const f = fixture();
  const path = resolve(f.root, '.env.fish'); writeFileSync(path, 'FISH_API_KEY=synthetic-fish');
  f.profile.providers['fish-audio'] = { route: 'dotenv', path, keys: ['FISH_API_KEY'] }; f.save();
  const runner = (file: string, args: string[], options: any) => {
    if (file === 'git') return f.runner(file, args, options);
    expect(args[1]).toContain('https://api.fish.audio/model?page_size=1&self=true');
    expect(args[1]).toContain('redirect:"error"'); expect(args[1]).toContain('AbortSignal.timeout(8000)');
    expect(options.env.FISH_API_KEY).toBe('synthetic-fish');
    expect(JSON.stringify(args)).not.toContain('synthetic-fish');
    return JSON.stringify({ selectedKeyCount: 1, providerSuccess: true, httpStatus: 200 });
  };
  expect(f.run('probe-media', 'dotenv', ['--provider=fish-audio'], { runner })).toMatchObject({ ok: true, providerSuccess: true, httpStatus: 200 });
  for (const httpStatus of [401, 302, null]) {
    const failureRunner = (file: string, args: string[], options: any) => file === 'git' ? f.runner(file, args, options)
      : JSON.stringify({ selectedKeyCount: 1, providerSuccess: false, httpStatus });
    expect(f.run('probe-media', 'dotenv', ['--provider=fish-audio'], { runner: failureRunner })).toMatchObject({ ok: false, httpStatus, providerSuccess: false });
  }
});

test('password metadata only returns existence and never opens/imports CSV or starts credential child', () => {
  const f = fixture();
  const path = resolve(f.root, '.apex/Chrome passwords.csv'); writeFileSync(path, 'not-even-valid-csv PRIVATE');
  f.profile.passwordCsvPath = path; f.save();
  expect(f.run('password-metadata', 'chrome')).toMatchObject({ ok: true, available: true, contentsRead: false, passwordUse: 'device-chrome-manager' });
  rmSync(path);
  expect(f.run('password-metadata', 'chrome')).toMatchObject({ ok: true, available: false, contentsRead: false });
  expect(f.children()).toHaveLength(0);
});

test('bind initializes profile from verified checkout, with explicit metadata-only local paths', () => {
  const f = fixture(); rmSync(f.profilePath);
  const fish = resolve(f.root, '.apex/synthetic.dpapi'); writeFileSync(fish, Buffer.from([1, 2, 3]));
  const csv = resolve(f.root, '.apex/synthetic.csv'); writeFileSync(csv, 'not a password export');
  expect(f.run('bind', 'local', ['--fish-dpapi', fish, '--password-csv', csv])).toMatchObject({ ok: true, profileBound: true, backupCreated: false });
  expect(JSON.parse(readFileSync(f.profilePath, 'utf8'))).toEqual({ version: 1, repository: 'aljjang95/blade-surge', checkout: f.root,
    providers: { cloudflare: { route: 'wrangler' }, 'fish-audio': { route: 'dpapi', path: fish, keys: ['FISH_API_KEY'] } }, passwordCsvPath: csv });
  expect(f.children()).toHaveLength(0);
});

test('stale checkout rebind retains paths and backups original profile without reading sources', () => {
  const f = fixture();
  f.profile.checkout = resolve(f.root, 'retired-nonexistent-checkout');
  f.profile.providers.runware = { route: 'dotenv', path: resolve(f.root, '.apex/absent.env'), keys: ['RUNWARE_API_KEY'] };
  f.profile.passwordCsvPath = resolve(f.root, '.apex/absent.csv'); f.save();
  const before = JSON.parse(readFileSync(f.profilePath, 'utf8'));
  expect(f.run('bind', 'local')).toMatchObject({ ok: true, backupCreated: true });
  expect(JSON.parse(readFileSync(f.profilePath, 'utf8'))).toEqual({ ...before, checkout: f.root });
  const backups = readdirSync(dirname(f.profilePath)).filter((name) => name.endsWith('.backup.local.json'));
  expect(backups).toHaveLength(1);
  expect(JSON.parse(readFileSync(resolve(dirname(f.profilePath), backups[0]), 'utf8'))).toEqual(before);
  expect(f.children()).toHaveLength(0);
});

test('bind rejects wrong remote/head or tampered profile and does not overwrite or create backup', () => {
  const f = fixture();
  const before = readFileSync(f.profilePath, 'utf8');
  f.git('remote', 'set-url', 'origin', 'https://github.com/other/repo.git');
  expect(f.run('bind', 'local')).toMatchObject({ ok: false, code: 'BINDING' });
  f.git('remote', 'set-url', 'origin', 'https://github.com/aljjang95/blade-surge.git');
  const args = f.args('bind', 'local'); args[2] = 'f'.repeat(40);
  expect(runBridge(args, { root: f.root, cwd: f.root, runner: f.runner })).toMatchObject({ ok: false, code: 'HEAD' });
  expect(readFileSync(f.profilePath, 'utf8')).toBe(before);
  expect(readdirSync(dirname(f.profilePath))).toEqual(['profiles.local.json']);
  f.profile.token = 'PRIVATE'; f.save();
  expect(f.run('bind', 'local')).toMatchObject({ ok: false, code: 'PROFILE' });
  expect(JSON.parse(readFileSync(f.profilePath, 'utf8')).token).toBe('PRIVATE');
});

test('project config contains only safe endpoint and explicitly does not claim cloud activation', () => {
  const text = readFileSync(resolve(workspace, '.codex/config.toml'), 'utf8');
  const parsed = Bun.TOML.parse(text);
  expect(parsed).toEqual({ mcp_servers: { remote_desktop_commander: { url: 'https://mcp.desktopcommander.app/mcp', enabled: true, startup_timeout_sec: 20, tool_timeout_sec: 60 } } });
  expect(text).toContain('활성화하지 않는다');
  expect(readFileSync(resolve(workspace, 'docs/pc-bridge.md'), 'utf8')).toContain('config alone does not activate a cloud');
});

test('official Runway variable is accepted without credentials or provider network calls', () => {
  const f = fixture();
  expect(validateProfile({ ...f.profile, providers: { runway: { route: 'dotenv', path: f.profilePath, keys: ['RUNWAYML_API_SECRET'] } } })).toBeDefined();
  expect(childEnvironment({ RUNWAYML_API_SECRET: 'PRIVATE', PATH: 'system' })).toEqual({ PATH: 'system', WRANGLER_SEND_METRICS: 'false' });
});

test.skipIf(process.platform !== 'win32')('real raw-binary CurrentUser DPAPI child readiness uses one synthetic key without exporting value', () => {
  const f = fixture();
  mkdirSync(resolve(f.root, 'tools'));
  copyFileSync(resolve(workspace, 'tools/pc-bridge-dpapi.ps1'), resolve(f.root, 'tools/pc-bridge-dpapi.ps1'));
  const path = resolve(f.root, '.apex/synthetic.dpapi');
  const powershell = resolve(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const script = '$ErrorActionPreference="Stop"; [Console]::InputEncoding=New-Object Text.UTF8Encoding($false,$true); Add-Type -AssemblyName System.Security; $r=ConvertFrom-Json ([Console]::In.ReadToEnd()); $b=[Text.Encoding]::UTF8.GetBytes($r.value); $e=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [IO.File]::WriteAllBytes($r.path,$e); [Array]::Clear($b,0,$b.Length)';
  execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { input: JSON.stringify({ path, value: 'synthetic-fish-only' }), env: f.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  f.profile.providers['fish-audio'] = { route: 'dpapi', path, keys: ['FISH_API_KEY'] }; f.save();
  const runner = (file: string, args: string[], options: any) => execFileSync(file, args, options) as string;
  const result = f.run('media-auth', 'dpapi', ['--provider=fish-audio'], { runner });
  expect(result).toMatchObject({ ok: true, selectedKeyCount: 1, dpapiReadable: true, providerSuccess: false });
  expect(JSON.stringify(result)).not.toContain('synthetic-fish-only');
  writeFileSync(path, Buffer.from([1, 2, 3]));
  expect(f.run('media-auth', 'dpapi', ['--provider=fish-audio'], { runner })).toEqual({ ok: false, code: 'CHILD', message: 'Local command failed or returned an invalid response.' });
});
