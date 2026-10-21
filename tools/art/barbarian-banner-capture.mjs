// 광전사 드라칸 배너 렌더 캡처(로컬 루프백). node tools/art/barbarian-banner-capture.mjs <origin> <out.png> [shot=banner|portrait] [pose] [t] [rot]
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { launchOpts } from '../chrome.mjs';
const [origin = 'http://127.0.0.1:5173', out = 'work/barbarian-banner.png', shot = 'banner', pose = 'cheer', t = '0.42', rot = ''] = process.argv.slice(2);
const [w, h] = shot === 'banner' ? [900, 1200] : [768, 768];
const browser = await chromium.launch(launchOpts());
try {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}/tools/art/barbarian-banner-studio.html?w=${w}&h=${h}&shot=${shot}&pose=${pose}&t=${t}${rot ? `&rot=${rot}` : ''}`);
  await page.waitForFunction(() => window.__banner, null, { timeout: 180000 });
  const r = await page.evaluate(() => window.__banner);
  writeFileSync(out, Buffer.from(r.url.split(',')[1], 'base64'));
  console.log(JSON.stringify({ out, clip: r.clip, clips: r.clips, size: r.size, bodyAsset: r.bodyAsset, bbox: r.bbox, errors }));
} finally { await browser.close(); }
