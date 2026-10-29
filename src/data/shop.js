import { GACHA_BANNERS } from './gacha-banners.js';
// 상점 SKU. kind:'gem'은 보석 소비 상품(게임 내 거래), kind:'cash'는 카탈로그(src/shared/iap-catalog.js)의 shopSku와 짝지어진 현금 상품이다.
// 현금 상품은 서버 카탈로그에서 판매 중(enabled)이고 스토어가 가격을 돌려줄 때만 상점에 보인다. 가격은 스토어의 formattedPrice만 표시하며 여기에는 적지 않는다(price는 내부 분석용 참고값).
export const SHOP_TABS = [
  { id: 'hot', name: '추천' },
  { id: 'gem', name: '보석' },
  { id: 'pack', name: '패키지' },
  { id: 'enh', name: '강화' },
  { id: 'gold', name: '골드' },
  { id: 'energy', name: '에너지' },
];

export const SKUS = [
  // ---- 추천/패키지 (한정) ----
  { id: 'starter', tab: 'hot', kind: 'cash', name: '스타터 팩', price: 1200, icon: '/img/icon_chest_legend.webp', badge: '92% 할인', limited: true, hours: 24, once: true,
    desc: 'SSR 확정 소환권 1 · 보석 1,000 · 골드 50,000', rewards: { gems: 1000, gold: 50000, ssrTicket: 1 } },
  { id: 'monthly', tab: 'hot', kind: 'cash', name: '월정액 카드', price: 5900, icon: '/img/icon_gem.webp', badge: 'BEST',
    desc: '즉시 보석 1,200 + 30일간 매일 보석 100 (총 4,200)', rewards: { gems: 1200, monthly: 30 } },
  // 가격 문구는 Play가 돌려준 값으로 덮어쓴다(priceLabel 없음). 카탈로그 밖·비활성이면 상점에 나오지 않는다.
  { id: 'remove_ads', tab: 'hot', kind: 'cash', name: '광고 제거', price: 4900, icon: '/img/icon_protect.webp',
    desc: '전면 광고를 영구히 끕니다 (계정 단위, 기기를 바꿔도 복원)', rewards: {} },
  { id: 'growth', tab: 'pack', kind: 'cash', name: '성장 패키지', price: 12000, icon: '/img/icon_chest_epic.webp', badge: '인기',
    once: true,
    desc: '보석 2,400 · 골드 200,000 · 초월석 5 · 강화석 100 (계정당 1회)', rewards: { gems: 2400, gold: 200000, transcendStones: 5, stones: 100 } },

  // ---- 보석 ----
  { id: 'gem1', tab: 'gem', kind: 'cash', name: '보석 300',   price: 3900,   icon: '/img/icon_gem.webp', gems: 300,   bonus: 1500 },
  { id: 'gem2', tab: 'gem', kind: 'cash', name: '보석 980',   price: 12000,  icon: '/img/icon_gem.webp', gems: 980,   bonus: 980 },
  { id: 'gem3', tab: 'gem', kind: 'cash', name: '보석 1,980', price: 25000,  icon: '/img/icon_gem.webp', gems: 1980,  bonus: 1980, badge: '인기' },

  // ---- 강화 재료 (과금 핵심) ----
  { id: 'skill_reset1', tab: 'enh', kind: 'gem', name: '스킬 초기화서', price: 300, icon: '/img/icon_protect.webp', desc: '스킬 초기화서 ×1 · 투자 SP 반환', rewards: { skillResets: 1 } },
  { id: 'skill_reset5', tab: 'enh', kind: 'gem', name: '스킬 초기화서 ×5', price: 1250, icon: '/img/icon_protect.webp', desc: '스킬 초기화서 ×5 · 투자 SP 반환', rewards: { skillResets: 5 }, badge: '묶음 할인' },
  { id: 'tstone10', tab: 'enh', kind: 'gem', name: '초월석 ×10', price: 900, icon: '/img/icon_stone_3.webp', desc: '초월석 ×10 · SSR/SSSR 초월 성장 재료', rewards: { transcendStones: 10 } },
  { id: 'stone1', tab: 'enh', kind: 'gem', name: '강화석 10', price: 150, icon: '/img/icon_stone_1.webp', desc: '강화석 ×10', rewards: { stones: 10 } },
  { id: 'stone2', tab: 'enh', kind: 'gem', name: '강화석 60', price: 720, icon: '/img/icon_stone_1.webp', desc: '강화석 ×60', rewards: { stones: 60 }, badge: '+20%' },
  { id: 'stone_hi', tab: 'enh', kind: 'gem', name: '상급 강화석 10', price: 480, icon: '/img/icon_stone_2.webp', desc: '상급 강화석 ×10 (+10~+14 강화용)', rewards: { stones2: 10 } },
  { id: 'stone_legend', tab: 'enh', kind: 'gem', name: '전설 강화석 3', price: 900, icon: '/img/icon_stone_3.webp', desc: '전설 강화석 ×3 (+15 이상 강화용)', rewards: { stones3: 3 } },
  { id: 'protect1', tab: 'enh', kind: 'gem', name: '보호 주문서', price: 300, icon: '/img/icon_protect.webp', desc: '강화 실패 시 파괴 방지 ×1', rewards: { protect: 1 } },
  { id: 'protect5', tab: 'enh', kind: 'gem', name: '보호 주문서 ×5', price: 1250, icon: '/img/icon_protect.webp', desc: '파괴 방지 ×5', rewards: { protect: 5 }, badge: '인기' },
  { id: 'bless1', tab: 'enh', kind: 'gem', name: '축복 주문서', price: 200, icon: '/img/icon_bless.webp', desc: '강화 성공률 +20% ×1', rewards: { bless: 1 } },

  // ---- 골드 (보석 소모) ----
  { id: 'gold1', tab: 'gold', kind: 'gem', name: '골드 주머니', price: 100,  icon: '/img/icon_gold.webp', desc: '골드 20,000', rewards: { gold: 20000 } },
  { id: 'gold2', tab: 'gold', kind: 'gem', name: '골드 상자',   price: 450,  icon: '/img/icon_gold.webp', desc: '골드 100,000', rewards: { gold: 100000 }, badge: '+10%' },
  { id: 'gold3', tab: 'gold', kind: 'gem', name: '골드 금고',   price: 1800, icon: '/img/icon_gold.webp', desc: '골드 500,000', rewards: { gold: 500000 }, badge: '+25%' },

  // ---- 에너지 ----
  { id: 'en1', tab: 'energy', kind: 'gem', name: '에너지 60',  price: 60,  icon: '/img/icon_energy.webp', desc: '즉시 에너지 60 회복', rewards: { energy: 60 } },
  { id: 'en2', tab: 'energy', kind: 'gem', name: '에너지 120', price: 100, icon: '/img/icon_energy.webp', desc: '즉시 에너지 120 회복', rewards: { energy: 120 }, badge: '+20%' },
];

// 영웅 소환 배너 요약(옛 호출부 호환). 정본은 gacha-banners.js의 GACHA_BANNERS.hero이며 픽업은 교대표(heroPickup)로 정한다.
// featured는 교대표가 비었을 때의 기본 픽업. SSR은 전부 영웅(픽업 50% · 다른 SSR 50%, 픽업 실패 뒤 다음 SSR 픽업 확정).
// 확정권 중복도 같은 지급 경로를 탄다. 40조각으로 장기 초월 재료의 체감 가치를 보장한다.
const HERO_BANNER = GACHA_BANNERS.hero;
export const GACHA = { single: HERO_BANNER.single, ten: HERO_BANNER.ten, pity: HERO_BANNER.pity, softPity: HERO_BANNER.softPity, softPityStep: HERO_BANNER.softPityStep,
  featured: 'barbarian', rates: HERO_BANNER.rates,
  ssrSplit: { featured: HERO_BANNER.ssr.featured, pool: 1 - HERO_BANNER.ssr.featured, gear: 0 }, srSplit: { hero: HERO_BANNER.sr.hero, gear: 0 }, rSplit: { gear: 0 },
  materials: HERO_BANNER.materials, dupShards: 40 };
export const BATTLE_PASS = { price: 9900, maxLevel: 30, xpPerLevel: 100 };
export const ENERGY = { max: 100, regenSec: 180 };

export const DAILY_REWARDS = [
  { gold: 5000 }, { gems: 100 }, { tickets: 1, skillResets: 1 }, { gold: 15000 }, { gems: 200 }, { tickets: 2 }, { tickets: 5 },
];

export const PASS_TRACK = Array.from({ length: 30 }, (_, i) => {
  const lv = i + 1;
  const free = lv % 5 === 0 ? { gems: 100 } : (lv % 2 ? { gold: 4000 * lv } : { tickets: 1 });
  const prem = lv % 10 === 0 ? { ssrTicket: 1 } : (lv % 5 === 0 ? { gems: 500 } : (lv % 2 ? { gems: 120 } : { tickets: 2 }));
  // 계승 문장(docs/GEAR_VAULT_INHERIT.md): 콘텐츠 보상 소량만 — 무료 트랙 10·20·30레벨에 1개씩. 프리미엄 트랙·상점·IAP 에는 넣지 않는다(현금 판매 금지).
  if (lv % 10 === 0) free.lineageSigil = 1;
  if ([5, 15, 25].includes(lv)) prem.transcendStones = 5;
  if ([8, 18, 28].includes(lv)) prem.skillResets = 1;
  return { lv, free, prem };
});
