// 컨셉 던전 2곳(빙하 조수 분지 · 석양 황동 채석장)의 표준 → 심층 → 재도전 흐름을 고르는 읽기 전용 모델.
// 저장·해금·보상은 기존 ExpeditionEconomy(dungeonAccess · settle)만 판정·지급한다. 이 파일은 아무것도 쓰지 않는다.
import { CONCEPT_DUNGEONS } from '../data/expansion.js';
import { expeditionDepth } from '../data/expedition-depths.js';
import { BOSS_SIGNATURES } from '../data/boss-encounters.js';
import { ENEMIES } from '../data/stages.js';

export const CONCEPT_LOOP_IDS = Object.freeze(CONCEPT_DUNGEONS.map(dungeon => dungeon.id));
export const isConceptLoopRoute = id => CONCEPT_LOOP_IDS.includes(id);

/** 보스의 실제 전용 기술(이름·cue)만 phasePatterns 순서대로 돌려준다. */
export function conceptBossSignatures(enemyId) {
  const boss = /** @type {Record<string, any>} */ (ENEMIES)[enemyId];
  if (!boss?.phasePatterns) return [];
  return [...new Set(boss.phasePatterns.flat())].filter(key => Object.hasOwn(BOSS_SIGNATURES, key))
    .map(key => ({ key, name: BOSS_SIGNATURES[key].name, cue: BOSS_SIGNATURES[key].cue }));
}

/**
 * 카드에 쓰는 보스 cue · 기본 클리어 수 · 심층 해금/첫 정복 보상 상태.
 * @param {{ s: any, dungeonAccess: (id: string, options: { depth: string }) => { ok: boolean, error?: string|null } }} service
 * @param {string} id
 * @param {'standard'|'deep'} [depth]
 */
export function conceptBossCard(service, id, depth = 'standard') {
  const dungeon = CONCEPT_DUNGEONS.find(entry => entry.id === id), deep = expeditionDepth(id);
  if (!dungeon || !deep) return null;
  const access = service.dungeonAccess(id, { depth: 'deep' }), wins = service.s.depthWins?.[id] || 0;
  const signatures = conceptBossSignatures(depth === 'deep' ? deep.bossEnemy : dungeon.bossEnemy);
  return {
    id, depth,
    bossName: depth === 'deep' ? deep.bossName : dungeon.bossName,
    signatures,
    cue: signatures.map(signature => `${signature.name}: ${signature.cue}`).join(' · '),
    clears: Math.max(0, (service.s.stats?.[id] || 0) - wins),
    deep: { name: deep.name, energy: deep.energy, unlocked: !!access.ok, lockReason: access.ok ? '' : access.error || '입장 조건을 확인해 주세요.',
      wins, firstRewardPending: wins === 0, firstRewards: structuredClone(deep.firstRewards) },
  };
}

/** 카드 한 줄 상태 문구. 받은 적 없는 보상을 받은 것처럼 쓰지 않는다. */
export function conceptLoopStatus(card) {
  const deep = card.deep;
  const deepText = deep.wins ? `심층 ${deep.wins}회 정복 · 첫 정복 보상 받음`
    : deep.unlocked ? '심층 열림 · 첫 정복 보상 대기' : `심층 잠김 · ${deep.lockReason}`;
  return `기본 클리어 ${card.clears}회 · ${deepText}`;
}

/**
 * 결과 화면의 기본 행동 '다음 도전'. 실제로 끝낸 경로·단계와 현재 해금 판정만 읽는다.
 * 기본 승리: 심층이 열려 있으면 심층 카드(출격 전 확인)로, 아니면 같은 기본 원정 재도전 + 실제 잠김 사유.
 * 심층 승리: 같은 심층 재도전. 패배·저장 실패·균열·전술 공략·다른 경로는 기존 버튼만 쓴다(null).
 * @param {{ s: any, dungeonAccess: (id: string, options: { depth: string }) => { ok: boolean, error?: string|null } }} service
 * @param {{ win?: boolean, saveError?: string|null, kind?: string, id?: string, depth?: string, riftId?: string|null, conquestId?: string|null }} result
 */
export function conceptNextChallenge(service, result) {
  if (!result?.win || result.saveError || result.kind !== 'dungeon' || result.riftId || result.conquestId || !isConceptLoopRoute(result.id)) return null;
  const id = /** @type {string} */ (result.id), dungeon = CONCEPT_DUNGEONS.find(entry => entry.id === id), deep = expeditionDepth(id);
  const access = service.dungeonAccess(id, { depth: 'deep' }), wins = service.s.depthWins?.[id] || 0;
  const lockReason = access.ok ? '' : access.error || '입장 조건을 확인해 주세요.';
  if (result.depth === 'deep') {
    return { action: 'retry', id, depth: 'deep', energy: deep.energy, label: '다음 도전 · 심층 재도전',
      detail: wins ? `심층 ${wins}회 정복 · 첫 정복 보상 받음 · 반복 보상만 지급` : '첫 정복 보상 대기', lockReason };
  }
  if (result.depth !== 'standard' && result.depth !== undefined) return null;
  if (access.ok) {
    return { action: 'deep-prep', id, depth: 'deep', energy: deep.energy, label: '다음 도전 · 심층 원정 준비',
      detail: `${deep.name} · 에너지 ${deep.energy}${wins ? ` · ${wins}회 정복` : ' · 첫 정복 보상 대기'}`, lockReason: '' };
  }
  return { action: 'retry', id, depth: 'standard', energy: dungeon.energy, label: '다음 도전 · 다시 도전',
    detail: `심층 잠김 · ${lockReason}`, lockReason };
}
