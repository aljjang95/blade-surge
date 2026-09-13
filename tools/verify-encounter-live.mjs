// Release-status verification of the six new GLBs and the actual served entry.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const sha = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(sha || '')) throw Error('Expected full release commit SHA');
const manifest = JSON.parse(fs.readFileSync('docs/media/encounter-models.json', 'utf8'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const built = JSON.parse(fs.readFileSync('dist/version.json', 'utf8'));
if (built.sha !== sha || built.dirty !== false) throw Error('Local build is not the clean release');
const entryPath = html => html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/)?.[1];
const builtEntry = entryPath(fs.readFileSync('dist/index.html', 'utf8'));
if (!builtEntry?.startsWith('/assets/')) throw Error('Missing built module entry');
const entrySha256 = hash(fs.readFileSync(`dist${builtEntry}`));
for (const asset of manifest.assets) {
  if (!/^public\/models\/tll\/encounters\/[a-z0-9-]+\.glb$/.test(asset.path)) throw Error('Unexpected asset path');
  const bytes = fs.readFileSync(asset.path);
  if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256) throw Error(`Local asset drift: ${asset.path}`);
}
const report = { started: new Date().toISOString(), sha, status: 'running', hosts: [] };
fs.mkdirSync('_autopipe/evidence', { recursive: true });
const save = () => fs.writeFileSync('_autopipe/evidence/encounter-models-live.json', JSON.stringify(report, null, 2));
async function get(url) {
  const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw Error(`${url} HTTP ${response.status}`);
  return response;
}
try {
  for (const origin of ['https://blade.tllhouse.com', 'https://blade-surge.affinity-agent-studio.workers.dev']) {
    const host = { origin, assets: [] }; report.hosts.push(host);
    host.version = await (await get(`${origin}/version.json?verify=${Date.now()}`)).json();
    if (host.version.sha !== sha || host.version.dirty !== false) throw Error(`${origin}: release mismatch`);
    host.entry = entryPath(await (await get(origin)).text());
    if (host.entry !== builtEntry) throw Error(`${origin}: HTML entry differs from built release`);
    host.entrySha256 = hash(Buffer.from(await (await get(origin + host.entry)).arrayBuffer()));
    if (host.entrySha256 !== entrySha256) throw Error(`${origin}: entry bytes differ`);
    for (let i = 0; i < manifest.assets.length; i += 3) {
      host.assets.push(...await Promise.all(manifest.assets.slice(i, i + 3).map(async asset => {
        const path = asset.path.slice(6), response = await get(origin + path);
        const bytes = Buffer.from(await response.arrayBuffer()), actual = hash(bytes);
        if (bytes.length !== asset.bytes || actual !== asset.sha256) throw Error(`${origin}: asset mismatch ${path}`);
        return { path, bytes: bytes.length, sha256: actual, contentType: response.headers.get('content-type'), status: 'pass' };
      })));
      save();
    }
    host.status = 'pass';
    console.log(`${origin}: clean ${sha.slice(0, 8)}, actual entry and ${host.assets.length} model hashes matched`);
  }
  report.status = 'pass';
} catch (error) { report.status = 'fail'; report.error = String(error); process.exitCode = 1; console.error(error); }
finally { report.finished = new Date().toISOString(); save(); }
