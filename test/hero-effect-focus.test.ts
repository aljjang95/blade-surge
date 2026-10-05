import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { HeroEffectFocus } from '../src/engine/hero-effect-focus.js';
import { battleCameraOffset } from '../src/engine/camera-control.js';

const shader = () => ({ uniforms: {} as Record<string, any>, vertexShader: '',
  fragmentShader: '#version 300 es\nprecision highp float;\nvoid main() { gl_FragColor = vec4(1.0); /* } */ }\nfloat later() { return 2.0; }' });
const compile = (material: THREE.Material) => {
  const value = shader(); material.onBeforeCompile(value as any, {} as THREE.WebGLRenderer); return value;
};
const renderer = (width: number, height: number) => ({ getDrawingBufferSize: (target: THREE.Vector2) => target.set(width, height) });
const target = () => ({ alive: true, dead: false, disposed: false, pos: new THREE.Vector3(37, 0, -21), scale: 1 });

test('live actor body stays in the strong capsule across camera controls, aspect and resize', () => {
  const focus = new HeroEffectFocus(), actor = target(); focus.setTarget(actor);
  for (const [width, height] of [[880, 400], [400, 880], [1760, 800]]) {
    for (const yaw of [0, -90, 90, 180]) for (const pitch of [-18, 20]) for (const zoom of [70, 140]) {
      const camera = new THREE.PerspectiveCamera(42, width / height, .1, 120);
      const offset = battleCameraOffset({ x: 0, y: 8.2, z: 7.4 }, { yaw, pitch, zoom });
      camera.position.copy(actor.pos).add(new THREE.Vector3(offset.x, offset.y, offset.z));
      camera.lookAt(actor.pos.clone().add(new THREE.Vector3(0, .85, 0)));
      focus.update(renderer(width, height), camera);
      const area = focus.area.value;
      expect(area.z).toBeGreaterThan(0); expect(area.w).toBeGreaterThan(0);
      expect(focus.viewport.value.toArray()).toEqual([width, height]);
      const center = actor.pos.clone().setY(1.2).project(camera);
      const side = actor.pos.clone().setY(1.2).addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), .5).project(camera);
      const halfWidth = Math.abs(side.x - center.x) * .5;
      for (const worldY of [.2, 2.4]) {
        const endpoint = actor.pos.clone().setY(worldY).project(camera);
        const uvY = endpoint.y * .5 + .5;
        const dx = halfWidth / area.z;
        const dy = Math.max(0, Math.abs(uvY - area.y) - area.w * .55) / (area.w * .45);
        // Geometric containment is checked against the capsule's full-strength
        // interior, rather than asserting an implementation-derived width.
        expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(.78);
      }
    }
  }
});

test('offscreen, behind, dead, disposed, invalid and detached targets clear the previous mask; restart rebinds', () => {
  const focus = new HeroEffectFocus(), actor = target();
  const camera = new THREE.PerspectiveCamera(42, 2.2, .1, 120);
  camera.position.copy(actor.pos).add(new THREE.Vector3(0, 8.2, 7.4)); camera.lookAt(actor.pos);
  focus.setTarget(actor); focus.update(renderer(880, 400), camera); expect(focus.area.value.z).toBeGreaterThan(0);
  actor.alive = false; focus.update(renderer(880, 400), camera); expect(focus.area.value.toArray()).toEqual([0, 0, 0, 0]);
  actor.alive = true; actor.dead = true; focus.update(renderer(880, 400), camera); expect(focus.area.value.z).toBe(0);
  actor.dead = false; actor.disposed = true; focus.update(renderer(880, 400), camera); expect(focus.area.value.z).toBe(0);
  actor.disposed = false; actor.pos.set(10000, 0, -21); focus.update(renderer(880, 400), camera); expect(focus.area.value.z).toBe(0);
  actor.pos.copy(camera.position).add(new THREE.Vector3(0, 8.2, 7.4)); focus.update(renderer(880, 400), camera); expect(focus.area.value.z).toBe(0);
  actor.pos.set(NaN, 0, -21); focus.update(renderer(880, 400), camera); expect(focus.area.value.z).toBe(0);
  const replacement = target(); focus.setTarget(replacement); expect(focus.area.value.z).toBe(0);
  focus.update(renderer(880, 400), camera); expect(focus.area.value.z).toBeGreaterThan(0);
  focus.update(renderer(0, 0), camera); expect(focus.area.value.z).toBe(0);
  focus.update(renderer(400, 880), camera); expect(focus.area.value.z).toBeGreaterThan(0);
  focus.setTarget(null); focus.update(renderer(880, 400), camera); expect(focus.area.value.toArray()).toEqual([0, 0, 0, 0]);
});

test('additive binding preserves prior shader work/cache identity and changes alpha only, once', () => {
  const focus = new HeroEffectFocus();
  const material = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending });
  let calls = 0;
  material.onBeforeCompile = function(value) { expect(this).toBe(material); calls++; value.fragmentShader = value.fragmentShader.replace('vec4(1.0)', 'vec4(.5)'); };
  material.customProgramCacheKey = () => 'authored-fire-program';
  const originalVersion = material.version;
  expect(focus.bind(material)).toBe(material); const hook = material.onBeforeCompile;
  focus.bind(material); expect(material.onBeforeCompile).toBe(hook); expect(material.version).toBe(originalVersion + 1);
  const value = compile(material); expect(calls).toBe(1);
  expect(value.uniforms.heroFocus).toBe(focus.area); expect(value.uniforms.heroFocusViewport).toBe(focus.viewport);
  expect(value.uniforms.heroCosmeticMask).toBe(focus.cosmeticMask);
  expect(value.uniforms.heroCosmeticMaskActive).toBe(focus.cosmeticMaskActive);
  expect(value.uniforms.heroCosmeticMaskAllowed.value).toBe(1);
  expect(value.fragmentShader.startsWith('#version 300 es')).toBe(true);
  expect(value.fragmentShader).toContain('gl_FragColor = vec4(.5)');
  expect(value.fragmentShader).toContain('gl_FragColor.a *= heroCosmeticFactor(');
  expect(value.fragmentShader).not.toContain('gl_FragColor.rgb *=');
  expect(value.fragmentShader.indexOf('gl_FragColor.a *=')).toBeLessThan(value.fragmentShader.indexOf('float later()'));
  expect(material.customProgramCacheKey()).toBe('authored-fire-program|hero-effect-focus-v4:alpha');
  const normal = new THREE.SpriteMaterial({ transparent: true, blending: THREE.NormalBlending });
  const normalHook = normal.onBeforeCompile, normalKey = normal.customProgramCacheKey();
  focus.bind(normal); expect(normal.onBeforeCompile).toBe(normalHook); expect(normal.customProgramCacheKey()).toBe(normalKey);
  expect(normal.version).toBe(0);
});

test('explicit telegraph materials retain their original shader and program identity', () => {
  const focus = new HeroEffectFocus();
  const telegraph = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending });
  telegraph.userData.telegraph = true;
  const hook = telegraph.onBeforeCompile, key = telegraph.customProgramCacheKey(), version = telegraph.version;
  const uniforms = compile(telegraph).uniforms;
  expect(focus.bind(telegraph)).toBe(telegraph);
  expect(telegraph.onBeforeCompile).toBe(hook); expect(telegraph.customProgramCacheKey()).toBe(key);
  expect(telegraph.version).toBe(version); expect(compile(telegraph).uniforms).toEqual(uniforms);
  expect(compile(telegraph).fragmentShader).not.toContain('heroCosmeticFactor');
  const retained = telegraph.clone(); focus.bind(retained);
  expect(compile(retained).fragmentShader).not.toContain('heroEffectFactor');
});

test('projectile halo opt-out keeps the warmed alpha program and only its historical capsule attenuation', () => {
  const focus = new HeroEffectFocus();
  const cosmetic = new THREE.SpriteMaterial({ transparent: true, blending: THREE.AdditiveBlending });
  const projectile = cosmetic.clone();
  focus.bind(cosmetic); focus.bind(projectile);
  // Battle.spawnProjectile은 바인딩된 새 후광에 첫 렌더 전에 예외 플래그를 붙인다.
  projectile.userData.heroCosmeticMask = false;
  const cosmeticShader = compile(cosmetic), projectileShader = compile(projectile);
  expect(cosmetic.customProgramCacheKey()).toBe(projectile.customProgramCacheKey());
  expect(cosmeticShader.fragmentShader).toBe(projectileShader.fragmentShader);
  expect(cosmeticShader.uniforms.heroCosmeticMaskAllowed.value).toBe(1);
  expect(projectileShader.uniforms.heroCosmeticMaskAllowed.value).toBe(0);
  expect(projectileShader.fragmentShader).toContain('heroCosmeticMaskAllowed < .5) return factor;');
  expect(projectileShader.uniforms.heroFocus).toBe(focus.area);
  expect(projectileShader.uniforms.heroCosmeticMask).toBe(focus.cosmeticMask);
});

test('retained clone and replacement focus owner bind current shared uniforms without duplicate hooks', () => {
  const first = new HeroEffectFocus(), second = new HeroEffectFocus();
  const material = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending });
  first.bind(material);
  const retained = material.clone(); first.bind(retained);
  expect(compile(retained).uniforms.heroFocus).toBe(first.area);
  second.bind(material); const compiled = compile(material);
  expect(compiled.uniforms.heroFocus).toBe(second.area);
  expect(compiled.uniforms.heroCosmeticMask).toBe(second.cosmeticMask);
  expect(compiled.uniforms.heroCosmeticMaskActive).toBe(second.cosmeticMaskActive);
  expect(compiled.fragmentShader.match(/uniform vec4 heroFocus;/g)).toHaveLength(1);
  expect(compiled.fragmentShader.match(/uniform sampler2D heroCosmeticMask;/g)).toHaveLength(1);
  first.bind(material); expect(compile(material).uniforms.heroFocus).toBe(first.area);
  material.dispose(); first.bind(material); expect(compile(material).uniforms.heroFocus).toBe(first.area);
});

test('existing bloom blend receives only RGB attenuation and preserves alpha, texture, geometry ownership', () => {
  const focus = new HeroEffectFocus(), texture = new THREE.Texture();
  const uniforms = { tDiffuse: { value: texture }, opacity: { value: 1 } };
  const material = new THREE.ShaderMaterial({ uniforms, transparent: true, blending: THREE.AdditiveBlending });
  const bloom = { blendMaterial: material, copyUniforms: uniforms };
  expect(focus.bindBloom(bloom)).toBe(bloom); const hook = material.onBeforeCompile;
  focus.bindBloom(bloom); expect(material.onBeforeCompile).toBe(hook);
  const value = compile(material);
  expect(value.fragmentShader).toContain('gl_FragColor.rgb *= heroEffectFactor(vUv);');
  expect(value.fragmentShader).not.toContain('gl_FragColor.a *=');
  expect(value.fragmentShader).not.toContain('heroCosmeticMask');
  expect(value.uniforms).not.toHaveProperty('heroCosmeticMask');
  expect(material.customProgramCacheKey()).toContain('|hero-effect-focus-v3:bloom-rgb');
  expect((uniforms as any).heroFocus).toBe(focus.area); expect(material.uniforms.heroFocus).toBe(focus.area);
  expect(uniforms.tDiffuse.value).toBe(texture); expect(uniforms.opacity.value).toBe(1);
  expect(() => focus.bindBloom({})).toThrow('blendMaterial/copyUniforms');
});
