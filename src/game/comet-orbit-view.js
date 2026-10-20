import * as THREE from 'three';

// 고리 4개 × 부품 몇 개라 기하를 공유하고, 실행마다 만든 재질만 dispose 한다.
export class CometOrbitView {
  constructor(scene, route) {
    const d = route.def;
    this.group = new THREE.Group(); this.group.name = 'TLL_CometOrbits'; scene.add(this.group);
    const flat = g => { g.rotateX(-Math.PI / 2); return g; };
    this.geometries = {
      safe: flat(new THREE.RingGeometry(d.safe - .14, d.safe + .14, 64)),
      track: flat(new THREE.RingGeometry(d.track - .05, d.track + .05, 64)),
      center: flat(new THREE.CircleGeometry(d.safe, 48)),
      outer: flat(new THREE.RingGeometry(d.outerMin, d.outerMax, 64)),
      stone: new THREE.OctahedronGeometry(.75, 0),
      star: new THREE.ConeGeometry(.45, 1.1, 5),
      notch: flat(new THREE.RingGeometry(.55, .8, 24)),
    };
    this.materials = [];
    const mat = (o, basic = true) => { const m = basic ? new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, ...o }) : new THREE.MeshStandardMaterial(o); this.materials.push(m); return m; };
    this.entries = route.gates.map(gate => {
      const root = new THREE.Group(); root.position.copy(gate.center); this.group.add(root);
      const safe = new THREE.Mesh(this.geometries.safe, mat({ color: 0x5fb6ff, opacity: .9 })); safe.position.y = .07;
      const track = new THREE.Mesh(this.geometries.track, mat({ color: 0xcfe6ff, opacity: .45 })); track.position.y = .06;
      const warnMat = mat({ color: 0xff4a3a, opacity: 0 });
      const center = new THREE.Mesh(this.geometries.center, warnMat); center.position.y = .05; center.visible = false;
      const outer = new THREE.Mesh(this.geometries.outer, warnMat); outer.position.y = .05; outer.visible = false;
      const starMat = mat({ color: 0xffe08a, emissive: 0xffc040, emissiveIntensity: 1.2, roughness: .3 }, false);
      const star = new THREE.Mesh(this.geometries.star, starMat);
      star.position.set(Math.sin(gate.target) * d.track, 1.4, Math.cos(gate.target) * d.track); star.rotation.x = Math.PI;
      const notch = new THREE.Mesh(this.geometries.notch, mat({ color: 0xffe08a, opacity: .9 }));
      notch.position.set(Math.sin(gate.target) * d.track, .08, Math.cos(gate.target) * d.track);
      const stoneMat = mat({ color: 0x8fd0ff, emissive: 0x3a7cff, emissiveIntensity: .9, roughness: .25, metalness: .3 }, false);
      const stone = new THREE.Mesh(this.geometries.stone, stoneMat); stone.position.y = .9;
      root.add(safe, track, center, outer, star, notch, stone);
      return { gate, root, stone, star, notch, center, outer, warnMat, stoneMat, t: 0 };
    });
  }
  update(route, dt) {
    for (const e of this.entries) {
      const g = e.gate;
      e.t += dt;
      e.stone.position.x = g.stone.x - g.center.x; e.stone.position.z = g.stone.z - g.center.z;
      e.stone.rotation.y += dt * (g.aligned ? .5 : 2);
      e.star.rotation.y += dt * 1.5;
      const near = g.ready && !g.aligned && Math.abs(Math.atan2(Math.sin(g.target - g.angle), Math.cos(g.target - g.angle))) <= route.def.tolerance;
      e.stoneMat.emissive.setHex(g.aligned ? 0xffd060 : near ? 0x7dffb0 : 0x3a7cff);
      e.notch.visible = !g.aligned;
      // 예고는 남은 시간이 줄수록 진해진다(반복 깜빡임 없이 한 방향 변화).
      e.center.visible = g.warn === 'center'; e.outer.visible = g.warn === 'outer';
      if (g.warn) e.warnMat.opacity = .2 + .5 * (1 - Math.max(0, g.warnT) / route.def.meteor.warning);
    }
  }
  dispose() {
    this.group.removeFromParent();
    for (const g of Object.values(this.geometries)) g.dispose();
    for (const m of this.materials) m.dispose();
    this.entries = [];
  }
}
