import { afterEach, describe, expect, test } from 'bun:test';
import { createSocialClient, memoryStorage } from '../src/client/index.js';
import { bindCommunityHero } from '../../../src/social/integration.js';
import { HEROES } from '../../../src/data/heroes.js';

const ME = { id: 'p_' + 'a'.repeat(24), name: '모험가', tag: '0001', no: 1, hero: null, title: null, linked: false };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const cleanups = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function setup({ selected = 'knight', hero = null, deferred = false, failure = null } = {}) {
  let current = selected, profile = { ...ME, hero };
  const calls = [], pending = [];
  const json = (body, status = 200) => Response.json(body, { status });
  const storage = memoryStorage();
  storage.setItem('tll-social:hero-integration:key', 'A'.repeat(43)); // 이미 프로필이 있는 기기
  const client = createSocialClient({
    gameId: 'hero-integration', storage, window: null, document: null,
    fetch: async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, body });
      if (url.endsWith('/me')) return json({ profile, friends: [], requests: { incoming: [], outgoing: [] }, blocks: [], titles: [] });
      if (url.endsWith('/profile')) { profile = { ...profile, name: body.name, hero: body.hero ?? null }; return json(profile, 201); }
      if (url.endsWith('/me/hero')) {
        if (failure) return json(failure, 429);
        const accept = () => { profile = { ...profile, hero: body.hero }; return json(profile); };
        if (deferred) return new Promise(resolve => pending.push(() => resolve(accept())));
        return accept();
      }
      throw new Error('예상하지 못한 요청: ' + url);
    },
  });
  const originalProfile = client.profile;
  const binding = bindCommunityHero(client, () => current);
  cleanups.push(() => { binding.destroy(); client.destroy(); });
  return {
    client, binding, calls, originalProfile,
    select(value) { current = value; },
    accept() { pending.shift()(); },
    heroCalls: () => calls.filter(call => call.url.endsWith('/me/hero')),
  };
}

describe('게임 선택 영웅 연결', () => {
  test('내 정보와 상대 정보 모두 서버의 유효한 hero 초상을 먼저 쓴다', () => {
    const h = setup({ selected: 'knight' });
    h.client.state.me = { ...ME };
    for (const hero of Object.keys(HEROES)) {
      expect(h.binding.portraitFor({ ...ME, hero })).toBe(HEROES[hero].portrait);
      expect(h.binding.portraitFor({ id: '상대', hero })).toBe(HEROES[hero].portrait);
    }
  });

  test('hero가 없거나 잘못됐으면 본인은 선택 영웅, 상대는 기존 id 해시로 표시한다', () => {
    const h = setup({ selected: 'ranger' });
    h.client.state.me = { ...ME };
    for (const hero of [undefined, null, 'unknown', '__proto__']) {
      expect(h.binding.portraitFor({ ...ME, hero })).toBe(HEROES.ranger.portrait);
      // 기존 해시에서 id "a"는 97 % 5 = 2, 즉 mage다.
      expect(h.binding.portraitFor({ id: 'a', hero })).toBe(HEROES.mage.portrait);
    }
    expect(h.binding.portraitFor(null)).toBeNull();
  });

  test('UI가 이름만 넘겨 프로필을 만들어도 현재 선택 영웅을 같이 보낸다', async () => {
    const h = setup({ selected: 'rogue' });
    expect((await h.client.profile('새모험가')).ok).toBe(true);
    await flush();
    expect(h.calls).toEqual([{ url: '/api/social/profile', body: { name: '새모험가', hero: 'rogue' } }]);
    expect(h.client.state.me.hero).toBe('rogue');
  });

  test('state 수신으로 불일치를 맞추고 성공 상태 알림이 다시 와도 중복 전송하지 않는다', async () => {
    const h = setup({ selected: 'mage', hero: 'knight' });
    await h.client.me();
    await flush();
    expect(h.client.state.me.hero).toBe('mage');
    await h.client.me();
    await h.binding.sync();
    expect(h.heroCalls()).toEqual([{ url: '/api/social/me/hero', body: { hero: 'mage' } }]);
  });

  test('요청 중 상태·선택이 여러 번 바뀌어도 한 건씩 보내 마지막 선택으로 수렴한다', async () => {
    const h = setup({ selected: 'mage', hero: 'knight', deferred: true });
    await h.client.me();
    await h.client.me();
    h.select('rogue');
    await h.binding.sync();
    h.select('ranger');
    await h.binding.sync();
    expect(h.heroCalls().map(call => call.body.hero)).toEqual(['mage']);
    h.accept();
    await flush();
    expect(h.heroCalls().map(call => call.body.hero)).toEqual(['mage', 'ranger']);
    h.accept();
    await flush();
    expect(h.client.state.me.hero).toBe('ranger');
    expect(h.heroCalls()).toHaveLength(2);
  });

  test('로컬에서 영웅만 바꿔도 감시 주기의 sync로 서버에 전달한다', async () => {
    const h = setup({ selected: 'knight', hero: 'knight' });
    await h.client.me();
    expect(h.heroCalls()).toHaveLength(0);
    h.select('barbarian');
    await h.binding.sync();
    expect(h.client.state.me.hero).toBe('barbarian');
    expect(h.heroCalls()).toHaveLength(1);
  });

  test('프로필이 없거나 선택 영웅이 유효하지 않으면 변경 요청을 보내지 않는다', async () => {
    const h = setup();
    await h.binding.sync();
    expect(h.calls).toHaveLength(0);
    h.select('__proto__');
    await h.client.me();
    expect(h.heroCalls()).toHaveLength(0);
  });

  test('변경 실패 시 기존 영웅을 유지하고 후속 state·감시가 즉시 재시도하지 않는다', async () => {
    const h = setup({ selected: 'mage', hero: 'knight', failure: { error: 'rate', retryAfterMs: 60000 } });
    await h.client.me();
    await flush();
    await h.client.me();
    await h.binding.sync();
    expect(h.client.state.me.hero).toBe('knight');
    expect(h.heroCalls()).toHaveLength(1);
  });

  test('연결 해제는 상태 구독·프로필 래핑을 복원하고 대기 중 추가 전송을 막는다', async () => {
    const h = setup({ selected: 'mage', hero: 'knight', deferred: true });
    await h.client.me();
    h.select('ranger');
    h.binding.destroy();
    expect(h.client.profile).toBe(h.originalProfile);
    h.accept();
    await flush();
    await h.binding.sync();
    await h.client.me();
    expect(h.heroCalls()).toHaveLength(1);
  });
});
