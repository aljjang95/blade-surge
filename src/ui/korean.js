// 한국어 조사 선택. 마지막 한글 음절의 받침으로 고른다(한글이 아니면 받침 없음으로 본다).

/** @param {unknown} word */
export function hasFinalConsonant(word) {
  const code = String(word ?? '').trim().slice(-1).charCodeAt(0);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
}
/** 주제 조사 은/는을 붙인다. 예: 유리 정원은, 잿불 금고는 */
export const withTopic = (word) => String(word ?? '') + (hasFinalConsonant(word) ? '은' : '는');

