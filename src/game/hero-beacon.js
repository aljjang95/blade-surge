import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Static ground ring and facing chevron: three draws, no lights or animation.
export class HeroBeacon {
  constructor(root, model = null) {
    this.occluded = [];
    if (model) {
      const groups = new Map();
      model.traverse(o => {
        if (!o.isSkinnedMesh || !o.visible) return;
        let head = false;
        for (let p = o; p && p !== model; p = p.parent) if (/_Head$/.test(p.name)) head = true;
        if (!o.name.startsWith('TLL_') && !head) return;
        o.updateMatrix();
        const key = [o.skeleton.uuid, o.parent.uuid, o.bindMode, o.bindMatrix.elements.join(','), o.matrix.elements.join(','), Object.keys(o.geometry.attributes).sort().join(','), !!o.geometry.index].join('|');
        if (!groups.has(key)) groups.set(key, []); groups.get(key).push(o);
      });
      this.occlusionMaterial = new THREE.MeshBasicMaterial({ color: 0x9ee5d7, transparent: true, opacity: .48, depthFunc: THREE.GreaterDepth, depthWrite: false, toneMapped: false });
      for (const sources of groups.values()) {
        const source = sources[0], geometry = mergeGeometries(sources.map(o => o.geometry), false);
        if (!geometry) continue;
        const mesh = new THREE.SkinnedMesh(geometry, this.occlusionMaterial);
        mesh.name = 'HeroOccludedSilhouette'; mesh.bindMode = source.bindMode;
        mesh.bind(source.skeleton, source.bindMatrix); mesh.bindMatrixInverse.copy(source.bindMatrixInverse);
        mesh.position.copy(source.position); mesh.quaternion.copy(source.quaternion); mesh.scale.copy(source.scale);
        mesh.renderOrder = 980; mesh.frustumCulled = false; source.parent.add(mesh);
        this.occluded.push({ mesh, source });
      }
    }
    this.root = new THREE.Group(); this.root.name = 'HeroBeacon'; root.add(this.root);
    const add = (geometry, color, order) => {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      mesh.renderOrder = order; mesh.rotation.x = -Math.PI / 2; this.root.add(mesh); return mesh;
    };
    add(new THREE.RingGeometry(.66, .92, 32), 0x10252c, 990);
    add(new THREE.RingGeometry(.73, .84, 32), 0xb9ffee, 991);
    const shape = new THREE.Shape();
    shape.moveTo(-.28, -.91); shape.lineTo(0, -1.35); shape.lineTo(.28, -.91); shape.lineTo(0, -1.06); shape.closePath();
    this.arrow = add(new THREE.ShapeGeometry(shape), 0xffe6a0, 992);
    this.root.position.y = .08;
    // One crisp, camera-facing locator. No text, pulses or lighting cost.
    // A fixed projected size survives manual zoom and a crowded ground plane.
    const pixels = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const d = Math.abs(x - 15.5) + Math.abs(y - 15.5), i = (y * 32 + x) * 4;
      if (d > 15) continue;
      const color = d > 11 ? [8, 22, 29] : d > 7 ? [128, 242, 221] : [242, 255, 250];
      pixels.set([...color, 255], i);
    }
    this.locatorTexture = new THREE.DataTexture(pixels, 32, 32);
    this.locatorTexture.colorSpace = THREE.SRGBColorSpace; this.locatorTexture.needsUpdate = true;
    this.locator = new THREE.Sprite(new THREE.SpriteMaterial({map:this.locatorTexture, depthTest:false, depthWrite:false, toneMapped:false, sizeAttenuation:false}));
    this.locator.name = 'PlayerLocator'; this.locator.position.y = 2.72;
    this.locator.scale.set(.027,.034,1); this.locator.renderOrder = 998; this.root.add(this.locator);
  }
  update(alive, yaw) {
    this.root.visible = alive;
    // Actor already applies yaw and the rig's faceFlip to our parent.
    this.root.rotation.y = yaw - (this.root.parent?.rotation.y || 0);
    for (const { mesh, source } of this.occluded) mesh.visible = alive && source.visible;
  }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    for (const { mesh } of this.occluded) { mesh.removeFromParent(); mesh.geometry.dispose(); }
    this.occluded.length = 0; this.occlusionMaterial?.dispose();
    this.locator.material.dispose(); this.locatorTexture.dispose();
    this.root.removeFromParent(); this.root.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  }
}
