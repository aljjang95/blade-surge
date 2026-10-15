import { audio } from '../engine/audio.js';

const EPS = 1e-9;
/** 합창 장막을 두를 보스의 적 id. 같은 보스를 쓰는 다른 던전은 이 컨트롤러가 만들어지지 않아 영향이 없다. */
const BOSS_ENEMY = 'glass_hour_sovereign';
/** 창이 열릴 때 한 번 내는 합성음 옵션(열 때마다 객체를 만들지 않는다). */
const OPEN_SOUND = { vol: .3, base: 523, notes: [0, 4, 7, 12], step: .07, type: 'triangle' };

/** 종락 회랑 심층 보스의 합창 장막.
 * 보스가 나타나면 장막(veiled)에 싸여 받는 피해가 def.veil 배로 줄어든다.
 * 삼중 조종(def.signature)의 마지막 울림이 터진 직후 def.window 초 동안만 장막이 걷혀(open) def.open 배 피해를 받고,
 * 그동안 보스의 다음 공격 대기(atkCd)를 창 남은 시간 이상으로 붙잡아 새 공격을 시작하지 못하게 한다.
 * 장막이 덮인 동안 보스의 삼중 조종은 마지막 울림까지 기절·경직·브레이크로 끊기지 않는다(guards). 그래도 조종이 열리지 못하고 끝나면
 * (보스 처치 직전 등) broken 으로 센다. 같은 attackSequence 로는 한 번만 연다.
 * 상태는 idle(보스 미부착) → veiled ⇄ open → ended(보스 처치·stop·전투 종료)이고 ended 는 되돌아오지 않는다.
 * 게임 시간(dt)만 쓰고 Math.random·Date 를 쓰지 않으며, update·filter 는 객체를 만들지 않는다.
 * 읽기 상태는 뷰·목표창이 읽기만 한다. 피해 감쇄는 Enemy.hurt 가 boss.damageVeil.filter 로 부른다. */
export class BellfallDeepCounter {
  #state = 'idle';
  #boss = null;
  #windowLeft = 0;
  #windows = 0;
  #broken = 0;
  #veiledHits = 0;
  #openHits = 0;
  #veiledDamage = 0;
  #openDamage = 0;
  /** 마지막으로 창을 연 attackSequence. 같은 조종으로 두 번 열지 않는다. */
  #openedSeq = 0;
  /** 삼중 조종이 시작된 뒤 마지막 울림을 기다리는 attackSequence(없으면 0). */
  #watchSeq = 0;

  /** @param {{id:string, signature:string, window:number, veil:number, open:number}} def
   * @param {object|null} [world] 주어지면 다른 월드로 넘어간 뒤에는 ended 로 바꾼다. */
  constructor(def, world = null) {
    if (!def || !(def.window > 0) || !(def.veil > 0) || !(def.open > 0)) throw new RangeError('합창 장막 정의가 올바르지 않습니다.');
    this.def = def; this.world = world;
    /** 창이 열릴 때의 토스트 문구(열 때마다 문자열을 만들지 않는다). */
    this.openToast = '장막이 걷혔다 · ' + def.window + '초 반격';
  }

  // ---------------- 읽기 상태 ----------------
  get state() { return this.#state; }
  /** 반격 창 남은 초. open 밖에서는 0. */
  get windowLeft() { return this.#state === 'open' ? this.#windowLeft : 0; }
  get windowTotal() { return this.def.window; }
  get windows() { return this.#windows; }
  get boss() { return this.#boss; }
  get veiledHits() { return this.#veiledHits; }
  get openHits() { return this.#openHits; }
  get veiledDamage() { return this.#veiledDamage; }
  get openDamage() { return this.#openDamage; }
  /** 삼중 조종이 시작됐지만 마지막 울림 전에 끊긴 횟수(판정에는 쓰지 않는 관찰값). */
  get broken() { return this.#broken; }

  damageMul() {
    return this.#state === 'open' ? this.def.open : this.#state === 'veiled' ? this.def.veil : 1;
  }
  /** Enemy.hurt 가 방어·잠행 감쇄 뒤, 체력을 깎기 전에 부른다. 새 객체를 만들지 않는다.
   * @param {number} dmg */
  filter(dmg) {
    const out = dmg * this.damageMul();
    if (this.#state === 'open') { this.#openHits++; this.#openDamage += out; }
    else if (this.#state === 'veiled') { this.#veiledHits++; this.#veiledDamage += out; }
    return out;
  }

  /** 장막이 삼중 조종을 지키는 중인가: veiled 동안 부착된 보스가 이 시그니처를 시전 중이고 그 조종으로 아직 창을 열지 않았으면 참.
   * 마지막 고리가 터진 프레임과 창이 열리는 다음 컨트롤러 갱신 사이(Battle 순서상 player 단계 한 번)도 지킨다. 창이 열리면 지키지 않는다.
   * Enemy.hurt·Enemy.update·postureHit 가 이 동안 기절·경직·브레이크로 조종을 끊지 않도록 묻는다. 객체를 만들지 않는다.
   * @param {any} enemy */
  guards(enemy) {
    if (this.#state !== 'veiled' || enemy !== this.#boss) return false;
    const sig = this.def.signature, plan = enemy.signatures?.plan;
    return enemy.state === 'attack' && enemy.special === sig && plan?.key === sig && enemy.attackSequence !== this.#openedSeq;
  }

  // ---------------- 프레임 ----------------
  update(game, dt) {
    if (this.#state === 'ended') return;
    // 일시정지 중에는 창 시계도 멈춘다(Battle.update 가 돌지 않는 동안에도 같다).
    if (game.paused) return;
    if (game.bossDefeated || !game.active || (this.world && game.world !== this.world)) { this.#end(); return; }
    if (this.#state === 'idle') {
      const b = game.boss;
      if (!b || !b.alive || b.spawning || !b.isBoss || !b.signatures) return;
      if ((b.runtimeSpeciesId || game.stage?.encounter?.enemyId) !== BOSS_ENEMY) return;
      this.#boss = b; b.damageVeil = this; this.#state = 'veiled';
      game.ui?.toast?.('합창 장막 · 마지막 울림 직후에만 장막이 걷힙니다', 'gold');
      return;
    }
    const boss = this.#boss;
    if (!boss.alive) { this.#end(); return; }
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (this.#state === 'open') {
      this.#windowLeft -= dt;
      if (this.#windowLeft <= EPS) { this.#windowLeft = 0; this.#state = 'veiled'; }
      // 새 공격 대기를 창 남은 시간 이상으로 붙잡는다. 원래 대기보다 짧게 만들지는 않는다.
      // 보스는 같은 프레임에 대기를 dt 만큼 줄이므로 dt 를 더해 두어야 창이 닫히기 전 마지막 프레임에 공격이 시작되지 않는다.
      else if (boss.atkCd < this.#windowLeft + dt) boss.atkCd = this.#windowLeft + dt;
      return;
    }
    this.#watch(game, boss, dt);
  }

  /** veiled 동안 삼중 조종의 시작·마지막 울림·끊김을 본다. */
  #watch(game, boss, dt) {
    const sig = this.def.signature, plan = boss.signatures?.plan;
    const casting = boss.state === 'attack' && boss.special === sig && plan?.key === sig;
    if (this.#watchSeq) {
      // 마지막 울림 = BossSignatures 가 마지막 고리를 실제로 터뜨리며 completedAttackSequence 를 쓴 순간. 그 뒤 상태가 바뀌었어도 연다.
      if (boss.completedAttackSequence === this.#watchSeq) { this.#watchSeq = 0; this.#open(game, boss, dt); return; }
      // 감시 중인 조종이 마지막 울림 없이 바뀌거나 끝났다 = 끊김.
      if (!casting || boss.attackSequence !== this.#watchSeq) { this.#broken++; this.#watchSeq = 0; }
      else return;
    }
    if (casting && boss.attackSequence !== this.#openedSeq) {
      this.#watchSeq = boss.attackSequence;
      // 이미 마지막 울림이 지난 프레임에 처음 보더라도 놓치지 않는다.
      if (boss.completedAttackSequence === this.#watchSeq) { this.#watchSeq = 0; this.#open(game, boss, dt); }
    }
  }

  #open(game, boss, dt) {
    this.#openedSeq = boss.attackSequence;
    this.#state = 'open'; this.#windowLeft = this.def.window; this.#windows++;
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
}
