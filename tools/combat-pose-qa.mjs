// 전투·마을 이동 중 영웅 자세 감사: 다섯 직업의 대기·기본 공격·스킬·달리기·회피·피격·환호와 마을 걷기를
// 실제 게임 루프(app.step, 고정 1/60초)로 재생하며 매 표본마다 무기 손잡이-손 거리, 무기-머리 구 겹침,
// 무기·위팔·아래팔의 몸통 관통 깊이를 잰다. 정식 빌드에서도 돌도록 개발 서버 전용 import를 쓰지 않고
// window.app / window.__THREE / window.__LOOKS(읽기 전용)만 읽는다. 시작 상태(무적·쿨다운·MP·AUTO 끔)만 고정한다.
// 사용: node tools/combat-pose-qa.mjs [origin] [outDir] [heroes] [jobFilter]
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// 수용 기준(brief A2): 단위는 cm. 느슨하게 바꾸지 않는다.
export const THRESHOLDS = Object.freeze({ handCm: 8, headOverlapCm: 0, torsoCm: 4, armCm: 4 });
export const HEROES = ['knight', 'barbarian', 'mage', 'rogue', 'ranger'];

/** 표본 [frame, t, hw, ho, headClear, torso, arm, armSeg, headSpec] 묶음을 클립 요약으로 줄인다. headSpec은 brief 문자 그대로의 구(머리 뼈 중심 반경 0.35) 참고값이다. */
export function summarizeSamples(samples) {
  const max = { hw: 0, ho: 0, torso: 0, arm: 0 }, worst = {}, minClear = { v: Infinity }, minSpec = { v: Infinity };
  samples.forEach((s, i) => {
    const [frame, t, hw, ho, clear, torso, arm, , spec] = s;
    const set = (key, value, better) => { if (!worst[key] || better(value, worst[key].value)) worst[key] = { i, frame, t, value }; };
    set('hw', hw, (a, b) => a > b); set('ho', ho, (a, b) => a > b); set('headClear', clear, (a, b) => a < b);
    set('torso', torso, (a, b) => a > b); set('arm', arm, (a, b) => a > b);
    max.hw = Math.max(max.hw, hw); max.ho = Math.max(max.ho, ho); max.torso = Math.max(max.torso, torso); max.arm = Math.max(max.arm, arm);
    minClear.v = Math.min(minClear.v, clear); minSpec.v = Math.min(minSpec.v, spec ?? 9);
  });
  const headClear = samples.length ? minClear.v : 0;
  const fail = {
    hw: max.hw > THRESHOLDS.handCm, ho: max.ho > THRESHOLDS.handCm,
    head: headClear < -THRESHOLDS.headOverlapCm, torso: max.torso > THRESHOLDS.torsoCm, arm: max.arm > THRESHOLDS.armCm,
  };
  // 순위용 점수: 1 초과면 기준 위반. 머리 겹침은 깊이 1cm당 1/4 가산.
  const score = Math.max(max.hw / THRESHOLDS.handCm, max.ho / THRESHOLDS.handCm, max.torso / THRESHOLDS.torsoCm, max.arm / THRESHOLDS.armCm,
    headClear < 0 ? 1 + -headClear / 4 : 0);
  return { samples: samples.length, max: { ...max, headClear, headSpec: samples.length ? minSpec.v : 0 }, worst, fail, ok: !Object.values(fail).some(Boolean), score };
}

/** 브라우저 안에 측정·재생 도구를 설치한다. 직렬화되므로 바깥 변수를 쓰지 않는다. */
export function installProbe() {
  const T = window.__THREE, V = T.Vector3, app = window.app, DT = 1 / 60, SPEC_HEAD_R = .35;
  if (!T || !app) throw new Error('window.__THREE / window.app 없음');
  const low = s => s.toLowerCase().replace(/mixamorig:?/, '');
  const JOINTS = ['hips', 'neck', 'head', 'leftarm', 'rightarm', 'leftforearm', 'rightforearm', 'lefthand', 'righthand'];
  const SEGMENTS = [['leftarm', 'leftforearm'], ['leftforearm', 'lefthand'], ['rightarm', 'rightforearm'], ['rightforearm', 'righthand']];
  const q = { envs: {} };
  const scaleOf = root => { const s = root.getWorldScale(new V()); return Math.max(s.x, s.y, s.z); };
  const r1 = x => Math.round(x * 10) / 10;
  // SkinnedMesh의 bindMatrixInverse는 updateMatrixWorld에서만 갱신되므로 조상은 updateWorldMatrix, 하위는 updateMatrixWorld로 갱신한다.
  const refresh = root => { root.updateWorldMatrix(true, false); root.updateMatrixWorld(true); };

  // 뼈 이름은 Mixamo 접두사와 대소문자를 무시하고 찾는다.
  function bind(root, heroId) {
    const bones = {}; root.traverse(o => { if (o.isBone) bones[low(o.name)] = o; });
    for (const j of JOINTS) if (!bones[j]) throw new Error('뼈 없음: ' + j + ' (' + heroId + ')');
    const look = window.__LOOKS?.[heroId], weaponNames = new Set(look?.weaponNodes || []), offNames = new Set(look?.armorNodes || []);
    const held = [];
    root.traverseVisible(o => {
      if (!o.isMesh) return;
      let kind = null, hand = false, armory = false;
      for (let p = o; p && p !== root; p = p.parent) {
        if (!kind && weaponNames.has(p.name)) kind = 'weapon';
        if (!kind && offNames.has(p.name)) kind = 'offhand';
        if (p.userData?.armoryItem) armory = true;
        if (p.isBone && /hand|wrist/i.test(p.name)) hand = true;
      }
      if (!kind && hand && (armory || !o.isSkinnedMesh)) kind = 'weapon';
      if (kind) held.push({ mesh: o, kind });
    });
    return { root, heroId, bones, held };
  }

  // 몸통 단면(타원)을 척추 본에 지배적으로 묶인 정점의 좌우·앞뒤 중앙값으로 추정한다(모델 단위). 타원 표면 점의 |좌표| 중앙값은 반축의 cos45도 배이므로 1/cos45도로 되돌린다. 망토·허리띠 같은 바깥 장식 정점에 휘둘리지 않는다.
  q.calibrate = heroId => {
    const s = app.showcase, root = s.root;
    s.pose?.restore(); s.mixer.stopAllAction(); s.mixer.clipAction(s.clips.Idle).reset().play(); s.mixer.setTime(0);
    refresh(root);
    const rig = bind(root, heroId), P = n => rig.bones[n].getWorldPosition(new V()), k = scaleOf(root);
    const hips = P('hips'), ax = P('neck').sub(hips), L = ax.length(); ax.normalize();
    const right = P('rightarm').sub(P('leftarm')); right.addScaledVector(ax, -right.dot(ax)).normalize();
    const front = new V().crossVectors(ax, right).normalize();
    const lat = [], dep = [], skull = [];
    root.traverseVisible(o => {
      if (!o.isSkinnedMesh) return;
      o.skeleton.update();
      const names = o.skeleton.bones.map(b => low(b.name)), idx = o.geometry.attributes.skinIndex, wt = o.geometry.attributes.skinWeight;
      if (!idx || !wt) return;
      for (let v = 0; v < idx.count; v++) {
        let best = -1, bw = 0;
        for (let c = 0; c < 4; c++) if (wt.getComponent(v, c) > bw) { bw = wt.getComponent(v, c); best = idx.getComponent(v, c); }
        if (names[best] === 'head') { skull.push(o.getVertexPosition(v, new V()).applyMatrix4(o.matrixWorld)); continue; }
        if (!/^spine/.test(names[best])) continue;
        const p = o.getVertexPosition(v, new V()).applyMatrix4(o.matrixWorld).sub(hips), along = p.dot(ax);
        if (along < L * .2 || along > L * .95) continue;
        p.addScaledVector(ax, -along); lat.push(Math.abs(p.dot(right))); dep.push(Math.abs(p.dot(front)));
      }
    });
    const pct = (a, f) => { a.sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * f))]; };
    const env = lat.length >= 30 ? { a: pct(lat, .5) * Math.SQRT2 / k, b: pct(dep, .5) * Math.SQRT2 / k, n: lat.length } : { a: .16, b: .16, n: lat.length, fallback: true };
    // 머리 구: 머리 뼈에 지배적으로 묶인 정점의 중심(머리 뼈 로컬)과 75분위 반경(모자·후드 같은 돌출 정점 제외). 머리 뼈 자체는 목 밑동이라 반경 0.35 구가 어깨까지 덮는다.
    if (skull.length >= 30) {
      const c = new V(); for (const p of skull) c.add(p); c.divideScalar(skull.length);
      const dist = skull.map(p => p.distanceTo(c)).sort((x, y) => x - y);
      env.hc = rig.bones.head.worldToLocal(c.clone()).toArray(); env.hr = dist[Math.floor(dist.length * .75)] / k; env.hn = skull.length;
    }
    q.envs[heroId] = env;
    return { ...env, k, torsoLen: L / k };
  };

  // 한 표본: [무기 손거리, 보조장비 손거리, 머리 여유(음수=겹침), 몸통 관통(무기), 팔 관통, 팔 구간]. 단위 cm.
  function measure(rig) {
    const root = rig.root; refresh(root);
    const env = q.envs[rig.heroId] || { a: .18, b: .18 }, k = scaleOf(root);
    const P = {}; for (const j of JOINTS) P[j] = rig.bones[j].getWorldPosition(new V());
    const ax = P.neck.clone().sub(P.hips), L = ax.length(); ax.normalize();
    const right = P.rightarm.clone().sub(P.leftarm); right.addScaledVector(ax, -right.dot(ax)).normalize();
    const front = new V().crossVectors(ax, right).normalize();
    const a = env.a * k, b = env.b * k, R = SPEC_HEAD_R * k, d = new V(), tmp = new V();
    const hc = env.hc ? rig.bones.head.localToWorld(new V().fromArray(env.hc)) : P.head, hr = (env.hr ?? SPEC_HEAD_R) * k;
    const deepest = { d: 0, at: null, p: new V() }, detail = [], worst = { torso: -1, torsoP: new V(), head: Infinity, headP: new V() };
    // 몸통 좌표계(위 u, 좌우 x, 앞뒤 z, cm)로 바꾼 점과 양손 위치
    const frame = p => { d.copy(p).sub(P.hips); return [r1(d.dot(ax) * 100), r1(d.dot(right) * 100), r1(d.dot(front) * 100)]; };
    const depth = p => {
      d.copy(p).sub(P.hips); const u = d.dot(ax), x = d.dot(right), z = d.dot(front), ue = u < 0 ? u : u > L ? u - L : 0;
      if (ue !== 0) return 0;
      const rho = Math.hypot(x / a, z / b); if (rho >= 1) return 0;
      const r = Math.hypot(x, z), dp = r < 1e-9 ? Math.min(a, b) : r / rho - r;
      if (dp > deepest.d) { deepest.d = dp; deepest.at = [u, x, z]; deepest.p.copy(p); }
      return dp;
    };
    let hw = 0, ho = 0, clear = Infinity, spec = Infinity, torso = 0;
    for (const { mesh, kind } of rig.held) {
      mesh.skeleton?.update();
      const n = mesh.geometry.attributes.position.count, stride = Math.max(1, Math.ceil(n / 8000));
      let dl = Infinity, dr = Infinity, dh = Infinity, ds = Infinity, tp = 0, nearD = Infinity, farD = -1; deepest.d = 0; deepest.at = null;
      const nearP = new V(), farP = new V();
      for (let i = 0; i < n; i += stride) {
        mesh.getVertexPosition(i, tmp).applyMatrix4(mesh.matrixWorld);
        const el = tmp.distanceTo(P.lefthand), er = tmp.distanceTo(P.righthand), eh = Math.min(el, er);
        dl = Math.min(dl, el); dr = Math.min(dr, er);
        if (eh < nearD) { nearD = eh; nearP.copy(tmp); } if (eh > farD) { farD = eh; farP.copy(tmp); } const eh2 = tmp.distanceTo(hc); if (eh2 - hr < worst.head) { worst.head = eh2 - hr; worst.headP.copy(tmp); }
        dh = Math.min(dh, eh2); ds = Math.min(ds, tmp.distanceTo(P.head));
        tp = Math.max(tp, depth(tmp));
      }
      const hand = Math.min(dl, dr);
      detail.push({ mesh: (mesh.parent?.name || '') + '/' + mesh.name, kind, hand: r1(hand * 100), head: r1((dh - hr) * 100), torso: r1(tp * 100), at: deepest.at && deepest.at.map(v => r1(v * 100)), handL: r1(dl * 100), handR: r1(dr * 100), grip: frame(nearP), tip: frame(farP) });
      const isString = /string/i.test(mesh.name);
      if (isString) { /* 시위: 손가락 노크 소켓 기준이라 손거리 판정에서 제외 */ } else if (kind === 'weapon') hw = Math.max(hw, hand); else ho = Math.max(ho, hand);
      if (tp > worst.torso) { worst.torso = tp; worst.torsoP.copy(deepest.p); }
      clear = Math.min(clear, dh - hr); spec = Math.min(spec, ds - R); torso = Math.max(torso, tp);
    }
    q.lastGeom = { P, ax, right, front, L, a, b, hc, hr, R, worst };
    q.lastDetail = { handLpos: frame(P.lefthand), handRpos: frame(P.righthand), detail, axisLenCm: r1(L * 100), a: r1(a * 100), b: r1(b * 100), hc: r1(hr * 100) };
    let arm = 0, seg = -1;
    SEGMENTS.forEach(([from, to], si) => {
      for (let s = 1; s <= 5; s++) { tmp.copy(P[from]).lerp(P[to], s / 5); const dep = depth(tmp); if (dep > arm) { arm = dep; seg = si; } }
    });
    return [r1(hw * 100), r1(ho * 100), r1((Number.isFinite(clear) ? clear : 9) * 100), r1(torso * 100), r1(arm * 100), seg, r1((Number.isFinite(spec) ? spec : 9) * 100)];
  }

  const step = render => app.step(DT, !!render);
  const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
  const player = () => app.battle.player;

  q.freeze = () => { app.testPause = true; const p = player(); p.heroLevel = 99; return { hero: p.def.id, scale: scaleOf(p.model), state: p.state }; };
  // 시작 상태 고정: 무적·쿨다운 0·MP 가득·궁극 게이지 가득·AUTO 끔, 대기 자세로 되돌린다.
  function settle() {
    const p = player();
    for (const c of ['KeyA', 'KeyD', 'KeyW', 'KeyS']) key('keyup', c);
    p.auto = false; p.invuln = 1e9; p.cds.fill(0); p.mp = p.maxMp; p.ult = p.ultMax; p.stun = 0; p.hp = p.maxHp; app.input.clear();
    for (let i = 0; i < 120 && p.state !== 'idle'; i++) { step(false); p.invuln = 1e9; }
    if (p.state !== 'idle') { p.state = 'idle'; p.skillCtx = null; p.vel.set(0, 0, 0); }
    p.play('Idle', { fade: 0 });
    for (let i = 0; i < 24; i++) step(false);
    p.cds.fill(0); p.mp = p.maxMp; p.ult = p.ultMax;
  }

  // 캡처: 효과·지형을 숨기고 영웅과 판정 도형(몸통 타원 캡슐, 머리 구, 가장 깊은 점)을 정면 대각선·옆 두 시점으로 한 장에 그린다.
  function capture(rig) {
    const sc = app.scene, cam = app.renderer.camera, canvas = app.renderer.r.domElement, g = q.lastGeom;
    let top = rig.root; while (top.parent && top.parent !== sc) top = top.parent;
    const hidden = []; for (const c of sc.children) if (c !== top && !c.isLight && c.visible) { c.visible = false; hidden.push(c); }
    const mk = (geo, color, opacity) => new T.Mesh(geo, new T.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity, depthTest: false }));
    const overlay = new T.Group(); overlay.matrixAutoUpdate = false;
    overlay.matrix.makeBasis(g.right, g.ax, g.front).setPosition(g.P.hips);
    const cyl = mk(new T.CylinderGeometry(1, 1, 1, 20, 1, true), 0x00e0ff, .55); cyl.scale.set(g.a, g.L, g.b); cyl.position.y = g.L / 2; overlay.add(cyl);
    const head = mk(new T.SphereGeometry(g.hr, 14, 10), 0xff40ff, .7); head.position.copy(g.hc);
    const spec = mk(new T.SphereGeometry(g.R, 12, 8), 0xffff00, .25); spec.position.copy(g.P.head);
    const dot = (p, color) => { const m = new T.Mesh(new T.SphereGeometry(.03, 8, 6), new T.MeshBasicMaterial({ color, depthTest: false })); m.position.copy(p); return m; };
    const extra = [head, spec, dot(g.worst.torsoP, 0xff2020), dot(g.worst.headP, 0xff9020), dot(g.P.lefthand, 0x40ff40), dot(g.P.righthand, 0x4060ff)];
    sc.add(overlay); for (const m of extra) sc.add(m);
    const center = g.P.hips.clone().addScaledVector(g.ax, g.L * .75), saved = { p: cam.position.clone(), q: cam.quaternion.clone() };
    const out = document.createElement('canvas'); out.width = 1024; out.height = 512; const ctx = out.getContext('2d');
    const views = [center.clone().addScaledVector(g.front, 2.2).addScaledVector(g.right, 1.5).addScaledVector(g.ax, .5), center.clone().addScaledVector(g.right, 2.6).addScaledVector(g.ax, .3)];
    views.forEach((pos, i) => {
      cam.position.copy(pos); cam.lookAt(center); cam.updateMatrixWorld(true);
      app.renderer.render();
      const side = canvas.height; ctx.drawImage(canvas, (canvas.width - side) / 2, 0, side, side, i * 512, 0, 512, 512);
    });
    cam.position.copy(saved.p); cam.quaternion.copy(saved.q);
    sc.remove(overlay); for (const m of extra) { sc.remove(m); m.geometry.dispose(); m.material.dispose(); }
    for (const c of hidden) c.visible = true;
    return out.toDataURL('image/png');
  }

  // 재생기: tick(f)이 'end'면 종료, 숫자면 그 t로 표본, null이면 건너뛴다. opts.stopAt은 재생(캡처) 때 그 표본에서 멈춘다.
  function drive(root, heroId, max, tick, opts, extra = {}) {
    const rig = bind(root, heroId), samples = [], actions = new Set(), inBattle = app.mode === 'battle';
    let image = null, detail = null;
    for (let f = 0; f < max; f++) {
      step(opts.stopAt !== undefined);
      const t = tick(f);
      if (t === 'end') break;
      if (t === null || t === undefined) continue;
      if (inBattle) actions.add(player().actionName);
      // q.hook이 있으면(combat-mesh-qa.mjs) 측정·캡처를 그쪽이 맡는다. 근사 도형 측정은 q.oldMeasure로 함께 부른다.
      const m = q.hook ? q.hook.measure(rig, f) : measure(rig);
      if (m === null) continue; // hook이 이 프레임 표본을 건너뛰길 요청
      samples.push([f, +t.toFixed(3), ...m]);
      if (opts.stopAt !== undefined && samples.length - 1 === opts.stopAt) { image = q.hook ? q.hook.capture(rig) : capture(rig); detail = q.lastDetail; break; }
    }
    return { samples, image, detail, held: rig.held.map(h => h.kind + ':' + h.mesh.parent?.name), actions: [...actions], ...extra };
  }

  q.battle = (kind, arg, opts = {}) => {
    const p = player(); settle();
    const root = p.model, id = p.def.id;
    if (kind === 'idle') {
      const dur = p.clips.Idle.duration, frames = Math.ceil(dur * 60), stride = Math.max(1, Math.floor(frames / 24));
      return drive(root, id, frames, f => f % stride === 0 ? f / frames : null, opts, { anim: 'Idle', dur });
    }
    if (kind === 'run') {
      key('keydown', 'KeyD');
      try {
        const dur = p.clips.Running_A.duration;
        return drive(root, id, 90, f => f >= 24 && p.state === 'move' && f % 2 === 0 ? ((f - 24) * DT * p.action.timeScale / dur) % 1 : null, opts, { anim: 'Running_A', dur });
      } finally { key('keyup', 'KeyD'); }
    }
    if (kind === 'attack') {
      const c = p.def.combo[arg], dur = c.dur;
      p.startCombo(arg);
      return drive(root, id, 600, () => p.state !== 'attack' || p.comboIdx !== arg ? 'end' : p.stateT / dur, opts, { anim: c.anim, dur, hitAt: c.hitAt });
    }
    if (kind === 'skill') {
      const sk = p.def.skills[arg];
      if (!p.tryCastSkill(arg)) return { skipped: '시전 불가', samples: [], anim: sk?.anim };
      const ctx = p.skillCtx, dur = ctx.impl.dur || .8;
      return drive(root, id, 600, () => (p.state !== 'skill' && p.state !== 'ult') || p.skillCtx !== ctx || ctx.done || ctx.t > dur + .05 ? 'end' : ctx.t / dur, opts, { anim: sk.anim, dur, castAt: sk.castAt, skill: sk.id, ult: !!sk.ult });
    }
    if (kind === 'dodge') {
      p.dodge(null);
      return drive(root, id, 60, () => p.state !== 'dodge' ? 'end' : p.stateT / .32, opts, { anim: 'Dodge_Forward', dur: .32 });
    }
    if (kind === 'clip') {
      const clip = p.clips[arg]; if (!clip) return { skipped: '클립 없음', samples: [] };
      p.play(arg, { once: true, fade: .05 });
      const frames = Math.ceil(clip.duration * 60 / (p.action.timeScale || 1));
      return drive(root, id, frames, f => f / frames, opts, { anim: arg, dur: clip.duration });
    }
    throw new Error('알 수 없는 종류: ' + kind);
  };

  // 로비(마을): 쇼케이스 영웅을 실제 키 입력으로 걷게 하고 로비 교정이 얹힌 뼈를 잰다.
  q.hub = (kind, arg, opts = {}) => {
    const s = app.showcase, root = s.root, id = s.def.id;
    app.testPause = true;
    if (!app.hubWalkMode && !app.setHubWalkMode(true)) throw new Error('마을 걷기 모드를 켤 수 없음');
    for (const c of ['KeyA', 'KeyD', 'KeyW', 'KeyS']) key('keyup', c);
    for (let i = 0; i < 30; i++) step(false);
    if (kind === 'hub-idle') {
      const dur = s.clips.Idle.duration, frames = Math.ceil(dur * 60), stride = Math.max(1, Math.floor(frames / 24));
      return drive(root, id, frames, f => f % stride === 0 ? f / frames : null, opts, { anim: 'Idle', dur });
    }
    if (kind === 'hub-walk') {
      const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA'], leg = 60;
      let cur = null;
      try {
        return drive(root, id, leg * 4, f => {
          const want = keys[Math.floor(f / leg)];
          if (want !== cur) { if (cur) key('keyup', cur); key('keydown', want); cur = want; }
          return f % leg >= 20 && f % 2 === 0 && app.hubMovement.moving ? (f % leg) / leg : null;
        }, opts, { anim: 'Running_A', dur: s.clips.Running_A.duration });
      } finally { if (cur) key('keyup', cur); for (let i = 0; i < 20; i++) step(false); }
    }
    if (kind === 'hub-clip') {
      const clip = s.clips[arg]; if (!clip) return { skipped: '클립 없음', samples: [] };
      s.mixer.stopAllAction(); const a = s.mixer.clipAction(clip); a.reset().setLoop(T.LoopOnce, 1); a.clampWhenFinished = true; a.play();
      const frames = Math.ceil(clip.duration * 60);
      return drive(root, id, frames, f => f / frames, opts, { anim: arg, dur: clip.duration });
    }
    throw new Error('알 수 없는 종류: ' + kind);
  };

  q.startBattle = async heroId => {
    app.ui.closeModal?.(); app.eco.s.selected = heroId; app.eco.s.energy = 100;
    if (!await app.startStage(app.eco.nextStage())) throw new Error('stage start failed');
    app.companionAgent?.endBattle?.();
  };
  q.info = () => { const p = player(); return { combos: p.def.combo.map(c => c.anim), skills: p.def.skills.map(s => ({ id: s.id, anim: s.anim, ult: !!s.ult })), loadout: p.skillLoadout, clips: Object.keys(p.clips) }; };
  q.oldMeasure = measure; q.refresh = refresh; q.scaleOf = scaleOf;
  window.__poseQA = q;
}

export async function openPage(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block', reducedMotion: 'no-preference' });
  const page = await context.newPage();
  await page.goto(origin + '/');
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 120000 }); await page.click('#boot-start');
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot').classList.contains('show') && app.showcase, null, { timeout: 120000 });
  await page.evaluate(() => app.ui.closeModal?.());
  return { context, page };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [origin = 'http://127.0.0.1:5196', outArg = 'work/cycles/20261019-combat-pose-audit/after', heroArg = HEROES.join(','), filter = ''] = process.argv.slice(2);
  const out = path.resolve(outArg), shots = path.join(out, 'captures');
  await fs.mkdir(shots, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
  const report = { scope: '격리 Chromium(1280x720), 실제 게임 루프(app.step 1/60초) 재생. 시작 상태(무적·쿨다운·MP·궁극 게이지·AUTO 끔·각성 레벨)만 고정. 실기기 아님.',
    origin, thresholds: THRESHOLDS, source: { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirtyFiles: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).split('\n').filter(Boolean).length },
    heroes: {}, errors: [] };
  const label = (hero, job) => (hero + '-' + job.id).replace(/[^\w.-]+/g, '_');
  const wanted = id => !filter || filter.split(',').some(f => id.includes(f));
  let anyFail = false;
  try {
    for (const hero of heroArg.split(',')) {
      const { context, page } = await openPage(browser, origin);
      page.on('pageerror', e => report.errors.push(hero + ': ' + e.message));
      const row = { env: null, hub: [], battle: [] }; report.heroes[hero] = row;
      try {
        await page.evaluate(async id => { app.eco.s.selected = id; await app.showcaseHero(id, true); }, hero);
        await page.evaluate(installProbe);
        row.env = await page.evaluate(id => window.__poseQA.calibrate(id), hero);
        const runJobs = async (phase, jobs, call) => {
          for (const job of jobs.filter(j => wanted(j.id))) {
            const res = await page.evaluate(call, job);
            const sum = summarizeSamples(res.samples);
            row[phase].push({ ...job, anim: res.anim, dur: res.dur, hitAt: res.hitAt, castAt: res.castAt, skill: res.skill, skipped: res.skipped, held: res.held, actions: res.actions, ...sum, frames: res.samples });
          }
          // 최악 프레임 캡처: 지표마다 위반이 가장 큰 작업(전투 2개, 마을 1개)의 최악 표본을 같은 순서로 다시 재생해 남긴다.
          const metrics = { hw: r => r.max.hw - THRESHOLDS.handCm, torso: r => r.max.torso - THRESHOLDS.torsoCm, arm: r => r.max.arm - THRESHOLDS.armCm, headClear: r => -r.max.headClear - THRESHOLDS.headOverlapCm };
          const picks = [];
          for (const [metric, excess] of Object.entries(metrics)) {
            const over = row[phase].filter(r => r.samples && excess(r) > 0).sort((x, y) => excess(y) - excess(x));
            for (const r of over.slice(0, phase === 'hub' ? 1 : 2)) picks.push([r, metric]);
          }
          // 위반이 없으면 점수 1위 작업 하나를 대표 프레임으로 남긴다.
          if (!picks.length) { const top = row[phase].filter(r => r.samples).sort((x, y) => y.score - x.score)[0]; if (top) picks.push([top, Object.entries({ hw: top.max.hw / THRESHOLDS.handCm, torso: top.max.torso / THRESHOLDS.torsoCm, arm: top.max.arm / THRESHOLDS.armCm }).sort((x, y) => y[1] - x[1])[0][0]]); }
          for (const [r, metric] of picks) {
            const at = r.worst[metric]?.i ?? 0;
            const again = await page.evaluate(call, { id: r.id, kind: r.kind, arg: r.arg, opts: { stopAt: at } });
            if (again.image) {
              const file = path.join(shots, phase + '-' + label(hero, r) + '-' + metric + '.png');
              await fs.writeFile(file, Buffer.from(again.image.split(',')[1], 'base64'));
              (r.captures ||= []).push({ detail: again.detail, file: path.relative(out, file), metric, sample: at, frame: r.worst[metric]?.frame, value: r.worst[metric]?.value });
            }
          }
        };
        // 1) 마을: 걷기·정지·감정 표현(환호·상호작용)
        await runJobs('hub', [{ id: 'hub-idle', kind: 'hub-idle' }, { id: 'hub-walk', kind: 'hub-walk' }, { id: 'hub-Cheer', kind: 'hub-clip', arg: 'Cheer' }, { id: 'hub-Interact', kind: 'hub-clip', arg: 'Interact' }],
          ({ kind, arg, opts }) => window.__poseQA.hub(kind, arg, opts || {}));
        // 2) 전투
        await page.evaluate(id => window.__poseQA.startBattle(id), hero);
        await page.waitForFunction(() => app.battle?.active && app.battle.player && app.input.enabled, null, { timeout: 60000 });
        await page.waitForTimeout(1200);
        row.fixture = await page.evaluate(() => window.__poseQA.freeze());
        const info = await page.evaluate(() => window.__poseQA.info());
        row.info = info;
        const jobs = [{ id: 'idle', kind: 'idle' }, { id: 'run', kind: 'run' }];
        info.combos.forEach((anim, i) => jobs.push({ id: 'attack' + (i + 1), kind: 'attack', arg: i }));
        info.skills.forEach((s, i) => jobs.push({ id: 'skill' + i + '-' + s.id, kind: 'skill', arg: i }));
        jobs.push({ id: 'dodge', kind: 'dodge' }, { id: 'hit', kind: 'clip', arg: 'Hit_A' }, { id: 'cheer', kind: 'clip', arg: 'Cheer' }, { id: 'interact', kind: 'clip', arg: 'Interact' });
        await runJobs('battle', jobs, ({ kind, arg, opts }) => window.__poseQA.battle(kind, arg, opts || {}));
      } catch (e) { report.errors.push(hero + ': ' + (e.stack || e.message)); }
      await context.close();
      for (const r of [...row.hub, ...row.battle]) if (!r.ok && !r.skipped) anyFail = true;
      const line = r => [r.id.padEnd(22), String(r.samples).padStart(3), 'hand ' + r.max.hw.toFixed(1) + '/' + r.max.ho.toFixed(1), 'head ' + r.max.headClear.toFixed(1) + '(spec ' + r.max.headSpec.toFixed(1) + ')', 'torso ' + r.max.torso.toFixed(1), 'arm ' + r.max.arm.toFixed(1), r.skipped ? '건너뜀:' + r.skipped : r.ok ? 'OK' : 'FAIL ' + Object.keys(r.fail).filter(k => r.fail[k]).join(',')].join(' | ');
      console.log('== ' + hero + ' env ' + JSON.stringify(row.env && { a: +row.env.a.toFixed(3), b: +row.env.b.toFixed(3), n: row.env.n }));
      for (const r of [...row.hub, ...row.battle]) console.log(line(r));
    }
  } finally { await browser.close(); }
  report.pass = !anyFail && !report.errors.length;
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report));
  console.log(JSON.stringify({ pass: report.pass, errors: report.errors.slice(0, 5) }));
  if (!report.pass) process.exitCode = 1;
}
