import * as THREE from 'three';
import { Battle as BaseBattle } from './battle-base.js';
import { ENEMIES } from '../data/stages.js';
import { HEROES, heroStats, levelExp } from '../data/heroes.js';
import { audio } from '../engine/audio.js';
import { ImpactClock, impactStrength } from './combat-motion.js';
import { normalizeRpg, recordMonster, monsterLevel, monsterXp, grantCombatXp, KillLedger } from './rpg-core.js';
import { buildCatalogue } from './rpg-catalogue.js';
import { RpgView } from '../ui/rpg.js';
import '../ui/rpg.css';

const direction = new THREE.Vector3();

/** Additive extension: encounter, damage, gear, skills and stage-clear rewards stay in the base. */
export class Battle extends BaseBattle {
  constructor(app) {
    super(app);
    this.killLedger = new KillLedger(); this.combatXp = 0; this.rpgDirty = false; this.saveT = 0;
    this.feedbackCount = 0; this.feedbackSound = false; this.viewT = 0;
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
    await super.start(...args);
    this.timeCtl = new ImpactClock(); this.killLedger = new KillLedger();
    this.combatXp = 0; this.saveT = 0; this.viewT = 0; this.lastTarget = null;
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
    enemy.speciesId = type; enemy.level = monsterLevel(this.stage.idx, enemy.def);
    enemy.summoned = !!near;
    enemy.xpReward = monsterXp(enemy.def, this.stage.scale, enemy.summoned);
    recordMonster(this.ensureRpg(), type, enemy.level, this.stage.idx);
    this.rpgDirty = true;
    if (enemy.isBoss) this.ui.showBoss(`Lv.${enemy.level} ${enemy.def.name}`, true, enemy.def.portrait);
    return enemy;
  }
  onEnemyDeath(enemy) {
    if (!this.killLedger.claim(enemy)) return;
    const rpg = this.ensureRpg();
    if (enemy.speciesId && Object.hasOwn(ENEMIES, enemy.speciesId)) {
      recordMonster(rpg, enemy.speciesId, enemy.level, this.stage.idx, true);
      const hero = this.app.eco.hero(this.heroId);
      const award = grantCombatXp(hero, enemy.xpReward || 0, levelExp);
      this.combatXp = Math.min(1e9, this.combatXp + award.gained);
      rpg.combatXp = Math.min(1e9, rpg.combatXp + award.gained);
      this.rpgDirty = true;
      if (award.levels) {
        const p = this.player, oldMax = p.maxHp;
        const nextStats = heroStats(HEROES[this.heroId], hero, this.app.eco.heroEquipBonus(this.heroId));
        p.stats = this.upgradeHeroStats?.(nextStats) || nextStats;
        p.maxHp = p.stats.hp; p.heroLevel = hero.level;
        for (const [i, button] of (this.ui.skillBtns || []).entries()) if (p.def.skills[i]) button.classList.toggle('locked', !p.unlocked(i));
        const awakened = p.def.skills.filter(skill => skill.unlock > award.beforeLevel && skill.unlock <= hero.level);
        if (awakened.length) this.ui.awakenBanner(awakened);
        // Preserve missing health, never revive a dead hero or reset skill cooldowns.
        if (p.alive) p.hp = Math.min(p.maxHp, p.hp + Math.max(0, p.maxHp - oldMax));
        this.rpgView.levelUp(award.level, award.levels);
        this.flushRpg();
      }
    }
    super.onEnemyDeath(enemy);
  }
  victory() { this.flushRpg(); super.victory(); if (this.result) this.result.combatXp = this.combatXp; this.rpgView?.refresh(); }
  defeat() { this.flushRpg(); super.defeat(); if (this.result) this.result.combatXp = this.combatXp; this.rpgView?.refresh(); }
  update(realDt) {
    this.feedbackCount = 0; this.feedbackSound = false;
    super.update(realDt);
    if (!Number.isFinite(realDt) || realDt <= 0) return;
    this.saveT += realDt; this.viewT += realDt;
    if (this.saveT >= 1) this.flushRpg();
    if (this.viewT >= 0.1) { this.viewT = 0; this.rpgView.refresh(); }
  }
  damageEnemy(enemy, dmg, opts = {}) {
    const p = this.player;
    if (!p || !enemy?.alive || enemy.spawning || !Number.isFinite(dmg) || dmg <= 0) return;
    const crit = Math.random() < p.stats.crit;
    let amount = dmg * (0.9 + Math.random() * 0.2) * (crit ? p.stats.critDmg : 1);
    if (this.sp) amount *= this.sp.dmgMul(enemy);
    const dealt = enemy.hurt(amount, { ...opts, crit });
    if (!(dealt > 0)) return;
    if (this.sp && !opts.noProc) this.sp.onHit(enemy);
    this.dmgDealt += dealt; this.combo++; this.comboT = 2.5;
    this.maxCombo = Math.max(this.maxCombo, this.combo); this.ui.setCombo(this.combo);
    p.addUlt((crit ? 3 : 2) * (p.stats.ultGain || 1));
    this.lastTarget = enemy;
    const hitPos = enemy.pos.clone().setY(1.1 * enemy.def.scale);
    if (this.fx.dmgLayer.children.length < 26 || crit) this.fx.damage(hitPos, dealt, { crit, kind: opts.kind === 'magic' ? 'skill' : '' });
    if (opts.quiet) return;
    const heavy = !!opts.finisher || crit;
    const dx = opts.dirx || 0, dz = opts.dirz || 0;
    enemy.receiveImpact(dx, dz, impactStrength({ finisher: opts.finisher, crit, boss: enemy.isBoss, elite: enemy.isElite }));
    const color = opts.kind === 'magic' ? 0xa0e0ff : crit ? 0xffd040 : 0xfff0d0;
    // The entire pack shares a small per-frame budget, rather than 30 stacked impacts.
    if (this.feedbackCount++ < 6) {
      this.fx.flash(hitPos, color, { size: heavy ? 2.5 : 1.6, life: 0.12 });
      this.fx.directional(hitPos, direction.set(dx, 0, dz).normalize(), color, { n: heavy ? 10 : 5, speed: heavy ? 11 : 7 });
    }
    if (!this.feedbackSound) {
      this.feedbackSound = true; audio.hit(opts.kind || 'slash', { crit, heavy, finisher: !!opts.finisher });
      if (heavy) audio.vibe(20);
    }
    if (!opts.quietStop) this.timeCtl.hitstop(opts.finisher ? 0.09 : crit ? 0.055 : 0.035);
    // Directional body recoil carries ordinary hits. No added random camera shake.
  }
}
