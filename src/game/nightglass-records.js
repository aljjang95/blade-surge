import { Vector3 } from 'three';

// 쪽 번호는 방문 순서와 별개다. 심층에서도 각 기록의 정체성은 유지한다.
export class NightglassRecords {
  #progress = 0;
  #hold = 0;
  #closed = false;
  #report = null;
  #lastHint = '';
  #markerT = 0;
  #lastHp = null;
  #interruptedFrame = false;
  #viewPromise = null;
  view = null;
  holdingAllowed = false;

  constructor(def, world) {
    this.def = def; this.world = world;
    const flow = world.buildFlow(world.startRoom.x, world.startRoom.z);
    this.rooms = new Map(world.rooms.map(room => [room, {
      room, pos: new Vector3(room.x, 0, room.z), prepared: false, expected: 0, spawnCount: 0,
    }]));
    this.gates = def.gates.map(({ roomId, id, pageId, label }) => {
      const room = world.rooms.find(r => r.id === roomId);
      if (!room || ['boss', 'start'].includes(room.type) || !flow ||
          typeof world.minX !== 'number' || typeof world.minZ !== 'number' || typeof world.cols !== 'number' ||
          !(flow[Math.floor(room.z - world.minZ) * world.cols + Math.floor(room.x - world.minX)] >= 0)) {
        throw new RangeError(`기록 ${pageId}쪽에 봉인 밖 접근 경로가 없습니다.`);
      }
      room.label = label; room.objectiveProp = 'nightglass-record';
      return Object.assign(this.rooms.get(room), { id, pageId, label, ready: false, attuned: false });
    });
  }
  get progress() { return this.#progress; }
  get hold() { return this.#hold; }
  get complete() { return this.#progress === this.gates.length; }
  get closed() { return this.#closed || !!this.#report; }
  get coexistsAttunement() { return this.def.coexistAttunement === true; }
  allowsAttunement(room) {
    return this.coexistsAttunement && this.rooms.has(room) && room.type === 'treasure' && !this.gates.some(g => g.room === room);
  }
  async prepareView(scene) {
    if (this.closed || this.view) return;
    if (!this.#viewPromise) this.#viewPromise = (async () => {
      const [{ NightglassRecordView }, { loadModel }] = await Promise.all([
        import('./nightglass-record-view.js'), import('../engine/assets.js'),
      ]);
      const gltf = await loadModel('tllNightglassRecord');
      if (!this.closed) this.view = new NightglassRecordView(scene, gltf, this);
    })().finally(() => { this.#viewPromise = null; });
    await this.#viewPromise;
  }
  autoRoom() {
    if (this.closed) return null;
    // 지나가며 정화한 제단은 공명을 마칠 때까지 AUTO 목표로 유지한다.
    return this.world.rooms.find(r => this.allowsAttunement(r) && r.attunementPending && !r.attuned && !r.cleared)
      || this.gates[this.#progress]?.room || null;
  }
  autoPoint(room) {
    if (this.closed) return null;
    const gate = this.gates[this.#progress];
    if (gate?.room === room && gate.ready) return gate.pos;
    return this.allowsAttunement(room) && room.attunementPending && !room.attuned ? this.rooms.get(room).pos : null;
  }
  interrupt() {
    this.#hold = 0; this.holdingAllowed = false;
    for (const room of this.world.rooms) if (this.allowsAttunement(room) && room.attunementPending) room.attunementT = 0;
  }
  // 입력과 애니메이션 갱신 사이에도 관찰하여 한 프레임 안에 끝난 행동을 놓치지 않는다.
  observePlayer(player) {
    const stable = player?.alive && (player.state === 'idle' || player.state === 'move');
    const damaged = Number.isFinite(this.#lastHp) && player?.hp < this.#lastHp;
    this.#lastHp = player?.hp ?? null;
    if (!stable || damaged) { this.interrupt(); this.#interruptedFrame = true; }
  }
  stop() { this.#closed = true; this.interrupt(); this.view?.dispose(); this.view = null; }
  prepareRoom(room, count) {
    const state = this.rooms.get(room);
    if (state && !state.prepared) { state.prepared = true; state.expected = count; }
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
      game.ui.toast(`${gate.label} 정화 · ${this.gates[this.#progress] === gate ? '기록대에서 2초 유지' : '복원 순서 대기'}`, 'gold');
      this.view?.update(); this.refreshHint(game);
    }
    return true;
  }
  canUnseal() { return this.complete && this.world.rooms.every(r => ['start', 'boss'].includes(r.type) || r.cleared); }
  canWin() { return this.canUnseal() && !this.world.sealed && this.world.bossRoom.cleared; }
  hint() {
    const gate = this.gates[this.#progress], n = this.gates.length;
    const order = this.coexistsAttunement ? '역순 3→2→1' : '순서 1→2→3';
    const altars = this.coexistsAttunement
      ? ` · 제단 ${this.world.rooms.filter(r => this.allowsAttunement(r) && r.attuned).length}/2` : '';
    if (!gate) return `기록 ${n}/${n} 복원${altars} · ${this.canUnseal() ? '기록관 처치' : '남은 구역 정화'}`;
    return `기록 ${this.#progress}/${n} · ${order} · ${gate.label} · ${gate.ready ? `기록대 2초 (${this.#hold.toFixed(1)}/2)` : '적과 증원 처치'}${altars}`;
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
    if (gate) {
      const inside = Math.hypot(game.player.pos.x - gate.pos.x, game.player.pos.z - gate.pos.z) <= this.def.radius;
      this.#hold = this.holdingAllowed && inside && gate.ready && this.enemiesCleared(game, gate) ? this.#hold + dt : 0;
      if (this.#hold + 1e-9 >= this.def.holdSeconds) {
        gate.attuned = true; this.#progress++; this.#hold = 0;
        game.markCleared(gate.room); game.autoTarget = this.autoRoom();
        game.ui.toast(`${gate.label} 복원 완료 · ${this.#progress}/${this.gates.length}`, 'gold');
      }
    }
    this.#markerT -= dt;
    if (this.#markerT <= 0) {
      this.#markerT = 1.8;
      for (const cue of this.gates) {
        if (cue.attuned || !cue.room.discovered || Math.hypot(game.player.pos.x - cue.pos.x, game.player.pos.z - cue.pos.z) > 22) continue;
        game.fx.damage(cue.pos, 0, { text: `${cue.label} · ${cue !== this.gates[this.#progress] ? '순서 대기' : cue.ready ? '기록대 2초' : '적 정화'}` });
      }
    }
    this.view?.update(); this.refreshHint(game);
  }
  finish(win) {
    if (!this.#report) {
      this.#report = Object.freeze({ id: this.def.id, complete: !!win && !this.#closed && this.canWin(),
        progress: this.#progress, target: this.gates.length,
        rooms: Object.freeze(this.gates.filter(g => g.attuned).map(g => g.room.id)),
        pages: Object.freeze(this.gates.filter(g => g.attuned).map(g => Object.freeze({
          id: g.id, pageId: g.pageId, label: g.label, roomId: g.room.id,
        }))),
      });
      this.interrupt(); this.view?.update();
    }
    return this.#report;
  }
}
