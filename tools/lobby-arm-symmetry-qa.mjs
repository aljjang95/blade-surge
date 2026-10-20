// 로비 영웅의 좌우 팔 대칭을 영웅 자신의 좌표계(뿌리 기준)에서 Idle 한 주기 동안 잰다.
// 정식 빌드에서도 돌도록 개발 서버 전용 import 없이 게임 상태(app.showcase)만 쓴다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openLobby } from './lobby-weapon-clip-qa.mjs';

export async function measureArms({ samples = 24, corrected = true } = {}) {
  const s = window.app.showcase, root = s.root;
  const V = app.renderer.camera.position.constructor;
  const bones = []; root.traverse(o => { if (o.isBone) bones.push(o); });
  const bone = n => { const b = bones.find(x => x.name.toLowerCase().replace(/mixamorig:?/, '') === n.toLowerCase()); if (!b) throw new Error('뼈 없음: ' + n); return b; };
  const names = ['Hips', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand'];
  const B = Object.fromEntries(names.map(n => [n, bone(n)]));
  const scale = root.getWorldScale(new V()).y;
  s.pose?.restore(); s.mixer.stopAllAction(); s.mixer.clipAction(s.clips.Idle).reset().play();
  const frames = [];
  for (let i = 0; i < samples; i++) {
    s.pose?.restore(); s.mixer.setTime(s.clips.Idle.duration * i / samples);
    if (corrected) s.pose?.apply();
    root.updateMatrixWorld(true);
    // 뿌리 로컬 좌표(미터, 모델 배율 제거): x 좌우, y 위, z 앞
    const inv = root.matrixWorld.clone().invert();
    const P = {}; for (const n of names) P[n] = B[n].getWorldPosition(new V()).applyMatrix4(inv).multiplyScalar(scale);
    // 몸통 축: 엉덩이→목. 팔 관절의 몸통 축까지 수평 거리와 높이를 좌우 비교한다.
    const ax = P.Neck.clone().sub(P.Hips).normalize();
    const off = p => { const d = p.clone().sub(P.Hips); const along = d.dot(ax); return { lateral: d.clone().sub(ax.clone().multiplyScalar(along)).length(), height: along }; };
    const side = k => ({ shoulder: off(P[k + 'Arm']), elbow: off(P[k + 'ForeArm']), hand: off(P[k + 'Hand']) });
    const L = side('Left'), R = side('Right');
    frames.push({
      t: +(s.clips.Idle.duration * i / samples).toFixed(3),
      shoulderHeightDiff: Math.abs(L.shoulder.height - R.shoulder.height),
      elbowLateralDiff: Math.abs(L.elbow.lateral - R.elbow.lateral),
      elbowHeightDiff: Math.abs(L.elbow.height - R.elbow.height),
      handHeightDiff: Math.abs(L.hand.height - R.hand.height),
      L, R,
    });
  }
  const max = k => Math.max(...frames.map(f => f[k]));
  return { hero: s.def.id, corrected, samples, summary: { shoulderHeightDiff: max('shoulderHeightDiff'), elbowLateralDiff: max('elbowLateralDiff'), elbowHeightDiff: max('elbowHeightDiff'), handHeightDiff: max('handHeightDiff') }, frames };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [origin = 'http://127.0.0.1:5189', outArg = 'work/qa-arm-symmetry', list = 'knight,barbarian,mage,rogue,ranger', mode = 'after', count = '24'] = process.argv.slice(2);
  const out = path.resolve(outArg); await fs.mkdir(out, { recursive: true });
  const { browser, page } = await openLobby(origin); const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    const rows = [];
    for (const id of list.split(',')) {
      await page.evaluate(async id => { app.eco.s.selected = id; await app.showcaseHero(id, true); }, id);
      rows.push(await page.evaluate(measureArms, { corrected: mode !== 'before', samples: Number(count) }));
    }
    await fs.writeFile(path.join(out, 'arms-' + mode + '.json'), JSON.stringify({ origin, mode, rows, errors }, null, 2));
    console.log(JSON.stringify(rows.map(r => ({ hero: r.hero, ...Object.fromEntries(Object.entries(r.summary).map(([k, v]) => [k, +v.toFixed(3)])) }))));
    if (errors.length) throw new Error(errors.join('\n'));
  } finally { await browser.close(); }
}

