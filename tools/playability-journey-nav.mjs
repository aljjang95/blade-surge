// 실제 사용자 여정 QA 보조: 관측한 보행 마스크 사본으로 길을 찾고, 월드 방향을 조이스틱 화면 오프셋으로 바꾼다.
// 게임 상태를 바꾸지 않는 순수 함수만 둔다. world.buildFlow 는 AUTO 가 쓰는 캐시(_flowKey/_flow)를 바꾸므로 부르지 않고
// 같은 규칙(침식 마스크 inner 위 4방향 BFS, 대각선은 양옆이 열린 때만)을 이 사본에서 다시 계산한다.

/** src/game/world.js 의 CELL(마스크 셀 크기). 관측한 bounds 로 역산한 값이 다르면 보고서에 남긴다. */
export const WORLD_CELL = 1;

/** readGrid() 결과(문자열 마스크)를 배열로 푼다. */
export function decodeGrid(raw) {
  if (!raw || !Number.isInteger(raw.cols) || !Number.isInteger(raw.rows)) return null;
  const n = raw.cols * raw.rows;
  if (raw.inner.length !== n || raw.mask.length !== n) return null;
  const inner = new Uint8Array(n), mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) { inner[i] = raw.inner.charCodeAt(i) === 49 ? 1 : 0; mask[i] = raw.mask.charCodeAt(i) === 49 ? 1 : 0; }
  return { cols: raw.cols, rows: raw.rows, minX: raw.minX, minZ: raw.minZ, cell: raw.cell || WORLD_CELL, inner, mask, sealed: !!raw.sealed };
}

/** 관측한 bounds 와 열 수로 셀 크기를 역산한다(world.buildMask 의 pad 6 기준). 진단용. */
export function inferCell(raw) {
  const b = raw?.bounds;
  if (!b || !raw.cols) return null;
  return (b.maxX - b.minX + 12) / raw.cols;
}

export function cellIndex(g, x, z) {
  const cx = Math.floor((x - g.minX) / g.cell), cz = Math.floor((z - g.minZ) / g.cell);
  if (cx < 0 || cz < 0 || cx >= g.cols || cz >= g.rows) return -1;
  return cz * g.cols + cx;
}

/** world.walkable 과 같은 판정(원래 마스크). */
export function walkable(g, x, z) {
  const i = cellIndex(g, x, z);
  return i >= 0 && g.mask[i] === 1;
}

/** 반경 안의 가장 가까운 침식 마스크 셀. */
export function nearestInner(g, i, maxR = 6) {
  if (i < 0) return -1;
  if (g.inner[i]) return i;
  const cz = (i / g.cols) | 0, cx = i - cz * g.cols;
  for (let r = 1; r <= maxR; r++) {
    let best = -1, bd = Infinity;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= g.cols || nz >= g.rows) continue;
      const j = nz * g.cols + nx;
      if (g.inner[j] && dx * dx + dz * dz < bd) { bd = dx * dx + dz * dz; best = j; }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** 목표 지점까지의 BFS 거리장. 목표가 막힌 곳이면 가까운 열린 셀을 목표로 삼는다. */
export function distanceField(g, tx, tz) {
  const start = nearestInner(g, cellIndex(g, tx, tz));
  if (start < 0) return null;
  const n = g.cols * g.rows, dist = new Int32Array(n).fill(-1), q = new Int32Array(n);
  let head = 0, tail = 0;
  dist[start] = 0; q[tail++] = start;
  while (head < tail) {
    const cur = q[head++], cz = (cur / g.cols) | 0, cx = cur - cz * g.cols, d = dist[cur];
    for (let k = 0; k < 4; k++) {
      const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0), nz = cz + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || nz < 0 || nx >= g.cols || nz >= g.rows) continue;
      const j = nz * g.cols + nx;
      if (dist[j] !== -1 || g.inner[j] !== 1) continue;
      dist[j] = d + 1; q[tail++] = j;
    }
  }
  return { dist, start };
}

/**
 * 거리장을 따라 lookahead 셀 앞의 셀 중심을 향하는 단위 방향.
 * @returns {{x:number,z:number,remaining:number,arrived:boolean}|null}
 */
export function pathDirection(g, field, x, z, lookahead = 3) {
  if (!field) return null;
  const dist = field.dist;
  let from = cellIndex(g, x, z);
  if (from < 0) return null;
  if (dist[from] < 0) {
    // 벽 옆 셀: 반경 2 안에서 가장 목표에 가까운 열린 셀로 빠져나온다.
    const cz = (from / g.cols) | 0, cx = from - cz * g.cols;
    let best = -1, bv = Infinity;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= g.cols || nz >= g.rows) continue;
      const v = dist[nz * g.cols + nx];
      if (v >= 0 && v < bv) { bv = v; best = nz * g.cols + nx; }
    }
    if (best < 0) return null;
    from = best;
  }
  if (dist[from] === 0) return { x: 0, z: 0, remaining: 0, arrived: true };
  let cur = from;
  for (let k = 0; k < lookahead && dist[cur] > 0; k++) {
    const cz = (cur / g.cols) | 0, cx = cur - cz * g.cols;
    let best = -1, bv = dist[cur];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= g.cols || nz >= g.rows) continue;
      const v = dist[nz * g.cols + nx];
      if (v < 0) continue;
      // 대각선은 양옆 셀이 모두 열렸을 때만(모서리에 몸 반경이 걸리지 않게).
      if (dx && dz && (dist[cz * g.cols + nx] < 0 || dist[nz * g.cols + cx] < 0)) continue;
      if (v < bv) { bv = v; best = nz * g.cols + nx; }
    }
    if (best < 0) break;
    cur = best;
  }
  if (cur === from) return null;
  const cz = (cur / g.cols) | 0, cx = cur - cz * g.cols;
  const wx = g.minX + (cx + 0.5) * g.cell, wz = g.minZ + (cz + 0.5) * g.cell;
  const dx = wx - x, dz = wz - z, l = Math.hypot(dx, dz);
  if (l < 1e-6) return { x: 0, z: 0, remaining: dist[from], arrived: false };
  return { x: dx / l, z: dz / l, remaining: dist[from], arrived: false };
}

/**
 * 게임의 cameraRelativeMove(x, y, yaw) = { x: x·c + y·s, y: −x·s + y·c } 의 역변환.
 * 월드 방향(x, z)을 화면 조이스틱 방향(오른쪽 +x, 아래 +y)으로 바꾼다. 길이는 1로 맞춘다.
 */
export function worldToStick(wx, wz, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const x = wx * c - wz * s, y = wx * s + wz * c, l = Math.hypot(x, y);
  return l < 1e-9 ? { x: 0, y: 0 } : { x: x / l, y: y / l };
}

/** 검증용: 게임 cameraRelativeMove 와 같은 식. */
export function stickToWorld(x, y, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: x * c + y * s, z: -x * s + y * c };
}

/** src/game/ranger-aim.js clearShot 과 같은 직선 시야 판정(원래 마스크 사본). */
export function clearLine(g, ax, az, bx, bz, targetRadius = 0, step = 0.5) {
  if (!g) return true;
  const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz);
  const reach = length - Math.max(0.35, targetRadius);
  if (reach <= step) return true;
  const ux = dx / length, uz = dz / length;
  for (let d = step; d < reach; d += step) if (!walkable(g, ax + ux * d, az + uz * d)) return false;
  return true;
}

/** 두 평면 벡터 사이 각(라디안, 0..π). 길이가 0이면 null. */
export function angleBetween(ax, az, bx, bz) {
  const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
  if (la < 1e-9 || lb < 1e-9) return null;
  return Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb))));
}

/** 목표를 향한 방향 기준으로 옆걸음·후퇴 방향을 고른다. 앞쪽 거리 probe 안이 걸을 수 있는 쪽을 우선한다. */
export function evasiveDirection(g, px, pz, tx, tz, kind, preferSign = 1, probe = 2.5) {
  const dx = tx - px, dz = tz - pz, l = Math.hypot(dx, dz) || 1, fx = dx / l, fz = dz / l;
  const open = (vx, vz) => !g || (walkable(g, px + vx * probe, pz + vz * probe) && walkable(g, px + vx * probe * 0.5, pz + vz * probe * 0.5));
  const side = (sign) => ({ x: -fz * sign, z: fx * sign });
  if (kind === 'retreat') {
    if (open(-fx, -fz)) return { x: -fx, z: -fz, kind: 'retreat' };
    // 뒤가 막혔으면 대각선 후퇴, 그래도 막히면 옆걸음.
    for (const sign of [preferSign, -preferSign]) { const s = side(sign), vx = (s.x - fx) / Math.SQRT2, vz = (s.z - fz) / Math.SQRT2; if (open(vx, vz)) return { x: vx, z: vz, kind: 'retreat-diagonal' }; }
  }
  for (const sign of [preferSign, -preferSign]) { const s = side(sign); if (open(s.x, s.z)) return { ...s, kind: 'strafe', sign }; }
  return { ...side(preferSign), kind: 'strafe-blocked', sign: preferSign };
}
