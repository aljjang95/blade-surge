import * as THREE from 'three';
import { Battle } from './battle-base.js';
import { stageDef } from '../data/stages.js';
import { audio } from '../engine/audio.js';

export const PRACTICE_ENEMIES = 10;

// 기존 던전 킷과 이동 마스크를 재사용하는 닫힌 연습장.
export function practiceStage() {
  const stage = stageDef(1, 1);
  return { ...stage, practice: true, code: '전투 연습', energy: 0, objective: null,
    encounter: null, dungeonBossId: null,
    dungeon: { layout: { spacing: [34, 34], size: [24, 20], sizes: [[24, 20]], width: 6,
      cells: [[2, 2]], edges: [], types: ['start'], labels: ['전투 연습장'] } } };
}

export function practiceSpawnPoints(room) {
  return Array.from({ length: PRACTICE_ENEMIES }, (_, i) => ({
    x: room.x + (i % 5 - 2) * 2.4, z: room.z - 2.5 - Math.floor(i / 5) * 2.6,
  }));
}

/** 실제 전투를 쓰되 연습 처치·종료는 성장/정산 경로에 진입하지 않는다. */
export class PracticeBattle extends Battle {
  constructor(app, onFinish) { super(app); this.onFinish = onFinish; }
  async start() {
    const hero = this.app.eco.hero('knight');
    await super.start(practiceStage(), 'knight', hero, this.app.eco.heroEquipBonus('knight'));
    if (!this.active) return false;
    this.hazards?.dispose(); this.hazards = null; this.timers.length = 0;
    this.player.auto = false; this.player.yaw = Math.PI;
    this.player.pos.z += 2.5;
    this.curRoom.spawned = true; this.curRoom.cleared = false;
    this.waveKilled = 0;
    for (const point of practiceSpawnPoints(this.curRoom))
      this.spawnEnemy('skel_minion', null, this.curRoom, new THREE.Vector3(point.x, 0, point.z));
    this.renderer.rig.target.copy(this.player.pos);
    this.ui.setObjective(this.world);
    return true;
  }
  // 방 이동·보스 포탈·보상·물약 소비는 연습 전투에서 제공하지 않는다.
  enterRoom() {}
  markCleared() {}
  canBossShortcut() { return false; }
  applyConsumable() { return { ok: false, error: '연습에서는 물약을 소비하지 않습니다.' }; }
  canApplyConsumable() { return false; }
  rollDrop() { return null; }
  onEnemyDeath(enemy) {
    if (!this.active) return;
    this.kills++; this.waveKilled++; this.killStreak++; this.killStreakT = 3.4;
    this.ui.setKillStreak(this.killStreak, '연습');
    this.applyKillCombatEffects(enemy);
    this.fx.dustPuff(enemy.pos, { size: 2, life: .6 });
    audio.play('hit_wood', { vol: .3, min: .05 });
  }
  onPlayerDeath() {
    this.preparePlayerDeath();
    if (this.hasProc('phoenix_rebirth') && !this.rebirthUsed) { this.phoenixRebirth(); return; }
    this.defeat();
  }
  update(realDt) {
    if (!this.active) { this.player?.mixer.update(realDt); this.player?.updateCombatPose(realDt); return; }
    super.update(realDt);
    // 피격 특수 효과가 적을 처치하더라도 같은 프레임의 사망/부활 처리를 먼저 마친다.
    if (this.kills === PRACTICE_ENEMIES) this.victory();
  }
  victory() { if (this.player?.alive && this.player.hp > 0) this.finish(true); }
  defeat() { this.finish(false); }
  finish(win) {
    if (!this.active) return;
    this.active = false; this.input.enabled = false; this.input.clear();
    this.pauseReasons.clear(); this.paused = false;
    this.result = { practice: true, win, kills: this.kills, time: this.elapsed, maxCombo: this.maxCombo };
    if (win) { this.player.state = 'idle'; this.player.vel.set(0, 0, 0); this.player.kb.set(0, 0, 0); this.player.stopTrail(); this.player.play('Cheer', { fade: .2 }); audio.play('jingle_win0', { vol: .6 }); }
    this.onFinish(this.result);
  }
}
