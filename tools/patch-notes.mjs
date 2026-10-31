// 패치노트 초안 도구: 지난 배포 이후 머지된 PR 제목을 모아 분류하고 content/news/<오늘>-patch-<버전>.md 초안을 만든다.
//   node tools/patch-notes.mjs [--since <sha|tag>] [--until <ref>] [--version 1.0.4] [--date 2026-10-27] [--out-dir content/news]
// --since 기본값은 운영(https://blade.tllhouse.com/version.json)의 sha 다. 읽지 못하면 --since 가 필수다.
// 초안은 draft: true 라 빌드에 실리지 않는다. 지휘가 이용자 말투로 다듬고 draft 줄을 지운 뒤 같은 배포에 싣는다(docs/SPEC_720H.md 4A.2).
// 종료 코드: 0 만듦 · 1 같은 파일이 이미 있음(덮어쓰지 않음) · 2 인자/기준 커밋 오류.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PATCH_SECTIONS } from '../src/shared/news-core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
export const LIVE_VERSION_URL = 'https://blade.tllhouse.com/version.json';

// 제목 접두어/단어가 이 중 하나면 이용자에게 보이지 않는 변경이다.
const INTERNAL = /^(?:문서|테스트|기획|리팩터(?:링)?|빌드|도구|인계|docs?|test|tests|perf|chore|refactor|build|ci|style|infra)(?:\s*[:(·\-]|\s|$)/i;
const BALANCE = /밸런스|능력치|배율|너프|버프|난이도 조정|확률 조정|수치 조정|balance/i;
const FIX = /수정|고침|해결|버그|오류|잘림|꺼짐|겹침|깨짐|묻힘|흐림|fix/i;
const NEW = /추가|신규|새로|새 |첫 |리메이크|SSR|픽업|이벤트|시즌|해금|오픈|\d차\s*:|\bnew\b/i;

/** PR 제목 하나를 'internal' 또는 PATCH_SECTIONS 중 하나로 가른다. */
export function classifyTitle(title) {
  const text = String(title || '').trim();
  if (INTERNAL.test(text)) return 'internal';
  if (BALANCE.test(text)) return '밸런스';
  if (FIX.test(text) && !/추가|신규|새로/.test(text)) return '버그 수정';
  if (NEW.test(text)) return '새 콘텐츠';
  return '개선';
}

/**
 * git log(`%H%x1f%s%x1f%b%x1e`) 출력에서 PR 번호·제목을 모은다. 스쿼시(`제목 (#12)`)와 머지 커밋(`Merge pull request #12 …` + 본문 제목)을 모두 읽는다.
 * @returns {{ pr: number | null, sha: string, title: string }[]} 같은 PR 은 한 번만, 최신 커밋부터.
 */
export function parsePrs(logText) {
  const rows = [];
  const seen = new Set();
  for (const record of String(logText).split('\x1e')) {
    const [sha = '', subject = '', body = ''] = record.replace(/^\n+/, '').split('\x1f');
    if (!sha.trim()) continue;
    let pr = null, title = subject.trim();
    const merge = /^Merge pull request #(\d+) from \S+/.exec(title);
    if (merge) {
      pr = Number(merge[1]);
      title = body.split('\n').map((line) => line.trim()).find(Boolean) || title;
    } else {
      const squash = /\s*\(#(\d+)\)\s*$/.exec(title);
      if (squash) { pr = Number(squash[1]); title = title.slice(0, squash.index).trim(); }
    }
    // 'X (#292) (#296)' 처럼 번호가 겹쳐 붙은 제목에서 남은 번호 표기를 걷어낸다.
    title = title.replace(/\s*\(#\d+\)/g, '').trim();
    if (!title) continue;
    const key = pr !== null ? `pr:${pr}` : `sha:${sha.trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ pr, sha: sha.trim(), title });
  }
  return rows;
}

/** 이미 있는 패치 파일 이름(`<날짜>-patch-1-0-3.md`)들에서 다음 패치 버전을 정한다. */
export function nextPatchVersion(fileNames) {
  let best = null;
  for (const name of fileNames) {
    const match = /-patch-(\d+)-(\d+)-(\d+)\.md$/.exec(name);
    if (!match) continue;
    const version = match.slice(1, 4).map(Number);
    if (!best || version[0] > best[0] || (version[0] === best[0] && (version[1] > best[1] || (version[1] === best[1] && version[2] > best[2])))) best = version;
  }
  return best ? `${best[0]}.${best[1]}.${best[2] + 1}` : '1.0.0';
}

const kstNow = (now) => new Date(now.getTime() + 9 * 3600000).toISOString();

/** 초안 마크다운. 분류 결과와 뺀 내부 변경은 머리말의 # 주석에 남겨 다듬는 사람이 볼 수 있게 한다. */
export function renderDraft({ rows, version, now = new Date(), since, until }) {
  const buckets = new Map(PATCH_SECTIONS.map((name) => [name, []]));
  const internal = [];
  for (const row of rows) {
    const kind = classifyTitle(row.title);
    (kind === 'internal' ? internal : buckets.get(kind)).push(row);
  }
  const ref = (row) => (row.pr !== null ? `#${row.pr}` : row.sha.slice(0, 7));
  const visible = [...buckets.values()].reduce((sum, list) => sum + list.length, 0);
  const iso = kstNow(now);
  const lines = [
    '---',
    '# 초안입니다. 이용자 말투(짧고 친근한 존댓말)로 다듬고, 이용자에게 안 보이는 줄은 지우고, 아래 draft 줄을 지우면 다음 빌드에 실립니다.',
    `# 범위: ${since}..${until} · 이용자 변경 ${visible}건 · 내부 변경 ${internal.length}건(본문에서 뺌)`,
    ...internal.map((row) => `# 내부: ${ref(row)} ${row.title.replace(/\n/g, ' ')}`),
    'type: patch',
    `title: ${version} 패치노트`,
    `date: ${iso.slice(0, 16)}:00+09:00`,
    `version: ${version}`,
    'pinned: false',
    'draft: true',
    '---',
    '이번 패치에서 달라진 점이에요.',
    '',
  ];
  for (const [name, list] of buckets) {
    if (!list.length) continue;
    lines.push(`## ${name}`, ...list.map((row) => `- ${row.title} (${ref(row)})`), '');
  }
  if (!visible) lines.push('- (이용자에게 보이는 변경이 아직 없어요. 필요하면 직접 적어 주세요.)', '');
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`알 수 없는 인자: ${arg}`);
    const [key, inline] = arg.slice(2).split(/=(.*)/s);
    if (!['since', 'until', 'version', 'date', 'out-dir'].includes(key)) throw new Error(`알 수 없는 옵션: --${key}`);
    const value = inline !== undefined ? inline : argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`--${key} 값이 필요합니다.`);
    args[key] = value;
  }
  return args;
}

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

async function liveSha(fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl(LIVE_VERSION_URL, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const sha = (await response.json())?.sha;
    return typeof sha === 'string' && /^[0-9a-f]{7,40}$/.test(sha) ? sha : null;
  } catch { return null; }
}

/** 기준 커밋을 확인한다. 없으면 null. */
function resolveCommit(ref) {
  try { return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim() || null; } catch { return null; }
}

/**
 * @param {string[]} [argv]
 * @param {{ now?: Date, fetchImpl?: typeof fetch }} [deps]
 * @returns {Promise<number>} 종료 코드
 */
export async function main(argv = process.argv.slice(2), { now = new Date(), fetchImpl } = {}) {
  let args;
  try { args = parseArgs(argv); } catch (error) { console.error(error.message); return 2; }
  const since = args.since || await liveSha(fetchImpl);
  if (!since) { console.error('운영 version.json 의 sha 를 읽지 못했습니다. --since <sha|tag> 로 기준을 직접 주세요.'); return 2; }
  if (!resolveCommit(since)) { console.error(`기준 커밋 '${since}' 를 이 저장소에서 찾지 못했습니다(git fetch origin main 을 먼저 하거나 --since 를 확인하세요).`); return 2; }
  const until = args.until || 'HEAD';
  if (!resolveCommit(until)) { console.error(`끝 커밋 '${until}' 를 찾지 못했습니다.`); return 2; }
  const outDir = path.resolve(ROOT, args['out-dir'] || 'content/news');
  fs.mkdirSync(outDir, { recursive: true });
  const version = args.version || nextPatchVersion(fs.readdirSync(outDir));
  if (!/^\d+(?:\.\d+){1,3}$/.test(version)) { console.error(`--version 형식이 올바르지 않습니다: ${version}`); return 2; }
  const date = args.date || kstNow(now).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.error(`--date 는 YYYY-MM-DD 여야 합니다: ${date}`); return 2; }
  const file = path.join(outDir, `${date}-patch-${version.replace(/\./g, '-')}.md`);
  if (fs.existsSync(file)) { console.error(`이미 있습니다(덮어쓰지 않음): ${path.relative(ROOT, file)}`); return 1; }
  const log = git(['log', '--first-parent', '--format=%H%x1f%s%x1f%b%x1e', `${since}..${until}`]);
  const rows = parsePrs(log);
  const draftNow = args.date ? new Date(`${date}T01:00:00Z`) : now;
  fs.writeFileSync(file, renderDraft({ rows, version, now: draftNow, since: since.slice(0, 12), until }), { flag: 'wx' });
  console.log(`초안 생성: ${path.relative(ROOT, file)} (PR/커밋 ${rows.length}건)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
