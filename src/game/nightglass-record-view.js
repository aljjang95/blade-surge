import * as THREE from 'three';

// Scattered local transforms from the authored GLB's sidecar. Each lectern owns
// one numbered leaf; hiding the other two avoids suggesting nine collectibles.
const LEAVES = ['LeafA', 'LeafB', 'LeafC'];
const OFFSETS = [[-.16, .18, .12], [.025, .26, -.07], [.16, .12, .10]];
const ROTATIONS = [[-.088494353, -.095479108, -.111791670, .985167563],
  [.118436709, .051681876, .063867703, .989556789], [-.073974259, .114000723, .119541958, .983484268]];

export class NightglassRecordView {
  constructor(scene, gltf, route) {
    this.route = route;
    this.group = new THREE.Group(); this.group.name = 'TLL_NightglassRecords'; scene.add(this.group);
    this.materials = new Set(); this.textures = new Set(); this.disposed = false;
    this.ring = new THREE.RingGeometry(route.def.radius - .16, route.def.radius, 40);
    this.ring.rotateX(-Math.PI / 2);
    this.entries = route.gates.map((gate, index) => {
      const root = new THREE.Group(); root.position.copy(gate.pos); this.group.add(root);
      const model = gltf.scene.clone(true); model.position.z = -1.8; root.add(model);
      const ownMaterials = new Map();
      model.traverse(o => {
        if (!o.isMesh) return;
        o.frustumCulled = true;
        const own = m => {
          if (!ownMaterials.has(m)) { const c = m.clone(); ownMaterials.set(m, c); this.materials.add(c); }
          return ownMaterials.get(m);
        };
        o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
      });
      const page = gate.pageId - 1;
      const leaf = model.getObjectByName(LEAVES[page]);
      if (!leaf) throw new Error(`기록 ${gate.pageId} 모델이 없습니다.`);
      for (const name of LEAVES) { const node = model.getObjectByName(name); if (node) node.visible = node === leaf; }
      const restored = leaf.position.clone(); restored.x = 0;
      const scattered = restored.clone().add(new THREE.Vector3(...OFFSETS[page]));
      const restRotation = leaf.quaternion.clone(), scatterRotation = new THREE.Quaternion(...ROTATIONS[page]).normalize();
      const lens = model.getObjectByName('StateLens');
      const lensMaterials = new Set();
      lens?.traverse(o => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) lensMaterials.add(m); });
      const padMaterial = new THREE.MeshBasicMaterial({ color: 0xffdda0, transparent: true, opacity: .8, depthWrite: false });
      this.materials.add(padMaterial);
      const pad = new THREE.Mesh(this.ring, padMaterial); pad.position.y = .12; root.add(pad);
      const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 96;
      const context = canvas.getContext('2d'), texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace; this.textures.add(texture);
      const labelMaterial = new THREE.SpriteMaterial({ map: texture, depthWrite: false }); this.materials.add(labelMaterial);
      const label = new THREE.Sprite(labelMaterial); label.position.set(0, 2.85, -1.8); label.scale.set(3.6, .9, 1); root.add(label);
      return { root, model, leaf, restored, scattered, restRotation, scatterRotation, lensMaterials, pad,
        context, texture, labelState: '', page, index };
    });
    this.update(route);
  }
  update(route = this.route) {
    if (this.disposed) return;
    for (const entry of this.entries) {
      const gate = route.gates[entry.index], current = entry.index === route.progress;
      entry.root.visible = gate.room.discovered;
      const progress = gate.attuned ? 1 : current ? THREE.MathUtils.clamp(route.hold / route.def.holdSeconds, 0, 1) : 0;
      entry.leaf.position.lerpVectors(entry.scattered, entry.restored, progress);
      entry.leaf.quaternion.slerpQuaternions(entry.scatterRotation, entry.restRotation, progress);
      const color = gate.attuned ? 0x75ebc3 : current ? 0xffdda0 : 0x8495ad;
      for (const material of entry.lensMaterials) {
        material.color.setHex(color);
        if (material.emissive) { material.emissive.setHex(color); material.emissiveIntensity = .4; }
      }
      entry.pad.visible = current && gate.ready;
      entry.pad.material.opacity = .55 + progress * .45;
      const state = gate.attuned ? '복원 완료' : !current ? '순서 대기' : gate.ready ? '빛 안에서 2초' : '적 정화';
      if (state !== entry.labelState && entry.context) {
        entry.labelState = state;
        const c = entry.context; c.clearRect(0, 0, 384, 96);
        c.fillStyle = 'rgba(9,18,32,.94)'; c.fillRect(0, 0, 384, 96);
        c.textAlign = 'center'; c.fillStyle = gate.attuned ? '#75ebc3' : '#ffe4b2';
        c.font = 'bold 30px sans-serif'; c.fillText(gate.label, 192, 37);
        c.fillStyle = '#f2f5ff'; c.font = '26px sans-serif'; c.fillText(state, 192, 77); entry.texture.needsUpdate = true;
      }
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.group.removeFromParent(); this.ring.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.materials.clear(); this.textures.clear();
  }
}
