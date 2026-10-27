// 보이스 통일 생성기: voice-plan.mjs 의 대사를 Fish Audio(S2.1 Pro 계열) ICL 로 mp3 직출력한다.
// 호출은 Cloud TLL 프록시($APEX_CLOUD_URL/p/fish)만 쓴다(키는 서버가 붙임). 후처리(정규화·무음 자르기 등) 없음.
// 사용: node tools/voice/fish-unify.mjs --outdir <dir> [--only a,b,c | --owner knight | --all] [--attempt 0..n]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ALL_LINES, VOICES, FISH_MODEL, REFERENCE_FILES } from './voice-plan.mjs';

// 최소 msgpack 인코더(맵·문자열·바이너리·실수·불리언) — 외부 의존 없이 Fish references.audio 바이너리를 보낸다.
function pack(value) {
  const out = [];
  const u = (n, bytes) => { const b = Buffer.alloc(bytes); b.writeUIntBE(n, 0, bytes); out.push(b); };
  const enc = v => {
    if (typeof v === 'boolean') out.push(Buffer.from([v ? 0xc3 : 0xc2]));
    else if (typeof v === 'number') { const b = Buffer.alloc(9); b[0] = 0xcb; b.writeDoubleBE(v, 1); out.push(b); }
    else if (typeof v === 'string') { const s = Buffer.from(v, 'utf8'); out.push(Buffer.from([0xdb])); u(s.length, 4); out.push(s); }
    else if (Buffer.isBuffer(v)) { out.push(Buffer.from([0xc6])); u(v.length, 4); out.push(v); }
    else if (Array.isArray(v)) { out.push(Buffer.from([0xdd])); u(v.length, 4); v.forEach(enc); }
    else { const keys = Object.keys(v); out.push(Buffer.from([0xdf])); u(keys.length, 4); for (const k of keys) { enc(k); enc(v[k]); } }
  };
  enc(value);
  return Buffer.concat(out);
}

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const outdir = opt('outdir');
if (!outdir) { console.error('missing --outdir'); process.exit(2); }
const attempt = Number(opt('attempt') || 0);
const only = opt('only')?.split(',');
const owner = opt('owner');
let targets = ALL_LINES.filter(l => !REFERENCE_FILES.has(l.file));
if (only) targets = ALL_LINES.filter(l => only.includes(l.file));
else if (owner) targets = targets.filter(l => l.owner === owner);
else if (!args.includes('--all')) { console.error('need --only, --owner or --all'); process.exit(2); }
for (const l of targets) if (REFERENCE_FILES.has(l.file)) { console.error('reference clip cannot be regenerated: ' + l.file); process.exit(2); }

const base = process.env.APEX_CLOUD_URL;
if (!base) { console.error('APEX_CLOUD_URL not set'); process.exit(2); }
mkdirSync(outdir, { recursive: true });
const refCache = {};
const refOf = v => (refCache[v.ref] ??= readFileSync(v.ref));
const receiptPath = join(outdir, 'gen-receipt.json');
const receipt = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : { model: FISH_MODEL, endpoint: '/p/fish/v1/tts via Cloud TLL proxy', postProcessing: 'none', format: 'mp3', calls: 0, files: {} };
for (const line of targets) {
  const voice = VOICES[line.owner];
  const temperature = [0.7, 0.55, 0.85, 0.4][attempt % 4];
  const body = pack({ text: `[${line.emotion}] ${line.text}`, references: [{ audio: refOf(voice), text: voice.refText }], format: 'mp3', normalize: false, latency: 'balanced', temperature, top_p: 0.7 });
  let ok = false;
  for (let tries = 0; tries < 3 && !ok; tries++) {
    const res = await fetch(`${base}/p/fish/v1/tts`, { method: 'POST', headers: { 'content-type': 'application/msgpack', model: FISH_MODEL, 'user-agent': 'curl/8.5' }, body });
    receipt.calls++;
    if (res.ok) {
      const mp3 = Buffer.from(await res.arrayBuffer());
      writeFileSync(join(outdir, line.file + '.mp3'), mp3);
      receipt.files[line.file] = { owner: line.owner, voice: voice.id, text: line.text, attempt, temperature, bytes: mp3.length, sha256: createHash('sha256').update(mp3).digest('hex'), at: new Date().toISOString() };
      ok = true;
    } else { console.error(`${line.file} HTTP ${res.status} ${(await res.text()).slice(0, 120)}`); await new Promise(r => setTimeout(r, 2000)); }
  }
  console.log(ok ? 'ok ' + line.file : 'FAIL ' + line.file);
}
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
