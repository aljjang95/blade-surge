import * as THREE from 'three';
import { hazardVertexShader } from './region-hazards.js';
import { bossSignatureFragmentShader } from '../engine/boss-warn-shader.js';

/** 로컬 돌진과 파티 DTO가 같은 고정 통로를 표시한다. 전투 시계·피해는 Enemy가 소유한다.
 *  보스 예고 셰이더(고유기와 공용)로 그리고, Enemy가 매 프레임 setProgress 로 남은 시간 채움을 민다. */
export class EnemyDashWarning {
  constructor(scene, sharedMesh = null) {
    this.owned = !sharedMesh;
    this.mesh = sharedMesh || new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({ vertexShader: hazardVertexShader, fragmentShader: bossSignatureFragmentShader,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { color: { value: new THREE.Color(0xff3030) }, size: { value: new THREE.Vector2() },
          shape: { value: 2 }, safeRadius: { value: 0 }, opacity: { value: .8 }, fired: { value: 0 }, progress: { value: 0 }, arc: { value: 0 } } }));
    if (this.owned) { this.mesh.name = 'EnemyDashWarning'; this.mesh.renderOrder = 4; scene.add(this.mesh); }
    this.mesh.visible = false;
  }
  show(shape) {
    const mesh = this.mesh, u = mesh.material.uniforms;
    mesh.position.set(shape.x, .14, shape.z); mesh.rotation.y = -shape.angle; mesh.scale.set(shape.length, 1, shape.width);
    u.size.value.set(shape.length, shape.width); u.color.value.setHex(0xff3030);
    u.shape.value = 2; u.safeRadius.value = 0; u.fired.value = 0; u.opacity.value = .65; u.progress.value = 0;
    mesh.visible = true;
  }
  /** 남은 시간 채움(0→1). 끝나면(돌진 출발) 채움을 꽉 채운 채 유지해 지나갈 통로를 계속 보여 준다. */
  setProgress(value) {
    if (!this.mesh.visible) return;
    const u = this.mesh.material.uniforms, k = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    u.progress.value = k; u.opacity.value = .65 + .25 * k;
  }
  hide() { this.mesh.visible = false; }
  dispose() {
    this.hide();
    if (this.disposed) return;
    this.disposed = true;
    if (this.owned) { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
  }
}
