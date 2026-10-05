import { afterEach, beforeEach, expect, test } from 'bun:test';
import * as THREE from 'three';
import { FX } from '../src/engine/fx.js';

const root = globalThis as any;
let oldDocument: any, oldRaf: any, oldTimeout: any, oldClearTimeout: any, clock: ReturnType<typeof timerClock>;
async function flush() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
function timerClock() {
  let now = 0, serial = 0;
  const timers = new Map<number, { at: number; callback: () => void }>(), errors: any[] = [];
  return {
    errors, timers,
    set(callback: () => void, delay: number) { const id = ++serial; timers.set(id, { at: now + delay, callback }); return id; },
    clear(id: number) { timers.delete(id); },
    async advance(ms: number) {
      await flush(); const end = now + ms;
      while (true) {
        const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        const [id, timer] = next; now = timer.at; timers.delete(id);
        try { timer.callback(); } catch (error) { errors.push(error); }
        await flush();
      }
      now = end; await flush();
    },
  };
}
beforeEach(() => {
  oldDocument = root.document; oldRaf = root.requestAnimationFrame;
  oldTimeout = root.setTimeout; oldClearTimeout = root.clearTimeout;
  const gradient = { addColorStop() {} };
  const context = new Proxy({ createRadialGradient: () => gradient, createLinearGradient: () => gradient }, {
    get: (target: any, key) => target[key] ?? (() => {}),
  });
  root.document = { createElement: () => ({ getContext: () => context }) };
  root.requestAnimationFrame = (fn: any) => { queueMicrotask(() => fn(0)); return 1; };
  clock = timerClock(); root.setTimeout = (fn: any, ms: number) => clock.set(fn, ms);
  root.clearTimeout = (id: number) => clock.clear(id);
});
afterEach(() => {
  root.document = oldDocument; root.requestAnimationFrame = oldRaf;
  root.setTimeout = oldTimeout; root.clearTimeout = oldClearTimeout;
});

function observe(promise: Promise<any>) {
  const result = { done: false, value: undefined as any, error: undefined as any };
  promise.then(value => { result.value = value; result.done = true; }, error => { result.error = error; result.done = true; });
  return result;
}
async function finish(result: ReturnType<typeof observe>, ms = 60) {
  await clock.advance(ms); expect(result.done).toBe(true);
  expect(clock.errors).toEqual([]); expect(clock.timers.size).toBe(0);
  return result;
}

function fixture(holdPass = 3, parallel = false) {
  const fx: any = Object.create(FX.prototype);
  Object.assign(fx, { _primed: true, _mats: {}, _transparentMats: new Map(), _depthMats: new Map(),
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), plane1: new THREE.PlaneGeometry(1, 1) });
  const target = {}, previous = {}, events: string[] = [], nativeProperties = new Map<THREE.Material, any>();
  let current = previous, lost = false, linked = true, held = false, compileCalls = 0, missingGets = 0, nativeAsyncCalls = 0;
  const programs = new Map<string, any>(), listened = new Set<THREE.Material>();
  const programFor = (key: string) => {
    if (!programs.has(key)) programs.set(key, { program: { key },
      isReady: () => { events.push(`ready:${key}`); return !held; },
      getUniforms: () => { events.push(`uniforms:${key}`); },
      getAttributes: () => { events.push(`attributes:${key}`); } });
    return programs.get(key);
  };
  // Like r170 WebGLProperties.get, a missing read creates an empty record.
  // Material disposal removes it, reproducing the unsafe native timer case.
  const makeProperties = (records: Map<THREE.Material, any>) => ({
    has: (m: THREE.Material) => records.has(m),
    get: (m: THREE.Material) => { if (!records.has(m)) { missingGets++; records.set(m, {}); } return records.get(m); },
  });
  const gl = { LINK_STATUS: 0x8b82, isContextLost: () => lost,
    getProgramParameter: (p: any, parameter: number) => {
      expect(parameter).toBe(gl.LINK_STATUS); events.push(`link:${p.key}`); return linked;
    }, getProgramInfoLog: () => 'fixture shader link failed' };
  const renderer: any = { shadowMap: { enabled: true }, getRenderTarget: () => current,
    setRenderTarget: (value: any) => { current = value; }, initTexture() {}, getContext: () => gl,
    extensions: { get: (name: string) => { expect(name).toBe('KHR_parallel_shader_compile'); return parallel ? {} : null; } },
    properties: makeProperties(nativeProperties),
    compile: (scene: THREE.Scene, camera: THREE.Camera, targetScene: THREE.Scene | null = null) => {
      expect(camera).toBe(fx.camera); compileCalls++; events.push(`compile:${compileCalls}`);
      if (compileCalls === 2 && scene !== fx.scene) expect(targetScene).toBe(fx.scene);
      if (compileCalls === holdPass) held = true;
      const materials = new Set<THREE.Material>();
      // Match r170 compile's returned material set, including invisible meshes.
      scene.traverse((o: any) => {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m) continue; materials.add(m);
          const key = m.name || m.type, cache = nativeProperties.get(m)?.programs ?? new Map();
          let currentProgram;
          if (m.transparent && m.side === THREE.DoubleSide && m.forceSinglePass === false) {
            cache.set(`${key}:back`, programFor(`${key}:back`));
            currentProgram = programFor(`${key}:front`); cache.set(`${key}:front`, currentProgram);
          } else { currentProgram = programFor(key); cache.set(key, currentProgram); }
          nativeProperties.set(m, { programs: cache, currentProgram });
          if (!listened.has(m)) { listened.add(m); m.addEventListener('dispose', () => nativeProperties.delete(m)); }
        }
      });
      return materials;
    },
  };
  // Source-faithful r170 compileAsync polling: deliberately no catch/guard.
  // The production adapter must never call this vulnerable path.
  renderer.compileAsync = (scene: THREE.Scene, camera: THREE.Camera, targetScene: THREE.Scene | null = null) => {
    nativeAsyncCalls++; const materials = renderer.compile(scene, camera, targetScene);
    return new Promise(resolve => {
      const checkMaterialsReady = () => {
        materials.forEach((material: THREE.Material) => {
          if (renderer.properties.get(material).currentProgram.isReady()) materials.delete(material);
        });
        if (!materials.size) { resolve(scene); return; }
        setTimeout(checkMaterialsReady, 10);
      };
      if (renderer.extensions.get('KHR_parallel_shader_compile') !== null) checkMaterialsReady();
      else setTimeout(checkMaterialsReady, 10);
    });
  };
  const template = new THREE.Group(), geometry = new THREE.PlaneGeometry(1, 1);
  const surface = new THREE.MeshStandardMaterial(); surface.name = 'loot';
  for (let i = 0; i < 2; i++) { const mesh = new THREE.Mesh(geometry, surface); mesh.castShadow = true; template.add(mesh); }
  const hazards = new THREE.Group(), warning = new THREE.ShaderMaterial(); warning.name = 'warning';
  for (let i = 0; i < 6; i++) { const mesh = new THREE.Mesh(geometry, warning); mesh.visible = false; hazards.add(mesh); }
  fx.scene.add(hazards);
  const unrelated = new THREE.MeshStandardMaterial(); unrelated.name = 'unrelated'; fx.scene.add(new THREE.Mesh(geometry, unrelated));
  return { fx, renderer, template, hazards, geometry, surface, warning, unrelated, nativeProperties, programs, events, target, previous, programFor,
    current: () => current, release: () => { held = false; }, compileCalls: () => compileCalls,
    missingGets: () => missingGets, nativeAsyncCalls: () => nativeAsyncCalls,
    setLost: (value: boolean) => { lost = value; }, setLinked: (value: boolean) => { linked = value; },
    resetProperties: () => { renderer.properties = makeProperties(new Map()); },
    async untilHeld() { for (let i = 0; i < 4 && !held; i++) await clock.advance(10); expect(held).toBe(true); } };
}

test('the source-faithful native poll reproduces disposal before its first 10 ms check', async () => {
  const f = fixture(1); f.renderer.compileAsync(f.fx.scene, f.fx.camera); f.warning.dispose();
  await clock.advance(10);
  expect(clock.errors).toHaveLength(1); expect(clock.errors[0]).toBeInstanceOf(TypeError);
  expect(f.missingGets()).toBe(1); expect(clock.timers.size).toBe(0);
});

test('owned readiness awaits all three passes then reflects only the two requested signatures', async () => {
  const f = fixture(); let disposed = 0;
  f.geometry.addEventListener('dispose', () => disposed++); f.surface.addEventListener('dispose', () => disposed++);
  const result = observe(f.fx.prepare(f.renderer, {}, f.target, [f.template], [f.template, f.hazards]));
  await f.untilHeld(); expect(result.done).toBe(false); expect(f.events.some(e => e.startsWith('uniforms:'))).toBe(false);
  expect(f.hazards.parent).toBe(f.fx.scene); expect(f.hazards.children.every((o: THREE.Object3D) => !o.visible)).toBe(true);
  f.release(); await finish(result);
  expect(result.value).toBe(true); expect(result.error).toBeUndefined(); expect(f.compileCalls()).toBe(3); expect(f.nativeAsyncCalls()).toBe(0);
  expect(f.events.filter(e => e.startsWith('uniforms:'))).toEqual(['uniforms:loot', 'uniforms:warning']);
  expect(f.events.filter(e => e.startsWith('attributes:'))).toEqual(['attributes:loot', 'attributes:warning']);
  expect(f.events.filter(e => e.startsWith('link:'))).toEqual(['link:loot', 'link:warning']);
  expect(f.current()).toBe(f.previous); expect(f.template.parent).toBeNull(); expect(f.hazards.parent).toBe(f.fx.scene); expect(disposed).toBe(0);
});

test('the first check matches r170 extension scheduling with no extra warm render', async () => {
  for (const parallel of [false, true]) {
    const f = fixture(1, parallel); const result = observe(f.fx.prepare(f.renderer, {}, f.target));
    await clock.advance(0);
    expect(f.events.some(e => e.startsWith('ready:'))).toBe(parallel);
    await clock.advance(9); if (!parallel) expect(f.events.some(e => e.startsWith('ready:'))).toBe(false);
    await clock.advance(1); expect(f.events.some(e => e.startsWith('ready:'))).toBe(true);
    f.fx._disposed = true; await finish(result, 10); expect(result.value).toBe(false); expect(f.nativeAsyncCalls()).toBe(0);
  }
});

test('owned preparation compiles and reflects the player-only scene against its real target without a warm draw', async () => {
  const f = fixture(5), maskScene = new THREE.Scene(), maskTarget = {}, material = new THREE.MeshDepthMaterial();
  material.name = 'player-mask'; const object = new THREE.Mesh(f.geometry, material); object.visible = false; maskScene.add(object);
  const finalScene = new THREE.Scene(), finalTarget = {}, finalMaterial = new THREE.ShaderMaterial(); finalMaterial.name = 'player-final';
  finalScene.add(new THREE.Mesh(f.geometry, finalMaterial));
  let current = true;
  const mask = { scene: maskScene, target: maskTarget, readinessObjects: [maskScene], isCurrent: () => current };
  const final = { scene: finalScene, target: finalTarget, readinessObjects: [finalScene], isCurrent: () => current };
  const original = f.renderer.compile; let maskCompiled = false, finalCompiled = false;
  f.renderer.compile = (scene: THREE.Scene, camera: THREE.Camera, targetScene: THREE.Scene | null = null) => {
    if (scene === maskScene) { expect(f.current()).toBe(maskTarget); expect(targetScene).toBeNull(); maskCompiled = true; }
    if (scene === finalScene) { expect(f.current()).toBe(finalTarget); expect(targetScene).toBeNull(); finalCompiled = true; }
    return original(scene, camera, targetScene);
  };
  const result = observe(f.fx.prepare(f.renderer, {}, f.target, [f.template], [f.template, f.hazards], () => true, [mask, final]));
  await f.untilHeld(); expect(maskCompiled).toBe(true); expect(finalCompiled).toBe(true);
  expect(result.done).toBe(false); expect(f.current()).toBe(finalTarget);
  f.release(); await finish(result);
  expect(result.value).toBe(true); expect(result.error).toBeUndefined(); expect(f.compileCalls()).toBe(5);
  expect(f.events.filter(e => e.startsWith('uniforms:'))).toEqual(['uniforms:player-mask', 'uniforms:player-final', 'uniforms:loot', 'uniforms:warning']);
  expect(f.events.filter(e => e.startsWith('attributes:'))).toEqual(['attributes:player-mask', 'attributes:player-final', 'attributes:loot', 'attributes:warning']);
  expect(f.current()).toBe(f.previous); expect(f.nativeAsyncCalls()).toBe(0); expect(maskScene.children).toEqual([object]);
});

test('stopped or restored player-only target preparation settles before stale polls and restores the original target', async () => {
  for (const changedContext of [false, true]) {
    const f = fixture(4), maskScene = new THREE.Scene(), material = new THREE.MeshDepthMaterial(); material.name = 'player-mask';
    maskScene.add(new THREE.Mesh(f.geometry, material)); let current = true;
    const mask = { scene: maskScene, target: {}, readinessObjects: [maskScene], isCurrent: () => current };
    const result = observe(f.fx.prepare(f.renderer, {}, f.target, [], [], () => true, [mask]));
    await f.untilHeld(); current = false;
    if (changedContext) f.resetProperties(); material.dispose(); await finish(result, 10);
    expect(result.value).toBe(false); expect(result.error).toBeUndefined(); expect(f.missingGets()).toBe(0);
    expect(f.events.some(e => e === 'uniforms:player-mask' || e === 'attributes:player-mask')).toBe(false);
    expect(f.current()).toBe(f.previous); expect(f.nativeAsyncCalls()).toBe(0);
  }
});

test('default readiness deduplicates templates and restores their original parent', async () => {
  const f = fixture(0), owner = new THREE.Group(); owner.add(f.template);
  const result = observe(f.fx.prepare(f.renderer, {}, f.target, [f.template, f.template])); await finish(result);
  expect(result.value).toBe(true); expect(f.events.filter(e => e.startsWith('uniforms:'))).toEqual(['uniforms:loot']);
  expect(f.template.parent).toBe(owner); expect(owner.children).toEqual([f.template]); expect(f.current()).toBe(f.previous);
});

test('canceling and disposing a compiled material before the poll settles without any native query', async () => {
  const f = fixture(1), owner = new THREE.Group(); owner.add(f.template); let valid = true;
  const result = observe(f.fx.prepare(f.renderer, {}, f.target, [f.template], [f.template, f.hazards], () => valid));
  await clock.advance(0); valid = false; f.warning.dispose(); f.template.removeFromParent();
  await finish(result, 10);
  expect(result.value).toBe(false); expect(result.error).toBeUndefined(); expect(f.events.filter(e => e.startsWith('ready:'))).toEqual([]);
  expect(f.missingGets()).toBe(0); expect(f.template.parent).toBeNull(); expect(owner.children).toEqual([]); expect(f.current()).toBe(f.previous);
});

test('a disposed material with a still-current caller rejects cleanly before recreating properties', async () => {
  const f = fixture(1); const result = observe(f.fx.prepare(f.renderer, {}, f.target, [f.template]));
  await clock.advance(0); f.warning.dispose(); await finish(result, 10);
  expect(result.error?.message).toContain('disposed or replaced'); expect(f.missingGets()).toBe(0);
  expect(f.events.some(e => e.startsWith('ready:') || e.startsWith('link:'))).toBe(false); expect(f.current()).toBe(f.previous);
});

test('context loss or restored renderer properties abort polling without stale program queries', async () => {
  for (const reset of [false, true]) {
    const f = fixture(1); const result = observe(f.fx.prepare(f.renderer, {}, f.target, [f.template]));
    await clock.advance(0); if (reset) f.resetProperties(); else f.setLost(true);
    await finish(result, 10); expect(result.error?.message).toContain(reset ? 'renderer state changed' : 'context lost');
    expect(f.events.some(e => e.startsWith('ready:') || e.startsWith('link:'))).toBe(false); expect(f.missingGets()).toBe(0);
    expect(f.current()).toBe(f.previous); expect(f.template.parent).toBeNull();
  }
});

test('program replacement before a poll and disposal during isReady are both caught', async () => {
  for (const during of [false, true]) {
    const f = fixture(1); const result = observe(f.fx.prepare(f.renderer, {}, f.target, [f.template]));
    await clock.advance(0);
    if (during) f.programs.get('warning').isReady = () => { f.warning.dispose(); return true; };
    else f.nativeProperties.get(f.warning).currentProgram = f.programFor('replacement');
    await finish(result, 10); expect(result.error?.message).toContain('disposed or replaced'); expect(f.missingGets()).toBe(0);
    expect(f.events.some(e => e.startsWith('link:') || e.startsWith('uniforms:'))).toBe(false);
  }
});

test('compile exceptions, unavailable readiness APIs and poll exceptions reject with complete cleanup', async () => {
  for (const failure of ['compile', 'api', 'poll']) {
    const f = fixture(0); const original = f.renderer.compile;
    f.renderer.compile = (...args: any[]) => {
      if (failure === 'compile') throw Error('fixture compile failed');
      const materials = original(...args);
      if (failure === 'api') delete f.programs.get('warning').isReady;
      if (failure === 'poll') f.programs.get('warning').isReady = () => { throw Error('fixture poll failed'); };
      return materials;
    };
    const result = observe(f.fx.prepare(f.renderer, {}, f.target, [f.template])); await finish(result);
    expect(result.error?.message).toContain(failure === 'api' ? 'readiness is unavailable' : `fixture ${failure} failed`);
    expect(f.current()).toBe(f.previous); expect(f.template.parent).toBeNull();
  }
});

test('a never-ready captured program times out at 30 seconds and clears both timers', async () => {
  const f = fixture(1); const result = observe(f.fx.prepare(f.renderer, {}, f.target, [f.template]));
  await clock.advance(29999); expect(result.done).toBe(false); expect(clock.timers.size).toBe(2);
  await finish(result, 1); expect(result.error?.message).toBe('render preparation timeout');
  expect(f.current()).toBe(f.previous); expect(f.template.parent).toBeNull();
  const calls = f.events.length; await clock.advance(100); expect(f.events).toHaveLength(calls);
});

test('missing requested material and unsupported reflection API fail closed', async () => {
  for (const missing of [false, true]) {
    const f = fixture(0); f.renderer.shadowMap.enabled = false;
    const original = root.requestAnimationFrame; let rafs = 0;
    const compile = f.renderer.compile;
    if (!missing) f.renderer.compile = (...args: any[]) => {
      const materials = compile(...args);
      if (f.programs.has('loot')) delete f.programs.get('loot').getAttributes;
      return materials;
    };
    root.requestAnimationFrame = (fn: any) => original((time: number) => {
      if (++rafs === 2 && missing) f.nativeProperties.delete(f.surface);
      fn(time);
    });
    const result = observe(f.fx.prepare(f.renderer, {}, f.target, [f.template])); await finish(result);
    expect(result.error?.message).toContain(missing ? 'disposed or replaced' : 'program reflection is unavailable');
    expect(f.missingGets()).toBe(0); expect(f.events.some(e => e.startsWith('uniforms:'))).toBe(false);
    expect(f.current()).toBe(f.previous); root.requestAnimationFrame = original;
  }
});

test('cancellation before the initial loader frame prevents priming and compilation', async () => {
  const f = fixture(0); f.fx._primed = false; let valid = true;
  const result = observe(f.fx.prepare(f.renderer, {}, f.target, [f.template], [f.template], () => valid)); valid = false;
  await finish(result); expect(result.value).toBe(false); expect(f.fx._primed).toBe(false); expect(f.events).toEqual([]);
  expect(f.current()).toBe(f.previous); expect(f.template.parent).toBeNull();
});

test('reflection rechecks cancellation and renderer ownership after each loading frame', async () => {
  for (const failure of ['cancel', 'reset', 'replace']) {
    const f = fixture(0); f.renderer.shadowMap.enabled = false; let valid = true, rafs = 0;
    const original = root.requestAnimationFrame;
    root.requestAnimationFrame = (fn: any) => original((time: number) => {
      if (++rafs === 3) {
        if (failure === 'cancel') valid = false;
        else if (failure === 'reset') f.resetProperties();
        else f.nativeProperties.get(f.warning).currentProgram = f.programFor('replacement-warning');
      }
      fn(time);
    });
    const result = observe(f.fx.prepare(f.renderer, {}, f.target, [f.template], [f.template, f.hazards], () => valid)); await finish(result);
    if (failure === 'cancel') expect(result.value).toBe(false);
    else expect(result.error?.message).toContain(failure === 'reset' ? 'renderer state changed' : 'disposed or replaced');
    expect(f.events.filter(e => e.startsWith('uniforms:'))).toEqual(['uniforms:loot']);
    expect(f.events.filter(e => e.startsWith('link:'))).toEqual(['link:loot']);
    expect(f.missingGets()).toBe(0); expect(f.current()).toBe(f.previous); root.requestAnimationFrame = original;
  }
});

test('live link failure and context loss during its query never reflect invalid programs', async () => {
  for (const lose of [false, true]) {
    const f = fixture(0); f.renderer.shadowMap.enabled = false;
    if (lose) f.renderer.getContext().getProgramParameter = () => { f.setLost(true); return false; }; else f.setLinked(false);
    const result = observe(f.fx.prepare(f.renderer, {}, f.target, [f.template])); await finish(result);
    expect(result.error?.message).toContain(lose ? 'context lost' : 'fixture shader link failed');
    expect(f.events.some(e => e.startsWith('uniforms:') || e.startsWith('attributes:'))).toBe(false);
    expect(f.current()).toBe(f.previous); expect(f.template.parent).toBeNull();
  }
});

test('overlapping preparations leave the new target owned until it restores the original once', async () => {
  const f = fixture(1), replacementTarget = {}, laterTarget = {}; f.renderer.shadowMap.enabled = false;
  const material = new THREE.MeshStandardMaterial(); material.name = 'replacement-loot';
  const replacement = new THREE.Mesh(f.geometry, material); let firstCurrent = true;
  const first = observe(f.fx.prepare(f.renderer, {}, f.target, [f.template], [f.template], () => firstCurrent));
  await clock.advance(0); expect(f.current()).toBe(f.target); firstCurrent = false;
  const second = observe(f.fx.prepare(f.renderer, {}, replacementTarget, [replacement]));
  await clock.advance(10); expect(first.value).toBe(false); expect(second.done).toBe(false); expect(f.current()).toBe(replacementTarget);
  expect(f.events.some(e => e.startsWith('uniforms:'))).toBe(false); expect(f.template.parent).toBeNull();
  f.release(); await finish(second); expect(second.value).toBe(true); expect(f.current()).toBe(f.previous); expect(replacement.parent).toBeNull();
  expect(f.events.filter(e => e.startsWith('uniforms:'))).toEqual(['uniforms:replacement-loot']);
  const later = observe(f.fx.prepare(f.renderer, {}, laterTarget)); await finish(later); expect(later.value).toBe(true); expect(f.current()).toBe(f.previous);
});

test('disabled compiled reflection keeps the original narrow readiness scope', async () => {
  const f = fixture(0); f.renderer.shadowMap.enabled = false;
  const result = observe(f.fx.prepare(f.renderer, {}, f.target, [f.template], [f.template, f.hazards], () => true, [], { reflectCompiledPrograms: false }));
  await finish(result); expect(result.value).toBe(true);
  expect(f.events.filter(e => e.startsWith('uniforms:'))).toEqual(['uniforms:loot', 'uniforms:warning']);
  expect(f.events).not.toContain('uniforms:unrelated'); expect(f.compileCalls()).toBe(2);
});

test('compiled reflection includes cached back and front and deduplicates shared acquired handles', async () => {
  const f = fixture(0); f.renderer.shadowMap.enabled = false;
  const material = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, forceSinglePass: false });
  material.name = 'ribbon'; const alias = material.clone(); alias.name = 'ribbon';
  f.fx.scene.add(new THREE.Mesh(f.geometry, material), new THREE.Mesh(f.geometry, alias));
  f.template.add(new THREE.Mesh(f.geometry, material));
  const back = f.programFor('ribbon:back');
  back.isReady = () => {
    f.events.push('ready:ribbon:back');
    // 실제 캐시에 남은 back은 마지막 currentProgram이 아니어도 유효하다.
    f.nativeProperties.get(material).currentProgram = back;
    return true;
  };
  const result = observe(f.fx.prepare(f.renderer, {}, f.target, [f.template], [], () => true, [], { reflectCompiledPrograms: true }));
  await finish(result); expect(result.value).toBe(true); expect(result.error).toBeUndefined();
  for (const key of ['warning', 'unrelated', 'loot', 'ribbon:back', 'ribbon:front']) {
    expect(f.events.filter(e => e === `uniforms:${key}`)).toHaveLength(1);
    expect(f.events.filter(e => e === `attributes:${key}`)).toHaveLength(1);
    expect(f.events.filter(e => e === `link:${key}`)).toHaveLength(1);
  }
  expect(f.events).toContain('ready:ribbon:back'); expect(f.events).toContain('ready:ribbon:front');
  expect(f.compileCalls()).toBe(2); expect(f.current()).toBe(f.previous);
});

test('a non-current cached back program must become ready within the existing deadline', async () => {
  const f = fixture(0); f.renderer.shadowMap.enabled = false;
  const material = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, forceSinglePass: false });
  material.name = 'ribbon'; f.fx.scene.add(new THREE.Mesh(f.geometry, material));
  f.programFor('ribbon:back').isReady = () => false;
  const result = observe(f.fx.prepare(f.renderer, {}, f.target, [], [], () => true, [], { reflectCompiledPrograms: true }));
  await clock.advance(29999); expect(result.done).toBe(false);
  await finish(result, 1); expect(result.error?.message).toBe('render preparation timeout');
  expect(f.events.some(e => e.startsWith('uniforms:'))).toBe(false); expect(f.current()).toBe(f.previous);
});

test('compiled reflection rejects disposed material, replaced cache/key/handle and lost renderer before native queries', async () => {
  for (const failure of ['dispose', 'map', 'key', 'program', 'handle', 'context', 'properties']) {
    const f = fixture(0); f.renderer.shadowMap.enabled = false;
    const original = root.requestAnimationFrame; let rafs = 0;
    root.requestAnimationFrame = (fn: any) => original((time: number) => {
      if (++rafs === 2) {
        const record = f.nativeProperties.get(f.warning);
        if (failure === 'dispose') f.warning.dispose();
        else if (failure === 'map') record.programs = new Map(record.programs);
        else if (failure === 'key') record.programs.delete('warning');
        else if (failure === 'program') record.programs.set('warning', f.programFor('replacement'));
        else if (failure === 'handle') f.programFor('warning').program = { key: 'changed-native-handle' };
        else if (failure === 'context') f.setLost(true);
        else f.resetProperties();
      }
      fn(time);
    });
    const result = observe(f.fx.prepare(f.renderer, {}, f.target, [], [], () => true, [], { reflectCompiledPrograms: true }));
    await finish(result);
    expect(result.error?.message).toContain(failure === 'context' ? 'context lost' : failure === 'properties' ? 'renderer state changed' : 'disposed or replaced');
    expect(f.events.some(e => e.startsWith('link:') || e.startsWith('uniforms:'))).toBe(false);
    expect(f.missingGets()).toBe(0); expect(f.current()).toBe(f.previous); root.requestAnimationFrame = original;
  }
});

test('compiled reflection honors live cancellation after the loading frame and after uniform reflection', async () => {
  for (const duringUniforms of [false, true]) {
    const f = fixture(0); f.renderer.shadowMap.enabled = false; let valid = true;
    const original = root.requestAnimationFrame; let rafs = 0;
    if (duringUniforms) f.programFor('warning').getUniforms = () => { f.events.push('uniforms:warning'); valid = false; };
    else root.requestAnimationFrame = (fn: any) => original((time: number) => { if (++rafs === 2) valid = false; fn(time); });
    const result = observe(f.fx.prepare(f.renderer, {}, f.target, [], [], () => valid, [], { reflectCompiledPrograms: true }));
    await finish(result); expect(result.value).toBe(false); expect(result.error).toBeUndefined();
    expect(f.events.some(e => e.startsWith('attributes:'))).toBe(false);
    expect(f.events.filter(e => e.startsWith('uniforms:'))).toEqual(duringUniforms ? ['uniforms:warning'] : []);
    expect(f.current()).toBe(f.previous); expect(f.missingGets()).toBe(0); root.requestAnimationFrame = original;
  }
});

test('compiled reflection rechecks cache lifetime after link, uniforms and attributes', async () => {
  for (const point of ['link', 'uniforms', 'attributes']) {
    const f = fixture(0); f.renderer.shadowMap.enabled = false;
    const replace = () => { const record = f.nativeProperties.get(f.warning); record.programs = new Map(record.programs); };
    if (point === 'link') {
      const native = f.renderer.getContext().getProgramParameter;
      f.renderer.getContext().getProgramParameter = (...args: any[]) => { const result = native(...args); replace(); return result; };
    } else f.programFor('warning')[point === 'uniforms' ? 'getUniforms' : 'getAttributes'] = () => { f.events.push(`${point}:warning`); replace(); };
    const result = observe(f.fx.prepare(f.renderer, {}, f.target, [], [], () => true, [], { reflectCompiledPrograms: true }));
    await finish(result); expect(result.error?.message).toContain('disposed or replaced');
    if (point === 'link') expect(f.events.some(e => e.startsWith('uniforms:'))).toBe(false);
    if (point !== 'attributes') expect(f.events.some(e => e.startsWith('attributes:'))).toBe(false);
    expect(f.missingGets()).toBe(0); expect(f.current()).toBe(f.previous);
  }
});

test('compiled reflection still rejects uncompiled and replaced explicitly requested materials', async () => {
  for (const replacement of [false, true]) {
    const f = fixture(0); f.renderer.shadowMap.enabled = false;
    const missing = new THREE.Mesh(f.geometry, new THREE.MeshStandardMaterial());
    const original = root.requestAnimationFrame; let rafs = 0;
    if (replacement) root.requestAnimationFrame = (fn: any) => original((time: number) => {
      if (++rafs === 2) (f.hazards.children[0] as THREE.Mesh).material = missing.material;
      fn(time);
    });
    const result = observe(f.fx.prepare(f.renderer, {}, f.target, [], [replacement ? f.hazards : missing], () => true, [], { reflectCompiledPrograms: true }));
    await finish(result); expect(result.error?.message).toContain('requested material was not compiled');
    expect(f.events.some(e => e.startsWith('uniforms:'))).toBe(false);
    expect(f.missingGets()).toBe(0); expect(f.current()).toBe(f.previous); root.requestAnimationFrame = original;
  }
});

test('compiled reflection binds requested target materials to their own compile pass', async () => {
  const f = fixture(0); f.renderer.shadowMap.enabled = false;
  const scene = new THREE.Scene(), material = new THREE.MeshDepthMaterial(); material.name = 'player-mask';
  scene.add(new THREE.Mesh(f.geometry, material));
  // 메인에서 컴파일됐어도 별도 타깃에 없는 요청은 성공으로 처리하지 않는다.
  const target = { scene, target: {}, readinessObjects: [f.hazards], isCurrent: () => true };
  const result = observe(f.fx.prepare(f.renderer, {}, f.target, [], [], () => true, [target], { reflectCompiledPrograms: true }));
  await finish(result); expect(result.error?.message).toContain('requested material was not compiled for its target');
  expect(f.events.some(e => e.startsWith('uniforms:'))).toBe(false); expect(f.current()).toBe(f.previous);
});

test('compiled reflection aborts context loss during uniforms before attributes or further programs', async () => {
  const f = fixture(0); f.renderer.shadowMap.enabled = false;
  f.programFor('warning').getUniforms = () => { f.events.push('uniforms:warning'); f.setLost(true); };
  const result = observe(f.fx.prepare(f.renderer, {}, f.target, [], [], () => true, [], { reflectCompiledPrograms: true }));
  await finish(result); expect(result.error?.message).toContain('context lost');
  expect(f.events.filter(e => e.startsWith('uniforms:'))).toEqual(['uniforms:warning']);
  expect(f.events.some(e => e.startsWith('attributes:'))).toBe(false); expect(f.current()).toBe(f.previous);
});

test('compiled reflection covers the existing main, warm, shadow, mask and final passes without adding a compile', async () => {
  const f = fixture(5), maskScene = new THREE.Scene(), finalScene = new THREE.Scene();
  const maskMaterial = new THREE.MeshDepthMaterial(); maskMaterial.name = 'player-mask';
  const finalMaterial = new THREE.ShaderMaterial(); finalMaterial.name = 'player-final';
  maskScene.add(new THREE.Mesh(f.geometry, maskMaterial)); finalScene.add(new THREE.Mesh(f.geometry, finalMaterial));
  const targets = [
    { scene: maskScene, target: {}, readinessObjects: [maskScene], isCurrent: () => true },
    { scene: finalScene, target: {}, readinessObjects: [finalScene], isCurrent: () => true },
  ];
  const result = observe(f.fx.prepare(f.renderer, {}, f.target, [f.template], [f.template, f.hazards], () => true, targets, { reflectCompiledPrograms: true }));
  await f.untilHeld(); expect(result.done).toBe(false); expect(f.events.some(e => e.startsWith('uniforms:'))).toBe(false);
  f.release(); await finish(result); expect(result.value).toBe(true); expect(result.error).toBeUndefined();
  expect(f.compileCalls()).toBe(5); expect(f.nativeAsyncCalls()).toBe(0);
  for (const key of f.programs.keys()) expect(f.events.filter(e => e === `uniforms:${key}`)).toHaveLength(1);
  expect(f.current()).toBe(f.previous); expect(f.hazards.parent).toBe(f.fx.scene); expect(f.template.parent).toBeNull();
});
