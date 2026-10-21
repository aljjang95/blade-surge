import * as THREE from 'three';
import { lobbyCameraPosition, lobbyCompositionShift, walkingLobbyCameraPosition } from './lobby-camera.js';
import { LobbySightline } from './lobby-sightline.js';
import { battleCameraOffset } from './camera-control.js';
import { fitBattleCameraOffset, minimumBattleAspect, refitBattleCameraPosition } from './battle-aspect-fit.js';
import { BattleOcclusion } from './battle-occlusion.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { displaySize, renderPixelRatio, thermalRenderProfile, snapResolutionScale, sharpenStrength, battleNeedsFxaa } from '../platform/mobile-display.js';
import { rebindEnvironment, createStorybookEnvironment } from './environment.js';
import { ShaderProgramValidator } from './shader-program-validator.js';
import { PlayerSilhouette, PLAYER_SILHOUETTE_FRAGMENT } from './player-silhouette.js';
import { setDeviceMaxAnisotropy } from './texture-sampling.js';
import { acquireWebGL2Context, GraphicsStartupError } from '../platform/startup-compat.js';

// 최종 합성 셰이더: 색수차 · 비네트 · 히트 플래시 · 방사형 블러(궁극기) · 색보정
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAberr: { value: 0 },      // 색수차 강도
    uFlash: { value: 0 },      // 화면 가장자리 임팩트 틴트 (전면 플래시 금지)
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uVignette: { value: 0.35 },
    uRadial: { value: 0 },     // 방사형 블러
    uDesat: { value: 0 },      // 채도 감소 (사망/슬로우)
    uSpeed: { value: new THREE.Vector2(0, 1) },   // 마지막 적 슬로우의 가장자리 속도선: (세기 0~1, 화면 가로세로비)
    uTime: { value: 0 },
    uSpeedClock: { value: 0 },   // 속도선 무늬 전용 시계: 전투 일시정지 중에는 흐르지 않는다
    uPlayerMask: { value: null },
    uPlayerOutlineStep: { value: new THREE.Vector2() },
    uPlayerOutlineActive: { value: 0 },
    // 동화풍 색 보정 — 같은 패스 안의 산술 몇 줄이라 추가 패스가 없다. uGrade=0 이면 건너뛴다(낮음 화질).
    uGrade: { value: 1 },
    uSat: { value: 0.22 },
    uCool: { value: new THREE.Color(0.9, 0.98, 1.1) },      // 그림자 쪽 곱
    uWarm: { value: new THREE.Color(1.1, 1.03, 0.9) },      // 하이라이트 쪽 곱
    uLift: { value: new THREE.Color(0.012, 0.016, 0.03) },  // 그림자 들뜸(먹먹한 검정 방지)
    uRegion: { value: new THREE.Color(1, 1, 1) },           // 지역 색조 곱
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAberr, uFlash, uVignette, uRadial, uDesat, uTime, uSpeedClock; uniform vec3 uFlashColor; uniform vec2 uSpeed;
    uniform float uGrade, uSat; uniform vec3 uCool, uWarm, uLift, uRegion;
    varying vec2 vUv;
    ${PLAYER_SILHOUETTE_FRAGMENT}
    void main(){
      vec2 uv = vUv; vec2 c = uv - 0.5; float d = length(c);
      vec3 col;
      if (uRadial > 0.001) {
        col = vec3(0.0); const int N = 8;
        for (int i = 0; i < N; i++) { float t = float(i) / float(N); col += texture2D(tDiffuse, uv - c * t * uRadial).rgb; }
        col /= float(N);
      } else {
        float a = uAberr * d;
        col.r = texture2D(tDiffuse, uv + c * a).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv - c * a).b;
      }
      if (uGrade > 0.001) {
        // 채도를 올리고, 그림자는 시원하게 · 하이라이트는 따뜻하게 나눠 칠한다.
        float l0 = dot(col, vec3(0.299, 0.587, 0.114));
        col = max(mix(vec3(l0), col, 1.0 + uGrade * uSat), 0.0);
        float sh = 1.0 - smoothstep(0.0, 0.45, l0);
        float hi = smoothstep(0.35, 1.2, l0);
        col *= mix(vec3(1.0), uCool, sh * uGrade) * mix(vec3(1.0), uWarm, hi * uGrade) * mix(vec3(1.0), uRegion, uGrade);
        col += uLift * sh * uGrade;
      }
      float g = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(g), uDesat);
      // 모서리는 검정 대신 푸른 그늘로 눌러 화면이 먹먹해지지 않게 한다.
      col *= vec3(1.0) - uVignette * smoothstep(0.35, 0.95, d) * vec3(0.92, 0.95, 0.8);
      // 전면 백색 플래시는 시야와 접근성을 해친다. 타격 색은 바깥 테두리에만 남기되,
      // 화면 중앙(영웅·적)은 그대로 두고 가장자리는 실제로 보일 만큼 짙게 물들인다.
      float impactEdge = smoothstep(0.34, 0.9, d);
      col = mix(col, uFlashColor * 0.78, clamp(uFlash * impactEdge * 0.85, 0.0, 0.46));
      if (uSpeed.x > 0.001) {
        // 가장자리 전용 속도선·그늘. 거리 r 은 축별 정규화(네 변의 중점이 모두 r=1, 모서리 약 1.19)라 가로·세로 화면비와 무관하게
        // 네 변 어디서나 바깥 마스크에 닿고, r < 0.52 인 중앙(영웅·적)은 마스크가 0 이라 절대 건드리지 않는다.
        vec2 a2 = abs(c * 2.0);
        float r = pow(pow(a2.x, 4.0) + pow(a2.y, 4.0), 0.25);
        float edge = smoothstep(0.52, 1.0, r);
        vec2 q = c * vec2(uSpeed.y, 1.0);   // 줄 방향만 화면비를 보정해 어느 비율에서도 중심에서 고르게 퍼진다
        float u = atan(q.y, q.x) / 6.2831853 + 0.5;
        float n = 44.0, id = floor(u * n);
        float h = fract(sin((id + floor(uSpeedClock * 14.0) * 7.0) * 91.7) * 43758.5453);   // 14fps 로 끊어 바뀌는 손그림풍 줄 배치
        float lane = abs(fract(u * n) - 0.5) * 2.0;
        float line = (1.0 - smoothstep(0.0, 0.16 + 0.34 * h, lane)) * step(0.35, h) * smoothstep(0.64 + 0.18 * (1.0 - h), 0.98, r);
        col = mix(col, vec3(1.0, 0.97, 0.88), clamp(line * uSpeed.x * 0.75, 0.0, 0.62));
        col *= 1.0 - edge * uSpeed.x * 0.3;
      }
      gl_FragColor = vec4(playerOutline(col, uv), 1.0);
    }`,
};

// 대비 적응형 선명화(AMD FidelityFX CAS 방식). 이웃 4칸의 최소·최대로 "여유 있는 곳"만 강하게 키우므로
// 이미 대비가 큰 윤곽선에는 후광이 생기지 않는다. 톤매핑·sRGB 변환이 끝난 화면(OutputPass 뒤)에 적용한다.
const SharpenShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1, 1) },   // 렌더 해상도 기준 1픽셀의 UV 크기
    uSharp: { value: 0.5 },                       // 0(약함)~1(강함)
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uSharp;
    varying vec2 vUv;
    void main(){
      vec3 e = texture2D(tDiffuse, vUv).rgb;
      vec3 b = texture2D(tDiffuse, vUv + vec2(0.0, -uTexel.y)).rgb;
      vec3 d = texture2D(tDiffuse, vUv + vec2(-uTexel.x, 0.0)).rgb;
      vec3 f = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb;
      vec3 h = texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb;
      vec3 mn = min(min(min(d, e), min(f, b)), h);
      vec3 mx = max(max(max(d, e), max(f, b)), h);
      // 신호 한계까지 남은 거리 / 최대값 → 채널별 적응 가중치.
      vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0));
      float peak = -1.0 / mix(8.0, 5.0, clamp(uSharp, 0.0, 1.0));
      vec3 w = amp * peak;
      vec3 col = (b * w + d * w + f * w + h * w + e) / (1.0 + 4.0 * w);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

const FLASH_MAX = 0.6, ABERR_MAX = 2, ABERR_SCALE = 0.012, RADIAL_MAX = 0.6, RADIAL_SCALE = 0.1;
/** 세로 선택 로비에서 바라보는 점을 낮추는 양(월드 단위). 390x844 기본 시점에서 영웅 발 y 560→434px, 머리 315→183px. */
export const LOBBY_PORTRAIT_LOOK_DROP = 1;

// 지역별 색 보정 — 키는 dungeon-visuals 의 key. cool/warm/lift 는 기본값에 지역 색조만 얹는다.
const GRADE_BASE = { sat: 0.22, cool: [0.9, 0.98, 1.1], warm: [1.1, 1.03, 0.9], lift: [0.012, 0.016, 0.03], region: [1, 1, 1], fog: 0.4 };
const GRADES = {
  default:    {},
  lobby:      { sat: 0.16, region: [1.02, 1.01, 0.98], fog: 0 },
  memorial:   { region: [0.96, 1.07, 1.03], lift: [0.008, 0.026, 0.03] },
  kiln:       { region: [1.1, 0.98, 0.9], cool: [0.98, 0.93, 1.08], lift: [0.03, 0.012, 0.012], sat: 0.2 },
  archive:    { region: [0.94, 1.0, 1.13], lift: [0.012, 0.018, 0.04] },
  beacon:     { region: [0.92, 1.07, 1.08], lift: [0.006, 0.028, 0.034] },
  tribunal:   { region: [1.07, 0.95, 1.09], lift: [0.024, 0.012, 0.034] },
  confluence: { region: [1.0, 1.09, 0.94], lift: [0.012, 0.026, 0.016] },
  meadow:     { region: [1.02, 1.07, 0.96], sat: 0.3, fog: 0.5 },
  coast:      { region: [0.96, 1.04, 1.09], sat: 0.28, fog: 0.5 },
  mountain:   { region: [1.0, 1.02, 1.07], sat: 0.26, fog: 0.5 },
  city:       { region: [1.07, 1.02, 0.95], sat: 0.26, fog: 0.5 },
};
// 배열까지 복사한다 — 보간이 기본값 상수를 오염시키지 않게.
const gradeFor = (key) => {
  const g = { ...GRADE_BASE, ...(GRADES[key] || GRADES.default) };
  for (const k of ['cool', 'warm', 'lift', 'region']) g[k] = [...g[k]];
  return g;
};
// 림라이트는 카메라 반대편(피사체 뒤쪽 위)에서 비춘다. 전투 중 카메라가 돌아도 같은 자리에 머물도록 프레임마다 따라간다.
const RIM_INTENSITY = 1.15, RIM_DISTANCE = 8, RIM_HEIGHT = 5.5;
const LOBBY_GRADE = gradeFor('lobby');
const GRADE_CHANNELS = Object.freeze(['cool', 'warm', 'lift', 'region']);
const _rimDir = new THREE.Vector3();
const _tintTarget = new THREE.Color();

/** 카메라 프리셋 — y/z 는 타겟 기준 오프셋, fov 는 가로모드 기준(세로는 +14), lookY 는 시선 높이, lag 는 추적 탄성 */
export const CAMERA_PRESETS = {
  top:    { y: 8.2, z: 7.4, fov: 42, lookY: 0.85, lag: 6, name: '탑다운', desc: '전투 범위와 캐릭터 실루엣을 함께 보는 기본 시점' },
  action: { y: 6.8, z: 8.4, fov: 43, lookY: 1.1, lag: 7.5, name: '액션', desc: '낮고 가까운 시점 — 타격 동작을 선명하게' },
  wide:   { y: 9.4, z: 9.2, fov: 40, lookY: 0.8, lag: 5, name: '시네마틱', desc: '가까운 보스와 패턴을 함께 보는 넓은 시점' },
};
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    // 컨텍스트를 직접 하나만 만든다. 고성능 요청이 거절되면 기본 GPU 선택으로 한 번만 다시 시도한다.
    const { context, powerPreference } = acquireWebGL2Context(canvas);
    this.contextPowerPreference = powerPreference;
    let r;
    try { r = new THREE.WebGLRenderer({ canvas, context, antialias: false, powerPreference, stencil: false, depth: true }); }
    catch (error) { throw new GraphicsStartupError('gfx-init', error); }
    // 외부 컨텍스트를 받으면 Three 는 컨텍스트의 alpha(true)로 기본 클리어 알파를 0 으로 잡는다.
    // Three 가 직접 만들던 기존 경로와 같은 불투명 클리어(1)를 유지한다.
    r.setClearAlpha(1);
    // 컨텍스트 복구 때 Three 는 같은 alpha(true) 기준으로 배경 상태를 새로 만들어 클리어 알파가 0 으로 돌아간다.
    // Three 의 복구 처리 다음에 실행되도록 생성 직후 등록해 기존 경로와 같은 1 을 다시 맞춘다.
    canvas.addEventListener('webglcontextrestored', () => r.setClearAlpha(1));
    // Development keeps full Three diagnostics. Production still rejects failed links,
    // without synchronously fetching three success logs for every new program.
    r.debug.checkShaderErrors = import.meta.env?.DEV !== false;
    this.programValidator = new ShaderProgramValidator();
    this.isWebGL2 = r.capabilities.isWebGL2;
    setDeviceMaxAnisotropy(r.capabilities.getMaxAnisotropy());
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.12;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.r = r;
    r.localClippingEnabled = true;
    this.battleOcclusion = new BattleOcclusion();
    this.rebuildEnvironment();
    this.scene = new THREE.Scene();
    this.touch = window.matchMedia('(any-pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    this.thermalTier = 0; this.renderCount = 0; this.resolutionScale = 1; this.nativeRatio = 1;
    this._shadowSizes = new WeakMap();
    this._syncShadow = object => this._applyShadowSize(object);
    // 아레나가 교체하는 태양광에도 첫 렌더 전에 같은 해상도 정책을 적용한다.
    this.scene.addEventListener('childadded', event => event.child.traverse(this._syncShadow));
    this.scene.background = new THREE.Color(0x0b0a12);
    this.scene.fog = new THREE.FogExp2(0x0b0a12, 0.028);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
    this.camera.position.set(0, 12, 12);
    this.quality = 'high';
    this.battleMinimumAspect = 0;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    // 카메라 리그
    this.rig = { target: new THREE.Vector3(), pos: new THREE.Vector3(0, 12, 12), offset: new THREE.Vector3(0, 12.5, 8.5), trauma: 0, zoom: 0, lookOffset: new THREE.Vector3(0, 1, 0), mode: 'battle', orbit: 0, lag: 6,
      // 프리셋: 사람들이 주로 고르는 세 시점 + AUTO(상황 블렌드). battle.update 가 base 를 읽어 offset/fov 를 목표로 보간한다
      preset: 'auto', base: { ...CAMERA_PRESETS.top }, fov: 46, side: 0 };
    this.time = 0;

    this.composer = new EffectComposer(r);
    this.composer.setPixelRatio(this.pixelRatio);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.62, 0.62, 0.84);
    this.composer.addPass(this.bloom);
    this.finalPass = new ShaderPass(FinalShader);
    this.composer.addPass(this.finalPass);
    this.composer.addPass(new OutputPass());
    this.lobbyAA = new ShaderPass(FXAAShader); this.lobbyAA.enabled = false;
    this.composer.addPass(this.lobbyAA);
    // 선명화는 항상 마지막(FXAA 뒤)이다. 낮음 화질에서는 끈다.
    this.sharpenPass = new ShaderPass(SharpenShader); this.sharpenPass.enabled = false;
    this.composer.addPass(this.sharpenPass);
    this.u = this.finalPass.uniforms;
    this.playerSilhouette = new PlayerSilhouette(this.u, this.finalPass);
    // 림라이트: 그림자 없는 약한 방향광 하나. 구성이 고정이라 셰이더가 다시 컴파일되지 않는다.
    this.rimLight = new THREE.DirectionalLight(0xb4d6ff, RIM_INTENSITY);
    this.scene.add(this.rimLight, this.rimLight.target);
    this._gradeKey = 'default'; this._grade = gradeFor('default'); this._gradeTarget = gradeFor('default');
    this.flash = 0; this.aberr = 0; this.radial = 0; this.desat = 0; this.speedAccent = 0;
    // 카메라는 사용자 시점·지역 구도만 따른다. 동작 줄이기 선호는 후처리 왜곡을 끈다.
    this.postFxEnabled = true;

    const scheduleResize = () => {
      if (this._resizeFrame) return;
      this._resizeFrame = requestAnimationFrame(() => { this._resizeFrame = 0; this.resize(); });
    };
    window.addEventListener('resize', scheduleResize);
    window.visualViewport?.addEventListener('resize', scheduleResize);
    this.resize();
  }
  setQuality(q) {
    this.quality = q;
    const profile = thermalRenderProfile(q, this.touch, this.thermalTier);
    this.bloom.enabled = profile.bloomEnabled;
    this.r.shadowMap.enabled = q !== 'low';
    // 종류는 사용자 설정 때만 바꾼다. 부하 단계 왕복으로 셰이더를 다시 컴파일하지 않는다.
    this.r.shadowMap.type = profile.softShadow ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.scene.traverse(this._syncShadow);
    // 낮음: 색 보정과 림라이트를 끈다(조명 개수는 그대로 두어 셰이더를 다시 짜지 않는다).
    if (this.rimLight) this.rimLight.intensity = q === 'low' ? 0 : RIM_INTENSITY;
    this.resize(true);
  }
  setThermalTier(tier) {
    if (!Number.isInteger(tier) || tier < 0 || tier > 4 || tier === this.thermalTier) return;
    const wasReduced = this.thermalTier >= 3;
    this.thermalTier = tier;
    this.bloom.enabled = this.quality !== 'low' && tier < 2;
    this.scene.traverse(this._syncShadow);
    if (wasReduced !== (tier >= 3)) this.resize(true);
  }
  /** 동적 해상도 배율(0.7~1.0, 0.1 단계). 단계가 바뀔 때만 렌더 타깃을 다시 잡는다. */
  setResolutionScale(scale) {
    const next = snapResolutionScale(scale);
    if (next === this.resolutionScale) return;
    this.resolutionScale = next;
    this.resize(true);
  }
  _applyShadowSize(object) {
    const shadow = object.shadow;
    if (!object.castShadow || !shadow) return;
    let base = this._shadowSizes.get(shadow);
    if (!base) { base = { width: shadow.mapSize.x, height: shadow.mapSize.y }; this._shadowSizes.set(shadow, base); }
    const scale = thermalRenderProfile(this.quality, this.touch, this.thermalTier).shadowScale;
    const width = Math.max(128, Math.floor(base.width * scale)), height = Math.max(128, Math.floor(base.height * scale));
    if (shadow.mapSize.x === width && shadow.mapSize.y === height) return;
    shadow.mapSize.set(width, height);
    // Three r170은 mapSize만 바꿔서는 기존 렌더 타깃을 다시 만들지 않는다.
    shadow.map?.dispose(); shadow.map = null; shadow.needsUpdate = true;
  }
  rebuildEnvironment(templates = []) {
    const previous = this.characterEnvironment;
    const studio = createStorybookEnvironment(), pmrem = new THREE.PMREMGenerator(this.r);
    this.characterEnvironment = pmrem.fromScene(studio, .04, .1, 100);
    studio.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); pmrem.dispose();
    // Render-target textures have no image to re-upload after WebGL context restoration.
    for (const root of [this.scene, ...templates]) rebindEnvironment(root, previous?.texture, this.characterEnvironment.texture);
    previous?.dispose();
  }
  resize(force = false) {
    const { width: w, height: h } = displaySize(window);
    const pr = renderPixelRatio({ width: w, height: h, dpr: window.devicePixelRatio, quality: this.quality,
      touch: this.touch, thermalTier: this.thermalTier, resolutionScale: this.resolutionScale });
    this.nativeRatio = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    document.documentElement.style.setProperty('--app-height', h + 'px');
    if (!force && this._width === w && this._height === h && this.r.getPixelRatio() === pr) return;
    this._width = w; this._height = h;
    this.pixelRatio = pr;
    this.r.setPixelRatio(pr); this.composer.setPixelRatio(pr);
    this.r.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.playerSilhouette.resize(w, h, pr);
    this.lobbyAA.uniforms.resolution.value.set(1 / (w * this.r.getPixelRatio()), 1 / (h * this.r.getPixelRatio()));
    this.sharpenPass.uniforms.uTexel.value.copy(this.lobbyAA.uniforms.resolution.value);
    this.sharpenPass.uniforms.uSharp.value = sharpenStrength(pr, this.nativeRatio);
    if (this.rig?.mode === 'battle' && this.battleMinimumAspect > 0) {
      const look = this.rig.target.clone().add(this.rig.lookOffset);
      const fitted = refitBattleCameraPosition(this.rig.pos, look, this.camera.aspect, w / h, this.battleMinimumAspect);
      if (fitted !== this.rig.pos) {
        this.rig.pos.set(fitted.x, fitted.y, fitted.z);
        this.camera.position.copy(this.rig.pos);
      }
    }
    this.camera.aspect = w / h;
    // 세로 화면이면 시야를 넓혀 전장 확보
    this.camera.fov = (this.rig?.fov ?? 46) + (w < h ? 14 : 0);
    this.camera.updateProjectionMatrix();
    // 블룸 내부 해상도를 직접 강제한다.
    // 함정: UnrealBloomPass 의 `resolution` 필드는 생성자에서만 쓰인다. 그 뒤에는
    // EffectComposer.setSize() 가 pass.setSize(w, h) 를 호출해 **캔버스 전체 해상도**로
    // 밉 체인을 다시 잡아버려서, resolution 을 아무리 낮춰도 아무 효과가 없다.
    // 블룸은 5단 밉 × (가로+세로 블러) = 10회 풀스크린 패스라 해상도 제곱으로 비싸진다.
    // composer.setSize 뒤에 setSize 를 다시 불러 덮어써야 실제로 낮아진다.
    const profile = thermalRenderProfile(this.quality, this.touch, this.thermalTier);
    const bw = Math.max(1, Math.min(profile.bloomLimit, Math.round(w / profile.bloomDivisor)));
    const bh = Math.max(1, Math.min(profile.bloomLimit, Math.round(h / profile.bloomDivisor)));
    this.bloom.resolution.set(bw, bh);
    this.bloom.setSize(bw, bh);
  }
  /** 설정에서 고른 카메라 — 'auto' 면 battle 이 상황별로 top/action/wide 를 블렌드한다 */
  setCameraPreset(name) {
    const rig = this.rig; rig.preset = CAMERA_PRESETS[name] ? name : 'auto';
    if (rig.preset !== 'auto') Object.assign(rig.base, CAMERA_PRESETS[rig.preset]);
  }
  setBattleVisual(visual = null, stage = null) {
    // Always reset before the optional camera early return; visual profiles can
    // be shared by standard/deep routes and cannot own this scope.
    this.battleMinimumAspect = minimumBattleAspect(stage);
    this.battleVisual = visual;
    this._applyRegionLook(visual);
    const c = visual?.camera;
    if (!c) return;
    this.rig.environmentCamera = c;
    this.battleCamera = { yaw: c.yaw, pitch: c.pitch, zoom: c.zoom };
    this.rig.environmentSide = c.side || 0;
  }
  /** 프레임마다 목표 fov 로 보간 (배틀이 rig.fov 를 바꾼다) */
  _applyFov(realDt) {
    const want = this.rig.fov + (this._width < this._height ? 14 : 0);
    if (Math.abs(this.camera.fov - want) > 0.05) { this.camera.fov += (want - this.camera.fov) * Math.min(1, realDt * 3); this.camera.updateProjectionMatrix(); }
  }
  /** 화면 전체 카메라 킥·흔들림은 쓰지 않는다. 사용자의 드래그·핀치 시점이 타격마다 밀리거나 되튀지 않게 한다.
   * 기존 호출부(전투·스킬·보스 연출)는 그대로 두고, 타격감은 무기·캐릭터 반동·VFX·히트스톱·소리·진동이 맡는다. */
  shake() {}
  /** 화면 전체 FOV 줌 펄스도 쓰지 않는다(공격마다 화면이 확대·축소되지 않는다). */
  punch() {}
  /** 마지막 적 슬로우 가장자리 속도선 세기(0~1). 동작 줄이기·로비·낮은 화질에서는 update 가 0 으로 막는다. */
  setSpeedAccent(level = 0) { this.speedAccent = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0; }
  flashScreen(strength = 1, color = 0xffffff) {
    // 동작 줄이기에서는 예전 상한(0.25)을 유지하고, 일반 설정에서만 가장자리 틴트를 더 짙게 쓴다.
    this.flash = Math.max(this.flash, Math.min(this.postFxEnabled ? FLASH_MAX : 0.25, strength)); this.u.uFlashColor.value.set(color);
  }
  /** paused: 전투 일시정지 중이면 속도선 무늬 시계를 멈춰 정지 화면을 그대로 둔다. */
  update(dt, realDt, paused = false) {
    this.time += realDt;
    this.speedClock = (this.speedClock || 0) + (paused ? 0 : realDt);
    const rig = this.rig, cam = this.camera;
    let desired;
    if (rig.mode === 'lobby') {
      const walking = this.lobbyNavigation;
      const portrait = this._width < this._height;
      // The walking plaza needs a clear view of the route ahead and nearby entrances.
      const p = walking ? walkingLobbyCameraPosition(portrait, this.lobbyCamera) : lobbyCameraPosition(this.lobbyCamera);
      desired = new THREE.Vector3(p.x, p.y, p.z).add(rig.target);
      this.lobbySightline ??= new LobbySightline();
      if (!walking) desired.y += this.lobbySightline.solve(desired,rig.target,this.lobbyOccluders,performance.now());
      const lobbyFov = 46 + (window.innerWidth < window.innerHeight ? 14 : 0);
      if (cam.fov !== lobbyFov) { cam.fov = lobbyFov; cam.updateProjectionMatrix(); }
      // 부팅·전투에서 로비로 바뀐 첫 프레임은 바로 자리 잡는다. 전투 좌표의 카메라에서 보간하면 광장을 가로질러 나무를 지난다.
      // 로비 안의 시점·걷기 전환은 계속 부드럽게 보간한다.
      if (!this._rigInLobby) rig.pos.copy(desired);
      else rig.pos.lerp(desired, 1 - Math.exp(-realDt * (walking ? 6 : 3)));
      cam.position.copy(rig.pos);
      // Editorial offset reserves the right-hand destination panel, without moving the hero.
      const editorialShift = walking ? { x: 0, z: 0 } : lobbyCompositionShift(p, this._width >= this._height);
      // 세로 선택 로비는 하단 착지 패널이 화면 아래 절반 가까이를 덮는다. 카메라 위치는 그대로 두고
      // 바라보는 점만 낮춰 영웅을 상단 바와 패널 사이에 둔다(UX R7). 줌·펄스 없이 고정 구도다.
      const portraitDrop = !walking && portrait ? LOBBY_PORTRAIT_LOOK_DROP : 0;
      cam.lookAt(rig.target.x + editorialShift.x, rig.target.y + (walking ? .6 : 1.1) - portraitDrop, rig.target.z + editorialShift.z);
    } else {
      const off = rig.offset.clone();
      off.x += rig.side + (rig.environmentSide || 0);   // 지역마다 전투 중심을 여는 비대칭 구도
      const controlled = battleCameraOffset(off, this.battleCamera);
      const fitted = this.battleMinimumAspect > 0
        ? fitBattleCameraOffset(controlled, rig.lookOffset, cam.aspect, this.battleMinimumAspect) : controlled;
      off.set(fitted.x, fitted.y, fitted.z);
      desired = rig.target.clone().add(off);
      this._applyFov(realDt);
      rig.pos.lerp(desired, 1 - Math.exp(-realDt * rig.lag));
      cam.position.copy(rig.pos);
      const look = rig.target.clone().add(rig.lookOffset);
      cam.lookAt(look);
    }
    // Arena supplies actual hero coordinates before this final camera update.
    this.battleOcclusion.update(cam.position, rig.mode !== 'lobby');
    this._rigInLobby = rig.mode === 'lobby';
    // 포스트 유니폼 감쇠
    this.flash = Math.max(0, this.flash - realDt * 3.5);
    this.aberr = Math.max(0, this.aberr - realDt * 1.6);
    this.radial = Math.max(0, this.radial - realDt * 1.2);
    this.u.uFlash.value = this.flash;
    // 색수차·방사형 블러는 궁극기·마무리타·보스 처치처럼 skills/battle 이 직접 올린 값만 쓰고, 상한을 둔다.
    // 로비·동작 줄이기에서는 공격 실루엣을 지키기 위해 끄고, 8탭 방사형 블러는 낮음 화질에서도 끈다(색수차는 3탭이라 유지).
    const post = this.postFxEnabled && rig.mode !== 'lobby';
    this.u.uAberr.value = post ? Math.min(this.aberr, ABERR_MAX) * ABERR_SCALE : 0;
    this.u.uRadial.value = post && this.quality !== 'low' ? Math.min(this.radial, RADIAL_MAX) * RADIAL_SCALE : 0;
    this.u.uDesat.value = this.desat;
    this.u.uSpeed?.value.set(post && this.quality !== 'low' && this.thermalTier < 3 ? this.speedAccent || 0 : 0, this._width / Math.max(1, this._height) || 1);
    this.u.uTime.value = this.time;
    if (this.u.uSpeedClock) this.u.uSpeedClock.value = this.speedClock;
    this._updateGrade(realDt, rig.mode === 'lobby'); this._updateRim();
  }
  render() {
    this.playerSilhouette.render(this.r, this.camera, this.playerSilhouetteTarget?.());
    // Bind the live actor after camera movement; a new battle never inherits an old mask.
    if (this.heroEffectFocus) {
      this.heroEffectFocus.setTarget(this.heroEffectTarget?.());
      this.heroEffectFocus.update(this.r, this.camera);
    }
    // 로비는 항상 FXAA, 전투는 렌더 해상도가 기기 해상도보다 낮아 모서리가 확대될 때만 켠다. 선명화는 낮음 화질 외 모두 켠다.
    this.lobbyAA.enabled = this.rig.mode === 'lobby' || battleNeedsFxaa(this.pixelRatio, this.nativeRatio, this.quality);
    this.sharpenPass.enabled = this.quality !== 'low';
    this.composer.render();
    this.programValidator.validate(this.r);
    this.renderCount++;
  }
  /** 지역 색 보정 목표를 정하고, 아레나가 깐 안개를 지역 하늘의 지평선 색 쪽으로 밝힌다(대기 원근). */
  _applyRegionLook(visual) {
    this._gradeKey = visual?.key || 'default';
    this._gradeTarget = gradeFor(this._gradeKey);
    const fog = this.scene?.fog, horizon = visual?.sky?.horizon;
    if (fog && horizon != null && this._gradeTarget.fog > 0) fog.color.lerp(_tintTarget.set(horizon), this._gradeTarget.fog);
  }
  /** 보정 값을 목표로 부드럽게 끌어간다(지역 전환 시 색이 튀지 않게). 유니폼이 없는 테스트 고정물에서는 건너뛴다. */
  _updateGrade(realDt, lobby) {
    const U = this.u; if (!U.uGrade || !this._grade) return;
    if (this.quality === 'low') { U.uGrade.value = 0; return; }
    const target = lobby ? LOBBY_GRADE : this._gradeTarget, g = this._grade, k = 1 - Math.exp(-realDt * 2.5);
    g.sat += (target.sat - g.sat) * k;
    for (const key of GRADE_CHANNELS) for (let i = 0; i < 3; i++) g[key][i] += (target[key][i] - g[key][i]) * k;
    U.uGrade.value = 1; U.uSat.value = g.sat;
    U.uCool.value.setRGB(g.cool[0], g.cool[1], g.cool[2]); U.uWarm.value.setRGB(g.warm[0], g.warm[1], g.warm[2]);
    U.uLift.value.setRGB(g.lift[0], g.lift[1], g.lift[2]); U.uRegion.value.setRGB(g.region[0], g.region[1], g.region[2]);
  }
  _updateRim() {
    const light = this.rimLight; if (!light) return;
    this.camera.getWorldDirection(_rimDir); _rimDir.y = 0;
    if (_rimDir.lengthSq() < 1e-6) _rimDir.set(0, 0, -1); else _rimDir.normalize();
    const t = this.rig.target;
    light.target.position.copy(t);
    light.position.set(t.x + _rimDir.x * RIM_DISTANCE, t.y + RIM_HEIGHT, t.z + _rimDir.z * RIM_DISTANCE);
  }
}
