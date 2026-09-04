/**
 * 보이스 생성기 — Runware.
 *   node tools/voice/gen.mjs refs            # VOICES 설명문 → Qwen3 VoiceDesign → tools/voice/refs/<voice>.mp3 (정체성, 한 번만)
 *   node tools/voice/gen.mjs lines [필터]     # LINES → Seed Audio(@Audio1 = refs) → ASR 대조/길이 대조 → 정규화 → public/sfx/voice/<name>.mp3
 *   node tools/voice/gen.mjs report          # 남은 것 / 실패한 것
 * 멱등: 이미 있는 산출물은 건너뛴다. 실패는 tools/voice/.fail.json 에 남기고 다음 실행에서 재시도(최대 3회).
 * 키: RUNWARE_API_KEY 환경변수 (session-auth). bash 178초 상한 — 한 호출에 BATCH 개씩만.
 */
import { VOICES, LINES } from './lines.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { randomUUID } from 'crypto';

const HERE = dirname(new URL(import.meta.url).pathname), PROJ = resolve(HERE, '../..');
const REFS = resolve(HERE, 'refs'), OUT = resolve(PROJ, 'public/sfx/voice'), TMP = resolve(HERE, '.tmp'), FAIL = resolve(HERE, '.fail.json');
for (const d of [REFS, OUT, TMP]) mkdirSync(d, { recursive: true });
const KEY = process.env.RUNWARE_API_KEY; if (!KEY) { console.error('RUNWARE_API_KEY 없음 — session-auth'); process.exit(1); }
const mode = process.argv[2] || 'report', filter = process.argv[3] || '';
const BATCH = Number(process.env.BATCH || 8);
const fails = existsSync(FAIL) ? JSON.parse(readFileSync(FAIL, 'utf8')) : {};

async function runware(tasks) {
  const r = await fetch('https://api.runware.ai/v1', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY }, body: JSON.stringify(tasks) });
  const j = await r.json();
  const byId = {}; for (const d of j.data || []) byId[d.taskUUID] = d; for (const e of j.errors || []) byId[e.taskUUID] = { error: e.message };
  return byId;
}
async function download(url, path) { const b = Buffer.from(await (await fetch(url)).arrayBuffer()); writeFileSync(path, b); return b.length; }
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
/** 라우드니스 정규화 → 앞뒤 무음만 제거(중간은 건드리지 않는다) → mp3.
 *  처음엔 -42dB 기준으로 중간 무음까지 지웠더니 낮게 으르렁대는 악마 보스 대사가 0.3초로 잘려 나갔다 — 정규화를 먼저 하고 가장자리만 자른다 */
function post(src, dst, { bark }) {
  const n1 = src.replace(/\.mp3$/, '_n.wav'), t1 = src.replace(/\.mp3$/, '_t.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-af', `loudnorm=I=${bark ? -14 : -16}:TP=-1.5:LRA=11`, '-ar', '44100', n1]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', n1, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse', t1]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', t1, '-ac', '1', '-b:a', '96k', dst]);
  return dur(dst);
}
const norm = (s) => s.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
// 글자 바이그램 Dice — 외치는 대사는 ASR 이 'Heavens REEEAAND' 처럼 늘여 쓰므로 단어 일치로는 못 잡는다
function similar(a, b) { const g = (s) => { const t = norm(s).replace(/ /g, ''); const m = new Map(); for (let i = 0; i < t.length - 1; i++) { const k = t.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); } return m; }; const A = g(a), B = g(b); let hit = 0, na = 0, nb = 0; for (const [k, v] of A) { na += v; if (B.has(k)) hit += Math.min(v, B.get(k)); } for (const v of B.values()) nb += v; return na && nb ? (2 * hit) / (na + nb) : 0; }

if (mode === 'refs') {
  const todo = Object.entries(VOICES).filter(([k]) => !existsSync(resolve(REFS, k + '.mp3')));
  const tasks = todo.map(([k, v]) => ({ taskType: 'audioInference', taskUUID: randomUUID(), _k: k, model: 'alibaba:qwen@3-tts-1.7b-voicedesign', positivePrompt: v.desc, speech: { text: v.ref, language: 'English' }, outputFormat: 'MP3', includeCost: true }));
  if (!tasks.length) { console.log('refs: 전부 있음'); process.exit(0); }
  const res = await runware(tasks.map(({ _k, ...t }) => t));
  for (const t of tasks) { const d = res[t.taskUUID]; if (!d || d.error) { console.log('FAIL', t._k, d?.error); continue; } await download(d.audioURL, resolve(REFS, t._k + '.mp3')); console.log('ref', t._k, `${dur(resolve(REFS, t._k + '.mp3')).toFixed(1)}s $${d.cost}`); }
  process.exit(0);
}
if (mode === 'report') {
  const left = LINES.filter((l) => !existsSync(resolve(OUT, l.name + '.mp3')));
  console.log(`전체 ${LINES.length} · 완료 ${LINES.length - left.length} · 남음 ${left.length}`); console.log('남음:', left.map((l) => l.name).join(' '));
  console.log('실패 기록:', Object.entries(fails).filter(([, v]) => v.n >= 3).map(([k, v]) => `${k}(${v.last})`).join(' ') || '없음');
  process.exit(0);
}
if (mode === 'lines') {
  const todo = LINES.filter((l) => !existsSync(resolve(OUT, l.name + '.mp3')) && (!filter || l.name.includes(filter)) && (fails[l.name]?.n || 0) < 3).slice(0, BATCH);
  if (!todo.length) { console.log('lines: 할 것 없음'); process.exit(0); }
  const refB64 = {}; for (const l of todo) if (!refB64[l.voice]) { const p = resolve(REFS, l.voice + '.mp3'); if (!existsSync(p)) { console.error('ref 없음:', l.voice, '— 먼저 refs'); process.exit(1); } refB64[l.voice] = 'data:audio/mpeg;base64,' + readFileSync(p).toString('base64'); }
  const reuse = todo.filter((l) => existsSync(resolve(TMP, l.name + '.mp3')) && !/no data|API/.test(fails[l.name]?.last || ''));
  const fresh = todo.filter((l) => !reuse.includes(l));
  const tasks = fresh.map((l) => {
    const n = fails[l.name]?.n || 0;   // 재시도마다 지시를 조금 바꾼다
    const prompt = l.kind === 'bark'
      ? `Using the voice of @Audio1, perform ONLY this sound, nothing else, ${n ? 'extremely brief, one burst, ' : ''}${l.act}: "${l.text}"`
      : `Using the voice of @Audio1, say ONLY the following line, ${l.act}: "${l.text}"`;
    return { taskType: 'audioInference', taskUUID: randomUUID(), _l: l, model: 'bytedance:seed-audio@1.0', positivePrompt: prompt, inputs: { referenceAudios: [refB64[l.voice]] }, outputFormat: 'MP3', includeCost: true };
  });
  const res = tasks.length ? await runware(tasks.map(({ _l, ...t }) => t)) : {};
  const raw = reuse.map((l) => ({ l, p: resolve(TMP, l.name + '.mp3'), cost: 0 }));
  for (const t of tasks) { const d = res[t.taskUUID]; const l = t._l; if (!d || d.error) { fails[l.name] = { n: (fails[l.name]?.n || 0) + 1, last: d?.error || 'no data' }; console.log('FAIL', l.name, d?.error); continue; } const p = resolve(TMP, l.name + '.mp3'); await download(d.audioURL, p); raw.push({ l, p, cost: d.cost }); }
  // 후처리 먼저, 검증은 최종 파일로: 대사는 ASR 바이그램 일치, 기합은 길이
  const posted = raw.map((r) => ({ ...r, dst: resolve(OUT, r.l.name + '.mp3'), d: post(r.p, resolve(OUT, r.l.name + '.mp3'), { bark: r.l.kind === 'bark' }) }));
  const lineFiles = posted.filter((r) => r.l.kind === 'line').map((r) => r.dst);
  const asr = lineFiles.length ? JSON.parse(execFileSync('python3', [resolve(HERE, 'asr.py'), ...lineFiles], { maxBuffer: 1 << 24 }).toString().trim().split('\n').pop()) : {};
  let cost = 0;
  for (const { l, dst, d, cost: c } of posted) {
    cost += c || 0;
    const p = dst;
    let ok = true, why = '';
    if (l.maxSec && d > l.maxSec) { ok = false; why = `길이 ${d.toFixed(2)}s > ${l.maxSec}`; }
    if (l.kind === 'bark' && d < 0.2) { ok = false; why = `너무 짧음 ${d.toFixed(2)}s (빈 소리)`; }
    if (!(d > 0) || statSync(dst).size < 1500) { ok = false; why = `깨진 파일 (${statSync(dst).size}B)`; }   // 트림 뒤 빈 mp3 는 ffprobe 가 NaN 을 뱉어 길이 검사를 통과했다
    if (l.kind === 'line') { const s = similar(l.text, asr[p] || ''); if (s < (l.maxSec ? 0.35 : 0.5)) { ok = false; why = `ASR 불일치 ${(s * 100) | 0}% "${asr[p]}"`; } }
    if (!ok) { fails[l.name] = { n: (fails[l.name]?.n || 0) + 1, last: why }; execFileSync('rm', ['-f', dst]); console.log('✗', l.name, why); }
    else { delete fails[l.name]; console.log('✓', l.name, `${d.toFixed(2)}s`, l.kind === 'line' ? `"${asr[p]}"` : ''); }
  }
  writeFileSync(FAIL, JSON.stringify(fails, null, 1));
  console.log(`이번 배치 비용 $${cost.toFixed(4)}`);
}
