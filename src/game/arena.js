import * as THREE from 'three';
import { getPart } from '../engine/assets.js';

const THEMES = {
  crypt:  { fog: 0x0b0a16, bg: 0x0b0a16, hemi: [0x5a6aa0, 0x1a1420], sun: 0xb8c4ff, sunI: 3.2, torch: 0xff8a2a, tint: 0xd8dcff },
  throne: { fog: 0x160a08, bg: 0x160a08, hemi: [0xa06040, 0x201008], sun: 0xffc090, sunI: 3.0, torch: 0xff6a20, tint: 0xffd8c0 },
  abyss:  { fog: 0x0e0716, bg: 0x0e0716, hemi: [0x7a40a0, 0x150a20], sun: 0xd0a0ff, sunI: 2.8, torch: 0xa060ff, tint: 0xe0c8ff },
  lobby:  { fog: 0x0a0812, bg: 0x0a0812, hemi: [0x6a5a90, 0x1a1420], sun: 0xffe0c0, sunI: 3.4, torch: 0xffa040, tint: 0xffffff },
};

const rnd = (a, b) => a + Math.random() * (b - a);

export class Arena {
  constructor(scene, dungeonGltf, renderer) {
    this.scene = scene; this.gltf = dungeonGltf; this.renderer = renderer;
    this.group = new THREE.Group(); scene.add(this.group);
    this.lights = []; this.torches = []; this.t = 0;
  }
  clear() {
    while (this.group.children.length) { const c = this.group.children.pop(); c.traverse?.((o) => { if (o.isInstancedMesh) o.dispose(); }); }
    for (const l of this.lights) this.scene.remove(l); this.lights.length = 0; this.torches.length = 0;
  }
  _meshOf(name) { const p = this.gltf.scene.getObjectByName(name); let m = null; p?.traverse((o) => { if (!m && o.isMesh) m = o; }); return { mesh: m, part: p }; }
  instanced(name, transforms, tint) {
    const { mesh: src, part } = this._meshOf(name); if (!src) return;
    const mat = src.material.clone(); if (tint) mat.color.multiply(new THREE.Color(tint));
    const im = new THREE.InstancedMesh(src.geometry, mat, transforms.length);
    // gltfpack 양자화: 메시 노드에 dequantize 변환이 있으므로 파트 기준 로컬 행렬을 곱해준다
    part.updateWorldMatrix(true, true);
    const local = new THREE.Matrix4().copy(part.matrixWorld).invert().multiply(src.matrixWorld);
    const o = new THREE.Object3D();
    transforms.forEach((t, i) => { o.position.set(t.x, t.y || 0, t.z); o.rotation.set(0, t.ry || 0, 0); o.scale.setScalar(t.s || 1); o.updateMatrix(); im.setMatrixAt(i, o.matrix.multiply(local)); });
    im.castShadow = true; im.receiveShadow = true; this.group.add(im); return im;
  }
  place(name, x, z, ry = 0, s = 1, tint) { const p = getPart(this.gltf, name); p.position.set(x, 0, z); p.rotation.y = ry; p.scale.setScalar(s); p.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (tint) { o.material = o.material.clone(); o.material.color.multiply(new THREE.Color(tint)); } } }); this.group.add(p); return p; }

  build(theme = 'crypt', { lobby = false } = {}) {
    this.clear();
    const T = THEMES[theme] || THEMES.crypt;
    this.scene.background = new THREE.Color(T.bg); this.scene.fog.color.set(T.fog); this.scene.fog.density = lobby ? 0.035 : 0.022;
    // 조명
    const hemi = new THREE.HemisphereLight(T.hemi[0], T.hemi[1], 1.7); this.scene.add(hemi); this.lights.push(hemi);
    const sun = new THREE.DirectionalLight(T.sun, T.sunI); sun.position.set(8, 18, 6); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = sun.shadow.camera.bottom = -20; sun.shadow.camera.right = sun.shadow.camera.top = 20; sun.shadow.camera.near = 1; sun.shadow.camera.far = 50; sun.shadow.bias = -0.0015; sun.shadow.normalBias = 0.02;
    this.scene.add(sun); this.lights.push(sun);
    // 바닥 9x9 (4유닛 타일)
    const floors = { floor_tile_large: [], floor_tile_large_rocks: [], floor_dirt_large: [], floor_tile_big_grate: [] };
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
      const r = Math.random(); const k = r < 0.72 ? 'floor_tile_large' : r < 0.82 ? 'floor_tile_large_rocks' : r < 0.95 ? 'floor_dirt_large' : 'floor_tile_big_grate';
      const inner = Math.abs(i) < 3 && Math.abs(j) < 3;
      floors[(inner && k === 'floor_tile_large_rocks') ? 'floor_tile_large' : k].push({ x: i * 4, z: j * 4, ry: Math.floor(Math.random() * 4) * Math.PI / 2 });
    }
    for (const k in floors) if (floors[k].length) this.instanced(k, floors[k], T.tint);
    // 벽 (외곽 반경 18)
    const walls = { wall: [], wall_cracked: [], wall_broken: [], wall_arched: [], wall_window_open: [], wall_shelves: [] };
    const wallVariants = ['wall', 'wall', 'wall', 'wall_cracked', 'wall_arched', 'wall_window_open', 'wall_broken', 'wall_shelves'];
    const R = 18;
    for (let i = -4; i <= 4; i++) {
      const v = () => wallVariants[Math.floor(Math.random() * wallVariants.length)];
      walls[v()].push({ x: i * 4, z: -R, ry: 0 });
      walls[v()].push({ x: i * 4, z: R, ry: Math.PI });
      walls[v()].push({ x: -R, z: i * 4, ry: Math.PI / 2 });
      walls[v()].push({ x: R, z: i * 4, ry: -Math.PI / 2 });
    }
    for (const k in walls) if (walls[k].length) this.instanced(k, walls[k], T.tint);
    // 기둥
    const pil = []; for (const [x, z] of [[-R, -R], [R, -R], [-R, R], [R, R]]) pil.push({ x, z, s: 1.15 });
    for (const [x, z] of [[-R, 0], [R, 0], [0, -R], [0, R], [-R, -9], [-R, 9], [R, -9], [R, 9], [-9, -R], [9, -R], [-9, R], [9, R]]) pil.push({ x, z });
    this.instanced('pillar_decorated', pil, T.tint);
    // 배너
    const ban = []; for (const [x, z, ry] of [[-6, -R + 0.4, 0], [6, -R + 0.4, 0], [-R + 0.4, -6, Math.PI / 2], [-R + 0.4, 6, Math.PI / 2], [R - 0.4, -6, -Math.PI / 2], [R - 0.4, 6, -Math.PI / 2], [-6, R - 0.4, Math.PI], [6, R - 0.4, Math.PI]]) ban.push({ x, z, ry });
    this.instanced('banner_shield_red', ban);
    // 소품 (플레이 반경 밖 링)
    const props = ['barrel_large', 'barrel_small_stack', 'crates_stacked', 'box_stacked', 'rubble_half', 'keg', 'trunk_large_A', 'table_medium_broken', 'coin_stack_medium', 'candle_triple', 'sword_shield_broken', 'chest'];
    for (let i = 0; i < 22; i++) { const a = i / 22 * Math.PI * 2 + rnd(-0.1, 0.1); const r = rnd(15.8, 17); const n = props[Math.floor(Math.random() * props.length)]; this.place(n, Math.cos(a) * r, Math.sin(a) * r, rnd(0, Math.PI * 2), rnd(0.9, 1.1)); }
    // 횃불 + 포인트라이트 (4개)
    const tp = [[-R + 0.5, -8, Math.PI / 2], [R - 0.5, 8, -Math.PI / 2], [8, -R + 0.5, 0], [-8, R - 0.5, Math.PI]];
    tp.forEach(([x, z, ry], i) => {
      const t = this.place('torch_mounted', x, z, ry); t.position.y = 2.2;
      const l = new THREE.PointLight(T.torch, 28, 18, 2); l.position.set(x - Math.sin(ry) * 0.8 * 0 + (x > 0 ? -1 : x < 0 ? 1 : 0), 3, z + (z > 0 ? -1 : z < 0 ? 1 : 0)); this.scene.add(l); this.lights.push(l); this.torches.push({ l, i0: 28, seed: i * 1.7 });
      // 횃불 파티클은 fx에서
      this.torchPos = this.torchPos || []; this.torchPos.push(l.position.clone());
    });
    if (lobby) {
      this.place('chest_gold', 2.6, -1.4, -0.6, 1.1); this.place('coin_stack_large', -2.4, -1.8, 0.4); this.place('coin_stack_medium', 3.4, 0.8, 1); this.place('sword_shield_gold', 0, -3.2, 0, 1).position.y = 0.9;
      this.place('candle_triple', -1.8, 1.8, 0, 1.2);
      const spot = new THREE.SpotLight(0xffe0b0, 120, 22, 0.5, 0.6, 1.5); spot.position.set(0, 9, 3); spot.target.position.set(0, 0, 0); spot.castShadow = false; this.scene.add(spot, spot.target); this.lights.push(spot, spot.target);
    }
    // 중앙 마법진 (전투 시)
    if (!lobby) { const ring = new THREE.Mesh(new THREE.RingGeometry(13.5, 14.2, 64), new THREE.MeshBasicMaterial({ color: T.torch, transparent: true, opacity: 0.18, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; this.group.add(ring); }
  }
  update(dt, fx) {
    this.t += dt;
    for (const t of this.torches) { t.l.intensity = t.i0 * (0.85 + Math.sin(this.t * 13 + t.seed) * 0.08 + Math.sin(this.t * 31 + t.seed * 3) * 0.07); }
    if (fx && this.torchPos && Math.random() < dt * 30) { const p = this.torchPos[Math.floor(Math.random() * this.torchPos.length)]; fx.embers(p.clone().setY(2.6), 0xff9a30, { n: 1, radius: 0.2, life: 0.9, size: 0.3, rise: 1.5 }); }
  }
}
