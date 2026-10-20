// 기존 combat-mesh-qa는 그대로 두고 머리 장식의 절대 관통 깊이를 추가로 잰다.
// 머리·목 지배 정점 + 척추·어깨에 묶인 긴 뒷머리의 볼록 껍질은 빈 곳·망토 일부도 덮는 보수적 외피다.
// Idle을 빼지 않는다. 지팡이 정점·삼각형 중심·1cm 이하 간격 변 표본의 가장 깊은 점을 cm로 보고한다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { installProbe, openPage } from './combat-pose-qa.mjs';

export const MAGE_JOBS = [
  { id: 'hub-Cheer', phase: 'hub', kind: 'hub-clip', arg: 'Cheer', frame: 372 },
  { id: 'cheer', phase: 'battle', kind: 'clip', arg: 'Cheer', frame: 294 },
  { id: 'dodge', phase: 'battle', kind: 'dodge', frame: 16 },
  { id: 'attack1', phase: 'battle', kind: 'attack', arg: 0, frame: 9 },
  { id: 'attack2', phase: 'battle', kind: 'attack', arg: 1, frame: 9 },
  { id: 'attack4', phase: 'battle', kind: 'attack', arg: 3, frame: 9 },
  { id: 'skill0-fireball', phase: 'battle', kind: 'skill', arg: 0, frame: 9 },
  { id: 'skill2-blizzard', phase: 'battle', kind: 'skill', arg: 2, frame: 12 },
];

export async function installHeadProbe(page) {
  let hull = await fs.readFile('node_modules/three/examples/jsm/math/ConvexHull.js', 'utf8');
  hull = hull.replace(/import\s*\{[^}]*\}\s*from\s*'three';/, 'const { Line3, Plane, Triangle, Vector3 } = window.__THREE;').replace(/export\s*\{[^}]*\};?/, 'window.__ConvexHull = ConvexHull;');
  await page.evaluate('(() => {' + hull + '})()');
  await page.evaluate(installProbe);
  await page.evaluate(installMageHeadProbe);
}

export function installMageHeadProbe() {
  const q = window.__poseQA, T = window.__THREE, V = T.Vector3;
  const cache = new WeakMap(), samples = new WeakMap(), v = new V();
  function headInfo(body) {
    let ids = cache.get(body); if (ids) return ids;
    ids = []; const g = body.geometry, names = body.skeleton.bones.map(b => b.name.toLowerCase().replace(/mixamorig:?/, ''));
    for (let i = 0; i < g.attributes.position.count; i++) {
      let best = 0, weight = -1;
      for (let k = 0; k < 4; k++) if (g.attributes.skinWeight.getComponent(i, k) > weight) { weight = g.attributes.skinWeight.getComponent(i, k); best = g.attributes.skinIndex.getComponent(i, k); }
      // 긴 뒷머리는 자동 스키닝에서 척추·어깨에도 묶여 있다. 바인드 좌표의 뒤쪽 상체 외피를
      // 포함해 놓치지 않는다(망토 일부도 포함하므로 과대 가능). 팔·손·하체는 제외한다.
      const backHair = /spine|shoulder|hips/.test(names[best]) && g.attributes.position.getY(i) >= .72 && g.attributes.position.getZ(i) < -.10;
      if (/^(head|neck)/.test(names[best]) || backHair) ids.push(i);
    }
    cache.set(body, ids); return ids;
  }
  function weaponSamples(mesh) {
    let points = samples.get(mesh); if (points) return points;
    const g = mesh.geometry, p = g.attributes.position, index = g.index;
    const a = new V(), b = new V(), c = new V(), z = new V(), raw = [];
    const add = p => raw.push(p.x, p.y, p.z);
    for (let i = 0; i < p.count; i++) add(v.fromBufferAttribute(p, i));
    // 월드 배율이 바뀌어도 초기 배율에서 1cm 이하가 되도록 분할한다(보고서에 표본 수 기록).
    const scale = Math.max(...mesh.getWorldScale(new V()).toArray());
    for (let i = 0; i < (index?.count ?? p.count); i += 3) {
      a.fromBufferAttribute(p, index ? index.getX(i) : i); b.fromBufferAttribute(p, index ? index.getX(i + 1) : i + 1); c.fromBufferAttribute(p, index ? index.getX(i + 2) : i + 2);
      add(z.copy(a).add(b).add(c).multiplyScalar(1 / 3));
      for (const [from, to] of [[a, b], [b, c], [c, a]]) {
        const n = Math.ceil(from.distanceTo(to) * scale / .01);
        for (let j = 1; j < n; j++) add(z.copy(from).lerp(to, j / n));
      }
    }
    points = new Float32Array(raw); samples.set(mesh, points); return points;
  }
  q.headMeasure = (rig, fixedHull = null) => {
    q.refresh(rig.root); let body = null;
    rig.root.traverseVisible(o => { if (o.isSkinnedMesh && !body) body = o; });
    body.skeleton.update(); const ids = headInfo(body);
    const hull = fixedHull || new window.__ConvexHull().setFromPoints(ids.map(i => body.getVertexPosition(i, new V()).applyMatrix4(body.matrixWorld)));
    let max = 0, at = null, count = 0;
    for (const {mesh, kind} of rig.held) {
      if (kind !== 'weapon') continue;
      const pts = weaponSamples(mesh); count += pts.length / 3;
      for (let i = 0; i < pts.length; i += 3) {
        v.fromArray(pts, i).applyMatrix4(mesh.matrixWorld); let near = -Infinity;
        for (const face of hull.faces) { const d = face.normal.dot(v) - face.constant; if (d > near) near = d; if (near >= 0) break; }
        if (-near > max) { max = -near; at = v.toArray(); }
      }
    }
    return { cm: max * 100, world: at, headVertices: ids.length, weaponSamples: count, hull };
  };
  q.hook = {
    measure(rig, f) {
      const old = q.oldMeasure(rig), result = q.headMeasure(rig);
      q.headLast = { ...result, rig, frame: f }; delete q.headLast.hull;
      const owner = app.mode === 'battle' ? app.battle.player : app.showcase;
      const pose = owner.heroPose || owner.combatPose;
      if (f === 0) q.rotationStats = { maxDegrees: 0, maxStepDegrees: 0, previous: new Map() };
      if (pose) {
        const nodes = ['RightArm', 'RightForeArm', 'RightHand', 'RightShoulder'].map(n => rig.root.getObjectByName('mixamorig' + n));
        const corrected = nodes.map(n => n.quaternion.clone()); pose.suspend();
        for (let i = 0; i < nodes.length; i++) {
          const delta = nodes[i].quaternion.clone().invert().multiply(corrected[i]).normalize();
          const prior = q.rotationStats.previous.get(nodes[i].name) || new T.Quaternion();
          q.rotationStats.maxDegrees = Math.max(q.rotationStats.maxDegrees, delta.angleTo(new T.Quaternion()) * 180 / Math.PI);
          q.rotationStats.maxStepDegrees = Math.max(q.rotationStats.maxStepDegrees, delta.angleTo(prior) * 180 / Math.PI);
          q.rotationStats.previous.set(nodes[i].name, delta);
        }
        pose.resume();
      }
      if (q.recordHeadFrames) {
        const nodes = []; rig.root.traverse(o => { if (o.isBone) nodes.push(o); });
        for (let p = rig.root; p && p !== app.scene; p = p.parent) nodes.push(p);
        const owner = app.mode === 'battle' ? app.battle.player : app.showcase;
        const actions = [...new Set(Object.values(owner.clips))].map(clip => ({ clip, action: owner.mixer.existingAction(clip) })).filter(({action:a}) => a?.enabled && a.isScheduled() && a.getEffectiveWeight() > .001).map(({clip,action:a}) => ({ name: clip.name, time:a.time, duration:clip.duration, weight:a.getEffectiveWeight() }));
        q.recordHeadFrames.push({ rig, nodes, pose:nodes.map(o => [...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()]), f, actions, job:q.headJob, hull:result.hull });
      }
      return [...old, result.cm];
    },
    capture(rig) {
      const sc = app.scene, cam = app.renderer.camera, canvas = app.renderer.r.domElement;
      let top = rig.root; while (top.parent && top.parent !== sc) top = top.parent;
      const hidden = []; for (const c of sc.children) if (c !== top && !c.isLight && c.visible) { hidden.push(c); c.visible = false; }
      // 동일한 장면 좌표의 정면·오른쪽·후면. 팔 교정으로 카메라 축이 변하지 않는다.
      const up = new V(0, 1, 0), rotation = rig.root.getWorldQuaternion(new T.Quaternion());
      const front = new V(0, 0, 1).applyQuaternion(rotation), right = new V(1, 0, 0).applyQuaternion(rotation);
      const focus = rig.bones.hips.getWorldPosition(new V()).addScaledVector(up, .6);
      const saved = {p:cam.position.clone(),q:cam.quaternion.clone()}, mats = [];
      // 발광 때문에 겹침이 가려지지 않도록 원본 색/텍스처를 그대로 쓰는 무조명 진단 캡처.
      rig.root.traverseVisible(o => { if (!o.isMesh || Array.isArray(o.material)) return; mats.push([o,o.material]); o.material = new T.MeshBasicMaterial({map:o.material.map,color:o.material.color,vertexColors:o.material.vertexColors,side:T.DoubleSide}); });
      const out = document.createElement('canvas'); out.width = 1800; out.height = 600; const ctx = out.getContext('2d');
      for (const [i, dir] of [front, right, front.clone().negate()].entries()) {
        cam.position.copy(focus).addScaledVector(dir, 2.9).addScaledVector(up,.25); cam.lookAt(focus); cam.updateMatrixWorld(true); app.renderer.render();
        const side = canvas.height; ctx.drawImage(canvas,(canvas.width-side)/2,0,side,side,i*600,0,600,600);
      }
      cam.position.copy(saved.p); cam.quaternion.copy(saved.q); cam.updateMatrixWorld(true);
      for(const [o,m] of mats) {o.material.dispose();o.material=m;} for(const c of hidden)c.visible=true;
      return out.toDataURL('image/png');
    },
  };
}

export async function runMageHead(origin, out, baseline = null) {
  await fs.mkdir(path.join(out,'captures'), {recursive:true});
  const browser = await chromium.launch({args:['--use-angle=d3d11','--ignore-gpu-blocklist']});
  const report = {origin,source:{head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirtyFiles:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim().split('\n').filter(Boolean),correctionsSha256:createHash('sha256').update(await fs.readFile('src/data/combat-pose-v1.json')).digest('hex')},method:'머리·목 지배 스킨 정점 + 바인드 y>=0.72,z<-0.10인 척추·어깨·골반 정점(긴 뒷머리, 망토 일부 포함)의 볼록 껍질 절대 깊이. Idle 차감 없음. 지팡이 변 1cm 표본 + 정점·면 중심; cm. 외피의 빈 공간을 포함한 보수적 상한이며 실제 표면의 정확한 깊이와 구분. 격리 Chromium 1280×720, 실기기 아님.',thresholdCm:1.5,rows:[],errors:[]};
  try {
    const {page} = await openPage(browser, origin); page.on('pageerror',e=>report.errors.push(e.message));
    await page.evaluate(async()=>{app.eco.s.selected='mage';await app.showcaseHero('mage',true);});
    await installHeadProbe(page); await page.evaluate(()=>__poseQA.calibrate('mage'));
    for(const job of MAGE_JOBS) {
      if(job.id==='cheer') {await page.evaluate(()=>__poseQA.startBattle('mage'));await page.waitForFunction(()=>app.battle?.active&&app.battle.player&&app.input.enabled);await page.evaluate(()=>__poseQA.freeze());}
      const res = await page.evaluate(j=>__poseQA[j.phase](j.kind,j.arg),job);
      const rotation = await page.evaluate(()=>({maxDegrees:__poseQA.rotationStats.maxDegrees,maxStepDegrees:__poseQA.rotationStats.maxStepDegrees}));
      if(!res.samples.length)throw new Error('측정 표본 없음: '+job.id);
      const worst = res.samples.reduce((a,b)=>b[9]>a[9]?b:a), representative=res.samples.find(s=>s[0]===job.frame);
      const row={...job,anim:res.anim,dur:res.dur,hitAt:res.hitAt,castAt:res.castAt,maxCm:worst[9],worstFrame:worst[0],representativeCm:representative?.[9],handCm:Math.max(...res.samples.map(s=>s[2])),rotation,frames:res.samples,pass:worst[9]<=1.5&&Number.isFinite(representative?.[9]),captures:[]};
      const before = baseline?.rows.find(r=>r.id===job.id);
      for(const frame of new Set([job.frame,worst[0],...(before ? [before.worstFrame] : [])])) {
        const again=await page.evaluate(({job,frame})=>__poseQA[job.phase](job.kind,job.arg,{stopAt:frame}),{job,frame});
        if(again.image){const file=`captures/${job.id}-${frame}.png`;await fs.writeFile(path.join(out,file),Buffer.from(again.image.split(',')[1],'base64'));row.captures.push(file);}
      }
      report.rows.push(row);console.log(JSON.stringify({id:row.id,maxCm:row.maxCm,representativeCm:row.representativeCm,worstFrame:row.worstFrame,pass:row.pass}));
    }
  } finally {await browser.close();}
  report.pass=!report.errors.length&&report.rows.length===8&&report.rows.every(r=>r.pass);
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const baseline=process.argv[4]?JSON.parse(await fs.readFile(process.argv[4],'utf8')):null;const r=await runMageHead(process.argv[2]||'http://127.0.0.1:5311',path.resolve(process.argv[3]||'work/mage-overlap/head'),baseline);if(!r.pass)process.exitCode=1;}
