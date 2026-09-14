import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Static ground ring and facing chevron: three draws, no lights or animation.
export class HeroBeacon {
  constructor(root, model = null) {
    this.occluded = [];
    if (model) {
      const groups = new Map();
      model.traverse(o => {
        if (!o.isSkinnedMesh || !o.name.startsWith('TLL_') || !o.visible) return;
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
    this.root.removeFromParent(); this.root.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  }
}
