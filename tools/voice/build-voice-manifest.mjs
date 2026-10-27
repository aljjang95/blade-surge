// voice-manifest.json 생성: 계획(voice-plan.mjs) × 실제 mp3 해시 × ASR 표본(asr.py 형식 JSON) × 생성 영수증.
// 사용: node tools/voice/build-voice-manifest.mjs --asr <asr.json> --regen <재생성한 파일명 줄 목록> [--receipt <gen-receipt.json>] [--calls n]
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ALL_LINES, VOICES, VOICE_DIR, FISH_MODEL } from './voice-plan.mjs';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const asr = JSON.parse(readFileSync(opt('asr'), 'utf8'));
const regen = new Set(readFileSync(opt('regen'), 'utf8').split('\n').map(s => s.trim()).filter(Boolean));
const receipt = opt('receipt') ? JSON.parse(readFileSync(opt('receipt'), 'utf8')) : { files: {}, calls: 0 };
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');

const voices = Object.fromEntries(Object.entries(VOICES).map(([owner, v]) => [owner, v.referenceId ? { id: v.id, referenceId: v.referenceId, label: v.label } : { id: v.id, ref: v.ref, refSha256: sha(v.ref), refText: v.refText }]));
const files = ALL_LINES.map(line => {
  const path = `${VOICE_DIR}/${line.file}.mp3`;
  const a = asr[line.file];
  const isRegen = regen.has(line.file);
  return {
    file: line.file, owner: line.owner, voice: VOICES[line.owner].id, kind: line.kind, text: line.text, lang: 'ko',
    source: isRegen ? 'regenerated' : 'kept', sha256: sha(path),
    ...(isRegen && receipt.files[line.file] ? { emotion: line.emotion, attempt: receipt.files[line.file].attempt, temperature: receipt.files[line.file].temperature } : {}),
    asr: a ? { lang: a.lang, langProb: a.p, text: a.text, durationSec: a.dur } : null,
  };
});
const manifest = {
  generatedAt: new Date().toISOString().slice(0, 10),
  provider: 'Fish Audio', model: FISH_MODEL, endpoint: 'Cloud TLL proxy /p/fish/v1/tts (ICL references, format=mp3)', postProcessing: 'none',
  billing: '무료 티어(s2.1-pro-free). 유료 s2.1-pro 는 API 크레딧 0 으로 402', fishCalls: Number(opt('calls') || receipt.calls || 0),
  voices, files,
};
writeFileSync('tools/voice/voice-manifest.json', JSON.stringify(manifest, null, 1) + '\n');
console.log(JSON.stringify({ files: files.length, regenerated: files.filter(f => f.source === 'regenerated').length, kept: files.filter(f => f.source === 'kept').length }));
