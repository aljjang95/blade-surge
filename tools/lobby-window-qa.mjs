// 로비 메이플식 창(인벤토리 · 장비 · 메뉴) 실제 입력 검증.
// 2026-10-15 던전 우선 로비: 빠른 메뉴 바를 제거했다. 창은 데스크톱 보조 진입(E / I / Q)으로만 열고, 메뉴는 하단 독의 '메뉴'로 연다.
// 터치 프로필의 장비 · 가방 동선은 '영웅·장비' 탭이며 tools/lobby-dungeon-first-qa.mjs 가 검사한다.
// 사용법: node tools/lobby-window-qa.mjs [origin=http://127.0.0.1:5310/] [out=work/lobby-window-qa]
// 주입 fixture: 빈 가방에서는 칸 클릭을 검증할 수 없어 eco.addRewards(조각 · 강화석 · 소환권)와
// 게임의 실제 제작 함수 eco.craftSetItem / eco.equip 으로 장비를 만들고 장착한다. 저장 스키마에는 새 필드가 없다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';
// 빌드본에는 /src 경로가 없으므로 세트·부위 목록은 Node 쪽에서 읽어 페이지에 넘긴다.
import { SETS, SLOTS } from '../src/data/items.js';
import { installAutoStarter } from './qa-starter.mjs';
const origin = process.argv[2] || 'http://127.0.0.1:5310/', out = path.resolve(process.argv[3] || 'work/lobby-window-qa');
await fs.mkdir(out, { recursive: true });
const PROFILES = [
  { id: 'desktop', viewport: { width: 1280, height: 720 } },
];
const report = { started: new Date().toISOString(), fixture: 'Injected fixture: eco.addRewards({fragments,stones,tickets,gold}) then real eco.craftSetItem / eco.equip. Native click/tap/keyboard input; no DOM shortcuts.', profiles: [] };
const failures = [];
const browser = await chromium.launch(launchOpts());
for (const spec of PROFILES) {
  const { id, ...options } = spec, touch = !!options.hasTouch;
  const context = await browser.newContext(options), page = await context.newPage();
  const row = { id, viewport: options.viewport, checks: [], errors: [] }; report.profiles.push(row);
  page.on('pageerror', (e) => row.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') row.errors.push(m.text()); });
  const check = (name, ok, detail) => { row.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); if (!ok) failures.push(id + ': ' + name + (detail === undefined ? '' : ' ' + JSON.stringify(detail))); };
  const act = (selector) => touch ? page.locator(selector).first().tap() : page.locator(selector).first().click();
  const shot = (name) => page.screenshot({ path: path.join(out, id + '-' + name + '.png') });
  const rect = (selector) => page.evaluate((s) => { const n = document.querySelector(s); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; }, selector);
  const inside = (r) => r && r.x >= -0.5 && r.y >= -0.5 && r.r <= options.viewport.width + 0.5 && r.b <= options.viewport.height + 0.5;
  const visible = (selector) => page.evaluate((s) => { const n = document.querySelector(s); return !!n && !n.hidden && getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().width > 0; }, selector);
  const settle = (ms = 250) => page.waitForTimeout(ms);
  // 좁은 화면은 창이 빠른 메뉴 바를 가리므로 X 로 먼저 닫는다(실제 사용자 경로와 같다).
  const closeVisibleWindows = async () => { for (const win of ['inventory', 'equipment']) if (await visible('.mpl-win[data-win="' + win + '"]')) { await act('.mpl-win[data-win="' + win + '"] .mpl-close'); await settle(120); } };
  const smallTargets = (scope) => page.evaluate((s) => [...document.querySelectorAll(s + ' button')].filter((b) => b.offsetParent !== null).map((b) => { const r = b.getBoundingClientRect(); return { t: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 14), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((b) => b.w > 0 && (b.w < 44 || b.h < 44)), scope);
  try {
    await installAutoStarter(page); // 빈 저장 부팅 시 시작 영웅 선택 화면 자동 통과
    await page.goto(origin);
    if (await page.locator('#btn-ignore-rotate').isVisible()) await act('#btn-ignore-rotate');
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 }); await act('#boot-start');
    await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show') && window.app.mapleUI, undefined, { timeout: 120000 });
    await settle(1200);
    for (let n = 0; n < 4; n++) { const c = page.locator('#modal.show #m-cancel'); if (!await c.isVisible()) break; await act('#modal.show #m-cancel'); await settle(200); }
    // ---- 주입 fixture ----
    const fixture = await page.evaluate(async ({ ids, SLOTS }) => {
      const eco = window.app.eco;
      eco.addRewards({ fragments: 400, stones: 30, tickets: 4, gold: 50000 }, { silent: true });
      const made = [];
      for (const [i, slot] of SLOTS.entries()) { const r = eco.craftSetItem(ids[i % ids.length], slot); if (r.ok) made.push(r.inst.uid); }
      for (const [i, slot] of ['weapon', 'armor'].entries()) { const r = eco.craftSetItem(ids[(i + 1) % ids.length], slot); if (r.ok) made.push(r.inst.uid); }
      const sel = eco.s.selected; if (made[0] !== undefined) eco.equip(sel, made[0]);
      eco.emit();
      return { made, equipped: made[0], hero: sel, bag: eco.s.inventory.length };
    }, { ids: Object.keys(SETS), SLOTS });
    row.fixture = fixture; check('fixture items crafted', fixture.made.length >= 4, fixture);
    await settle(300); await shot('00-lobby');

    // ---- 빠른 메뉴 바는 없다 ----
    check('no quick bar on the lobby', !await page.evaluate(() => !!document.querySelector('.mpl-quickbar')));

    // ---- 인벤토리 ----
    await page.keyboard.press('KeyI'); await settle();
    const inv = await rect('.mpl-win[data-win="inventory"]');
    check('inventory window opens inside viewport', await visible('.mpl-win[data-win="inventory"]') && inside(inv), inv);
    await shot('01-inventory');
    const gridInfo = await page.evaluate(() => ({ cells: document.querySelectorAll('[data-win="inventory"] .mpl-cell').length, empty: document.querySelectorAll('[data-win="inventory"] .mpl-cell.is-empty').length, gear: document.querySelectorAll('[data-win="inventory"] .mpl-cell.has-gear').length, money: document.querySelector('[data-win="inventory"] .mpl-money')?.textContent.trim() }));
    check('inventory shows fixed 24+ slots with empty cells', gridInfo.cells >= 24 && gridInfo.empty > 0 && gridInfo.gear >= 4, gridInfo);
    check('inventory footer shows gold/gems', /\d/.test(gridInfo.money || ''), gridInfo.money);
    if (touch) { const small = await smallTargets('[data-win="inventory"]'); check('inventory touch targets >=44px', small.length === 0, small); }
    // 탭 전환
    const tabResult = {};
    for (const tab of ['use', 'etc', 'cash', 'gear']) {
      await act('[data-win="inventory"] [data-tab="' + tab + '"]'); await settle(120);
      tabResult[tab] = await page.evaluate(() => ({ cells: document.querySelectorAll('[data-win="inventory"] .mpl-cell').length, filled: document.querySelectorAll('[data-win="inventory"] .mpl-cell:not(.is-empty)').length }));
      if (tab === 'use') await shot('02-inventory-use');
    }
    check('consumable tab lists saved stacks (stones/tickets)', tabResult.use.filled >= 2, tabResult);
    check('cash tab shows empty slots', tabResult.cash.cells >= 24, tabResult);
    // 칸 클릭 → 기존 아이템 시트
    await act('[data-win="inventory"] .mpl-cell.has-gear'); await settle(300);
    const sheet = await page.evaluate(() => !!document.querySelector('#modal.show .item-sheet'));
    check('inventory gear cell opens existing item sheet', sheet);
    await shot('03-item-sheet');
    if (sheet) { await act('#modal.show #i-close'); await settle(300); }
    check('inventory stays open after sheet closes', await visible('.mpl-win[data-win="inventory"]'));
    const focusBack = await page.evaluate(() => document.activeElement?.closest?.('[data-win="inventory"]') !== null);
    check('focus returns into inventory window after sheet', focusBack);

    // ---- 장비 창 ----
    if (touch) await closeVisibleWindows();
    await page.keyboard.press('KeyE'); await settle();
    const eq = await rect('.mpl-win[data-win="equipment"]');
    check('equipment window opens inside viewport', await visible('.mpl-win[data-win="equipment"]') && inside(eq), eq);
    await shot('04-equipment');
    const slots = await page.$$eval('[data-win="equipment"] .mpl-slot', (bs) => bs.map((b) => ({ slot: b.dataset.slot, empty: b.classList.contains('is-empty') })));
    check('equipment shows 4 slots', slots.length === 4, slots);
    if (touch) { const small = await smallTargets('[data-win="equipment"]'); check('equipment touch targets >=44px', small.length === 0, small); }
    const filled = slots.find((s) => !s.empty), empty = slots.find((s) => s.empty);
    if (filled) {
      await act('[data-win="equipment"] .mpl-slot[data-slot="' + filled.slot + '"]'); await settle(300);
      check('equipment filled slot opens item sheet', await page.evaluate(() => !!document.querySelector('#modal.show .item-sheet')));
      await act('#modal.show #i-close'); await settle(250);
    } else check('fixture equipped one slot', false, slots);
    if (empty) {
      await page.evaluate(() => window.app.mapleUI.manager.close('inventory')); await settle(100);
      await act('[data-win="equipment"] .mpl-slot[data-slot="' + empty.slot + '"]'); await settle(300);
      const pressed = await page.evaluate(() => [...document.querySelectorAll('[data-win="inventory"] .mpl-chip[aria-pressed="true"]')].map((b) => b.textContent.trim()));
      check('empty slot opens inventory filtered to that slot', await visible('.mpl-win[data-win="inventory"]') && pressed.length === 1 && pressed[0] !== '전체', pressed);
      await shot('05-equipment-and-inventory');
    } else check('has empty slot to test', false, slots);
    // 창을 닫는다(X)
    for (const win of ['inventory', 'equipment']) {
      if (await visible('.mpl-win[data-win="' + win + '"]')) { await act('.mpl-win[data-win="' + win + '"] .mpl-close'); await settle(120); }
      check(win + ' closes with X', !await visible('.mpl-win[data-win="' + win + '"]'));
    }

    // ---- 메뉴 ----
    await act('.oath-nav-menu'); await settle(400);
    const menu = await rect('#oath-menu');
    check('menu opens inside viewport', await page.evaluate(() => document.querySelector('#oath-menu').open) && inside(menu), menu);
    await shot('06-menu');
    const groups = await page.$$eval('#oath-menu .oath-menu-group', (gs) => gs.filter((g) => !g.hidden).map((g) => ({ title: g.querySelector('h3').textContent, items: [...g.querySelectorAll('.oath-menu-list > button')].map((b) => b.textContent.trim().replace(/\s+/g, ' ')) })));
    check('menu has 5 groups with short icon lists', groups.length === 5 && groups.every((g) => g.items.length >= 2), groups);
    row.menuGroups = groups;
    const ids = await page.$$eval('#oath-menu .oath-menu-list > button', (bs) => bs.map((b) => b.id || b.dataset.tab || b.className.split(' ').find((c) => /open|lobby/.test(c))));
    check('menu keeps existing button ids', ['btn-daily', 'btn-mail', 'btn-quest', 'btn-guide', 'btn-settings'].every((x) => ids.includes(x)), ids);
    if (touch) { const small = await smallTargets('#oath-menu'); check('menu touch targets >=44px', small.length === 0, small); }
    await act('#oath-menu #btn-settings'); await settle(350);
    check('menu item still opens its popup (settings)', await page.evaluate(() => !!document.querySelector('#modal.show')));
    await shot('07-settings-popup');
    await act('#modal.show #m-cancel'); await settle(250);
    await act('.oath-nav-menu'); await settle(300);
    await act('#oath-menu .oath-menu-close'); await settle(250);
    check('menu closes with X', !await page.evaluate(() => document.querySelector('#oath-menu').open));

    // 기존 QA(garden-ui-qa)가 쓰는 하단 독의 메뉴 버튼과 네이티브 Esc 경로도 그대로 동작해야 한다.
    await act('.oath-nav-menu'); await page.locator('#oath-menu[open]').waitFor({ timeout: 4000 }); await settle(200);
    await page.keyboard.press('Escape'); await settle(300);
    check('dock menu button opens #oath-menu and native Esc closes it', !await page.evaluate(() => document.querySelector('#oath-menu').open));
    // ---- 데스크톱 전용: 단축키 · 드래그 · Esc ----
    // 기존 QA(garden-ui-qa)가 쓰는 하단 독의 메뉴 버튼과 네이티브 Esc 경로도 그대로 동작해야 한다.
    await act('.oath-nav-menu'); await page.locator('#oath-menu[open]').waitFor({ timeout: 4000 }); await settle(200);
    await page.keyboard.press('Escape'); await settle(300);
    check('dock menu button opens #oath-menu and native Esc closes it', !await page.evaluate(() => document.querySelector('#oath-menu').open));
    if (!touch) {
      await page.locator('body').click({ position: { x: 640, y: 30 } }).catch(() => {});
      await page.keyboard.press('KeyI'); await settle(200);
      check('I opens inventory', await visible('.mpl-win[data-win="inventory"]'));
      await page.keyboard.press('KeyE'); await settle(200);
      check('E opens equipment', await visible('.mpl-win[data-win="equipment"]'));
      await shot('08-both-windows');
      // 드래그
      const before = await rect('.mpl-win[data-win="inventory"]'), head = await rect('.mpl-win[data-win="inventory"] .mpl-title-text');
      await page.mouse.move(head.x + 10, head.y + head.h / 2); await page.mouse.down(); await page.mouse.move(head.x - 150, head.y + head.h / 2 + 80, { steps: 8 }); await page.mouse.up(); await settle(150);
      const after = await rect('.mpl-win[data-win="inventory"]');
      check('title bar drag moves the window inside viewport', Math.abs(after.x - before.x) > 80 && inside(after), { before, after });
      const stored = await page.evaluate(() => localStorage.getItem('bladesurge.ui.windows.v1'));
      check('window position saved under UI-only key', !!stored && /inventory/.test(stored), stored);
      const saveKeys = await page.evaluate(() => Object.keys(localStorage).filter((k) => !/windows/.test(k)));
      row.otherStorageKeys = saveKeys;
      await page.mouse.move(head.x - 150, head.y + 80); await page.mouse.move(2000, 2000).catch(() => {});
      // 드래그를 화면 밖으로: 클램프
      const head2 = await rect('.mpl-win[data-win="inventory"] .mpl-title-text');
      await page.mouse.move(head2.x + 10, head2.y + head2.h / 2); await page.mouse.down(); await page.mouse.move(5000, 5000, { steps: 4 }); await page.mouse.up(); await settle(120);
      check('dragging off-screen is clamped inside viewport', inside(await rect('.mpl-win[data-win="inventory"]')), await rect('.mpl-win[data-win="inventory"]'));
      // 클릭하면 앞으로
      await page.locator('.mpl-win[data-win="equipment"] .mpl-title').click({ position: { x: 40, y: 12 } }); await settle(80);
      const topId = await page.evaluate(() => window.app.mapleUI.manager.topmost()?.id);
      check('clicking a window brings it to front', topId === 'equipment', topId);
      // Esc 는 가장 위 창만
      await page.keyboard.press('Escape'); await settle(120);
      const afterEsc = await page.evaluate(() => ({ eq: window.app.mapleUI.manager.isOpen('equipment'), inv: window.app.mapleUI.manager.isOpen('inventory') }));
      check('Esc closes only the top window', !afterEsc.eq && afterEsc.inv, afterEsc);
      await page.keyboard.press('Escape'); await settle(120);
      check('second Esc closes the remaining window', !await page.evaluate(() => window.app.mapleUI.manager.isOpen('inventory')));
      // 위치 복원
      await page.keyboard.press('KeyI'); await settle(200);
      check('reopened window is still inside viewport', inside(await rect('.mpl-win[data-win="inventory"]')));
      await page.keyboard.press('KeyI'); await settle(120);
      check('I toggles inventory closed', !await visible('.mpl-win[data-win="inventory"]'));
      // 다른 모달 중에는 무시
      await page.keyboard.press('KeyQ'); await settle(300);
      check('Q opens quests popup', await page.evaluate(() => !!document.querySelector('#modal.show')));
      await shot('09-quests-popup');
      await page.keyboard.press('KeyI'); await settle(150);
      check('hotkey ignored while a modal is open', !await visible('.mpl-win[data-win="inventory"]'));
      await act('#modal.show #m-cancel'); await settle(250);
      await act('.oath-nav-menu'); await settle(300);
      await page.keyboard.press('KeyE'); await settle(150);
      check('hotkey ignored while menu dialog is open', !await visible('.mpl-win[data-win="equipment"]'));
      await page.keyboard.press('Escape'); await settle(250);
      check('Esc closes menu dialog', !await page.evaluate(() => document.querySelector('#oath-menu').open));
      // 입력창 포커스 중에는 무시
      await page.evaluate(() => { const i = document.createElement('input'); i.id = 'qa-input'; i.style.cssText = 'position:fixed;left:5px;top:5px;z-index:99'; document.body.append(i); i.focus(); });
      await page.keyboard.press('KeyI'); await settle(120);
      check('hotkey ignored while typing in an input', !await visible('.mpl-win[data-win="inventory"]'));
      await page.evaluate(() => document.getElementById('qa-input')?.remove());
    }
    // ---- 거점 걷기 모드: 착지 패널의 '마을 둘러보기'로 들어가고 '출격 메뉴로'로 돌아온다 ----
    await act('#citadel-explore'); await settle(1200);
    const hubOn = await page.evaluate(() => window.app.hubWalkMode);
    check('hub walk mode entered (explore link)', hubOn);
    if (hubOn) {
      await shot('10-hub-walk');
      await act('#citadel-command-return'); await settle(400);
      check('return button restores dungeon landing', await page.evaluate(() => !window.app.hubWalkMode && !document.querySelector('#citadel-command').hidden));
    }
  } catch (error) { check('profile completed without exception', false, String(error?.stack || error).slice(0, 600)); await shot('zz-failure').catch(() => {}); }
  check('console errors = 0', row.errors.length === 0, row.errors.slice(0, 5));
  await context.close();
}
await browser.close();
report.failures = failures; report.finished = new Date().toISOString();
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
for (const p of report.profiles) console.log(p.id + ': ' + p.checks.filter((c) => c.ok).length + '/' + p.checks.length + ' ok');
if (failures.length) { console.error('FAILURES:\n' + failures.join('\n')); process.exit(1); }
console.log('lobby-window-qa passed');
