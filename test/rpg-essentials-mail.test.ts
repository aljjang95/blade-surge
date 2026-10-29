// RPG 필수 E5: 우편 기간·모두 받기 기반(docs/RPG_ESSENTIALS.md).
import { describe, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { MAILBOX, mailOpen } from '../src/data/mail.js';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const DAY = 86400000;
const live: any = MAILBOX.find((m: any) => Number.isFinite(m.until));

describe('우편 정의', () => {
  test('id 는 고유한 양의 정수, 기간은 from < until', () => {
    const ids = MAILBOX.map((m: any) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MAILBOX as any[]) {
      expect(Number.isSafeInteger(m.id) && m.id > 0).toBe(true);
      if (Number.isFinite(m.until)) expect(m.from < m.until).toBe(true);
    }
  });
  test('mailOpen: 기간 없으면 상시, until 은 미만', () => {
    expect(mailOpen({}, 0)).toBe(true);
    expect(mailOpen({ from: 10, until: 20 }, 9)).toBe(false);
    expect(mailOpen({ from: 10, until: 20 }, 10)).toBe(true);
    expect(mailOpen({ from: 10, until: 20 }, 20)).toBe(false);
  });
});

describe('기간 우편 수령', () => {
  test('기간 안에서만 보이고 받을 수 있으며 한 번만', () => {
    let clock = live.from - DAY;
    const eco: any = new Economy({ now: () => clock, storage: memory(), rng: () => .5 });
    expect(eco.mailbox().some((m: any) => m.id === live.id)).toBe(false);
    expect(eco.claimMail(live.id)).toBeNull();
    clock = live.from + DAY;
    expect(eco.mailbox().some((m: any) => m.id === live.id)).toBe(true);
    const before = eco.unreadMail();
    const stones = eco.s.stones;
    expect(eco.claimMail(live.id)).toBeTruthy();
    expect(eco.s.stones).toBe(stones + (live.rewards.stones || 0));
    expect(eco.claimMail(live.id)).toBeNull();
    expect(eco.unreadMail()).toBe(before - 1);
    clock = live.until;
    expect(eco.mailbox().some((m: any) => m.id === live.id)).toBe(false);
  });
  test('기간이 끝난 뒤 안 받은 우편은 받을 수 없다', () => {
    const clock = live.until + DAY;
    const eco: any = new Economy({ now: () => clock, storage: memory(), rng: () => .5 });
    expect(eco.claimMail(live.id)).toBeNull();
  });
  test('기존 저장을 다시 불러와도 수령 기록이 남고 새 우편이 붙는다', () => {
    let clock = live.from + DAY;
    const storage = memory();
    const eco: any = new Economy({ now: () => clock, storage, rng: () => .5 });
    eco.claimMail(1); eco.save?.();
    const again: any = new Economy({ now: () => clock, storage, rng: () => .5 });
    expect(again.s.mail.find((m: any) => m.id === 1).read).toBe(true);
    expect(again.s.mail.find((m: any) => m.id === live.id).read).toBe(false);
  });
});
