/** 영웅 형태 아이템 렌더 드라이버.
 * 실행(루프백 Vite 를 먼저 띄운다): bun x vite --host 127.0.0.1 --port 5497 --strictPort
 * node tools/item-render-variants.mjs [--url http://127.0.0.1:5497] [--only key,key] [--review 폴더] [--verify-canonical]
 * 쓰는 파일: public/img/item-renders/forms/<id>--<형태>.webp, src/data/item-presentation-variants.json(매니페스트).
 * --only 는 해당 key 그림과 매니페스트 항목만 갈아 끼우고 원본 해시를 다시 적는다(예: 영웅 GLB 가 바뀐 뒤 궁수 장식 조합만 다시 굽기).
 * --verify-canonical 은 기존 item-renders 무기 그림을 같은 장면으로 다시 찍어 SHA · 픽셀 차이만 보고하고 기존 파일은 쓰지 않는다.
 * --review 는 검수판(모든 무기 × 기본/영웅 5명)과 실루엣 비교 JSON 을 그 폴더에 쓴다.
 */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { launchOpts } from './chrome.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const root = fileURLToPath(new URL('../', import.meta.url));
const output = root + 'public/img/item-renders/forms/';
const manifestPath = root + 'src/data/item-presentation-variants.json';
const only = arg('--only', null), reviewDir = arg('--review', null), verifyCanonical = process.argv.includes('--verify-canonical');
const url = arg('--url', 'http://127.0.0.1:5497');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fileOf = (key) => key.replace('@', '--') + '.webp';
const encode = (raw) => sharp(raw).resize(256, 256, { kernel: 'lanczos3' }).webp({ quality: 92, alphaQuality: 100, effort: 6 }).toBuffer();

async function alphaMask(bytes) {
  const { data } = await sharp(bytes).resize(256, 256).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mask = new Uint8Array(256 * 256);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] > 16 ? 1 : 0;
  return mask;
}
function occupancyOf(mask) {
  let left = 256, top = 256, right = 0, bottom = 0;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) if (mask[y * 256 + x]) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return Math.max(right - left + 1, bottom - top + 1) / 256;
}
const iou = (a, b) => { let both = 0, any = 0; for (let i = 0; i < a.length; i++) { both += a[i] & b[i]; any += a[i] | b[i]; } return any ? both / any : 1; };

// 형상 · 카메라 · 조합을 정하는 원본. 바뀌면 test/item-visual-forms.test.ts 가 실패하므로 다시 굽는다.
const TEXT_SOURCES = ['src/data/gear-catalog.js', 'src/data/items.js', 'src/data/armory.js', 'src/engine/item-forge.js', 'src/engine/forged-weapons.js',
  'src/engine/armory-assets.js', 'src/engine/hero-model-paths.js', 'src/ui/item-visual-model.js', 'src/data/item-presentation-forms.json', 'tools/item-render-variants.html'];
async function assetSources() {
  const forge = (await readdir(root + 'public/models/dungeon-forge-v2')).filter((name) => name.endsWith('.glb')).sort().map((name) => 'public/models/dungeon-forge-v2/' + name);
  const armory = (await readdir(root + 'public/models/armory-v1')).filter((name) => name.endsWith('_weapon.glb')).sort().map((name) => 'public/models/armory-v1/' + name);
  return [...forge, ...armory];
}

const browser = await chromium.launch(launchOpts());
const errors = [], receipt = [], silhouettes = [];
try {
  await mkdir(output, { recursive: true });
  if (reviewDir) await mkdir(reviewDir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url + '/tools/item-render-variants.html');
  await page.waitForFunction(() => window.itemRenderReady, undefined, { timeout: 120000 });
  const targets = await page.evaluate(() => window.itemFormTargets);
  const keys = only ? only.split(',') : targets.map((target) => target.key);
  for (const key of keys) {
    const target = targets.find((entry) => entry.key === key);
    if (!target || !/^[a-z0-9_]+@[a-z0-9-]+$/.test(key)) throw Error('렌더 대상 아님: ' + key);
    const result = await page.evaluate((k) => window.renderItemForm(k), key);
    const bytes = await encode(Buffer.from(result.data.split(',')[1], 'base64'));
    const metadata = await sharp(bytes).metadata(), stats = await sharp(bytes).stats();
    if (metadata.width !== 256 || metadata.height !== 256 || !metadata.hasAlpha || stats.channels[3].max === 0 || stats.channels[3].min !== 0) throw Error('투명 렌더 검증 실패: ' + key);
    const mask = await alphaMask(bytes), occupancy = occupancyOf(mask);
    if (occupancy < .5 || occupancy > .95) throw Error('프레임 점유율 범위 밖: ' + key + ' ' + occupancy.toFixed(3));
    if (target.variant === 'armory-ornament' && !result.meshes.some((name) => name.startsWith('Ornament_'))) throw Error('장식 메시 없음: ' + key);
    await writeFile(output + fileOf(key), bytes);
    const [matrix] = await page.evaluate((id) => window.heroIconMatrix([id]), target.id);
    const canonicalMask = await alphaMask(await readFile(root + 'public' + matrix.canonical));
    silhouettes.push({ key, heroes: target.heroes, canonical: matrix.canonical, iouWithCanonical: Number(iou(mask, canonicalMask).toFixed(3)) });
    receipt.push({ key, id: target.id, heroes: target.heroes, variant: target.variant, form: target.form, count: target.count, formKey: target.formKey,
      file: fileOf(key), bytes: bytes.length, sha256: sha(bytes), occupancy: Number(occupancy.toFixed(3)), meshes: result.meshes.length });
  }
  if (errors.length) throw Error(errors.join('\n'));
  if (verifyCanonical) {
    const base = JSON.parse(await readFile(root + 'src/data/item-presentation.json', 'utf8'));
    const report = [];
    for (const entry of base.items.filter((item) => item.slot === 'weapon')) {
      const result = await page.evaluate((id) => window.renderCanonical(id), entry.id);
      const bytes = await encode(Buffer.from(result.data.split(',')[1], 'base64'));
      const existing = await readFile(root + 'public/img/item-renders/' + entry.id + '.webp');
      const [a, b] = await Promise.all([bytes, existing].map((input) => sharp(input).ensureAlpha().raw().toBuffer()));
      let diff = 0; for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
      report.push({ id: entry.id, source: entry.source, shaMatch: sha(bytes) === entry.sha256, meanAbsDiff: Number((diff / a.length).toFixed(4)) });
    }
    const matched = report.filter((entry) => entry.shaMatch).length;
    console.log('기존 무기 썸네일 재현: ' + matched + '/' + report.length + ' SHA 일치 · 최대 평균 픽셀 차 ' + Math.max(...report.map((entry) => entry.meanAbsDiff)));
    if (reviewDir) await writeFile(reviewDir + '/canonical-reproduction.json', JSON.stringify(report, null, 1) + '\n');
  }

  if (reviewDir) {
    await writeFile(reviewDir + '/silhouette-vs-canonical.json', JSON.stringify(silhouettes, null, 1) + '\n');
    const weaponIds = [...new Set(targets.map((target) => target.id))].sort();
    const matrix = await page.evaluate((ids) => window.heroIconMatrix(ids), weaponIds);
    const columns = ['canonical', 'knight', 'barbarian', 'mage', 'rogue', 'ranger'];
    const thumb = 112, label = 30, perSheet = 10;
    for (let sheet = 0; sheet * perSheet < matrix.length; sheet++) {
      const rows = matrix.slice(sheet * perSheet, sheet * perSheet + perSheet);
      const tiles = [];
      for (const [r, row] of rows.entries()) for (const [c, column] of columns.entries()) {
        const cell = column === 'canonical' ? { url: row.canonical, label: '기본 ' + row.id } : row.heroes[column];
        const caption = (cell.label || '').replace(/[<&>]/g, '');
        const svg = Buffer.from('<svg width="' + thumb + '" height="' + label + '"><rect width="100%" height="100%" fill="#0d2333"/><text x="56" y="12" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#eaf5ff">' + (column === 'canonical' ? row.id : column) + '</text><text x="56" y="25" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#ffd77a">' + (column === 'canonical' ? '기본' : caption) + '</text></svg>');
        const image = await sharp(await readFile(root + 'public' + cell.url)).resize(thumb, thumb).png().toBuffer();
        const input = await sharp({ create: { width: thumb, height: thumb + label, channels: 4, background: '#123044' } }).composite([{ input: image, top: 0, left: 0 }, { input: svg, top: thumb, left: 0 }]).png().toBuffer();
        tiles.push({ input, left: c * thumb, top: r * (thumb + label) });
      }
      await sharp({ create: { width: columns.length * thumb, height: rows.length * (thumb + label), channels: 4, background: '#123044' } }).composite(tiles).png().toFile(reviewDir + '/hero-forms-' + String(sheet + 1).padStart(2, '0') + '.png');
    }
  }
  // 매니페스트는 맨 마지막에 쓴다. Vite 가 이 JSON 변경을 감지해 스튜디오 페이지를 다시 불러오기 때문이다.
  const sourceHashes = Object.fromEntries(await Promise.all(TEXT_SOURCES.map(async (file) => [file, sha((await readFile(root + file, 'utf8')).replace(/\r\n/g, '\n'))])));
  const assetFiles = [...await assetSources(), ...['Mage', 'Rogue', 'Ranger'].map((name) => 'public/models/' + name + '.glb')];
  const assetHashes = Object.fromEntries(await Promise.all(assetFiles.map(async (file) => [file, sha(await readFile(root + file))])));
  const previous = only ? JSON.parse(await readFile(manifestPath, 'utf8')) : { variants: [] };
  const merged = new Map(previous.variants.map((entry) => [entry.key, entry]));
  for (const entry of receipt) merged.set(entry.key, entry);
  const variants = [...merged.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  await writeFile(manifestPath, JSON.stringify({
    renderer: 'tools/item-render-variants.mjs + tools/item-render-variants.html (Three.js WebGL2, item-render-studio 카메라·조명, 모델 = src/ui/item-visual-model.js)',
    recipe: 'bun x vite --host 127.0.0.1 --port 5497 --strictPort; node tools/item-render-variants.mjs --url http://127.0.0.1:5497',
    encode: { size: 256, format: 'webp', quality: 92, alphaQuality: 100, effort: 6, kernel: 'lanczos3', capture: 768 },
    sourceHashes, assetHashes, variants,
  }, null, 2) + '\n');
  console.log('영웅 형태 렌더 ' + receipt.length + '종 · 매니페스트 ' + variants.length + '종 · 합계 ' + variants.reduce((sum, entry) => sum + entry.bytes, 0) + 'B · 브라우저 오류 ' + errors.length);

} finally { await browser.close(); }
