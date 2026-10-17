// 건축은 현재와 봉인 해제 후 보행 셀의 합집합 경계를 따른다. 전투 마스크와 난수는 읽거나 소비하지 않는다.
export const DUNGEON_WALL_LENGTH = 4;
export const DUNGEON_WALL_CLEARANCE = .005;
const VARIANTS = ['wall', 'wall', 'wall', 'wall_cracked', 'wall_arched', 'wall_window_open', 'wall_broken'];
const NORMALS = [[0, -1, 0], [0, 1, Math.PI], [-1, 0, Math.PI / 2], [1, 0, -Math.PI / 2]];

/** 봉인 문을 외벽으로 오인하지 않도록 architectureMask만 읽는다. */
export function collectDungeonWallRuns(floor) {
  const { architectureMask: mask, cols, rows, minX, minZ } = floor;
  if (!mask || mask.length !== cols * rows) throw new Error('던전 건축 마스크가 없습니다.');
  const open = (x, z) => x >= 0 && z >= 0 && x < cols && z < rows && mask[z * cols + x] === 1;
  const runs = [];
  for (const side of [0, 1]) for (let z = 0; z < rows; z++) {
    let start = -1;
    for (let x = 0; x <= cols; x++) {
      const edge = x < cols && open(x, z) && !open(x, z + (side ? 1 : -1));
      if (edge && start < 0) start = x;
      if (!edge && start >= 0) {
        const line = z + (side ? 1 : 0);
        runs.push({ axis: 'x', side, a: minX + start, b: minX + x, at: minZ + line,
          length: x - start, startCell: start, lineCell: line });
        start = -1;
      }
    }
  }
  for (const side of [2, 3]) for (let x = 0; x < cols; x++) {
    let start = -1;
    for (let z = 0; z <= rows; z++) {
      const edge = z < rows && open(x, z) && !open(x + (side === 3 ? 1 : -1), z);
      if (edge && start < 0) start = z;
      if (!edge && start >= 0) {
        const line = x + (side === 3 ? 1 : 0);
        runs.push({ axis: 'z', side, a: minZ + start, b: minZ + z, at: minX + line,
          length: z - start, startCell: start, lineCell: line });
        start = -1;
      }
    }
  }
  return runs;
}

// 정수 셀 좌표를 섞어 변형을 고른다. 기존 바닥·장식의 random() 흐름과 독립적이다.
function variantAt(seed, run, offset) {
  let hash = (seed | 0) ^ 0x3f6a2c91;
  hash = Math.imul(hash ^ (run.startCell + offset), 0x45d9f3b);
  hash = Math.imul(hash ^ run.lineCell, 0x45d9f3b);
  hash = Math.imul(hash ^ run.side, 0x45d9f3b);
  return VARIANTS[((hash ^ (hash >>> 16)) >>> 0) % VARIANTS.length];
}

/** 직선 경계를 최대 4m로 나눈다. 끝의 짧은 조각은 아치가 찌그러지지 않도록 일반 벽을 쓴다. */
export function collectDungeonWallSegments(floor) {
  const result = [];
  for (const run of collectDungeonWallRuns(floor)) {
    const [normalX, normalZ, ry] = NORMALS[run.side];
    for (let offset = 0; offset < run.length; offset += DUNGEON_WALL_LENGTH) {
      const length = Math.min(DUNGEON_WALL_LENGTH, run.length - offset);
      const a = run.a + offset, b = a + length, middle = a + length / 2;
      result.push({ x: run.axis === 'x' ? middle : run.at, z: run.axis === 'x' ? run.at : middle,
        ry, length, normalX, normalZ, variant: length < DUNGEON_WALL_LENGTH ? 'wall' : variantAt(floor.seed, run, offset),
        boundary: { axis: run.axis, at: run.at, a, b } });
    }
  }
  return result;
}

/** 반대편 보행 셀까지의 실제 여유에 맞는 원본 벽을 고른다. 높이·두께는 줄이지 않는다. */
export function fitDungeonWallSegments(floor, segments, depths) {
  const available = Object.values(depths).filter(depth => Number.isFinite(depth) && depth > 0);
  if (!available.length) return segments;
  const steps = Math.ceil(Math.max(...available) + DUNGEON_WALL_CLEARANCE);
  const { architectureMask: mask, cols, rows, minX, minZ } = floor;
  return segments.map(segment => {
    let space = Infinity;
    for (let along = .5; along < segment.length; along++) {
      const x = segment.boundary.axis === 'x' ? segment.boundary.a + along : segment.boundary.at;
      const z = segment.boundary.axis === 'z' ? segment.boundary.a + along : segment.boundary.at;
      for (let distance = 0; distance < steps && distance < space; distance++) {
        const ix = Math.floor(x + segment.normalX * (distance + .5) - minX);
        const iz = Math.floor(z + segment.normalZ * (distance + .5) - minZ);
        if (ix >= 0 && iz >= 0 && ix < cols && iz < rows && mask[iz * cols + ix] === 1) {
          space = distance; break;
        }
      }
    }
    let variant = segment.variant, depth = depths[variant];
    if (!(depth > 0) || depth > space) { variant = 'wall'; depth = depths.wall; }
    if (!(depth > 0) || depth > space) throw new Error('던전 경계의 여유보다 원본 벽이 두껍습니다.');
    // 1m 홈에는 0.99985m 일반 벽과 5mm 여유를 함께 넣을 수 없다. 남는 폭을 양쪽에 나눈다.
    const clearance = Math.min(DUNGEON_WALL_CLEARANCE, Math.max(0, (space - depth) / 2));
    return { ...segment, variant, clearance };
  });
}
