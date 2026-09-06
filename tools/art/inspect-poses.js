import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { spawnCharacter, disposeCharacter, requiredModelAliases } from '../../src/engine/assets.js';
import { HEROES } from '../../src/data/heroes.js';
import { applyLook } from '../../src/game/look.js';

export function inspectPoses(models) {
  const reports = [];
  for (const hero of Object.values(HEROES)) {
    const c = spawnCharacter(models[hero.model]); applyLook(c.root, hero);
    let samples = 0, vertices = 0, maxSpan = 0;
    for (const name of requiredModelAliases('hero', hero.id)) {
      const clip = c.clips[name]; if (!clip) throw new Error(`Missing ${hero.id}:${name}`);
      for (const fraction of [0, .5, .95]) {
        c.mixer.stopAllAction(); c.mixer.clipAction(clip).reset().play(); c.mixer.update(clip.duration * fraction);
        c.root.updateMatrixWorld(true); const box = new THREE.Box3();
        c.root.traverse((o) => {
          if (!o.isSkinnedMesh) return;
          const n = o.geometry.attributes.position.count;
          for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 128))) {
            const p = o.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(o.matrixWorld);
            if (!p.toArray().every(Number.isFinite)) throw new Error(`Non-finite pose ${hero.id}:${name}`);
            box.expandByPoint(p); vertices++;
          }
        });
        maxSpan = Math.max(maxSpan, box.getSize(new THREE.Vector3()).length()); samples++;
        if (maxSpan > 12) throw new Error(`Exploded pose ${hero.id}:${name}:${maxSpan}`);
      }
    }
    reports.push({ hero: hero.id, poseSamples: samples, sampledVertices: vertices, maxSpan });
    disposeCharacter(c.root, c.mixer);
  }
  return reports;
}

export function renderTurnarounds(models) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1024, 1024); renderer.setScissorTest(true);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, .04); room.dispose(); pmrem.dispose();
  const images = {};
  for (const hero of Object.values(HEROES)) {
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x16232d);
    scene.add(new THREE.HemisphereLight(0xd6e7ed, 0x28232b, 2));
    const light = new THREE.DirectionalLight(0xffe5c1, 3); light.position.set(-2, 4, 5); scene.add(light);
    const c = spawnCharacter(models[hero.model]); applyLook(c.root, hero); scene.add(c.root);
    c.root.traverse((o) => { if (o.isMesh && o.material?.userData.tllAuthored) { o.material.envMap = environment.texture; o.material.envMapIntensity = .7; } });
    c.mixer.clipAction(c.clips.Idle).play(); c.mixer.update(.25);
    const camera = new THREE.PerspectiveCamera(37, 1, .1, 20); camera.position.set(0, 1.7, 4.2); camera.lookAt(0, 1.3, 0);
    [0, -.7854, .7854, 1.5708].forEach((angle, i) => {
      c.root.rotation.y = angle; const x = (i % 2) * 512, y = i < 2 ? 512 : 0;
      renderer.setViewport(x, y, 512, 512); renderer.setScissor(x, y, 512, 512); renderer.render(scene, camera);
    });
    images[hero.id] = renderer.domElement.toDataURL('image/png'); disposeCharacter(c.root, c.mixer);
  }
  environment.dispose(); renderer.dispose(); renderer.forceContextLoss(); return images;
}
