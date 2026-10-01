import * as THREE from 'three';

/** 기존 링의 텍스처·확대·페이드를 한 draw로 묶는다. 판정과 경고는 전투가 소유한다. */
export class RingPool {
  constructor(scene, geometry, texture, capacity = 256) {
    this.capacity = capacity;
    this.items = [];
    this.free = Array.from({ length: capacity }, () => ({ position: new THREE.Vector3(), rotation: new THREE.Quaternion(), color: new THREE.Color(), r0: 0, r1: 0, life: 0, thick: 1, age: 0, updated: false }));
    // 인스턴스 알파는 이 풀만 소유하고 FX의 공유 면은 수정하지 않는다.
    this.geometry = geometry.clone();
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.geometry.setAttribute('ringAlpha', this.alpha);
    this.material = new THREE.MeshBasicMaterial({ map: texture, color: 0xffffff,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    // 두께가 없는 면은 앞·뒷면 분리 패스 없이 같은 픽셀을 그릴 수 있다.
    this.material.forceSinglePass = true;
    this.material.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute float ringAlpha; varying float vRingAlpha;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRingAlpha = ringAlpha;');
      shader.fragmentShader = 'varying float vRingAlpha;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', 'diffuseColor.a *= vRingAlpha;\n#include <alphatest_fragment>');
    };
    this.material.customProgramCacheKey = () => 'pooled-ring-alpha-v1';
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.name = 'PooledImpactRings'; this.mesh.count = 0; this.mesh.visible = false;
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 9;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.alpha.setUsage(THREE.DynamicDrawUsage);
    this.uploadAttributes = [this.mesh.instanceMatrix, this.mesh.instanceColor, this.alpha];
    this.uploadRanges = this.uploadAttributes.map(() => ({ start: 0, count: 0 }));
    this.transform = new THREE.Object3D();
    this.scene = scene; this.dirty = false;
    this.previousBeforeRender = scene.onBeforeRender;
    this.beforeRender = (renderer, drawScene, camera, target) => {
      this.previousBeforeRender.call(scene, renderer, drawScene, camera, target);
      this.sync();
    };
    // 행렬과 GPU 전송은 실제 장면을 그릴 때만 계산한다. 시뮬레이션은 수명만 갱신한다.
    scene.onBeforeRender = this.beforeRender;
    scene.add(this.mesh);
  }
  emit(pos, color, { r0 = .3, r1 = 4, life = .45, y = .08, vertical = false, thick = 1 } = {}, camera) {
    if (this.disposed || !Number.isFinite(life) || life <= 0) return;
    const transform = this.transform;
    transform.position.copy(pos); transform.position.y += y;
    transform.rotation.set(0, 0, 0);
    if (vertical) transform.lookAt(camera.position); else transform.rotation.x = -Math.PI / 2;
    // 포화 시 가장 오래된 링을 재사용하며 게임 난수에는 관여하지 않는다.
    const ring = this.free.pop() || this.items.shift();
    ring.position.copy(transform.position); ring.rotation.copy(transform.quaternion); ring.color.set(color);
    ring.r0 = r0; ring.r1 = r1; ring.life = life; ring.thick = thick; ring.age = 0; ring.updated = false;
    this.items.push(ring);
    this.dirty = true; this.mesh.count = this.items.length; this.mesh.visible = true;
  }
  update(dt) {
    if (this.disposed || !this.items.length || !Number.isFinite(dt) || dt < 0) return;
    let active = 0;
    for (let i = 0; i < this.items.length; i++) {
      const ring = this.items[i]; ring.age += dt; ring.updated = true;
      if (ring.age >= ring.life) this.free.push(ring);
      else this.items[active++] = ring;
    }
    this.items.length = active;
    this.dirty = true; this.mesh.count = active; this.mesh.visible = active > 0;
  }
  sync() {
    if (this.disposed || !this.dirty) return;
    this.dirty = false;
    const t = this.transform;
    for (let i = 0; i < this.items.length; i++) {
      const ring = this.items[i], k = ring.age / ring.life;
      const r = ring.updated ? ring.r0 + (ring.r1 - ring.r0) * (1 - (1 - k) ** 3) : 1;
      t.position.copy(ring.position); t.quaternion.copy(ring.rotation); t.scale.set(r, r, ring.updated ? r * ring.thick : 1); t.updateMatrix();
      this.mesh.setMatrixAt(i, t.matrix); this.mesh.setColorAt(i, ring.color);
      this.alpha.setX(i, ring.updated ? (1 - k) * 1.2 : 1);
    }
    this.mesh.count = this.items.length; this.mesh.visible = this.items.length > 0;
    if (this.items.length) {
      this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; this.alpha.needsUpdate = true;
      for (let i = 0; i < this.uploadAttributes.length; i++) {
        const attribute = this.uploadAttributes[i], range = this.uploadRanges[i];
        range.count = this.items.length * attribute.itemSize;
        attribute.clearUpdateRanges(); attribute.updateRanges.push(range);
      }
    }
  }
  clear() { while (this.items.length) this.free.push(this.items.pop()); this.dirty = false; this.mesh.count = 0; this.mesh.visible = false; }
  warmObject() {
    const mesh = this.mesh.clone(); mesh.visible = true; mesh.count = 1; return mesh;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.clear(); this.mesh.removeFromParent();
    if (this.scene.onBeforeRender === this.beforeRender) this.scene.onBeforeRender = this.previousBeforeRender;
    this.mesh.dispose(); this.geometry.dispose(); this.material.dispose();
  }
}
