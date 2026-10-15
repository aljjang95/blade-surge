import * as THREE from 'three';

// 성운 첨탑 심층(BUNDLE-12)의 외곽 고리 표시(PLAN 3.2). 연출만 하고 규칙·판정에는 관여하지 않는다.
//
// 읽기 계약: 뷰는 route(AstralDeepConstellations)의 ring 과 def.ring 을 읽기만 하고 쓰지 않는다.
//   route.ring: { phase('idle'|'open'|'running'|'done'), center(Vector3), clock(열린 뒤 게임 초), held(유지 중인 성표 번호 또는 -1),
//                 marks[i]{ pos(Vector3), hold, done }, shard{ state('calm'|'warning'|'burst'), age, cycle } }
//   route.def.ring: { marks, markRadius, holdSeconds, warning, core, shards, color }
// 표시: InstancedMesh 6개(모두 불투명 MeshBasicMaterial, 정렬·반투명 패스 없음).
//   고리 선 1(중심 반지름 = 성표까지의 거리, ring.color), 성표 바닥 고리 N, 성표 채움 원 N(유지 비율 = 안쪽 원 scale),
//   파편 shards 개(작은 팔면체), 중심 경계 고리 1(집결 예고 동안), 중심 섬광 원 1(터지는 동안).
//   성표 색: 정화 금색 0xffd060 / 유지 중 ring.color / 그 밖 회색 0x8394ac. 채움은 유지 중 ring.color, 정화되면 금색으로 가득 찬다.
//   파편: calm 이면 고리 위(높이 1.2)에 떠 있고, warning 이면 age / warning 비율로 중심까지 모이며, burst 에는 숨고 섬광이 core 반지름으로 켜진다.
//   위치는 reduced 와 상관없이 같고, reduced 는 파편이 위아래로 흔들리는 장식만 끈다(흔들림도 route.ring.clock 에서 계산해 시간 누적 상태가 없다).
//   phase open|running 일 때만 보인다. done 이면 .5초 동안 줄어든 뒤 숨고(reduced 면 즉시), idle 은 숨긴다.
// 높이: 바닥 연출은 .09~.12(B09 교훈: 얇거나 바닥에 묻히면 844x390 에서 보이지 않는다). 고리 선 .09, 성표 .10, 채움 .11, 중심 경계 .11, 섬광 .12.
// 수명주기: constructor 에서만 geometry/material/InstancedMesh/상태 배열을 만든다. update 에서는 할당하지 않는다
//   (행렬 배열에 직접 기록, 바뀐 인스턴스만 기록하고 그때만 needsUpdate). dispose()는 반복 호출해도 안전하다.
// 시간: 줄어듦은 update 에 넘어온 게임 dt 의 누적만 쓴다(Math.random·Date·performance.now 금지). dt 0(syncView)은 시간을 진행하지 않는다.
// drawCalls: 보이는 메시 수. 첫 update 전에는 출격 준비 compile 을 위해 메시를 보이게 두고(인스턴스는 scale 0),
//   첫 update 뒤에 그릴 것이 없으면 0 이다.

/** @typedef {{ reduced: boolean }} AstralDeepRingViewOptions */

const HIDE_SECONDS = .5, TIME_EPS = 1e-6;
const LINE_Y = .09, MARK_Y = .10, FILL_Y = .11, BORDER_Y = .11, FLASH_Y = .12;
const LINE_WIDTH = .45, MARK_WIDTH = .4, BORDER_WIDTH = .4, FILL_GAP = .1;
const SHARD_RADIUS = .45, SHARD_Y = 1.2, SHARD_DROP = .4, BOB = .12;
const COLOR = Object.freeze({ purified: 0xffd060, idle: 0x8394ac, ring: 0x8fb8ff, border: 0xffb060, flash: 0xdfe8ff, shard: 0xcfe0ff });
// 성표 상태 코드. markState 의 문자열과 1:1.
const IDLE = 0, HELD = 1, PURIFIED = 2;
const MARK_NAMES = Object.freeze(['idle', 'held', 'purified']);
// 단계 코드.
const P_IDLE = 0, P_OPEN = 1, P_RUNNING = 2, P_DONE = 3;

function markCode(ring, i) {
  const mark = ring.marks[i];
  if (mark.done) return PURIFIED;
  return ring.held === i ? HELD : IDLE;
}

/** 순수·무할당 성표 상태 판정. @param {any} ring @param {number} i @returns {'idle'|'held'|'purified'} */
export function markState(ring, i) {
  return MARK_NAMES[markCode(ring, i)];
}

/** 성표 색(0xRRGGBB). 유지 중 색은 정의의 ring.color. @param {'idle'|'held'|'purified'} state @param {any} [def] route.def.ring */
export function markColor(state, def) {
  if (state === 'purified') return COLOR.purified;
  if (state === 'held') return def && Number.isFinite(def.color) ? def.color : COLOR.ring;
  return COLOR.idle;
}

function phaseCode(ring) {
  const phase = ring ? ring.phase : null;
  return phase === 'open' ? P_OPEN : phase === 'running' ? P_RUNNING : phase === 'done' ? P_DONE : P_IDLE;
}

const num = (v, fallback) => Number.isFinite(v) ? v : fallback;
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

export class AstralDeepRingView {
  /** @param {import('three').Object3D} scene @param {any} route */
  constructor(scene, route) {
    this.scene = scene; this.route = route; this.disposed = false;
    const def = route.def.ring;
    this.def = def;
    this.nMarks = def.marks.length; this.nShards = def.shards;
    // 고리 반지름은 첫 성표까지의 거리다(정의의 성표는 모두 같은 반지름 위에 있다).
    this.ringRadius = Math.hypot(def.marks[0][0], def.marks[0][1]);
    this.group = new THREE.Group(); this.group.name = 'TLL_AstralDeepRing'; scene.add(this.group);

    const flat = g => g.rotateX(-Math.PI / 2);
    const markRadius = num(def.markRadius, 1.4), fillRadius = Math.max(.2, markRadius - MARK_WIDTH - FILL_GAP);
    const lineGeometry = flat(new THREE.RingGeometry(this.ringRadius - LINE_WIDTH / 2, this.ringRadius + LINE_WIDTH / 2, 96));
    const markGeometry = flat(new THREE.RingGeometry(markRadius - MARK_WIDTH, markRadius, 40));
    const fillGeometry = flat(new THREE.CircleGeometry(fillRadius, 32));
    const shardGeometry = new THREE.OctahedronGeometry(SHARD_RADIUS);
    const core = num(def.core, 3.4);
    const borderGeometry = flat(new THREE.RingGeometry(core - BORDER_WIDTH, core, 64));
    const flashGeometry = flat(new THREE.CircleGeometry(core, 48));
    /** @type {import('three').BufferGeometry[]} */ this.geometries = [lineGeometry, markGeometry, fillGeometry, shardGeometry, borderGeometry, flashGeometry];
    this.whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.shardMat = new THREE.MeshBasicMaterial({ color: COLOR.shard });
    /** @type {import('three').Material[]} */ this.materials = [this.whiteMat, this.shardMat];

    // 인스턴스 메시는 생성자에서만 만든다. 월드 좌표를 행렬에 직접 쓰므로 그룹은 원점에 둔다.
    const inst = (name, geometry, material, count) => {
      const m = new THREE.InstancedMesh(geometry, material, count);
      m.name = name; m.frustumCulled = false; m.visible = false;
      this.group.add(m); return m;
    };
    this.line = inst('TLL_AstralDeepRingLine', lineGeometry, this.whiteMat, 1);
    this.marks = inst('TLL_AstralDeepRingMarks', markGeometry, this.whiteMat, this.nMarks);
    this.fills = inst('TLL_AstralDeepRingFills', fillGeometry, this.whiteMat, this.nMarks);
    this.shards = inst('TLL_AstralDeepRingShards', shardGeometry, this.shardMat, this.nShards);
    this.border = inst('TLL_AstralDeepRingCoreBorder', borderGeometry, this.whiteMat, 1);
    this.flash = inst('TLL_AstralDeepRingCoreFlash', flashGeometry, this.whiteMat, 1);
    this.meshes = [this.line, this.marks, this.fills, this.shards, this.border, this.flash];
    this.shown = new Int32Array(this.meshes.length);

    // 행렬 캐시: 인스턴스마다 [x, y, z, sx, sy, sz]. NaN 이면 아직 쓰지 않은 것이라 첫 기록은 항상 일어난다.
    this.cache = new Map();
    for (const m of this.meshes) this.cache.set(m, new Float64Array(m.count * 6).fill(NaN));
    this.scratch = new THREE.Color();
    // 색 캐시(인스턴스별 0xRRGGBB, -1 이면 미기록). 색 버퍼는 여기서 만들어 update 의 첫 setColorAt 할당을 없앤다.
    this.colorCache = new Map();
    for (const m of [this.line, this.marks, this.fills, this.border, this.flash]) {
      for (let i = 0; i < m.count; i++) m.setColorAt(i, this.scratch.setHex(COLOR.idle));
      this.colorCache.set(m, new Int32Array(m.count).fill(-1));
    }
    for (const m of this.meshes) for (let i = 0; i < m.count; i++) this.#put(m, i, 0, 0, 0, 0, 0, 0);

    // 파편 방향(성표 사이 22.5° 어긋난 곳)을 미리 계산해 update 에서 삼각함수 배열을 만들지 않는다.
    this.cos = new Float64Array(this.nShards); this.sin = new Float64Array(this.nShards);
    for (let k = 0; k < this.nShards; k++) {
      const a = (k + .5) * Math.PI * 2 / this.nShards;
      this.cos[k] = Math.cos(a); this.sin[k] = Math.sin(a);
    }
    this.phase = P_IDLE; this.doneAge = HIDE_SECONDS;
    // 첫 update 전에는 출격 준비(fx.prepare → renderer.compile)가 보이는 객체만 순회하므로 메시를 보이게 둔다(모두 scale 0).
    for (const m of this.meshes) m.visible = true;
  }

  /** 실제로 보이는 메시 수(draw call). */
  get drawCalls() {
    if (this.disposed || !this.group.visible) return 0;
    let n = 0;
    for (const m of this.meshes) if (m.visible) n++;
    return n;
  }

  /** 행렬을 쓴다(회전 없음). 값이 같으면 아무것도 하지 않는다. */
  #put(mesh, i, x, y, z, sx, sy, sz) {
    const c = this.cache.get(mesh), o = i * 6;
    if (c[o] === x && c[o + 1] === y && c[o + 2] === z && c[o + 3] === sx && c[o + 4] === sy && c[o + 5] === sz) return;
    c[o] = x; c[o + 1] = y; c[o + 2] = z; c[o + 3] = sx; c[o + 4] = sy; c[o + 5] = sz;
    const a = mesh.instanceMatrix.array, p = i * 16;
    a[p] = sx; a[p + 1] = 0; a[p + 2] = 0; a[p + 3] = 0;
    a[p + 4] = 0; a[p + 5] = sy; a[p + 6] = 0; a[p + 7] = 0;
    a[p + 8] = 0; a[p + 9] = 0; a[p + 10] = sz; a[p + 11] = 0;
    a[p + 12] = x; a[p + 13] = y; a[p + 14] = z; a[p + 15] = 1;
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** 인스턴스 색을 쓴다. 값이 같으면 아무것도 하지 않는다. */
  #paint(mesh, i, hex) {
    const c = this.colorCache.get(mesh);
    if (c[i] === hex) return;
    c[i] = hex;
    mesh.setColorAt(i, this.scratch.setHex(hex));
    mesh.instanceColor.needsUpdate = true;
  }

  /** @param {any} route @param {number} dt 게임 시간(0 이면 시간을 진행하지 않는다) @param {AstralDeepRingViewOptions} [opts] */
  update(route, dt, opts) {
    if (this.disposed) return;
    const r = route || this.route, ring = r.ring || null, advance = Number.isFinite(dt) && dt > 0 ? dt : 0, reduced = !!(opts && opts.reduced);
    const code = phaseCode(ring);
    if (code !== this.phase) {
      const from = this.phase;
      this.phase = code;
      // 고리를 한 번도 보지 못한 채 바로 끝난 상태는 줄어드는 연출 없이 숨긴다.
      this.doneAge = code === P_DONE && (from === P_OPEN || from === P_RUNNING) ? 0 : HIDE_SECONDS;
    }
    if (advance > 0 && code === P_DONE) this.doneAge += advance;
    let scale = 0;
    if (code === P_OPEN || code === P_RUNNING) scale = 1;
    else if (code === P_DONE) scale = reduced || this.doneAge >= HIDE_SECONDS - TIME_EPS ? 0 : 1 - this.doneAge / HIDE_SECONDS;
    const live = code === P_OPEN || code === P_RUNNING;
    this.#syncBase(ring, scale);
    this.#syncShards(ring, live, reduced);
    for (let k = 0; k < this.meshes.length; k++) this.meshes[k].visible = this.shown[k] > 0;
  }

  /** 고리 선·성표·채움(open|running|done 의 줄어듦 동안). */
  #syncBase(ring, scale) {
    const def = this.def, n = this.nMarks;
    if (scale <= 0) {
      this.#put(this.line, 0, 0, LINE_Y, 0, 0, 0, 0);
      for (let i = 0; i < n; i++) { this.#put(this.marks, i, 0, MARK_Y, 0, 0, 0, 0); this.#put(this.fills, i, 0, FILL_Y, 0, 0, 0, 0); }
      this.shown[0] = 0; this.shown[1] = 0; this.shown[2] = 0;
      return;
    }
    const c = ring.center, hold = Math.max(1e-6, num(def.holdSeconds, 1));
    this.#put(this.line, 0, c.x, LINE_Y, c.z, scale, scale, scale);
    this.#paint(this.line, 0, num(def.color, COLOR.ring));
    let fills = 0;
    for (let i = 0; i < n; i++) {
      const mark = ring.marks[i], code = markCode(ring, i), p = mark.pos;
      this.#put(this.marks, i, p.x, MARK_Y, p.z, scale, scale, scale);
      const hex = markColor(MARK_NAMES[code], def);
      this.#paint(this.marks, i, hex);
      // 채움: 정화되면 가득, 유지 중이면 hold 비율, 그 밖은 없다.
      const f = code === PURIFIED ? 1 : clamp01(num(mark.hold, 0) / hold), s = f * scale;
      this.#put(this.fills, i, p.x, FILL_Y, p.z, s, s, s);
      this.#paint(this.fills, i, hex);
      if (s > 0) fills++;
    }
    this.shown[0] = 1; this.shown[1] = n; this.shown[2] = fills;
  }

  /** 파편 집결(warning 동안 중심으로 모임), 중심 경계 고리, 중심 섬광. */
  #syncShards(ring, live, reduced) {
    const def = this.def, n = this.nShards;
    const state = live && ring.shard ? ring.shard.state : null, burst = state === 'burst', warning = state === 'warning';
    if (!live) {
      for (let k = 0; k < n; k++) this.#put(this.shards, k, 0, 0, 0, 0, 0, 0);
      this.#put(this.border, 0, 0, BORDER_Y, 0, 0, 0, 0); this.#put(this.flash, 0, 0, FLASH_Y, 0, 0, 0, 0);
      this.shown[3] = 0; this.shown[4] = 0; this.shown[5] = 0;
      return;
    }
    const c = ring.center;
    let shards = 0;
    if (burst) {
      for (let k = 0; k < n; k++) this.#put(this.shards, k, c.x, SHARD_Y, c.z, 0, 0, 0);
    } else {
      // 집결 비율: 위치는 age / warning 으로만 정해 reduced 여도 같다.
      const f = warning ? clamp01(num(ring.shard.age, 0) / Math.max(1e-6, num(def.warning, 1.5))) : 0;
      const radius = this.ringRadius * (1 - f), baseY = SHARD_Y - f * SHARD_DROP;
      const clock = num(ring.clock, 0);
      for (let k = 0; k < n; k++) {
        const y = baseY + (reduced ? 0 : Math.sin(clock * 4 + k * 1.3) * BOB);
        this.#put(this.shards, k, c.x + this.cos[k] * radius, y, c.z + this.sin[k] * radius, 1, 1, 1);
      }
      shards = n;
    }
    this.shown[3] = shards;
    // 위험 범위는 집결 예고 동안 미리 보이고, 터지는 순간 섬광이 같은 반지름을 채운다.
    if (warning) { this.#put(this.border, 0, c.x, BORDER_Y, c.z, 1, 1, 1); this.#paint(this.border, 0, COLOR.border); }
    else this.#put(this.border, 0, c.x, BORDER_Y, c.z, 0, 0, 0);
    this.shown[4] = warning ? 1 : 0;
    if (burst) { this.#put(this.flash, 0, c.x, FLASH_Y, c.z, 1, 1, 1); this.#paint(this.flash, 0, COLOR.flash); }
    else this.#put(this.flash, 0, c.x, FLASH_Y, c.z, 0, 0, 0);
    this.shown[5] = burst ? 1 : 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    for (const m of this.meshes) m.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries = []; this.materials = []; this.meshes = [];
    this.cache = null; this.colorCache = null; this.scene = null; this.route = null;
  }
}
