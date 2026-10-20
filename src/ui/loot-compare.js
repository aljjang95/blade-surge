// 새로 얻은 장비의 현재 장착 대비 비교와 'NEW' 표시. 저장 스키마를 바꾸지 않고, NEW 는 세션 메모리에만 둔다(새로고침하면 사라진다).
import { ITEM_BY_ID, RARITY_INFO } from '../data/items.js';

const fresh = new Set();
/** 이번 세션에서 새로 얻은 장비 uid 를 NEW 로 표시한다. */
export function markFresh(uids) { for (const uid of uids || []) if (Number.isInteger(uid)) fresh.add(uid); }
/** 전투 시작 시점의 invSeq 이후 인벤토리에 들어온 장비(결과 카드에 없는 전투 중 직접 획득 포함)를 NEW 로 표시한다. */
export function markFreshSince(eco, invSeqAtStart) {
  if (!Number.isInteger(invSeqAtStart)) return;
  markFresh((eco?.s?.inventory || []).filter((inst) => inst.uid >= invSeqAtStart).map((inst) => inst.uid));
}
export function isFresh(uid) { return fresh.has(uid); }
/** 장비를 열어 보면 NEW 를 끈다. */
export function clearFresh(uid) { fresh.delete(uid); }
export function freshCount() { return fresh.size; }
export function resetFresh() { fresh.clear(); }

const fmt = (n) => Number(n).toLocaleString('ko-KR');

/**
 * 장비 uid 를 heroId 가 지금 장착한 장비와 비교한다.
 * @returns {{ verdict: 'better'|'worse'|'same'|'equipped'|'none', powerDelta: number, sell: number } | null}
 */
export function compareLoot(eco, heroId, uid) {
  const inst = eco.s.inventory.find((x) => x.uid === uid), def = inst && ITEM_BY_ID[inst.id];
  if (!def) return null;
  const sell = RARITY_INFO[def.rarity]?.sell || 200;
  const p = eco.previewItem(heroId, uid);
  if (!p) return { verdict: 'none', powerDelta: 0, sell };
  if (p.remove) return { verdict: 'equipped', powerDelta: 0, sell };
  const powerDelta = Math.round(p.after.power - p.before.power);
  return { verdict: powerDelta > 0 ? 'better' : powerDelta < 0 ? 'worse' : 'same', powerDelta, sell };
}

/** 카드에 붙는 짧은 문구와 접근성 설명. */
export function compareText(cmp) {
  if (!cmp) return { short: '', long: '' };
  if (cmp.verdict === 'better') return { short: '▲ 장착 추천', long: '현재 장비보다 전투력 +' + fmt(cmp.powerDelta) + ' · 장착 추천' };
  if (cmp.verdict === 'equipped') return { short: '장착 중', long: '이미 장착 중인 장비' };
  if (cmp.verdict === 'worse') return { short: '판매 ' + fmt(cmp.sell), long: '현재 장비가 더 좋습니다 (전투력 ' + fmt(cmp.powerDelta) + ') · 판매가 ' + fmt(cmp.sell) + ' 골드' };
  return { short: '판매 ' + fmt(cmp.sell), long: '전투력 변화 없음 · 판매가 ' + fmt(cmp.sell) + ' 골드' };
}
