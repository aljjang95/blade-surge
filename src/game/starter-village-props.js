// 초보자 마을 Tripo 소품 GLB 8종(public/models/starter-village-v1/, 정규화 기록은 docs/starter-village-props.md) 로더.
// 스토어 네이티브 채널에서는 APK 밖(remote 묶음 starter-village)이라 받는 일은 주입된 읽기 함수(assets.js 의 loadLibraryGltf)가 맡는다.
// 못 받은 소품은 맵에 없고, 장면(starter-village-scene.js applyProps)은 맵에 없는 소품의 절차 모델을 그대로 둔다.
export const STARTER_PROP_ROOT = '/models/starter-village-v1/';
export const STARTER_PROP_NAMES = Object.freeze(['cottage', 'forge', 'board', 'dummy', 'portal', 'statue', 'fountain', 'stall']);
export const starterPropPath = name => `${STARTER_PROP_ROOT}${name}.glb`;

/**
 * 소품 템플릿을 한 번만 받아 로비를 다시 지어도 나눠 쓴다(지오메트리·텍스처는 템플릿 소유라 장면이 해제하지 않는다).
 * 실패한 소품은 캐시하지 않아 다음 로비에서 다시 시도한다(재시도 간격은 remote-assets 가 쉰다).
 * @param {(path: string) => Promise<{ scene?: any }>} load
 */
export function createStarterPropLoader(load) {
  const templates = new Map(), pending = new Map();
  const fetchOne = name => {
    if (!pending.has(name)) pending.set(name, (async () => {
      try {
        const gltf = await load(starterPropPath(name)), scene = gltf?.scene || gltf;
        if (scene?.isObject3D) templates.set(name, scene);
      } catch { /* 받지 못한 소품은 절차 모델 그대로 둔다 */ }
      finally { pending.delete(name); }
    })());
    return pending.get(name);
  };
  return {
    /** 받는 데 성공한 소품 이름 → 템플릿 장면(스냅샷). 하나도 못 받아도 거부하지 않고 빈 맵을 돌려준다. */
    async load(names = STARTER_PROP_NAMES) {
      await Promise.all(names.filter(name => !templates.has(name)).map(fetchOne));
      return new Map([...templates].filter(([name]) => names.includes(name)));
    },
  };
}
