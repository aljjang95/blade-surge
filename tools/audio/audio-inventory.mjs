// 소리 재고 조사: 코드가 부르는 이벤트 → 파일 → 라우드니스(LUFS)·트루 피크·길이·루프 이음매를 한 표로 만든다.
// node tools/audio/audio-inventory.mjs --out <폴더>  → inventory.json, inventory.md
// 읽기 전용이다. 파일을 고치거나 다시 인코딩하지 않는다(음성 TTS 원본은 측정만 한다).
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import * as lib from '../../src/engine/combat-sound-library.js';
import * as music from '../../src/data/music.js';
import { CHAPTERS, stageDef } from '../../src/data/stages.js';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC = path.join(ROOT, 'public');
const args = process.argv.slice(2);
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(ROOT, 'work/audio-inventory');
const AUDIO_EXT = /\.(mp3|ogg|m4a|wav|opus)$/;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : AUDIO_EXT.test(e.name) ? [path.join(dir, e.name)] : []);
}

/** ffmpeg ebur128 + astats 한 번으로 통합 라우드니스·트루 피크·샘플 피크·RMS 를 잰다. */
async function measure(file) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af',
    'ebur128=peak=true:framelog=quiet,astats=metadata=0:measure_perchannel=none:measure_overall=Peak_level+RMS_level', '-f', 'null', '-'], { maxBuffer: 1 << 24 });
  const num = re => { const m = re.exec(stderr); return m ? Number(m[1]) : null; };
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(stderr);
  return {
    durationSec: dur ? +(Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])).toFixed(3) : null,
    lufs: num(/I:\s+(-?[\d.]+) LUFS/), lra: num(/LRA:\s+(-?[\d.]+) LU/), truePeakDb: num(/Peak:\s+(-?[\d.inf]+) dBFS/),
    samplePeakDb: num(/Peak level dB: (-?[\d.inf]+)/), rmsDb: num(/RMS level dB: (-?[\d.inf]+)/),
    sampleRate: num(/Audio: \w+.*?, (\d+) Hz/), channels: /Audio: .*?(mono|stereo)/.exec(stderr)?.[1] || null,
  };
}

/** 루프 이음매: 끝 50ms 와 처음 50ms 의 RMS(dBFS), 끝 3초의 평균 대비 감쇠. 끝이 조용해지면 루프에서 '뚝 끊김·빈 구간'이 들린다. */
async function seam(file) {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], { encoding: 'buffer', maxBuffer: 1 << 28 });
  const x = new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4));
  const rms = (a, b) => { let s = 0; for (let i = Math.max(0, a); i < Math.min(x.length, b); i++) s += x[i] * x[i]; return 10 * Math.log10(s / Math.max(1, b - a) + 1e-12); };
  const n = x.length, sr = 8000;
  return { headDb: +rms(0, sr * 0.05).toFixed(1), tailDb: +rms(n - sr * 0.05, n).toFixed(1), bodyDb: +rms(0, n).toFixed(1), last3sDb: +rms(n - sr * 3, n).toFixed(1) };
}

// 코드 → 파일 참조. 정적 문자열과 라이브러리 표를 함께 본다.
function codeReferences() {
  const refs = new Map(); // public 상대 경로 → 이벤트 목록
  const add = (rel, event) => { if (!refs.has(rel)) refs.set(rel, new Set()); refs.get(rel).add(event); };
  for (const n of lib.UI_SOUND_NAMES) add(lib.sfxUrl(n).slice(1), `ui/reward:${n}`);
  for (const n of lib.FX_SOUND_FILES) add(lib.sfxUrl(n).slice(1), `fx:${n.split('/').pop()}`);
  for (const n of lib.HIT_SOUND_FILES) add(lib.sfxUrl(n).slice(1), `hit:${n.split('/').pop()}`);
  for (const n of lib.COMBAT_SOUND_FILES) add(lib.sfxUrl(n).slice(1), `hero:${n.split('/').slice(-2).join('/')}`);
  for (const n of lib.EVENT_SOUND_FILES || []) add(lib.sfxUrl(n).slice(1), `event:${n.split('/').pop()}`);
  for (const n of lib.FX_DERIVED_FILES || []) add(lib.sfxUrl(n).slice(1), `fx:${n.split('/').pop()}(파생)`);
  const scenes = [['lobby', { scene: 'lobby' }], ['gacha', { scene: 'gacha' }], ['arena', { stage: { expedition: { kind: 'arena' } } }], ['boss', { boss: true }]];
  for (const t of ['garden', 'forge', 'frost', 'tide', 'crown']) scenes.push([`campaign:${t}`, { stage: { theme: t } }]);
  scenes.push(['campaign:homecoming', { stage: { ch: 6, theme: 'garden' } }]);
  for (const [label, ctx] of scenes) add(`bgm/${music.musicForScene(ctx)}.mp3`, `bgm:${label}`);
  for (const cue of music.FLOWMUSIC_CUE_PLAN) add(`bgm/${cue.fallback}.mp3`, `bgm-cue:${cue.id}`);
  for (const [cue, name] of Object.entries(music.BGM_CUES || {})) add(`bgm/${name}.mp3`, `bgm:${cue}`);
  // 캠페인 마을과 지역별 X-1..X-10(일반·중간 보스·최종 보스) 곡 지도
  for (const chapter of CHAPTERS) {
    const map = music.campaignMusicMap(chapter.id, { stageDef });
    add(`bgm/${map.town}.mp3`, `bgm:town:${music.TOWN_CUE_PLAN[chapter.id - 1]?.town || chapter.id}`);
    for (const row of map.stages) if (row.rank !== 'normal') add(`bgm/${row.boss}.mp3`, `bgm:boss:${row.rank}${row.rank === 'captain' ? '' : '(X-' + row.stage.split('-')[1] + ')'}`);
  }
  // Android 채널(googleplay·onestore)은 지역곡을 같은 이름의 Opus(.ogg)로 받는다(music.js bgmUrl).
  for (const [rel, events] of [...refs]) if (/^bgm\/regions\/.*\.mp3$/.test(rel)) for (const e of events) add(rel.replace(/\.mp3$/, '.ogg'), `android:${e}`);
  return refs;
}

const files = [...walk(path.join(PUBLIC, 'bgm')), ...walk(path.join(PUBLIC, 'sfx'))].sort();
const refs = codeReferences();
const rows = [];
let next = 0;
async function worker() {
  while (next < files.length) {
    const file = files[next++], rel = path.relative(PUBLIC, file).split(path.sep).join('/');
    const data = fs.readFileSync(file);
    const row = { file: rel, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), voice: rel.startsWith('sfx/voice/'),
      events: [...(refs.get(rel) || [])].sort(), ...(await measure(file)) };
    if (rel.startsWith('bgm/')) row.seam = await seam(file);
    rows.push(row);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
rows.sort((a, b) => a.file.localeCompare(b.file));

const bySha = new Map();
for (const r of rows) { if (!bySha.has(r.sha256)) bySha.set(r.sha256, []); bySha.get(r.sha256).push(r.file); }
const duplicates = [...bySha.values()].filter(g => g.length > 1);
const missing = [...refs.keys()].filter(rel => !rows.some(r => r.file === rel)).sort();
const unreferenced = rows.filter(r => !r.voice && !r.events.length).map(r => r.file);
const clipping = rows.filter(r => r.truePeakDb !== null && r.truePeakDb > -0.5).map(r => `${r.file} (${r.truePeakDb} dBTP)`);
const bgm = rows.filter(r => r.file.startsWith('bgm/') && r.events.length);
const summary = { generatedAt: new Date().toISOString(), files: rows.length, totalBytes: rows.reduce((s, r) => s + r.bytes, 0), missing, duplicates, unreferenced, clipping,
  bgmLufsSpread: bgm.length ? +(Math.max(...bgm.map(r => r.lufs)) - Math.min(...bgm.map(r => r.lufs))).toFixed(1) : null };
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'inventory.json'), JSON.stringify({ summary, rows }, null, 1));

const fmt = v => v === null || v === undefined ? '–' : String(v);
// 이벤트 → 파일 → LUFS/피크(이벤트 기준으로 뒤집은 표). 같은 이벤트의 변형 파일은 한 줄에 모은다.
const byEvent = new Map();
for (const r of rows) for (const e of r.events) {
  const key = e.replace(/\(파생\)$/, '').replace(/_\d+$/, '').replace(/\d+$/, '');
  if (!byEvent.has(key)) byEvent.set(key, []);
  byEvent.get(key).push(r);
}
const eventRows = [...byEvent].sort(([a], [b]) => a.localeCompare(b)).map(([e, rs]) => {
  const l = rs.map(r => r.lufs).filter(v => v !== null && v > -70), p = rs.map(r => r.truePeakDb).filter(v => v !== null);
  return `| ${e} | ${rs.length} | ${rs.map(r => r.file).join('<br>')} | ${l.length ? Math.min(...l) + (l.length > 1 ? ' ~ ' + Math.max(...l) : '') : '(짧음)'} | ${p.length ? Math.max(...p) : '–'} |`;
});
const md = ['# Blade Surge 소리 재고', '', `생성 ${summary.generatedAt} · 파일 ${rows.length}개 · ${(summary.totalBytes / 1e6).toFixed(2)} MB`, '',
  `- 코드가 부르는데 없는 파일: ${missing.length ? missing.join(', ') : '없음'}`,
  `- 같은 내용(SHA) 중복: ${duplicates.length}묶음`, ...duplicates.map(g => `  - ${g.join(' = ')}`),
  `- 코드가 부르지 않는 파일(음성 제외): ${unreferenced.length}개`, ...unreferenced.map(f => `  - ${f}`),
  `- 트루 피크 -0.5 dBTP 초과: ${clipping.length ? clipping.join(', ') : '없음'}`,
  `- 사용 중 BGM 라우드니스 폭: ${fmt(summary.bgmLufsSpread)} LU`, '',
  '## 이벤트 → 파일 → 라운드니스', '', '이벤트 이름의 변형 번호를 떼고 묶었다. LUFS 는 400ms 미만 효과음에서 -70(측정 불가)이라 비운다.', '',
  '| 이벤트 | 변형 수 | 파일 | LUFS(최소~최대) | 최대 dBTP |', '|---|---|---|---|---|', ...eventRows, '',
  '## BGM', '', '| 파일 | 이벤트 | 길이(s) | LUFS | dBTP | 끝50ms dB | 처음50ms dB | 마지막3s dB | 전체 dB |', '|---|---|---|---|---|---|---|---|---|',
  ...rows.filter(r => r.file.startsWith('bgm/')).map(r => `| ${r.file} | ${r.events.join('<br>') || '(미사용)'} | ${fmt(r.durationSec)} | ${fmt(r.lufs)} | ${fmt(r.truePeakDb)} | ${fmt(r.seam?.tailDb)} | ${fmt(r.seam?.headDb)} | ${fmt(r.seam?.last3sDb)} | ${fmt(r.seam?.bodyDb)} |`),
  '', '## 효과음', '', '| 파일 | 이벤트 | 길이(s) | LUFS | dBTP | 샘플 피크 dB | RMS dB | 바이트 |', '|---|---|---|---|---|---|---|---|',
  ...rows.filter(r => r.file.startsWith('sfx/') && !r.voice).map(r => `| ${r.file} | ${r.events.join(', ') || '(미사용)'} | ${fmt(r.durationSec)} | ${fmt(r.lufs)} | ${fmt(r.truePeakDb)} | ${fmt(r.samplePeakDb)} | ${fmt(r.rmsDb)} | ${r.bytes} |`),
  '', '## 음성(측정만, 손대지 않음)', '', '| 파일 | 길이(s) | LUFS | dBTP |', '|---|---|---|---|',
  ...rows.filter(r => r.voice).map(r => `| ${r.file} | ${fmt(r.durationSec)} | ${fmt(r.lufs)} | ${fmt(r.truePeakDb)} |`), ''];
fs.writeFileSync(path.join(outDir, 'inventory.md'), md.join('\n'));
console.log(JSON.stringify({ out: outDir, files: rows.length, missing: missing.length, duplicates: duplicates.length, unreferenced: unreferenced.length, clipping: clipping.length, bgmLufsSpread: summary.bgmLufsSpread }));
