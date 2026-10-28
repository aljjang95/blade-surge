const finite = value => Number.isFinite(value) ? value : 0;
const clamp01 = value => Math.max(0, Math.min(1, value));
const distance = (a, b) => Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.z) - finite(b?.z));
const proximity = (d, inner, outer) => {
  const t = clamp01((outer - d) / (outer - inner));
  return t * t * (3 - 2 * t);
};

// 장르 기준(쿼터뷰 고정 시점 액션 RPG): 화면 중심은 영웅에 묶여 있고, 타격·무리 밀도로 카메라가 움직이지 않는다.
// 이동 예측과 조준 대상 쪽 치우침은 합쳐 LEAD_MAX(월드 m) 안에서만 쓴다. 타격감은 히트스톱·섬광·넉백·숫자가 맡는다.
export const FRAMING = Object.freeze({ leadPerSpeed: .12, leadMax: .6, lockMax: .35, totalMax: .8,
  // 보스가 이 거리(m) 안이면 넓은 구도를 다 쓰고, 바깥 경계까지 서서히 푼다. 보스방 안에서 거리 변화로 줌이 펌핑하지 않게 안쪽을 넓게 잡는다.
  bossInner: 14, bossOuter: 22,
  // 보스 구도는 넓은 프리셋까지 다 가지 않는다(절제된 줌아웃, 거리 약 +13%). 큰 보스의 예고 범위는 AUTO 맞춤이 한 방향으로만 더 물러난다.
  bossBlend: .6 });

/** 순수 구도 정책: 영웅 중심 + 짧은 이동 예측·조준 치우침, 가까운 보스에만 넓은 구도. */
export function battleFraming({ player, boss, preset = 'auto', presets }) {
  const p = player.pos, vx = finite(player.vel?.x), vz = finite(player.vel?.z), speed = Math.hypot(vx, vz);
  let x = 0, z = 0;
  if (speed > .5) {
    const lead = Math.min(FRAMING.leadMax, (speed - .5) * FRAMING.leadPerSpeed);
    x = vx / speed * lead; z = vz / speed * lead;
  }
  const lock = player.lockTarget;
  if (lock?.alive && !lock.spawning && lock.pos) {
    const d = distance(p, lock.pos);
    const bias = Math.min(FRAMING.lockMax, d * .06) * proximity(d, 8, 18);
    if (d > 0) { x += (lock.pos.x - p.x) / d * bias; z += (lock.pos.z - p.z) / d * bias; }
  }
  const lead = Math.hypot(x, z);
  if (lead > FRAMING.totalMax) { x *= FRAMING.totalMax / lead; z *= FRAMING.totalMax / lead; }
  const bossWeight = boss?.alive && !boss.spawning && boss.pos ? proximity(distance(p, boss.pos), FRAMING.bossInner, FRAMING.bossOuter) * FRAMING.bossBlend : 0;
  const automatic = !presets[preset];
  const base = automatic ? presets.action : presets[preset];
  const desired = { ...base };
  if (automatic) for (const key of ['y', 'z', 'fov', 'lookY', 'lag']) desired[key] += (presets.wide[key] - desired[key]) * bossWeight;
  return { target: { x: finite(p.x) + x, y: finite(p.y), z: finite(p.z) + z }, desired, bossWeight };
}

export const framingBlend = (dt, rate) => 1 - Math.exp(-Math.max(0, finite(dt)) * rate);
