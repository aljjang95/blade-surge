// 전투 가독성 표시 층: "내가 누구를 노리고, 맞혔는지/빗나갔는지, 누가 적인지"를 한눈에 보이게 하는 고정 메시 묶음.
// - 적 발밑 붉은 고리(인스턴스 1드로우) · 적 머리 위 작은 체력 막대(인스턴스 1드로우, 맞은 적·조준 대상만)
// - 현재 대상 조준 표시(바닥 꺾쇠 고리 + 머리 위 역삼각 표식, 영웅색) · 원거리 영웅의 조준선(영웅→대상 점선)
// - 빗나감 먼지 고리(인스턴스 1드로우, 회색) — 맞음(영웅색 불꽃·숫자)과 확실히 다르게.
// 프레임 루프에서 할당하지 않는다. 난수를 쓰지 않는다(시드 전투 결정성 보존).
import * as THREE from 'three';

export const FOE_RING_MAX = 64;
export const HP_BAR_MAX = 24;
export const WHIFF_MAX = 16;
export const FOE_COLOR = 0xff3b30;

const HEAD = /* glsl */`
  vec3 camRight() { return vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]); }
  vec3 camUp() { return vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]); }
`;

function instanced(base, attrs, max) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index; g.setAttribute('position', base.getAttribute('position')); g.setAttribute('uv', base.getAttribute('uv'));
  const out = {};
  for (const [name, size] of Object.entries(attrs)) {
    const arr = new Float32Array(max * size), a = new THREE.InstancedBufferAttribute(arr, size);
    a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); out[name] = a;
  }
  g.instanceCount = 0;
  return { geo: g, attr: out };
}

export class ReadabilityView {
  constructor(scene) {
    this.scene = scene; this.time = 0;
    const plane = new THREE.PlaneGeometry(1, 1);
    const flat = plane.clone().rotateX(-Math.PI / 2);

    // 1) 적 발밑 고리: aRing = (x, z, 반지름, 강도)
    const ring = instanced(flat, { aRing: 4 }, FOE_RING_MAX);
    this.ringAttr = ring.attr.aRing;
    this.rings = new THREE.Mesh(ring.geo, new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(FOE_COLOR) }, uTime: { value: 0 } },
      vertexShader: /* glsl */`
        attribute vec4 aRing; varying vec2 vUv; varying float vA;
        void main(){ vUv = uv; vA = aRing.w; vec3 p = vec3(aRing.x, .045, aRing.y) + position * (aRing.z * 2.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.); }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uTime; varying vec2 vUv; varying float vA;
        void main(){ vec2 q = vUv * 2. - 1.; float r = length(q);
          float band = smoothstep(.70, .80, r) * (1. - smoothstep(.90, 1., r));
          float inner = (1. - smoothstep(.0, .8, r)) * .16;
          // 네 방향 짧은 눈금: 바닥 무늬와 섞이지 않게 '적' 표식으로 읽히도록.
          float a = atan(q.y, q.x) + uTime * .6; float tick = step(.82, abs(cos(a * 2.))) * smoothstep(.62, .7, r) * (1. - smoothstep(.98, 1., r));
          float alpha = (band * .85 + inner + tick * .55) * vA; if (alpha < .01) discard;
          gl_FragColor = vec4(uColor * (1. + band * .4), alpha); }`,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.rings.frustumCulled = false; this.rings.renderOrder = 3; scene.add(this.rings);

    // 2) 머리 위 체력 막대: aBar = (x, y, z, 채움) · aBarB = (지연 채움, 너비, 정예 여부, 알파)
    const bar = instanced(plane, { aBar: 4, aBarB: 4 }, HP_BAR_MAX);
    this.barAttr = bar.attr.aBar; this.barAttrB = bar.attr.aBarB;
    this.bars = new THREE.Mesh(bar.geo, new THREE.ShaderMaterial({
      vertexShader: /* glsl */`${HEAD}
        attribute vec4 aBar; attribute vec4 aBarB; varying vec2 vUv; varying vec4 vB; varying float vFill;
        void main(){ vUv = uv; vB = aBarB; vFill = aBar.w;
          vec3 p = aBar.xyz + camRight() * position.x * aBarB.y + camUp() * position.y * aBarB.y * .16;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.); }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying vec4 vB; varying float vFill;
        void main(){ vec2 px = vUv; float edge = step(.06, px.y) * step(px.y, .94) * step(.015, px.x) * step(px.x, .985);
          vec3 back = vec3(.05, .03, .04);
          vec3 fillC = mix(vec3(1., .2, .16), vec3(1., .78, .2), vB.z);
          vec3 c = back; float inFill = step(px.x, vFill), inLag = step(px.x, vB.x) * (1. - inFill);
          c = mix(c, fillC * (.8 + .35 * px.y), inFill * edge); c = mix(c, vec3(1., .95, .85), inLag * edge);
          gl_FragColor = vec4(c, vB.w * (edge > .5 ? .95 : .9)); }`,
      transparent: true, depthWrite: false, depthTest: false,
    }));
    this.bars.frustumCulled = false; this.bars.renderOrder = 980; scene.add(this.bars);

    // 3) 조준 대상: 바닥 꺾쇠 고리 + 머리 위 역삼각 표식
    this.reticle = new THREE.Mesh(flat, new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xffffff) }, uTime: { value: 0 }, uPulse: { value: 0 }, uShow: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uTime, uPulse, uShow; varying vec2 vUv;
        void main(){ vec2 q = vUv * 2. - 1.; float r = length(q); float a = atan(q.y, q.x) - uTime * 1.4;
          // 네 개의 꺾쇠(호): 빈틈이 있어 대상 몸을 가리지 않고 회전으로 '조준 중'을 알린다.
          float seg = step(.35, fract(a / 1.5707963 + .5)) ;
          float band = smoothstep(.74, .80, r) * (1. - smoothstep(.92, .98, r)) * seg;
          float glow = smoothstep(.55, .9, r) * (1. - smoothstep(.95, 1., r)) * .22;
          float hit = uPulse * smoothstep(.3, .85, r) * (1. - smoothstep(.85, 1., r)) * .9;
          float alpha = (band + glow + hit) * uShow; if (alpha < .01) discard;
          gl_FragColor = vec4(mix(uColor, vec3(1.), hit * .6 + band * .15), alpha); }`,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }));
    this.reticle.frustumCulled = false; this.reticle.renderOrder = 985; this.reticle.visible = false; scene.add(this.reticle);
    const chevGeo = new THREE.ConeGeometry(.2, .34, 3); chevGeo.rotateX(Math.PI); // 꼭짓점이 아래
    this.chevron = new THREE.Mesh(chevGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, depthWrite: false }));
    this.chevronEdge = new THREE.Mesh(chevGeo, new THREE.MeshBasicMaterial({ color: 0x14060a, transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide }));
    this.chevronEdge.scale.setScalar(1.35); this.chevron.add(this.chevronEdge);
    this.chevron.renderOrder = 986; this.chevronEdge.renderOrder = 985; this.chevron.visible = false; scene.add(this.chevron);

    // 4) 조준선(원거리 영웅): 바닥 위 점선이 대상 쪽으로 흐른다
    this.tracer = new THREE.Mesh(flat, new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xffffff) }, uTime: { value: 0 }, uShow: { value: 0 }, uLen: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uTime, uShow, uLen; varying vec2 vUv;
        void main(){ float along = vUv.y * uLen; float dash = step(.45, fract(along * 1.6 - uTime * 3.));
          float side = 1. - smoothstep(.25, .5, abs(vUv.x - .5));
          float ends = smoothstep(.0, .12, vUv.y) * (1. - smoothstep(.9, 1., vUv.y));
          float alpha = dash * side * ends * uShow * .75; if (alpha < .01) discard;
          gl_FragColor = vec4(uColor, alpha); }`,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }));
    this.tracer.frustumCulled = false; this.tracer.renderOrder = 984; this.tracer.visible = false; scene.add(this.tracer);

    // 5) 빗나감 먼지 고리: aWhiff = (x, y, z, 나이 0..1) · aWhiffB = (크기, 0, 0, 0)
    const wh = instanced(plane, { aWhiff: 4, aWhiffB: 4 }, WHIFF_MAX);
    this.whiffAttr = wh.attr.aWhiff; this.whiffAttrB = wh.attr.aWhiffB;
    this.whiffs = new THREE.Mesh(wh.geo, new THREE.ShaderMaterial({
      vertexShader: /* glsl */`${HEAD}
        attribute vec4 aWhiff; attribute vec4 aWhiffB; varying vec2 vUv; varying float vAge;
        void main(){ vUv = uv; vAge = aWhiff.w; float s = aWhiffB.x * (.55 + aWhiff.w * .9);
          vec3 p = aWhiff.xyz + (camRight() * position.x + camUp() * position.y) * s;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.); }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying float vAge;
        void main(){ vec2 q = vUv * 2. - 1.; float r = length(q);
          float ring = smoothstep(.55, .75, r) * (1. - smoothstep(.8, 1., r));
          float puff = (1. - smoothstep(.0, .7, r)) * .35 * (1. - vAge);
          float alpha = (ring * .7 + puff) * (1. - vAge) * (1. - vAge); if (alpha < .01 || vAge >= 1.) discard;
          gl_FragColor = vec4(vec3(.72, .70, .66), alpha); }`,
      transparent: true, depthWrite: false,
    }));
    this.whiffs.frustumCulled = false; this.whiffs.renderOrder = 12; scene.add(this.whiffs);
    this.whiffList = Array.from({ length: WHIFF_MAX }, () => ({ x: 0, y: 0, z: 0, t: 1, life: .32, size: .9 }));
    this.whiffNext = 0;
  }

  setHeroColor(color) {
    this.reticle.material.uniforms.uColor.value.set(color);
    this.chevron.material.color.set(color);
    this.tracer.material.uniforms.uColor.value.set(color);
  }

  /** 빗나감: 회색 먼지 고리 하나(숫자·영웅색 없음). */
  whiff(x, y, z, size = .9) {
    const w = this.whiffList[this.whiffNext]; this.whiffNext = (this.whiffNext + 1) % WHIFF_MAX;
    w.x = x; w.y = y; w.z = z; w.t = 0; w.size = size;
  }

  setRings(list, n) {
    const a = this.ringAttr.array; let k = 0;
    for (let i = 0; i < n && k < FOE_RING_MAX; i++, k++) { const r = list[i]; a[k * 4] = r.x; a[k * 4 + 1] = r.z; a[k * 4 + 2] = r.radius; a[k * 4 + 3] = r.alpha; }
    this.rings.geometry.instanceCount = k; this.ringAttr.needsUpdate = true;
  }

  setBars(list, n) {
    const a = this.barAttr.array, b = this.barAttrB.array; let k = 0;
    for (let i = 0; i < n && k < HP_BAR_MAX; i++, k++) {
      const r = list[i];
      a[k * 4] = r.x; a[k * 4 + 1] = r.y; a[k * 4 + 2] = r.z; a[k * 4 + 3] = r.fill;
      b[k * 4] = r.lag; b[k * 4 + 1] = r.width; b[k * 4 + 2] = r.elite; b[k * 4 + 3] = r.alpha;
    }
    this.bars.geometry.instanceCount = k; this.barAttr.needsUpdate = true; this.barAttrB.needsUpdate = true;
  }

  /** 조준 대상 표시. target 이 없으면 서서히 숨긴다. */
  setTarget(target, show, pulse, dt) {
    const u = this.reticle.material.uniforms;
    u.uShow.value = show; u.uPulse.value = pulse;
    const vis = show > .01 && !!target; this.reticle.visible = vis; this.chevron.visible = vis;
    if (!vis) return;
    const r = Math.max(.7, target.radius * 1.55) * (1 + pulse * .22);
    this.reticle.position.set(target.pos.x, .06, target.pos.z); this.reticle.scale.setScalar(r * 2);
    const top = target.headY + .8 + Math.sin(this.time * 5.2) * .09 - pulse * .12;
    this.chevron.position.set(target.pos.x, top, target.pos.z);
    this.chevron.rotation.y += dt * 2.4;
    this.chevron.material.opacity = show; this.chevronEdge.material.opacity = show * .8;
    this.chevron.scale.setScalar(1 + pulse * .45);
  }

  setTracer(from, to, show) {
    const u = this.tracer.material.uniforms; u.uShow.value = show;
    this.tracer.visible = show > .01 && !!to;
    if (!this.tracer.visible) return;
    const dx = to.x - from.x, dz = to.z - from.z, len = Math.hypot(dx, dz);
    if (len < 1.2) { this.tracer.visible = false; return; }
    this.tracer.position.set((from.x + to.x) / 2, .07, (from.z + to.z) / 2);
    this.tracer.rotation.set(0, Math.atan2(dx, dz), 0);
    this.tracer.scale.set(.32, 1, len); u.uLen.value = len;
  }

  update(dt) {
    this.time += dt;
    this.rings.material.uniforms.uTime.value = this.time;
    this.reticle.material.uniforms.uTime.value = this.time;
    this.tracer.material.uniforms.uTime.value = this.time;
    const a = this.whiffAttr.array, b = this.whiffAttrB.array; let k = 0;
    for (const w of this.whiffList) {
      if (w.t >= 1) continue;
      w.t = Math.min(1, w.t + dt / w.life);
      a[k * 4] = w.x; a[k * 4 + 1] = w.y; a[k * 4 + 2] = w.z; a[k * 4 + 3] = w.t; b[k * 4] = w.size; k++;
    }
    this.whiffs.geometry.instanceCount = k; this.whiffAttr.needsUpdate = true; this.whiffAttrB.needsUpdate = true;
  }

  clear() {
    this.rings.geometry.instanceCount = 0; this.bars.geometry.instanceCount = 0; this.whiffs.geometry.instanceCount = 0;
    for (const w of this.whiffList) w.t = 1;
    this.reticle.visible = false; this.chevron.visible = false; this.tracer.visible = false;
  }
}
