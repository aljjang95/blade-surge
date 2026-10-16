import * as THREE from 'three';

// 재벼림 심층 보스방 거수의 사슬 끊기 월드 표시(BUNDLE-15 PLAN 3.4). 연출만 하고 규칙·판정에는 관여하지 않는다.
//
// 읽기 계약: 뷰는 chains(AshforgeChainBreak)를 읽기만 하고 쓰지 않는다.
//   chains: state('idle'|'chained'|'open'|'exposed'|'unchained'|'ended'), def{ radius },
//           boss{ pos, alive, def.scale }, count, chainsLeft, pulling, pullSide, pillar(Vector3), anchor(Vector3),
//           hold, holdTotal, windowLeft, windowTotal, exposedLeft, exposedTotal, lastCutT(마지막 끊김 뒤 경과 초, 없으면 Infinity)
// 표시:
//   chained(끌기 없음)  남은 사슬(chainsLeft)이 보스 둘레 바닥에 방사로 짧게 늘어진다(철색).
//   chained(끌기 중)    남은 사슬이 보스 몸 가장자리에서 anchor 로 팽팽히 이어진다(달군 붉은색). 반대편 pillar 에 회색 기둥 고리.
//   open                같은 선이 금빛이 되고 기둥은 청록으로 열린다. 채움 원판의 반지름·밝기가 hold/holdTotal 에 비례한다(0 이면 테두리만).
//   exposed             남은 사슬은 늘어진다. lastCutT < .6 동안 끊긴 사슬 하나(chainsLeft 번째 칸)가 떨어지며 작아진다(reduced 면 즉시 숨김). 기둥 숨김.
//   idle·unchained·ended·보스 없음·보스 사망  전부 숨김.
// 메시 예산(draw call): 사슬 마디 InstancedMesh 1 + 기둥 고리 1 + 채움 원판 1 = 최대 3. 코드로 만든 geometry 만 쓴다.
//   마디는 사슬당 최대 12(끌기·열림 선은 길이에 비례, 늘어짐은 5). 인스턴스 수 = count × 12.
// 수명주기: constructor 에서만 geometry/material/mesh/색을 만든다. update 에서는 할당하지 않는다(숫자 대입·행렬 배열 직접 기록뿐).
//   사슬 메시는 첫 update 전까지 보이게 두어(그릴 인스턴스는 없음) 출격 준비 컴파일이 인스턴싱 프로그램을 미리 만들게 한다(EmberChainView 와 같다).
//   dispose()는 scene 에서 제거하고 geometry/material/InstancedMesh 를 해제하며 반복 호출해도 안전하다.
// 시간: 흔들림 위상은 update 에 넘어온 게임 dt 의 누적만 쓴다(Math.random·Date·performance.now 금지). dt 0 이면 진행하지 않고,
//   reduced 면 흔들림(위상)도 멈춘다. 끊김 연출의 진행은 컨트롤러의 lastCutT 를 읽는다.

/** @typedef {{ reduced: boolean }} AshforgeChainViewOptions */

const MAX_LINKS = 12, SLACK_LINKS = 5, LANE = 1.1;
const LINK_BASE_PITCH = .36;          // 기본 크기 마디가 맞물려 이어지는 간격
const TAUT_PITCH = .7, TAUT_SCALE_MIN = .8, TAUT_SCALE_MAX = 3;
const SLACK_SCALE = 1.5, BODY_RADIUS = .7, SLACK_GAP = .4;
const LINK_Y = .14, STAND_LIFT = .13;  // 바닥 마디 높이(.08 이상), 세운 마디는 반지름만큼 더 올린다
const CUT_SECONDS = .6, FALL_HEIGHT = .8;
const RING_Y = .1, FILL_Y = .09, RING_WIDTH = .3, FILL_GAP = .1, DEFAULT_RADIUS = 1.6;
const SHAKE = .05, SWAY = .06;
const COLOR = Object.freeze({ slack: 0x5a5048, pull: 0xc0452a, open: 0xffb060, pillarPull: 0x6d7a86, pillarOpen: 0x5ff0d0 });
const FILL_MIN = .35, FILL_MAX = .7;
// 그리기 순서: 지면 VFX(8~9)보다 뒤, 빌보드·플립북(11 이상)보다 앞.
const ORDER = Object.freeze({ fill: 10.55, ring: 10.6 });
// 사슬 색 코드(캐시 비교용 정수).
const SLACK = 0, PULL = 1, OPEN = 2;

/** 바닥에 누운 가로로 긴 타원 마디(길이 축 x, 고리 축 y). */
function buildLinkGeometry() {
  const link = new THREE.TorusGeometry(.13, .04, 5, 10);
  link.scale(1.6, 1, 1);
  link.rotateX(Math.PI / 2);
  return link;
}
function flat(geometry) { geometry.rotateX(-Math.PI / 2); return geometry; }

/** 열 우선 4x4 행렬 배열에 한 마디를 직접 기록한다(임시 객체 없음). 길이 축은 (dx, dz)이고 flip 이면 고리를 세워 맞물린 모양을 만든다. */
function writeLink(array, i, x, y, z, dx, dz, s, flip) {
  const o = i * 16;
  array[o] = dx * s; array[o + 1] = 0; array[o + 2] = dz * s; array[o + 3] = 0;
  if (flip) {
    array[o + 4] = -dz * s; array[o + 5] = 0; array[o + 6] = dx * s; array[o + 7] = 0;
    array[o + 8] = 0; array[o + 9] = -s; array[o + 10] = 0; array[o + 11] = 0;
    array[o + 13] = y + STAND_LIFT * s;
  } else {
    array[o + 4] = 0; array[o + 5] = s; array[o + 6] = 0; array[o + 7] = 0;
    array[o + 8] = -dz * s; array[o + 9] = 0; array[o + 10] = dx * s; array[o + 11] = 0;
    array[o + 13] = y;
  }
  array[o + 12] = x; array[o + 14] = z; array[o + 15] = 1;
}

export class AshforgeChainBreakView {
  /** @param {import('three').Object3D} scene @param {any} chains */
  constructor(scene, chains) {
    this.scene = scene; this.chains = chains; this.disposed = false; this.t = 0;
    this.capacity = Math.max(1, Math.floor(chains?.count > 0 ? chains.count : chains?.def?.count > 0 ? chains.def.count : 3));
    const radius = chains?.def?.radius > 0 ? chains.def.radius : DEFAULT_RADIUS;
    this.group = new THREE.Group(); this.group.name = 'TLL_AshforgeChainBreakView'; scene.add(this.group);

    const linkGeometry = buildLinkGeometry();
    const ringGeometry = flat(new THREE.RingGeometry(Math.max(.1, radius - RING_WIDTH), radius, 48));
    const fillGeometry = flat(new THREE.CircleGeometry(Math.max(.1, radius - RING_WIDTH - FILL_GAP), 40));
    /** @type {import('three').BufferGeometry[]} */ this.geometries = [linkGeometry, ringGeometry, fillGeometry];
    // 사슬은 불투명이고 색은 인스턴스 색으로만 정한다(정면 조명에 의존하지 않도록 MeshBasicMaterial).
    this.linkMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.ringMat = new THREE.MeshBasicMaterial({ color: COLOR.pillarPull, transparent: true, opacity: .75, depthWrite: false, side: THREE.DoubleSide });
    this.fillMat = new THREE.MeshBasicMaterial({ color: COLOR.pillarOpen, transparent: true, opacity: FILL_MIN, depthWrite: false, side: THREE.DoubleSide });
    /** @type {import('three').Material[]} */ this.materials = [this.linkMat, this.ringMat, this.fillMat];

    this.links = new THREE.InstancedMesh(linkGeometry, this.linkMat, this.capacity * MAX_LINKS);
    this.links.name = 'TLL_AshforgeChainLinks'; this.links.frustumCulled = false; this.links.visible = true;
    this.ring = new THREE.Mesh(ringGeometry, this.ringMat);
    this.ring.name = 'TLL_AshforgeChainPillar'; this.ring.renderOrder = ORDER.ring; this.ring.frustumCulled = false; this.ring.visible = false;
    this.ring.position.y = RING_Y;
    this.fill = new THREE.Mesh(fillGeometry, this.fillMat);
    this.fill.name = 'TLL_AshforgeChainPillarFill'; this.fill.renderOrder = ORDER.fill; this.fill.frustumCulled = false; this.fill.visible = false;
    this.fill.position.y = FILL_Y;
    this.group.add(this.links, this.ring, this.fill);

    const color = hex => new THREE.Color(hex);
    this.linkColors = [color(COLOR.slack), color(COLOR.pull), color(COLOR.open)];
    this.pillarColors = [color(COLOR.pillarPull), color(COLOR.pillarOpen)];
    // 인스턴스 색 버퍼를 미리 만든다(update 에서 첫 setColorAt 할당 방지). 행렬은 0 으로 채워 scale 0 으로 시작한다.
    this.colorCode = SLACK;
    for (let i = 0; i < this.capacity * MAX_LINKS; i++) this.links.setColorAt(i, this.linkColors[SLACK]);
    this.links.instanceMatrix.array.fill(0);
    this.shown = 0;   // 직전 갱신에서 쓴 마디 수(남은 칸을 0 으로 지우는 범위)
  }

  /** 지금 그려지는 메시 수(draw call). */
  get drawCalls() {
    if (this.disposed) return 0;
    return (this.links.visible && this.shown > 0 ? 1 : 0) + (this.ring.visible ? 1 : 0) + (this.fill.visible ? 1 : 0);
  }
  /** 사슬 마디 인스턴스 수. */
  get count() { return this.disposed ? 0 : this.capacity * MAX_LINKS; }

  /** @param {any} chains @param {number} dt 게임 시간(0 이면 진행하지 않는다) @param {AshforgeChainViewOptions} [opts] */
  update(chains, dt, opts) {
    if (this.disposed) return;
    const c = chains, state = c?.state, boss = c?.boss;
    const live = (state === 'chained' || state === 'open' || state === 'exposed') && !!boss && boss.alive !== false && !!boss.pos;
    if (!live) { this.#hide(); return; }
    const reduced = !!opts?.reduced;
    if (dt > 0 && Number.isFinite(dt) && !reduced) this.t += dt;
    const scale = boss.def?.scale > 0 ? boss.def.scale : 1, bx = boss.pos.x, bz = boss.pos.z;
    const cap = this.capacity, left = Math.max(0, Math.min(cap, Math.floor(Number.isFinite(c.chainsLeft) ? c.chainsLeft : cap)));
    // 팽팽한 선(끌기·열림)은 anchor 와 pillar 가 모두 있을 때만 그린다.
    const taut = (state === 'open' || (state === 'chained' && !!c.pulling)) && !!c.anchor && !!c.pillar;
    const mode = taut ? (state === 'open' ? OPEN : PULL) : SLACK;
    if (mode !== this.colorCode) {
      this.colorCode = mode;
      const color = this.linkColors[mode], total = cap * MAX_LINKS;
      for (let i = 0; i < total; i++) this.links.setColorAt(i, color);
      if (this.links.instanceColor) this.links.instanceColor.needsUpdate = true;
    }
    const array = this.links.instanceMatrix.array;
    let n = 0;
    if (taut) {
      for (let k = 0; k < left; k++) n = this.#taut(array, n, k, left, bx, bz, scale, c.anchor.x, c.anchor.z, mode === PULL);
    } else {
      for (let k = 0; k < left; k++) n = this.#slack(array, n, k, bx, bz, scale, -1);
      const f = state === 'exposed' && !reduced && left < cap && c.lastCutT >= 0 && c.lastCutT < CUT_SECONDS ? c.lastCutT / CUT_SECONDS : -1;
      if (f >= 0) n = this.#slack(array, n, left, bx, bz, scale, f);
    }
    if (n < this.shown) array.fill(0, n * 16, this.shown * 16);
    this.shown = n;
    this.links.instanceMatrix.needsUpdate = true;
    this.links.visible = n > 0;

    // 기둥: 끌기·열림에서만. 채움은 열림 동안 hold 비율만큼 커진다.
    if (taut) {
      this.ring.visible = true;
      this.ring.position.x = c.pillar.x; this.ring.position.z = c.pillar.z;
      this.ringMat.color.copy(this.pillarColors[mode === OPEN ? 1 : 0]);
      this.ringMat.opacity = mode === OPEN && !reduced ? .85 + .1 * Math.sin(this.t * 6) : mode === OPEN ? .85 : .7;
      const total = c.holdTotal > 0 ? c.holdTotal : c.def?.hold > 0 ? c.def.hold : 1;
      const frac = mode === OPEN ? Math.max(0, Math.min(1, (Number.isFinite(c.hold) ? c.hold : 0) / total)) : 0;
      if (frac > 0) {
        this.fill.visible = true;
        this.fill.position.x = c.pillar.x; this.fill.position.z = c.pillar.z;
        this.fill.scale.x = frac; this.fill.scale.z = frac;
        this.fillMat.opacity = FILL_MIN + (FILL_MAX - FILL_MIN) * frac;
      } else this.fill.visible = false;
    } else { this.ring.visible = false; this.fill.visible = false; }
  }

  /** 늘어진 사슬 한 칸: 보스 둘레 바닥(반지름 0.7×scale + .4)에서 방사로 짧게. fall >= 0 이면 끊겨 떨어지며 작아지는 중이다. 쓴 뒤의 마디 수를 돌려준다. */
  #slack(array, n, k, bx, bz, scale, fall) {
    let a = k * (Math.PI * 2 / this.capacity) + .5;
    if (this.t > 0) a += SWAY * Math.sin(this.t * 1.2 + k * 2);
    const dx = Math.cos(a), dz = Math.sin(a), r0 = BODY_RADIUS * scale + SLACK_GAP;
    const s = fall >= 0 ? SLACK_SCALE * (1 - fall) : SLACK_SCALE;
    const y = fall >= 0 ? LINK_Y + FALL_HEIGHT * (1 - fall) * (1 - fall) : LINK_Y;
    const pitch = LINK_BASE_PITCH * SLACK_SCALE;
    for (let j = 0; j < SLACK_LINKS; j++) {
      const dist = r0 + (j + .5) * pitch, wiggle = Math.sin(j * 1.3 + k) * .08;
      writeLink(array, n++, bx + dx * dist - dz * wiggle, y, bz + dz * dist + dx * wiggle, dx, dz, s, (j & 1) === 1);
    }
    return n;
  }

  /** 팽팽한 사슬 한 가닥: 보스 몸 가장자리에서 anchor 까지 나란한 선으로 마디를 채운다(마디 수는 길이에 비례, 최대 12). */
  #taut(array, n, k, left, bx, bz, scale, ax, az, shake) {
    let dx = ax - bx, dz = az - bz;
    const dist = Math.hypot(dx, dz);
    if (dist > 1e-6) { dx /= dist; dz /= dist; } else { dx = 1; dz = 0; }
    const body = BODY_RADIUS * scale, len = Math.max(0, dist - body);
    const lane = (k - (left - 1) / 2) * LANE, px = -dz, pz = dx;
    const count = Math.min(MAX_LINKS, Math.max(1, Math.ceil(len / TAUT_PITCH)));
    const pitch = len / count, s = Math.max(TAUT_SCALE_MIN, Math.min(TAUT_SCALE_MAX, pitch / LINK_BASE_PITCH));
    for (let j = 0; j < count; j++) {
      const along = body + (j + .5) * pitch;
      const off = lane + (shake && this.t > 0 ? SHAKE * Math.sin(this.t * 40 + j * 1.7 + k) : 0);
      writeLink(array, n++, bx + dx * along + px * off, LINK_Y, bz + dz * along + pz * off, dx, dz, s, (j & 1) === 1);
    }
    return n;
  }

  #hide() {
    if (this.shown > 0) { this.links.instanceMatrix.array.fill(0, 0, this.shown * 16); this.links.instanceMatrix.needsUpdate = true; this.shown = 0; }
    this.links.visible = false; this.ring.visible = false; this.fill.visible = false;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.links.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries = []; this.materials = [];
    this.scene = null; this.chains = null;
  }
}
