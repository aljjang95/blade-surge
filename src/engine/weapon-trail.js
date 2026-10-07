import * as THREE from 'three';

/** 준비 구간을 비우고 실제 참격 구간에만 잔광을 남긴다. 판정 시간은 바꾸지 않는다. */
export function weaponTrailGain(progress, contact, spinning = false) {
  if (!Number.isFinite(progress) || !Number.isFinite(contact)) return 0;
  const open = Math.max(0, contact - .16);
  if (progress < open || progress >= 1) return 0;
  if (spinning) return Math.min(1, (progress - open) / .08);
  const strike = Math.min(1, (progress - open) / .1);
  const recovery = Math.max(0, 1 - Math.max(0, progress - contact) / .27);
  return strike * recovery;
}

/** 색 잔광과 얇은 밝은 날을 하나의 양면 draw에 합친다. */
export function createWeaponTrailMaterial(texture, color) {
  const uniforms = THREE.UniformsUtils.clone(THREE.ShaderLib.basic.uniforms);
  uniforms.map.value = texture; uniforms.diffuse.value.set(color); uniforms.opacity.value = .88;
  return new THREE.ShaderMaterial({
    uniforms, defines: { USE_MAP: '', MAP_UV: 'uv' },
    vertexShader: 'attribute float trailAlpha; varying float vTrailAlpha;\n' + THREE.ShaderLib.basic.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTrailAlpha = trailAlpha;'),
    fragmentShader: 'varying float vTrailAlpha;\n' + THREE.ShaderLib.basic.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
        float bladeCore = 1.0 - smoothstep(.035, .105, abs(vMapUv.y - .74));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.92, .97, 1.0), bladeCore * .62);
        diffuseColor.a *= vTrailAlpha * smoothstep(.0, .12, vMapUv.y);`),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, forceSinglePass: true, fog: true,
  });
}

/** 공격 시작 시 할당한 고정 버퍼만 갱신한다. 벡터·배열·기록을 프레임마다 만들지 않는다. */
export class WeaponTrail {
  constructor(getPoints, material, { segs = 18, life = .24, width = 1, getGain = null } = {}) {
    this.getPoints = getPoints; this.getGain = getGain;
    this.segs = Math.max(3, Math.min(32, Math.round(segs))); this.life = life;
    this.width = width; this.t = 0; this.dead = false; this.active = true;
    this.head = 0; this.n = 0;
    this.points = [new THREE.Vector3(), new THREE.Vector3()];
    this.samples = new Float32Array(this.segs * 6);
    this.times = new Float64Array(this.segs); this.gains = new Float32Array(this.segs);
    this.pos = new Float32Array(this.segs * 6); this.uv = new Float32Array(this.segs * 4);
    this.alpha = new Float32Array(this.segs * 2);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('trailAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const index = new Uint16Array((this.segs - 1) * 6);
    for (let i = 0; i < this.segs - 1; i++) {
      const a = i * 2, offset = i * 6;
      index[offset] = a; index[offset + 1] = a + 1; index[offset + 2] = a + 2;
      index[offset + 3] = a + 1; index[offset + 4] = a + 3; index[offset + 5] = a + 2;
    }
    geometry.setIndex(new THREE.BufferAttribute(index, 1)); geometry.setDrawRange(0, 0);
    this.geo = geometry; this.mat = material;
    this.mesh = new THREE.Mesh(geometry, material); this.mesh.frustumCulled = false; this.mesh.renderOrder = 12;
  }
  stop() { this.active = false; }
  dispose() {
    if (this.dead) return;
    this.dead = true; this.active = false; this.n = 0; this.geo.setDrawRange(0, 0);
    this.geo.dispose(); this.mat.dispose();
  }
  update(dt) {
    if (this.dead || !Number.isFinite(dt) || dt <= 0) return;
    this.t += dt;
    while (this.n && this.t - this.times[(this.head + this.n - 1) % this.segs] >= this.life) this.n--;
    const gain = this.active ? (this.getGain ? this.getGain() : 1) : 0;
    if (gain > .01) {
      const points = this.getPoints(this.points);
      if (points) {
        const a = points[0], b = points[1];
        // 손 가까이의 넓은 면을 줄여 캐릭터를 가리지 않고 끝의 궤적을 드러낸다.
        this.head = (this.head + this.segs - 1) % this.segs;
        const offset = this.head * 6, inner = Math.max(0, 1 - this.width);
        this.samples[offset] = a.x + (b.x - a.x) * inner;
        this.samples[offset + 1] = a.y + (b.y - a.y) * inner;
        this.samples[offset + 2] = a.z + (b.z - a.z) * inner;
        this.samples[offset + 3] = b.x; this.samples[offset + 4] = b.y; this.samples[offset + 5] = b.z;
        this.times[this.head] = this.t; this.gains[this.head] = Math.min(1, gain);
        this.n = Math.min(this.segs, this.n + 1);
      }
    }
    if (!this.active && !this.n) { this.dispose(); return; }
    for (let i = 0; i < this.n; i++) {
      const slot = (this.head + i) % this.segs, source = slot * 6, target = i * 6;
      for (let component = 0; component < 6; component++) this.pos[target + component] = this.samples[source + component];
      const u = 1 - i / Math.max(1, this.n - 1), uv = i * 4;
      this.uv[uv] = u; this.uv[uv + 1] = 0; this.uv[uv + 2] = u; this.uv[uv + 3] = 1;
      const fade = Math.max(0, 1 - (this.t - this.times[slot]) / this.life);
      this.alpha[i * 2] = this.alpha[i * 2 + 1] = this.gains[slot] * fade * fade;
    }
    this.geo.setDrawRange(0, Math.max(0, (this.n - 1) * 6));
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.uv.needsUpdate = true;
    this.geo.attributes.trailAlpha.needsUpdate = true;
  }
}
