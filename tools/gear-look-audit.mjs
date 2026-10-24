/**
 * 장비 외형 감사 — 폰 가로 화면(915x412)에서 영웅 화면 3D 미리보기가 장비·아바타에 따라 무엇이 바뀌는지 찍고 상태를 기록한다.
 *   bun run build && node tools/gear-look-audit.mjs [출력폴더=work/qa/gear-look] [영웅=knight]
 * 결과: 단계별 스크린샷 + result.json(몸체 asset id, 붙은 병기고 장식, 보이는 무기 노드, 외형 상태).
 */
import { chromium } from 'playwright';
import { launchOpts } from './chrome.mjs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const PROJ = resolve(decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'));
const PORT = 4311, OUT = resolve(PROJ, process.argv[2] || 'work/qa/gear-look'), HERO = process.argv[3] || 'knight';
mkdirSync(OUT, { recursive: true });
const srv = spawn(process.execPath, [resolve(PROJ, 'node_modules/vite/bin/vite.js'), ...(process.env.DEV ? [] : ['preview']), '--port', String(PORT), '--strictPort'], { cwd: PROJ, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://localhost:${PORT}/`)).ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 500)); }
if (!up) { srv.kill(); throw new Error('preview server did not start'); }
const br = await chromium.launch(launchOpts());
const page = await (await br.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: Number(process.env.DPR || 1), hasTouch: true })).newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const errors = [], steps = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 240) + ' @ ' + (e.stack || '').split('\n').slice(1, 4).join(' | ').slice(0, 400)));

// 단계마다 장비를 바꾸고 쇼케이스를 다시 지은 뒤 몸체 교체가 끝날 때까지 기다린다.
async function step(name, mutate) {
  const state = await page.evaluate(async ({ heroId, mutate }) => {
    const app = window.app, eco = app.eco;
    const put = (id, enh = 0) => { const inst = { uid: eco.s.invSeq++, id, enh }; eco.s.inventory.push(inst); eco.equip(heroId, inst.uid); };
    // eslint-disable-next-line no-new-func
    new Function('eco', 'put', 'heroId', mutate)(eco, put, heroId);
    eco.s.selected = heroId; eco.emit();
    await app.showcaseHero(heroId);
    app.meta.openTab('heroes');
    const t0 = performance.now();
    while (performance.now() - t0 < 30000) {
      const root = app.showcase?.root, want = eco.equippedAvatar(heroId);
      if (root && (!want || root.userData.libraryBodyAssetId === want) && (!root.userData.libraryTargetId || root.userData.libraryTargetId === root.userData.libraryBodyAssetId) && !document.querySelector('.wardrobe-loading')) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    // 미리보기는 장착 변경 뒤 다시 마운트되므로 로딩 표시가 2초 연속 사라질 때까지 기다린다.
    for (let calm = 0, t1 = performance.now(); calm < 4 && performance.now() - t1 < 30000;) {
      await new Promise((r) => setTimeout(r, 500));
      calm = document.querySelector('.wardrobe-loading') ? 0 : calm + 1;
    }
    const root = app.showcase.root, visible = [];
    root.traverse((o) => { if (o.isMesh && o.visible && /Sword|Shield|Axe|Staff|Wand|Knife|Bow|Spellbook|Crossbow|Armory_|Armor_|Gear_/.test(o.name + '|' + (o.parent?.name || ''))) visible.push(o.name || o.parent?.name); });
    return { body: root.userData.libraryBodyAssetId || null, tier: root.userData.libraryHeroTier || null, armory: root.userData.armoryAppearance || [], armor: root.userData.armorAppearance?.itemId || null, gear: root.userData.gearAppearance || null, visible: [...new Set(visible)], equip: Object.fromEntries(Object.entries(eco.heroEquipInsts(heroId)).map(([k, v]) => [k, v?.id || null])), avatar: eco.equippedAvatar(heroId) };
  }, { heroId: HERO, mutate });
  const file = `${String(steps.length).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: resolve(OUT, file) });
  steps.push({ name, file, ...state });
  console.log(name, JSON.stringify(state));
}

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 120000 });
  await page.click('#boot-start', { force: true }); await page.waitForTimeout(1500);
  for (let i = 0; i < 3; i++) { const close = page.getByRole('button', { name: '닫기' }).first(); if (await close.isVisible().catch(() => false)) { await close.click(); await page.waitForTimeout(400); } }
  await page.evaluate((heroId) => { const eco = window.app.eco; window.app.ui.confirm = async () => true; if (!eco.s.heroes[heroId]) (eco.s.roster.policy = 1, eco.s.roster.starterChosen = true); eco.s.gems = 99999; }, HERO);
  const clear = "for (const s of ['weapon','armor','ring','boots']) eco.unequip(heroId, s); eco.equipAvatar(heroId, null);";
  await step('base', clear);
  await step('armor-N', clear + "put('a_leather');");
  await step('armor-E', clear + "put('a_knight');");
  await step('armor-L', clear + "put('a_king');");
  await step('weapon-N', clear + "put('w_iron');");
  await step('weapon-E', clear + "put('w_knight');");
  await step('weapon-L', clear + "put('w_king', 10);");
  await step('full-N', clear + "for (const id of ['w_iron','a_leather','r_copper','b_cloth']) put(id);");
  await step('full-L', clear + "for (const id of ['w_king','a_king','r_king','b_king']) put(id, 15);");
  // 확대(상반신) 보기: 미리보기 버튼으로 전환한 뒤 찍는다.
  await step('full-L-close', clear + "for (const id of ['w_king','a_king','r_king','b_king']) put(id, 15);");
  await page.getByRole('button', { name: '상반신 확대' }).click().catch(() => {});
  await page.waitForTimeout(1200); await page.screenshot({ path: resolve(OUT, `${String(steps.length - 1).padStart(2, '0')}-full-L-close.png`) });
  // 미보유 아바타 시착: 저장은 바뀌지 않고 미리보기만 아바타 몸체가 된다.
  await page.getByRole('button', { name: '전신 보기' }).click().catch(() => {});
  await page.click('[data-avatar-try]'); await page.waitForTimeout(4000);
  await page.screenshot({ path: resolve(OUT, `${String(steps.length).padStart(2, '0')}-avatar-try.png`) });
  steps.push({ name: 'avatar-try', file: `${String(steps.length).padStart(2, '0')}-avatar-try.png`, previewBody: await page.evaluate(() => window.app.wardrobe.instance?.root.userData.libraryBodyAssetId || null), owned: await page.evaluate(() => window.app.eco.s.avatars.owned.slice()) });
  console.log('avatar-try', JSON.stringify(steps.at(-1)));
  await step('avatar', clear + "const a = { knight:'avatar_knight_sakura', barbarian:'avatar_barbarian_oni', mage:'avatar_mage_astral', rogue:'avatar_rogue_crow', ranger:'avatar_ranger_fox' }[heroId]; eco.buyAvatar(a); eco.equipAvatar(heroId, a);");
  await step('avatar-show-gear', "for (const id of ['w_king','a_king','r_king','b_king']) put(id, 15); eco.setShowGear(heroId, true);");
  await step('avatar-hide-gear', "eco.setShowGear(heroId, false);");
  // 전투 화면(블룸 포함)에서 장비 외형을 본다.
  await page.evaluate(async () => { window.app.eco.setShowGear(window.app.eco.s.selected, true); window.app.eco.s.energy = 9999; await window.app.startStage(window.app.eco.nextStage()); });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: resolve(OUT, `${String(steps.length).padStart(2, '0')}-battle-full-L.png`) });
  steps.push({ name: 'battle-full-L', gear: await page.evaluate(() => window.app.battle?.player?.model?.userData.gearAppearance || null), body: await page.evaluate(() => window.app.battle?.player?.model?.userData.libraryBodyAssetId || null) });
  console.log('battle', JSON.stringify(steps.at(-1)));
} finally {
  writeFileSync(resolve(OUT, 'result.json'), JSON.stringify({ at: new Date().toISOString(), hero: HERO, viewport: '915x412', steps, errors }, null, 2));
  console.log('errors', errors.length, errors.slice(0, 5));
  await br.close(); srv.kill();
}
