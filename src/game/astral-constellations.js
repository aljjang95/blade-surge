import { Vector3 } from 'three';

// All progress and choice receipts live in the route controller; the view is a
// projection, and Battle retains room rewards, seal, victory and settlement.
export class AstralConstellations {
  #progress = 0;
  #read = 0;
  #hold = 0;
  #selected = null;
  #confirm = null;
  #wrongLatch = false;
  #mistakes = 0;
  #feedback = '';
  #closed = false;
  #report = null;
  #lastHp = null;
  #interruptedFrame = false;
  #lastHint = '';
  #combat = false;
  #viewPromise = null;
  view = null;
  holdingAllowed = false;

  constructor(def, world) {
    this.def = def; this.world = world;
    const flow = world.buildFlow(world.startRoom.x, world.startRoom.z);
    const reachable = point => {
      if (!flow || !Number.isFinite(world.minX) || !Number.isFinite(world.minZ) || !Number.isInteger(world.cols)) return false;
      const x = Math.floor(point.x - world.minX), z = Math.floor(point.z - world.minZ);
      return x >= 0 && x < world.cols && z >= 0 && z * world.cols + x < flow.length && flow[z * world.cols + x] >= 0;
    };
    this.rooms = new Map(world.rooms.map(room => [room, {
      room, pos: new Vector3(room.x, 0, room.z), prepared: false, expected: 0, spawnCount: 0,
    }]));
    this.gates = def.gates.map(({ roomId, stationId, label, answer }) => {
      const room = world.rooms.find(r => r.id === roomId);
      if (!room || ['start', 'boss'].includes(room.type) || !reachable(room) || !def.choices.some(c => c.id === answer)) {
        throw new RangeError(`조율판 ${stationId}에 봉인 밖 접근 경로/단서가 없습니다.`);
      }
      const pads = def.choices.map(choice => ({ ...choice, pos: new Vector3(room.x + choice.dx, 0, room.z + choice.dz) }));
      // A walking hero and the entire circle must fit; never publish a pad only
      // because its center happens to occupy a reachable Floor cell.
      for (const pad of pads) {
        if (!reachable(pad.pos)) throw new RangeError(`조율판 ${stationId}/${pad.code}에 접근할 수 없습니다.`);
        for (let i = 0; i < 8; i++) {
          const angle = i * Math.PI / 4, margin = def.radius + .6;
          if (!reachable({ x: pad.pos.x + Math.cos(angle) * margin, z: pad.pos.z + Math.sin(angle) * margin })) {
            throw new RangeError(`조율판 ${stationId}/${pad.code}의 판정 영역이 막혀 있습니다.`);
          }
        }
      }
      room.label = label; room.objectiveProp = 'astral-constellation';
      return Object.assign(this.rooms.get(room), { stationId, label, answer, pads, ready: false, available: false, attuned: false });
    });
  }
  get progress() { return this.#progress; }
  get read() { return this.#read; }
  get hold() { return this.#hold; }
  get mistakes() { return this.#mistakes; }
  get complete() { return this.#progress === this.gates.length; }
  get closed() { return this.#closed || !!this.#report; }
  get coexistsAttunement() { return false; }
  get selected() { return this.#selected; }
  get revealed() { return this.#read + 1e-9 >= this.def.readSeconds; }
  get phase() {
    if (this.complete) return 'complete';
    if (!this.gates[this.#progress]?.available) return 'combat';
    return this.#wrongLatch ? 'retry' : this.revealed ? 'select' : 'read';
  }
  get feedback() { return this.#feedback; }
  allowsAttunement(_room) { return false; }
  // Generic frost disks must not turn a cleared station into an unannounced
  // damage test. Live enemies still suspend all interaction and visual clues.
  ownsHazards(room) { return !this.closed && this.gates.some(g => g.room === room && g.ready && !g.attuned); }
  async prepareView(scene) {
    if (this.closed || this.view) return;
    if (!this.#viewPromise) this.#viewPromise = (async () => {
      const { AstralConstellationView } = await import('./astral-constellation-view.js');
      if (!this.closed) this.view = new AstralConstellationView(scene, this);
    })().finally(() => { this.#viewPromise = null; });
    await this.#viewPromise;
  }
  autoRoom() { return this.closed ? null : this.gates[this.#progress]?.room || null; }
  autoPoint(room) {
    const gate = this.gates[this.#progress];
    if (this.closed || gate?.room !== room || !gate.available) return null;
    return this.revealed && !this.#wrongLatch ? gate.pads.find(p => p.id === gate.answer).pos : gate.pos;
  }
  interrupt() {
    this.#read = 0; this.#hold = 0; this.#selected = null; this.#confirm = null; this.holdingAllowed = false;
    for (const gate of this.gates) gate.available = false;
    this.view?.update();
  }
  inCombat(game, gate) {
    return game.enemies.some(e => e.alive && (e.homeRoom === gate.room || e.pos &&
      Math.hypot(e.pos.x - game.player.pos.x, e.pos.z - game.player.pos.z) <= this.def.combatRadius));
  }
  observePlayer(player) {
    const stable = player?.alive && ['idle', 'move'].includes(player.state);
    const damaged = Number.isFinite(this.#lastHp) && player?.hp < this.#lastHp;
    this.#lastHp = player?.hp ?? null;
    const game = player?.game, gate = this.gates[this.#progress];
    // Battle observes once more after enemy/projectile updates. An adjacent
    // pursuer entering the radius in that pass must hide the clue immediately,
    // including the frame before its first successful hit.
    const combat = game?.world === this.world && gate?.ready && this.inCombat(game, gate);
    if (combat) this.#combat = true;
    if (!stable || damaged || combat) {
      this.interrupt(); this.#interruptedFrame = true;
      if (game?.world === this.world) this.refreshHint(game);
    }
  }
  stop() { this.#closed = true; this.interrupt(); this.view?.dispose(); this.view = null; }
  prepareRoom(room, count) {
    const state = this.rooms.get(room);
    if (state && !state.prepared) {
      if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('조율판 방의 생성 수가 유효하지 않습니다.');
      state.prepared = true; state.expected = count;
    }
  }
  spawn(room) { const state = this.rooms.get(room); if (state) state.spawnCount++; }
  enemiesCleared(game, state) {
    return state.prepared && state.room.spawned && state.spawnCount >= state.expected &&
      !game.enemies.some(e => e.alive && e.homeRoom === state.room) && !game.pending.some(n => n.room === state.room);
  }
  combatPending(game, room) {
    const state = this.rooms.get(room);
    return !!state && !this.enemiesCleared(game, state);
  }
  beforeClear(game, room) {
    const gate = this.gates.find(g => g.room === room);
    if (!gate || gate.attuned) return false;
    if (!this.closed && game.active && !game.paused && this.enemiesCleared(game, gate) && !gate.ready) {
      gate.ready = true;
      game.ui.toast(`${gate.label} 정화 · ${gate === this.gates[this.#progress] ? '모래시계 단서를 읽으세요' : '복원 순서 대기'}`, 'gold');
      this.refreshHint(game);
    }
    return true;
  }
  canUnseal() { return !this.closed && this.complete && this.world.rooms.every(r => ['start', 'boss'].includes(r.type) || r.cleared); }
  canWin() { return this.canUnseal() && !this.world.sealed && this.world.bossRoom.cleared; }
  hint() {
    const gate = this.gates[this.#progress], n = this.gates.length;
    if (!gate) return `별자리 ${n}/${n} 복원 · ${this.canUnseal() ? '레비아탄 처치' : '남은 구역 정화'}`;
    const prefix = `별자리 ${this.#progress}/${n} · ${gate.label}`;
    if (!gate.ready || this.#combat) return `${prefix} · 전투 중 · 단서 중단`;
    if (!gate.available) return `${prefix} · 모래시계로 이동`;
    const clue = gate.pads.find(p => p.id === gate.answer), identity = `${clue.code} ${clue.glyph} ${clue.name}`;
    if (this.#wrongLatch) return `${prefix} · 오답 · 판 밖으로 나와 재시도`;
    if (!this.revealed) return `${prefix} · 단서 ${identity} (${this.#read.toFixed(1)}/1초)`;
    return `${prefix} · ${identity} 판 1초 (${this.#hold.toFixed(1)}/1) · 공격/회피 시 초기화`;
  }
  refreshHint(game) {
    const hint = this.hint();
    if (hint !== this.#lastHint) { this.#lastHint = hint; game.ui.setObjective(this.world); }
  }
  update(game, dt) {
    if (this.closed || !game.active || game.paused || !game.player?.alive || game.bossDefeated || game.world !== this.world) {
      this.interrupt(); return;
    }
    if (!Number.isFinite(dt) || dt <= 0) { this.holdingAllowed = false; return; }
    this.observePlayer(game.player);
    this.holdingAllowed = !this.#interruptedFrame; this.#interruptedFrame = false;
    game.autoTarget = this.autoRoom();
    const gate = this.gates[this.#progress];
    for (const entry of this.gates) entry.available = false;
    if (gate) {
      const player = game.player, distance = Math.hypot(player.pos.x - gate.pos.x, player.pos.z - gate.pos.z);
      this.#combat = this.inCombat(game, gate);
      gate.available = this.holdingAllowed && gate.ready && this.enemiesCleared(game, gate) && !this.#combat &&
        gate.room.discovered && distance <= this.def.readRadius;
      if (!gate.available) {
        this.#read = 0; this.#hold = 0; this.#selected = null; this.#confirm = null;
      } else {
        const pad = gate.pads.find(p => Math.hypot(player.pos.x - p.pos.x, player.pos.z - p.pos.z) <= this.def.radius);
        if (this.#wrongLatch) {
          this.#hold = 0; this.#read = 0;
          if (!pad) { this.#wrongLatch = false; this.#feedback = ''; }
        } else if (!this.revealed) {
          // The full frame belongs to reading; it cannot also confirm a choice.
          this.#read = Math.min(this.def.readSeconds, this.#read + dt); this.#hold = 0; this.#selected = null;
        } else {
          if (pad?.id !== this.#selected) { this.#hold = 0; this.#confirm = null; }
          this.#selected = pad?.id || null;
          const confirming = this.#confirm?.gate === gate && this.#confirm?.choice === pad?.id;
          this.#hold = pad ? Math.min(this.def.holdSeconds, this.#hold + dt) : 0;
          // Battle's damage/projectile pass runs after this route update. Only
          // commit on the NEXT valid frame; observePlayer/interrupt cancels the
          // receipt if damage or an action happened later in the final frame.
          if (confirming) {
            this.#confirm = null;
            if (pad.id === gate.answer) {
              gate.attuned = true; gate.available = false; this.#progress++; this.interrupt(); this.#feedback = '';
              game.markCleared(gate.room); game.autoTarget = this.autoRoom();
              game.ui.toast(`${gate.label} 복원 완료 · ${this.#progress}/${this.gates.length}`, 'gold');
            } else {
              const clue = gate.pads.find(p => p.id === gate.answer);
              this.#mistakes++; this.#wrongLatch = true; this.#read = 0; this.#hold = 0; this.#selected = null;
              this.#feedback = `${pad.code} ${pad.glyph} 오답 · 단서는 ${clue.code} ${clue.glyph}`;
              game.ui.toast(`${this.#feedback} · 판 밖으로 나와 다시 읽으세요.`, 'gold');
            }
          } else if (pad && this.#hold + 1e-9 >= this.def.holdSeconds) {
            this.#confirm = { gate, choice: pad.id };
          }
        }
      }
    }
    this.view?.update(); this.refreshHint(game);
  }
  finish(win) {
    if (!this.#report) {
      this.#report = Object.freeze({ id: this.def.id, complete: !!win && !this.#closed && this.canWin(),
        progress: this.#progress, target: this.gates.length, mistakes: this.#mistakes,
        rooms: Object.freeze(this.gates.filter(g => g.attuned).map(g => g.room.id)),
        constellations: Object.freeze(this.gates.filter(g => g.attuned).map(g => Object.freeze({
          stationId: g.stationId, roomId: g.room.id, label: g.label, choice: g.answer,
        }))),
      });
      this.interrupt();
    }
    return this.#report;
  }
}
