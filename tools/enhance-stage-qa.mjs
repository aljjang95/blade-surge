/**
 * 강화 연출(enhance-stage) 화면 QA — 긴장 중간·결과 직후 캡처, 클래스·문구·겹침 기록, 영상 녹화.
 *   bun run build && node tools/enhance-stage-qa.mjs [출력폴더=work/qa/enhance-stage]
 */
import { chromium } from 'playwright';
import { launchOpts } from './chrome.mjs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync, readdirSync, renameSync } from 'node:fs';

const PROJ = resolve(decodeURIComponent(new URL('..', import.meta.url).pathname));
const PORT = 4311, OUT = resolve(PROJ, process.argv[2] || 'work/qa/enhance-stage');
mkdirSync(OUT, { recursive: true });
const srv = spawn(process.execPath, [resolve(PROJ, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: PROJ, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://localhost:${PORT}/`)).ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 500)); }
if (!up) { srv.kill(); throw new Error('preview server did not start'); }
const br = await chromium.launch(launchOpts());
const ctx = await br.newContext({ viewport: { width: 844, height: 390 }, recordVideo: { dir: OUT, size: { width: 844, height: 390 } } });
const page = await ctx.newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const errors = [], notes = [], records = [];
page.on('console', (m) => { if (m.type() === 'error' && !/status of 404/.test(m.text())) errors.push(m.text().slice(0, 240)); });
page.on('response', (r) => { if (r.status() >= 400) (r.status() === 404 && /\/api\//.test(r.url()) ? notes : errors).push(`HTTP ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 120)}`); });
page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 240)));
const settle = (ms = 500) => page.waitForTimeout(ms);
const shot = async (name) => { const f = `${name}.png`; await page.screenshot({ path: resolve(OUT, f) }); return f; };
// 긴장 길이(enhance-stage.js enhanceStageTiming 과 같은 식)
const tensionOf = (lv, quick) => { const k = Math.max(0, Math.min(1, (lv - 3) / 14)); return quick ? 0.45 + 0.25 * k : 0.8 + 1.2 * k; };

// 결과 숫자 상자가 버튼·확률 문구와 겹치는지.
const measure = (settle = false) => page.evaluate((settle) => {
  const st = document.querySelector('.enh-stage');
  if (!st) return { stage: false };
  if (settle) st.querySelectorAll('.enh-stamp').forEach((e) => e.getAnimations().forEach((a) => { try { a.finish(); } catch {} }));
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(0), y: +b.y.toFixed(0), w: +b.width.toFixed(0), h: +b.height.toFixed(0), r: +b.right.toFixed(0), b: +b.bottom.toFixed(0) }; };
  const hit = (a, b) => !!(a && b && a.w && b.w && a.x < b.r && a.r > b.x && a.y < b.b && a.b > b.y);
  const stamp = st.querySelector('.enh-stamp'), sr = r(stamp);
  // 입장 애니메이션(스케일 2.4→1)이 끝난 최종 위치를 레이아웃에서 계산(transform 영향 없음): 상자 위 18% 지점, 가로 가운데.
  let fin = null;
  if (stamp) { const sb = st.getBoundingClientRect(), w = stamp.offsetWidth, h = stamp.offsetHeight; const x = sb.x + sb.width / 2 - w / 2, y = sb.y + sb.height * 0.18; fin = { x: +x.toFixed(0), y: +y.toFixed(0), w, h, r: +(x + w).toFixed(0), b: +(y + h).toFixed(0) }; }
  const targets = { go: '#e-go', rate: '.enh-rate', note: '.is-enh-note' }, rects = {}, overlap = {};
  const finalOverlap = {};
  for (const [k, sel] of Object.entries(targets)) { rects[k] = r(document.querySelector(sel)); overlap[k] = hit(sr, rects[k]); finalOverlap[k] = hit(fin, rects[k]); }
  const vw = innerWidth, vh = innerHeight;
  return { stage: true, cls: st.className, stamp: stamp?.textContent ?? null, stampRect: sr, rects, overlap, finalRect: fin, finalOverlap, stampInViewport: sr ? sr.x >= 0 && sr.y >= 0 && sr.r <= vw && sr.b <= vh : null, sparks: st.querySelectorAll('.enh-spark').length };
}, settle);

// 무기를 장착하고 강화 단계를 맞춘 뒤 장비 상세 시트를 연다.
const openSheet = (enh) => page.evaluate(async (enh) => {
  const app = window.app, eco = app.eco, s = eco.s;
  s.gold = 9e9; for (const k of ['stones', 'stones2', 'stones3', 'protect', 'bless']) if (k in s || k.startsWith('stones')) s[k] = 99999;
  const heroId = s.selected;
  let inst = s.inventory.find((x) => x.id === 'w_town_star');
  if (!inst) { inst = { uid: s.invSeq++, id: 'w_town_star', enh: 0 }; s.inventory.push(inst); }
  inst.enh = enh; eco.hero(heroId).equip.weapon = inst.uid; eco.emit();
  window.__uid = inst.uid;
  app.ui.endModal?.();
  app.meta.showItem(inst.uid, heroId, { focus: 'enhance' });
  await new Promise((r) => setTimeout(r, 400));
  return { uid: inst.uid, heroId, enh: inst.enh, hasGo: !!document.querySelector('#e-go') };
}, enh);

// 다음 eco.enhance 결과를 강제한다(원래 함수는 호출하지 않는다).
const force = (o) => page.evaluate((o) => { window.__force = o; }, o);

async function scenario(id, label, from, outcome, opts = {}) {
  // 소프트웨어 렌더라 스크린샷이 느려 긴장 중간을 놓칠 수 있다 — 긴장 중간 캡처가 이미 결과 단계거나 결과 캡처가 비면 최대 3번 다시 한다.
  let rec;
  for (let attempt = 1; attempt <= 3; attempt++) {
    rec = await scenarioOnce(id, label, from, outcome, opts); rec.attempt = attempt;
    const fin = rec.result || rec.skipResult;
    if (rec.mid && !/result/.test(rec.mid.cls || '') && fin?.stage) break;
    records.pop(); if (attempt === 3) records.push(rec);
  }
  return rec;
}
async function scenarioOnce(id, label, from, outcome, opts = {}) {
  const sh = await openSheet(from);
  const rec = { id, label, from, outcome, sheet: sh, view: opts.view ?? '844x390' };
  if (!sh.hasGo) { rec.error = '#e-go 없음'; records.push(rec); return rec; }
  await settle(2800); // 직전 연출 종료 후 2.5초가 지나야 '연속(quick)'이 아닌 정상 긴장 구간이 된다
  await force(outcome);
  await page.click('#e-go');
  await page.waitForSelector('.enh-stage', { timeout: 3000 }).catch(() => {});
  const t0 = Date.now();
  const quick = await page.evaluate(() => !!document.querySelector('.enh-stage.quick'));
  const tension = tensionOf(from, quick); rec.quick = quick; rec.tension = +tension.toFixed(3);
  if (opts.skip) {
    await settle(tension * 500);
    rec.mid = { ...(await measure()), file: await shot(`${id}-mid`), at: Date.now() - t0 };
    await page.mouse.click(120, 195); // 스테이지 위 탭
    await page.waitForSelector('.enh-stage.result', { timeout: 3000 }).catch(() => {});
    await settle(150);
    rec.skipResult = { ...(await measure()), file: await shot(`${id}-result`), at: Date.now() - t0 };
    rec.skipResult.settled = await measure(true);
  } else {
    await settle(tension * 500);
    rec.mid = { ...(await measure()), file: await shot(`${id}-mid`), at: Date.now() - t0 };
    await page.waitForSelector('.enh-stage.result', { timeout: 6000 }).catch(() => {});
    const tr = Date.now() - t0;
    await settle(150);
    rec.result = { ...(await measure()), file: await shot(`${id}-result`), at: Date.now() - t0, resultAppearedAt: tr, expectedTension: tension };
    rec.result.settled = await measure(true); // 입장 애니메이션(스케일 2.4→1)을 끝낸 뒤의 최종 위치
    if (!rec.result.stage) rec.result.note = '결과 150ms 뒤 .enh-stage 없음';
  }
  await page.waitForSelector('.enh-stage', { state: 'detached', timeout: 5000 }).catch(() => { rec.stageLingers = true; });
  await settle(400);
  rec.after = await page.evaluate(() => ({ stage: !!document.querySelector('.enh-stage'), goEnabled: !document.querySelector('#e-go')?.disabled, toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent).slice(-1)[0] ?? null, artClass: document.querySelector('.is-head-art')?.className ?? null }));
  records.push(rec); console.log(id, JSON.stringify({ mid: rec.mid?.cls, res: (rec.result || rec.skipResult)?.cls, stamp: (rec.result || rec.skipResult)?.stamp, ov: (rec.result || rec.skipResult)?.overlap }));
  return rec;
}

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 120000 });
  await page.click('#boot-start', { force: true }); await settle(1200);
  const starter = page.getByRole('button', { name: '이 영웅으로 시작' });
  if (await starter.isVisible().catch(() => false)) { await page.getByText('광전사 드라칸').first().click(); await starter.click(); await settle(2500); }
  for (let i = 0; i < 3; i++) { const c = page.getByRole('button', { name: '닫기' }).first(); if (await c.isVisible().catch(() => false)) { await c.click(); await settle(400); } }
  await page.evaluate(() => {
    const eco = window.app.eco, orig = eco.enhance.bind(eco);
    window.__origEnhance = orig;
    eco.enhance = (uid, o) => {
      const f = window.__force; if (!f) return orig(uid, o);
      window.__force = null;
      const inst = eco.s.inventory.find((x) => x.uid === uid);
      if (f.destroyed) { return { ok: true, success: false, destroyed: true, down: 0, enh: inst.enh, chance: 0.5 }; }
      inst.enh = f.enh; eco.emit();
      return { ok: true, success: !!f.success, destroyed: false, down: f.down || 0, enh: f.enh, chance: 0.5 };
    };
    window.app.ui.confirm = async () => true;
  });

  await scenario('warmup', '워밍업(기록 제외)', 3, { success: true, enh: 4 });
  records.pop();
  await scenario('a-5to6', '+5→+6 성공', 5, { success: true, enh: 6 });
  await scenario('b-9to10', '+9→+10 성공(구간 돌파)', 9, { success: true, enh: 10 });
  await scenario('c-14to15', '+14→+15 성공(돌파·최장 긴장)', 14, { success: true, enh: 15 });
  await scenario('d-12down11', '+12→+11 실패 하락', 12, { success: false, enh: 11, down: 1 });
  await scenario('e-8fail', '+8 실패', 8, { success: false, enh: 8 });
  await scenario('h-14destroy', '+14 파괴', 14, { destroyed: true });
  // (f) 연속 강화: 성공 직후 1초 안에 다시
  {
    const sh = await openSheet(6);
    const rec = { id: 'f-chain', label: '연속 강화(성공 직후 1초 내 재강화)', from: 6, sheet: sh, view: '844x390', steps: [] };
    for (let i = 0; i < 3; i++) {
      const lv = await page.evaluate(() => window.app.eco.s.inventory.find((x) => x.uid === window.__uid).enh);
      await force({ success: true, enh: lv + 1 });
      const t0 = Date.now();
      await page.click('#e-go');
      await settle(150);
      const early = await measure();
      await page.waitForSelector('.enh-stage.result', { timeout: 4000 }).catch(() => {});
      const tr = Date.now() - t0;
      await settle(150);
      const res = { ...(await measure()), file: await shot(`f-chain-${i}-result`) }; res.settled = await measure(true);
      await page.waitForSelector('.enh-stage', { state: 'detached', timeout: 4000 }).catch(() => {});
      const detachedAt = Date.now();
      // 시트 재렌더 후 곧바로(약 0.6초 안에) 다음 강화
      await page.waitForFunction(() => { const g = document.querySelector('#e-go'); return g && !g.disabled; }, null, { timeout: 4000 }).catch(() => {});
      rec.steps.push({ i, from: lv, quickClass: /quick/.test(early.cls || ''), resultAfterMs: tr, cls: res.cls, stamp: res.stamp, overlap: res.overlap, settledOverlap: res.settled?.overlap, file: res.file, reEnabledAfterMs: Date.now() - detachedAt });
      if (i < 2) await settle(300);
    }
    records.push(rec); console.log('f-chain', JSON.stringify(rec.steps.map((s) => [s.quickClass, s.resultAfterMs, s.stamp])));
  }
  await scenario('g-skip', '긴장 중 탭 건너뛰기(+13→+14)', 13, { success: true, enh: 14 }, { skip: true });

  // 뷰포트별 (c)
  for (const [w, h] of [[640, 360], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h }); await settle(500);
    const keep = page.getByRole('button', { name: '세로로 계속하기' });
    if (await keep.isVisible().catch(() => false)) { await keep.click(); await settle(600); }
    await scenario(`c-14to15-${w}x${h}`, `+14→+15 ${w}x${h}`, 14, { success: true, enh: 15 }, { view: `${w}x${h}` });
  }
} catch (e) { errors.push('SCRIPT ' + (e.stack || e.message).slice(0, 400)); }
finally {
  await page.close(); await ctx.close();
  // 영상 파일 이름 정리
  try { const vids = readdirSync(OUT).filter((f) => f.endsWith('.webm')); vids.forEach((f, i) => renameSync(resolve(OUT, f), resolve(OUT, i ? `enhance-stage-${i}.webm` : 'enhance-stage.webm'))); } catch {}
  writeFileSync(resolve(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), records, errors, notes }, null, 2));
  await br.close(); srv.kill();
}
console.log('errors:', errors.length, errors.slice(0, 5));
process.exitCode = errors.length ? 1 : 0;
