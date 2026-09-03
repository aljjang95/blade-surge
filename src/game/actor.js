import * as THREE from 'three';
import { spawnCharacter } from '../engine/assets.js';
import { RIGS } from '../data/rigs.js';

const _v = new THREE.Vector3();
export const ARENA_R = 15.5;

export class Actor {
  constructor(game, gltf, { scale = 1, tint = null, rig = 'kaykit' } = {}) {
    this.rig = RIGS[rig] || RIGS.kaykit; this.rigName = rig;
    this.game = game;
    const { root, mixer, clips } = spawnCharacter(gltf);
    this.model = root; this.mixer = mixer; this.clips = clips;
    this.root = new THREE.Group(); this.root.add(root); root.scale.setScalar(scale);
    this.scale = scale;
    this.pos = this.root.position; this.yaw = 0;
    this.vel = new THREE.Vector3(); this.kb = new THREE.Vector3();
    this.hp = 100; this.maxHp = 100; this.alive = true; this.dead = false;
    this.action = null; this.actionName = ''; this.flashT = 0; this.flashColor = new THREE.Color(1, 1, 1);
    this.stun = 0; this.slow = 0; this.slowT = 0; this.invuln = 0; this.radius = 0.7 * scale;
    this.mats = []; this.model.traverse((o) => { if (o.isMesh) this.mats.push(o.material); });
    // 틴트: 곱하면 Quaternius 텍스처가 통짜 색으로 뭉개진다 → 원래 색과 lerp
    // KayKit 은 밝은 아틀라스라 틴트가 잘 먹지만, Quaternius 는 채도가 높아 색을 건드리면 통짜로 뭉갠다.
    if (tint && rig === 'kaykit') { const c = new THREE.Color(tint); for (const m of this.mats) m.color.lerp(c, 0.85); }
    this.deathT = -1; this.hurtAnimT = 0;
    this.mixer.addEventListener('finished', (e) => this.onAnimFinished?.(e));
    game.scene.add(this.root);
  }
  get x() { return this.pos.x; } get z() { return this.pos.z; }
  /** 논리 애니 키를 리그별 실제 클립 이름으로. 배열이면 랜덤. 없으면 idle 폴백 */
  A(key) {
    const v = this.rig[key];
    const pick = Array.isArray(v) ? v[Math.floor(Math.random() * v.length)] : v;
    if (pick && this.clips[pick]) return pick;
    // 폴백 체인
    for (const k of [key === 'run' ? 'walk' : null, 'idleCombat', 'idle']) {
      if (!k) continue; const f = this.rig[k]; const fp = Array.isArray(f) ? f[0] : f;
      if (fp && this.clips[fp]) return fp;
    }
    return Object.keys(this.clips)[0];
  }
  has(key) { const v = this.rig[key]; const p = Array.isArray(v) ? v[0] : v; return !!(p && this.clips[p]); }
  setVisibleParts(show, all) { for (const n of all) { const o = this.model.getObjectByName(n); if (o) o.visible = show.includes(n); } }
  play(name, { loop = true, fade = 0.12, speed = 1, once = false, clamp = false, restart = true } = {}) {
    const clip = this.clips[name]; if (!clip) return null;
    const a = this.mixer.clipAction(clip);
    if (this.action === a && !restart) { a.timeScale = speed; return a; }
    if (this.action && this.action !== a) this.action.fadeOut(fade);
    a.reset(); a.enabled = true; a.setLoop(loop && !once ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = clamp || once; a.timeScale = speed; a.setEffectiveWeight(1); a.fadeIn(fade); a.play();
    this.action = a; this.actionName = name; return a;
  }
  /** duration(초)에 맞춰 애니 속도 조정해서 재생 */
  playTimed(name, duration, opts = {}) { const clip = this.clips[name]; if (!clip) return null; return this.play(name, { ...opts, once: true, speed: clip.duration / duration }); }
  face(x, z) { this.yaw = Math.atan2(x - this.pos.x, z - this.pos.z); }
  faceDir(dx, dz) { if (dx || dz) this.yaw = Math.atan2(dx, dz); }
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  distTo(o) { return Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z); }
  flash(color = 0xffffff, t = 0.12) { this.flashT = t; this.flashColor.set(color); }
  knockback(dirx, dirz, force) { const l = Math.hypot(dirx, dirz) || 1; this.kb.x += dirx / l * force; this.kb.z += dirz / l * force; }
  update(dt) {
    this.mixer.update(dt);
    // 넉백 감쇠
    const fx0 = this.pos.x, fz0 = this.pos.z;
    if (this.kb.lengthSq() > 0.0001) { this.pos.addScaledVector(this.kb, dt); this.kb.multiplyScalar(Math.pow(0.02, dt)); }
    this.pos.addScaledVector(this.vel, dt);
    // 벽 충돌 (월드가 있으면 슬라이딩, 없으면 원형 아레나)
    const W = this.game.world;
    if (W) { const [rx, rz] = W.resolve(fx0, fz0, this.pos.x, this.pos.z, this.radius * 0.8); this.pos.x = rx; this.pos.z = rz; }
    else { const d = Math.hypot(this.pos.x, this.pos.z); if (d > ARENA_R) { this.pos.x *= ARENA_R / d; this.pos.z *= ARENA_R / d; } }
    this.pos.y = this.rig.hover || 0;
    this.root.rotation.y = this.yaw + (this.rig.faceFlip ? Math.PI : 0);
    if (this.stun > 0) this.stun -= dt;
    if (this.slowT > 0) { this.slowT -= dt; if (this.slowT <= 0) this.slow = 0; }
    if (this.invuln > 0) this.invuln -= dt;
    // 히트 플래시
    // 장비 발광(look.js 의 baseEmissive)은 플래시·틴트 밑에 항상 깔린다
    if (this.flashT > 0) { this.flashT -= dt; const k = Math.max(0, this.flashT / 0.12); for (const m of this.mats) { m.emissive.copy(this.flashColor).multiplyScalar(k * 1.2); if (m.userData.baseEmissive) m.emissive.add(m.userData.baseEmissive); } this._emDirty = true; }
    else if (this.tintEmissive) { for (const m of this.mats) { m.emissive.copy(this.tintEmissive); if (m.userData.baseEmissive) m.emissive.add(m.userData.baseEmissive); } this._emDirty = true; }
    else if (this._emDirty) { this._emDirty = false; for (const m of this.mats) { if (m.userData.baseEmissive) m.emissive.copy(m.userData.baseEmissive); else m.emissive.setScalar(0); } }
    if (this.deathT >= 0) { this.deathT += dt; if (this.deathT > 1.2) { this.pos.y = (this.rig.hover || 0) - (this.deathT - 1.2) * 1.5; } if (this.deathT > 2.4) this.dead = true; }
  }
  die() {
    if (!this.alive) return; this.alive = false; this.deathT = 0; this.vel.set(0, 0, 0);
    this.play(Math.random() < 0.5 ? 'Death_A' : 'Death_B', { once: true, clamp: true, fade: 0.08 });
    for (const m of this.mats) { m.transparent = true; }
  }
  dispose() { this.game.scene.remove(this.root); this.model.traverse((o) => { if (o.isMesh) o.material.dispose(); }); }
  /** 무기 트레일용: 손 위치와 무기 끝 */
  /** GLTFLoader 는 노드 이름의 '.' 등을 제거함 → 원본/정제 이름 모두 검색 */
  node(name) { return this.model.getObjectByName(name) || this.model.getObjectByName(name.replace(/[^\w-]/g, '')); }
  weaponPoints(handName = 'handslot.r', len = 1.3) {
    const h = this.node(handName); if (!h) return null;
    const a = new THREE.Vector3(); h.getWorldPosition(a);
    const b = new THREE.Vector3(0, len * this.scale, 0); h.localToWorld(b);
    return [a, b];
  }
}
