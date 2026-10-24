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
import { Player } from '../src/game/player.js';

const NOW = Date.UTC(2026, 10, 12);
const fresh = () => EconomyCore.fromState(null, { now: () => NOW, rng: () => 0.5 }).snapshot() as any;
const core = (roster: any) => EconomyCore.fromState({ ...fresh(), roster }, { now: () => NOW, rng: () => 0.5 }) as any;

describe('검은 고양이 사냥꾼 소유 정책', () => {
  test('정책 1 저장은 원래 다섯만 소유하고 소환으로 해금하면 정규화 뒤에도 남는다', () => {
    const eco = core({ policy: 1 });
    expect(eco.ownHero('blackcat')).toBe(false);
    for (const id of HERO_LEGACY_IDS) expect(eco.ownHero(id)).toBe(true);
    const got = eco.grantHero('blackcat');
    expect(got.unlocked).toBe(true);
    const again = EconomyCore.fromState(eco.snapshot(), { now: () => NOW, rng: () => 0.5 }) as any;
    expect(again.ownHero('blackcat')).toBe(true);
    expect(again.s.roster.owned).toContain('blackcat');
  });

  test('정책 2도 미소유 → 소환 해금 → 정규화 뒤 유지', () => {
    const eco = core({ policy: 2, owned: ['mage'], starter: 'mage', starterChosen: true, paid: [] });
    expect(eco.ownHero('blackcat')).toBe(false);
    expect(eco.grantHero('blackcat').unlocked).toBe(true);
    const again = EconomyCore.fromState(eco.snapshot(), { now: () => NOW, rng: () => 0.5 }) as any;
    expect(again.s.roster.owned).toEqual(['mage', 'blackcat']);
  });

  test('시작 후보에 없고 영웅 상품은 원래 다섯 + 전체 묶음뿐, 소환 전용 표시', () => {
    expect(starterChoices().map((c: any) => c.id)).not.toContain('blackcat');
    const heroSkus = IAP_PRODUCTS.filter((p: any) => /^hero_/.test(p.id)).map((p: any) => p.id).sort();
    expect(heroSkus).toEqual([...HERO_LEGACY_IDS.map(heroProductId), HERO_ALL_PRODUCT_ID].sort());
    expect((HEROES.blackcat as any).gachaOnly).toBe(true);
    expect(HEROES.blackcat.rarity).toBe('SSR');
  });

  test('목록: 영웅 순서 맨 뒤·파티 입장·특성·난이도(원거리 첫 SSR)', () => {
    expect(HERO_ORDER[HERO_ORDER.length - 1]).toBe('blackcat');
    expect(PARTY_HEROES).toContain('blackcat');
    expect(HERO_TRAITS.blackcat.role).toBe('원거리 저주 · 단일 화력 사수');
    expect(HERO_TRAITS.blackcat.line.length).toBeGreaterThan(0);
    expect(HERO_TRAITS.blackcat.intro.length).toBeGreaterThan(0);
    expect(HERO_DIFFICULTY.blackcat).toBe(3);
    expect(HEROES.blackcat.ranged).toBe(true);
  });
});

describe('검은 고양이 사냥꾼 외형·소리 조회는 kit(명사수) 표를 쓴다', () => {
  test('kitOf: 명사수 기준', () => {
    expect(kitOf('blackcat')).toBe('ranger');
    expect(kitOf(HEROES.blackcat)).toBe('ranger');
  });

  test('LOOKS·무기 외형 조회가 예외 없이 명사수 표를 돌려준다', () => {
    expect((LOOKS as any)[kitOf(HEROES.blackcat)]).toBe(LOOKS.ranger);
    expect(() => weaponLook('blackcat', { id: 'w_town_oath', enh: 0 }, LOOKS)).not.toThrow();
  });

  test('기본 몸은 검은 고양이 아바타 몸이고 명사수는 그대로다', () => {
    const body = libraryAssetForHero('blackcat');
    expect(body?.id).toBe('avatar_ranger_blackcat');
    expect(body?.id).toBe(libraryAssetForAvatar(HEROES.blackcat.bodyAvatar)?.id);
    expect(libraryAssetForHero('ranger')?.avatar).not.toBe(true);
  });

  test('소리: 고유 스킬 둘은 명사수 효과음을 빌리고 세트·보이스도 명사수 것', () => {
    expect(skillSound('cat_omen', 'blackcat')).toBe(skillSound('ranger_volley', 'ranger'));
    expect(skillSound('nine_lives', 'blackcat')).toBe(skillSound('ranger_tempest', 'ranger'));
    expect(SKILL_SOUND_ALIAS).toMatchObject({ cat_omen: 'ranger_volley', nine_lives: 'ranger_tempest' });
    expect(heroSoundFiles('blackcat')).toEqual(heroSoundFiles('ranger'));
    expect(ultimateSound('blackcat')).toBe(ultimateSound('ranger'));
    expect(heroVoiceName('blackcat', 'select')).toBe('hero_ranger_select');
  });
});

describe('검은 고양이 사냥꾼 고유 스킬 표', () => {
  const ids = ['cat_omen', 'nine_lives'];
  test('명사수 스킬 여섯은 공유하고 삼중 추적화살·폭풍의 일곱 화살 자리만 바뀐다', () => {
    const own = HEROES.blackcat.skills.map((s: any) => s.id), base = HEROES.ranger.skills.map((s: any) => s.id);
    expect(own).toEqual(base.map((id: string) => id === 'ranger_volley' ? 'cat_omen' : id === 'ranger_tempest' ? 'nine_lives' : id));
    expect(HEROES.blackcat.skills.filter((s: any) => s.ult).map((s: any) => s.id)).toEqual(['nine_lives']);
  });
  test('두 스킬이 SKILLS·조준 모양·연출·서명·소리 표에 모두 있고 보라색이다', () => {
    for (const id of ids) {
      expect((SKILLS as any)[id]).toBeTruthy();
      expect((SKILL_AIM_SHAPES as any)[id]).toBeTruthy();
      expect((SKILL_VFX as any)[id]).toBeTruthy();
      expect((SKILL_VFX as any)[id].color).toBe(0xb070ff);
      expect((SKILL_SIGNATURES as any)[id]).toBeInstanceOf(Function);
      expect(skillSound(id, 'blackcat')).toContain('/ranger/skill_');
    }
    expect(SKILL_PRELUDES.nine_lives).toBeInstanceOf(Function);
  });
  test('궁극기만 전장 장악 연출 대상', async () => {
    const { MAJOR_SKILL_IDS } = await import('../src/engine/skill-vfx.js');
    expect(MAJOR_SKILL_IDS.has('nine_lives')).toBe(true);
    expect(MAJOR_SKILL_IDS.has('cat_omen')).toBe(false);
  });
});

describe('검은 고양이 사냥꾼 집중(직업 자원)', () => {
  test('jobId ranger 라 집중이 쌓이고 3에서 멈춘다', () => {
    expect((HEROES.blackcat as any).jobId).toBe('ranger');
    // Player.gainJobResource 와 같은 규칙: jobId 가 없으면 무시, 있으면 최대 3.
    const gain = (Player as any).prototype.gainJobResource;
    const self: any = { def: HEROES.blackcat, jobResource: 0, game: { ui: { toast() {} } } };
    for (let i = 0; i < 5; i++) gain.call(self, 1);
    expect(self.jobResource).toBe(3);
  });
});

describe('소환 전용 영웅 해금 견적', () => {
  test('정책 1·정책 2 모두 미보유 검은 고양이는 소환 안내(gacha)이고 무료 해금·구매가 없다', async () => {
    const { Economy } = await import('../src/game/economy.js');
    const { createMemoryStorage } = await import('../src/game/economy-core.js');
    const legacy: any = new Economy({ storage: createMemoryStorage() });
    legacy.s.roster = { policy: 1, owned: ['knight', 'barbarian', 'mage', 'rogue', 'ranger'], starter: null, starterChosen: true, paid: [] };
    expect(legacy.heroUnlockQuote('blackcat')).toMatchObject({ reason: 'gacha', canFree: false, owned: false });
    const fresh: any = new Economy({ storage: createMemoryStorage() });
    expect(fresh.chooseStarter('mage').ok).toBe(true);
    expect(fresh.heroUnlockQuote('blackcat')).toMatchObject({ reason: 'gacha', canFree: false });
  });
});

describe('배너 그림', () => {
  test('치비가 없으면 아바타 초상으로 대체(늑대인간과 같은 방식)', async () => {
    const { heroBannerArt } = await import('../src/data/banner-art.js');
    expect(heroBannerArt('blackcat', HEROES.blackcat.portrait)).toEqual({ src: '/img/tll/avatars/avatar_ranger_blackcat-v1.webp', kind: 'fallback' });
  });
});
