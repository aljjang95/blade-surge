import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderOddsPage } from '../tools/gen-odds-page.mjs';

// KG이니시스 심사용 공개 법적 페이지(약관·환불·확률) 점검.
const read = (name: string) => readFileSync(new URL(`../public/${name}.html`, import.meta.url), 'utf8');
const PAGES = ['terms', 'refund', 'odds'] as const;

test('세 페이지가 존재하고 비어 있지 않다', () => {
  for (const p of PAGES) expect(read(p).length).toBeGreaterThan(500);
});

test('"환불 불가" 문구가 어느 공개 페이지에도 없다', () => {
  for (const p of [...PAGES, 'privacy', 'support']) {
    const t = read(p).replace(/\s+/g, '');
    expect(t.includes('환불불가')).toBe(false);
  }
});

test('7일 청약철회 문구가 약관과 환불 정책에 있다', () => {
  for (const p of ['terms', 'refund']) expect(read(p)).toContain('7일 이내');
  expect(read('refund')).toContain('청약철회');
});

test('세 페이지 모두 사업자 정보 푸터 6항목이 있다', () => {
  const labels = ['상호', '대표자', '사업자등록번호', '통신판매업 신고번호', '주소', '연락처(이메일)'];
  for (const p of PAGES) {
    const html = read(p);
    for (const l of labels) expect(html).toContain(`<li>${l}:`);
    // 사업자 정보는 Drive 정본(사업자 정보 — 더 럭셔리 로드)과 같아야 하고 빈칸이 남으면 안 된다.
    expect(html).not.toContain('{{');
    expect(html).toContain('849-09-03410');
    expect(html).toContain('제2026-충남서산-0101호');
  }
});

test('세 페이지가 서로 링크한다', () => {
  const links: Record<string, string[]> = {
    terms: ['/refund.html', '/privacy.html', '/support.html', '/odds.html'],
    refund: ['/terms.html', '/privacy.html', '/support.html', '/odds.html'],
    odds: ['/terms.html', '/refund.html', '/privacy.html', '/support.html'],
  };
  for (const p of PAGES) for (const l of links[p]) expect(read(p)).toContain(`href="${l}"`);
});

test('환불 정책에 가격 숫자가 없고 7일 이후 공제 상한이 적혀 있다', () => {
  const html = read('refund');
  expect(html).toContain('가격은 구매 화면에 표시');
  expect(html).toContain('결제금액의 10% 이내');
  expect(/[0-9,]+\s*원/.test(html)).toBe(false);
});

test('odds.html은 생성기 출력과 같다(node tools/gen-odds-page.mjs 로 재생성)', () => {
  expect(read('odds')).toBe(renderOddsPage());
});

test('개인정보·고객센터 페이지에도 사업자 정보 푸터가 있다(KG 심사: 사이트 전 페이지 사업자 표기)', () => {
  for (const name of ['privacy', 'support']) {
    const html = readFileSync(new URL(`../public/${name}.html`, import.meta.url), 'utf8');
    expect(html).toContain('849-09-03410');
    expect(html).toContain('제2026-충남서산-0101호');
  }
});
