// 궁수 자세 스튜디오 캡처(로컬 루프백 전용). node tools/art/ranger-pose-capture.mjs <port> <outDir>
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { launchOpts } from '../chrome.mjs';
const [port = '5761', out = 'work/ranger-pose'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(launchOpts());
const results = {};
for (const mode of ['before', 'after']) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:' + port + '/tools/art/ranger-pose-studio.html?mode=' + mode);
  await page.waitForFunction(() => window.__rangerStudio, null, { timeout: 120000 });
  await page.waitForTimeout(500);
  results[mode] = { ...(await page.evaluate(() => window.__rangerStudio)), errors };
  await page.screenshot({ path: out + '/ranger-pose-' + mode + '.png' });
  await page.close();
}
await browser.close();
writeFileSync(out + '/ranger-pose-report.json', JSON.stringify(results, null, 1));
console.log(JSON.stringify({ before: results.before.revision, after: results.after.revision, errors: [results.before.errors, results.after.errors] }));

