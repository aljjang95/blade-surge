import * as THREE from 'three';

// 검성 성역(7초) 전용 연출: 경계 원(지면 1장) + 빛기둥 N개(병합 지오메트리 1장) = 드로우콜 2.
// 예전에는 금빛 마법진 2장 + 불기둥 8개(교차 2장씩 16) + 화면 섬광으로 시전 순간 화면 전체가 금빛으로 번졌다.
// 기둥은 가늘고(폭 .7m) 가로로 부드럽게 사그라들며, 하나씩 차례로 솟는다. 경계는 얇은 선 + 회전 눈금으로 '여기까지'를 읽게 한다.
// 가산 밝기는 낮게(기둥 정점 .85×가로 감쇠, 경계 .75) 두어 블룸 임계를 크게 넘지 않는다. 프레임마다 하는 일은 유니폼 갱신뿐이다.

export const SANCTUM = Object.freeze({ pillars: 8, pillarWidth: .7, pillarHeight: 5.2, rise: .34, stagger: .07, fadeIn: .3, fadeOut: 1, pillarPeak: .85, edgePeak: .75 });

const PILLAR_VERT = `
  attribute vec2 aPillar; uniform float uRadius, uTime, uWidth, uHeight, uRise, uStagger;
  varying vec2 vUv; varying float vRise;
  void main() {
    float ang = aPillar.x;
    vec4 base = modelMatrix * vec4(cos(ang) * uRadius, 0.0, sin(ang) * uRadius, 1.0);
    // 원통형 빌보드: 세로축은 월드 위, 가로는 카메라를 향하도록.
    vec3 toCam = cameraPosition - base.xyz; toCam.y = 0.0;
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam + vec3(1e-4, 0.0, 0.0)));
    float rise = smoothstep(0.0, 1.0, clamp((uTime - aPillar.y * uStagger) / uRise, 0.0, 1.0));
    vRise = rise;
    vec3 p = base.xyz + right * position.x * uWidth + vec3(0.0, position.y * uHeight * (0.25 + 0.75 * rise), 0.0);
    vUv = vec2(position.x * 2.0, position.y);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const PILLAR_FRAG = `
  uniform vec3 uColor; uniform float uAlpha, uTime, uPeak; varying vec2 vUv; varying float vRise;
  void main() {
    float x = vUv.x, v = vUv.y;
    float across = exp(-x * x * 5.5) * (1.0 - smoothstep(0.85, 1.0, abs(x)));
    float core = exp(-x * x * 40.0);
    // 아래가 진하고 위로 갈수록 옅다. 위로 흐르는 옅은 띠가 '성스러운 빛이 오르는' 느낌만 준다.
    float vert = pow(1.0 - v, 1.5) * smoothstep(0.0, 0.06, v);
    float bands = 0.82 + 0.18 * sin(v * 18.0 - uTime * 5.0);
    float a = (across * 0.7 + core * 0.3) * vert * bands * vRise * uAlpha * uPeak;
    if (a < 0.003) discard;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.35), a);
  }`;
const ZONE_VERT = `varying vec2 vUv; void main() { vUv = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ZONE_FRAG = `
  uniform vec3 uColor; uniform float uAlpha, uTime, uPeak; varying vec2 vUv;
  void main() {
    float r = length(vUv); if (r > 1.0) discard;
    float ang = atan(vUv.y, vUv.x);
    float edge = exp(-pow((r - 0.965) / 0.012, 2.0));
    // 경계 번짐은 좁고 옅게(예전 폭 .06·세기 .28 은 반경 8m 에서 50cm 넘는 복숭아빛 띠가 됐다).
    float halo = exp(-pow((r - 0.965) / 0.03, 2.0)) * 0.14;
    float inner = exp(-pow((r - 0.56) / 0.008, 2.0)) * 0.35;
    // 경계 안쪽을 천천히 도는 24개 눈금(룬 자리)
    float ticks = step(0.0, sin(ang * 24.0 + uTime * 0.6) - 0.82) * step(0.88, r) * step(r, 0.935) * 0.55;
    float fill = smoothstep(0.55, 0.97, r) * 0.05;
    float a = (edge + halo + inner + ticks + fill) * uAlpha * uPeak;
    if (a < 0.003) discard;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), edge * 0.1), a);
  }`;

let pillarGeometry = null, pillarCount = 0;
/** n 개의 기둥 사각형(가로 -.5~.5, 세로 0~1)을 한 지오메트리로 묶는다. aPillar = (각도, 솟는 순서). 모든 성역이 공유한다. */
export function sanctumPillarGeometry(n = SANCTUM.pillars) {
  if (pillarGeometry && pillarCount === n) return pillarGeometry;
  const pos = new Float32Array(n * 4 * 3), pil = new Float32Array(n * 4 * 2), idx = [];
  // 솟는 순서는 한 칸씩 건너뛰며 돈다(0,3,6,1,4,7,2,5): 원을 따라 빛이 번져 가는 박자.
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2, order = (i * 3) % n;
    const corners = [[-.5, 0], [.5, 0], [.5, 1], [-.5, 1]];
    corners.forEach(([x, y], c) => { const v = i * 4 + c; pos[v * 3] = x; pos[v * 3 + 1] = y; pil[v * 2] = ang; pil[v * 2 + 1] = order; });
    const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPillar', new THREE.BufferAttribute(pil, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3, 0), 30);
  pillarGeometry = g; pillarCount = n;
  return g;
}

/**
 * 성역 연출을 FX 수명 관리에 올린다. fx._keep 으로 준비 캐시에 등록해 첫 시전 끊김을 막는다.
 * @param {any} fx @param {THREE.Vector3} center
 * @param {{radius?: number, life?: number, color?: THREE.ColorRepresentation, pillars?: number, gain?: number}} [options]
 */
export function spawnSanctum(fx, center, { radius = 8, life = 7, color = 0xffc845, pillars = SANCTUM.pillars, gain = 1 } = {}) {
  const S = SANCTUM, t = { value: 0 }, alpha = { value: 0 };
  const col = new THREE.Color(color);
  const common = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide };
  const pillarMat = fx._keep(new THREE.ShaderMaterial({
    uniforms: { uColor: { value: col.clone() }, uAlpha: alpha, uTime: t, uPeak: { value: S.pillarPeak * Math.max(.8, gain) }, uRadius: { value: radius }, uWidth: { value: S.pillarWidth }, uHeight: { value: S.pillarHeight }, uRise: { value: S.rise }, uStagger: { value: S.stagger } },
    vertexShader: PILLAR_VERT, fragmentShader: PILLAR_FRAG, ...common,
  }));
  const zoneMat = fx._keep(new THREE.ShaderMaterial({
    uniforms: { uColor: { value: col.clone() }, uAlpha: alpha, uTime: t, uPeak: { value: S.edgePeak * gain } },
    vertexShader: ZONE_VERT, fragmentShader: ZONE_FRAG, ...common,
  }));
  const group = new THREE.Group(); group.position.set(center.x, 0, center.z);
  const zone = new THREE.Mesh(fx.plane2, zoneMat); zone.rotation.x = -Math.PI / 2; zone.position.y = .08; zone.scale.setScalar(radius); zone.renderOrder = 8;
  const columns = new THREE.Mesh(sanctumPillarGeometry(pillars), pillarMat); columns.renderOrder = 12; columns.frustumCulled = false;
  group.add(zone, columns);
  const outAt = Math.max(S.fadeIn, life - S.fadeOut);
  fx.add(group, life, (k, time) => {
    t.value = time;
    alpha.value = time < S.fadeIn ? time / S.fadeIn : time > outAt ? Math.max(0, (life - time) / S.fadeOut) : 1;
    // 경계는 안쪽 85% 에서 제자리로 넓어지며 자리 잡는다.
    const e = 1 - Math.pow(1 - Math.min(1, time / .35), 3);
    zone.scale.setScalar(radius * (.85 + .15 * e));
  }, () => { pillarMat.dispose(); zoneMat.dispose(); });
  return group;
}
