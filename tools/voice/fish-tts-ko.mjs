// 한국어 영웅 대사를 Fish ICL로 생성한다. 속도·피치·노멀라이즈 후처리는 하지 않는다.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { encode } from 'file:///C:/Users/heart/.codex/skills/game-audio-forge/scripts/node_modules/@msgpack/msgpack/dist.esm/index.mjs';
import { fish, sha256, wavInfo } from 'file:///C:/Users/heart/.codex/skills/game-audio-forge/scripts/lib/client.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((out, value, index, values) => value.startsWith('--') ? out.concat([[value.slice(2), values[index + 1]]]) : out, []));
for (const key of ['ref', 'ref-text', 'lines', 'outdir']) if (!args[key]) { console.error('missing --' + key); process.exit(2); }
const ref = readFileSync(args.ref);
const refInfo = wavInfo(ref);
if (refInfo.durationMs < 2000 || refInfo.durationMs > 15000) { console.error('ref_duration_out_of_range ' + refInfo.durationMs); process.exit(2); }
const lines = JSON.parse(readFileSync(args.lines, 'utf8'));
mkdirSync(args.outdir, { recursive: true });
const results = [];
for (const item of lines) {
  const out = join(args.outdir, item.id + '.wav');
  if (existsSync(out)) { results.push({ id: item.id, status: 'skipped_exists' }); continue; }
  const body = encode({ text: item.text, references: [{ audio: ref, text: args['ref-text'] }], format: 'wav', sample_rate: 44100,
    normalize: false, latency: 'balanced', temperature: item.temperature ?? 0.7, top_p: item.top_p ?? 0.7 });
  const t0 = Date.now();
  const wav = await fish(body, 's2.1-pro-free');
  const info = wavInfo(wav);
  writeFileSync(out, wav);
  results.push({ id: item.id, text: item.text, out, sha256: sha256(wav), bytes: wav.length, ...info, latencyMs: Date.now() - t0 });
}
const receipt = { provider: 'fish', model: 's2.1-pro-free', endpoint: 'https://api.fish.audio/v1/tts', costUsd: 0,
  ref: args.ref, refSha256: sha256(ref), refDurationMs: refInfo.durationMs, refText: args['ref-text'], postProcessing: 'none',
  normalize: false, results, createdAt: new Date().toISOString() };
writeFileSync(join(args.outdir, 'fish-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(results.map(result => ({ id: result.id, status: result.status || 'ok', durationMs: result.durationMs, sampleRateHz: result.sampleRateHz }))));
