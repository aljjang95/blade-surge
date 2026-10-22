// MMO P1-F 수용 QA: 실제 빌드(dist) + 로컬 workerd(miniflare: Worker·D1·SocialHub) + Chromium.
// 1) 그림자 모드: 게스트 생성 → 로컬 명령 → 패리티 로그 불일치 0
// 2) 서버 권위: 신규 설치 → 게스트 생성 → 1-1 AUTO 클리어 → 결과 화면에 서버 영수증 → localStorage 삭제 후 새로고침 → 서버에서 복구
// 네트워크 배포 없음. 실행: bun run build && node tools/v1-account-qa.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const out = path.join(root, 'work/qa/v1-account');
mkdirSync(out, { recursive: true });
assert.ok(existsSync(path.join(dist, 'index.html')), 'dist 없음: 먼저 bun run build');
const bundle = await build({ entryPoints: [path.join(root, 'worker/index.ts')], bundle: true, write: false, format: 'esm', platform: 'browser',
  loader: { '.css': 'empty' }, conditions: ['workerd', 'worker', 'browser'], external: ['cloudflare:*'] });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png',
  '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };

async function stack(percent) {
  const server = http.createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const mf = new Miniflare(convertV4MiniflareOptions({ name: 'v1-qa-' + percent, modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2025-06-01', compatibilityFlags: ['nodejs_compat'],
    bindings: { APP_ORIGIN: origin, SOCIAL_DEV_ORIGINS: 'true', V1_ENABLED: 'true', V1_SERVER_AUTHORITY_PERCENT: String(percent), SESSION_HMAC: 'qa-secret-'.padEnd(48, 'q'), DIALOGUE_ENABLED: 'false', GOOGLE_CLIENT_IDS: '' },
    d1Databases: { COMMERCE_DB: 'v1-qa-' + percent },
    durableObjects: { SOCIAL: { className: 'SocialHub', useSQLite: true }, PARTIES: { className: 'PartyRoom', useSQLite: true }, DIALOGUE_BUDGET: { className: 'DialogueBudget', useSQLite: true } } }));
  const db = await mf.getD1Database('COMMERCE_DB');
  for (const file of readdirSync(path.join(root, 'worker/v1/migrations')).filter(f => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(path.join(root, 'worker/v1/migrations', file), 'utf8').split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
    await db.batch(sql.split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
  }
  server.on('request', async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith('/api/')) {
        const chunks = []; for await (const c of req) chunks.push(c);
        const r = await mf.dispatchFetch(origin + req.url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
        res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
      }
      let file = path.join(dist, decodeURIComponent(url.pathname));
      if (!file.startsWith(dist) || !existsSync(file) || url.pathname.endsWith('/')) file = path.join(dist, 'index.html');
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(readFileSync(file));
    } catch (error) { res.writeHead(500); res.end(String(error?.message)); }
  });
  return { origin, mf, db, close: async () => { server.close(); await mf.dispose(); } };
}

const report = { started: new Date().toISOString(), steps: [], errors: [] };
const step = (name, ok, detail = '') => { report.steps.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); if (!ok) process.exitCode = 1; };
const browser = await chromium.launch({ ...(process.env.V1_QA_CHROMIUM ? { executablePath: process.env.V1_QA_CHROMIUM } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });

async function open(context, origin, prepare) {
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(String(e).slice(0, 300)));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').click();
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 240000 });
  if (prepare) await page.evaluate(prepare);
  await page.locator('#boot-start').click({ force: true });
  await page.waitForFunction(() => window.app?.mode === 'lobby', null, { timeout: 120000 });
  await page.waitForFunction(() => /^(ready|disabled|offline)/.test(document.documentElement.dataset.v1 || ''), null, { timeout: 60000 });
  return page;
}
const localTutorialDone = () => { const e = window.app.eco; e.s.tutorial = { completed: true }; e.s.daily.last = Math.floor(Date.now() / 86400000); e.save(); };

try {
  // ── 1) 그림자 모드 ─────────────────────────────────────
  const shadow = await stack(0);
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
    const page = await open(context, shadow.origin, localTutorialDone);
    const v1 = await page.evaluate(() => document.documentElement.dataset.v1);
    step('그림자: 게스트 계정 연결', v1 === 'ready:shadow', v1 + ' ' + await page.evaluate(() => JSON.stringify({ e: window.app.account.error, l: window.app.account.lastError, i: window.app.account.import })));
    const stats = await page.evaluate(async () => {
      const a = window.app, e = a.eco;
      e.claimMail(1); e.addItem('N'); a.account.queue.snapshot(); e.equip('knight', e.s.inventory.at(-1).uid); e.unequip('knight', 'weapon');
      for (let i = 0; i < 100 && (a.account.queue.pending.length || a.account.queue.busy); i++) await new Promise(r => setTimeout(r, 50));
      return a.account.queue.stats;
    });
    const parity = await shadow.db.prepare('SELECT SUM(match = 0) AS bad, COUNT(*) AS n FROM parity_log').first();
    step('그림자: 패리티 로그 0 불일치', parity.n >= 3 && parity.bad === 0 && stats.mismatched === 0, JSON.stringify({ ...stats, logged: parity.n, bad: parity.bad }));
    await context.close();
  } finally { await shadow.close(); }

  // ── 2) 서버 권위 ───────────────────────────────────────
  const server = await stack(100);
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
    let page = await open(context, server.origin, localTutorialDone);
    const v1 = await page.evaluate(() => document.documentElement.dataset.v1);
    step('서버 권위: 신규 설치 → 게스트 생성', v1 === 'ready:server', v1);
    const started = await page.evaluate(async () => {
      const a = window.app; a.journey.s.autoBattle = true; a.ui.closeModal();
      return await a.startStage({ ch: 1, st: 1 });
    });
    assert.equal(started, true, '1-1 출격 실패');
    await page.waitForFunction(() => window.app.battle?.active && !window.app.stageStarting && !!window.app.battle.player, null, { timeout: 180000 });
    const ticket = await page.evaluate(() => window.app.battle.v1Run?.runId || null);
    step('서버 권위: 1-1 서버 티켓 발급', !!ticket, ticket || '');
    await page.evaluate(() => { const a = window.app; a.testPause = true; a.battle.player.auto = true; a.ui.closeModal(); });
    // 서버 시계 개연성(경과 ≤ 실제 시간 ×1.2)을 지키기 위해 실제 시간과 비슷한 속도로 진행한다.
    let state = null;
    for (let i = 0; i < 400; i++) {
      state = await page.evaluate(() => {
        const a = window.app, b = a.battle, P = b.player;
        for (let k = 0; k < 60 && b.active; k++) {
          if (!P.alive) { b.revivePlayer?.(); a.ui.closeModal?.(); }
          a.step(1 / 60, false);
        }
        return { active: b.active, win: b.result?.win ?? null, elapsed: b.elapsed, kills: b.kills };
      });
      if (!state.active) break;
      await page.waitForTimeout(1000);
    }
    step('서버 권위: 1-1 AUTO 클리어', state?.win === true, JSON.stringify(state));
    for (let i = 0; i < 240 && !(await page.evaluate(() => window.app.account.receipts.length)); i++) {
      await page.evaluate(() => { for (let k = 0; k < 30; k++) window.app.step(1 / 60, false); });
      await page.waitForTimeout(250);
    }
    const receipt = await page.evaluate(() => {
      const r = window.app.account.receipts.at(-1), el = document.getElementById('v1-receipt');
      return r ? { verdict: r.verdict, issues: r.issues, got: r.got.length, loot: r.loot.length, shown: el?.dataset.receiptId === r.receiptId, text: el?.textContent } : null;
    });
    step('서버 권위: 결과 화면에 서버 영수증', receipt?.verdict === 'ok' && receipt.shown, JSON.stringify(receipt));
    await page.screenshot({ path: path.join(out, 'receipt.png') });
    await page.waitForTimeout(1500);
    const before = await page.evaluate(() => { const s = window.app.eco.s; return { gold: s.gold, unlocked: s.progress.unlocked, inv: s.inventory.length, level: s.heroes.knight.level }; });
    await page.evaluate(() => localStorage.clear());
    await page.close();
    page = await open(context, server.origin, null);
    await page.waitForFunction(() => window.app.eco.s.progress.unlocked > 1, null, { timeout: 30000 }).catch(() => {});
    const after = await page.evaluate(() => { const s = window.app.eco.s; return { gold: s.gold, unlocked: s.progress.unlocked, inv: s.inventory.length, level: s.heroes.knight.level, v1: document.documentElement.dataset.v1 }; });
    step('서버 권위: localStorage 삭제 후 새로고침 → 서버에서 복구', after.unlocked === before.unlocked && after.gold === before.gold && after.inv === before.inv,
      JSON.stringify({ before, after }));
    await context.close();
  } finally { await server.close(); }
} catch (error) {
  step('예외', false, String(error?.message || error).slice(0, 500));
} finally {
  await browser.close();
  report.finished = new Date().toISOString();
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ qa: 'v1-account', pass: report.steps.every(s => s.ok), steps: report.steps.length, errors: report.errors.length }));
}
