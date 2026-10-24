// 첫 마을(초보자 마을) 룩 개발용 고정 시점 촬영. 실제 입력 QA가 아니다(걷기 모드 진입·위치는 테스트 훅으로 정한다).
// 사용법: node tools/starter-village-shot.mjs [origin=http://127.0.0.1:5199/] [out=work/starter-village/look] [--vp=1280x720] [--spots=entry,yard]
// 기록: 시점마다 png 와 렌더러 drawcalls·triangles 를 report.json 에 남긴다. SwiftShader 소프트웨어 렌더라 프레임 속도 판단에 쓰지 않는다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';

const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith('--'));
const origin = positional[0] || 'http://127.0.0.1:5199/', out = path.resolve(positional[1] || 'work/starter-village/look');
const [VW, VH] = (args.find(a => a.startsWith('--vp='))?.split('=')[1] || '1280x720').split('x').map(Number);
const mobile = VW < 1000 || VH > VW;
// 시점: 걷기 위치(x,z)와 바라볼 방향(카메라 yaw, 기본 북쪽).
const SPOTS = {
  entry: { x: 0, z: 9.6 }, guide: { x: -1.4, z: 7.4 }, yard: { x: -3.4, z: 2.4 }, board: { x: -2.6, z: -.8 },
  forge: { x: 3.2, z: 1.4 }, market: { x: 4.4, z: 6.6 }, statue: { x: 0, z: -2.6 }, portal: { x: 0, z: -6.8 },
};
const only = args.find(a => a.startsWith('--spots='))?.split('=')[1]?.split(',') || Object.keys(SPOTS);
await fs.mkdir(out, { recursive: true });
const today = Math.floor(Date.now() / 86400000);
const seed = { progress: { unlocked: 1, stars: {}, difficulty: 'story' }, heroes: { knight: { level: 1 } }, tutorial: { completed: true }, daily: { day: 0, last: today },
  roster: { policy: 2, owned: ['knight'], starter: 'knight', starterChosen: true, paid: [] }, selected: 'knight' };
const browser = await chromium.launch(launchOpts());
const context = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, locale: 'ko-KR', serviceWorkers: 'block' });
await context.addInitScript(([key, data]) => { try { if (!sessionStorage.getItem('qa-seeded')) { localStorage.setItem(key, JSON.stringify(data)); sessionStorage.setItem('qa-seeded', '1'); } } catch {} }, ['bladesurge_save_v1', seed]);
const page = await context.newPage();
const report = { origin, viewport: `${VW}x${VH}`, started: new Date().toISOString(), shots: [], errors: [] };
page.on('pageerror', e => report.errors.push(String(e).slice(0, 300)));
await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 300; i++) {
  if (await page.evaluate(() => window.app?.mode === 'lobby' && !!window.app?.arena?.lobbyHall && !!window.app?.showcase).catch(() => false)) break;
  // 시작 영웅 선택이 남아 있으면 기본 영웅으로 넘긴다.
  const start = page.locator('button.ss-go:visible:not([disabled])').first();
  if (await start.count()) await start.click().catch(() => {});
  else { const card = page.locator('.ss-card:visible, [data-hero]:visible').first(); if (await card.count()) await card.click().catch(() => {}); }
  await page.waitForTimeout(1000);
}
const tapStart = page.locator('button:visible', { hasText: '터치하여 시작' }).first();
if (await tapStart.count()) { await tapStart.click().catch(() => {}); await page.waitForTimeout(2000); }
await page.waitForTimeout(2500);
const walk = await page.evaluate(() => window.app.setHubWalkMode(true));
report.walk = walk;
for (const id of only) {
  const spot = SPOTS[id]; if (!spot) continue;
  await page.evaluate(({ x, z }) => { const a = window.app; a.hubMovement.reset({ x, y: 0, z }); a.syncHub(); }, spot);
  await page.waitForTimeout(1800);
  const file = `${VW}x${VH}-${id}.png`;
  await page.screenshot({ path: path.join(out, file), timeout: 120000 });
  const info = await page.evaluate(() => { const r = window.app.renderer.r.info.render; return { calls: r.calls, triangles: r.triangles, nearest: window.app.hubMovement.nearest?.id || null, starter: !!window.app.arena.lobbyHall?.userData?.starter }; });
  report.shots.push({ id, file, ...info });
  console.log(id, JSON.stringify(info));
}
await fs.writeFile(path.join(out, `report-${VW}x${VH}.json`), JSON.stringify(report, null, 2));
console.log('errors', report.errors.length, report.errors.slice(0, 3).join(' | '));
await browser.close();
