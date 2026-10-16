import { Vector3 } from 'three';
import { audio } from '../engine/audio.js';

const EPS = 1e-9;
/** 노출이 열릴 때 한 번 내는 합성음 옵션(열 때마다 객체를 만들지 않는다). */
const OPEN_SOUND = { vol: .3, base: 330, notes: [0, 7, 12], step: .08, type: 'square' };

/** 잿불금고 심층 보스(쇠사슬의 집행자)의 후방 노출(BUNDLE-14).
 * 원안 "밀물 경고가 끝난 뒤 냉각 밸브를 열고 사슬 집행자의 후방을 공격"의 보스 규칙이다. 새 애니메이션·리그 없이 기존 논리 상태만 쓴다.
 * 용재 망치(def.signature)의 마지막 고리가 실제로 터진 직후(BossSignatures 가 completedAttackSequence 를 쓴 순간) def.window 초 동안
 * 망치가 바닥에 박혀 집행자가 그 자리에 묶이고(pins) 방향을 바꾸지 않으며, 다음 공격 대기(atkCd)를 창 남은 시간 이상으로 붙잡는다.
 * 그동안 받는 피해는 맞은 방향(공격자 → 보스, Enemy.hurt 의 dirx·dirz)과 보스 정면(yaw)의 내적으로 나눈다:
 * def.rearDot 이상이면 등 뒤(def.rear 배), -def.frontDot 이하면 정면 사슬 갑주(def.front 배), 그 사이(옆)와 방향 없는 피해(중독 등)는 1배다.
 * 창 밖에서는 늘 1배다. 같은 attackSequence 로는 한 번만 연다.
 * armored 동안 시전 중인 용재 망치는 마지막 고리까지 기절·경직·자세 붕괴로 끊기지 않는다(guards, 종락 합창 장막과 같은 자리).
 * 장비를 갖춘 영웅은 치명타·기절로 망치를 거의 늘 끊어 창이 열리지 않았다(BUNDLE-14 PLAN 4.1, 브라우저 진단). 그래도 망치가 마지막 고리 없이 끝나면(보스 처치 직전 등) broken 으로 센다.
 * 상태는 idle(보스 미부착) → armored ⇄ exposed → ended(보스 처치·stop·전투 종료·다른 월드)이고 ended 는 되돌아오지 않는다.
 * 게임 시간(dt)만 쓰고 Math.random·Date 를 쓰지 않으며, update·filter·pins·autoFlank 는 객체를 만들지 않는다.
 * 피해 배율은 Enemy.hurt 가 boss.damageVeil.filter 로 부른다(합창 장막과 같은 자리). */
export class EmberRearExposure {
  #state = 'idle';
  #boss = null;
  #windowLeft = 0;
  #windows = 0;
  #broken = 0;
  #rearHits = 0;
  #frontHits = 0;
  #sideHits = 0;
  #rearDamage = 0;
  #frontDamage = 0;
  /** 마지막으로 창을 연 attackSequence. 같은 망치로 두 번 열지 않는다. */
  #openedSeq = 0;
  /** 용재 망치가 시작된 뒤 마지막 고리를 기다리는 attackSequence(없으면 0). */
  #watchSeq = 0;
  /** 마지막 피해의 방향 구분('rear'|'front'|'side'|''). 뷰가 읽기만 한다. */
  #lastSide = '';
  #lastSideT = Infinity;
  /** AUTO 우회 지점(재사용). */
  #flank = new Vector3();

  /** @param {{id:string, boss:string, signature:string, window:number, rearDot:number, frontDot:number, rear:number, front:number,
   *   autoDot:number, meleeReach:number, rangedReach:number, sidePad:number}} def
   * @param {object|null} [world] 주어지면 다른 월드로 넘어간 뒤에는 ended 로 바꾼다. */
  constructor(def, world = null) {
    if (!def || typeof def.boss !== 'string' || typeof def.signature !== 'string' || !(def.window > 0) || !(def.rear > 0) || !(def.front > 0) ||
        !(def.rearDot > 0 && def.rearDot < 1) || !(def.frontDot > 0 && def.frontDot < 1) || !(def.autoDot >= def.rearDot && def.autoDot < 1) ||
        !(def.meleeReach > 0) || !(def.rangedReach > 0) || !(def.sidePad >= 0)) throw new RangeError('후방 노출 정의가 올바르지 않습니다.');
    this.def = def; this.world = world;
    /** 창이 열릴 때의 토스트 문구(열 때마다 문자열을 만들지 않는다). */
    this.openToast = '망치가 박혔다 · ' + def.window + '초 동안 등 뒤가 약점';
  }

  // ---------------- 읽기 상태 ----------------
  get state() { return this.#state; }
  /** 노출 창 남은 초. exposed 밖에서는 0. */
  get windowLeft() { return this.#state === 'exposed' ? this.#windowLeft : 0; }
  get windowTotal() { return this.def.window; }
  get windows() { return this.#windows; }
  get boss() { return this.#boss; }
  get rearHits() { return this.#rearHits; }
  get frontHits() { return this.#frontHits; }
  get sideHits() { return this.#sideHits; }
  get rearDamage() { return this.#rearDamage; }
  get frontDamage() { return this.#frontDamage; }
  /** 용재 망치가 시작됐지만 마지막 고리 없이 끝난 횟수(판정에는 쓰지 않는 관찰값). 지키는 동안에도 보스 처치 등으로 생길 수 있다. */
  get broken() { return this.#broken; }
  /** 노출 창 안에서 마지막으로 맞은 방향과 그 뒤 경과 초(뷰의 짧은 반짝임용). */
  get lastSide() { return this.#lastSide; }
  get lastSideT() { return this.#lastSideT; }

  /** 맞은 방향 구분. dirx·dirz 는 공격자 → 보스 방향이다(방패병 정면 가드와 같은 규약). 방향이 없으면 'side'(1배).
   * @param {number} [dirx] @param {number} [dirz] */
  sideOf(dirx = 0, dirz = 0) {
    const boss = this.#boss, l = Math.hypot(dirx, dirz);
    if (!boss || !(l > EPS)) return 'side';
    const dot = (dirx / l) * Math.sin(boss.yaw) + (dirz / l) * Math.cos(boss.yaw);
    return dot >= this.def.rearDot ? 'rear' : dot <= -this.def.frontDot ? 'front' : 'side';
  }
  /** Enemy.hurt 가 방어·잠행 감쇄 뒤, 체력을 깎기 전에 부른다. 중독 틱은 방향 없이 부른다(1배). 새 객체를 만들지 않는다.
   * @param {number} dmg @param {number} [dirx] @param {number} [dirz] */
  filter(dmg, dirx, dirz) {
    if (this.#state !== 'exposed') return dmg;
    if (dirx === undefined && dirz === undefined) return dmg;
    const side = this.sideOf(dirx, dirz);
    this.#lastSide = side; this.#lastSideT = 0;
    if (side === 'rear') { const out = dmg * this.def.rear; this.#rearHits++; this.#rearDamage += out; return out; }
    if (side === 'front') { const out = dmg * this.def.front; this.#frontHits++; this.#frontDamage += out; return out; }
    this.#sideHits++;
    return dmg;
  }
  /** 후방 노출이 용재 망치를 지키는 중인가: armored 동안 부착된 보스가 이 시그니처를 시전 중이고 그 망치로 아직 창을 열지 않았으면 참.
   * 마지막 고리가 터진 프레임과 창이 열리는 다음 컨트롤러 갱신 사이도 지킨다. 창이 열리면(exposed) 지키지 않는다.
   * Enemy.hurt·Enemy.update·postureHit 가 이 동안 기절·경직·브레이크로 망치를 끊지 않도록 묻는다. 객체를 만들지 않는다.
   * @param {any} enemy */
  guards(enemy) {
    if (this.#state !== 'armored' || enemy !== this.#boss) return false;
    const sig = this.def.signature, plan = enemy.signatures?.plan;
    return enemy.state === 'attack' && enemy.special === sig && plan?.key === sig && enemy.attackSequence !== this.#openedSeq;
  }
  /** 노출 창 동안 부착된 보스는 추격 단계에서 제자리에 서고 방향을 바꾸지 않는다. Enemy.update 의 추격 분기가 묻는다. @param {any} enemy */
  pins(enemy) { return this.#state === 'exposed' && enemy === this.#boss; }

  /** AUTO: 노출 창 동안 영웅이 등 뒤 사거리 안에 없으면 갈 지점을 돌려준다(이미 있으면 null 이라 평소 전투를 한다).
   * 정면 쪽이면 몸을 가로지르지 않게 가까운 옆 경유점을, 옆·뒤쪽이면 등 뒤 점을 준다. 보스방 안쪽으로 자른다. 재사용 벡터를 돌려준다.
   * 옆 경유점에 이미 닿았으면(방 가장자리에서 잘려 앞쪽으로 남은 경유점 포함) 등 뒤 점을 준다. 같은 경유점에 서서 멈추지 않는다.
   * @param {any} player */
  autoFlank(player) {
    const boss = this.#boss;
    if (this.#state !== 'exposed' || !boss?.alive || !player?.alive || !player.pos) return null;
    const def = this.def, fx = Math.sin(boss.yaw), fz = Math.cos(boss.yaw);
    const vx = player.pos.x - boss.pos.x, vz = player.pos.z - boss.pos.z, dist = Math.hypot(vx, vz);
    const reach = player.def?.ranged ? def.rangedReach : def.meleeReach;
    // 공격자 → 보스 방향과 정면의 내적(filter 와 같은 식). 영웅이 보스 위에 겹쳐 있으면 정면 쪽으로 본다.
    const dot = dist > EPS ? (-vx / dist) * fx + (-vz / dist) * fz : -1;
    if (dot >= def.autoDot && dist <= reach + .6) return null;
    const room = boss.homeRoom;
    if (dot < def.autoDot && vx * fx + vz * fz > -.5) {
      // 정면·옆 앞쪽: 영웅이 있는 쪽 옆으로 돌아 들어간다(오른쪽 = (fz, -fx)).
      const s = vx * fz - vz * fx >= 0 ? 1 : -1, r = reach + def.sidePad;
      this.#clampTo(room, boss.pos.x + s * fz * r - fx * .8, boss.pos.z - s * fx * r - fz * .8);
      if (Math.hypot(this.#flank.x - player.pos.x, this.#flank.z - player.pos.z) >= .6) return this.#flank;
    }
    return this.#clampTo(room, boss.pos.x - fx * reach, boss.pos.z - fz * reach);
  }
  /** 우회 지점을 보스방 안쪽(가장자리 1.2)으로 잘라 재사용 벡터에 담는다. */
  #clampTo(room, tx, tz) {
    if (room && Number.isFinite(room.w) && Number.isFinite(room.h)) {
      const m = 1.2;
      tx = Math.max(room.x - room.w / 2 + m, Math.min(room.x + room.w / 2 - m, tx));
      tz = Math.max(room.z - room.h / 2 + m, Math.min(room.z + room.h / 2 - m, tz));
    }
    return this.#flank.set(tx, 0, tz);
  }

  // ---------------- 프레임 ----------------
  update(game, dt) {
    if (this.#state === 'ended') return;
    // 일시정지 중에는 창 시계도 멈춘다.
    if (game.paused) return;
    if (game.bossDefeated || !game.active || (this.world && game.world !== this.world)) { this.#end(); return; }
    if (this.#state === 'idle') {
      const b = game.boss;
      if (!b || !b.alive || b.spawning || !b.isBoss || !b.signatures) return;
      if ((b.runtimeSpeciesId || game.stage?.encounter?.enemyId) !== this.def.boss) return;
      this.#boss = b; b.damageVeil = this; this.#state = 'armored';
      game.ui?.toast?.('사슬 갑주 · 용재 망치가 박히면 등 뒤를 노리세요', 'gold');
      return;
    }
    const boss = this.#boss;
    if (!boss.alive) { this.#end(); return; }
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.#lastSideT += dt;
    if (this.#state === 'exposed') {
      this.#windowLeft -= dt;
      if (this.#windowLeft <= EPS) { this.#windowLeft = 0; this.#state = 'armored'; }
      // 새 공격 대기를 창 남은 시간 이상으로 붙잡는다(원래 대기보다 짧게 만들지 않는다). 보스는 같은 프레임에 대기를 dt 만큼 줄이므로 dt 를 더한다.
      else if (boss.atkCd < this.#windowLeft + dt) boss.atkCd = this.#windowLeft + dt;
      return;
    }
    this.#watch(game, boss, dt);
  }

  /** armored 동안 용재 망치의 시작·마지막 고리·끊김을 본다. */
  #watch(game, boss, dt) {
    const sig = this.def.signature, plan = boss.signatures?.plan;
    const casting = boss.state === 'attack' && boss.special === sig && plan?.key === sig;
    if (this.#watchSeq) {
      if (boss.completedAttackSequence === this.#watchSeq) { this.#watchSeq = 0; this.#open(game, boss, dt); return; }
      if (!casting || boss.attackSequence !== this.#watchSeq) { this.#broken++; this.#watchSeq = 0; }
      else return;
    }
    if (casting && boss.attackSequence !== this.#openedSeq) {
      this.#watchSeq = boss.attackSequence;
      if (boss.completedAttackSequence === this.#watchSeq) { this.#watchSeq = 0; this.#open(game, boss, dt); }
    }
  }

  #open(game, boss, dt) {
    this.#openedSeq = boss.attackSequence;
    this.#state = 'exposed'; this.#windowLeft = this.def.window; this.#windows++;
    if (boss.atkCd < this.#windowLeft + dt) boss.atkCd = this.#windowLeft + dt;
    audio.magic?.(OPEN_SOUND);
    game.ui?.toast?.(this.openToast, 'gold');
  }

  #end() {
    this.#state = 'ended'; this.#windowLeft = 0; this.#watchSeq = 0;
    const boss = this.#boss;
    if (boss && boss.damageVeil === this) boss.damageVeil = null;
  }
  /** 전투 종료·중단. 반복 호출해도 안전하다. */
  stop() { this.#end(); }
  /** 결과 보고(고정 객체). */
  report() {
    return Object.freeze({ id: this.def.id, windows: this.#windows, rearHits: this.#rearHits, frontHits: this.#frontHits, sideHits: this.#sideHits,
      rearDamage: Math.round(this.#rearDamage), frontDamage: Math.round(this.#frontDamage), broken: this.#broken });
  }
}
