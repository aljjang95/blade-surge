import { Plane, Vector3, Vector4 } from 'three';

/** 광장 수관처럼 좁은 평면 절단이 필요한 곳의 기존 2평면 cutaway(clipIntersection).
 * 던전 벽에는 더 이상 쓰지 않는다: 측면 경계 없는 평면이 층 전체 벽을 0.35 높이로 잘라
 * 영웅이 움직일 때 단면이 옆벽을 따라 미끄러지며 벽이 납작·속 빈 껍데기로 보였다. */
export class PlaneCutaway {
  constructor() {
    this.target = new Vector3();
    this.planes = [new Plane(), new Plane(new Vector3(0, -1, 0), .35)];
    this.reset();
  }
  bind(material) {
    material.clippingPlanes = this.planes;
    // Three discards only points in the negative half-space of BOTH planes.
    material.clipIntersection = true;
  }
  setTarget(position) {
    this.hasTarget = !!position && Number.isFinite(position.x) && Number.isFinite(position.z);
    if (this.hasTarget) this.target.set(position.x, 0, position.z);
  }
  reset() {
    this.hasTarget = false;
    this.disable();
  }
  disable() {
    this.planes[0].setComponents(0, 1, 0, 1e9);
  }
  update(cameraPosition, active = true) {
    if (!active || !this.hasTarget) { this.disable(); return; }
    const dx = cameraPosition.x - this.target.x, dz = cameraPosition.z - this.target.z;
    const length = Math.hypot(dx, dz);
    if (!Number.isFinite(length) || length < 1e-5) { this.disable(); return; }
    const x = dx / length, z = dz / length;
    this.planes[0].setComponents(-x, 0, -z, x * this.target.x + z * this.target.z - .8);
  }
}

// 시선 원뿔 형태(월드 단위). 영웅 몸통 높이를 겨냥하고, 화면 가로가 넓은 모바일 가로 화면에 맞춰 옆으로 길게 연다.
export const SIGHTLINE = Object.freeze({
  aimY: 1, core: 2.4, feather: 2.6, lateral: 1.45,
  baseY: .45, rampTop: 1.35, maxFade: 1, frontStart: -.35, frontRamp: 3.2,
  // 영웅 몸을 실제로 덮는 조각(가로 확장 없는 반경 body~bodyFeather)만 짧은 앞뒤 램프로 바로 비운다.
  // 옆벽처럼 영웅 곁에 있는 조각은 긴 램프로 천천히 비워, 벽을 따라 걸을 때 비움 경계가 튀지 않게 한다.
  body: .7, bodyFeather: .7, bodyFrontRamp: 1,
  nearCamera: 1.4, nearCameraRamp: 3,
});

const VERTEX_WORLD = /* glsl */ `
vec4 sightWorld = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
sightWorld = batchingMatrix * sightWorld;
#endif
#ifdef USE_INSTANCING
sightWorld = instanceMatrix * sightWorld;
#endif
vSightWorld = ( modelMatrix * sightWorld ).xyz;`;

const FRAGMENT_HEAD = /* glsl */ `
varying vec3 vSightWorld;
uniform vec3 uSightCamera;
uniform vec3 uSightTarget;
uniform vec3 uSightRight;
uniform vec4 uSightShape;
uniform vec4 uSightBase;
uniform vec4 uSightDepth;
uniform vec4 uSightBody;
const float SIGHT_BAYER[16] = float[16]( 0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5. );
float sightBayer4( vec2 p ) {
  ivec2 q = ivec2( mod( floor( p ), 4.0 ) );
  return ( SIGHT_BAYER[ q.y * 4 + q.x ] + .5 ) / 16.;
}`;

// sightFade()와 같은 식. 고정 화면 디더라 프레임 사이에 패턴이 흔들리지 않고 경계가 서서히 움직인다.
const FRAGMENT_DISCARD = /* glsl */ `
if ( uSightShape.w > .5 ) {
  vec3 sightRay = vSightWorld - uSightCamera;
  float sightLen = max( length( sightRay ), 1e-4 );
  vec3 sightToTarget = uSightTarget - uSightCamera;
  float sightTargetDist = max( length( sightToTarget ), 1e-4 );
  vec3 sightAxis = sightToTarget / sightTargetDist;
  vec3 sightDir = sightRay / sightLen;
  vec3 sightHit = sightDir * ( sightTargetDist / max( dot( sightDir, sightAxis ), 1e-3 ) ) - sightToTarget;
  float sightLat = dot( sightHit, uSightRight );
  float sightVert = length( sightHit - sightLat * uSightRight );
  float sightRadial = length( vec2( sightLat / uSightShape.z, sightVert ) );
  float sightFade = 1.0 - smoothstep( uSightShape.x, uSightShape.x + uSightShape.y, sightRadial );
  float sightCover = 1.0 - smoothstep( uSightBody.x, uSightBody.x + uSightBody.y, length( vec2( sightLat, sightVert ) ) );
  float sightFront = dot( vSightWorld.xz - uSightTarget.xz, vec2( -uSightRight.z, uSightRight.x ) );
  sightFade *= smoothstep( uSightDepth.x, uSightDepth.x + mix( uSightDepth.y, uSightBody.z, sightCover ), sightFront );
  sightFade *= smoothstep( uSightBase.x, uSightBase.y, vSightWorld.y );
  sightFade = max( sightFade, 1.0 - smoothstep( uSightDepth.z, uSightDepth.z + uSightDepth.w, sightLen ) );
  if ( sightFade * uSightBase.z > sightBayer4( gl_FragCoord.xy ) ) discard;
}`;

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const bindings = new WeakMap();

/** 전투 건축의 시선 확보. 카메라에서 영웅(몸통)으로 향하는 원뿔 안, 영웅보다 카메라 쪽에 있는 벽·기둥·나무만
 * 화면 고정 디더로 서서히 비운다. 바닥 경계(0.45m 아래)와 원뿔 밖 벽은 원래 높이·실루엣을 유지하고,
 * 그림자 패스는 원본 깊이 재질을 써서 벽 그림자가 이동 중 사라졌다 생기지 않는다.
 * 카메라 바로 앞(시점 회전·줌으로 벽 속에 들어간 경우)의 면도 비워 근접 클리핑 단면을 숨긴다.
 * 재질은 Arena가 소유하고, 이 객체는 공유 uniform만 소유한다. */
export class BattleOcclusion {
  constructor(shape = SIGHTLINE) {
    this.shape = shape;
    this.target = new Vector3();
    this.camera = new Vector3();
    this.right = new Vector3(1, 0, 0);
    this.uniforms = {
      uSightCamera: { value: new Vector3() },
      uSightTarget: { value: new Vector3() },
      uSightRight: { value: new Vector3(1, 0, 0) },
      uSightShape: { value: new Vector4(shape.core, shape.feather, shape.lateral, 0) },
      uSightBase: { value: new Vector4(shape.baseY, shape.rampTop, shape.maxFade, 0) },
      uSightDepth: { value: new Vector4(shape.frontStart, shape.frontRamp, shape.nearCamera, shape.nearCameraRamp) },
      uSightBody: { value: new Vector4(shape.body, shape.bodyFeather, shape.bodyFrontRamp, 0) },
    };
    this.reset();
  }
  get active() { return this.uniforms.uSightShape.value.w > .5; }
  bind(material) {
    if (Array.isArray(material)) { for (const entry of material) this.bind(entry); return; }
    if (!material) return;
    const prior = bindings.get(material);
    const intact = prior && material.onBeforeCompile === prior.hook && material.customProgramCacheKey === prior.cacheKey;
    if (intact && prior.owner === this) return;
    // 다른 시선 객체(렌더러 재생성 등)가 이미 묶었으면 그 이전 원본에서 다시 묶어 삽입이 겹치지 않게 한다.
    const original = intact ? prior.original : material.onBeforeCompile, prefix = intact ? prior.prefix : material.customProgramCacheKey();
    const uniforms = this.uniforms;
    const hook = function (shader, renderer) {
      original.call(this, shader, renderer);
      if (shader.vertexShader.includes('vSightWorld') || !shader.fragmentShader.includes('#include <clipping_planes_fragment>') || !shader.vertexShader.includes('#include <project_vertex>')) return;
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = 'varying vec3 vSightWorld;\n' + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + VERTEX_WORLD);
      shader.fragmentShader = FRAGMENT_HEAD + '\n' + shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FRAGMENT_DISCARD);
    };
    const cacheKey = () => prefix + '|battle-sightline-v2';
    material.onBeforeCompile = hook; material.customProgramCacheKey = cacheKey;
    material.userData.battleSightline = true;
    material.needsUpdate = true;
    bindings.set(material, { owner: this, hook, cacheKey, original, prefix });
  }
  isBound(material) { const b = bindings.get(material); return b?.owner === this && material.onBeforeCompile === b.hook; }
  setTarget(position) {
    this.hasTarget = !!position && Number.isFinite(position.x) && Number.isFinite(position.z);
    if (this.hasTarget) this.target.set(position.x, this.shape.aimY, position.z);
  }
  reset() {
    this.hasTarget = false;
    this.disable();
  }
  disable() {
    this.uniforms.uSightShape.value.w = 0;
  }
  update(cameraPosition, active = true) {
    if (!active || !this.hasTarget || !cameraPosition) { this.disable(); return; }
    const dx = this.target.x - cameraPosition.x, dy = this.target.y - cameraPosition.y, dz = this.target.z - cameraPosition.z;
    const length = Math.hypot(dx, dy, dz), flat = Math.hypot(dx, dz);
    if (!Number.isFinite(length) || length < 1e-3) { this.disable(); return; }
    this.camera.copy(cameraPosition);
    // 화면 오른쪽 = 시선 방향과 위쪽의 외적. 바로 위에서 내려다보면 이전 값을 유지한다.
    if (flat > 1e-4) this.right.set(-dz / flat, 0, dx / flat);
    const u = this.uniforms;
    u.uSightCamera.value.copy(this.camera); u.uSightTarget.value.copy(this.target); u.uSightRight.value.copy(this.right);
    u.uSightShape.value.w = 1;
  }
  /** 셰이더와 같은 식의 CPU 사본(디더 전 비움 정도 0~maxFade). 테스트와 실제 프레임 계측에 쓴다. */
  fadeAt(point) {
    if (!this.active) return 0;
    const s = this.shape, c = this.camera, t = this.target;
    const rx = point.x - c.x, ry = point.y - c.y, rz = point.z - c.z, len = Math.max(Math.hypot(rx, ry, rz), 1e-4);
    const tx = t.x - c.x, ty = t.y - c.y, tz = t.z - c.z, dist = Math.max(Math.hypot(tx, ty, tz), 1e-4);
    const ax = tx / dist, ay = ty / dist, az = tz / dist, dx = rx / len, dy = ry / len, dz = rz / len;
    const scale = dist / Math.max(dx * ax + dy * ay + dz * az, 1e-3);
    const hx = dx * scale - tx, hy = dy * scale - ty, hz = dz * scale - tz;
    const lat = hx * this.right.x + hy * this.right.y + hz * this.right.z;
    const vert = Math.hypot(hx - lat * this.right.x, hy - lat * this.right.y, hz - lat * this.right.z);
    const radial = Math.hypot(lat / s.lateral, vert);
    let fade = 1 - smooth(s.core, s.core + s.feather, radial);
    // 영웅보다 카메라 쪽(수평)에 있는 조각만. 뒤쪽 벽은 시점이 가팔라도 비우지 않는다.
    const front = (point.x - t.x) * -this.right.z + (point.z - t.z) * this.right.x;
    const cover = 1 - smooth(s.body, s.body + s.bodyFeather, Math.hypot(lat, vert));
    fade *= smooth(s.frontStart, s.frontStart + s.frontRamp + (s.bodyFrontRamp - s.frontRamp) * cover, front);
    fade *= smooth(s.baseY, s.rampTop, point.y);
    fade = Math.max(fade, 1 - smooth(s.nearCamera, s.nearCamera + s.nearCameraRamp, len));
    return fade * s.maxFade;
  }
}
