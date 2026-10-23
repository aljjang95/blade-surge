import { Vector3 } from 'three';

// 전투 카메라 AUTO: 사용자가 손대지 않는 동안 yaw·pitch·zoom 을 상황에 맞춰 임계 감쇠 스프링으로 옮긴다.
// 화면 흔들림·FOV 펄스는 만들지 않는다. 값은 사용자 시점(battleCamera)과 같은 단위(도·zoom%)로만 움직이고,
// 렌더러는 지금처럼 battleCameraOffset 으로 그 값을 쓴다. 프레임마다 객체를 만들지 않는다.
export const AUTO_CAMERA = Object.freeze({
  // 마지막 드래그·핀치·키 입력 뒤 이만큼 손을 떼고 있으면(초) 천천히 복귀를 시작한다.
  resumeDelay: 3.5, resumeRamp: 1.6,
  // 임계 감쇠 스프링 각진동수(1/초)와 최대 속도. 반응은 ω≈3 이 0.5초 안에 대부분 따라가는 정도다.
  yawOmega: 2.6, pitchOmega: 3.2, zoomOmega: 2.4,
  yawMaxRate: 70, pitchMaxRate: 16, zoomMaxRate: 32,
  // 위협이 카메라 정면에서 이 각도(도)를 넘어 옆·뒤로 가면, 이 각도 안으로 들어오도록 최소한만 돌린다.
  // 세로 화면은 좌우가 좁아 예고 범위가 옆으로 넘친다. 위협을 화면 세로축(정면)에 더 가깝게 세운다.
  frontCone: 62, frontConePortrait: 16, minThreatDistance: 2.2,
  threatRange: 13, bossRange: 24, bossReach: 4.5,
  // 위협이 사라진 뒤 이 시간(초)이 지나면 지역 기본 시점(던전 진행 방향)으로 돌아간다.
  calmReturn: 2.5,
  // 무리 퍼짐 반경(월드 단위) → 줌. 지역 기본 줌(100 기준)에 곱한다.
  spreadNear: 3, spreadFar: 10, zoomNear: 100, zoomFar: 80, bossZoomPerRadius: 5, bossZoomMin: 80,
  // 영웅·보스 예고 범위가 들어와야 하는 화면 안전 상자(NDC 반폭). HUD 가장자리를 비워 둔다.
  safeX: .8, safeY: .7, fitZoomMin: 72,
  // 영웅과 카메라 사이 바닥이 막혀 있으면(벽) 이만큼까지 내려다본다(도).
  occlusionPitch: 9, occlusionProbes: Object.freeze([1.1, 2, 3, 4.2]),
});

const DEG = 180 / Math.PI, RAD = Math.PI / 180;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
/** -180..180 으로 감은 각도 차(도). */
export const wrapDegrees = value => ((finite(value) + 180) % 360 + 360) % 360 - 180;
const alive = actor => !!actor?.alive && !actor.spawning && !!actor.pos;

/** 임계 감쇠 스프링 한 걸음. state[key] 에 속도를 둔다. 최대 속도를 넘지 않는다. */
export function criticalStep(x, goal, state, key, omega, dt, maxRate) {
  if (!(dt > 0) || !(omega > 0)) return x;
  const v = finite(state[key]), change = x - goal, temp = (v + omega * change) * dt, decay = Math.exp(-omega * dt);
  let next = goal + (change + temp) * decay, nv = (v - omega * temp) * decay;
  const limit = maxRate * dt;
  if (Math.abs(next - x) > limit) { const sign = Math.sign(next - x); next = x + sign * limit; nv = sign * maxRate; }
  state[key] = nv;
  return next;
}

const _p = new Vector3();
/** 월드 점이 화면 안전 상자를 얼마나 벗어나는지(1 = 경계). 카메라 뒤에 있으면 크게 본다. */
function frameRatio(camera, x, y, z, cfg) {
  _p.set(x, y, z).project(camera);
  if (!Number.isFinite(_p.x) || !Number.isFinite(_p.y) || _p.z > 1) return 2;
  return Math.max(Math.abs(_p.x) / cfg.safeX, Math.abs(_p.y) / cfg.safeY);
}

/**
 * 상황에서 AUTO 목표 시점을 정한다(순수 계산, out 에 쓴다).
 * ctx: { player, enemies, boss, base:{yaw,pitch,zoom}, current:{yaw,pitch,zoom}, bearing(rad, 지역 오프셋 방위),
 *        walkable(x,z)?, camera?, calm(초) }
 */
export function autoCameraGoal(ctx, out, cfg = AUTO_CAMERA) {
  const p = ctx.player?.pos, base = ctx.base, current = ctx.current;
  out.yaw = current.yaw; out.pitch = base.pitch; out.zoom = base.zoom; out.threat = null;
  if (!p) return out;
  // 1) 가장 위협적인 대상: 사거리 안 보스 > 예고 중인 가장 가까운 적. 그냥 몰려 있는 무리로는 돌리지 않는다.
  let threat = null, best = Infinity;
  const boss = ctx.boss;
  if (alive(boss) && Math.hypot(boss.pos.x - p.x, boss.pos.z - p.z) < cfg.bossRange) threat = boss;
  let spread = 0, count = 0;
  for (const enemy of ctx.enemies || []) {
    if (!alive(enemy)) continue;
    const d = Math.hypot(enemy.pos.x - p.x, enemy.pos.z - p.z);
    if (d > cfg.threatRange) continue;
    count++; if (d > spread) spread = d;
    if (!threat && enemy.telegraph > 0 && d < best) { best = d; threat = enemy; }
  }
  out.threat = threat;
  // 2) yaw: 위협이 정면 원뿔 밖이면 원뿔 경계까지만 돌린다. 이동 방향으로는 돌리지 않는다(조이스틱이 화면 기준이라 계속 도는 고리를 만든다).
  if (threat) {
    const tx = threat.pos.x - p.x, tz = threat.pos.z - p.z;
    if (Math.hypot(tx, tz) > cfg.minThreatDistance) {
      // 카메라는 목표점에서 (sin b, cos b) 방향에 있고 정면은 그 반대다.
      const b = finite(ctx.bearing) + current.yaw * RAD;
      const angle = wrapDegrees((Math.atan2(-tx, -tz) - b) * DEG);   // 위협을 정확히 정면에 두는 방위까지의 회전
      const cone = finite(ctx.camera?.aspect, 2) < 1 ? cfg.frontConePortrait : cfg.frontCone;
      const excess = Math.abs(angle) - cone;
      if (excess > 0) out.yaw = wrapDegrees(current.yaw + Math.sign(angle) * excess);
    }
  } else if (ctx.calm >= cfg.calmReturn) out.yaw = base.yaw;
  // 3) zoom: 무리 반경·보스 크기에 맞춘 편한 거리, 그리고 영웅·보스 예고 범위가 안전 상자를 넘지 않는 거리 중 가까운 쪽.
  const scale = finite(base.zoom, 100) / 100;
  let zoom = count > 1 ? cfg.zoomNear + (cfg.zoomFar - cfg.zoomNear) * smooth((spread - cfg.spreadNear) / (cfg.spreadFar - cfg.spreadNear)) : cfg.zoomNear;
  if (alive(boss) && threat === boss) zoom = Math.min(zoom, Math.max(cfg.bossZoomMin, cfg.zoomNear - finite(boss.radius, 1) * cfg.bossZoomPerRadius));
  zoom *= scale;
  const camera = ctx.camera;
  if (camera && threat) {
    const reach = (threat === boss ? cfg.bossReach : 1.5) + finite(threat.radius, .7);
    const y = finite(threat.pos.y);
    let ratio = frameRatio(camera, p.x, finite(p.y) + 1, p.z, cfg);
    ratio = Math.max(ratio, frameRatio(camera, threat.pos.x + reach, y, threat.pos.z, cfg), frameRatio(camera, threat.pos.x - reach, y, threat.pos.z, cfg),
      frameRatio(camera, threat.pos.x, y, threat.pos.z + reach, cfg), frameRatio(camera, threat.pos.x, y, threat.pos.z - reach, cfg));
    // 화면상 거리는 줌에 거의 비례한다. 넘치면 그 비율만큼 물러난다(다음 프레임 투영으로 다시 확인).
    if (ratio > 1) zoom = Math.min(zoom, Math.max(cfg.fitZoomMin, current.zoom / ratio));
    else if (ratio > .92) zoom = Math.min(zoom, current.zoom);
  }
  out.zoom = zoom;
  // 4) pitch: 영웅에서 카메라 쪽 바닥을 몇 점 찍어 막혀 있으면 위에서 내려다본다.
  if (typeof ctx.walkable === 'function') {
    const b = finite(ctx.bearing) + out.yaw * RAD, sx = Math.sin(b), sz = Math.cos(b);
    let occluded = 0;
    for (const d of cfg.occlusionProbes) {
      if (!ctx.walkable(p.x + sx * d, p.z + sz * d)) { occluded = Math.max(occluded, 1 - (d - cfg.occlusionProbes[0]) / 4.5); break; }
    }
    out.pitch = base.pitch + cfg.occlusionPitch * occluded;
  }
  return out;
}

/** AUTO 상태기계: 손댄 직후 정지, 무입력 resumeDelay 뒤 resumeRamp 동안 서서히 스프링을 세운다. */
export class BattleAutoCamera {
  constructor(cfg = AUTO_CAMERA) {
    this.cfg = cfg;
    this.velocity = { yaw: 0, pitch: 0, zoom: 0 };
    this.goal = { yaw: 0, pitch: 0, zoom: 100, threat: null };
    this.idle = Infinity; this.calm = Infinity;
  }
  /** 사용자가 시점을 직접 움직였다. 즉시 멈추고 속도를 버린다. */
  interrupt() { this.idle = 0; this.velocity.yaw = this.velocity.pitch = this.velocity.zoom = 0; }
  /** 복원·AUTO 켜기: 기다리지 않고 바로 복귀를 시작한다. */
  resume() { this.idle = this.cfg.resumeDelay; }
  get holding() { return this.idle < this.cfg.resumeDelay; }
  /** value({yaw,pitch,zoom})를 제자리에서 고친다. 정지 중이면 false. */
  step(dt, value, ctx) {
    const cfg = this.cfg; dt = finite(dt); if (!(dt > 0) || !value) return false;
    this.idle += dt; ctx.calm = this.calm;
    autoCameraGoal(ctx, this.goal, cfg);
    this.calm = this.goal.threat ? 0 : this.calm + dt;
    if (this.idle < cfg.resumeDelay) return false;
    const w = Math.max(.08, smooth((this.idle - cfg.resumeDelay) / cfg.resumeRamp)), v = this.velocity, g = this.goal;
    const yawGoal = value.yaw + wrapDegrees(g.yaw - value.yaw);
    value.yaw = wrapDegrees(criticalStep(value.yaw, yawGoal, v, 'yaw', cfg.yawOmega * w, dt, cfg.yawMaxRate * w));
    value.pitch = clamp(criticalStep(value.pitch, g.pitch, v, 'pitch', cfg.pitchOmega * w, dt, cfg.pitchMaxRate * w), -18, 20);
    value.zoom = clamp(criticalStep(value.zoom, g.zoom, v, 'zoom', cfg.zoomOmega * w, dt, cfg.zoomMaxRate * w), 70, 140);
    return true;
  }
}
