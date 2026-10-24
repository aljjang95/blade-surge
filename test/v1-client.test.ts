import { describe, expect, test } from 'bun:test';
import { v1Harness, ORIGIN, newDeviceKey } from './helpers/v1-harness';
import { handleV1Request } from '../worker/v1/router';
import { AccountClient } from '../src/net/account-client.js';
import { CommandQueue } from '../src/net/command-queue.js';
import { importLocalSave } from '../src/net/import.js';
import { EconomyCore } from '../src/game/economy-core.js';
import { parityHash } from '../src/shared/state-hash.js';

async function clientHarness(env = {}) {
  const h = await v1Harness({ env });
  const fetchImpl = async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers); headers.set('origin', ORIGIN);
    return handleV1Request(new Request(url, { ...init, headers }), h.env, h.deps);
  };
  const client = new AccountClient({ deviceKey: newDeviceKey(), fetchImpl: fetchImpl as any, url: (p: string) => ORIGIN + p });
  return { h, client };
}
const settle = async (q: CommandQueue) => { for (let i = 0; i < 50 && (q.pending.length || q.busy); i++) await new Promise(r => setTimeout(r, 5)); };

describe('MMO P1-F 클라이언트 명령 큐·그림자 모드', () => {
  test('그림자 모드: UI가 부르는 기존 메서드가 /cmd로 가고 패리티가 맞는다', async () => {
    const { h, client } = await clientHarness();
    const session = await client.session();
    expect(session.authority).toBe('shadow');
    const eco = EconomyCore.fromState(null, { now: () => h.now() });
    eco.s.gold = 1_000_000;
    const imported = await importLocalSave(client, crypto.randomUUID(), eco);
    expect(imported.status).toBe('shadow');
    let authority = 'shadow';
    const q = new CommandQueue(eco, client, { authority: () => authority, adopt: () => { throw new Error('shadow never adopts'); } });
    expect(eco.claimMail(1)).toBeTruthy();
    eco.addItem('N'); q.snapshot(); eco.equip('knight', eco.s.inventory[0].uid);
    expect(eco.chooseStarter('ranger').ok).toBe(true); // 시작 영웅 선택도 /cmd 로 가고, 선택 변화가 selectHero 를 따로 보내지 않는다
    eco.claimMail(1); // 실패한 명령은 보내지 않는다
    await settle(q);
    expect(q.stats).toEqual({ sent: 4, matched: 4, mismatched: 0, rejected: 0 });
    const me = await client.me();
    expect(me.stateHash).toBe(parityHash(eco.s));
    expect(h.db.sqlite.query('SELECT COUNT(*) AS n FROM parity_log WHERE match = 0').get()).toEqual({ n: 0 });
    // 전투 보상처럼 명령 밖 변화 → 그림자 재동기화
    eco.addRewards({ gold: 5000 }, { applyVip: false });
    q.snapshot();
    await settle(q);
    expect((await client.me()).stateHash).toBe(parityHash(eco.s));
    void authority;
  });

  test('서버 권위: 로컬이 어긋나면 서버 문서로 덮어쓴다', async () => {
    const { h, client } = await clientHarness({ V1_SERVER_AUTHORITY_PERCENT: '100' });
    expect((await client.session()).authority).toBe('server');
    const eco = EconomyCore.fromState(null, { now: () => h.now() });
    eco.s.gems = 999_999; // 로컬 변조
    let adopted: any = null;
    const q = new CommandQueue(eco, client, { authority: () => 'server', adopt: (doc: any) => { adopted = doc; q.quiet(() => { eco.s = eco.migrate(doc); }); } });
    eco.claimMail(1);
    await settle(q);
    expect(q.stats.mismatched).toBe(1);
    expect(adopted.gems).toBe(1500 + 500);
    expect(eco.s.gems).toBe(2000);
    expect(q.pending.length).toBe(0);
  });

  test('토큰이 만료되면 기기 키로 다시 받아 재시도한다', async () => {
    const { h, client } = await clientHarness();
    await client.session();
    h.advance(61 * 60 * 1000);
    expect((await client.me()).rev).toBe(1);
  });
});
