import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { GAME_RATING, WEB_ONESTORE_IARC, ratingLabel, ratingReady, webRatingFromOnestoreIarc } from '../src/data/game-rating.js';
import { renderGameInfoPage } from '../tools/gen-game-info-page.mjs';
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

test('채널별 등급: 웹=GRAC, Play=IARC 인증 ID, 원스토어=등급분류번호. 값이 없으면 준비 중', async () => {
  const { GAME_RATINGS, ratingFor, ratingReady } = await import('../src/data/game-rating.js');
  expect(ratingFor('web')).toBe(GAME_RATING);
  expect(ratingFor('unknown-channel')).toBe(GAME_RATING);
  for (const ch of ['googleplay', 'onestore']) {
    expect(ratingFor(ch)).toBe(GAME_RATINGS[ch]);
    expect(ratingLabel(ratingFor(ch))).toBe('게임물 등급분류 신청 준비 중');
    expect(ratingReady(ratingFor(ch))).toBe(false);
  }
  expect(ratingLabel({ authority: 'IARC', status: 'rated', age: '12', number: 'a1b2c3d4-iarc', date: null, descriptors: [] })).toBe('12세이용가 · IARC 인증 ID a1b2c3d4-iarc');
  expect(ratingLabel({ authority: 'ONESTORE', status: 'rated', age: '15', number: 'OS-2026-0001', date: null, descriptors: [] })).toBe('15세이용가 · 등급분류번호 OS-2026-0001');
  // 결제 게이트용: 결정+연령+번호가 모두 있어야 준비됨
  expect(ratingReady(GAME_RATING)).toBe(false);
  expect(ratingReady({ status: 'rated', age: '15', number: ' ', date: null, descriptors: [] })).toBe(false);
  expect(ratingReady({ status: 'rated', age: '15', number: 'CC-1', date: null, descriptors: [] })).toBe(true);
});

test('웹 등급은 원스토어 IARC 결과: 값이 없으면 게이트 닫힘·준비 중, 채우면 열림·표시 문구 일치', () => {
  // 지금 정본은 비어 있다(원스토어 앱 등록·IARC 설문 대기)
  expect(WEB_ONESTORE_IARC.certId).toBeNull();
  expect(GAME_RATING.source).toBe('onestore-iarc');
  expect(ratingReady(GAME_RATING)).toBe(false);
  expect(ratingLabel(GAME_RATING)).toBe('게임물 등급분류 신청 준비 중');
  // 연령만 있거나 인증 ID만 있어도 닫힌다(등급을 지어내지 않는다)
  expect(ratingReady(webRatingFromOnestoreIarc({ age: '12', certId: null, date: null, descriptors: [] }))).toBe(false);
  expect(ratingReady(webRatingFromOnestoreIarc({ age: null, certId: 'abc', date: null, descriptors: [] }))).toBe(false);
  expect(ratingReady(webRatingFromOnestoreIarc({ age: '12', certId: '  ', date: null, descriptors: [] }))).toBe(false);
  const filled = webRatingFromOnestoreIarc({ age: '12', certId: '7b6a5e95-a731-8010-8150-3f8dc1e042f7', date: '2026-11-20', descriptors: ['폭력성'] });
  expect(ratingReady(filled)).toBe(true);
  expect(ratingLabel(filled)).toBe('12세이용가 · 폭력성 · 원스토어 IARC 인증 ID 7b6a5e95-a731-8010-8150-3f8dc1e042f7');
});

test('game-info 페이지: 비어 있으면 대기 안내, 채우면 인증 ID·발급일이 그대로 나오고 GRAC 번호가 아님을 밝힌다', () => {
  const empty = renderGameInfoPage();
  expect(empty).toContain('data-rating-status="preparing"');
  expect(empty).toContain('발급 후 기재');
  expect(empty).not.toMatch(/\d+세이용가|전체이용가/);
  const filled = renderGameInfoPage(webRatingFromOnestoreIarc({ age: '12', certId: 'CERT-1', date: '2026-11-20', descriptors: [] }));
  expect(filled).toContain('12세이용가 — 원스토어 IARC 대한민국 결과');
  expect(filled).toContain('CERT-1');
  expect(filled).toContain('2026-11-20');
  for (const h of [empty, filled]) { expect(h).toContain('직접 심사 번호가 아닙니다'); expect(h).toContain('href="/odds.html"'); }
});

test('공개 game-info.html 과 첫 화면 링크가 생성기·정본과 같다', () => {
  expect(readFileSync(new URL('../public/game-info.html', import.meta.url), 'utf8')).toBe(renderGameInfoPage());
  expect(readFileSync(new URL('../index.html', import.meta.url), 'utf8').split('href="/game-info.html"').length - 1).toBe(2);
});
