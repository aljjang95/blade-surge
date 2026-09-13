import { Battle as SoloBattle } from '../game/apex-battle.js';
import { Battle as BaseBattle } from '../game/battle-base.js';
import { Battle as RpgBattle } from '../game/rpg-battle.js';

/** One host advances the shared world; guests only render its snapshots. */
export class Battle extends SoloBattle {
  async start(...args) {
    await super.start(...args);
    if (!this.stage.party) return;
    this.run.enabled = false; this.effects = {}; this.apex = null;
    this.procs.clear(); this.setBonus = []; this.sp.clear();
    this.chronicle.close(); this.chronicle.refresh();
    await this.app.party.prepareActors(this);
  }
  stop() {
    if (this.stage?.party) this.app.party?.disposeActors();
    super.stop();
  }
  spawnEnemy(type, ...args) {
    const enemy = this.stage?.party ? BaseBattle.prototype.spawnEnemy.call(this,type,...args) : super.spawnEnemy(type,...args);
    if (enemy && this.stage?.party) this.app.party.attachEnemy(enemy, type);
    return enemy;
  }
  onEnemyDeath(enemy) {
    if (!this.stage?.party) return super.onEnemyDeath(enemy);
    if (enemy.partyCounted) return;
    enemy.partyCounted = true;
    BaseBattle.prototype.onEnemyDeath.call(this, enemy);
    for (const player of this.app.party.livingPlayers()) if (player !== this.player) player.addUlt(enemy.isBoss ? 30 : 5);
  }
  damageEnemy(enemy, damage, options = {}) {
    if (!this.stage?.party) return super.damageEnemy(enemy, damage, options);
    const hp = enemy.hp;
    RpgBattle.prototype.damageEnemy.call(this, enemy, damage, options);
    const dealt = Math.max(0, hp - enemy.hp);
    if (dealt) this.app.party.hitEvent(enemy, dealt);
  }
  onPlayerDeath(player = this.player) {
    if (!this.stage?.party) return super.onPlayerDeath();
    this.app.party.playerDown(player);
  }
  victory() {
    if (!this.stage?.party) return super.victory();
    if (this.active) this.app.party.finish(true);
  }
  defeat() {
    if (!this.stage?.party) return super.defeat();
    if (!this.active) return;
    if (this.app.party.isHost) this.app.party.finish(false);
    else this.app.party.abort('파티 원정을 떠났습니다.');
  }
  update(dt) {
    if (this.stage?.party && !this.app.party.isHost) return this.app.party.updateGuest(dt);
    super.update(dt);
  }
}
