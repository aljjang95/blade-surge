import { CompanionAgent, type CompanionContext, type CompanionSnapshot, type CompanionTactic } from './companion-agent';
import { CompanionCombatant } from './combatant.js';
import { DialogueError, requestDialogue, type DialogueTransport } from './dialogue-client';

export function safeCompanionStorage(): Storage | undefined {
  try { return typeof window !== 'undefined' ? window.localStorage : undefined; }
  catch { return undefined; }
}

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
  showcase?: { def?: { name?: string } };
  eco?: { s?: { selected?: string; settings?: { quality?: CompanionSnapshot['quality'] } }; heroPower?: (id: string) => number; nextStage?: () => { idx: number } };
}

export class CompanionDirector {
  readonly mind: CompanionAgent;
  private readonly app: AppLike;
  private battle: BattleLike | null = null;
  private actor: CompanionCombatant | null = null;
  private telemetryT = 0;
  private lowHpAnnounced = false;
  private epoch = 0;
  private pending: AbortController | null = null;
  private proposalEpoch = -1;
  private proposalUntil = 0;
  private nextRequestAt = 0;

  constructor(app: AppLike, storage: Storage | undefined = safeCompanionStorage(),
    private readonly transport: DialogueTransport = requestDialogue) {
    this.app = app;
    this.mind = new CompanionAgent({ storage });
    this.syncQuality();
  }

  syncQuality(): void {
    const quality = this.app.eco?.s?.settings?.quality;
    this.mind.setQuality(quality === 'low' || quality === 'mid' ? quality : 'high');
  }

  syncLobbyContext(): void {
    if (this.app.mode !== 'lobby') return;
    const name = this.app.showcase?.def?.name;
    const hero = this.app.eco?.s?.selected;
    if (!name || !hero) return;
    this.mind.updateContext({ mode: 'lobby', heroName: name, floor: this.app.eco?.nextStage?.().idx ?? 1,
      hpRatio: 1, enemiesNear: 0, combo: 0, roomsCleared: 0, totalRooms: 0, bossName: '', power: this.app.eco?.heroPower?.(hero) ?? 0 });
  }

  subscribe = (listener: () => void): (() => void) => this.mind.subscribe(listener);
  getSnapshot = (): CompanionSnapshot => this.mind.getSnapshot();

  setOpen(open: boolean): void {
    if (open) { this.syncQuality(); this.syncLobbyContext(); }
    if (this.mind.getSnapshot().open === open) return;
    if (!open) this.cancelDialogue();
    if (this.battle?.player) this.battle.setPaused('dialogue', open);
    this.mind.setOpen(open);
  }

  toggleOpen(): void {
    this.setOpen(!this.mind.getSnapshot().open);
  }

  setTactic(tactic: CompanionTactic): void {
    this.cancelDialogue();
    this.mind.setTactic(tactic);
    this.actor?.setTactic(tactic);
  }

  reply(input: string): string | null {
    this.cancelDialogue();
    this.syncLobbyContext();
    const before = this.mind.getSnapshot().tactic;
    const reply = this.mind.reply(input);
    const after = this.mind.getSnapshot().tactic;
    if (before !== after) this.actor?.setTactic(after);
    return reply;
  }

  async ask(rawInput: string): Promise<void> {
    this.syncLobbyContext();
    const input = rawInput.trim().slice(0, 240), snapshot = this.mind.getSnapshot();
    if (!input || !snapshot.open || this.pending) return;
    if (Date.now() < this.nextRequestAt) {
      this.mind.resetDialogue(`잠시 숨을 고르고 ${Math.ceil((this.nextRequestAt - Date.now()) / 1000)}초 뒤 다시 말해 주세요.`);
      return;
    }
    const controller = new AbortController(), epoch = this.epoch;
    this.pending = controller;
    this.nextRequestAt = Date.now() + 15000;
    this.mind.beginDialogue(input);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply = await Promise.race([
        this.transport({ requestId: crypto.randomUUID(), input,
          history: snapshot.messages.slice(-4).map(({ role, text }) => ({ role, text: text.slice(0, 360) })), context: snapshot.context,
        }, controller.signal),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new DialogueError()); }, 24000); }),
      ]);
      if (this.pending !== controller || this.epoch !== epoch || !this.mind.getSnapshot().open || controller.signal.aborted) return;
      this.proposalEpoch = epoch;
      this.proposalUntil = Date.now() + 60000;
      this.mind.finishDialogue(reply.reply, reply.tactic);
    } catch (error) {
      if (this.pending !== controller || this.epoch !== epoch) return;
      if (error instanceof DialogueError) this.nextRequestAt = Math.max(this.nextRequestAt, Date.now() + error.retryAfter * 1000);
      this.mind.resetDialogue('지금은 대답을 듣기 어렵습니다. 잠시 뒤 다시 말해 주세요. 전술 선택은 계속 사용할 수 있습니다.');
    } finally {
      if (timeout) clearTimeout(timeout);
      if (this.pending === controller) this.pending = null;
    }
  }

  applyProposal(): void {
    const snapshot = this.mind.getSnapshot();
    if (!snapshot.open || !snapshot.proposedTactic || this.proposalEpoch !== this.epoch || Date.now() > this.proposalUntil
      || (this.battle && (!this.battle.active || !this.battle.player?.alive))) { this.mind.resetDialogue(); return; }
    this.setTactic(snapshot.proposedTactic);
  }

  cancelDialogue(): void {
    this.epoch++;
    this.pending?.abort();
    this.pending = null;
    this.proposalEpoch = -1;
    this.proposalUntil = 0;
    this.mind.resetDialogue();
  }

  reset(): boolean {
    this.endBattle();
    this.nextRequestAt = 0;
    return this.mind.reset();
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
    if (event === 'victory' || event === 'defeat') this.cancelDialogue();
    this.mind.observe(event, detail);
  }

  endBattle(disconnect = true): void {
    this.cancelDialogue();
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
