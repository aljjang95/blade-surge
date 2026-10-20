export const DEFAULT_BANNED_WORDS = ['씨발', '시발', '개새끼', '병신', '좆', 'fuck', 'shit', 'bitch', 'asshole'];

// 금칙어를 같은 길이의 '*'로 가린다. 글자 사이에 공백·기호를 끼워 넣어도 잡는다.
export function maskBanned(value: string, extra: string[] = []): string {
  let result = value.normalize('NFKC');
  for (const word of [...DEFAULT_BANNED_WORDS, ...extra]) {
    const letters = [...word.normalize('NFKC').trim()];
    if (!letters.length) continue;
    const pattern = letters.map(letter => letter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\p{P}\\p{S}\\s]*');
    result = result.replace(new RegExp(pattern, 'giu'), match => '*'.repeat([...match].length));
  }
  return result;
}

// 채팅용: 금칙어를 가리고 URL·도메인 형태는 '[링크]'로 바꾼다.
export function filterChat(value: string, extra: string[] = []): string {
  return maskBanned(value, extra).replace(/(?:https?:\/\/|www\.)[^\s]+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:[a-z]{2,63})(?::\d+)?(?:\/[^\s]*)?/giu, '[링크]');
}

export function neutralizeMentions(value: string): string {
  return value.replace(/@/g, '@\u200b').replace(/<([@#])/g, '<\u200b$1');
}
