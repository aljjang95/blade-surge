// 핵앤슬래시 타격감 튜닝 표와 순수 계산. 난수·DOM·시간(Date) 없이 step 의 시뮬레이션 시각(elapsed)만 쓴다.
// 화면 흔들림·FOV 펀치는 오너 결정으로 쓰지 않는다(renderer.shake/punch 는 의도적 no-op) — 무게는 정지·섬광·슬로우로 전한다.

export const FEEL = Object.freeze({
  // 히트스탑: base 는 타격 등급별 기본 정지(초). 실제 정지 = base * (1 + 무게 합), 상한 max.
  hitstop: Object.freeze({
    // h3-feel 고정 픽스처 측정(2026-10-22): 치명타가 평타(.05)와 10ms 차이라 구분되지 않았고, 마무리·처치가 레퍼런스(110–150, 처치 120–180ms)보다 가벼웠다.
    // 평타·경타 리듬은 그대로 두고 치명타·강타·반격·마무리만 올린다. received 는 영웅이 강타(kb≥6)를 맞았을 때의 정지다.
    base: Object.freeze({ light: .045, basic: .05, crit: .072, boss: .06, heavy: .085, counter: .1, finisher: .12, received: .07 }),
    shareGain: 2,      // 쓰러지지 않은 타격의 피해 / 대상 최대 HP 비율에 곱한다(큰 한 방일수록 무겁다)
    shareCap: .4,
    crowdStep: .05,    // 같은 창(crowdWindow) 안에서 두 번째 대상부터 한 명당 더해지는 무게
    crowdCap: .3,
    crowdWindow: .06,
    elite: .2,         // 정예 타격
    kill: .2,          // 쓰러뜨리는 타격은 피해 비율 대신 이 값(졸개 평타 처치 60ms, 마무리 처치 144ms, 정예 마무리 처치는 상한)
    weightCap: 1,      // 무게 합 상한(전부 겹쳐도 기본의 2배까지)
    max: .15,          // 한 번의 정지 상한(ImpactClock HITSTOP_CAP .18 보다 작다)
  }),
  // 달리기 발 미끄러짐: heroRunStride 는 Running_A 를 배율 1 로 제자리 재생할 때 디딤발이 뒤로 가는 화면 속도(m/s).
  // tools/anim-audit-qa.mjs(스키닝 정점 기준, 2026-10-22) 실측. 이동 속도 / (보폭 속도 × targetSlide) 로 재생 배율을 정한다.
  // 예전 고정 배율(1.1 + 질주 .35)은 디딤발이 몸 이동의 42–70%만 따라가 얼음 위를 미끄러지듯 보였다(feel-fixture run 띠).
  // targetSlide 1.35 는 발이 몸 이동의 74% 를 따라가게 남겨 2등신 캐릭터 다리가 지나치게 빨라 보이지 않게 하는 절충값이다.
  locomotion: Object.freeze({
    heroRunStride: Object.freeze({ knight: 2.77, barbarian: 2.74, mage: 3.55, rogue: 3.44, ranger: 3.22 }),
    targetSlide: 1.35, min: .7, max: 2.6,
    // 몬스터: src/data/locomotion-stride.js 의 보폭 표. 걷기 전용 큰 몸집이 지나치게 종종거리지 않게 상한을 낮춘다.
    monsterMin: .6, monsterMax: 2.2,
  }),
  // 영웅 클립 크로스페이드(초). 고정 픽스처(2026-10-22)에서 회피 끝→공격(.035초, 2프레임)이 44–50°, 쌍검 연타(.06초)가 59° 한 프레임에
  // 튀었다(주변 프레임의 4–5배). 연타 섞기는 다음 타의 선딜(접촉 진행도의 64%) 안, 회복 섞기는 접촉 전이라 접촉 프레임·판정 시각은 바뀌지 않는다.
  blend: Object.freeze({
    chain: Object.freeze({ '1h': .07, '2h': .07, dual: .08, staff: .08, bow: .08 }),   // 공격 → 다음 타(쌍검 선딜 85ms 안)
    recover: .1,        // 회피·경직·대기 → 공격(앞 자세가 공격 자세와 멀다)
    dodge: .08,         // 공격·이동 → 회피(무적·이동은 첫 프레임에 바로 시작한다)
    hurt: .07,          // 영웅 피격(경직) 클립
  }),
  // 적 피격 반응. 경타는 예전처럼 빠르게(1.8배) 움찔하고, 강타·치명타·마무리는 강타 클립을 조금 느리게 끝까지 보여 무게를 읽게 한다.
  // 경직 = base + kb × perKb(상한 kbCap) + 강타 heavyHold. 접촉 반응 시작은 같은 프레임이다.
  // kb ≥ knockKb 는 뒤로 젖혀지며 밀려나는 넉백 클립(hitKnockback, 없으면 hitHeavy → hit 폴백).
  react: Object.freeze({ lightSpeed: 1.8, heavySpeed: 1.4, base: .22, perKb: .03, kbCap: .4, heavyHold: .1, knockKb: 6 }),
  // 사망 변주(결정적, 난수 없음). 시체는 맞은 방향을 등지도록 돌아 넘어지고(맞은 쪽으로 쓰러지지 않게), 처치 등급마다 쓰러지는 박자가 다르다.
  death: Object.freeze({ snap: 1.3, normal: 1, heavy: .82 }),
  // 연출 박자(궁극기·보스 처치). 슬로우는 끝 ease 초 동안 1 로 부드럽게 복귀한다(예전엔 뚝 끊겼다).
  // kick 은 렌더 카메라만 시선 방향으로 밀었다 되돌리는 한 번의 방향성 펀치다(무작위 흔들림 아님, rig·사용자 시점 불변).
  cinematic: Object.freeze({
    ultStart: Object.freeze({ scale: .25, sec: .7, ease: .3 }),
    ultRelease: Object.freeze({ stop: .06, kick: .7 }),
    bossKill: Object.freeze({ stop: .15, scale: .15, sec: 1.8, ease: .8, kick: 1.1 }),
  }),
  camera: Object.freeze({ kickIn: .07, kickOut: .38, kickMax: 1.4 }),
  // 넉백 속도는 매 초 keep 배로 줄어든다(지수 마찰). 초기 속도 v 의 총 이동 = v / -ln(keep). 몰이(pull)도 같은 속도 벡터를 쓰므로 값은 바꾸지 않는다.
  knockback: Object.freeze({ keep: .02 }),
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

/** 영웅 달리기 클립 재생 배율. speed 는 실제 이동 속도(m/s, 질주·버프·둔화 반영). 실측 보폭이 없는 영웅은 예전 배율을 쓴다. */
export function heroRunTempo(heroId, speed, sprint = 0) {
  const L = FEEL.locomotion, stride = L.heroRunStride[heroId];
  if (!(stride > 0) || !(speed > 0)) return 1.1 + Math.max(0, num(sprint)) * .35;
  return clamp(speed / (stride * L.targetSlide), L.min, L.max);
}

/** 몬스터 걷기·달리기 재생 배율. strideUnit 은 액터 배율 1 기준 보폭 속도(m/s), 없으면 null(호출자가 기존 배율 사용). */
export function monsterLocoTempo(strideUnit, actorScale, speed) {
  const L = FEEL.locomotion;
  if (!(strideUnit > 0) || !(actorScale > 0)) return null;
  return clamp(Math.max(0, num(speed)) / (strideUnit * actorScale * L.targetSlide), L.monsterMin, L.monsterMax);
}

/** 넉백 속도 감쇠 배율(dt 초 동안). 프레임 크기와 무관하게 같은 곡선이다. */
export function knockbackDecay(dt) { return Math.pow(FEEL.knockback.keep, Math.max(0, num(dt))); }

/** 초기 넉백 속도(m/s)가 멈출 때까지 미는 총 거리(m). 히트스톱(dt 0) 동안은 움직이지 않으므로 정지 길이와 무관하다. */
export function knockbackTravel(speed) { return Math.max(0, num(speed)) / -Math.log(FEEL.knockback.keep); }

/** 영웅 공격 클립의 크로스페이드(초). prevState 는 공격을 시작하기 직전의 상태, weapon 은 영웅 무기 종류. */
export function attackBlend(prevState, weapon) {
  const B = FEEL.blend;
  if (prevState !== 'attack') return B.recover;
  return B.chain[weapon] ?? B.recover;
}

const _react = { key: 'hit', speed: 1, stagger: 0 };
/** 적 피격 반응: 재생할 논리 클립 키, 재생 배율, 경직(초). kb 는 넉백 세기(저항 적용 전).
 * 군중 타격에서 매 접촉 호출되므로 반환 객체(out, 기본은 모듈 하나)를 재사용한다. 바로 읽고 보관하지 않는다. */
export function enemyHitReact(kb = 0, crit = false, finisher = false, out = _react) {
  const R = FEEL.react, k = Math.max(0, num(kb)), heavy = k >= 4 || !!crit || !!finisher;
  out.key = k >= R.knockKb ? 'hitKnockback' : heavy ? 'hitHeavy' : 'hit'; out.speed = heavy ? R.heavySpeed : R.lightSpeed;
  out.stagger = R.base + Math.min(R.kbCap, k * R.perKb) + (heavy ? R.heavyHold : 0);
  return out;
}

/** 사망 변주. 반환: 사망 클립 재생 배율과 시체가 바라볼 방향(맞은 방향의 반대 = 공격자 쪽, 라디안) 또는 null.
 * 쓰러뜨린 타격이 마무리·치명타·강타(kb≥6)면 빠르게 꺾이고, 정예·보스는 무겁게 천천히 쓰러진다. 같은 입력은 늘 같은 결과다. */
export function deathStyle({ dirx = 0, dirz = 0, kb = 0, crit = false, finisher = false, elite = false, boss = false } = {}) {
  const D = FEEL.death, l = Math.hypot(num(dirx), num(dirz));
  const speed = boss || elite ? D.heavy : finisher || crit || num(kb) >= 6 ? D.snap : D.normal;
  return { speed, faceYaw: l > 1e-6 ? Math.atan2(-dirx / l, -dirz / l) : null };
}

/** 렌더 카메라 펀치 거리(m): t 초 동안 kickIn 에 걸쳐 부드럽게 amount 까지 들어갔다가 kickOut 동안 0 으로 돌아온다. 범위 밖은 0. */
export function cameraKick(t, amount) {
  const C = FEEL.camera, a = clamp(num(amount), 0, C.kickMax);
  if (!(t >= 0) || a === 0) return 0;
  if (t < C.kickIn) { const k = t / C.kickIn; return a * k * k * (3 - 2 * k); }
  const u = (t - C.kickIn) / C.kickOut;
  if (u >= 1) return 0;
  return a * (1 - u) * (1 - u);
}

/** 연출 박자 판정. kind: 'ultStart' | 'ultRelease' | 'bossKill'. 동작 줄이기에서는 정지(히트스톱)만 남기고 슬로우·카메라 펀치를 끈다. */
export function cinematicBeat(kind, reduced = false) {
  const c = FEEL.cinematic[kind];
  if (!c) return null;
  return { stop: c.stop || 0, slowmo: !reduced && c.scale ? { scale: c.scale, sec: c.sec, ease: c.ease } : null, kick: reduced ? 0 : c.kick || 0 };
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
