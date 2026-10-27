import * as THREE from 'three';
import { audio } from '../engine/audio.js';

// 종지기(bellringer): 7장 종탑 도시의 새 AI 동사. 매단 청동 종을 쳐서 고리 충격파를 바깥으로 퍼뜨린다.
//  1) 거리 안으로 들어오면 멈춰 서서 0.9초 동안 종을 흔든다(예고, 기절시키면 취소).
//  2) 종소리와 함께 고리 두 겹이 시간차로 바깥으로 퍼진다. 고리 띠(.78R~R)에 닿으면 피해+짧은 경직이고,
//     회피 무적으로 지나치거나 두 고리 사이 빈틈에 서면 맞지 않는다.
//  3) 매단 종은 먼저 피해를 받는다(종 체력). 종이 깨지면 주변 적이 2초 기절하고 종지기는 무방비가 되며 더는 종을 치지 못한다.
// 고리는 종지기가 죽으면 거둔다. 난수는 쿨다운 흔들림에만 쓰고(주입), 나머지는 전투 시간(dt)만으로 진행한다.
export const BELL = Object.freeze({
  firstCooldown: 1.2, firstJitter: .8, cooldown: 7.5, cooldownJitter: 2, retryCooldown: 3,
  minDistance: 3.2, maxDistance: 11, maxActive: 2,
  windup: .9,
  // 고리: 시작 반지름에서 최대 반지름까지 일정 속도로 퍼진다. 두 번째 고리는 gap 초 뒤에 출발해 사이에 빈틈이 생긴다.
  startRadius: 1.4, maxRadius: 10, speed: 5.2, gap: .75, band: .78,
  damageMul: 1.1, knockback: 7,
  // 종 체력은 종지기 최대 체력의 비율. 깨지면 반경 안 적이 stunSeconds 동안 기절하고 종지기는 exposeSeconds 동안 무방비(받는 피해 배율)다.
  bellHpRatio: .45, shatterRadius: 7, stunSeconds: 2, exposeSeconds: 2, exposedDamageMul: 1.5,
});

const RING_COUNT = 2;
const BELL_COLOR = 0xe0c68c;
// 모든 종지기가 공유하는 정적 지오메트리. 프레임 루프에서는 위치·배율만 바꾼다.
let ringGeometry = null, bellGeometry = null;
function sharedRingGeometry() {
  if (!ringGeometry) ringGeometry = new THREE.RingGeometry(BELL.band, 1, 64, 1).rotateX(-Math.PI / 2);
  return ringGeometry;
}
function sharedBellGeometry() {
  if (!bellGeometry) {
    // 종 몸체(위가 좁고 아래가 넓은 원통) + 테두리 + 추 + 손잡이.
    const body = new THREE.CylinderGeometry(.34, .72, .95, 14).translate(0, 0, 0);
    const lip = new THREE.CylinderGeometry(.78, .78, .12, 14).translate(0, -.5, 0);
    const clapper = new THREE.SphereGeometry(.14, 8, 6).translate(0, -.62, 0);
    const handle = new THREE.TorusGeometry(.18, .045, 5, 10).translate(0, .56, 0);
    const parts = [body, lip, clapper, handle].map((g) => (g.index ? g.toNonIndexed() : g));
    let count = 0; for (const g of parts) count += g.getAttribute('position').count;
    const position = new Float32Array(count * 3), normal = new Float32Array(count * 3);
    let offset = 0;
    for (const g of parts) {
      position.set(g.getAttribute('position').array, offset * 3); normal.set(g.getAttribute('normal').array, offset * 3);
      offset += g.getAttribute('position').count; g.dispose();
    }
    bellGeometry = new THREE.BufferGeometry();
    bellGeometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    bellGeometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  }
  return bellGeometry;
}

/** 게임 난수 대신 주입한 random 으로 쿨다운만 흔든다(결정성 검사용). */
export class Bellringer {
  constructor(enemy, random = Math.random) {
    this.enemy = enemy; this.random = random;
    this.phase = null; this.t = 0; this.cd = BELL.firstCooldown + random() * BELL.firstJitter;
    this.bellMax = Math.max(1, enemy.maxHp * BELL.bellHpRatio); this.bellHp = this.bellMax;
    this.exposed = 0; this.flash = 0; this.tolls = 0; this.interrupted = 0; this.shattered = 0; this.hits = 0;
    // 고리 두 겹: 미리 만들어 두고 재사용한다(할당 없음).
    /** @type {{ active: boolean, r: number, cx: number, cz: number, age: number, struck: any[], mesh: THREE.Mesh | null }[]} */
    this.rings = Array.from({ length: RING_COUNT }, () => ({ active: false, r: 0, cx: 0, cz: 0, age: 0, struck: [], mesh: null }));
    this.nextRing = 0; this.launchT = 0;
    /** @type {THREE.Mesh | null} */
    this.bell = null; this.bellMaterial = null; this.disposed = false;
    const game = enemy.game;
    if (enemy.root && game?.scene) this.buildVisuals(enemy, game);
  }
  buildVisuals(enemy, game) {
    this.bellMaterial = new THREE.MeshStandardMaterial({ color: 0x9a7a3c, roughness: .42, metalness: .75, emissive: BELL_COLOR, emissiveIntensity: 0 });
    this.bell = new THREE.Mesh(sharedBellGeometry(), this.bellMaterial);
    this.bell.name = 'BellringerBell'; this.bell.castShadow = false;
    // 머리 위로 짧은 막대에 매달린 종. root 는 확대되지 않는 월드 단위다.
    this.bellY = 2.2 * (enemy.def?.scale || 1) + .6;
    this.bell.position.set(0, this.bellY, 0);
    enemy.root.add(this.bell);
    this.ringMaterials = this.rings.map((ring) => {
      const material = new THREE.MeshBasicMaterial({ color: BELL_COLOR, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, forceSinglePass: true });
      const mesh = new THREE.Mesh(sharedRingGeometry(), material);
      mesh.name = 'BellringerWave'; mesh.visible = false; mesh.renderOrder = 4; mesh.position.y = .12;
      game.scene.add(mesh); ring.mesh = mesh; return material;
    });
  }
  get ringing() { return this.rings[0].active || this.rings[1].active; }
  /** 지금 종을 치는 중(예고 또는 고리 퍼지는 중). 동시에 치는 종지기 수 제한에 쓴다. */
  get busy() { return this.phase === 'toll' || this.ringing; }
  get intact() { return this.bellHp > 0; }
  available(distance) {
    const e = this.enemy, g = e.game;
    return !this.phase && this.intact && this.cd <= 0 && e.alive && !e.spawning && e.state === 'chase' && !(e.stun > 0) &&
      !((e.gatherT || 0) > 0) && g.active !== false && !g.bossDefeated && !!g.player?.alive &&
      distance >= BELL.minDistance && distance <= BELL.maxDistance && this.activeCount() < BELL.maxActive;
  }
  activeCount() {
    const list = this.enemy.game.enemies;
    if (!list) return 0;
    let n = 0;
    for (let i = 0; i < list.length; i++) { const o = list[i]; if (o !== this.enemy && o.alive && o.bellringer?.busy) n++; }
    return n;
  }
  /** true 이면 이번 프레임의 추적·공격 판단을 건너뛴다(예고 중 제자리). 고리 진행은 항상 한다. */
  update(dt, distance) {
    const e = this.enemy, g = e.game;
    this.exposed = Math.max(0, this.exposed - dt); this.flash = Math.max(0, this.flash - dt);
    this.advanceRings(dt);
    this.drawBell();
    // 전투 종료(포기·정산·보스 처치)면 결과 화면 뒤에서 울리지 않게 거둔다.
    if (g.active === false || g.bossDefeated || !g.player?.alive) { this.cancel(); return false; }
    if (!this.phase) {
      this.cd -= dt;
      if (!this.available(distance)) return false;
      this.start();
    }
    if (this.phase === 'toll') {
      // 예고 중 기절은 hurt 에서 즉시 끊지만, 다른 경로로 들어온 기절도 여기서 확인한다.
      if (e.stun > 0 || e.state !== 'chase') { this.interrupt(); return false; }
      this.t += dt;
      e.vel.set(0, 0, 0);
      e.telegraph = Math.max(0, BELL.windup - this.t);
      if (this.t >= BELL.windup) { this.strike(); this.phase = 'recover'; this.t = 0; }
      return true;
    }
    if (this.phase === 'recover') {
      // 두 번째 고리가 출발할 때까지 제자리에서 종을 친다.
      this.t += dt; e.vel.set(0, 0, 0);
      if (this.nextRing < RING_COUNT && this.t >= this.launchT) this.launchRing(this.nextRing++);
      if (this.nextRing >= RING_COUNT) { this.phase = null; this.t = 0; e.special = null; e.telegraph = 0; this.cd = BELL.cooldown + this.random() * BELL.cooldownJitter; }
      return this.phase === 'recover';
    }
    return false;
  }
  start() {
    const e = this.enemy;
    this.phase = 'toll'; this.t = 0; this.tolls++;
    e.special = 'bell'; e.telegraph = BELL.windup; e.gatherT = 0;
    // 서 있는 자리에서 종이 울리므로 예고 링과 고리 중심이 같다.
    e.announceSkill?.();
    const clip = e.A?.('raise');
    if (clip && e.play) e.play(clip, { once: true, fade: .08, speed: 1.1 });
    audio.charge?.({ vol: .25, dur: .6 });
  }
  strike() {
    const e = this.enemy;
    this.nextRing = 0; this.launchT = 0;
    this.launchRing(this.nextRing++);
    this.launchT = BELL.gap;
    this.flash = .25; e.telegraph = 0; e.special = null;
    audio.play?.('hit_bell', { vol: .45, rate: .75 });
    e.game.renderer?.shake?.(.15);
  }
  launchRing(index) {
    const ring = this.rings[index], e = this.enemy;
    ring.active = true; ring.r = BELL.startRadius; ring.age = 0; ring.cx = e.pos.x; ring.cz = e.pos.z; ring.struck.length = 0;
    if (index > 0) audio.play?.('hit_bell', { vol: .35, rate: .62 });
  }
  advanceRings(dt) {
    for (const ring of this.rings) {
      if (!ring.active) continue;
      ring.age += dt; ring.r += BELL.speed * dt;
      if (ring.r >= BELL.maxRadius) { ring.active = false; if (ring.mesh) ring.mesh.visible = false; continue; }
      this.strikeRing(ring);
      this.drawRing(ring);
    }
  }
  /** 고리 띠 안에 있는 플레이어를 한 번씩만 친다. 회피 무적으로 맞지 않아도 이 고리는 그 플레이어를 지나친 것으로 센다. */
  strikeRing(ring) {
    const e = this.enemy, g = e.game;
    const list = g.stage?.party ? g.app?.party?.livingPlayers?.() : null;
    if (list) { for (let i = 0; i < list.length; i++) this.strikePlayer(ring, list[i]); }
    else this.strikePlayer(ring, g.player);
  }
  strikePlayer(ring, p) {
    if (!p?.alive || ring.struck.indexOf(p) >= 0) return;
    const dx = p.pos.x - ring.cx, dz = p.pos.z - ring.cz, d2 = dx * dx + dz * dz;
    if (!ringContains(ring.r, d2)) return;
    ring.struck.push(p);
    const e = this.enemy;
    if (p.hurt(e.atk * BELL.damageMul, { dirx: dx || .1, dirz: dz || .1, kb: BELL.knockback, kind: 'blunt' })) this.hits++;
  }
  drawRing(ring) {
    const mesh = ring.mesh; if (!mesh) return;
    mesh.visible = true; mesh.position.x = ring.cx; mesh.position.z = ring.cz; mesh.scale.set(ring.r, 1, ring.r);
    const fade = 1 - (ring.r - BELL.startRadius) / (BELL.maxRadius - BELL.startRadius);
    mesh.material.opacity = .25 + .55 * Math.max(0, fade);
  }
  drawBell() {
    if (!this.bell) return;
    const e = this.enemy;
    this.bell.visible = this.intact && e.alive;
    if (!this.bell.visible) return;
    const swing = this.phase === 'toll' ? Math.sin(this.t * 22) * .5 * (this.t / BELL.windup) : this.flash > 0 ? Math.sin(this.flash * 60) * .35 : 0;
    this.bell.rotation.z = swing;
    this.bellMaterial.emissiveIntensity = this.phase === 'toll' ? .4 + .6 * (this.t / BELL.windup) : Math.min(1, this.flash * 4);
  }
  /** 받은 피해를 종이 먼저 받아 낸다. 종 체력을 넘긴 몫(과다 피해)과 종이 깨진 뒤의 피해가 종지기 몸에 닿는다. */
  absorb(dmg) {
    if (!this.intact) return dmg * (this.exposed > 0 ? BELL.exposedDamageMul : 1);
    const taken = Math.min(dmg, this.bellHp);
    this.bellHp -= taken; this.flash = Math.max(this.flash, .12);
    this.enemy.game.fx?.damage?.(this.enemy.pos, 0, { text: this.bellHp > 0 ? '종 ' + Math.ceil(this.bellHp / this.bellMax * 100) + '%' : '종 파괴' });
    if (this.bellHp <= 0) { this.bellHp = 0; this.shatter(); }
    return dmg - taken;
  }
  /** 종이 깨졌다: 진행 중인 예고를 거두고, 주변 적을 기절시키고, 종지기를 무방비로 만든다. */
  shatter() {
    const e = this.enemy, g = e.game;
    this.shattered++;
    this.cancelWindup();
    this.exposed = BELL.exposeSeconds; e.stun = Math.max(e.stun || 0, BELL.exposeSeconds);
    const list = g.enemies;
    if (list) for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o === e || !o.alive || o.spawning || o.isBoss) continue;
      const dx = o.pos.x - e.pos.x, dz = o.pos.z - e.pos.z;
      if (dx * dx + dz * dz > BELL.shatterRadius * BELL.shatterRadius) continue;
      o.stun = Math.max(o.stun || 0, BELL.stunSeconds);
      if (o.state === 'attack') { o.state = 'chase'; o.telegraph = 0; }
    }
    g.fx?.shockTex?.(e.pos, BELL_COLOR, { r1: BELL.shatterRadius, life: .5 });
    g.fx?.damage?.(e.pos, 0, { text: '무방비' });
    g.renderer?.shake?.(.35);
    audio.shatter?.({ vol: .5 }); audio.boom?.({ vol: .4, dur: .3, low: 90 });
    if (this.bell) this.bell.visible = false;
  }
  /** 예고만 거둔다(이미 퍼지는 고리는 남는다). */
  cancelWindup() {
    const e = this.enemy;
    if (this.phase === 'toll') { this.phase = null; this.t = 0; e.special = null; e.telegraph = 0; }
  }
  /** 예고 중 기절: 종소리가 나기 전에 끊고 잠시 뒤 다시 친다. */
  interrupt() {
    if (this.phase !== 'toll') return;
    this.interrupted++; this.cancelWindup(); this.cd = BELL.retryCooldown;
  }
  /** 전투 종료·사망: 효과 없이 모두 거둔다. */
  cancel() {
    this.cancelWindup();
    this.phase = null;
    for (const ring of this.rings) { ring.active = false; if (ring.mesh) ring.mesh.visible = false; }
    this.nextRing = RING_COUNT;
  }
  /** 받는 피해 배율 — 종이 깨진 뒤 무방비인 동안만 늘어난다(absorb 가 적용하므로 표시용). */
  damageMul() { return this.intact ? 1 : this.exposed > 0 ? BELL.exposedDamageMul : 1; }
  /**
   * AUTO 회피용: 이 종지기의 고리(또는 곧 나올 고리)가 target 에 닿기까지 남은 초. 닿을 일이 없으면 Infinity, 해당 없음이면 null.
   * 예고 중에는 예고 남은 시간 + 첫 고리가 거리에 닿는 시간이다.
   */
  impactIn(target) {
    if (!this.busy || !target?.pos) return null;
    let best = Infinity;
    const px = target.pos.x, pz = target.pos.z;
    if (this.phase === 'toll') {
      const d = Math.hypot(px - this.enemy.pos.x, pz - this.enemy.pos.z);
      best = Math.max(0, BELL.windup - this.t) + Math.max(0, d - BELL.startRadius) / BELL.speed;
    }
    for (const ring of this.rings) {
      if (!ring.active) continue;
      const d = Math.hypot(px - ring.cx, pz - ring.cz);
      if (ring.struck.indexOf(target) >= 0) continue;
      const t = ringContains(ring.r, d * d) ? 0 : d > ring.r ? (d - ring.r) / BELL.speed : Infinity;
      if (t < best) best = t;
    }
    return best;
  }
  /** 파티 경고 원판(예고 중 최대 반경 고리). 피해·시계와 무관한 표시 전용 값이다. */
  partyWarning(id) {
    if (this.phase !== 'toll') return null;
    return { id: `${id}:bell:${this.tolls}`, kind: 'ring', x: this.enemy.pos.x, z: this.enemy.pos.z, radius: BELL.maxRadius, width: 0, length: 0, angle: 0,
      safeRadius: 0, remaining: Math.max(0, BELL.windup - this.t), duration: BELL.windup, color: BELL_COLOR };
  }
  /** 호스트가 스냅샷에 싣는 값. 종 체력(bh)은 늘, 예고 진행(ph)과 고리 반경(rr·rs)은 진행 중일 때만 넣어 평소 크기를 지킨다. */
  /** @returns {{ bh: number, ph?: number, rr?: number, rs?: number }} */
  partyState() {
    const out = { bh: +(this.bellHp / this.bellMax).toFixed(3) };
    if (this.phase === 'toll') out.ph = +Math.min(1, this.t / BELL.windup).toFixed(3);
    if (this.rings[0].active) out.rr = +this.rings[0].r.toFixed(2);
    if (this.rings[1].active) out.rs = +this.rings[1].r.toFixed(2);
    return out;
  }
  /**
   * 게스트 복제본: 호스트가 보낸 종 체력·예고 진행·고리 반경으로 그린다. 판정은 호스트만 한다.
   * 같은 스냅샷이 여러 프레임 보이는 동안 고리는 속도로 이어 그려 10Hz 로 끊겨 보이지 않게 한다.
   */
  applyParty(item, dt = 0) {
    const fresh = item !== this._last;
    if (fresh) { this._last = item; this._gr = item.rr || 0; this._gs = item.rs || 0; }
    else { if (this._gr > 0) this._gr += BELL.speed * dt; if (this._gs > 0) this._gs += BELL.speed * dt; }
    this.bellHp = (Number.isFinite(item.bh) ? Math.max(0, Math.min(1, item.bh)) : 1) * this.bellMax;
    this.t = (Number.isFinite(item.ph) ? item.ph : 0) * BELL.windup;
    this.phase = item.ph > 0 ? 'toll' : null;
    const draw = (index, r) => {
      const ring = this.rings[index]; ring.active = r > 0 && r < BELL.maxRadius; ring.r = r;
      ring.cx = this.enemy.pos.x; ring.cz = this.enemy.pos.z;
      if (ring.active) this.drawRing(ring); else if (ring.mesh) ring.mesh.visible = false;
    };
    draw(0, this._gr); draw(1, this._gs);
    this.drawBell();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.bell?.removeFromParent();
    this.bellMaterial?.dispose();
    for (const ring of this.rings) ring.mesh?.removeFromParent();
    for (const material of this.ringMaterials || []) material.dispose();
  }
}

/** 고리 띠 판정: 반지름 r 의 고리는 .78r ~ r 사이(거리 제곱 d2)를 친다. 경고 셰이더의 ring 도형과 같은 비율이다. */
export function ringContains(r, d2) {
  return d2 >= (r * BELL.band) ** 2 && d2 <= r * r;
}
