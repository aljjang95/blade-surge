// 정예 접두사 — 정예마다 행동형 접두사 1~2개(디아블로식). 스탯 배수가 아니라 '이 정예를 어떻게 상대할지'를 바꾸는 동사다.
// 2026-10-27 대표님 피드백(몬스터 정체성 없음·오합지졸) 직접 플레이 결과: 정예가 30% 회전베기 외에 일반 몹과 같은 추격·근접만 했다.
// 결정적: 방 번호·단계·정예 순번으로 고르고, 시간은 Enemy.update 의 dt 만 쓴다. 프레임 루프에서 새 배열·객체를 만들지 않는다.
import * as THREE from 'three';
import { audio } from '../engine/audio.js';

export const ELITE_AFFIXES = {
  warding: { name: '방패막', color: 0x7fc8ff, hint: '주변 무리에 보호막을 씌웁니다. 정예를 몰아쳐 막을 깨세요.' },
  frenzy: { name: '광폭', color: 0xff5040, hint: '곁의 무리가 쓰러질수록 빨라집니다. 정예부터 떼어 놓고 잡으세요.' },
  splitting: { name: '분열', color: 0xc6ff7a, hint: '쓰러지면 작은 분신 셋으로 갈라집니다. 몰이로 한데 모아 쓸어 내세요.' },
  molten: { name: '불길 자취', color: 0xff8a30, hint: '지나간 자리에 불길이 남습니다. 불 밖에서 싸우세요.' },
  tether: { name: '사슬 구속', color: 0xd0a0ff, hint: '사슬 예고선 뒤 영웅을 끌어당깁니다. 선이 닿기 전에 회피하세요.' },
  volatile: { name: '시한 폭발', color: 0xffe060, hint: '쓰러지면 잠시 뒤 터집니다. 무리 속에서 쓰러뜨리면 폭발이 적을 휩씁니다.' },
  commander: { name: '지휘관', color: 0xffc040, hint: '곁의 무리가 더 빨리 공격합니다. 지휘관이 쓰러지면 무리가 흩어집니다.' },
  blink: { name: '그림자 도약', color: 0x9a7cff, hint: '멀어지면 영웅 뒤로 순간 이동합니다. 도착 원을 보고 비키세요.' },
};
const ORDER = Object.keys(ELITE_AFFIXES);
const PATCHES = 10;
const _v = new THREE.Vector3();

/** 정예 하나에 붙일 접두사. 4단계부터·정예방은 둘. */
export function pickAffixes(roomId, stageIdx, st, ordinal = 0, eliteRoom = false) {
  const count = st >= 4 || eliteRoom ? 2 : 1;
  const a = ((roomId * 7 + stageIdx * 3 + ordinal * 5) % ORDER.length + ORDER.length) % ORDER.length;
  const out = [ORDER[a]];
  if (count > 1) out.push(ORDER[(a + 3 + (stageIdx % 3)) % ORDER.length]);
  return out;
}

export class EliteAffixes {
  constructor(enemy, keys) {
    this.e = enemy; this.keys = keys; this.has = Object.fromEntries(keys.map((k) => [k, true]));
    this.t = { ward: 3 + (enemy.packId % 3), tether: 5, blink: 4, trail: 0 };
    this.frenzy = 0; this.wardHp = 0; this.wardOn = 0; this.tetherT = -1; this.blinkT = -1; this.deathT = -1;
    this.blinkTo = new THREE.Vector3();
    this.patches = Array.from({ length: PATCHES }, () => ({ x: 0, z: 0, life: 0 })); this.patchI = 0; this.patchTick = 0;
    this.label = keys.map((k) => ELITE_AFFIXES[k].name).join('·');
  }
  /** 곁의 무리가 쓰러졌을 때(Battle.onEnemyDeath). */
  allyDied(other) {
    if (!this.has.frenzy || !this.e.alive || other === this.e || other.distTo(this.e) > 9 || this.frenzy >= 5) return;
    this.frenzy++;
    this.e.flash?.(0xff3020, .25);
    this.e.game.fx.damage(this.e.pos, 0, { text: `광폭 ${this.frenzy}` });
  }
  /** 이동·공격 배속. */
  get speedMul() { return 1 + this.frenzy * .1; }
  /** 받는 피해 — 방패막이 켜진 동안 주변 무리는 60%를 덜 받는다(정예 자신은 막이 깨질 피해를 받는다). */
  wardFilter(target, dmg) {
    if (target === this.e) { if (this.wardOn > 0) { this.wardHp -= dmg; if (this.wardHp <= 0) this.breakWard(); } return dmg; }
    return this.wardOn > 0 && target.distTo(this.e) < 7 ? dmg * .4 : dmg;
  }
  breakWard() {
    if (this.wardOn <= 0) return;
    this.wardOn = 0; const g = this.e.game;
    g.fx.shockTex(this.e.pos, 0x7fc8ff, { r1: 7, life: .4 }); g.fx.damage(this.e.pos, 0, { text: '보호막 파괴' });
    audio.shatter?.({ vol: .5 }); this.e.stun = Math.max(this.e.stun, .8);
  }
  update(dt, d) {
    const e = this.e, g = e.game, p = e.player;
    if (!p) return false;
    // 불길 자취: 남은 불을 줄이고 영웅이 밟으면 0.5초마다 데인다.
    if (this.has.molten) {
      this.patchTick -= dt; let burn = false;
      for (const pt of this.patches) if (pt.life > 0) { pt.life -= dt; if (pt.life > 0 && Math.hypot(p.pos.x - pt.x, p.pos.z - pt.z) < 1.35) burn = true; }
      if (burn && this.patchTick <= 0) { this.patchTick = .5; p.hurt(e.atk * .55, { dirx: 0, dirz: 0, kb: 0, kind: 'fire' }); }
      if (e.alive && (this.t.trail -= dt) <= 0 && Math.hypot(e.vel.x, e.vel.z) > .5) {
        this.t.trail = .55; const pt = this.patches[this.patchI++ % PATCHES]; pt.x = e.pos.x; pt.z = e.pos.z; pt.life = 4.5;
        g.fx.groundTex(_v.set(pt.x, 0, pt.z), 'circle_demon', 0xff7a2a, { r0: 1.2, r1: 1.4, life: 4.5, spin: .3, fadeIn: .1, hold: 3.6 });
      }
    }
    if (!e.alive) {
      // 시한 폭발: 쓰러진 자리에서 1.2초 뒤 터진다(아군도 휩쓴다).
      if (this.deathT >= 0) { this.deathT -= dt; if (this.deathT < 0) this.detonate(); }
      return false;
    }
    if (e.stun > 0 || e.state === 'spawn' || e.pack?.aggro === false) return false;
    // 방패막: 7초마다 4초. 정예가 최대 체력 8%를 받으면 깨진다.
    if (this.has.warding) {
      if (this.wardOn > 0) { this.wardOn -= dt; if (this.wardOn <= 0) this.wardOn = 0; }
      else if ((this.t.ward -= dt) <= 0) {
        this.t.ward = 7; this.wardOn = 4; this.wardHp = e.maxHp * .08;
        g.fx.groundTex(e.pos, 'circle_gold', 0x7fc8ff, { r0: 1, r1: 7, life: 4, spin: .6, fadeIn: .15, hold: 3.2 });
        g.fx.damage(e.pos, 0, { text: '보호막' }); audio.magic?.({ vol: .3, base: 330, notes: [0, 7, 12], step: .06 });
      }
    }
    // 사슬 구속: 1초 예고선 → 회피 무적이 아니면 영웅을 정예 쪽으로 5m 끌어당긴다.
    if (this.has.tether) {
      if (this.tetherT >= 0) {
        this.tetherT -= dt; e.vel.set(0, 0, 0); e.telegraph = Math.max(0, this.tetherT);
        if (this.tetherT < 0) {
          const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, l = Math.hypot(dx, dz) || 1;
          if (l < 14 && !(p.invuln > 0)) { p.knockback(dx, dz, Math.min(16, l * 2.2)); p.hurt(e.atk * .6, { dirx: dx, dirz: dz, kb: 0, kind: 'blunt' }); g.fx.damage(p.pos, 0, { text: '구속!' }); }
          audio.whoosh?.({ vol: .45, pitch: .6, dur: .4 });
        }
        return true;
      }
      if ((this.t.tether -= dt) <= 0 && d > 3.5 && d < 12 && e.state === 'chase') {
        this.t.tether = 8.5; this.tetherT = 1;
        g.fx.slashArc?.(e.pos, Math.atan2(p.pos.x - e.pos.x, p.pos.z - e.pos.z), 0xd0a0ff, { radius: d + .5, arc: 9, height: .1, telegraph: true, life: 1, tilt: 0, thickness: 1 });
        e.game.ui?.combatCue?.(`정예 · 사슬 구속`, 'red');
        return true;
      }
    }
    // 그림자 도약: 멀어진 영웅 뒤 2.5m 에 0.7초 도착 원 → 순간 이동 후 바로 공격 대기 단축.
    if (this.has.blink) {
      if (this.blinkT >= 0) {
        this.blinkT -= dt; e.vel.set(0, 0, 0);
        if (this.blinkT < 0) {
          const [x, z] = g.world ? g.world.resolve(e.pos.x, e.pos.z, this.blinkTo.x, this.blinkTo.z, .6) : [this.blinkTo.x, this.blinkTo.z];
          g.fx.ghost?.(e.model, 0x9a7cff, { life: .35, opacity: .5 }); e.pos.x = x; e.pos.z = z; e.atkCd = Math.min(e.atkCd, .25);
          g.fx.shockTex(e.pos, 0x9a7cff, { r1: 2.6, life: .3 });
        }
        return true;
      }
      if ((this.t.blink -= dt) <= 0 && d > 6 && d < 16 && e.state === 'chase') {
        this.t.blink = 7.5; this.blinkT = .7;
        const fx = Math.sin(p.yaw || 0), fz = Math.cos(p.yaw || 0);
        this.blinkTo.set(p.pos.x - fx * 2.5, 0, p.pos.z - fz * 2.5);
        g.fx.ring(this.blinkTo, 0x9a7cff, { r0: 1.6, r1: 2, telegraph: true, life: .7, y: .06, width: 1 });
        return true;
      }
    }
    return false;
  }
  /** 정예가 쓰러질 때(Enemy.kill). */
  onDeath() {
    const e = this.e, g = e.game;
    if (this.has.volatile) {
      this.deathT = 1.2; this.deathX = e.pos.x; this.deathZ = e.pos.z;
      g.fx.ring(e.pos, 0xffe060, { r0: 4, r1: 4.6, telegraph: true, life: 1.2, y: .06, width: 1 });
    }
    if (this.has.splitting && !e.summoned) {
      const R = g.stage?.combatRosterFor?.() || g.stage?.rosterFor?.();
      const t = R?.trash?.[0];
      if (t) for (let i = 0; i < 3; i++) g.after?.(.15 + i * .08, () => {
        if (!g.active) return;
        const a = i / 3 * Math.PI * 2, c = g.spawnEnemy(t, null, e.homeRoom, new THREE.Vector3(e.pos.x + Math.cos(a) * 1.4, 0, e.pos.z + Math.sin(a) * 1.4));
        if (c) { c.summoned = true; c.xpReward = 0; c.reactT = 0; if (c.pack) c.pack.aggro = true; }
      });
      g.fx.burst?.(e.pos.clone().setY(1), 0xc6ff7a, { n: 18, speed: 7, size: .3 });
    }
    if (this.has.commander) for (const o of g.enemies) if (o !== e && o.alive && o.pack === e.pack && o.distTo(e) < 10) { o.stun = Math.max(o.stun, .9); }
  }
  detonate() {
    const g = this.e.game, x = this.deathX, z = this.deathZ;
    _v.set(x, 0, z);
    g.fx.explosion?.(_v, { size: 6, color: 0xffd040, life: .5, opacity: .6 }); g.fx.shockTex(_v, 0xffd040, { r1: 6, life: .45 });
    audio.boom?.({ vol: .6, dur: .5, low: 70 }); g.renderer?.shake?.(.4);
    for (const p of g.players || [g.player]) if (p?.alive && Math.hypot(p.pos.x - x, p.pos.z - z) < 4.4) p.hurt(this.e.atk * 2, { dirx: p.pos.x - x, dirz: p.pos.z - z, kb: 8, kind: 'blunt' });
    for (const o of g.enemies) if (o.alive && !o.spawning && Math.hypot(o.pos.x - x, o.pos.z - z) < 4.4) o.hurt(this.e.atk * 4, { dirx: o.pos.x - x, dirz: o.pos.z - z, kb: 7, kind: 'blunt' });
  }
  /** 지휘관 곁의 무리 공격 대기 가속(Enemy.update 에서 atkCd 감소에 곱한다). */
  static commandMul(enemy) {
    const leader = enemy.pack?.leader;
    return leader && leader !== enemy && leader.alive && leader.affixes?.has.commander && leader.distTo(enemy) < 10 ? 1.35 : 1;
  }
}
