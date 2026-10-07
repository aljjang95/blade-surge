import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { CITADEL_HUB_HOTSPOTS } from '../src/data/citadel-hub.js';
import { createCitadelGateDesignLibrary, CITADEL_GATE_DESIGNS, CITADEL_GATE_PORTALS } from '../src/game/citadel-gate-designs.js';
import { buildCitadelHubScene, preloadCitadelHubAssets } from '../src/game/citadel-hub-scene.js';

const gates = CITADEL_HUB_HOTSPOTS.filter(spot => ['dungeon', 'campaign', 'arena'].includes(spot.kind));

test('all fourteen canonical routes have distinct bounded geometry and preserve the open collision corridor', () => {
  const library = createCitadelGateDesignLibrary(), shapes = new Set<string>();
  try {
    expect(Object.keys(CITADEL_GATE_DESIGNS).sort()).toEqual(gates.map(spot => spot.route).sort());
    for (const spot of gates) {
      const gate = library.build(spot), bounds = new THREE.Box3().setFromObject(gate);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-.001);
      expect(bounds.min.y).toBeLessThan(.005);
      expect(bounds.max.y).toBeLessThanOrEqual(3.8);
      expect(bounds.max.x - bounds.min.x).toBeLessThan(4);
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
          const portalBounds = node.geometry.boundingBox;
          expect(portalBounds.min.x).toBeGreaterThan(-1.026);
          expect(portalBounds.max.x).toBeLessThan(1.026);
          expect(portalBounds.min.y).toBeGreaterThan(.039);
          expect(portalBounds.max.y).toBeLessThan(2.541);
          return;
        }
        signature += Array.from(position.array).join(',');
        for (let i = 0; i < position.count; i++) {
          const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
          expect(Number.isFinite(x + y + z)).toBe(true);
          // 머리 아래의 입체는 기존 좌우 충돌 원 안에 두어 통로와 주변에 장애물을 늘리지 않는다.
          if (y > .08 && y < 2.35) expect(Math.hypot(Math.abs(x) - 1.27, z)).toBeLessThanOrEqual(.291);
        }
      });
      expect(triangles).toBeLessThan(2500);
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
          expect(mesh.geometry.index!.count / 3).toBe(quality === 'low' ? 32 : 48);
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
