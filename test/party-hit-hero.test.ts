import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { PartyState } from '../worker/party-state';
import { PartyRoom } from '../worker/party';
import { PARTY_HEROES, PARTY_LIMITS, validPartySnapshot } from '../src/party/protocol.js';
import { partyHitHeroMessage } from '../src/party/visual-protocol.js';
import { PartySession } from '../src/party/session.js';
import { Battle as PartyBattle } from '../src/party/battle.js';
import { Battle as RpgBattle } from '../src/game/rpg-battle.js';
import { audio } from '../src/engine/audio.js';
import { COMBAT_SOUND_FILES, HIT_SOUND_FILES, WEAPON_BY_HERO, HERO_BY_WEAPON, partyHitProfile } from '../src/engine/combat-sound-library.js';
import { kitOf } from '../src/data/heroes.js';

afterEach(() => mock.restore());

// 파티 원격 타격음(A5): hit 이벤트의 공격자 영웅 필드가 프로토콜·Worker·게스트 재생을 끝까지 통과하는지 고정한다.
const now = 100000;
function running() {
  let serial = 0;
  const r = new PartyState('C'.repeat(20), 'host-secret', now + PARTY_LIMITS.ttlMs, () => `member-${++serial}`);
  const host = r.join('호스트', 'knight', 'host-secret', now).id;
  const guest = r.join('동료', 'mage', null, now).id;
  const send = (id: string, data: unknown) => r.receive(id, JSON.stringify(data), now);
  send(host, { type: 'stage', stageIdx: 1 });
  for (const id of [host, guest]) send(id, { type: 'ready', ready: true });
  send(host, { type: 'start', stageIdx: 1, seed: 7 });
  return { r, host, guest, send };
}
const snap = (r: PartyState, events: unknown[], tick = 1) => ({ tick, elapsed: tick / 10,
  players: [...r.members.values()].map(p => ({ id: p.id, heroId: p.heroId, x: 0, z: 0, yaw: 0, hp: 100, maxHp: 100, state: 'idle', anim: 'Idle', ult: 0, cds: [0, 0, 0, 0] })),
  enemies: [], rooms: [{ id: 0, discovered: true, cleared: false, activated: true }], roomsCleared: 0, bossDefeated: false, portal: null, events });
const hit = (extra: object = {}) => ({ type: 'hit', id: 'e1', x: 1, z: 2, value: 120, ...extra });

test('프로토콜: hero 없는 구버전 hit 과 허용된 hero 가 있는 새 hit 을 모두 통과시킨다', () => {
  const { r } = running();
  expect(validPartySnapshot(snap(r, [hit()]))).toBe(true);
  for (const hero of PARTY_HEROES) expect(validPartySnapshot(snap(r, [hit({ hero })]))).toBe(true);
  expect(validPartySnapshot(snap(r, [hit({ hero: 'knight' }), { type: 'mp', id: 'member-1', value: 30 }]))).toBe(true);
});

test('프로토콜: 허용 목록 밖 hero 와 다른 낯선 키는 여전히 거부한다', () => {
  const { r } = running();
  for (const hero of ['admin', '', 'KNIGHT', 7, null, {}, ['knight']]) expect(validPartySnapshot(snap(r, [hit({ hero })]))).toBe(false);
  for (const extra of [{ attacker: 'knight' }, { crit: true }, { heroId: 'knight' }]) expect(validPartySnapshot(snap(r, [hit({ hero: 'knight', ...extra })]))).toBe(false);
});

test('Worker 경로: PartyState 가 새 형식 스냅샷을 받아들이고 잘못된 hero 는 snapshot-schema 로 거부한다', () => {
  const { r, host, send } = running();
  expect(() => send(host, { type: 'snapshot', seq: 1, snapshot: snap(r, [hit()]) })).not.toThrow();
  expect(() => send(host, { type: 'snapshot', seq: 2, snapshot: snap(r, [hit({ hero: 'mage' })], 2) })).not.toThrow();
  expect(() => send(host, { type: 'snapshot', seq: 3, snapshot: snap(r, [hit({ hero: 'admin' })], 3) })).toThrow('snapshot-schema');
  expect(() => send(host, { type: 'snapshot', seq: 4, snapshot: snap(r, [hit({ hero: 'mage', sound: 'x' })], 4) })).toThrow('snapshot-schema');
});

test('릴레이: hero 를 모르는 구버전 클라이언트에는 hero 키를 걷어 엄격 검사를 통과시킨다', () => {
  const { r } = running();
  const message = { type: 'snapshot', seq: 1, snapshot: snap(r, [hit({ hero: 'rogue' }), { type: 'mp', id: 'member-1', value: 3 }]) };
  const legacy: any = partyHitHeroMessage(message, false);
  expect(legacy.snapshot.events.some((e: any) => 'hero' in e)).toBe(false);
  expect(legacy.snapshot.events[0]).toEqual(hit());
  expect(validPartySnapshot(legacy.snapshot)).toBe(true);
  expect(partyHitHeroMessage(message, true)).toBe(message);
  // 원본은 바뀌지 않는다(다른 클라이언트용 직렬화가 같은 객체를 쓴다).
  expect(message.snapshot.events[0]).toMatchObject({ hero: 'rogue' });
  const plain = { type: 'snapshot', seq: 2, snapshot: snap(r, [hit()]) };
  expect(partyHitHeroMessage(plain, false)).toBe(plain);
  expect(partyHitHeroMessage({ type: 'party' }, false)).toEqual({ type: 'party' });
});

test('호스트: hitEvent 는 피해를 준 파티원의 영웅을 싣고, 파티원이 아니면 구버전 형식으로 보낸다', () => {
  const session: any = { events: [], members: [{ id: 'm1', heroId: 'knight' }, { id: 'm2', heroId: 'ranger' }], heroOf: PartySession.prototype.heroOf };
  const enemy: any = { partyId: 'e9', pos: { x: 3, z: -4 } };
  PartySession.prototype.hitEvent.call(session, enemy, 12.4, { partyId: 'm2' });
  PartySession.prototype.hitEvent.call(session, enemy, 5, { partyId: 'ghost' });
  PartySession.prototype.hitEvent.call(session, enemy, 7, undefined);
  expect(session.events).toEqual([
    { type: 'hit', id: 'e9', x: 3, z: -4, value: 12, hero: 'ranger' },
    { type: 'hit', id: 'e9', x: 3, z: -4, value: 5 },
    { type: 'hit', id: 'e9', x: 3, z: -4, value: 7 }]);
  const r = running().r;
  expect(validPartySnapshot(snap(r, session.events))).toBe(true);
});

test('호스트: party Battle.damageEnemy 가 source(파티원)를 공격자로 넘기고 source 가 없으면 로컬 플레이어를 쓴다', () => {
  const calls: any[] = [];
  const hostPlayer = { stats: {}, partyId: 'm1' }, member = { stats: {}, partyId: 'm2' };
  const game: any = { stage: { party: {} }, player: hostPlayer, app: { party: { hitEvent: (...args: any[]) => calls.push(args) } } };
  spyOn(RpgBattle.prototype, 'damageEnemy').mockImplementation(((enemy: any) => { enemy.hp = Math.max(0, enemy.hp - 40); }) as any);
  PartyBattle.prototype.damageEnemy.call(game, { hp: 100 }, 40, { source: member });
  PartyBattle.prototype.damageEnemy.call(game, { hp: 100 }, 40, {});
  PartyBattle.prototype.damageEnemy.call(game, { hp: 100 }, 40, { source: { noStats: true } });
  expect(calls.map(c => [c[1], c[2]])).toEqual([[40, member], [40, hostPlayer], [40, hostPlayer]]);
  PartyBattle.prototype.damageEnemy.call(game, { hp: 0 }, 0, {});
  expect(calls).toHaveLength(3);
});

// ---- 게스트 재생 ----
test('Durable Object 중계: heroHits 를 선언한 클라이언트만 hero 를 받고, 구버전 소켓은 걷힌 스냅샷을 받는다', () => {
  const { r } = running();
  const room: any = new PartyRoom({ storage: {} as any });
  const got: Record<string, any[]> = { old: [], mid: [], fresh: [] };
  for (const id of Object.keys(got)) room.sockets.set(id, { send: (text: string) => got[id].push(JSON.parse(text)), close() {} });
  room.visualClients.add('mid'); room.avatarClients.add('mid');
  room.visualClients.add('fresh'); room.avatarClients.add('fresh'); room.heroHitClients.add('fresh');
  room.dispatch([{ message: { type: 'snapshot', seq: 1, snapshot: snap(r, [hit({ hero: 'ranger' })]) } }]);
  for (const id of ['old', 'mid']) {
    expect(got[id][0].snapshot.events).toEqual([hit()]);
    expect(validPartySnapshot(got[id][0].snapshot)).toBe(true);
  }
  expect(got.fresh[0].snapshot.events).toEqual([hit({ hero: 'ranger' })]);
  room.drop('fresh', 'test'); expect(room.heroHitClients.has('fresh')).toBe(false);
});

// ---- 게스트 재생 ----
function soundFixture() {
  const sound: any = new (audio.constructor as any)();
  const heard: string[] = [];
  sound.ctx = { currentTime: 1, state: 'running' };
  sound.pick = sound.thump = sound.ting = sound.contactSnap = () => {};
  for (const name of [...HIT_SOUND_FILES, ...COMBAT_SOUND_FILES]) sound.buffers[name] = { name, duration: .3 };
  sound.play = (name: string) => heard.push(name);
  return { sound, heard };
}
const heroLayers = (heard: string[]) => [...new Set(heard.filter(n => n.includes('/hero/')).map(n => n.split('/')[2]))];
const bodies = (heard: string[]) => heard.filter(n => n.includes('/hit/b_')).map(n => n.replace(/^.*\/hit\/(b_[a-z]+)_\d+$/, '$1'));
function playAs(event: object) {
  const { sound, heard } = soundFixture();
  spyOn(audio, 'hit').mockImplementation(sound.hit.bind(sound));
  PartySession.prototype.playRemoteHit.call({}, event);
  mock.restore();
  return heard;
}

test('영웅 → 무기 매핑은 HERO_BY_WEAPON 의 정확한 역이다', () => {
  // 소환 전용 영웅(늑대인간 족장)은 자기 무기 항목 없이 kit(광전사)의 것을 쓴다.
  expect(Object.keys(WEAPON_BY_HERO).sort()).toEqual(PARTY_HEROES.filter((h: string) => kitOf(h) === h).sort());
  expect(partyHitProfile('werewolf')).toEqual(partyHitProfile('barbarian'));
  for (const [weapon, hero] of Object.entries(HERO_BY_WEAPON)) expect(WEAPON_BY_HERO[hero as string]).toBe(weapon);
  expect(partyHitProfile('admin')).toBeNull();
  expect(partyHitProfile(undefined)).toBeNull();
  expect(partyHitProfile('mage')).toEqual({ kind: 'magic', weapon: 'staff' });
});

test('게스트 재생: 공격자 영웅마다 서로 다른 영웅 접촉 레이어가 울린다', () => {
  const layers = new Map<string, string[]>();
  for (const hero of PARTY_HEROES) {
    const heard = playAs({ type: 'hit', id: 'e1', value: 200, hero });
    expect(heroLayers(heard)).toEqual([kitOf(hero)]);
    layers.set(hero, heard.filter(n => n.includes('/hero/')));
  }
  // 서로 다른 소리 세트는 kit 이 다른 영웅 수만큼(늑대인간 족장은 광전사와 같은 세트).
  expect(new Set([...layers.values()].map(v => v.join('|'))).size).toBe(new Set(PARTY_HEROES.map((h: string) => kitOf(h))).size);
  // 무기별 몸체 규칙도 따른다: 도끼(barbarian)는 무거운 바디, 쌍단검(rogue)은 가벼운 바디.
  expect(bodies(playAs({ type: 'hit', id: 'e1', value: 200, hero: 'barbarian' }))).toEqual(['b_heavy']);
  expect(bodies(playAs({ type: 'hit', id: 'e1', value: 200, hero: 'rogue' }))).toEqual(['b_light']);
  expect(bodies(playAs({ type: 'hit', id: 'e1', value: 200, hero: 'knight' }))).toEqual(['b_basic']);
});

test('게스트 재생: 큰 피해(value>1000)는 기존처럼 마무리 등급을 유지하고, hero 가 없거나 모르는 값이면 기존 slash 소리로 내려간다', () => {
  expect(bodies(playAs({ type: 'hit', id: 'e1', value: 1500, hero: 'knight' }))).toEqual(['b_finisher']);
  for (const old of [{ type: 'hit', id: 'e1', value: 200 }, { type: 'hit', id: 'e1', value: 200, hero: 'admin' }]) {
    const heard = playAs(old);
    expect(heroLayers(heard)).toEqual([]);
    expect(bodies(heard)).toEqual(['b_basic']);
    expect(heard.some(n => n.includes('/hit/t_slash'))).toBe(true);
  }
  expect(bodies(playAs({ type: 'hit', id: 'e1', value: 1500 }))).toEqual(['b_finisher']);
});
