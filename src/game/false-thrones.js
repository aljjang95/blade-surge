import { Vector3 } from 'three';
import { audio } from '../engine/audio.js';

// 거울 미궁 발자국이 거리장을 따라 내려가는 이웃 칸의 탐색 순서: x+ → x− → z+ → z−.
const NEIGHBOR_DX = [1, -1, 0, 0];
const NEIGHBOR_DZ = [0, 0, 1, -1];

/** 흑사막 환영 분지 일반의 원안: 가짜 왕좌 세 개를 부숴야 여왕의 본체가 드러난다.
 * 기존 목표(중심에서 n초 유지)와 다른 동사다. 왕좌는 실제 공격으로만 깎이며,
 * 보라 모래시계가 멈춘 동안에만 피해가 들어가고, 도는 동안 때리면 모래가 반사된다.
 * 방 정화·보상·봉인은 Battle 이 그대로 소유하고 이 클래스는 언제 정화를 허락할지만 정한다.
 * 정의에 escape 가 있으면(흑사막 분지 심층) 왕좌 전부와 모든 구역을 정화한 뒤 거울 미궁이 열린다.
 * 제한 시간 안에 진짜 거울에 닿아야 봉인이 풀리며, 실패(환영 거울·시간 초과)는 피해만 주고 진행을 막지 않는다. */
export class FalseThrones {
  #closed = false;
  #report = null;
  #lastHint = '';
  #markerT = 0;
  #reflectCd = 0;
  #reflects = 0;
  #blocked = 0;
  /** 거울 뷰에 넘기는 옵션 객체(재사용, 프레임 루프 무할당). */
  #opts = { reduced: false };
  view = null;
  /** 거울 미궁 뷰(def.escape 이고 뷰 파일이 준비됐을 때만). 없어도 규칙은 그대로다. */
  mazeView = null;
  /** 거울 미궁 상태. def.escape 가 없으면 null. */
  maze = null;
  constructor(def, world) {
    this.def = def; this.world = world;
    const { minX, minZ, cols } = world;
    if (typeof minX !== 'number' || typeof minZ !== 'number' || typeof cols !== 'number') throw new RangeError('가짜 왕좌 이동 지도가 준비되지 않았습니다.');
    const flow = world.buildFlow(world.startRoom.x, world.startRoom.z);
    const reach = (x, z) => !!flow && flow[Math.floor(z - minZ) * cols + Math.floor(x - minX)] >= 0;
    this.gates = def.gates.map(({ roomId, label }, i) => {
      const room = world.rooms.find(r => r.id === roomId);
      if (!room || room.type === 'boss' || room.type === 'start' || !reach(room.x, room.z) || !reach(room.x - def.standOff, room.z)) {
        throw new RangeError(`가짜 왕좌 ${roomId}에 봉인 밖 접근 경로가 없습니다.`);
      }
      room.label = label; room.objectiveProp = 'false-throne';
      return { room, label, index: i, ready: false, broken: false, prepared: false, expected: 0, spawned: 0,
        // 왕좌마다 위상이 달라 세 방이 똑같은 박자로 움직이지 않는다.
        phase: 'spin', age: i * .6, hits: 0, gap: 0, flash: 0,
        pos: new Vector3(room.x, 0, room.z), stand: new Vector3(room.x - def.standOff, 0, room.z) };
    });
    if (def.escape) this.maze = this.#createMaze(def.escape, world, flow);
  }
  /** 거울 방과 두 거울 칸이 봉인 밖에서 걸어 닿는 칸인지 확인하고 미궁 상태를 만든다. */
  #createMaze(escape, world, flow) {
    const room = world.rooms.find(r => r.id === escape.roomId);
    if (!room || room.type === 'boss' || room.type === 'start' || this.gates.some(g => g.room === room)) {
      throw new RangeError(`거울 미궁 방 ${escape.roomId}이(가) 올바르지 않습니다.`);
    }
    const real = new Vector3(room.x + escape.real[0], 0, room.z + escape.real[1]);
    const illusion = new Vector3(room.x + escape.illusion[0], 0, room.z + escape.illusion[1]);
    for (const p of [real, illusion]) {
      const i = this.#cellIndex(p.x, p.z);
      if (i < 0 || world.inner?.[i] !== 1 || !flow || !(flow[i] >= 0)) throw new RangeError('거울이 설 자리에 봉인 밖 접근 경로가 없습니다.');
    }
    room.label = escape.label;
    return { room, phase: 'idle', real, illusion, limit: 0, left: 0, elapsed: 0, collapses: 0, illusions: 0, cooldown: 0,
      trail: new Float32Array(escape.trailCount * 2), trailN: 0, trailT: 0 };
  }
  /** 월드 좌표의 이동 지도 칸 번호. 지도 밖이면 -1. */
  #cellIndex(x, z) {
    const { minX, minZ, cols, rows } = this.world;
    const cx = Math.floor(x - minX), cz = Math.floor(z - minZ);
    return cx < 0 || cz < 0 || cx >= cols || cz >= rows ? -1 : cz * cols + cx;
  }
  get progress() { return this.gates.filter(g => g.broken).length; }
  get complete() { return this.gates.every(g => g.broken); }
  get closed() { return this.#closed || !!this.#report; }
  get reflects() { return this.#reflects; }
  get blocked() { return this.#blocked; }
  /** 아직 부수지 않은 왕좌 중 길 순서상 첫 번째. 순서 제약은 없고 AUTO 안내용이다. */
  get current() { return this.gates.find(g => !g.broken) || null; }
  async prepareView(scene) {
    try {
      const { FalseThroneView } = await import('./false-throne-view.js');
      if (!this.closed) this.view = new FalseThroneView(scene, this);
    } finally {
      // 거울 미궁 연출은 왕좌 뷰와 상관없이 만든다. 왕좌 뷰의 실패는 그대로 호출자에게 전달된다.
      await this.prepareMazeView(scene);
    }
  }
  /** 연출 전용: def.escape 가 있을 때만 만든다. 가져오기·생성 실패는 규칙에 영향을 주지 않는다. @param {any} scene */
  async prepareMazeView(scene) {
    if (!this.def.escape || this.closed || this.mazeView) return;
    try {
      const { MirrorMazeView } = await import('./mirror-maze-view.js');
      if (!this.closed && !this.mazeView) this.mazeView = new MirrorMazeView(scene, this);
    } catch { /* 뷰가 없거나 만들 수 없어도 규칙은 그대로 동작한다. */ }
  }
  autoRoom() { return this.closed ? null : this.current?.room || null; }
  /** 거울 미궁이 도는 동안 AUTO 가 향할 지점(진짜 거울). 그 밖에는 null 이다. */
  autoGoal() { return !this.closed && this.maze?.phase === 'running' ? this.maze.real : null; }
  autoPoint(room) {
    const gate = this.current;
    return !this.closed && gate?.room === room && gate.ready ? gate.stand : null;
  }
  /** AUTO 는 모래시계가 멈춘 왕좌 옆에서만 공격한다(반사 벌칙을 일부러 밟지 않는다). @param {any} player */
  autoStrike(player) {
    const gate = this.current;
    // 멈춤이 곧 끝나면 휘두르지 않는다. 휘두른 타격이 회전 중에 닿아 반사되는 일을 막는다.
    if (this.closed || !gate?.ready || gate.phase !== 'still' || gate.age > this.def.stillSeconds - this.def.autoMargin) return null;
    const d = Math.hypot(player.pos.x - gate.pos.x, player.pos.z - gate.pos.z);
    return d <= this.def.standOff + .9 ? gate : null;
  }
  ownsHazards(room) { return this.gates.some(g => g.room === room && !g.broken); }
  interrupt() {}
  stop() {
    this.#closed = true;
    this.view?.dispose(); this.view = null;
    this.mazeView?.dispose(); this.mazeView = null;
  }
  prepareRoom(room, count) {
    const gate = this.gates.find(g => g.room === room);
    if (gate && !gate.prepared) { gate.prepared = true; gate.expected = count; }
  }
  spawn(room) { const gate = this.gates.find(g => g.room === room); if (gate) gate.spawned++; }
  enemiesCleared(game, gate) {
    return gate.prepared && gate.room.spawned && gate.spawned >= gate.expected &&
      !game.enemies.some(e => e.alive && e.homeRoom === gate.room) && !game.pending.some(n => n.room === gate.room);
  }
  combatPending(game, room) {
    const gate = this.gates.find(g => g.room === room);
    return !!gate && !this.enemiesCleared(game, gate);
  }
  /** 왕좌가 서 있는 방은 부서질 때까지 정화되지 않는다. */
  beforeClear(game, room) {
    const gate = this.gates.find(g => g.room === room);
    if (!gate || gate.broken) return false;
    if (!this.closed && game.active && !game.paused && this.enemiesCleared(game, gate) && !gate.ready) {
      gate.ready = true; gate.phase = 'spin'; gate.age = 0;
      game.ui.toast(`${gate.label} · 보라 모래시계가 멈출 때 공격`, 'gold');
      this.refreshHint(game);
      // 준비는 Battle.markCleared 에서 오고, 마지막 적을 투사체가 잡으면 같은 스텝의 경로 목표 갱신보다 뒤다.
      // 뷰가 한 스텝 늦지 않게 시간 진행 없이 맞춘다.
      this.syncView(game);
    }
    return true;
  }
  canUnseal() {
    return this.complete && (!this.maze || this.maze.phase === 'done') && this.world.rooms.every(r => ['start', 'boss'].includes(r.type) || r.cleared);
  }
  canWin() { return this.canUnseal() && !this.world.sealed && this.world.bossRoom.cleared; }
  hint() {
    const n = this.gates.length, done = this.progress, gate = this.current, maze = this.maze;
    if (maze?.phase === 'running') return `거울 미궁 탈출 · 모래 발자국을 따라 진짜 거울로 · ${Math.ceil(maze.left)}초`;
    if (maze?.phase === 'done') return '거울 미궁 탈출 완료 · 여왕 처치';
    if (!gate) return `가짜 왕좌 ${n}/${n} 파괴 · ${this.canUnseal() ? '여왕 처치' : '남은 구역 정화'}`;
    if (!gate.ready) return `가짜 왕좌 ${done}/${n} · ${gate.label} · 적 처치 후 공격`;
    return `가짜 왕좌 ${done}/${n} · ${gate.label} · ${gate.phase === 'still' ? `모래시계 멈춤 · 지금 공격 ${gate.hits}/${this.def.hits}` : '모래시계 회전 · 공격하면 반사'}`;
  }
  refreshHint(game) {
    const hint = this.hint();
    if (hint !== this.#lastHint) { this.#lastHint = hint; game.ui.setObjective(this.world); }
  }
  /** 이 위치·범위의 아군 타격이 닿는 왕좌 하나를 찾는다. */
  #touched(x, z, reach) {
    for (const g of this.gates) {
      if (g.broken) continue;
      if (Math.hypot(x - g.pos.x, z - g.pos.z) <= reach + this.def.radius) return g;
    }
    return null;
  }
  /** Battle 의 근접·광역 판정이 부른다. 한 번의 판정은 왕좌 하나에 최대 1타.
   * 실제로 균열이 생기거나 반사됐을 때만 true 다(막힘·연타 간격은 타격으로 세지 않는다). @returns {boolean} */
  strike(game, x, z, reach) {
    if (this.closed || !game.active || game.paused || !game.player?.alive) return false;
    const gate = this.#touched(x, z, reach);
    if (!gate) return false;
    if (!gate.ready) {
      // 방의 적이 남아 있으면 모래 장막이 막는다. 벌칙은 없다.
      if (gate.gap <= 0) { gate.gap = this.def.hitGap; this.#blocked++; game.fx.damage?.(gate.pos, 0, { text: '모래 장막 · 적을 먼저 처치' }); }
      return false;
    }
    if (gate.gap > 0) return false;
    gate.gap = this.def.hitGap;
    if (gate.phase !== 'still') return this.#reflect(game, gate);
    gate.hits++; gate.flash = .18;
    game.fx.damage?.(gate.pos, 0, { text: `왕좌 균열 ${gate.hits}/${this.def.hits}` });
    audio.ting?.({ vol: .2, freq: 520 + gate.hits * 60 });
    if (gate.hits >= this.def.hits) this.#break(game, gate);
    else this.refreshHint(game);
    // 균열·파괴는 경로 목표 갱신 밖(근접·광역·투사체 판정)에서 일어난다. 표시 입력(hits·flash·broken)을 같은 프레임에 맞춘다.
    this.syncView(game);
    return true;
  }
  /** 투사체: 관통이 아니면 맞은 왕좌에서 소멸한다. 같은 투사체는 한 왕좌를 한 번만 친다. */
  strikeProjectile(game, p) {
    const gate = this.#touched(p.pos.x, p.pos.z, p.radius);
    if (!gate || p.hit.has(gate)) return false;
    p.hit.add(gate);
    return this.strike(game, gate.pos.x, gate.pos.z, 0);
  }
  #reflect(game, gate) {
    if (this.#reflectCd > 0) return false;
    this.#reflectCd = this.def.reflect.cooldown; this.#reflects++;
    const p = game.player, dx = p.pos.x - gate.pos.x, dz = p.pos.z - gate.pos.z, d = Math.hypot(dx, dz) || 1;
    p.hurt?.(p.maxHp * this.def.reflect.damage, { dirx: dx / d, dirz: dz / d, kb: 2.5, kind: 'magic' });
    game.fx.castCircle?.(gate.pos, this.def.spinColor, { radius: this.def.radius + 1, life: .6 });
    game.ui.toast(`${gate.label} · 모래시계가 도는 중 · 모래 반사`, 'red');
    return true;
  }
  #break(game, gate) {
    gate.broken = true; gate.phase = 'broken';
    this.view?.shatter(gate);
    game.fx.castCircle?.(gate.pos, this.def.stillColor, { radius: 4, life: 1.2 });
    game.renderer?.shake?.(.35);
    audio.magic?.({ vol: .32, base: 247, notes: [0, 3, 7, 12], step: .08, type: 'triangle' });
    game.markCleared(gate.room);
    game.autoTarget = this.autoRoom();
    const n = this.progress, total = this.gates.length;
    game.ui.toast(n === total ? `마지막 가짜 왕좌 파괴 · 환영 여왕의 본체가 드러납니다` : `${gate.label} 파괴 · ${n}/${total}`, 'gold');
    this.refreshHint(game);
  }
  /** 규칙을 갱신한 뒤 같은 스텝의 상태를 거울 뷰에 그린다. 규칙의 조기 반환(보스 처치·결과 등)에도 일시정지가 아니면 이어서 그린다. */
  update(game, dt) {
    this.#updateRules(game, dt);
    if (this.mazeView && !game.paused && Number.isFinite(dt) && dt > 0) {
      this.#opts.reduced = !!game.app?.reducedMotion?.matches;
      this.mazeView.update(this, dt, this.#opts);
    }
  }
  /** 스텝 안에서 규칙 갱신 뒤 바뀐 표시 입력(왕좌 준비·균열·파괴)을 시간 진행 없이 두 뷰에 반영한다. @param {any} game */
  syncView(game) {
    if (game?.paused || (!this.view && !this.mazeView)) return;
    this.view?.update(this, 0);
    if (this.mazeView) {
      this.#opts.reduced = !!game.app?.reducedMotion?.matches;
      this.mazeView.update(this, 0, this.#opts);
    }
  }
  #updateRules(game, dt) {
    if (this.closed || !game.active || game.paused || !game.player?.alive || game.bossDefeated || game.world !== this.world) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.#reflectCd = Math.max(0, this.#reflectCd - dt);
    for (const g of this.gates) {
      g.gap = Math.max(0, g.gap - dt); g.flash = Math.max(0, g.flash - dt);
      if (g.broken || !g.ready) continue;
      g.age += dt;
      const span = g.phase === 'still' ? this.def.stillSeconds : this.def.spinSeconds;
      if (g.age + 1e-9 >= span) {
        g.age -= span; g.phase = g.phase === 'still' ? 'spin' : 'still';
        if (g.phase === 'still' && game.world.roomAt?.(game.player.pos.x, game.player.pos.z) === g.room) audio.ting?.({ vol: .2, freq: 880 });
      }
    }
    const gate = this.current;
    if (gate) game.autoTarget = gate.room;
    this.#markerT -= dt;
    if (this.#markerT <= 0) {
      this.#markerT = 1.8;
      for (const g of this.gates) {
        if (g.broken || !g.room.discovered || Math.hypot(game.player.pos.x - g.pos.x, game.player.pos.z - g.pos.z) > 22) continue;
        game.fx.damage?.(g.pos, 0, { text: !g.ready ? `${g.index + 1}번 가짜 왕좌 · 적 처치` : g.phase === 'still' ? '모래시계 멈춤 · 공격' : '모래시계 회전 · 대기' });
      }
    }
    this.#updateMaze(game, dt);
    this.view?.update(this, dt); this.refreshHint(game);
  }
  /** 모든 왕좌와 시작·보스방을 뺀 모든 구역이 정화됐으면 거울 미궁을 연다. 열리는 스텝에는 시간이 흐르지 않는다. */
  #updateMaze(game, dt) {
    const maze = this.maze;
    if (!maze || maze.phase === 'done') return;
    if (maze.phase === 'idle') {
      if (!this.#readyToOpen()) return;
      maze.phase = 'running'; maze.trailT = this.def.escape.trailEvery;
      this.#resetLimit(game.player.pos);
      this.#stampTrail(game.player.pos);
      game.ui.toast(`거울 미궁 · 모래 발자국을 따라 진짜 거울로 ${maze.limit}초 안에 탈출`, 'gold');
      game.fx.castCircle?.(maze.real, this.def.stillColor, { radius: this.def.escape.radius + 1, life: 1.2 });
      return;
    }
    const e = this.def.escape, p = game.player;
    maze.elapsed += dt; maze.left -= dt; maze.cooldown = Math.max(0, maze.cooldown - dt);
    maze.trailT -= dt;
    if (maze.trailT <= 0) { this.#stampTrail(p.pos); maze.trailT += e.trailEvery; if (maze.trailT <= 0) maze.trailT = e.trailEvery; }
    // 같은 스텝에서는 진짜 거울 도달이 시간 초과보다 먼저다.
    if (Math.hypot(p.pos.x - maze.real.x, p.pos.z - maze.real.z) <= e.radius) {
      maze.phase = 'done';
      game.ui.toast('진짜 거울 통과 · 환영 여왕의 본체가 드러납니다', 'gold');
      game.fx.castCircle?.(maze.real, this.def.stillColor, { radius: 4, life: 1.2 });
      audio.magic?.({ vol: .32, base: 247, notes: [0, 3, 7, 12], step: .08, type: 'triangle' });
      // unsealBoss 는 canUnseal 을 다시 확인하므로 phase 를 바꾼 뒤에 부른다.
      game.unsealBoss?.();
      return;
    }
    const dx = p.pos.x - maze.illusion.x, dz = p.pos.z - maze.illusion.z;
    if (maze.cooldown <= 0 && Math.hypot(dx, dz) <= e.radius) {
      maze.illusions++; maze.cooldown = e.illusionCooldown;
      const d = Math.hypot(dx, dz) || 1;
      p.hurt?.(p.maxHp * e.illusionDamage, { dirx: dx / d, dirz: dz / d, kb: 3, kind: 'magic' });
      game.fx.castCircle?.(maze.illusion, this.def.spinColor, { radius: e.radius + 1, life: .6 });
      game.ui.toast('환영 거울 · 모래 발자국이 닿지 않는 거울입니다', 'red');
    }
    if (maze.left <= 0) {
      maze.collapses++;
      p.hurt?.(p.maxHp * e.collapseDamage, { kind: 'magic' });
      this.#resetLimit(p.pos);
      game.ui.toast('거울 미궁 붕괴 · 모래 발자국을 따라 다시 탈출', 'red');
    }
  }
  /** 왕좌가 모두 부서지고 시작·보스방을 뺀 모든 구역이 정화됐는지. 프레임마다 불러도 할당하지 않는다. */
  #readyToOpen() {
    for (const g of this.gates) if (!g.broken) return false;
    for (const r of this.world.rooms) if (r.type !== 'start' && r.type !== 'boss' && !r.cleared) return false;
    return true;
  }
  /** 거리장 값. 지도 밖이면 -1. */
  #flowAt(flow, x, z) {
    const { cols, rows } = this.world;
    return x < 0 || z < 0 || x >= cols || z >= rows ? -1 : flow[z * cols + x];
  }
  /** 영웅 칸에서 진짜 거울까지의 거리장 칸 수로 제한 시간을 정한다. 칸이 거리장 밖이면 직선 거리 × 1.5 로 대신한다. */
  #resetLimit(pos) {
    const maze = this.maze, e = this.def.escape;
    const flow = this.world.buildFlow(maze.real.x, maze.real.z), i = this.#cellIndex(pos.x, pos.z);
    let dist = flow && i >= 0 ? flow[i] : -1;
    if (!(dist >= 0)) dist = Math.hypot(pos.x - maze.real.x, pos.z - maze.real.z) * 1.5;
    maze.limit = maze.left = Math.ceil(dist / e.pace + e.grace);
  }
  /** 영웅 칸에서 진짜 거울로 거리가 줄어드는 이웃 칸을 따라 trailSpacing 칸마다 칸 중심을 찍는다. 할당 없이 trail 을 덮어쓴다. */
  #stampTrail(pos) {
    const maze = this.maze, e = this.def.escape, { minX, minZ } = this.world;
    maze.trailN = 0;
    const flow = this.world.buildFlow(maze.real.x, maze.real.z);
    if (!flow) return;
    let cx = Math.floor(pos.x - minX), cz = Math.floor(pos.z - minZ), here = this.#flowAt(flow, cx, cz), acc = 0;
    if (here < 0) {
      // 벽에 붙은 칸에 서 있으면 걸을 수 있는 가장 가까운 이웃 칸에서 시작한다.
      let bx = cx, bz = cz, bd = -1;
      for (let k = 0; k < 4; k++) {
        const nd = this.#flowAt(flow, cx + NEIGHBOR_DX[k], cz + NEIGHBOR_DZ[k]);
        if (nd >= 0 && (bd < 0 || nd < bd)) { bd = nd; bx = cx + NEIGHBOR_DX[k]; bz = cz + NEIGHBOR_DZ[k]; }
      }
      if (bd < 0) return;
      cx = bx; cz = bz; here = bd;
    }
    while (here > 0 && maze.trailN < e.trailCount) {
      let bx = cx, bz = cz, bd = here;
      for (let k = 0; k < 4; k++) {
        const nd = this.#flowAt(flow, cx + NEIGHBOR_DX[k], cz + NEIGHBOR_DZ[k]);
        if (nd >= 0 && nd < bd) { bd = nd; bx = cx + NEIGHBOR_DX[k]; bz = cz + NEIGHBOR_DZ[k]; }
      }
      if (bd === here) break;
      cx = bx; cz = bz; here = bd; acc += 1;
      if (here > 0 && acc >= e.trailSpacing - 1e-9) {
        acc -= e.trailSpacing;
        maze.trail[maze.trailN * 2] = minX + cx + .5; maze.trail[maze.trailN * 2 + 1] = minZ + cz + .5; maze.trailN++;
      }
    }
  }
  /** 결과는 실제 파괴만 센다. 패배를 완료로 바꾸지 않는다. */
  finish(win) {
    if (!this.#report) {
      const report = { id: this.def.id, label: '가짜 왕좌 파괴', complete: !!win && !this.#closed && this.canWin(),
        progress: this.progress, target: this.gates.length, rooms: Object.freeze(this.gates.filter(g => g.broken).map(g => g.room.id)),
        sandReflects: this.#reflects };
      // 거울 미궁이 있는 정의에서만 탈출 기록을 더한다. 일반 흑사막의 보고 모양은 그대로다.
      if (this.maze) report.escape = Object.freeze({ escaped: this.maze.phase === 'done', collapses: this.maze.collapses,
        illusions: this.maze.illusions, seconds: Math.round(this.maze.elapsed * 100) / 100 });
      this.#report = Object.freeze(report);
    }
    return this.#report;
  }
}
