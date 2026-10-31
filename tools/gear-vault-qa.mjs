/**
 * 장비 금고 화면 QA(docs/GEAR_OWNERSHIP_VAULT.md 6절) — 실제 빌드에서 가방(영웅 소유만)·금고·꺼내기·맡기기 흐름을 누르고 캡처한다.
 *   bun run build && node tools/gear-vault-qa.mjs [출력폴더=work/qa/gear-vault] [폭=844] [높이=390]
 * 상태 준비만 evaluate 로 하고, 금고 열기·장비 고르기·꺼내기·맡기기는 실제 클릭이다.
 */
import { chromium } from 'playwright';
import { launchOpts } from './chrome.mjs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const PROJ = resolve(decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'));
const PORT = 4311, OUT = resolve(PROJ, process.argv[2] || 'work/qa/gear-vault');
const W = Number(process.argv[3]) || 844, H = Number(process.argv[4]) || 390;
mkdirSync(OUT, { recursive: true });
const srv = spawn(process.execPath, [resolve(PROJ, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: PROJ, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://localhost:${PORT}/`)).ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 500)); }
if (!up) { srv.kill(); throw new Error('preview server did not start'); }
const br = await chromium.launch(launchOpts());
const page = await (await br.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 })).newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const errors = [], results = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 240)));
const missing = [];
page.on('response', (r) => { if (r.status() >= 400) missing.push(r.status() + ' ' + new URL(r.url()).pathname); });
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'OK   ' : 'FAIL ') + name, typeof detail === 'string' ? detail : JSON.stringify(detail ?? '')); };
const shot = (name) => page.screenshot({ path: resolve(OUT, `${name}-${W}x${H}.png`) });
const inModal = (sel) => page.locator('#modal ' + sel);
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 120000 });
  await page.click('#boot-start', { force: true }); await page.waitForTimeout(1500);
  for (let i = 0; i < 4; i++) { const close = page.getByRole('button', { name: '닫기' }).first(); if (await close.isVisible().catch(() => false)) { await close.click(); await page.waitForTimeout(400); } }
  // 새 계정은 시작 영웅 선택부터 뜬다: 기사로 시작한다.
  const starter = page.getByRole('button', { name: /이 영웅으로 시작/ }).first();
  if (await starter.isVisible().catch(() => false)) { await starter.click(); await page.waitForTimeout(1500); }
  for (let i = 0; i < 4; i++) { const close = page.getByRole('button', { name: '닫기' }).first(); if (await close.isVisible().catch(() => false)) { await close.click(); await page.waitForTimeout(400); } }
  // 세로 화면(360×800)은 가로 안내가 덮는다: 세로로 계속한다.
  const ignoreRotate = page.locator('#btn-ignore-rotate'); if (await ignoreRotate.isVisible().catch(() => false)) { await ignoreRotate.click(); await page.waitForTimeout(500); }
  // 상태 준비: 기사·마법사 소유, 기사 가방 3개(하나 착용), 마법사가 금고에 맡긴 전설 무기 1개, 골드 넉넉.
  const prep = await page.evaluate(() => {
    const eco = window.app.eco;
    eco.s.roster.owned = [...new Set([...eco.s.roster.owned, 'knight', 'mage'])]; eco.s.roster.starterChosen = true; eco.s.selected = 'knight'; eco.s.gold = 3_000_000;
    const k1 = eco.addItem('E', 'weapon', undefined, 0, 'knight'), k2 = eco.addItem('S', 'armor', undefined, 0, 'knight'), k3 = eco.addItem('U', 'ring', undefined, 0, 'knight');
    k1.enh = 9; eco.equip('knight', k1.uid);
    const m1 = eco.addItem('U', 'weapon', undefined, 0, 'mage'); m1.enh = 12; eco.vaultDeposit(m1.uid);
    const m2 = eco.addItem('N', 'boots', undefined, 0, 'mage');
    eco.emit(); window.app.meta.heroSel = 'knight'; window.app.meta.heroPane = 'gear'; window.app.meta.openTab('heroes');
    return { k1: k1.uid, k2: k2.uid, k3: k3.uid, m1: m1.uid, m2: m2.uid, bag: eco.heroBag('knight').map((x) => x.uid) };
  });
  await page.waitForSelector('#hero-bag [data-bag-vault]', { state: 'attached', timeout: 30000 }); await page.waitForTimeout(1200);
  if (!await page.locator('#hero-bag [data-bag-vault]').isVisible()) {
    await shot('00-debug');
    console.log(JSON.stringify(await page.evaluate(() => { const b = document.querySelector('#hero-bag [data-bag-vault]'); const chain = []; for (let e = b; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || e.hidden) chain.push(e.id || e.className); } return { chain, tab: window.app.meta.tab, rect: b.getBoundingClientRect() }; })));
  }
  const bagUids = await page.$$eval('#hero-bag [data-inv]', (els) => els.map((e) => +e.dataset.inv));
  check('가방에는 기사 소유 장비만', JSON.stringify(bagUids.sort()) === JSON.stringify([prep.k1, prep.k2, prep.k3].sort()), bagUids);
  check('가방에 금고 버튼(1/20)', (await page.textContent('#hero-bag [data-bag-vault]')).includes('1/20'), await page.textContent('#hero-bag [data-bag-vault]'));
  await shot('01-bag');
  await page.click('#hero-bag [data-bag-vault]'); await inModal('.vault-sheet').waitFor();
  await page.waitForTimeout(400); await shot('02-vault');
  await inModal(`[data-vault-uid="${prep.m1}"]`).click(); await page.waitForTimeout(300);
  const takeLabel = await inModal('#v-take').textContent(), pickText = await inModal('.vault-pick').textContent();
  check('꺼내기 견적: 다른 영웅 → 골드 55,010', pickText.includes('55,010'), pickText);
  await shot('03-vault-pick');
  const goldBefore = await page.evaluate(() => window.app.eco.s.gold);
  await inModal('#v-take').click(); await page.waitForTimeout(500);
  const after = await page.evaluate((uid) => ({ owner: window.app.eco.s.inventory.find((x) => x.uid === uid)?.owner, gold: window.app.eco.s.gold, used: window.app.eco.s.vault.used }), prep.m1);
  check('꺼낸 장비는 기사 소유·골드 차감·하루 1회 사용', after.owner === 'knight' && goldBefore - after.gold === 55010 && after.used === 1, { takeLabel, ...after });
  await shot('04-vault-after-take');
  await inModal('[data-vault-tab="bag"]').click(); await page.waitForTimeout(300);
  await inModal(`[data-bag-uid="${prep.k2}"]`).click(); await page.waitForTimeout(300);
  await shot('05-bag-tab-pick');
  await inModal('#v-put').click(); await page.waitForTimeout(500);
  const put = await page.evaluate((uid) => window.app.eco.s.inventory.find((x) => x.uid === uid), prep.k2);
  check('맡긴 장비는 금고·맡긴 영웅 기록', put.owner === 'vault' && put.from === 'knight', put);
  await shot('06-after-put');
  await inModal('#v-close').click(); await page.waitForTimeout(600);
  await page.click(`#hero-bag [data-inv="${prep.m1}"]`); await inModal('#i-vault').waitFor({ timeout: 15000 });
  check('장비 시트에 금고에 맡기기', await inModal('#i-vault').isVisible(), '');
  await page.waitForTimeout(500); await shot('07-item-sheet');
  // 버튼이 화면 안에 다 보이는지(가로 844×390)
  const box = await inModal('#i-vault').boundingBox();
  check('맡기기 버튼이 화면 안', box && box.y + box.height <= H && box.x + box.width <= W, box);

  // ---- 계승 의식 · 도감 (docs/GEAR_VAULT_INHERIT.md 덩어리 3) ----
  await page.evaluate(() => window.app.meta.ui.closeModal()); await page.waitForTimeout(400);
  const rit = await page.evaluate(() => {
    const eco = window.app.eco; eco.s.lineageSigil = 6; eco.s.gold = 3_000_000;
    const l = eco.addItem('L', 'weapon', undefined, 0, 'mage'); l.enh = 15; eco.vaultDeposit(l.uid);
    const l2 = eco.addItem('L', 'armor', undefined, 0, 'mage'); eco.vaultDeposit(l2.uid);
    eco.emit(); window.app.meta.heroSel = 'knight'; window.app.meta.openTab('heroes');
    return { l: l.uid, l2: l2.uid, hops: 0 };
  });
  await page.waitForSelector('#hero-bag [data-bag-vault]', { state: 'attached', timeout: 30000 }); await page.waitForTimeout(800);
  const overlap = async (sel) => page.evaluate((q) => {
    const rects = [...document.querySelectorAll(q)].filter((e) => e.offsetParent !== null).map((e) => e.getBoundingClientRect());
    let bad = 0; for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const a = rects[i], b = rects[j]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) bad++; }
    return bad;
  }, sel);
  const inView = async (sel) => page.evaluate(([q, vw, vh]) => [...document.querySelectorAll(q)].every((e) => { const r = e.getBoundingClientRect(); return r.left >= -1 && r.top >= -1 && r.right <= vw + 1 && r.bottom <= vh + 1; }), [sel, W, H]);
  await page.click('#hero-bag [data-bag-vault]'); await inModal('.vault-sheet').waitFor(); await page.waitForTimeout(300);
  await inModal(`[data-vault-uid="${rit.l}"]`).click(); await page.waitForTimeout(300);
  const boundText = await inModal('.vault-pick').textContent();
  check('bound 안내: 계승 의식으로만 옮길 수 있어요', boundText.includes('계승 의식으로만 옮길 수 있어요'), boundText);
  check('bound 일 때 일반 꺼내기 비활성·의식 버튼 활성', await inModal('#v-take').isDisabled() && await inModal('#v-ritual').isEnabled(), '');
  check('금고 하단 버튼 겹침 0·화면 안', (await overlap('#modal .vault-actions > *')) === 0 && await inView('#modal .vault-actions .btn'), await overlap('#modal .vault-actions > *'));
  await shot('10-bound-notice');
  await inModal('#v-ritual').click(); await inModal('#ritual-go').waitFor(); await page.waitForTimeout(300);
  const quoteText = await inModal('.ritual-quote').textContent();
  check('의식 견적: 문장 2개(+15)·남은 2/2·골드', /2개/.test(quoteText) && quoteText.includes('2/2') && quoteText.includes('200,000'), quoteText.replace(/\s+/g, ' '));
  check('의식 시트 겹침 0·화면 안', (await overlap('#modal .ritual-quote > div, #modal .ritual-item, #modal .vault-actions > *')) === 0 && await inView('#modal #ritual-go, #modal #ritual-back, #modal .ritual-quote'), await overlap('#modal .ritual-quote > div, #modal .ritual-item, #modal .vault-actions > *'));
  await shot('11-ritual-quote');
  const rBefore = await page.evaluate(() => ({ gold: window.app.eco.s.gold, sigil: window.app.eco.s.lineageSigil }));
  await inModal('#ritual-go').click(); await inModal('#rite-stage').waitFor({ timeout: 5000 }); await page.waitForTimeout(2400);
  const rAfter = await page.evaluate((uid) => { const e = window.app.eco; const it = e.s.inventory.find((x) => x.uid === uid); return { gold: e.s.gold, sigil: e.s.lineageSigil, owner: it.owner, hops: it.hops, enh: it.enh, used: e.s.vault.rused }; }, rit.l);
  check('서버 응답(결과 확정) 뒤 연출: 소유 knight·계승 1·강화 +15·문장 -2·하루 1회', rAfter.owner === 'knight' && rAfter.hops === 1 && rAfter.enh === 15 && rBefore.sigil - rAfter.sigil === 2 && rBefore.gold - rAfter.gold === 200000 && after.used === 1, after);
  const phase = await inModal('.vault-rite').getAttribute('data-phase');
  check('연출 중간 단계 재생', ['glow', 'arrive'].includes(phase), phase);
  await shot('12-rite-mid');
  await inModal('#rite-stage').click(); await page.waitForTimeout(500);
  check('탭으로 건너뛰기 → 결과 표시(계승 1)', (await inModal('#rite-result').textContent()).includes('계승 1') && (await inModal('.vault-rite').getAttribute('data-phase')) === 'done', await inModal('#rite-result').textContent());
  check('연출 시트 겹침 0·화면 안', (await overlap('#modal .rite-stage > *, #modal .rite-result, #modal .vault-actions > *')) === 0 && await inView('#modal #rite-ok, #modal .rite-stage, #modal #rite-result'), await overlap('#modal .rite-stage > *, #modal .rite-result, #modal .vault-actions > *'));
  await shot('13-rite-done');
  await inModal('#rite-ok').click(); await inModal('.vault-grid').waitFor(); await page.waitForTimeout(300);
  await inModal('[data-vault-tab="dex"]').click(); await inModal('.dex-list').waitFor(); await page.waitForTimeout(300);
  const dexText = await inModal('.dex-body').textContent();
  check('도감: 계승 도감 1종·마일스톤 목록', dexText.includes('계승 도감 1종') && dexText.includes('드랍 도감 25%'), dexText.replace(/\s+/g, ' ').slice(0, 160));
  check('도감 화면 겹침 0·가로 넘침 없음', (await overlap('#modal .dex-ms, #modal .dex-bar')) === 0 && await page.evaluate(() => { const b = document.querySelector('#modal .dex-body'); return b.scrollWidth <= b.clientWidth + 1; }), '');
  await shot('14-dex');
  // 전투 중 의식 비활성: 전투 플래그를 켜고 다시 연다.
  await page.evaluate(() => { window.app.__qaBattle = window.app.battle; window.app.battle = { active: true }; });
  await inModal('[data-vault-tab="vault"]').click(); await page.waitForTimeout(300);
  await inModal(`[data-vault-uid="${rit.l2}"]`).click(); await page.waitForTimeout(300);
  check('전투 중 의식 버튼 비활성', await inModal('#v-ritual').isDisabled(), '');
  await page.evaluate(() => { window.app.battle = window.app.__qaBattle; });
} finally {
  // 404 는 미리보기 서버에 없는 원격 자산 묶음·/api 이다(콘솔 오류와 별개로 경로를 남긴다).
  if (missing.length) console.log('4xx 경로:', [...new Set(missing)].slice(0, 10).join(', '));
  const real = errors.filter((e) => !/Failed to load resource: the server responded with a status of 404/.test(e) || !missing.every((m) => /^404 \/(api\/|assets\/remote|models\/|remote\/)/.test(m)));
  check('콘솔 오류 0(원격 자산·/api 404 제외)', real.length === 0, real.slice(0, 5).join(' | '));
  writeFileSync(resolve(OUT, `result-${W}x${H}.json`), JSON.stringify({ at: new Date().toISOString(), viewport: [W, H], results, errors }, null, 2));
  await br.close(); srv.kill();
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
