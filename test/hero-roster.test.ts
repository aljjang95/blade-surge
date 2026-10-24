import { describe, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { ArsenalService } from '../src/game/arsenal-service.js';
import { MasterworksService } from '../src/game/masterworks-service.js';
import { createMemoryStorage } from '../src/game/economy-core.js';
import { normalizeSave } from '../src/game/save.js';
import { HEROES, HERO_ORDER } from '../src/data/heroes.js';
import { GACHA } from '../src/data/shop.js';
import { HERO_FREE_UNLOCK, HERO_FREE_UNLOCK_TOTAL_GEMS, HERO_POLICY, rosterOwns } from '../src/data/hero-roster.js';
import { OPS, validateOp } from '../src/shared/v1-ops.js';
import { Meta } from '../src/ui/meta.js';
import { starterChoices, needsStarterSelect } from '../src/ui/starter-select.js';
import { audio } from '../src/engine/audio.js';

const IDS = Object.keys(HEROES);
const fresh = (storage = createMemoryStorage()) => new Economy({ storage });
/** 이 정책 전의 저장 원본: roster 필드가 없다. */
function legacyRaw(patch: (raw: any) => void = () => {}) {
  const raw: any = JSON.parse(JSON.stringify(fresh().s));
  delete raw.roster; patch(raw); return raw;
}
function withStore(raw: any) {
  const storage = createMemoryStorage(); storage.setItem('bladesurge_save_v1', JSON.stringify(raw)); return new Economy({ storage });
}
/** 스타터를 고른 정책 2 저장 + 넉넉한 진행·보석. */
function chosen(id = 'knight', { unlocked = 60, gems = 99999 } = {}) {
  const eco = fresh(); expect(eco.chooseStarter(id).ok).toBe(true);
  eco.s.progress.unlocked = unlocked; eco.s.gems = gems; return eco;
}

describe('저장 정책', () => {
  test('roster 없는 기존 저장은 정책 1 로 다섯 영웅을 모두 소유하고 레벨·선택을 보존하며 여러 번 불러도 같다', () => {
    const raw = legacyRaw((r) => { r.selected = 'mage'; r.heroes.mage.level = 24; r.heroes.rogue.level = 9; r.heroes.rogue.shards = 33; });
    const a = withStore(raw);
    expect(a.s.roster).toEqual({ policy: HERO_POLICY.LEGACY, owned: IDS, starter: null, starterChosen: true, paid: [] });
    for (const id of IDS) expect(a.ownHero(id)).toBe(true);
    expect(a.s.selected).toBe('mage');
    expect([a.s.heroes.mage.level, a.s.heroes.rogue.level, a.s.heroes.rogue.shards]).toEqual([24, 9, 33]);
    const once = JSON.stringify(a.s.roster);
    const b = withStore(JSON.parse(JSON.stringify(a.s))); const c = withStore(JSON.parse(JSON.stringify(b.s)));
    expect(JSON.stringify(b.s.roster)).toBe(once); expect(JSON.stringify(c.s.roster)).toBe(once);
    expect(c.s.heroes.mage.level).toBe(24);
    // 영웅 선택 화면은 정책 1 에서는 뜨지 않는다.
    expect(needsStarterSelect(a)).toBe(false);
  });

  test('새 저장은 정책 2, 시작 영웅 하나만 소유하고 영웅 상태 다섯은 그대로 만든다', () => {
    const eco = fresh();
    expect(eco.s.roster).toEqual({ policy: HERO_POLICY.STARTER, owned: ['knight'], starter: 'knight', starterChosen: false, paid: [] });
    expect(eco.ownedHeroIds()).toEqual(['knight']);
    expect(Object.keys(eco.s.heroes)).toEqual(IDS);
    for (const id of IDS.filter((x) => x !== 'knight')) expect(eco.ownHero(id)).toBe(false);
    expect(needsStarterSelect(eco)).toBe(true);
  });

  test('정화: 중복·모르는 id 제거, owned 가 비면 시작 영웅 또는 기사, 미소유 selected 는 시작 영웅으로', () => {
    const base = JSON.parse(JSON.stringify(fresh().s));
    const run = (roster: any, selected = 'knight') => normalizeSave({ ...base, roster, selected }, JSON.parse(JSON.stringify(base)));
    const a = run({ policy: 2, owned: ['mage', 'mage', 'ghost', 7], starter: 'mage', starterChosen: true, paid: ['rogue', 'rogue', 'zzz'] }, 'ranger');
    expect(a.roster).toEqual({ policy: 2, owned: ['mage'], starter: 'mage', starterChosen: true, paid: ['rogue'] });
    expect(a.selected).toBe('mage');
    expect(run({ policy: 2, owned: [], starter: 'rogue', starterChosen: true, paid: [] }).roster.owned).toEqual(['rogue']);
    expect(run({ policy: 2, owned: [], starter: null, starterChosen: true, paid: [] }).roster.owned).toEqual(['knight']);
    // 시작 영웅을 고르기 전에는 시작 영웅 하나만 소유할 수 있다(로컬 편집으로 owned 를 늘려도 정화된다).
    expect(run({ policy: 2, owned: ['knight', 'mage', 'rogue'], starter: 'knight', starterChosen: false, paid: [] }).roster.owned).toEqual(['knight']);
    // 정화는 멱등
    const twice = normalizeSave(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(base)));
    expect(twice.roster).toEqual(a.roster);
    // rosterOwns: roster 없는 픽스처는 정책 1
    expect(rosterOwns(undefined, 'mage')).toBe(true);
  });

  test('저장을 다시 불러와도 소유와 선택이 유지된다', () => {
    const storage = createMemoryStorage(); const eco = new Economy({ storage });
    expect(eco.chooseStarter('rogue').ok).toBe(true);
    const again = new Economy({ storage });
    expect(again.s.roster).toMatchObject({ policy: 2, owned: ['rogue'], starter: 'rogue', starterChosen: true });
    expect(again.s.selected).toBe('rogue');
  });
});

describe('시작 영웅 선택', () => {
  test('chooseStarter 는 한 번만 되고 고른 영웅이 유일한 소유·선택 영웅이다', () => {
    const eco = fresh();
    expect(eco.chooseStarter('ghost')).toEqual({ ok: false, reason: 'unknown' });
    expect(eco.chooseStarter('mage')).toEqual({ ok: true, id: 'mage' });
    expect(eco.s.roster).toMatchObject({ owned: ['mage'], starter: 'mage', starterChosen: true });
    expect(eco.s.selected).toBe('mage');
    expect(eco.ownHero('knight')).toBe(false);
    expect(eco.chooseStarter('rogue')).toEqual({ ok: false, reason: 'chosen' });
    expect(eco.s.roster.owned).toEqual(['mage']);
  });
  test('정책 1(기존 저장)은 시작 영웅을 고를 수 없다', () => {
    expect(withStore(legacyRaw()).chooseStarter('mage')).toEqual({ ok: false, reason: 'policy' });
  });
  test('저장이 실패하면 선택이 취소된다', () => {
    const storage = createMemoryStorage(); const eco = new Economy({ storage });
    storage.setItem = () => { throw new Error('quota'); };
    expect(eco.chooseStarter('mage')).toEqual({ ok: false, reason: 'storage' });
    expect(eco.s.roster).toMatchObject({ owned: ['knight'], starterChosen: false }); expect(eco.s.selected).toBe('knight');
  });
  test('선택 화면은 다섯 영웅 카드를 초상·이름·한 줄 특징과 함께 모두 낸다', () => {
    const cards = starterChoices();
    expect(cards.map((c) => c.id)).toEqual(HERO_ORDER);
    for (const c of cards) { expect(c.name).toBe((HEROES as any)[c.id].name); expect(c.portrait.length).toBeGreaterThan(0); expect(c.role.length).toBeGreaterThan(0); expect(c.line.length).toBeGreaterThan(0); }
  });
});

describe('무료 해금', () => {
  test('비용 사다리는 둘째 영웅 1,500부터 합계 11,000 이고 진행 조건은 오른다', () => {
    expect(HERO_FREE_UNLOCK.map((s) => s.gems)).toEqual([1500, 2500, 3000, 4000]);
    expect(HERO_FREE_UNLOCK_TOTAL_GEMS).toBe(11000);
    const needs = HERO_FREE_UNLOCK.map((s) => s.need);
    expect([...needs].sort((a, b) => a - b)).toEqual(needs);
  });
  test('시작 영웅을 고르기 전에는 열 수 없다', () => {
    const eco = fresh(); eco.s.gems = 99999; eco.s.progress.unlocked = 60;
    expect(eco.unlockHeroFree('mage')).toEqual({ ok: false, reason: 'starter-pending' });
  });
  test('진행 조건과 보석 조건을 각각 확인하고 사유를 돌려준다', () => {
    const eco = chosen('knight', { unlocked: 1, gems: 99999 });
    const [first] = HERO_FREE_UNLOCK;
    let q = eco.heroUnlockQuote('mage');
    expect(q).toMatchObject({ reason: 'progress', canFree: false, need: first.need, gems: first.gems, step: 0, needLabel: '3-5' });
    expect(eco.unlockHeroFree('mage')).toEqual({ ok: false, reason: 'progress' });
    eco.s.progress.unlocked = first.need - 1; expect(eco.heroUnlockQuote('mage').reason).toBe('progress');
    eco.s.progress.unlocked = first.need; eco.s.gems = first.gems - 1;
    q = eco.heroUnlockQuote('mage'); expect(q.reason).toBe('gems'); expect(eco.unlockHeroFree('mage')).toEqual({ ok: false, reason: 'gems' });
    expect(eco.s.gems).toBe(first.gems - 1); expect(eco.ownHero('mage')).toBe(false);
    eco.s.gems = first.gems; expect(eco.heroUnlockQuote('mage').canFree).toBe(true);
  });
  test('해금하면 보석을 쓰고 소유를 열며 다음 영웅은 한 단계 비싼 조건이 된다', () => {
    const eco = chosen('knight', { unlocked: HERO_FREE_UNLOCK[3].need, gems: 20000 });
    const order = ['mage', 'rogue', 'ranger', 'barbarian'];
    let spent = 0;
    order.forEach((id, i) => {
      const q = eco.heroUnlockQuote(id); expect(q).toMatchObject({ step: i, gems: HERO_FREE_UNLOCK[i].gems, need: HERO_FREE_UNLOCK[i].need });
      const before = eco.s.gems; expect(eco.unlockHeroFree(id)).toEqual({ ok: true, id, gems: HERO_FREE_UNLOCK[i].gems });
      spent += HERO_FREE_UNLOCK[i].gems; expect(eco.s.gems).toBe(before - HERO_FREE_UNLOCK[i].gems); expect(eco.ownHero(id)).toBe(true);
    });
    expect(spent).toBe(HERO_FREE_UNLOCK_TOTAL_GEMS);
    expect(eco.ownedHeroIds()).toEqual(HERO_ORDER);
    expect(eco.heroUnlockQuote('barbarian').reason).toBe('owned');
    expect(eco.unlockHeroFree('barbarian')).toEqual({ ok: false, reason: 'owned' });
  });
  test('결제로 연 영웅은 무료 해금 단계를 올리지 않는다', () => {
    const eco = chosen('knight', { unlocked: 60 });
    eco.applyIapState({ entitlements: { heroes: ['mage'] } });
    expect(eco.ownHero('mage')).toBe(true);
    expect(eco.heroUnlockQuote('rogue')).toMatchObject({ step: 0, gems: HERO_FREE_UNLOCK[0].gems });
  });
  test('저장이 실패하면 보석과 소유를 되돌린다', () => {
    const storage = createMemoryStorage(); const eco = new Economy({ storage });
    eco.chooseStarter('knight'); eco.s.progress.unlocked = 60; eco.s.gems = 5000;
    storage.setItem = () => { throw new Error('quota'); };
    expect(eco.unlockHeroFree('mage')).toEqual({ ok: false, reason: 'storage' });
    expect(eco.s.gems).toBe(5000); expect(eco.s.roster.owned).toEqual(['knight']); expect(eco.ownHero('mage')).toBe(false);
  });
  test('정책 1 은 무료 해금 대상이 없다', () => {
    expect(withStore(legacyRaw()).heroUnlockQuote('mage').reason).toBe('owned');
  });
});

describe('가챠', () => {
  test('미보유 영웅이 나오면 소유를 열지 않고 조각만 쌓는다', () => {
    const eco = new Economy({ storage: createMemoryStorage(), gachaRng: () => 0 });
    eco.chooseStarter('knight');
    const target = GACHA.featured; expect(eco.ownHero(target)).toBe(false);
    const before = eco.s.heroes[target].shards;
    const res = eco.rollResult('SSR', true);
    expect(res).toMatchObject({ type: 'hero', id: target, dup: false, locked: true, shards: GACHA.dupShards });
    expect(eco.s.heroes[target].shards).toBe(before + GACHA.dupShards);
    expect(eco.ownHero(target)).toBe(false);
    expect(eco.s.roster.owned).toEqual(['knight']);
  });
  test('보유 영웅은 지금처럼 중복 조각이고 locked 표시가 없다', () => {
    const eco = new Economy({ storage: createMemoryStorage(), gachaRng: () => 0 });
    eco.chooseStarter(GACHA.featured);
    const res = eco.rollResult('SSR', true);
    expect(res).toMatchObject({ dup: true, shards: GACHA.dupShards }); expect('locked' in res).toBe(false);
  });
  test('열 번 뽑아도 소유는 늘지 않고 해금 뒤에는 쌓인 조각이 그대로 남는다', () => {
    const eco = new Economy({ storage: createMemoryStorage(), gachaSeed: 5 });
    eco.chooseStarter('knight'); eco.s.tickets = 100;
    for (let i = 0; i < 6; i++) eco.pull(10);
    expect(eco.s.roster.owned).toEqual(['knight']);
    eco.s.progress.unlocked = 60; eco.s.gems = 99999;
    const shards = eco.s.heroes.mage.shards;
    expect(eco.unlockHeroFree('mage').ok).toBe(true); expect(eco.s.heroes.mage.shards).toBe(shards);
  });
});

describe('서버 권한(entitlements.heroes)', () => {
  test('paid 를 목록으로 교체하고 회수하면 잠금만 걸린다(데이터 보존)', () => {
    const eco = chosen('knight');
    eco.s.heroes.mage.level = 17; eco.s.heroes.mage.equip.weapon = null;
    expect(eco.applyIapState({ entitlements: { heroes: ['mage', 'rogue', 'ghost', 'mage'] } })).toEqual([]);
    expect(eco.s.roster.paid).toEqual(['mage', 'rogue']);
    expect(eco.ownHero('mage')).toBe(true); expect(eco.ownHero('rogue')).toBe(true);
    eco.s.selected = 'mage';
    // 같은 목록을 다시 받아도 변화가 없다
    eco.applyIapState({ entitlements: { heroes: ['rogue', 'mage'] } }); expect(eco.s.roster.paid).toEqual(['mage', 'rogue']);
    // 환불·회수: mage 만 빠진다
    eco.applyIapState({ entitlements: { heroes: ['rogue'] } });
    expect(eco.s.roster.paid).toEqual(['rogue']); expect(eco.ownHero('mage')).toBe(false);
    expect(eco.s.selected).toBe('knight'); expect(eco.s.heroes.mage.level).toBe(17);
    // 전부 회수
    eco.applyIapState({ entitlements: { heroes: [] } }); expect(eco.s.roster.paid).toEqual([]); expect(eco.ownHero('rogue')).toBe(false);
  });
  test('회수된 영웅의 원정 직업 선택도 풀린다', () => {
    const eco = chosen('knight'); const app: any = { eco }; app.expedition = new ExpeditionEconomy(eco);
    eco.applyIapState({ entitlements: { heroes: ['rogue'] } });
    eco.s.expedition.unlockedJobs = ['ranger']; eco.s.expedition.selectedJob = 'ranger'; eco.s.selected = 'rogue';
    eco.applyIapState({ entitlements: { heroes: [] } });
    expect(eco.s.expedition.selectedJob).toBeNull(); expect(eco.s.selected).toBe('knight');
  });
  test('entitlements.heroes 가 없으면 paid 는 그대로다', () => {
    const eco = chosen('knight'); eco.applyIapState({ entitlements: { heroes: ['mage'] } });
    eco.applyIapState({ entitlements: { adsRemoved: true } }); expect(eco.s.roster.paid).toEqual(['mage']);
  });
  test('저장이 실패하면 권한 적용을 되돌린다', () => {
    const storage = createMemoryStorage(); const eco = new Economy({ storage }); eco.chooseStarter('knight');
    storage.setItem = () => { throw new Error('quota'); };
    expect(eco.applyIapState({ entitlements: { heroes: ['mage'] } })).toBeNull(); expect(eco.s.roster.paid).toEqual([]);
  });
});

describe('미소유 영웅 차단', () => {
  const voice = audio.voice;
  test('meta.selectHero 는 미소유 영웅을 선택하지 않는다', () => {
    audio.voice = async () => {};
    try {
      const eco = chosen('knight'); const meta: any = Object.create(Meta.prototype);
      Object.assign(meta, { eco, app: { showcaseHero: () => {} }, ui: { toast: () => {} }, renderHeroes: () => {} });
      expect(meta.selectHero('mage')).toBe(false); expect(eco.s.selected).toBe('knight');
      eco.applyIapState({ entitlements: { heroes: ['mage'] } });
      expect(meta.selectHero('mage')).toBe(true); expect(eco.s.selected).toBe('mage');
    } finally { audio.voice = voice; }
  });
  test('원정 직업은 영웅을 소유해야 열고 고를 수 있으며 직업 해금이 영웅을 열지 않는다', () => {
    const eco = chosen('knight'); const ex = new ExpeditionEconomy(eco);
    ex.s.claimed.push('garden_scout');
    expect(ex.unlockJob('ranger')).toMatchObject({ ok: false }); expect(eco.ownHero('rogue')).toBe(false); expect(ex.s.unlockedJobs).not.toContain('ranger');
    ex.s.unlockedJobs.push('ranger'); // 예전 저장에서 이미 열린 직업
    expect(ex.selectJob('ranger')).toMatchObject({ ok: false }); expect(eco.s.selected).toBe('knight'); expect(ex.s.selectedJob).toBeNull();
    eco.applyIapState({ entitlements: { heroes: ['rogue'] } });
    expect(ex.selectJob('ranger')).toEqual({ ok: true }); expect(eco.s.selected).toBe('rogue');
  });
  test('arsenal 은 미소유 영웅의 기예·구성 저장·적용을 막는다', () => {
    const eco = chosen('knight'); const app: any = { eco, battle: { active: false }, expeditionUI: { result: null } };
    app.expedition = new ExpeditionEconomy(eco); app.masterworks = new MasterworksService(app); app.arsenal = new ArsenalService(app);
    expect(app.arsenal.setArt('aegis', 'mage').ok).toBe(false);
    expect(app.arsenal.savePreset(0, 'x', 'mage').ok).toBe(false);
    // 소유 중에 만든 구성이 회수 뒤 적용되지 않는다
    eco.applyIapState({ entitlements: { heroes: ['mage'] } });
    expect(app.arsenal.savePreset(0, 'x', 'mage').ok).toBe(true);
    eco.applyIapState({ entitlements: { heroes: [] } });
    const before = JSON.stringify(eco.s);
    expect(app.arsenal.applyPreset(0, 'mage').ok).toBe(false); expect(JSON.stringify(eco.s)).toBe(before); expect(eco.s.selected).toBe('knight');
  });
  test('v1-ops selectHero·equip·unequip 은 미소유 영웅에 실패한다', () => {
    const eco = chosen('knight'); eco.s.inventory.push({ uid: 5, id: 'w_storm', enh: 0 }); eco.s.invSeq = 6;
    expect(OPS.selectHero.run(eco, 'mage')).toBe(false); expect(eco.s.selected).toBe('knight');
    expect(OPS.equip.run(eco, 'mage', 5)).toBe(false); expect(eco.s.heroes.mage.equip.weapon).toBeNull();
    expect(OPS.unequip.run(eco, 'mage', 'weapon')).toBe(false);
    eco.applyIapState({ entitlements: { heroes: ['mage'] } });
    expect(OPS.selectHero.run(eco, 'mage')).toBe(true); expect(eco.s.selected).toBe('mage');
  });
  test('어떤 경로로도 미소유 영웅이 selected 가 되지 않는다(정화 포함)', () => {
    const base = JSON.parse(JSON.stringify(fresh().s));
    const s = normalizeSave({ ...base, selected: 'ranger', roster: { policy: 2, owned: ['knight'], starter: 'knight', starterChosen: true, paid: [] } }, base);
    expect(s.selected).toBe('knight');
  });
});

describe('v1-ops 새 명령', () => {
  test('chooseStarter / unlockHeroFree 는 id 문자열 하나만 받는다', () => {
    expect(validateOp('chooseStarter', ['mage'])).toBe(OPS.chooseStarter);
    expect(validateOp('unlockHeroFree', ['mage'])).toBe(OPS.unlockHeroFree);
    for (const op of ['chooseStarter', 'unlockHeroFree']) {
      expect(validateOp(op, [])).toBeNull(); expect(validateOp(op, [1])).toBeNull(); expect(validateOp(op, ['a', 'b'])).toBeNull(); expect(validateOp(op, ['bad id!'])).toBeNull();
    }
  });
  test('명령은 Economy 메서드를 그대로 호출하고 성공 판정은 ok 필드다', () => {
    const eco = fresh();
    const r1 = OPS.chooseStarter.run(eco, 'rogue'); expect(OPS.chooseStarter.ok(r1)).toBe(true); expect(eco.s.roster.starter).toBe('rogue');
    expect(OPS.chooseStarter.ok(OPS.chooseStarter.run(eco, 'mage'))).toBe(false);
    eco.s.progress.unlocked = 60; eco.s.gems = 9000;
    const r2 = OPS.unlockHeroFree.run(eco, 'mage'); expect(OPS.unlockHeroFree.ok(r2)).toBe(true); expect(eco.ownHero('mage')).toBe(true);
    expect(OPS.unlockHeroFree.ok(OPS.unlockHeroFree.run(eco, 'mage'))).toBe(false);
  });
});
