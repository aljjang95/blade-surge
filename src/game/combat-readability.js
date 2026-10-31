// 전투 가독성(대표님 2026-10-29: "적을 쏘는 건지 허공에 쏘는 건지 구분이 안 간다").
// 공용 규칙: 맞음 = 영웅색 불꽃·흰 섬광·숫자·조준 표식 펄스 / 빗나감 = 회색 먼지 고리·숫자 없음 /
// 조준 = 대상 발밑 꺾쇠 고리·머리 위 표식·(원거리) 조준선 / 피아 = 적 붉은 발밑 고리·맞은 적 체력 막대, 영웅은 기존 청록 비컨.
// 판정·피해·난수에는 손대지 않는 표시 층이다(Math.random 미사용). 계측(stats)은 QA 하네스가 읽는다.
import { ReadabilityView } from '../engine/readability-view.js';

/** 영웅별 조준 표식 색. 광전사 고유색(붉은 주황)은 적 표식 붉은색과 겹치므로 호박색으로 비켜 둔다. */
export const READ_COLOR = Object.freeze({
  knight: 0xffd45a, barbarian: 0xffb028, mage: 0x58c8ff, rogue: 0xc690ff, ranger: 0x7ff0c4,
  werewolf: 0xffb028, blackcat: 0xc690ff, default: 0xffffff,
});
export const READABILITY = Object.freeze({
  barHold: 3.2,        // 맞은 뒤 체력 막대를 보이는 시간(초)
  barLagDelay: .25,    // 흰 지연 막대가 줄어들기 시작하는 시간
  barLagRate: 1.1,     // 지연 막대 감소 속도(전체 비율/초)
  pulseDecay: 5.5,     // 조준 표식 명중 펄스 감쇠
  minFlash: .08,       // 모든 명중의 최소 흰 섬광(초) — 큰 적에 작은 피해도 '맞았다'가 보이게
  shotHold: .9,        // 원거리 조준선이 사격 뒤 남는 시간
  meleeReach: 5.5, rangedReach: 13,
});

// 대표님 2026-10-30 "피아 식별 반경이 너무 커서 UI 가 보기 불편": 적 고리를 몸 폭 쪽으로 줄이고(1.15→.8) 비대상은 더 옅게.
export const FOE_RING_SCALE = .8;
const ringRows = Array.from({ length: 64 }, () => ({ x: 0, z: 0, radius: 1, alpha: 1 }));
const barRows = Array.from({ length: 24 }, () => ({ x: 0, y: 0, z: 0, fill: 1, lag: 1, width: 1, elite: 0, alpha: 1 }));

export class CombatReadability {
  constructor(battle) {
    this.battle = battle;
    this.view = battle.scene ? new ReadabilityView(battle.scene) : null;
    this.stats = { shots: 0, hits: 0, crits: 0, whiffs: 0, targetFrames: 0, frames: 0 };
    this.target = null; this.show = 0; this.pulse = 0; this.shotT = 0; this.heroId = null;
    this._tracerFrom = { x: 0, z: 0 }; this._tracerTo = { x: 0, z: 0 };
  }
  reset(heroDef) {
    this.stats.shots = this.stats.hits = this.stats.crits = this.stats.whiffs = this.stats.targetFrames = this.stats.frames = 0;
    this.target = null; this.show = 0; this.pulse = 0; this.shotT = 0;
    this.heroId = heroDef?.id || null; this.ranged = !!heroDef?.ranged;
    this.view?.setHeroColor(READ_COLOR[this.heroId] ?? READ_COLOR[heroDef?.jobId] ?? READ_COLOR.default);
    this.view?.clear();
  }
  get enabled() { return !!this.view; }

  /** 영웅(또는 파티 동료)의 명중. damageEnemy 의 실제 피해 뒤에 부른다. */
  hit(enemy, dealt, crit, source) {
    if (source && source !== this.battle.player) return;
    this.stats.hits++; if (crit) this.stats.crits++;
    enemy._rdHitT = READABILITY.barHold;
    if (enemy._rdLag === undefined) enemy._rdLag = Math.min(1, (enemy.hp + (dealt || 0)) / (enemy.maxHp || 1));
    enemy._rdLagWait = READABILITY.barLagDelay;
    if (enemy === this.target) this.pulse = 1;
    // 피해 비율이 작아 무게 섬광이 생략되는 타격에도 짧은 흰 섬광을 준다(실제 섬광이 더 길면 덮어쓰지 않는다).
    if (!(enemy.flashT > READABILITY.minFlash * .5)) enemy.flash?.(crit ? 0xffd040 : 0xffffff, READABILITY.minFlash, 1.25);
  }
  /** 영웅의 평타 발사(원거리). */
  shot(source) { if (source && source !== this.battle.player) return; this.stats.shots++; this.shotT = READABILITY.shotHold; }
  /** 아무것도 맞히지 못한 공격: 사거리 끝 회색 먼지. */
  whiff(pos, source, size = .9) {
    if (source && source !== this.battle.player) return;
    this.stats.whiffs++;
    if (this.enabled) this.view.whiff(pos.x, Math.max(.35, pos.y || .9), pos.z, size);
  }

  pickTarget(p) {
    const lock = p.lockTarget;
    if (lock && lock.alive && !lock.spawning && p.distTo(lock) < 16) return lock;
    return p.nearestEnemy?.(this.ranged ? READABILITY.rangedReach : READABILITY.meleeReach) || null;
  }

  update(dt) {
    const b = this.battle, p = b.player; if (!this.view) return;
    this.view.update(dt);
    if (!p || !b.active || !this.enabled) { this.view.clear(); this.target = null; return; }
    this.stats.frames++;
    const t = p.alive ? this.pickTarget(p) : null;
    if (t !== this.target) { this.target = t; if (t) this.pulse = Math.max(this.pulse, .35); }
    if (t) this.stats.targetFrames++;
    this.show += ((t ? 1 : 0) - this.show) * Math.min(1, dt * 12);
    this.pulse = Math.max(0, this.pulse - dt * READABILITY.pulseDecay);
    this.shotT = Math.max(0, this.shotT - dt);
    if (t) t.headY = 1.75 * (t.def?.scale || 1);
    this.view.setTarget(t, this.show, this.pulse, dt, b.renderer?.camera);
    if (this.ranged && t) {
      this._tracerFrom.x = p.pos.x; this._tracerFrom.z = p.pos.z; this._tracerTo.x = t.pos.x; this._tracerTo.z = t.pos.z;
      this.view.setTracer(this._tracerFrom, this._tracerTo, this.show * (.35 + .65 * Math.min(1, this.shotT / .3)));
    } else this.view.setTracer(null, null, 0);

    let nr = 0, nb = 0;
    for (const e of b.enemies) {
      if (!e.alive || e.spawning) continue;
      const scale = e.def?.scale || 1;
      // 정예·보스는 이미 자기 색 고리(금·적)가 있다. 일반 적만 붉은 고리를 얹는다.
      if (!e.isBoss && !e.isElite && nr < ringRows.length) { const r = ringRows[nr++]; r.x = e.pos.x; r.z = e.pos.z; r.radius = e.radius * FOE_RING_SCALE; r.alpha = e === t ? .85 : .3; }
      const hitT = e._rdHitT || 0;
      if (hitT > 0) e._rdHitT = hitT - dt;
      const fill = Math.max(0, Math.min(1, e.hp / (e.maxHp || 1)));
      if (e._rdLag !== undefined) {
        if (e._rdLagWait > 0) e._rdLagWait -= dt; else e._rdLag = Math.max(fill, e._rdLag - READABILITY.barLagRate * dt);
      }
      if (e.isBoss || nb >= barRows.length || !(hitT > 0 || (e === t && fill < 1))) continue;
      const row = barRows[nb++];
      row.x = e.pos.x; row.y = e.pos.y + 1.95 * scale + .1; row.z = e.pos.z; row.fill = fill;
      row.lag = Math.max(fill, e._rdLag ?? fill); row.width = Math.min(1.6, .75 + .25 * scale); row.elite = e.isElite ? 1 : 0;
      row.alpha = Math.min(1, Math.max(e === t ? 1 : 0, hitT / .4));
    }
    this.view.setRings(ringRows, nr); this.view.setBars(barRows, nb);
  }
  clear() { this.view?.clear(); this.target = null; }
}
