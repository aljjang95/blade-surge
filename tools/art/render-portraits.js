// Run in the served development page through the managed browser's developer surface.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { spawnCharacter, disposeCharacter } from '../../src/engine/assets.js';
import { HEROES } from '../../src/data/heroes.js';
import { applyLook } from '../../src/game/look.js';

export function renderPortraits(models) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(512, 512); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, .04); room.dispose(); pmrem.dispose();
  const result = {};
  for (const def of Object.values(HEROES)) {
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x16232d);
    scene.add(new THREE.HemisphereLight(0xd6e7ed, 0x28232b, 2));
    const key = new THREE.DirectionalLight(0xffe5c1, 3); key.position.set(-2, 4, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(0x79bcd8, 2.5); rim.position.set(3, 2, -3); scene.add(rim);
    const character = spawnCharacter(models[def.model]); applyLook(character.root, def);
    character.root.traverse((o) => { if (o.isMesh && o.material?.userData.tllAuthored) { o.material.envMap = environment.texture; o.material.envMapIntensity = .7; } });
    character.mixer.clipAction(character.clips.Idle).play(); character.mixer.update(.25);
    scene.add(character.root); scene.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 20); camera.position.set(.5, 1.8, 3.1); camera.lookAt(0, 1.65, 0);
    renderer.render(scene, camera); result[def.id] = renderer.domElement.toDataURL('image/png');
    disposeCharacter(character.root, character.mixer);
  }
  environment.dispose(); renderer.dispose(); renderer.forceContextLoss(); return result;
}
