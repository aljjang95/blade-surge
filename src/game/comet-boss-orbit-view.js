import * as THREE from 'three';

// 혜성 기사단장 보스전 푸른 궤도선·유성 예고의 월드 표시(BUNDLE-06 PLAN 3.2).
//
// 읽기 계약: 뷰는 orbit(CometBossOrbit)를 읽기만 하고 쓰지 않는다.
//   orbit: state('idle'|'armed'|'warn'|'ended'), kind('outer'|'center'|null), warnLeft, warnTotal, center(Vector3),
//          def{ safe, outerMin, outerMax }
// 표시: armed·warn 에서 보스방 중심에 푸른 궤도선, warn 에서 kind 에 따라 바깥 유성 예고 고리(outerMin~outerMax) 또는
//   중심 유성 예고 원판(반지름 safe)을 붉게 겹친다. idle·ended 면 모두 숨긴다.
// 표시 영역은 판정 영역과 같다: 고리 안·밖 반지름과 원판 반지름은 생성 때 def 값 그대로 쓴다.
//   궤도선 링은 safe 를 넘지 않도록 선 안쪽(safe−LINE_WIDTH ~ safe)에 둔다. 링의 바깥 가장자리가 곧 판정 경계(r = safe)라서,
//   링 두께가 safe 밖으로 걸치면 선 위에 선 영웅이 안전 구역 밖에 있는데도 선 안으로 보이는 오차가 생긴다.
// 수명주기: constructor 에서만 geometry/material/mesh 를 만든다. update 에서는 할당하지 않는다(숫자 대입·visible 만).
//   dispose()는 scene 에서 제거하고 geometry/material 을 해제하며 반복 호출해도 안전하다.
// 메시 예산(draw call): 궤도선 1 + (바깥 예고 1 | 중심 예고 1) = 최대 2. 바깥·중심 예고는 동시에 보이지 않는다.

/** @typedef {{ reduced: boolean }} CometBossOrbitViewOptions */

const LINE_COLOR = 0x82bfff, WARN_COLOR = 0xff4a3a;   // 붉은색은 comet-deep-orbit-view 폭풍 예고(PALETTE.storm)와 같은 계열
const LINE_WIDTH = .12;                                // 궤도선 링 두께. 링의 바깥 반지름이 safe 와 같다.
const LINE_OPACITY = .85, LINE_PULSE = .1;
const WARN_BASE = .2, WARN_GAIN = .5;                  // 예고 시작 순간에도 보이도록 최소 불투명도를 둔다(일반판 고리 유성과 같다).
const LINE_Y = .07, WARN_Y = .05;
// 바닥 표식의 그리기 순서(comet-deep-orbit-view FLOOR_ORDER 와 같은 층): 지면 VFX(8~9)보다 뒤, 빌보드·플립북(11 이상)보다 앞.
// 예고 붉은 영역(10) 위에 궤도선(10.3)이 얹힌다.
const ORDER = Object.freeze({ warn: 10, line: 10.3 });

export class CometBossOrbitView {
  /** @param {import('three').Object3D} scene @param {any} orbit */
  constructor(scene, orbit) {
    this.scene = scene; this.orbit = orbit; this.disposed = false; this.t = 0;
    const d = orbit.def;
    this.group = new THREE.Group(); this.group.name = 'TLL_CometBossOrbit'; scene.add(this.group);
    /** @type {import('three').BufferGeometry[]} */ this.geometries = [];
    /** @type {import('three').Material[]} */ this.materials = [];
    const flat = g => { g.rotateX(-Math.PI / 2); this.geometries.push(g); return g; };
    const basic = o => { const m = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, ...o }); this.materials.push(m); return m; };
    const mesh = (name, geometry, material, y, order) => {
      const m = new THREE.Mesh(geometry, material);
      m.name = name; m.position.y = y; m.renderOrder = order; m.frustumCulled = false; m.visible = false;
      this.group.add(m); return m;
    };
    this.lineMat = basic({ color: LINE_COLOR, opacity: LINE_OPACITY });
    this.outerMat = basic({ color: WARN_COLOR, opacity: WARN_BASE });
    this.centerMat = basic({ color: WARN_COLOR, opacity: WARN_BASE });
    this.line = mesh('TLL_CometBossOrbitLine', flat(new THREE.RingGeometry(d.safe - LINE_WIDTH, d.safe, 96)), this.lineMat, LINE_Y, ORDER.line);
    this.outer = mesh('TLL_CometBossOrbitOuter', flat(new THREE.RingGeometry(d.outerMin, d.outerMax, 96)), this.outerMat, WARN_Y, ORDER.warn);
    this.center = mesh('TLL_CometBossOrbitCenter', flat(new THREE.CircleGeometry(d.safe, 64)), this.centerMat, WARN_Y, ORDER.warn);
  }

  /** @param {any} orbit @param {number} dt @param {CometBossOrbitViewOptions} [opts] */
  update(orbit, dt, opts) {
    if (this.disposed) return;
    const state = orbit?.state, c = orbit?.center;
    const live = (state === 'armed' || state === 'warn') && !!c;
    if (!live) { this.line.visible = false; this.outer.visible = false; this.center.visible = false; return; }
    const reduced = !!opts?.reduced;
    this.t += dt;
    this.group.position.set(c.x, 0, c.z);
    this.line.visible = true;
    this.lineMat.opacity = reduced ? LINE_OPACITY : LINE_OPACITY + LINE_PULSE * Math.sin(this.t * 4);
    const warn = state === 'warn';
    const outer = warn && orbit.kind === 'outer', center = warn && orbit.kind === 'center';
    this.outer.visible = outer; this.center.visible = center;
    if (!outer && !center) return;
    // 예고는 남은 시간이 줄수록 진해진다(반복 깜빡임 없이 한 방향 변화).
    const total = orbit.warnTotal > 0 ? orbit.warnTotal : 1;
    const progress = 1 - Math.max(0, Math.min(1, orbit.warnLeft / total));
    const opacity = WARN_BASE + WARN_GAIN * (Number.isFinite(progress) ? progress : 0);
    if (outer) this.outerMat.opacity = opacity; else this.centerMat.opacity = opacity;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries = []; this.materials = [];
    this.scene = null; this.orbit = null;
  }
}
