// 소환 배너 일러스트 규칙. 치비 배너(16:9 가로 그림, 캐릭터는 가운데 40% 띠)가 있으면 그것을, 없으면 지금 방식을 쓴다.
// 파일은 /img/tll/banners/<id>-chibi-v1.webp 형식이며 다른 레인이 만든다. 만들어지면 아래 객체에 한 줄씩 추가한다.

/** 영웅 id → 치비 배너 일러스트 경로. 아직 없으면 비어 있다. */
export const HERO_BANNER_ART = Object.freeze({});

/** 초보자 배너 일러스트 경로(없으면 null). */
export const BEGINNER_BANNER_ART = null;

/** 치비 배너가 없을 때 쓰는 3D 렌더 대체 이미지. */
export const FALLBACK_BANNER_ART = '/img/banner_featured.webp';

/**
 * 영웅 배너 일러스트. 치비 배너가 있으면 { src, kind: 'chibi' }, 없으면 지금 방식
 * (픽업이 barbarian이면 3D 렌더 banner_featured, 아니면 초상, 초상도 없으면 banner_featured)의 { src, kind: 'fallback' }.
 * @param {string} id 영웅 id
 * @param {string} [portrait] 영웅 초상 경로(대체용)
 */
export function heroBannerArt(id, portrait) {
  const chibi = Object.hasOwn(HERO_BANNER_ART, id) ? HERO_BANNER_ART[id] : null;
  if (chibi) return { src: chibi, kind: 'chibi' };
  return { src: id === 'barbarian' ? FALLBACK_BANNER_ART : (portrait || FALLBACK_BANNER_ART), kind: 'fallback' };
}

/** 초보자 배너 일러스트. 치비가 있으면 그것, 없으면 대체 초상(없으면 banner_featured). */
export function beginnerBannerArt(portrait, chibi = BEGINNER_BANNER_ART) {
  if (chibi) return { src: chibi, kind: 'chibi' };
  return { src: portrait || FALLBACK_BANNER_ART, kind: 'fallback' };
}
