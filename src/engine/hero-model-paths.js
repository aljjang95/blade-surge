import KNIGHT_HEAD_BALANCE from '../data/knight-head-balance-v1.json';

export const KNIGHT_HEAD_BALANCE_REVISION_ID = 'knight-head-balance-v1';

/** @typedef {{id:string, useInGame:boolean, status:string, assets:{base:{path:string,sha256:string|null},fitting:{path:string,sha256:string|null}}}} HeadBalanceRevision */
/** @typedef {{base:string, fitting:string, proportionRevision:string|null}} HeroModelPaths */
/** 완성된 생성물 쌍만 선택하며, 소스 단계에서는 기존 배포 경로를 유지한다.
 * @param {string} name
 * @param {HeadBalanceRevision} revision
 * @returns {HeroModelPaths}
 */
export function heroModelPaths(name, revision = KNIGHT_HEAD_BALANCE) {
  const paths = { base: `/models/${name}.glb`, fitting: `/models/heroes-v3/${name.toLowerCase()}-v3.glb`, proportionRevision: null };
  if (name !== 'Knight' || !revision.useInGame) return paths;
  if (revision.id !== KNIGHT_HEAD_BALANCE_REVISION_ID || revision.status !== 'GENERATED' || !/^[a-f0-9]{64}$/.test(revision.assets.base.sha256 || '')
    || !/^[a-f0-9]{64}$/.test(revision.assets.fitting.sha256 || '')
    || revision.assets.base.path !== '/models/heroes-next/knight-head-balance-v1.glb'
    || revision.assets.fitting.path !== '/models/heroes-next/knight-fitting-head-balance-v1.glb') {
    throw new Error('Knight head balance requires the exact generated base and fitting pair');
  }
  return { base: revision.assets.base.path, fitting: revision.assets.fitting.path, proportionRevision: revision.id };
}
