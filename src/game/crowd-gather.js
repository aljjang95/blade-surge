import { audio } from '../engine/audio.js';

// 고정 경고·돌진의 swept path 소유자를 움직이면 예고와 실제 타격 원점이 갈라진다.
const originLocked = enemy => !!enemy.mobRole?.plan || enemy.telegraph > 0 ||
  ((enemy.isBoss || enemy.isElite) && enemy.state === 'attack');

const fits = (world, x, z, radius) => world.walkable(x + radius, z) && world.walkable(x - radius, z) &&
  world.walkable(x, z + radius) && world.walkable(x, z - radius);

/** 기존 충격형 pull과 분리한 짧은 목표점 수렴. 적의 공격 시계·기절은 건드리지 않는다. */
export function beginEnemyGather(enemy, x, z, speed, duration) {
  if (!enemy.alive || enemy.spawning || enemy.disposed || enemy.gatherBlockT > 0 || originLocked(enemy) || !Number.isFinite(x) || !Number.isFinite(z) ||
      !Number.isFinite(speed) || speed <= 0 || !Number.isFinite(duration) || duration <= 0) return false;
  enemy.gatherX = x; enemy.gatherZ = z;
  enemy.gatherSpeed = Math.min(32, speed) * (enemy.isBoss ? .15 : enemy.isElite ? .5 : 1);
  enemy.gatherT = Math.max(enemy.gatherT || 0, duration);
  return true;
}

/** Actor의 기존 Floor.resolve를 통과하는 속도만 예약해 중심 관통·잔여 관성을 막는다. */
export function prepareEnemyGather(enemy, dt) {
  if (!(enemy.gatherT > 0) || !Number.isFinite(dt) || dt <= 0 || enemy.game.paused) return false;
  if (!enemy.alive || enemy.spawning || enemy.disposed || !enemy.game.active || !enemy.game.player?.alive) {
    enemy.gatherT = 0; return false;
  }
  if (enemy.gatherBlockT > 0) { enemy.gatherT = 0; return false; }
  if (originLocked(enemy)) { enemy.gatherT = Math.max(0, enemy.gatherT - dt); return false; }
  const dx = enemy.gatherX - enemy.pos.x, dz = enemy.gatherZ - enemy.pos.z;
  const distance = Math.hypot(dx, dz), stop = .9 + (enemy.radius || .7) * .35;
  const travel = Math.min(Math.max(0, distance - stop), enemy.gatherSpeed * Math.min(dt, enemy.gatherT));
  const velocity = distance > 0 ? travel / (distance * dt) : 0;
  let vx = dx * velocity, vz = dz * velocity;
  const world = enemy.game.world, steps = Math.ceil(travel / .35);
  if (world?.walkable && steps > 1) {
    // Floor.resolve의 축 슬라이딩을 작은 구간에서 먼저 읽는다. 위치는 여기서 쓰지
    // 않고 Actor의 단일 충돌 경로에 최종 속도를 전달하며 임시 좌표 배열도 만들지 않는다.
    const radius = (enemy.radius || .7) * .8, sx = vx * dt / steps, sz = vz * dt / steps;
    let x = enemy.pos.x, z = enemy.pos.z;
    for (let i = 0; i < steps; i++) {
      const nx = x + sx, nz = z + sz;
      if (fits(world, nx, nz, radius) || (!fits(world, x, z, radius) && world.walkable(nx, nz))) { x = nx; z = nz; }
      else if (fits(world, nx, z, radius)) x = nx;
      else if (fits(world, x, nz, radius)) z = nz;
    }
    vx = (x - enemy.pos.x) / dt; vz = (z - enemy.pos.z) / dt;
  }
  enemy.kb.set(0, 0, 0);
  enemy.vel.set(vx, 0, vz);
  enemy.gatherT = Math.max(0, enemy.gatherT - dt);
  return true;
}

/** 스킬 준비/채널 구간에서만 사용한다. 기존 환경·세트의 충격형 vacuum 계약은 보존한다. */
export function gatherEnemies(game, center, radius, speed, duration = .14) {
  if (!game.active || game.paused || !center || !Number.isFinite(radius) || radius <= 0) return 0;
  let count = 0;
  for (const enemy of game.enemies) {
    if (!enemy.alive || enemy.spawning) continue;
    const dx = enemy.pos.x - center.x, dz = enemy.pos.z - center.z;
    if (dx * dx + dz * dz > radius * radius) continue;
    if (enemy.gather(center.x, center.z, speed, duration)) count++;
  }
  if (count && (game._vacSfx === undefined || game.elapsed - game._vacSfx > .45)) {
    game._vacSfx = game.elapsed; audio.suck({ vol: .22, dur: .4 });
  }
  return count;
}
