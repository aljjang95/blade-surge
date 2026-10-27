// 보이스 통일 감사: public/sfx/voice 의 모든 mp3 가 매니페스트(voice-manifest.json)에 있고,
// 영어 대사 0건 · 소유자(직업/아나운서/보스)당 목소리 정확히 1개인지 검사한다. `node tools/voice/voice-audit.mjs` 로 직접 실행도 된다.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ALL_LINES, VOICES, VOICE_DIR } from './voice-plan.mjs';

const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const HANGUL = /[가-힣]/;
const LATIN_WORD = /[A-Za-z]{2,}/;          // 영어 단어(대사 텍스트에 알파벳 2자 이상 연속이면 영어 혼입)
const norm = v => (v || '').replace(/\(ko강제\)/g, '').replace(/[^가-힣0-9]/g, '');
const bigrams = v => new Set(v.length > 1 ? [...v].slice(0, -1).map((c, i) => c + v[i + 1]) : [v]);
// Whisper 언어 판정은 짧은 한국어 외침을 ja 로 찍기도 한다 — 그럴 땐 한국어 강제 받아쓰기가 의도한 대사와 맞는지(글자 바이그램 Dice)로 본다.
const dice = (a, b) => { a = norm(a); b = norm(b); if (!a || !b) return 0; const A = bigrams(a), B = bigrams(b); let n = 0; for (const x of A) if (B.has(x)) n++; return 2 * n / (A.size + B.size); };
const ASR_MIN_SEC = 1.5;                    // 이보다 짧은 기합은 ASR 언어 판정이 무의미하다(길이·텍스트로만 본다)

export function auditVoiceManifest({ manifestPath = 'tools/voice/voice-manifest.json', voiceDir = VOICE_DIR, heroes = {} } = {}) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const errors = [];
  const err = msg => errors.push(msg);
  const diskFiles = readdirSync(voiceDir).filter(f => f.endsWith('.mp3')).map(f => f.slice(0, -4)).sort();
  const byFile = new Map(manifest.files.map(e => [e.file, e]));
  if (byFile.size !== manifest.files.length) err('매니페스트에 중복 파일 항목이 있다');
  for (const f of diskFiles) if (!byFile.has(f)) err(`매니페스트에 없는 파일: ${f}`);
  for (const f of byFile.keys()) if (!diskFiles.includes(f)) err(`디스크에 없는 매니페스트 항목: ${f}`);
  const plan = new Map(ALL_LINES.map(l => [l.file, l]));
  for (const f of diskFiles) if (!plan.has(f)) err(`계획(voice-plan.mjs)에 없는 파일: ${f}`);

  // 소유자별 목소리 id 와 레퍼런스 고정
  for (const [owner, v] of Object.entries(VOICES)) {
    const m = manifest.voices[owner];
    if (!m || m.id !== v.id) err(`소유자 ${owner}: 매니페스트 목소리 id 불일치`);
    else if (m.refSha256 !== sha(v.ref)) err(`소유자 ${owner}: 레퍼런스 클립 ${v.ref} 가 바뀌었다(해시 불일치)`);
  }
  const voicesByOwner = {};
  const stats = { files: 0, english: 0, nonKorean: 0, asrChecked: 0, asrNonKorean: 0, regenerated: 0, kept: 0, owners: {} };
  for (const e of manifest.files) {
    stats.files++;
    const line = plan.get(e.file);
    if (line) {
      if (e.owner !== line.owner) err(`${e.file}: 소유자 ${e.owner} ≠ 계획 ${line.owner}`);
      if (e.text !== line.text) err(`${e.file}: 대사 텍스트가 계획과 다르다`);
    }
    (voicesByOwner[e.owner] ??= new Set()).add(e.voice);
    stats.owners[e.owner] = (stats.owners[e.owner] || 0) + 1;
    if (e.lang !== 'ko') { stats.nonKorean++; err(`${e.file}: lang=${e.lang}`); }
    if (!HANGUL.test(e.text) || LATIN_WORD.test(e.text)) { stats.english++; err(`${e.file}: 한국어가 아닌 대사 "${e.text}"`); }
    if (e.source === 'regenerated') stats.regenerated++; else stats.kept++;
    try { if (sha(join(voiceDir, e.file + '.mp3')) !== e.sha256) err(`${e.file}: 파일 해시 불일치`); } catch { /* 위에서 보고 */ }
    if (e.asr && e.asr.durationSec >= ASR_MIN_SEC) {
      stats.asrChecked++;
      if (e.asr.lang !== 'ko' && dice(e.text, e.asr.text) < 0.5) { stats.asrNonKorean++; err(`${e.file}: ASR 언어 ${e.asr.lang} ("${e.asr.text}")`); }
    }
  }
  stats.ownersWithMultipleVoices = 0;
  for (const [owner, set] of Object.entries(voicesByOwner)) if (set.size !== 1) { stats.ownersWithMultipleVoices++; err(`${owner}: 목소리 ${set.size}개 [${[...set].join(', ')}]`); }
  // 기준 kit 를 빌리는 영웅은 그 kit 소유자의 목소리를 쓴다(HEROES[id].voiceId 가 매니페스트 소유자여야 한다).
  stats.borrowers = {};
  for (const [id, def] of Object.entries(heroes)) {
    const owner = def.voiceId || id;
    if (!voicesByOwner[owner]) err(`영웅 ${id}: 보이스 소유자 ${owner} 가 매니페스트에 없다`);
    if (def.voiceId && def.voiceId !== id) stats.borrowers[id] = def.voiceId;
  }
  return { errors, stats, manifest };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { HEROES } = await import('../../src/data/heroes.js');
  const { errors, stats } = auditVoiceManifest({ heroes: HEROES });
  console.log(JSON.stringify(stats));
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log(`OK 영어 0건 · 목소리 2개 이상 소유자 0건 · 파일 ${stats.files}개`);
}
