/**
 * 몸 교체 후보의 클립 자세 시트 — 같은 재질 마감으로 클립마다 진행 25·50·75% 자세를 전신 3/4 로 찍어 나란히 둔다.
 * 장식(땋은 머리·망토·모자·머리카락)이 팔을 따라 끌려가거나 몸 안으로 말려 드는지 눈으로 보는 용도. 실기기·GPU 증거가 아니다.
 *   POSE_ROWS='[["id","GLB","클립 GLB"]]' node tools/art/face-audit/poses.mjs <출력폴더> [클립,…]
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { CHROME, GL_ARGS } from '../../chrome.mjs';

const OUT = process.argv[2] || 'work/qa/poses', ROWS = JSON.parse(process.env.POSE_ROWS || '[]');
const CLIPS = (process.argv[3] || 'idle,run,dodge,hit,death,cheer,cast_shoot,cast_raise').split(',');
const VIEW = [{ name: 'p', yaw: 35, fov: 30, full: 1 }], T = 200, PORT = 4412;
mkdirSync(OUT, { recursive: true });
const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
const br = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: GL_ARGS });
try {
  const pg = await br.newPage(); pg.on('pageerror', e => console.log('ERR', e.message));
  await pg.goto(`http://localhost:${PORT}/tools/art/face-audit/inspect.html`); await pg.waitForFunction(() => window.ready);
  for (const [id, url, clip] of ROWS) {
    const tiles = [];
    for (const [ci, name] of CLIPS.entries()) for (const [k, f] of [.25, .5, .75].entries()) {
      const r = await pg.evaluate(([u, c, v, n, t]) => window.shoot(u, c, v, n, t), ['/' + url, '/' + clip, VIEW, name, -f]);
      tiles.push({ input: await sharp(Buffer.from(r.out.p.split(',')[1], 'base64')).resize(T, T).toBuffer(), left: k * T, top: ci * T, clip: r.clip });
    }
    await sharp({ create: { width: 3 * T, height: CLIPS.length * T, channels: 3, background: '#000' } }).composite(tiles.map(({ input, left, top }) => ({ input, left, top }))).png().toFile(`${OUT}/${id}_poses.png`);
    console.log(id, tiles.filter((t, i) => i % 3 === 0).map((t) => t.clip).join(','));
  }
} finally { await br.close(); srv.kill(); }
