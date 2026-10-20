// 무리 aggro·추격. 적은 보이는 플레이어만 감지하고, 같은 무리와 시야가 닿는 이웃 무리에 경보를 전한다.
// 벽 너머로 끌어오거나 순간 이동시키지 않는다. 추격은 실제 이동 마스크의 경로 거리장을 따라 복도를 지난다.
// 프레임 루프에서는 새 객체·배열을 만들지 않는다(거리장 버퍼는 층마다 한 번 할당).

export const PACK = Object.freeze({
  sight: 13, eliteSight: 15,      // 감지 거리(m). 이동 마스크 위 직선 시야가 있어야 한다.
  alertRadius: 11,                // 무리끼리 경보가 닿는 거리(시야 필요)
  noiseRadius: 14,                // 피격 소리가 다른 무리를 깨우는 거리(시야 필요)
  reach: 64,                      // 추격 거리장 최대 경로 길이(셀=1m)
  leashPath: 48,                  // 무리의 가장 가까운 적이 이 경로보다 멀면 추적을 잃기 시작한다
  leashSec: 4,                    // 그 상태가 이만큼 이어지면 자기 방으로 돌아간다
  paceRange: 6.5,                 // 이보다 멀 때만 무리 보폭을 맞춘다(붙은 뒤에는 각자 싸운다)
  paceAhead: 2.4, paceBehind: 3, paceSlow: .62, paceFast: 1.25,
  // 10m 넘게 멀어진 추격자만 영웅 기본 이동속도의 92%까지 따라 달린다(질주는 따돌린다). 거리를 두고 싸우는
  // 원거리 영웅(4~8m)에게는 붙지 않는다. 7.5m 에서는 AUTO 원거리 영웅 패배가 늘었다(군중 흐름 시뮬 다중 시드).
  catchupRange: 10, catchupMax: 1.45, catchupShare: .92,
  losRefresh: .15, step: .5,
  reactStep: .07,                 // 경보를 받은 무리원이 차례로 반응하는 간격(결정적)
  formation: 4,                   // 한 무리 기본 인원
  rangedSlots: 3,                 // 동시에 조준하는 일반 원거리 적 상한
  rangedSlotRadius: 16,
  guardHold: 3.2,                 // 원거리 적이 뒤로 물러설 수 있는 무리 앵커 반경 여유
});

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

/** 이동 마스크 위 직선이 막혔는지. grid 는 world.mask(시야) 또는 world.inner(몸이 지나갈 여유). */
export function lineClear(world, ax, az, bx, bz, grid = world?.mask, skip = 0) {
  if (!world || !grid) return true;
  const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
  if (d < 1e-6) return true;
  const n = Math.ceil(d / PACK.step), cols = world.cols, rows = world.rows;
  for (let i = 1; i < n; i++) {
    const t = i / n, along = t * d;
    if (along < skip || d - along < skip) continue;
    const x = Math.floor((ax + dx * t - world.minX)), z = Math.floor((az + dz * t - world.minZ));
    if (x < 0 || z < 0 || x >= cols || z >= rows || grid[z * cols + x] !== 1) return false;
  }
  return true;
}

/** 한 지점(플레이어 또는 방 중심)까지의 경로 거리장. 배열은 생성할 때 한 번만 만든다. */
export class PursuitField {
  /** @param {*} world @param {number} [reach] */
  constructor(world, reach = PACK.reach) {
    const n = world.cols * world.rows;
    this.world = world; this.reach = reach;
    this.dist = new Int32Array(n); this.stamp = new Uint32Array(n); this.queue = new Int32Array(n);
    this.gen = 0; this.cell = -1; this.inner = null; this.key = null;
  }
  cellOf(x, z) {
    const w = this.world, cx = Math.floor(x - w.minX), cz = Math.floor(z - w.minZ);
    return cx < 0 || cz < 0 || cx >= w.cols || cz >= w.rows ? -1 : cz * w.cols + cx;
  }
  /** 목표 셀이 바뀌었거나 봉인 해제로 내부 마스크가 바뀐 때만 다시 퍼뜨린다. */
  seed(x, z) {
    const w = this.world, inner = w.inner;
    let cell = this.cellOf(x, z);
    if (cell < 0) return false;
    if (cell === this.cell && inner === this.inner) return true;
    this.cell = cell; this.inner = inner;
    if (++this.gen >= 0xffffffff) { this.stamp.fill(0); this.gen = 1; }
    // 목표가 벽에 붙은 셀이면 가장 가까운 내부 셀에서 시작한다(고정 순서라 결정적이다).
    if (inner[cell] !== 1) {
      const cols = w.cols, cx = cell % cols, cz = (cell - cx) / cols;
      let found = -1;
      for (let r = 1; r <= 2 && found < 0; r++) for (let k = 0; k < DIRS.length; k++) {
        const nx = cx + DIRS[k][0] * r, nz = cz + DIRS[k][1] * r;
        if (nx < 0 || nz < 0 || nx >= cols || nz >= w.rows) continue;
        if (inner[nz * cols + nx] === 1) { found = nz * cols + nx; break; }
      }
      if (found < 0) return false;
      cell = found;
    }
    const dist = this.dist, stamp = this.stamp, q = this.queue, gen = this.gen, cols = w.cols, rows = w.rows, reach = this.reach;
    let head = 0, tail = 0;
    dist[cell] = 0; stamp[cell] = gen; q[tail++] = cell;
    while (head < tail) {
      const cur = q[head++], d = dist[cur];
      if (d >= reach) continue;
      const cx = cur % cols, cz = (cur - cx) / cols;
      for (let k = 0; k < 4; k++) {
        const nx = cx + DIRS[k][0], nz = cz + DIRS[k][1];
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
        const ni = nz * cols + nx;
        if (stamp[ni] === gen || inner[ni] !== 1) continue;
        stamp[ni] = gen; dist[ni] = d + 1; q[tail++] = ni;
      }
    }
    return true;
  }
  valueAt(cell) { return cell >= 0 && this.stamp[cell] === this.gen ? this.dist[cell] : -1; }
  /** 위치에서 목표까지의 경로 길이(셀). 벽에 붙은 셀은 이웃 내부 셀로 읽는다. 닿지 않으면 -1. */
  distanceAt(x, z) {
    const cell = this.cellOf(x, z), here = this.valueAt(cell);
    if (here >= 0 || cell < 0) return here;
    const cols = this.world.cols; let best = -1;
    for (let k = 0; k < DIRS.length; k++) { const v = this.valueAt(cell + DIRS[k][1] * cols + DIRS[k][0]); if (v >= 0 && (best < 0 || v < best)) best = v; }
    return best < 0 ? -1 : best + 1;
  }
  /** 경로를 따라 내려가는 다음 셀 중심 방향을 out 에 쓴다. 모서리를 가로지르는 대각선은 쓰지 않는다. */
  step(x, z, out) {
    const w = this.world, cols = w.cols, cell = this.cellOf(x, z);
    if (cell < 0) return false;
    const cx = cell % cols, cz = (cell - cx) / cols, here = this.valueAt(cell);
    let best = -1, bx = 0, bz = 0;
    for (let k = 0; k < DIRS.length; k++) {
      const ox = DIRS[k][0], oz = DIRS[k][1];
      const v = this.valueAt(cell + oz * cols + ox);
      if (v < 0) continue;
      if (ox && oz && (this.valueAt(cell + ox) < 0 || this.valueAt(cell + oz * cols) < 0)) continue;
      if (best < 0 || v < best) { best = v; bx = ox; bz = oz; }
    }
    if (best < 0 || (here >= 0 && best >= here)) return false;
    const tx = w.minX + cx + bx + .5, tz = w.minZ + cz + bz + .5, vx = tx - x, vz = tz - z, l = Math.hypot(vx, vz) || 1;
    out.x = vx / l; out.z = vz / l;
    return true;
  }
}

/** 전투가 쓰는 플레이어 추격장. 층이 바뀔 때만 새로 만든다. */
/**
 * 벽 속(이동 불가 셀)에 중심이 들어간 적을 가장 가까운 바닥 셀로 되돌린다. 넉백·소환 위치 오류로 생긴
 * 잘못된 상태의 충돌 보정이며 3m 안에서만 찾는다(고정 순서라 결정적). 옮겼으면 true.
 */
export function escapeWall(world, pos) {
  if (!world?.walkable || world.walkable(pos.x, pos.z)) return false;
  const bx = Math.floor(pos.x - world.minX), bz = Math.floor(pos.z - world.minZ);
  for (let r = 1; r <= 3; r++) for (let k = 0; k < DIRS.length; k++) {
    const x = world.minX + bx + DIRS[k][0] * r + .5, z = world.minZ + bz + DIRS[k][1] * r + .5;
    if (world.walkable(x, z)) { pos.x = x; pos.z = z; return true; }
  }
  return false;
}

/** 전투가 쓰는 플레이어 추격장. 층이 바뀔 때만 새로 만든다. */
export function pursuitField(game) {
  const world = game?.world;
  if (!world?.inner || !Number.isFinite(world.cols)) return null;
  if (game._pursuit?.world !== world) { game._pursuit = new PursuitField(world); game._pursuitHomes = []; }
  return game._pursuit;
}

/** 귀환용 방 중심 거리장. 최근 방 3개만 유지해 층당 메모리를 묶는다. */
function homeField(game, room) {
  const homes = game._pursuitHomes || (game._pursuitHomes = []);
  for (let i = 0; i < homes.length; i++) if (homes[i].key === room) { homes[i].seed(room.x, room.z); return homes[i]; }
  const field = homes.length < 3 ? new PursuitField(game.world) : homes.shift();
  field.key = room; field.cell = -1; field.seed(room.x, room.z); homes.push(field);
  return field;
}

export class Pack {
  constructor(room, x, z, aggro = false) {
    this.room = room; this.x = x; this.z = z; this.aggro = aggro; this.returning = false;
    this.members = []; this.slots = 0; this.lostT = 0; this.alertedAt = -1;
    this.frame = NaN; this.sumNow = 0; this.cntNow = 0; this.nearNow = Infinity;
    this.meanPrev = 0; this.cntPrev = 0; this.nearPrev = 0;
  }
}

/** 방 명단을 무리로 나눈다. 진입 지점에서 먼 쪽부터, 서로 떨어진 앵커를 고정 격자에서 고른다(난수 없음). */
export function planRoomPacks(world, room, count, entryX, entryZ) {
  if (!room || !(count > 0)) return null;
  const packs = Math.max(1, Math.min(5, Math.round(count / PACK.formation)));
  const mx = Math.max(0, room.w / 2 - 3.2), mz = Math.max(0, room.h / 2 - 3.2), cand = [];
  for (const fx of [-1, -.5, 0, .5, 1]) for (const fz of [-1, -.5, 0, .5, 1]) {
    const x = room.x + fx * mx, z = room.z + fz * mz;
    if (!world?.inner || world.inner[Math.floor(z - world.minZ) * world.cols + Math.floor(x - world.minX)] === 1) cand.push({ x, z });
  }
  if (!cand.length) cand.push({ x: room.x, z: room.z });
  const chosen = [];
  const far = c => Math.hypot(c.x - entryX, c.z - entryZ);
  while (chosen.length < packs) {
    let best = null, score = -Infinity;
    for (const c of cand) {
      if (chosen.includes(c)) continue;
      let spread = Infinity; for (const o of chosen) spread = Math.min(spread, Math.hypot(c.x - o.x, c.z - o.z));
      // 첫 무리는 입구 반대편, 다음 무리는 이미 고른 앵커와의 간격을 우선한다. 입구 코앞(7m 안)은 피한다.
      const s = (chosen.length ? Math.min(spread, 9) * 1.4 : 0) + Math.min(far(c), 18) * (chosen.length ? .45 : 1) - (far(c) < 7 ? 20 : 0);
      if (s > score) { score = s; best = c; }
    }
    if (!best) break;
    chosen.push(best);
  }
  return chosen.map(c => new Pack(room, c.x, c.z));
}

/** 방 명단의 다음 무리. 순서대로 돌리되 영웅이 서 있는 앵커(6m 안)에는 새 병력을 세우지 않는다. Battle.roomPackFor와 장식 배치가 같은 규칙을 쓴다. */
export function pickRoomPack(room, heroPos) {
  const packs = room.packs, p = heroPos;
  const cursor = room.packCursor || 0; room.packCursor = cursor + 1;
  let pack = packs[cursor % packs.length];
  if (p && Math.hypot(pack.x - p.x, pack.z - p.z) < 6) {
    let far = -1;
    for (const other of packs) { const d = Math.hypot(other.x - p.x, other.z - p.z); if (d > far) { far = d; pack = other; } }
  }
  return pack;
}

/** 무리 대형의 다음 자리. 황금각 나선이라 인원이 늘어도 겹치지 않는다. */
export function packSlot(world, pack, out) {
  const i = pack.slots++, a = i * 2.399963, r = i ? .95 + .62 * Math.sqrt(i) : 0;
  let x = pack.x + Math.cos(a) * r, z = pack.z + Math.sin(a) * r;
  if (world?.resolve) [x, z] = world.resolve(pack.x, pack.z, x, z, .6);
  out.x = x; out.z = z;
  return out;
}

export function joinPack(enemy, pack) {
  if (!enemy || !pack) return;
  enemy.pack = pack; pack.members.push(enemy);
  // 이미 싸우는 무리에 합류하는 대기열 병력은 바로 교전한다.
  enemy.reactT = pack.aggro ? PACK.reactStep : 0;
}

function seesPlayer(enemy, game, range) {
  const players = game.stage?.party && game.app?.party?.livingPlayers ? game.app.party.livingPlayers() : null;
  if (players) {
    for (let i = 0; i < players.length; i++) { const p = players[i]; if (p?.alive && sees(enemy, game, p, range)) return true; }
    return false;
  }
  return !!game.player?.alive && sees(enemy, game, game.player, range);
}
function sees(enemy, game, p, range) {
  const dx = p.pos.x - enemy.pos.x, dz = p.pos.z - enemy.pos.z;
  return dx * dx + dz * dz <= range * range && lineClear(game.world, enemy.pos.x, enemy.pos.z, p.pos.x, p.pos.z);
}

/** 무리 경보. 같은 무리는 순서대로 반응하고, 시야가 닿는 radius 안 이웃 무리로 한 번씩 번진다. */
export function alertPack(game, pack, source, radius = PACK.alertRadius) {
  if (!pack || pack.aggro) return false;
  pack.aggro = true; pack.returning = false; pack.lostT = 0; pack.alertedAt = game.elapsed || 0;
  let order = 0;
  for (let i = 0; i < pack.members.length; i++) {
    const m = pack.members[i];
    if (!m.alive) continue;
    m.reactT = m === source ? 0 : PACK.reactStep * ++order;
  }
  if (source?.pos) game.fx?.ring?.(source.pos, 0xff5a3c, { r0: .3, r1: 1.6, life: .35, y: .08 });
  const enemies = game.enemies || [];
  for (let i = 0; i < enemies.length; i++) {
    const other = enemies[i], op = other.pack;
    if (!op || op.aggro || !other.alive || other.spawning || !source?.pos) continue;
    const dx = other.pos.x - source.pos.x, dz = other.pos.z - source.pos.z;
    if (dx * dx + dz * dz > radius * radius) continue;
    if (!lineClear(game.world, source.pos.x, source.pos.z, other.pos.x, other.pos.z)) continue;
    alertPack(game, op, other, PACK.alertRadius);
  }
  return true;
}

/** 무리 통계는 프레임마다 한 번 넘긴다. 같은 프레임의 다른 무리원이 지난 프레임 값을 읽는다. */
function rollover(pack, game, dt) {
  if (pack.frame === game.elapsed) return;
  pack.frame = game.elapsed;
  pack.meanPrev = pack.cntNow ? pack.sumNow / pack.cntNow : 0; pack.cntPrev = pack.cntNow; pack.nearPrev = pack.nearNow;
  pack.sumNow = 0; pack.cntNow = 0; pack.nearNow = Infinity;
  // 추격 중인 무리원이 한 명도 없던 프레임(모두 피격·공격 중)은 추적 상실로 세지 않는다.
  if (!pack.aggro || !(dt > 0) || !pack.cntPrev) return;
  if (pack.nearPrev > PACK.leashPath) pack.lostT += dt; else pack.lostT = 0;
  if (pack.lostT > PACK.leashSec) { pack.aggro = false; pack.returning = true; pack.lostT = 0; }
}

/**
 * 적 한 명의 추격 판단. 반환값: true 면 교전(추격·공격), false 면 대기/귀환 이동을 이미 vel 에 썼다.
 * route 에는 플레이어로 가는 단위 방향과 무리 보폭 배율(route.pace)을 쓴다.
 */
export function updatePursuit(enemy, game, player, distance, dt, route) {
  route.pace = 1; route.los = true;
  const world = game.world, pack = enemy.pack;
  if (pack && !enemy.isBoss) {
    rollover(pack, game, dt);
    if (!pack.aggro) {
      const sight = enemy.isElite ? PACK.eliteSight : PACK.sight;
      if (!enemy.spawning && dt > 0 && seesPlayer(enemy, game, sight)) alertPack(game, pack, enemy);
    }
    if (!pack.aggro) return false;
    if (enemy.reactT > 0) { enemy.reactT -= dt; if (enemy.reactT > 0) return false; }
  }
  const dx = player.pos.x - enemy.pos.x, dz = player.pos.z - enemy.pos.z, d = distance || Math.hypot(dx, dz) || 1;
  route.x = dx / d; route.z = dz / d;
  if (!world?.inner || enemy.isBoss) return true;
  enemy.losT = (enemy.losT || 0) - dt;
  if (enemy.losT <= 0) {
    enemy.losT = PACK.losRefresh;
    // 몸이 지나갈 여유가 있는 직선이면 그대로 간다. 끝 1.2m는 벽에 붙어 선 자리라 내부 마스크에서 뺀다.
    enemy.routeClear = lineClear(world, enemy.pos.x, enemy.pos.z, player.pos.x, player.pos.z, world.inner, 1.2);
    enemy.sightClear = enemy.routeClear || lineClear(world, enemy.pos.x, enemy.pos.z, player.pos.x, player.pos.z);
  }
  route.los = enemy.sightClear !== false;
  const field = pursuitField(game);
  if (field) {
    field.seed(player.pos.x, player.pos.z);
    if (pack) { const path = field.distanceAt(enemy.pos.x, enemy.pos.z); if (path >= 0 && path < pack.nearNow) pack.nearNow = path; }
    if (enemy.routeClear === false) field.step(enemy.pos.x, enemy.pos.z, route);
  }
  if (pack) {
    pack.sumNow += d; pack.cntNow++;
    if (pack.cntPrev > 1 && d > PACK.paceRange) {
      const ahead = pack.meanPrev - d;
      route.pace = ahead > PACK.paceAhead ? PACK.paceSlow : -ahead > PACK.paceBehind ? PACK.paceFast : 1;
    }
    // 발각한 무리는 걷는 영웅을 놓치지 않을 만큼 따라붙는다. 느린 종일수록 더 서두르되 영웅 기본 속도는 넘지 않는다.
    const base = enemy.def?.spd || 0, hero = player.stats?.spd || 0;
    if (d > PACK.catchupRange && base > 0 && hero > 0) route.pace *= Math.max(1, Math.min(PACK.catchupMax, hero * PACK.catchupShare / base));
  }
  return true;
}

/** 전투 소리: 맞은 적의 무리를 깨우고, 시야가 닿는 가까운 경계 무리도 깨운다. 같은 적은 0.5초에 한 번만 퍼뜨린다. */
export function packNoise(game, source) {
  const pack = source?.pack;
  if (!pack || !source.alive) return;
  const now = game.elapsed || 0;
  if (source.noiseAt !== undefined && now - source.noiseAt < .5) return;
  source.noiseAt = now;
  if (!pack.aggro) { alertPack(game, pack, source, PACK.noiseRadius); return; }
  const enemies = game.enemies || [];
  for (let i = 0; i < enemies.length; i++) {
    const other = enemies[i], op = other.pack;
    if (!op || op.aggro || !other.alive || other.spawning) continue;
    const dx = other.pos.x - source.pos.x, dz = other.pos.z - source.pos.z;
    if (dx * dx + dz * dz > PACK.noiseRadius * PACK.noiseRadius) continue;
    if (lineClear(game.world, source.pos.x, source.pos.z, other.pos.x, other.pos.z)) alertPack(game, op, other);
  }
}

/** 추적을 잃은 무리는 자기 방으로 길을 따라 돌아가 앵커에서 다시 경계한다. 대기 중에는 무리 간격만 유지한다. */
export function idlePursuit(enemy, game, sepX, sepZ, route) {
  const pack = enemy.pack, world = game.world;
  enemy.vel.set(sepX * .5, 0, sepZ * .5);
  if (!pack?.returning || !pack.room) return false;
  const room = pack.room, inRoom = Math.abs(enemy.pos.x - room.x) < room.w / 2 - 1 && Math.abs(enemy.pos.z - room.z) < room.h / 2 - 1;
  let tx = pack.x - enemy.pos.x, tz = pack.z - enemy.pos.z;
  const left = Math.hypot(tx, tz);
  if (left < 1.4) {
    let home = true;
    for (let i = 0; i < pack.members.length && home; i++) { const m = pack.members[i]; if (m.alive && Math.hypot(m.pos.x - pack.x, m.pos.z - pack.z) >= 3.2) home = false; }
    if (home) pack.returning = false;
    return false;
  }
  route.x = tx / left; route.z = tz / left;
  if (!inRoom && world?.inner) homeField(game, room).step(enemy.pos.x, enemy.pos.z, route);
  const speed = (enemy.def?.spd || 3) * .85;
  enemy.vel.set(route.x * speed + sepX * .5, 0, route.z * speed + sepZ * .5);
  return true;
}

/** 원거리 일반 적도 동시에 조준하는 수를 묶어 무리 전투의 예고를 읽을 수 있게 한다. 보스·정예는 기존 권한을 유지한다. */
export function canCommitRanged(self, enemies, player, slots = PACK.rangedSlots, radius = PACK.rangedSlotRadius) {
  if (!self || self.isBoss || self.isElite || !self.def?.ranged) return true;
  let active = 0;
  for (let i = 0; i < enemies.length; i++) {
    const o = enemies[i];
    if (!o || o === self || !o.alive || o.spawning || o.isBoss || o.isElite || !o.def?.ranged || o.state !== 'attack') continue;
    if (player?.pos && Math.hypot(o.pos.x - player.pos.x, o.pos.z - player.pos.z) > radius) continue;
    if (++active >= slots) return false;
  }
  return true;
}
