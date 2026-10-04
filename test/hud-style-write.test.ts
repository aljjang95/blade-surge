import { expect, test } from 'bun:test';
import { writeHudStyle } from '../src/ui/hud-style-write.js';

function fixture() {
  const properties = new Map<string, { value: string; priority: string }>();
  const writes: Array<{ property: string; incoming: string; priority: string }> = [];
  const style = {
    getPropertyValue: (property: string) => properties.get(property)?.value || '',
    getPropertyPriority: (property: string) => properties.get(property)?.priority || '',
    setProperty(property: string, incoming: string, priority = '') {
      writes.push({ property, incoming, priority });
      // CSS 경계가 소수를 정규화해도 입력 문자열은 온전히 기록한다.
      const value = property === 'width' ? `${Number.parseFloat(incoming).toFixed(4)}%`
        : property === 'background' ? 'linear-gradient(90deg, rgb(43, 212, 106), rgb(166, 255, 90))' : incoming;
      properties.set(property, { value, priority });
    },
    removeProperty(property: string) { properties.delete(property); },
  };
  return { style, writes };
}

test('브라우저가 정규화한 값은 재사용하되 새 원본 소수값은 그대로 적용한다', () => {
  const f = fixture(), first = '33.33333333333333%', second = '33.33333333333334%';
  writeHudStyle(f.style, 'width', first);
  for (let frame = 0; frame < 75; frame++) writeHudStyle(f.style, 'width', first);
  expect(f.writes).toEqual([{ property: 'width', incoming: first, priority: '' }]);
  expect(f.style.getPropertyValue('width')).toBe('33.3333%');
  writeHudStyle(f.style, 'width', second); writeHudStyle(f.style, 'width', second);
  expect(f.writes).toEqual([{ property: 'width', incoming: first, priority: '' }, { property: 'width', incoming: second, priority: '' }]);
});

test('외부 선언 삭제와 같은 값의 우선순위 변경은 다음 HUD 갱신에서 복구한다', () => {
  const f = fixture(); writeHudStyle(f.style, 'width', '50%'); f.style.removeProperty('width');
  writeHudStyle(f.style, 'width', '50%'); expect(f.style.getPropertyValue('width')).toBe('50.0000%');
  f.style.setProperty('width', '50%', 'important'); writeHudStyle(f.style, 'width', '50%');
  expect(f.style.getPropertyPriority('width')).toBe(''); expect(f.writes).toHaveLength(4);
  writeHudStyle(f.style, 'width', '50%'); expect(f.writes).toHaveLength(4);
});

test('정규화되는 배경과 숫자 불투명도도 같은 요청만 생략하고 실제 변화는 유지한다', () => {
  const f = fixture(), background = 'linear-gradient(90deg,#2bd46a,#a6ff5a)';
  writeHudStyle(f.style, 'background', background); writeHudStyle(f.style, 'opacity', .42);
  for (let frame = 0; frame < 75; frame++) {
    writeHudStyle(f.style, 'background', background); writeHudStyle(f.style, 'opacity', .42);
  }
  expect(f.writes).toHaveLength(2); writeHudStyle(f.style, 'opacity', .41999999999999993);
  expect(f.writes.at(-1)).toEqual({ property: 'opacity', incoming: '0.41999999999999993', priority: '' });
  f.style.setProperty('opacity', '0'); writeHudStyle(f.style, 'opacity', .41999999999999993);
  expect(f.style.getPropertyValue('opacity')).toBe('0.41999999999999993');
});

test('교체된 스타일 객체와 다른 속성은 별도로 적용하고 조작판 진행 소수는 보존한다', () => {
  const first = fixture(), replacement = fixture(), progress = '49.99999999999999%';
  writeHudStyle(first.style, '--p', progress); writeHudStyle(replacement.style, '--p', progress);
  writeHudStyle(first.style, 'width', progress); writeHudStyle(first.style, '--p', progress);
  expect(first.writes).toHaveLength(2); expect(replacement.writes).toHaveLength(1);
  expect(first.style.getPropertyValue('--p')).toBe(progress); expect(replacement.writes[0].incoming).toBe(progress);
});
