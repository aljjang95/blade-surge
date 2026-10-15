import { Vector3 } from 'three';
import { audio } from '../engine/audio.js';

const EPS = 1e-9;
const TAU = Math.PI * 2;

/** 혜성 기사단장 보스방의 푸른 궤도선 유성(BUNDLE-06).
 * 보스가 나타나면 보스방 중심에 푸른 궤도선(반지름 def.safe)이 생긴다. 보스가 공격하지 않는 틈에 def.warning 초 예고가 뜨고,
 * 평소 유성(outer)은 바깥 고리(def.outerMin~outerMax)에 떨어져 선 안쪽이 안전하다. def.centerEvery 번째마다 중심 유성(center)이
 * 선 안쪽(≤ def.safe)을 덮으므로 그때는 선 밖으로 피해야 한다. 맞으면 최대 체력 def.damage 비율의 마법 피해이고,
 * 무적·방어 감쇄는 Player.hurt 가 소유한다. 예고 동안 보스의 다음 공격 대기(atkCd)를 붙잡아 새 공격을 시작하지 못하게 한다.
 * 상태는 idle(보스 미부착) → armed ⇄ warn → ended(보스 처치·stop·전투 종료·다른 월드)이고 ended 는 되돌아오지 않는다.
 * 게임 시간(dt)만 쓰고 Math.random·Date 를 쓰지 않으며, update·autoEvade 는 객체를 만들지 않는다.
 * 읽기 상태는 뷰·목표창이 읽기만 한다. */
export class CometBossOrbit {
  #state = 'idle';
  /** @type {'outer'|'center'|null} */
  #kind = null;
  /** @type {any} */
  #boss = null;
  #clock = 0;
  #warnLeft = 0;
  #count = 0;
  #strikes = 0;
  #centerStrikes = 0;
  #hits = 0;
  #startsDuringWarn = 0;
  /** 예고 동안 보스 attackSequence 가 바뀌는지 보는 기억값. */
  #seq = 0;
  /** autoEvade 가 돌려주는 재사용 안전 지점. */
  #safePoint = new Vector3();
  /** 피해·연출 옵션(재사용). 판정 시점에 값만 바꾼다. */
  #hurtOpts = { dirx: 0, dirz: 0, kb: 2, kind: 'magic' };
  #outerFx = null;
  #centerFx = null;
  #outerSound = { vol: .22, freq: 900 };
  #centerSound = { vol: .22, freq: 620 };
  #boomSound = { vol: .35, dur: .4 };

  /** @param {{id:string, enemy:string, safe:number, outerMin:number, outerMax:number, escape:number, first:number, every:number, warning:number, centerEvery:number, damage:number}} def
   * @param {any} world 보스방 중심과 이동 지도를 읽는다. 다른 월드로 넘어가면 ended 로 바꾼다. */
  constructor(def, world) {
    const positive = key => Number.isFinite(def?.[key]) && def[key] > 0;
    if (!def || typeof def.enemy !== 'string' || !['safe', 'outerMin', 'outerMax', 'escape', 'first', 'every', 'warning', 'centerEvery', 'damage'].every(positive) ||
        def.first > def.every || def.outerMin <= def.safe || def.outerMax <= def.outerMin) throw new RangeError('푸른 궤도선 정의가 올바르지 않습니다.');
    const room = world?.bossRoom, { minX, minZ, cols } = world || {};
    if (!room || typeof minX !== 'number' || typeof minZ !== 'number' || typeof cols !== 'number') throw new RangeError('푸른 궤도선 이동 지도가 준비되지 않았습니다.');
    this.def = def; this.world = world; this.room = room;
    this.center = new Vector3(room.x, 0, room.z);
    // 보스방 중심에서 걸어갈 수 있는 곳만 안전 지점·낙하 구역으로 쓴다.
    const flow = world.buildFlow(room.x, room.z);
    const reach = (x, z) => !!flow && flow[Math.floor(z - minZ) * cols + Math.floor(x - minX)] >= 0;
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * TAU;
      for (const r of [def.safe - 1.2, def.escape, def.outerMax + .8]) {
        if (!reach(room.x + Math.sin(a) * r, room.z + Math.cos(a) * r)) throw new RangeError('푸른 궤도선 주변에 걸을 수 있는 길이 없습니다.');
      }
    }
    this.#outerFx = { radius: def.outerMax, life: .5 };
    this.#centerFx = { radius: def.safe, life: .5 };
    // 문구는 생성자에서 한 번만 만든다(프레임 중 문자열을 만들지 않는다).
    this.attachToast = '푸른 궤도선 · 평소 유성은 선 바깥에 떨어집니다';
    this.centerToast = '중심 유성 예고 · 푸른 선 밖으로';
    this.outerHitToast = '유성 충돌 · 바깥 유성은 푸른 선 안쪽이 안전';
    this.centerHitToast = '유성 충돌 · 중심 유성은 푸른 선 밖으로';
  }

  // ---------------- 읽기 상태 ----------------
  get state() { return this.#state; }
  /** 낙하 종류. 예고(warn) 중에만 'outer' | 'center', 그 밖은 null. */
  get kind() { return this.#state === 'warn' ? this.#kind : null; }
  get warnLeft() { return this.#state === 'warn' ? this.#warnLeft : 0; }
  get warnTotal() { return this.def.warning; }
  get strikes() { return this.#strikes; }
  get centerStrikes() { return this.#centerStrikes; }
  get hits() { return this.#hits; }
  /** 예고 중 보스의 attackSequence 가 바뀐 횟수(판정에는 쓰지 않는 관찰값, 0이어야 한다). */
  get attackStartsDuringWarn() { return this.#startsDuringWarn; }
  get boss() { return this.#boss; }

  // ---------------- 프레임 ----------------
  update(game, dt) {
    if (this.#state === 'ended') return;
    // 일시정지 중에는 시계와 예고도 멈춘다.
    if (game.paused) return;
    if (game.bossDefeated || !game.active || (this.world && game.world !== this.world)) { this.#end(); return; }
    if (this.#state === 'idle') { this.#attach(game); return; }
    const boss = this.#boss;
    if (!boss.alive) { this.#end(); return; }
    if (!Number.isFinite(dt) || dt <= 0) return;
    const player = game.player;
    if (!player?.alive) return;
    // 영웅이 보스방 밖이면 시계를 멈추고 진행 중인 예고는 피해 없이 거둔다.
    if (game.world.roomAt?.(player.pos.x, player.pos.z) !== this.room) {
      if (this.#state === 'warn') this.#cancel();
      return;
    }
    if (this.#state === 'armed') {
      this.#clock += dt;
      if (this.#clock + EPS >= this.def.every && boss.state !== 'attack') this.#begin(game, boss, dt);
      return;
    }
    // warn: 새 공격 대기를 예고 남은 시간 이상으로 붙잡는다. 보스는 같은 프레임에 대기를 dt 만큼 줄이므로 dt 를 더해 둔다.
    if (boss.atkCd < this.#warnLeft + dt) boss.atkCd = this.#warnLeft + dt;
    this.#warnLeft -= dt;
    if (boss.attackSequence !== this.#seq) { this.#startsDuringWarn++; this.#seq = boss.attackSequence; }
    if (this.#warnLeft <= EPS) this.#strike(game, player);
  }

  #attach(game) {
    const b = game.boss;
    if (!b || !b.alive || b.spawning || !b.isBoss) return;
    if ((b.runtimeSpeciesId || game.stage?.encounter?.enemyId) !== this.def.enemy) return;
    this.#boss = b; this.#state = 'armed';
    // 첫 예고는 부착 뒤 first 초 지점에서 시작한다.
    this.#clock = this.def.every - this.def.first;
    game.ui?.toast?.(this.attachToast, 'gold');
  }

  #begin(game, boss, dt) {
    const d = this.def;
    this.#count++;
    this.#kind = this.#count % d.centerEvery === 0 ? 'center' : 'outer';
    this.#state = 'warn'; this.#warnLeft = d.warning; this.#clock = 0; this.#seq = boss.attackSequence;
    // 예고가 시작된 바로 이 프레임에도 보스가 공격을 시작하지 않게 한다.
    if (boss.atkCd < this.#warnLeft + dt) boss.atkCd = this.#warnLeft + dt;
    audio.ting?.(this.#kind === 'center' ? this.#centerSound : this.#outerSound);
    if (this.#kind === 'center') game.ui?.toast?.(this.centerToast, 'red');
  }

  #strike(game, player) {
    const d = this.def, kind = this.#kind, c = this.center;
    const dx = player.pos.x - c.x, dz = player.pos.z - c.z, r = Math.hypot(dx, dz);
    this.#strikes++;
    if (kind === 'center') this.#centerStrikes++;
    game.fx?.castCircle?.(c, 0x9fd0ff, kind === 'center' ? this.#centerFx : this.#outerFx);
    game.renderer?.shake?.(.25);
    audio.boom?.(this.#boomSound);
    const inside = kind === 'center' ? r <= d.safe : r >= d.outerMin && r <= d.outerMax;
    if (inside && player.alive) {
      const l = r || 1, o = this.#hurtOpts;
      o.dirx = dx / l; o.dirz = dz / l;
      const hit = player.hurt?.(player.maxHp * d.damage, o);
      if (hit !== false) { this.#hits++; game.ui?.toast?.(kind === 'center' ? this.centerHitToast : this.outerHitToast, 'red'); }
    }
    this.#state = 'armed'; this.#kind = null; this.#warnLeft = 0; this.#clock = 0;
  }

  /** AUTO: 예고 중 그 kind 의 피격 구역(여유 0.5 포함)에 있으면 안전 지점을 돌려준다. 아니면 null. 새 객체를 만들지 않는다.
   * 안전 지점은 같은 방향의 outer → 선 안쪽(safe−1.2), center → 선 바깥(escape). 중심에 서 있으면 보스 반대쪽으로 잡는다.
   * @param {{pos:Vector3}} player */
  autoEvade(player) {
    if (this.#state !== 'warn') return null;
    const d = this.def, c = this.center, p = player.pos;
    const dx = p.x - c.x, dz = p.z - c.z, r = Math.hypot(dx, dz);
    const center = this.#kind === 'center';
    if (center ? r > d.safe + .5 : r < d.outerMin - .5 || r > d.outerMax + .5) return null;
    let ux = 0, uz = 1;
    if (r > 1e-6) { ux = dx / r; uz = dz / r; }
    else if (this.#boss) {
      const bx = p.x - this.#boss.pos.x, bz = p.z - this.#boss.pos.z, bl = Math.hypot(bx, bz);
      if (bl > 1e-6) { ux = bx / bl; uz = bz / bl; }
    }
    const to = center ? d.escape : d.safe - 1.2;
    return this.#safePoint.set(c.x + ux * to, 0, c.z + uz * to);
  }

  #cancel() { this.#state = 'armed'; this.#kind = null; this.#warnLeft = 0; }
  #end() { this.#state = 'ended'; this.#kind = null; this.#warnLeft = 0; }
  /** 전투 종료·중단. 반복 호출해도 안전하다. */
  stop() { this.#end(); }
}
