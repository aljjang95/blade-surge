// 궁수 초상 렌더 캡처(로컬 루프백). node tools/art/ranger-portrait-capture.mjs <origin> <out.png> [pose]
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { launchOpts } from '../chrome.mjs';
const [origin = 'http://127.0.0.1:5761', out = 'work/ranger-portrait.png', pose = 'draw'] = process.argv.slice(2);
const browser = await chromium.launch(launchOpts());
try {
  const page = await browser.newPage({ viewport: { width: 1122, height: 1402 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/tools/art/ranger-portrait-studio.html?pose=' + pose);
  await page.waitForFunction(() => window.__portrait, null, { timeout: 180000 });
  const r = await page.evaluate(() => window.__portrait);
  writeFileSync(out, Buffer.from(r.url.split(',')[1], 'base64'));
  console.log(JSON.stringify({ out, pose: r.pose, revision: r.revision, errors }));
} finally { await browser.close(); }

