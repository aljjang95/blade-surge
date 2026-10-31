import * as THREE from 'three';

// 아바타 입기/벗기 전환 연출: 빛 실루엣 와이프.
// 발밑에서 머리로 빛줄기가 올라가며 실루엣이 밝아지고(덮기), 가장 밝을 때 같은 인스턴스 안에서 몸만 바꾼 뒤(교체),
// 빛이 걷히며 새 모습이 드러난다(드러내기). 믹서·재생 중 동작·무기·강화 빛은 인스턴스에 그대로 남으므로 포즈·시간이 이어진다.
// 화면 흔들림·카메라 이동 없음. 가산 셰이더 평면 하나(드로우 1회)만 쓴다.

/** 전체 전환 시간(초). 0.3~0.5 범위. */
export const BODY_WIPE_SECONDS = 0.4;
/** 몸이 아직 받아지지 않았을 때 가장 밝은 상태로 기다리는 최대 시간(초). 넘으면 걷고, 늦게 온 몸은 그대로 교체된다. */
export const BODY_WIPE_HOLD_MAX = 1.2;

const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/**
 * 전환 상태기계(순수). 매 프레임 update(dt) 가 같은 객체를 돌려준다(프레임 할당 없음).
 * phase: idle → cover → hold(교체 대기) → reveal → idle. 교체는 cover 가 끝나는 순간 한 번 내보낸다(frame.swap).
 * @param {{ duration?: number, holdMax?: number }} [options]
 */
export function createBodyWipe({ duration = BODY_WIPE_SECONDS, holdMax = BODY_WIPE_HOLD_MAX } = {}) {
  const half = duration / 2;
  let phase = 'idle', t = 0, hold = 0, ready = true, instant = false;
  /** @type {any} */ let target, applied;
  let started = false;
  const frame = { phase: 'idle', intensity: 0, sweep: 0, swap: false, target: undefined };
  return {
    get phase() { return phase; },
    get target() { return target; },
    /** 처음 모습(전환 없이). */
    reset(value) { target = applied = value; started = true; phase = 'idle'; t = 0; hold = 0; ready = true; },
    /**
     * 새 모습을 요청한다. 같은 모습이면 무시(false). 진행 중이면 목표만 바꾸고, 드러내는 중이면 다시 덮는다.
     * @param {any} value @param {{ instant?: boolean }} [opts] instant: 동작 줄이기 — 연출 없이 다음 프레임에 교체
     */
    request(value, opts = {}) {
      if (!started) { this.reset(value); return false; }
      if (value === target && (phase !== 'idle' || value === applied)) return false;
      target = value; instant = !!opts.instant;
      if (phase === 'idle') { phase = 'cover'; t = 0; }
      else if (phase === 'reveal') { phase = 'cover'; t = Math.max(0, duration - t); }   // 같은 밝기에서 다시 올라간다
      return true;
    },
    /** 교체가 끝났음(동기 교체면 swap 직후, 비동기면 몸이 도착했을 때). */
    markReady() { ready = true; },
    update(dt) {
      frame.swap = false; frame.target = target;
      if (phase === 'cover') {
        t += instant ? half : dt;
        if (t >= half) { t = half; phase = 'hold'; hold = 0; ready = false; applied = target; frame.swap = true; }
      }
      if (phase === 'hold' && !frame.swap) {
        hold += dt;
        if (ready || hold >= holdMax) phase = 'reveal';
      }
      if (phase === 'reveal') {
        t += instant ? half : dt;
        if (t >= duration) { t = 0; phase = 'idle'; instant = false; }
      }
      frame.phase = phase;
      frame.intensity = instant ? 0 : phase === 'cover' ? smooth(t / half) : phase === 'hold' ? 1 : phase === 'reveal' ? 1 - smooth((t - half) / half) : 0;
      frame.sweep = phase === 'idle' ? 0 : phase === 'hold' ? .5 : t / duration;
      return frame;
    },
  };
}

const VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// 실루엣: 몸 폭으로 좁아지는 가우스 기둥 + 아래에서 위로 지나가는 밝은 띠. 띠 아래는 새 모습 쪽 잔광이 남는다.
const FRAG = /* glsl */`
uniform float uIntensity; uniform float uSweep; uniform vec3 uColor; varying vec2 vUv;
void main(){
  if (uIntensity <= 0.002) discard;
  float x = (vUv.x - 0.5) * 2.0;
  float body = exp(-x * x * 4.0) * smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.86, 1.0, vUv.y));
  float d = vUv.y - (uSweep * 1.2 - 0.1);
  float band = exp(-d * d * 220.0);
  float trail = smoothstep(-0.4, 0.0, d) * (1.0 - step(0.0, d)) * 0.35;
  float a = body * (0.28 + band * 0.9 + trail) + band * 0.22 * exp(-x * x * 1.4);
  gl_FragColor = vec4(uColor, min(0.9, a * uIntensity));
}`;

/** 와이프 평면(가산, 깊이 무시, 항상 캐릭터 위). 장면에 한 번 붙여 두고 setBodyWipe 로 매 프레임 갱신한다. */
export function createBodyWipeMesh(color = '#fff2c8') {
  const material = new THREE.ShaderMaterial({
    uniforms: { uIntensity: { value: 0 }, uSweep: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.name = 'AvatarBodyWipe'; mesh.renderOrder = 20; mesh.frustumCulled = false; mesh.visible = false;
  return mesh;
}

/**
 * @param {THREE.Mesh} mesh createBodyWipeMesh 결과
 * @param {{ height: number, radius: number }} size 캐릭터 높이·반경(평면을 놓는 공간 기준)
 * @param {{ intensity: number, sweep: number }} frame createBodyWipe().update 결과
 */
export function setBodyWipe(mesh, size, frame) {
  const material = /** @type {THREE.ShaderMaterial} */ (mesh.material);
  material.uniforms.uIntensity.value = frame.intensity; material.uniforms.uSweep.value = frame.sweep;
  mesh.visible = frame.intensity > 0.002;
  if (!mesh.visible) return;
  const h = Math.max(.5, size.height) * 1.12, w = Math.max(.6, size.radius * 2.4);
  mesh.scale.set(w, h, 1); mesh.position.set(0, h / 2 - size.height * .04, Math.max(.3, size.radius));
}

export function disposeBodyWipeMesh(mesh) {
  mesh.removeFromParent(); mesh.geometry.dispose(); /** @type {THREE.Material} */ (mesh.material).dispose();
}
