import * as THREE from 'three';

// Static, opaque identity markers: no camera effects, additive FX, pulsing,
// model fetches, render targets, or simulation/settlement writes.
export class AstralConstellationView {
  constructor(scene, route) {
    this.route = route; this.disposed = false;
    this.geometries = new Set(); this.materials = new Set(); this.textures = new Set();
    this.group = new THREE.Group(); this.group.name = 'TLL_AstralConstellations'; scene.add(this.group);
    const ownGeometry = g => { this.geometries.add(g); return g; };
    const ownMaterial = m => { this.materials.add(m); return m; };
    const ring = ownGeometry(new THREE.RingGeometry(route.def.radius - .10, route.def.radius, 40));
    ring.rotateX(-Math.PI / 2);
    const frameGeometry = ownGeometry(new THREE.CylinderGeometry(.055, .055, 1.55, 8));
    const baseGeometry = ownGeometry(new THREE.CylinderGeometry(.64, .64, .12, 12));
    const glassGeometry = ownGeometry(new THREE.ConeGeometry(.42, .68, 12));
    const glassMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: 0xb5d7eb, roughness: .38, metalness: .28 }));
    const frameMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: 0x52647b, roughness: .5, metalness: .65 }));
    const sandMaterial = ownMaterial(new THREE.MeshStandardMaterial({ color: 0xffe3a4, roughness: .8 }));
    const sandGeometry = ownGeometry(new THREE.ConeGeometry(.23, .35, 10));
    const identities = [3, 40, 4].map(segments => {
      const g = ownGeometry(new THREE.CircleGeometry(route.def.radius * .42, segments));
      g.rotateX(-Math.PI / 2); return g;
    });
    const label = (parent, x, y, z, width, height, compact = false) => {
      const typography = compact
        ? { width: 256, height: 88, titleSize: 32, subtitleSize: 28, titleY: 34, subtitleY: 70, boldSubtitle: true }
        : { width: 512, height: 176, titleSize: 33, subtitleSize: 30, titleY: 66, subtitleY: 128, boldSubtitle: false };
      const canvas = document.createElement('canvas'); canvas.width = typography.width; canvas.height = typography.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('조율판 문자 표시를 준비하지 못했습니다.');
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; this.textures.add(texture);
      const material = ownMaterial(new THREE.SpriteMaterial({ map: texture, depthWrite: false, depthTest: !compact }));
      const sprite = new THREE.Sprite(material); sprite.position.set(x, y, z); sprite.scale.set(width, height, 1); parent.add(sprite);
      // Quiet-phase choice information must remain readable behind companions.
      // Raised boards stay outside the circle/hero's feet; geometry keeps depth.
      if (compact) sprite.renderOrder = 20;
      return { sprite, context, texture, typography, state: '' };
    };
    try {
    this.entries = route.gates.map((gate, index) => {
      const root = new THREE.Group(); root.position.copy(gate.pos); this.group.add(root);
      const model = new THREE.Group(); model.position.set(0, 0, -2.4); root.add(model);
      for (const y of [.18, 1.73]) { const mesh = new THREE.Mesh(baseGeometry, frameMaterial); mesh.position.y = y; model.add(mesh); }
      for (const x of [-.47, .47]) { const mesh = new THREE.Mesh(frameGeometry, frameMaterial); mesh.position.set(x, .95, 0); model.add(mesh); }
      for (const [y, inverted] of [[.60, false], [1.29, true]]) {
        const mesh = new THREE.Mesh(glassGeometry, glassMaterial); mesh.position.y = y;
        if (inverted) mesh.rotation.z = Math.PI; model.add(mesh);
      }
      const sand = new THREE.Mesh(sandGeometry, sandMaterial); sand.position.y = .41; model.add(sand);
      const title = label(root, 0, 2.75, -2.4, 5.3, 1.82);
      const pads = gate.pads.map((pad, choiceIndex) => {
        const padRoot = new THREE.Group(); padRoot.position.copy(pad.pos).sub(gate.pos); root.add(padRoot);
        const material = ownMaterial(new THREE.MeshBasicMaterial({ color: 0xffdda0, side: THREE.DoubleSide }));
        const outline = new THREE.Mesh(ring, material); outline.position.y = .12; padRoot.add(outline);
        const glyph = new THREE.Mesh(identities[choiceIndex], material); glyph.position.y = .125;
        // CircleGeometry(4, thetaStart=0) already has diamond vertices at
        // ±X/±Z. A 45-degree rotation would turn it into the wrong square.
        if (pad.id === 'triangle') glyph.rotation.y = Math.PI / 2;
        padRoot.add(glyph);
        // Keep each panel outside its circle. The near B circle's panel
        // sits to its left, clearing both the bottom potion HUD and hero feet.
        const text = pad.id === 'circle'
          ? label(padRoot, -2.8, 1.0, 0, 2.35, .80, true)
          : label(padRoot, 0, 2.25, -1.75, 2.35, .80, true);
        return { root: padRoot, outline, glyph, material, text, choiceIndex };
      });
      return { root, model, sand, title, pads, index };
    });
    this.update();
    } catch (error) { this.dispose(); throw error; }
  }
  draw(label, title, subtitle) {
    const state = `${title}\n${subtitle}`;
    if (label.state === state) return;
    label.state = state;
    const c = label.context, t = label.typography, center = t.width / 2;
    c.clearRect(0, 0, t.width, t.height);
    c.fillStyle = '#101b2b'; c.fillRect(0, 0, t.width, t.height); c.textAlign = 'center';
    c.fillStyle = '#ffe4b2'; c.font = `bold ${t.titleSize}px sans-serif`; c.fillText(title, center, t.titleY);
    c.fillStyle = '#f2f5ff'; c.font = `${t.boldSubtitle ? 'bold ' : ''}${t.subtitleSize}px sans-serif`;
    c.fillText(subtitle, center, t.subtitleY); label.texture.needsUpdate = true;
  }
  update(route = this.route) {
    if (this.disposed) return;
    this.group.visible = !route.closed;
    for (const entry of this.entries) {
      const gate = route.gates[entry.index], current = entry.index === route.progress;
      entry.root.visible = gate.room.discovered && !route.closed;
      entry.sand.position.y = gate.attuned ? 1.2 : .41;
      const shown = current && gate.available && !route.closed;
      // Hide the clue AND choice shapes during actual combat. A quiet physical
      // hourglass remains a landmark; undiscovered rooms remain fully hidden.
      entry.title.sprite.visible = gate.attuned || shown;
      const clue = gate.pads.find(p => p.id === gate.answer);
      const state = gate.attuned ? '복원 완료' : route.phase === 'retry' ? '판 밖으로 나와 재시도'
        : route.phase === 'read' ? `단서 ${clue.code} ${clue.glyph} ${clue.name} · 1초 읽기`
        : `단서 ${clue.code} ${clue.glyph} ${clue.name} · 같은 판 1초`;
      this.draw(entry.title, gate.label, state);
      for (const [i, padEntry] of entry.pads.entries()) {
        const pad = gate.pads[i];
        padEntry.root.visible = shown && route.phase !== 'read';
        const choosing = route.selected === pad.id;
        padEntry.material.color.setHex(choosing ? 0xfff0cb : 0xc6d9ec);
        this.draw(padEntry.text, `${pad.code} ${pad.glyph}`,
          choosing ? `${route.hold.toFixed(1)} / 1초` : '1초 유지');
      }
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.group.removeFromParent();
    for (const item of [...this.geometries, ...this.materials, ...this.textures]) item.dispose();
    this.geometries.clear(); this.materials.clear(); this.textures.clear();
  }
}
