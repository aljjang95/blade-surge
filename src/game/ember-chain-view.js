import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 재벼림 심층 심장로(BUNDLE-08)의 사슬에 묶인 불씨 해방 표시(PLAN 3.2). 연출만 하고 규칙·판정에는 관여하지 않는다.
//
// 읽기 계약: 뷰는 route(CoolingValves)를 읽기만 하고 쓰지 않는다.
//   route: gates[i]{ room{ discovered }, pos, ready, attuned }, progress, padOpen(gate)(없으면 열림), def{ releaseSeconds }
// 표시: 심장로마다 사슬 4가닥과 묶인 불씨 6개. InstancedMesh 2개(사슬, 불씨)라서 draw call ≤ 2, count = gates × 10.
//   hidden    방 미발견: 둘 다 scale 0.
//   bound     차례가 아니거나 아직 정리 중: 철색 사슬, 어두운 주황 불씨.
//   shock     차례이고 준비됐지만 조작판이 닫힘(망치 충격파 대기): 붉게 달군 사슬, 주황 불씨.
//   open      차례이고 조작판이 열림: 밝은 금빛 사슬, 밝은 불씨.
//   releasing 냉각됨: 사슬은 0.6초 동안 떨어지며 사라지고, 불씨는 releaseSeconds 동안 4 떠오르며 사라진다.
//   released  그 뒤: 둘 다 scale 0.
// 배치(심장로 위치 gate.pos 기준): 사슬 4가닥은 바닥 모서리 (±1.6, ±1.6)에서 (±.3, 2.2, ±.3) 로 안쪽 위로 솟는다.
//   냉각 장치 본체 위쪽에서 모이는 형태라 장치 앞 시야를 가르지 않는다. 겹침 확인(CoolingValves·coolingVent 기준):
//   조작판 고리는 x = ∓3.5(side 반대편)에 반지름 1.6 이라 바깥 가장자리가 |x| = 1.9 에서 시작하고 사슬 발은 |x| = 1.6 이라 닿지 않는다
//   (모서리 (−1.6, ±1.6)에서 판 중심까지 2.48 > 1.6). 분출 띠는 x = ±3.5 중심 폭 4 라 |x| = 1.5 ~ 5.5 이고,
//   사슬 발(|x| = 1.6)이 띠 안쪽 가장자리에서 .1 안으로 들어온다. 사슬은 가는 막대(마디 폭 ≈ .22, 굵기 ≈ .05)이고 위로 갈수록
//   중심으로 기울어 띠 위를 덮지 않으므로, 바닥에 깔린 띠의 해칭·테두리는 그대로 읽힌다. 발은 좌우(side 가 번갈아 바뀜) 모두에 있어 어느 쪽이든 같다.
//   불씨 6개는 장치 아래쪽(반지름 .75 ~ 1.0, 높이 .5 ~ 1.0)에 모여 있어 두 표식 모두 건드리지 않는다.
// 수명주기: constructor 에서만 geometry/material/InstancedMesh/임시값/상태 배열을 만든다. update 에서는 할당하지 않는다
//   (행렬 배열 직접 기록, 미리 만든 Color 복사만). 바뀐 인스턴스의 행렬·색만 쓰고 needsUpdate 도 그때만 올린다.
//   dispose()는 scene 제거와 geometry/material/InstancedMesh 해제를 하며 반복 호출해도 안전하다.
// 시간: 해방 경과 시간(releaseAge)과 불씨 흔들림은 update 에 넘어온 게임 dt 의 누적만 쓴다
//   (Math.random·Date·performance.now 금지, app.step 결정성 유지). dt 0(syncView)은 시간을 진행하지 않는다.

/** @typedef {{ reduced: boolean }} EmberChainViewOptions */
/** @typedef {'hidden'|'bound'|'shock'|'open'|'releasing'|'released'} FurnaceState */

const CHAINS_PER_FURNACE = 4, EMBERS_PER_FURNACE = 6;
const CHAIN_FOOT = 1.6, CHAIN_TOP_Y = 2.2, CHAIN_TOP_XZ = .3;
const CHAIN_LINKS = 9;                       // 한 가닥을 이루는 고리 마디 수(번갈아 90도 돌려 맞물린 모양)
const CHAIN_FALL_SECONDS = .6, CHAIN_FALL_DROP = 2.2;
const EMBER_RADIUS = .17, EMBER_RISE = 4, EMBER_BOB = .06, EMBER_BOB_SPEED = 3, EMBER_SPIN = 1.2;
const EMBER_SCALE = Object.freeze([0, .85, 1, 1.15, 1, 0]);   // 상태 코드별 크기(hidden, bound, shock, open, releasing, released)
const DEFAULT_RELEASE_SECONDS = 1.6;
const COLOR = Object.freeze({
  chainBound: 0x5a5048, chainShock: 0xc0452a, chainOpen: 0xffb060,
  emberBound: 0xa04018, emberShock: 0xff8030, emberOpen: 0xffd080,
});
// 상태 코드(캐시 비교용 정수). furnaceState 의 문자열과 1:1.
const HIDDEN = 0, BOUND = 1, SHOCK = 2, OPEN = 3, RELEASING = 4, RELEASED = 5;
const STATE_NAMES = Object.freeze(['hidden', 'bound', 'shock', 'open', 'releasing', 'released']);

// 사슬 한 가닥의 실제 길이(발 → 윗점). 단위 길이 geometry 를 이 값만큼 늘이므로 마디가 둥글게 보이도록 미리 y 를 줄여 둔다.
const CHAIN_LENGTH = Math.hypot(CHAIN_FOOT - CHAIN_TOP_XZ, CHAIN_FOOT - CHAIN_TOP_XZ, CHAIN_TOP_Y);

/** 순수·무할당 상태 판정. @param {any} route @param {number} i @param {number} releaseAge @returns {FurnaceState} */
export function furnaceState(route, i, releaseAge) {
  return STATE_NAMES[stateCode(route, i, releaseAge, releaseSecondsOf(route))];
}

function releaseSecondsOf(route) {
  const s = route?.def?.releaseSeconds;
  return Number.isFinite(s) && s > 0 ? s : DEFAULT_RELEASE_SECONDS;
}

function stateCode(route, i, releaseAge, releaseSeconds) {
  const gate = route.gates[i];
  if (!gate.room.discovered) return HIDDEN;
  if (gate.attuned) return releaseAge < releaseSeconds ? RELEASING : RELEASED;
  if (i === route.progress) {
    // padOpen 이 없는 정의는 조작판이 늘 열려 있다(일반 냉각 장치와 같은 뜻).
    const open = typeof route.padOpen === 'function' ? !!route.padOpen(gate) : true;
    if (open) return OPEN;
    if (gate.ready) return SHOCK;
  }
  return BOUND;
}

/** 열 우선 4x4 행렬 배열에 y 회전·균일 스케일·이동을 직접 기록한다(임시 객체 없음). */
function writeEmber(array, i, x, y, z, s, rotY) {
  const o = i * 16, c = Math.cos(rotY) * s, n = Math.sin(rotY) * s;
  array[o] = c; array[o + 1] = 0; array[o + 2] = -n; array[o + 3] = 0;
  array[o + 4] = 0; array[o + 5] = s; array[o + 6] = 0; array[o + 7] = 0;
  array[o + 8] = n; array[o + 9] = 0; array[o + 10] = c; array[o + 11] = 0;
  array[o + 12] = x; array[o + 13] = y; array[o + 14] = z; array[o + 15] = 1;
}

/** 사슬 한 가닥: 기저(x', 단위 y', z')에 폭 배율 s·길이 배율 s*CHAIN_LENGTH 를 곱하고 발 위치 (fx, fy, fz)에 놓는다. */
function writeChain(array, i, basis, b, fx, fy, fz, s) {
  const o = i * 16, L = CHAIN_LENGTH * s;
  array[o] = basis[b] * s; array[o + 1] = basis[b + 1] * s; array[o + 2] = basis[b + 2] * s; array[o + 3] = 0;
  array[o + 4] = basis[b + 3] * L; array[o + 5] = basis[b + 4] * L; array[o + 6] = basis[b + 5] * L; array[o + 7] = 0;
  array[o + 8] = basis[b + 6] * s; array[o + 9] = basis[b + 7] * s; array[o + 10] = basis[b + 8] * s; array[o + 11] = 0;
  array[o + 12] = fx; array[o + 13] = fy; array[o + 14] = fz; array[o + 15] = 1;
}

/** 고리 마디를 이어 붙인 단위 길이(y 0 ~ 1) 사슬 geometry. */
function buildChainGeometry() {
  const parts = [];
  const pitch = CHAIN_LENGTH / CHAIN_LINKS;
  for (let k = 0; k < CHAIN_LINKS; k++) {
    const link = new THREE.TorusGeometry(.085, .026, 4, 8);
    link.scale(1, 1.7, 1);                                  // 세로로 긴 타원 마디
    if (k % 2) link.rotateY(Math.PI / 2);
    link.translate(0, (k + .5) * pitch, 0);
    link.scale(1, 1 / CHAIN_LENGTH, 1);                     // 길이를 1 로 정규화
    parts.push(link);
  }
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

export class EmberChainView {
  /** @param {import('three').Object3D} scene @param {any} route */
  constructor(scene, route) {
    this.scene = scene; this.route = route; this.disposed = false; this.t = 0;
    const n = route.gates.length;
    this.n = n; this.releaseSeconds = releaseSecondsOf(route);
    this.group = new THREE.Group(); this.group.name = 'TLL_EmberChains'; scene.add(this.group);

    const chainGeometry = buildChainGeometry();
    const emberGeometry = new THREE.OctahedronGeometry(EMBER_RADIUS, 0);
    /** @type {import('three').BufferGeometry[]} */ this.geometries = [chainGeometry, emberGeometry];
    // 둘 다 불투명이라 일반 순서·한 패스로 그린다. 색은 인스턴스 색으로만 정한다.
    this.chainMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .55, metalness: .25 });
    this.emberMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    /** @type {import('three').Material[]} */ this.materials = [this.chainMat, this.emberMat];

    // 인스턴스 메시는 생성자에서만 만든다. 월드 좌표를 행렬에 직접 쓰므로 그룹은 원점에 둔다.
    const inst = (name, geometry, material, count) => {
      const m = new THREE.InstancedMesh(geometry, material, count);
      m.name = name; m.frustumCulled = false; m.visible = false;
      this.group.add(m); return m;
    };
    this.chain = inst('TLL_EmberChainLinks', chainGeometry, this.chainMat, n * CHAINS_PER_FURNACE);
    this.ember = inst('TLL_EmberChainEmbers', emberGeometry, this.emberMat, n * EMBERS_PER_FURNACE);

    const color = hex => new THREE.Color(hex);
    this.chainColors = [color(COLOR.chainBound), color(COLOR.chainBound), color(COLOR.chainShock), color(COLOR.chainOpen), color(COLOR.chainBound), color(COLOR.chainBound)];
    this.emberColors = [color(COLOR.emberBound), color(COLOR.emberBound), color(COLOR.emberShock), color(COLOR.emberOpen), color(COLOR.emberOpen), color(COLOR.emberBound)];

    // 사슬 가닥별 정적 기저(x', 단위 y', z')와 발 위치, 불씨별 정적 위치·위상. 상태 배열도 여기서 한 번만 만든다.
    this.basis = new Float64Array(CHAINS_PER_FURNACE * 9);
    this.footX = new Float64Array(CHAINS_PER_FURNACE); this.footZ = new Float64Array(CHAINS_PER_FURNACE);
    for (let k = 0; k < CHAINS_PER_FURNACE; k++) {
      const sx = k & 1 ? 1 : -1, sz = k & 2 ? 1 : -1;
      const dx = sx * (CHAIN_TOP_XZ - CHAIN_FOOT), dy = CHAIN_TOP_Y, dz = sz * (CHAIN_TOP_XZ - CHAIN_FOOT);
      const ux = dx / CHAIN_LENGTH, uy = dy / CHAIN_LENGTH, uz = dz / CHAIN_LENGTH;
      // x' = normalize(ŷ × u), z' = x' × u (오른손 기저)
      let ax = uz, az = -ux; const al = Math.hypot(ax, az); ax /= al; az /= al;
      const bx = -az * uy, by = az * ux - ax * uz, bz = ax * uy;
      this.basis.set([ax, 0, az, ux, uy, uz, bx, by, bz], k * 9);
      this.footX[k] = sx * CHAIN_FOOT; this.footZ[k] = sz * CHAIN_FOOT;
    }
    this.emberX = new Float64Array(EMBERS_PER_FURNACE); this.emberZ = new Float64Array(EMBERS_PER_FURNACE);
    this.emberY = new Float64Array(EMBERS_PER_FURNACE); this.emberPhase = new Float64Array(EMBERS_PER_FURNACE);
    for (let k = 0; k < EMBERS_PER_FURNACE; k++) {
      const a = k / EMBERS_PER_FURNACE * Math.PI * 2 + .4, r = .75 + (k % 2) * .25;
      this.emberX[k] = Math.cos(a) * r; this.emberZ[k] = Math.sin(a) * r;
      this.emberY[k] = .5 + (k % 3) * .25; this.emberPhase[k] = k * 1.7;
    }
    /** @type {FurnaceState[]} */ this.states = new Array(n).fill('hidden');
    this.code = new Int8Array(n).fill(-1);
    this.releaseAge = new Float64Array(n); this.seen = new Uint8Array(n);
    this.chainScale = new Float64Array(n).fill(-1); this.chainDrop = new Float64Array(n);
    this.eY = new Float64Array(n * EMBERS_PER_FURNACE).fill(NaN);
    this.eS = new Float64Array(n * EMBERS_PER_FURNACE).fill(-1);
    this.eR = new Float64Array(n * EMBERS_PER_FURNACE);
    this.chainShown = 0; this.emberShown = 0;
    // 인스턴스 색 버퍼를 미리 만든다(update 에서 첫 setColorAt 할당 방지). 행렬은 0 으로 채워 scale 0 으로 시작한다.
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < CHAINS_PER_FURNACE; k++) this.chain.setColorAt(i * CHAINS_PER_FURNACE + k, this.chainColors[BOUND]);
      for (let k = 0; k < EMBERS_PER_FURNACE; k++) this.ember.setColorAt(i * EMBERS_PER_FURNACE + k, this.emberColors[BOUND]);
    }
    this.chain.instanceMatrix.array.fill(0); this.ember.instanceMatrix.array.fill(0);
    this.#sync(route, 0, false);
    // 출격 준비(fx.prepare → renderer.compile)는 보이는 객체만 순회한다. 첫 update 전까지 두 메시를 보이게 두어
    // 인스턴싱·인스턴스 색 프로그램을 미리 만든다. 아직 보일 인스턴스가 없으면 scale 0 이라 화면에는 아무것도 보이지 않고 drawCalls 는 0 이다.
    this.chain.visible = true; this.ember.visible = true;
  }

  /** 보이는 인스턴스가 하나 이상인 InstancedMesh 수(draw call). */
  get drawCalls() {
    if (this.disposed) return 0;
    return (this.chain.visible && this.chainShown > 0 ? 1 : 0) + (this.ember.visible && this.emberShown > 0 ? 1 : 0);
  }
  /** 인스턴스 수(사슬 + 불씨). */
  get count() { return this.disposed ? 0 : this.n * (CHAINS_PER_FURNACE + EMBERS_PER_FURNACE); }

  /** @param {any} route @param {number} dt 게임 시간(0 이면 시간을 진행하지 않는다) @param {EmberChainViewOptions} [opts] */
  update(route, dt, opts) {
    if (this.disposed) return;
    const advance = Number.isFinite(dt) && dt > 0 ? dt : 0;
    this.#sync(route || this.route, advance, !!opts?.reduced);
  }

  #sync(route, advance, reduced) {
    const n = this.n, rs = this.releaseSeconds;
    if (advance > 0 && !reduced) this.t += advance;
    const t = this.t;
    const cm = this.chain.instanceMatrix.array, em = this.ember.instanceMatrix.array;
    let chainDirty = false, emberDirty = false, chainColorDirty = false, emberColorDirty = false;
    let chainShown = 0, emberShown = 0;
    for (let i = 0; i < n; i++) {
      const gate = route.gates[i];
      if (gate.attuned) {
        if (!this.seen[i]) { this.seen[i] = 1; this.releaseAge[i] = 0; } else this.releaseAge[i] += advance;
      }
      const age = this.releaseAge[i];
      const code = stateCode(route, i, age, rs);
      const changed = code !== this.code[i];
      if (changed) {
        this.code[i] = code; this.states[i] = STATE_NAMES[code];
        for (let k = 0; k < CHAINS_PER_FURNACE; k++) this.chain.setColorAt(i * CHAINS_PER_FURNACE + k, this.chainColors[code]);
        for (let k = 0; k < EMBERS_PER_FURNACE; k++) this.ember.setColorAt(i * EMBERS_PER_FURNACE + k, this.emberColors[code]);
        chainColorDirty = true; emberColorDirty = true;
      }
      const px = gate.pos.x, py = gate.pos.y, pz = gate.pos.z;

      // 사슬: 해방 중에는 처음 CHAIN_FALL_SECONDS 동안 아래로 떨어지며 줄어든다. reduced 면 즉시 사라진다.
      let cs = 1, drop = 0;
      if (code === HIDDEN || code === RELEASED) cs = 0;
      else if (code === RELEASING) {
        const f = reduced ? 1 : Math.min(1, age / CHAIN_FALL_SECONDS);
        cs = 1 - f; drop = CHAIN_FALL_DROP * f * f;
      }
      if (changed || cs !== this.chainScale[i] || drop !== this.chainDrop[i]) {
        this.chainScale[i] = cs; this.chainDrop[i] = drop;
        for (let k = 0; k < CHAINS_PER_FURNACE; k++) {
          writeChain(cm, i * CHAINS_PER_FURNACE + k, this.basis, k * 9, px + this.footX[k], py - drop, pz + this.footZ[k], cs);
        }
        chainDirty = true;
      }
      if (cs > 0) chainShown += CHAINS_PER_FURNACE;

      // 불씨: 묶인 동안은 게임 시간으로 흔들리고(reduced 면 정지), 해방 중에는 위로 떠오르며 줄어든다(reduced 면 제자리에서 줄어든다).
      const base = EMBER_SCALE[code];
      const rp = code === RELEASING ? Math.min(1, age / rs) : 0;
      const es = code === RELEASING ? base * (1 - rp) : base;
      for (let k = 0; k < EMBERS_PER_FURNACE; k++) {
        const e = i * EMBERS_PER_FURNACE + k;
        let y = this.emberY[k], rot = this.emberPhase[k];
        if (code === RELEASING) { if (!reduced) y += EMBER_RISE * rp; }
        else if (!reduced && code !== HIDDEN && code !== RELEASED) {
          y += EMBER_BOB * Math.sin(t * EMBER_BOB_SPEED + this.emberPhase[k]); rot += t * EMBER_SPIN;
        }
        if (es !== this.eS[e] || y !== this.eY[e] || rot !== this.eR[e]) {
          this.eS[e] = es; this.eY[e] = y; this.eR[e] = rot;
          writeEmber(em, e, px + this.emberX[k], py + y, pz + this.emberZ[k], es, rot);
          emberDirty = true;
        }
        if (es > 0) emberShown++;
      }
    }
    this.chainShown = chainShown; this.emberShown = emberShown;
    if (chainDirty) this.chain.instanceMatrix.needsUpdate = true;
    if (emberDirty) this.ember.instanceMatrix.needsUpdate = true;
    if (chainColorDirty && this.chain.instanceColor) this.chain.instanceColor.needsUpdate = true;
    if (emberColorDirty && this.ember.instanceColor) this.ember.instanceColor.needsUpdate = true;
    this.chain.visible = chainShown > 0; this.ember.visible = emberShown > 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.chain.dispose(); this.ember.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries = []; this.materials = [];
    this.scene = null; this.route = null;
  }
}
