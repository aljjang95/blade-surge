import { expect, test } from 'bun:test';
import { PartyState } from '../worker/party-state';
import { PARTY_LIMITS, validPartySnapshot } from '../src/party/protocol.js';
import { partyAvatarMessage } from '../src/party/visual-protocol.js';

// 아바타 이전 클라이언트와 섞인 파티가 멈추지 않는지 고정한다.
const now = 100000;
function room(guestAvatar?: string) {
  let serial = 0;
  const r = new PartyState('B'.repeat(20), 'host-secret', now + PARTY_LIMITS.ttlMs, () => `member-${++serial}`);
  const host = r.join('호스트', 'knight', 'host-secret', now).id;
  const guest = r.join('동료', 'ranger', null, now, guestAvatar).id;
  const send = (id: string, data: unknown) => r.receive(id, JSON.stringify(data), now);
  send(host, { type: 'stage', stageIdx: 1 });
  for (const id of [host, guest]) send(id, { type: 'ready', ready: true });
  send(host, { type: 'start', stageIdx: 1, seed: 7 });
  return { r, host, guest, send };
}
const snap = (r: PartyState, tick: number, withAvatar: boolean) => ({ tick, elapsed: tick / 10,
  players: [...r.members.values()].map(p => ({ id: p.id, heroId: p.heroId, ...(withAvatar && p.avatar ? { avatar: p.avatar } : {}),
    x: 0, z: 0, yaw: 0, hp: 100, maxHp: 100, state: 'idle', anim: 'Idle', ult: 0, cds: [0, 0, 0, 0] })),
  enemies: [], rooms: [{ id: 0, discovered: true, cleared: false, activated: true }], roomsCleared: 0, bossDefeated: false, portal: null, events: [] });

test('아바타 이전 호스트의 스냅샷은 아바타를 착용한 게스트가 있어도 통과한다', () => {
  const { r, host, send } = room('avatar_ranger_fox');
  expect([...r.members.values()].find(m => m.heroId === 'ranger')?.avatar).toBe('avatar_ranger_fox');
  expect(() => send(host, { type: 'snapshot', seq: 1, snapshot: snap(r, 1, false) })).not.toThrow();
  expect(() => send(host, { type: 'snapshot', seq: 2, snapshot: snap(r, 2, true) })).not.toThrow();
  const forged = snap(r, 3, true); forged.players[0] = { ...forged.players[0], avatar: 'avatar_knight_sakura' };
  expect(() => send(host, { type: 'snapshot', seq: 3, snapshot: forged })).toThrow('snapshot-members');
});

test('모르는 아바타나 다른 영웅의 아바타는 입장을 막지 않고 외형만 버린다', () => {
  for (const bad of ['missing', 'avatar_knight_sakura']) {
    const { r } = room(bad);
    expect([...r.members.values()].find(m => m.heroId === 'ranger')?.avatar).toBeUndefined();
  }
});

test('아바타 이전 클라이언트로 보내는 스냅샷에서는 avatar 키를 걷어 내 엄격 검사를 통과시킨다', () => {
  const { r } = room('avatar_ranger_fox');
  const message = { type: 'snapshot', seq: 1, snapshot: snap(r, 1, true) };
  const legacy: any = partyAvatarMessage(message, false);
  expect(legacy.snapshot.players.some((p: any) => 'avatar' in p)).toBe(false);
  expect(validPartySnapshot(legacy.snapshot)).toBe(true);
  expect(partyAvatarMessage(message, true)).toBe(message);
  expect(message.snapshot.players.some((p: any) => p.avatar === 'avatar_ranger_fox')).toBe(true);
});

