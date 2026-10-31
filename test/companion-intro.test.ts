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

test('소개 카드 자리: 주인공 둘레·HUD와 겹치는 후보는 건너뛰고, 맞는 자리가 없으면 null', async () => {
  const { pickCardSlot, rectHitsCircle } = await import('../src/ui/companion-intro.js');
  // 세로 390x700: 왼쪽 띠(가운데까지 넘어옴)는 주인공 둘레(195,343,r86)에 닿고 위쪽 띠는 비켜 간다.
  const side = { left: 64, top: 300, width: 150, height: 180 };
  const top = { left: 14, top: 150, width: 270, height: 70 };
  const hero = { x: 195, y: 343, r: 86 };
  expect(rectHitsCircle({ left: 64, top: 300, right: 214, bottom: 480 }, hero.x, hero.y, hero.r)).toBe(true);
  expect(pickCardSlot([side, top], [], hero, 390, 700)).toBe(top);
  // HUD와 겹치면 건너뛴다.
  expect(pickCardSlot([top], [{ left: 200, top: 140, right: 300, bottom: 200 }], hero, 390, 700)).toBeNull();
  // 화면 밖이면 건너뛴다.
  expect(pickCardSlot([{ left: 300, top: 150, width: 200, height: 60 }], [], null, 390, 700)).toBeNull();
});

test('띄울 자리가 없으면(showCard false) 카드를 띄우지 않고 본 기록도 남기지 않는다', () => {
  let seen = false, hidden = 0;
  const fake: any = { elapsed: 0, cardState: 'idle', getSeen: () => seen, markSeen: () => { seen = true; }, showCard: () => false, hideCard: () => { hidden++; } };
  for (let t = 0; t < 10; t += 0.1) CompanionPresence.prototype.updateCard.call(fake, 0.1);
  expect(seen).toBe(false); expect(fake.cardState).toBe('done');
});
