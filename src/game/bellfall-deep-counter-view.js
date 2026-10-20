import * as THREE from 'three';

// 종락 심층 보스 합창 장막의 월드 표시(BUNDLE-05 PLAN 3.2).
//
// 읽기 계약: 뷰는 counter(BellfallDeepCounter)를 읽기만 하고 쓰지 않는다.
//   counter: state('idle'|'veiled'|'open'|'ended'), windowLeft, windowTotal, boss{ pos, alive, def.scale }
// 표시: veiled 에서는 보스를 감싼 흐린 보라 껍질, open 에서는 보스 발밑의 금색 고리(남은 시간만큼 반지름·불투명도가 줄어듦).
//   idle·ended·보스 없음·보스 사망이면 둘 다 숨긴다.
// 수명주기: constructor 에서만 geometry/material/mesh 를 만든다. update 에서는 할당하지 않는다(숫자 대입만).
//   dispose()는 scene 에서 제거하고 geometry/material 을 해제하며 반복 호출해도 안전하다.
// 메시 예산(draw call): 껍질 1 + 고리 1 = 최대 2(둘이 동시에 보이지 않는다).

/** @typedef {{ reduced: boolean }} BellfallDeepCounterViewOptions */

const SHELL_COLOR = 0xb48cff, RING_COLOR = 0xffd060;
const SHELL_RADIUS = 1.15;       // 보스 def.scale 에 곱하는 껍질 반지름
const SHELL_CENTER = 1;          // 보스 def.scale 에 곱하는 껍질 중심 높이
const SHELL_OPACITY = .14;       // 영웅 시야를 가리지 않도록 낮게 둔다
const SHELL_PULSE = .04;
const RING_BASE = 1.5;           // 보스 def.scale 에 곱하는 열린 직후 고리 반지름
const RING_MIN_RADIUS = 2.4;
const RING_MIN_FRACTION = .35;   // 창이 닫히기 직전 고리 반지름 비율
const RING_Y = .09;
// 그리기 순서: 지면 VFX(8~9)보다 뒤, 빌보드·플립북(11 이상)보다 앞.
const ORDER = Object.freeze({ ring: 10.3, shell: 10.8 });

export class BellfallDeepCounterView {
  /** @param {import('three').Object3D} scene @param {any} counter */
  constructor(scene, counter) {
    this.scene = scene; this.counter = counter; this.disposed = false; this.t = 0;
    this.group = new THREE.Group(); this.group.name = 'TLL_BellfallDeepCounter'; scene.add(this.group);
    /** @type {import('three').BufferGeometry[]} */ this.geometries = [];
    /** @type {import('three').Material[]} */ this.materials = [];

    // 장막 껍질: 단위 구를 보스 scale 로 키운다. 깊이 기록을 끄고 낮은 불투명도로 영웅을 가리지 않는다.
    const shellGeometry = new THREE.SphereGeometry(1, 24, 16); this.geometries.push(shellGeometry);
    this.shellMat = new THREE.MeshBasicMaterial({ color: SHELL_COLOR, transparent: true, opacity: SHELL_OPACITY, depthWrite: false });
    this.materials.push(this.shellMat);
    this.shell = new THREE.Mesh(shellGeometry, this.shellMat);
    this.shell.name = 'TLL_BellfallDeepVeil'; this.shell.renderOrder = ORDER.shell; this.shell.frustumCulled = false; this.shell.visible = false;

    // 반격 바닥 고리: 단위 반지름 링을 바닥에 눕힌다.
    const ringGeometry = new THREE.RingGeometry(.86, 1, 64); ringGeometry.rotateX(-Math.PI / 2); this.geometries.push(ringGeometry);
    this.ringMat = new THREE.MeshBasicMaterial({ color: RING_COLOR, transparent: true, opacity: .85, depthWrite: false });
    this.materials.push(this.ringMat);
    this.ring = new THREE.Mesh(ringGeometry, this.ringMat);
    this.ring.name = 'TLL_BellfallDeepCounterRing'; this.ring.renderOrder = ORDER.ring; this.ring.frustumCulled = false; this.ring.visible = false;
    this.ring.position.y = RING_Y;
    this.group.add(this.shell, this.ring);
  }

  /** @param {any} counter @param {number} dt @param {BellfallDeepCounterViewOptions} [opts] */
  update(counter, dt, opts) {
    if (this.disposed) return;
    const boss = counter?.boss, state = counter?.state;
    const live = !!boss && boss.alive !== false && !!boss.pos && (state === 'veiled' || state === 'open');
    if (!live) { this.shell.visible = false; this.ring.visible = false; return; }
    const reduced = !!opts?.reduced;
    this.t += dt;
    const scale = boss.def?.scale > 0 ? boss.def.scale : 1, pos = boss.pos;
    if (state === 'veiled') {
      this.ring.visible = false; this.shell.visible = true;
      this.shell.position.set(pos.x, SHELL_CENTER * scale, pos.z);
      this.shell.scale.setScalar(SHELL_RADIUS * scale * (reduced ? 1 : 1 + .03 * Math.sin(this.t * 3)));
      this.shellMat.opacity = reduced ? SHELL_OPACITY : SHELL_OPACITY + SHELL_PULSE * Math.sin(this.t * 3);
      return;
    }
    this.shell.visible = false; this.ring.visible = true;
    const total = counter.windowTotal > 0 ? counter.windowTotal : 1;
    const frac = Math.max(0, Math.min(1, counter.windowLeft / total));
    const base = Math.max(RING_MIN_RADIUS, RING_BASE * scale);
    this.ring.position.x = pos.x; this.ring.position.z = pos.z;
    this.ring.scale.setScalar(base * (RING_MIN_FRACTION + (1 - RING_MIN_FRACTION) * frac) * (reduced ? 1 : 1 + .03 * Math.sin(this.t * 8)));
    this.ringMat.opacity = .3 + .6 * frac;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries = []; this.materials = [];
    this.scene = null; this.counter = null;
  }
}
