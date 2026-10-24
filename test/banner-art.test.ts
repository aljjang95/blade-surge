import { describe, expect, test } from 'bun:test';
import { HERO_BANNER_ART, BEGINNER_BANNER_ART, heroBannerArt, beginnerBannerArt } from '../src/data/banner-art.js';

describe('소환 배너 일러스트 규칙', () => {
  test('치비 배너가 없으면 지금 방식(barbarian은 3D 렌더, 그 밖은 초상)', () => {
    expect(heroBannerArt('barbarian', '/p/b.webp')).toEqual({ src: '/img/banner_featured.webp', kind: 'fallback' });
    expect(heroBannerArt('mage', '/p/m.webp')).toEqual({ src: '/p/m.webp', kind: 'fallback' });
    expect(heroBannerArt('mage')).toEqual({ src: '/img/banner_featured.webp', kind: 'fallback' });
    expect(heroBannerArt('toString', '/p/x.webp').kind).toBe('fallback');
  });
  test('치비 배너가 있으면 그것을 쓴다(초보자는 인자로 주입해 규칙 확인)', () => {
    expect(Object.isFrozen(HERO_BANNER_ART)).toBe(true);
    expect(beginnerBannerArt('/p/k.webp', '/img/tll/banners/knight-chibi-v1.webp')).toEqual({ src: '/img/tll/banners/knight-chibi-v1.webp', kind: 'chibi' });
  });
  test('초보자 배너: 치비 없으면 대체 초상, 초상도 없으면 3D 렌더', () => {
    expect(BEGINNER_BANNER_ART).toBeNull();
    expect(beginnerBannerArt('/p/k.webp')).toEqual({ src: '/p/k.webp', kind: 'fallback' });
    expect(beginnerBannerArt('')).toEqual({ src: '/img/banner_featured.webp', kind: 'fallback' });
  });
  test('등록된 경로는 /img/tll/banners/<id>-chibi-v1.webp 형식이다', () => {
    for (const [id, src] of Object.entries(HERO_BANNER_ART)) {
      expect(src).toBe(`/img/tll/banners/${id}-chibi-v1.webp`);
      expect(heroBannerArt(id, '/p/x.webp')).toEqual({ src, kind: 'chibi' });
    }
    if (BEGINNER_BANNER_ART) expect(BEGINNER_BANNER_ART).toMatch(/^\/img\/tll\/banners\/[a-z0-9_-]+-chibi-v1\.webp$/);
  });
});
