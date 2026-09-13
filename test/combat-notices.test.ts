import { expect, spyOn, test } from 'bun:test';
import { CombatNoticeQueue } from '../src/ui/combat-notices.js';

function fixture() {
  let now = 0, sequence = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const visible: string[] = [], seen: { message: string; at: number }[] = [];
  const queue = new CombatNoticeQueue({
    show: ({ message }: { message: string }) => {
      visible.push(message); seen.push({ message, at: now });
      return () => { visible.splice(visible.indexOf(message), 1); };
    },
    schedule: ((fn: () => void, delay: number) => {
      const id = sequence++; timers.set(id, { fn, at: now + delay }); return id;
    }) as any,
    cancel: ((id: number) => { timers.delete(id); }) as any,
  });
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = until;
  };
  return { queue, visible, seen, timers, advance };
}

test('seal warning and portal guidance each receive 2.2 seconds of visible time', () => {
  const f = fixture();
  f.queue.push('보스의 봉인이 풀렸다!', 'red');
  f.queue.push('보스방으로 가는 포탈이 열렸다', 'gold');
  expect(f.visible).toEqual(['보스의 봉인이 풀렸다!']);
  f.advance(2199); expect(f.visible).toEqual(['보스의 봉인이 풀렸다!']);
  f.advance(1); expect(f.visible).toEqual(['보스방으로 가는 포탈이 열렸다']);
  f.advance(2199); expect(f.visible).toHaveLength(1);
  f.advance(1); expect(f.visible).toEqual([]);
  expect(f.seen.map(({ at }) => at)).toEqual([0, 2200]);
});

test('new danger preempts routine information immediately, then resumes it', () => {
  const f = fixture();
  f.queue.push('전투 목표', 'gold'); f.advance(700);
  f.queue.push('보스의 기척', 'red');
  expect(f.visible).toEqual(['보스의 기척']);
  f.advance(2200); expect(f.visible).toEqual(['전투 목표']);
  f.advance(2200); expect(f.visible).toEqual([]);
});

test('repeated active and waiting messages neither stack nor extend a warning forever', () => {
  const f = fixture();
  f.queue.push('위험', 'red'); f.advance(1000);
  expect(f.queue.push('위험', 'red')).toBe(false);
  f.queue.push('포탈', 'gold'); expect(f.queue.push('포탈', 'gold')).toBe(false);
  f.advance(1200); expect(f.visible).toEqual(['포탈']);
  f.advance(2200); expect(f.visible).toEqual([]);
  expect(f.seen).toHaveLength(2);
});

test('queued danger precedes routine guidance without removing that guidance', () => {
  const f = fixture();
  f.queue.push('보스 경고', 'red'); f.queue.push('포탈', 'gold'); f.queue.push('낙석', 'red');
  f.advance(2200); expect(f.visible).toEqual(['낙석']);
  f.advance(2200); expect(f.visible).toEqual(['포탈']);
});

test('bursts stay bounded, preserve danger, and keep the newest routine guidance', () => {
  const f = fixture();
  f.queue.push('보스 경고', 'red'); f.queue.push('낙석', 'red');
  for (let i = 0; i < 20; i++) f.queue.push(`정보 ${i}`, 'gold');
  expect(f.visible).toEqual(['보스 경고']);
  f.advance(2200); expect(f.visible).toEqual(['낙석']);
  f.advance(2200 * 4); expect(f.visible).toEqual([]);
  expect(f.seen.map(({ message }) => message)).toEqual(['보스 경고', '낙석', '정보 17', '정보 18', '정보 19']);
});

test('leaving or restarting a battle discards its notices and ignores stale callbacks', () => {
  const f = fixture();
  f.queue.push('이전 경고', 'red'); f.queue.push('이전 포탈', 'gold');
  const stale = [...f.timers.values()][0].fn;
  f.queue.clear(); expect(f.visible).toEqual([]); expect(f.timers.size).toBe(0);
  f.queue.push('새 전투'); stale(); expect(f.visible).toEqual(['새 전투']);
  f.advance(2200); expect(f.visible).toEqual([]);
  expect(f.seen.map(({ message }) => message)).toEqual(['이전 경고', '새 전투']);
});

test('default timers respect browser receivers during scheduling, preemption and cleanup', () => {
  const timers = new Map<number, () => void>();
  let nextId = 1;
  const visible: string[] = [];
  const schedule = spyOn(globalThis, 'setTimeout').mockImplementation(function (this: unknown, callback: () => void, delay: number) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    expect(delay).toBe(2200);
    const id = nextId++; timers.set(id, callback); return id;
  } as any);
  const cancel = spyOn(globalThis, 'clearTimeout').mockImplementation(function (this: unknown, id: number) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    timers.delete(id);
  } as any);
  try {
    const queue = new CombatNoticeQueue({ show: ({ message }: { message: string }) => {
      visible.push(message); return () => { visible.splice(visible.indexOf(message), 1); };
    } });
    queue.push('목표', 'gold'); queue.push('경고', 'red');
    expect(visible).toEqual(['경고']); expect(timers.size).toBe(1);
    const [id, fire] = [...timers][0]; timers.delete(id); fire();
    expect(visible).toEqual(['목표']); expect(timers.size).toBe(1);
    queue.clear(); expect(visible).toEqual([]); expect(timers.size).toBe(0);
  } finally { schedule.mockRestore(); cancel.mockRestore(); }
});
