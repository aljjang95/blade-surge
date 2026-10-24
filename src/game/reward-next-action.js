// 결과 화면의 "이 보상으로 지금 할 것" 한 가지를 고른다. 순수 함수: 저장도 소비도 하지 않는다.
// 목적지는 게임 재화(보석·소환권·강화석·패스)를 쓰는 화면뿐이다. 상점·결제 화면은 어떤 경우에도 고르지 않는다.
import { GACHA_BANNERS } from '../data/gacha-banners.js';
import { growthOptions } from './growth-options.js';

const earned = (got, keys) => (got || []).reduce((sum, g) => sum + (keys.includes(g?.k) && g.n > 0 ? g.n : 0), 0);
const num = n => Number(n).toLocaleString('ko-KR');

/** 지금 보유 재화로 살 수 있는 소환 배너. 영웅 픽업 → 초보자(10회) → 장비 순. 견적은 경제 규칙(pullQuote)만 따른다. */
function affordableSummon(eco) {
  for (const id of ['hero', 'beginner', 'gear']) {
    const n = id === 'beginner' ? 10 : 1, q = eco.pullQuote?.(n, id);
    if (!q?.ok) continue;
    const name = GACHA_BANNERS[id].name, cost = q.currency === 'tickets' ? `소환권 ${num(q.tickets)}` : `보석 ${num(q.cost)}`;
    return { banner: id, tickets: q.currency === 'tickets', hint: `${cost} → ${name} ${n}회` };
  }
  return null;
}

/** 지금 보유 골드·강화석으로 확정 성공(100%)하는 장착 장비 강화 하나. 선택 영웅을 먼저 본다. */
function enhanceable(eco) {
  const s = eco.s, owned = s.roster?.owned;
  const ids = [s.selected, ...Object.keys(s.heroes || {}).filter(id => id !== s.selected)]
    .filter(id => s.heroes?.[id] && (!owned || owned.includes(id)));
  for (const heroId of ids) {
    const o = growthOptions({ ...s, selected: heroId }).find(x => x.kind === 'equipment' && x.mode !== 'equip');
    if (o) return { heroId, uid: o.uid, name: o.name, from: o.from, to: o.to };
  }
  return null;
}

/**
 * @param {{mode:'campaign'|'tower'|'dungeon'|'arena', got?:{k:string,n:number}[], eco:any}} input
 * @returns {null|{id:'summon'|'enhance'|'chest'|'pass', label:string, hint:string, target:{tab:string, banner?:string, heroId?:string, uid?:number, journeyTab?:string}}}
 */
export function rewardNextAction({ mode, got, eco }) {
  if (!eco?.s) return null;
  const gems = earned(got, ['gems']), tickets = earned(got, ['tickets']), stones = earned(got, ['stones', 'stones2', 'stones3']);
  const summon = () => { const a = affordableSummon(eco); return a && { id: 'summon', label: a.tickets ? '소환권으로 소환하기' : '보석으로 소환하기', hint: a.hint, target: { tab: 'gacha', banner: a.banner } }; };
  const enhance = () => { const a = enhanceable(eco); return a && { id: 'enhance', label: '강화석으로 장비 강화', hint: `${a.name} +${a.from} → +${a.to} 강화 가능`, target: { tab: 'heroes', heroId: a.heroId, uid: a.uid } }; };
  const chest = () => eco.towerSummary?.().chest?.ready ? { id: 'chest', label: '주간 보급 받기', hint: '이번 주 무한의 성 보급 상자 수령 가능', target: { tab: 'journey', journeyTab: 'tower' } } : null;
  const pass = () => { const n = eco.passClaimable?.() || 0; return n > 0 ? { id: 'pass', label: '패스 보상 받기', hint: `받을 수 있는 패스 보상 ${num(n)}개`, target: { tab: 'pass' } } : null; };
  const primary = mode === 'campaign' || mode === 'tower' ? (gems + tickets > 0 ? summon : null)
    : stones > 0 ? enhance : null;
  const rest = mode === 'campaign' || mode === 'tower' ? [chest, pass, enhance] : [chest, pass, summon];
  for (const pick of [primary, ...rest]) { const a = pick?.(); if (a) return a; }
  return null;
}
