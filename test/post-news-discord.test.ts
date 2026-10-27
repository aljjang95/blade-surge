import { describe, expect, test } from 'bun:test';
import { buildPayload, main } from '../tools/post-news-discord.mjs';
import { readNews } from '../tools/build-news.mjs';

const SECRET = 'https://discord.com/api/webhooks/123456789012345678/SECRET_token-value';
const run = async (argv: string[], deps: Record<string, unknown> = {}) => {
  const out: string[] = [], err: string[] = [];
  const code = await main(argv, { env: {}, log: (l: string) => out.push(l), error: (l: string) => err.push(l), ...deps } as any);
  return { code, out: out.join('\n'), err: err.join('\n') };
};
const patch = () => readNews().find((row: any) => row.type === 'patch');

describe('디스코드 소식 게시 도구', () => {
  test('본문: 멘션을 모두 끄고 제목·링크·색을 채운다', () => {
    const payload = buildPayload({ ...patch(), title: '@everyone 공지', summary: '@here 요약' });
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.embeds[0].url).toMatch(/^https:\/\/blade\.tllhouse\.com\/news\/.+\/$/);
    expect(payload.embeds[0].title).toContain('[패치노트 v1.0.3]');
    expect(payload.embeds[0].color).toBeGreaterThan(0);
    expect(payload.embeds[0].title.length).toBeLessThanOrEqual(256);
  });
  test('기본은 드라이런: JSON 만 출력하고 fetch 를 부르지 않으며 웹훅 값을 읽지도 않는다', async () => {
    let called = 0;
    const slug = (patch() as any).id;
    const { code, out } = await run(['--slug', slug], { env: { DISCORD_WEBHOOK_NEWS: SECRET }, fetchImpl: async () => { called += 1; return { ok: true }; } });
    expect(code).toBe(0);
    expect(called).toBe(0);
    expect(out).toContain('"allowed_mentions"');
    expect(out).toContain('드라이런');
    expect(out).not.toContain('SECRET');
  });
  test('--send 는 환경 변수의 웹훅으로만 보내고 값을 출력하지 않는다', async () => {
    const calls: any[] = [];
    const slug = (patch() as any).id;
    const { code, out, err } = await run(['--slug', slug, '--send'], { env: { DISCORD_WEBHOOK_NEWS: SECRET }, fetchImpl: async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 204 }; } });
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(SECRET);
    expect(calls[0].body.allowed_mentions).toEqual({ parse: [] });
    expect(out + err).not.toContain('SECRET');
  });
  test('웹훅이 없거나 형식이 다르면 전송하지 않고(코드 3) 값도 출력하지 않는다', async () => {
    const slug = (patch() as any).id;
    let called = 0;
    const fetchImpl = async () => { called += 1; return { ok: true }; };
    expect((await run(['--slug', slug, '--send'], { env: {}, fetchImpl })).code).toBe(3);
    const bad = await run(['--slug', slug, '--send'], { env: { DISCORD_WEBHOOK_NEWS: 'https://evil.example/hook?token=LEAK' }, fetchImpl });
    expect(bad.code).toBe(3);
    expect(bad.out + bad.err).not.toContain('LEAK');
    expect(called).toBe(0);
  });
  test('전송 실패는 코드 4, 없는 글·인자 오류는 코드 2', async () => {
    const slug = (patch() as any).id;
    expect((await run(['--slug', slug, '--send'], { env: { DISCORD_WEBHOOK_NEWS: SECRET }, fetchImpl: async () => ({ ok: false, status: 429 }) })).code).toBe(4);
    expect((await run(['--slug', slug, '--send'], { env: { DISCORD_WEBHOOK_NEWS: SECRET }, fetchImpl: async () => { throw new Error(SECRET); } })).code).toBe(4);
    expect((await run(['--slug', 'nope'])).code).toBe(2);
    expect((await run([])).code).toBe(2);
    expect((await run(['--bogus'])).code).toBe(2);
  });
});
