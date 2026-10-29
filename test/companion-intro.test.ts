import { expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { INTRO_DELAY_SEC, INTRO_SHOW_SEC, introPhase, pauseSummary, NEB_ROLE, NEB_ROUTE, CompanionPresence } from '../src/ui/companion-intro.js';

test('소개 카드: 이미 봤으면 뜨지 않고, 처음이면 1.5초 뒤 6초간 보인 뒤 끝난다', () => {
  expect(introPhase(true, 3)).toBe('none');
  expect(introPhase(false, 0)).toBe('wait');
  expect(introPhase(false, INTRO_DELAY_SEC - 0.01)).toBe('wait');
  expect(introPhase(false, INTRO_DELAY_SEC)).toBe('show');
  expect(introPhase(false, INTRO_DELAY_SEC + INTRO_SHOW_SEC - 0.01)).toBe('show');
  expect(introPhase(false, INTRO_DELAY_SEC + INTRO_SHOW_SEC)).toBe('done');
});

test('일시정지 요약: 역할·획득 경로·현재 전술을 담고 가격·상품 표현이 없다', () => {
  const text = pauseSummary('guard');
  expect(text).toContain('네브');
  expect(text).toContain('수호');
  expect(text).toContain(NEB_ROLE);
  expect(text).toContain(NEB_ROUTE);
  expect(pauseSummary('unknown')).toContain('몰이');
  expect(NEB_ROUTE).toContain('무료');
  expect(text).not.toMatch(/원\b|구매|결제|젬/);
});

test('소개 카드 본 기록은 설정에 저장되고 서버 소유 키가 아니다', async () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) } });
  const eco: any = new Economy();
  expect(eco.s.settings.companionIntroSeen).toBe(false);
  eco.s.settings.companionIntroSeen = true; eco.save();
  const reload: any = new Economy();
  expect(reload.s.settings.companionIntroSeen).toBe(true);
  const { SERVER_OWNED_KEYS } = await import('../src/shared/state-hash.js');
  expect((SERVER_OWNED_KEYS as readonly string[]).includes('settings')).toBe(false);
});

test('띄운 카드는 저장된 본 기록이 바로 true 가 돼도 6초 뒤 닫힌다(리뷰 P2)', () => {
  let seen = false, shown = 0, hidden = 0;
  const fake: any = { elapsed: 0, cardState: 'idle', getSeen: () => seen, markSeen: () => { seen = true; }, showCard: () => { shown++; }, hideCard: () => { hidden++; } };
  for (let t = 0; t < 10; t += 0.1) CompanionPresence.prototype.updateCard.call(fake, 0.1);
  expect(shown).toBe(1); expect(hidden).toBe(1); expect(fake.cardState).toBe('done');
});
