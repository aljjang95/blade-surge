// 로비 무기의 월드 경계·주축과 팔 높이를 한 Idle 주기의 고정 시점에서 측정한다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { installAutoStarter } from './qa-starter.mjs';

export async function measureLobby({ samples = 12, corrected = true } = {}) {
  if (!Number.isInteger(samples) || samples < 8 || samples > 240) throw new Error('표본 수는 8~240의 정수여야 한다');
  const T = await import('/node_modules/three/build/three.module.js');
  const { LOOKS } = await import('/src/game/look.js');
  const s = window.app.showcase, root = s.root;
  const names = new Set([...(LOOKS[s.def.id]?.weaponNodes || []), ...(LOOKS[s.def.id]?.armorNodes || [])]);
  const bones = []; root.traverse(o => { if (o.isBone) bones.push(o); });
  const bone = name => bones.find(b => b.name.toLowerCase().replace(/mixamorig:?/, '') === name.toLowerCase());
  const head = bone('Head');
  if (!head) throw new Error('머리 뼈 없음: ' + s.def.id);
  const meshes = [];
  root.traverseVisible(o => {
    if (!o.isMesh) return;
    let weapon = false, hand = false;
    for (let p = o; p && p !== root; p = p.parent) {
      if (names.has(p.name) || p.userData.armoryItem) weapon = true;
      if (/hand|wrist/i.test(p.name) && p.isBone) hand = true;
    }
    if (weapon || (hand && !o.isSkinnedMesh)) meshes.push(o);
  });
  if (!meshes.length) throw new Error('보이는 무기 없음: ' + s.def.id);
  const positions = name => { const b = bone(name); if (!b) throw new Error('뼈 없음: ' + name); return b.getWorldPosition(new T.Vector3()).toArray(); };
  s.pose?.restore(); s.mixer.stopAllAction(); s.mixer.clipAction(s.clips.Idle).reset().play();
  const frames = [];
  for (let i = 0; i < samples; i++) {
    s.pose?.restore(); s.mixer.setTime(s.clips.Idle.duration * i / samples);
    if (corrected) s.pose?.apply();
    root.updateMatrixWorld(true);
    const center = head.getWorldPosition(new T.Vector3());
    const radius = .35 * Math.max(...root.getWorldScale(new T.Vector3()).toArray());
    const sphere = new T.Sphere(center, radius);
    const weapons = meshes.map(mesh => {
      mesh.skeleton?.update();
      const pts = [], box = new T.Box3();
      for (let v = 0; v < mesh.geometry.attributes.position.count; v++) {
        const p = mesh.getVertexPosition(v, new T.Vector3()); pts.push(p); box.expandByPoint(p.clone().applyMatrix4(mesh.matrixWorld));
      }
      // 주성분 축: 메시의 로컬 축 이름이나 장착 소켓 회전에 의존하지 않는다.
      const mean = new T.Vector3(); for (const p of pts) mean.add(p); mean.divideScalar(pts.length);
      const c = Array(9).fill(0); for (const p of pts) { const d = p.clone().sub(mean).toArray(); for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) c[a * 3 + b] += d[a] * d[b]; }
      let axis = new T.Vector3(1, 1, 1).normalize();
      for (let k = 0; k < 40; k++) axis.set(c[0]*axis.x+c[1]*axis.y+c[2]*axis.z, c[3]*axis.x+c[4]*axis.y+c[5]*axis.z, c[6]*axis.x+c[7]*axis.y+c[8]*axis.z).normalize();
      axis.transformDirection(mesh.matrixWorld);
      return { name: mesh.name, box: { min: box.min.toArray(), max: box.max.toArray() }, headOverlap: box.intersectsSphere(sphere), headClearance: box.distanceToPoint(center) - radius, tiltDeg: T.MathUtils.radToDeg(Math.acos(Math.min(1, Math.abs(axis.y)))), axis: axis.toArray() };
    });
    const hands = { left: positions('LeftHand'), right: positions('RightHand') }, shoulders = { left: positions('LeftArm'), right: positions('RightArm') };
    frames.push({ time: s.clips.Idle.duration * i / samples, head: center.toArray(), radius, weapons, hands, shoulders, handHeightDiff: Math.abs(hands.left[1] - hands.right[1]), shoulderHeightDiff: Math.abs(shoulders.left[1] - shoulders.right[1]) });
  }
  return { hero: s.def.id, model: s.def.model, corrected, duration: s.clips.Idle.duration, frames, summary: { headOverlapCount: frames.reduce((n, f) => n + f.weapons.filter(w => w.headOverlap).length, 0), maxTiltDeg: Math.max(...frames.flatMap(f => f.weapons.map(w => w.tiltDeg))), maxHandHeightDiff: Math.max(...frames.map(f => f.handHeightDiff)), maxShoulderHeightDiff: Math.max(...frames.map(f => f.shoulderHeightDiff)) } };
}

export async function openLobby(origin, reducedMotion = 'reduce') {
  const browser = await chromium.launch({ args: ['--use-angle=d3d11'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 590 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block', reducedMotion });
  const page = await context.newPage();
  await installAutoStarter(page); // 빈 저장 부팅 시 시작 영웅 선택 화면 자동 통과
  await page.goto(origin + '/');
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 120000 }); await page.click('#boot-start');
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot').classList.contains('show') && app.showcase, null, { timeout: 120000 });
  await page.evaluate(() => app.ui.closeModal?.());
  return { browser, page };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [origin = 'http://127.0.0.1:5189', outArg = 'C:/Users/heart/AppData/Local/APEX/gogo/aljjang95-blade-surge/cycles/20261018-hero-pose-audit/weapon-clip', list = 'knight,barbarian,mage,rogue,ranger', mode = 'after', count = '12'] = process.argv.slice(2);
  const samples = Number(count);
  const out = path.resolve(outArg); await fs.mkdir(out, { recursive: true });
  const { browser, page } = await openLobby(origin); const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    const rows = [];
    for (const id of list.split(',')) {
      await page.evaluate(async id => { app.eco.s.selected = id; await app.showcaseHero(id, true); }, id);
      rows.push(await page.evaluate(measureLobby, { corrected: mode !== 'before', samples }));
    }
    const mage = rows.find(r => r.hero === 'mage');
    const acceptance = {
      A1: mage ? mage.summary.headOverlapCount === 0 && mage.summary.maxTiltDeg <= 25 : null,
      A2: mage ? mage.summary.maxHandHeightDiff <= .25 && mage.summary.maxShoulderHeightDiff <= .03 : null,
      A3: rows.every(r => r.summary.headOverlapCount === 0),
    };
    const source = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), hashes: {} };
    for (const file of ['src/main.js', 'src/engine/lobby-pose.js', 'tools/lobby-weapon-clip-qa.mjs']) {
      source.hashes[file] = createHash('sha256').update(await fs.readFile(file)).digest('hex');
    }
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({ origin, viewport: '1280x590', samples, mode, source, acceptance, rows, errors }, null, 2));
    console.log(JSON.stringify(rows.map(r => ({ hero: r.hero, ...r.summary }))));
    if (mode !== 'before' && Object.values(acceptance).includes(false)) throw new Error('로비 자세 수용 기준 실패: ' + JSON.stringify(acceptance));
    if (errors.length) throw new Error(errors.join('\n'));
  } finally { await browser.close(); }
}
