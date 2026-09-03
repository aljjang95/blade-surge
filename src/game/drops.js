import * as THREE from 'three';
import { audio } from '../engine/audio.js';
import { getPart, softCircleTex } from '../engine/assets.js';
import { RARITY_COLOR, ITEM_BY_ID, ITEM_ICON } from '../data/items.js';

const _v = new THREE.Vector3();

/**
 * 필드 드랍: 코인/장비/강화석이 3D 로 튀어나오고, 플레이어가 가까이 가면 자석처럼 빨려온다.
 * 몹몰이 → 광역 처치 → 드랍 비처럼 쏟아지는 도파민 루프의 핵심.
 */
export class DropSystem {
  constructor(game) {
    this.game = game; this.scene = game.scene;
    this.items = [];
    this.magnetR = 4.2;      // 자석 반경
    this.pickR = 1.1;
    this.gold = 0; this.stones = 0; this.stones2 = 0; this.stones3 = 0; this.fragments = 0; this.loot = [];
    this._geoCoin = null; this._matCache = {};
    this.beamMat = new THREE.SpriteMaterial({ map: softCircleTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  }
  setup(dungeonGltf) {
    // 코인 메시 (던전 킷) — 없으면 실린더 폴백
    const src = dungeonGltf?.scene.getObjectByName('coin');
    if (src) { let m = null; src.traverse((o) => { if (!m && o.isMesh) m = o; }); if (m) { this._geoCoin = m.geometry; this._matCoin = m.material; } }
    if (!this._geoCoin) { this._geoCoin = new THREE.CylinderGeometry(0.18, 0.18, 0.05, 10); this._matCoin = new THREE.MeshStandardMaterial({ color: 0xffcf5a, metalness: 0.6, roughness: 0.35, emissive: 0x664400 }); }
    else { this._matCoin = this._matCoin.clone(); this._matCoin.emissive = new THREE.Color(0x553300); }
  }
  _mat(color, emissive = 1.2) {
    const key = color + '|' + emissive;
    if (!this._matCache[key]) this._matCache[key] = new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(emissive), roughness: 0.3, metalness: 0.5 });
    return this._matCache[key];
  }
  /** kind: 'gold' | 'stone' | 'item' */
  spawn(pos, kind, payload, { count = 1, spread = 1 } = {}) {
    for (let i = 0; i < count; i++) {
      let mesh;
      if (kind === 'gold') { mesh = new THREE.Mesh(this._geoCoin, this._matCoin); mesh.scale.setScalar(1.1); }
      else if (kind === 'stone') { mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), this._mat(0x4cc3ff, 1.6)); mesh.userData.own = true; }
      else if (kind === 'stone2') { mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), this._mat(0x3a7bff, 2.0)); mesh.userData.own = true; }
      else if (kind === 'stone3') { mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.34), this._mat(0xffd35a, 2.4)); mesh.userData.own = true; }
      else if (kind === 'frag') { mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.1, 6), this._mat(0xb26bff, 2.0)); mesh.userData.own = true; }
      else { const c = RARITY_COLOR[payload.rarity] || '#fff'; mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), this._mat(new THREE.Color(c).getHex(), 1.4)); mesh.userData.own = true; }
      mesh.position.copy(pos); mesh.position.y = 0.6 + Math.random() * 0.3;
      mesh.castShadow = false;
      const a = Math.random() * Math.PI * 2, s = (1.5 + Math.random() * 2.5) * spread;
      const it = { mesh, kind, payload, vx: Math.cos(a) * s, vy: 4 + Math.random() * 3, vz: Math.sin(a) * s, t: 0, state: 'fly', spin: (Math.random() - 0.5) * 8 };
      this.scene.add(mesh); this.items.push(it);
      // 희귀 장비는 기둥 빔
      if (kind === 'item' && ['E', 'U', 'L'].includes(payload.rarity)) {
        const beam = new THREE.Sprite(this.beamMat.clone()); beam.material.color.set(RARITY_COLOR[payload.rarity]);
        beam.scale.set(1.4, 5, 1); beam.position.copy(pos).setY(2.2); this.scene.add(beam); it.beam = beam;
        this.game.fx.groundTex(pos, 'shockwave', RARITY_COLOR[payload.rarity], { r0: 0.3, r1: 3, life: 0.6 });
        if (payload.rarity === 'L') { this.game.fx.holyBurst(pos, { size: 5, color: 0xff9a2e }); audio.play('jingle_legend', { vol: 0.7 }); this.game.renderer.flashScreen(0.25, 0xff9a2e); }
        else if (payload.rarity === 'U') { this.game.fx.holyBurst(pos, { size: 4, color: 0xc07cff }); audio.play('ui_glass', { vol: 0.7, rate: 0.9 }); }
        else audio.play('ui_glass', { vol: 0.6, rate: 1.2 });
      }
    }
  }
  update(dt) {
    const p = this.game.player; if (!p) return;
    const magnet = p.alive ? this.magnetR * (p.magnetMul || 1) : 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]; it.t += dt;
      const m = it.mesh;
      if (it.state === 'fly') {
        it.vy -= 22 * dt;
        m.position.x += it.vx * dt; m.position.y += it.vy * dt; m.position.z += it.vz * dt;
        it.vx *= Math.pow(0.1, dt); it.vz *= Math.pow(0.1, dt);
        if (m.position.y <= 0.28) { m.position.y = 0.28; it.state = 'idle'; it.vy = 0; }
        m.rotation.y += it.spin * dt; m.rotation.x += it.spin * 0.5 * dt;
      } else if (it.state === 'idle') {
        m.rotation.y += 2.2 * dt;
        m.position.y = 0.28 + Math.sin(it.t * 3.2) * 0.12;
        const d = Math.hypot(p.pos.x - m.position.x, p.pos.z - m.position.z);
        if (d < magnet) { it.state = 'magnet'; }
        else if (it.t > 22) { this._remove(i); continue; }  // 오래된 드랍 정리
      } else if (it.state === 'magnet') {
        const dx = p.pos.x - m.position.x, dy = (p.pos.y + 0.9) - m.position.y, dz = p.pos.z - m.position.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        const sp = 9 + it.t * 6;
        m.position.x += dx / d * sp * dt; m.position.y += dy / d * sp * dt; m.position.z += dz / d * sp * dt;
        m.rotation.y += 9 * dt;
        if (d < this.pickR) { this.collect(it); this._remove(i); continue; }
      }
      if (it.beam) { it.beam.position.copy(m.position).setY(2.2); it.beam.material.opacity = it.state === 'magnet' ? 0 : 0.5 + Math.sin(it.t * 4) * 0.2; }
    }
  }
  _remove(i) { const it = this.items[i]; this.scene.remove(it.mesh); if (it.mesh.userData.own) it.mesh.geometry.dispose(); if (it.beam) { this.scene.remove(it.beam); it.beam.material.dispose(); } this.items.splice(i, 1); }
  collect(it) {
    const g = this.game; const p = g.player;
    const pos = p.pos.clone().setY(1.3);
    if (it.kind === 'gold') {
      this.gold += it.payload; g.ui.flyReward(pos, `+${it.payload}`, g.renderer.camera, 'gold');
      audio.coinPick(this._coinIdx = ((this._coinIdx || 0) + 1) % 14);
      g.fx.burst(pos, 0xffcf5a, { n: 3, speed: 3, size: 0.25, life: 0.3 });
    } else if (it.kind === 'stone') {
      this.stones += it.payload; g.ui.flyReward(pos, `강화석 +${it.payload}`, g.renderer.camera, 'stone');
      audio.ice({ vol: 0.3, dur: 0.3 }); g.fx.burst(pos, 0x4cc3ff, { n: 5, speed: 4, size: 0.25, life: 0.35 });
    } else if (it.kind === 'stone2' || it.kind === 'stone3') {
      const hi = it.kind === 'stone3'; this[it.kind] += it.payload;
      g.ui.flyReward(pos, `${hi ? '전설' : '상급'} 강화석 +${it.payload}`, g.renderer.camera, 'stone');
      audio.ice({ vol: 0.4, dur: 0.4 }); if (hi) audio.play('ui_glass', { vol: 0.5, rate: 1.4 });
      g.fx.burst(pos, hi ? 0xffd35a : 0x3a7bff, { n: 9, speed: 5, size: 0.3, life: 0.4 });
    } else if (it.kind === 'frag') {
      this.fragments += it.payload; g.ui.flyReward(pos, `세트 조각 +${it.payload}`, g.renderer.camera, 'stone');
      audio.magic({ vol: 0.25, base: 520, notes: [0, 7, 12], step: 0.04 }); g.fx.burst(pos, 0xb26bff, { n: 8, speed: 5, size: 0.3, life: 0.4 });
    } else {
      this.loot.push(it.payload);
      const def = ITEM_BY_ID[it.payload.id];
      g.ui.lootPopup(def, it.payload.rarity);
      audio.loot(it.payload.rarity);
      g.fx.burst(pos, RARITY_COLOR[it.payload.rarity], { n: 14, speed: 6, size: 0.35, life: 0.5 });
      audio.vibe(it.payload.rarity === 'L' ? [40, 30, 90] : it.payload.rarity === 'U' ? [30, 20, 50] : 20);
      if (it.payload.rarity === 'L') audio.voice('legend_drop', { min: 5 }); else if (it.payload.rarity === 'U') audio.voice('unique_drop', { min: 8 });
    }
  }
  /** 적 처치 시 드랍 롤 */
  onKill(enemy, stage) {
    const pos = enemy.pos.clone();
    const g = enemy.def.gold || 1;
    const goldAmt = Math.max(1, Math.floor(g * stage.scale * (0.8 + Math.random() * 0.5)));
    this.spawn(pos, 'gold', goldAmt, { count: enemy.isBoss ? 8 : enemy.isElite ? 3 : 1, spread: enemy.isBoss ? 2 : 1 });
    if (enemy.isBoss || enemy.isElite || Math.random() < 0.18) this.spawn(pos, 'stone', enemy.isBoss ? 5 : enemy.isElite ? 2 : 1, { count: 1 });
    // 비석 상위 등급: 엘리트 → 상급, 보스 → 전설. 세트 조각은 엘리트·보스에서만 (제작 30개)
    if (enemy.isElite) { this.spawn(pos, 'stone2', 1, { count: 1 }); if (Math.random() < 0.6) this.spawn(pos, 'frag', 2, { count: 1 }); }
    if (enemy.isBoss) { this.spawn(pos, 'stone2', 2, { count: 1 }); this.spawn(pos, 'stone3', 1, { count: 1 }); this.spawn(pos, 'frag', 5, { count: 1, spread: 1.5 }); }
    // 장비: 엘리트 확정, 보스 2개, 잡몹 낮은 확률
    // 장비: 보스 3, 엘리트 2, 잡몹 8% — 자주 떨어지되 대부분 흰·초록 (등급 가중치가 희소성을 만든다)
    const rolls = enemy.isBoss ? 3 : enemy.isElite ? 2 : (Math.random() < 0.08 ? 1 : 0);
    for (let i = 0; i < rolls; i++) {
      const table = enemy.isBoss ? 'boss' : enemy.isElite ? 'elite' : 'normal';
      const inst = this.game.rollDrop(table);
      if (inst) this.spawn(pos, 'item', inst, { count: 1, spread: 1.4 });
    }
  }
  clear() { while (this.items.length) this._remove(this.items.length - 1); this.gold = 0; this.stones = 0; this.stones2 = 0; this.stones3 = 0; this.fragments = 0; this.loot = []; }
}
