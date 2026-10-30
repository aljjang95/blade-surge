// 게임 정보·등급 공개 페이지(public/game-info.html) 생성기. 등급 값은 전부 src/data/game-rating.js(GAME_RATING)에서 읽는다.
// 사용: node tools/gen-game-info-page.mjs (파일 쓰기) · node tools/gen-game-info-page.mjs --check (다르면 exit 1).
// 출력은 결정적이다(시각·난수 없음). 테스트가 renderGameInfoPage()와 파일을 비교한다.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GAME_RATING, ratingReady } from '../src/data/game-rating.js';
import { BUSINESS_INFO as B } from '../src/shared/business-info.js';

const OUT = fileURLToPath(new URL('../public/game-info.html', import.meta.url));
const AGE_TEXT = { '전체': '전체이용가', '12': '12세이용가', '15': '15세이용가', '청소년이용불가': '청소년이용불가' };
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** @param {import('../src/data/game-rating.js').GameRating} [rating] */
export function renderGameInfoPage(rating = GAME_RATING) {
  const ready = ratingReady(rating);
  const age = ready ? AGE_TEXT[rating.age] : '발급 대기 중';
  const notice = ready
    ? `원스토어를 통해 IARC 인증을 발급받은 대한민국 ${esc(age)} 게임물입니다.`
    : '원스토어 앱 등록과 IARC 등급 설문을 진행 중입니다. 대한민국 이용등급은 발급되는 대로 이 페이지와 게임 첫 화면에 표시합니다. 등급을 받기 전에는 등급 마크나 연령을 표시하지 않습니다.';
  const rows = [
    ['게임물 제명', '블레이드 서지'],
    ['제작·운영자', '더 럭셔리 로드(The Luxury Lord)'],
    ['서비스 유형', '모바일 웹 판타지 액션 RPG'],
    ['사행·환금 구조', '현금성 경품, 베팅, 이용자 간 아이템 거래, 환전·현금화 기능 없음. 보석으로 하는 확률형 소환이 있으며 등급별 확률·천장 규칙은 <a href="/odds.html">확률 정보</a>에 공개합니다.'],
    ['이용등급', ready ? `${esc(age)} — 원스토어 IARC 대한민국 결과` : esc(age)],
    ['등급분류 경로', '원스토어 IARC · 대한민국(KR)'],
    ['IARC 인증 ID', ready ? esc(rating.certId ?? rating.number) : '발급 후 기재'],
    ['IARC 인증 발급일', ready && rating.date ? esc(rating.date) : '발급 후 기재'],
    ['GRAC 직접 심사 번호', '별도 번호를 기재하지 않습니다. 위 IARC 인증 ID는 게임물관리위원회(GRAC) 직접 심사 번호가 아닙니다.'],
    ['게임물 내용정보', ready ? (rating.descriptors.length ? esc(rating.descriptors.join('·')) : '별도 내용정보 설명자 기재 없음') : '등급 발급 후 결과 그대로 기재'],
    ['상호작용 요소', '게임 내 구매, 이용자 간 채팅'],
    ['게임제작업 등록번호', esc(B.gameProductionNo)],
  ];
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>블레이드 서지 게임 정보·등급</title><style>body{max-width:780px;margin:40px auto;padding:0 24px;font:16px/1.8 system-ui;color:#173d34;background:#f8f1e5}a{color:#215b4b}table{border-collapse:collapse;margin:8px 0;width:100%}th,td{border:1px solid #b9c9bf;padding:6px 10px;text-align:left;vertical-align:top}th{width:9em;background:#eee4d2}.notice{border:1px solid #b9c9bf;background:#fffaf0;padding:10px 14px}</style></head><body>
<!-- 이 파일은 tools/gen-game-info-page.mjs가 src/data/game-rating.js로 생성한다. 직접 고치지 말고 생성기를 실행하세요. -->
<main data-rating-authority="IARC" data-rating-source="onestore-iarc" data-rating-status="${esc(rating.status)}">
<h1>블레이드 서지 게임 정보·등급</h1><p>운영자: 더럭셔리로드</p>
<p class="notice"><strong>${ready ? '유통 정보' : '등급 안내'}</strong><br>${notice}</p>
<h2>서비스 기본 정보</h2>
<table><tbody>
${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('\n')}
</tbody></table>
<h2>사업자 정보</h2>
<table><tbody>
<tr><th>상호</th><td>${esc(B.name)}</td></tr>
<tr><th>대표자</th><td>${esc(B.representative)}</td></tr>
<tr><th>소재지</th><td>${esc(B.address)}</td></tr>
<tr><th>사업자등록번호</th><td>${esc(B.registrationNo)}</td></tr>
<tr><th>통신판매업 신고번호</th><td>${esc(B.mailOrderNo)}</td></tr>
<tr><th>문의</th><td><a href="mailto:${esc(B.email)}">${esc(B.email)}</a> · 전화 ${esc(B.phone)}</td></tr>
</tbody></table>
<p><a href="/terms.html">이용약관</a> · <a href="/refund.html">청약철회·환불</a> · <a href="/privacy.html">개인정보처리방침</a> · <a href="/support.html">고객지원</a> · <a href="/odds.html">확률 정보</a> · <a href="/">블레이드 서지로 돌아가기</a></p>
</main>
</body></html>
`;
}

// 직접 실행했을 때만 파일을 쓰거나 검사한다(테스트가 import해도 부작용 없음).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = renderGameInfoPage();
  if (process.argv.includes('--check')) {
    let cur = '';
    try { cur = readFileSync(OUT, 'utf8'); } catch { /* 없으면 다름 */ }
    if (cur !== html) { console.error('public/game-info.html 이 생성기 출력과 다릅니다. node tools/gen-game-info-page.mjs 를 실행하세요.'); process.exit(1); }
    console.log('game-info.html 최신');
  } else {
    writeFileSync(OUT, html);
    console.log('public/game-info.html 생성');
  }
}
