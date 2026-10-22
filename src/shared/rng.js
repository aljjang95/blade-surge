// 공용 난수 도구. 브라우저·bun·workerd에서 같은 결과를 내도록 DOM·Node 내장 모듈 없이 순수 ESM으로 둔다.

/**
 * 결정적 RNG (mulberry32). 같은 seed는 같은 [0, 1) 수열을 낸다.
 * @param {number} seed
 * @returns {() => number}
 */
export function createSeededRng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * 문자열·숫자 조각을 32비트 FNV-1a로 섞어 uint32 seed를 만든다.
 * 조각 사이에 구분자(0x1f)를 넣어 ('ab','c')와 ('a','bc')가 다른 값이 되게 한다.
 * @param {...(string|number|bigint|boolean|null|undefined)} parts
 * @returns {number}
 */
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  parts.forEach((part, index) => {
    if (index) h = Math.imul(h ^ 0x1f, 0x01000193);
    const text = typeof part === 'string' ? part : String(part);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      h = Math.imul(h ^ (code & 0xff), 0x01000193);
      h = Math.imul(h ^ (code >>> 8), 0x01000193);
    }
  });
  return h >>> 0;
}

/**
 * seed와 문맥 조각(예: 계정·명령 id·용도)으로 독립된 결정적 스트림을 만든다.
 * @param {string|number} seed
 * @param {...(string|number)} parts
 * @returns {() => number}
 */
export function seededStream(seed, ...parts) {
  return createSeededRng(hashSeed(seed, ...parts));
}

/**
 * 서버용 암호학적 RNG. crypto.getRandomValues의 uint32를 2^32로 나눠 [0, 1)을 낸다.
 * 한 번에 여러 값을 받아 두고 소비해 호출 비용을 줄인다.
 * @param {{ getRandomValues: (array: Uint32Array) => Uint32Array }} [source]
 * @returns {() => number}
 */
export function cryptoRng(source = globalThis.crypto) {
  if (!source || typeof source.getRandomValues !== 'function') throw new Error('crypto.getRandomValues를 사용할 수 없습니다');
  const buffer = new Uint32Array(64);
  let index = buffer.length;
  return () => {
    if (index >= buffer.length) { source.getRandomValues(buffer); index = 0; }
    return buffer[index++] / 4294967296;
  };
}
