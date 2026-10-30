import { skillGateLevel } from '../data/skill-tree.js';
import * as THREE from 'three';
import { Battle as BaseBattle } from './battle-base.js';
import { ENEMIES } from '../data/stages.js';
import { HEROES, heroStats, levelExp } from '../data/heroes.js';
import { audio } from '../engine/audio.js';
import { ImpactClock } from './combat-motion.js';
import { contactFeedback } from './apex-combat.js';
import { CROWD_SPARKS, contactProfile, contactBudget } from './combat-contact.js';
import { HitCrowd, hitWeight, weightedHitstop, flashFor } from './feel.js';
import { CONTROL_MP_GAIN, CONTROL_ULT_GAIN, ultHitGain } from './control-rewards.js';
import { normalizeRpg, recordMonster, monsterLevel, monsterXp, grantCombatXp, KillLedger } from './rpg-core.js';
import { buildCatalogue } from './rpg-catalogue.js';
import { slainOf, recordSlain } from './kill-ledger.js';
import { stageExpeditionEncounter, encounterLevelLabel } from './rpg-encounters.js';
import { RpgView } from '../ui/rpg.js';
import { frontierEffectForStage } from '../data/seasonal-content.js';
import '../ui/rpg.css';
import { withAvatarSpeed } from '../data/avatars.js';

const direction = new THREE.Vector3();
// 데미지 숫자 동시 표시 상한(fx.maxDmg 40 이내)과 프레임당 신규 표시 상한
const DMG_CAP = 12, DMG_CAP_CRIT = 20, DMG_PER_FRAME = 6;

/** Additive extension: encounter, damage, gear, skills and stage-clear rewards stay in the base. */
export class Battle extends BaseBattle {
  constructor(app) {
    super(app);
    this.killLedger = new KillLedger(); this.combatXp = 0; this.rpgDirty = false; this.saveT = 0;
    this.feedbackCount = 0; this.feedbackSound = false; this.viewT = 0; this.hitCrowd = new HitCrowd();
    this.ensureRpg();
    this.rpgView = new RpgView(app, this, buildCatalogue(), { heroStats, levelExp, HEROES });
    app.eco.onChange(() => { this.ensureRpg(); this.rpgView.refresh(); });
    this._flushHidden = () => { if (document.hidden) this.flushRpg(); };
    document.addEventListener('visibilitychange', this._flushHidden);
    window.addEventListener('pagehide', () => this.flushRpg());
  }
  ensureRpg() {
    if (this.rpgState !== this.app.eco.s) {
      this.rpgState = this.app.eco.s;
      this.rpgState.rpg = normalizeRpg(this.rpgState.rpg, Object.keys(ENEMIES));
      // 처치 원장 도입 전 저장: 기기 도감의 처치 수를 한 번 옮긴다(로컬은 신뢰 경계 밖이라 상한 없음).
      // 서버 권위 계정은 서버 문서의 slain 이 덮어쓴다(서버 병합은 가져오기의 trustedSlain, docs/SERVER_AUTHORITY_GATES.md 3절).
      const slain = slainOf(this.rpgState);
      if (!slain.seeded) {
        for (const [id, r] of Object.entries(this.rpgState.rpg.bestiary)) if (r.kills > 0) recordSlain(this.rpgState, id, r.kills);
        slain.seeded = true;
      }
    }
    return this.rpgState.rpg;
  }
  flushRpg() {
    if (!this.rpgDirty) return true;
    const saved = this.app.eco.save();
    this.rpgDirty = !saved; this.saveT = 0;
    if (!saved && !this.storageWarned) { this.storageWarned = true; this.ui.toast('성장 기록을 저장하지 못했습니다. 이 창을 닫기 전에 저장 권한을 확인해 주세요.', 'red'); }
    if (saved) this.storageWarned = false;
    return saved;
  }
  async start(...args) {
    const [, heroId, hero] = args;
    const growthStart = hero ? Object.freeze({ heroId, level: hero.level, exp: hero.exp }) : null;
    const pendingStart = super.start(...args);
    const generation = this._startGeneration;
    await pendingStart;
    // A cancelled model load may finish after a newer run is already fighting.
    // Do not replace that run's XP ledger or growth snapshot from the old call.
    if (generation !== this._startGeneration) return;
    this.growthStart = growthStart;
    this.timeCtl = new ImpactClock(); this.killLedger = new KillLedger(); this.hitCrowd = new HitCrowd();
    this.combatXp = 0; this.legendXp = 0; this.levelUpsInBattle = 0; this.saveT = 0; this.viewT = 0; this.lastTarget = null;
    this.ensureRpg(); this.rpgView?.refresh();
  }
  stop() {
    this.flushRpg(); this.rpgView?.close();
    super.stop();
    this.lastTarget = null; this.rpgView?.refresh();
  }
  setPaused(reason, on) {
    super.setPaused(reason, on);
    if (on) this.flushRpg();
  }
  spawnEnemy(type, near = null, room = null, at = null) {
    const enemy = super.spawnEnemy(type, near, room, at);
    if (!enemy) return enemy;
    const encounter = stageExpeditionEncounter(this.stage);
    enemy.speciesId = enemy.runtimeSpeciesId || type; enemy.level = encounter ? null : monsterLevel(this.stage.idx, enemy.def);
    enemy.summoned = !!near;
    enemy.xpReward = monsterXp(enemy.def, this.stage.scale, enemy.summoned);
    // 고통 단계는 처치 EXP 도 단계마다 늘어난다(지옥 × (1 + 0.1×단계), docs/SPEC_720H.md 3.2).
    if (this.stage.campaignDifficulty?.combatExpMul > 1) enemy.xpReward = Math.floor(enemy.xpReward * this.stage.campaignDifficulty.combatExpMul);
    const effect = frontierEffectForStage(this.stage);
    if (enemy.isElite && effect?.kind === 'eliteXpMultiplier') enemy.xpReward = Math.floor(enemy.xpReward * effect.value);
    recordMonster(this.ensureRpg(), enemy.speciesId, enemy.level, this.stage.idx, false, encounter);
    this.rpgDirty = true;
    if (enemy.isBoss) this.ui.showBoss(`${encounterLevelLabel(this.stage, enemy.level)} ${enemy.def.name}`, true, enemy.def.portrait);
    return enemy;
  }
  onEnemyDeath(enemy) {
    // Result presentation keeps animation timers alive, but its reward ledger is closed.
    if (!this.active) return;
    if (!this.killLedger.claim(enemy)) return;
    audio.kill({ boss: !!enemy.isBoss, elite: !!enemy.isElite });
    const rpg = this.ensureRpg();
    // 무리 졸개는 도감 처치·경험치에 넣지 않는다(기존 명단 보상만 유지).
    if (enemy.speciesId && Object.hasOwn(ENEMIES, enemy.speciesId) && !enemy.packFollower) {
      recordMonster(rpg, enemy.speciesId, enemy.level, this.stage.idx, true, stageExpeditionEncounter(this.stage));
      if (!this.stage.party) recordSlain(this.app.eco.s, enemy.speciesId);
      const hero = this.app.eco.hero(this.heroId);
      const award = grantCombatXp(hero, enemy.xpReward || 0, levelExp);
      this.combatXp = Math.min(1e9, this.combatXp + award.gained);
      // Lv.80 이후 처치 EXP 는 전설 수련으로(계정 공통). 정산 영수증의 legend 에 함께 모인다.
      if (award.overflow > 0 && this.app.eco.grantLegend) { this.app.eco.grantLegend(award.overflow); this.legendXp = Math.min(1e12, (this.legendXp || 0) + award.overflow); }
      rpg.combatXp = Math.min(1e9, rpg.combatXp + award.gained);
      this.rpgDirty = true;
      if (award.levels) {
        this.app.funnel?.track('hero_level_up', { source: 'combat', level: hero.level });
        const p = this.player, oldMax = p.maxHp;
        const bonus = this.app.eco.heroEquipBonus(this.heroId);
        // 출격 때와 같은 아바타 이동속도를 다시 얹는다(레벨업 재계산이 지우지 않게).
        const nextStats = withAvatarSpeed(heroStats(p.def || HEROES[this.heroId], hero, bonus), bonus, { party: !!this.stage?.party });
        p.stats = this.upgradeHeroStats?.(nextStats) || nextStats;
        p.maxHp = p.stats.hp; p.heroLevel = hero.level;
        for (const [slot, button] of (this.ui.skillBtns || []).entries()) { const i = p.combatSkillIndex ? p.combatSkillIndex(slot) : slot; if (p.def.skills[i]) button.classList.toggle('locked', !p.unlocked(i)); }
        const awakened = p.def.skills.filter(skill => skill.unlock > award.beforeLevel && skill.unlock <= hero.level);
        if (awakened.length) this.ui.awakenBanner(awakened);
        // 기본 스킬 단계 해금(skill-tree.js BASIC_SKILL_GATES·ULT_GATE_LEVEL): 레벨이 오르는 순간 새 스킬이 열렸음을 알린다.
        const opened = p.def.skills.filter((skill, i) => !skill.unlock && skillGateLevel(p.def, i) > award.beforeLevel && skillGateLevel(p.def, i) <= hero.level);
        if (opened.length) { this.ui.waveBanner(`새 스킬 — ${opened[0].name}`); this.ui.toast(`Lv.${hero.level} · <b>${opened.map((sk) => sk.name).join(', ')}</b> 사용 가능`, 'gold'); }
        // Preserve missing health, never revive a dead hero or reset skill cooldowns.
        if (p.alive) p.hp = Math.min(p.maxHp, p.hp + Math.max(0, p.maxHp - oldMax));
        // 레벨업 순간을 영웅 발밑에서 보여 준다: 충격파·오로라 기둥·불씨 + 상승 SFX + 머리 위 레벨 숫자(0.9초, 흔들림 없음).
        if (p.alive && p.pos) {
          this.fx?.levelUpBurst?.(p.pos, (p.def || HEROES[this.heroId])?.color || 0x7feac0);
          this.fx?.damage?.(p.pos, 0, { text: `Lv.${hero.level}`, kind: 'levelup' });
          audio.levelUp({ vol: 0.55 });
          // 실제로 연출을 보여 준 레벨업만 센다(결과 화면이 소리를 낮출지 정한다).
          this.levelUpsInBattle = (this.levelUpsInBattle || 0) + award.levels;
        }
        this.rpgView.levelUp(award.level, award.levels);
        this.flushRpg();
      }
    }
    super.onEnemyDeath(enemy);
  }
  victory() { this.flushRpg(); super.victory(); if (this.result) { this.result.combatXp = this.combatXp; this.result.legendXp = this.legendXp || 0; this.result.growthStart = this.growthStart; } this.rpgView?.refresh(); }
  defeat() { this.flushRpg(); super.defeat(); if (this.result) { this.result.combatXp = this.combatXp; this.result.legendXp = this.legendXp || 0; this.result.growthStart = this.growthStart; } this.rpgView?.refresh(); }
  update(realDt) {
    this.feedbackCount = 0; this.feedbackSound = false; this.dmgFrame = 0;
    super.update(realDt);
    if (!Number.isFinite(realDt) || realDt <= 0) return;
    this.saveT += realDt; this.viewT += realDt;
    if (this.saveT >= 1) this.flushRpg();
    if (this.viewT >= 0.1) { this.viewT = 0; this.rpgView.refresh(); }
  }
  damageEnemy(enemy, dmg, opts = {}) {
    if (!this.active) return;
    const p = opts.source?.stats ? opts.source : this.player;
    if (!p || !enemy?.alive || enemy.spawning || !Number.isFinite(dmg) || dmg <= 0) return;
    const crit = Math.random() < p.stats.crit;
    let amount = dmg * (0.9 + Math.random() * 0.2) * (crit ? p.stats.critDmg : 1);
    if (this.sp) amount *= this.sp.dmgMul(enemy);
    // attacker: 보스 후방 노출이 등 뒤·정면을 공격자 위치로 가른다(BUNDLE-14).
    const dealt = enemy.hurt(amount, { ...opts, crit, attacker: p });
    if (!(dealt > 0) && !(enemy.absorbed > 0)) return;   // 종지기의 종이 전부 받아 낸 타격(dealt 0)도 맞은 것이다
    if (this.sp && !opts.noProc) this.sp.onHit(enemy, opts);
    this.readability?.hit(enemy, dealt, crit, p);
    this.dmgDealt += dealt; this.combo++; this.comboT = 2.5; audio.comboStep(this.combo);
    this.maxCombo = Math.max(this.maxCombo, this.combo); this.ui.setCombo(this.combo);
    const gain = ultHitGain({ basic: opts.basic === true, crit });
    if (gain) p.addUlt(gain * (p.stats.ultGain || 1));
    const finisherTokens = this.controlFinisherTokens || (this.controlFinisherTokens = new WeakSet());
    if (opts.basic && opts.finisher && opts.comboToken && !finisherTokens.has(opts.comboToken)) {
      finisherTokens.add(opts.comboToken); p.addUlt(CONTROL_ULT_GAIN.comboFinisher * (p.stats.ultGain || 1)); p.addMp?.(CONTROL_MP_GAIN.comboFinisher);
    }
    this.lastTarget = enemy;
    const hitPos = enemy.pos.clone().setY(1.1 * enemy.def.scale);
    // 동시 숫자 상한을 키우되 한 프레임에 새로 띄우는 수는 제한해 군중 타격에서 DOM 갱신이 몰리지 않게 한다.
    if (dealt > 0 && this.fx.dmgLayer.children.length < (crit||opts.finisher?DMG_CAP_CRIT:DMG_CAP) && (this.dmgFrame = (this.dmgFrame | 0) + 1) <= DMG_PER_FRAME) this.fx.damage(hitPos, dealt, {
      crit, kind: opts.kind === 'magic' ? 'skill' : '', finisher: !!opts.finisher, boss: !!enemy.isBoss,
      heavy: contactProfile(opts, crit, enemy.isBoss, true)?.heavy,
    });
    const contact = this.paused ? null : contactProfile(opts, crit, enemy.isBoss, !!this.app.reducedMotion?.matches);
    if (!contact) return;
    const dx = opts.dirx || 0, dz = opts.dirz || 0;
    const feedback=contactFeedback({finisher:opts.finisher,crit,boss:enemy.isBoss,elite:enemy.isElite,reduced:!!this.app.reducedMotion?.matches});
    enemy.receiveImpact(dx, dz, feedback.recoil);
    // 타격 무게(큰 피해 비율·군중 동시 타격·정예·결정타)가 정지와 섬광을 키운다. 같은 창의 모든 타격이 무게에 기여하므로 예산 밖 타격도 센다.
    const weight = hitWeight({ dealt, maxHp: enemy.maxHp, crowd: (this.hitCrowd || (this.hitCrowd = new HitCrowd())).hit(this.elapsed, enemy), elite: enemy.isElite, killed: !enemy.alive });
    if (contact.stop > 0) {
      this.timeCtl.hitstop(weightedHitstop(contact.stop, weight));
      const flash = flashFor(weight);
      if (weight > .05 && flash.sec > enemy.flashT) enemy.flash(crit ? 0xffd040 : opts.tint ?? 0xffffff, flash.sec, opts.tint && !crit ? flash.gain * .6 : flash.gain);
    }
    // 수동 평타가 맞을 때마다 카메라 구도를 대상 쪽으로 당기지 않는다(사용자 시점 유지).
    // Every eligible hit recoils; only expensive contact feedback shares the time budget.
    const budget = contactBudget(this._contactBudget, this.elapsed, contact);
    // tint(숲의 속박 화살): 다섯 발 관통이 겹쳐 맞히는 적을 크림 섬광이 덮지 않게 색·크기만 바꾼다(호출 수·난수 그대로, battle-base 와 같은 규칙).
    const color = opts.tint && !crit ? opts.tint : opts.kind === 'magic' ? 0xa0e0ff : crit ? 0xffd040 : 0xfff0d0, tintK = opts.tint ? .6 : 1;
    if (!budget) {
      // 같은 60ms 창에 함께 맞은 다른 적도 접점 섬광을 받는다(정지·소리·진동은 창당 한 번 그대로).
      // 휘두르기 한 번에 여럿이 맞으면 첫 적만 번쩍여 군중 타격이 비어 보였다. 각도를 정해 난수 흐름은 건드리지 않는다.
      // 동작 줄이기에서는 주 접점 하나만 남긴다. 이번 창에서 이미 번쩍인 적(고정 3칸)은 다시 쓰지 않는다.
      const sparked = this._crowdSparked || (this._crowdSparked = new Array(CROWD_SPARKS).fill(null)), n = this._crowdSparks | 0;
      let seen = enemy === this._contactLast;
      for (let i = 0; i < n && !seen; i++) seen = sparked[i] === enemy;
      if (!seen && contact.particles > 0 && n < CROWD_SPARKS && this.feedbackCount++ < 6) {
        sparked[n] = enemy; this._crowdSparks = n + 1;
        this.fx.flash?.(hitPos, color, { size: contact.size * .75 * tintK, life: .09, angle: this._crowdSparks * 1.9 });
      }
      return;
    }
    this._contactBudget = budget; this._contactAt = budget.at;
    if (budget.emit) { this._crowdSparks = 0; this._contactLast = enemy; }
    // The entire pack shares a small per-frame budget, rather than 30 stacked impacts.
    if (budget.emit && this.feedbackCount++ < 6) {
      this.fx.contact(hitPos,direction.set(dx,0,dz).normalize(),color,{size:contact.size*tintK,particles:contact.particles,light:false,kind:opts.kind||'slash',tier:contact.tier,crit});
    }
    {
      audio.hit(opts.kind || 'slash', { crit, heavy:contact.heavy || crit || !!enemy.isBoss, finisher: !!opts.finisher, boss: !!enemy.isBoss, counter: !!opts.counter, weapon: p.def?.weapon, light: !opts.basic && !opts.finisher });
      if (p === this.player && !p.auto && contact.haptic) audio.vibe(contact.haptic);
      if (opts.basic) p.receiveStrikeRecoil?.(opts.finisher ? 1 : crit ? .8 : .55);
    }
    // 명중은 화면 전체 카메라 킥·줌 없이 대상 반동·몸 반동·VFX·히트스톱·소리·진동으로 전달한다.
    // 색수차는 마무리타에서만 짧게 다시 켠다(감쇠·상한은 렌더러가 소유한다).
    if (opts.finisher && this.renderer) this.renderer.aberr = Math.max(this.renderer.aberr || 0, 0.7);
  }
}
