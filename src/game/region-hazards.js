import * as THREE from 'three';

const RULES = {
  garden: { color: 0xe8be74, name: '종의 공명 · 고리 사이로 이동', period: 12 },
  forge: { color: 0xff713d, name: '냉각로 과열 · 붉은 띠를 벗어나세요', period: 11 },
  frost: { color: 0x85dfff, name: '지연 기록 · 기록된 자리에서 이동', period: 12 },
  tide: { color: 0x48dabd, name: '밀물 · 파도 사이로 이동', period: 11 },
  crown: { color: 0xe9c785, name: '왕관의 심판 · 중앙 원 또는 십자 밖으로', period: 10 },
};

/** 예고와 피격에 같은 도형을 사용한다. 회피 중 무적은 Player.hurt가 처리한다. */
export function hazardContains(h, x, z) {
  const dx = x - h.x, dz = z - h.z, d2 = dx * dx + dz * dz;
  if (h.safeRadius && d2 <= h.safeRadius * h.safeRadius) return false;
  if (h.type === 'ring') return d2 >= (h.radius * .78) ** 2 && d2 <= h.radius ** 2;
  if (h.type === 'disk') return d2 <= h.radius ** 2;
  const c = Math.cos(h.angle), s = Math.sin(h.angle);
  return Math.abs(dx * c + dz * s) <= h.length / 2 && Math.abs(-dx * s + dz * c) <= h.width / 2;
}

/** 단계와 방에 따라 순서를 고정해, 전투 시간(dt)만으로 재현되는 지역 기믹. */
export function hazardPattern(theme, room, player, cycle, full = true) {
  const base = { x: room.x, z: room.z, angle: 0, safeRadius: 0, delay: 1.5, slow: false, push: 2 };
  const short = Math.min(room.w, room.h), count = full ? 3 : 2;
  if (theme === 'garden') return Array.from({ length: count }, (_, i) => ({ ...base, type: 'ring', radius: Math.min(short * .44, 3 + i * 3), delay: 1.5 + i * .55 }));
  if (theme === 'forge' || theme === 'tide') {
    const horizontal = cycle % 2 === 0, wave = theme === 'tide';
    return Array.from({ length: count }, (_, i) => ({ ...base, type: 'lane', angle: horizontal ? 0 : Math.PI / 2,
      x: room.x + (horizontal ? 0 : (i - (count - 1) / 2) * room.w * .27),
      z: room.z + (horizontal ? (i - (count - 1) / 2) * room.h * .27 : 0),
      width: wave ? 3.5 : 2.8, length: (horizontal ? room.w : room.h) - 2,
      delay: 1.5 + (wave ? i * .65 : 0), push: wave ? 7 : 2 }));
  }
  if (theme === 'frost') return Array.from({ length: count }, (_, i) => {
    const angle = cycle * 1.7 + i * Math.PI;
    return { ...base, type: 'disk', radius: 2.3, slow: true, delay: 1.7 + i * .35,
      x: Math.max(room.x - room.w / 2 + 3, Math.min(room.x + room.w / 2 - 3, player.x + (i ? Math.cos(angle) * 4 : 0))),
      z: Math.max(room.z - room.h / 2 + 3, Math.min(room.z + room.h / 2 - 3, player.z + (i ? Math.sin(angle) * 4 : 0))) };
  });
  if (theme === 'crown') return [0, 1].map(i => ({ ...base, type: 'lane', angle: Math.PI / 4 + i * Math.PI / 2 + (cycle % 2) * Math.PI / 4,
    width: 3, length: short * 1.2, safeRadius: 2.8, delay: 1.8 + (full ? i * .3 : 0) }));
  return [];
}

// 여섯 장의 재사용 평면. 중앙 안전 영역과 고리 안쪽은 실제로 비워 둔다.
export const hazardVertexShader = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
export const hazardFragmentShader = `
  varying vec2 vUv;
  uniform vec3 color;
  uniform vec2 size;
  uniform float shape, safeRadius, opacity, fired;
  void main(){
    vec2 p=(vUv-.5)*size; float r=length(p), edge;
    if(r<safeRadius)discard;
    if(shape<1.5){float q=length(vUv-.5)*2.;if(q>1.||(shape>.5&&q<.78))discard;edge=step(.9,q)+(shape>.5?1.-step(.83,q):0.);}
    else{vec2 q=abs(vUv-.5)*2.;edge=step(.91,max(q.x,q.y));}
    float stripe=step(.7,fract((p.x+p.y)*.7));
    gl_FragColor=vec4(color,opacity*(.18+edge*.62+stripe*.12+fired*.15));
  }`;

export class RegionHazards {
  constructor(game) {
    this.game = game; this.rule = RULES[game.stage.chapter.theme];
    this.room = null; this.cooldown = 5; this.cycle = 0; this.triggered = 0; this.hits = 0;
    this.geometry = new THREE.PlaneGeometry(1, 1); this.geometry.rotateX(-Math.PI / 2);
    this.group = new THREE.Group(); this.group.name = 'region-hazards'; game.scene.add(this.group);
    this.slots = Array.from({ length: 6 }, () => {
      const material = new THREE.ShaderMaterial({ vertexShader: hazardVertexShader, fragmentShader: hazardFragmentShader, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { color: { value: new THREE.Color(this.rule?.color || 0xffffff) }, size: { value: new THREE.Vector2(1, 1) }, shape: { value: 0 }, safeRadius: { value: 0 }, opacity: { value: 1 }, fired: { value: 0 } } });
      const mesh = new THREE.Mesh(this.geometry, material); mesh.visible = false; mesh.renderOrder = 2; this.group.add(mesh);
      return { mesh, hazard: null, age: 0, hit: false };
    });
  }
  clear() { for (const s of this.slots) { s.hazard = null; s.mesh.visible = false; } }
  dispose() { this.clear(); this.group.removeFromParent(); this.geometry.dispose(); for (const s of this.slots) s.mesh.material.dispose(); }
  spawn(room, anchor = this.game.player) {
    const g = this.game, theme = g.stage.chapter.theme;
    const pattern = hazardPattern(theme, room, anchor.pos, this.cycle++, room.type === 'boss' && g.stage.encounter?.rank !== 'captain');
    this.clear(); this.triggered++;
    for (let i = 0; i < pattern.length; i++) {
      const s = this.slots[i], h = pattern[i], m = s.mesh, u = m.material.uniforms;
      s.hazard = h; s.age = 0; s.hit = false; m.visible = true;
      const x = h.type === 'lane' ? h.length : h.radius * 2, z = h.type === 'lane' ? h.width : h.radius * 2;
      m.position.set(h.x, .11, h.z); m.rotation.y = -h.angle; m.scale.set(x, 1, z);
      u.size.value.set(x, z); u.shape.value = h.type === 'disk' ? 0 : h.type === 'ring' ? 1 : 2; u.safeRadius.value = h.safeRadius;
      u.fired.value = 0; u.opacity.value = .8;
    }
    if (this.triggered === 1 || room.type === 'boss') g.ui.toast(this.rule.name, 'red');
  }
  getPartyWarnings() {
    return this.slots.flatMap((s, i) => {
      const h = s.hazard; if (!h || s.age > h.delay + .5) return [];
      return [{id:`region:${this.cycle}:${i}`,kind:h.type,x:h.x,z:h.z,radius:h.radius || 0,width:h.width || 0,length:h.length || 0,angle:h.angle || 0,safeRadius:h.safeRadius || 0,remaining:Math.max(0,h.delay-s.age),duration:h.delay,color:this.rule?.color || 0xffffff}];
    });
  }
  update(dt) {
    const g = this.game;
    const targets = g.stage.party ? g.app.party.livingPlayers() : [g.player].filter(p => p?.alive);
    if (!this.rule || !g.active || !targets.length || g.paused || g.bossDefeated) { this.clear(); return; }
    const eligible = p => { const r = g.world.roomAt(p.pos.x,p.pos.z); return r && r.spawned && !r.cleared && !['start','treasure'].includes(r.type); };
    const anchor = targets.find(p => eligible(p) && g.world.roomAt(p.pos.x,p.pos.z) === this.room) || targets.find(eligible) || targets[0];
    const room = g.world.roomAt(anchor.pos.x, anchor.pos.z);
    if (room !== this.room) { this.room = room; this.cooldown = 5; this.clear(); }
    if (!room || room.cleared || !room.spawned || room.type === 'start' || room.type === 'treasure') { this.clear(); return; }
    this.cooldown -= dt;
    if (this.cooldown <= 0) { this.spawn(room, anchor); this.cooldown = this.rule.period + (room.type === 'boss' ? 0 : 3); }
    for (const s of this.slots) {
      const h = s.hazard; if (!h) continue;
      s.age += dt;
      const fired = s.age >= h.delay;
      s.mesh.material.uniforms.fired.value = fired ? 1 : 0;
      s.mesh.material.uniforms.opacity.value = fired ? Math.max(0, 1 - (s.age - h.delay) / .5) : .65 + .25 * s.age / h.delay;
      if (fired && !s.hit) {
        s.hit = true;
        for (const p of targets) if (hazardContains(h, p.pos.x, p.pos.z)) {
          const hit = p.hurt(p.maxHp * .06, { dirx: p.pos.x - h.x || .1, dirz: p.pos.z - h.z || .1, kb: h.push, kind: 'magic' });
          if (hit) { this.hits++; if (h.slow) { p.slow = .5; p.slowT = Math.max(p.slowT || 0, 1.2); } }
        }
      }
      if (s.age > h.delay + .5) { s.hazard = null; s.mesh.visible = false; }
    }
  }
}
