/**
 * 아바타 상점 초상 굽기 — 게임 로더(vite dev + Playwright Chromium)로 아바타 몸을 얼굴 3/4 상반신·투명 배경으로 렌더하고
 * art-src/t5-pc/portrait-bg/bg_<영웅>_<테마>.png 위에 합성해 public/img/tll/avatars/<아바타 id>-v1.webp 로 쓴다.
 *   node tools/art/avatar-portrait/render.mjs [아바타 id ...] [--raw <투명 PNG·시트 폴더>] [--size 512]
 * id 를 생략하면 src/data/avatars.js 의 아바타 중 manifest 몸이 있는 것 전부. 몸이 없는 id 는 실패로 끝난다(exit 1).
 * 몸 해석은 게임과 같다(preloadHeroBody → applyLook avatarId, 교정 몸이 있으면 교정 몸). SwiftShader 렌더이며 실기기 증거가 아니다.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { launchOpts } from '../../chrome.mjs';
import { AVATARS } from '../../../src/data/avatars.js';
import { PORTRAIT_BACKGROUNDS, portraitPath } from './render-config.mjs';


const PROJ = resolve(decodeURIComponent(new URL('../../..', import.meta.url).pathname));
const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i < 0 ? def : args[i + 1]; };
const ids = args.filter((a, i) => !a.startsWith('--') && !['--raw', '--size', '--yaw', '--frame'].includes(args[i - 1]));
const SIZE = Number(flag('--size', 512)), RAW = flag('--raw', null), YAW = flag('--yaw', null), FRAME = flag('--frame', null);
const targets = ids.length ? ids : AVATARS.map((a) => a.id);
for (const id of targets) if (!PORTRAIT_BACKGROUNDS[id]) { console.error('배경 매핑 없음: ' + id); process.exit(2); }
if (RAW) mkdirSync(resolve(RAW), { recursive: true });
mkdirSync(resolve(PROJ, 'public/img/tll/avatars'), { recursive: true });

const PORT = 5600 + Math.floor(Math.random() * 300);
const srv = spawn(process.execPath, [resolve(PROJ, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: PROJ, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 500)); }
if (!up) { srv.kill(); throw new Error('vite dev server did not start'); }
const browser = await chromium.launch(launchOpts());
const report = [];
let failed = 0;
try {
  for (const id of targets) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const q = new URLSearchParams({ id, size: String(SIZE * 2), ...(YAW ? { yaw: YAW } : {}), ...(FRAME ? { frame: FRAME } : {}) });
    await page.goto(`http://127.0.0.1:${PORT}/tools/art/avatar-portrait/studio.html?${q}`);
    await page.waitForFunction(() => window.__portrait, null, { timeout: 240000 });
    const r = await page.evaluate(() => window.__portrait); await page.close();
    if (r.error) { failed++; console.error(id, r.error); report.push({ id, error: r.error }); continue; }
    // 2배로 렌더해 줄이고(가장자리 정리), 인물 그림자(흐린 실루엣)를 배경과 인물 사이에 깐다.
    const figure = await sharp(Buffer.from(r.url.split(',')[1], 'base64')).resize(SIZE, SIZE).png().toBuffer();
    const alpha = await sharp(figure).extractChannel(3).toBuffer();
    const shadow = await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: '#000' } }).joinChannel(await sharp(alpha).linear(.55, 0).blur(SIZE / 48).toBuffer()).png().toBuffer();
    const bgFile = resolve(PROJ, 'art-src/t5-pc/portrait-bg', PORTRAIT_BACKGROUNDS[id]);
    if (!existsSync(bgFile)) { failed++; console.error(id, '배경 없음', bgFile); continue; }
    const out = resolve(PROJ, 'public' + portraitPath(id));
    const img = sharp(bgFile).resize(SIZE, SIZE).composite([{ input: shadow, left: Math.round(SIZE / 96), top: Math.round(SIZE / 96) }, { input: figure }]);
    await img.clone().webp({ quality: 86, effort: 6 }).toFile(out);
    if (RAW) { writeFileSync(resolve(RAW, id + '__figure.png'), figure); await img.clone().png().toFile(resolve(RAW, id + '__portrait.png')); }
    const entry = { id, out: portraitPath(id), body: r.body, source: r.source, bg: PORTRAIT_BACKGROUNDS[id], errors };
    report.push(entry); console.log(JSON.stringify(entry));
  }
} finally { await browser.close(); srv.kill(); }
if (RAW) writeFileSync(resolve(RAW, 'report.json'), JSON.stringify(report, null, 2));
process.exit(failed ? 1 : 0);
