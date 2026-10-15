import * as THREE from 'three';

// 혜성 요새 심층 궤도 고리 5개의 월드 표시(TASK-DESIGN 9·10절, 17절 정정 2·3·4).
//
// 읽기 계약: 뷰는 route(CometDeepOrbits)와 gate 필드를 읽기만 하고 쓰지 않는다.
//   route: def, gates, closed
//   gate: room, phase('locked'|'ready'|'collapse'|'shelter'|'storm'|'connected'), angle, target, stone, center,
//         clock, connectT, lockT, stormIndex, stormWarn, stormWarnT, stormShelter
// 수명주기: constructor 에서만 geometry/material 을 만든다. update 에서는 할당하지 않는다(숫자 대입·visible·drawRange 만).
//   dispose()는 그룹 제거와 모든 geometry/material 해제를 하며 반복 호출해도 안전하다.
// 표시 영역은 판정 영역과 같다: 붉은 영역 = gate.center 반경 def.storm.radius 원 ∩ 그 방 직사각형(생성 때 한 번 자른 정적 geometry),
//   빈 원 = gate.stormShelter 반경 def.shelterRadius.
// 메시 예산(보이는 메시 기준): locked·connected 2, ready 5, collapse 6, shelter 5, 폭풍 예고 5, 폭풍 대기 3.

/** @typedef {{ reduced: boolean }} CometDeepViewOptions */

const TAU = Math.PI * 2;
const ARC_SEGMENTS = 90;            // 붕괴 시간 9초 기준 한 칸 0.1초
const RAY_SEGMENTS = 72;            // 붉은 영역 둘레 표본 수(방 모서리 방향은 따로 더한다)
const COUNTDOWN_RADIUS_GAP = .3;    // 룬석 접촉대(track + band) 바로 바깥
// 폭풍 예고 붉은 영역의 불투명도: 첫 프레임부터 바닥과 구분되되 청록 빈 원(ring .95)보다 약해야 한다.
const STORM_RED_BASE = .3, STORM_RED_GAIN = .15;
// 바닥 표식의 그리기 순서. 지면 VFX(fx.groundTex 8, fx.ring 9)보다 뒤, 빌보드·플립북(11 이상)보다 앞이다.
// 같은 순서 안에서는 붉은 영역 → 빈 원 채움 → 빈 원 테두리 → 궤도선·홈·호 순으로 쌓는다.
const FLOOR_ORDER = Object.freeze({ red: 10, fill: 10.1, ring: 10.2, track: 10.3, notch: 10.4, arc: 10.5 });
const PALETTE = Object.freeze({
  trackIdle: 0x9fb4cc, trackLive: 0xcfe6ff, gold: 0xffd060,
  stoneIdle: 0x6f86a8, stoneReady: 0x3a7cff, stoneNear: 0x7dffb0, stoneDone: 0xffd060,
  countCalm: 0x6fd0ff, countWarn: 0xffb347, countUrgent: 0xff5a4a,
  shelter: 0x5fb6ff, shelterHold: 0xffe08a, storm: 0xff4a3a, hollow: 0x4dffe8,
});

/** 원 반경 radius 와 방 직사각형(반폭 hw, 반높이 hh)의 교집합을 중심 부채꼴로 덮는 평면(y=0) geometry. */
function clippedDiscGeometry(radius, hw, hh) {
  const angles = [];
  for (let k = 0; k < RAY_SEGMENTS; k++) angles.push(k / RAY_SEGMENTS * TAU);
  // 방 모서리 방향을 표본에 넣어 모서리가 깎이지 않게 한다.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const a = Math.atan2(sx * hw, sz * hh); angles.push(a < 0 ? a + TAU : a);
  }
  angles.sort((a, b) => a - b);
  const count = angles.length, positions = new Float32Array((count + 1) * 3), index = [];
  for (let k = 0; k < count; k++) {
    const s = Math.sin(angles[k]), c = Math.cos(angles[k]);
    let t = radius;
    if (Math.abs(s) > 1e-9) t = Math.min(t, hw / Math.abs(s));
    if (Math.abs(c) > 1e-9) t = Math.min(t, hh / Math.abs(c));
    positions[(k + 1) * 3] = Math.max(-hw, Math.min(hw, s * t));
    positions[(k + 1) * 3 + 2] = Math.max(-hh, Math.min(hh, c * t));
  }
  // θ 가 늘어나는 방향(+z → +x)으로 감으면 법선이 위(+y)를 본다.
  for (let k = 0; k < count; k++) index.push(0, k + 1, (k + 1) % count + 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}

export class CometDeepOrbitView {
  /** @param {import('three').Object3D} scene @param {any} route */
  constructor(scene, route) {
    this.scene = scene; this.route = route; this.disposed = false;
    const d = route.def;
    this.group = new THREE.Group(); this.group.name = 'TLL_CometDeepOrbits'; scene.add(this.group);
    /** @type {import('three').BufferGeometry[]} */ this.geometries = [];
    /** @type {import('three').Material[]} */ this.materials = [];
    const geo = g => { this.geometries.push(g); return g; };
    const flat = g => { g.rotateX(-Math.PI / 2); return geo(g); };
    const basic = o => { const m = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, ...o }); this.materials.push(m); return m; };
    const lit = o => { const m = new THREE.MeshStandardMaterial(o); this.materials.push(m); return m; };
    // 뷰 인스턴스당 1벌인 공유 geometry/material.
    const shared = {
      track: flat(new THREE.RingGeometry(d.track - .05, d.track + .05, 72)),
      ring: flat(new THREE.RingGeometry(d.shelterRadius - .12, d.shelterRadius, 48)),
      disc: flat(new THREE.CircleGeometry(d.shelterRadius, 48)),
      stone: geo(new THREE.OctahedronGeometry(.75, 0)),
      star: geo(new THREE.ConeGeometry(.45, 1.1, 5)),
      notch: flat(new THREE.RingGeometry(.55, .8, 24)),
    };
    const starMat = basic({ color: PALETTE.shelterHold, opacity: 1, transparent: false, depthWrite: true });
    const notchMat = basic({ color: PALETTE.shelterHold, opacity: .9 });
    const arcInner = d.track + (d.band || 1.5) + COUNTDOWN_RADIUS_GAP;
    this.entries = route.gates.map(gate => {
      const room = gate.room;
      const root = new THREE.Group(); root.position.set(gate.center.x, 0, gate.center.z); root.visible = false; this.group.add(root);
      const mesh = (geometry, material, y) => { const m = new THREE.Mesh(geometry, material); m.position.y = y; m.visible = false; root.add(m); return m; };
      const trackMat = basic({ color: PALETTE.trackIdle, opacity: .25 });
      const stoneMat = lit({ color: 0x8fd0ff, emissive: PALETTE.stoneIdle, emissiveIntensity: .9, roughness: .25, metalness: .3 });
      const arcMat = basic({ color: PALETTE.countCalm, opacity: .85 });
      const ringMat = basic({ color: PALETTE.shelter, opacity: .8 });
      const fillMat = basic({ color: PALETTE.hollow, opacity: .2 });
      const redMat = basic({ color: PALETTE.storm, opacity: 0 });
      // 붕괴 카운트다운은 고리별 geometry 의 drawRange 로 줄인다(고리 한 칸 = 6 인덱스).
      const arcGeometry = flat(new THREE.RingGeometry(arcInner, arcInner + .22, ARC_SEGMENTS, 1, 0, TAU));
      const redGeometry = geo(clippedDiscGeometry(d.storm.radius, room.w / 2, room.h / 2));
      const e = {
        gate, root, trackMat, stoneMat, arcMat, ringMat, fillMat, redMat, arcGeometry, t: 0,
        track: mesh(shared.track, trackMat, .06),
        stone: mesh(shared.stone, stoneMat, .9),
        star: mesh(shared.star, starMat, 1.4),
        notch: mesh(shared.notch, notchMat, .08),
        arc: mesh(arcGeometry, arcMat, .075),
        ring: mesh(shared.ring, ringMat, .07),
        fill: mesh(shared.disc, fillMat, .055),
        red: mesh(redGeometry, redMat, .04),
        // 마지막으로 보인 빈 원 위치(방 중심 기준). 폭풍 대기 중 안전한 쉼터를 계속 보여 준다.
        lastX: 0, lastZ: 0, arcCount: -1, arcTone: -1, stoneTone: -1, phase: '',
      };
      // depthTest 는 유지한다(룬석·기사 모델 뒤로 가려지게). 기사 성역 같은 지면 VFX 가 표식을 덮지 않게 순서만 올린다.
      for (const key of Object.keys(FLOOR_ORDER)) e[key].renderOrder = FLOOR_ORDER[key];
      e.star.position.set(Math.sin(gate.target) * d.track, 1.4, Math.cos(gate.target) * d.track); e.star.rotation.x = Math.PI;
      e.notch.position.set(Math.sin(gate.target) * d.track, .08, Math.cos(gate.target) * d.track);
      return e;
    });
  }

  /** @param {any} route @param {number} dt @param {CometDeepViewOptions} [opts] */
  update(route, dt, opts) {
    if (this.disposed) return;
    const closed = !!route.closed;
    this.group.visible = !closed;
    if (closed) return;
    const reduced = !!opts?.reduced, d = route.def, warning = d.storm.warning;
    for (const e of this.entries) {
      const g = e.gate, room = g.room;
      const show = !!room.discovered && g.phase !== undefined;
      e.root.visible = show;
      if (!show) continue;
      e.t += dt;
      const phase = g.phase;
      const active = phase === 'ready' || phase === 'collapse' || phase === 'shelter' || phase === 'storm';
      const connected = phase === 'connected';
      const aligned = phase === 'shelter' || phase === 'storm' || connected;
      const collapse = phase === 'collapse', shelter = phase === 'shelter', storm = phase === 'storm';
      const warn = storm && !!g.stormWarn;

      // 궤도선: 연결되면 금빛으로 흐려지고, 대기 중에는 희미하다.
      e.track.visible = true;
      e.trackMat.color.setHex(connected ? PALETTE.gold : active ? PALETTE.trackLive : PALETTE.trackIdle);
      e.trackMat.opacity = connected ? .3 : phase === 'locked' ? .22 : storm ? .3 : .5;

      // 룬석: 위치는 컨트롤러가 정하고 뷰는 방 중심 기준으로 옮겨 그리기만 한다.
      e.stone.visible = true;
      e.stone.position.x = g.stone.x - g.center.x; e.stone.position.z = g.stone.z - g.center.z;
      if (!reduced) e.stone.rotation.y += dt * (aligned ? .5 : 2);
      const tone = connected || aligned ? 3 : collapse && g.lockT > 0 ? 2 : phase === 'ready' || collapse ? 1 : 0;
      if (tone !== e.stoneTone) {
        e.stoneTone = tone;
        e.stoneMat.emissive.setHex(tone === 3 ? PALETTE.stoneDone : tone === 2 ? PALETTE.stoneNear : tone === 1 ? PALETTE.stoneReady : PALETTE.stoneIdle);
      }

      // 별과 홈 표식은 아직 맞추지 못한 동안만 보인다.
      const needStar = phase === 'ready' || collapse;
      e.star.visible = needStar; e.notch.visible = needStar;
      if (needStar && !reduced) e.star.rotation.y += dt * 1.5;

      // 붕괴 카운트다운 호: clock / collapseSeconds. clock > 0 이면 최소 한 칸을 남겨 0 으로 보이지 않는다.
      const counting = collapse || shelter;
      e.arc.visible = counting;
      if (counting) {
        const frac = Math.max(0, Math.min(1, g.clock / d.collapseSeconds));
        const count = Math.ceil(frac * ARC_SEGMENTS - 1e-9);
        if (count !== e.arcCount) { e.arcCount = count; e.arcGeometry.setDrawRange(0, count * 6); }
        const arcTone = frac <= 1 / 6 ? 2 : frac <= 1 / 3 ? 1 : 0;
        if (arcTone !== e.arcTone) {
          e.arcTone = arcTone;
          e.arcMat.color.setHex(arcTone === 2 ? PALETTE.countUrgent : arcTone === 1 ? PALETTE.countWarn : PALETTE.countCalm);
        }
      } else e.arcCount = -1;

      // 중심 쉼터 원(준비·붕괴에서는 흐리게, 쉼터에서는 진하게). 폭풍 예고 중에는 빈 원 위치로 옮겨 쓴다.
      e.ring.visible = active;
      e.fill.visible = false; e.red.visible = false;
      if (warn) {
        // 예고 영역 = 판정 영역: 붉은 영역(방 안) + stormShelter 위치의 청록 빈 원.
        const progress = Math.max(0, Math.min(1, 1 - g.stormWarnT / warning));
        e.lastX = g.stormShelter.x - g.center.x; e.lastZ = g.stormShelter.z - g.center.z;
        e.red.visible = true; e.redMat.opacity = STORM_RED_BASE + STORM_RED_GAIN * progress;
        e.ring.position.x = e.lastX; e.ring.position.z = e.lastZ;
        e.ringMat.color.setHex(PALETTE.hollow); e.ringMat.opacity = .95;
        e.fill.visible = true; e.fill.position.x = e.lastX; e.fill.position.z = e.lastZ;
        e.fill.scale.setScalar(1); e.fillMat.color.setHex(PALETTE.hollow); e.fillMat.opacity = .16 + .3 * progress;
      } else if (storm) {
        // 대기 중: 첫 회차 전에는 중심, 이후에는 마지막 빈 원 위치를 안전 표시로 남긴다.
        if (g.stormIndex === 0) { e.lastX = 0; e.lastZ = 0; }
        e.ring.position.x = e.lastX; e.ring.position.z = e.lastZ;
        e.ringMat.color.setHex(PALETTE.hollow); e.ringMat.opacity = .55;
      } else if (active) {
        e.ring.position.x = 0; e.ring.position.z = 0;
        e.ringMat.color.setHex(shelter ? PALETTE.shelterHold : PALETTE.shelter);
        e.ringMat.opacity = shelter ? .95 : .4;
        if (shelter && g.connectT > 0) {
          // 연결 진행: 중심 원이 connectT / connectSeconds 만큼 차오른다.
          const hold = Math.max(.001, Math.min(1, g.connectT / d.connectSeconds));
          e.fill.visible = true; e.fill.position.x = 0; e.fill.position.z = 0;
          e.fill.scale.setScalar(hold); e.fillMat.color.setHex(PALETTE.shelterHold); e.fillMat.opacity = .45;
        }
        if (shelter && !reduced) e.ring.scale.setScalar(1 + Math.sin(e.t * 6) * .04);
        else e.ring.scale.setScalar(1);
      }
      if (warn || storm) e.ring.scale.setScalar(1);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.entries = []; this.geometries = []; this.materials = [];
    this.scene = null; this.route = null;
  }
}
