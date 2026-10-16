import * as THREE from 'three';

// 잿불금고 심층 사슬 집행자 후방 노출의 월드 표시(BUNDLE-14 PLAN 3절).
//
// 읽기 계약: 뷰는 rear(EmberRearExposure)를 읽기만 하고 쓰지 않는다.
//   rear: state('idle'|'armored'|'exposed'|'ended'), windowLeft, windowTotal, lastSide('rear'|'front'|'side'|''), lastSideT,
//         boss{ pos, yaw, alive, def.scale }, def{ rearDot, frontDot, rangedReach }
// 표시(exposed 에서만): 보스 등 뒤 바닥의 청록 부채꼴(TLL_EmberRearWedge)과 정면의 사슬 갑주 호(TLL_EmberRearGuard).
//   부채꼴은 남은 시간만큼 불투명도가 줄고(0 이 되지 않는다), 등 뒤 타격 직후 짧게 밝아진다.
//   armored·idle·ended·보스 없음·보스 사망이면 둘 다 숨긴다.
// 방향 규약: 보스 정면은 (sin yaw, cos yaw) 이고 Actor 의 root.rotation.y = yaw 와 같다. 메시의 로컬 +z 가 정면이다.
//   부채꼴은 로컬 -z(등 뒤), 갑주 호는 로컬 +z(정면)를 중심으로 만들고 mesh.rotation.y = yaw 로 돌린다.
// 수명주기: constructor 에서만 geometry/material/mesh 를 만든다. update 에서는 할당하지 않는다(숫자 대입만).
//   보스 크기(scale)가 바뀌면 같은 정점 배열에 반지름 값을 다시 쓴다(새 배열을 만들지 않는다).
//   dispose()는 scene 에서 제거하고 geometry/material 을 해제하며 반복 호출해도 안전하다.
// 메시 예산(draw call): 부채꼴 1 + 갑주 호 1 = 최대 2.

/** @typedef {{ reduced: boolean }} EmberRearViewOptions */

const WEDGE_COLOR = 0x5ff0d0, GUARD_COLOR = 0xd8a070;
const WEDGE_INNER = .7;            // 보스 def.scale 에 곱하는 부채꼴 안쪽 반지름
const GUARD_INNER = .8;            // 보스 def.scale 에 곱하는 갑주 호 안쪽 반지름
const GUARD_THICKNESS = .3;        // 갑주 호 두께(월드 단위)
const WEDGE_Y = .08, GUARD_Y = .09;  // 바닥 연출 높이(.08 이상)
const WEDGE_MIN = .2, WEDGE_MAX = .55;  // 창이 끝나기 직전/열린 직후 불투명도
const WEDGE_FLASH = .3, FLASH_SECONDS = .25;
const WEDGE_PULSE = .06, GUARD_OPACITY = .55, GUARD_PULSE = .05;
const ARC_SEGMENTS = 24;
// 그리기 순서: 지면 VFX(8~9)보다 뒤, 빌보드·플립북(11 이상)보다 앞. 반격 고리(10.3)·장막(10.8)과 겹치지 않는 값이다.
const ORDER = Object.freeze({ wedge: 10.4, guard: 10.45 });

/** 로컬 +z(center 1) 또는 -z(center -1)를 중심으로 양쪽 half 라디안인 부채꼴 띠(바닥, y=0)를 만든다.
 * 정점은 (안쪽, 바깥) 쌍이고 setRadii 가 같은 배열에 반지름을 다시 쓴다. */
function sectorGeometry(half, center) {
  const n = ARC_SEGMENTS, dirs = new Float32Array((n + 1) * 2), positions = new Float32Array((n + 1) * 6), index = [];
  for (let i = 0; i <= n; i++) {
    const a = -half + (2 * half * i) / n;
    // 중심 방향 기준 각도 a: x = sin a, z = cos a. center -1 이면 z 부호를 뒤집는다.
    dirs[i * 2] = Math.sin(a); dirs[i * 2 + 1] = Math.cos(a) * center;
    if (i < n) { const k = i * 2; index.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.userData.dirs = dirs;
  return geometry;
}
function setRadii(geometry, inner, outer) {
  const dirs = geometry.userData.dirs, positions = geometry.getAttribute('position'), array = positions.array;
  for (let i = 0; i < dirs.length / 2; i++) {
    const dx = dirs[i * 2], dz = dirs[i * 2 + 1], k = i * 6;
    array[k] = dx * inner; array[k + 1] = 0; array[k + 2] = dz * inner;
    array[k + 3] = dx * outer; array[k + 4] = 0; array[k + 5] = dz * outer;
  }
  positions.needsUpdate = true;
}

export class EmberRearView {
  /** @param {import('three').Object3D} scene @param {any} rear */
  constructor(scene, rear) {
    this.scene = scene; this.rear = rear; this.disposed = false; this.t = 0; this.scaleKey = NaN;
    this.group = new THREE.Group(); this.group.name = 'TLL_EmberRearView'; scene.add(this.group);
    /** @type {import('three').BufferGeometry[]} */ this.geometries = [];
    /** @type {import('three').Material[]} */ this.materials = [];
    const def = rear.def, rearHalf = Math.acos(def.rearDot), frontHalf = Math.acos(def.frontDot);
    this.outer = def.rangedReach;
    // 등 뒤 부채꼴: 로컬 -z 중심. 정면 호: 로컬 +z 중심.
    const wedgeGeometry = sectorGeometry(rearHalf, -1); this.geometries.push(wedgeGeometry);
    this.wedgeMat = new THREE.MeshBasicMaterial({ color: WEDGE_COLOR, transparent: true, opacity: WEDGE_MAX, depthWrite: false, side: THREE.DoubleSide });
    this.materials.push(this.wedgeMat);
    this.wedge = new THREE.Mesh(wedgeGeometry, this.wedgeMat);
    this.wedge.name = 'TLL_EmberRearWedge'; this.wedge.renderOrder = ORDER.wedge; this.wedge.frustumCulled = false; this.wedge.visible = false;
    this.wedge.position.y = WEDGE_Y;

    const guardGeometry = sectorGeometry(frontHalf, 1); this.geometries.push(guardGeometry);
    this.guardMat = new THREE.MeshBasicMaterial({ color: GUARD_COLOR, transparent: true, opacity: GUARD_OPACITY, depthWrite: false, side: THREE.DoubleSide });
    this.materials.push(this.guardMat);
    this.guard = new THREE.Mesh(guardGeometry, this.guardMat);
    this.guard.name = 'TLL_EmberRearGuard'; this.guard.renderOrder = ORDER.guard; this.guard.frustumCulled = false; this.guard.visible = false;
    this.guard.position.y = GUARD_Y;
    setRadii(wedgeGeometry, WEDGE_INNER, this.outer); setRadii(guardGeometry, GUARD_INNER, GUARD_INNER + GUARD_THICKNESS);
    this.group.add(this.wedge, this.guard);
  }

  /** @param {any} rear @param {number} dt @param {EmberRearViewOptions} [opts] */
  update(rear, dt, opts) {
    if (this.disposed) return;
    const boss = rear?.boss;
    const live = rear?.state === 'exposed' && !!boss && boss.alive !== false && !!boss.pos;
    if (!live) { this.wedge.visible = false; this.guard.visible = false; return; }
    const reduced = !!opts?.reduced;
    if (dt > 0) this.t += dt;
    const scale = boss.def?.scale > 0 ? boss.def.scale : 1, pos = boss.pos, yaw = Number.isFinite(boss.yaw) ? boss.yaw : 0;
    if (scale !== this.scaleKey) {
      this.scaleKey = scale;
      setRadii(this.wedge.geometry, WEDGE_INNER * scale, Math.max(this.outer, WEDGE_INNER * scale + 1));
      setRadii(this.guard.geometry, GUARD_INNER * scale, GUARD_INNER * scale + GUARD_THICKNESS);
    }
    this.wedge.visible = true; this.guard.visible = true;
    this.wedge.position.x = pos.x; this.wedge.position.z = pos.z; this.wedge.rotation.y = yaw;
    this.guard.position.x = pos.x; this.guard.position.z = pos.z; this.guard.rotation.y = yaw;
    const total = rear.windowTotal > 0 ? rear.windowTotal : 1;
    const frac = Math.max(0, Math.min(1, rear.windowLeft / total));
    let opacity = WEDGE_MIN + (WEDGE_MAX - WEDGE_MIN) * frac;
    if (rear.lastSide === 'rear' && rear.lastSideT < FLASH_SECONDS) opacity += WEDGE_FLASH;
    this.wedgeMat.opacity = Math.min(1, reduced ? opacity : opacity + WEDGE_PULSE * Math.sin(this.t * 6));
    this.guardMat.opacity = reduced ? GUARD_OPACITY : GUARD_OPACITY + GUARD_PULSE * Math.sin(this.t * 6);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries = []; this.materials = [];
    this.scene = null; this.rear = null;
  }
}
