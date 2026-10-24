import { describe, expect, test } from 'bun:test';
import { EconomyCore } from '../src/game/economy-core.js';
import { HEROES, HERO_ORDER, kitOf } from '../src/data/heroes.js';
import { HERO_LEGACY_IDS } from '../src/data/hero-roster.js';
import { IAP_PRODUCTS, heroProductId, HERO_ALL_PRODUCT_ID } from '../src/shared/iap-catalog.js';
import { starterChoices } from '../src/ui/starter-select.js';
import { SKILLS, SKILL_AIM_SHAPES } from '../src/game/skills.js';
import { SKILL_VFX } from '../src/engine/skill-vfx.js';
import { SKILL_SIGNATURES, SKILL_PRELUDES } from '../src/engine/skill-signatures.js';
import { skillSound, heroSoundFiles, SKILL_SOUND_ALIAS, ultimateSound } from '../src/engine/combat-sound-library.js';
import { heroVoiceName } from '../src/engine/hero-voice.js';
import { weaponLook } from '../src/data/weapon-looks.js';
import { LOOKS } from '../src/game/look.js';
import { libraryAssetForHero, libraryAssetForAvatar } from '../src/engine/library-assets.js';
import { PARTY_HEROES } from '../src/party/protocol.js';
import { HERO_TRAITS, HERO_DIFFICULTY } from '../src/data/hero-traits.js';

const NOW = Date.UTC(2026, 10, 3);
const fresh = () => EconomyCore.fromState(null, { now: () => NOW, rng: () => 0.5 }).snapshot() as any;
const core = (roster: any) => EconomyCore.fromState({ ...fresh(), roster }, { now: () => NOW, rng: () => 0.5 }) as any;

describe('늑대인간 족장 소유 정책', () => {
  test('정책 1 저장은 원래 다섯만 소유하고 소환으로 해금하면 정규화 뒤에도 남는다', () => {
    const eco = core({ policy: 1 });
    expect(eco.ownHero('werewolf')).toBe(false);
    for (const id of HERO_LEGACY_IDS) expect(eco.ownHero(id)).toBe(true);
    const got = eco.grantHero('werewolf');
    expect(got.unlocked).toBe(true);
    expect(eco.ownHero('werewolf')).toBe(true);
    const again = EconomyCore.fromState(eco.snapshot(), { now: () => NOW, rng: () => 0.5 }) as any;
    expect(again.ownHero('werewolf')).toBe(true);
    expect(again.s.roster.owned).toContain('werewolf');
  });

  test('정책 2도 미소유 → 소환 해금 → 정규화 뒤 유지', () => {
    const eco = core({ policy: 2, owned: ['mage'], starter: 'mage', starterChosen: true, paid: [] });
    expect(eco.ownHero('werewolf')).toBe(false);
    expect(eco.grantHero('werewolf').unlocked).toBe(true);
    const again = EconomyCore.fromState(eco.snapshot(), { now: () => NOW, rng: () => 0.5 }) as any;
    expect(again.ownHero('werewolf')).toBe(true);
    expect(again.s.roster.owned).toEqual(['mage', 'werewolf']);
  });

  test('시작 후보에 없고 영웅 상품은 원래 다섯 + 전체 묶음뿐', () => {
    expect(starterChoices().map((c: any) => c.id)).not.toContain('werewolf');
    const heroSkus = IAP_PRODUCTS.filter((p: any) => /^hero_/.test(p.id)).map((p: any) => p.id).sort();
    expect(heroSkus).toEqual([...HERO_LEGACY_IDS.map(heroProductId), HERO_ALL_PRODUCT_ID].sort());
  });

  test('목록: 파티 입장·특성·난이도에 포함', () => {
    expect(HERO_ORDER).toContain('werewolf');
    expect(PARTY_HEROES).toContain('werewolf');
    expect(HERO_TRAITS.werewolf.role).toContain('생존형 딜러');
    expect(HERO_DIFFICULTY.werewolf).toBeGreaterThanOrEqual(HERO_DIFFICULTY.barbarian);
  });
});

describe('늑대인간 족장 외형·소리 조회는 kit(광전사) 표를 쓴다', () => {
  test('kitOf: kit 있으면 기준 영웅, 없으면 자기 id', () => {
    expect(kitOf('werewolf')).toBe('barbarian');
    expect(kitOf(HEROES.werewolf)).toBe('barbarian');
    expect(kitOf('mage')).toBe('mage');
    expect(kitOf(null)).toBe('');
  });

  test('LOOKS·무기 외형 조회가 예외 없이 광전사 표를 돌려준다', () => {
    expect((LOOKS as any)[kitOf(HEROES.werewolf)]).toBe(LOOKS.barbarian);
    const inst = { id: 'w_town_oath', enh: 0 };
    expect(() => weaponLook('werewolf', inst, LOOKS)).not.toThrow();
  });

  test('기본 몸은 늑대인간 아바타 몸이고 다른 영웅은 그대로다', () => {
    const body = libraryAssetForHero('werewolf');
    expect(body?.id).toBe('avatar_barbarian_werewolf');
    expect(body?.id).toBe(libraryAssetForAvatar(HEROES.werewolf.bodyAvatar)?.id);
    expect(libraryAssetForHero('barbarian')?.avatar).not.toBe(true);
  });

  test('소리: 고유 스킬 둘은 광전사 효과음을 빌리고 세트·보이스도 광전사 것', () => {
    expect(skillSound('blood_howl', 'werewolf')).toBe(skillSound('berserk', 'barbarian'));
    expect(skillSound('moonlit_hunt', 'werewolf')).toBe(skillSound('hell_axe', 'barbarian'));
    expect(SKILL_SOUND_ALIAS).toEqual({ blood_howl: 'berserk', moonlit_hunt: 'hell_axe' });
    expect(heroSoundFiles('werewolf')).toEqual(heroSoundFiles('barbarian'));
    expect(ultimateSound('werewolf')).toBe(ultimateSound('barbarian'));
    expect(heroVoiceName('werewolf', 'select')).toBe('hero_barbarian_select');
    expect(heroVoiceName('mage', 'select')).toBe('hero_mage_select');
  });
});

describe('늑대인간 족장 고유 스킬 표', () => {
  test('두 스킬이 SKILLS·조준 모양·연출·서명·소리 표에 모두 있다', () => {
    const ids = HEROES.werewolf.skills.filter((s: any) => ['blood_howl', 'moonlit_hunt'].includes(s.id)).map((s: any) => s.id);
    expect(ids).toEqual(['blood_howl', 'moonlit_hunt']);
    for (const id of ids) {
      expect((SKILLS as any)[id]).toBeTruthy();
      expect((SKILL_AIM_SHAPES as any)[id]).toBeTruthy();
      expect((SKILL_VFX as any)[id]).toBeTruthy();
      expect((SKILL_SIGNATURES as any)[id]).toBeInstanceOf(Function);
      expect(skillSound(id, 'werewolf')).toContain('/barbarian/skill_');
    }
    expect(SKILL_PRELUDES.moonlit_hunt).toBeInstanceOf(Function);
  });
});

describe('리뷰 반영: 소환 전용 영웅 해금 견적', () => {
  test('정책 1·정책 2 모두 미보유 늑대인간은 소환 안내(gacha)이고 무료 해금·구매가 없다', async () => {
    const { Economy } = await import('../src/game/economy.js');
    const { createMemoryStorage } = await import('../src/game/economy-core.js');
    const legacy: any = new Economy({ storage: createMemoryStorage() });
    legacy.s.roster = { policy: 1, owned: ['knight', 'barbarian', 'mage', 'rogue', 'ranger'], starter: null, starterChosen: true, paid: [] };
    expect(legacy.heroUnlockQuote('werewolf')).toMatchObject({ reason: 'gacha', canFree: false, owned: false });
    const fresh: any = new Economy({ storage: createMemoryStorage() });
    expect(fresh.chooseStarter('mage').ok).toBe(true);
    expect(fresh.heroUnlockQuote('werewolf')).toMatchObject({ reason: 'gacha', canFree: false });
  });
});
