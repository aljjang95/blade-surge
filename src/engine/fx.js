import * as THREE from 'three';
import { softCircleTex, sparkTex, ringTex, slashTex, smokeTex, VFX_TEX } from './assets.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();

// ============ GPU Points 파티클 풀 ============
class ParticlePool {
  constructor(scene, { max = 1500, texture, blending = THREE.AdditiveBlending, depthWrite = false } = {}) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.age = new Float32Array(max); this.life = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.size0 = new Float32Array(max); this.shrink = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const m = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: texture }, uScale: { value: 400 } },
      vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aAlpha; varying vec3 vC; varying float vA; uniform float uScale;
        void main(){ vC = aColor; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uTex; varying vec3 vC; varying float vA; void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb, t.a * vA); if (gl_FragColor.a < 0.01) discard; }`,
      transparent: true, depthWrite, blending,
    });
    this.mesh = new THREE.Points(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 10;
    scene.add(this.mesh); this.geo = g; this.mat = m;
  }
  emit(x, y, z, vx, vy, vz, color, size, life, { grav = 9, drag = 0.98, shrink = 1 } = {}) {
    let i;
    if (this.n < this.max) i = this.n++; else i = Math.floor(Math.random() * this.max);
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.size[i] = size; this.size0[i] = size; this.alpha[i] = 1; this.age[i] = 0; this.life[i] = life; this.grav[i] = grav; this.drag[i] = drag; this.shrink[i] = shrink;
  }
  update(dt) {
    let n = this.n;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { // swap-remove
        n--; if (i !== n) { this._copy(n, i); i--; } continue;
      }
      const d = Math.pow(this.drag[i], dt * 60);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02 && this.grav[i] > 0) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3 + 1] *= -0.35; this.vel[i * 3] *= 0.7; this.vel[i * 3 + 2] *= 0.7; }
      const t = this.age[i] / this.life[i];
      this.alpha[i] = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      this.size[i] = this.size0[i] * (1 + (this.shrink[i] - 1) * t);
    }
    this.n = n;
    this.geo.setDrawRange(0, n);
    const a = this.geo.attributes; a.position.needsUpdate = a.aColor.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = true;
  }
  _copy(from, to) {
    for (let k = 0; k < 3; k++) { this.pos[to * 3 + k] = this.pos[from * 3 + k]; this.vel[to * 3 + k] = this.vel[from * 3 + k]; this.col[to * 3 + k] = this.col[from * 3 + k]; }
    this.size[to] = this.size[from]; this.size0[to] = this.size0[from]; this.alpha[to] = this.alpha[from]; this.age[to] = this.age[from]; this.life[to] = this.life[from]; this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from]; this.shrink[to] = this.shrink[from];
  }
}

// ============ 일회성 메시 이펙트(스프라이트/링/참격/기둥) 관리 ============
export class FX {
  constructor(scene, camera) {
    this.scene = scene; this.camera = camera;
    this.sparks = new ParticlePool(scene, { max: 1500, texture: sparkTex() });
    this.glow = new ParticlePool(scene, { max: 1200, texture: softCircleTex() });
    this.smoke = new ParticlePool(scene, { max: 400, texture: smokeTex(), blending: THREE.NormalBlending });
    this.items = []; // {obj, t, life, update}
    this.lights = []; // 임시 포인트라이트
    this.dmgLayer = document.getElementById('dmg-layer');
    this.dmgPool = []; this.maxDmg = 40;
    this.quality = 'high';
    this._mats = {};
    this.trails = [];
  }
  setQuality(q) { this.quality = q; }
  get lite() { return this.quality === 'low'; }
  add(obj, life, update, onEnd) { this.scene.add(obj); this.items.push({ obj, t: 0, life, update, onEnd }); return obj; }
  update(dt) {
    this.sparks.update(dt); this.glow.update(dt); this.smoke.update(dt);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]; it.t += dt; const k = it.t / it.life;
      if (k >= 1) { this.scene.remove(it.obj); it.onEnd?.(); it.obj.traverse?.((o) => { if (o.geometry && o.userData.ownGeo) o.geometry.dispose(); }); this.items.splice(i, 1); continue; }
      it.update?.(k, it.t, dt);
    }
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const l = this.lights[i]; l.t += dt; const k = l.t / l.life;
      if (k >= 1) { this.scene.remove(l.light); this.lights.splice(i, 1); continue; }
      l.light.intensity = l.i0 * (1 - k) * (1 - k);
    }
    for (let i = this.trails.length - 1; i >= 0; i--) { const tr = this.trails[i]; tr.update(dt); if (tr.dead) { this.scene.remove(tr.mesh); this.trails.splice(i, 1); } }
  }
  light(pos, color, intensity = 6, dist = 9, life = 0.35) {
    if (this.lite || this.lights.length > 6) return;
    const l = new THREE.PointLight(color, intensity * 2.5, dist, 2); l.position.copy(pos); l.position.y += 1; this.scene.add(l);
    this.lights.push({ light: l, t: 0, life, i0: intensity * 2.5 });
  }
  _mat(key, make) { return this._mats[key] || (this._mats[key] = make()); }

  // ---------- 파티클 프리셋 ----------
  burst(pos, color, { n = 18, speed = 7, size = 0.35, life = 0.5, grav = 12, up = 0.5, pool = 'sparks', spread = 1, shrink = 0.2 } = {}) {
    const p = this[pool]; const c = new THREE.Color(color);
    if (this.lite) n = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.5) * Math.PI * spread, s = speed * (0.4 + Math.random() * 0.8);
      p.emit(pos.x, pos.y, pos.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + up * speed, Math.sin(a) * Math.cos(e) * s, c, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.8), { grav, shrink });
    }
  }
  directional(pos, dir, color, { n = 14, speed = 9, size = 0.3, life = 0.4, spread = 0.5 } = {}) {
    const c = new THREE.Color(color); if (this.lite) n = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const s = speed * (0.5 + Math.random());
      _v.set(dir.x + (Math.random() - 0.5) * spread, 0.25 + Math.random() * 0.5, dir.z + (Math.random() - 0.5) * spread).normalize().multiplyScalar(s);
      this.sparks.emit(pos.x, pos.y, pos.z, _v.x, _v.y, _v.z, c, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.8), { grav: 14, shrink: 0.1 });
    }
  }
  dust(pos, { n = 10, color = 0x8a7a6a, size = 1.4, life = 0.9, speed = 2.5 } = {}) {
    const c = new THREE.Color(color); if (this.lite) n = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random()); this.smoke.emit(pos.x, pos.y + 0.2, pos.z, Math.cos(a) * s, 0.6 + Math.random(), Math.sin(a) * s, c, size * (0.6 + Math.random() * 0.8), life * (0.7 + Math.random() * 0.6), { grav: -0.6, drag: 0.94, shrink: 1.8 }); }
  }
  embers(pos, color, { n = 8, radius = 1, life = 1.2, size = 0.22, rise = 2.5 } = {}) {
    const c = new THREE.Color(color); if (this.lite) n = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * radius; this.glow.emit(pos.x + Math.cos(a) * r, pos.y + Math.random() * 0.5, pos.z + Math.sin(a) * r, (Math.random() - 0.5) * 1.2, rise * (0.5 + Math.random()), (Math.random() - 0.5) * 1.2, c, size * (0.5 + Math.random()), life * (0.6 + Math.random() * 0.8), { grav: -1, drag: 0.97, shrink: 0.2 }); }
  }
  aura(pos, color, n = 3) { this.embers(pos, color, { n, radius: 0.8, life: 0.8, size: 0.3, rise: 2 }); }

  // ---------- 스프라이트 플래시 ----------
  flash(pos, color, { size = 2.2, life = 0.18, tex = 'spark' } = {}) {
    const m = new THREE.SpriteMaterial({ map: tex === 'spark' ? sparkTex() : softCircleTex(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 1 });
    const s = new THREE.Sprite(m); s.position.copy(pos); s.scale.setScalar(size * 0.3); s.material.rotation = Math.random() * Math.PI; s.renderOrder = 11;
    this.add(s, life, (k) => { s.scale.setScalar(size * (0.3 + k * 1.2)); m.opacity = 1 - k; }, () => m.dispose());
  }
  // ---------- 지면 충격파 링 ----------
  ring(pos, color, { r0 = 0.3, r1 = 4, life = 0.45, width = 0.5, y = 0.08, vertical = false, thick = 1 } = {}) {
    const m = new THREE.MeshBasicMaterial({ map: ringTex(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 1 });
    const geo = new THREE.PlaneGeometry(2, 2); const mesh = new THREE.Mesh(geo, m); mesh.position.copy(pos); mesh.position.y += y; mesh.renderOrder = 9;
    if (vertical) mesh.lookAt(this.camera.position); else mesh.rotation.x = -Math.PI / 2;
    mesh.userData.ownGeo = true;
    this.add(mesh, life, (k) => { const e = 1 - Math.pow(1 - k, 3); const r = r0 + (r1 - r0) * e; mesh.scale.set(r, r, r * thick); m.opacity = (1 - k) * 1.2; }, () => m.dispose());
  }
  // ---------- 참격 아크 (지면 평행, 캐릭터 전방) ----------
  slashArc(pos, yaw, color, { radius = 2.4, arc = 140, life = 0.22, height = 1.1, tilt = 0, flip = false, thickness = 0.55 } = {}) {
    const a = THREE.MathUtils.degToRad(arc);
    const geo = new THREE.RingGeometry(radius * (1 - thickness), radius, 24, 1, -a / 2, a);
    // uv: u 를 각도 방향으로
    const uv = geo.attributes.uv; const p = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) { const x = p.getX(i), y = p.getY(i); const ang = Math.atan2(y, x); const rr = Math.hypot(x, y); uv.setXY(i, (ang + a / 2) / a, (rr - radius * (1 - thickness)) / (radius * thickness)); }
    const m = new THREE.MeshBasicMaterial({ map: slashTex(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 1 });
    const mesh = new THREE.Mesh(geo, m); mesh.userData.ownGeo = true; mesh.renderOrder = 12;
    mesh.position.copy(pos); mesh.position.y += height;
    mesh.rotation.order = 'YXZ'; mesh.rotation.y = yaw - Math.PI / 2 + (flip ? 0 : 0); mesh.rotation.x = -Math.PI / 2 + tilt * (flip ? -1 : 1);
    const dir = flip ? -1 : 1;
    this.add(mesh, life, (k) => { const e = 1 - Math.pow(1 - k, 2); mesh.scale.setScalar(0.7 + e * 0.6); m.opacity = 1 - e; mesh.rotation.z = dir * (e - 0.5) * 0.9; }, () => m.dispose());
  }
  // ---------- 검격 파동 (수직 초승달, 이동) ----------
  crescent(pos, dir, color, { size = 1.8, life = 0.5, speed = 0, tilt = -0.75 } = {}) {
    const geo = new THREE.RingGeometry(size * 0.55, size, 32, 1, Math.PI * 0.2, Math.PI * 0.6);
    const uv = geo.attributes.uv; const p = geo.attributes.position; const a0 = Math.PI * 0.2, a = Math.PI * 0.6;
    for (let i = 0; i < uv.count; i++) { const x = p.getX(i), y = p.getY(i); const ang = Math.atan2(y, x); uv.setXY(i, (ang - a0) / a, (Math.hypot(x, y) - size * 0.55) / (size * 0.45)); }
    const m = new THREE.MeshBasicMaterial({ map: slashTex(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, m); mesh.userData.ownGeo = true; mesh.renderOrder = 12; mesh.position.copy(pos);
    const d = dir.clone().normalize();
    // 진행 방향에 수직인 평면(로컬 +Z = 진행 방향) + 카메라 쪽으로 기울임
    mesh.lookAt(pos.clone().add(d)); mesh.rotateX(tilt);
    this.add(mesh, life, (k, t, dt) => { mesh.position.addScaledVector(d, speed * dt); m.opacity = k < 0.7 ? 1 : (1 - k) / 0.3; const sc = 1 + k * 0.5; mesh.scale.set(sc, sc, 1); }, () => m.dispose());
    return mesh;
  }
  // ---------- 빛의 기둥 ----------
  pillar(pos, color, { radius = 0.9, height = 9, life = 0.6, delay = 0 } = {}) {
    const geo = new THREE.CylinderGeometry(radius, radius * 1.15, height, 16, 1, true);
    const m = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uK: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uK; varying vec2 vUv; void main(){ float a = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.1, vUv.y); float edge = pow(abs(sin(vUv.x * 6.283 * 4.0 + uK * 6.0)), 3.0) * 0.5 + 0.5; a *= edge * (1.0 - uK) * 0.42; gl_FragColor = vec4(uColor, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, m); mesh.userData.ownGeo = true; mesh.position.copy(pos); mesh.position.y += height / 2; mesh.scale.set(0.1, 1, 0.1); mesh.renderOrder = 8;
    this.add(mesh, life + delay, (k, t) => { const kk = Math.max(0, (t - delay) / life); mesh.visible = t >= delay; const s = kk < 0.2 ? kk / 0.2 : 1 - (kk - 0.2) / 0.8 * 0.6; mesh.scale.set(s, 1, s); m.uniforms.uK.value = kk; }, () => m.dispose());
  }
  // ---------- 번개 ----------
  lightning(from, to, color = 0x9ad8ff, { life = 0.28, width = 0.16, segs = 12, jitter = 0.7, branches = 2 } = {}) {
    const group = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const build = () => {
      while (group.children.length) { const c = group.children.pop(); c.geometry.dispose(); }
      const mk = (a, b, w, n) => {
        const pts = [a.clone()]; const d = b.clone().sub(a); const len = d.length(); const perp = new THREE.Vector3(-d.z, 0, d.x).normalize();
        for (let i = 1; i < n; i++) { const t = i / n; const p = a.clone().addScaledVector(d, t); p.addScaledVector(perp, (Math.random() - 0.5) * jitter * len * 0.25); p.y += (Math.random() - 0.5) * jitter * len * 0.2; pts.push(p); }
        pts.push(b.clone());
        const pos = []; const camDir = this.camera.position.clone().sub(a).normalize();
        for (let i = 0; i < pts.length - 1; i++) {
          const p0 = pts[i], p1 = pts[i + 1]; const seg = p1.clone().sub(p0); const side = seg.clone().cross(camDir).normalize().multiplyScalar(w * (1 - i / pts.length * 0.5));
          const A = p0.clone().add(side), B = p0.clone().sub(side), C = p1.clone().add(side), D = p1.clone().sub(side);
          pos.push(A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z, B.x, B.y, B.z, D.x, D.y, D.z, C.x, C.y, C.z);
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const mesh = new THREE.Mesh(g, m); mesh.renderOrder = 13; group.add(mesh);
        return pts;
      };
      const pts = mk(from, to, width, segs);
      for (let b = 0; b < branches; b++) { const i = 1 + Math.floor(Math.random() * (pts.length - 2)); const p = pts[i]; const end = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, -1 - Math.random() * 2, (Math.random() - 0.5) * 3)); mk(p, end, width * 0.5, 5); }
    };
    build(); let acc = 0;
    this.add(group, life, (k, t, dt) => { acc += dt; if (acc > 0.05) { acc = 0; build(); } m.opacity = 1 - k * k; }, () => { m.dispose(); group.children.forEach((c) => c.geometry.dispose()); });
  }
  // ---------- 발광 구체 (투사체 본체) ----------
  orb(color, size = 0.4) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(size * 0.5, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softCircleTex(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); halo.scale.setScalar(size * 4);
    g.add(core, halo); g.userData.halo = halo; g.userData.core = core; return g;
  }
  // ---------- 그을음 데칼 ----------
  scorch(pos, { radius = 2, life = 4, color = 0x000000 } = {}) {
    if (this.lite) return;
    const m = new THREE.MeshBasicMaterial({ map: softCircleTex(), color, transparent: true, depthWrite: false, opacity: 0.7 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), m); mesh.userData.ownGeo = true; mesh.rotation.x = -Math.PI / 2; mesh.position.copy(pos); mesh.position.y = 0.04; mesh.renderOrder = 1;
    this.add(mesh, life, (k) => { m.opacity = 0.7 * (1 - k); }, () => m.dispose());
  }
  // ---------- 무기 트레일 (리본) ----------
  trail(getPoints, color, { segs = 16, life = 0.35 } = {}) {
    const tr = new WeaponTrail(getPoints, color, segs, life); this.scene.add(tr.mesh); this.trails.push(tr); return tr;
  }
  // ---------- 잔상 (스킨드 메시 스냅샷) ----------
  ghost(root, color, { life = 0.45, opacity = 0.7 } = {}) {
    if (this.lite) return;
    const parts = [];
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const src = o.geometry; const cnt = src.attributes.position.count; const arr = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) { o.getVertexPosition(i, _v); _v.applyMatrix4(o.matrixWorld); arr[i * 3] = _v.x; arr[i * 3 + 1] = _v.y; arr[i * 3 + 2] = _v.z; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3)); if (src.index) g.setIndex(src.index);
      parts.push(g);
    });
    if (!parts.length) return;
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    const grp = new THREE.Group(); for (const g of parts) { const mm = new THREE.Mesh(g, m); mm.userData.ownGeo = true; grp.add(mm); }
    this.add(grp, life, (k) => { m.opacity = opacity * (1 - k); }, () => m.dispose());
  }
  // ========== GPT 생성 VFX 텍스처 기반 이펙트 ==========
  _addMat(tex, color, { blending = THREE.AdditiveBlending } = {}) { return new THREE.MeshBasicMaterial({ map: tex, color, blending, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 1 }); }
  /** 카메라를 향하는 텍스처 플래시 (holy_burst, ice, shockwave 등) */
  texFlash(pos, name, color = 0xffffff, { size = 3, life = 0.35, spin = 0, grow = 1.3, y = 1 } = {}) {
    const tex = VFX_TEX[name]; if (!tex) return this.flash(pos, color, { size, life });
    const m = new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, rotation: Math.random() * Math.PI * 2 });
    const sp = new THREE.Sprite(m); sp.position.copy(pos); sp.position.y += y; sp.scale.setScalar(size * 0.4); sp.renderOrder = 11;
    this.add(sp, life, (k) => { const e = 1 - Math.pow(1 - k, 2); sp.scale.setScalar(size * (0.4 + e * grow)); m.opacity = k < 0.25 ? k / 0.25 : 1 - (k - 0.25) / 0.75; m.rotation += spin * 0.016; }, () => m.dispose());
    return sp;
  }
  /** 지면 텍스처 (마법진 / 충격파 링). 회전·확대·페이드 */
  groundTex(pos, name, color = 0xffffff, { r0 = 0.2, r1 = 4, life = 0.5, spin = 1, y = 0.06, fadeIn = 0.15, hold = 0 } = {}) {
    const tex = VFX_TEX[name]; if (!tex) return this.ring(pos, color, { r0, r1, life, y });
    const m = this._addMat(tex, color);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m); mesh.userData.ownGeo = true; mesh.rotation.x = -Math.PI / 2; mesh.position.copy(pos); mesh.position.y = y; mesh.renderOrder = 8;
    this.add(mesh, life, (k, t, dt) => { const e = 1 - Math.pow(1 - k, 3); const r = r0 + (r1 - r0) * e; mesh.scale.set(r, r, 1); mesh.rotation.z += spin * dt; m.opacity = k < fadeIn ? k / fadeIn : (hold > 0 ? (k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35) : 1 - (k - fadeIn) / (1 - fadeIn)); }, () => m.dispose());
    return mesh;
  }
  /** 시전 마법진: 캐스터 아래에서 회전, 커졌다가 사라짐 */
  castCircle(pos, color = 0xffd060, { radius = 2.4, life = 0.9, demon = false } = {}) {
    return this.groundTex(pos, demon ? 'circle_demon' : 'circle_gold', color, { r0: radius * 0.4, r1: radius, life, spin: 1.6, y: 0.07, fadeIn: 0.2, hold: 0.35 });
  }
  /** 플립북 (explosion / dust 4x4 아틀라스) — 빌보드 셰이더 */
  flipbook(pos, name, { size = 3, life = 0.6, color = 0xffffff, cols = 4, rows = 4, y = 1, blending = THREE.AdditiveBlending, opacity = 1 } = {}) {
    const tex = VFX_TEX[name]; if (!tex) return this.burst(pos, color, { n: 20 });
    const m = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uFrame: { value: 0 }, uGrid: { value: new THREE.Vector2(cols, rows) }, uColor: { value: new THREE.Color(color) }, uScale: { value: size }, uAlpha: { value: opacity } },
      vertexShader: `uniform float uScale; varying vec2 vUv; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(0.0,0.0,0.0,1.0); mv.xy += position.xy * uScale; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uTex; uniform float uFrame, uAlpha; uniform vec2 uGrid; uniform vec3 uColor; varying vec2 vUv;
        void main(){ float f = floor(uFrame); float cx = mod(f, uGrid.x); float cy = floor(f / uGrid.x); vec2 uv = (vUv + vec2(cx, uGrid.y - 1.0 - cy)) / uGrid; vec4 t = texture2D(uTex, uv); float lum = max(t.r, max(t.g, t.b)); gl_FragColor = vec4(t.rgb * uColor, lum * uAlpha); }`,
      transparent: true, depthWrite: false, blending, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m); mesh.userData.ownGeo = true; mesh.position.copy(pos); mesh.position.y += y; mesh.renderOrder = 12; mesh.frustumCulled = false;
    const frames = cols * rows;
    this.add(mesh, life, (k) => { m.uniforms.uFrame.value = Math.min(frames - 1, k * frames); m.uniforms.uAlpha.value = opacity * (k > 0.85 ? (1 - k) / 0.15 : 1); }, () => m.dispose());
    return mesh;
  }
  explosion(pos, { size = 4, color = 0xffffff, life = 0.55 } = {}) { this.flipbook(pos, 'explosion', { size, life, color, y: size * 0.35 }); }
  dustPuff(pos, { size = 3, life = 0.9, color = 0xa89880 } = {}) { this.flipbook(pos, 'dust', { size, life, color, y: size * 0.3, blending: THREE.NormalBlending, opacity: 0.75 }); }
  /** 화염 기둥: 교차 2장 + UV 스크롤 */
  firePillar(pos, { height = 6, width = 2.2, life = 0.8, color = 0xffb060 } = {}) {
    const tex = VFX_TEX.fire_pillar; if (!tex) return this.pillar(pos, color, { radius: width / 2, height, life });
    const g = new THREE.Group(); g.position.copy(pos); g.renderOrder = 12;
    const mats = [];
    for (let i = 0; i < 2; i++) { const t = tex.clone(); t.needsUpdate = true; t.wrapT = THREE.RepeatWrapping; const m = this._addMat(t, color); const p = new THREE.Mesh(new THREE.PlaneGeometry(width, height), m); p.userData.ownGeo = true; p.position.y = height / 2; p.rotation.y = i * Math.PI / 2; g.add(p); mats.push(m); }
    this.add(g, life, (k, t, dt) => { const s = k < 0.15 ? k / 0.15 : 1; g.scale.set(s, k < 0.15 ? k / 0.15 : 1 + k * 0.1, s); for (const m of mats) { m.map.offset.y -= dt * 1.6; m.opacity = k > 0.6 ? (1 - k) / 0.4 : 1; } }, () => mats.forEach((m) => { m.map.dispose(); m.dispose(); }));
  }
  /** 텍스처 번개: 두 점 사이 빌보드 스트립 */
  boltTex(from, to, color = 0x9ad8ff, { width = 1.6, life = 0.25 } = {}) {
    const tex = VFX_TEX.lightning; if (!tex) return this.lightning(from, to, color, { life });
    const d = to.clone().sub(from); const len = d.length(); const mid = from.clone().add(to).multiplyScalar(0.5);
    const m = this._addMat(tex, color);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, len), m); mesh.userData.ownGeo = true; mesh.position.copy(mid); mesh.renderOrder = 13;
    // 로컬 +Y 를 d 방향으로, 평면 법선은 카메라 쪽으로
    const up = d.clone().normalize(); const toCam = this.camera.position.clone().sub(mid).normalize(); const right = new THREE.Vector3().crossVectors(up, toCam).normalize(); const normal = new THREE.Vector3().crossVectors(right, up);
    const basis = new THREE.Matrix4().makeBasis(right, up, normal); mesh.quaternion.setFromRotationMatrix(basis);
    let acc = 0; this.add(mesh, life, (k, t, dt) => { acc += dt; if (acc > 0.05) { acc = 0; mesh.scale.x = 0.7 + Math.random() * 0.6; m.map = tex; } m.opacity = 1 - k * k; }, () => m.dispose());
  }
  /** 텍스처 참격 (slash.webp) — 진행방향에 수직, 이동 */
  slashSprite(pos, dir, color = 0xfff0a0, { size = 3, life = 0.5, speed = 0, tilt = -0.6, flip = false } = {}) {
    const tex = VFX_TEX.slash; if (!tex) return this.crescent(pos, dir, color, { size, life, speed, tilt });
    const m = this._addMat(tex, color);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m); mesh.userData.ownGeo = true; mesh.position.copy(pos); mesh.renderOrder = 12;
    const d = dir.clone().normalize(); mesh.lookAt(pos.clone().add(d)); mesh.rotateX(tilt); if (flip) mesh.rotateZ(Math.PI);
    this.add(mesh, life, (k, t, dt) => { mesh.position.addScaledVector(d, speed * dt); m.opacity = k < 0.6 ? 1 : (1 - k) / 0.4; const sc = 1 + k * 0.6; mesh.scale.set(sc, sc, 1); }, () => m.dispose());
    return mesh;
  }
  /** 얼음 결정 폭발 */
  iceBurst(pos, { size = 3, life = 0.5 } = {}) { this.texFlash(pos, 'ice', 0xc0f0ff, { size, life, spin: 0.5, grow: 1.0, y: 0.6 }); }
  holyBurst(pos, { size = 6, life = 0.4, color = 0xfff0c0 } = {}) { this.texFlash(pos, 'holy_burst', color, { size, life, spin: 1.2, grow: 1.6, y: 1.2 }); }
  shockTex(pos, color = 0xffe080, { r1 = 6, life = 0.45 } = {}) { this.groundTex(pos, 'shockwave', color, { r0: 0.5, r1, life, spin: 0.4, y: 0.1, fadeIn: 0.05 }); }

  // ---------- 데미지 숫자 ----------
  damage(worldPos, value, { crit = false, kind = '', text = null } = {}) {
    const el = this.dmgPool.length ? this.dmgPool.pop() : document.createElement('div');
    if (this.dmgLayer.children.length > this.maxDmg) { const old = this.dmgLayer.firstChild; if (old) { this.dmgLayer.removeChild(old); this.dmgPool.push(old); } }
    el.className = 'dmg' + (crit ? ' crit' : '') + (kind ? ' ' + kind : '');
    el.textContent = text ?? (crit ? `${Math.round(value)}!` : Math.round(value));
    _v.copy(worldPos); _v.y += 1.9 + Math.random() * 0.5; _v.x += (Math.random() - 0.5) * 0.8; _v.project(this.camera);
    const x = (_v.x * 0.5 + 0.5) * window.innerWidth, y = (-_v.y * 0.5 + 0.5) * window.innerHeight;
    el.style.left = x + 'px'; el.style.top = y + 'px';
    this.dmgLayer.appendChild(el);
    const done = () => { if (el.parentNode) el.parentNode.removeChild(el); this.dmgPool.push(el); el.removeEventListener('animationend', done); };
    el.addEventListener('animationend', done);
  }
  clearDamage() { while (this.dmgLayer.firstChild) this.dmgLayer.removeChild(this.dmgLayer.firstChild); }
  clearAll() { for (const it of this.items) this.scene.remove(it.obj); this.items.length = 0; for (const l of this.lights) this.scene.remove(l.light); this.lights.length = 0; for (const t of this.trails) this.scene.remove(t.mesh); this.trails.length = 0; this.sparks.n = this.glow.n = this.smoke.n = 0; this.clearDamage(); }
}

class WeaponTrail {
  constructor(getPoints, color, segs, life) {
    this.getPoints = getPoints; this.segs = segs; this.life = life; this.t = 0; this.dead = false; this.active = true;
    this.hist = []; // [{a, b, t}]
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(segs * 2 * 3); this.uv = new Float32Array(segs * 2 * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    const idx = []; for (let i = 0; i < segs - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx); g.setDrawRange(0, 0);
    const m = new THREE.MeshBasicMaterial({ map: slashTex(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 12; this.geo = g; this.mat = m;
  }
  stop() { this.active = false; }
  update(dt) {
    this.t += dt;
    if (this.active) { const p = this.getPoints(); if (p) this.hist.unshift({ a: p[0].clone(), b: p[1].clone(), t: 0 }); }
    for (const h of this.hist) h.t += dt;
    while (this.hist.length > this.segs) this.hist.pop();
    while (this.hist.length && this.hist[this.hist.length - 1].t > this.life) this.hist.pop();
    if (!this.active && !this.hist.length) { this.dead = true; this.geo.dispose(); this.mat.dispose(); return; }
    const n = this.hist.length;
    for (let i = 0; i < n; i++) { const h = this.hist[i]; this.pos.set([h.a.x, h.a.y, h.a.z, h.b.x, h.b.y, h.b.z], i * 6); const u = 1 - i / Math.max(1, n - 1); this.uv.set([u, 0, u, 1], i * 4); }
    this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.uv.needsUpdate = true;
  }
}
