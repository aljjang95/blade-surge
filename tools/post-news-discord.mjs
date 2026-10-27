// 소식 글을 디스코드 웹훅(#공지·#패치노트)으로 보낼 JSON 을 만든다.
//   node tools/post-news-discord.mjs --slug <글 id> [--send]
// 기본은 --dry-run: 보낼 JSON 만 출력하고 아무것도 전송하지 않는다. 실제 전송은 --send 를 명시했을 때만이고,
// 웹훅 URL 은 환경 변수 DISCORD_WEBHOOK_NEWS 에서만 읽으며 값은 어디에도 출력하지 않는다.
// 공개 게시라서 집행 직전 문구를 대표님께 확인한 뒤에만 --send 를 쓴다(docs/SPEC_720H.md 4A.2, docs/community-operations.md).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NEWS_TYPE_LABELS } from '../src/shared/news-core.js';
import { SITE_ORIGIN, readNews } from './build-news.mjs';

const COLORS = { notice: 0xffcf5a, patch: 0x6bff8f, devnote: 0x4cc3ff };
const WEBHOOK_PATTERN = /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const clip = (text, max) => { const chars = [...String(text)]; return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : String(text); };

/** 글 하나를 디스코드 웹훅 본문으로 바꾼다. 멘션은 allowed_mentions 로 전부 끈다. */
export function buildPayload(item) {
  const label = NEWS_TYPE_LABELS[item.type];
  return {
    username: 'Blade Surge',
    allowed_mentions: { parse: [] },
    embeds: [{
      title: clip(`[${label}${item.version ? ` v${item.version}` : ''}] ${item.title}`, 256),
      description: clip(`${item.summary}\n\n자세한 내용은 아래 링크에서 볼 수 있어요.`, 2000),
      url: `${SITE_ORIGIN}${item.url}`,
      color: COLORS[item.type],
      timestamp: new Date(item.date).toISOString(),
      footer: { text: 'BLADE SURGE · blade.tllhouse.com' },
    }],
  };
}

function parseArgs(argv) {
  const args = { send: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--send') args.send = true;
    else if (arg === '--dry-run') args.send = false;
    else if (arg === '--slug' || arg.startsWith('--slug=')) {
      const value = arg.includes('=') ? arg.slice(7) : argv[++i];
      if (!value || value.startsWith('--')) throw new Error('--slug 값이 필요합니다.');
      args.slug = value;
    } else throw new Error(`알 수 없는 인자: ${arg}`);
  }
  if (!args.slug) throw new Error('--slug <글 id> 가 필요합니다.');
  return args;
}

/**
 * @param {string[]} [argv]
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, newsDir?: string, log?: (line: string) => void, error?: (line: string) => void }} [deps]
 * @returns {Promise<number>} 종료 코드: 0 성공(드라이런 포함) · 2 인자/글 오류 · 3 웹훅 설정 오류 · 4 전송 실패
 */
export async function main(argv = process.argv.slice(2), { env = process.env, fetchImpl = globalThis.fetch, newsDir, log = console.log, error = console.error } = {}) {
  let args;
  try { args = parseArgs(argv); } catch (e) { error(e.message); return 2; }
  let items;
  try { items = readNews(newsDir); } catch (e) { error(e.message); return 2; }
  const item = items.find((row) => row.id === args.slug);
  if (!item) { error(`글을 찾지 못했습니다(초안은 제외): ${args.slug}`); return 2; }
  const payload = buildPayload(item);
  if (!args.send) {
    log(JSON.stringify(payload, null, 2));
    log('(드라이런: 전송하지 않았습니다. 실제 게시는 --send)');
    return 0;
  }
  const url = env.DISCORD_WEBHOOK_NEWS;
  if (!url || !WEBHOOK_PATTERN.test(url)) { error('환경 변수 DISCORD_WEBHOOK_NEWS 가 없거나 디스코드 웹훅 주소 형식이 아닙니다(값은 출력하지 않습니다).'); return 3; }
  try {
    const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
    if (!response.ok) { error(`전송 실패: HTTP ${response.status}`); return 4; }
  } catch { error('전송 실패: 네트워크 오류'); return 4; }
  log(`전송 완료: ${args.slug}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
