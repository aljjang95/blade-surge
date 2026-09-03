import * as THREE from 'three';
import { getPart } from '../engine/assets.js';
import { ROOM_TYPE } from './world.js';

const THEMES = {
  crypt:  { fog: 0x0b0a16, bg: 0x0b0a16, hemi: [0x5a6aa0, 0x1a1420], sun: 0xb8c4ff, sunI: 2.6, torch: 0xff8a2a, tint: 0xd8dcff },
  throne: { fog: 0x160a08, bg: 0x160a08, hemi: [0xa06040, 0x201008], sun: 0xffc090, sunI: 2.5, torch: 0xff6a20, tint: 0xffd8c0 },
  abyss:  { fog: 0x0e0716, bg: 0x0e0716, hemi: [0x7a40a0, 0x150a20], sun: 0xd0a0ff, sunI: 2.4, torch: 0xa060ff, tint: 0xe0c8ff },
  lobby:  { fog: 0x0a0812, bg: 0x0a0812, hemi: [0x6a5a90, 0x1a1420], sun: 0xffe0c0, sunI: 3.4, torch: 0xffa040, tint: 0xffffff },
};
const TILE = 4;
const rnd = (a, b) => a + Math.random() * (b - a);

export class Arena {
  constructor(scene, dungeonGltf, renderer) {
    this.scene = scene; this.gltf = dungeonGltf; this.renderer = renderer;
    this.group = new THREE.Group(); scene.add(this.group);
    this.lights = []; this.torches = []; this.torchPos = []; this.t = 0;
    this.doors = [];
  }
  clear() {
    while (this.group.children.length) { const c = this.group.children.pop(); c.traverse?.((o) => { if (o.isInstancedMesh) o.dispose(); }); }
    for (const l of this.lights) this.scene.remove(l);
    this.lights.length = 0; this.torches.length = 0; this.torchPos.length = 0; this.doors.length = 0;
  }
  _meshOf(name) { const p = this.gltf.scene.getObjectByName(name); let m = null; p?.traverse((o) => { if (!m && o.isMesh) m = o; }); return { mesh: m, part: p }; }
  /**
   * 인스턴싱. 층 전체를 하나의 InstancedMesh 로 묶으면 바운딩 스피어가 층 전체를 덮어
   * **프러스텀 컬링이 절대 안 걸린다** — 안 보이는 방까지 매 프레임 그린다.
   * 그래서 공간 청크(CHUNK 유닛 격자)로 쪼개 각 덩어리가 따로 컬링되게 한다.
   * castShadow=false 인 것(바닥 등)은 그림자 패스에서 통째로 빠져 삼각형이 절반 난다.
   */
  instanced(name, transforms, tint, opts = {}) {
    if (!transforms.length) return;
    const { mesh: src, part } = this._meshOf(name); if (!src) return;
    const { castShadow = true, chunk = 44 } = opts;
    const mat = src.material.clone(); if (tint) mat.color.multiply(new THREE.Color(tint));
    part.updateWorldMatrix(true, true);
    const local = new THREE.Matrix4().copy(part.matrixWorld).invert().multiply(src.matrixWorld);

    // 공간 버킷으로 분할
    const buckets = new Map();
    for (const t of transforms) {
      const k = `${Math.floor(t.x / chunk)},${Math.floor(t.z / chunk)}`;
      (buckets.get(k) || buckets.set(k, []).get(k)).push(t);
    }
    const o = new THREE.Object3D(); const out = [];
    for (const list of buckets.values()) {
      const im = new THREE.InstancedMesh(src.geometry, mat, list.length);
      list.forEach((t, i) => { o.position.set(t.x, t.y || 0, t.z); o.rotation.set(0, t.ry || 0, 0); o.scale.setScalar(t.s || 1); o.updateMatrix(); im.setMatrixAt(i, o.matrix.multiply(local)); });
      im.castShadow = castShadow; im.receiveShadow = true; im.frustumCulled = true;
      im.computeBoundingSphere?.();   // 청크 기준 타이트한 바운드 → 컬링이 실제로 걸린다
      this.group.add(im); out.push(im);
    }
    return out[0];
  }
  place(name, x, z, ry = 0, s = 1, tint) {
    const p = getPart(this.gltf, name); p.position.set(x, 0, z); p.rotation.y = ry; p.scale.setScalar(s);
    p.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (tint) { o.material = o.material.clone(); o.material.color.multiply(new THREE.Color(tint)); } } });
    this.group.add(p); return p;
  }

  // ================= 로비 (기존 소형 아레나) =================
  buildLobby() {
    this.clear();
    const T = THEMES.lobby;
    this.scene.background = new THREE.Color(T.bg); this.scene.fog.color.set(T.fog); this.scene.fog.density = 0.035;
    const hemi = new THREE.HemisphereLight(T.hemi[0], T.hemi[1], 1.7); this.scene.add(hemi); this.lights.push(hemi);
    const sun = new THREE.DirectionalLight(T.sun, T.sunI); sun.position.set(8, 18, 6); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = sun.shadow.camera.bottom = -18; sun.shadow.camera.right = sun.shadow.camera.top = 18;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 50; sun.shadow.bias = -0.0015; sun.shadow.normalBias = 0.02;
    this.scene.add(sun); this.lights.push(sun);
    const floors = [];
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) floors.push({ x: i * TILE, z: j * TILE, ry: Math.floor(Math.random() * 4) * Math.PI / 2 });
    this.instanced('floor_tile_large', floors, T.tint, { castShadow: false });
    const R = 10, walls = [];
    for (let i = -2; i <= 2; i++) { walls.push({ x: i * TILE, z: -R, ry: 0 }, { x: i * TILE, z: R, ry: Math.PI }, { x: -R, z: i * TILE, ry: Math.PI / 2 }, { x: R, z: i * TILE, ry: -Math.PI / 2 }); }
    this.instanced('wall', walls, T.tint);
    this.instanced('pillar_decorated', [[-R, -R], [R, -R], [-R, R], [R, R]].map(([x, z]) => ({ x, z })), T.tint);
    this.place('chest_gold', 2.6, -1.4, -0.6, 1.1); this.place('coin_stack_large', -2.4, -1.8, 0.4);
    this.place('coin_stack_medium', 3.4, 0.8, 1); this.place('sword_shield_gold', 0, -3.2, 0, 1).position.y = 0.9;
    const spot = new THREE.SpotLight(0xffe0b0, 120, 22, 0.5, 0.6, 1.5); spot.position.set(0, 9, 3); spot.target.position.set(0, 0, 0);
    this.scene.add(spot, spot.target); this.lights.push(spot, spot.target);
    this.floorData = null;
  }

  // ================= 무한의 성 — 한 층 전체 =================
  buildFloor(floorData, theme = 'crypt') {
    this.clear();
    this.floorData = floorData;
    const T = THEMES[theme] || THEMES.crypt;
    this.scene.background = new THREE.Color(T.bg); this.scene.fog.color.set(T.fog); this.scene.fog.density = 0.026;

    const hemi = new THREE.HemisphereLight(T.hemi[0], T.hemi[1], 1.5); this.scene.add(hemi); this.lights.push(hemi);
    // 넓은 맵이라 태양 그림자 카메라는 플레이어를 따라다니게 (update 에서 갱신)
    const sun = new THREE.DirectionalLight(T.sun, T.sunI); sun.position.set(10, 22, 8); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -22; sun.shadow.camera.right = sun.shadow.camera.top = 22;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 70; sun.shadow.bias = -0.0018; sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target); this.lights.push(sun, sun.target); this.sun = sun;

    // ---- 바닥 (방 + 복도) ----
    const floors = { floor_tile_large: [], floor_tile_large_rocks: [], floor_dirt_large: [] };
    const put = (rect, boss) => {
      const x0 = Math.floor((rect.x - rect.w / 2) / TILE), x1 = Math.ceil((rect.x + rect.w / 2) / TILE);
      const z0 = Math.floor((rect.z - rect.h / 2) / TILE), z1 = Math.ceil((rect.z + rect.h / 2) / TILE);
      for (let i = x0; i < x1; i++) for (let j = z0; j < z1; j++) {
        const k = Math.random();
        const key = boss ? 'floor_tile_large' : k < 0.75 ? 'floor_tile_large' : k < 0.9 ? 'floor_tile_large_rocks' : 'floor_dirt_large';
        floors[key].push({ x: i * TILE + TILE / 2, z: j * TILE + TILE / 2, ry: Math.floor(Math.random() * 4) * Math.PI / 2 });
      }
    };
    for (const r of floorData.rooms) put(r, r.type === ROOM_TYPE.BOSS);
    for (const c of floorData.corridors) put(c, false);
    for (const k in floors) this.instanced(k, floors[k], T.tint, { castShadow: false });

    // ---- 벽: 걷기 가능 셀의 경계에 세운다 ----
    const walls = { wall: [], wall_cracked: [], wall_broken: [], wall_arched: [], wall_window_open: [] };
    const variants = ['wall', 'wall', 'wall', 'wall_cracked', 'wall_arched', 'wall_window_open', 'wall_broken'];
    const W = floorData;
    const step = TILE;
    const seen = new Set();
    for (const rect of [...floorData.rooms, ...floorData.corridors]) {
      const x0 = Math.floor((rect.x - rect.w / 2) / step) * step, x1 = Math.ceil((rect.x + rect.w / 2) / step) * step;
      const z0 = Math.floor((rect.z - rect.h / 2) / step) * step, z1 = Math.ceil((rect.z + rect.h / 2) / step) * step;
      for (let x = x0; x < x1; x += step) for (let z = z0; z < z1; z += step) {
        const cx = x + step / 2, cz = z + step / 2;
        // 4방향 중 걷기 불가 쪽에 벽
        const sides = [[0, -1, 0], [0, 1, Math.PI], [-1, 0, Math.PI / 2], [1, 0, -Math.PI / 2]];
        for (const [dx, dz, ry] of sides) {
          const nx = cx + dx * step, nz = cz + dz * step;
          if (W.walkable(nx, nz)) continue;
          const kk = `${Math.round(cx)}_${Math.round(cz)}_${dx}_${dz}`;
          if (seen.has(kk)) continue; seen.add(kk);
          const v = variants[Math.floor(Math.random() * variants.length)];
          walls[v].push({ x: cx + dx * step / 2, z: cz + dz * step / 2, ry });
        }
      }
    }
    for (const k in walls) this.instanced(k, walls[k], T.tint);

    // ---- 방 장식 ----
    const pillars = [], banners = [];
    const props = ['barrel_large', 'barrel_small_stack', 'crates_stacked', 'box_stacked', 'rubble_half', 'keg', 'trunk_large_A', 'table_medium_broken', 'candle_triple', 'sword_shield_broken'];
    for (const r of floorData.rooms) {
      const hw = r.w / 2 - 1.6, hh = r.h / 2 - 1.6;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) pillars.push({ x: r.x + sx * hw, z: r.z + sz * hh, s: r.type === ROOM_TYPE.BOSS ? 1.25 : 1 });
      if (r.type === ROOM_TYPE.BOSS) {
        banners.push({ x: r.x - 5, z: r.z - r.h / 2 + 0.6, ry: 0 }, { x: r.x + 5, z: r.z - r.h / 2 + 0.6, ry: 0 });
        this.place('stairs_wide', r.x, r.z - r.h / 2 + 2.2, 0, 1, T.tint);
      }
      if (r.type === ROOM_TYPE.TREASURE) { this.place('chest_gold', r.x, r.z, rnd(0, 6.28), 1.2); this.place('coin_stack_large', r.x + 1.6, r.z + 1.2, 0, 1); this.place('coin_stack_medium', r.x - 1.7, r.z + 0.9, 0, 1); }
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const px = r.x + rnd(-1, 1) * (r.w / 2 - 2.2), pz = r.z + rnd(-1, 1) * (r.h / 2 - 2.2);
        if (Math.hypot(px - r.x, pz - r.z) < 3.5) continue;
        this.place(props[Math.floor(Math.random() * props.length)], px, pz, rnd(0, 6.28), rnd(0.9, 1.1));
      }
      // 방마다 횃불 2개
      for (const [ox, oz] of [[-hw, 0], [hw, 0]]) {
        const lx = r.x + ox, lz = r.z + oz;
        this.torchPos.push(new THREE.Vector3(lx, 2.6, lz));
        if (this.torches.length < 14) {
          const l = new THREE.PointLight(T.torch, 22, 15, 2); l.position.set(lx, 3, lz);
          this.scene.add(l); this.lights.push(l); this.torches.push({ l, i0: 22, seed: this.torches.length * 1.7, room: r });
        }
      }
      // 방 타입 표식 (바닥 링)
      if (r.type === ROOM_TYPE.ELITE || r.type === ROOM_TYPE.BOSS || r.type === ROOM_TYPE.TREASURE) {
        const col = r.type === ROOM_TYPE.BOSS ? 0xff3040 : r.type === ROOM_TYPE.ELITE ? 0xffc040 : 0x60ffc0;
        const ring = new THREE.Mesh(new THREE.RingGeometry(r.w * 0.28, r.w * 0.32, 40),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(r.x, 0.06, r.z); this.group.add(ring);
      }
    }
    this.instanced('pillar_decorated', pillars, T.tint);
    this.instanced('banner_shield_red', banners);
  }

  update(dt, fx, playerPos) {
    this.t += dt;
    for (const t of this.torches) t.l.intensity = t.i0 * (0.85 + Math.sin(this.t * 13 + t.seed) * 0.08 + Math.sin(this.t * 31 + t.seed * 3) * 0.07);
    if (this.sun && playerPos) { this.sun.position.set(playerPos.x + 10, 22, playerPos.z + 8); this.sun.target.position.copy(playerPos); this.sun.target.updateMatrixWorld(); }
    if (fx && this.torchPos.length && Math.random() < dt * 24 && playerPos) {
      const p = this.torchPos[Math.floor(Math.random() * this.torchPos.length)];
      if (Math.abs(p.x - playerPos.x) < 22 && Math.abs(p.z - playerPos.z) < 22)
        fx.embers(p, 0xff9a30, { n: 1, radius: 0.2, life: 0.9, size: 0.3, rise: 1.5 });
    }
  }
}
