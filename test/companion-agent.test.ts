import { describe, expect, test } from 'bun:test';
import { CompanionAgent, type CompanionContext } from '../src/companion/companion-agent';

test('동행 저장의 null 메시지는 버리고 정상 전술과 대화는 보존한다', () => {
  const raw = { tactic: 'guard', bond: 7, messages: [null, { id: 3, role: 'player', text: '수호해줘', at: 123 }, { id: 4, role: 'companion', text: { bad: true }, at: 124 }] };
  const agent = new CompanionAgent({ storage: { getItem: () => JSON.stringify(raw), setItem() {} } });
  expect(agent.getSnapshot().tactic).toBe('guard');
  expect(agent.getSnapshot().bond).toBe(7);
  expect(agent.getSnapshot().messages).toEqual([{ id: 3, role: 'player', text: '수호해줘', at: 123 }]);
  expect(() => agent.reply('고마워')).not.toThrow();
});

test('동행 저장 구조가 비어 있어도 인사와 안전한 기본 전술로 시작한다', () => {
  const agent = new CompanionAgent({ storage: { getItem: () => '{"tactic":"__proto__","bond":-10,"messages":[null]}', setItem() {} } });
  expect(agent.getSnapshot().tactic).toBe('gather');
  expect(agent.getSnapshot().bond).toBe(1);
  expect(agent.getSnapshot().messages[0]?.role).toBe('companion');
});

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const COMBAT_CONTEXT: CompanionContext = {
  mode: 'battle',
  heroName: '검성 아르카',
  floor: 7,
  hpRatio: 0.42,
  enemiesNear: 13,
  combo: 38,
  roomsCleared: 4,
  totalRooms: 9,
  bossName: '해골 군주',
  power: 18240,
};

describe('CompanionAgent', () => {
  test('자연어 명령을 실제 전투 전술로 바꾼다', () => {
    const agent = new CompanionAgent({ now: () => 100 });

    agent.reply('적을 한곳에 몰아줘');
    expect(agent.getSnapshot().tactic).toBe('gather');

    agent.reply('이제 나를 지켜');
    expect(agent.getSnapshot().tactic).toBe('guard');

    agent.reply('보스를 파쇄해');
    expect(agent.getSnapshot().tactic).toBe('break');
  });

  test('전투 문맥을 수치가 들어간 대화로 설명한다', () => {
    const agent = new CompanionAgent({ now: () => 100 });
    agent.updateContext(COMBAT_CONTEXT);

    const report = agent.reply('상태 보고');

    expect(report).toContain('체력 42%');
    expect(report).toContain('근접 위협 13체');
    expect(report).toContain('콤보 38');
  });

  test('전술과 유대 기억을 로컬 원장에 복구한다', () => {
    const storage = new MemoryStorage();
    const first = new CompanionAgent({ storage, now: () => 100 });
    first.reply('수호 진형으로 바꿔');
    first.reply('잘했어');

    const restored = new CompanionAgent({ storage, now: () => 200 });

    expect(restored.getSnapshot().tactic).toBe('guard');
    expect(restored.getSnapshot().bond).toBeGreaterThan(1);
    expect(restored.getSnapshot().messages.at(-1)?.text).toContain('같은 편');
  });

  test('같은 보스 관측을 중복 발화하지 않는다', () => {
    const agent = new CompanionAgent({ now: () => 100 });
    const before = agent.getSnapshot().messages.length;

    agent.observe('boss-spotted', { id: '7:skeleton-king', name: '해골 군주' });
    agent.observe('boss-spotted', { id: '7:skeleton-king', name: '해골 군주' });

    expect(agent.getSnapshot().messages.length).toBe(before + 1);
  });
});
