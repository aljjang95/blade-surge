/**
 * 캐시 아바타 런타임 QA — 준비 상태, 구매·착용, 로비·전투 몸체 교체, 해제 복귀와 콘솔 오류를 확인한다.
 *   bun run build && node tools/avatar-qa.mjs [출력폴더=work/qa/avatar]
 * manifest에 아바타 GLB가 없으면 준비 중 UI를 확인한 뒤 skipped로 종료한다.
 */
import { chromium } from 'playwright';
import { CHROME } from './chrome.mjs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const PROJ = resolve(decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'));
const PORT = 4297, OUT = resolve(PROJ, process.argv[2] || 'work/qa/avatar');
const manifest = JSON.parse(readFileSync(resolve(PROJ, 'asset-library/manifest.json'), 'utf8'));
const avatars = manifest.assets.filter((asset) => asset.avatar === true && asset.role === 'hero');
mkdirSync(OUT, { recursive: true });
const srv = spawn(process.execPath, [resolve(PROJ, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: PROJ, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://localhost:${PORT}/`)).ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 500)); }
if (!up) { srv.kill(); throw new Error('preview server did not start'); }
const br = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await br.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const errors = [], results = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text().slice(0, 240)); });
page.on('pageerror', (error) => errors.push('PAGEERR ' + error.message.slice(0, 240)));
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'OK   ' : 'FAIL ') + name, typeof detail === 'string' ? detail : JSON.stringify(detail ?? '')); };
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 120000 });
  await page.click('#boot-start', { force: true }); await page.waitForTimeout(1200);
  // 출석 보상 등 첫 진입 팝업이 화면을 덮으면 스크린샷 판정이 안 되므로 닫는다.
  for (let i = 0; i < 3; i++) { const close = page.getByRole('button', { name: '닫기' }).first(); if (await close.isVisible().catch(() => false)) { await close.click(); await page.waitForTimeout(400); } }
  await page.evaluate(() => { window.app.ui.confirm = async () => true; window.app.eco.s.gems = 10000; window.app.eco.emit(); window.app.meta.openTab('shop', 'avatar'); });
  await page.waitForSelector('[data-avatar]');
  const pending = await page.locator('[data-avatar]:disabled').count();
  check('아바타 카드 5개', await page.locator('[data-avatar]').count() === 5, await page.locator('[data-avatar]').count());
  if (!avatars.length) {
    check('자산 없음: 준비 중 표시', pending === 5, pending);
    await page.screenshot({ path: resolve(OUT, 'avatar-pending.png') });
    console.log('skipped: no avatar assets');
  } else {
    const id = avatars[0].id;
    await page.click(`[data-avatar="${id}"]`);
    await page.waitForFunction((avatarId) => window.app.eco.s.avatars.owned.includes(avatarId) && window.app.eco.equippedAvatar(window.app.eco.s.selected) === avatarId, id, { timeout: 30000 });
    await page.screenshot({ path: resolve(OUT, 'avatar-shop-equipped.png') });
    await page.evaluate(() => window.app.meta.openTab('heroes'));
    await page.waitForSelector('[data-avatar-action]');
    await page.waitForFunction((avatarId) => window.app.showcase?.root.userData.libraryBodyAssetId === avatarId, id, { timeout: 30000 });
    check('로비 쇼케이스 몸체가 아바타 asset id', await page.evaluate((avatarId) => window.app.showcase.root.userData.libraryBodyAssetId === avatarId, id), id);
    await page.screenshot({ path: resolve(OUT, 'avatar-lobby.png') });
    await page.evaluate(async () => { window.app.eco.s.energy = 9999; await window.app.startStage(window.app.eco.nextStage()); });
    await page.waitForFunction((avatarId) => window.app.battle?.player?.model?.userData.libraryBodyAssetId === avatarId, id, { timeout: 60000 });
    check('전투 플레이어 몸체가 아바타 asset id', await page.evaluate((avatarId) => window.app.battle.player.model.userData.libraryBodyAssetId === avatarId, id), id);
    await page.screenshot({ path: resolve(OUT, 'avatar-battle.png') });
    await page.evaluate(async () => { window.app.battle.stop(); window.app.toLobby(); window.app.eco.equipAvatar(window.app.eco.s.selected, null); await window.app.showcaseHero(window.app.eco.s.selected); });
    await page.waitForFunction((avatarId) => window.app.showcase?.root.userData.libraryBodyAssetId !== avatarId, id, { timeout: 30000 });
    check('해제 후 갑옷 단계 몸체 복귀', await page.evaluate((avatarId) => window.app.showcase.root.userData.libraryBodyAssetId !== avatarId, id), id);
    await page.screenshot({ path: resolve(OUT, 'avatar-unequipped.png') });
    // 나머지 영웅도 로비 쇼케이스에서 아바타 몸체로 바뀌는지 확인한다.
    for (const asset of avatars.slice(1)) {
      await page.evaluate(async ({ avatarId, heroId }) => {
        const eco = window.app.eco; eco.s.gems += 3000; eco.s.selected = heroId;
        eco.buyAvatar(avatarId); eco.equipAvatar(heroId, avatarId); await window.app.showcaseHero(heroId);
      }, { avatarId: asset.id, heroId: asset.heroId });
      const swapped = await page.waitForFunction((avatarId) => window.app.showcase?.root.userData.libraryBodyAssetId === avatarId, asset.id, { timeout: 30000 }).then(() => true, () => false);
      check(`로비 쇼케이스 몸체: ${asset.heroId}`, swapped, asset.id);
      await page.evaluate(() => window.app.meta.openTab('heroes'));
      await page.waitForTimeout(900);
      await page.screenshot({ path: resolve(OUT, `avatar-heroes-${asset.heroId}.png`) });
    }
  }
} finally {
  check('콘솔 오류 0', errors.length === 0, errors.slice(0, 5).join(' | '));
  writeFileSync(resolve(OUT, 'result.json'), JSON.stringify({ at: new Date().toISOString(), assets: avatars.map((asset) => asset.id), results, errors }, null, 2));
  await br.close(); srv.kill();
}
process.exitCode = results.every((result) => result.ok) ? 0 : 1;
