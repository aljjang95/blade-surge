import * as THREE from 'three';

// 종락 회랑 심층 종문 3개의 월드 표시(BUNDLE-04 PLAN 3.2).
//
// 읽기 계약: 뷰는 route(BellfallDeepBells)와 gate 필드를 읽기만 하고 쓰지 않는다.
//   route: def(radius, holdSeconds), gates, closed, hold, holdGate, lastDiscord, discordT, guide
//   gate: room, phase('locked'|'lit'|'dark'|'resonated'), center
// 정답 순서(tollOrder)는 읽지 않는다. 정답은 guide gate 만 흰 맥동으로 드러낸다.
// 수명주기: constructor 에서만 geometry/material/InstancedMesh 를 만든다. update 에서는 할당하지 않는다(숫자 대입·행렬 갱신·drawRange 만).
//   dispose()는 그룹 제거와 모든 geometry/material 해제를 하며 반복 호출해도 안전하다.
// 메시 예산(draw call): 바닥 링 InstancedMesh 1 + 종 InstancedMesh 1 + 유지 진행 호 1 = 최대 3.
// 표시 영역은 판정 영역과 같다: 링의 바깥 반경 = def.radius(컨트롤러의 공명 판정 반경).

/** @typedef {{ reduced: boolean }} BellfallDeepViewOptions */

const TAU = Math.PI * 2;
const ARC_SEGMENTS = 48;          // 유지 2초 기준 한 칸 약 0.04초
const BELL_Y = 3.4;               // 종을 매단 축의 높이(종 몸통은 그 아래로 약 1.3)
const RING_Y = .07, ARC_Y = .08;
const SWING_SECONDS = 1.2;        // 소등·공명 직후 종이 흔들리는 시간
const DISCORD_SECONDS = .6;       // 불협 직후 보라색을 유지하는 시간
// 바닥 표식의 그리기 순서. 지면 VFX(fx.groundTex 8, fx.ring 9)보다 뒤, 빌보드·플립북(11 이상)보다 앞이다.
const FLOOR_ORDER = Object.freeze({ ring: 10.2, arc: 10.5 });
const PALETTE = Object.freeze({
  locked: 0x5f6f80,      // 흐린 회청
  lit: 0xffd060,         // 금색
  dark: 0x1c2a5c,        // 어두운 남색
  resonated: 0x88dfc3,   // 청록
  discord: 0xb06cff,     // 불협 직후 보라
  arc: 0x88dfc3,
  guide: 0xffffff,
});
const AXIS_Z = new THREE.Vector3(0, 0, 1);

/** 종 조형: 축(0,0,0)에서 아래로 늘어지는 회전체. 위 꼭지 → 어깨 → 입구의 바깥 곡선. */
function bellGeometry() {
  const profile = [
    [0, .12], [.16, .1], [.2, -.08], [.34, -.32], [.5, -.62], [.68, -.95], [.82, -1.2], [.9, -1.3], [.8, -1.32], [.55, -1.2],
    [.38, -1.0], [.2, -.7], [.1, -.4], [0, -.3],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(profile, 20);
}

export class BellfallDeepBellView {
  /** @param {import('three').Object3D} scene @param {any} route */
  constructor(scene, route) {
    this.scene = scene; this.route = route; this.disposed = false; this.t = 0;
    const radius = route.def.radius;
    this.group = new THREE.Group(); this.group.name = 'TLL_BellfallDeepBells'; scene.add(this.group);
    /** @type {import('three').BufferGeometry[]} */ this.geometries = [];
    /** @type {import('three').Material[]} */ this.materials = [];
    const geo = g => { this.geometries.push(g); return g; };
    const flat = g => { g.rotateX(-Math.PI / 2); return geo(g); };
    const basic = o => { const m = new THREE.MeshBasicMaterial(o); this.materials.push(m); return m; };
    const count = route.gates.length;

    // 바닥 링: 판정 반경과 같은 바깥 반경. 인스턴스 색이 곧 종문 상태다.
    this.ringMat = basic({ color: 0xffffff, transparent: true, opacity: .9, depthWrite: false });
    this.ring = new THREE.InstancedMesh(flat(new THREE.RingGeometry(radius - .14, radius, 72)), this.ringMat, count);
    this.ring.name = 'TLL_BellfallRings'; this.ring.renderOrder = FLOOR_ORDER.ring; this.ring.frustumCulled = false;
    // 종: 불투명, 인스턴스 색.
    this.bellMat = basic({ color: 0xffffff });
    this.bell = new THREE.InstancedMesh(geo(bellGeometry()), this.bellMat, count);
    this.bell.name = 'TLL_BellfallBells'; this.bell.frustumCulled = false;
    // 유지 진행 호: 링 안쪽 띠. holdGate 위치로 옮겨 쓰고 drawRange 로 줄인다(한 칸 = 6 인덱스).
    this.arcMat = basic({ color: PALETTE.arc, transparent: true, opacity: .95, depthWrite: false });
    this.arcGeometry = flat(new THREE.RingGeometry(radius - .62, radius - .34, ARC_SEGMENTS, 1, 0, TAU));
    this.arc = new THREE.Mesh(this.arcGeometry, this.arcMat);
    this.arc.name = 'TLL_BellfallHoldArc'; this.arc.renderOrder = FLOOR_ORDER.arc; this.arc.visible = false;
    this.arc.position.y = ARC_Y; this.arc.frustumCulled = false;
    this.arcGeometry.setDrawRange(0, 0); this.arcCount = 0;
    this.group.add(this.ring, this.bell, this.arc);

    // update 에서 재사용하는 작업 객체(프레임 루프 무할당).
    this.color = new THREE.Color(); this.white = new THREE.Color(PALETTE.guide);
    this.matrix = new THREE.Matrix4(); this.quat = new THREE.Quaternion();
    this.pos = new THREE.Vector3(); this.unit = new THREE.Vector3(1, 1, 1); this.none = new THREE.Vector3(0, 0, 0);
    this.noRotation = new THREE.Quaternion();
    this.entries = route.gates.map((gate, i) => {
      // 색 버퍼(instanceColor)를 생성자에서 만들어 둔다.
      this.ring.setColorAt(i, this.color.setHex(PALETTE.locked));
      this.bell.setColorAt(i, this.color.setHex(PALETTE.locked));
      const e = { gate, shown: null, phase: '', ringHex: -1, bellHex: -1, swingT: SWING_SECONDS, swinging: false };
      this.place(i, e, false);
      return e;
    });
    this.ring.instanceMatrix.needsUpdate = true; this.bell.instanceMatrix.needsUpdate = true;
    this.ring.instanceColor.needsUpdate = true; this.bell.instanceColor.needsUpdate = true;
    this.ring.visible = false; this.bell.visible = false;
  }

  /** 인스턴스 i 의 행렬을 쓴다. shown 이 거짓이면 크기 0 이라 그려지지 않는다. angle 은 종의 흔들림(라디안). */
  place(i, e, shown, angle = 0) {
    const c = e.gate.center;
    this.pos.set(c.x, RING_Y, c.z);
    this.matrix.compose(this.pos, this.noRotation, shown ? this.unit : this.none);
    this.ring.setMatrixAt(i, this.matrix);
    this.pos.set(c.x, BELL_Y, c.z);
    this.quat.setFromAxisAngle(AXIS_Z, angle);
    this.matrix.compose(this.pos, this.quat, shown ? this.unit : this.none);
    this.bell.setMatrixAt(i, this.matrix);
  }

  /** @param {any} route @param {number} dt @param {BellfallDeepViewOptions} [opts] */
  update(route, dt, opts) {
    if (this.disposed) return;
    const closed = !!route.closed;
    this.group.visible = !closed;
    if (closed) return;
    const reduced = !!opts?.reduced;
    this.t += dt;
    const guide = route.guide || null, lastDiscord = route.lastDiscord || null;
    const discordLive = !!lastDiscord && route.discordT < DISCORD_SECONDS;
    let matrixDirty = false, ringDirty = false, bellDirty = false, anyShown = false;
    const entries = this.entries;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i], g = e.gate, phase = g.phase;
      const show = !!g.room.discovered && phase !== undefined;
      anyShown = anyShown || show;
      // 소등·공명 순간에 종이 한 번 흔들린다(reduced 면 없음).
      if (phase !== e.phase) {
        e.phase = phase;
        if (!reduced && (phase === 'dark' || phase === 'resonated')) { e.swingT = 0; e.swinging = true; }
      }
      let angle = 0;
      if (e.swinging) {
        if (reduced) { e.swinging = false; e.swingT = SWING_SECONDS; }
        else {
          e.swingT += dt;
          if (e.swingT >= SWING_SECONDS) { e.swinging = false; e.swingT = SWING_SECONDS; }
          else angle = Math.sin(e.swingT * 14) * .32 * (1 - e.swingT / SWING_SECONDS);
        }
        matrixDirty = true; this.place(i, e, show, angle);
      } else if (show !== e.shown) { matrixDirty = true; this.place(i, e, show, 0); }
      e.shown = show;
      if (!show) continue;

      const hex = discordLive && g === lastDiscord ? PALETTE.discord
        : phase === 'lit' ? PALETTE.lit : phase === 'dark' ? PALETTE.dark : phase === 'resonated' ? PALETTE.resonated : PALETTE.locked;
      if (hex !== e.bellHex) { e.bellHex = hex; this.bell.setColorAt(i, this.color.setHex(hex)); bellDirty = true; }
      if (g === guide) {
        // guide 종문만 링이 흰색으로 맥동한다. reduced 면 맥동 없이 일정한 밝기를 쓴다.
        const mix = reduced ? .8 : .6 + .4 * Math.sin(this.t * 5);
        this.color.setHex(hex).lerp(this.white, mix);
        this.ring.setColorAt(i, this.color); ringDirty = true; e.ringHex = -1;
      } else if (hex !== e.ringHex) { e.ringHex = hex; this.ring.setColorAt(i, this.color.setHex(hex)); ringDirty = true; }
    }
    this.ring.visible = anyShown; this.bell.visible = anyShown;
    if (matrixDirty) { this.ring.instanceMatrix.needsUpdate = true; this.bell.instanceMatrix.needsUpdate = true; }
    if (ringDirty) this.ring.instanceColor.needsUpdate = true;
    if (bellDirty) this.bell.instanceColor.needsUpdate = true;

    // 유지 진행 호: 공명 중인 종문에만 보인다. hold > 0 이면 최소 한 칸을 남긴다.
    const hg = route.holdGate, hold = route.hold;
    const arcOn = !!hg && hold > 0 && !!hg.room.discovered;
    this.arc.visible = arcOn;
    if (arcOn) {
      this.arc.position.x = hg.center.x; this.arc.position.z = hg.center.z;
      const frac = Math.max(0, Math.min(1, hold / route.def.holdSeconds));
      const n = Math.max(1, Math.ceil(frac * ARC_SEGMENTS - 1e-9));
      if (n !== this.arcCount) { this.arcCount = n; this.arcGeometry.setDrawRange(0, n * 6); }
    } else this.arcCount = 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.ring.dispose(); this.bell.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.entries = []; this.geometries = []; this.materials = [];
    this.scene = null; this.route = null;
  }
}
