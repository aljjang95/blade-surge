// 지역 환경 장치 — 캠페인 전투 방마다 그 지역의 장치 하나(큰 방은 둘)를 세운다. 영웅이 치면 한 번 발동해 적을 이용한다.
// 정원: 잠든 공명종(기절) · 용광로: 화약 통(1초 뒤 폭발, 영웅도 다친다) · 서리: 서리 결정(빙결) · 심해: 조수 밸브(소용돌이로 끌어모음)
// 왕관: 심판의 등불(빛 고리 세 번) · 종탑: 금 간 종(피해 고리). 무리를 장치 곁으로 몰아 쓰는 '환경 콤보'를 만든다.
// 파티(호스트 스냅샷에 실리지 않음)·원정에는 세우지 않는다. 장치 메시는 방 진입 때만 만들고, 매 프레임에는 할당하지 않는다.
import * as THREE from 'three';
import { audio } from '../engine/audio.js';

export const ROOM_PROPS = {
  garden: { kind: 'bell', name: '잠든 공명종', color: 0xe8be74, hint: '종을 치면 공명파가 주변 적을 기절시킵니다.' },
  forge: { kind: 'keg', name: '화약 통', color: 0xff713d, hint: '통을 치면 1초 뒤 폭발합니다. 적을 몰아넣고 빠지세요.' },
  frost: { kind: 'crystal', name: '서리 결정', color: 0x85dfff, hint: '결정을 깨면 주변 적이 얼어붙습니다.' },
  tide: { kind: 'geyser', name: '조수 밸브', color: 0x48dabd, hint: '밸브를 치면 소용돌이가 적을 한가운데로 빨아들입니다.' },
  crown: { kind: 'lantern', name: '심판의 등불', color: 0xe9c785, hint: '등불을 치면 빛 고리가 세 번 퍼져 주변 적을 태웁니다.' },
  crypt: { kind: 'cracked', name: '금 간 종', color: 0xe0c68c, hint: '종을 치면 갈라진 울림이 주변 적을 베어 냅니다.' },
};
const RADIUS = { bell: 6, keg: 5, crystal: 5.5, geyser: 8, lantern: 6, cracked: 6 };
const _v = new THREE.Vector3();

export function roomPropsAllowed(stage) { return !!stage && Number.isInteger(stage.st) && !stage.expedition && !stage.party; }

/** 방 하나의 장치 자리: 방 중심에서 진입 쪽으로 30%(+큰 방은 반대편 하나 더). */
export function propSpots(room, entryX, entryZ) {
  const dx = entryX - room.x, dz = entryZ - room.z, l = Math.hypot(dx, dz) || 1, k = Math.min(room.w, room.h) * .3;
  const out = [{ x: room.x + dx / l * k * .6 - dz / l * k * .5, z: room.z + dz / l * k * .6 + dx / l * k * .5 }];
  if (room.w * room.h >= 380) out.push({ x: room.x - dx / l * k * .4 + dz / l * k * .7, z: room.z - dz / l * k * .4 - dx / l * k * .7 });
  return out;
}

export class RoomProps {
  constructor(game) {
    this.game = game; this.list = []; this.group = new THREE.Group(); this.group.name = 'room-props';
    game.scene.add(this.group);
    this.mats = new Map(); this.geos = [];
    this.announced = new Set();
  }
  mat(color, glow = false) {
    const key = color + (glow ? 'g' : '');
    if (!this.mats.has(key)) this.mats.set(key, glow ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending })
      : new THREE.MeshStandardMaterial({ color, roughness: .55, metalness: .35, emissive: color, emissiveIntensity: .12 }));
    return this.mats.get(key);
  }
  geo(g) { this.geos.push(g); return g; }
  /** 방 진입(전투 시작) 때 장치를 세운다. */
  placeFor(room) {
    const g = this.game, theme = g.stage?.chapter?.theme, def = ROOM_PROPS[g.stage?.chapter?.id === 7 ? 'crypt' : theme];
    if (!def || !roomPropsAllowed(g.stage) || !g.world || room.props) return;
    room.props = [];
    for (const s of propSpots(room, room.entryX ?? room.x, room.entryZ ?? room.z)) {
      const [x, z] = g.world.resolve(room.x, room.z, s.x, s.z, 1);
      const mesh = this.build(def, x, z); this.group.add(mesh);
      const prop = { def, kind: def.kind, x, z, room, mesh, used: false, t: 0, fuse: -1, pulses: 0, pulseT: 0, ring: mesh.userData.ring };
      this.list.push(prop); room.props.push(prop);
    }
    if (!this.announced.has(def.kind)) { this.announced.add(def.kind); g.ui?.toast?.(`환경 장치 · ${def.name} — ${def.hint}`, 'gold'); }
  }
  build(def, x, z) {
    const root = new THREE.Group(); root.position.set(x, 0, z); const c = def.color, add = (geo, mat, px, py, pz, rx = 0) => { const m = new THREE.Mesh(this.geo(geo), mat); m.position.set(px, py, pz); m.rotation.x = rx; root.add(m); return m; };
    const dark = this.mat(0x3a3530), body = this.mat(c), glow = this.mat(c, true);
    if (def.kind === 'bell' || def.kind === 'cracked') {
      add(new THREE.BoxGeometry(.18, 2.6, .18), dark, -.9, 1.3, 0); add(new THREE.BoxGeometry(.18, 2.6, .18), dark, .9, 1.3, 0); add(new THREE.BoxGeometry(2.1, .18, .22), dark, 0, 2.55, 0);
      add(new THREE.CylinderGeometry(.35, .75, 1.1, 12, 1, true), body, 0, 1.85, 0); add(new THREE.SphereGeometry(.16, 8, 6), glow, 0, 1.3, 0);
      if (def.kind === 'cracked') add(new THREE.BoxGeometry(.05, .9, .8), glow, .2, 1.85, 0);
    } else if (def.kind === 'keg') {
      add(new THREE.CylinderGeometry(.5, .55, 1.1, 12), this.mat(0x6a4630), 0, .55, 0); add(new THREE.CylinderGeometry(.57, .57, .08, 12), dark, 0, .25, 0); add(new THREE.CylinderGeometry(.57, .57, .08, 12), dark, 0, .85, 0);
      add(new THREE.BoxGeometry(.5, .32, .05), body, 0, .58, .53); add(new THREE.CylinderGeometry(.03, .03, .4, 5), dark, 0, 1.3, 0); add(new THREE.SphereGeometry(.09, 6, 5), glow, 0, 1.52, 0);
    } else if (def.kind === 'crystal') {
      for (const [px, h, r] of [[-.4, 1.2, .25], [0, 2, .34], [.42, 1.4, .26]]) add(new THREE.ConeGeometry(r, h, 5), glow, px, h / 2, 0);
      add(new THREE.CylinderGeometry(.9, 1, .2, 7), this.mat(0xcfe0f2), 0, .1, 0);
    } else if (def.kind === 'geyser') {
      add(new THREE.TorusGeometry(.75, .16, 6, 16), dark, 0, .2, 0, -Math.PI / 2); add(new THREE.CylinderGeometry(.6, .6, .12, 16), glow, 0, .18, 0);
      add(new THREE.CylinderGeometry(.12, .12, 1.1, 8), body, 0, .7, 0); add(new THREE.TorusGeometry(.32, .06, 6, 12), body, 0, 1.3, 0, -Math.PI / 2);
    } else {
      add(new THREE.CylinderGeometry(.1, .16, 2.4, 7), dark, 0, 1.2, 0); add(new THREE.OctahedronGeometry(.42, 0), glow, 0, 2.6, 0); add(new THREE.ConeGeometry(.5, .35, 4), body, 0, 3.1, 0);
    }
    const ring = new THREE.Mesh(this.geo(new THREE.RingGeometry(1.25, 1.5, 32)), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: .5, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .07; root.add(ring); root.userData.ring = ring;
    return root;
  }
  /** 영웅의 타격 판정(Battle.hitArea)이 장치에 닿았는지. 닿으면 한 번 발동한다. */
  strike(pos, yaw, range, arcDeg) {
    if (!this.list.length) return;
    const half = THREE.MathUtils.degToRad(arcDeg) / 2;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]; if (!p || p.used) continue;
      const dx = p.x - pos.x, dz = p.z - pos.z, d = Math.hypot(dx, dz);
      if (d > range + 1.1) continue;
      if (arcDeg < 360 && d > .8) { let a = Math.atan2(dx, dz) - yaw; a = Math.atan2(Math.sin(a), Math.cos(a)); if (Math.abs(a) > half + .35) continue; }
      this.trigger(p);
    }
  }
  trigger(p) {
    this.game._propsUsed = (this.game._propsUsed || 0) + 1;
    const g = this.game; p.used = true; p.ring.material.opacity = 0;
    _v.set(p.x, 0, p.z);
    if (p.kind === 'keg') { p.fuse = 1; g.fx.ring(_v, 0xff5020, { r0: RADIUS.keg - .4, r1: RADIUS.keg, telegraph: true, life: 1, y: .06, width: 1 }); audio.play?.('hit_metal0', { vol: .4, rate: .7 }); g.ui?.combatCue?.('화약 통 점화!', 'red'); return; }
    if (p.kind === 'lantern') { p.pulses = 3; p.pulseT = 0; return; }
    this.effect(p);
  }
  /** 장치 효과: 반경 안 적에게(정예·보스는 약하게). 비율 피해라 단계가 올라도 의미가 같다. */
  hit(p, frac, { stun = 0, slow = false, kb = 4, gather = false, player = 0 } = {}) {
    const g = this.game, r = RADIUS[p.kind]; let n = 0;
    for (const e of g.enemies) {
      if (!e.alive || e.spawning || e.burrow?.phase === 'under') continue;
      const dx = e.pos.x - p.x, dz = e.pos.z - p.z, d = Math.hypot(dx, dz); if (d > r) continue;
      const scale = e.isBoss ? .12 : e.isElite ? .3 : 1;
      if (gather) e.gather?.(p.x, p.z, 16, .45);
      if (frac > 0) e.hurt(e.maxHp * frac * scale, { dirx: dx, dirz: dz, kb: gather ? 0 : kb, kind: 'blunt', stun: stun * (e.isBoss ? .2 : 1) });
      else if (stun) e.stun = Math.max(e.stun, stun * (e.isBoss ? .2 : 1));
      if (slow) { e.slow = Math.max(e.slow || 0, .5); e.slowT = Math.max(e.slowT || 0, 4); }
      n++;
    }
    if (player > 0) for (const pl of g.players || [g.player]) if (pl?.alive && Math.hypot(pl.pos.x - p.x, pl.pos.z - p.z) < r) pl.hurt(pl.maxHp * player, { dirx: pl.pos.x - p.x, dirz: pl.pos.z - p.z, kb: 8, kind: 'blunt' });
    if (n >= 3) g.fx.damage(_v.set(p.x, 0, p.z), 0, { text: `환경 콤보 ×${n}` });
    return n;
  }
  effect(p) {
    const g = this.game; _v.set(p.x, 0, p.z); const c = p.def.color;
    if (p.kind === 'bell' || p.kind === 'cracked') {
      g.fx.shockTex(_v, c, { r1: RADIUS.bell, life: .5 }); g.fx.ring(_v, c, { r0: .5, r1: RADIUS.bell, life: .5, width: .6 });
      audio.play?.('hit_metal0', { vol: .6, rate: .5 }); audio.boom?.({ vol: .35, dur: .6, low: 110 });
      this.hit(p, p.kind === 'cracked' ? .22 : .06, { stun: p.kind === 'cracked' ? .8 : 1.8, kb: 5 });
    } else if (p.kind === 'keg') {
      g.fx.explosion?.(_v, { size: 6, color: 0xff7a30, life: .5, opacity: .7 }); g.fx.shockTex(_v, 0xff8a40, { r1: RADIUS.keg + 1, life: .45 });
      audio.boom?.({ vol: .8, dur: .6, low: 60 }); g.renderer?.shake?.(.45);
      this.hit(p, .45, { kb: 9, player: .12 });
      p.mesh.visible = false;
    } else if (p.kind === 'crystal') {
      g.fx.burst?.(_v.clone().setY(1), c, { n: 24, speed: 9, size: .35 }); g.fx.shockTex(_v, c, { r1: RADIUS.crystal, life: .5 });
      audio.shatter?.({ vol: .6 });
      this.hit(p, .1, { stun: 2.2, slow: true, kb: 1 });
      p.mesh.visible = false;
    } else if (p.kind === 'geyser') {
      g.fx.groundTex(_v, 'circle_gold', c, { r0: RADIUS.geyser, r1: 1, life: .6, spin: -2, fadeIn: .05 });
      audio.whoosh?.({ vol: .5, pitch: .4, dur: .6 });
      this.hit(p, 0, { gather: true, stun: .6 }); p.fuse = .6; p.burst = true;
    }
  }
  update(dt) {
    if (!this.list.length) return;
    const g = this.game;
    for (let i = this.list.length - 1; i >= 0; i--) {
      // 효과가 방을 정화하면 clearRoom 이 목록을 줄인다(같은 프레임 안에서).
      const p = this.list[i]; if (!p) continue;
      if (!p.used) { p.t += dt; p.ring.material.opacity = .32 + Math.sin(p.t * 4) * .2; p.ring.scale.setScalar(1 + Math.sin(p.t * 2) * .06); }
      if (p.fuse >= 0) { p.fuse -= dt; if (p.fuse < 0) { if (p.burst) { p.burst = false; _v.set(p.x, 0, p.z); g.fx.shockTex(_v, p.def.color, { r1: 4, life: .4 }); this.hit(p, .18, { kb: 3 }); } else this.effect(p); } }
      if (p.pulses > 0 && (p.pulseT -= dt) <= 0) {
        p.pulses--; p.pulseT = .45; _v.set(p.x, 0, p.z);
        g.fx.ring(_v, p.def.color, { r0: .4, r1: RADIUS.lantern, life: .4, width: .7 }); g.fx.flash?.(_v.clone().setY(2.6), p.def.color, { size: 2.2, life: .2 });
        audio.magic?.({ vol: .25, base: 523, notes: [0, 7], step: .05 });
        this.hit(p, .09, { stun: .5, kb: 2 });
      }
    }
  }
  /** 방이 정화되면 그 방 장치를 거둔다. */
  clearRoom(room) {
    if (!room.props) return;
    for (const p of room.props) { this.group.remove(p.mesh); const k = this.list.indexOf(p); if (k >= 0) this.list.splice(k, 1); }
    room.props = [];
  }
  dispose() {
    this.group.removeFromParent();
    for (const g of this.geos) g.dispose(); for (const m of this.mats.values()) m.dispose();
    this.group.traverse((o) => { if (o.material && !Array.from(this.mats.values()).includes(o.material)) o.material.dispose(); });
    this.list.length = 0; this.geos.length = 0; this.mats.clear();
  }
}
