/**
 * 무한의 성 — 한 층(Floor)의 절차적 생성.
 * 방(Room)들을 매크로 그리드에 배치하고 L자 복도로 잇는다.
 * 이동 가능 영역은 1유닛 셀 마스크로 들고 있어서 벽 슬라이딩 충돌이 싸게 된다.
 */

// 시드 기반 난수 (같은 층 = 같은 지형)
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ROOM_TYPE = { START: 'start', NORMAL: 'normal', ELITE: 'elite', TREASURE: 'treasure', BOSS: 'boss' };

const CELL = 1;              // 마스크 셀 크기(유닛)
const MACRO = 34;            // 매크로 그리드 간격
const TILE = 4;              // 던전 킷 바닥 타일 크기

export class Floor {
  constructor(floorNum, theme, seed = floorNum * 7919 + 13) {
    this.floor = floorNum; this.theme = theme;
    this.rand = mulberry32(seed);
    this.rooms = []; this.corridors = [];
    this.generate();
    this.buildMask();
  }
  r(a, b) { return a + this.rand() * (b - a); }
  ri(a, b) { return Math.floor(this.r(a, b + 1)); }

  generate() {
    const G = 5;                       // 5x5 매크로 그리드
    const want = 9 + Math.min(4, Math.floor(this.floor / 4));  // 층이 오를수록 방이 많다
    const visited = new Set();
    const order = [];
    const key = (x, y) => y * G + x;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    // 프론티어에서 무작위로 자라게 하면 한 줄로 늘어지지 않고 덩어리진 층이 나온다
    let cx = this.ri(1, G - 2), cy = this.ri(1, G - 2);
    visited.add(key(cx, cy)); order.push([cx, cy]);
    this.linkPending = [];
    let guard = 0;
    while (order.length < want && guard++ < 600) {
      const frontier = [];
      for (const [px, py] of order) for (const [dx, dy] of dirs) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= G || ny >= G || visited.has(key(nx, ny))) continue;
        frontier.push([px, py, nx, ny]);
      }
      if (!frontier.length) break;
      const [px, py, nx, ny] = frontier[this.ri(0, frontier.length - 1)];
      visited.add(key(nx, ny)); order.push([nx, ny]);
      this.linkPending.push([[px, py], [nx, ny]]);
    }
    // 순환 통로 1~2개 (막다른 길만 있으면 길찾기가 지루하다)
    const extra = 1 + (this.rand() < 0.5 ? 1 : 0);
    for (let e = 0; e < extra; e++) {
      const cands = [];
      for (const [ax, ay] of order) for (const [dx, dy] of dirs) {
        const bx = ax + dx, by = ay + dy;
        if (!visited.has(key(bx, by))) continue;
        const dup = this.linkPending.some(([[p, q], [r, t]]) => (p === ax && q === ay && r === bx && t === by) || (p === bx && q === by && r === ax && t === ay));
        if (!dup) cands.push([[ax, ay], [bx, by]]);
      }
      if (cands.length) this.linkPending.push(cands[this.ri(0, cands.length - 1)]);
    }
    // 매크로 좌표 → 월드 방
    const cells = new Map();
    order.forEach(([gx, gy], i) => {
      const isStart = i === 0;
      const big = isStart ? 0 : this.rand();
      let w = Math.round(this.r(14, 24) / TILE) * TILE;
      let h = Math.round(this.r(14, 24) / TILE) * TILE;
      const wx = (gx - (G - 1) / 2) * MACRO + this.r(-3, 3);
      const wz = (gy - (G - 1) / 2) * MACRO + this.r(-3, 3);
      const room = { id: i, gx, gy, x: wx, z: wz, w, h, type: isStart ? ROOM_TYPE.START : ROOM_TYPE.NORMAL,
        cleared: isStart, discovered: isStart, spawned: false, enemies: [], pathLen: 0 };
      this.rooms.push(room); cells.set(key(gx, gy), room);
    });
    // 복도
    for (const [[ax, ay], [bx, by]] of (this.linkPending || [])) {
      const A = cells.get(key(ax, ay)), B = cells.get(key(bx, by));
      if (!A || !B) continue;
      this.corridors.push(...this.lShape(A, B));
      (A.links ||= []).push(B.id); (B.links ||= []).push(A.id);
    }
    // 시작방에서의 거리(BFS) → 가장 먼 방이 보스
    const start = this.rooms[0];
    const dist = new Map([[start.id, 0]]); const q = [start];
    while (q.length) { const cur = q.shift(); for (const nid of (cur.links || [])) { if (dist.has(nid)) continue; dist.set(nid, dist.get(cur.id) + 1); q.push(this.rooms[nid]); } }
    for (const rm of this.rooms) rm.pathLen = dist.get(rm.id) ?? 99;
    const far = this.rooms.slice(1).sort((a, b) => b.pathLen - a.pathLen);
    if (far[0]) { far[0].type = ROOM_TYPE.BOSS; far[0].w = Math.max(far[0].w, 28); far[0].h = Math.max(far[0].h, 28); }
    // 엘리트 2~3, 보물 1
    const rest = far.slice(1);
    const nElite = Math.min(rest.length, 2 + (this.floor > 3 ? 1 : 0));
    for (let i = 0; i < nElite; i++) rest[i].type = ROOM_TYPE.ELITE;
    if (rest[nElite]) rest[nElite].type = ROOM_TYPE.TREASURE;
    this.bossRoom = this.rooms.find((rm) => rm.type === ROOM_TYPE.BOSS) || this.rooms[this.rooms.length - 1];
    this.startRoom = start;
  }
  /** 두 방을 잇는 L자 복도(폭 6) */
  lShape(A, B) {
    const w = 6, half = w / 2;
    const ax = A.x, az = A.z, bx = B.x, bz = B.z;
    const segs = [];
    // 가로 먼저
    const x0 = Math.min(ax, bx) - half, x1 = Math.max(ax, bx) + half;
    segs.push({ x: (x0 + x1) / 2, z: az, w: x1 - x0, h: w });
    const z0 = Math.min(az, bz) - half, z1 = Math.max(az, bz) + half;
    segs.push({ x: bx, z: (z0 + z1) / 2, w, h: z1 - z0 });
    return segs;
  }

  // ---------- 이동 가능 마스크 ----------
  buildMask() {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    const rects = [...this.rooms, ...this.corridors];
    for (const r of rects) {
      minX = Math.min(minX, r.x - r.w / 2); maxX = Math.max(maxX, r.x + r.w / 2);
      minZ = Math.min(minZ, r.z - r.h / 2); maxZ = Math.max(maxZ, r.z + r.h / 2);
    }
    const pad = 6;
    this.minX = minX - pad; this.minZ = minZ - pad;
    this.cols = Math.ceil((maxX - minX + pad * 2) / CELL);
    this.rows = Math.ceil((maxZ - minZ + pad * 2) / CELL);
    this.mask = new Uint8Array(this.cols * this.rows);
    for (const r of rects) this.fillRect(r, 1);
    this.bounds = { minX, maxX, minZ, maxZ };
  }
  fillRect(r, v) {
    const x0 = Math.floor((r.x - r.w / 2 - this.minX) / CELL), x1 = Math.ceil((r.x + r.w / 2 - this.minX) / CELL);
    const z0 = Math.floor((r.z - r.h / 2 - this.minZ) / CELL), z1 = Math.ceil((r.z + r.h / 2 - this.minZ) / CELL);
    for (let z = Math.max(0, z0); z < Math.min(this.rows, z1); z++)
      for (let x = Math.max(0, x0); x < Math.min(this.cols, x1); x++) this.mask[z * this.cols + x] = v;
  }
  walkable(wx, wz) {
    const x = Math.floor((wx - this.minX) / CELL), z = Math.floor((wz - this.minZ) / CELL);
    if (x < 0 || z < 0 || x >= this.cols || z >= this.rows) return false;
    return this.mask[z * this.cols + x] === 1;
  }
  /** 벽 슬라이딩: 목표 위치를 이동 가능한 곳으로 보정 */
  resolve(fromX, fromZ, toX, toZ, radius = 0.55) {
    const ok = (x, z) => this.walkable(x + radius, z) && this.walkable(x - radius, z) && this.walkable(x, z + radius) && this.walkable(x, z - radius);
    if (ok(toX, toZ)) return [toX, toZ];
    if (ok(toX, fromZ)) return [toX, fromZ];   // X 만 이동 (벽 따라 미끄러짐)
    if (ok(fromX, toZ)) return [fromX, toZ];   // Z 만 이동
    return [fromX, fromZ];
  }
  roomAt(wx, wz) {
    for (const r of this.rooms) if (Math.abs(wx - r.x) < r.w / 2 && Math.abs(wz - r.z) < r.h / 2) return r;
    return null;
  }
  /** 방 안의 랜덤 위치 */
  randomIn(room, margin = 2.5) {
    return [room.x + this.r(-1, 1) * (room.w / 2 - margin), room.z + this.r(-1, 1) * (room.h / 2 - margin)];
  }
  /** 목표 지점까지의 BFS 거리장 (길찾기). 목표가 바뀔 때만 다시 계산 */
  buildFlow(tx, tz) {
    const key = Math.round(tx) + ',' + Math.round(tz);
    if (this._flowKey === key) return this._flow;
    const N = this.cols * this.rows;
    const dist = new Int32Array(N).fill(-1);
    const sx = Math.floor((tx - this.minX) / CELL), sz = Math.floor((tz - this.minZ) / CELL);
    if (sx < 0 || sz < 0 || sx >= this.cols || sz >= this.rows) return null;
    const q = new Int32Array(N); let head = 0, tail = 0;
    const si = sz * this.cols + sx;
    if (this.mask[si] !== 1) return null;
    dist[si] = 0; q[tail++] = si;
    while (head < tail) {
      const cur = q[head++]; const cz = (cur / this.cols) | 0, cx = cur - cz * this.cols; const d = dist[cur];
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0), nz = cz + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || nz < 0 || nx >= this.cols || nz >= this.rows) continue;
        const ni = nz * this.cols + nx;
        if (dist[ni] !== -1 || this.mask[ni] !== 1) continue;
        dist[ni] = d + 1; q[tail++] = ni;
      }
    }
    this._flowKey = key; this._flow = dist; return dist;
  }
  /** 거리장을 따라 내려가는 방향 (없으면 직선) */
  flowDir(flow, wx, wz) {
    if (!flow) return null;
    const cx = Math.floor((wx - this.minX) / CELL), cz = Math.floor((wz - this.minZ) / CELL);
    if (cx < 1 || cz < 1 || cx >= this.cols - 1 || cz >= this.rows - 1) return null;
    let best = -1, bx = 0, bz = 0;
    const here = flow[cz * this.cols + cx];
    if (here < 0) return null;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const d = flow[(cz + dz) * this.cols + (cx + dx)];
      if (d < 0) continue;
      if (best === -1 || d < best) { best = d; bx = dx; bz = dz; }
    }
    if (best === -1 || best >= here) return null;
    const l = Math.hypot(bx, bz) || 1;
    return [bx / l, bz / l];
  }
  get remaining() { return this.rooms.filter((r) => !r.cleared && r.type !== ROOM_TYPE.START).length; }
}
