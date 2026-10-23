/**
 * 영웅·아바타 얼굴 점검 — 실제 런타임이 읽는 GLB(교정본 우선)를 같은 재질 마감(금속도 0.22 상한, 불투명 MASK)으로
 * 정면·3/4 얼굴, 전신, 전투 시점(위 55°)으로 찍고 직업별 4×4 시트를 만든다.
 *   node tools/art/face-audit/run.mjs [출력폴더=work/qa/face-audit] [id 필터 정규식]
 * 2026-10-23 궁수 '애꾸' 제보 대응으로 만들었다. 실기기·GPU 화면 증거가 아니다.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { CHROME, GL_ARGS } from '../../chrome.mjs';

const OUT = process.argv[2] || 'work/qa/face-audit', FILTER = new RegExp(process.argv[3] || '.');
const PORT = 4411, N = 'asset-library/normalized/', H = 'public/models/heroes-next/', RT = process.env.RANGER_T1 || H + 'ranger-library-t1-v6.glb';
const ROWS = {
  ranger: [['ranger_t1', RT], ['ranger_t2', H + 'ranger-t2-body-fit-v1.glb', RT], ['ranger_t3', H + 'ranger-t3-body-fit-v1.glb', RT], ['ranger_fox', H + 'ranger-fox-body-fit-v1.glb', RT]],
  knight: [], barbarian: [], mage: [], rogue: [],
};
const AVATAR = { knight: 'knight_sakura', barbarian: 'barbarian_oni', mage: 'mage_astral', rogue: 'rogue_crow' };
for (const c of ['knight', 'barbarian', 'mage', 'rogue']) {
  for (const t of [1, 2, 3]) ROWS[c].push([`${c}_t${t}`, `${N}hero_${c}_t${t}.glb`, `${N}hero_${c}_t1.glb`]);
  ROWS[c].push([AVATAR[c], `${N}avatar_${AVATAR[c]}.glb`, `${N}hero_${c}_t1.glb`]);
}
const VIEWS = [{ name: 'face_front', yaw: 0, fov: 30 }, { name: 'face_34', yaw: 35, fov: 30 }, { name: 'full_front', yaw: 0, fov: 30, full: 1 }, { name: 'combat', yaw: 20, pitch: 55, fov: 30, full: 1 }];
mkdirSync(OUT + '/shots', { recursive: true });
const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
const br = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: GL_ARGS });
try {
  const pg = await br.newPage(); pg.on('pageerror', e => console.log('ERR', e.message));
  await pg.goto(`http://localhost:${PORT}/tools/art/face-audit/inspect.html`); await pg.waitForFunction(() => window.ready);
  for (const [group, rows] of Object.entries(ROWS)) {
    const tiles = [];
    for (const [id, url, clip] of rows) {
      if (!FILTER.test(id)) continue;
      const r = await pg.evaluate(([u, c, v]) => window.shoot(u, c, v), ['/' + url, clip ? '/' + clip : null, VIEWS]);
      for (const [j, v] of VIEWS.entries()) {
        const png = Buffer.from(r.out[v.name].split(',')[1], 'base64'); writeFileSync(`${OUT}/shots/${id}__${v.name}.png`, png);
        tiles.push({ input: await sharp(png).resize(256, 256).toBuffer(), left: j * 256, top: (tiles.length / 4 | 0) * 256 });
      }
      console.log(id, r.h.toFixed(2), r.clip);
    }
    if (tiles.length) await sharp({ create: { width: 1024, height: tiles.length / 4 * 256, channels: 3, background: '#000' } }).composite(tiles).png().toFile(`${OUT}/${group}_sheet.png`);
  }
} finally { await br.close(); srv.kill(); }
