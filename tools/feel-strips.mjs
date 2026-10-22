// feel-fixture-qa 스크린샷을 영웅·장면별 프레임 띠로 묶는다. after 폴더가 있으면 위(전)·아래(후)로 쌓는다.
// 화면 중앙(영웅·대상 주변)만 잘라 HUD 를 뺀다. 사용: node tools/feel-strips.mjs <beforeDir> [afterDir] <outDir>
import sharp from 'sharp';
import { readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [beforeDir, afterDirArg, outArg] = process.argv.slice(2);
const afterDir = outArg ? afterDirArg : null, outDir = outArg || afterDirArg;
mkdirSync(outDir, { recursive: true });
const CROP = { left: 470, top: 120, width: 760, height: 560 };   // 1688x780 캡처 기준
const W = 380, H = 280;
const group = dir => {
  const map = new Map();
  for (const f of readdirSync(dir).filter(f => f.endsWith('.png')).sort()) {
    const m = f.match(/^(\w+)-(\w+)-(\d+)-(.+)\.png$/); if (!m) continue;
    const key = `${m[1]}-${m[2]}`; if (!map.has(key)) map.set(key, []); map.get(key).push({ file: join(dir, f), label: m[4] });
  }
  return map;
};
const tile = async (file, label) => {
  const img = await sharp(file).extract(CROP).resize(W, H).toBuffer();
  const svg = Buffer.from(`<svg width="${W}" height="${H}"><rect x="0" y="0" width="${W}" height="22" fill="rgba(0,0,0,.6)"/><text x="6" y="16" font-size="14" font-family="sans-serif" fill="#fff">${label}</text></svg>`);
  return sharp(img).composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer();
};
const row = async list => {
  const tiles = await Promise.all(list.map(x => tile(x.file, x.label)));
  return sharp({ create: { width: W * tiles.length, height: H, channels: 3, background: '#111' } })
    .composite(tiles.map((input, i) => ({ input, left: i * W, top: 0 }))).png().toBuffer();
};
const before = group(beforeDir), after = afterDir ? group(afterDir) : new Map();
for (const [key, list] of before) {
  const rows = [await row(list.map(x => ({ ...x, label: `전 ${x.label}` })))];
  if (after.has(key)) rows.push(await row(after.get(key).map(x => ({ ...x, label: `후 ${x.label}` }))));
  const width = Math.max(list.length, after.get(key)?.length || 0) * W;
  await sharp({ create: { width, height: H * rows.length, channels: 3, background: '#111' } })
    .composite(rows.map((input, i) => ({ input, left: 0, top: i * H }))).png().toFile(join(outDir, `strip-${key}.png`));
  console.log('strip', key);
}
