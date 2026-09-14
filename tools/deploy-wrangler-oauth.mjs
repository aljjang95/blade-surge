import { execFileSync } from 'node:child_process';
import { devNull } from 'node:os';
import { fileURLToPath } from 'node:url';
import { cloudflareQuery } from './deploy-control.mjs';
import config from './release-config.json' with { type: 'json' };

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const templates = [
  'SELECT session FROM rsi_claim WHERE repo = ? AND axis = ?',
  'INSERT INTO rsi_claim (repo, axis, session, base_sha, started_at, note) VALUES (?, ?, ?, ?, ?, ?)',
  'DELETE FROM rsi_claim WHERE repo = ? AND axis = ? AND session = ?',
];
const uuid = (value) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const headValid = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const fail = () => { throw new Error('Wrangler lease adapter rejected request or response.'); };
const literal = (value) => "'" + value.replaceAll("'", "''") + "'";

// No credential discovery, extraction, alternate profile, or token fallback.
/**
 * @typedef {Object} AdapterOptions
 * @property {string[]} [args]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {unknown} [head]
 * @property {unknown} [owner]
 * @property {(file: string, args: string[], options: import('node:child_process').ExecFileSyncOptionsWithStringEncoding) => string} [runner]
 */
/** @param {AdapterOptions} options */
export function deploymentQuery({ args = [], env = process.env, head, owner, runner = execFileSync } = {}) {
  const auth = args.filter((arg) => arg.startsWith('--auth'));
  if (auth.length === 0) return cloudflareQuery(env);
  if (auth.length !== 1 || auth[0] !== '--auth=wrangler') fail();
  return wranglerLeaseQuery({ env, head, owner, runner });
}

/** @param {AdapterOptions} options */
export function wranglerLeaseQuery({ env = process.env, head, owner, runner = execFileSync } = {}) {
  if (!headValid(head) || !uuid(owner) || !uuid(config.leaseDatabaseId)) fail();
  if (Object.keys(env).some((key) => /^(CF_|CLOUDFLARE_)/i.test(key)
    || /^(APEX_RSI_DB|WRANGLER_PROFILE)$/i.test(key))) fail();
  const childEnv = { ...env };
  let verified = false;
  const command = (args) => {
    try {
      const output = runner(process.execPath, [cli, ...args, '--env-file', devNull], {
        cwd: root, env: childEnv, encoding: 'utf8', shell: false,
        stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
      if (typeof output !== 'string' || output.length > 1024 * 1024) fail();
      return JSON.parse(output);
    } catch { throw new Error('Wrangler lease command failed or returned invalid JSON.'); }
  };
  return async (sql, params) => {
    const kind = templates.indexOf(sql);
    if (kind < 0 || !Array.isArray(params) || params.length !== [2, 6, 3][kind]
      || !params.every((value) => typeof value === 'string' && value.length > 0 && value.length <= 128)
      || params[0] !== config.repository || params[1] !== config.leaseAxis) fail();
    if (kind !== 0 && (!uuid(params[2]) || params[2] !== owner)) fail();
    if (kind === 1 && (!headValid(params[3]) || params[3] !== head
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(params[4])
      || !Number.isFinite(Date.parse(params[4])) || new Date(params[4]).toISOString() !== params[4]
      || params[5] !== '검증된 배포 전환 잠금')) fail();
    if (!verified) {
      const info = command(['d1', 'info', 'apex-rsi', '--json']);
      if (!info || Array.isArray(info) || info.uuid !== config.leaseDatabaseId || info.name !== 'apex-rsi') fail();
      verified = true;
    }
    let index = 0;
    const bound = sql.replace(/\?/g, () => literal(params[index++]));
    // Execute the verified UUID, never a mutable name or caller-supplied binding.
    const response = command(['d1', 'execute', config.leaseDatabaseId, '--remote', '--json', '--command', bound]);
    if (!Array.isArray(response) || response.length !== 1) fail();
    const result = response[0];
    if (!result || result.success !== true || !Array.isArray(result.results)
      || !Number.isSafeInteger(result.meta?.changes) || result.meta.changes < 0 || result.meta.changes > 1) fail();
    if (kind === 0) {
      if (result.meta.changes !== 0 || result.results.length > 1
        || result.results.some((row) => !row || Object.keys(row).length !== 1 || !uuid(row.session))) fail();
    } else if (result.results.length !== 0 || (kind === 1 && result.meta.changes !== 1)) fail();
    return { success: true, results: result.results, meta: { changes: result.meta.changes } };
  };
}
