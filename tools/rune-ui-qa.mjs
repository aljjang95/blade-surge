// 룬 UI(R3) 실제 화면 QA: 장비 상세 → 룬 소켓 탭 → 룬 고르기 → 박기 → 각인판 → 자동 장착 → 제작 공방 룬 합성.
// 사용: bun run dev -- --port 5288 후 `node tools/rune-ui-qa.mjs [baseUrl]`. 캡처·보고는 work/qa/rune-ui/ (커밋하지 않음).
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const base = process.argv[2] || 'http://127.0.0.1:5288/';
const out = process.env.RUNE_QA_OUT || 'work/qa/rune-ui';
const sizes = (process.env.RUNE_QA_SIZES || '844x390,800x360,1280x720,390x844').split(',').map((s) => s.split('x').map(Number));
await fs.mkdir(out, { recursive: true });
const report = { base, at: new Date().toISOString(), sizes: {}, errors: [] };

/** 모달 안 글자 잘림·넘침 검사: 가로로 넘친 글자 요소. */
const clipCheck = () => {
  const box = document.querySelector('#modal.show .modal-box') || document.querySelector('.exp-shell .rune-bag');
  if (!box) return { clipped: [], overflowX: false };
  const clipped = [];
  for (const el of box.querySelectorAll('small,b,em,span,button,h2,h3,p')) {
    const r = el.getBoundingClientRect(); if (!r.width || getComputedStyle(el).visibility === 'hidden') continue;
    if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') clipped.push(el.className + ':' + el.textContent.trim().slice(0, 24));
    const br = box.getBoundingClientRect();
    if (el.textContent.trim() && (r.right > br.right + 1 || r.left < br.left - 1) && !el.closest('.rp-grid,.rp-filters')) clipped.push('out:' + el.className + ':' + el.textContent.trim().slice(0, 24));
  }
  return { clipped: [...new Set(clipped)].slice(0, 20), overflowX: box.scrollWidth > box.clientWidth + 1 };
};

const browser = await chromium.launch({ ...(process.env.RUNE_QA_CHROME ? { executablePath: process.env.RUNE_QA_CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
try {
  for (const [w, h] of sizes) {
    const tag = w + 'x' + h, rec = { shots: [], checks: {} };
    report.sizes[tag] = rec;
    const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: true, isMobile: w < h || w <= 900 });
    page.on('pageerror', (e) => report.errors.push(tag + ' pageerror ' + e.message));
    page.on('response', (r) => { if (r.status() >= 400) report.errors.push(tag + ' http ' + r.status() + ' ' + r.url().replace(base, '/')); });
    page.on('console', (m) => { if (m.type() === 'error') report.errors.push(tag + ' console ' + m.text().slice(0, 200)); });
    // 실제 터치: 요소 가운데를 터치스크린으로 누른다(렌더 루프가 무거운 세로 화면에서 안정 대기 없이).
    const touch = async (loc) => { const ignore = page.locator('#btn-ignore-rotate'); if (await ignore.isVisible().catch(() => false)) { await ignore.click(); await page.waitForTimeout(200); } await loc.waitFor({ state: 'visible' }); await loc.scrollIntoViewIfNeeded(); await page.waitForTimeout(400); const b = await loc.boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(150); };
    const shot = async (name) => { const p = `${out}/${tag}-${name}.png`; await page.waitForTimeout(250); await page.screenshot({ path: p, timeout: 120000 }); rec.shots.push(p); rec.checks[name + ':clip'] = await page.evaluate(clipCheck); };
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 120000 });
    await page.locator('#boot-start').click();
    await page.waitForFunction(() => window.app?.mode === 'lobby', null, { timeout: 120000 });
    // 테스트 세이브 주입: 레전드리 갑옷 +12(소켓 2 + 잠긴 3번째), 유니크 무기 +15, 스페셜 반지, 룬 가방.
    await page.evaluate(() => {
      const app = window.app, eco = app.eco, s = eco.s;
      app.ui.closeModal(); app.testPause = true;
      s.gold = 184000;
      const add = (id, enh) => { const inst = { uid: s.invSeq++, id, enh }; s.inventory.push(inst); return inst.uid; };
      const knight = s.heroes.knight || Object.values(s.heroes)[0];
      const heroId = s.heroes.knight ? 'knight' : Object.keys(s.heroes)[0];
      s.selected = heroId;
      const weapon = add('w_storm', 15), ring = add('r_storm', 7), armor = add('a_titan', 12);
      add('b_sky', 7);
      knight.equip = { ...knight.equip, weapon, ring, armor: null };
      eco.runeState().bag = { ember_edge: [5, 1, 0], ember_hunt: [3, 0, 0], ember_feast: [1, 0, 0], tide_guard: [2, 1, 0], tide_breath: [3, 0, 0], tide_return: [1, 0, 0], storm_step: [2, 0, 0], storm_eye: [1, 0, 0], storm_edge: [1, 3, 0], stone_root: [1, 1, 0], stone_plate: [0, 0, 1], stone_reserve: [2, 0, 0] };
      eco.runeState().dust = 126;
      // 무기에 잿불 3·물결 2 → 온천 맥동(잿불·물결 각 2) 발동 상태로 시작
      eco.runeInsert(weapon, 0, { id: 'ember_edge', grade: 2 });
      eco.runeInsert(weapon, 1, { id: 'ember_hunt', grade: 1 });
      eco.runeInsert(weapon, 2, { id: 'tide_guard', grade: 2 });
      eco.runeInsert(ring, 0, { id: 'tide_breath', grade: 1 });
      eco.save(); eco.emit?.();
      window.__qa = { heroId, armor, weapon, ring };
      app.meta.openTab('heroes');
    });
    const ids = await page.evaluate(() => window.__qa);
    await page.waitForTimeout(400);
    // 장비 상세 → 룬 소켓 탭(빈 2칸 + 잠긴 3번째)
    await page.evaluate(({ armor, heroId }) => window.app.meta.showItem(armor, heroId), ids);
    await touch(page.locator('[data-side-tab="rune"]'));
    await page.locator('.rs-pane').waitFor();
    rec.checks.powerBefore = await page.locator('.is-power b').textContent();
    rec.checks.sockets = await page.$$eval('.rs-pane .rs-socket', (els) => els.map((e) => e.dataset.state + ':' + e.querySelector('small').textContent));
    await shot('1-socket-tab');
    // 룬 장착 → 룬 고르기(폭풍 필터 → 바람 칼끝 II)
    await touch(page.locator('#rs-insert'));
    try { await page.locator('.rune-picker').waitFor({ timeout: 8000 }); }
    catch (e) { await page.screenshot({ path: `${out}/${tag}-debug.png` }); const b = await page.locator('#rs-insert').boundingBox(); console.log('debug', JSON.stringify(b), await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.outerHTML.slice(0, 160), [b.x + b.width / 2, b.y + b.height / 2])); throw e; }
    await touch(page.locator('.rp-cell[data-key="storm_edge:2"]'));
    rec.checks.preview = await page.$$eval('.rp-preview > span', (els) => els.map((e) => e.textContent));
    await shot('2-picker');
    await touch(page.locator('#rp-go'));
    await page.locator('.rs-pane').waitFor();
    rec.checks.powerAfterInsert = await page.locator('.is-power b').textContent();
    rec.checks.socketsAfter = await page.$$eval('.rs-pane .rs-socket', (els) => els.map((e) => e.dataset.state + ':' + e.querySelector('small').textContent));
    rec.checks.synergyAfter = await page.$$eval('.rs-syns .rs-syn', (els) => els.map((e) => e.textContent));
    rec.checks.realCounts = await page.evaluate(({ armor, heroId }) => { const eco = window.app.eco; return { sockets: eco.s.inventory.find((x) => x.uid === armor).sockets, gold: eco.s.gold }; }, ids);
    await shot('3-after-insert');
    // 두 번째 칸도 박기(물결) 뒤 교체 확인창(앱 안)
    await touch(page.locator('.rs-socket[data-socket="0"]'));
    await touch(page.locator('#rs-swap'));
    await page.locator('.rune-picker').waitFor();
    await shot('4-picker-replace');
    await touch(page.locator('#rp-cancel'));
    await page.locator('.rs-pane').waitFor();
    // 각인판
    await touch(page.locator('#rs-overview'));
    await page.locator('.rune-overview').waitFor();
    await page.waitForTimeout(1200);
    await shot('5-overview');
    rec.checks.overviewAutoPlan = await page.locator('#ro-auto').textContent();
    await touch(page.locator('#ro-auto'));
    await page.waitForTimeout(300);
    rec.checks.afterAuto = await page.evaluate(({ weapon, ring, armor }) => { const inv = window.app.eco.s.inventory; return [weapon, ring, armor].map((u) => inv.find((x) => x.uid === u)?.sockets || null); }, ids);
    await shot('6-overview-auto');
    // 제작 공방 → 룬 가방 · 합성
    await page.evaluate(() => { window.app.ui.closeModal(); window.app.expeditionUI.open('forge'); });
    await touch(page.locator('.exp-forge-panes button', { hasText: '룬 가방' }));
    await page.locator('.rune-bag').waitFor();
    await touch(page.locator('.rb-cell[data-rune="ember_edge"]'));
    rec.checks.bagBefore = await page.evaluate(() => window.app.eco.runeState().bag.ember_edge);
    await shot('7-bag-merge');
    await touch(page.locator('#rb-go'));
    await page.waitForTimeout(300);
    rec.checks.bagAfter = await page.evaluate(() => ({ bag: window.app.eco.runeState().bag.ember_edge, gold: window.app.eco.s.gold }));
    await shot('8-bag-merged');
    await page.close();
  }
} finally {
  await browser.close();
  await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
