import * as THREE from 'three';

export const DUNGEON_SURFACE_PATH = '/img/environment/dungeon-stone-v1.webp';
/** @type {{ texture: THREE.Texture | null }} */
export const DUNGEON_SURFACE = { texture: null };
let pending;

/** 출격 전에 한 번 읽고 장면마다 재질만 소유한다. */
export function preloadDungeonSurface() {
  if (pending) return pending;
  pending = new THREE.TextureLoader().loadAsync(DUNGEON_SURFACE_PATH).then(texture => {
    texture.name = 'GPT_Dungeon_Stone_v1';
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    DUNGEON_SURFACE.texture = texture;
    return texture;
  }).catch(error => {
    pending = null;
    throw error;
  });
  return pending;
}

/** 압축 GLB의 좌표와 스케일을 보존하고 실제 4m 타일 면적에 UV를 투영한다. */
export function projectDungeonSurface(source, local, tileSize = 4) {
  const geometry = source.clone();
  const position = source.getAttribute('position');
  const uv = new Float32Array(position.count * 2), point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).applyMatrix4(local);
    uv[i * 2] = point.x / tileSize + .5;
    uv[i * 2 + 1] = point.z / tileSize + .5;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/** 팔레트 샘플을 실제 석재 표면으로 바꾸며 테마 색과 불투명 지면은 유지한다. */
export function applyDungeonSurface(material) {
  const texture = DUNGEON_SURFACE.texture;
  if (!texture) return false;
  material.map = texture;
  material.bumpMap = texture;
  material.bumpScale = .018;
  material.roughness = .92;
  material.metalness = 0;
  material.userData.surfaceTexture = 'gpt-dungeon-stone-v1';
  material.needsUpdate = true;
  return true;
}

/** 겹친 방/회랑의 같은 타일은 첫 배치만 남기고 기존 난수 소비 순서를 보존한다. */
export function collectDungeonTiles(floor, random, tileSize = 4) {
  /** @type {Record<string, { x: number, z: number, ry: number }[]>} */
  const transforms = { floor_tile_large: [], floor_tile_large_rocks: [], floor_dirt_large: [] };
  const seen = new Set();
  let sampledTiles = 0;
  const put = (rect, boss) => {
    const x0 = Math.floor((rect.x - rect.w / 2) / tileSize), x1 = Math.ceil((rect.x + rect.w / 2) / tileSize);
    const z0 = Math.floor((rect.z - rect.h / 2) / tileSize), z1 = Math.ceil((rect.z + rect.h / 2) / tileSize);
    for (let i = x0; i < x1; i++) for (let j = z0; j < z1; j++) {
      const choice = random();
      const name = boss || floor.layout ? 'floor_tile_large'
        : choice < .75 ? 'floor_tile_large' : choice < .9 ? 'floor_tile_large_rocks' : 'floor_dirt_large';
      const ry = Math.floor(random() * 4) * Math.PI / 2;
      sampledTiles++;
      const key = `${i},${j}`;
      if (seen.has(key)) continue;
      seen.add(key);
      transforms[name].push({ x: i * tileSize + tileSize / 2, z: j * tileSize + tileSize / 2, ry });
    }
  };
  for (const room of floor.rooms) put(room, room.type === 'boss');
  for (const corridor of floor.corridors) put(corridor, false);
  return { transforms, sampledTiles, uniqueTiles: seen.size };
}
