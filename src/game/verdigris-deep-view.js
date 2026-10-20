import * as THREE from 'three';

// 녹청 심층(BUNDLE-11)의 생명 제단 4곳과 포자 수로 표시(PLAN 3.2). 연출만 하고 규칙·판정에는 관여하지 않는다.
//
// 읽기 계약: 뷰는 route(VerdigrisDeepAltars)를 읽기만 하고 쓰지 않는다.
//   route: def{ radius, cueColor, wrongStep{ color }, channel{ color, bands } },
//          gates[i]{ room{ x, z, discovered }, ready, attuned }, lit(점등된 gate 또는 null), litMoves(점등이 옮겨 간 횟수),
//          channel{ phase('idle'|'open'|'running'|'done'), exit(Vector3), minZ, maxZ, startX, finishX,
//                   bands[i]{ x, half, state('calm'|'warning'|'burst'), age } } | null
// 표시: InstancedMesh 7개(모두 불투명 MeshBasicMaterial, 정렬·반투명 패스 없음).
//   제단  바닥 고리(인스턴스 색 = 상태), 받침, 빛 기둥(점등 제단만).  수로  띠 4, 포자 구슬(띠마다 6), 출발선·도착선 2, 출구 고리 1.
//   제단 고리  room.discovered 일 때만. 점등 cueColor / 정화(attuned) 금색 / 정화됐지만 비점등(ready) wrongStep.color / 그 밖 회색.
//   빛 기둥    점등 제단만. litMoves 가 바뀐 update 에서 새 점등 제단 기둥이 .6초 동안 솟는다(reduced 면 즉시).
//   수로      phase open|running 일 때만 보인다. 띠 색 calm 어두운 초록 / warning 연노랑 / burst def.channel.color.
//             warning 에는 낮은 새싹 구슬, burst 에는 높이 솟는 구슬이 붙어 색이 비슷해도 모양으로 구분된다.
//             done 이면 .5초 동안 줄어든 뒤 숨는다(reduced 면 즉시). idle 은 숨김.
// 높이: 바닥 연출은 .09~.12(B09 교훈: 얇거나 바닥에 묻히면 844x390 에서 보이지 않는다). 띠 폭 2·half, 줄 폭 .5, 고리 두께 .45.
// 수명주기: constructor 에서만 geometry/material/InstancedMesh/상태 배열을 만든다. update 에서는 할당하지 않는다
//   (행렬 배열에 직접 기록, 바뀐 인스턴스만 기록하고 그때만 needsUpdate). dispose()는 반복 호출해도 안전하다.
// 시간: 솟음·줄어듦은 update 에 넘어온 게임 dt 의 누적만 쓴다(Math.random·Date·performance.now 금지).
//   구슬 높이는 route 가 주는 band.age 로 정한다. dt 0(syncView)은 시간을 진행하지 않는다.
// drawCalls: 보이는 메시 수. 첫 update 전에는 출격 준비 compile 을 위해 메시를 보이게 두고(인스턴스는 scale 0),
//   첫 update 뒤에 그릴 것이 없으면 0 이다.

/** @typedef {{ reduced: boolean }} VerdigrisDeepViewOptions */
/** @typedef {'hidden'|'purified'|'lit'|'danger'|'idle'} AltarState */
/** @typedef {'calm'|'warning'|'burst'} BandState */

const RISE_SECONDS = .6, HIDE_SECONDS = .5, TIME_EPS = 1e-6;
const RING_Y = .10, PED_H = .32, BAND_Y = .09, LINE_Y = .11, EXIT_Y = .11, ORB_BASE_Y = .3;
const RING_WIDTH = .45, BEAM_HEIGHT = 6, LINE_WIDTH = .5, EXIT_RADIUS = 1.8, EXIT_WIDTH = .5;
const ORBS_PER_BAND = 6, ORB_RADIUS = .42, ORB_RISE = 2.2, ORB_SPREAD = 1.8, SPROUT_SCALE = .45;
const COLOR = Object.freeze({ purified: 0xffd060, idle: 0x8394ac, danger: 0xb06cff, cue: 0x72e6ae, ped: 0x4a5d52,
  calm: 0x2f5d3a, warning: 0xd6f06a, burst: 0x9be86a, orb: 0xd8ffa8, start: 0xe8f6ee, finish: 0xffd060, exitOpen: 0xb8f0c8 });
// 상태 코드(캐시 비교용 정수). altarState 의 문자열과 1:1.
const HIDDEN = 0, PURIFIED = 1, LIT = 2, DANGER = 3, IDLE = 4;
const ALTAR_NAMES = Object.freeze(['hidden', 'purified', 'lit', 'danger', 'idle']);
// 수로 단계 코드.
const CH_IDLE = 0, CH_OPEN = 1, CH_RUNNING = 2, CH_DONE = 3;

function litGate(route) {
  return route.lit === undefined ? route.gates[route.progress] || null : route.lit;
}

function altarCode(route, i, lit) {
  const gate = route.gates[i];
  if (!gate.room.discovered) return HIDDEN;
  if (gate.attuned) return PURIFIED;
  if (gate === lit) return LIT;
  return gate.ready ? DANGER : IDLE;
}

/** 순수·무할당 제단 상태 판정. @param {any} route @param {number} i @returns {AltarState} */
export function altarState(route, i) {
  return ALTAR_NAMES[altarCode(route, i, litGate(route))];
}

/** 순수 띠 상태 판정. 알 수 없는 값은 calm. @param {any} band @returns {BandState} */
export function bandState(band) {
  const s = band ? band.state : null;
  return s === 'burst' ? 'burst' : s === 'warning' ? 'warning' : 'calm';
}

/** 띠 색(0xRRGGBB). burst 색은 정의의 channel.color. @param {BandState} state @param {any} [def] */
export function bandColor(state, def) {
  if (state === 'burst') return def && def.channel && Number.isFinite(def.channel.color) ? def.channel.color : COLOR.burst;
  return state === 'warning' ? COLOR.warning : COLOR.calm;
}

function channelCode(channel) {
  const phase = channel ? channel.phase : null;
  return phase === 'open' ? CH_OPEN : phase === 'running' ? CH_RUNNING : phase === 'done' ? CH_DONE : CH_IDLE;
}

const smooth = f => f * f * (3 - 2 * f);
const num = (v, fallback) => Number.isFinite(v) ? v : fallback;

export class VerdigrisDeepView {
  /** @param {import('three').Object3D} scene @param {any} route */
  constructor(scene, route) {
    this.scene = scene; this.route = route; this.disposed = false;
    const def = route.def;
    this.nAltars = route.gates.length;
    this.nBands = Array.isArray(def.channel?.bands) ? def.channel.bands.length : 4;
    this.group = new THREE.Group(); this.group.name = 'TLL_VerdigrisDeep'; scene.add(this.group);

    const flat = g => g.rotateX(-Math.PI / 2);
    const radius = num(def.radius, 3);
    const ringGeometry = flat(new THREE.RingGeometry(radius - RING_WIDTH, radius, 48));
    const pedGeometry = new THREE.CylinderGeometry(.8, .95, PED_H, 16).translate(0, PED_H / 2, 0);
    const beamGeometry = new THREE.CylinderGeometry(.22, .42, 1, 12).translate(0, .5, 0);
    const planeGeometry = flat(new THREE.PlaneGeometry(1, 1));
    const orbGeometry = new THREE.IcosahedronGeometry(ORB_RADIUS, 1);
    const exitGeometry = flat(new THREE.RingGeometry(EXIT_RADIUS - EXIT_WIDTH, EXIT_RADIUS, 40));
    /** @type {import('three').BufferGeometry[]} */ this.geometries = [ringGeometry, pedGeometry, beamGeometry, planeGeometry, orbGeometry, exitGeometry];
    const basic = hex => new THREE.MeshBasicMaterial({ color: hex });
    this.whiteMat = basic(0xffffff); this.pedMat = basic(COLOR.ped);
    this.beamMat = basic(num(def.cueColor, COLOR.cue)); this.orbMat = basic(COLOR.orb);
    /** @type {import('three').Material[]} */ this.materials = [this.whiteMat, this.pedMat, this.beamMat, this.orbMat];

    // 인스턴스 메시는 생성자에서만 만든다. 월드 좌표를 행렬에 직접 쓰므로 그룹은 원점에 둔다.
    const inst = (name, geometry, material, count) => {
      const m = new THREE.InstancedMesh(geometry, material, count);
      m.name = name; m.frustumCulled = false; m.visible = false;
      this.group.add(m); return m;
    };
    const A = this.nAltars, B = this.nBands;
    this.ring = inst('TLL_VerdigrisAltarRings', ringGeometry, this.whiteMat, A);
    this.ped = inst('TLL_VerdigrisAltarBases', pedGeometry, this.pedMat, A);
    this.beam = inst('TLL_VerdigrisAltarBeams', beamGeometry, this.beamMat, A);
    this.bands = inst('TLL_VerdigrisSporeBands', planeGeometry, this.whiteMat, B);
    this.orbs = inst('TLL_VerdigrisSporeOrbs', orbGeometry, this.orbMat, B * ORBS_PER_BAND);
    this.lines = inst('TLL_VerdigrisChannelLines', planeGeometry, this.whiteMat, 2);
    this.exit = inst('TLL_VerdigrisChannelExit', exitGeometry, this.whiteMat, 1);
    this.meshes = [this.ring, this.ped, this.beam, this.bands, this.orbs, this.lines, this.exit];

    // 행렬 캐시: 인스턴스마다 [x, y, z, sx, sy, sz]. NaN 이면 아직 쓰지 않은 것이라 첫 기록은 항상 일어난다.
    this.cache = new Map();
    for (const m of this.meshes) this.cache.set(m, new Float64Array(m.count * 6).fill(NaN));
    this.scratch = new THREE.Color();
    // 색 캐시(인스턴스별 0xRRGGBB, -1 이면 미기록). 색 버퍼는 여기서 만들어 update 의 첫 setColorAt 할당을 없앤다.
    this.colorCache = new Map();
    for (const m of [this.ring, this.bands, this.lines, this.exit]) {
      for (let i = 0; i < m.count; i++) m.setColorAt(i, this.scratch.setHex(COLOR.idle));
      this.colorCache.set(m, new Int32Array(m.count).fill(-1));
    }
    for (const m of this.meshes) for (let i = 0; i < m.count; i++) this.#put(m, i, 0, 0, 0, 0, 0, 0);

    this.cueHex = num(def.cueColor, COLOR.cue); this.dangerHex = num(def.wrongStep?.color, COLOR.danger);
    this.orbPhase = new Float64Array(ORBS_PER_BAND);
    for (let k = 0; k < ORBS_PER_BAND; k++) this.orbPhase[k] = (k * .37) % 1;
    // 점등 이동 연출.
    this.lastMoves = num(route.litMoves, 0); this.riseAge = RISE_SECONDS; this.riseIndex = -1;
    // 수로 연출.
    this.phase = CH_IDLE; this.doneAge = HIDE_SECONDS;
    this.shown = new Int32Array(this.meshes.length);
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

  /** @param {any} route @param {number} dt 게임 시간(0 이면 시간을 진행하지 않는다) @param {VerdigrisDeepViewOptions} [opts] */
  update(route, dt, opts) {
    if (this.disposed) return;
    const r = route || this.route, advance = Number.isFinite(dt) && dt > 0 ? dt : 0, reduced = !!(opts && opts.reduced);
    this.#syncAltars(r, advance, reduced);
    this.#syncChannel(r, advance, reduced);
    for (let k = 0; k < this.meshes.length; k++) this.meshes[k].visible = this.shown[k] > 0;
  }

  #syncAltars(route, advance, reduced) {
    const lit = litGate(route), moves = num(route.litMoves, 0), n = this.nAltars;
    if (moves !== this.lastMoves) {
      this.lastMoves = moves; this.riseAge = 0; this.riseIndex = lit ? route.gates.indexOf(lit) : -1;
    } else if (advance > 0 && this.riseAge < RISE_SECONDS) this.riseAge += advance;
    const rise = reduced || this.riseAge >= RISE_SECONDS - TIME_EPS ? 1 : smooth(this.riseAge / RISE_SECONDS);
    let rings = 0, beams = 0;
    for (let i = 0; i < n; i++) {
      const code = altarCode(route, i, lit), room = route.gates[i].room;
      const shown = code !== HIDDEN ? 1 : 0;
      this.#put(this.ring, i, room.x, RING_Y, room.z, shown, shown, shown);
      this.#put(this.ped, i, room.x, 0, room.z, shown, shown, shown);
      if (shown) {
        rings++;
        this.#paint(this.ring, i, code === PURIFIED ? COLOR.purified : code === LIT ? this.cueHex : code === DANGER ? this.dangerHex : COLOR.idle);
      }
      // 기둥은 점등 제단만. h 가 0 이면 scale 0 이라 그려지지 않는다.
      const h = code === LIT ? (i === this.riseIndex ? rise : 1) : 0;
      this.#put(this.beam, i, room.x, 0, room.z, h > 0 ? 1 : 0, h * BEAM_HEIGHT, h > 0 ? 1 : 0);
      if (h > 0) beams++;
    }
    this.shown[0] = rings; this.shown[1] = rings; this.shown[2] = beams;
  }

  #syncChannel(route, advance, reduced) {
    const ch = route.channel || null, code = channelCode(ch);
    if (code !== this.phase) {
      const from = this.phase;
      this.phase = code;
      // 수로를 한 번도 보지 못한 채 바로 끝난 상태는 줄어드는 연출 없이 숨긴다.
      this.doneAge = code === CH_DONE && (from === CH_OPEN || from === CH_RUNNING) ? 0 : HIDE_SECONDS;
    }
    if (advance > 0 && code === CH_DONE) this.doneAge += advance;
    let scale = 0;
    if (code === CH_OPEN || code === CH_RUNNING) scale = 1;
    else if (code === CH_DONE) scale = reduced || this.doneAge >= HIDE_SECONDS - TIME_EPS ? 0 : 1 - this.doneAge / HIDE_SECONDS;
    if (scale > 0 && !(ch.maxZ > ch.minZ)) scale = 0;
    const len = scale > 0 ? ch.maxZ - ch.minZ : 0, cz = scale > 0 ? (ch.minZ + ch.maxZ) / 2 : 0;
    const def = route.def, half = num(def.channel?.bandHalf, 1.1);
    let bands = 0, orbs = 0;
    for (let i = 0; i < this.nBands; i++) {
      const band = scale > 0 && ch.bands ? ch.bands[i] : null;
      if (!band) {
        this.#put(this.bands, i, 0, BAND_Y, 0, 0, 0, 0);
        for (let k = 0; k < ORBS_PER_BAND; k++) this.#put(this.orbs, i * ORBS_PER_BAND + k, 0, 0, 0, 0, 0, 0);
        continue;
      }
      const state = bandState(band), x = num(band.x, 0), w = num(band.half, half) * 2;
      this.#put(this.bands, i, x, BAND_Y, cz, w * scale, scale, len * scale); bands++;
      this.#paint(this.bands, i, bandColor(state, def));
      const burst = state === 'burst', warning = state === 'warning';
      const f = burst ? Math.min(1, Math.max(0, num(band.age, 0) / num(def.channel?.burst, .7))) : 0;
      for (let k = 0; k < ORBS_PER_BAND; k++) {
        const ph = this.orbPhase[k], idx = i * ORBS_PER_BAND + k;
        let s = 0, y = ORB_BASE_Y;
        if (burst) {
          // 위로 솟다가 끝에서 줄어든다. reduced 면 솟은 중간 모습으로 멈춘다.
          const g = reduced ? .5 : f;
          y = ORB_BASE_Y + g * (ORB_RISE + ph * ORB_SPREAD);
          s = (.8 + .4 * ph) * (!reduced && f > .75 ? (1 - f) * 4 : 1);
        } else if (warning) s = SPROUT_SCALE;
        s *= scale;
        const ox = ((k % 3) - 1) * half * .55, oz = cz - len / 2 + (k + .5) * len / ORBS_PER_BAND;
        if (s > 0) orbs++;
        this.#put(this.orbs, idx, x + ox, y, oz, s, s, s);
      }
    }
    this.shown[3] = bands; this.shown[4] = orbs;
    // 출발선·도착선, 출구 고리.
    let lines = 0, exits = 0;
    if (scale > 0) {
      const sx = num(ch.startX, num(def.channel?.startLine, 0)), fx = num(ch.finishX, num(def.channel?.finishLine, 0));
      this.#put(this.lines, 0, sx, LINE_Y, cz, LINE_WIDTH * scale, scale, len * scale);
      this.#put(this.lines, 1, fx, LINE_Y, cz, LINE_WIDTH * scale, scale, len * scale);
      this.#paint(this.lines, 0, COLOR.start); this.#paint(this.lines, 1, COLOR.finish);
      lines = 2;
      const exit = ch.exit;
      if (exit && Number.isFinite(exit.x) && Number.isFinite(exit.z)) {
        this.#put(this.exit, 0, exit.x, EXIT_Y, exit.z, scale, scale, scale);
        this.#paint(this.exit, 0, code === CH_RUNNING ? COLOR.finish : COLOR.exitOpen);
        exits = 1;
      } else this.#put(this.exit, 0, 0, EXIT_Y, 0, 0, 0, 0);
    } else {
      this.#put(this.lines, 0, 0, LINE_Y, 0, 0, 0, 0); this.#put(this.lines, 1, 0, LINE_Y, 0, 0, 0, 0);
      this.#put(this.exit, 0, 0, EXIT_Y, 0, 0, 0, 0);
    }
    this.shown[5] = lines; this.shown[6] = exits;
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
