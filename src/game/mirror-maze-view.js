import * as THREE from 'three';

// 흑사막 심층 거울 미궁(BUNDLE-09)의 거울 두 개와 사라지는 모래 발자국 표시(PLAN 3.2). 연출만 하고 규칙·판정에는 관여하지 않는다.
//
// 읽기 계약: 뷰는 route(FalseThrones)를 읽기만 하고 쓰지 않는다.
//   route: def{ spinColor, stillColor, escape{ trailCount, trailEvery } },
//          maze{ room{ x, z }, phase('idle'|'running'|'done'), real, illusion, trail(Float32Array x,z 쌍), trailN, trailT } | null
// 표시: InstancedMesh 4개 — 거울 틀 2, 거울면 2(인스턴스 색), 모래시계 원뿔 4(인스턴스 색, 거울마다 위·아래 한 쌍), 발자국 trailCount.
//   count = 2 + 2 + 4 + trailCount, draw call ≤ 4. 불투명 재질만 써서 정렬·반투명 패스가 없다.
//   hidden    (미궁 전·maze 없음) 모든 메시 숨김. drawCalls 0.
//   real      진짜 거울(0): 멈춘 밝은 보라(stillColor) 모래시계, 거울면도 stillColor.
//   illusion  환영 거울(1): 도는 어두운 보라(spinColor) 모래시계, 거울면도 spinColor. 모래시계는 거울면 법선 둘레로 돈다.
//   shattered (탈출 뒤) 0.5초 동안 줄어들어 사라진 뒤 모든 메시 숨김.
//   running 이 시작되면 거울이 0.4초 동안 바닥에서 솟는다(reduced 면 즉시). 발자국은 trail 의 앞 trailN 개를 바닥에 찍고,
//   trail 이 다시 채워진 뒤 i 번째가 i × .04초 뒤에 나타나 trailEvery 동안 줄어들어 사라진다(reduced 면 지연·줄어듦 없이 그대로).
// 수명주기: constructor 에서만 geometry/material/InstancedMesh/상태 배열을 만든다. update 에서는 할당하지 않는다
//   (행렬 배열에 직접 기록). 바뀐 인스턴스의 행렬만 쓰고 needsUpdate 도 그때만 올린다. dispose()는 반복 호출해도 안전하다.
// 시간: 솟음·부서짐·모래시계 회전·발자국 경과는 update 에 넘어온 게임 dt 의 누적만 쓴다
//   (Math.random·Date·performance.now 금지, app.step 결정성 유지). dt 0(syncView)은 시간을 진행하지 않는다.
// drawCalls: group·mesh 가시성을 그대로 센다. 첫 update 전에는 출격 준비 compile 을 위해 메시를 보이게 두므로(인스턴스는 scale 0) 4 이고,
//   첫 update 뒤 hidden 이면 0 이다.

/** @typedef {{ reduced: boolean }} MirrorMazeViewOptions */
/** @typedef {'hidden'|'real'|'illusion'|'shattered'} MirrorState */

const RISE_SECONDS = .4, SHATTER_SECONDS = .5, TIME_EPS = 1e-6;
const FOOT_DELAY = .04, FOOT_Y = .03, SPIN_SPEED = 5;
const FRAME_W = 1.9, FRAME_H = 3.1, FRAME_D = .22, FACE_W = 1.5, FACE_H = 2.7, FACE_D = .08;
const GLASS_Y = FRAME_H + .8;                       // 모래시계 중심 높이(두 원뿔의 뾰족한 끝이 만나는 곳)
const CONE_RADIUS = .42, CONE_HEIGHT = .62;
// 발자국은 탈출 단서라 보라 바닥 위에서 읽혀야 한다. smoke-screens-1 844x390 에서 반지름 .2 는 몇 픽셀이라 보이지 않았다.
const FRAME_COLOR = 0xc9a25e, SAND_COLOR = 0xf4dc9c, FOOT_RADIUS = .42;
// 단계 코드(캐시 비교용 정수). mirrorState 의 문자열과 대응한다.
const HIDDEN = 0, RUNNING = 1, DONE = 2;
const FRAME_STATES = Object.freeze([['hidden', 'real', 'shattered'], ['hidden', 'illusion', 'shattered']]);

function phaseCode(maze) {
  const phase = maze ? maze.phase : null;
  return phase === 'running' ? RUNNING : phase === 'done' ? DONE : HIDDEN;
}

/** 순수·무할당 상태 판정. which 0 = 진짜 거울, 1 = 환영 거울. @param {any} route @param {number} which @returns {MirrorState} */
export function mirrorState(route, which) {
  return FRAME_STATES[which === 1 ? 1 : 0][phaseCode(route ? route.maze : null)];
}

/**
 * 열 우선 4x4 행렬 배열에 기저 열 3개와 이동·균일 스케일을 직접 기록한다(임시 객체 없음).
 * 열 (ax, ay, az) 등은 크기 1 의 회전 기저이고 s 를 곱해 쓴다.
 */
function writeBasis(array, i, ax, ay, az, bx, by, bz, cx, cy, cz, tx, ty, tz, s) {
  const o = i * 16;
  array[o] = ax * s; array[o + 1] = ay * s; array[o + 2] = az * s; array[o + 3] = 0;
  array[o + 4] = bx * s; array[o + 5] = by * s; array[o + 6] = bz * s; array[o + 7] = 0;
  array[o + 8] = cx * s; array[o + 9] = cy * s; array[o + 10] = cz * s; array[o + 11] = 0;
  array[o + 12] = tx; array[o + 13] = ty; array[o + 14] = tz; array[o + 15] = 1;
}

/** y 축 회전(yaw)과 균일 스케일. 로컬 +z 가 (sin yaw, 0, cos yaw) 를 향한다. */
function writeYaw(array, i, x, y, z, yaw, s) {
  const c = Math.cos(yaw), n = Math.sin(yaw);
  writeBasis(array, i, c, 0, -n, 0, 1, 0, n, 0, c, x, y, z, s);
}

/** 모래시계 원뿔: y 회전(yaw) · 법선(z) 둘레 회전(spin) · 위쪽 원뿔이면 x 축으로 뒤집기. */
function writeCone(array, i, x, y, z, yaw, spin, flipped, s) {
  const c = Math.cos(yaw), n = Math.sin(yaw), cs = Math.cos(spin), sn = Math.sin(spin);
  // 로컬 기저(뒤집기 전용 · 일반): Rz(spin) 또는 Rz(spin)·Rx(π). 그다음 Ry(yaw)를 곱한다.
  const bx = flipped ? sn : -sn, by = flipped ? -cs : cs, cz = flipped ? -1 : 1;
  writeBasis(array, i,
    c * cs, sn, -n * cs,
    c * bx, by, -n * bx,
    n * cz, 0, c * cz,
    x, y, z, s);
}

const smooth = f => f * f * (3 - 2 * f);

export class MirrorMazeView {
  /** @param {import('three').Object3D} scene @param {any} route */
  constructor(scene, route) {
    this.scene = scene; this.route = route; this.disposed = false;
    const escape = route.def.escape || {};
    this.trailCount = Number.isFinite(escape.trailCount) && escape.trailCount > 0 ? Math.floor(escape.trailCount) : 10;
    this.trailEvery = Number.isFinite(escape.trailEvery) && escape.trailEvery > 0 ? escape.trailEvery : .5;
    this.group = new THREE.Group(); this.group.name = 'TLL_MirrorMaze'; scene.add(this.group);

    const frame = new THREE.BoxGeometry(FRAME_W, FRAME_H, FRAME_D); frame.translate(0, FRAME_H / 2, 0);
    const face = new THREE.BoxGeometry(FACE_W, FACE_H, FACE_D); face.translate(0, FRAME_H / 2, FRAME_D / 2 + FACE_D / 2 - .02);
    const cone = new THREE.ConeGeometry(CONE_RADIUS, CONE_HEIGHT, 12); cone.translate(0, -CONE_HEIGHT / 2, 0);
    const foot = new THREE.CircleGeometry(FOOT_RADIUS, 10); foot.rotateX(-Math.PI / 2); foot.scale(.7, 1, 1.35);
    /** @type {import('three').BufferGeometry[]} */ this.geometries = [frame, face, cone, foot];
    this.frameMat = new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: .4, metalness: .7 });
    this.faceMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.coneMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.footMat = new THREE.MeshBasicMaterial({ color: SAND_COLOR });
    /** @type {import('three').Material[]} */ this.materials = [this.frameMat, this.faceMat, this.coneMat, this.footMat];

    // 인스턴스 메시는 생성자에서만 만든다. 월드 좌표를 행렬에 직접 쓰므로 그룹은 원점에 둔다.
    const inst = (name, geometry, material, count) => {
      const m = new THREE.InstancedMesh(geometry, material, count);
      m.name = name; m.frustumCulled = false; m.visible = false;
      m.instanceMatrix.array.fill(0);
      this.group.add(m); return m;
    };
    this.frame = inst('TLL_MirrorFrames', frame, this.frameMat, 2);
    this.face = inst('TLL_MirrorFaces', face, this.faceMat, 2);
    this.cones = inst('TLL_MirrorHourglass', cone, this.coneMat, 4);
    this.feet = inst('TLL_MirrorFootprints', foot, this.footMat, this.trailCount);
    this.meshes = [this.frame, this.face, this.cones, this.feet];

    // 색은 거울 번호로 정해진다(0 진짜 = stillColor, 1 환영 = spinColor). 첫 setColorAt 할당이 update 로 가지 않게 여기서 채운다.
    const still = new THREE.Color(route.def.stillColor), spin = new THREE.Color(route.def.spinColor);
    for (let m = 0; m < 2; m++) {
      const c = m === 0 ? still : spin;
      this.face.setColorAt(m, c); this.cones.setColorAt(m * 2, c); this.cones.setColorAt(m * 2 + 1, c);
    }

    /** @type {MirrorState[]} */ this.states = ['hidden', 'hidden'];
    this.phase = HIDDEN; this.riseAge = 0; this.shatterAge = 0; this.spinT = 0;
    // 거울별 캐시(바뀐 것만 기록): 스케일·모래시계 각도·위치·방향.
    this.mScale = new Float64Array(2); this.mAngle = new Float64Array(2);
    this.mX = new Float64Array(2).fill(NaN); this.mY = new Float64Array(2).fill(NaN); this.mZ = new Float64Array(2).fill(NaN);
    this.mYaw = new Float64Array(2).fill(NaN);
    // 발자국: trail 이 갱신될 때 위치·방향을 계산해 두고, 시간에 따라 스케일만 바꾼다.
    this.fX = new Float64Array(this.trailCount); this.fZ = new Float64Array(this.trailCount);
    this.fYaw = new Float64Array(this.trailCount); this.fScale = new Float64Array(this.trailCount);
    this.fY = FOOT_Y; this.fN = 0; this.trailClock = 0;
    this.lastTrailT = NaN; this.lastX = NaN; this.lastZ = NaN;
    this.footShown = 0;
    // 첫 update 전에는 출격 준비(fx.prepare → renderer.compile)가 보이는 객체만 순회하므로 메시를 보이게 둔다(모두 scale 0).
    for (const m of this.meshes) m.visible = true;
  }

  /** scale > 0 으로 그려지는 발자국 수. */
  get footprints() { return this.disposed ? 0 : this.footShown; }
  /** 인스턴스 수(틀 2 + 거울면 2 + 모래시계 4 + 발자국). */
  get count() { return this.disposed ? 0 : 8 + this.trailCount; }
  /** 실제로 보이는 메시 수(draw call). */
  get drawCalls() {
    if (this.disposed || !this.group.visible) return 0;
    let n = 0;
    for (const m of this.meshes) if (m.visible) n++;
    return n;
  }

  /** @param {any} route @param {number} dt 게임 시간(0 이면 시간을 진행하지 않는다) @param {MirrorMazeViewOptions} [opts] */
  update(route, dt, opts) {
    if (this.disposed) return;
    const r = route || this.route;
    this.#sync(r, Number.isFinite(dt) && dt > 0 ? dt : 0, !!(opts && opts.reduced));
  }

  #sync(route, advance, reduced) {
    const maze = route.maze || null;
    const code = phaseCode(maze);
    this.states[0] = mirrorState(route, 0); this.states[1] = mirrorState(route, 1);
    if (code !== this.phase) {
      const from = this.phase;
      this.phase = code;
      if (code === RUNNING) { this.riseAge = 0; this.lastTrailT = NaN; }
      // 미궁을 한 번도 보지 못한 채 바로 끝난 상태는 부서짐 연출 없이 숨긴다.
      else if (code === DONE) this.shatterAge = from === RUNNING ? 0 : SHATTER_SECONDS;
      else this.shatterAge = 0;
    }
    if (advance > 0) {
      if (code === RUNNING) { this.riseAge += advance; if (!reduced) this.spinT += advance; }
      else if (code === DONE) this.shatterAge += advance;
    }

    let scale = 0;
    if (code === RUNNING) scale = reduced || this.riseAge >= RISE_SECONDS - TIME_EPS ? 1 : smooth(this.riseAge / RISE_SECONDS);
    else if (code === DONE) scale = reduced || this.shatterAge >= SHATTER_SECONDS - TIME_EPS ? 0 : 1 - this.shatterAge / SHATTER_SECONDS;

    let mirrorShown = false;
    if (maze) {
      const room = maze.room;
      for (let m = 0; m < 2; m++) {
        const p = m === 0 ? maze.real : maze.illusion;
        const angle = m === 1 ? this.spinT * SPIN_SPEED : 0;
        // 거울면은 방 중심을 바라본다(방 정보가 없으면 -z).
        let fx = room && Number.isFinite(room.x) ? room.x - p.x : 0, fz = room && Number.isFinite(room.z) ? room.z - p.z : -1;
        if (fx * fx + fz * fz < 1e-9) { fx = 0; fz = -1; }
        const yaw = Math.atan2(fx, fz);
        if (scale !== this.mScale[m] || angle !== this.mAngle[m] || p.x !== this.mX[m] || p.y !== this.mY[m] || p.z !== this.mZ[m] || yaw !== this.mYaw[m]) {
          this.mScale[m] = scale; this.mAngle[m] = angle; this.mX[m] = p.x; this.mY[m] = p.y; this.mZ[m] = p.z; this.mYaw[m] = yaw;
          writeYaw(this.frame.instanceMatrix.array, m, p.x, p.y, p.z, yaw, scale);
          writeYaw(this.face.instanceMatrix.array, m, p.x, p.y, p.z, yaw, scale);
          const gy = p.y + GLASS_Y * scale;
          writeCone(this.cones.instanceMatrix.array, m * 2, p.x, gy, p.z, yaw, angle, false, scale);
          writeCone(this.cones.instanceMatrix.array, m * 2 + 1, p.x, gy, p.z, yaw, angle, true, scale);
          this.frame.instanceMatrix.needsUpdate = true; this.face.instanceMatrix.needsUpdate = true; this.cones.instanceMatrix.needsUpdate = true;
        }
        if (scale > 0) mirrorShown = true;
      }
    }
    this.frame.visible = mirrorShown; this.face.visible = mirrorShown; this.cones.visible = mirrorShown;
    this.#syncFootprints(maze, code === RUNNING, advance, reduced);
    this.feet.visible = this.footShown > 0;
  }

  #syncFootprints(maze, running, advance, reduced) {
    const cap = this.trailCount, fm = this.feet.instanceMatrix.array;
    let refreshed = false;
    if (running) {
      const trail = maze.trail;
      // trail 이 다시 채워졌는지: 재계산 뒤 trailT 가 커지거나 첫 점이 바뀐다(처음 보는 running 도 갱신으로 본다).
      refreshed = !(maze.trailT <= this.lastTrailT) || trail[0] !== this.lastX || trail[1] !== this.lastZ;
      this.lastTrailT = maze.trailT; this.lastX = trail[0]; this.lastZ = trail[1];
      if (refreshed) {
        const n = Math.max(0, Math.min(cap, Math.floor(maze.trailN) || 0, trail.length >> 1));
        this.fN = n; this.trailClock = 0; this.fY = maze.real.y + FOOT_Y;
        for (let i = 0; i < n; i++) {
          const x = trail[i * 2], z = trail[i * 2 + 1];
          // 진행 방향: 다음 점으로, 마지막 점은 이전 점에서 오던 방향, 한 점뿐이면 진짜 거울 쪽.
          const dx = i < n - 1 ? trail[i * 2 + 2] - x : n > 1 ? x - trail[i * 2 - 2] : maze.real.x - x;
          const dz = i < n - 1 ? trail[i * 2 + 3] - z : n > 1 ? z - trail[i * 2 - 1] : maze.real.z - z;
          this.fYaw[i] = Math.atan2(dx, dz); this.fX[i] = x; this.fZ[i] = z;
        }
      } else this.trailClock += advance;
    } else {
      this.fN = 0; this.lastTrailT = NaN;
    }
    let dirty = false, shown = 0;
    for (let i = 0; i < cap; i++) {
      let s = 0;
      if (i < this.fN) {
        if (reduced) s = 1;
        else {
          const c = this.trailClock - i * FOOT_DELAY;
          s = c < 0 ? 0 : Math.max(0, 1 - c / this.trailEvery);
        }
      }
      if (s > 0) shown++;
      if (s !== this.fScale[i] || (refreshed && s > 0)) {
        this.fScale[i] = s;
        writeYaw(fm, i, this.fX[i], this.fY, this.fZ[i], this.fYaw[i], s);
        dirty = true;
      }
    }
    this.footShown = shown;
    if (dirty) this.feet.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    for (const m of this.meshes) m.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries = []; this.materials = []; this.meshes = [];
    this.scene = null; this.route = null;
  }
}
