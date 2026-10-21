// 소환 연출 계획(표시 전용). 결과·확률·재화 로직은 건드리지 않고, 이미 정해진 결과를 어떻게 보여 줄지만 정한다.
const TONES = Object.freeze({
  R: Object.freeze({ color: '#4cc3ff', beams: 2, charge: 800 }),
  SR: Object.freeze({ color: '#b26bff', beams: 4, charge: 1200 }),
  SSR: Object.freeze({ color: '#ffcf5a', beams: 7, charge: 1800 }),
});
const RANK = Object.freeze({ R: 0, SR: 1, SSR: 2 });
/** 한 장당 뒤집는 간격(ms). 짧게 이어 넘겨 10회도 3초 안에 끝난다. */
const FLIP_STEP = 150;
/** 높은 등급 카드 앞에 두는 뜸(ms). */
const HOLD_BEFORE = Object.freeze({ R: 0, SR: 220, SSR: 520 });
/** 뒤집기 직전 카드 뒷면이 해당 등급 색으로 빛나는 시간(ms). */
const HINT_LEAD = 480;

/** 결과 중 가장 높은 등급. 알 수 없는 등급은 R로 본다. */
export function bestRarity(results) {
  let best = 'R';
  for (const r of results || []) if ((RANK[r?.rar] ?? 0) > RANK[best]) best = r.rar;
  return best;
}
/** 등급별 연출 색·빔 수·충전 시간. */
export function revealTone(rar) { return TONES[rar] || TONES.R; }

/**
 * 카드별 뒤집기 시점. 낮은 등급부터 짧게 넘기고 SR·SSR은 뜸을 두고 마지막에 뒤집어 기대감을 키운다.
 * 반환 배열은 입력 순서(그리드 위치)를 그대로 따른다.
 * @param {ReadonlyArray<{rar?: string}>} results
 */
export function revealPlan(results) {
  const list = results || [];
  const best = bestRarity(list), tone = revealTone(best);
  const order = list.map((r, i) => i).sort((a, b) => (RANK[list[a]?.rar] ?? 0) - (RANK[list[b]?.rar] ?? 0) || a - b);
  const cards = new Array(list.length);
  let t = tone.charge + 300;
  for (const i of order) {
    const rar = RANK[list[i]?.rar] === undefined ? 'R' : list[i].rar;
    t += HOLD_BEFORE[rar];
    cards[i] = Object.freeze({ rar, at: t, hintAt: rar === 'R' ? null : Math.max(0, t - HINT_LEAD) });
    t += FLIP_STEP;
  }
  return Object.freeze({ best, tone, cards, doneAt: list.length ? t : 0 });
}

/**
 * 다시 소환 버튼 안내. 재화가 모자라면 얼마가 부족한지 알려 준다(티켓 10장이면 티켓으로 소환).
 * @param {{gems:number, tickets:number}} wallet @param {{ten:number}} gacha
 */
export function tenPullStatus(wallet, gacha) {
  const gems = wallet?.gems || 0, tickets = wallet?.tickets || 0, cost = gacha.ten;
  if (tickets >= 10) return { ok: true, useTicket: true, need: 0, label: '티켓 10장' };
  if (gems >= cost) return { ok: true, useTicket: false, need: 0, label: String(cost) };
  return { ok: false, useTicket: false, need: cost - gems, label: String(cost) };
}
