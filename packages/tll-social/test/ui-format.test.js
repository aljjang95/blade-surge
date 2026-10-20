import { describe, expect, test } from 'bun:test';
import { badgeText, channelLabel, checkNickname, clockText, dateText, dateTimeText, durationText, errorMessage, fullName, parseFriendCode, presenceText, statusChip, titleTone } from '../src/ui/format.js';

describe('시간·시각 표시', () => {
  const at = Date.UTC(2025, 7, 10, 11, 14); // 서울 20:14
  test('오후 8:14 형식', () => {
    expect(clockText(at, 540)).toBe('오후 8:14');
    expect(clockText(Date.UTC(2025, 7, 10, 0, 5), 540)).toBe('오전 9:05');
    expect(clockText(Date.UTC(2025, 7, 10, 3, 0), 540)).toBe('오후 12:00');
    expect(clockText(Date.UTC(2025, 7, 9, 15, 0), 540)).toBe('오전 12:00');
  });
  test('날짜와 날짜+시각', () => {
    expect(dateText(at, 540)).toBe('2025.08.10');
    expect(dateTimeText(at, 540)).toBe('2025.08.10 20:14');
  });
  test('클리어 시간은 mm:ss, 한 시간이 넘으면 h:mm:ss', () => {
    expect(durationText(7 * 60000 + 31000)).toBe('07:31');
    expect(durationText(3723000)).toBe('1:02:03');
    expect(durationText(-1)).toBe('--:--');
    expect(durationText(NaN)).toBe('--:--');
  });
  test('잘못된 값은 빈 문자열', () => {
    expect(clockText(NaN)).toBe('');
    expect(dateText(undefined)).toBe('');
  });
});

describe('이름·코드', () => {
  test('광장 라벨과 인원', () => {
    expect(channelLabel('world-1', [{ id: 'world-1', count: 87 }])).toBe('광장 1 · 87명');
    expect(channelLabel('world-2', [{ id: 'world-1', count: 5 }])).toBe('광장 2');
    expect(channelLabel(null, [])).toBe('광장');
  });
  test('이름#태그', () => {
    expect(fullName({ name: '검은달', tag: '4821' })).toBe('검은달#4821');
    expect(fullName(null)).toBe('');
  });
  test('친구 코드 파싱', () => {
    expect(parseFriendCode(' 검은달#4821 ')).toEqual({ name: '검은달', tag: '4821' });
    expect(parseFriendCode('검은달')).toBe(null);
    expect(parseFriendCode('검은달#12')).toBe(null);
    expect(parseFriendCode(3)).toBe(null);
  });
  test('닉네임은 서버 규칙과 같게 2~12자 한글·영문·숫자·_', () => {
    expect(checkNickname('검은달').ok).toBe(true);
    expect(checkNickname('a_1').ok).toBe(true);
    expect(checkNickname('가').error).toBe('length');
    expect(checkNickname('열두글자를넘기는아주긴이름이다').error).toBe('length');
    expect(checkNickname('검은 달').error).toBe('chars');
    expect(checkNickname('이름!').error).toBe('chars');
    expect(checkNickname('  검은달  ').name).toBe('검은달');
  });
});

describe('배지·접속 위치·칭호', () => {
  test('배지 숫자', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(5)).toBe('5');
    expect(badgeText(120)).toBe('99+');
    expect(badgeText(-3)).toBe('');
  });
  test('접속 위치', () => {
    expect(presenceText({ state: 'lobby' })).toBe('로비');
    expect(presenceText({ state: 'battle', where: '오로라 빙정호' })).toBe('던전 · 오로라 빙정호');
    expect(presenceText({ state: 'party' })).toBe('파티 중');
    expect(presenceText(null)).toBe('');
  });
  test('칭호 색 톤', () => {
    expect(titleTone('founder')).toBe('gold');
    expect(titleTone('first:emberwake_drydock')).toBe('gold');
    expect(titleTone('pioneer:x')).toBe('orange');
    expect(titleTone('vanguard:x')).toBe('blue');
    expect(titleTone('conqueror')).toBe('purple');
  });
  test('게시글 상태 칩: 답변이 달린 열린 글은 답변 완료', () => {
    expect(statusChip({ status: 'reviewing' }).label).toBe('검토 중');
    expect(statusChip({ status: 'planned' }).label).toBe('반영 예정');
    expect(statusChip({ status: 'done' }).label).toBe('반영 완료');
    expect(statusChip({ status: 'open', devReply: '확인했습니다' }).label).toBe('답변 완료');
    expect(statusChip({ status: 'open', devReply: null }).label).toBe('');
  });
});

describe('오류 문구는 항상 한국어', () => {
  test('알려진 코드', () => {
    expect(errorMessage('rename-cooldown')).toContain('24시간');
    expect(errorMessage('link-disabled')).toContain('준비 중');
  });
  test('모르는 코드도 영어를 그대로 보이지 않는다', () => {
    expect(errorMessage('weird-code')).toMatch(/[가-힣]/);
    expect(errorMessage('http-500')).toMatch(/서버/);
    expect(errorMessage('weird-code')).not.toContain('weird-code');
  });
  test('다시 시도할 시간 안내', () => {
    expect(errorMessage('rate', 4000)).toContain('4초');
    expect(errorMessage('rename-cooldown', 3 * 3600000)).toContain('3시간');
  });
});
