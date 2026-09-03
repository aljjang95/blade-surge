// 상점 SKU (전부 목업 — 실제 결제 없음)
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
  { id: 'starter', tab: 'hot', kind: 'cash', name: '스타터 팩', price: 1200, priceLabel: '₩1,200', icon: '/img/icon_chest_legend.webp', badge: '92% 할인', limited: true, hours: 24, once: true,
    desc: 'SSR 확정 소환권 1 · 보석 1,000 · 골드 50,000', rewards: { gems: 1000, gold: 50000, ssrTicket: 1 } },
  { id: 'monthly', tab: 'hot', kind: 'cash', name: '월정액 카드', price: 5900, priceLabel: '₩5,900', icon: '/img/icon_gem.webp', badge: 'BEST',
    desc: '즉시 보석 600 + 30일간 매일 보석 100 (총 3,600)', rewards: { gems: 600, monthly: 30 } },
  { id: 'growth', tab: 'pack', kind: 'cash', name: '성장 패키지', price: 12000, priceLabel: '₩12,000', icon: '/img/icon_chest_epic.webp', badge: '인기',
    desc: '보석 2,400 · 소환권 10 · 골드 200,000 · 강화석', rewards: { gems: 2400, tickets: 10, gold: 200000 } },
  { id: 'boss_pack', tab: 'pack', kind: 'cash', name: '해골 군주 토벌 패키지', price: 33000, priceLabel: '₩33,000', icon: '/img/icon_chest_legend.webp', badge: '한정', limited: true, hours: 72,
    desc: 'SSR 장비 선택 상자 · 보석 6,000 · 소환권 20', rewards: { gems: 6000, tickets: 20, ssrGear: 1 } },
  { id: 'vip_pass', tab: 'pack', kind: 'cash', name: 'VIP 멤버십 (30일)', price: 19000, priceLabel: '₩19,000', icon: '/img/icon_vip.webp',
    desc: '에너지 최대치 +50 · 골드 획득 +30% · 소탕 티켓 매일 5장', rewards: { vipDays: 30, gems: 1000 } },

  // ---- 보석 ----
  { id: 'gem1', tab: 'gem', kind: 'cash', name: '보석 300',   price: 3900,   priceLabel: '₩3,900',   icon: '/img/icon_gem.webp', gems: 300,   bonus: 300 },
  { id: 'gem2', tab: 'gem', kind: 'cash', name: '보석 980',   price: 12000,  priceLabel: '₩12,000',  icon: '/img/icon_gem.webp', gems: 980,   bonus: 980 },
  { id: 'gem3', tab: 'gem', kind: 'cash', name: '보석 1,980', price: 25000,  priceLabel: '₩25,000',  icon: '/img/icon_gem.webp', gems: 1980,  bonus: 1980, badge: '인기' },
  { id: 'gem4', tab: 'gem', kind: 'cash', name: '보석 3,280', price: 39000,  priceLabel: '₩39,000',  icon: '/img/icon_gem.webp', gems: 3280,  bonus: 3280 },
  { id: 'gem5', tab: 'gem', kind: 'cash', name: '보석 6,480', price: 79000,  priceLabel: '₩79,000',  icon: '/img/icon_gem.webp', gems: 6480,  bonus: 6480, badge: '최고 효율' },
  { id: 'gem6', tab: 'gem', kind: 'cash', name: '보석 12,000', price: 129000, priceLabel: '₩129,000', icon: '/img/icon_gem.webp', gems: 12000, bonus: 12000 },

  // ---- 강화 재료 (과금 핵심) ----
  { id: 'stone1', tab: 'enh', kind: 'gem', name: '강화석 10', price: 150, icon: '/img/icon_stone_1.webp', desc: '강화석 ×10', rewards: { stones: 10 } },
  { id: 'stone2', tab: 'enh', kind: 'gem', name: '강화석 60', price: 720, icon: '/img/icon_stone_1.webp', desc: '강화석 ×60', rewards: { stones: 60 }, badge: '+20%' },
  { id: 'stone_hi', tab: 'enh', kind: 'gem', name: '상급 강화석 10', price: 480, icon: '/img/icon_stone_2.webp', desc: '상급 강화석 ×10 (+10~+14 강화용)', rewards: { stones2: 10 } },
  { id: 'stone_legend', tab: 'enh', kind: 'gem', name: '전설 강화석 3', price: 900, icon: '/img/icon_stone_3.webp', desc: '전설 강화석 ×3 (+15 이상 강화용)', rewards: { stones3: 3 } },
  { id: 'protect1', tab: 'enh', kind: 'gem', name: '보호 주문서', price: 300, icon: '/img/icon_protect.webp', desc: '강화 실패 시 파괴 방지 ×1', rewards: { protect: 1 } },
  { id: 'protect5', tab: 'enh', kind: 'gem', name: '보호 주문서 ×5', price: 1250, icon: '/img/icon_protect.webp', desc: '파괴 방지 ×5', rewards: { protect: 5 }, badge: '인기' },
  { id: 'bless1', tab: 'enh', kind: 'gem', name: '축복 주문서', price: 200, icon: '/img/icon_bless.webp', desc: '강화 성공률 +20% ×1', rewards: { bless: 1 } },
  { id: 'enh_pack', tab: 'enh', kind: 'cash', name: '강화 마스터 패키지', price: 22000, priceLabel: '₩22,000', icon: '/img/icon_protect.webp', badge: '한정', limited: true, hours: 48,
    desc: '보호 주문서 10 · 축복 주문서 10 · 강화석 200 · 골드 300,000', rewards: { protect: 10, bless: 10, stones: 200, gold: 300000 } },

  // ---- 골드 (보석 소모) ----
  { id: 'gold1', tab: 'gold', kind: 'gem', name: '골드 주머니', price: 100,  icon: '/img/icon_gold.webp', desc: '골드 20,000', rewards: { gold: 20000 } },
  { id: 'gold2', tab: 'gold', kind: 'gem', name: '골드 상자',   price: 450,  icon: '/img/icon_gold.webp', desc: '골드 100,000', rewards: { gold: 100000 }, badge: '+10%' },
  { id: 'gold3', tab: 'gold', kind: 'gem', name: '골드 금고',   price: 1800, icon: '/img/icon_gold.webp', desc: '골드 500,000', rewards: { gold: 500000 }, badge: '+25%' },

  // ---- 에너지 ----
  { id: 'en1', tab: 'energy', kind: 'gem', name: '에너지 60',  price: 60,  icon: '/img/icon_energy.webp', desc: '즉시 에너지 60 회복', rewards: { energy: 60 } },
  { id: 'en2', tab: 'energy', kind: 'gem', name: '에너지 120', price: 100, icon: '/img/icon_energy.webp', desc: '즉시 에너지 120 회복', rewards: { energy: 120 }, badge: '+20%' },
];

export const GACHA = { single: 300, ten: 2700, pity: 80, softPity: 60, featured: 'barbarian', rates: { R: 86, SR: 12, SSR: 2 } };
export const BATTLE_PASS = { price: 9900, maxLevel: 30, xpPerLevel: 100 };
export const ENERGY = { max: 100, regenSec: 180 };

export const DAILY_REWARDS = [
  { gold: 5000 }, { gems: 100 }, { tickets: 1 }, { gold: 15000 }, { gems: 200 }, { tickets: 2 }, { ssrTicket: 1 },
];

export const PASS_TRACK = Array.from({ length: 30 }, (_, i) => {
  const lv = i + 1;
  const free = lv % 5 === 0 ? { gems: 100 } : (lv % 2 ? { gold: 4000 * lv } : { tickets: 1 });
  const prem = lv % 10 === 0 ? { ssrTicket: 1 } : (lv % 5 === 0 ? { gems: 500 } : (lv % 2 ? { gems: 120 } : { tickets: 2 }));
  return { lv, free, prem };
});
