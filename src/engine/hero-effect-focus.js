import * as THREE from 'three';

// A weak registry lets a replacement focus owner rebind a surviving material
// without nesting the old shader hook or retaining disposed materials.
const bindings = new WeakMap();
const capsule = `
uniform vec4 heroFocus;
uniform vec2 heroFocusViewport;
float heroEffectFactor(vec2 uv) {
  if (heroFocus.z <= 0.0 || heroFocus.w <= 0.0) return 1.0;
  vec2 p = abs(uv - heroFocus.xy);
  p.y = max(0.0, p.y - heroFocus.w * .55);
  float d = length(p / vec2(heroFocus.z, heroFocus.w * .45));
  return mix(.04, 1.0, smoothstep(.78, 1.22, d));
}
`;

function extendMain(source, statement) {
  // Ignore comment braces while locating main's matching close. Appending to
  // the last brace would modify an unrelated helper declared after main.
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, comment => comment.replace(/[^\n]/g, ' '));
  const main = /\bvoid\s+main\s*\(\s*(?:void\s*)?\)\s*\{/.exec(code);
  if (!main) throw new Error('Hero effect focus requires a fragment main()');
  const open = code.indexOf('{', main.index);
  let depth = 1, close = open + 1;
  for (; close < code.length && depth; close++) {
    if (code[close] === '{') depth++;
    else if (code[close] === '}') depth--;
  }
  if (depth) throw new Error('Hero effect focus found an unbalanced fragment main()');
  close--;
  // Keep #version/precision and the original shader's declarations in place.
  return source.slice(0, main.index) + capsule + source.slice(main.index, close)
    + '\n' + statement + '\n' + source.slice(close);
}

/** One live-hero projection shared by additive FX and the existing bloom blend.
 * Owns no GPU targets, actors, geometry, textures or materials. */
export class HeroEffectFocus {
  constructor() {
    this.area = { value: new THREE.Vector4() };
    this.viewport = { value: new THREE.Vector2(1, 1) };
    this.target = null;
    this.bound = new WeakSet();
    this.foot = new THREE.Vector3(); this.head = new THREE.Vector3();
    this.center = new THREE.Vector3(); this.left = new THREE.Vector3(); this.right = new THREE.Vector3();
    this.view = new THREE.Vector3(); this.cameraRight = new THREE.Vector3();
  }
  setTarget(target) {
    this.target = target;
    // A replacement/dead/lobby actor cannot inherit the previous frame's mask.
    this.area.value.set(0, 0, 0, 0);
  }
  bind(material) {
    if (material?.blending !== THREE.AdditiveBlending || !material.transparent) return material;
    return this._bind(material, 'alpha');
  }
  bindBloom(bloom) {
    const material = bloom?.blendMaterial, uniforms = bloom?.copyUniforms;
    if (!material?.isShaderMaterial || !uniforms || material.blending !== THREE.AdditiveBlending) {
      throw new Error('Hero effect focus requires the existing additive bloom blendMaterial/copyUniforms');
    }
    uniforms.heroFocus = this.area; uniforms.heroFocusViewport = this.viewport;
    material.uniforms.heroFocus = this.area; material.uniforms.heroFocusViewport = this.viewport;
    this._bind(material, 'bloom-rgb');
    return bloom;
  }
  _bind(material, scope) {
    const prior = bindings.get(material);
    const intact = prior && material.onBeforeCompile === prior.hook && material.customProgramCacheKey === prior.cacheKey;
    if (intact && prior.owner === this && prior.scope === scope) return material;
    const original = intact ? prior.original : material.onBeforeCompile;
    const prefix = intact ? prior.prefix : material.customProgramCacheKey();
    const focus = this;
    const statement = scope === 'alpha'
      ? 'gl_FragColor.a *= heroEffectFactor(gl_FragCoord.xy / heroFocusViewport);'
      : 'gl_FragColor.rgb *= heroEffectFactor(vUv);';
    const hook = function(shader, renderer) {
      original.call(this, shader, renderer);
      shader.uniforms.heroFocus = focus.area;
      shader.uniforms.heroFocusViewport = focus.viewport;
      shader.fragmentShader = extendMain(shader.fragmentShader, statement);
    };
    const cacheKey = () => prefix + '|hero-effect-focus-v3:' + scope;
    material.onBeforeCompile = hook; material.customProgramCacheKey = cacheKey;
    material.needsUpdate = true;
    bindings.set(material, { owner: this, scope, original, prefix, hook, cacheKey });
    this.bound.add(material);
    return material;
  }
  update(renderer, camera) {
    this.area.value.set(0, 0, 0, 0);
    const p = this.target;
    if (!p?.alive || p.dead || p.disposed || !p.pos || ![p.pos.x, p.pos.y, p.pos.z].every(Number.isFinite)) return;
    renderer.getDrawingBufferSize(this.viewport.value);
    const size = this.viewport.value;
    if (!(size.x > 0 && size.y > 0) || ![size.x, size.y].every(Number.isFinite)) return;
    camera.updateMatrixWorld(true);
    this.view.copy(p.pos).applyMatrix4(camera.matrixWorldInverse);
    if (this.view.z >= -camera.near) return;
    const scale = Number.isFinite(p.scale) && p.scale > 0 ? p.scale : 1;
    this.foot.copy(p.pos); this.foot.y += .2 * scale; this.foot.project(camera);
    this.head.copy(p.pos); this.head.y += 2.4 * scale; this.head.project(camera);
    this.center.copy(p.pos); this.center.y += 1.2 * scale;
    this.cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
    this.left.copy(this.center).addScaledVector(this.cameraRight, -.5 * scale).project(camera);
    this.right.copy(this.center).addScaledVector(this.cameraRight, .5 * scale).project(camera);
    this.center.project(camera);
    if (![...this.foot.toArray(), ...this.head.toArray(), ...this.left.toArray(), ...this.right.toArray(), ...this.center.toArray()].every(Number.isFinite)
      || this.foot.z < -1 || this.foot.z > 1) return;
    const x = this.center.x * .5 + .5;
    const y = (this.foot.y + this.head.y) * .25 + .5;
    // Padding keeps the historical body rectangle inside the strong capsule,
    // with a short continuous transition to unchanged neighbouring effects.
    const width = Math.max(Math.abs(this.left.x - this.center.x), Math.abs(this.right.x - this.center.x)) * .5 * 1.6;
    const height = Math.abs(this.head.y - this.foot.y) * .25 * 1.4;
    const rx = Math.max(width, 2 / size.x), ry = Math.max(height, 2 / size.y);
    if (x + rx < 0 || x - rx > 1 || y + ry < 0 || y - ry > 1) return;
    this.area.value.set(x, y, rx, ry);
  }
}
