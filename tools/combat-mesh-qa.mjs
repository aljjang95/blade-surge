// 전투·마을 자세의 실제 메시 관통 감사: combat-pose-qa.mjs의 재생기(실제 게임 루프, app.step 1/60초)를 그대로 쓰고,
// 근사 도형(머리 구·몸통 원기둥) 대신 영웅 스킨 메시의 월드 정점으로 직접 잰다. 정식 빌드(vite build + 정적 서버)에서 돈다.
// 개발 서버 전용 import를 쓰지 않고 window.app / window.__THREE / window.__LOOKS(읽기 전용)만 읽는다.
//
// 방법: 영웅 몸 스킨 메시의 월드 정점(SkinnedMesh.getVertexPosition)을 지배 뼈별로 모아 몸 부위(몸통 본체·머리·위팔·아래팔·허벅지·정강이)마다
// 그 정점들의 볼록 껍질(three ConvexHull, 매 표본 새로 계산)을 만든다. 껍질은 원기둥·구와 달리 실제 정점에 붙어 있다.
// 몸 메시는 망토·치마·어깨갑옷 같은 얇은 판이 섞인 열린 조각 모음이라 법선 부호·광선 홀짝 판정이 속았다(측정 도구 개발 기록 참조). 껍질은 속이 찬 입체라 안쪽 판정이 안정적이다.
// 깊이 = 껍질 면까지의 최소 거리(점이 껍질 안쪽일 때). 껍질이 오목한 곳(허리)에서는 실제보다 크게 나올 수 있으므로 기준선 보정을 둔다.
// 사용: node tools/combat-mesh-qa.mjs [origin] [outDir] [heroes] [jobFilter]
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { installProbe, openPage, summarizeSamples, HEROES, THRESHOLDS as OLD_THRESHOLDS } from './combat-pose-qa.mjs';

// 판정 기준(측정 전에 고정, 느슨하게 바꾸지 않는다). 단위 cm.
export const CRITERIA = Object.freeze({
  weapon: '무기 메시(look.js weaponNodes, 손에 든 것)의 정점 중, 영웅 몸·머리 스킨 메시 부위 껍질(몸통 본체·머리·위팔·아래팔·허벅지·정강이) 안쪽으로 3cm 이상 들어간 정점이 하나라도 있으면 결함. 손·손가락은 쥠이므로 부위에서 뺀다. 깊이는 같은 정점의 대기 자세(Idle) 최대 깊이를 뺀 초과분이다.',
  offhand: '보조장비(방패·마법책, look.js armorNodes)도 같은 규칙. 무기와 따로 집계한다.',
  armTorso: '팔(위팔·아래팔 뼈에 묶인 스킨 정점)이 몸통 본체 껍질 안쪽으로 3cm 이상 들어가면 결함.',
  scope: '몸통 본체 = 몸통 뼈(hips·spine·shoulder)에 묶인 정점 중 망토·어깨갑옷·옆 장식(몸통 중심선에서 좌우 1.25a, 앞 1.15b, 뒤 0.9b 밖. a·b는 척추 정점 중앙값으로 잰 몸통 반폭·반두께)을 뺀 것. 의복 관통은 이 기준에 넣지 않는다.',
  baseline: '볼록 껍질은 오목한 곳(허리·다리 사이·치마 아래)에서 실제보다 크게 나오므로 대기 자세(Idle) 25프레임에서 이미 있던 겹침(껍질 과대, 어깨 이음매, 손잡이·방패끈)은 정점별·부위별 최대 깊이로 기록해 두고 판정에서 뺀다. 이렇게 가려지는 대기 자세의 절대 깊이는 report.json의 idleRaw에 따로 남기고 캡처로 확인한다.',
  weaponCm: 3,
  armTorsoCm: 3,
  stride: '한 동작이 90프레임을 넘으면 3프레임마다 표본(환호·상호작용 같은 긴 클립), 그 외는 매 프레임.',
});

/** three 예제의 ConvexHull을 페이지에 심는다(모듈 import를 전역 THREE 참조로 바꿔 평가). 개발 서버가 아니라 node_modules 파일을 직접 읽는다. */
async function hullSource() {
  const file = path.resolve('node_modules/three/examples/jsm/math/ConvexHull.js');
  let s = await fs.readFile(file, 'utf8');
  s = s.replace(/import\s*\{[^}]*\}\s*from\s*'three';/, 'const { Line3, Plane, Triangle, Vector3 } = window.__THREE;').replace(/export\s*\{[^}]*\};?/, 'window.__ConvexHull = ConvexHull;');
  return '(() => {' + s + '})()';
}

/** 브라우저 안에 메시 측정·캡처 훅을 설치한다. installProbe 뒤에 호출하며 직렬화되므로 바깥 변수를 쓰지 않는다. */
export function installMeshProbe(cfg) {
  const q = window.__poseQA, T = window.__THREE, V = T.Vector3, Hull = window.__ConvexHull;
  const low = s => s.toLowerCase().replace(/mixamorig:?/, '');
  const r1 = x => Math.round(x * 10) / 10;
  // 부위: torso(몸통 본체), head, arm(위팔·아래팔), leg(허벅지·정강이). 손·발·손가락은 쥠/접지라 뺀다.
  const partOf = n => /hand|foot|toe/.test(n) ? null : /^(head|neck)/.test(n) ? 'head' : /leg/.test(n) ? n : /shoulder/.test(n) || /hips|spine/.test(n) ? 'torso' : /arm/.test(n) ? n : null;
  const regionOf = p => p === 'torso' ? 0 : p === 'head' ? 1 : /arm/.test(p) ? 2 : 3;
  const REGN = ['torso', 'head', 'arm', 'leg'];
  const heldBase = new WeakMap(), cache = new WeakMap(), idleRaw = { weapon: [0, 0, 0, 0], offhand: [0, 0, 0, 0], armTorso: 0 };
  q.idleRaw = (reset) => { const out = JSON.parse(JSON.stringify(idleRaw)); if (reset) { idleRaw.weapon = [0, 0, 0, 0]; idleRaw.offhand = [0, 0, 0, 0]; idleRaw.armTorso = 0; } return out; };

  function meshInfo(mesh) {
    let c = cache.get(mesh); if (c) return c;
    const g = mesh.geometry, n = g.attributes.position.count, idx = g.attributes.skinIndex, wt = g.attributes.skinWeight;
    const names = mesh.skeleton.bones.map(b => low(b.name)), vPart = new Array(n), vBone = new Int16Array(n);
    for (let v = 0; v < n; v++) {
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++) if (wt.getComponent(v, k) > bw) { bw = wt.getComponent(v, k); best = idx.getComponent(v, k); }
      vBone[v] = best; vPart[v] = partOf(names[best]);
    }
    const armVerts = []; for (let v = 0; v < n; v++) if (vPart[v] && /arm/.test(vPart[v])) armVerts.push(v);
    c = { names, vPart, vBone, armVerts, n, wp: new Float64Array(n * 3), garment: null };
    cache.set(mesh, c); return c;
  }
  const tmp = new V(), tmp2 = new V(), hp = new V();
  // 점이 껍질 안이면 가장 가까운 면까지 거리(양수 깊이), 밖이면 0.
  function depthIn(hull, x, y, z) {
    hp.set(x, y, z); let m = -Infinity;
    for (const f of hull.faces) { const dd = f.normal.x * x + f.normal.y * y + f.normal.z * z - f.constant; if (dd > m) { m = dd; if (m >= 0) return 0; } }
    return -m;
  }
  function boxOf(pts) { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (const p of pts) for (let a = 0; a < 3; a++) { if (p.getComponent(a) < mn[a]) mn[a] = p.getComponent(a); if (p.getComponent(a) > mx[a]) mx[a] = p.getComponent(a); } return { mn, mx }; }

  q.meshUnknown = root => { let m = null; root.traverse(o => { if (o.isSkinnedMesh && !m) m = o; }); if (!m) return []; const i = meshInfo(m), u = new Set(); i.names.forEach(nm => { if (!partOf(nm) && !/hand|foot|toe|index|thumb|middle|ring|pinky|end|top|eye|jaw|tail/.test(nm) && !/^(armature|root)/.test(nm)) u.add(nm); }); return [...u]; };
  const JN = ['hips', 'neck', 'leftarm', 'rightarm'];
  q.hook = {
    mode: 'run',
    measure(rig, f) {
      if (f > 90 && f % 3 !== 0 && this.mode !== 'base') return null;
      const old = q.oldMeasure(rig); // 근사 도형 값(참고)과 world matrix 갱신
      const root = rig.root; let body = null; root.traverseVisible(o => { if (o.isSkinnedMesh && !body) body = o; });
      body.skeleton.update();
      const info = meshInfo(body), wp = info.wp, n = info.n;
      for (let v = 0; v < n; v++) { body.getVertexPosition(v, tmp).applyMatrix4(body.matrixWorld); wp[v * 3] = tmp.x; wp[v * 3 + 1] = tmp.y; wp[v * 3 + 2] = tmp.z; }
      const P = {}; for (const j of JN) P[j] = rig.bones[j].getWorldPosition(new V());
      const ax = P.neck.clone().sub(P.hips).normalize(), right = P.rightarm.clone().sub(P.leftarm); right.addScaledVector(ax, -right.dot(ax)).normalize();
      const front = new V().crossVectors(ax, right).normalize();
      const frame = (x, y, z) => { tmp2.set(x, y, z).sub(P.hips); return [r1(tmp2.dot(ax) * 100), r1(tmp2.dot(right) * 100), r1(tmp2.dot(front) * 100)]; };
      const dirFrame = (x, y, z) => { tmp2.set(x, y, z); return [r1(tmp2.dot(ax) * 100), r1(tmp2.dot(right) * 100), r1(tmp2.dot(front) * 100)]; };
      q.lastBasis = { ax: ax.toArray(), right: right.toArray(), front: front.toArray(), hips: P.hips.toArray() };
      // 의복 분리: 처음 부른 기준선(Idle) 프레임에서 한 번만 정한다.
      if (!info.garment) {
        const env = q.envs[rig.heroId] || { a: 0.18, b: 0.18 }, k = q.scaleOf(rig.root), gm = new Uint8Array(n), cv = new V(), Lax = P.neck.distanceTo(P.hips); let gc = 0;
        for (let v = 0; v < n; v++) {
          if (info.vPart[v] !== 'torso') continue;
          cv.set(wp[v * 3], wp[v * 3 + 1], wp[v * 3 + 2]).sub(P.hips); const x = cv.dot(right), z = cv.dot(front), u = cv.dot(ax);
          if (Math.abs(x) > 1.25 * env.a * k || z > 1.15 * env.b * k || z < -0.9 * env.b * k || u < -0.12 * Lax || u > 1.1 * Lax) { gm[v] = 1; gc++; }
        }
        info.garment = gm; info.garmentVerts = gc;
      }
      // 부위별 볼록 껍질
      const groups = {};
      for (let v = 0; v < n; v++) { const p = info.vPart[v]; if (!p || (p === 'torso' && info.garment[v])) continue; (groups[p] ||= []).push(new V(wp[v * 3], wp[v * 3 + 1], wp[v * 3 + 2])); }
      const hulls = [];
      for (const [name, pts0] of Object.entries(groups)) {
        let pts = pts0;
        if (name === 'head' && pts.length > 30) {
          // 두개골: 후드 끝·뿔·머리묶음 같은 돌출 정점을 빼려고 중심에서 75분위 거리 안의 정점만 쓴다.
          const c = new V(); for (const p of pts) c.add(p); c.divideScalar(pts.length);
          const ds = pts.map(p => p.distanceTo(c)), sorted = [...ds].sort((x, y) => x - y), lim = sorted[Math.floor(sorted.length * 0.75)];
          pts = pts.filter((p, i) => ds[i] <= lim);
        }
        if (pts.length < 8) continue;
        const hull = new Hull().setFromPoints(pts); if (!hull.faces.length) continue;
        hulls.push({ name, region: regionOf(name), hull, box: boxOf(pts) });
      }
      const torso = hulls.find(h => h.name === 'torso');
      q.lastHulls = hulls;
      const base = this.mode === 'base';
      const slots = { weapon: [0, 0, 0, 0], offhand: [0, 0, 0, 0] }, worst = { weapon: { excess: 0 }, offhand: { excess: 0 } };
      // 1) 무기·보조장비 정점 -> 부위 껍질 안쪽 깊이
      for (const { mesh, kind } of rig.held) {
        const pos = mesh.geometry.attributes.position, me = mesh.matrixWorld;
        let bs = heldBase.get(mesh); if (!bs) { bs = new Float32Array(pos.count * 4); heldBase.set(mesh, bs); }
        for (let i = 0; i < pos.count; i++) {
          tmp.fromBufferAttribute(pos, i).applyMatrix4(me);
          const x = tmp.x, y = tmp.y, z = tmp.z;
          // 부위 영역(몸통·머리·팔·다리)별 최대 깊이. 판정 값은 같은 정점의 대기 자세 대비 초과 깊이이고, 절대 깊이(대기 자세 기록)는 idleRaw로 따로 보고한다.
          const dr = [0, 0, 0, 0], hr = [null, null, null, null];
          for (const h of hulls) {
            if (x < h.box.mn[0] || x > h.box.mx[0] || y < h.box.mn[1] || y > h.box.mx[1] || z < h.box.mn[2] || z > h.box.mx[2]) continue;
            const d1 = depthIn(h.hull, x, y, z) * 100; if (d1 > dr[h.region]) { dr[h.region] = d1; hr[h.region] = h; }
          }
          if (base) { for (let rg = 0; rg < 4; rg++) { if (dr[rg] > bs[i * 4 + rg]) bs[i * 4 + rg] = dr[rg]; if (dr[rg] > idleRaw[kind][rg]) idleRaw[kind][rg] = dr[rg]; } continue; }
          for (let rg = 0; rg < 4; rg++) {
            const val = dr[rg] - bs[i * 4 + rg];
            if (val <= 0.5) continue;
            if (val > slots[kind][rg]) slots[kind][rg] = val;
            const wk = worst[kind]; if (val > wk.excess) Object.assign(wk, { excess: val, depth: dr[rg], base: bs[i * 4 + rg], region: REGN[rg], part: hr[rg].name, kind, mesh: (mesh.parent?.name || '') + '/' + mesh.name, world: [x, y, z], at: frame(x, y, z) });
          }
        }
      }
      // 2) 팔 정점 -> 몸통 본체 껍질 안쪽 깊이
      let aRaw = 0, aEx = 0; const worstA = { excess: 0 };
      if (!info.armBase) info.armBase = new Float32Array(n);
      if (torso) for (const v of info.armVerts) {
        const x = wp[v * 3], y = wp[v * 3 + 1], z = wp[v * 3 + 2];
        if (x < torso.box.mn[0] || x > torso.box.mx[0] || y < torso.box.mn[1] || y > torso.box.mx[1] || z < torso.box.mn[2] || z > torso.box.mx[2]) continue;
        const dep = depthIn(torso.hull, x, y, z) * 100; if (dep <= 0) continue;
        if (base) { if (dep > info.armBase[v]) info.armBase[v] = dep; if (dep > idleRaw.armTorso) idleRaw.armTorso = dep; continue; }
        const ex = dep - info.armBase[v];
        if (ex > aEx) { aEx = ex; aRaw = dep; Object.assign(worstA, { excess: ex, depth: dep, base: info.armBase[v], part: info.vPart[v], bone: info.names[info.vBone[v]], region: 'arm→torso', world: [x, y, z], at: frame(x, y, z) }); }
      }
      const pick = [worst.weapon, worst.offhand, worstA].sort((p, q2) => q2.excess - p.excess)[0];
      q.lastDetail = { weapon: worst.weapon.excess > 0 ? worst.weapon : null, offhand: worst.offhand.excess > 0 ? worst.offhand : null, arm: worstA.excess > 0 ? worstA : null, pick: pick.excess > 0 ? pick : null, hips: frame(P.hips.x, P.hips.y, P.hips.z), garmentVerts: info.garmentVerts, parts: hulls.map(h => h.name) };
      const W = slots.weapon, O = slots.offhand;
      return [...old, r1(W[0]), r1(W[1]), r1(W[2]), r1(W[3]), r1(O[0]), r1(O[1]), r1(O[2]), r1(O[3]), r1(aRaw), r1(aEx)];
    },
    // 캡처: 효과·지형을 숨기고 오버레이 없이 정면·측면(가장 깊은 점이 있는 쪽)·후면 세 시점을 한 장에 그린다.
    capture(rig) {
      const sc = app.scene, cam = app.renderer.camera, canvas = app.renderer.r.domElement, B = q.lastBasis, dt = q.lastDetail;
      let top = rig.root; while (top.parent && top.parent !== sc) top = top.parent;
      const hidden = []; for (const c of sc.children) if (c !== top && !c.isLight && c.visible) { c.visible = false; hidden.push(c); }
      const front = new V().fromArray(B.front), right = new V().fromArray(B.right), up = new V().fromArray(B.ax);
      // 시점 중심: 몸 가운데(엉덩이 위 45cm)와 가장 깊은 점의 중간. 영웅 전체와 결함 점이 한 화면에 들어오도록 거리는 cfg.distance.
      const hit = dt.pick || null;
      const bodyMid = new V().fromArray(B.hips).addScaledVector(up, 0.45);
      const focus = hit ? bodyMid.clone().lerp(new V().fromArray(hit.world), 0.5) : bodyMid;
      const sideSign = ((hit?.at || [0, 1, 0])[1]) >= 0 ? 1 : -1;
      const dist = cfg.distance, saved = { p: cam.position.clone(), q: cam.quaternion.clone() };
      const out = document.createElement('canvas'); out.width = 1536; out.height = 512; const ctx = out.getContext('2d');
      // 진단용 오버레이(this.overlay): 부위 껍질 와이어와 가장 깊은 점. A2 제출 캡처는 오버레이 없이 찍는다.
      const extra = [];
      if (this.overlay && q.lastHulls) {
        for (const h of q.lastHulls) {
          const pts = []; for (const f of h.hull.faces) { let e = f.edge; do { pts.push(e.tail().point.clone(), e.head().point.clone()); e = e.next; } while (e !== f.edge); }
          const m = new T.LineSegments(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: h.name === 'torso' ? 0x00e0ff : h.name === 'head' ? 0xff40ff : 0xffff00, depthTest: false, transparent: true, opacity: 0.6 }));
          m.frustumCulled = false; sc.add(m); extra.push(m);
        }
        if (hit) { const dot = new T.Mesh(new T.SphereGeometry(0.04, 8, 6), new T.MeshBasicMaterial({ color: 0xff2020, depthTest: false })); dot.position.fromArray(hit.world); sc.add(dot); extra.push(dot); }
      }
      const dirs = [front.clone(), right.clone().multiplyScalar(sideSign), front.clone().multiplyScalar(-1)];
      dirs.forEach((dir, i) => {
        cam.position.copy(focus).addScaledVector(dir, dist).addScaledVector(up, 0.25); cam.lookAt(focus); cam.updateMatrixWorld(true);
        app.renderer.render();
        const side = canvas.height; ctx.drawImage(canvas, (canvas.width - side) / 2, 0, side, side, i * 512, 0, 512, 512);
      });
      cam.position.copy(saved.p); cam.quaternion.copy(saved.q); cam.updateMatrixWorld(true);
      for (const m of extra) { sc.remove(m); m.geometry.dispose(); m.material.dispose(); }
      for (const c of hidden) c.visible = true;
      return out.toDataURL('image/jpeg', 0.88);
    },
  };
}

/** 표본 한 줄: [f, t, oHw,oHo,oHeadClear,oTorso,oArm,oSeg,oSpec, 무기(몸통,머리,팔,다리), 보조(몸통,머리,팔,다리), aRaw, aEx] */
const I = { w: 9, o: 13, aRaw: 17, aEx: 18 };
const REGN = ['torso', 'head', 'arm', 'leg'];
const maxOf = (s, base) => Math.max(s[base], s[base + 1], s[base + 2], s[base + 3]);

/**
 * 한 작업의 표본 묶음을 요약한다: 근사 도형 판정(기존 기준)과 메시 판정(CRITERIA)을 함께 낸다.
 * idle은 같은 모델의 대기 자세 절대 깊이(idleRaw). 대기 자세에서 이미 3cm 이상 겹쳐 보이는 쌍(껍질 과대)은 잡음 바닥이 있다고 보고
 * 기준을 3cm + 그 바닥으로 올려 판정한다(넘으면 결함, 3cm~기준 사이는 판정불가). 바닥이 3cm 미만인 쌍은 3cm 그대로다.
 */
export function summarizeJob(samples, idle) {
  const oldS = summarizeSamples(samples.map(s => s.slice(0, 9)));
  const cm = CRITERIA.weaponCm, thrOf = floor => floor < cm ? cm : cm + floor;
  const thr = { weapon: [0, 1, 2, 3].map(k => thrOf(idle.weapon[k])), offhand: [0, 1, 2, 3].map(k => thrOf(idle.offhand[k])), armTorso: thrOf(idle.armTorso) };
  const byRegion = { weapon: { torso: 0, head: 0, arm: 0, leg: 0 }, offhand: { torso: 0, head: 0, arm: 0, leg: 0 } };
  const best = { weapon: { v: 0, i: -1 }, offhand: { v: 0, i: -1 }, armTorso: { v: 0, i: -1 }, unk: { v: 0, i: -1 } };
  let aRaw = 0, unkMax = 0; const unkWhat = new Set();
  samples.forEach((s, i) => {
    for (const kind of ['weapon', 'offhand']) for (let k = 0; k < 4; k++) {
      const v = s[(kind === 'weapon' ? I.w : I.o) + k];
      byRegion[kind][REGN[k]] = Math.max(byRegion[kind][REGN[k]], v);
      if (v >= thr[kind][k]) { if (v > best[kind].v) best[kind] = { v, i }; }
      else if (v >= cm) { unkWhat.add(kind + ':' + REGN[k]); if (v > best.unk.v) best.unk = { v, i }; unkMax = Math.max(unkMax, v); }
    }
    aRaw = Math.max(aRaw, s[I.aRaw]);
    if (s[I.aEx] >= thr.armTorso) { if (s[I.aEx] > best.armTorso.v) best.armTorso = { v: s[I.aEx], i }; }
    else if (s[I.aEx] >= CRITERIA.armTorsoCm) { unkWhat.add('arm→torso'); if (s[I.aEx] > best.unk.v) best.unk = { v: s[I.aEx], i }; unkMax = Math.max(unkMax, s[I.aEx]); }
  });
  const fail = { weapon: best.weapon.i >= 0, offhand: best.offhand.i >= 0, armTorso: best.armTorso.i >= 0 };
  const mesh = { weapon: best.weapon.v, weaponAt: best.weapon.i, offhand: best.offhand.v, offhandAt: best.offhand.i, armTorso: best.armTorso.v, armTorsoAt: best.armTorso.i, armTorsoRaw: aRaw, byRegion, threshold: thr, fail, unreliableOver: [...unkWhat], unreliableMax: unkMax, unreliableAt: best.unk.i };
  return { samples: samples.length, old: oldS, mesh, meshOk: !fail.weapon && !fail.offhand && !fail.armTorso, unreliable: unkWhat.size > 0 };
}

/** 판정: 결함(신뢰할 수 있는 쌍이 3cm 이상) / 판정불가(껍질 과대로 신뢰 불가한 쌍만 3cm 이상) / 오탐(근사 도형은 위반이었지만 메시는 통과) / 정상 */
export function verdictOf(sum) {
  if (sum.samples === 0) return '측정불가';
  if (!sum.meshOk) return '결함';
  if (sum.unreliable) return '판정불가';
  return sum.old.ok ? '정상' : '오탐';
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [origin = 'http://127.0.0.1:5198', outArg = 'work/cycles/20261019-combat-mesh-audit/after', heroArg = HEROES.join(','), filter = ''] = process.argv.slice(2);
  const out = path.resolve(outArg), shots = path.join(out, 'captures');
  await fs.mkdir(shots, { recursive: true });
  const hullSrc = await hullSource();
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
  const report = { scope: '격리 Chromium(1280x720), 실제 게임 루프(app.step 1/60초) 재생, 영웅 스킨 메시 월드 정점의 부위별 볼록 껍질로 직접 측정. 시작 상태(무적·쿨다운·MP·궁극 게이지·AUTO 끔·각성 레벨)만 고정. 실기기 아님.',
    origin, criteria: CRITERIA, oldThresholds: OLD_THRESHOLDS,
    source: { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirtyFiles: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).split('\n').filter(Boolean).length },
    heroes: {}, errors: [] };
  const label = (hero, job) => (hero + '-' + job.id).replace(/[^\w.-]+/g, '_');
  const wanted = id => !filter || filter.split(',').some(f => id.includes(f));
  const seen = new Map();
  try {
    for (const hero of heroArg.split(',')) {
      const { context, page } = await openPage(browser, origin);
      page.on('pageerror', e => report.errors.push(hero + ': ' + e.message));
      const row = { hub: [], battle: [] }; report.heroes[hero] = row;
      try {
        await page.evaluate(async id => { app.eco.s.selected = id; await app.showcaseHero(id, true); }, hero);
        await page.evaluate(hullSrc);
        await page.evaluate(installProbe);
        await page.evaluate(installMeshProbe, { distance: 3.4 });
        row.env = await page.evaluate(id => window.__poseQA.calibrate(id), hero);
        // 기준선: 정상 대기 자세를 한 번 재생해 정점별 기존 겹침을 기록한다(판정에는 쓰이지 않음).
        await page.evaluate(() => { window.__poseQA.hook.mode = 'base'; });
        await page.evaluate(() => window.__poseQA.hub('hub-idle', undefined, {}));
        await page.evaluate(() => { window.__poseQA.hook.mode = 'run'; });
        row.idleRaw = { hub: await page.evaluate(() => window.__poseQA.idleRaw(true)) };
        const runJobs = async (phase, jobs, call) => {
          for (const job of jobs.filter(j => wanted(j.id))) {
            const res = await page.evaluate(call, job);
            const sum = summarizeJob(res.samples, row.idleRaw[phase]), verdict = verdictOf(sum);
            const rec = { ...job, anim: res.anim, dur: res.dur, skipped: res.skipped, held: res.held, verdict, ...sum, frames: res.samples };
            row[phase].push(rec);
            // 대기 자세는 결과와 무관하게 항상 한 장 남긴다(껍질 과대·구조상 겹침 확인용).
            if ((job.id === 'idle' || job.id === 'hub-idle') && verdict === '정상') {
              const again = await page.evaluate(call, { id: job.id, kind: job.kind, arg: job.arg, opts: { stopAt: 0 } });
              if (again.image) { const file = path.join(shots, phase + '-' + label(hero, job) + '-ref.jpg'); await fs.writeFile(file, Buffer.from(again.image.split(',')[1], 'base64')); rec.capture = { file: path.relative(out, file), sample: 0, frame: res.samples[0]?.[0], why: 'ref', detail: again.detail }; }
            }
            // 캡처: 결함은 메시 최악 표본, 판정불가는 껍질 과대 후보의 최악 표본, 오탐은 근사 도형이 가장 크게 센 표본을 남긴다.
            if (verdict === '결함' || verdict === '판정불가' || verdict === '오탐') {
              let at, why;
              if (verdict === '판정불가') { at = sum.mesh.unreliableAt; why = 'unreliable:' + sum.mesh.unreliableOver.join(','); }
              else if (verdict === '결함') {
                const c = [['weapon', sum.mesh.weapon, sum.mesh.weaponAt], ['offhand', sum.mesh.offhand, sum.mesh.offhandAt], ['arm', sum.mesh.armTorso, sum.mesh.armTorsoAt]].sort((x, y) => y[1] - x[1])[0];
                why = c[0]; at = c[2];
              } else {
                const o = sum.old, ratio = { hw: o.max.hw / OLD_THRESHOLDS.handCm, torso: o.max.torso / OLD_THRESHOLDS.torsoCm, arm: o.max.arm / OLD_THRESHOLDS.armCm, headClear: o.max.headClear < 0 ? 1 + -o.max.headClear / 4 : 0 };
                const key = Object.entries(ratio).sort((x, y) => y[1] - x[1])[0][0]; at = o.worst[key]?.i ?? 0; why = 'old-' + key;
              }
              const frameKey = hero + '|' + res.anim + '|' + Math.round((res.samples[at]?.[1] ?? 0) * 30) + '|' + verdict;
              if (seen.has(frameKey)) rec.capture = { ...seen.get(frameKey), shared: true };
              else {
                const again = await page.evaluate(call, { id: job.id, kind: job.kind, arg: job.arg, opts: { stopAt: at } });
                if (again.image) {
                  const file = path.join(shots, phase + '-' + label(hero, job) + '-' + (verdict === '오탐' ? 'fp' : verdict === '판정불가' ? 'unk' : 'defect') + '.jpg');
                  await fs.writeFile(file, Buffer.from(again.image.split(',')[1], 'base64'));
                  rec.capture = { file: path.relative(out, file), sample: at, frame: res.samples[at]?.[0], why, detail: again.detail };
                  seen.set(frameKey, { file: rec.capture.file, sample: at, frame: rec.capture.frame, why, detail: again.detail });
                }
              }
            }
          }
        };
        await runJobs('hub', [{ id: 'hub-idle', kind: 'hub-idle' }, { id: 'hub-walk', kind: 'hub-walk' }, { id: 'hub-Cheer', kind: 'hub-clip', arg: 'Cheer' }, { id: 'hub-Interact', kind: 'hub-clip', arg: 'Interact' }],
          ({ kind, arg, opts }) => window.__poseQA.hub(kind, arg, opts || {}));
        await page.evaluate(id => window.__poseQA.startBattle(id), hero);
        await page.waitForFunction(() => app.battle?.active && app.battle.player && app.input.enabled, null, { timeout: 60000 });
        await page.waitForTimeout(1200);
        row.fixture = await page.evaluate(() => window.__poseQA.freeze());
        const info = await page.evaluate(() => window.__poseQA.info());
        row.info = info;
        row.unknownBones = await page.evaluate(() => window.__poseQA.meshUnknown(app.battle.player.model));
        await page.evaluate(() => { window.__poseQA.hook.mode = 'base'; });
        await page.evaluate(() => window.__poseQA.battle('idle', undefined, {}));
        await page.evaluate(() => { window.__poseQA.hook.mode = 'run'; });
        row.idleRaw.battle = await page.evaluate(() => window.__poseQA.idleRaw(true));
        const jobs = [{ id: 'idle', kind: 'idle' }, { id: 'run', kind: 'run' }];
        info.combos.forEach((anim, i) => jobs.push({ id: 'attack' + (i + 1), kind: 'attack', arg: i }));
        info.skills.forEach((s, i) => jobs.push({ id: 'skill' + i + '-' + s.id, kind: 'skill', arg: i }));
        jobs.push({ id: 'dodge', kind: 'dodge' }, { id: 'hit', kind: 'clip', arg: 'Hit_A' }, { id: 'cheer', kind: 'clip', arg: 'Cheer' }, { id: 'interact', kind: 'clip', arg: 'Interact' });
        await runJobs('battle', jobs, ({ kind, arg, opts }) => window.__poseQA.battle(kind, arg, opts || {}));
      } catch (e) { report.errors.push(hero + ': ' + (e.stack || e.message)); }
      await context.close();
      const line = r => [r.id.padEnd(22), String(r.samples).padStart(3), '근사 hw ' + r.old.max.hw.toFixed(1) + ' head ' + r.old.max.headClear.toFixed(1) + ' torso ' + r.old.max.torso.toFixed(1) + ' arm ' + r.old.max.arm.toFixed(1),
        '메시 무기 ' + r.mesh.weapon.toFixed(1) + '(몸통 ' + r.mesh.byRegion.weapon.torso.toFixed(1) + ' 머리 ' + r.mesh.byRegion.weapon.head.toFixed(1) + ' 팔 ' + r.mesh.byRegion.weapon.arm.toFixed(1) + ' 다리 ' + r.mesh.byRegion.weapon.leg.toFixed(1) + ') 보조 ' + r.mesh.offhand.toFixed(1) + ' 팔→몸통 ' + r.mesh.armTorso.toFixed(1) + '(원값 ' + r.mesh.armTorsoRaw.toFixed(1) + ')', r.skipped ? '건너뜀:' + r.skipped : r.verdict].join(' | ');
      console.log('== ' + hero + ' 미분류 뼈 ' + JSON.stringify(row.unknownBones || []));
      for (const r of [...row.hub, ...row.battle]) console.log(line(r));
    }
  } finally { await browser.close(); }
  const all = Object.values(report.heroes).flatMap(h => [...h.hub, ...h.battle]);
  report.pass = !report.errors.length && all.every(r => r.skipped || r.meshOk);
  report.counts = all.reduce((m, r) => (m[r.verdict] = (m[r.verdict] || 0) + 1, m), {});
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report));
  console.log(JSON.stringify({ pass: report.pass, counts: report.counts, errors: report.errors.slice(0, 5) }));
  if (!report.pass) process.exitCode = 1;
}
