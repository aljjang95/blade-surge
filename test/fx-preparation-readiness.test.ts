import { afterEach, beforeEach, expect, test } from 'bun:test';
import * as THREE from 'three';
import { FX } from '../src/engine/fx.js';

const root = globalThis as any;
let oldDocument: any, oldRaf: any;
beforeEach(() => {
  oldDocument = root.document; oldRaf = root.requestAnimationFrame;
  const gradient = { addColorStop() {} };
  const context = new Proxy({ createRadialGradient: () => gradient, createLinearGradient: () => gradient }, {
    get: (target: any, key) => target[key] ?? (() => {}),
  });
  root.document = { createElement: () => ({ getContext: () => context }) };
  root.requestAnimationFrame = (fn: any) => { queueMicrotask(() => fn(0)); return 1; };
});
afterEach(() => { root.document = oldDocument; root.requestAnimationFrame = oldRaf; });

function fixture() {
  const fx: any = Object.create(FX.prototype);
  Object.assign(fx, { _primed: true, _mats: {}, _transparentMats: new Map(), _depthMats: new Map(),
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), plane1: new THREE.PlaneGeometry(1, 1) });
  const target = {}, previous = {}, events: string[] = [], nativeProperties = new Map<THREE.Material, any>();
  let current = previous, lost = false, linked = true, hold: (() => void) | null = null, compileCalls = 0;
  const programs = new Map<string, any>();
  const programFor = (key: string) => {
    if (!programs.has(key)) programs.set(key, { program: { key },
      getUniforms: () => { events.push(`uniforms:${key}`); },
      getAttributes: () => { events.push(`attributes:${key}`); } });
    return programs.get(key);
  };
  const gl = { LINK_STATUS: 0x8b82, isContextLost: () => lost,
    getProgramParameter: (p: any, parameter: number) => {
      expect(parameter).toBe(gl.LINK_STATUS); events.push(`link:${p.key}`); return linked;
    }, getProgramInfoLog: () => 'fixture shader link failed' };
  const renderer: any = { shadowMap: { enabled: true }, getRenderTarget: () => current,
    setRenderTarget: (value: any) => { current = value; }, initTexture() {}, getContext: () => gl,
    properties: { has: (m: THREE.Material) => nativeProperties.has(m), get: (m: THREE.Material) => {
      expect(nativeProperties.has(m)).toBe(true); return nativeProperties.get(m);
    } }, compileAsync: async (scene: THREE.Scene, camera: THREE.Camera, targetScene?: THREE.Scene) => {
      expect(current).toBe(target); expect(camera).toBe(fx.camera); compileCalls++;
      events.push(`compile:${compileCalls}`);
      if (compileCalls === 2) expect(targetScene).toBe(fx.scene);
      scene.traverse((o: any) => {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m) continue; const key = m.name || m.type;
          nativeProperties.set(m, { currentProgram: programFor(key) });
        }
      });
      if (compileCalls === 3) await new Promise<void>(resolve => { hold = resolve; });
      events.push(`compiled:${compileCalls}`);
    } };
  const template = new THREE.Group(), geometry = new THREE.PlaneGeometry(1, 1);
  const surface = new THREE.MeshStandardMaterial(); surface.name = 'loot';
  template.add(new THREE.Mesh(geometry, surface), new THREE.Mesh(geometry, surface));
  const hazards = new THREE.Group(), warning = new THREE.ShaderMaterial(); warning.name = 'warning';
  for (let i = 0; i < 6; i++) { const mesh = new THREE.Mesh(geometry, warning); mesh.visible = false; hazards.add(mesh); }
  fx.scene.add(hazards);
  const unrelated = new THREE.MeshStandardMaterial(); unrelated.name = 'unrelated'; fx.scene.add(new THREE.Mesh(geometry, unrelated));
  return { fx, renderer, template, hazards, geometry, surface, warning, nativeProperties, programs, events, target, previous,
    current: () => current, release: () => { if (!hold) throw Error('compile was not held'); hold(); },
    setLost: (value: boolean) => { lost = value; }, setLinked: (value: boolean) => { linked = value; },
    async untilHeld() { for (let i = 0; i < 20 && !hold; i++) await Promise.resolve(); expect(hold).not.toBeNull(); } };
}

test('targeted readiness awaits every native preparation pass, deduplicates programs and leaves actual hidden hazards in their scene', async () => {
  const f = fixture(); let completed = false, disposed = 0;
  f.geometry.addEventListener('dispose', () => disposed++); f.surface.addEventListener('dispose', () => disposed++);
  const preparing = f.fx.prepare(f.renderer, {}, f.target, [f.template], [f.template, f.hazards]).then(() => { completed = true; });
  await f.untilHeld(); expect(completed).toBe(false); expect(f.events.some(e => e.startsWith('uniforms:'))).toBe(false);
  expect(f.hazards.parent).toBe(f.fx.scene); expect(f.hazards.children.every((o: THREE.Object3D) => !o.visible)).toBe(true);
  f.release(); await preparing;
  expect(f.events.filter(e => e.startsWith('uniforms:'))).toEqual(['uniforms:loot', 'uniforms:warning']);
  expect(f.events.filter(e => e.startsWith('attributes:'))).toEqual(['attributes:loot', 'attributes:warning']);
  expect(f.events.filter(e => e.startsWith('link:'))).toEqual(['link:loot', 'link:warning']);
  expect(f.events.indexOf('compiled:3')).toBeLessThan(f.events.indexOf('uniforms:loot'));
  expect(f.current()).toBe(f.previous); expect(f.template.parent).toBeNull(); expect(f.hazards.parent).toBe(f.fx.scene);
  expect(disposed).toBe(0); expect(completed).toBe(true);
});

test('default readiness uses only requested templates and restores their original owner', async () => {
  const f = fixture(), owner = new THREE.Group(); owner.add(f.template);
  const preparing = f.fx.prepare(f.renderer, {}, f.target, [f.template, f.template]);
  await f.untilHeld(); f.release(); await preparing;
  expect(f.events.filter(e => e.startsWith('uniforms:'))).toEqual(['uniforms:loot']);
  expect(f.template.parent).toBe(owner); expect(owner.children).toEqual([f.template]); expect(f.current()).toBe(f.previous);
});

test('uncompiled requested material fails closed without creating renderer properties', async () => {
  const f = fixture(); f.renderer.shadowMap.enabled = false;
  const original = f.renderer.compileAsync;
  f.renderer.compileAsync = async (...args: any[]) => { await original(...args); f.nativeProperties.delete(f.surface); };
  await expect(f.fx.prepare(f.renderer, {}, f.target, [f.template])).rejects.toThrow('material was not compiled');
  expect(f.nativeProperties.has(f.surface)).toBe(false); expect(f.events.some(e => e.startsWith('uniforms:'))).toBe(false);
  expect(f.current()).toBe(f.previous); expect(f.template.parent).toBeNull();
});

test('unexpected program API fails closed and restores the target and templates', async () => {
  const f = fixture(); f.renderer.shadowMap.enabled = false;
  const original = f.renderer.compileAsync;
  f.renderer.compileAsync = async (...args: any[]) => { await original(...args); if (f.programs.has('loot')) delete f.programs.get('loot').getAttributes; };
  await expect(f.fx.prepare(f.renderer, {}, f.target, [f.template])).rejects.toThrow('program reflection is unavailable');
  expect(f.current()).toBe(f.previous); expect(f.template.parent).toBeNull();
});

test('native compile failure detaches templates without disposing shared resources', async () => {
  const f = fixture(); let disposed = 0;
  f.geometry.addEventListener('dispose', () => disposed++); f.surface.addEventListener('dispose', () => disposed++);
  f.renderer.compileAsync = async () => { throw Error('fixture compile failed'); };
  await expect(f.fx.prepare(f.renderer, {}, f.target, [f.template])).rejects.toThrow('fixture compile failed');
  expect(f.current()).toBe(f.previous); expect(f.template.parent).toBeNull(); expect(disposed).toBe(0);
});

test('context loss aborts readiness as device loss and never reflects an invalid program', async () => {
  const f = fixture(); f.renderer.shadowMap.enabled = false; f.setLost(true);
  await expect(f.fx.prepare(f.renderer, {}, f.target, [f.template])).rejects.toThrow('context lost');
  expect(f.events.some(e => e.startsWith('link:') || e.startsWith('uniforms:'))).toBe(false);
  expect(f.current()).toBe(f.previous); expect(f.template.parent).toBeNull();
});

test('a live failed link rejects stage readiness before reflection and restores all borrowed state', async () => {
  const f = fixture(); f.renderer.shadowMap.enabled = false; f.setLinked(false);
  await expect(f.fx.prepare(f.renderer, {}, f.target, [f.template])).rejects.toThrow('fixture shader link failed');
  expect(f.events.filter(e => e.startsWith('link:'))).toEqual(['link:loot']);
  expect(f.events.some(e => e.startsWith('uniforms:') || e.startsWith('attributes:'))).toBe(false);
  expect(f.current()).toBe(f.previous); expect(f.template.parent).toBeNull();
});

test('cancellation before the initial loader frame prevents FX priming and compilation', async () => {
  const f = fixture(); f.fx._primed = false; let valid = true;
  const preparing = f.fx.prepare(f.renderer, {}, f.target, [f.template], [f.template], () => valid);
  valid = false;
  expect(await preparing).toBe(false); expect(f.fx._primed).toBe(false); expect(f.events).toEqual([]);
  expect(f.current()).toBe(f.previous); expect(f.template.parent).toBeNull();
});

test('stopping during compile prevents reflection and never resurrects borrowed templates', async () => {
  const f = fixture(), previousOwner = new THREE.Group(); previousOwner.add(f.template);
  const preparing = f.fx.prepare(f.renderer, {}, f.target, [f.template], [f.template]);
  await f.untilHeld(); f.fx._disposed = true; f.template.removeFromParent(); f.release();
  expect(await preparing).toBe(false); expect(f.events.some(e => e.startsWith('link:') || e.startsWith('uniforms:'))).toBe(false);
  expect(f.current()).toBe(f.previous); expect(f.template.parent).toBeNull(); expect(previousOwner.children).toEqual([]);
});

test('cancellation between loader frames aborts targeted readiness before native reflection', async () => {
  const f = fixture(); let valid = true, rafs = 0;
  const original = root.requestAnimationFrame;
  root.requestAnimationFrame = (fn: any) => original((time: number) => { if (++rafs === 2) valid = false; fn(time); });
  const preparing = f.fx.prepare(f.renderer, {}, f.target, [f.template], [f.template, f.hazards], () => valid);
  await f.untilHeld(); f.release();
  expect(await preparing).toBe(false); expect(f.events.some(e => e.startsWith('link:') || e.startsWith('uniforms:'))).toBe(false);
  expect(f.current()).toBe(f.previous); expect(f.template.parent).toBeNull(); expect(f.hazards.parent).toBe(f.fx.scene);
});

test('context lost during link query is device loss rather than a shader failure', async () => {
  const f = fixture(); f.renderer.shadowMap.enabled = false;
  f.renderer.getContext().getProgramParameter = () => { f.setLost(true); return false; };
  await expect(f.fx.prepare(f.renderer, {}, f.target, [f.template])).rejects.toThrow('context lost');
  expect(f.events.some(e => e.startsWith('uniforms:') || e.startsWith('attributes:'))).toBe(false);
  expect(f.current()).toBe(f.previous); expect(f.template.parent).toBeNull();
});

test('a superseded deferred preparation never reflects or clobbers the latest target, which restores the original once', async () => {
  const f = fixture(), replacementTarget = {}, laterTarget = {};
  f.renderer.shadowMap.enabled = false;
  const material = new THREE.MeshStandardMaterial(); material.name = 'replacement-loot';
  const replacement = new THREE.Mesh(f.geometry, material), waits: (() => void)[] = [];
  let compileCalls = 0, firstCurrent = true;
  f.renderer.compileAsync = async (scene: THREE.Scene) => {
    const call = ++compileCalls;
    expect(f.current()).toBe(call === 1 ? f.target : replacementTarget);
    scene.traverse((o: any) => {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m) continue;
        const key = m.name || m.type;
        if (!f.programs.has(key)) f.programs.set(key, { program: { key }, getUniforms: () => f.events.push(`uniforms:${key}`),
          getAttributes: () => f.events.push(`attributes:${key}`) });
        f.nativeProperties.set(m, { currentProgram: f.programs.get(key) });
      }
    });
    if (call <= 2) await new Promise<void>(resolve => waits.push(resolve));
  };
  const until = async (count: number) => { for (let i = 0; i < 30 && waits.length < count; i++) await Promise.resolve(); expect(waits).toHaveLength(count); };
  const first = f.fx.prepare(f.renderer, {}, f.target, [f.template], [f.template], () => firstCurrent);
  await until(1); firstCurrent = false;
  const second = f.fx.prepare(f.renderer, {}, replacementTarget, [replacement]);
  await until(2); waits[0]();
  expect(await first).toBe(false); expect(f.current()).toBe(replacementTarget);
  expect(f.events.some(e => e.startsWith('uniforms:'))).toBe(false); expect(f.template.parent).toBeNull();
  waits[1](); expect(await second).toBe(true); expect(f.current()).toBe(f.previous); expect(replacement.parent).toBeNull();
  expect(f.events.filter(e => e.startsWith('uniforms:'))).toEqual(['uniforms:replacement-loot']);
  // A subsequent preparation starts from the real original target, proving no
  // superseded ownership leaves a loading target stranded.
  f.renderer.compileAsync = async () => { expect(f.current()).toBe(laterTarget); };
  expect(await f.fx.prepare(f.renderer, {}, laterTarget)).toBe(true); expect(f.current()).toBe(f.previous);
});
