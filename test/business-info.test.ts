import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import { BUSINESS_INFO as B } from '../src/shared/business-info.js';
import { businessInfoHtml } from '../src/ui/legal-links.js';

const pages = ['privacy', 'terms', 'refund', 'support', 'odds'];
const values = Object.values(B);

describe('사업자 정보 정본', () => {
  it('데이터는 동결되어 있다', () => { expect(Object.isFrozen(B)).toBe(true); });
  for (const p of pages) {
    it(`public/${p}.html 푸터에 모든 값이 있다`, () => {
      const html = readFileSync(`public/${p}.html`, 'utf8');
      for (const v of values) expect(html, `${p}: ${v}`).toContain(v);
    });
  }
  it('인게임 렌더에 모든 값이 들어간다', () => {
    const out = businessInfoHtml();
    for (const v of [B.representative, B.registrationNo, B.mailOrderNo, B.address, B.email, B.phone]) expect(out).toContain(v);
    expect(out).toContain('<details');
  });
});
