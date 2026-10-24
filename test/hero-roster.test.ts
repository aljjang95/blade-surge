import { describe, expect, test } from 'bun:test';
import { Economy, heroPickup } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { ArsenalService } from '../src/game/arsenal-service.js';
import { MasterworksService } from '../src/game/masterworks-service.js';
import { createMemoryStorage } from '../src/game/economy-core.js';
import { normalizeSave } from '../src/game/save.js';
import { HEROES, HERO_ORDER, levelExp } from '../src/data/heroes.js';
import { JOBS } from '../src/data/expansion.js';
import { GACHA } from '../src/data/shop.js';
import { GACHA_MILEAGE } from '../src/data/gacha-banners.js';
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
  test('보석 해금 사다리는 닫혔다: 진행·보석이 충분해도 사유 gacha이고 상태는 그대로다(영웅은 소환으로만)', () => {
    const eco = chosen('knight', { unlocked: 60, gems: 99999 });
    const before = JSON.stringify(eco.s);
    for (const id of ['mage', 'rogue', 'ranger', 'barbarian']) {
      expect(eco.heroUnlockQuote(id)).toMatchObject({ reason: 'gacha', canFree: false, owned: false });
      expect(eco.unlockHeroFree(id)).toEqual({ ok: false, reason: 'gacha' });
    }
    expect(JSON.stringify(eco.s)).toBe(before);
    expect(eco.heroUnlockQuote('knight').reason).toBe('owned'); expect(eco.heroUnlockQuote('ghost').reason).toBe('unknown');
  });
  test('소환 첫 획득은 해금(조각 0)이고 같은 영웅을 또 뽑으면 조각 +40이다', () => {
    const eco = chosen('knight', { unlocked: 1, gems: 0 }); eco.gachaRng = () => 0; // SR 영웅 칸의 첫 후보(mage)
    const first = eco.rollResult('SR');
    expect(first).toMatchObject({ type: 'hero', id: 'mage', dup: false, unlocked: true, shards: 0 });
    expect(eco.ownHero('mage')).toBe(true); expect(eco.s.roster.owned).toEqual(['knight', 'mage']); expect(eco.s.heroes.mage.shards).toBe(0);
    const again = eco.rollResult('SR');
    expect(again).toMatchObject({ id: 'mage', dup: true, shards: GACHA.dupShards }); expect('unlocked' in again).toBe(false);
    expect(eco.s.heroes.mage.shards).toBe(GACHA.dupShards);
    expect(eco.s.roster.owned).toEqual(['knight', 'mage']);
  });
  test('결제로 연 영웅은 소환 규칙을 바꾸지 않는다(결제 권한은 소유로 보이고 다른 영웅은 여전히 소환으로만)', () => {
    const eco = chosen('knight', { unlocked: 60 });
    eco.applyIapState({ entitlements: { heroes: ['mage'] } });
    expect(eco.ownHero('mage')).toBe(true); expect(eco.heroUnlockQuote('mage').reason).toBe('owned');
    expect(eco.heroUnlockQuote('rogue')).toMatchObject({ reason: 'gacha', step: 0 });
  });
  test('저장이 실패하면 소환·마일리지 교환의 소유·보석·조각이 되돌아간다', () => {
    const storage = createMemoryStorage(); const eco = new Economy({ storage, gachaRng: () => 0 });
    eco.chooseStarter('mage'); eco.s.gems = 5000; eco.gachaState().mileage = GACHA_MILEAGE.cost;
    const before = JSON.stringify(eco.s);
    storage.setItem = () => { throw new Error('quota'); };
    expect(eco.exchangeMileage()).toBeNull(); expect(eco.lastGachaError).toBe('storage');
    expect(eco.pull(10)).toBeNull(); expect(eco.lastGachaError).toBe('storage');
    expect(JSON.stringify(eco.s)).toBe(before); expect(eco.s.roster.owned).toEqual(['mage']); expect(eco.ownHero(heroPickup())).toBe(false);
  });
  test('정책 1 은 무료 해금 대상이 없다', () => {
    expect(withStore(legacyRaw()).heroUnlockQuote('mage').reason).toBe('owned');
  });
});

describe('가챠', () => {
  test('시작 영웅을 고르기 전에는 해금하지 않고 조각만 쌓는다', () => {
    const eco = new Economy({ storage: createMemoryStorage(), gachaRng: () => 0 });
    const target = 'barbarian'; expect(eco.s.roster.starterChosen).toBe(false); expect(eco.ownHero(target)).toBe(false);
    const before = eco.s.heroes[target].shards;
    const res = eco.rollResult('SSR', { featured: target });
    expect(res).toMatchObject({ type: 'hero', id: target, dup: false, locked: true, shards: GACHA.dupShards });
    expect(eco.s.heroes[target].shards).toBe(before + GACHA.dupShards);
    expect(eco.ownHero(target)).toBe(false); expect(eco.s.roster.owned).toEqual(['knight']);
  });
  test('시작 영웅을 고른 뒤 미보유 픽업 SSR 첫 획득은 해금(조각 0)이다', () => {
    const eco = new Economy({ storage: createMemoryStorage(), gachaRng: () => 0 });
    eco.chooseStarter('mage'); const target = heroPickup(); expect(eco.ownHero(target)).toBe(false);
    const res = eco.rollResult('SSR');
    expect(res).toMatchObject({ type: 'hero', id: target, dup: false, unlocked: true, shards: 0, featured: true }); expect('locked' in res).toBe(false);
    expect(eco.ownHero(target)).toBe(true); expect(eco.s.roster.owned).toEqual(['mage', target]);
    expect(eco.s.heroes[target].shards).toBe(0);
  });
  test('보유 영웅은 중복 조각이고 locked 표시가 없다', () => {
    const eco = new Economy({ storage: createMemoryStorage(), gachaRng: () => 0 });
    eco.chooseStarter(heroPickup());
    const res = eco.rollResult('SSR');
    expect(res).toMatchObject({ dup: true, shards: GACHA.dupShards }); expect('locked' in res).toBe(false); expect('unlocked' in res).toBe(false);
  });
  test('열 번씩 뽑으면 소유가 늘고(중복 없이 정렬 유지) 해금 전에 쌓인 조각은 그대로 남는다', () => {
    const eco = new Economy({ storage: createMemoryStorage(), gachaSeed: 5 });
    eco.chooseStarter('knight'); eco.s.tickets = 0; eco.s.gems = 99999; eco.s.heroes.mage.shards = 77;
    for (let i = 0; i < 6; i++) expect(eco.pull(10)).not.toBeNull();
    const owned = eco.s.roster.owned;
    expect(owned.length).toBeGreaterThan(1); expect(new Set(owned).size).toBe(owned.length); expect(owned[0]).toBe('knight');
    // 해금은 조각을 지우지 않는다: 미보유 상태에서 쌓은 조각 77은 첫 획득 뒤에도 남는다(중복이 더 나오면 40씩 늘 뿐 줄지 않는다).
    if (eco.ownHero('mage')) expect(eco.s.heroes.mage.shards).toBeGreaterThanOrEqual(77);
    else expect(eco.heroUnlockQuote('mage').reason).toBe('gacha');
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

describe('미소유 영웅 성장·장비·외형 명령 차단', () => {
  /** 명령 전후로 영웅 상태·재화가 바뀌지 않았는지 본다(거절은 부작용이 없어야 한다). */
  const snap = (eco: any, id = 'mage') => JSON.stringify([eco.s.heroes[id], eco.s.gold, eco.s.gems, eco.s.transcendStones, eco.s.skillResets, eco.s.avatars.equipped, eco.s.avatars.showGear]);

  test('신규 저장의 미소유 영웅은 성장·장비·외형 명령을 모두 거절하고 아무것도 바꾸지 않는다', () => {
    const eco = chosen('knight'); eco.s.gold = 99999999; eco.s.transcendStones = 99; eco.s.heroes.mage.shards = 9999; eco.s.heroes.mage.level = 30;
    eco.s.skillResets = 5;
    const uid = eco.addItem('N', 'weapon').uid; eco.s.avatars.owned.push('avatar_mage_astral');
    const before = snap(eco);
    eco.s.heroes.mage.exp = Math.ceil(levelExp(30) / 2); // 사냥으로 절반을 채워도 미소유면 막힌다
    const b2 = snap(eco);
    const r = {
      levelUpHero: eco.levelUpHero('mage'), promoteHero: eco.promoteHero('mage'), transcend: eco.transcend('mage'),
      learnSkill: eco.learnSkill('mage', 1), resetSkills: eco.resetSkills('mage', { useGems: true }),
      setSkillLoadout: eco.setSkillLoadout('mage', 0, 4), equip: eco.equip('mage', uid), unequip: eco.unequip('mage', 'weapon'),
      equipAvatar: eco.equipAvatar('mage', 'avatar_mage_astral'), setShowGear: eco.setShowGear('mage', true),
    };
    expect(r.levelUpHero).toBe(false); expect(eco.lastTrainingError).toBe('locked');
    expect(r.promoteHero).toBe(false);
    expect(r.transcend).toEqual({ ok: false, reason: 'locked' });
    expect(r.learnSkill).toEqual({ ok: false, reason: 'locked' });
    expect(r.resetSkills).toEqual({ ok: false, reason: 'locked' });
    expect(r.setSkillLoadout).toBe(false);
    expect(r.equip).toBe(false); expect(r.unequip).toBe(false);
    expect(r.equipAvatar).toEqual({ ok: false, reason: 'locked' });
    expect(r.setShowGear).toEqual({ ok: false, reason: 'locked' });
    expect(snap(eco)).toBe(b2); expect(before).not.toBe(b2);
    expect(eco.s.heroes.mage.equip.weapon).toBeNull();
    expect(eco.trainingQuote('mage')).toMatchObject({ ok: false, reason: 'locked' });
  });

  test('시작 영웅은 그대로 성장·장비가 된다(차단은 미소유에만 적용)', () => {
    const eco = chosen('knight'); const hero = eco.s.heroes.knight;
    hero.level = 30; hero.exp = Math.ceil(levelExp(30) / 2); eco.s.gold = 99999999; hero.shards = 9999;
    expect(eco.levelUpHero('knight')).toBe(true); expect(hero.level).toBe(31);
    expect(eco.promoteHero('knight')).toBe(true);
    const uid = eco.addItem('N', 'weapon').uid;
    eco.equip('knight', uid); expect(hero.equip.weapon).toBe(uid);
    expect(eco.unequip('knight', 'weapon') !== false).toBe(true); expect(hero.equip.weapon).toBeNull();
    eco.s.avatars.owned.push('avatar_knight_sakura');
    expect(eco.equipAvatar('knight', 'avatar_knight_sakura').ok).toBe(true);
  });

  test('소환 해금 직후에는 같은 명령이 허용된다', () => {
    const eco = chosen('knight'); eco.gachaRng = () => 0; eco.s.heroes.mage.level = 30; eco.s.gold = 99999999; eco.s.heroes.mage.shards = 9999;
    eco.s.heroes.mage.exp = Math.ceil(levelExp(30) / 2);
    const uid = eco.addItem('N', 'weapon').uid; eco.s.avatars.owned.push('avatar_mage_astral');
    expect(eco.levelUpHero('mage')).toBe(false); expect(eco.equipAvatar('mage', 'avatar_mage_astral').ok).toBe(false);
    expect(eco.unlockHeroFree('mage').ok).toBe(false); // 보석 해금은 닫혔다
    expect(eco.rollResult('SR')).toMatchObject({ id: 'mage', unlocked: true }); expect(eco.s.heroes.mage.shards).toBe(9999);
    eco.s.heroes.mage.exp = Math.ceil(levelExp(30) / 2);
    expect(eco.levelUpHero('mage')).toBe(true); expect(eco.s.heroes.mage.level).toBe(31);
    expect(eco.promoteHero('mage')).toBe(true);
    eco.equip('mage', uid); expect(eco.s.heroes.mage.equip.weapon).toBe(uid);
    expect(eco.equipAvatar('mage', 'avatar_mage_astral').ok).toBe(true);
    expect(eco.setShowGear('mage', true).ok).toBe(true);
  });

  test('결제 권한(entitlements.heroes)으로 열린 영웅도 허용되고 회수되면 다시 거절한다', () => {
    const eco = chosen('knight'); eco.s.gold = 99999999; eco.s.heroes.rogue.level = 30;
    eco.applyIapState({ entitlements: { heroes: ['rogue'] } });
    eco.s.heroes.rogue.exp = Math.ceil(levelExp(30) / 2);
    expect(eco.levelUpHero('rogue')).toBe(true);
    eco.applyIapState({ entitlements: { heroes: [] } });
    eco.s.heroes.rogue.exp = Math.ceil(levelExp(31) / 2);
    expect(eco.levelUpHero('rogue')).toBe(false); expect(eco.s.heroes.rogue.level).toBe(31);
  });

  test('기존 저장(정책 1)의 다섯 영웅은 전부 그대로 성장·장비가 된다', () => {
    const eco = withStore(legacyRaw((r) => { r.gold = 99999999; r.gems = 5000; }));
    const out: Record<string, boolean[]> = {};
    for (const id of IDS) {
      const h = eco.s.heroes[id]; h.level = 20; h.exp = Math.ceil(levelExp(20) / 2); h.shards = 9999;
      const uid = eco.addItem('N', 'weapon').uid;
      out[id] = [eco.levelUpHero(id) === true, eco.promoteHero(id) === true, eco.equip(id, uid) !== false && h.equip.weapon === uid,
        eco.unequip(id, 'weapon') !== false && h.equip.weapon === null, eco.setShowGear(id, true).ok === true, eco.learnSkill(id, 1).reason !== 'locked'];
    }
    for (const id of IDS) expect(out[id]).toEqual([true, true, true, true, true, true]);
    expect(eco.s.roster.policy).toBe(HERO_POLICY.LEGACY);
  });

  test('상점 아바타는 미소유 영웅이면 구매 전에 막아 보석을 쓰지 않는다', async () => {
    const eco = chosen('knight'); eco.s.gems = 99999; const toasts: string[] = [];
    const meta: any = Object.create(Meta.prototype);
    Object.assign(meta, { eco, app: { showcaseHero: () => {} }, ui: { toast: (m: string) => toasts.push(m), confirm: async () => true }, renderShop: () => {}, refreshTop: () => {} });
    await meta.buyOrEquipAvatar('avatar_mage_astral');
    expect(eco.s.gems).toBe(99999); expect(eco.s.avatars.owned).not.toContain('avatar_mage_astral'); expect(toasts.at(-1)).toContain('영웅을 먼저 해금');
    eco.applyIapState({ entitlements: { heroes: ['mage'] } });
    await meta.buyOrEquipAvatar('avatar_mage_astral');
    expect(eco.s.avatars.owned).toContain('avatar_mage_astral'); expect(eco.s.avatars.equipped.mage).toBe('avatar_mage_astral');
  });

  test('원정 직업(전직)은 미소유 영웅이면 열지도 고르지도 못한다', () => {
    const eco = chosen('knight'); const ex = new ExpeditionEconomy(eco);
    const job = JOBS.find((j: any) => j.heroId !== 'knight')!;
    expect(ex.selectJob(job.id).ok).toBe(false); expect(ex.unlockJob(job.id).ok).toBe(false);
    expect(eco.s.selected).toBe('knight');
  });

  test('v1-ops 영웅 지정 명령은 미소유에 실패하고 해금 뒤에는 성공한다', () => {
    const eco = chosen('knight'); eco.s.gold = 99999999; eco.s.heroes.mage.level = 30; eco.s.heroes.mage.shards = 9999;
    const uid = eco.addItem('N', 'weapon').uid; eco.s.avatars.owned.push('avatar_mage_astral');
    eco.s.heroes.mage.exp = Math.ceil(levelExp(30) / 2);
    const calls: [string, unknown[]][] = [['levelUpHero', ['mage']], ['promoteHero', ['mage']], ['transcend', ['mage']], ['learnSkill', ['mage', 1]],
      ['resetSkills', ['mage', true]], ['setSkillLoadout', ['mage', 0, 4]], ['selectHero', ['mage']], ['equip', ['mage', uid]], ['unequip', ['mage', 'weapon']],
      ['equipAvatar', ['mage', 'avatar_mage_astral']]];
    for (const [op, args] of calls) {
      const def = validateOp(op, args)!; expect(def).toBe((OPS as any)[op]);
      expect(def.ok(def.run(eco, ...args))).toBe(false);
    }
    expect(eco.s.heroes.mage.level).toBe(30);
    eco.applyIapState({ entitlements: { heroes: ['mage'] } });
    for (const op of ['levelUpHero', 'promoteHero', 'equip', 'equipAvatar']) {
      const [, args] = calls.find(([name]) => name === op)!; const def = (OPS as any)[op];
      expect(def.ok(def.run(eco, ...args))).toBe(true);
    }
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
    // 보석 해금 명령은 남아 있지만 소환으로만 획득하므로 실패한다.
    expect(OPS.unlockHeroFree.ok(OPS.unlockHeroFree.run(eco, 'mage'))).toBe(false); expect(eco.ownHero('mage')).toBe(false);
    // 소환 명령이 같은 규칙으로 영웅을 해금한다(결과 배열이 성공 값).
    eco.s.tickets = 10; eco.gachaRng = () => 0;
    const r2 = OPS.pull.run(eco, 1, 'hero'); expect(OPS.pull.ok(r2)).toBe(true); expect(eco.s.tickets).toBe(9);
    expect(OPS.pull.ok(OPS.pull.run(eco, 5, 'hero'))).toBe(false);
  });
});
