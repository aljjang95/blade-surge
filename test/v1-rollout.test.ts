import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { EXPECTED_TABLES, OBSERVE, STAGES, STAGE_IDS, checkUrl, interpretMe, migrationTables, parseArgs, renderStage } from '../tools/v1-rollout.mjs';
import { buildRequests } from '../tools/play-iap-register.mjs';

const allText = () => JSON.stringify(STAGES);

test('단계는 상태 확인 -> 0003·0004 -> p0 -> 5/25/100 -> 롤백 -> Play 테스트 순서다', () => {
  expect(STAGE_IDS).toEqual(['status', 'migrate', 'p0', 'p5', 'p25', 'p100', 'rollback', 'play-test']);
});

test('모든 단계가 dry-run 출력이고 집행형 플래그(--apply)·시크릿 쓰기를 명령으로 내놓지 않는다', () => {
  for (const s of STAGES) {
    const text = renderStage(s);
    expect(text).toContain('dry-run');
    for (const step of s.steps) for (const it of step.items) expect(it.run).not.toMatch(/--apply|secret put|secret bulk/);
  }
});

test('관찰 SQL은 전부 SELECT이고 쓰기 문장이 없다', () => {
  const queries = Object.values(OBSERVE).flatMap((v: any) => (typeof v === 'function' ? [v(25)] : [v]));
  for (const sql of queries) {
    expect(sql).toMatch(/^SELECT /);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE)\b/i);
  }
});

test('쓰기 SQL은 롤백 단계에만 있고 대상을 <ids>로 비워 둔다', () => {
  for (const s of STAGES) {
    const writes = s.steps.flatMap((x: any) => x.items).filter((it: any) => /\b(UPDATE|DELETE|INSERT)\b/.test(it.run));
    if (s.id === 'rollback') {
      expect(writes.length).toBe(2);
      for (const w of writes) expect(w.run).toContain('<ids>');
    } else expect(writes).toEqual([]);
  }
});

test('컷오버 단계는 wrangler.jsonc 수정 -> deploy.mjs 배포를 안내하고 기존 이용자 보호 PR 선행을 적는다', () => {
  for (const id of ['p5', 'p25', 'p100']) {
    const s = STAGES.find((x: any) => x.id === id)!;
    const text = renderStage(s);
    expect(text).toContain('wrangler.jsonc');
    expect(text).toContain('node tools/deploy.mjs --auth=wrangler');
    expect(text).toContain('claude/monetize-2-legacy-guard');
    expect(s.confirm).toBeTruthy();
    expect(s.pass.length).toBeGreaterThan(0);
    expect(s.abort.length).toBeGreaterThan(0);
  }
  expect(renderStage(STAGES.find((x: any) => x.id === 'p25')!)).toContain('"V1_SERVER_AUTHORITY_PERCENT": "25"');
});

test('롤백은 신규 컷오버 중지(percent 0) 다음에 SQL 순서이고 shadow 복귀를 적는다', () => {
  const text = renderStage(STAGES.find((x: any) => x.id === 'rollback')!);
  expect(text.indexOf('"V1_SERVER_AUTHORITY_PERCENT": "0"')).toBeLessThan(text.indexOf("SET authority = 'shadow'"));
  expect(text).toContain("SET status = 'shadow'");
});

test('기대 표 목록이 마이그레이션 파일(0001~0004)과 같고 문서에도 있다', () => {
  expect([...EXPECTED_TABLES]).toEqual(migrationTables());
  const doc = readFileSync(new URL('../docs/V1_ROLLOUT.md', import.meta.url), 'utf8');
  for (const t of EXPECTED_TABLES) expect(doc).toContain(t);
});

test('인자 검증: 알 수 없는 단계·집행 플래그·잘못된 URL·빈 호출은 거부', () => {
  expect(parseArgs(['--stage', 'p5']).errors).toEqual([]);
  expect(parseArgs(['--stage', 'p7']).errors.length).toBe(1);
  expect(parseArgs(['--stage', 'p5', '--apply']).errors.length).toBe(1);
  expect(parseArgs(['--stage']).errors.length).toBe(1);
  expect(parseArgs([]).errors.length).toBe(1);
  expect(parseArgs(['--list']).errors).toEqual([]);
  expect(parseArgs(['--check', 'http://blade.tllhouse.com']).errors.length).toBe(1);
  expect(parseArgs(['--check', 'https://blade.tllhouse.com/api?x=1']).errors.length).toBe(1);
  expect(parseArgs(['--check', 'https://u:p@blade.tllhouse.com']).errors.length).toBe(1);
  expect(parseArgs(['--check', 'https://blade.tllhouse.com']).errors).toEqual([]);
});

test('--check는 GET만 부르고 상태를 판독한다', async () => {
  const calls: any[] = [];
  const f = async (url: string, init: any) => {
    calls.push([init.method, new URL(url).pathname]);
    if (url.includes('version.json')) return { status: 200, json: async () => ({ sha: 'a'.repeat(40), dirty: false, builtAt: 't' }) };
    return { status: 401, json: async () => ({ error: 'token' }) };
  };
  const r = await checkUrl('https://blade.tllhouse.com/', f as any);
  expect(calls.every((c) => c[0] === 'GET')).toBe(true);
  expect(calls.map((c) => c[1])).toEqual(['/version.json', '/api/v1/me', '/api/v1/me']);
  expect(r.version.sha).toBe('a'.repeat(40));
  expect(r.verdict).toContain('정상');
});

test('판독: 닫힘 / SESSION_HMAC 없음 / 정상 / 예상 밖', () => {
  expect(interpretMe({ status: 503, error: 'unavailable' }, { status: 503, error: 'unavailable' })).toContain('V1 닫힘');
  expect(interpretMe({ status: 401, error: 'token' }, { status: 503, error: 'session-unavailable' })).toContain('SESSION_HMAC 없음');
  expect(interpretMe({ status: 401, error: 'token' }, { status: 401, error: 'token' })).toContain('정상');
  expect(interpretMe({ status: 500 }, { status: 500 })).toContain('예상 밖');
});

test('Play 테스트 단계 안내는 영웅 상품을 등록 대상으로 내놓지 않는다', () => {
  expect(JSON.stringify(buildRequests())).not.toMatch(/hero_/);
  expect(allText()).not.toMatch(/hero_(knight|all)/);
});
