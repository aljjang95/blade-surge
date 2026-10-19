import * as THREE from 'three';

const SEGMENTS = 96;
const AIM_COLOR = new THREE.Color(0x5fe6ff);

// 원판(사거리·지점·부채꼴): 반지름이 커져도 테두리 두께가 월드 단위로 일정하고, 안쪽은 가장자리로 갈수록 밝아진다.
const DISC_VERTEX = 'varying vec2 vLocal; void main(){ vLocal = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const DISC_FRAGMENT = [
  'uniform vec3 uColor; uniform float uRadius; uniform float uEdge; uniform float uFill; uniform float uOpacity;',
  'varying vec2 vLocal;',
  'void main(){',
  '  float d = length(vLocal); if (d > 1.0) discard;',
  '  float fromEdge = (1.0 - d) * uRadius;',
  '  float rim = 1.0 - smoothstep(0.0, uEdge * .3, fromEdge);',
  '  float edge = 1.0 - smoothstep(uEdge * .55, uEdge, fromEdge);',
  '  float core = 1.0 - smoothstep(0.0, uEdge * .35, abs(fromEdge - uEdge * .5));',
  '  float fill = uFill * (.45 + .55 * d * d);',
  '  float a = max(edge * .95, fill);',
  '  vec3 c = mix(uColor, vec3(1.0), core * .6);',
  '  c = mix(c, vec3(.03, .2, .27), rim * .8);',
  '  gl_FragColor = vec4(c, a * uOpacity);',
  '}'].join('\n');

// 직선 레인: 폭·길이가 바뀌어도 테두리와 가운데 점선이 월드 단위로 일정하다.
const LANE_VERTEX = 'varying vec2 vLocal; void main(){ vLocal = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const LANE_FRAGMENT = [
  'uniform vec3 uColor; uniform float uWidth; uniform float uLength; uniform float uOpacity;',
  'varying vec2 vLocal;',
  'void main(){',
  '  float across = abs(vLocal.x) * uWidth; float along = -vLocal.y * uLength;',
  '  float half_ = uWidth * .5;',
  '  float rim = 1.0 - smoothstep(0.0, .06, half_ - across);',
  '  float edge = 1.0 - smoothstep(.1, .2, half_ - across);',
  '  float dash = (1.0 - smoothstep(.04, .08, across)) * step(.5, fract(along / .9));',
  '  float fill = .3 + .2 * (along / max(uLength, .001));',
  '  float a = max(max(edge, dash * .85), fill);',
  '  vec3 c = mix(uColor, vec3(1.0), max(edge * .55, dash * .9));',
  '  c = mix(c, vec3(.03, .2, .27), rim * .85);',
  '  gl_FragColor = vec4(c, a * uOpacity);',
  '}'].join('\n');

function discMaterial(fill) {
  return new THREE.ShaderMaterial({ vertexShader: DISC_VERTEX, fragmentShader: DISC_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    uniforms: { uColor: { value: AIM_COLOR }, uRadius: { value: 1 }, uEdge: { value: .2 }, uFill: { value: fill }, uOpacity: { value: 1 } } });
}

// 확률 띠(envelope): 확정 영역과 구분되도록 호박색 점선 테두리와 아주 옅은 채움만 그린다. 점선 길이는 월드 단위로 일정하다.
const ENVELOPE_COLOR = new THREE.Color(0xffc46b);
const ENVELOPE_FRAGMENT = [
  'uniform vec3 uColor; uniform float uRadius; uniform float uOpacity;',
  'varying vec2 vLocal;',
  'void main(){',
  '  float d = length(vLocal); if (d > 1.0) discard;',
  '  float fromEdge = (1.0 - d) * uRadius;',
  '  float rim = 1.0 - smoothstep(.1, .2, fromEdge);',
  '  float dash = step(.5, fract(atan(vLocal.y, vLocal.x) * uRadius / .8));',
  '  float a = max(rim * dash * .9, .07 + .05 * d * d);',
  '  gl_FragColor = vec4(mix(uColor, vec3(1.0), rim * dash * .35), a * uOpacity);',
  '}'].join('\n');
function envelopeMaterial() {
  return new THREE.ShaderMaterial({ vertexShader: DISC_VERTEX, fragmentShader: ENVELOPE_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    uniforms: { uColor: { value: ENVELOPE_COLOR }, uRadius: { value: 1 }, uOpacity: { value: 1 } } });
}
function flat(geometry, material) {
  const node = new THREE.Mesh(geometry, material);
  node.rotation.x = -Math.PI / 2; node.renderOrder = 12; node.frustumCulled = false;
  return node;
}

/** 판정과 분리된 조준 표시. 생성 때만 지오메트리/재질을 할당하고 update는 위치·크기·uniform 숫자만 바꾼다. */
export class SkillAimView {
  constructor(scene) {
    this.group = new THREE.Group(); this.group.name = 'skill-aim'; this.group.visible = false;
    this.rangeMaterial = discMaterial(.13);
    this.targetMaterial = discMaterial(.3);
    this.coneMaterial = discMaterial(.26);
    this.fanMaterial = discMaterial(.26);
    this.envelopeMaterial = envelopeMaterial();
    this.laneMaterial = new THREE.ShaderMaterial({ vertexShader: LANE_VERTEX, fragmentShader: LANE_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      uniforms: { uColor: { value: AIM_COLOR }, uWidth: { value: 1 }, uLength: { value: 1 }, uOpacity: { value: 1 } } });
    this.headMaterial = new THREE.MeshBasicMaterial({ color: 0xc8f8ff, transparent: true, opacity: .92, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.range = flat(new THREE.CircleGeometry(1, SEGMENTS), this.rangeMaterial);
    this.target = flat(new THREE.CircleGeometry(1, SEGMENTS), this.targetMaterial);
    // 확률로만 닿는 바깥 한계. 확정 영역(range/target)보다 아래에 그려 점선 띠만 바깥에 남는다.
    this.envelope = flat(new THREE.CircleGeometry(1, SEGMENTS), this.envelopeMaterial); this.envelope.renderOrder = 11; this.envelope.visible = false;
    this.direction = new THREE.Group();
    // 영웅에서 +z(조준 방향)로 뻗는 단위 레인과 화살촉
    this.lane = flat(new THREE.PlaneGeometry(1, 1).translate(0, -.5, 0), this.laneMaterial);
    const head = new THREE.BufferGeometry();
    head.setAttribute('position', new THREE.Float32BufferAttribute([-.5, 0, 0, .5, 0, 0, 0, 0, 1, -.5, 0, 0, -.32, 0, -.12, .32, 0, -.12, .5, 0, 0, -.5, 0, 0, .32, 0, -.12], 3));
    this.head = new THREE.Mesh(head, this.headMaterial); this.head.renderOrder = 13; this.head.frustumCulled = false;
    // 최대 한 바퀴의 고정 버퍼에서 drawRange만 바꿔 부채꼴 각도를 선택한다.
    this.cone = flat(new THREE.CircleGeometry(1, 360, 0, Math.PI * 2), this.coneMaterial);
    this.fan = flat(new THREE.CircleGeometry(1, 360, 0, Math.PI * 2), this.fanMaterial);
    this.direction.add(this.lane, this.head, this.cone, this.fan);
    this.group.add(this.envelope, this.range, this.direction, this.target);
    scene.add(this.group);
  }
  update(player, aim, shape) {
    this.group.visible = !!player?.alive && !!aim?.active && !aim.cancel && !!shape;
    if (!this.group.visible) return;
    this.group.position.set(player.pos.x, player.pos.y + .07, player.pos.z);
    const distance = shape.range, origin = shape.origin || 0, tip = shape.tip || 0;
    const reach = Math.max(.8, distance + origin + tip);
    this.range.scale.setScalar(reach); this.rangeMaterial.uniforms.uRadius.value = reach;
    this.rangeMaterial.uniforms.uEdge.value = Math.min(.32, .14 + reach * .008);
    this.direction.rotation.y = Math.atan2(aim.x, aim.z);
    const line = shape.kind === 'line', cone = shape.kind === 'cone', circle = shape.kind === 'circle';
    const showLane = line || circle || !!shape.projectileRange;
    const length = Math.max(.001, circle ? distance * aim.dist01 : (shape.projectileRange || distance));
    // 직선 투사체·돌진 몸통은 경로 끝에서 반경(tip)만큼 더 나아간다. 끝 원(target)은 경로 끝 기준 그대로 둔다.
    const laneLength = line ? length + tip : length;
    const width = circle ? .42 : Math.max(.7, shape.width || .3);
    this.lane.visible = showLane; this.head.visible = showLane && !circle;
    if (showLane) {
      this.lane.position.z = origin;
      this.lane.scale.set(width, laneLength, 1);
      this.laneMaterial.uniforms.uWidth.value = width; this.laneMaterial.uniforms.uLength.value = laneLength;
      const headWidth = Math.max(1.3, width * 1.45), headLength = Math.min(laneLength * .4, headWidth * .75);
      this.head.scale.set(headWidth, 1, headLength);
      this.head.position.set(0, .01, origin + laneLength - headLength * .35);
    }
    this.cone.visible = cone;
    if (cone) {
      const angle = Math.min(360, Math.max(1, Math.round(shape.angle)));
      this.cone.geometry.setDrawRange(0, angle * 3);
      this.cone.rotation.z = -Math.PI / 2 - angle * Math.PI / 360;
      // 화살 부채는 꼭짓점을 뒤로 물린 부채꼴(back)로 그려 각 화살 몸통이 훑는 바깥 선과 맞춘다.
      const coneRadius = shape.coneRadius || distance;
      this.cone.position.z = -(shape.back || 0);
      this.cone.scale.setScalar(coneRadius);
      this.coneMaterial.uniforms.uRadius.value = coneRadius; this.coneMaterial.uniforms.uEdge.value = .2;
    }
    const fan = shape.fanAngle > 0;
    this.fan.visible = fan;
    if (fan) {
      const angle = Math.min(360, Math.max(1, Math.round(shape.fanAngle)));
      this.fan.geometry.setDrawRange(0, angle * 3);
      this.fan.rotation.z = -Math.PI / 2 - angle * Math.PI / 360;
      this.fan.position.z = -shape.fanBack;
      this.fan.scale.setScalar(shape.fanRange);
      this.fanMaterial.uniforms.uRadius.value = shape.fanRange; this.fanMaterial.uniforms.uEdge.value = .2;
    }
    this.target.visible = circle || (line && shape.radius > 0);
    if (this.target.visible) {
      const at = circle ? length : length + origin + (shape.endOffset || 0);
      this.target.position.set(aim.x * at, .015, aim.z * at);
      this.target.scale.setScalar(shape.radius);
      this.targetMaterial.uniforms.uRadius.value = shape.radius; this.targetMaterial.uniforms.uEdge.value = .18;
    }
    // envelope: 확정 반지름보다 큰 값이 있을 때만 그린다. 지점형(circle)은 지점 중심, 자기 중심형(self)은 영웅 중심이다.
    const confirmed = circle ? shape.radius : Math.max(.8, distance + origin);
    this.envelope.visible = shape.envelope > confirmed;
    if (this.envelope.visible) {
      const cx = circle ? aim.x * length : 0, cz = circle ? aim.z * length : 0;
      this.envelope.position.set(cx, .005, cz);
      this.envelope.scale.setScalar(shape.envelope);
      this.envelopeMaterial.uniforms.uRadius.value = shape.envelope;
    }
  }
  dispose() {
    this.group.removeFromParent();
    this.group.traverse(node => { if (node.isMesh) node.geometry.dispose(); });
    for (const m of [this.rangeMaterial, this.targetMaterial, this.coneMaterial, this.fanMaterial, this.envelopeMaterial, this.laneMaterial, this.headMaterial]) m.dispose();
  }
}
