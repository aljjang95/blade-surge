import * as THREE from 'three';

// Readability marker: opaque authored hero, strong ground rings and locator; no body duplicate or occluder bypass.
export class HeroBeacon {
  constructor(root, model = null) {
    // Keep the authored hero fully opaque. Readability is carried by the locator/rings,
    // never by a translucent duplicate drawn through occluders.
    this.occluded = [];
    this.root = new THREE.Group(); this.root.name = 'HeroBeacon'; root.add(this.root);
    const add = (geometry, color, order) => {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      mesh.renderOrder = order; mesh.rotation.x = -Math.PI / 2; this.root.add(mesh); return mesh;
    };
    this.shadowRing = add(new THREE.RingGeometry(.66, .92, 32), 0x10252c, 990);
    this.primaryRing = add(new THREE.RingGeometry(.73, .84, 32), 0xb9ffee, 991);
    this.focusRing = add(new THREE.RingGeometry(.9, 1.06, 32), 0xffe6a0, 992);
    this.focusRing.visible = false; this.focused = false; this.focusColor = new THREE.Color(0xffe6a0);
    const shape = new THREE.Shape();
    shape.moveTo(-.28, -.91); shape.lineTo(0, -1.35); shape.lineTo(.28, -.91); shape.lineTo(0, -1.06); shape.closePath();
    this.arrow = add(new THREE.ShapeGeometry(shape), 0xffe6a0, 993);
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
    this.locator = new THREE.Sprite(new THREE.SpriteMaterial({map:this.locatorTexture, depthTest:false, depthWrite:false, toneMapped:false, sizeAttenuation:false, transparent:true, opacity:.92}));
    this.locator.name = 'PlayerLocator'; this.locator.position.y = 2.72;
    this.locator.scale.set(.044,.054,1); this.locator.renderOrder = 998; this.root.add(this.locator);
  }
  setFocus(active, color = 0xffe6a0) {
    this.focused = !!active; this.focusColor.set(color);
  }
  update(alive, yaw, { state = 'idle', color = 0xb9ffee, reduced = false } = {}) {
    this.root.visible = alive;
    // Actor already applies yaw and the rig's faceFlip to our parent.
    this.root.rotation.y = yaw - (this.root.parent?.rotation.y || 0);
    const action = state === 'attack' || state === 'skill' || state === 'ult' || state === 'dodge';
    const emphasized = alive && (this.focused || action);
    this.focusRing.visible = emphasized;
    this.primaryRing.scale.setScalar(action ? 1.08 : 1);
    this.primaryRing.material.color.set(emphasized ? 0xffffff : 0xb9ffee);
    this.primaryRing.material.opacity = action ? 0.96 : 0.82;
    this.arrow.material.color.set(emphasized ? 0xffffff : 0xffe6a0);
    this.locator.material.opacity = action ? 1 : 0.9;
    this.locator.scale.set(action ? .052 : .044, action ? .064 : .054, 1);
    if (emphasized) {
      this.focusRing.material.color.set(this.focused ? this.focusColor : color);
      this.focusRing.scale.setScalar(reduced ? 1 : (this.focused || state === 'ult' ? 1.12 : 1.06));
      this.focusRing.material.opacity = state === 'ult' ? 0.98 : 0.86;
    }
  }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.occluded.length = 0;
    this.locator.material.dispose(); this.locatorTexture.dispose();
    this.root.removeFromParent(); this.root.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  }
}

