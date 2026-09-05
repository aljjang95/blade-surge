import { CompanionAgent, type CompanionContext, type CompanionSnapshot, type CompanionTactic } from './companion-agent';
import { CompanionCombatant } from './combatant.js';

interface PositionLike {
  x: number;
  z: number;
}

interface EnemyLike {
  alive: boolean;
  spawning: boolean;
  isBoss?: boolean;
  isElite?: boolean;
  def?: { name?: string };
  pos: PositionLike;
}

interface BattleLike {
  active: boolean;
  paused: boolean;
  setPaused(reason: string, on: boolean): void;
  input?: {
    enabled: boolean;
    clear(): void;
  };
  stage?: { idx?: number };
  player?: {
    alive: boolean;
    hp: number;
    maxHp: number;
    comboIdx?: number;
    def?: { name?: string };
    stats?: { power?: number };
    pos: PositionLike;
  };
  enemies: EnemyLike[];
  boss?: EnemyLike | null;
  combo: number;
  roomsCleared: number;
  world?: { rooms?: unknown[] };
}

interface AppLike {
  mode: 'boot' | 'lobby' | 'battle';
  battle?: BattleLike;
  models: Record<string, unknown>;
  eco?: { s?: { settings?: { quality?: CompanionSnapshot['quality'] } } };
}

export class CompanionDirector {
  readonly mind: CompanionAgent;
  private readonly app: AppLike;
  private battle: BattleLike | null = null;
  private actor: CompanionCombatant | null = null;
  private telemetryT = 0;
  private lowHpAnnounced = false;

  constructor(app: AppLike, storage: Storage | undefined = typeof window !== 'undefined' ? window.localStorage : undefined) {
    this.app = app;
    this.mind = new CompanionAgent({ storage });
    this.syncQuality();
  }

  syncQuality(): void {
    const quality = this.app.eco?.s?.settings?.quality;
    this.mind.setQuality(quality === 'low' || quality === 'mid' ? quality : 'high');
  }

  subscribe = (listener: () => void): (() => void) => this.mind.subscribe(listener);
  getSnapshot = (): CompanionSnapshot => this.mind.getSnapshot();

  setOpen(open: boolean): void {
    if (open) this.syncQuality();
    if (this.mind.getSnapshot().open === open) return;
    if (this.battle?.player) this.battle.setPaused('dialogue', open);
    this.mind.setOpen(open);
  }

  toggleOpen(): void {
    this.setOpen(!this.mind.getSnapshot().open);
  }

  setTactic(tactic: CompanionTactic): void {
    this.mind.setTactic(tactic);
    this.actor?.setTactic(tactic);
  }

  reply(input: string): string | null {
    const before = this.mind.getSnapshot().tactic;
    const reply = this.mind.reply(input);
    const after = this.mind.getSnapshot().tactic;
    if (before !== after) this.actor?.setTactic(after);
    return reply;
  }

  startBattle(battle: BattleLike): void {
    this.endBattle(false);
    this.battle = battle;
    if (this.mind.getSnapshot().open && battle.player) {
      battle.setPaused('dialogue', true);
    }
    this.syncQuality();
    this.mind.setConnected(true);
    this.updateTelemetry(battle);
    const model = this.app.models.Skeleton_Mage;
    if (model && battle.player) {
      this.actor = new CompanionCombatant(battle, model, (event: string) => this.mind.observe(event));
      this.actor.setTactic(this.mind.getSnapshot().tactic);
      this.actor.pos.set(battle.player.pos.x + 1.2, 0, battle.player.pos.z + 1.5);
    }
    this.mind.observe('battle-start', { floor: battle.stage?.idx ?? 1 });
  }

  updateBattle(battle: BattleLike, dt: number, realDt: number): void {
    if (battle !== this.battle) this.battle = battle;
    this.actor?.setTactic(this.mind.getSnapshot().tactic);
    this.actor?.update(dt);
    this.telemetryT -= realDt;
    if (this.telemetryT <= 0) {
      this.telemetryT = 0.25;
      this.updateTelemetry(battle);
      const hpRatio = battle.player ? battle.player.hp / battle.player.maxHp : 1;
      if (hpRatio < 0.27 && !this.lowHpAnnounced) {
        this.lowHpAnnounced = true;
        this.mind.observe('low-hp', { floor: battle.stage?.idx ?? 0 });
      } else if (hpRatio > 0.48) {
        this.lowHpAnnounced = false;
      }
    }
  }

  observe(event: string, detail: Record<string, unknown> = {}): void {
    this.mind.observe(event, detail);
  }

  endBattle(disconnect = true): void {
    if (this.actor) {
      this.actor.dispose();
      this.actor = null;
    }
    this.battle?.setPaused('dialogue', false);
    this.battle = null;
    this.lowHpAnnounced = false;
    if (disconnect) {
      this.mind.setConnected(false);
      this.mind.updateContext({ ...this.mind.getSnapshot().context, mode: 'lobby', enemiesNear: 0, combo: 0, bossName: '' });
    }
  }

  private updateTelemetry(battle: BattleLike): void {
    const player = battle.player;
    if (!player) return;
    const near = battle.enemies.reduce((count, enemy) => {
      if (!enemy.alive || enemy.spawning) return count;
      return Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.z - player.pos.z) < 9 ? count + 1 : count;
    }, 0);
    const context: CompanionContext = {
      mode: 'battle',
      heroName: player.def?.name ?? '모험가',
      floor: battle.stage?.idx ?? 1,
      hpRatio: Math.max(0, Math.min(1, player.hp / Math.max(1, player.maxHp))),
      enemiesNear: near,
      combo: battle.combo || 0,
      roomsCleared: battle.roomsCleared || 0,
      totalRooms: battle.world?.rooms?.length ?? 0,
      bossName: battle.boss?.alive ? battle.boss.def?.name ?? '보스' : '',
      power: player.stats?.power ?? 0,
    };
    this.mind.updateContext(context);
  }
}
