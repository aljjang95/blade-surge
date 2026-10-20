// 실제 사용자 여정 QA: 수동 궁수 구간의 관측 샘플을 판정한다(순수 함수). 판정 기준은 보고서에 그대로 남긴다.
// 입력은 playability-journey-observer.mjs 의 drain() 누적이다. 고정 스텝·주입 fixture 결과가 아니다.
import { angleBetween } from './playability-journey-nav.mjs';

export const MANUAL_THRESHOLDS = Object.freeze({
  minMoveDistance: 3,        // 조이스틱을 누른 동안 실제 이동한 누적 거리(유닛)
  minAimedShots: 3,          // 대상이 잡힌 수동 기본 사격 수
  maxAimErrorRad: 0.15,      // 발사 순간 화살 방향과 대상 방향의 차이
  minMoveInput: 0.3,         // 발사 순간 이동 입력(월드 moveDir) 크기
  minSpeed: 0.5,             // 발사 순간 실제 속도(이동 사격)
  strafeDeg: [45, 135],      // 이동 방향과 화살 방향의 각 — 옆걸음
  retreatMinDeg: 120,        // 이동 방향과 화살 방향의 각 — 후퇴
  dodgeShotMaxSec: 0.8,      // 회피 시작 → 사격 발사까지 게임 시간
  minSingleShots: 3,         // 데이터상 1발인 기본 사격 수
  minClockSec: 5,            // 수동 구간 동안 흐른 게임 시간
});

const deg = (rad) => (rad === null ? null : rad * 180 / Math.PI);
const round = (v, n = 3) => (v === null || v === undefined || !Number.isFinite(v) ? v ?? null : Number(v.toFixed(n)));

/** 발사 샘플에 조준 오차·이동각을 붙인다. 여러 발이면 가운데 화살을 기준으로 한다. */
export function annotateShot(s) {
  const mid = s.dirs[Math.floor(s.dirs.length / 2)] || [0, 0];
  const aimErr = s.target ? angleBetween(mid[0], mid[1], s.target.x - s.pos[0], s.target.z - s.pos[1]) : null;
  const moveMag = Math.hypot(s.move[0], s.move[1]);
  const moveDeg = moveMag > 1e-6 ? deg(angleBetween(s.move[0], s.move[1], mid[0], mid[1])) : null;
  const targetDist = s.target ? Math.hypot(s.target.x - s.pos[0], s.target.z - s.pos[1]) : null;
  return { ...s, aimErr, moveMag, moveDeg, targetDist };
}

/** 수동 구간 판정. 각 항목은 ok 와 근거(detail)를 함께 돌려준다. */
export function assessManual(data, t = MANUAL_THRESHOLDS) {
  const frames = data.frames.filter((f) => f.phase === 'manual');
  const shots = data.shots.filter((s) => s.phase === 'manual' && !s.auto && !s.skill).map(annotateShot);
  const checks = {};

  let moved = 0, joyFrames = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    if (a.joy && b.joy && !a.auto && !b.auto && a.alive && b.alive) { moved += Math.hypot(b.x - a.x, b.z - a.z); joyFrames++; }
  }
  checks.joystickMovement = { ok: moved >= t.minMoveDistance && frames.every((f) => !f.auto),
    detail: { movedUnits: round(moved, 2), joySamples: joyFrames, autoSamples: frames.filter((f) => f.auto).length } };

  const aimed = shots.filter((s) => s.target && s.aimErr !== null);
  checks.aimTowardTarget = { ok: aimed.length >= t.minAimedShots && aimed.every((s) => s.aimErr <= t.maxAimErrorRad),
    detail: { aimedShots: aimed.length, manualShots: shots.length, untargetedShots: shots.filter((s) => !s.target).length,
      maxAimErrorRad: round(Math.max(0, ...aimed.map((s) => s.aimErr))), worst: aimed.filter((s) => s.aimErr > t.maxAimErrorRad).slice(0, 5).map(brief) } };

  const moving = aimed.filter((s) => s.moveMag >= t.minMoveInput && s.speed >= t.minSpeed && s.aimErr <= t.maxAimErrorRad);
  const strafe = moving.filter((s) => s.moveDeg >= t.strafeDeg[0] && s.moveDeg <= t.strafeDeg[1]);
  const retreat = moving.filter((s) => s.moveDeg >= t.retreatMinDeg);
  checks.strafeShot = { ok: strafe.length > 0, detail: { count: strafe.length, examples: strafe.slice(0, 3).map(brief) } };
  checks.retreatShot = { ok: retreat.length > 0, detail: { count: retreat.length, examples: retreat.slice(0, 3).map(brief) } };

  const manualTransitions = data.transitions.filter((x) => x.phase === 'manual' && !x.auto);
  const dodge = shots.filter((s) => s.attackFromDodge && s.sinceDodge !== null && s.sinceDodge <= t.dodgeShotMaxSec);
  checks.dodgeThenShot = { ok: dodge.length > 0, detail: { count: dodge.length, examples: dodge.slice(0, 3).map(brief),
    dodgeStarts: manualTransitions.filter((x) => x.to === 'dodge').length, dodgeToAttack: manualTransitions.filter((x) => x.from === 'dodge' && x.to === 'attack').length } };

  const singles = shots.filter((s) => s.expected === 1);
  const mismatched = shots.filter((s) => s.expected !== null && s.count !== s.expected);
  checks.normalSingleArrow = { ok: singles.length >= t.minSingleShots && mismatched.length === 0,
    detail: { singleExpectedShots: singles.length, countsByCombo: countBy(shots, (s) => 'combo' + s.comboIdx + ':' + s.count + '/' + s.expected), mismatched: mismatched.slice(0, 5).map(brief) } };

  const arrowIds = new Set(shots.flatMap((s) => s.arrowIds));
  const hits = data.ended.filter((e) => arrowIds.has(e.id) && e.hits.length);
  const damage = data.damage.filter((d) => d.phase === 'manual');
  const hitDamage = hits.filter((h) => damage.some((d) => h.hits.includes(d.id) && Math.abs(d.wall - h.wall) < 250));
  const kills = frames.length ? frames.at(-1).kills - frames[0].kills : 0;
  checks.arrowDamagesEnemy = { ok: hitDamage.length > 0,
    detail: { arrowsTracked: arrowIds.size, arrowsEnded: data.ended.filter((e) => arrowIds.has(e.id)).length, arrowHits: hits.length, hitsWithHpDrop: hitDamage.length,
      damageEvents: damage.length, damageTotal: damage.reduce((n, d) => n + Math.max(0, d.from - d.to), 0), kills, dmgDealtDelta: frames.length ? frames.at(-1).dmg - frames[0].dmg : 0 } };

  let monotonic = true, restarts = 0;
  for (let i = 1; i < frames.length; i++) if (frames[i].clock < frames[i - 1].clock - 1e-9) { monotonic = false; restarts++; }
  const clockDelta = frames.length ? frames.at(-1).clock - frames[0].clock : 0, wallDelta = frames.length ? (frames.at(-1).wall - frames[0].wall) / 1000 : 0;
  checks.gameClockProgress = { ok: monotonic && clockDelta >= t.minClockSec,
    detail: { gameSec: round(clockDelta, 2), wallSec: round(wallDelta, 2), ratio: wallDelta > 0 ? round(clockDelta / wallDelta, 3) : null, pausedSamples: frames.filter((f) => f.paused).length, restarts, samples: frames.length } };

  checks.movingDrawHeld = { ok: (data.counters?.movingDrawFrames || 0) > 0, detail: { movingDrawFrames: data.counters?.movingDrawFrames || 0, heldFrames: data.counters?.heldFrames || 0 } };
  return { thresholds: t, checks, shots: shots.map(brief) };
}

function brief(s) {
  return { seq: s.seq, clock: round(s.clock, 3), combo: s.comboIdx, count: s.count, expected: s.expected, state: s.state, aimErr: round(s.aimErr), moveDeg: round(s.moveDeg, 1), moveMag: round(s.moveMag, 2), speed: round(s.speed, 2),
    joy: s.joy, targetDist: round(s.targetDist, 2), target: s.target ? { id: s.target.id, type: s.target.type, hp: s.target.hp } : null, fromDodge: s.attackFromDodge, sinceDodge: round(s.sinceDodge, 3), held: s.held };
}

function countBy(list, key) { const out = {}; for (const x of list) { const k = key(x); out[k] = (out[k] || 0) + 1; } return out; }
