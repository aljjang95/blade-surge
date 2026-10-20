import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 일식 수문 역류 밸브(일반 3·심층 4)의 월드 표시(BUNDLE-07 PLAN 3.2).
//
// 읽기 계약: 뷰는 route(RouteObjectives)를 읽기만 하고 쓰지 않는다.
//   route: gates[i].room{ x, z, discovered }, gates[i].attuned, progress, hold, def{ holdSeconds, radius, cueColor }
// 표시: 밸브마다 기둥(+손잡이), 청록 물줄기, 바닥 고리를 InstancedMesh 3개로 그린다(draw call ≤ 3).
//   hidden  방 미발견: 세 인스턴스 모두 scale 0.
//   sealed  attuned: 물줄기 0(멈춤), 손잡이는 끝까지 돌아간 채 고정, 고리 금색.
//   holding 차례이면서 hold > 0: 물줄기 높이 1 − hold/holdSeconds(최소 .15), 고리 청록, 손잡이가 hold 만큼 돈다.
//   next    차례: 물줄기 전체 높이, 밝은 청록 고리.
//   waiting 그 밖: 물줄기 낮은 높이(.5), 회색 고리. 바닥만 봐도 남은 것·차례·끝난 것이 구분된다.
// 배치: 기둥·물줄기는 방 중심에서 대각선(+x, −z) 방향으로 def.radius + .8 떨어진 곳(유지 원 밖이라 영웅을 가리지 않는다).
//   방 사이 복도는 축 방향이라, 축 위(+x)에 두면 영웅·AUTO 가 충돌체 없는 기둥을 뚫고 지나간다(BUNDLE-07 리뷰 P3).
//   고리는 방 중심에 둔다. 고리 반지름은 def.radius 라서 유지 판정 원(RouteObjectives.update 의 hypot <= radius)과 같다.
//   링의 바깥 가장자리가 곧 판정 경계이므로 두께는 안쪽(radius − RING_WIDTH ~ radius)으로만 둔다.
// 수명주기: constructor 에서만 geometry/material/InstancedMesh/임시값을 만든다. update 에서는 할당하지 않는다
//   (행렬 배열 직접 기록, 미리 만든 Color 복사만). 행렬·색은 상태나 높이가 바뀐 인스턴스만 쓰고 needsUpdate 도 그때만 올린다.
//   dispose()는 scene 제거와 geometry/material/InstancedMesh 해제를 하며 반복 호출해도 안전하다.
// 시간: 맥동은 update 에 넘어온 게임 dt 의 누적 시계만 쓴다(Math.random·Date·performance.now 금지, app.step 결정성 유지).

/** @typedef {{ reduced: boolean }} BackflowValveViewOptions */
/** @typedef {'hidden'|'sealed'|'holding'|'next'|'waiting'} ValveState */

const RING_WIDTH = .16;                  // 바닥 고리 두께(바깥 반지름 = def.radius)
const PILLAR_OFFSET = .8;                // 유지 원 바깥쪽 여유
const PILLAR_DIR_X = Math.SQRT1_2, PILLAR_DIR_Z = -Math.SQRT1_2;   // 축 방향 복도를 피하는 대각선
const PILLAR_HEIGHT = 2.3, STREAM_HEIGHT = 3.4, STREAM_RADIUS = .5;
const RING_Y = .07, STREAM_Y = .05;
const WAITING_HEIGHT = .5, HOLD_MIN_HEIGHT = .15;
const HANDLE_TURN = Math.PI * 1.5;       // 봉인 완료 때 손잡이가 돈 각도
const PULSE_AMP = .08, PULSE_SPEED = 4.5, PULSE_PHASE = 1.7;
// 바닥 표식의 그리기 순서(comet-deep-orbit-view FLOOR_ORDER 와 같은 층): 지면 VFX(8~9)보다 뒤, 빌보드·플립북(11 이상)보다 앞.
const ORDER = Object.freeze({ ring: 10.2, stream: 10.5 });
const COLOR = Object.freeze({ sealed: 0xffd060, waiting: 0x8394ac, pillar: 0x6f8199 });
// 상태 코드(캐시 비교용 정수). valveState 의 문자열과 1:1.
const HIDDEN = 0, SEALED = 1, HOLDING = 2, NEXT = 3, WAITING = 4;
const STATE_NAMES = Object.freeze(['hidden', 'sealed', 'holding', 'next', 'waiting']);

/** 순수·무할당 상태 판정. @param {any} route @param {number} i @returns {ValveState} */
export function valveState(route, i) {
  return STATE_NAMES[stateCode(route, i)];
}

function stateCode(route, i) {
  const gate = route.gates[i];
  if (!gate.room.discovered) return HIDDEN;
  if (gate.attuned) return SEALED;
  if (i === route.progress) return route.hold > 0 ? HOLDING : NEXT;
  return WAITING;
}

/** 열 우선 4x4 행렬 배열에 y 회전·축별 스케일·이동을 직접 기록한다(임시 객체 없음). */
function writeMatrix(array, i, x, y, z, sx, sy, sz, rotY) {
  const o = i * 16, c = Math.cos(rotY), s = Math.sin(rotY);
  array[o] = c * sx; array[o + 1] = 0; array[o + 2] = -s * sx; array[o + 3] = 0;
  array[o + 4] = 0; array[o + 5] = sy; array[o + 6] = 0; array[o + 7] = 0;
  array[o + 8] = s * sz; array[o + 9] = 0; array[o + 10] = c * sz; array[o + 11] = 0;
  array[o + 12] = x; array[o + 13] = y; array[o + 14] = z; array[o + 15] = 1;
}

export class BackflowValveView {
  /** @param {import('three').Object3D} scene @param {any} route */
  constructor(scene, route) {
    this.scene = scene; this.route = route; this.disposed = false; this.t = 0; this.reduced = true;
    const d = route.def, n = route.gates.length;
    this.n = n; this.radius = d.radius; this.holdSeconds = d.holdSeconds > 0 ? d.holdSeconds : 1;
    this.group = new THREE.Group(); this.group.name = 'TLL_BackflowValves'; scene.add(this.group);

    // 기둥(받침 + 몸통 + 손잡이)을 한 geometry 로 병합한다.
    const parts = [
      new THREE.BoxGeometry(1.1, .3, 1.1).translate(0, .15, 0),
      new THREE.CylinderGeometry(.3, .38, PILLAR_HEIGHT, 12).translate(0, PILLAR_HEIGHT / 2 + .3, 0),
      new THREE.BoxGeometry(1.2, .14, .16).translate(0, PILLAR_HEIGHT + .45, 0),
    ];
    const pillarGeometry = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    const streamGeometry = new THREE.CylinderGeometry(STREAM_RADIUS, STREAM_RADIUS, 1, 16, 1, true).translate(0, .5, 0);
    const ringGeometry = new THREE.RingGeometry(d.radius - RING_WIDTH, d.radius, 64).rotateX(-Math.PI / 2);
    /** @type {import('three').BufferGeometry[]} */ this.geometries = [pillarGeometry, streamGeometry, ringGeometry];
    this.pillarMat = new THREE.MeshStandardMaterial({ color: COLOR.pillar, roughness: .45, metalness: .5 });
    // 반투명 양면 재질은 three 가 뒷면·앞면 두 번 그리고 그때마다 재질을 다시 처리한다(draw call 2배, 프레임 루프 할당).
    // 물줄기는 열린 원기둥이라 양면이 필요하므로 forceSinglePass 로 한 번에 그린다(fx.js·arena.js 관례). 바닥 고리는 위를 보는 앞면만 그린다.
    this.streamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .55, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .85, depthWrite: false, side: THREE.FrontSide });
    /** @type {import('three').Material[]} */ this.materials = [this.pillarMat, this.streamMat, this.ringMat];

    // 인스턴스 메시는 생성자에서만 만든다. 월드 좌표를 행렬에 직접 쓰므로 그룹은 원점에 둔다.
    const inst = (name, geometry, material, order) => {
      const m = new THREE.InstancedMesh(geometry, material, n);
      m.name = name; m.renderOrder = order; m.frustumCulled = false; m.visible = false;
      this.group.add(m); return m;
    };
    this.pillar = inst('TLL_BackflowValvePillars', pillarGeometry, this.pillarMat, 0);   // 불투명이라 일반 순서
    this.stream = inst('TLL_BackflowValveStreams', streamGeometry, this.streamMat, ORDER.stream);
    this.ring = inst('TLL_BackflowValveRings', ringGeometry, this.ringMat, ORDER.ring);

    // update 가 재사용하는 색(미리 만들어 둔다)과 인스턴스별 캐시.
    const color = hex => new THREE.Color(hex);
    this.colors = {
      sealed: color(COLOR.sealed), waiting: color(COLOR.waiting),
      holding: color(d.cueColor), next: color(d.cueColor).lerp(color(0xffffff), .45),
    };
    this.state = new Int8Array(n).fill(-1);
    this.height = new Float64Array(n);
    this.width = new Float64Array(n).fill(1);
    this.angle = new Float64Array(n);
    this.px = new Float64Array(n); this.pz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const room = route.gates[i].room;
      this.px[i] = room.x + (d.radius + PILLAR_OFFSET) * PILLAR_DIR_X; this.pz[i] = room.z + (d.radius + PILLAR_OFFSET) * PILLAR_DIR_Z;
      // 인스턴스 색 버퍼를 미리 만든다(update 에서 첫 setColorAt 할당 방지). 모두 hidden 이라 scale 0.
      this.ring.setColorAt(i, this.colors.waiting); this.stream.setColorAt(i, this.colors.waiting);
      writeMatrix(this.pillar.instanceMatrix.array, i, this.px[i], 0, this.pz[i], 0, 0, 0, 0);
      writeMatrix(this.stream.instanceMatrix.array, i, this.px[i], STREAM_Y, this.pz[i], 0, 0, 0, 0);
      writeMatrix(this.ring.instanceMatrix.array, i, room.x, RING_Y, room.z, 0, 0, 0, 0);
    }
    this.pillarShown = 0; this.streamShown = 0; this.ringShown = 0;
    this.#sync(route);
    // 출격 준비(fx.prepare → renderer.compile)는 보이는 객체만 순회한다. 첫 update 전까지 세 메시를 보이게 두어
    // 인스턴싱·인스턴스 색 프로그램을 출격 준비에서 미리 만든다(방 2 첫 발견 때 컴파일 끊김 방지, 리뷰 P2-2).
    // 아직 발견한 방이 없으면 모든 인스턴스가 scale 0 이라 화면에는 아무것도 보이지 않고 drawCalls 는 0 이다.
    this.pillar.visible = true; this.stream.visible = true; this.ring.visible = true;
  }

  /** 보이는 인스턴스가 하나 이상인 InstancedMesh 수(draw call). */
  get drawCalls() {
    if (this.disposed) return 0;
    return (this.pillar.visible && this.pillarShown > 0 ? 1 : 0) + (this.stream.visible && this.streamShown > 0 ? 1 : 0) +
      (this.ring.visible && this.ringShown > 0 ? 1 : 0);
  }
  /** 밸브 수(인스턴스 수). */
  get count() { return this.disposed ? 0 : this.n; }

  /** @param {any} route @param {number} dt 게임 시간 @param {BackflowValveViewOptions} [opts] */
  update(route, dt, opts) {
    if (this.disposed) return;
    if (Number.isFinite(dt) && dt > 0 && !opts?.reduced) this.t += dt;
    this.reduced = !!opts?.reduced;
    this.#sync(route || this.route);
  }

  #sync(route) {
    const n = this.n, reduced = this.reduced;
    let pillarDirty = false, streamDirty = false, ringDirty = false, colorDirty = false, streamColorDirty = false;
    let pillars = 0, streams = 0, rings = 0;
    const pm = this.pillar.instanceMatrix.array, sm = this.stream.instanceMatrix.array, rm = this.ring.instanceMatrix.array;
    for (let i = 0; i < n; i++) {
      const code = stateCode(route, i), room = route.gates[i].room;
      let h = 0, angle = 0;
      if (code === SEALED) angle = HANDLE_TURN;
      else if (code === HOLDING) {
        const frac = Math.min(1, Math.max(0, route.hold / this.holdSeconds));
        h = Math.max(HOLD_MIN_HEIGHT, 1 - frac); angle = HANDLE_TURN * frac;
      } else if (code === NEXT) h = 1;
      else if (code === WAITING) h = WAITING_HEIGHT;
      // 물줄기 폭 맥동: reduced 면 1 로 고정(정지).
      const w = h > 0 && !reduced ? 1 + PULSE_AMP * Math.sin(this.t * PULSE_SPEED + i * PULSE_PHASE) : 1;
      const stateChanged = code !== this.state[i];
      if (stateChanged) {
        this.state[i] = code;
        const shown = code !== HIDDEN ? 1 : 0;
        writeMatrix(rm, i, room.x, RING_Y, room.z, shown, shown, shown, 0); ringDirty = true;
        if (code === SEALED) this.ring.setColorAt(i, this.colors.sealed);
        else if (code === HOLDING) this.ring.setColorAt(i, this.colors.holding);
        else if (code === NEXT) this.ring.setColorAt(i, this.colors.next);
        else this.ring.setColorAt(i, this.colors.waiting);
        colorDirty = true;
        if (code === NEXT) this.stream.setColorAt(i, this.colors.next);
        else this.stream.setColorAt(i, this.colors.holding);
        streamColorDirty = true;
      }
      if (stateChanged || angle !== this.angle[i]) {
        this.angle[i] = angle;
        const shown = code !== HIDDEN ? 1 : 0;
        writeMatrix(pm, i, this.px[i], 0, this.pz[i], shown, shown, shown, angle); pillarDirty = true;
      }
      if (stateChanged || h !== this.height[i] || w !== this.width[i]) {
        this.height[i] = h; this.width[i] = w;
        writeMatrix(sm, i, this.px[i], STREAM_Y, this.pz[i], h > 0 ? w : 0, h * STREAM_HEIGHT, h > 0 ? w : 0, 0); streamDirty = true;
      }
      if (code !== HIDDEN) { pillars++; rings++; }
      if (h > 0) streams++;
    }
    this.pillarShown = pillars; this.streamShown = streams; this.ringShown = rings;
    if (pillarDirty) this.pillar.instanceMatrix.needsUpdate = true;
    if (streamDirty) this.stream.instanceMatrix.needsUpdate = true;
    if (ringDirty) this.ring.instanceMatrix.needsUpdate = true;
    if (colorDirty && this.ring.instanceColor) this.ring.instanceColor.needsUpdate = true;
    if (streamColorDirty && this.stream.instanceColor) this.stream.instanceColor.needsUpdate = true;
    this.pillar.visible = pillars > 0; this.stream.visible = streams > 0; this.ring.visible = rings > 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    for (const m of [this.pillar, this.stream, this.ring]) m.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries = []; this.materials = [];
    this.scene = null; this.route = null;
  }
}
