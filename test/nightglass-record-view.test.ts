import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { NightglassRecordView } from '../src/game/nightglass-record-view.js';
import metadata from '../public/models/tll/props/nightglass-record-v1.json';

test('real record GLB renders one distinct leaf per identity, interpolates and releases owned resources only', async () => {
  const bytes = await readFile(new URL('../public/models/tll/props/nightglass-record-v1.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const before = gltf.scene.toJSON();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const labels: string[] = [];
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({
    width: 0, height: 0, getContext: () => ({ clearRect() {}, fillRect() {}, fillText: (text: string) => labels.push(text) }),
  }) } });
  const scene = new THREE.Scene();
  const route: any = { progress: 0, hold: 0, def: { radius: 2, holdSeconds: 2 },
    gates: [3, 2, 1].map((pageId, i) => ({ room: { discovered: true }, pageId, label: `record${pageId}`,
      pos: new THREE.Vector3(i * 20, 0, 0), ready: true, attuned: false })) };
  let view: any;
  try {
    view = new NightglassRecordView(scene, gltf, route);
    expect(scene.children).toHaveLength(1);
    expect(labels).toContain('record3');
    for (const [i, entry] of view.entries.entries()) {
      const leafNames = ['LeafA', 'LeafB', 'LeafC'];
      expect(leafNames.filter(name => entry.model.getObjectByName(name).visible)).toEqual([leafNames[2 - i]]);
      expect(entry.pad.visible).toBe(i === 0);
      const node = (metadata.interface.nodes as any)[leafNames[2 - i]];
      expect(entry.scatterRotation.toArray()).toEqual(expect.arrayContaining([expect.any(Number)]));
      node.scattered.quaternionXYZW.forEach((n: number, j: number) => expect(entry.scatterRotation.toArray()[j]).toBeCloseTo(n, 6));
    }
    const first = view.entries[0], source = gltf.scene.getObjectByName('LeafC') as THREE.Mesh;
    expect(first.leaf.geometry).toBe(source.geometry);
    expect(first.leaf.material).not.toBe(source.material);
    expect(first.leaf.position.distanceTo(first.scattered)).toBeLessThan(1e-8);
    route.hold = 1; view.update();
    expect(first.leaf.position.distanceTo(first.restored)).toBeCloseTo(first.scattered.distanceTo(first.restored) / 2, 6);
    route.hold = 0; view.update();
    expect(first.leaf.position.distanceTo(first.scattered)).toBeLessThan(1e-8);
    route.gates[0].attuned = true; route.progress = 1; view.update();
    expect(first.leaf.position.distanceTo(first.restored)).toBeLessThan(1e-8);
    expect(first.pad.visible).toBe(false); expect(view.entries[1].pad.visible).toBe(true);
    expect(labels).toContain('복원 완료');
    route.gates[1].room.discovered = false; view.update(); expect(view.entries[1].root.visible).toBe(false);
    let ownedDisposals = 0, sourceDisposals = 0;
    const ownedCount = view.materials.size + view.textures.size + 1;
    for (const item of [...view.materials, ...view.textures, view.ring]) item.addEventListener('dispose', () => ownedDisposals++);
    source.geometry.addEventListener('dispose', () => sourceDisposals++);
    (source.material as THREE.Material).addEventListener('dispose', () => sourceDisposals++);
    view.dispose(); view.dispose(); view.update();
    expect(scene.children).toHaveLength(0); expect(ownedDisposals).toBe(ownedCount); expect(sourceDisposals).toBe(0);
    expect(gltf.scene.toJSON()).toEqual(before);
  } finally {
    view?.dispose();
    if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
  }
});
