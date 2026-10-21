import * as THREE from 'three';
import { materialsOf, spawnCharacter } from '../engine/assets.js';
import { RIGS } from '../data/rigs.js';
import { attackPhase, attackBody, monsterAttackPhase } from './combat-motion.js';
import { knockbackDecay } from './feel.js';

const _v = new THREE.Vector3();
const _weaponQuaternion = new THREE.Quaternion();
export const ARENA_R = 15.5;
// 처치 연출(위로 튀며 회전)의 길이와 결정적 변주. 게임 난수를 소비하지 않는다.
const LAUNCH_SEC = 0.55;
// 렌더 피벗 방향 보간 시간상수(초). 0.1초 안에 90% 따라간다.
const TURN_SMOOTH_SEC = 0.045;
const DEATH_TURN_SEC = 0.06;
let launchSerial = 0x2f6e2b1;
const launchNoise = () => (launchSerial = (Math.imul(launchSerial, 1664525) + 1013904223) >>> 0) / 4294967296;

export class Actor {
  /** @param {*} game @param {*} gltf @param {{scale?: number, tint?: string|number|null, rig?: string, roster?: *}} options */
  constructor(game, gltf, { scale = 1, tint = null, rig = 'kaykit', roster = null } = {}) {
    this.rig = RIGS[rig] || RIGS.kaykit; this.rigName = rig;
    this.game = game;
    this.libraryAsset = gltf.scene.userData.libraryAsset || null;
    // 여러 기존 모델 이름이 같은 Tripo 자산(캐시된 glTF 하나)을 공유하므로 로스터는 호출자가 자기 정의로 넘긴다.
    this.libraryRoster = roster || gltf.scene.userData.libraryRoster || null;
    const { root, mixer, clips } = spawnCharacter(gltf);
    this.model = root; this.mixer = mixer; this.clips = clips;
    this.root = new THREE.Group();
    // Render-only pivot: preserve authored bones, sockets, scale and collision root.
    this.motionRoot = new THREE.Group(); this.root.add(this.motionRoot); this.motionRoot.add(root); root.scale.multiplyScalar(scale);
    this._attackMotion = null; this._impact = null;
    this.scale = scale;
    if (this.libraryRoster?.scale) this.model.scale.multiplyScalar(this.libraryRoster.scale);
    // 등장·자폭 연출이 배율을 다시 쓸 때 로스터 보정을 잃지 않도록 최종 모델 배율을 기준으로 남긴다.
    this.modelScale = this.model.scale.x;
    // 비행 클립(사망·내려찍기)은 모델 단위로 hover 만큼 내려와 착지한다. 실제 적용 배율을 곱해야 지면에 맞는다.
    const hover = (this.libraryAsset?.hover ?? 0) * scale * (this.libraryRoster?.scale || 1);
    if (hover > 0) this.rig = { ...this.rig, hover };
    this.pos = this.root.position; this.yaw = 0;
    this.vel = new THREE.Vector3(); this.kb = new THREE.Vector3();
    this.hp = 100; this.maxHp = 100; this.alive = true; this.dead = false;
    this.action = null; this.actionName = ''; this.flashT = 0; this.flashDuration = 0; this.flashGain = 1; this.flashColor = new THREE.Color(1, 1, 1);
    this.stun = 0; this.slow = 0; this.slowT = 0; this.invuln = 0; this.radius = 0.7 * scale;
    this.mats = []; this.model.traverse((o) => { if (o.isMesh) this.mats.push(...materialsOf(o).filter((m) => m.emissive)); });
    // 틴트: 곱하면 Quaternius 텍스처가 통짜 색으로 뭉개진다 → 원래 색과 lerp
    // KayKit 은 밝은 아틀라스라 틴트가 잘 먹지만, Quaternius 는 채도가 높아 색을 건드리면 통짜로 뭉갠다.
    if (tint && rig === 'kaykit' && !this.model.userData.authoredContract) { const c = new THREE.Color(tint); for (const m of this.mats) if (!m.userData.tllAuthored) m.color?.lerp(c, 0.85); }
    // 라이브러리 몬스터는 손그림 텍스처를 살리며 적 정의 색조(지역 변종·정예)를 옅게 입힌다. 재질은 인스턴스별 복제본이다.
    else if (tint && rig === 'library') { const c = new THREE.Color(tint); for (const m of this.mats) m.color?.lerp(c, 0.32); }
    this.deathT = -1; this.hurtAnimT = 0; this.launchT = -1; this.launchH = 0; this.launchTilt = 0; this.launchSpin = 0;
    this.mixer.addEventListener('finished', (e) => this.onAnimFinished?.(e));
    game.scene.add(this.root);
  }
  get x() { return this.pos.x; } get z() { return this.pos.z; }
  /** 논리 애니 키를 리그별 실제 클립 이름으로. 배열이면 랜덤. 없으면 idle 폴백 */
  A(key) {
    const v = this.rig[key];
    const choices = Array.isArray(v) ? v : [v];
    const available = choices.filter((name) => name && this.clips[name]);
    if (available.length) return available.length === 1 ? available[0] : available[Math.floor(Math.random() * available.length)];
    // 라이브러리 클립은 제작 시점에 선택적으로 추가되므로 논리 키별 폴백을 둔다.
    const chain = {
      attack2: ['attack'], attackHeavy: ['attack', 'attack2'], attackSpin: ['attackHeavy', 'attack'],
      attackJump: ['attackHeavy', 'attack'], cast: ['attack'], raise: ['cast', 'attack'],
      summon: ['roar', 'cast', 'attack'], spawn: ['roar', 'idle'], run: ['walk'],
      // 강타 피격 클립이 없는 자산은 일반 피격으로(예전에는 idle 로 떨어져 강타를 맞아도 서 있었다).
      hitHeavy: ['hit'],
    }[key] || [];
    // 폴백은 난수 없이 리그 후보 중 첫 실제 클립, 없으면 논리 이름 그대로의 클립을 쓴다.
    for (const fallback of chain) {
      const mapped = this.rig[fallback];
      if (Array.isArray(mapped)) { for (const name of mapped) if (name && this.clips[name]) return name; }
      else if (mapped && this.clips[mapped]) return mapped;
      if (this.clips[fallback]) return fallback;
    }
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
    this._attackMotion = null;
    const a = this.mixer.clipAction(clip);
    if (this.action === a && !restart) { a.timeScale = speed; return a; }
    if (this.action && this.action !== a) this.action.fadeOut(fade);
    a.reset(); a.enabled = true; a.setLoop(loop && !once ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = clamp || once; a.timeScale = speed; a.setEffectiveWeight(1); a.fadeIn(fade); a.play();
    this.action = a; this.actionName = name; return a;
  }
  /** duration(초)에 맞춰 애니 속도 조정해서 재생 */
  playTimed(name, duration, opts = {}) {
    const clip = this.clips[name]; if (!clip) return null;
    const action = this.play(name, { ...opts, once: true, speed: clip.duration / duration });
    // 영웅 콤보와 몬스터 라이브러리 공격 모두 렌더 클립의 접촉 프레임을 고정한다.
    if (action && this.state === 'attack' && opts.phase === 'monster') {
      this._attackMotion = { action, clip, phase: 'monster', duration, hitAt: opts.hitAt, impactAt: opts.impactAt };
      action.timeScale = 0;
    } else if (action && this.state === 'attack' && this.def?.combo?.includes(this.current) && !this.current.ticks && this.current.move !== 'spin') {
      this._attackMotion = { action, combo: this.current, clip };
      action.timeScale = 0;
    }
    return action;
  }
  receiveImpact(dirx, dirz, strength = 0.5) {
    if (this.game.app?.reducedMotion?.matches) return;
    const angle = (Math.hypot(dirx, dirz) > 0 ? Math.atan2(dirx, dirz) : this.yaw) - this.yaw - (this.rig?.faceFlip ? Math.PI : 0);
    this._impact = { t: 0, strength: Math.min(1, Math.max(0, strength)), x: Math.sin(angle), z: Math.cos(angle) };
  }
  /** 처치 연출: 렌더 피벗만 위로 튀며 한 바퀴 돈다. 판정 위치·드랍·충돌 루트는 건드리지 않고 제자리로 돌아온다. */
  launchOnKill(strength = 1) {
    if (this.game.app?.reducedMotion?.matches) return;
    this.launchT = 0; this.launchH = (0.9 + launchNoise() * 0.4) * Math.min(1.6, Math.max(0.6, strength));
    this.launchTilt = (launchNoise() < 0.5 ? -1 : 1) * (0.7 + launchNoise() * 0.5);
    this.launchSpin = (launchNoise() < 0.5 ? -1 : 1);
  }
  receiveStrikeRecoil(strength = .5) {
    if (!this.game.app?.reducedMotion?.matches) this._strikeRecoil = {t:0,strength:Math.min(1,Math.max(0,strength))};
  }
  updateCombatPose(dt) {
    const pivot = this.motionRoot, reduced = this.game.app?.reducedMotion?.matches;
    pivot.position.set(0, 0, 0); pivot.rotation.set(0, 0, 0); pivot.scale.set(1,1,1);
    const motion = this._attackMotion;
    if (motion && this.state === 'attack' && this.action === motion.action &&
      (motion.phase === 'monster' || this.current === motion.combo)) {
      if (motion.phase === 'monster') {
        const t = Math.min(1, (this.stateT + dt) / motion.duration);
        motion.action.time = monsterAttackPhase(t, motion.hitAt, motion.impactAt) * motion.clip.duration;
      } else {
        const c = motion.combo;
        const expires = this.buffs?.t > 0 && this.buffs.t <= dt;
        const speed = (expires ? 1 : (this.buffs?.atkSpd || 1)) * (this.stormT > dt ? 1.4 : 1);
        const t = Math.min(1, (this.stateT + dt) / (c.dur / speed));
        motion.action.time = attackPhase(t, c.hitAt) * motion.clip.duration;
      }
      this.mixer.update(0);
    }
    if (!reduced && this._monsterAttackPose && this.state === 'attack') {
      const pose = this._monsterAttackPose;
      const t = Math.min(1, (this.stateT + dt) / pose.duration);
      const weight = Math.min(2, Math.max(.5, (this.scale || 1) * (pose.heightM || 1)));
      const before = t < pose.hitAt ? Math.sin(Math.PI * t / pose.hitAt) : 0;
      const snap = t >= pose.hitAt && pose.hitAt < .999 ? Math.max(0, 1 - (t - pose.hitAt) / (1 - pose.hitAt)) ** 1.65 : 0;
      const profile = pose.profile;
      const heavy = profile === 'brute' || pose.boss || pose.elite ? 1.2 : profile === 'soldier' ? .75 : 1;
      pivot.rotation.x += (-before * .13 + snap * .2) * weight * heavy;
      pivot.position.z += (-before * .08 + snap * .16) * weight;
      if (profile === 'blob') pivot.scale.set(1 + snap * .16, 1 - snap * .12, 1 + snap * .16);
      else if (profile === 'flyer' || profile === 'drake') pivot.position.y += before * .12 - snap * .2;
    }
    const c = this.current;
    if (!reduced && this.state === 'attack' && this.def?.combo?.includes(c)) {
      const expires = this.buffs?.t > 0 && this.buffs.t <= dt;
      const speed = (expires ? 1 : (this.buffs?.atkSpd || 1)) * (this.stormT > dt ? 1.4 : 1);
      const t = Math.min(1, (this.stateT + dt) / (c.dur / speed));
      const warriorIndex = this.def.id === 'knight' || this.def.id === 'barbarian' ? this.comboIdx : -1;
      const pose = attackBody(t, c.hitAt, this.def.weapon, this.def.ranged, warriorIndex, c.move, c.finisher);
      pivot.rotation.x = pose.pitch; pivot.rotation.y = pose.yaw; pivot.position.z = pose.forward; pivot.rotation.z = pose.roll || 0;
    }
    if (this._strikeRecoil) {
      const s = this._strikeRecoil; s.t += dt;
      if (s.t >= .21 || reduced) this._strikeRecoil = null;
      else { const kick = (1 - s.t / .21) ** 2 * s.strength;
        pivot.position.z -= kick * .16; pivot.rotation.x -= kick * .12; pivot.rotation.z += kick * .035;
      }
    }
    if (this.launchT >= 0) {
      this.launchT += dt;
      const k = this.launchT / LAUNCH_SEC;
      if (k >= 1 || reduced) this.launchT = -1;
      else {
        // 포물선 높이와 한 바퀴 회전은 모두 k=0 과 k=1 에서 0(또는 한 바퀴)이라 끝날 때 튀지 않는다.
        pivot.position.y += this.launchH * 4 * k * (1 - k);
        pivot.rotation.x += this.launchTilt * Math.sin(k * Math.PI);
        pivot.rotation.y += this.launchSpin * k * Math.PI * 2;
      }
    }
    if (this._impact) {
      const i = this._impact; i.t += dt;
      if (i.t >= 0.24 || reduced) this._impact = null;
      else {
        const decay = (1 - i.t / 0.24) ** 2 * i.strength;
        pivot.rotation.x += i.z * decay * 0.38;
        pivot.rotation.z -= i.x * decay * 0.38;
        pivot.position.x += i.x * decay * .24; pivot.position.z += i.z * decay * .24;
        const squash = Math.min(.09, decay * .09);
        pivot.scale.set(1 + squash*.55, 1 - squash, 1 + squash*.55);
      }
    }
    if (this._deathTurn) {
      // 처치 순간 공격자 쪽으로 돌아선 몸을 렌더에서만 시간상수 DEATH_TURN_SEC 로 따라 돌린다.
      this._deathTurn = reduced || Math.abs(this._deathTurn) < 1e-3 ? 0 : this._deathTurn * Math.exp(-dt / DEATH_TURN_SEC);
      pivot.rotation.y += this._deathTurn;
    }
    this.updateTurnSmoothing(dt, reduced);
  }
  /** 렌더 전용 방향 보간: 판정 방향(yaw)은 즉시, 보이는 몸은 시간상수 TURN_SMOOTH_SEC 로 따라 돈다. 판정·위치·난수는 건드리지 않는다. */
  updateTurnSmoothing(dt, reduced) {
    if (!this.turnSmoothing || reduced || !this.alive) { this._shownYaw = this.yaw; return; }
    if (!Number.isFinite(this._shownYaw)) this._shownYaw = this.yaw;
    const lag = Math.atan2(Math.sin(this._shownYaw - this.yaw), Math.cos(this._shownYaw - this.yaw)) * Math.exp(-dt / TURN_SMOOTH_SEC);
    this._shownYaw = this.yaw + lag;
    if (Math.abs(lag) > 1e-4) this.motionRoot.rotation.y += lag;
  }
  face(x, z) { this.yaw = Math.atan2(x - this.pos.x, z - this.pos.z); }
  faceDir(dx, dz) { if (dx || dz) this.yaw = Math.atan2(dx, dz); }
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  distTo(o) { return Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z); }
  flash(color = 0xffffff, t = 0.12, gain = 1) { this.flashT = this.flashDuration = t; this.flashColor.set(color); this.flashGain = gain; }
  updateHitFeedback(dt) {
    // 피격 신호는 재질 위의 짧은 악센트다. 긴 치명타도 더 밝아지지 않는다.
    // 장비·유령의 기존 발광은 보존하고, 흰 발광으로 텍스처를 지우지 않는다.
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      const k = this.flashT / this.flashDuration;
      const strength = (this.game.app?.reducedMotion?.matches ? .16 : .38 * (this.flashGain || 1)) * k * k;
      for (const m of this.mats) {
        m.emissive.copy(this.flashColor).multiplyScalar(strength);
        if (this.tintEmissive) m.emissive.add(this.tintEmissive);
        if (m.userData.baseEmissive) m.emissive.add(m.userData.baseEmissive);
      }
      this._emDirty = true;
    }
    else if (this.tintEmissive) { for (const m of this.mats) { m.emissive.copy(this.tintEmissive); if (m.userData.baseEmissive) m.emissive.add(m.userData.baseEmissive); } this._emDirty = true; }
    else if (this._emDirty) { this._emDirty = false; for (const m of this.mats) { if (m.userData.baseEmissive) m.emissive.copy(m.userData.baseEmissive); else m.emissive.setScalar(0); } }
  }
  knockback(dirx, dirz, force) { const l = Math.hypot(dirx, dirz) || 1; this.kb.x += dirx / l * force; this.kb.z += dirz / l * force; }
  update(dt) {
    // 영웅 가산 자세 층(heroPose): 이전 프레임 보정을 되돌린 뒤 mixer가 원본을 쓰고, 마지막에 보정을 얹는다.
    this.heroPose?.restore();
    this.mixer.update(dt);
    this.updateCombatPose(dt);
    this.heroPose?.apply(dt);
    // 넉백 감쇠
    const fx0 = this.pos.x, fz0 = this.pos.z;
    if (this.kb.lengthSq() > 0.0001) { this.pos.addScaledVector(this.kb, dt); this.kb.multiplyScalar(knockbackDecay(dt)); }
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
    this.updateHitFeedback(dt);
    if (this.deathT >= 0) {
      if (this.game.routeObjectives?.hidesCorpse?.(this)) this.model.visible = false;
      this.deathT += dt;
      if (this.deathT > 1.2) this.pos.y = (this.rig.hover || 0) - (this.deathT - 1.2) * 1.5;
      if (this.deathT > 2.4) this.dead = true;
    }
  }
  die() {
    if (!this.alive) return; this.alive = false; this.deathT = 0; this.vel.set(0, 0, 0);
    // 리그별 사망 클립(KayKit Death_A/B, Tripo 라이브러리 death)을 논리 키로 고른다. 난수 소비는 1회로 동일하다.
    const deathClip = this.rig?.death === 'death' || (Array.isArray(this.rig?.death) && this.rig.death[0] === 'death') ? 'death' : null;
    this.play(deathClip && this.clips?.[deathClip] ? deathClip : (Math.random() < 0.5 ? 'Death_A' : 'Death_B'), { once: true, clamp: true, fade: 0.08 });
    for (const m of this.mats) { m.transparent = true; }
  }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.game.scene.remove(this.root); this.heroPose?.dispose(); this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.mixer.getRoot());
    const skeletons = new Set(), materials = new Set();
    this.model.traverse((o) => {
      if (o.isSkinnedMesh) skeletons.add(o.skeleton);
      if (o.isMesh) for (const material of materialsOf(o)) materials.add(material);
    });
    // spawnCharacter가 복제한 스켈레톤의 전용 boneTexture만 정리한다.
    for (const skeleton of skeletons) skeleton.dispose();
    for (const material of materials) material.dispose();
  }
  /** 무기 트레일용: 손 위치와 무기 끝 */
  /** GLTFLoader 는 노드 이름의 '.' 등을 제거함 → 원본/정제 이름 모두 검색 */
  node(name) { return this.model.getObjectByName(name) || this.model.getObjectByName(name.replace(/[^\w-]/g, '')); }
  weaponPoints(handName = 'handslot.r', len = 1.3, points = [new THREE.Vector3(), new THREE.Vector3()]) {
    handName = this.model.userData.authoredContract?.sockets?.[handName] || handName;
    const h = this.node(handName); if (!h) return null;
    const a = points[0]; h.getWorldPosition(a);
    const b = points[1].set(0, len * this.scale, 0);
    if (this.model.userData.authoredContract) {
      h.getWorldQuaternion(_weaponQuaternion);
      b.applyQuaternion(_weaponQuaternion).add(a);
    } else h.localToWorld(b);
    return points;
  }
}
