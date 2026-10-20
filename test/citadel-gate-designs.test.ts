import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { CITADEL_HUB_HOTSPOTS } from '../src/data/citadel-hub.js';
import { createCitadelGateDesignLibrary, CITADEL_GATE_DESIGNS, CITADEL_GATE_PORTALS } from '../src/game/citadel-gate-designs.js';
import { buildCitadelHubScene, preloadCitadelHubAssets } from '../src/game/citadel-hub-scene.js';
import { GATE_STONE_SURFACE, setGateStoneSurface } from '../src/game/gate-stone-surface.js';

const gates = CITADEL_HUB_HOTSPOTS.filter(spot => ['dungeon', 'campaign', 'arena'].includes(spot.kind));
// 쐐기돌 아치 개편 전(bdea615) 루트별 고형 삼각형(high)과 draw call 수. 개편 후 삼각형은 2배 이하, draw call 은 그대로여야 한다.
const BASELINE: Record<string, { triangles: number; calls: number }> = {
  glass_garden: { triangles: 660, calls: 3 }, ember_vault: { triangles: 1276, calls: 3 }, star_archive: { triangles: 1132, calls: 4 },
  bellfall_crypt: { triangles: 1036, calls: 3 }, cinder_tide_lock: { triangles: 2240, calls: 3 }, nightglass_observatory: { triangles: 1568, calls: 4 },
  eclipse_hydra_vault: { triangles: 1482, calls: 5 }, ashforge_catacomb: { triangles: 948, calls: 3 }, astral_leviathan_spire: { triangles: 766, calls: 4 },
  verdigris_sanctum: { triangles: 1214, calls: 4 }, sable_mirage_basin: { triangles: 792, calls: 4 }, comet_bastion: { triangles: 794, calls: 4 },
  campaign: { triangles: 726, calls: 3 }, arena: { triangles: 784, calls: 2 },
};
const OPENING = (mesh: any) => {
  // 포털 메시의 uv.x >= 0 인 정점은 입구 면, uv.x = -1 인 정점은 돌에 새긴 룬·보석이다.
  const uv = mesh.geometry.getAttribute('uv'), position = mesh.geometry.getAttribute('position');
  const open: number[] = [];
  for (let i = 0; i < position.count; i++) if (uv.getX(i) >= 0) open.push(i);
  return open;
};

test('all fourteen canonical routes have distinct bounded geometry and preserve the open collision corridor', () => {
  const library = createCitadelGateDesignLibrary(), shapes = new Set<string>();
  try {
    expect(Object.keys(CITADEL_GATE_DESIGNS).sort()).toEqual(gates.map(spot => spot.route).sort());
    for (const spot of gates) {
      const gate = library.build(spot), bounds = new THREE.Box3().setFromObject(gate);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-.001);
      expect(bounds.min.y).toBeLessThan(.005);
      expect(bounds.max.y).toBeLessThanOrEqual(5);
      expect(bounds.max.x - bounds.min.x).toBeLessThan(4.5);
      expect(gate.children.length).toBeLessThanOrEqual(5);
      let signature = '', triangles = 0;
      gate.traverse((node: any) => {
        if (!node.isMesh) return;
        const position = node.geometry.getAttribute('position');
        expect(position.count).toBeGreaterThan(0);
        expect(node.geometry.getAttribute('color').count).toBe(position.count);
        expect(node.material.vertexColors).toBe(true);
        expect(node.material.transparent).toBe(false);
        expect(node.geometry.groups).toHaveLength(0);
        triangles += (node.geometry.index?.count ?? position.count) / 3;
        if (node.userData.portalVisual) {
          // 균열 면은 시각 효과만 차지한다. 고형 메시의 기존 기둥·통로 규칙은 아래에서 그대로 검사한다.
          expect(node.material.isShaderMaterial).toBe(true);
          expect(node.material.side).toBe(THREE.DoubleSide);
          expect(node.geometry.getAttribute('uv').count).toBe(position.count);
          // 둥근 아치 루트는 쐐기돌 아치 안쪽(반원, 높이 3.48)까지, 상인방 루트는 기존 높이 2.5 까지 채운다.
          const arched = gates.some(g => g.route === spot.route) && ['glass_garden', 'star_archive', 'bellfall_crypt', 'nightglass_observatory', 'eclipse_hydra_vault', 'astral_leviathan_spire', 'verdigris_sanctum', 'sable_mirage_basin'].includes(spot.route);
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const i of OPENING(node)) {
            minX = Math.min(minX, position.getX(i)); maxX = Math.max(maxX, position.getX(i));
            minY = Math.min(minY, position.getY(i)); maxY = Math.max(maxY, position.getY(i));
          }
          expect(minX).toBeGreaterThan(-1.151);
          expect(maxX).toBeLessThan(1.151);
          expect(minY).toBeGreaterThan(.039);
          expect(maxY).toBeLessThan(arched ? 3.501 : 2.541);
          return;
        }
        signature += Array.from(position.array).join(',');
        for (let i = 0; i < position.count; i++) {
          const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
          expect(Number.isFinite(x + y + z)).toBe(true);
          // 머리 아래의 입체는 좌우 충돌 원(중심 1.5, 반지름 .5, citadel-hub.js) 안에 두어 통로와 주변에 장애물을 늘리지 않는다.
          if (y > .08 && y < 2.35) expect(Math.hypot(Math.abs(x) - 1.5, z)).toBeLessThanOrEqual(.501);
        }
      });
      expect(triangles).toBeLessThan(3200);
      // 굵은 기둥: 맨 아래 받침 폭 .9 이상, 기둥 몸통 깊이 .5 이상(앞뒤 합), 앞쪽으로 나온 이맛돌·아치는 .45 이상.
      let baseMin = Infinity, baseMax = -Infinity, frontMax = 0;
      gate.traverse((node: any) => {
        if (!node.isMesh || node.userData.portalVisual) return;
        const p = node.geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) {
          if (p.getY(i) < .1 && p.getX(i) > 0) { baseMin = Math.min(baseMin, p.getX(i)); baseMax = Math.max(baseMax, p.getX(i)); }
          if (p.getY(i) > 2.3 && p.getY(i) < 4) frontMax = Math.max(frontMax, p.getZ(i));
        }
      });
      expect(baseMax - baseMin).toBeGreaterThanOrEqual(.9);
      expect(frontMax).toBeGreaterThanOrEqual(.4);
      // 삼각형은 개편 전 루트별 값의 2배 이하(포털 면 제외), draw call 은 같다.
      let solid = 0, calls = 0;
      gate.traverse((node: any) => { if (node.isMesh) { calls++; if (!node.userData.portalVisual) solid += (node.geometry.index?.count ?? node.geometry.getAttribute('position').count) / 3; } });
      expect(solid).toBeLessThanOrEqual(BASELINE[spot.route].triangles * 2);
      expect(calls).toBe(BASELINE[spot.route].calls);
      shapes.add(signature);
      const ray = new THREE.Raycaster(); gate.updateMatrixWorld(true);
      for (const x of [-.82, 0, .82]) for (const y of [.25, 1, 1.9, 2.32]) {
        ray.set(new THREE.Vector3(x, y, 1), new THREE.Vector3(0, 0, -1));
        expect(ray.intersectObject(gate, true)).toHaveLength(0);
      }
    }
    expect(shapes.size).toBe(14);
  } finally { library.dispose(); }
});

test('quality variants share five materials and release owned buffers once without disposing the environment', () => {
  for (const quality of ['high', 'low']) {
    const environment = new THREE.Texture(), library = createCitadelGateDesignLibrary({ quality, environmentTexture: environment });
    const geometry = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    let freedGeometry = 0, freedMaterial = 0, freedTexture = 0;
    environment.addEventListener('dispose', () => freedTexture++);
    const parent = new THREE.Group();
    for (const spot of gates) {
      const gate = library.build(spot); parent.add(gate);
      gate.traverse((node: any) => {
        if (!node.isMesh) return;
        geometry.add(node.geometry); materials.add(node.material);
      });
    }
    expect(materials.size).toBe(5);
    expect(geometry.size).toBeLessThanOrEqual(68);
    for (const buffer of geometry) buffer.addEventListener('dispose', () => freedGeometry++);
    for (const material of materials) material.addEventListener('dispose', () => freedMaterial++);
    library.dispose(); library.dispose();
    expect(parent.children).toHaveLength(0);
    expect(freedGeometry).toBe(geometry.size);
    expect(freedMaterial).toBe(materials.size);
    expect(freedTexture).toBe(0);
    expect(() => library.build(gates[0])).toThrow();
    environment.dispose();
  }
});

test('only the twelve dungeon routes own opaque energy interiors with one shared finite clock', () => {
  for (const quality of ['high', 'low']) {
    const library = createCitadelGateDesignLibrary({ quality }), portals: THREE.Mesh[] = [];
    try {
      expect(Object.keys(CITADEL_GATE_PORTALS).sort()).toEqual(gates.filter(spot => spot.kind === 'dungeon').map(spot => spot.route).sort());
      for (const spot of gates) {
        const gate = library.build(spot);
        const energy = gate.children.filter(child => child.userData.portalVisual) as THREE.Mesh[];
        expect(energy.length).toBe(spot.kind === 'dungeon' ? 1 : 0);
        expect(gate.userData.portal).toBe(spot.kind === 'dungeon');
        for (const mesh of energy) {
          expect(OPENING(mesh).length / 3).toBe(quality === 'low' ? 32 : 48);
          // 룬·보석은 같은 포털 메시에 합쳐져 있어 별도 draw call 이 없다(입구 면보다 정점이 많다).
          if (spot.route === 'star_archive') expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(OPENING(mesh).length);
          else expect(mesh.geometry.getAttribute('position').count).toBeGreaterThanOrEqual(OPENING(mesh).length);
          expect(mesh.castShadow).toBe(false);
          expect(mesh.receiveShadow).toBe(false);
          const expected = new THREE.Color(CITADEL_GATE_PORTALS[spot.route as keyof typeof CITADEL_GATE_PORTALS]);
          const tint = mesh.geometry.getAttribute('color');
          expect(tint.getX(0)).toBeCloseTo(expected.r, 6);
          expect(tint.getY(0)).toBeCloseTo(expected.g, 6);
          expect(tint.getZ(0)).toBeCloseTo(expected.b, 6);
          portals.push(mesh);
        }
      }
      expect(portals).toHaveLength(12);
      const shared = portals[0].material as THREE.ShaderMaterial;
      expect(portals.every(mesh => mesh.material === shared)).toBe(true);
      expect(shared.uniforms.fogColor.value.isColor).toBe(true);
      library.update(.02); expect(shared.uniforms.portalTime.value).toBeCloseTo(.02);
      library.update(100); expect(shared.uniforms.portalTime.value).toBeCloseTo(.07);
      library.update(Number.NaN); library.update(-1);
      expect(shared.uniforms.portalTime.value).toBeCloseTo(.07);
      library.update(.03, true); expect(shared.uniforms.portalTime.value).toBe(0);
      library.update(100, true); expect(shared.uniforms.portalTime.value).toBe(0);
      library.update(.01); expect(shared.uniforms.portalTime.value).toBeCloseTo(.08);
      library.dispose(); library.update(.01);
      expect(shared.uniforms.portalTime.value).toBeCloseTo(.08);
    } finally { library.dispose(); }
  }
});

test('the live hub places every new entrance at its unchanged canonical trigger and disposes the design library', () => {
  const scene = buildCitadelHubScene({ assets: new Map() });
  const geometry = new Set<THREE.BufferGeometry>(); let freed = 0;
  for (const spot of gates) {
    const node = scene.userData.hotspotNodes.get(spot.id);
    expect(node.position.x).toBe(spot.x); expect(node.position.z).toBe(spot.z);
    expect(node.rotation.y).toBe(spot.yaw);
    const design = node.children.find((child: THREE.Object3D) => child.userData.designId);
    expect(design?.userData.route).toBe(spot.route);
    design?.traverse((mesh: any) => { if (mesh.isMesh) geometry.add(mesh.geometry); });
  }
  for (const buffer of geometry) buffer.addEventListener('dispose', () => freed++);
  scene.userData.dispose(); scene.userData.dispose();
  expect(freed).toBe(geometry.size);
});

test('optional hub downloads retain NPC and prop assets while procedural gate designs need no old gate GLB', async () => {
  const requested: string[] = [];
  await preloadCitadelHubAssets({ fetcher: async (path: string) => { requested.push(path); return new Response('', { status: 404 }); } });
  expect(requested.some(path => path.includes('/gate-'))).toBe(false);
  expect(requested).toContain('/models/citadel-hub-v1/merchant.glb');
  expect(requested).toContain('/models/citadel-hub-v1/bench.glb');
  expect(requested).toContain('/models/citadel-hub-v1/paving.glb');
});

test('stone gate material multiplies a shared triplanar detail map only when the texture exists and quality is not low', () => {
  const fakeShader = () => ({ uniforms: {} as Record<string, any>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>' });
  const stoneOf = (library: any) => {
    let found: any = null;
    for (const spot of gates) library.build(spot).traverse((node: any) => { if (node.isMesh && node.material.name === 'Citadel_Gate_Shared_stone') found = node.material; });
    return found;
  };
  const previous = GATE_STONE_SURFACE.texture, texture = new THREE.Texture();
  try {
    // 텍스처가 없으면 기존 정점 색 재질 그대로다(로드 전·실패 시 기존 모습).
    setGateStoneSurface(null);
    const plain = createCitadelGateDesignLibrary(), plainStone = stoneOf(plain);
    expect(plainStone.userData.gateStoneSurface).toBeUndefined();
    // 늦게 도착한 텍스처는 이미 만든 돌 재질에 한 번 적용된다.
    const high = createCitadelGateDesignLibrary(), highStone = stoneOf(high);
    setGateStoneSurface(texture);
    expect(highStone.userData.gateStoneSurface).toBe('gpt-gate-stone-detail-v1');
    expect(plainStone.userData.gateStoneSurface).toBe('gpt-gate-stone-detail-v1');
    const shader = fakeShader(); highStone.onBeforeCompile(shader, null);
    expect(shader.uniforms.gateDetailMap.value).toBe(texture);
    expect(shader.vertexShader).toContain('gateObjPos = position');
    expect(shader.fragmentShader.match(/texture2D\(gateDetailMap/g)).toHaveLength(3);
    expect(shader.fragmentShader).toContain('clamp(1.0 + (gateV - 0.49) * 1.7, 0.6, 1.25)');
    // 금속·결정·발광 재질과 낮음 품질은 질감 없이 그대로다.
    const lowLibrary = createCitadelGateDesignLibrary({ quality: 'low' }), lowStone = stoneOf(lowLibrary);
    expect(lowStone.userData.gateStoneSurface).toBeUndefined();
    const other = new Set<string>();
    for (const spot of gates) high.build(spot).traverse((node: any) => { if (node.isMesh && !node.userData.portalVisual && node.material.name !== 'Citadel_Gate_Shared_stone') other.add(node.material.name + ':' + !!node.material.userData.gateStoneSurface); });
    expect(other.size).toBeGreaterThan(0);
    expect([...other].every(entry => entry.endsWith(':false'))).toBe(true);
    // 폐기한 라이브러리는 이후에 도착한 텍스처를 받지 않는다.
    setGateStoneSurface(null);
    const late = createCitadelGateDesignLibrary(), lateStone = stoneOf(late); late.dispose(); setGateStoneSurface(texture);
    expect(lateStone.userData.gateStoneSurface).toBeUndefined();
    plain.dispose(); high.dispose(); lowLibrary.dispose();
  } finally { setGateStoneSurface(previous); texture.dispose(); }
});





