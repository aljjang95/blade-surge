import { afterEach, beforeEach, expect, test } from 'bun:test';
import * as THREE from 'three';
import { Input, skillAimThreshold } from '../src/engine/input.js';
import { cameraRelativeMove } from '../src/engine/camera-control.js';
import { Player } from '../src/game/player.js';
import { SKILLS } from '../src/game/skills.js';
import { skillAimShape, playerSkillAimShape, BOW_SOCKET } from '../src/game/skill-aim/shapes.js';
import { SkillAimView } from '../src/game/skill-aim/aim-view.js';

class Element extends EventTarget {
  properties: Record<string, string> = {};
  style: any = { setProperty: (key: string, value: string) => { this.properties[key] = value; }, removeProperty: (key: string) => { delete this.properties[key]; } };
  dataset: Record<string, string> = {};
  classes = new Set<string>();
  classList = { toggle: (name: string, on: boolean) => on ? this.classes.add(name) : this.classes.delete(name), remove: (name: string) => this.classes.delete(name) };
  rect = { left: 600, top: 220, right: 700, bottom: 320, width: 100, height: 100 };
  knob: Element | null = null;
  querySelector() { return this.knob; }
  getBoundingClientRect() { return this.rect; }
}
const saved = ['window', 'document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
let host: EventTarget, input: Input, buttons: Element[], elements: Map<string, Element>;
function event(target: EventTarget, type: string, id: number | null, x = 650, y = 270) {
  const e = new Event(type, { cancelable: true });
  const values: any = id === null ? { button: 0, clientX: x, clientY: y } : { changedTouches: [{ identifier: id, clientX: x, clientY: y }] };
  for (const key in values) Object.defineProperty(e, key, { value: values[key] });
  target.dispatchEvent(e);
}
beforeEach(() => {
  host = new EventTarget(); elements = new Map();
  buttons = Array.from({ length: 6 }, (_, slot) => { const b = new Element(); b.dataset.skill = String(slot); b.knob = new Element(); return b; });
  const find = (id: string) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; };
  find('skill-aim-cancel').rect = { left: 500, top: 40, right: 580, bottom: 120, width: 80, height: 80 };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: host });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: Object.assign(new EventTarget(), {
    getElementById: find, querySelector: find, querySelectorAll: () => buttons,
  }) });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  input = new Input(); input.enabled = true;
});
afterEach(() => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });

function player(id = 'ranger_pierce', extra: any = {}) {
  const noop = () => {};
  const p: any = Object.assign(Object.create(Player.prototype), {
    def: { id: 'ranger', skills: [{ id, cd: 5, dmg: 1, mp: 10 }] }, heroLevel: 50, skillLoadout: [4, 5],
    skillLevels: [1], cds: [0], state: 'idle', stun: 0, ult: 100, ultMax: 100, mp: 100,
    stats: { atk: 100 }, buffs: { atk: 1 }, hp: 100, maxHp: 100, alive: true, yaw: .3,
    pos: new THREE.Vector3(3, 0, 5), vel: new THREE.Vector3(), moveDir: new THREE.Vector3(),
    game: { input, ui: { toast: noop }, hasProc: () => false, fx: new Proxy({}, { get: () => noop }), renderer: { shake: noop }, enemies: [], after: noop, stage: {} },
    stopTrail: noop, playTimed: noop, startTrail: noop, autoAim() { this.yaw = -1; }, ...extra,
  });
  return p;
}

test('모든 실제 스킬 ID에 유한한 모양이 있다', () => {
  expect(Object.keys(SKILLS)).toHaveLength(42);
  for (const id of Object.keys(SKILLS)) {
    const shape: any = skillAimShape(id);
    expect(shape).toBeTruthy(); expect(['line', 'cone', 'circle', 'self']).toContain(shape.kind);
    expect(Number.isFinite(shape.range)).toBe(true); expect(shape.range).toBeGreaterThanOrEqual(0);
    if (shape.kind === 'circle') expect(shape.radius).toBeGreaterThan(0);
    if (shape.kind === 'line') expect(shape.width).toBeGreaterThan(0);
  }
  expect(skillAimShape('missing')).toBeNull();
});

test('탭은 해제 시 기존 액션만 넣고 임계값 이상은 드래그다', () => {
  expect(skillAimThreshold(56)).toBe(14); expect(skillAimThreshold(40)).toBe(10);
  event(buttons[0], 'touchstart', 7); expect(input.queue).toEqual([]);
  event(host, 'touchend', 7, 660, 270);
  expect(input.consume('skill0')).toBe(true); expect(input.takeAim(0)).toBeUndefined();
  event(buttons[0], 'touchstart', 8); event(host, 'touchmove', 8, 663, 270);
  expect(input.skillAim?.active).toBe(true); expect(buttons[0].classes.has('aiming')).toBe(true);
  expect(buttons[0].properties['--aim-x']).toBe('13px');
  event(host, 'touchend', 8, 700, 270);
  expect(input.consume('skill0')).toBe(true); expect(input.takeAim(0)).toMatchObject({ slot: 0, x: 1, z: 0, dist01: 1 });
  expect(input.takeAim(0)).toBeUndefined(); expect(input.skillAim).toBeNull();
  expect(buttons[0].properties).toEqual({}); expect(buttons[0].classes.has('aiming')).toBe(false);
});

test('취소 영역과 touchcancel은 큐·쿨다운·MP를 보존한다', () => {
  const p = player(), before = { mp: p.mp, cds: [...p.cds], yaw: p.yaw };
  for (const type of ['touchend', 'touchcancel']) {
    event(buttons[0], 'touchstart', 1); event(host, 'touchmove', 1, 540, 80);
    expect(input.skillAim?.cancel).toBe(true); expect(elements.get('skill-aim-cancel')!.classes.has('on')).toBe(true);
    expect(elements.get('skill-aim-cancel')!.classes.has('hot')).toBe(true);
    event(host, type, 1, 540, 80);
    expect(input.queue).toEqual([]); expect(input.aimedCasts.size).toBe(0);
    expect(elements.get('skill-aim-cancel')!.classes.size).toBe(0);
    expect({ mp: p.mp, cds: p.cds, yaw: p.yaw }).toEqual(before);
  }
  event(buttons[0], 'touchstart', 2); event(host, 'touchmove', 2, 740, 270); event(host, 'touchcancel', 2, 740, 270);
  expect(input.queue).toEqual([]);
});

test('이동 손가락과 스킬 두 슬롯의 소유권이 독립적이다', () => {
  const joy = elements.get('joy')!;
  event(joy, 'touchstart', 11, 100, 300); event(joy, 'touchmove', 11, 150, 300);
  event(buttons[0], 'touchstart', 12); event(buttons[1], 'touchstart', 13);
  event(host, 'touchmove', 12, 650, 220); event(host, 'touchmove', 13, 700, 270);
  event(host, 'mouseup', null); event(host, 'touchend', 99);
  expect(input.joy.active).toBe(true); expect(input.skillGestures.size).toBe(2);
  input.update(); expect(input.move.x).toBeGreaterThan(.8);
  event(host, 'touchend', 12, 650, 220);
  expect(input.takeAim(0)).toMatchObject({ x: 0, z: -1 }); expect(input.skillAim?.slot).toBe(1);
  event(host, 'touchend', 13, 700, 270); expect(input.takeAim(1)).toMatchObject({ x: 1, z: 0 });
  expect(input.joy.active).toBe(true);
});

test('마우스 드래그도 해제 시 카메라 yaw를 반영한다', () => {
  for (const yaw of [0, Math.PI / 2, -Math.PI / 2, 2.1]) {
    (input as any).getCameraYaw = () => yaw;
    event(buttons[0], 'mousedown', null); event(host, 'mousemove', null, 680, 230);
    const expected = cameraRelativeMove(.6, -.8, yaw);
    event(host, 'mouseup', null, 680, 230);
    const aim = input.takeAim(0)!; expect(aim.x).toBeCloseTo(expected.x); expect(aim.z).toBeCloseTo(expected.y);
    input.consume('skill0');
  }
});

test('clear 뒤 늦은 해제와 비활성 입력은 시전하지 않는다', () => {
  event(buttons[0], 'touchstart', 1); event(host, 'touchmove', 1, 720, 270);
  input.clear(); event(host, 'touchend', 1, 720, 270);
  expect(input.queue).toEqual([]); expect(input.skillAim).toBeNull();
  expect(elements.get('skill-aim-cancel')!.classes.has('on')).toBe(false);
  expect(buttons[0].properties).toEqual({});
  event(buttons[0], 'touchstart', 2); input.enabled = false; event(host, 'touchend', 2, 720, 270);
  expect(input.queue).toEqual([]);
});

test('기존 키보드 요청과 중복된 드래그는 이전 큐 의미를 덮지 않는다', () => {
  input.press('skill0'); event(buttons[0], 'touchstart', 1); event(host, 'touchend', 1, 720, 270);
  expect(input.queue).toEqual(['skill0']); expect(input.takeAim(0)).toBeUndefined();
});

test('취소 마크업 없이도 동작하고 원점으로 돌아온 드래그는 마지막 방향을 보존한다', () => {
  (document as any).getElementById = () => null;
  event(buttons[0], 'touchstart', 1); event(host, 'touchmove', 1, 700, 270);
  event(host, 'touchend', 1, 650, 270);
  expect(input.takeAim(0)).toMatchObject({ x: 1, z: 0, dist01: 0 });
  const p = player('shadow_dash');
  expect(p.tryCastSkill(0, { x: 1, z: 0, dist01: 0 })).toBe(true);
  expect(p.yaw).toBeCloseTo(Math.PI / 2); expect(p.vel.x).toBe(28);
});

test('Q/E 장착 인덱스에 조준을 전달한다', () => {
  const p = player(), calls: any[] = []; p.skillLoadout = [6, 7];
  p.tryCastSkill = (index: number, aim: any) => { calls.push({ index, aim }); return true; };
  const aim = { x: -1, z: 0, dist01: .4 };
  expect(p.tryCastCombatSkill(4, aim)).toBe(true); expect(p.tryCastCombatSkill(5, aim)).toBe(true);
  expect(calls).toEqual([{ index: 6, aim }, { index: 7, aim }]);
});

test('실제 소비 경로는 수동 방향을 AUTO보다 우선하고 aim을 한 번만 소비한다', () => {
  const p = player('ranger_pierce', { auto: true, autoMove: () => ({ x: 0, y: 0 }) });
  input.aimedCasts.set(0, { slot: 0, x: 1, z: 0, dist01: .5 }); input.press('skill0');
  p.handleInput(input, .016);
  expect(p.state).toBe('skill'); expect(p.yaw).toBeCloseTo(Math.PI / 2); expect(input.takeAim(0)).toBeUndefined();
  expect(p.cds[0]).toBe(5); expect(p.mp).toBeLessThan(100);
});

test('거부 검사마다 방향·쿨다운·MP·진행 중 시전을 변경하지 않는다', () => {
  for (const extra of [{ cds: [1] }, { mp: 0 }, { stun: 1 }, { state: 'ult' }, { state: 'dodge' }, { state: 'attack', canSkillCancel: () => false }, { state: 'skill', skillCtx: { done: false } }, { unlocked: () => false }]) {
    const p = player('ranger_pierce', extra), before = { yaw: p.yaw, cds: [...p.cds], mp: p.mp, ctx: p.skillCtx };
    expect(p.tryCastSkill(0, { x: -1, z: 0, dist01: 1 })).toBe(false);
    expect({ yaw: p.yaw, cds: p.cds, mp: p.mp, ctx: p.skillCtx }).toEqual(before);
  }
});

test('조준이 없으면 수동 방향 유지와 기존 AUTO 조준을 그대로 사용한다', () => {
  const manual = player(); expect(manual.tryCastSkill(0)).toBe(true); expect(manual.yaw).toBe(.3);
  expect(manual.skillCtx.data.aimPoint).toBeUndefined();
  const auto = player('ranger_pierce', { auto: true }); expect(auto.tryCastSkill(0)).toBe(true); expect(auto.yaw).toBe(-1);
});

test('지점 스킬의 실제 판정은 놓은 위치를 사용한다', () => {
  const p = player('star_prison'); let center: THREE.Vector3 | undefined;
  p.game.vacuum = () => {}; p.game.after = (_t: number, fn: () => void) => fn(); p.game.active = true;
  p.game.hitRadius = (at: THREE.Vector3) => { center = at; };
  expect(p.tryCastSkill(0, { x: 1, z: 0, dist01: .5 })).toBe(true);
  SKILLS.star_prison.cast(p.game, p, p.skillCtx);
  expect(center!.x).toBeCloseTo(11); expect(center!.z).toBe(5);
});

test('돌진과 연속 베기의 시작 보정이 수동 방향을 덮지 않는다', () => {
  for (const id of ['shadow_dash', 'bull_rush', 'flurry']) {
    const p = player(id); p.nearestEnemy = () => ({ pos: new THREE.Vector3(-10, 0, -10) });
    p.game.enemies = [{ alive: true, pos: new THREE.Vector3(-10, 0, -10) }];
    expect(p.tryCastSkill(0, { x: 1, z: 0, dist01: 1 })).toBe(true);
    expect(p.yaw).toBeCloseTo(Math.PI / 2);
    if (id !== 'flurry') { expect(p.vel.x).toBeGreaterThan(0); expect(p.vel.z).toBeCloseTo(0); }
  }
});

test('실제 투사체의 거리와 폭이 모양의 공유 상수와 같다', () => {
  for (const id of ['ranger_pierce', 'holy_slash', 'fireball', 'ranger_quickshot']) {
    const p = player(id), projectiles: any[] = []; p.game.spawnProjectile = (value: any) => projectiles.push(value);
    (SKILLS as any)[id].cast(p.game, p, { dmg: 10, data: {} });
    const projectile = projectiles[0], shape: any = skillAimShape(id);
    expect(shape.range).toBeCloseTo(projectile.speed * projectile.life);
    expect(shape.width).toBeCloseTo(projectile.radius * 2);
  }
});

test('표시는 동일 메시·버퍼를 재사용하고 전투 상태를 변경하지 않으며 dispose로 해제한다', () => {
  const scene = new THREE.Scene(), view = new SkillAimView(scene), p = player();
  const aim = { active: true, cancel: false, x: 1, z: 0, dist01: .5 };
  const geometry = view.lane.geometry, buffer = geometry.attributes.position.array, before = p.pos.clone();
  const out: any = {};
  for (const id of Object.keys(SKILLS)) {
    const shape = playerSkillAimShape(p, id, out); expect(shape).toBe(out);
    view.update(p, aim, shape); expect(view.group.visible).toBe(true);
    expect(view.lane.geometry).toBe(geometry); expect(view.lane.geometry.attributes.position.array).toBe(buffer);
  }
  expect(p.pos.equals(before)).toBe(true); expect(p.yaw).toBe(.3); expect(p.mp).toBe(100); expect(p.cds).toEqual([0]);
  view.update(p, { ...aim, cancel: true }, out); expect(view.group.visible).toBe(false);
  let disposed = 0; geometry.addEventListener('dispose', () => disposed++); view.dispose();
  expect(scene.children).toHaveLength(0); expect(disposed).toBe(1);
});

// ---- 표시 = 판정(tools/aim-hitbox-truth-qa.mjs 실측으로 고친 스킬) ----
// 레인(시작점에서 각도 ang로 len만큼 나가는 반폭 hw의 사각형)의 경계 거리(음수면 안). 좌표는 영웅 앞쪽 a, 오른쪽 c.
function laneSd(a: number, c: number, lane: any) {
  const ra = a - lane.sa, rc = c - lane.sc, cs = Math.cos(lane.ang), sn = Math.sin(lane.ang);
  const along = ra * cs + rc * sn, across = -ra * sn + rc * cs;
  const qa = Math.abs(along - lane.len / 2) - lane.len / 2, qc = Math.abs(across) - lane.hw;
  return Math.hypot(Math.max(qa, 0), Math.max(qc, 0)) + Math.min(Math.max(qa, qc), 0);
}
// 표시 모양의 레인 목록(aim-view와 같은 식).
function lanesOf(shape: any) {
  const list: any[] = [];
  for (let i = 0; i < shape.lanes; i++) {
    const off = i - (shape.lanes - 1) / 2; if (shape.laneSkipCenter && off === 0) continue;
    const ang = off * shape.laneStep;
    list.push({ ang, hw: shape.laneHalf, len: shape.laneLen, sa: shape.laneBaseA + shape.laneReach * Math.cos(ang), sc: shape.laneBaseC + shape.laneReach * Math.sin(ang) });
  }
  return list;
}
function projectilesOf(id: string, learned: any = null) {
  const p = player(id), list: any[] = [];
  if (learned) p.game.app = { eco: { s: { towns: { learned } } } };
  // 활 영웅: 화살 시작점 = 활 소켓 + 화살 방향 × .35(player.js arrowOrigin). 소켓은 영웅 기준 앞 .64·오른쪽 .07(실측, BOW_SOCKET).
  if (id.startsWith('ranger') || id === 'gale_hunt') {
    p.def = { ...p.def, weapon: 'bow' };
    p.arrowOrigin = (dir: THREE.Vector3) => {
      const f = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)), r = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
      return p.pos.clone().addScaledVector(f, BOW_SOCKET.a).addScaledVector(r, BOW_SOCKET.c).addScaledVector(dir, BOW_SOCKET.reach).setY(1.3);
    };
  }
  p.game.spawnProjectile = (value: any) => list.push(value);
  p.game.hitArea = () => 0; p.game.timeCtl = { slowmo() {} }; p.game.renderer = new Proxy({}, { get: () => () => {}, set: () => true });
  (SKILLS as any)[id].cast(p.game, p, { dmg: 10, data: {} });
  return { p, list };
}
// 각 투사체 몸통 가장자리 두 점이 시간 구간 전체에서 방향각이 같은 레인 안에 있는지 확인한다(영웅 앞쪽 a, 오른쪽 c).
function expectSweptLanes(p: any, list: any[], lanes: any[]) {
  const ux = Math.sin(p.yaw), uz = Math.cos(p.yaw), vx = Math.cos(p.yaw), vz = -Math.sin(p.yaw);
  for (const q of list) for (let t = 0; t <= 1.001; t += .125) {
    const ang = Math.atan2(q.dir.x * vx + q.dir.z * vz, q.dir.x * ux + q.dir.z * uz);
    const lane = lanes.find(l => Math.abs(l.ang - ang) < 1e-6); expect(lane).toBeDefined();
    const cx = q.pos.x - p.pos.x + q.dir.x * q.speed * q.life * t, cz = q.pos.z - p.pos.z + q.dir.z * q.speed * q.life * t;
    for (const side of [-1, 1]) {
      const px = cx + q.dir.z * q.radius * side, pz = cz - q.dir.x * q.radius * side;
      expect(laneSd(px * ux + pz * uz, px * vx + pz * vz, lane)).toBeLessThanOrEqual(.05);
    }
  }
}

test('직선 투사체 표시는 몸통 반경만큼 끝이 더 나가 실제 최대 도달 지점을 덮는다', () => {
  for (const id of ['holy_slash', 'ranger_pierce', 'ranger_quickshot', 'fireball']) {
    const { p, list } = projectilesOf(id), shape: any = playerSkillAimShape(p, id, {});
    const q = list[0], along = Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z);
    expect(shape.origin + shape.range + shape.tip).toBeGreaterThanOrEqual(along + q.speed * q.life + q.radius - .02);
    expect(shape.tip).toBeGreaterThanOrEqual(shape.width / 2);
  }
});

// 화살 다발(교관 추가탄 네 발 포함)은 부채꼴로 채우지 않고 화살마다 레인으로 그려 발 사이 틈을 비운다.
test('화살 다발 표시는 화살마다 레인을 두고 각 화살 몸통이 훑는 영역을 덮으며 발 사이는 비운다', () => {
  const cases: [string, any, number][] = [['ranger_volley', null, 3], ['ranger_volley', { ranger: ['oathhold_ranger_extra'] }, 4], ['ranger_tempest', null, 7], ['ranger_binding', null, 5], ['gale_hunt', null, 3]];
  for (const [id, learned, count] of cases) {
    const { p, list } = projectilesOf(id, learned), shape: any = playerSkillAimShape(p, id, {});
    expect(list).toHaveLength(count); expect(shape.lanes).toBe(count); expect(shape.laneSkipCenter).toBe(0); expect(shape.laneReach).toBeCloseTo(BOW_SOCKET.reach);
    const lanes = lanesOf(shape); expectSweptLanes(p, list, lanes);
    // 레인 끝은 마지막 몸통 가장자리(이동 거리 + 반경)와 보정을 덮는다.
    expect(shape.laneLen).toBeGreaterThanOrEqual(list[0].speed * list[0].life + list[0].radius);
    // 이웃 레인 사이 이등분선의 먼 지점은 어느 레인 안도 아니고(경계에서 .3m 이상) 틈으로 남는다. 가장 좁은 다발(화살 일곱 발)도 해당한다.
    for (let i = 0; i < lanes.length - 1; i++) {
      const mid = (lanes[i].ang + lanes[i + 1].ang) / 2, d = shape.origin + shape.laneLen * .9;
      expect(Math.min(...lanes.map(l => laneSd(d * Math.cos(mid), d * Math.sin(mid), l)))).toBeGreaterThan(.3);
    }
  }
});

test('용살검 파동 세 줄기는 레인으로 그려지고 각 파동 몸통을 덮는다', () => {
  const { p, list } = projectilesOf('dragon_slash'), shape: any = playerSkillAimShape(p, 'dragon_slash', {});
  expect(list).toHaveLength(3); expect(shape.lanes).toBe(3); expect(shape.laneStep).toBeCloseTo(.32); expect(shape.laneHalf).toBeCloseTo(1.5);
  expectSweptLanes(p, list, lanesOf(shape));
});

test('확정 범위만 그리는 스킬과 끝 원이 없는 반사창', () => {
  const p = player('meteor');
  const meteor: any = playerSkillAimShape(p, 'meteor', {}), magma: any = playerSkillAimShape(p, 'magma_zone', {}), arc: any = playerSkillAimShape(p, 'arc_reflect', {});
  // meteor: 첫 낙하(r 3.4)만 어느 방향에서도 확정. 바깥 한계 7.8은 운이 맞아야 닿는 띠다.
  expect(meteor.radius).toBeCloseTo(3.4); expect(meteor.envelope).toBeCloseTo(7.8);
  // magma_zone: 균열 장판(r 6.4)이 확정. 기둥 고리 7.5는 기둥 방향에서만 닿는다.
  expect(magma.range).toBeCloseTo(6.4); expect(magma.envelope).toBeCloseTo(7.5);
  // arc_reflect: 폭발은 열두 번째 반사 위치에서 터지므로 직선 끝 원이 없다.
  expect(arc.radius).toBe(0);
  // 원본 판정 기준 수치는 그대로다.
  expect(skillAimShape('meteor')!.radius).toBeCloseTo(7.8); expect(skillAimShape('magma_zone')!.range).toBeCloseTo(7.5);
});

// 확정 영역과 구분되는 바깥 한계(envelope): 확률 띠(chance)와 몰이 한계(pull)를 점선 원으로 그린다. 값은 tools/aim-hitbox-truth-qa.mjs 실측이다.
test('envelope가 있는 스킬은 확정 반지름과 envelope 값이 고정되고 점선 원이 확정 영역과 따로 그려진다', () => {
  const expected: Record<string, { confirmed: number; envelope: number; kind: string }> = {
    meteor: { confirmed: 3.4, envelope: 7.8, kind: 'chance' }, magma_zone: { confirmed: 6.4, envelope: 7.5, kind: 'chance' },
    shield_bash: { confirmed: 5, envelope: 7, kind: 'pull' }, quake: { confirmed: 8, envelope: 9, kind: 'pull' },
    whirlwind: { confirmed: 3.8, envelope: 5.5, kind: 'pull' }, hell_axe: { confirmed: 6, envelope: 7.5, kind: 'pull' },
  };
  const p = player('meteor'), view = new SkillAimView(new THREE.Scene()), aim = { active: true, cancel: false, x: 0, z: 1, dist01: .5 };
  const out: any = {}, withEnvelope: string[] = [];
  for (const id of Object.keys(SKILLS)) {
    const shape: any = playerSkillAimShape(p, id, out); view.update(p, aim, shape);
    expect(shape.envelopeKind === '').toBe(!(shape.envelope > 0));
    if (!(shape.envelope > 0)) { expect(view.envelope.visible).toBe(false); continue; }
    withEnvelope.push(id);
    const want = expected[id]; expect(want).toBeDefined();
    // 확정 반지름: 지점형은 radius, 자기 중심형은 range. envelope는 항상 확정보다 크다.
    const confirmed = shape.kind === 'circle' ? shape.radius : shape.range;
    expect(confirmed).toBeCloseTo(want.confirmed); expect(shape.envelope).toBeCloseTo(want.envelope); expect(shape.envelopeKind).toBe(want.kind);
    expect(shape.envelope).toBeGreaterThan(confirmed);
    // 점선 원: 보이고, envelope 반지름이며, 지점형은 지점 중심(range × dist01), 자기 중심형은 영웅 중심이다. 확정 원 위에 덮이지 않도록 아래층이다.
    expect(view.envelope.visible).toBe(true); expect(view.envelope.scale.x).toBeCloseTo(shape.envelope);
    expect(view.envelopeMaterial.uniforms.uRadius.value).toBeCloseTo(shape.envelope);
    expect(view.envelope.position.z).toBeCloseTo(shape.kind === 'circle' ? shape.range * aim.dist01 : 0);
    expect(view.envelope.renderOrder).toBeLessThan(view.target.renderOrder);
    if (shape.kind === 'circle') expect(view.target.scale.x).toBeCloseTo(shape.radius); else expect(view.range.scale.x).toBeCloseTo(shape.range);
  }
  expect(withEnvelope.sort()).toEqual(Object.keys(expected).sort());
  view.dispose();
});

test('분열 화염 교관 변형은 옆으로 갈라지는 투사체마다 레인을 더한다', () => {
  const mage = (learned: any) => { const p = player('fireball', { def: { id: 'mage', skills: [{ id: 'fireball', cd: 5, dmg: 1, mp: 10 }] } }); p.game.app = { eco: { s: { towns: { learned } } } }; return p; };
  const base: any = playerSkillAimShape(mage({}), 'fireball', {}), split: any = playerSkillAimShape(mage({ mage: ['oathhold_mage_split'] }), 'fireball', {});
  expect(base.lanes).toBe(0); expect(base.radius).toBeCloseTo(4.2);
  expect(split.radius).toBeCloseTo(5.2); expect(split.lanes).toBe(3); expect(split.laneSkipCenter).toBe(1); expect(split.laneReach).toBe(0); expect(split.laneBaseA).toBeCloseTo(split.origin);
  // 갈라지는 투사체 둘(속도 15 × 수명 .8, 몸통 .55, 조준 축 위 시작점)이 레인 안에 들어간다.
  const lanes = lanesOf(split); expect(lanes).toHaveLength(2);
  for (const lane of lanes) for (const t of [0, .5, 1]) for (const side of [-1, 1]) {
    const along = split.origin + 12 * t * Math.cos(lane.ang) - side * .55 * Math.sin(lane.ang), across = 12 * t * Math.sin(lane.ang) + side * .55 * Math.cos(lane.ang);
    expect(laneSd(along, across, lane)).toBeLessThanOrEqual(.05);
  }
  const view = new SkillAimView(new THREE.Scene()), pl = mage({ mage: ['oathhold_mage_split'] });
  view.update(pl, { active: true, cancel: false, x: 0, z: 1, dist01: 1 }, split);
  expect(view.laneNodes.filter((n: any) => n.pivot.visible)).toHaveLength(2); expect(view.lane.visible).toBe(true); view.dispose();
});

test('화살 다발은 부채꼴·사거리 원판 없이 레인만 그리고 용살검은 근접 부채꼴에 레인을 더한다', () => {
  const view = new SkillAimView(new THREE.Scene()), p = player(), aim = { active: true, cancel: false, x: 0, z: 1, dist01: 1 };
  const out: any = {};
  const shown = () => view.laneNodes.filter((n: any) => n.pivot.visible).length;
  view.update(p, aim, playerSkillAimShape(p, 'ranger_volley', out));
  expect(view.cone.visible).toBe(false); expect(view.range.visible).toBe(false); expect(view.lane.visible).toBe(false); expect(view.head.visible).toBe(false);
  expect(shown()).toBe(3);
  // 바깥 레인은 조준 축에서 laneStep만큼 돌고, 시작점은 각 레인 방향으로 origin만큼 나간다.
  const node = view.laneNodes[0]; expect(node.pivot.rotation.y).toBeCloseTo(-out.laneStep); expect(node.mesh.position.z).toBeCloseTo(BOW_SOCKET.reach);
  expect(node.pivot.position.z).toBeCloseTo(BOW_SOCKET.a); expect(node.pivot.position.x).toBeCloseTo(BOW_SOCKET.c);
  expect(node.mesh.scale.x).toBeCloseTo(out.laneHalf * 2); expect(node.mesh.scale.y).toBeCloseTo(out.laneLen);
  view.update(p, aim, playerSkillAimShape(p, 'dragon_slash', out));
  expect(view.cone.visible).toBe(true); expect(view.cone.position.z).toBeCloseTo(0); expect(view.lane.visible).toBe(false); expect(shown()).toBe(3);
  view.update(p, aim, playerSkillAimShape(p, 'holy_slash', out));
  expect(shown()).toBe(0); expect(view.range.visible).toBe(true); expect(view.lane.scale.y).toBeCloseTo(out.range + out.tip);
  view.dispose();
});
