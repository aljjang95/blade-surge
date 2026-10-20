import * as THREE from 'three';
import { VFX_TEX } from './assets.js';
import { resolveHeroGrade, skillVfxKey } from './skill-vfx.js';

/**
 * 등급 오라: SR 없음, SSR 금색 테두리(약하게), SSSR 무지개 테두리 + aura-sssr.
 * 플레이어마다 메시 2개(지면 링, 몸 주변 빌보드)와 재질 2개를 한 번만 만들고 등급에 따라 보이기만 바꾼다.
 * update 는 할당하지 않는다. 텍스처는 공유 캐시 소유라 dispose 에서 건드리지 않는다.
 */
const RING_TEX = skillVfxKey('skill-rune-circle-gold'), AURA_TEX = skillVfxKey('aura-sssr');
const GOLD = new THREE.Color(0xffd060);
const SSR_OPACITY = 0.2, SSSR_RING_OPACITY = 0.5, SSSR_AURA_OPACITY = 0.55;
let sharedPlane = null, sharedPlaneUsers = 0;

export class GradeAura {
  /** @param {THREE.Object3D} root 플레이어 루트(발 위치 기준) */
  constructor(root) {
    this.root = root; this.grade = 'SR'; this.hue = 0; this.t = 0; this.disposed = false;
    this.group = null; this.ring = null; this.aura = null;
  }
  _build() {
    if (this.group || this.disposed) return;
    sharedPlane ||= new THREE.PlaneGeometry(1, 1);
    sharedPlaneUsers++;
    const material = () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.group = new THREE.Group(); this.group.name = 'GradeAura'; this.group.visible = false;
    this.ring = new THREE.Mesh(sharedPlane, material()); this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.09; this.ring.scale.set(3.2, 3.2, 1); this.ring.renderOrder = 7; this.ring.visible = false;
    // 몸 주변 오라는 카메라를 향하는 세로 판. 발밑에서 허리 높이까지만 올라 플레이 시야를 가리지 않는다.
    this.aura = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.aura.position.y = 1.15; this.aura.scale.set(2.4, 2.8, 1); this.aura.renderOrder = 6; this.aura.visible = false;
    this.group.add(this.ring, this.aura); this.root.add(this.group);
  }
  /** 전투 준비 전에 재질을 FX 셰이더 준비 목록에 올려 첫 표시의 컴파일 끊김을 없앤다. SR 은 아무것도 만들지 않는다. */
  prepare(grade, fx = null) {
    if (this.disposed || (grade !== 'SSR' && grade !== 'SSSR')) return;
    this._build();
    fx?._keep?.(this.ring.material); fx?._keep?.(this.aura.material);
  }
  /** @param {'SR'|'SSR'|'SSSR'} grade */
  update(dt, grade, { alive = true, reduced = false, lite = false } = {}) {
    if (this.disposed) return;
    const show = alive && (grade === 'SSR' || grade === 'SSSR');
    if (!show) { if (this.group) this.group.visible = false; this.grade = grade; return; }
    if (!this.group) this._build();
    this.grade = grade;
    const ringTex = VFX_TEX[RING_TEX], auraTex = VFX_TEX[AURA_TEX];
    // 텍스처가 아직 없으면 링이 흰 사각형으로 보이므로 로딩 뒤에 켠다.
    const ringMat = this.ring.material;
    if (ringTex && ringMat.map !== ringTex) { ringMat.map = ringTex; ringMat.needsUpdate = true; }
    const auraMat = this.aura.material;
    if (auraTex && auraMat.map !== auraTex) { auraMat.map = auraTex; auraMat.needsUpdate = true; }
    const top = grade === 'SSSR';
    this.group.visible = !!ringTex;
    this.ring.visible = !!ringTex;
    this.aura.visible = top && !!auraTex && !lite;
    if (!reduced) { this.t += dt; this.hue = (this.hue + dt * 0.18) % 1; this.ring.rotation.z += dt * (top ? 0.5 : 0.25); }
    if (top) {
      ringMat.color.setHSL(this.hue, 0.9, 0.62); ringMat.opacity = SSSR_RING_OPACITY;
      auraMat.opacity = SSSR_AURA_OPACITY * (reduced ? 0.8 : 0.85 + 0.15 * Math.sin(this.t * 2.4));
    } else {
      ringMat.color.copy(GOLD); ringMat.opacity = SSR_OPACITY;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.group) {
      this.root.remove(this.group);
      this.ring.material.dispose(); this.aura.material.dispose();
      this.group.clear();
      if (--sharedPlaneUsers <= 0) { sharedPlane.dispose(); sharedPlane = null; sharedPlaneUsers = 0; }
    }
    this.group = this.ring = this.aura = null;
  }
}

export { resolveHeroGrade };