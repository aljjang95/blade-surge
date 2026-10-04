import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { PlayerSilhouette, PLAYER_SILHOUETTE_FRAGMENT } from '../src/engine/player-silhouette.js';

function fixture() {
  const uniforms = { uPlayerMask: { value: null as THREE.Texture | null },
    uPlayerOutlineStep: { value: new THREE.Vector2() }, uPlayerOutlineActive: { value: 0 } };
  const silhouette: any = new PlayerSilhouette(uniforms);
  const scene = new THREE.Scene(), parent = new THREE.Group(), root = new THREE.Group();
  const motion = new THREE.Group(), model = new THREE.Group();
  scene.add(parent); parent.add(root); root.add(motion); motion.add(model);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute([0, 0, .2, 1.1, 0, .1, 0, 1.1, .2], 3)];
  const material = new THREE.MeshStandardMaterial(), skin = new THREE.SkinnedMesh(geometry, material), bone = new THREE.Bone();
  skin.name = 'CurrentBody'; model.add(skin); skin.add(bone);
  const skeleton = new THREE.Skeleton([bone]); skin.bind(skeleton); skin.morphTargetInfluences![0] = .3;
  const equipment = new THREE.Mesh(new THREE.BoxGeometry(.1, .4, .1), new THREE.MeshStandardMaterial());
  equipment.position.set(.6, .3, .2); equipment.name = 'VisibleEquipment'; bone.add(equipment);
  const actor: any = { root, model, alive: true, dead: false, disposed: false };
  const camera = new THREE.PerspectiveCamera(42, 844 / 390, .1, 120);
  const oldTarget = null, context = { isContextLost: () => lost };
  let target: any = oldTarget, lost = false, color = new THREE.Color(0x234567), alpha = .3;
  const viewport = new THREE.Vector4(7, 9, 800, 370), scissor = new THREE.Vector4(11, 13, 790, 350); let scissorTest = true;
  const events: any[] = [], info = { autoReset: false, render: { calls: 0 }, reset: () => { throw Error('must not reset metrics'); } };
  const renderer: any = {
    info, autoClear: true, shadowMap: { enabled: true },
    getContext: () => context, getRenderTarget: () => target, getActiveCubeFace: () => 2, getActiveMipmapLevel: () => 3,
    setRenderTarget(value: any, cube = 0, mip = 0) { target = value; events.push(['target', value, cube, mip]); },
    getViewport(out: THREE.Vector4) { return out.copy(viewport); }, getScissor(out: THREE.Vector4) { return out.copy(scissor); },
    getScissorTest: () => scissorTest,
    setViewport(value: THREE.Vector4) { viewport.copy(value); }, setScissor(value: THREE.Vector4) { scissor.copy(value); },
    setScissorTest(value: boolean) { scissorTest = value; },
    getClearColor(out: THREE.Color) { return out.copy(color); }, getClearAlpha: () => alpha,
    setClearColor(value: any, nextAlpha: number) { color = value?.isColor ? value.clone() : new THREE.Color(value); alpha = nextAlpha; },
    clear(...args: any[]) { events.push(['clear', ...args]); },
    render(mask: THREE.Scene, drawCamera: THREE.Camera) {
      expect(mask).toBe(silhouette.scene); expect(drawCamera).toBe(camera);
      viewport.set(0, 0, 844, 390); scissor.set(0, 0, 844, 390); scissorTest = false;
      mask.updateMatrixWorld(true);
      mask.traverseVisible((o: any) => { if (o.isLight) throw Error('extra light');
        if (o.isMesh) { expect(o.castShadow).toBe(false); expect(o.receiveShadow).toBe(false);
          const materials = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of materials) if (m?.visible) info.render.calls++;
        }
      }); events.push(['render']);
    },
  };
  silhouette.resize(844, 390, 2);
  const prepare = () => { const preparation = silhouette.preparation(renderer, actor); expect(preparation.complete()).toBe(true); return preparation; };
  return { silhouette, uniforms, scene, parent, root, motion, model, geometry, material, skin, bone, skeleton, equipment,
    actor, camera, renderer, events, oldTarget, prepare, current: () => target, color: () => color, alpha: () => alpha,
    viewport, scissor, scissorTest: () => scissorTest,
    lose: () => { lost = true; } };
}

test('both animation poses share live skin, morph, ancestor and bone-mounted equipment transforms', () => {
  const f = fixture(); f.prepare(); const body = f.silhouette.entries.find((e: any) => e.source === f.skin).proxy;
  const equipment = f.silhouette.entries.find((e: any) => e.source === f.equipment).proxy;
  let lastVertex: THREE.Vector3 | undefined;
  for (const frame of [1, 2]) {
    f.parent.position.set(4 * frame, 2, -3); f.parent.rotation.y = .3 * frame;
    f.root.position.set(.7, 0, frame); f.motion.rotation.z = -.13 * frame;
    f.motion.scale.set(1.1, .85, 1); f.bone.rotation.z = .47 * frame;
    f.skin.morphTargetInfluences![0] = .2 * frame;
    f.silhouette.render(f.renderer, f.camera, f.actor);
    expect(f.uniforms.uPlayerOutlineActive.value).toBe(1);
    expect(body.geometry).toBe(f.skin.geometry); expect(body.skeleton).toBe(f.skeleton);
    expect(body.morphTargetInfluences).toBe(f.skin.morphTargetInfluences);
    expect(body.bindMode).toBe(f.skin.bindMode); expect(body.bindMatrixInverse.elements).toEqual(f.skin.bindMatrixInverse.elements);
    for (let index = 0; index < 3; index++) {
      const actual = f.skin.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(f.skin.matrixWorld);
      const masked = body.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(body.matrixWorld);
      expect(masked.distanceTo(actual)).toBeLessThan(1e-8);
      if (index === 1) { if (lastVertex) expect(actual.distanceTo(lastVertex)).toBeGreaterThan(.5); lastVertex = actual; }
    }
    expect(equipment.geometry).toBe(f.equipment.geometry); expect(equipment.matrixWorld.elements).toEqual(f.equipment.matrixWorld.elements);
    expect(f.viewport.toArray()).toEqual([7, 9, 800, 370]); expect(f.scissor.toArray()).toEqual([11, 13, 790, 350]);
    expect(f.scissorTest()).toBe(true);
  }
  expect(f.actor).not.toHaveProperty('mixer'); expect(f.renderer.info.render.calls).toBe(4);
  expect(f.renderer.info.autoReset).toBe(false); expect(f.renderer.shadowMap.enabled).toBe(true);
});

test('mask never includes sibling beacons, companions, enemies or hidden parents and material groups', () => {
  const f = fixture();
  for (const name of ['HeroBeacon', 'Pet', 'Enemy', 'UnseenBoss']) {
    const object = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); object.name = name; f.root.add(object);
  }
  const hiddenParent = new THREE.Group(), hidden = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  hiddenParent.visible = false; hidden.name = 'HiddenWeapon'; hiddenParent.add(hidden); f.model.add(hiddenParent);
  const groupedGeometry = new THREE.BoxGeometry(), first = new THREE.MeshStandardMaterial(), second = new THREE.MeshStandardMaterial();
  first.visible = false; const grouped = new THREE.Mesh(groupedGeometry, [first, second]); f.model.add(grouped);
  const additive = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending }));
  f.model.add(additive); f.prepare(); f.silhouette.render(f.renderer, f.camera, f.actor);
  const entries = f.silhouette.entries;
  expect(entries.map((e: any) => e.source)).toEqual([f.skin, f.equipment, hidden, grouped, additive]);
  expect(entries.find((e: any) => e.source === hidden).proxy.visible).toBe(false);
  expect(entries.find((e: any) => e.source === additive).proxy.visible).toBe(false);
  const masked = entries.find((e: any) => e.source === grouped).proxy;
  expect(masked.geometry.groups).toBe(grouped.geometry.groups); expect(masked.material[0].visible).toBe(false);
  expect(masked.material[1].visible).toBe(true); second.visible = false; first.visible = true;
  hiddenParent.visible = true; f.silhouette.render(f.renderer, f.camera, f.actor);
  expect(masked.material[0].visible).toBe(true); expect(masked.material[1].visible).toBe(false);
  expect(entries.find((e: any) => e.source === hidden).proxy.visible).toBe(true);
  f.model.visible = false; f.silhouette.render(f.renderer, f.camera, f.actor); expect(f.uniforms.uPlayerOutlineActive.value).toBe(0);
});

test('cold preparation, death, stop, actor replacement, loss and changed source cannot retain the old mask', () => {
  const f = fixture(); const pending = f.silhouette.preparation(f.renderer, f.actor);
  f.silhouette.render(f.renderer, f.camera, f.actor); expect(f.events).toEqual([]);
  expect(pending.complete()).toBe(true); f.silhouette.render(f.renderer, f.camera, f.actor);
  expect(f.uniforms.uPlayerOutlineActive.value).toBe(1);
  for (const property of ['alive', 'dead', 'disposed']) {
    const before = f.actor[property]; f.actor[property] = property !== 'alive';
    f.silhouette.render(f.renderer, f.camera, f.actor); expect(f.uniforms.uPlayerOutlineActive.value).toBe(0);
    f.actor[property] = before;
  }
  f.silhouette.render(f.renderer, f.camera, null); expect(f.uniforms.uPlayerOutlineActive.value).toBe(0);
  f.silhouette.render(f.renderer, f.camera, { ...f.actor }); expect(f.uniforms.uPlayerOutlineActive.value).toBe(0);
  f.skin.layers.set(1); f.equipment.layers.set(1); f.silhouette.render(f.renderer, f.camera, f.actor);
  expect(f.uniforms.uPlayerOutlineActive.value).toBe(0); f.camera.layers.set(1);
  f.silhouette.render(f.renderer, f.camera, f.actor); expect(f.uniforms.uPlayerOutlineActive.value).toBe(1);
  expect(f.silhouette.entries.every((entry: any) => entry.proxy.layers.mask === entry.source.layers.mask)).toBe(true);
  f.skin.layers.set(0); f.equipment.layers.set(0); f.camera.layers.set(0);
  f.skin.material = new THREE.MeshStandardMaterial(); f.silhouette.render(f.renderer, f.camera, f.actor);
  expect(f.uniforms.uPlayerOutlineActive.value).toBe(0); f.skin.material = f.material;
  f.material.side = THREE.DoubleSide; f.silhouette.render(f.renderer, f.camera, f.actor);
  expect(f.uniforms.uPlayerOutlineActive.value).toBe(0); f.material.side = THREE.FrontSide;
  const foreign = new THREE.Scene(); foreign.add(f.root); f.silhouette.render(f.renderer, f.camera, f.actor);
  expect(f.uniforms.uPlayerOutlineActive.value).toBe(0); f.parent.add(f.root);
  f.silhouette.clearActor(); expect(pending.isCurrent()).toBe(false); expect(pending.complete()).toBe(false);
  expect(f.silhouette.scene.children).toEqual([]); expect(f.uniforms.uPlayerOutlineActive.value).toBe(0);
  const next = f.prepare(); f.lose(); f.silhouette.render(f.renderer, f.camera, f.actor);
  expect(next.isCurrent()).toBe(false); expect(next.complete()).toBe(false); expect(f.uniforms.uPlayerOutlineActive.value).toBe(0);
});

test('render failure restores target face, mip, clear colour and autoClear without clearing draw accounting', () => {
  const f = fixture(); f.prepare(); const originalColor = f.color().clone();
  f.renderer.render = () => { f.viewport.set(0, 0, 20, 30); f.scissor.set(0, 0, 20, 30); f.renderer.setScissorTest(false);
    f.renderer.info.render.calls += 7; throw Error('real render failure'); };
  expect(() => f.silhouette.render(f.renderer, f.camera, f.actor)).toThrow('real render failure');
  expect(f.current()).toBe(f.oldTarget); expect(f.events.at(-1)).toEqual(['target', f.oldTarget, 2, 3]);
  expect(f.color().equals(originalColor)).toBe(true); expect(f.alpha()).toBe(.3); expect(f.renderer.autoClear).toBe(true);
  expect(f.renderer.info.render.calls).toBe(7); expect(f.renderer.info.autoReset).toBe(false);
  expect(f.viewport.toArray()).toEqual([7, 9, 800, 370]); expect(f.scissor.toArray()).toEqual([11, 13, 790, 350]);
  expect(f.scissorTest()).toBe(true);
  expect(f.uniforms.uPlayerOutlineActive.value).toBe(0); expect(f.events).toContainEqual(['clear', true, false, false]);
});

test('non-screen render-target callers leave the target and renderer state untouched with mask off', () => {
  const f = fixture(); f.prepare(); const offscreen = {}; f.renderer.setRenderTarget(offscreen, 2, 3); f.events.length = 0;
  f.silhouette.render(f.renderer, f.camera, f.actor); expect(f.current()).toBe(offscreen); expect(f.events).toEqual([]);
  expect(f.uniforms.uPlayerOutlineActive.value).toBe(0); expect(f.renderer.autoClear).toBe(true);
  expect(f.viewport.toArray()).toEqual([7, 9, 800, 370]); expect(f.scissor.toArray()).toEqual([11, 13, 790, 350]);
  expect(f.scissorTest()).toBe(true); expect(f.renderer.info.render.calls).toBe(0);
});

test('new or reparented descendants close the old mask until preparation instead of inventing stale equipment', () => {
  const f = fixture(); f.prepare(); f.silhouette.render(f.renderer, f.camera, f.actor);
  const added = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); f.bone.add(added);
  f.silhouette.render(f.renderer, f.camera, f.actor); expect(f.uniforms.uPlayerOutlineActive.value).toBe(0);
  f.prepare(); f.silhouette.render(f.renderer, f.camera, f.actor);
  expect(f.uniforms.uPlayerOutlineActive.value).toBe(1); expect(f.silhouette.entries.some((e: any) => e.source === added)).toBe(true);
  f.model.add(f.equipment); f.silhouette.render(f.renderer, f.camera, f.actor); expect(f.uniforms.uPlayerOutlineActive.value).toBe(0);
  f.prepare(); f.silhouette.render(f.renderer, f.camera, f.actor);
  expect(f.uniforms.uPlayerOutlineActive.value).toBe(1);
  expect(f.silhouette.entries.find((e: any) => e.source === f.equipment).proxy.matrixWorld.elements).toEqual(f.equipment.matrixWorld.elements);
});

test('restore makes a new renderer target, and clear/dispose free only owned resources once', () => {
  const f = fixture(); f.prepare(); let geometry = 0, material = 0, skeleton = 0, target = 0, masks = 0;
  f.geometry.addEventListener('dispose', () => geometry++); f.material.addEventListener('dispose', () => material++);
  f.skeleton.dispose = () => { skeleton++; }; const before = f.silhouette.target;
  before.addEventListener('dispose', () => target++);
  for (const entry of f.silhouette.entries) for (const mask of entry.materials) mask?.addEventListener('dispose', () => masks++);
  f.silhouette.restoreTarget(); expect(f.silhouette.target).not.toBe(before); expect(target).toBe(1);
  expect(f.uniforms.uPlayerMask.value).toBe(f.silhouette.target.texture); expect(f.silhouette.ready).toBe(false);
  f.silhouette.clearActor(); f.silhouette.clearActor(); expect(masks).toBe(2);
  f.silhouette.dispose(); f.silhouette.dispose(); expect(geometry).toBe(0); expect(material).toBe(0); expect(skeleton).toBe(0);
  expect(f.uniforms.uPlayerMask.value).toBeNull(); expect(f.uniforms.uPlayerOutlineActive.value).toBe(0);
});

test('target dimensions follow quality instead of extra DPR and edge shader never fills the player', () => {
  const f = fixture();
  for (const [width, height, ratio] of [[844, 390, 2], [390, 844, 1], [1920, 1080, .7]]) {
    f.silhouette.resize(width, height, ratio); const effective = Math.min(1, ratio);
    expect(f.silhouette.target.width).toBe(Math.floor(width * effective));
    expect(f.silhouette.target.height).toBe(Math.floor(height * effective));
    expect(f.silhouette.target.depthBuffer).toBe(false); expect(f.silhouette.target.stencilBuffer).toBe(false);
    const radius = f.uniforms.uPlayerOutlineStep.value.x * width;
    expect(radius + .5 / effective).toBeLessThanOrEqual(2);
    expect(f.uniforms.uPlayerOutlineStep.value.y * height).toBeCloseTo(radius, 12);
  }
  expect(PLAYER_SILHOUETTE_FRAGMENT).toContain('outside = 1.0 - step(.5');
  expect(PLAYER_SILHOUETTE_FRAGMENT).toContain('dark = outside *'); expect(PLAYER_SILHOUETTE_FRAGMENT).toContain('light = outside *');
  expect(PLAYER_SILHOUETTE_FRAGMENT).not.toContain('uTime'); expect(PLAYER_SILHOUETTE_FRAGMENT).not.toContain('depth');
});

test('existing final composition is prepared in its real linear target and retains shared material/geometry ownership', () => {
  const f = fixture(), geometry = new THREE.PlaneGeometry(2, 2), material = new THREE.ShaderMaterial();
  let freed = 0; geometry.addEventListener('dispose', () => freed++); material.addEventListener('dispose', () => freed++);
  const silhouette: any = new PlayerSilhouette(f.uniforms, { material, fsQuad: { _mesh: { geometry } } });
  const linearTarget = new THREE.WebGLRenderTarget(844, 390);
  const preparation = silhouette.preparation(f.renderer, f.actor, linearTarget);
  expect(preparation.targets).toHaveLength(2); expect(preparation.targets[0].scene).toBe(silhouette.scene);
  const composite = preparation.targets[1]; expect(composite.target).toBe(linearTarget);
  expect(composite.scene.children).toHaveLength(1);
  expect(composite.scene.children[0].geometry).toBe(geometry); expect(composite.scene.children[0].material).toBe(material);
  expect(composite.readinessObjects).toEqual([composite.scene]); expect(composite.isCurrent()).toBe(true);
  silhouette.dispose(); expect(preparation.isCurrent()).toBe(false); expect(composite.isCurrent()).toBe(false); expect(freed).toBe(0);
});

test('mask retains authored deformation/alpha settings and pinned shader output without editing the source', () => {
  const f = fixture(), map = new THREE.Texture(), alpha = new THREE.Texture(), displacement = new THREE.Texture();
  f.material.map = map; f.material.alphaMap = alpha; f.material.alphaTest = .3;
  f.material.displacementMap = displacement; f.material.displacementScale = .2; f.material.displacementBias = -.1;
  f.material.side = THREE.DoubleSide; f.prepare();
  const mask = f.silhouette.entries.find((entry: any) => entry.source === f.skin).materials[0];
  expect(mask.isMeshDepthMaterial).toBe(true); expect(mask.map).toBe(map); expect(mask.alphaMap).toBe(alpha);
  expect(mask.alphaTest).toBe(.3); expect(mask.displacementMap).toBe(displacement);
  expect(mask.displacementScale).toBe(.2); expect(mask.displacementBias).toBe(-.1); expect(mask.side).toBe(THREE.DoubleSide);
  const shader: any = { fragmentShader: THREE.ShaderLib.depth.fragmentShader, vertexShader: THREE.ShaderLib.depth.vertexShader };
  mask.onBeforeCompile(shader, {}); expect(shader.vertexShader).toBe(THREE.ShaderLib.depth.vertexShader);
  expect(shader.fragmentShader).toContain('if (diffuseColor.a <= .001) discard;');
  expect(shader.fragmentShader).toContain('gl_FragColor = vec4(1.0);');
  expect(f.material.map).toBe(map); expect(f.material.alphaMap).toBe(alpha); expect(f.material.displacementMap).toBe(displacement);
  expect(() => mask.onBeforeCompile({ fragmentShader: 'void main() {}' }, {})).toThrow('Three r170 depth shader');
  // 알파 테스트/별도 알파 맵이 없어도 알파 해시가 원본 map의 구멍을 읽는다.
  f.material.alphaTest = 0; f.material.alphaMap = null; f.material.alphaHash = true; f.prepare();
  const hashed = f.silhouette.entries.find((entry: any) => entry.source === f.skin).materials[0];
  expect(hashed.map).toBe(map); expect(hashed.alphaMap).toBeNull(); expect(hashed.alphaTest).toBe(0);
  expect(hashed.alphaHash).toBe(true); f.silhouette.render(f.renderer, f.camera, f.actor);
  expect(f.uniforms.uPlayerOutlineActive.value).toBe(1); expect(f.material.map).toBe(map);
  expect(f.material.alphaHash).toBe(true); expect(f.material.displacementMap).toBe(displacement);
});
