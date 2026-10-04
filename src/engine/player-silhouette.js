import * as THREE from 'three';

// 내 캐릭터의 현재 외곽만 합성한다. 벽 뒤에서도 이미 알고 있는 내 자세는
// 표시하지만, 월드 깊이나 다른 액터의 위치를 읽거나 공개하지 않는다.
export const PLAYER_SILHOUETTE_FRAGMENT = `
uniform sampler2D uPlayerMask;
uniform vec2 uPlayerOutlineStep;
uniform float uPlayerOutlineActive;
float playerNeighbour(vec2 uv, vec2 stepSize) {
  float m = texture2D(uPlayerMask, uv + vec2(stepSize.x, 0.0)).r;
  m = max(m, texture2D(uPlayerMask, uv - vec2(stepSize.x, 0.0)).r);
  m = max(m, texture2D(uPlayerMask, uv + vec2(0.0, stepSize.y)).r);
  m = max(m, texture2D(uPlayerMask, uv - vec2(0.0, stepSize.y)).r);
  vec2 diagonal = stepSize * .70710678;
  m = max(m, texture2D(uPlayerMask, uv + diagonal).r);
  m = max(m, texture2D(uPlayerMask, uv - diagonal).r);
  m = max(m, texture2D(uPlayerMask, uv + vec2(diagonal.x, -diagonal.y)).r);
  return max(m, texture2D(uPlayerMask, uv + vec2(-diagonal.x, diagonal.y)).r);
}
vec3 playerOutline(vec3 color, vec2 uv) {
  if (uPlayerOutlineActive < .5) return color;
  float outside = 1.0 - step(.5, texture2D(uPlayerMask, uv).r);
  float dark = outside * step(.5, playerNeighbour(uv, uPlayerOutlineStep));
  float light = outside * step(.5, playerNeighbour(uv, uPlayerOutlineStep * .5));
  color = mix(color, vec3(.012, .035, .041), dark * .92);
  return mix(color, vec3(.70, .95, .84), light * .94);
}
`;

function maskMaterial(source) {
  if (!source) return null;
  // 알파 구멍/변위/면 방향은 실제 장비와 같다. 색/조명/발광은 마스크에
  // 들어가지 않으며 원본 재질과 텍스처의 소유권은 캐릭터에게 남긴다.
  const material = new THREE.MeshDepthMaterial({
    toneMapped: false, depthTest: false, depthWrite: false,
    side: source.side, map: source.alphaTest > 0 || source.alphaMap || source.alphaHash ? source.map : null,
    alphaMap: source.alphaMap ?? null, alphaTest: source.alphaTest, alphaHash: source.alphaHash,
    displacementMap: source.displacementMap ?? null, displacementScale: source.displacementScale ?? 1,
    displacementBias: source.displacementBias ?? 0, wireframe: source.wireframe === true,
    clippingPlanes: source.clippingPlanes, clipIntersection: source.clipIntersection,
  });
  material.name = 'PlayerSilhouetteMask'; material.forceSinglePass = true;
  material.onBeforeCompile = shader => {
    // r170의 본/모프/변위/알파 셰이더를 그대로 쓰고 깊이 출력만 흰색으로 바꾼다.
    const output = 'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );';
    if (!shader.fragmentShader.includes(output)) throw new Error('player silhouette requires Three r170 depth shader');
    shader.fragmentShader = shader.fragmentShader.replace(output,
      'if (diffuseColor.a <= .001) discard;\ngl_FragColor = vec4(1.0);');
  };
  material.customProgramCacheKey = () => 'player-silhouette-mask-v1';
  return material;
}

function visibleInTree(object, model) {
  let inside = false;
  for (let parent = object; parent; parent = parent.parent) {
    if (!parent.visible) return false;
    if (parent === model) inside = true;
  }
  return inside;
}

/** 렌더러가 소유하는 단일 마스크. 프록시는 실제 버퍼/스켈레톤을 빌려
 * 현재 월드 행렬과 모프 가중치만 읽으며, 애니메이션/액터를 복제하지 않는다. */
export class PlayerSilhouette {
  /** @param {*} uniforms @param {*} [finalPass] */
  constructor(uniforms, finalPass = null) {
    this.uniforms = uniforms;
    this.scene = new THREE.Scene(); this.scene.name = 'PlayerSilhouetteOnly';
    this.entries = []; this.graph = []; this.actor = null; this.worldRoot = null;
    this.generation = 0; this.ready = false; this.disposed = false;
    this.clearColor = new THREE.Color(); this.viewport = new THREE.Vector4(); this.scissor = new THREE.Vector4();
    this.cssWidth = 1; this.cssHeight = 1; this.pixelRatio = 1;
    this.target = this._target(1, 1);
    this.uniforms.uPlayerMask.value = this.target.texture; this.uniforms.uPlayerOutlineActive.value = 0;
    this.compositeScene = null;
    if (finalPass) {
      const geometry = finalPass.fsQuad?._mesh?.geometry;
      if (!geometry || !finalPass.material) throw new Error('player silhouette requires Three r170 final fullscreen geometry');
      // 기존 마지막 패스의 버퍼/재질을 빌린 준비용 뷰다. 렌더하거나 dispose 하지 않는다.
      this.compositeScene = new THREE.Scene();
      this.compositeScene.add(new THREE.Mesh(geometry, finalPass.material));
    }
  }
  _target(width, height) {
    const target = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: false, stencilBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    target.texture.name = 'CurrentPlayerSilhouette';
    return target;
  }
  resize(width, height, pixelRatio) {
    this.cssWidth = Math.max(1, width); this.cssHeight = Math.max(1, height);
    this.pixelRatio = Math.min(1, Math.max(.01, pixelRatio));
    // DPR 2용 추가 타깃은 만들지 않고, 저품질의 기존 해상도를 올리지 않는다.
    this.target.setSize(Math.max(1, Math.floor(this.cssWidth * this.pixelRatio)),
      Math.max(1, Math.floor(this.cssHeight * this.pixelRatio)));
    // 가장 먼 샘플과 화면의 반 픽셀을 합쳐 2 CSS px 이내로 제한한다.
    const widthCss = Math.max(0, Math.min(1.35, 2 - .5 / this.pixelRatio));
    this.uniforms.uPlayerOutlineStep.value.set(widthCss / this.cssWidth, widthCss / this.cssHeight);
  }
  clearActor() {
    this.generation++; this.ready = false; this.actor = null; this.worldRoot = null; this.uniforms.uPlayerOutlineActive.value = 0;
    for (const entry of this.entries) {
      this.scene.remove(entry.proxy);
      for (const material of entry.materials) material?.dispose();
    }
    // 공유 지오메트리/본 텍스처/스켈레톤은 여기서 절대 dispose 하지 않는다.
    this.entries.length = 0;
    this.graph.length = 0;
  }
  preparation(renderer, actor, compositeTarget = null) {
    if (this.disposed || !actor?.model || actor.disposed) return null;
    this.clearActor(); this.actor = actor;
    this.worldRoot = actor.root; while (this.worldRoot.parent) this.worldRoot = this.worldRoot.parent;
    actor.model.traverse(source => {
      this.graph.push({ object: source, parent: source.parent, children: source.children.slice() });
      if (!source.isMesh || source.isInstancedMesh || source.isBatchedMesh) return;
      const sourceMaterials = Array.isArray(source.material) ? source.material.slice() : [source.material];
      const materials = sourceMaterials.map(maskMaterial);
      const proxy = source.isSkinnedMesh ? new THREE.SkinnedMesh(source.geometry, materials) : new THREE.Mesh(source.geometry, materials);
      // 단일 재질은 그룹 없는 지오메트리도 그린다. 배열 그룹 순서는 원본과 같다.
      if (!Array.isArray(source.material)) proxy.material = materials[0];
      proxy.name = 'PlayerSilhouette_' + source.name;
      proxy.matrixAutoUpdate = false; proxy.matrixWorldAutoUpdate = false;
      proxy.frustumCulled = false; proxy.castShadow = false; proxy.receiveShadow = false; proxy.visible = false;
      if (source.isSkinnedMesh) proxy.skeleton = source.skeleton;
      this.scene.add(proxy);
      this.entries.push({ source, proxy, materials, sourceMaterials, originalMaterial: source.material, geometry: source.geometry,
        clipCounts: sourceMaterials.map(material => material?.clippingPlanes?.length || 0) });
    });
    const generation = this.generation, context = renderer.getContext(), target = this.target;
    const isCurrent = () => !this.disposed && this.generation === generation && this.actor === actor
      && this.target === target && renderer.getContext() === context && !context.isContextLost();
    const mask = { scene: this.scene, target, readinessObjects: [this.scene], isCurrent };
    const targets = [mask];
    if (this.compositeScene) {
      if (!compositeTarget) throw new Error('player silhouette has no final linear render target');
      targets.push({ scene: this.compositeScene, target: compositeTarget, readinessObjects: [this.compositeScene], isCurrent });
    }
    return { ...mask, targets, complete: () => { if (!isCurrent()) return false; this.ready = true; return true; } };
  }
  contextLost() { this.generation++; this.ready = false; this.uniforms.uPlayerOutlineActive.value = 0; }
  restoreTarget() {
    this.contextLost(); this.target.dispose();
    this.target = this._target(1, 1); this.uniforms.uPlayerMask.value = this.target.texture;
    this.resize(this.cssWidth, this.cssHeight, this.pixelRatio);
  }
  _sync(camera) {
    const actor = this.actor;
    let worldRoot = actor.root; while (worldRoot.parent) worldRoot = worldRoot.parent;
    if (worldRoot !== this.worldRoot) return false;
    // 준비 뒤에 장비/서브트리가 교체되면 이전 실루엣을 추정해서 그리지 않는다.
    // 보임 토글은 아래에서 매 프레임 반영하고 새 버퍼는 다음 준비에서만 빌린다.
    for (const node of this.graph) {
      if (node.object.parent !== node.parent || node.object.children.length !== node.children.length) return false;
      for (let i = 0; i < node.children.length; i++) if (node.object.children[i] !== node.children[i]) return false;
    }
    // 본에 붙은 장비도 주 장면이 그릴 THISFRAME의 월드 행렬을 사용한다.
    actor.root.updateWorldMatrix(true, false); actor.root.updateMatrixWorld(true);
    let visible = 0;
    for (const entry of this.entries) {
      const { source, proxy, materials, sourceMaterials } = entry;
      if (source.geometry !== entry.geometry || source.material !== entry.originalMaterial) return false;
      const array = Array.isArray(source.material); let draws = false;
      for (let i = 0; i < materials.length; i++) {
        const original = array ? source.material[i] : source.material;
        if (original !== sourceMaterials[i]) return false;
        const material = materials[i]; if (!material) continue;
        // 셰이더 변형이 바뀐 장비를 전투 첫 프레임에 새로 컴파일하지 않는다.
        if (original.side !== material.side || original.alphaTest !== material.alphaTest || original.alphaHash !== material.alphaHash
          || (original.alphaMap ?? null) !== material.alphaMap
          || (original.alphaTest > 0 || original.alphaMap || original.alphaHash ? original.map : null) !== material.map
          || (original.displacementMap ?? null) !== material.displacementMap
          || (original.displacementScale ?? 1) !== material.displacementScale || (original.displacementBias ?? 0) !== material.displacementBias
          || original.clippingPlanes !== material.clippingPlanes || original.clipIntersection !== material.clipIntersection
          || (original.clippingPlanes?.length || 0) !== entry.clipCounts[i] || (original.wireframe === true) !== material.wireframe) return false;
        material.visible = original.visible !== false && original.colorWrite !== false && original.opacity > 0
          && original.blending !== THREE.AdditiveBlending;
        material.opacity = original.opacity;
        if (material.visible) draws = true;
      }
      proxy.visible = draws && visibleInTree(source, actor.model) && source.layers.test(camera.layers);
      if (!proxy.visible) continue;
      proxy.matrixWorld.copy(source.matrixWorld); proxy.matrixWorldNeedsUpdate = false;
      proxy.layers.mask = source.layers.mask;
      proxy.morphTargetInfluences = source.morphTargetInfluences;
      if (source.isSkinnedMesh) {
        proxy.skeleton = source.skeleton; proxy.bindMode = source.bindMode;
        proxy.bindMatrix.copy(source.bindMatrix); proxy.bindMatrixInverse.copy(source.bindMatrixInverse);
      }
      visible++;
    }
    return visible > 0;
  }
  render(renderer, camera, actor) {
    this.uniforms.uPlayerOutlineActive.value = 0;
    if (this.disposed || !this.ready || actor !== this.actor || !actor?.alive || actor.dead || actor.disposed
      || !actor.model?.parent || !actor.root?.parent || renderer.getContext().isContextLost()
      || this.uniforms.uPlayerOutlineStep.value.x <= 0) return;
    if (!this._sync(camera)) return;
    const previousTarget = renderer.getRenderTarget(), cube = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    // 현재 앱의 호출은 composer 앞의 화면 타깃이다. 별도 오프스크린 호출은
    // 추정한 뷰포트/가위 영역으로 그리지 않고 닫는다. GPU 상태 조회는 하지 않는다.
    if (previousTarget !== null) return;
    renderer.getViewport(this.viewport); renderer.getScissor(this.scissor);
    const scissorTest = renderer.getScissorTest();
    const autoClear = renderer.autoClear, clearAlpha = renderer.getClearAlpha(); renderer.getClearColor(this.clearColor);
    try {
      renderer.setRenderTarget(this.target); renderer.setClearColor(0, 0); renderer.autoClear = false;
      renderer.clear(true, false, false); renderer.render(this.scene, camera);
      this.uniforms.uPlayerOutlineActive.value = 1;
    } finally {
      try { renderer.setRenderTarget(previousTarget, cube, mip); }
      finally {
        renderer.setViewport(this.viewport); renderer.setScissor(this.scissor); renderer.setScissorTest(scissorTest);
        renderer.setClearColor(this.clearColor, clearAlpha); renderer.autoClear = autoClear;
      }
    }
  }
  dispose() {
    if (this.disposed) return;
    this.clearActor(); this.target.dispose(); this.disposed = true; this.uniforms.uPlayerMask.value = null;
    this.compositeScene?.clear();
  }
}
