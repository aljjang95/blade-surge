/** 아이템 렌더 스튜디오 드라이버.
 * 실행: (다른 터미널) bun x vite --host 127.0.0.1 --port 5391 --strictPort
 *       node tools/item-render-studio.mjs [--url http://127.0.0.1:5391] [--only id,id] [--review out-dir]
 * tools/item-render-studio.html 이 실제 3D 원본(item-forge · armor-appearance · armory GLB)을 gear-icon-studio 와 같은 카메라·조명으로 그린다.
 * 출력: public/img/item-renders/<id>.webp (256×256 투명 WebP), src/data/item-presentation.json (id · 원본 종류 · sha256 · 점유율).
 * --only 부분 실행은 아이콘만 쓰고 매니페스트를 덮어쓰지 않는다. 직접 띄운 dev 서버는 완료 후 종료한다.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { launchOpts } from './chrome.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const output = fileURLToPath(new URL('../public/img/item-renders/', import.meta.url));
const manifestPath = fileURLToPath(new URL('../src/data/item-presentation.json', import.meta.url));
const only = arg('--only', null), partial = !!only;
const reviewDir = arg('--review', null);
const browser = await chromium.launch(launchOpts());
const errors = [], receipt = [], samples = [];
try {
  await mkdir(output, { recursive: true });
  if (reviewDir) await mkdir(reviewDir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${arg('--url', 'http://127.0.0.1:5391')}/tools/item-render-studio.html`);
  await page.waitForFunction(() => window.itemRenderReady, undefined, { timeout: 120000 });
  const targets = await page.evaluate(() => window.itemRenderTargets);
  const ids = only ? only.split(',') : targets.map((target) => target.id);
  for (const id of ids) {
    const target = targets.find((entry) => entry.id === id);
    if (!target || !/^[a-z0-9_]+$/.test(id)) throw Error(`렌더 대상 아님: ${id}`);
    const result = await page.evaluate((itemId) => window.renderItem(itemId), id);
    const raw = Buffer.from(result.data.split(',')[1], 'base64');
    const bytes = await sharp(raw).resize(256, 256, { kernel: 'lanczos3' }).webp({ quality: 92, alphaQuality: 100, effort: 6 }).toBuffer();
    const metadata = await sharp(bytes).metadata(), stats = await sharp(bytes).stats();
    if (metadata.width !== 256 || metadata.height !== 256 || !metadata.hasAlpha || stats.channels[3].max === 0 || stats.channels[3].min !== 0) throw Error(`투명 렌더 검증 실패: ${id}`);
    await writeFile(`${output}/${id}.webp`, bytes);
    const { data } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let left = 256, top = 256, right = 0, bottom = 0;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) if (data[(y * 256 + x) * 4 + 3] > 16) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    const occupancy = Math.max(right - left + 1, bottom - top + 1) / 256;
    if (occupancy < .5 || occupancy > .95) throw Error(`프레임 점유율 범위 밖: ${id} ${occupancy.toFixed(3)}`);
    receipt.push({ id, slot: target.slot, source: target.source, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), drawCalls: result.drawCalls, occupancy: Number(occupancy.toFixed(3)) });
    samples.push({ id, bytes });
  }
  if (errors.length) throw Error(errors.join('\n'));
  // 형상 · 카메라를 정하는 원본만 해시한다. descriptor(item-presentation.js)는 URL 규칙이라 넣지 않는다.
  const sources = ['src/data/gear-catalog.js', 'src/data/items.js', 'src/data/armory.js', 'src/engine/item-forge.js', 'src/game/armor-appearance.js', 'tools/item-render-studio.html'];
  const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async (file) => [file, createHash('sha256').update((await readFile(fileURLToPath(new URL('../' + file, import.meta.url)), 'utf8')).replace(/\r\n/g, '\n')).digest('hex')])));
  if (reviewDir) {
    const thumb = 128, labelHeight = 22, columns = 10, rows = Math.ceil(samples.length / columns);
    const tiles = await Promise.all(samples.map(async ({ id, bytes }, i) => {
      const label = Buffer.from(`<svg width="${thumb}" height="${labelHeight}"><rect width="100%" height="100%" fill="#0d2333"/><text x="64" y="15" text-anchor="middle" font-family="Arial" font-size="9" fill="#eaf5ff">${id}</text></svg>`);
      const input = await sharp({ create: { width: thumb, height: thumb + labelHeight, channels: 4, background: '#123044' } }).composite([
        { input: await sharp(bytes).resize(thumb, thumb).png().toBuffer(), top: 0, left: 0 }, { input: label, top: thumb, left: 0 },
      ]).png().toBuffer();
      return { input, left: i % columns * thumb, top: Math.floor(i / columns) * (thumb + labelHeight) };
    }));
    await sharp({ create: { width: columns * thumb, height: rows * (thumb + labelHeight), channels: 4, background: '#123044' } }).composite(tiles).png().toFile(`${reviewDir}/item-renders-review.png`);
  }
  if (partial) {
    console.log(`부분 렌더 ${receipt.length}종 · 매니페스트는 유지 · 전체 실행으로 다시 고정해야 한다`);
  } else {
    await writeFile(manifestPath, JSON.stringify({ renderer: 'tools/item-render-studio.mjs + tools/item-render-studio.html (Three.js WebGL2, gear-icon-studio 카메라·조명)', sourceHashes, items: receipt.map(({ id, slot, source, sha256, occupancy }) => ({ id, slot, source, sha256, occupancy })) }, null, 2) + '\n');
    console.log(`아이템 렌더 ${receipt.length}종 · 256×256 투명 WebP · 브라우저 오류 ${errors.length}`);
  }
} finally { await browser.close(); }
