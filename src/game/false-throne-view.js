import * as THREE from 'three';

// 왕좌 3개 × 부품 몇 개라 기하·재질을 공유한다. 실행마다 만든 것만 stop() 에서 해제한다.
export class FalseThroneView {
  constructor(scene, route) {
    this.group = new THREE.Group(); this.group.name = 'TLL_FalseThrones'; scene.add(this.group);
    const def = route.def;
    this.geometries = [
      new THREE.BoxGeometry(2.2, .7, 1.8), new THREE.BoxGeometry(2.2, 2.6, .45), new THREE.BoxGeometry(.4, .6, 1.6),
      new THREE.ConeGeometry(.42, .62, 12), new THREE.RingGeometry(def.radius + .55, def.radius + .8, 40),
    ];
    const [seat, back, arm, cone, ring] = this.geometries;
    cone.translate(0, -.31, 0); ring.rotateX(-Math.PI / 2);
    this.stone = new THREE.MeshStandardMaterial({ color: 0x3a2c48, roughness: .55, metalness: .35, emissive: 0x1a0d26 });
    this.gold = new THREE.MeshStandardMaterial({ color: 0xc9a25e, roughness: .4, metalness: .7 });
    this.materials = [this.stone, this.gold];
    this.spin = new THREE.Color(def.spinColor); this.still = new THREE.Color(def.stillColor);
    this.entries = route.gates.map(gate => {
      const root = new THREE.Group(); root.position.copy(gate.pos); root.rotation.y = Math.PI / 2; this.group.add(root);
      const body = new THREE.Group(); root.add(body);
      const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); body.add(m); return m; };
      add(seat, this.stone, 0, .35, 0); add(back, this.stone, 0, 1.6, -.7);
      add(arm, this.gold, -1.1, 1, 0); add(arm, this.gold, 1.1, 1, 0);
      // 왕좌마다 모래시계 재질을 따로 가져 위상(회전/멈춤)을 독립적으로 보여준다.
      const glass = new THREE.MeshStandardMaterial({ color: def.spinColor, emissive: def.spinColor, emissiveIntensity: .6, roughness: .2 });
      const floor = new THREE.MeshBasicMaterial({ color: def.spinColor, transparent: true, opacity: .7, depthWrite: false });
      this.materials.push(glass, floor);
      const hourglass = new THREE.Group(); hourglass.position.set(0, 3.55, -.7); body.add(hourglass);
      const top = new THREE.Mesh(cone, glass); top.rotation.x = Math.PI; hourglass.add(top);
      hourglass.add(new THREE.Mesh(cone, glass));
      const pad = new THREE.Mesh(ring, floor); pad.position.y = .08; root.add(pad);
      return { gate, root, body, hourglass, glass, floor };
    });
  }
  update(route, dt) {
    for (const e of this.entries) {
      const g = e.gate;
      if (g.broken) continue;
      const still = g.ready && g.phase === 'still';
      if (!still) e.hourglass.rotation.z += dt * (g.ready ? 5 : 1.2);
      else e.hourglass.rotation.z = 0;
      const c = still ? this.still : this.spin;
      e.glass.color.copy(c); e.glass.emissive.copy(c); e.glass.emissiveIntensity = still ? 1.6 : g.ready ? .8 : .35;
      e.floor.color.copy(c); e.floor.opacity = !g.ready ? .25 : still ? .95 : .55;
      // 균열이 쌓일수록 조금씩 기울고, 맞은 순간 흔들린다.
      const damage = g.hits / route.def.hits;
      e.body.rotation.z = damage * .08 + (g.flash > 0 ? Math.sin(g.flash * 90) * .05 : 0);
      e.body.scale.setScalar(1 - damage * .12);
    }
  }
  shatter(gate) {
    const e = this.entries.find(x => x.gate === gate);
    if (e) e.root.visible = false;
  }
  dispose() {
    this.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.entries = [];
  }
}
