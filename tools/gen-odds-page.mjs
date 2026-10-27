// 확률 정보 공개 페이지(public/odds.html) 생성기. 숫자는 전부 src/data/gacha-banners.js(GACHA_BANNERS)에서 읽는다.
// 사용: node tools/gen-odds-page.mjs (파일 쓰기) · node tools/gen-odds-page.mjs --check (다르면 exit 1).
// 출력은 결정적이다(시각·난수 없음). 테스트가 renderOddsPage()와 파일을 비교한다.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GACHA_BANNERS, BANNER_IDS, GACHA_MILEAGE } from '../src/data/gacha-banners.js';

const OUT = fileURLToPath(new URL('../public/odds.html', import.meta.url));

// 재료 키 → 표시 이름
const MATERIAL_NAMES = {
  stones: '강화석', stones2: '상급 강화석', protect: '강화 보호권', bless: '축복 주문서',
  transcendStones: '초월석', gold: '골드',
};
const matName = (k) => MATERIAL_NAMES[k] || k;
const num = (n) => Number(n).toLocaleString('en-US');
// 확률 표기: 소수 둘째 자리까지, 뒤 0 제거 안 함(항상 같은 자릿수)
const pct = (r) => `${(r * 100).toFixed(2)}%`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 배너별 pull번째 등급 확률(gacha-banners.js bannerChances와 같은 규칙을 표시용으로 직접 계산해 정본 값만 읽는다)
function chancesAt(b, pull) {
  if (pull >= b.pity) return { R: 0, SR: 0, SSR: 1 };
  const ssr = b.rates.SSR + (pull > b.softPity ? (pull - b.softPity) * b.softPityStep : 0);
  const tot = b.rates.R + b.rates.SR + ssr;
  return { R: b.rates.R / tot, SR: b.rates.SR / tot, SSR: ssr / tot };
}

function gradeTable(b) {
  const tot = b.rates.R + b.rates.SR + b.rates.SSR;
  return `<table><thead><tr><th>등급</th><th>기본 확률(1회)</th></tr></thead><tbody>
<tr><td>SSR</td><td>${pct(b.rates.SSR / tot)}</td></tr>
<tr><td>SR</td><td>${pct(b.rates.SR / tot)}</td></tr>
<tr><td>R</td><td>${pct(b.rates.R / tot)}</td></tr>
</tbody></table>`;
}

function pityText(b) {
  const lines = [];
  lines.push(`<li>천장(확정): ${num(b.pity)}회째 소환은 SSR이 확정됩니다.</li>`);
  if (b.softPityStep > 0 && b.softPity < b.pity) {
    lines.push(`<li>확률 상승: ${num(b.softPity)}회 연속으로 SSR이 나오지 않으면 ${num(b.softPity + 1)}회째부터 소환할 때마다 SSR 가중치가 ${num(b.softPityStep)}씩 늘어납니다(기본 가중치 ${num(b.rates.SSR)} 기준).</li>`);
    const rows = [];
    for (let p = b.softPity + 1; p <= b.pity; p++) rows.push(`<tr><td>${num(p)}회째</td><td>${pct(chancesAt(b, p).SSR)}</td></tr>`);
    lines.push(`<li>회차별 SSR 확률<table><thead><tr><th>회차</th><th>SSR 확률</th></tr></thead><tbody>${rows.join('')}</tbody></table></li>`);
  } else {
    lines.push('<li>확률 상승 구간은 없습니다.</li>');
  }
  lines.push('<li>10회 소환은 마지막 칸이 SR 이상으로 보장됩니다.</li>');
  return `<ul>${lines.join('')}</ul>`;
}

// 등급 안 분배(영웅/장비 몫 + 재료 비율)
function shareTable(b) {
  const kind = b.id === 'gear' ? 'gear' : 'hero';
  const kindName = kind === 'gear' ? '장비' : '영웅';
  const rows = [];
  for (const g of ['SSR', 'SR', 'R']) {
    const key = g.toLowerCase();
    const share = b[key][kind];
    const parts = [];
    if (share > 0) parts.push(`${kindName} ${pct(share)}`);
    for (const m of b.materials[g]) parts.push(`${matName(m.k)} ×${num(m.n)} ${pct(m.w)}`);
    rows.push(`<tr><td>${g}</td><td>${parts.join(' · ')}</td></tr>`);
  }
  return `<table><thead><tr><th>등급</th><th>등급 안 구성(합계 100%)</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function featuredText(b) {
  if (!b.ssr.featured) return '<p>픽업이 없습니다. SSR은 전부 같은 확률로 나옵니다.</p>';
  const kind = b.id === 'gear' ? '장비 세트' : '영웅';
  return `<p>SSR이 나왔을 때 이번 픽업 ${kind}일 확률은 ${pct(b.ssr.featured)}입니다. 픽업이 아닌 SSR이 나오면 다음 SSR은 픽업으로 확정됩니다.</p>`;
}

function bannerSection(b) {
  const price = [];
  if (b.single > 0) price.push(`1회 ${num(b.single)} 보석`);
  price.push(`10회 ${num(b.ten)} 보석`);
  const limit = b.limit ? `<p>계정당 ${num(b.limit)}회까지 소환할 수 있습니다. ${num(b.limit)}회 안에 SSR이 나오지 않으면 마지막 회차가 SSR 영웅으로 확정됩니다.</p>` : '';
  return `<h2>${esc(b.name)}</h2>
<p>소환 비용: ${price.join(' · ')}</p>
${gradeTable(b)}
${pityText(b)}
<h3>픽업</h3>
${featuredText(b)}
<h3>등급 안 구성</h3>
${shareTable(b)}
${limit}`;
}

// 사업자 정보 푸터(terms/refund/odds 공통 형식)
const FOOTER = `<footer><h2>사업자 정보</h2>
<ul>
<li>상호: {{대표님 입력}}</li>
<li>대표자: {{대표님 입력}}</li>
<li>사업자등록번호: {{대표님 입력}}</li>
<li>통신판매업 신고번호: {{대표님 입력}}</li>
<li>주소: {{대표님 입력}}</li>
<li>연락처(이메일): <a href="mailto:aljjang95@gmail.com">aljjang95@gmail.com</a> {{대표님 입력}}</li>
</ul></footer>`;

export function renderOddsPage() {
  const sections = BANNER_IDS.map((id) => bannerSection(GACHA_BANNERS[id])).join('\n');
  const m = GACHA_MILEAGE;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>블레이드 서지 확률 정보</title><style>body{max-width:780px;margin:40px auto;padding:0 24px;font:16px/1.8 system-ui;color:#173d34;background:#f8f1e5}a{color:#215b4b}table{border-collapse:collapse;margin:8px 0}th,td{border:1px solid #b9c9bf;padding:4px 10px;text-align:left}</style></head><body>
<!-- 이 파일은 tools/gen-odds-page.mjs가 src/data/gacha-banners.js로 생성한다. 직접 고치지 말고 생성기를 실행하세요. -->
<h1>블레이드 서지 확률 정보</h1><p>시행일: {{대표님 입력: 시행일}} · 운영자: 더럭셔리로드</p>
<p>게임산업법 제33조 제2항에 따라 소환(확률형 아이템)의 등급별 확률과 천장 규칙을 공개합니다. 아래 수치는 게임 서버가 쓰는 설정값에서 자동으로 만든 것입니다. 확률을 바꾸면 이 페이지와 게임 안 표시를 함께 고치고 적용 전에 알려 드립니다.</p>
<p><a href="/terms.html">이용약관</a> · <a href="/refund.html">청약철회·환불 정책</a> · <a href="/privacy.html">개인정보처리방침</a> · <a href="/support.html">고객지원</a></p>
${sections}
<h2>소환 마일리지</h2>
<p>영웅 소환을 1회 할 때마다 마일리지 ${num(m.perPull)}점이 쌓이고, ${num(m.cost)}점으로 지금 픽업 SSR 영웅 1명(또는 중복 조각)과 바꿀 수 있습니다. 픽업이 바뀌어도 점수는 사라지지 않습니다.</p>
${FOOTER}
</body></html>
`;
}

// 직접 실행했을 때만 파일을 쓰거나 검사한다(테스트가 import해도 부작용 없음).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = renderOddsPage();
  if (process.argv.includes('--check')) {
    let cur = '';
    try { cur = readFileSync(OUT, 'utf8'); } catch { /* 없으면 다름 */ }
    if (cur !== html) { console.error('public/odds.html 이 생성기 출력과 다릅니다. node tools/gen-odds-page.mjs 를 실행하세요.'); process.exit(1); }
    console.log('odds.html 최신');
  } else {
    writeFileSync(OUT, html);
    console.log('public/odds.html 생성');
  }
}
