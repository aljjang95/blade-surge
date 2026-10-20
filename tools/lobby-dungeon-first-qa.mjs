// 던전 우선 로비 실제 입력 검증: 착지 화면 → 준비 열기/취소 → 실제 출격 1회 차감 → 포기 → 결과 → 영웅·장비 → 출격 준비 재진입.
// 사용법: node tools/lobby-dungeon-first-qa.mjs [origin=http://127.0.0.1:5391/] [out=work/lobby-dungeon-first-qa] [--profiles=desktop-1440,land-844x390,port-390x844] [--flow]
// 새 브라우저 프로필(새 저장)에서 시작한다. --flow 를 주면 첫 프로필에서 출격·포기·재진입까지 실제 클릭/탭으로 진행한다.
// 이 결과는 viewport/터치 에뮬과 소프트웨어 렌더 관측이며 물리 기기·GPU 프레임 검증이 아니다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const origin = positional[0] || 'http://127.0.0.1:5391/', out = path.resolve(positional[1] || 'work/lobby-dungeon-first-qa');
const flag = (name) => args.find((a) => a.startsWith('--' + name + '='))?.split('=')[1];
const ALL = [
  { id: 'desktop-1440', viewport: { width: 1440, height: 900 } },
  { id: 'desktop-1280', viewport: { width: 1280, height: 720 } },
  { id: 'land-844x390', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true },
  { id: 'land-640x360', viewport: { width: 640, height: 360 }, hasTouch: true, isMobile: true },
  { id: 'port-390x844', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];
const wanted = (flag('profiles') || 'desktop-1440,land-844x390,port-390x844').split(',');
const PROFILES = ALL.filter((p) => wanted.includes(p.id));
const runFlow = args.includes('--flow');
const runItems = args.includes('--items');
await fs.mkdir(out, { recursive: true });
const report = { started: new Date().toISOString(), origin, note: 'Fresh browser profile/save. Native click/tap/keyboard input. Viewport emulation + SwiftShader; not physical-device evidence.', profiles: [] };
const failures = [];
const browser = await chromium.launch(launchOpts());
try {
  for (const [index, spec] of PROFILES.entries()) {
    const { id, ...options } = spec, touch = !!options.hasTouch;
    const context = await browser.newContext(options), page = await context.newPage();
    const row = { id, viewport: options.viewport, checks: [], errors: [], shots: [] }; report.profiles.push(row);
    page.on('pageerror', (e) => row.errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') row.errors.push(m.text()); });
    const check = (name, ok, detail) => { row.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); if (!ok) failures.push(id + ': ' + name + (detail === undefined ? '' : ' ' + JSON.stringify(detail))); };
    // 기본은 Playwright 의 tap/click. SwiftShader 세로 화면에서 '안정' 대기가 끝나지 않으면 같은 요소 중심에 실제 터치/마우스 입력을 보낸다.
    const act = async (selector) => {
      const target = page.locator(selector).first();
      try { await (touch ? target.tap({ timeout: 15000 }) : target.click({ timeout: 15000 })); }
      catch (error) {
        const box = await target.boundingBox(); if (!box) throw error;
        row.inputFallbacks = (row.inputFallbacks || 0) + 1;
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
      }
    };
    // 소프트웨어 렌더(SwiftShader)는 큰 화면 한 프레임이 오래 걸린다. 캡처 대기를 넉넉히 둔다.
    const shot = async (name) => { const file = path.join(out, id + '-' + name + '.png'); await page.screenshot({ path: file, timeout: 120000 }); row.shots.push(path.basename(file)); };
    const settle = (ms = 300) => page.waitForTimeout(ms);
    const state = () => page.evaluate(() => ({ mode: window.app.mode, tab: window.app.meta.tab, energy: window.app.eco.s.energy, prep: !!window.app.hubUI.opened, prepTitle: document.querySelector('#citadel-destination-title')?.textContent || null, focus: document.activeElement?.id || document.activeElement?.className || null }));
    const dismissRotate = async () => { const b = page.locator('#rotate-hint #btn-ignore-rotate'); if (await b.isVisible().catch(() => false)) { await act('#rotate-hint #btn-ignore-rotate'); await settle(200); } };
    try {
      await page.goto(origin);
      await settle(400); await dismissRotate();
      await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 240000 });
      await dismissRotate(); await act('#boot-start');
      await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show') && window.app.oathShell, undefined, { timeout: 180000 });
      await settle(1500); await dismissRotate();
      for (let n = 0; n < 5; n++) { const c = page.locator('#modal.show #m-cancel'); if (!await c.isVisible().catch(() => false)) break; await dismissRotate(); await act('#modal.show #m-cancel'); await settle(250); }
      await settle(600);
      await shot('00-landing');
      // ---- 정보 구조 ----
      const ia = await page.evaluate(() => {
        const visible = (n) => { if (!n) return false; const r = n.getBoundingClientRect(), s = getComputedStyle(n); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !n.closest('[hidden]') && !n.closest('dialog:not([open])'); };
        const nav = [...document.querySelectorAll('#meta .bottomnav button')].filter(visible).map((b) => b.textContent.trim().replace(/\s+/g, ' '));
        const ctas = [...document.querySelectorAll('#tab-home .dl-cta, #tab-home .btn-gold, #tab-home .mpl-cmd-go')].filter(visible).length;
        const homeButtons = [...document.querySelectorAll('#tab-home button, #tab-home summary')].filter(visible).map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40));
        const quickbar = [...document.querySelectorAll('.mpl-quickbar')].filter(visible).length;
        const arena = [...document.querySelectorAll('button')].filter((b) => visible(b) && /결투장/.test(b.textContent)).length;
        const doc = document.documentElement; const overflowX = Math.max(doc.scrollWidth, document.body.scrollWidth) - innerWidth;
        const panel = document.querySelector('#citadel-command'), cta = document.querySelector('#citadel-dungeon-prepare');
        const pr = panel?.getBoundingClientRect(), cr = cta?.getBoundingClientRect();
        const hit = cr ? document.elementFromPoint(cr.x + cr.width / 2, cr.y + cr.height / 2) : null;
        const small = [...document.querySelectorAll('#tab-home button, #meta .bottomnav button')].filter(visible).map((b) => { const r = b.getBoundingClientRect(); return { t: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 16), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((b) => b.w < 44 || b.h < 44);
        const fontSizes = [...document.querySelectorAll('#citadel-command *')].filter((n) => visible(n) && n.childNodes.length && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())).map((n) => ({ t: n.textContent.trim().slice(0, 18), px: parseFloat(getComputedStyle(n).fontSize), family: getComputedStyle(n).fontFamily.split(',')[0] }));
        return { nav, ctas, homeButtons, quickbar, arena, overflowX, panel: pr && { x: pr.x, y: pr.y, r: pr.right, b: pr.bottom }, cta: cr && { x: cr.x, y: cr.y, r: cr.right, b: cr.bottom }, ctaHit: !!hit && (hit === cta || cta.contains(hit)), small, fontSizes, title: document.querySelector('#citadel-command-title')?.textContent, reason: document.querySelector('#citadel-command .dl-reason')?.textContent };
      });
      row.ia = ia;
      const vw = options.viewport.width, vh = options.viewport.height;
      check('top-level destinations <= 3', ia.nav.length <= 3, ia.nav);
      check('exactly one emphasized home CTA', ia.ctas === 1, ia.ctas);
      check('no quick bar', ia.quickbar === 0);
      check('arena not exposed on landing', ia.arena === 0);
      check('no horizontal overflow', ia.overflowX <= 1, ia.overflowX);
      check('landing panel inside viewport', ia.panel && ia.panel.x >= -0.5 && ia.panel.y >= -0.5 && ia.panel.r <= vw + 0.5 && ia.panel.b <= vh + 0.5, ia.panel);
      check('CTA visible and hit-testable', ia.cta && ia.cta.b <= vh + 0.5 && ia.ctaHit, ia.cta);
      if (touch) check('touch targets >= 44px', ia.small.length === 0, ia.small);
      check('landing text >= 12px', ia.fontSizes.every((f) => f.px >= 12), ia.fontSizes.filter((f) => f.px < 12));
      // ---- 준비 열기 → 취소: 비용 0, 초점 복귀 ----
      const before = await state();
      await act('#citadel-dungeon-prepare'); await settle(700);
      const opened = await state();
      check('CTA opens preparation for the recommended dungeon', opened.prep && opened.prepTitle === ia.title, { opened, title: ia.title });
      await shot('01-preparation');
      await act('#citadel-hub-dialog .citadel-hub-cancel, dialog[open] .citadel-hub-cancel'); await settle(500);
      const cancelled = await state();
      check('cancel spends no energy', cancelled.energy === before.energy, { before: before.energy, after: cancelled.energy });
      check('cancel restores focus to CTA', cancelled.focus === 'citadel-dungeon-prepare', cancelled.focus);
      // ESC 로 닫기
      await act('#citadel-dungeon-prepare'); await settle(600);
      await page.keyboard.press('Escape'); await settle(500);
      const escaped = await state();
      check('Escape closes preparation without cost', !escaped.prep && escaped.energy === before.energy, escaped);
      // ---- 메뉴: 보조 입구 ----
      await act('#meta .oath-nav-menu'); await settle(500);
      const menu = await page.evaluate(() => [...document.querySelectorAll('#oath-menu .oath-menu-group:not([hidden])')].map((g) => ({ title: g.querySelector('h3')?.textContent, items: [...g.querySelectorAll('button')].filter((b) => !b.hidden).map((b) => b.textContent.trim().replace(/\s+/g, ' ')) })));
      row.menu = menu;
      check('menu holds campaign/fields/supply entries', JSON.stringify(menu).includes('캠페인') && JSON.stringify(menu).includes('야외 필드') && JSON.stringify(menu).includes('보급 상점'), menu);
      check('menu hides party/arena', !/파티|결투장/.test(JSON.stringify(menu)), menu);
      await shot('02-menu');
      await page.keyboard.press('Escape'); await settle(400);
      // ---- 영웅·장비 ----
      await act('#meta .bottomnav [data-tab="heroes"]'); await settle(1500);
      await shot('03-heroes');
      const heroCta = await page.evaluate(() => { const b = document.querySelector('#h-next'); return b ? b.textContent.trim().replace(/\s+/g, ' ') : null; });
      check('hero screen offers dungeon preparation', !!heroCta && heroCta.startsWith('출격 준비'), heroCta);
      if (heroCta) {
        await act('#h-next'); await settle(900);
        const back = await state();
        check('hero sortie returns to landing with same preparation', back.tab === 'home' && back.prep && back.prepTitle === ia.title, back);
        await shot('04-hero-to-preparation');
        await page.keyboard.press('Escape'); await settle(400);
      }
      if (runItems && index === 0) {
        // ---- 아이템 표현: 같은 itemId 는 모든 표면에서 같은 3D 렌더 그림 ----
        // 주입 fixture: 실제 경제 함수 eco.addRewards / eco.craftSetItem / eco.equip 만 쓴다. 저장 스키마 변경 없음.
        const fixture = await page.evaluate(() => {
          const eco = window.app.eco;
          eco.addRewards({ fragments: 400, stones: 30, gold: 50000 }, { silent: true });
          const made = [];
          for (const [set, slot] of [['storm', 'weapon'], ['arm_aegis', 'armor'], ['blood', 'ring'], ['tether', 'boots'], ['phoenix', 'armor']]) { const r = eco.craftSetItem(set, slot); if (r.ok) made.push({ uid: r.inst.uid, id: r.inst.id }); }
          for (const m of made.slice(0, 4)) eco.equip(eco.s.selected, m.uid);
          eco.emit();
          return { made, hero: eco.s.selected };
        });
        row.itemFixture = fixture;
        check('item fixture crafted with real economy', fixture.made.length >= 4, fixture);
        await act('#meta .bottomnav [data-tab="heroes"]'); await settle(1500);
        // 소프트웨어 렌더에서는 착용 모습(R3F)과 장비 그림이 늦게 준비된다. 캡처 전에 실제 준비를 기다리고 결과를 기록한다.
        const wardrobe = await page.waitForFunction(() => {
          const canvas = document.querySelector('#hero-wardrobe canvas'), r = canvas?.getBoundingClientRect();
          const imgs = [...document.querySelectorAll('#tab-heroes img')].filter(img => img.getBoundingClientRect().width > 0);
          return window.app.wardrobe?.instance && r && r.width > 100 && r.height > 100 && imgs.every(img => img.complete && img.naturalWidth > 0)
            ? { canvas: [Math.round(r.width), Math.round(r.height)], images: imgs.length } : null;
        }, null, { timeout: 90000 }).then(h => h.jsonValue()).catch(() => null);
        row.wardrobeReady = wardrobe;
        check('equipped hero 3D preview and item images ready before capture', !!wardrobe, wardrobe);
        await settle(600);
        await shot('10-heroes-equipped');
        const surfaces = await page.evaluate((made) => made.map(({ uid, id }) => {
          const slot = document.querySelector('.hs-slot[data-uid="' + uid + '"] img');
          const bag = document.querySelector('#hero-bag [data-inv="' + uid + '"] img, #hero-bag [data-uid="' + uid + '"] img');
          return { id, slot: slot?.getAttribute('src') || null, slotVisual: slot?.dataset.itemVisual || null, bag: bag?.getAttribute('src') || null,
            slotForm: slot?.dataset.itemForm || null, slotHero: slot?.dataset.itemHero || null, bagForm: bag?.dataset.itemForm || null, bagHero: bag?.dataset.itemHero || null };
        }), fixture.made);
        row.itemSurfaces = surfaces;
        check('equipped slot uses 3D-rendered thumbnail', surfaces.slice(0, 4).every((s) => s.slot && s.slotVisual !== 'slot-silhouette' && /\/img\/(gear|item-renders)\//.test(s.slot)), surfaces);
        check('slot and bag show same image for same item', surfaces.filter((s) => s.slot && s.bag).every((s) => s.slot === s.bag), surfaces);
        // 영웅 문맥 형태: 장착 칸과 가방이 같은 영웅·같은 형태를 쓰고, 무기는 그 영웅의 형태 키를 남긴다.
        check('slot and bag carry the same hero and weapon form', surfaces.filter((s) => s.slot && s.bag).every((s) => s.slotForm === s.bagForm && s.slotHero === s.bagHero) && surfaces.some((s) => s.slotHero === fixture.hero), surfaces);
        // 장착 무기 상세 → 3D 보기
        await act('.hs-slot[data-uid="' + fixture.made[0].uid + '"]'); await settle(700);
        const sheet = await page.evaluate(() => { const img = document.querySelector('#modal.show .is-head-art img');
          return { head: img?.getAttribute('src') || null, form: img?.dataset.itemForm || null, hero: img?.dataset.itemHero || null, chip: document.querySelector('#modal.show .is-form')?.textContent || null, title: document.querySelector('#modal.show .is-head h2')?.textContent || null }; });
        check('item sheet header uses same thumbnail', sheet.head === surfaces[0].slot, { sheet, slot: surfaces[0].slot });
        check('item sheet header keeps the slot hero and form', sheet.form === surfaces[0].slotForm && sheet.hero === surfaces[0].slotHero, { sheet, slot: surfaces[0] });
        await act('#modal.show #i-3d'); await page.waitForFunction(() => !!document.querySelector('#modal.show .is-preview-canvas') || /불러오지 못/.test(document.querySelector('#modal.show .is-preview-stage')?.textContent || ''), undefined, { timeout: 60000 }).catch(() => {});
        await settle(1200);
        // 캔버스 픽셀은 drawing buffer 를 보존하지 않아 읽지 않는다. 그려진 모습은 11번 캡처를 직접 열어 확인한다.
        const preview = await page.evaluate(() => { const c = document.querySelector('#modal.show .is-preview-canvas'); return c ? { canvas: true, width: c.width, height: c.height, caption: document.querySelector('#modal.show .is-preview-caption')?.textContent } : { canvas: false, text: document.querySelector('#modal.show .is-preview-stage')?.textContent }; });
        row.itemPreview = preview;
        check('3D preview mounts a canvas from the item source', preview.canvas, preview);
        await shot('11-item-sheet-3d');
        await act('#modal.show #i-close'); await settle(500);
        const disposed = await page.evaluate(() => document.querySelectorAll('.is-preview-canvas').length);
        check('3D preview disposed on close', disposed === 0, disposed);
        if (!touch) {
          await act('#meta .bottomnav [data-tab="home"]'); await settle(800);
          await page.keyboard.press('KeyE'); await settle(700);
          await page.keyboard.press('KeyI'); await settle(700);
          await shot('12-equipment-inventory-windows');
          const win = await page.evaluate((made) => made.map(({ uid, id }) => ({ id, eq: document.querySelector('.mpl-win[data-win="equipment"] .mpl-slot img[src*="' + id + '"]')?.getAttribute('src') || null, inv: [...document.querySelectorAll('.mpl-win[data-win="inventory"] .mpl-cell img')].map((i) => i.getAttribute('src')).find((s) => s && s.includes(id)) || null })), fixture.made);
          row.windowSurfaces = win;
          check('E/I windows reuse the same thumbnails', win.slice(0, 4).every((w, i) => (!w.eq || w.eq === surfaces[i].slot) && (!w.inv || w.inv === surfaces[i].slot)) && win.some((w) => w.eq), win);
          await page.keyboard.press('Escape'); await settle(300); await page.keyboard.press('Escape'); await settle(300);
        }
      }
      if (runFlow && index === 0) {
        // ---- 실제 출격 1회 차감 → 포기 → 결과 → 영웅·장비 → 재진입 ----
        const start = await state();
        await act('#citadel-dungeon-prepare'); await settle(700);
        const cost = await page.evaluate(() => Number(document.querySelector('[data-citadel-cost]')?.textContent.replace(/\D/g, '')));
        await act('dialog[open] .citadel-hub-go');
        await page.waitForFunction(() => window.app.mode === 'battle' && window.app.battle?.active && !window.app.stageStarting, undefined, { timeout: 180000 });
        await settle(1500);
        const inBattle = await state();
        check('final sortie spends catalog energy once', start.energy - inBattle.energy === cost, { before: start.energy, after: inBattle.energy, cost });
        await shot('05-battle');
        await act('#btn-pause'); await settle(500);
        await act('#btn-giveup'); await settle(600);
        for (let n = 0; n < 3; n++) { const ok = page.locator('#modal.show #m-ok'); if (await ok.isVisible().catch(() => false)) { await act('#modal.show #m-ok'); await settle(500); } }
        await page.waitForFunction(() => !!window.app.expeditionUI?.result || window.app.mode === 'lobby', undefined, { timeout: 60000 });
        await settle(1200);
        await shot('06-result');
        const result = await page.evaluate(() => ({ result: window.app.expeditionUI?.result ? { win: window.app.expeditionUI.result.win, saveError: window.app.expeditionUI.result.saveError } : null, buttons: [...document.querySelectorAll('.exp-result-footer button')].map((b) => b.textContent.trim()) }));
        row.result = result;
        check('defeat result shown and saved', result.result && result.result.win === false && !result.result.saveError, result);
        // 결과 화면은 하단 목적지를 가린다. 실제 사용자 경로: 결과의 '로비' → 던전 착지 → 영웅·장비.
        await act('.exp-result-header .exp-close'); await settle(1200);
        const landed = await state();
        check('result lobby returns to dungeon landing', landed.mode === 'lobby' && landed.tab === 'home', landed);
        await shot('06b-landing-after-result');
        await act('#meta .bottomnav [data-tab="heroes"]'); await settle(1500);
        await shot('07-result-to-heroes');
        await act('#h-next'); await settle(900);
        const again = await state();
        const recent = await page.evaluate(() => document.querySelector('#citadel-command .dl-reason')?.textContent);
        check('re-entry opens same dungeon preparation', again.tab === 'home' && again.prep && again.prepTitle === ia.title, { again, recent });
        check('landing marks the dungeon as recent run', /최근 원정/.test(recent || ''), recent);
        await shot('08-reentry-preparation');
        await page.keyboard.press('Escape'); await settle(500);
        await shot('09-landing-after-run');
      }
    } catch (error) {
      row.errors.push('driver: ' + (error?.stack || error));
      failures.push(id + ': driver ' + (error?.message || error));
      await shot('zz-failure').catch(() => {});
    }
    check('no page errors', row.errors.length === 0, row.errors.slice(0, 5));
    await context.close();
    // 긴 실행이 외부에서 끊겨도 끝난 프로필 결과는 남긴다.
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({ ...report, failures, partial: true }, null, 2));
  }
} finally {
  await browser.close();
}
report.finished = new Date().toISOString();
report.failures = failures;
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out, profiles: report.profiles.map((p) => ({ id: p.id, checks: p.checks.length, failed: p.checks.filter((c) => !c.ok).map((c) => c.name) })), failures: failures.length }, null, 1));
process.exitCode = failures.length ? 1 : 0;
