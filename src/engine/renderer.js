import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// 최종 합성 셰이더: 색수차 · 비네트 · 히트 플래시 · 방사형 블러(궁극기) · 색보정
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAberr: { value: 0 },      // 색수차 강도
    uFlash: { value: 0 },      // 화면 플래시
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uVignette: { value: 0.35 },
    uRadial: { value: 0 },     // 방사형 블러
    uDesat: { value: 0 },      // 채도 감소 (사망/슬로우)
    uTime: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAberr, uFlash, uVignette, uRadial, uDesat, uTime; uniform vec3 uFlashColor;
    varying vec2 vUv;
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
      float g = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(g), uDesat);
      col *= 1.0 - uVignette * smoothstep(0.35, 0.95, d);
      col = mix(col, uFlashColor, clamp(uFlash, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
    this.isWebGL2 = r.capabilities.isWebGL2;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.r = r;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0a12);
    this.scene.fog = new THREE.FogExp2(0x0b0a12, 0.028);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
    this.camera.position.set(0, 12, 12);
    this.quality = 'high';
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    // 카메라 리그
    this.rig = { target: new THREE.Vector3(), pos: new THREE.Vector3(0, 12, 12), offset: new THREE.Vector3(0, 10.4, 9.0), trauma: 0, zoom: 0, lookOffset: new THREE.Vector3(0, 1, 0), mode: 'battle', orbit: 0, lag: 6 };
    this.time = 0;

    this.composer = new EffectComposer(r);
    this.composer.setPixelRatio(this.pixelRatio);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.5, 0.88);
    this.composer.addPass(this.bloom);
    this.finalPass = new ShaderPass(FinalShader);
    this.composer.addPass(this.finalPass);
    this.composer.addPass(new OutputPass());
    this.u = this.finalPass.uniforms;
    this.flash = 0; this.aberr = 0; this.radial = 0; this.desat = 0;

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }
  setQuality(q) {
    this.quality = q;
    const pr = q === 'low' ? Math.min(this.pixelRatio, 1) : q === 'mid' ? Math.min(this.pixelRatio, 1.5) : this.pixelRatio;
    this.r.setPixelRatio(pr); this.composer.setPixelRatio(pr);
    this.bloom.enabled = q !== 'low';
    this.r.shadowMap.enabled = q !== 'low';
    this.resize();
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.r.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // 세로 화면이면 시야를 넓혀 전장 확보
    this.camera.fov = w < h ? 60 : 46;
    this.camera.updateProjectionMatrix();
    this.bloom.resolution.set(Math.min(512, w / 2), Math.min(512, h / 2));
  }
  shake(amount) { this.rig.trauma = Math.min(1, this.rig.trauma + amount); }
  punch(z) { this.rig.zoom = Math.max(this.rig.zoom, z); }
  flashScreen(strength = 1, color = 0xffffff) { this.flash = Math.max(this.flash, strength); this.u.uFlashColor.value.set(color); }
  update(dt, realDt) {
    this.time += realDt;
    const rig = this.rig, cam = this.camera;
    // 트라우마 기반 셰이크
    rig.trauma = Math.max(0, rig.trauma - realDt * 2.2);
    const t = rig.trauma * rig.trauma;
    const n = (f, s) => Math.sin(this.time * f + s) * Math.cos(this.time * f * 0.63 + s * 2.1);
    rig.zoom = Math.max(0, rig.zoom - realDt * 3);
    let desired;
    if (rig.mode === 'lobby') {
      rig.orbit += realDt * 0.12;
      const rad = 6.5;
      desired = new THREE.Vector3(Math.sin(rig.orbit) * rad, 2.6, Math.cos(rig.orbit) * rad).add(rig.target);
      rig.pos.lerp(desired, 1 - Math.exp(-realDt * 3));
      cam.position.copy(rig.pos);
      cam.lookAt(rig.target.x, rig.target.y + 1.1, rig.target.z);
    } else {
      const off = rig.offset.clone().multiplyScalar(1 - rig.zoom * 0.18);
      desired = rig.target.clone().add(off);
      rig.pos.lerp(desired, 1 - Math.exp(-realDt * rig.lag));
      cam.position.copy(rig.pos);
      cam.position.x += n(31, 0) * t * 0.9;
      cam.position.y += n(37, 1) * t * 0.7;
      cam.position.z += n(29, 2) * t * 0.6;
      const look = rig.target.clone().add(rig.lookOffset);
      cam.lookAt(look);
      cam.rotation.z += n(23, 3) * t * 0.03;
    }
    // 포스트 유니폼 감쇠
    this.flash = Math.max(0, this.flash - realDt * 5);
    this.aberr = Math.max(0, this.aberr - realDt * 1.6);
    this.radial = Math.max(0, this.radial - realDt * 1.2);
    this.u.uFlash.value = this.flash;
    this.u.uAberr.value = this.aberr * 0.6 + t * 0.15;
    this.u.uRadial.value = this.radial;
    this.u.uDesat.value = this.desat;
    this.u.uTime.value = this.time;
  }
  render() { this.composer.render(); }
}
