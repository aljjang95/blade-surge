// MMO P1 남용 제한: D1 고정 창 카운터(소셜 허브의 this.limit과 같은 "창 안 N회" 계약, 저장소는 이 Worker의 D1).
// 바인딩이 따로 없어 항상 동작하며 fail-closed 의존이 없다. 키는 해시된 IP 또는 계정 id만 쓴다(원문 IP 저장 없음).
import { fail } from './http';
import { sha256Hex } from './token';
import type { Ctx } from './auth';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** 이름 → [창 안 최대 횟수, 창 길이 ms]. 모바일 회선(CGNAT) 공유를 감안해 IP 한도는 넉넉하고 계정 한도는 정상 플레이를 막지 않는다. */
export const LIMITS = {
  session: [60, 10 * MINUTE],      // IP: /auth/session (기존 계정 갱신 포함)
  sessionNew: [30, HOUR],          // IP: 새 계정 생성
  recover: [20, 10 * MINUTE],      // IP: /auth/recover
  import: [20, HOUR],              // IP: /import
  cmd: [240, MINUTE],              // 계정: /cmd
  runStart: [30, MINUTE],          // 계정: /runs/start
} as const satisfies Record<string, readonly [number, number]>;
export type LimitName = keyof typeof LIMITS;

/** 요청 IP를 해시한다. 헤더가 없으면(로컬·테스트) 한 버킷으로 모인다. */
export async function ipKey(request: Request): Promise<string> {
  return (await sha256Hex('v1-rl:' + (request.headers.get('cf-connecting-ip') ?? 'local'))).slice(0, 32);
}

/** 창 안에서 이번 시도를 세고, max를 넘으면 429(Retry-After 초 포함)로 거부한다. 한 문장 UPSERT라 동시 요청에도 정확하다. */
export async function rateLimit(c: Ctx, name: LimitName, subject: string): Promise<void> {
  const [max, windowMs] = LIMITS[name];
  const win = Math.floor(c.now / windowMs), until = (win + 1) * windowMs, key = `${name}:${subject}`;
  const row = await c.db.prepare(`INSERT INTO v1_rate(key, win, n, until) VALUES (?, ?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET n = CASE WHEN v1_rate.win = excluded.win THEN v1_rate.n + 1 ELSE 1 END, win = excluded.win, until = excluded.until
    RETURNING n`).bind(key, win, until).first<{ n: number }>();
  if ((row?.n ?? 1) > max) fail(429, 'rate', { retryAfter: Math.max(1, Math.ceil((until - c.now) / 1000)) });
  // 새 창의 첫 시도에서만 만료된 행을 치운다(드물게, 인덱스 범위 삭제).
  if (row?.n === 1) await c.db.prepare('DELETE FROM v1_rate WHERE until < ?').bind(c.now - HOUR).run();
}
