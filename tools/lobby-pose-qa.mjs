// 로비 영웅 좌우 팔 대칭 실측: 실제 로비 쇼케이스에서 직업별로 뼈 월드 위치를 재고 캡처한다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { installAutoStarter } from './qa-starter.mjs';
const origin = process.argv[2] || 'http://127.0.0.1:5182';
const out = path.resolve(process.argv[3] || 'work/qa-lobby-pose');
const heroes = (process.argv[4] || 'knight,barbarian,mage,rogue,ranger').split(',');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 590 }, deviceScaleFactor: 1.5, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
await installAutoStarter(page); // 빈 저장 부팅 시 시작 영웅 선택 화면 자동 통과
await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 120000 }); await page.click('#boot-start');
await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot').classList.contains('show') && app.showcase, null, { timeout: 120000 });
await page.evaluate(() => app.ui.closeModal?.());
const rows = [];
for (const id of heroes) {
  await page.evaluate(async id => { app.eco.s.selected = id; await app.showcaseHero(id, true); }, id);
  await page.waitForTimeout(1600);
  const m = await page.evaluate(() => {
    const s = app.showcase, root = s.root; root.updateMatrixWorld(true);
    const V = root.position.constructor; const inv = root.matrixWorld.clone().invert();
    const bones = []; root.traverse(o => { if (o.isBone) bones.push(o); });
    const find = (side, part) => bones.find(b => { const n = b.name.toLowerCase().replace(/mixamorig:?/,''); const L = side === 'l'; const sideOk = L ? (/left/.test(n) || /[._]l$/.test(n) || /\.l\b|_l\b/.test(n)) : (/right/.test(n) || /[._]r$/.test(n) || /\.r\b|_r\b/.test(n)); return sideOk && (part === 'upper' ? /(upper_?arm|^.*arm(\.|_)?(l|r)?$|leftarm$|rightarm$)/.test(n) && !/fore|lower/.test(n) : part === 'fore' ? /(fore_?arm|lower_?arm)/.test(n) : /hand$|hand[._](l|r)$|wrist/.test(n)); });
    const local = b => b ? (b.getWorldPosition(new V()).applyMatrix4(inv)) : null;
    const r = {}; for (const side of ['l', 'r']) for (const part of ['upper', 'fore', 'hand']) { const b = find(side, part), p = local(b); r[side + '_' + part] = b ? { name: b.name, x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) } : null; }
    const clipNames = Object.keys(s.clips || {}).slice(0, 40);
    return { model: s.def.model, bones: bones.length, r, clipNames, scaleY: root.scale.y };
  });
  // 좌우 비교: 손 높이 차, 몸통 중심선(x=0)으로부터 거리 차(모델 로컬 좌표)
  const R = m.r, d = (a, b) => (a && b) ? +(Math.abs(a) - Math.abs(b)).toFixed(3) : null;
  m.handHeightDiff = R.l_hand && R.r_hand ? +(R.l_hand.y - R.r_hand.y).toFixed(3) : null;
  m.handSpreadDiff = R.l_hand && R.r_hand ? d(R.l_hand.x, R.r_hand.x) : null;
  m.elbowHeightDiff = R.l_fore && R.r_fore ? +(R.l_fore.y - R.r_fore.y).toFixed(3) : null;
  m.shoulderHeightDiff = R.l_upper && R.r_upper ? +(R.l_upper.y - R.r_upper.y).toFixed(3) : null;
  const file = path.join(out, 'lobby-' + id + '.png'); await page.screenshot({ path: file });
  rows.push({ hero: id, ...m, screenshot: file });
}
await browser.close();
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({ origin, rows, errors }, null, 2));
console.log(JSON.stringify(rows.map(r => ({ hero: r.hero, model: r.model, bones: r.bones, sh: r.shoulderHeightDiff, el: r.elbowHeightDiff, hh: r.handHeightDiff, hs: r.handSpreadDiff, names: [r.r.l_upper?.name, r.r.l_fore?.name, r.r.l_hand?.name] })), null, 0), errors.slice(0, 2));
