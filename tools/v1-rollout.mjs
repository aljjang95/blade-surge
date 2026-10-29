#!/usr/bin/env node
// V1(서버 저장) 단계 롤아웃 '실행 계획 출력 + 읽기 전용 확인' 도구. docs/V1_ROLLOUT.md의 명령 모음.
// 이 도구는 아무것도 바꾸지 않는다: D1·시크릿·변수·배포·Play 상품 어느 것도 건드리지 않고, 명령과 SELECT만 '출력'한다.
// 집행은 사람이 출력된 명령을 복사해 PC(C:\Work\tasks\blade-art-deploy)에서 실행한다.
//   node tools/v1-rollout.mjs --list                  단계 목록
//   node tools/v1-rollout.mjs --stage <단계>          해당 단계의 계획 출력(dry-run, 기본)
//   node tools/v1-rollout.mjs --stage <단계> --json   같은 내용을 JSON으로
//   node tools/v1-rollout.mjs --check <https URL>     공개 HTTP readback(GET만): version.json + /api/v1/me 상태 판독
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DB = 'blade-surge-commerce-production';
export const WORKER = 'blade-surge';
export const PC_DIR = 'C:\\Work\\tasks\\blade-art-deploy';
export const PERCENT_STEPS = [0, 5, 25, 100];
/** 0001~0005 적용 뒤 D1에 있어야 하는 표(sqlite_master 기준). 마이그레이션 파일과의 일치는 test/v1-rollout.test.ts가 고정한다. */
export const EXPECTED_TABLES = Object.freeze([
  'account_archive', 'account_docs', 'account_flags', 'account_keys', 'account_links', 'accounts', 'audit_flags',
  'funnel_active', 'funnel_milestones', 'iap_debt', 'iap_entitlements', 'iap_grants', 'iap_meta', 'iap_obf', 'iap_purchases',
  'iap_refund_guard', 'iap_rtdn', 'iap_web_payments', 'legacy_saves', 'mail', 'oauth_states', 'parity_log', 'run_tickets', 'sanctions',
  'v1_rate', 'v1_schema', 'wallet_ledger',
]);

const since = (hours) => `(strftime('%s','now') - ${hours * 3600}) * 1000`;
const q = (sql) => sql.replace(/\s+/g, ' ').trim();
const d1 = (sql) => `npx wrangler d1 execute ${DB} --remote --command "${q(sql).replaceAll('"', '\\"')}"`;
const WRANGLER_NOTE = 'PC에서 deploy.mjs와 같은 인증(기존 Wrangler OAuth). 클라우드 프록시는 apex-cloud 정책상 막힐 수 있다.';

/** 읽기 전용 관찰 SQL. 이름 → SELECT. 모두 집계이고 계정 id를 출력하지 않는다. */
export const OBSERVE = Object.freeze({
  schema: q(`SELECT version, applied_at FROM v1_schema WHERE singleton = 1`),
  tables: q(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name`),
  authority: q(`SELECT authority, COUNT(*) AS accounts FROM accounts GROUP BY authority`),
  coverage: (p) => q(`SELECT COUNT(*) AS total, SUM(authority = 'server') AS server, SUM(authority = 'shadow' AND shard < ${p}) AS pending_cutover, SUM(authority = 'server' AND shard >= ${p}) AS server_above_percent FROM accounts`),
  parity24h: q(`SELECT COUNT(*) AS n, SUM(match = 0) AS mismatch, ROUND(100.0 * SUM(match = 0) / MAX(COUNT(*), 1), 2) AS mismatch_pct FROM parity_log WHERE at >= ${since(24)}`),
  parityByOp: q(`SELECT op, COUNT(*) AS n, SUM(match = 0) AS mismatch FROM parity_log WHERE at >= ${since(24)} GROUP BY op ORDER BY mismatch DESC`),
  auditFlags: q(`SELECT kind, severity, COUNT(*) AS n FROM audit_flags WHERE resolved_at IS NULL AND at >= ${since(24)} GROUP BY kind, severity ORDER BY severity DESC, n DESC`),
  legacySaves: q(`SELECT status, COUNT(*) AS n FROM legacy_saves GROUP BY status`),
  legacyComp: q(`SELECT COUNT(*) AS legacy_comp_rows, COUNT(DISTINCT account_id) AS accounts FROM wallet_ledger WHERE op_id LIKE 'legacy-comp:%'`),
  clampHolds: q(`SELECT COUNT(*) AS holds FROM sanctions WHERE kind = 'payout_hold' AND reason = 'import-clamped'`),
  runs24h: q(`SELECT state, COUNT(*) AS n FROM run_tickets WHERE started_at >= ${since(24)} GROUP BY state`),
  ledger24h: q(`SELECT kind, COUNT(*) AS n FROM wallet_ledger WHERE at >= ${since(24)} GROUP BY kind ORDER BY n DESC LIMIT 20`),
  sanctions24h: q(`SELECT kind, COUNT(*) AS n FROM sanctions WHERE at >= ${since(24)} GROUP BY kind`),
  iapRows: q(`SELECT (SELECT COUNT(*) FROM iap_purchases) AS purchases, (SELECT COUNT(*) FROM iap_grants) AS grants, (SELECT COUNT(*) FROM iap_web_payments) AS web_payments`),
});

const section = (title, items) => ({ title, items });
const cmd = (label, run, note) => ({ label, run, ...(note ? { note } : {}) });
const sql = (label, query) => cmd(label, d1(query), '읽기 전용(SELECT)');
const statusSql = (p) => [
  sql('계정 권위 분포', OBSERVE.authority),
  sql(`컷오버 범위 점검(percent=${p})`, OBSERVE.coverage(p)),
  sql('패리티 불일치율(24시간)', OBSERVE.parity24h),
  sql('패리티 불일치 op별(24시간)', OBSERVE.parityByOp),
  sql('미해결 감사 플래그(24시간)', OBSERVE.auditFlags),
  sql('legacy_saves 상태 분포', OBSERVE.legacySaves),
  sql('legacy-comp 원장 수(기존 이용자 보상, 1계정 1행이어야 함)', OBSERVE.legacyComp),
  sql('가져오기 절삭 보류(import-clamped payout_hold)', OBSERVE.clampHolds),
  sql('런 티켓 상태(24시간)', OBSERVE.runs24h),
  sql('원장 종류(24시간)', OBSERVE.ledger24h),
  sql('제재(24시간)', OBSERVE.sanctions24h),
];
const tail5xx = cmd('5xx·내부 오류 관찰(잠깐만 켜고 Ctrl+C로 끝낸다)', `npx wrangler tail ${WORKER} --status error --format pretty`,
  '읽기 전용 스트림. 끝나면 반드시 멈춘다. 본문에는 "v1 error"(이름만, SQL·식별자 없음)가 남는다. 대시보드 Workers Metrics의 5xx 비율도 같이 본다.');
const GATE_LEGACY = '선행: 기존 이용자 보호 PR(claude/monetize-2-legacy-guard)이 main에 머지되고 배포까지 끝났을 것(version.json sha가 그 머지 커밋 이후). 안 됐으면 컷오버 금지 — 기존 이용자가 영웅 4명을 잃는다(BM_DESIGN 11.6-1).';
const GATE_GACHA = '선행(확인): 서버 권위 모드의 소환은 "서버 결과 먼저 받고 연출"이어야 한다(BM_DESIGN 12.7-1, GACHA_HANDOFF 남은 것 1). 미완이면 p0 이후(퍼센트 0 초과)로 가지 않는다.';

function cutover(percent, prev) {
  return {
    id: `p${percent}`,
    title: `V1_SERVER_AUTHORITY_PERCENT ${prev} -> ${percent}` + (percent === 100 ? ' (전체 컷오버)' : ''),
    confirm: `대표님 한 줄 확인 후 집행: "V1 서버 권위를 ${prev}%에서 ${percent}%로 올립니다(되돌리는 법은 docs/V1_ROLLOUT.md 6장)."`,
    gates: [GATE_LEGACY, GATE_GACHA, percent === 5 ? 'p0 단계(V1_ENABLED=true, percent 0)가 24시간 이상 합격 기준을 채웠을 것.' : `직전 단계(${prev}%)가 24시간 이상 합격 기준을 채웠을 것(가능하면 48시간).`],
    steps: [
      section('집행(사람이 PC에서)', [
        cmd('1. 새 브랜치에서 wrangler.jsonc 한 줄만 수정', `"V1_SERVER_AUTHORITY_PERCENT": "${percent}"`, 'vars는 wrangler.jsonc가 정본이다. 변경 PR -> 리뷰 -> main 머지. 다른 변수는 건드리지 않는다.'),
        cmd('2. 머지된 main 기준 깨끗한 worktree에서 가드 배포', `cd ${PC_DIR} && node tools/deploy.mjs --auth=wrangler`, '유일한 배포 컨트롤러(tools/deploy.mjs). HEAD가 라이브의 후속 커밋이어야 한다. ' + WRANGLER_NOTE),
        cmd('3. 배포 readback', 'node tools/v1-rollout.mjs --check https://blade.tllhouse.com', 'version.json sha가 방금 머지한 커밋과 같은지 본다.'),
      ]),
      section(`적용 직후 관찰(처음 1시간은 15분마다, 그 뒤 하루 2회)`, [...statusSql(percent), tail5xx]),
    ],
    pass: [
      '5xx(내부 오류 `internal`) 0.5% 미만, 인증·세션 401/403 비율이 직전 단계와 비슷.',
      '패리티 불일치율 1% 미만이고 표본 n >= 200(불일치가 몰린 op가 없을 것).',
      'audit_flags 미해결 severity>=2가 0건(또는 전부 원인 확인·무해 판정).',
      'legacy_saves에 rejected 비율 5% 미만, imported 계정 대비 legacy-comp 행이 계정당 최대 1.',
      '문의·로그에 "진행이 사라졌다" 유형 신고 0건.',
    ],
    abort: [
      '5xx 2% 이상이 15분 지속, 또는 D1 오류 급증.',
      '패리티 불일치율 5% 이상 또는 특정 op 불일치가 몰림(규칙 불일치 의심).',
      'severity>=3 audit_flags 신규, 또는 legacy-comp가 계정당 2행 이상(원장 UNIQUE 위반이므로 불가능해야 함 = 코드 이상).',
      '재화 증발·중복 지급 신고 1건이라도 확인되면 즉시 중단 후 원인 확인.',
      '중단 = 같은 절차로 percent를 이전 값(0)으로 낮춰 신규 컷오버만 멈춘다. 이미 server가 된 계정의 복귀는 6장.',
    ],
  };
}

export const STAGES = Object.freeze([
  {
    id: 'status',
    title: '현재 운영 상태 확인(읽기 전용)',
    confirm: null,
    gates: [],
    steps: [
      section('공개 HTTP', [
        cmd('버전·V1 상태 판독', 'node tools/v1-rollout.mjs --check https://blade.tllhouse.com', 'GET만. /version.json, /api/v1/me(토큰 없음), /api/v1/me(잘못된 토큰)로 플래그·스키마·SESSION_HMAC를 값 노출 없이 판독.'),
        cmd('직접 확인(같은 내용)', 'curl -s https://blade.tllhouse.com/version.json ; curl -s -i https://blade.tllhouse.com/api/v1/me ; curl -s -H "Authorization: Bearer v1.x" https://blade.tllhouse.com/api/v1/me'),
      ]),
      section('D1 스키마(PC)', [
        sql('스키마 버전(0001=1, 0002=2, 0003=3, 0004=4)', OBSERVE.schema),
        sql('존재하는 표(기대 목록은 docs/V1_ROLLOUT.md 2장)', OBSERVE.tables),
        sql('결제 표 행 수(적용 전엔 오류 no such table이 정상)', OBSERVE.iapRows),
        cmd('적용된 마이그레이션 목록', `npx wrangler d1 migrations list ${DB} --remote`, '읽기 전용. 어떤 파일이 아직 안 들어갔는지 본다.'),
      ]),
      section('SESSION_HMAC 바인딩 존재(값은 보지 않는다)', [
        cmd('Worker 시크릿 이름 목록', `npx wrangler secret list --name ${WORKER}`, '이름만 나온다(JSON의 name 필드). SESSION_HMAC가 있으면 된다. 값은 어떤 명령으로도 출력되지 않는다.'),
      ]),
    ],
    pass: ['version.json이 의도한 main sha·dirty=false.', '/api/v1/me가 503 unavailable이면 V1_ENABLED=false 이거나 스키마 미준비(둘은 응답으로 구분되지 않는다 -> D1 조회로 가른다).'],
    abort: [],
  },
  {
    id: 'migrate',
    title: 'D1 0003·0004 원격 적용',
    confirm: '대표님 한 줄 확인 후 집행: "운영 D1에 0003(결제 표)·0004(웹 결제 표)를 추가합니다. 모두 IF NOT EXISTS 추가형이라 기존 이용자·게임에 영향이 없습니다."',
    gates: ['status 단계로 현재 스키마 버전과 마이그레이션 목록을 먼저 확인했을 것.', '적용 직전 북마크를 기록했을 것(아래 1번).'],
    steps: [
      section('사전 백업(Time Travel 북마크 조회, 읽기 전용)', [
        cmd('1. 현재 시점 북마크', `npx wrangler d1 time-travel info ${DB}`, '출력된 bookmark를 PR/영수증에 적는다(비밀 아님). 복원할 때 이 값을 쓴다.'),
      ]),
      section('적용(사람이 PC에서)', [
        cmd('2. 적용 대상 미리 보기', `npx wrangler d1 migrations list ${DB} --remote`),
        cmd('3. 적용', `cd ${PC_DIR} && npx wrangler d1 migrations apply ${DB} --remote`, 'wrangler.jsonc의 migrations_dir(worker/v1/migrations)를 쓴다. 0001·0002가 이미 들어갔어도 전부 IF NOT EXISTS / version 가드라 재적용은 무해하다. ' + WRANGLER_NOTE),
      ]),
      section('적용 후 확인(읽기 전용)', [
        sql('스키마 버전이 4인지', OBSERVE.schema),
        sql('표 25개(기대 목록과 대조)', OBSERVE.tables),
        sql('결제 표 접근 가능(모두 0이면 정상)', OBSERVE.iapRows),
        cmd('남은 마이그레이션 없음 확인', `npx wrangler d1 migrations list ${DB} --remote`),
      ]),
      section('롤백(필요할 때만, 사람이)', [
        cmd('Time Travel 복원', `npx wrangler d1 time-travel restore ${DB} --bookmark=<위 1번 북마크>`, '데이터베이스 전체가 그 시점으로 돌아간다. 이후에 쓰인 모든 행(세션·계정 포함)이 사라지므로 V1이 켜지기 전(트래픽 0)에만 쓴다. 0003·0004는 추가형이라 보통 롤백하지 않고 둔다(코드가 쓰지 않으면 무해).'),
      ]),
    ],
    pass: ['스키마 버전 4, 표 목록이 기대와 같음.', 'V1_ENABLED가 아직 false이므로 /api/v1은 여전히 503(변화 없음).'],
    abort: ['migrations apply가 중간에 실패하면 중단하고 오류 원문을 확인(재실행은 안전). 데이터 이상이 보이면 Time Travel 복원 전에 대표님께 보고.'],
  },
  {
    id: 'p0',
    title: 'V1_ENABLED=true, V1_SERVER_AUTHORITY_PERCENT=0 (그림자 모드만 열기)',
    confirm: '대표님 한 줄 확인 후 집행: "/api/v1을 엽니다. 퍼센트 0이라 모든 계정은 그림자(로컬이 정본)이고 서버는 기록만 합니다."',
    gates: ['migrate 단계 완료(스키마 4).', 'SESSION_HMAC 시크릿이 Worker에 있을 것(32자 이상 값. 없으면 사람이 PC에서 `npx wrangler secret put SESSION_HMAC`를 직접 입력 — 값은 채팅·로그에 남기지 않는다).', 'IAP_ENABLED·WEB_BILLING_ENABLED는 false 유지(결제는 별도 단계).'],
    steps: [
      section('집행(사람이 PC에서)', [
        cmd('1. wrangler.jsonc 수정(PR -> 머지)', '"V1_ENABLED": "true"   # V1_SERVER_AUTHORITY_PERCENT는 "0" 그대로', 'IAP_*·WEB_BILLING_ENABLED는 건드리지 않는다.'),
        cmd('2. 가드 배포', `cd ${PC_DIR} && node tools/deploy.mjs --auth=wrangler`, WRANGLER_NOTE),
        cmd('3. readback', 'node tools/v1-rollout.mjs --check https://blade.tllhouse.com', '기대: 토큰 없음 401 token, 잘못된 토큰 401 token(=SESSION_HMAC 있음). 503 session-unavailable이면 시크릿 없음.'),
      ]),
      section('관찰', [...statusSql(0), tail5xx]),
    ],
    pass: ['/api/v1/me 두 요청 모두 401 token.', '새 계정 생성(sessionNew) 429 비율이 낮음(IP당 시간 30개 한도).', 'parity_log가 쌓이고 불일치율 1% 미만(그림자 스냅샷이 도는 클라이언트 한정).', '24시간 동안 5xx 0.5% 미만, authority=server 계정 0개 유지.'],
    abort: ['5xx 2% 이상 15분 지속 -> V1_ENABLED를 다시 false로(같은 절차). 클라이언트는 서버 불가를 로컬 연습으로 폴백한다(MMO_DESIGN 설정 절).'],
  },
  cutover(5, 0),
  cutover(25, 5),
  cutover(100, 25),
  {
    id: 'rollback',
    title: '롤백(퍼센트만 낮추는 것으로는 이미 server가 된 계정이 돌아오지 않는다)',
    confirm: '대표님 한 줄 확인 후 집행: "컷오버를 멈추고, 지정한 계정(또는 코호트)을 그림자로 되돌립니다. 되돌린 계정은 그 이후 서버에서 쌓인 진행이 화면에 반영되지 않을 수 있습니다."',
    gates: ['반드시 1 -> 2 순서: 먼저 신규 컷오버를 멈추고(배포) 그다음 SQL. 순서가 바뀌면 다음 세션 생성 때 maybeCutover가 다시 server로 올린다.'],
    steps: [
      section('1. 신규 컷오버 멈추기(사람이 PC에서)', [
        cmd('wrangler.jsonc: V1_SERVER_AUTHORITY_PERCENT를 "0"으로(PR -> 머지)', '"V1_SERVER_AUTHORITY_PERCENT": "0"'),
        cmd('가드 배포 + readback', `cd ${PC_DIR} && node tools/deploy.mjs --auth=wrangler && node tools/v1-rollout.mjs --check https://blade.tllhouse.com`, 'maybeCutover는 세션 생성 때만 돈다(토큰 수명 1시간). 배포 뒤 1시간 지나면 새로 server가 되는 계정이 없다.'),
      ]),
      section('2. 영향 범위 먼저 보기(읽기 전용)', [
        sql('권위 분포', OBSERVE.authority),
        sql('legacy_saves 상태', OBSERVE.legacySaves),
        sql('server 계정의 최근 원장(되돌리면 클라이언트에 안 보일 활동량)', OBSERVE.ledger24h),
      ]),
      section('3. 되돌리기 SQL(집행: 사람이, 계정 목록을 <ids>에 채운 뒤. 이 도구는 실행하지 않는다)', [
        cmd('권위 복귀', d1(`UPDATE accounts SET authority = 'shadow' WHERE authority = 'server' AND account_id IN (<ids>)`), '쓰기. 전체 되돌림이면 account_id 조건 대신 `AND shard < <되돌릴 퍼센트>`를 쓴다. 먼저 SELECT COUNT(*)로 대상 수를 확인.'),
        cmd('가져오기 기록을 그림자로 되돌림', d1(`UPDATE legacy_saves SET status = 'shadow' WHERE status IN ('imported') AND account_id IN (<ids>)`), '쓰기. restored가 아니라 shadow로 둬서 그림자 동기화(/shadow/snapshot)가 계속 돈다. 원문 doc은 보존된다.'),
      ]),
    ],
    pass: ['대상 계정의 authority가 shadow, 신규 server 계정 증가 0.'],
    abort: ['대상이 의도보다 많으면(COUNT 불일치) UPDATE를 실행하지 않는다.'],
  },
  {
    id: 'play-test',
    title: 'Play 내부 테스트 결제 E2E 준비(docs/PLAY_INTERNAL_TEST.md)',
    confirm: '대표님 한 줄 확인 후 집행: "Play 콘솔에 소환·패스·월정액 상품 4종을 등록하고, 내부 테스트 동안만 IAP_ENABLED/IAP_ALLOW_TEST를 켭니다. 테스트 종료 후 원복합니다."',
    gates: ['V1_ENABLED=true(p0 이상)이 선행. 테스트 계정은 그림자여도 된다(영웅 직접 판매는 판매 안 함).', 'RTDN은 선택(없으면 시간당 크론 대사가 안전망).'],
    steps: [
      section('Play 상품 등록 미리 보기(네트워크 없음)', [
        cmd('dry-run', 'node tools/play-iap-register.mjs', '기본 dry-run. 등록될 상품은 remove_ads_v1·starter_pack_v1·monthly_card_v1·season_pass_s1 4종뿐이다(영웅 hero_* 는 소환 전용이라 제외).'),
        cmd('현재 등록 상태(읽기 전용 GET 2개)', 'NODE_USE_ENV_PROXY=1 node tools/play-iap-register.mjs --probe', '클라우드 프록시 경유. --apply는 이 도구에서 출력하지 않는다.'),
      ]),
      section('집행 항목은 docs/PLAY_INTERNAL_TEST.md 순서대로', [
        cmd('요약', '1) 상품 등록(대표님 확인 뒤 사람이) 2) AAB 내부 트랙 3) 테스터 등록 4) IAP_ENABLED/IAP_ALLOW_TEST 켜고 배포 5) 구매->지급->환불->역분개 SQL 확인 6) 플래그 원복 배포'),
      ]),
    ],
    pass: ['PLAY_INTERNAL_TEST.md 6장 체크리스트 전부.'],
    abort: ['테스트 중 실제 결제(test=0)가 보이면 즉시 IAP_ENABLED=false로 되돌린다.'],
  },
]);

export const STAGE_IDS = Object.freeze(STAGES.map((s) => s.id));

export function parseArgs(argv) {
  const out = { stage: null, check: null, json: false, list: false, help: false, errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') out.list = true;
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--stage' || a === '--check') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) out.errors.push(`${a} 값이 필요하다`);
      else out[a.slice(2)] = v;
    } else if (a === '--apply' || a === '--execute' || a === '--run') out.errors.push(`${a}는 지원하지 않는다: 이 도구는 출력과 읽기 전용 확인만 한다(집행은 사람이 명령을 복사해 실행)`);
    else out.errors.push(`알 수 없는 인자: ${a}`);
  }
  if (out.stage && !STAGE_IDS.includes(out.stage)) out.errors.push(`알 수 없는 단계: ${out.stage} (가능: ${STAGE_IDS.join(', ')})`);
  if (out.check) {
    let u = null;
    try { u = new URL(out.check); } catch { /* 아래에서 오류 */ }
    if (!u || u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) out.errors.push('--check는 https 원점 URL(예: https://blade.tllhouse.com)만 받는다');
  }
  if (!out.list && !out.help && !out.stage && !out.check && !out.errors.length) out.errors.push('--stage <단계>, --check <URL>, --list 중 하나가 필요하다');
  return out;
}

export function renderStage(stage) {
  const lines = [`# ${stage.id}: ${stage.title}`, '(dry-run: 아래는 출력일 뿐 아무것도 실행되지 않았다)', ''];
  if (stage.confirm) lines.push(`[대표님 확인 필요] ${stage.confirm}`, '');
  if (stage.gates.length) { lines.push('## 선행 조건'); for (const g of stage.gates) lines.push(`- ${g}`); lines.push(''); }
  for (const s of stage.steps) {
    lines.push(`## ${s.title}`);
    for (const it of s.items) { lines.push(`- ${it.label}`, `    ${it.run}`); if (it.note) lines.push(`    # ${it.note}`); }
    lines.push('');
  }
  if (stage.pass.length) { lines.push('## 다음 단계로 가는 합격 기준'); for (const p of stage.pass) lines.push(`- ${p}`); lines.push(''); }
  if (stage.abort.length) { lines.push('## 중단 기준'); for (const p of stage.abort) lines.push(`- ${p}`); lines.push(''); }
  return lines.join('\n');
}

/** 응답 한 건을 사람이 읽는 판정으로 바꾼다. 본문 원문은 싣지 않는다(오류 코드만). */
export function interpretMe(noToken, badToken) {
  if (noToken.status === 503 && noToken.error === 'unavailable') return 'V1 닫힘: V1_ENABLED=false 이거나 D1 스키마가 준비되지 않음(응답만으로는 구분 불가 -> status 단계의 D1 조회로 확인)';
  if (noToken.status === 401 && badToken.status === 503 && badToken.error === 'session-unavailable') return 'V1 열림, 그러나 SESSION_HMAC 없음/32자 미만(세션 발급·검증 불가)';
  if (noToken.status === 401 && badToken.status === 401) return 'V1 열림 + 스키마 준비 + SESSION_HMAC 있음(정상)';
  return `예상 밖 응답: 토큰없음=${noToken.status}/${noToken.error ?? '-'}, 잘못된토큰=${badToken.status}/${badToken.error ?? '-'}`;
}

/** 공개 HTTP readback. GET만 보낸다(주입한 fetch로 시험). */
export async function checkUrl(origin, doFetch = globalThis.fetch) {
  const base = origin.replace(/\/+$/, '');
  const get = async (path, headers = {}) => {
    const res = await doFetch(base + path, { method: 'GET', headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  };
  const version = await get(`/version.json?verify=${Date.now()}`);
  const a = await get('/api/v1/me');
  const b = await get('/api/v1/me', { authorization: 'Bearer v1.x' });
  const pick = (r) => ({ status: r.status, error: typeof r.body?.error === 'string' ? r.body.error.slice(0, 40) : undefined });
  return {
    origin: base,
    version: { status: version.status, sha: typeof version.body?.sha === 'string' ? version.body.sha : null, dirty: version.body?.dirty ?? null, builtAt: version.body?.builtAt ?? null },
    me: { noToken: pick(a), badToken: pick(b) },
    verdict: interpretMe(pick(a), pick(b)),
  };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.errors.length) { for (const e of args.errors) console.error(`오류: ${e}`); return 2; }
  if (args.help) { console.log('사용: --list | --stage <단계> [--json] | --check <https 원점 URL>\n단계: ' + STAGE_IDS.join(', ')); return 0; }
  if (args.list) { for (const s of STAGES) console.log(`${s.id.padEnd(10)} ${s.title}`); return 0; }
  if (args.check) {
    const r = await checkUrl(args.check);
    console.log(JSON.stringify(r, null, 2));
    return r.version.status === 200 ? 0 : 1;
  }
  const stage = STAGES.find((s) => s.id === args.stage);
  console.log(args.json ? JSON.stringify(stage, null, 2) : renderStage(stage));
  return 0;
}

export function migrationTables(dir = fileURLToPath(new URL('../worker/v1/migrations/', import.meta.url))) {
  const names = new Set();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
    // 표 재생성용 임시 표(<이름>_vN → RENAME)는 최종 표 목록에서 뺀다.
    for (const m of readFileSync(dir + f, 'utf8').matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) if (!/_v\d+$/.test(m[1])) names.add(m[1]);
  }
  return [...names].sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
}
