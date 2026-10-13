import {audio} from '../engine/audio.js';

// 잠복형: 땅속으로 숨어 다가온 뒤 예고 원 자리에서 솟구친다. 숨은 동안에는 기존 spawning 경계를 그대로 써서
// 조준·몰이·피격·스킬 대상에서 빠진다. 예고 중에는 반쯤 드러나 맞을 수 있고, 기절시키면 솟구치기가 취소된다.
export const BURROW = Object.freeze({
  // 소환 직후 바로 숨어 다가오고, 붙은 뒤에도 쿨다운마다 발밑으로 파고들어 기습한다.
  // 근접 적은 걸어서 붙은 뒤 거리를 다시 벌리지 않으므로 최소 거리 조건을 두지 않는다(2.2m 조건은 실전에서 첫 잠행 뒤 다시 숨지 못했다).
  firstCooldown: .6, firstJitter: .4, cooldown: 6.5, cooldownJitter: 2,
  minDistance: 0, maxDistance: 13,
  sink: .35, depth: 1.6, speed: 9, maxTunnel: 1.8, closeEnough: 1.1,
  mark: .75, radius: 2.6, damageMul: 1.6, knockback: 9,
  expose: .9, exposedDamageMul: 1.5,
});

/** 게임 난수 대신 주입한 random 으로 쿨다운만 흔든다(결정성 검사용). */
export class Burrow {
  constructor(enemy, random = Math.random) {
    this.enemy = enemy; this.random = random;
    this.phase = null; this.t = 0; this.trailT = 0; this.exposed = 0; this.x = 0; this.z = 0; this.erupted = 0; this.fizzled = 0;
    this.cd = BURROW.firstCooldown + random() * BURROW.firstJitter;
  }
  get hidden() { return this.phase === 'sink' || this.phase === 'tunnel'; }
  /** 0=완전히 드러남, 1=완전히 숨음. 파티 스냅샷으로 게스트에게 그대로 보낸다. */
  depth() {
    if (this.phase === 'sink') return Math.min(1, this.t / BURROW.sink);
    if (this.phase === 'tunnel') return 1;
    if (this.phase === 'mark') return 1 - .55 * Math.min(1, this.t / BURROW.mark);
    return 0;
  }
  /** 파티 경고 원판(게스트는 적 자신의 예고 링을 돌리지 않는다). 피해·시계와 무관한 표시 전용 값이다. */
  partyWarning(id) {
    if (this.phase !== 'mark') return null;
    return { id: `${id}:burrow:${this.erupted + this.fizzled}`, kind: 'disk', x: this.x, z: this.z, radius: BURROW.radius, width: 0, length: 0, angle: 0,
      safeRadius: 0, remaining: Math.max(0, BURROW.mark - this.t), duration: BURROW.mark, color: 0xffb04c };
  }
  available(distance) {
    const e = this.enemy, g = e.game;
    return !this.phase && this.cd <= 0 && e.alive && !e.spawning && e.state === 'chase' && !(e.stun > 0) &&
      !((e.gatherT || 0) > 0) && g.active !== false && !g.bossDefeated && !!g.player?.alive &&
      distance >= BURROW.minDistance && distance <= BURROW.maxDistance;
  }
  /** true 이면 이번 프레임의 추적·공격 판단을 건너뛴다. */
  update(dt, distance) {
    const e = this.enemy, g = e.game;
    this.exposed = Math.max(0, this.exposed - dt);
    if (!this.phase) {
      this.cd -= dt;
      if (!this.available(distance)) return false;
      this.start();
    }
    // 전투가 끝났거나(포기·정산) 보스가 쓰러졌으면 결과 화면 뒤에서 솟구치지 않게 피해 없이 거둔다.
    if (g.active === false || g.bossDefeated || !g.player?.alive) { this.cancel(); return false; }
    // 예고 중 기절은 hurt 에서 즉시 끊지만, 다른 경로로 들어온 기절도 이동을 지우기 전에 확인해 넉백을 보존한다.
    if (this.phase === 'mark' && e.stun > 0) { this.interrupt(); return false; }
    this.t += dt;
    e.vel.set(0, 0, 0); e.kb.set(0, 0, 0);
    if (this.phase === 'sink') {
      const k = Math.min(1, this.t / BURROW.sink);
      e.model.position.y = -k * BURROW.depth * e.scale;
      if (k >= 1) { e.model.visible = false; this.go('tunnel'); }
      return true;
    }
    if (this.phase === 'tunnel') {
      const p = e.player, dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z, d = Math.hypot(dx, dz) || 1;
      if (p.alive && d > BURROW.closeEnough && this.t < BURROW.maxTunnel) {
        e.vel.set(dx / d * BURROW.speed, 0, dz / d * BURROW.speed);
        this.trailT -= dt;
        if (this.trailT <= 0) { this.trailT = .14; e.game.fx?.dust?.(e.pos, { n: 1, size: .8 }); }
        return true;
      }
      this.mark();
      return true;
    }
    if (this.phase === 'mark') {
      e.pos.x = this.x; e.pos.z = this.z;
      const k = Math.min(1, this.t / BURROW.mark);
      e.model.position.y = -(1 - .55 * k) * BURROW.depth * e.scale;
      e.telegraph = Math.max(0, BURROW.mark - this.t);
      if (this.t >= BURROW.mark) this.surface(true);
      return true;
    }
    return false;
  }
  go(phase) { this.phase = phase; this.t = 0; }
  /** 예고 중 기절: 솟구치기를 취소하고 무방비로 끌려 나온다. 이번 타격의 넉백은 그대로 둔다. */
  interrupt() { if (this.phase === 'mark') this.surface(false); }
  /** 전투 종료: 효과·무방비 없이 원래 모습으로 돌려놓는다. */
  cancel() {
    const e = this.enemy;
    if (!this.phase) return;
    e.model.position.y = 0; e.model.visible = true; if (e.alive) e.spawning = false; e.telegraph = 0; e.special = null;
    this.phase = null; this.t = 0;
  }
  start() {
    const e = this.enemy;
    this.go('sink'); this.trailT = 0;
    e.spawning = true; e.gatherT = 0; e.special = 'burrow'; e.telegraph = 0;
    e.game.fx?.dustPuff?.(e.pos, { size: 2.2, life: .5 });
    audio.whoosh?.({ vol: .3, pitch: .55, dur: .3 });
  }
  mark() {
    const e = this.enemy;
    this.x = e.pos.x; this.z = e.pos.z; this.go('mark');
    e.model.visible = true; e.spawning = false; e.telegraph = BURROW.mark;
    // 반경 예고는 적 자신의 예고 링(실제 반경으로 키운다) 하나로 보여 준다. 바닥 원판을 겹치면 같은 정보가 두 번 그려진다.
    e.game.fx?.dust?.(e.pos, { n: 4, size: 1.2 });
    e.announceSkill?.();
  }
  surface(hit) {
    const e = this.enemy, g = e.game;
    e.model.position.y = 0; e.model.visible = true; e.spawning = false; e.telegraph = 0; e.special = null;
    this.phase = null; this.t = 0; this.cd = BURROW.cooldown + this.random() * BURROW.cooldownJitter;
    if (e.state !== 'dead') e.state = 'chase';
    if (hit) {
      this.erupted++;
      const c = { x: this.x, z: this.z };
      g.fx?.dustPuff?.(e.pos, { size: 2.6, life: .45 });
      g.renderer?.shake?.(.4); audio.boom?.({ vol: .5, dur: .35, low: 60 });
      for (const p of burrowTargets(g)) {
        if (Math.hypot(p.pos.x - c.x, p.pos.z - c.z) < BURROW.radius) p.hurt(e.atk * BURROW.damageMul, { dirx: p.pos.x - c.x, dirz: p.pos.z - c.z, kb: BURROW.knockback, kind: 'blunt' });
      }
      if (e.has?.('attack')) e.play(e.A('attack'), { once: true, fade: .05, speed: 1.4 });
    } else this.fizzled++;
    // 솟구친 직후(또는 기절로 끌려 나온 직후)는 무방비다. 받는 피해가 늘어 다시 숨기 전에 잡을 기회를 준다.
    this.exposed = BURROW.expose; e.stun = Math.max(e.stun || 0, BURROW.expose);
    g.fx?.damage?.(e.pos, 0, { text: '약점 노출' });
  }
  /** 받는 피해 배율 — 무방비 동안만 늘어난다. */
  damageMul() { return this.exposed > 0 ? BURROW.exposedDamageMul : 1; }
  dispose() {
    const e = this.enemy;
    if (this.phase) { e.model.position.y = 0; e.model.visible = true; if (e.alive) e.spawning = false; }
    this.phase = null;
  }
}

function burrowTargets(game) {
  const list = game.stage?.party ? game.app?.party?.livingPlayers?.() || [] : [game.player];
  return [...new Set(list)].filter((p) => p?.alive);
}

/** 게스트 복제본: 호스트가 보낸 깊이로 몸을 가라앉히고, 완전히 숨으면 감추고 로컬 조준 대상에서도 뺀다. */
export function applyBurrowDepth(enemy, sub) {
  const depth = Number.isFinite(sub) ? Math.max(0, Math.min(1, sub)) : 0;
  enemy.model.position.y = depth > 0 ? -depth * BURROW.depth * (enemy.scale || 1) : 0;
  const hidden = depth >= .999;
  enemy.model.visible = !hidden;
  enemy.spawning = hidden;
}
