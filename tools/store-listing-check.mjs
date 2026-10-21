// Google Play 스토어 등록정보 길이·금칙어 검증. 사용법: node tools/store-listing-check.mjs [store/googleplay]
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '..', process.argv[2] || 'store/googleplay');
// Play 한도: 제목 30자, 짧은 설명 80자, 전체 설명 4000자 (유니코드 문자 수 기준).
const LIMITS = { title: 30, shortDescription: 80, fullDescription: 4000 };
// 근거 없는 홍보 문구·타 게임 이름·평점 사칭을 막는 금칙어.
const BANNED = [/#\s?1\b/i, /\b1위/, /최고\s?평점/, /별점/, /\bTOP\s?\d/i, /best game/i, /던파|던전앤파이터|디아블로|diablo|lineage|리니지|torchlight|path of exile|genshin|원신/i,
  /무료 다운로드/, /결제 가능/, /프리미엄 패스|배틀패스|월정액|VIP/];
let failed = false;
const fail = message => { failed = true; console.error('실패:', message); };

for (const file of fs.readdirSync(dir).filter(name => /^listing\..+\.json$/.test(name))) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const row = {};
  for (const [key, max] of Object.entries(LIMITS)) {
    const text = data[key];
    if (typeof text !== 'string' || !text.trim()) { fail(`${file}: ${key} 없음`); continue; }
    const length = [...text].length;
    row[key] = `${length}/${max}`;
    if (length > max) fail(`${file}: ${key} ${length}자 > ${max}자`);
    for (const pattern of BANNED) if (pattern.test(text)) fail(`${file}: ${key}에 금칙 표현 ${pattern}`);
  }
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(data.fullDescription) && /\p{Extended_Pictographic}/u.test(data.title)) fail(`${file}: 제목에 이모지`);
  const first = data.fullDescription.split('\n').filter(Boolean).slice(0, 2);
  console.log(file, JSON.stringify(row), '첫 두 줄:', JSON.stringify(first));
}
process.exit(failed ? 1 : 0);
