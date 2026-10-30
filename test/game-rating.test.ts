import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { GAME_RATING, ratingLabel } from '../src/data/game-rating.js';
import { SOCIAL_CONFIG } from '../src/social/config.js';
import { maskBanned, filterChat } from '../packages/tll-social/src/shared/filter';

test('등급분류 전에는 연령·등급 마크를 표시하지 않는다', () => {
  expect(GAME_RATING.status).not.toBe('rated');
  const label = ratingLabel();
  expect(label).not.toMatch(/이용가|이용불가|\d+세/);
  expect(ratingLabel({ status: 'reviewing', age: null, number: null, date: null, descriptors: [] })).toBe('게임물 등급분류 심의 중');
});

test('등급 결정 뒤에는 결정서의 등급·내용정보·번호를 그대로 보인다', () => {
  const label = ratingLabel({ status: 'rated', age: '15', number: 'CC-OM-261100-001', date: '2026-11-20', descriptors: ['폭력성', '사행성'] });
  expect(label).toBe('15세이용가 · 폭력성·사행성 · 등급분류번호 CC-OM-261100-001');
  // 결정됐다고 적었는데 연령이 없으면 등급을 지어내지 않는다
  expect(ratingLabel({ status: 'rated', age: null, number: null, date: null, descriptors: [] })).toBe('게임물 등급분류 신청 준비 중');
});

test('부팅 화면의 정적 문구가 정본 문구와 같다(JS 로딩 전에도 같은 표시)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const m = html.match(/<p id="boot-rating"[^>]*>([^<]*)<\/p>/);
  expect(m?.[1]).toBe(ratingLabel());
});

test('게임 금칙어가 채팅에서 가려지고 일상 문장은 건드리지 않는다', () => {
  const extra = SOCIAL_CONFIG.bannedWords;
  expect(extra.length).toBeGreaterThan(20);
  expect(filterChat('야 ㅅ.ㅂ 지랄하네', extra)).not.toMatch(/ㅅ\.ㅂ|지랄/);
  expect(maskBanned('니애미', extra)).toBe('***');
  for (const ok of ['보스 보지 말고 피해', '오늘 자지 말고 레이드 가자', '시바견 귀엽다', '미친 데미지네', '애비게일', 'Dickens', '졸라맨', '불이 꺼져요', '닥쳐올 위기', '섹스턴', '개새싹', 'Scunthorpe']) expect(maskBanned(ok, extra)).toBe(ok);
});
