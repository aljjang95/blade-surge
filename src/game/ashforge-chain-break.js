import { Vector3 } from 'three';
import { audio } from '../engine/audio.js';

const EPS = 1e-9;
/** 방 안쪽 여유(가장자리에서 이만큼 안으로 자른다). B14 후방 우회 지점과 같은 값. */
const ROOM_MARGIN = 1.2;
/** 기둥이 열릴 때·사슬이 끊길 때 한 번 내는 합성음 옵션(낼 때마다 객체를 만들지 않는다). */
const OPEN_SOUND = { vol: .26, base: 392, notes: [0, 5, 10], step: .08, type: 'square' };
const CUT_SOUND = { vol: .32, base: 220, notes: [12, 7, 0], step: .07, type: 'sawtooth' };

/** 재벼림 제련소 심층 보스(잿빛 재벼림 거수)의 사슬 끊기(BUNDLE-15).
 * 원안의 남은 문장 "보스방 거수의 망치 충격파 뒤에만 열리는 조작 시간, 사슬 끌기 방향·끊기"의 보스 규칙이다. 새 애니메이션·리그 없이 기존 논리 상태만 쓴다.
 * 거수는 사슬 def.count 개에 묶여 나타난다. 용재 망치(def.signature)를 시전하면 사슬이 망치 착탄점(영웅 위치) 쪽 벽으로 끌리고(pullSide),
 * 보스방 반대편(중심에서 def.pillarOffset)에 사슬 기둥이 선다. 망치의 마지막 고리가 실제로 터진 다음 갱신부터 def.window 초 동안 기둥이 열리고
 * 망치가 박힌 거수는 제자리에 묶여(pins) 방향을 바꾸지 않으며 새 공격 대기(atkCd)를 창 끝까지 붙잡는다.
 * 열린 기둥(반경 def.radius) 안에서 영웅이 행동 없이(idle·move) 피해 없이 def.hold 초 버티면 사슬 하나가 끊긴다. 끊기면 def.exposed 초 동안
 * 거수가 휘청이며(제자리·새 공격 없음) 받는 모든 피해가 def.exposedMult 배가 되고, 끊을 때마다 남은 전투 내내 받는 피해가 def.weaken 씩 늘어난다
 * (사슬 k개를 끊었으면 1 + weaken × k 배, 휘청임 동안은 거기에 exposedMult 를 곱한다). 창이 끊김 없이 끝나면 놓침이다.
 * 사슬이 모두 끊기면 unchained 로 끊기 규칙이 끝나 평소 전투로 돌아간다(지킴·묶임 없음, 약화 배율만 남음).
 * chained 동안 시전 중인 용재 망치는 마지막 고리까지 기절·경직·자세 붕괴로 끊기지 않는다(guards, B14 후방 노출·종락 합창 장막과 같은 자리).
 * 그래도 망치가 마지막 고리 없이 끝나면(보스 처치 직전 등) broken 으로 센다.
 * 상태는 idle(보스 미부착) → chained ⇄ open → exposed → chained … → unchained, 그리고 ended(보스 처치·stop·전투 종료·다른 월드)이고 ended 는 되돌아오지 않는다.
 * 게임 시간(dt)만 쓰고 Math.random·Date 를 쓰지 않으며, update·filter·guards·pins·autoHold 는 객체를 만들지 않는다.
 * 피해 배율은 Enemy.hurt 가 boss.damageVeil.filter 로 부른다. 일시정지 중에는 창·버티기·노출 시계가 모두 멈춘다. */
export class AshforgeChainBreak {
  #state = 'idle';
  #boss = null;
  #cuts = 0;
  #windows = 0;
  #misses = 0;
  #broken = 0;
  #windowLeft = 0;
  #exposedLeft = 0;
  #exposedDamage = 0;
  #hold = 0;
  #lastHp = Infinity;
  #lastCutT = Infinity;
  /** 끌기 방향(x 부호). 끌기 중·열림이 아니면 0. */
  #pullSide = 0;
  /** 마지막으로 창을 연 attackSequence. 같은 망치로 두 번 열지 않는다. */
  #openedSeq = 0;
  /** 용재 망치가 시작된 뒤 마지막 고리를 기다리는 attackSequence(없으면 0). */
  #watchSeq = 0;
  /** 기둥 위치와 사슬이 끌리는 벽 지점(재사용). 끌기 중·열림에서만 뜻이 있다. */
  #pillar = new Vector3();
  #anchor = new Vector3();
  /** AUTO 목표(재사용). */
  #goal = new Vector3();
  /** 이번 창에서 보스 몸을 돌아가는 옆 경유점 단계를 마쳤는가. */
  #viaDone = false;
  /** 이번 창에서 옆 경유점을 한 번이라도 줬는가. 준 뒤 직선이 트이면 경유점 단계를 마친다(경계에서 두 지점을 오가지 않게). */
  #viaUsed = false;
  /** 지금 AUTO 목표 종류(0 기둥, 1 옆 경유점). 바뀌면 진전 감시를 다시 시작한다. */
  #goalKind = -1;
  #best = Infinity;
  #bestAt = 0;
  #giveUp = false;

  /** @param {{id:string, boss:string, signature:string, count:number, window:number, hold:number, radius:number,
   *   pillarOffset:number, anchorMargin:number, exposed:number, exposedMult:number, weaken:number}} def
   * @param {object|null} [world] 주어지면 다른 월드로 넘어간 뒤에는 ended 로 바꾼다. */
  constructor(def, world = null) {
    if (!def || typeof def.boss !== 'string' || typeof def.signature !== 'string' || !Number.isSafeInteger(def.count) || def.count < 1 ||
        !(def.window > 0) || !(def.hold > 0) || !(def.hold < def.window) || !(def.radius > 0) || !(def.pillarOffset > 0) ||
        !(def.anchorMargin >= 0) || !(def.exposed > 0) || !(def.exposedMult > 1) || !(def.weaken >= 0)) throw new RangeError('거수 사슬 정의가 올바르지 않습니다.');
    this.def = def; this.world = world;
    /** 토스트 문구(낼 때마다 문자열을 만들지 않는다). 끊김 토스트는 끊긴 수가 들어가 count 개만 미리 만든다. */
    this.attachToast = '거수의 사슬 ' + def.count + '개 · 망치가 끄는 반대편 기둥에서 버티세요';
    this.openToast = '사슬 기둥 열림 · ' + def.window + '초 안에 ' + def.hold + '초 버티기';
    this.cutToasts = Object.freeze(Array.from({ length: def.count }, (_, i) => '사슬 끊김 ' + (i + 1) + '/' + def.count + ' · 거수가 휘청인다'));
    this.freeToast = '거수의 사슬이 모두 끊겼다';
  }

  // ---------------- 읽기 상태(뷰·목표창·QA 가 읽기만 한다) ----------------
  get state() { return this.#state; }
  get boss() { return this.#boss; }
  get count() { return this.def.count; }
  get chainsLeft() { return this.def.count - this.#cuts; }
  get cuts() { return this.#cuts; }
  get windows() { return this.#windows; }
  get misses() { return this.#misses; }
  /** 용재 망치가 시작됐지만 마지막 고리 없이 끝난 횟수(관찰값). */
  get broken() { return this.#broken; }
  /** chained 이고 시전 중인 망치가 사슬을 끌고 있는가. */
  get pulling() { return this.#state === 'chained' && this.#pullSide !== 0; }
  /** 끌기 방향(x 부호, -1|1). 끌기 중·열림이 아니면 0. */
  get pullSide() { return this.#state === 'chained' || this.#state === 'open' ? this.#pullSide : 0; }
  /** 사슬 기둥 위치(재사용 벡터). 끌기 중·열림에서만 뜻이 있다. */
  get pillar() { return this.#pillar; }
  /** 사슬이 끌리는 벽 지점(재사용 벡터). 끌기 중·열림에서만 뜻이 있다. */
  get anchor() { return this.#anchor; }
  get hold() { return this.#state === 'open' ? this.#hold : 0; }
  get holdTotal() { return this.def.hold; }
  get windowLeft() { return this.#state === 'open' ? this.#windowLeft : 0; }
  get windowTotal() { return this.def.window; }
  get exposedLeft() { return this.#state === 'exposed' ? this.#exposedLeft : 0; }
  get exposedTotal() { return this.def.exposed; }
  get exposedDamage() { return this.#exposedDamage; }
  /** 지금 받는 피해 배율(약화 × 휘청임). 부착 전·ended 는 1. */
  get damageMult() {
    if (this.#state === 'idle' || this.#state === 'ended') return 1;
    const weak = 1 + this.def.weaken * this.#cuts;
    return this.#state === 'exposed' ? weak * this.def.exposedMult : weak;
  }
  /** 마지막 끊김 뒤 경과 초(뷰의 끊김 연출용). 끊긴 적이 없으면 Infinity. */
  get lastCutT() { return this.#lastCutT; }

  /** Enemy.hurt 가 방어·잠행 감쇄 뒤, 체력을 깎기 전에 부른다. 모든 피해(공격자 유무 상관없음)에 damageMult 를 곱한다
   * (끊은 사슬마다 weaken, exposed 동안 exposedMult). exposed 동안 들어간 피해는 exposedDamage 에 더한다. 새 객체를 만들지 않는다.
   * @param {number} dmg @param {any} [_attacker] */
  filter(dmg, _attacker) {
    if (!Number.isFinite(dmg) || this.#cuts === 0 && this.#state !== 'exposed') return dmg;
    const out = dmg * this.damageMult;
    if (this.#state === 'exposed') this.#exposedDamage += out;
    return out;
  }
  /** chained 동안 부착된 보스가 용재 망치를 시전 중이고 그 망치로 아직 창을 열지 않았으면 참(기절·경직·브레이크로 끊지 않음).
   * 마지막 고리가 터진 프레임과 창이 열리는 다음 컨트롤러 갱신 사이도 지킨다. @param {any} enemy */
  guards(enemy) {
    if (this.#state !== 'chained' || enemy !== this.#boss) return false;
    const sig = this.def.signature, plan = enemy.signatures?.plan;
    return enemy.state === 'attack' && enemy.special === sig && plan?.key === sig && enemy.attackSequence !== this.#openedSeq;
  }
  /** 끊긴 뒤 휘청이는 동안(exposed) 거수는 추격 단계에서 제자리에 서고 방향을 바꾸지 않으며 공격하지 않는다.
   * 기둥이 열린 동안(open, 망치가 박혀 사슬이 팽팽함)에는 쫓아가지 못한다: 영웅이 사거리(def.range × .92, Enemy 추격 분기와 같은 값) 밖이면 제자리에 서고,
   * 사거리 안이면 묶지 않아 평소처럼 돌아서 공격한다. 기둥을 무시하고 붙어 싸우는 플레이어가 공짜 안전 시간을 얻지 않게 한다(BUNDLE-15 PLAN 4.1 모의).
   * Enemy.update 의 추격 분기가 묻는다. 객체를 만들지 않는다. @param {any} enemy */
  pins(enemy) {
    if (enemy !== this.#boss) return false;
    if (this.#state === 'exposed') return true;
    if (this.#state !== 'open') return false;
    const p = enemy.game?.player;
    if (!p?.alive || !p.pos) return true;
    return Math.hypot(p.pos.x - enemy.pos.x, p.pos.z - enemy.pos.z) > (enemy.def?.range ?? 0) * .92;
  }

  /** AUTO: 기둥이 열려 있고 남은 창 안에 버티기를 끝낼 수 있으면 갈 지점(재사용 벡터)을 돌려준다. 그 밖에는 null(평소 전투).
   * 기둥 중심 .3 안이면 기둥 중심을 그대로 준다(Player 는 0 이동으로 서서 버틴다).
   * 영웅 → 기둥 직선이 보스 몸을 지나면 영웅 쪽에 가까운 옆 경유점을 먼저 주고, 닿거나 보스를 지나치면 그 창 동안 기둥만 준다.
   * 움직일 수 있는 상태(idle·move)에서 0.5초(게임 시간) 동안 목표에 0.05 이상 가까워지지 못하면 그 창에서 포기한다. @param {any} player */
  autoHold(player) {
    const boss = this.#boss, def = this.def;
    if (this.#state !== 'open' || !boss?.alive || !player?.alive || !player.pos || this.#giveUp) return null;
    if (def.hold - this.#hold > this.#windowLeft + EPS) return null;
    const px = player.pos.x, pz = player.pos.z, tx = this.#pillar.x, tz = this.#pillar.z;
    const d = Math.hypot(tx - px, tz - pz);
    if (d <= .3) { this.#goalKind = 0; this.#best = d; this.#bestAt = this.#windowLeft; return this.#goal.set(tx, 0, tz); }
    if (!this.#viaDone) {
      if (this.#via(boss, px, pz, tx, tz, d)) {
        this.#viaUsed = true;
        if (Math.hypot(this.#goal.x - px, this.#goal.z - pz) >= .6) return this.#progress(player, 1);
        this.#viaDone = true;
      } else if (this.#viaUsed) this.#viaDone = true;
    }
    this.#goal.set(tx, 0, tz);
    return this.#progress(player, 0);
  }
  /** 영웅 → 기둥 직선이 보스 몸(+영웅 몸)을 지나면 옆 경유점을 #goal 에 담고 참. 지나지 않거나 이미 보스를 지나쳤으면 경유점 단계를 마친다. */
  #via(boss, px, pz, tx, tz, d) {
    const body = (Number.isFinite(boss.radius) ? boss.radius : .7 * (boss.def?.scale || 1)) + .7;
    const ux = (tx - px) / d, uz = (tz - pz) / d, bx = boss.pos.x - px, bz = boss.pos.z - pz;
    const along = bx * ux + bz * uz, lateral = bx * -uz + bz * ux;
    // 보스가 이미 영웅 뒤쪽이거나 기둥 너머면 가로지를 몸이 없다. 보스를 지나쳤으면 이 창의 경유점 단계를 마친다.
    if (along <= 0) { this.#viaDone = true; return false; }
    if (along >= d || Math.abs(lateral) >= body) return false;
    // 보스가 직선의 왼쪽(lateral ≥ 0)이면 오른쪽으로, 아니면 왼쪽으로 돈다. 그쪽이 벽에 잘려 몸 안이면 반대쪽을 쓴다.
    const first = lateral >= 0 ? -1 : 1, room = boss.homeRoom || this.world?.bossRoom;
    for (const s of first > 0 ? SIDES_POS_FIRST : SIDES_NEG_FIRST) {
      this.#clampTo(room, boss.pos.x + s * -uz * (body + 1), boss.pos.z + s * ux * (body + 1), this.#goal);
      if (Math.hypot(this.#goal.x - boss.pos.x, this.#goal.z - boss.pos.z) >= body) return true;
    }
    return false;
  }
  /** 지금 목표까지의 진전을 본다. 목표 종류가 바뀌면 감시를 다시 시작한다. 공격·회피·스킬 동작 중에는 진전 시계를 멈춘다. */
  #progress(player, kind) {
    const d = Math.hypot(this.#goal.x - player.pos.x, this.#goal.z - player.pos.z);
    if (kind !== this.#goalKind) { this.#goalKind = kind; this.#best = d; this.#bestAt = this.#windowLeft; return this.#goal; }
    if (d < this.#best - .05) { this.#best = d; this.#bestAt = this.#windowLeft; }
    else if (player.state !== 'idle' && player.state !== 'move') this.#bestAt = this.#windowLeft;
    else if (this.#bestAt - this.#windowLeft > .5) { this.#giveUp = true; return null; }
    return this.#goal;
  }
  /** 지점을 보스방 안쪽(가장자리 ROOM_MARGIN)으로 잘라 out 에 담는다. */
  #clampTo(room, x, z, out) {
    if (room && Number.isFinite(room.w) && Number.isFinite(room.h)) {
      x = Math.max(room.x - room.w / 2 + ROOM_MARGIN, Math.min(room.x + room.w / 2 - ROOM_MARGIN, x));
      z = Math.max(room.z - room.h / 2 + ROOM_MARGIN, Math.min(room.z + room.h / 2 - ROOM_MARGIN, z));
    }
    return out.set(x, 0, z);
  }

  // ---------------- 프레임 ----------------
  update(game, dt) {
    if (this.#state === 'ended') return;
    if (game.paused) return;
    if (game.bossDefeated || !game.active || (this.world && game.world !== this.world)) { this.#end(); return; }
    if (this.#state === 'idle') {
      const b = game.boss;
      if (!b || !b.alive || b.spawning || !b.isBoss || !b.signatures) return;
      if ((b.runtimeSpeciesId || game.stage?.encounter?.enemyId) !== this.def.boss) return;
      this.#boss = b; b.damageVeil = this; this.#state = 'chained';
      game.ui?.toast?.(this.attachToast, 'gold');
      return;
    }
    const boss = this.#boss;
    if (!boss.alive) { this.#end(); return; }
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.#lastCutT += dt;
    if (this.#state === 'open') { this.#stepOpen(game, boss, dt); return; }
    if (this.#state === 'exposed') {
      this.#exposedLeft -= dt;
      if (this.#exposedLeft <= EPS) {
        this.#exposedLeft = 0;
        if (this.#cuts < this.def.count) this.#state = 'chained';
        else {
          // 끊기 규칙은 끝나지만 약화 배율은 남으므로 damageVeil 은 그대로 둔다(지킴·묶임은 unchained 에서 거짓).
          this.#state = 'unchained';
          game.ui?.toast?.(this.freeToast, 'gold');
        }
      } else if (boss.atkCd < this.#exposedLeft + dt) boss.atkCd = this.#exposedLeft + dt;
      return;
    }
    if (this.#state === 'chained') this.#watch(game, boss, dt);
  }

  #stepOpen(game, boss, dt) {
    this.#windowLeft -= dt;
    const p = game.player;
    if (p?.alive && p.pos) {
      // 이번 갱신에 hp 가 줄었으면 피격이다(회복은 늘기만 하므로 피해만 잡는다).
      const hurt = p.hp < this.#lastHp - EPS; this.#lastHp = p.hp;
      const inside = Math.hypot(p.pos.x - this.#pillar.x, p.pos.z - this.#pillar.z) <= this.def.radius;
      const stable = p.state === 'idle' || p.state === 'move';
      this.#hold = inside && stable && !hurt ? this.#hold + dt : 0;
      if (this.#hold + EPS >= this.def.hold) { this.#cut(game, boss, dt); return; }
    } else { this.#hold = 0; this.#lastHp = Infinity; }
    if (this.#windowLeft <= EPS) {
      this.#windowLeft = 0; this.#hold = 0; this.#pullSide = 0; this.#misses++; this.#state = 'chained';
    }
  }

  /** chained 동안 용재 망치의 시작(끌기 방향)·마지막 고리(창 열림)·끊김(broken)을 본다. */
  #watch(game, boss, dt) {
    const sig = this.def.signature, plan = boss.signatures?.plan;
    const casting = boss.state === 'attack' && boss.special === sig && plan?.key === sig;
    if (this.#watchSeq) {
      if (boss.completedAttackSequence === this.#watchSeq) { this.#watchSeq = 0; this.#open(game, boss, dt); return; }
      if (!casting || boss.attackSequence !== this.#watchSeq) { this.#broken++; this.#watchSeq = 0; this.#pullSide = 0; }
      else return;
    }
    if (casting && boss.attackSequence !== this.#openedSeq) {
      this.#watchSeq = boss.attackSequence;
      this.#startPull(boss, plan);
      if (boss.completedAttackSequence === this.#watchSeq) { this.#watchSeq = 0; this.#open(game, boss, dt); }
    }
  }
  /** 망치 착탄점(시그니처 계획의 첫 원판, 영웅 위치) 쪽 벽으로 사슬이 끌리고, 기둥은 방 중심의 반대편에 선다.
   * 착탄점이 중심에서 x 로 1 안쪽이면 창 번호의 짝홀로 정한다(결정적). */
  #startPull(boss, plan) {
    const room = boss.homeRoom || this.world?.bossRoom || { x: boss.pos.x, z: boss.pos.z, w: 0, h: 0 };
    const ev = plan?.events?.[0], ix = ev && Number.isFinite(ev.x) ? ev.x : boss.pos.x, dx = ix - room.x;
    const side = Math.abs(dx) >= 1 ? Math.sign(dx) : (this.#windows % 2 ? -1 : 1);
    this.#pullSide = side;
    this.#clampTo(room, room.x - side * this.def.pillarOffset, room.z, this.#pillar);
    const half = Number.isFinite(room.w) ? room.w / 2 : 0;
    this.#anchor.set(room.x + side * Math.max(0, half - this.def.anchorMargin), 0, boss.pos.z);
    if (room && Number.isFinite(room.h) && room.h > 0) {
      this.#anchor.z = Math.max(room.z - room.h / 2 + this.def.anchorMargin, Math.min(room.z + room.h / 2 - this.def.anchorMargin, this.#anchor.z));
    }
  }
  #open(game, boss, dt) {
    this.#openedSeq = boss.attackSequence;
    this.#state = 'open'; this.#windowLeft = this.def.window; this.#windows++; this.#hold = 0;
    this.#lastHp = game.player?.alive ? game.player.hp : Infinity;
    this.#viaDone = false; this.#viaUsed = false; this.#goalKind = -1; this.#best = Infinity; this.#bestAt = this.#windowLeft; this.#giveUp = false;
    audio.magic?.(OPEN_SOUND);
    game.ui?.toast?.(this.openToast, 'gold');
  }
  #cut(game, boss, dt) {
    this.#cuts++; this.#hold = 0; this.#windowLeft = 0; this.#pullSide = 0; this.#lastCutT = 0;
    this.#state = 'exposed'; this.#exposedLeft = this.def.exposed;
    // 휘청이는 동안 새 공격 대기를 남은 시간 이상으로 붙잡는다(원래 대기보다 짧게 만들지 않는다). 보스는 같은 프레임에 대기를 dt 만큼 줄이므로 dt 를 더한다.
    if (boss.atkCd < this.#exposedLeft + dt) boss.atkCd = this.#exposedLeft + dt;
    audio.magic?.(CUT_SOUND);
    game.ui?.toast?.(this.cutToasts[this.#cuts - 1], 'gold');
  }
  #end() {
    this.#state = 'ended'; this.#windowLeft = 0; this.#exposedLeft = 0; this.#hold = 0; this.#watchSeq = 0; this.#pullSide = 0;
    const boss = this.#boss;
    if (boss && boss.damageVeil === this) boss.damageVeil = null;
  }
  /** 전투 종료·중단. 반복 호출해도 안전하다. */
  stop() { this.#end(); }
  /** 결과 보고(고정 객체). */
  report() {
    return Object.freeze({ id: this.def.id, count: this.def.count, windows: this.#windows, cuts: this.#cuts, misses: this.#misses,
      exposedDamage: Math.round(this.#exposedDamage), broken: this.#broken });
  }
}
/** 옆 경유점을 시도하는 순서. 프레임마다 배열을 만들지 않는다. */
const SIDES_POS_FIRST = Object.freeze([1, -1]), SIDES_NEG_FIRST = Object.freeze([-1, 1]);
