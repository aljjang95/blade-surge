import * as THREE from 'three';
import { audio } from '../engine/audio.js';
import '../ui/treasure-chest.css';

// 대표님 2026-10-18: "보물 상자를 직접적으로 클릭하고 있는 상태에서 제품이 나오는 구조", "까는 것도 있어야 좋으니까".
// 보물방을 정화하면 보상은 정화 순간에 미리 굴려 상자에 담아 두고(결정성 유지), 플레이어가 상자를 누르고 있어야 열린다.
export const CHEST_HOLD_SEC = 1.2;
export const CHEST_AUTO_SEC = 0.8;
export const CHEST_DECAY = 1.5;
export const CHEST_RANGE = 2.2;
const LID_OPEN_SEC = 0.42;
const BEAM_SEC = 1.4;

/** 순수 상태기계. 잠김 → (누르는 동안 진행, 떼면 감소) → 열림. 열림 이벤트는 정확히 한 번만 돌려준다. */
export class ChestState {
  constructor(rewards = []) { this.phase = 'locked'; this.progress = 0; this.rewards = rewards; this.granted = false; }
  /** @returns {boolean} 이번 호출에서 열렸으면 true */
  step(dt, { holding = false, inRange = false, auto = false } = {}) {
    if (this.phase === 'open' || !(dt > 0)) return false;
    if (auto) this.progress += dt / CHEST_AUTO_SEC;
    else if (holding && inRange) this.progress += dt / CHEST_HOLD_SEC;
    else this.progress = Math.max(0, this.progress - dt * CHEST_DECAY / CHEST_HOLD_SEC);
    if (this.progress < 1) return false;
    this.progress = 1; this.phase = 'open';
    return true;
  }
  /** 정산 직전 강제 개봉. 아직 열리지 않았을 때만 true. */
  forceOpen() { if (this.phase === 'open') return false; this.phase = 'open'; this.progress = 1; return true; }
  /** 보상 지급권. 한 상자는 한 번만 지급한다. */
  claimRewards() { if (this.phase !== 'open' || this.granted) return null; this.granted = true; return this.rewards; }
}

const shared = {};
function materials() {
  if (shared.wood) return shared;
  shared.wood = new THREE.MeshStandardMaterial({ color: 0x8a4d24, roughness: .78, metalness: .05 });
  shared.woodDark = new THREE.MeshStandardMaterial({ color: 0x5a2f16, roughness: .85, metalness: .05 });
  shared.gold = new THREE.MeshStandardMaterial({ color: 0xf2c25a, roughness: .32, metalness: .85, emissive: 0x3a2400 });
  shared.beam = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  shared.geo = {
    body: new THREE.BoxGeometry(.92, .5, .62), bodyTrim: new THREE.BoxGeometry(.98, .07, .68),
    band: new THREE.BoxGeometry(.1, .52, .66), lid: new THREE.CylinderGeometry(.31, .31, .92, 14, 1, false, 0, Math.PI),
    lidBand: new THREE.CylinderGeometry(.325, .325, .1, 14, 1, false, 0, Math.PI), lock: new THREE.BoxGeometry(.18, .2, .06),
    seam: new THREE.BoxGeometry(.9, .04, .6), ring: new THREE.RingGeometry(.95, 1.12, 48), beam: new THREE.CylinderGeometry(.42, .62, 6, 18, 1, true),
  };
  return shared;
}

function ringMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    uniforms: { progress: { value: 0 }, color: { value: new THREE.Color(color) }, alpha: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec2 vUv; uniform float progress, alpha; uniform vec3 color; void main(){ vec2 p = vUv - 0.5; float a = atan(p.x, p.y) / 6.2831853 + 0.5; float on = step(a, progress); gl_FragColor = vec4(mix(vec3(0.16, 0.14, 0.1), color, on), (0.35 + 0.6 * on) * alpha); }',
  });
}

/** 보물방 상자 한 개의 3D 표현. 뚜껑은 뒤쪽 경첩을 축으로 열린다. */
class ChestView {
  constructor(scene, x, z, ry, scale) {
    const m = materials(), g = m.geo;
    this.root = new THREE.Group(); this.root.name = 'TreasureChest'; this.root.position.set(x, 0, z); this.root.rotation.y = ry;
    this.shake = new THREE.Group(); this.shake.scale.setScalar(scale); this.root.add(this.shake);
    const add = (geo, mat, px, py, pz, parent = this.shake, rx = 0, rz = 0) => { const mesh = new THREE.Mesh(geo, mat); mesh.position.set(px, py, pz); mesh.rotation.set(rx, 0, rz); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; };
    add(g.body, m.wood, 0, .25, 0); add(g.bodyTrim, m.gold, 0, .035, 0); add(g.bodyTrim, m.gold, 0, .5, 0);
    for (const side of [-1, 1]) add(g.band, m.woodDark, side * .32, .26, 0);
    this.lid = new THREE.Group(); this.lid.position.set(0, .5, -.31); this.shake.add(this.lid);
    add(g.lid, m.wood, 0, 0, .31, this.lid, 0, Math.PI / 2);
    for (const side of [-1, 1]) add(g.lidBand, m.gold, side * .32, 0, .31, this.lid, 0, Math.PI / 2);
    add(g.lock, m.gold, 0, -.02, .63, this.lid);
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.seam = new THREE.Mesh(g.seam, this.glowMat); this.seam.position.set(0, .5, 0); this.shake.add(this.seam);
    this.ringMat = ringMaterial(0xffd36a);
    this.ring = new THREE.Mesh(g.ring, this.ringMat); this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = .04; this.ring.renderOrder = 2; this.root.add(this.ring);
    this.beamMat = m.beam.clone();
    this.beam = new THREE.Mesh(g.beam, this.beamMat); this.beam.position.y = 3; this.beam.visible = false; this.root.add(this.beam);
    this.openT = -1; this.t = 0;
    scene.add(this.root);
  }
  update(dt, state, nearby, reduced) {
    this.t += dt;
    const p = state.progress;
    this.ringMat.uniforms.progress.value = p;
    this.ringMat.uniforms.alpha.value = state.phase === 'open' ? Math.max(0, this.ringMat.uniforms.alpha.value - dt * 3) : nearby ? Math.min(1, this.ringMat.uniforms.alpha.value + dt * 4) : Math.max(.35, this.ringMat.uniforms.alpha.value - dt * 2);
    this.glowMat.opacity = state.phase === 'open' ? 0 : Math.min(1, .12 + p * 1.1);
    // 진행할수록 점점 세게 떨리다 열리는 순간 멈춘다. 감속 모션 선호에서는 떨림 없이 빛만 차오른다.
    const shake = state.phase === 'locked' && !reduced ? p * p * .09 : 0;
    this.shake.rotation.z = Math.sin(this.t * 38) * shake; this.shake.rotation.x = Math.cos(this.t * 31) * shake * .5;
    this.shake.position.y = state.phase === 'locked' && p > 0 && !reduced ? Math.abs(Math.sin(this.t * 19)) * p * .05 : 0;
    if (this.openT >= 0) {
      this.openT += dt;
      const k = Math.min(1, this.openT / LID_OPEN_SEC);
      const back = 1.70158, e = 1 + (back + 1) * Math.pow(k - 1, 3) + back * Math.pow(k - 1, 2);
      this.lid.rotation.x = -1.95 * e;
      const b = this.openT / BEAM_SEC;
      this.beam.visible = b < 1; this.beamMat.opacity = b < 1 ? (1 - b) * .75 : 0; this.beam.scale.set(1 + b * .5, 1, 1 + b * .5);
    }
  }
  open() { this.openT = 0; this.shake.rotation.set(0, 0, 0); this.shake.position.y = 0; }
  dispose() {
    this.root.removeFromParent();
    this.glowMat.dispose(); this.ringMat.dispose(); this.beamMat.dispose();
  }
}

/** 전투가 소유하는 보물상자 묶음. 입력은 상자 직접 누르기(터치·클릭), 아래 가장자리 버튼, F 키 길게 누르기. */
export class TreasureChests {
  constructor(battle) {
    this.battle = battle; this.items = []; this.pointerId = null; this.keyHeld = false; this.buttonHeld = false; this.nearest = null;
    this._v = new THREE.Vector3(); this._c = new THREE.Vector3();
    if (typeof document === 'undefined') return;
    this.button = document.createElement('button'); this.button.type = 'button'; this.button.id = 'btn-chest'; this.button.hidden = true;
    this.button.innerHTML = '<span class="chest-btn-ring"></span><span class="chest-btn-label">상자 열기 · 길게 누르기</span>';
    this.button.setAttribute('aria-label', '보물상자 열기, 길게 누르기');
    document.getElementById('hud')?.append(this.button);
    const press = held => event => { this.buttonHeld = held; if (held) { event.preventDefault(); try { this.button.setPointerCapture?.(event.pointerId); } catch { /* 일부 브라우저는 캡처를 거절한다 */ } } };
    this.onBtnDown = press(true); this.onBtnUp = press(false);
    this.button.addEventListener('pointerdown', this.onBtnDown); this.button.addEventListener('pointerup', this.onBtnUp);
    this.button.addEventListener('pointercancel', this.onBtnUp); this.button.addEventListener('lostpointercapture', this.onBtnUp);
    this.button.addEventListener('contextmenu', e => e.preventDefault());
    this.onKey = event => { if (event.code === 'KeyF' && !event.repeat) this.keyHeld = event.type === 'keydown'; };
    // 상자 위를 직접 누른 손가락은 시점 회전 제스처보다 먼저 잡는다(캡처 단계, preventDefault 를 시점 제어가 존중한다).
    this.onPointerDown = event => {
      if (this.pointerId !== null || !this.nearest || event.target?.closest?.('button, dialog, .hud-btn, #joystick, .skill-btn')) return;
      if (!this.hitChest(this.nearest, event.clientX, event.clientY)) return;
      this.pointerId = event.pointerId; event.preventDefault(); event.stopPropagation();
    };
    this.onPointerUp = event => { if (event.pointerId === this.pointerId) this.pointerId = null; };
    window.addEventListener('keydown', this.onKey); window.addEventListener('keyup', this.onKey);
    window.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('pointerup', this.onPointerUp, true); window.addEventListener('pointercancel', this.onPointerUp, true);
    this.clearInput = battle.input?.onClear?.(() => { this.pointerId = null; this.keyHeld = false; this.buttonHeld = false; });
  }
  /** 보물방 정화 때 미리 굴린 보상을 담은 상자를 놓는다. */
  /** @param {*} room @param {Array<*>} rewards @param {{x:number,z:number,ry:number,s:number}|null} [pose] */
  add(room, rewards, pose = null) {
    pose ||= { x: room.x, z: room.z, ry: 0, s: 1.2 };
    const item = { room, state: new ChestState(rewards), view: null, x: pose.x, z: pose.z };
    if (this.battle.scene) item.view = new ChestView(this.battle.scene, pose.x, pose.z, pose.ry, pose.s);
    this.items.push(item);
    return item;
  }
  hitChest(item, sx, sy) {
    const cam = this.battle.renderer?.camera; if (!cam) return false;
    this._c.set(item.x, .6, item.z).project(cam);
    this._v.set(item.x, 1.6, item.z).project(cam);
    const w = innerWidth, h = innerHeight;
    const cx = (this._c.x + 1) / 2 * w, cy = (1 - this._c.y) / 2 * h;
    const radius = Math.max(56, Math.abs((this._v.y - this._c.y) / 2 * h) * 1.3);
    return Math.hypot(sx - cx, sy - cy) <= radius;
  }
  update(dt) {
    const b = this.battle, player = b.player, reduced = !!b.app?.reducedMotion?.matches;
    let nearest = null, best = Infinity;
    for (const item of this.items) {
      if (item.state.phase !== 'open' && player?.alive) {
        const d = Math.hypot(player.pos.x - item.x, player.pos.z - item.z);
        if (d <= CHEST_RANGE && d < best) { best = d; nearest = item; }
      }
    }
    this.nearest = nearest;
    const holding = this.pointerId !== null || this.keyHeld || this.buttonHeld;
    for (const item of this.items) {
      const inRange = item === nearest;
      const auto = !!player?.auto && player.alive && item.state.phase !== 'open';
      const before = item.state.progress;
      if (item.state.step(b.paused ? 0 : dt, { holding: holding && inRange, inRange, auto })) this.reveal(item);
      else if (inRange && holding && item.state.progress > before && Math.floor(item.state.progress * 6) !== Math.floor(before * 6)) audio.play('coin0', { vol: .25, rate: .8 + item.state.progress * .6 });
      item.view?.update(dt, item.state, inRange, reduced);
    }
    if (this.button) {
      const show = !!nearest && !player?.auto && !b.paused;
      if (this.button.hidden === show) this.button.hidden = !show;
      if (show) this.button.style.setProperty('--chest-progress', String(Math.round(nearest.state.progress * 100) / 100));
    }
  }
  reveal(item) {
    const b = this.battle, rewards = item.state.claimRewards(); if (!rewards) return;
    item.view?.open();
    const at = new THREE.Vector3(item.x, .9, item.z);
    for (const r of rewards) b.drops?.spawn(at, r.kind, r.payload, { count: r.count || 1, spread: r.spread || 1.8 });
    b.fx?.burst?.(at, 0xffd060, { n: 46, speed: 8, size: .45, up: 2.2, grav: 7, life: 1.1 });
    b.fx?.embers?.(at.clone().setY(0), 0xffe080, { n: 24, radius: 1.2, life: 1.6, rise: 3.2 });
    b.renderer?.shake?.(.22);
    audio.play('pack_open', { vol: .7 }); audio.play('coin_stack', { vol: .55, delay: .12 }); audio.vibe?.([18, 24, 60]);
  }
  /** 정산 직전: 열지 않은 상자의 보상을 그 자리에 쏟아 기존 자동 수거가 거두게 한다. 이미 연 상자는 다시 지급하지 않는다. */
  openAll() { for (const item of this.items) if (item.state.forceOpen()) this.reveal(item); }
  dispose() {
    for (const item of this.items) item.view?.dispose();
    this.items.length = 0;
    if (typeof window === 'undefined') return;
    this.button?.remove(); this.clearInput?.();
    window.removeEventListener('keydown', this.onKey); window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('pointerup', this.onPointerUp, true); window.removeEventListener('pointercancel', this.onPointerUp, true);
  }
}

