import * as THREE from 'three';
import { coolingVent } from './cooling-valves.js';
import { hazardVertexShader } from './region-hazards.js';

// A dark outline and white hatching remain distinct on the orange forge floor.
// Geometry still covers exactly the same rectangle as coolingVentContains.
const ventFragmentShader = `varying vec2 vUv; uniform float fired, opacity;
void main(){vec2 q=abs(vUv-.5)*2.;float edge=max(q.x,q.y);
float hatch=step(.74,fract((vUv.x*4.+vUv.y*12.)*.65));
vec3 c=mix(vec3(.85,.025,.08),vec3(1.,.91,.77),hatch*.65);
if(edge>.88)c=vec3(.035,.055,.065);if(edge>.96)c=vec3(1.,.9,.72);
gl_FragColor=vec4(c,opacity*(edge>.88?.95:.66+fired*.17));}`;

// Shared GLB geometry/textures remain cached. Each run owns its status materials,
// floor indicators and label textures; stop() disposes only those owned objects.
export class CoolingValveView {
  constructor(scene, gltf, route) {
    this.group = new THREE.Group(); this.group.name = 'TLL_CoolingValves'; scene.add(this.group);
    this.materials = new Set(); this.textures = new Set();
    this.plane = new THREE.PlaneGeometry(1, 1); this.plane.rotateX(-Math.PI / 2);
    this.ring = new THREE.RingGeometry(route.def.radius - .18, route.def.radius, 32); this.ring.rotateX(-Math.PI / 2);
    this.entries = route.gates.map((gate, i) => {
      const root = new THREE.Group(); root.position.copy(gate.pos); this.group.add(root);
      const model = gltf.scene.clone(true); root.add(model);
      const cloned = new Map();
      model.traverse(o => {
        if (!o.isMesh) return;
        o.frustumCulled = true;
        const own = m => { if (!cloned.has(m)) { const c = m.clone(); cloned.set(m, c); this.materials.add(c); } return cloned.get(m); };
        o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
      });
      const wheel = model.getObjectByName('Wheel');
      const status = model.getObjectByName('StatusLens');
      const statusMaterials = new Set(); status?.traverse(o => {
        if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) statusMaterials.add(m);
      });
      const padMaterial = new THREE.MeshBasicMaterial({ color: 0x56e6d5, transparent: true, opacity: .85, depthWrite: false });
      this.materials.add(padMaterial);
      const pad = new THREE.Mesh(this.ring, padMaterial); pad.position.y = .10; root.add(pad);
      const ventMaterial = new THREE.ShaderMaterial({ vertexShader: hazardVertexShader, fragmentShader: ventFragmentShader,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { color: { value: new THREE.Color(0xff863e) }, size: { value: new THREE.Vector2(4, 12) },
          shape: { value: 2 }, safeRadius: { value: 0 }, opacity: { value: .7 }, fired: { value: 0 } } });
      this.materials.add(ventMaterial);
      const vent = new THREE.Mesh(this.plane, ventMaterial); vent.position.y = .12; vent.renderOrder = 2; root.add(vent);
      const pipeMaterial = new THREE.MeshBasicMaterial({ color: 0x35444d }); this.materials.add(pipeMaterial);
      const pipe = new THREE.Mesh(this.plane, pipeMaterial); pipe.position.set(0, .08, -2.2); pipe.scale.set(.24, 1, 3.8); root.add(pipe);
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
      const context = canvas.getContext('2d');
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; this.textures.add(texture);
      const labelMaterial = new THREE.SpriteMaterial({ map: texture, depthWrite: false }); this.materials.add(labelMaterial);
      // Keep the short badge close to the wheel. The full instruction is in the
      // HUD; a tall duplicate placard is clipped by the close combat camera.
      const label = new THREE.Sprite(labelMaterial); label.position.set(0, 2.75, .35); label.scale.set(2.7, .675, 1); root.add(label);
      return { root, wheel, wheelStart: wheel?.rotation.z || 0, statusMaterials, pad, vent, pipe, canvas, context, texture, index: i, labelState: '' };
    });
    this.update(route);
  }
  update(route) {
    for (const entry of this.entries) {
      const gate = route.gates[entry.index], current = entry.index === route.progress;
      entry.root.visible = gate.room.discovered;
      const hot = current && gate.prepared && ['warning', 'vent'].includes(gate.phase);
      const color = gate.attuned ? 0x64e2c2 : hot ? 0xff863e : current ? 0xffd181 : 0x788392;
      for (const m of entry.statusMaterials) { m.color.setHex(color); if (m.emissive) { m.emissive.setHex(color); m.emissiveIntensity = .35; } }
      if (entry.wheel) entry.wheel.rotation.z = entry.wheelStart + (gate.attuned ? 1 : current ? route.hold / route.def.holdSeconds : 0) * Math.PI * 1.5;
      entry.pad.visible = current && gate.ready;
      entry.pad.position.x = gate.pad.x - gate.room.x;
      entry.pad.material.opacity = .55 + .45 * (current ? route.hold / route.def.holdSeconds : 0);
      const h = coolingVent(gate);
      entry.vent.visible = hot;
      entry.vent.position.x = h.x - gate.room.x; entry.vent.scale.set(h.width, 1, h.length);
      entry.vent.material.uniforms.size.value.set(h.width, h.length);
      entry.vent.material.uniforms.fired.value = gate.phase === 'vent' ? 1 : 0;
      entry.vent.material.uniforms.opacity.value = gate.phase === 'vent' ? .95 : .6;
      entry.pipe.material.color.setHex(gate.attuned ? 0x64e2c2 : 0x35444d);
      const state = gate.attuned ? '냉각 완료' : !current ? '대기' : gate.ready ? '조작 2초' : '방어';
      if (state !== entry.labelState && entry.context) {
        entry.labelState = state;
        const c = entry.context; c.clearRect(0, 0, 256, 64);
        c.fillStyle = 'rgba(9,18,27,.9)'; c.fillRect(0, 0, 256, 64);
        c.fillStyle = gate.attuned ? '#64e2c2' : '#ffe0a5'; c.font = 'bold 30px sans-serif'; c.textAlign = 'center';
        c.fillText(`${String(entry.index + 1).padStart(2, '0')} · ${state}`, 128, 43); entry.texture.needsUpdate = true;
      }
    }
  }
  dispose() {
    this.group.removeFromParent(); this.plane.dispose(); this.ring.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.materials.clear(); this.textures.clear();
  }
}
