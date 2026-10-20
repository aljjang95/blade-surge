// 핵앤슬래시 타격감 튜닝 표와 순수 계산. 난수·DOM·시간(Date) 없이 step 의 시뮬레이션 시각(elapsed)만 쓴다.
// 화면 흔들림·FOV 펀치는 오너 결정으로 쓰지 않는다(renderer.shake/punch 는 의도적 no-op) — 무게는 정지·섬광·슬로우로 전한다.

export const FEEL = Object.freeze({
  // 히트스탑: base 는 타격 등급별 기본 정지(초). 실제 정지 = base * (1 + 무게 합), 상한 max.
  hitstop: Object.freeze({
    base: Object.freeze({ light: .045, basic: .05, crit: .06, boss: .06, heavy: .075, counter: .09, finisher: .11 }),
    shareGain: 2,      // 쓰러지지 않은 타격의 피해 / 대상 최대 HP 비율에 곱한다(큰 한 방일수록 무겁다)
    shareCap: .4,
    crowdStep: .05,    // 같은 창(crowdWindow) 안에서 두 번째 대상부터 한 명당 더해지는 무게
    crowdCap: .3,
    crowdWindow: .06,
    elite: .2,         // 정예 타격
    kill: .12,         // 쓰러뜨리는 타격은 피해 비율 대신 이 값(졸개 일격 처치가 매번 무겁지 않게)
    weightCap: 1,      // 무게 합 상한(전부 겹쳐도 기본의 2배까지)
    max: .13,          // 한 번의 정지 상한(ImpactClock HITSTOP_CAP .18 보다 작다)
  }),
  // 피격 섬광: 가벼운 타격은 그대로(gain 1), 무거울수록 길고 밝다.
  flash: Object.freeze({
    baseSec: .12, maxSec: .22, gainMax: 1.6, perWeight: .55,
  }),
  // 슬로우모션(sim dt 배율). 끝 ease 초 동안 1 로 부드럽게 복귀한다.
  slowmo: Object.freeze({
    roomClear: Object.freeze({ scale: .32, sec: .5, ease: .28, accent: true }),   // 방의 마지막 적(accent: 가장자리 속도선)
    eliteKill: Object.freeze({ scale: .5, sec: .26, ease: .16 }),
    minRoomKills: 4,     // 이 수 이상 처치한 방의 마지막 적일 때만(1~2마리 방에선 끊김이 거슬린다)
    cooldown: 5,         // 슬로우 사이 최소 시뮬레이션 간격(초)
  }),
  // 연속 처치. multi = 짧은 창 안의 묶음 처치, streak = 3.4초 안에 이어지는 누적 처치.
  kill: Object.freeze({
    streakHold: 3.4,
    multiWindow: .7,
    // n 마리째에 단계 진입. ult/mp 는 궁극기 게이지·MP 보상(한 묶음에 단계마다 한 번). 누적 연속 처치(3.4초 유지)의 알약·보상은 기존 그대로다.
    multiSteps: Object.freeze([
      Object.freeze({ n: 3, ult: 1, mp: 0, ring: 3.2, pitch: 1 }),
      Object.freeze({ n: 5, ult: 2, mp: 2, ring: 4.4, pitch: 1.25 }),
      Object.freeze({ n: 8, ult: 3, mp: 4, ring: 5.6, pitch: 1.5 }),
      Object.freeze({ n: 12, ult: 5, mp: 6, ring: 7, pitch: 1.8 }),
    ]),
  }),
  // 전투 VFX(절차적 셰이더·인스턴싱). 시간은 FX.update 로 들어오는 sim dt 뿐이라 히트스톱·슬로우를 그대로 따른다.
  // 난수는 전투 난수와 분리된 VfxRng 스트림만 쓴다. 길이 m, 속도 m/s, 시간 초.
  vfx: Object.freeze({
    // 처치 파편: InstancedMesh 한 장(고정 용량)을 가장 오래된 칸부터 돌려 쓴다. 파편은 적 팔레트 색, 넉백 방향으로 날아가 중력으로 떨어진다.
    shards: Object.freeze({
      capacity: 256,
      count: Object.freeze({ minion: 9, elite: 18, boss: 32 }),
      frameBudget: 80,      // 한 프레임에 새로 낼 수 있는 파편 상한(군중 동시 처치에서도 업로드가 일정하다)
      liteScale: .5, reducedScale: .5,   // 낮음 화질·동작 줄이기에서는 개수를 절반으로(그 외 모든 값은 그대로)
      life: .5, lifeJitter: .18,
      speed: 5.6, speedJitter: .5,       // 넉백 방향 성분
      spread: 3.4,                       // 옆으로 흩어지는 폭
      up: 3.4, upJitter: 3,
      gravity: 26, drag: 1.5,
      size: .15, sizeJitter: .55, sizeByScale: Object.freeze([.7, 1.7]),   // 적 배율에 비례하되 이 범위로 묶는다
      spin: 16, glowSec: .1,             // 처음 glowSec 동안 흰빛으로 번쩍
      heightFrac: .55, bodyHeight: 1.7,  // 폭발 지점 = 적 위치 + bodyHeight * 배율 * heightFrac
      saturation: 1.25, lightMin: .3, lightMax: .72, accentLift: .22, accentShare: .3, darkShare: .18, darkScale: .45,
    }),
    // 묶음 처치 단계(multiSteps 와 같은 인덱스) 충격파. 반지름은 multiSteps[i].ring 을 그대로 쓴다(링 크기를 한 곳에서만 정한다).
    wave: Object.freeze({
      capacity: 8,
      steps: Object.freeze([
        Object.freeze({ life: .5, edge: .5, gain: .5, rays: 10, rayGain: .45 }),
        Object.freeze({ life: .55, edge: .58, gain: .6, rays: 14, rayGain: .55 }),
        Object.freeze({ life: .62, edge: .66, gain: .7, rays: 18, rayGain: .65 }),
        Object.freeze({ life: .72, edge: .75, gain: .82, rays: 24, rayGain: .75 }),
      ]),
      color: 0xffd060, height: .09,
      liteGain: .8, reducedGain: .6, reducedLife: .8,   // 낮음: 광선 끔·밝기 낮춤 / 동작 줄이기: 광선 끔·짧고 어둡게
    }),
    // 마지막 적 슬로우 동안 화면 가장자리에만 얹는 속도선·그늘. 중앙(r < innerR)은 절대 건드리지 않는다.
    speedLines: Object.freeze({ rampIn: .08, peak: .85 }),
  }),
  // 입력 버퍼·취소 창(초 / 공격 진행도 0~1). Player 가 같은 값을 쓴다.
  input: Object.freeze({
    attackBuffer: .14, dodgeBuffer: .12,
    cancelEarly: .16,        // 선딜 중 회피 취소가 열리는 진행도
    cancelBeforeHit: .04,    // 타격 직전 닫히는 여유
    cancelRecovery: .12,     // 타격 뒤 회피 취소가 열리는 오프셋
    cancelRecoveryEnd: .26,  // 타격 뒤 회피 취소가 닫히는 오프셋
    cancelHardEnd: .92,
    comboQueueOpen: .28,
    comboQueueBeforeHit: .12,
    skillCancelAfterHit: .05,
    skillCancelEnd: .9,
  }),
});

const num = (n, d = 0) => Number.isFinite(n) ? n : d;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** 타격 무게 합(0 이상). 큰 피해 비율(결정타 제외) + 군중 동시 타격 + 정예 + 결정타. */
export function hitWeight({ dealt = 0, maxHp = 0, crowd = 1, elite = false, killed = false } = {}) {
  const H = FEEL.hitstop;
  const share = maxHp > 0 && !killed ? clamp(num(dealt) / maxHp * H.shareGain, 0, H.shareCap) : 0;
  const crowdW = clamp((Math.max(1, num(crowd, 1)) - 1) * H.crowdStep, 0, H.crowdCap);
  return Math.min(H.weightCap, share + crowdW + (elite ? H.elite : 0) + (killed ? H.kill : 0));
}

/** 기본 정지(초)에 무게를 곱한다. 기본이 0(동작 줄이기·조용한 타격)이면 항상 0. */
export function weightedHitstop(base, weight) {
  if (!(base > 0)) return 0;
  return Math.min(FEEL.hitstop.max, base * (1 + Math.max(0, num(weight))));
}

/** 섬광 지속(초)·밝기 배율. 무게 0 이면 기존 값(0.12초, 배율 1)과 같다. */
export function flashFor(weight) {
  const F = FEEL.flash, w = Math.max(0, num(weight));
  return { sec: Math.min(F.maxSec, F.baseSec * (1 + w * .6)), gain: Math.min(F.gainMax, 1 + w * F.perWeight) };
}

/** 같은 창 안에서 맞은 서로 다른 대상 수를 센다. 같은 적을 연타·협공해도 군중으로 세지 않는다.
 * 대상이 없으면(구형 호출) 호출마다 하나로 센다. Set 을 재사용해 프레임마다 할당하지 않는다. */
export class HitCrowd {
  constructor() { this.at = -1e9; this.n = 0; this.seen = new Set(); }
  reset() { this.at = -1e9; this.n = 0; this.seen.clear(); }
  hit(now, target) {
    if (!(now - this.at <= FEEL.hitstop.crowdWindow) || now < this.at) { this.at = now; this.n = 0; this.seen.clear(); }
    if (target != null) { if (this.seen.has(target)) return Math.max(1, this.n); this.seen.add(target); }
    return ++this.n;
  }
}

/** 묶음 처치(multi-kill). 시각은 호출자가 넘기는 sim elapsed 뿐이다. */
export class KillChain {
  constructor() { this.n = 0; this.at = -1e9; this.step = -1; this.event = { multi: 0, step: -1 }; }
  reset() { this.n = 0; this.at = -1e9; this.step = -1; }
  /** 반환 객체는 재사용된다. step >= 0 이면 이번 처치로 새 묶음 단계에 진입. */
  kill(now) {
    const K = FEEL.kill;
    if (!(now - this.at <= K.multiWindow) || now < this.at) { this.n = 0; this.step = -1; }
    this.at = now; this.n++;
    let step = -1;
    for (let i = K.multiSteps.length - 1; i >= 0; i--) if (this.n >= K.multiSteps[i].n) { step = i; break; }
    const e = this.event;
    e.multi = this.n; e.step = step > this.step ? step : -1;
    if (step > this.step) this.step = step;
    return e;
  }
}

/** 방 정리·정예 처치 슬로우 판정. 반환: FEEL.slowmo 항목 또는 null. */
export function killSlowmo({ elite = false, boss = false, roomEmptied = false, roomKills = 0, now = 0, lastAt = -1e9, reduced = false } = {}) {
  if (reduced || boss) return null;   // 보스 처치는 기존 전용 연출이 있다
  const S = FEEL.slowmo;
  if (now - lastAt < S.cooldown && now >= lastAt) return null;
  if (roomEmptied && roomKills >= S.minRoomKills) return S.roomClear;
  if (elite) return S.eliteKill;
  return null;
}

/** 회피 취소 창: 선딜은 [cancelEarly, hitAt-cancelBeforeHit), 타격 뒤는 [hitAt+cancelRecovery, min(cancelHardEnd, hitAt+cancelRecoveryEnd)). */
export function dodgeCancelOpen(t, hitAt, hitDone) {
  const I = FEEL.input;
  if (!hitDone) return t >= I.cancelEarly && t < hitAt - I.cancelBeforeHit;
  return t >= hitAt + I.cancelRecovery && t < Math.min(I.cancelHardEnd, hitAt + I.cancelRecoveryEnd);
}

/** 다음 타 예약 입력이 받아들여지는 진행도. */
export function comboQueueOpen(t, hitAt, hitDone) {
  const I = FEEL.input;
  return hitDone || t >= Math.max(I.comboQueueOpen, hitAt - I.comboQueueBeforeHit);
}

/** 스킬 취소 창(타격 확인 뒤). */
export function skillCancelOpen(t, hitAt, hitDone) {
  const I = FEEL.input;
  return hitDone && t >= hitAt + I.skillCancelAfterHit && t < I.skillCancelEnd;
}

// ---- 전투 VFX 순수 계산(난수·시간·DOM 없음) ----
/** 처치 파편 개수. 등급(졸개·정예·보스)별 기본에 낮음 화질·동작 줄이기 배율을 곱한다. */
export function shardCount(kind = {}, { lite = false, reduced = false } = {}) {
  // 런타임 Enemy 는 isBoss/isElite 로 노출한다(boss/elite 표기도 받는다).
  const S = FEEL.vfx.shards, boss = !!(kind?.isBoss || kind?.boss), elite = !!(kind?.isElite || kind?.elite);
  const base = boss ? S.count.boss : elite ? S.count.elite : S.count.minion;
  return Math.max(0, Math.round(base * (lite ? S.liteScale : 1) * (reduced ? S.reducedScale : 1)));
}

/** 묶음 처치 단계의 충격파 인자. 반지름은 FEEL.kill.multiSteps[step].ring. 잘못된 단계는 null. */
export function waveParams(step, { lite = false, reduced = false } = {}) {
  const W = FEEL.vfx.wave, tier = W.steps[step], kill = FEEL.kill.multiSteps[step];
  if (!tier || !kill) return null;
  const quiet = lite || reduced;
  return {
    radius: kill.ring,
    life: tier.life * (reduced ? W.reducedLife : 1),
    edge: tier.edge,
    gain: tier.gain * (reduced ? W.reducedGain : lite ? W.liteGain : 1),
    rays: quiet ? 0 : tier.rays,
    rayGain: quiet ? 0 : tier.rayGain,
    color: W.color,
  };
}

/** 마지막 적 슬로우의 가장자리 속도선 세기(0~peak). remaining/total/ease 는 ImpactClock 의 slowT·slowmo 인자와 같은 초 단위. */
export function slowAccentLevel(remaining, total, ease = 0) {
  const V = FEEL.vfx.speedLines;
  if (!(remaining > 0) || !(total > 0)) return 0;
  const inK = clamp((total - remaining) / V.rampIn, 0, 1), outK = ease > 0 ? clamp(remaining / ease, 0, 1) : 1;
  const k = Math.min(inK, outK);
  return V.peak * k * k * (3 - 2 * k);
}

/** 슬로우 판정(killSlowmo 결과)에서 속도선 인자를 뽑는다. accent 표시가 없거나 동작 줄이기면 null — 속도선은 켜지지 않는다. */
export function slowAccentFor(slowmo, reduced = false) {
  return slowmo && slowmo.accent && !reduced ? { sec: slowmo.sec, ease: slowmo.ease } : null;
}
