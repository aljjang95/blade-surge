import * as THREE from 'three';

const SEGMENTS = 96;
function mesh(geometry, material) {
  const node = new THREE.Mesh(geometry, material);
  node.rotation.x = -Math.PI / 2; node.renderOrder = 12; node.frustumCulled = false;
  return node;
}

/** 판정과 분리된 조준 표시. 생성 때만 지오메트리/재질을 할당한다. */
export class SkillAimView {
  constructor(scene) {
    this.group = new THREE.Group(); this.group.name = 'skill-aim'; this.group.visible = false;
    this.material = new THREE.MeshBasicMaterial({ color: 0x5fe6ff, transparent: true, opacity: .65,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.fillMaterial = this.material.clone(); this.fillMaterial.opacity = .075;
    this.ring = mesh(new THREE.RingGeometry(.994, 1, SEGMENTS), this.material);
    this.disc = mesh(new THREE.CircleGeometry(1, SEGMENTS), this.fillMaterial);
    this.foot = mesh(new THREE.RingGeometry(.72, .79, 48), this.material);
    this.target = mesh(new THREE.RingGeometry(.98, 1, SEGMENTS), this.material);
    this.targetFill = mesh(new THREE.CircleGeometry(1, SEGMENTS), this.fillMaterial);
    this.direction = new THREE.Group();
    // 단위 레인: 테두리와 점선, 화살촉을 하나의 메시로 묶는다.
    const vertices = [];
    const quad = (x0, z0, x1, z1) => vertices.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z0, x1, 0, z1, x0, 0, z1);
    quad(-.5, 0, -.48, 1); quad(.48, 0, .5, 1); quad(-.5, 0, .5, .008);
    for (let i = 0; i < 10; i++) quad(-.012, i * .085, .012, i * .085 + .04);
    vertices.push(-.5, 0, .88, 0, 0, 1, -.03, 0, .88, .5, 0, .88, .03, 0, .88, 0, 0, 1);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    this.lane = new THREE.Mesh(geometry, this.material); this.lane.renderOrder = 12; this.lane.frustumCulled = false;
    this.laneFill = mesh(new THREE.PlaneGeometry(1, 1).translate(0, -.5, 0), this.fillMaterial);
    this.direction.add(this.lane, this.laneFill);
    // 최대 한 바퀴의 고정 버퍼에서 drawRange만 바꿔 부채꼴 각도를 선택한다.
    this.cone = mesh(new THREE.CircleGeometry(1, 360, 0, Math.PI * 2), this.fillMaterial);
    this.coneEdge = mesh(new THREE.RingGeometry(.985, 1, 360, 1, 0, Math.PI * 2), this.material);
    this.direction.add(this.cone, this.coneEdge);
    this.group.add(this.disc, this.ring, this.foot, this.direction, this.targetFill, this.target);
    scene.add(this.group);
  }
  update(player, aim, shape) {
    this.group.visible = !!player?.alive && !!aim?.active && !aim.cancel && !!shape;
    if (!this.group.visible) return;
    this.group.position.set(player.pos.x, player.pos.y + .09, player.pos.z);
    const distance = shape.range, origin = shape.origin || 0;
    this.ring.scale.setScalar(Math.max(.8, distance + origin));
    this.disc.scale.copy(this.ring.scale);
    this.direction.rotation.y = Math.atan2(aim.x, aim.z);
    const line = shape.kind === 'line', cone = shape.kind === 'cone', circle = shape.kind === 'circle';
    this.lane.visible = this.laneFill.visible = line || circle || !!shape.projectileRange;
    const length = circle ? distance * aim.dist01 : (shape.projectileRange || distance);
    const width = circle ? .32 : (shape.width || .3);
    this.lane.position.z = this.laneFill.position.z = origin;
    this.lane.scale.set(width, 1, Math.max(.001, length));
    this.laneFill.scale.set(width, Math.max(.001, length), 1);
    this.cone.visible = this.coneEdge.visible = cone;
    if (cone) {
      const angle = Math.min(360, Math.max(1, Math.round(shape.angle)));
      this.cone.geometry.setDrawRange(0, angle * 3);
      this.coneEdge.geometry.setDrawRange(0, angle * 6);
      this.cone.rotation.z = this.coneEdge.rotation.z = -Math.PI / 2 - angle * Math.PI / 360;
      this.cone.scale.setScalar(distance); this.coneEdge.scale.setScalar(distance);
    }
    this.target.visible = this.targetFill.visible = circle || (line && shape.radius > 0);
    if (this.target.visible) {
      const at = circle ? length : length + origin + (shape.endOffset || 0);
      this.target.position.set(aim.x * at, .012, aim.z * at);
      this.targetFill.position.copy(this.target.position);
      this.target.scale.setScalar(shape.radius); this.targetFill.scale.copy(this.target.scale);
    }
  }
  dispose() {
    this.group.removeFromParent();
    this.group.traverse(node => { if (node.isMesh) node.geometry.dispose(); });
    this.material.dispose(); this.fillMaterial.dispose();
  }
}
