import { describe, expect, test } from 'bun:test';
import { CHAPTERS, ENEMIES, STAGES_PER_CHAPTER, stageDef } from '../src/data/stages.js';
import { CAMPAIGN_TOWNS, CAMPAIGN_TOWN_COUNT, campaignTown, campaignTownMusic, latestTownChapter, regionUnlockedBy, resolveCampaignTown } from '../src/data/campaign-towns.js';
import { musicForScene } from '../src/data/music.js';

const enemies = ENEMIES as Record<string, any>;
const all = CHAPTERS.flatMap(chapter => Array.from({ length: STAGES_PER_CHAPTER }, (_, i) => stageDef(chapter.id, i + 1))) as any[];

describe('캠페인 구성: 지역마다 관문 1-10, X-5 중간 보스, X-10 지역 보스', () => {
  test('모든 지역은 정확히 10개 관문이고 번호가 1부터 연속이다', () => {
    expect(STAGES_PER_CHAPTER).toBe(10);
    expect(CHAPTERS.map(c => c.id)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const chapter of CHAPTERS) {
      const stages = all.filter(s => s.ch === chapter.id);
      expect(stages.map(s => s.st)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(stages.map(s => s.code)).toEqual(Array.from({ length: 10 }, (_, i) => `${chapter.id}-${i + 1}`));
      expect(() => stageDef(chapter.id, 11)).toThrow(RangeError);
    }
    expect(all.map(s => s.idx)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
  });

  test('X-5 만 중간 보스, X-10 만 지역 보스 표식을 갖고 보스 적 계약과 일치한다', () => {
    for (const chapter of CHAPTERS) {
      for (let st = 1; st <= 10; st++) {
        const stage = stageDef(chapter.id, st) as any;
        expect(stage.midboss).toBe(st === 5);
        expect(stage.regionBoss).toBe(st === 10);
        if (st === 5) { expect(stage.encounter.rank).toBe('midboss'); expect(stage.boss).toBe(true); }
        if (st === 10) { expect(stage.encounter.rank).toBe('finalboss'); expect(stage.boss).toBe(true); expect(stage.encounter.enemyId).toBe(chapter.boss); }
        if (st !== 5 && st !== 10) { expect(stage.midboss).toBe(false); expect(stage.regionBoss).toBe(false); }
      }
    }
    expect(all.filter(s => s.midboss).map(s => s.code)).toEqual(['1-5', '2-5', '3-5', '4-5', '5-5', '6-5']);
    expect(all.filter(s => s.regionBoss).map(s => s.code)).toEqual(['1-10', '2-10', '3-10', '4-10', '5-10', '6-10']);
  });

  test('X-10 을 클리어하면 다음 지역이 열린다고 데이터가 말한다(마지막 지역 제외)', () => {
    expect(all.filter(s => s.unlocksChapter).map(s => `${s.code}->${s.unlocksChapter}`)).toEqual(['1-10->2', '2-10->3', '3-10->4', '4-10->5', '5-10->6']);
    expect(regionUnlockedBy(stageDef(2, 10))?.name).toBe(campaignTown(3).name);
    expect(regionUnlockedBy(stageDef(2, 9))).toBeNull();
    expect(regionUnlockedBy(stageDef(6, 10))).toBeNull();
  });

  test('난이도 곡선: 관문 배율은 매끄럽게 오르고 보스 실효 체력은 5 → 10 → 다음 지역 5 순으로 단조 증가한다', () => {
    for (let i = 1; i < all.length; i++) {
      expect(all[i].scale).toBeGreaterThan(all[i - 1].scale);
      expect(all[i].scale / all[i - 1].scale).toBeLessThanOrEqual(1.120001);
    }
    // 보스 실효 체력(기본 체력 x 층 배율): 같은 계급끼리는 지역마다 반드시 오르고, 5 → 10 → 다음 5 로 이어질 때
    // 20층 이후 배율 증가가 완만(층당 약 4.5%)해 지역 보스(계급 체력 53,200) → 다음 지역 중간 보스(45,200)로 넘어갈 때
    // 3-10 이후 구간에서 최대 8% 내려갈 수 있다. 의도된 완급이며 그보다 큰 하락은 곡선 결함으로 본다.
    for (const kind of ['midboss', 'regionBoss'] as const) {
      const series = all.filter(s => s[kind]).map(s => enemies[s.encounter.enemyId].hp * s.scale);
      for (let i = 1; i < series.length; i++) expect(series[i]).toBeGreaterThan(series[i - 1]);
    }
    const bosses = all.filter(s => s.midboss || s.regionBoss).map(s => ({ hp: enemies[s.encounter.enemyId].hp * s.scale, atk: enemies[s.encounter.enemyId].atk * s.scale }));
    for (let i = 1; i < bosses.length; i++) { expect(bosses[i].hp).toBeGreaterThan(bosses[i - 1].hp * .92); expect(bosses[i].atk).toBeGreaterThan(bosses[i - 1].atk * .92); }
    // 같은 지역 안에서 중간 보스는 직전 관문 대장보다, 지역 보스는 중간 보스보다 실효 체력이 높다.
    for (const chapter of CHAPTERS) {
      const hp = (st: number) => { const s = stageDef(chapter.id, st) as any; return enemies[s.encounter.enemyId].hp * s.scale; };
      expect(hp(5)).toBeGreaterThan(hp(4)); expect(hp(10)).toBeGreaterThan(hp(5)); expect(hp(10)).toBeGreaterThan(hp(9));
    }
  });

  test('보상 의미는 그대로다: 에너지·별·첫 클리어 보석·티켓 마일스톤', () => {
    expect(all.every(s => s.energy >= 6)).toBe(true);
    expect(all.filter(s => s.rewards.firstGems === 300).map(s => s.code)).toEqual(['1-10', '2-10', '3-10', '4-10', '5-10', '6-10']);
    expect(all.filter(s => s.rewards.firstGems === 150).map(s => s.st).every(st => [3, 5, 7].includes(st))).toBe(true);
  });
});

describe('캠페인 마을 데이터', () => {
  test('지역 수와 같은 6개 마을이 있고 1지역만 원형 성채(스킨 없음)다', () => {
    expect(CAMPAIGN_TOWN_COUNT).toBe(CHAPTERS.length);
    expect(CAMPAIGN_TOWNS.map((t: any) => t.chapter)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(CAMPAIGN_TOWNS[0].skin).toBeNull();
    expect(new Set(CAMPAIGN_TOWNS.map((t: any) => t.id)).size).toBe(6);
    expect(new Set(CAMPAIGN_TOWNS.map((t: any) => t.name)).size).toBe(6);
  });

  test('2~6지역 마을은 팔레트·하늘·조명·풍경이 서로 모두 다르다', () => {
    const skins = CAMPAIGN_TOWNS.filter((t: any) => t.chapter > 1) as any[];
    expect(skins).toHaveLength(5);
    for (const key of ['stone', 'ivory', 'gold', 'teal']) expect(new Set(skins.map(t => t.palette[key])).size).toBe(5);
    expect(new Set(skins.map(t => t.atmosphere.bg)).size).toBe(5);
    expect(new Set(skins.map(t => t.atmosphere.sun)).size).toBe(5);
    expect(new Set(skins.map(t => t.sky.horizon)).size).toBe(5);
    expect(new Set(skins.map(t => t.scenery)).size).toBe(5);
    for (const t of skins) { expect(t.name.length).toBeGreaterThan(2); expect(t.waystone).toBeGreaterThan(0); expect(t.accent).toMatch(/^#[0-9a-f]{6}$/); }
  });

  test('로비 배경음은 1지역 마을에서 기존 로비 곡 그대로이고 2지역부터 그 지역 곡이다', () => {
    expect(campaignTownMusic(1)).toBe('regions/lobby');
    expect([2, 3, 4, 5, 6].map(campaignTownMusic)).toEqual(['regions/forge', 'regions/frost', 'regions/tide', 'regions/crown', 'regions/homecoming']);
    expect(musicForScene({ scene: 'lobby' })).toBe('regions/lobby');
  });

  test('해금한 가장 먼 지역은 progress.unlocked 에서 계산한다', () => {
    const at = (unlocked: number) => latestTownChapter({ unlocked });
    expect([1, 9, 10].map(at)).toEqual([1, 1, 1]);
    expect([11, 20, 21, 51, 59, 60].map(at)).toEqual([2, 2, 3, 6, 6, 6]);
    expect([0, -4, NaN, undefined, 999].map(v => latestTownChapter({ unlocked: v as any }))).toEqual([1, 1, 1, 1, 6]);
  });

  test('저장값 해석은 순수하고 멱등이며 잘못된 값은 안전한 값으로 되돌린다', () => {
    const p = { unlocked: 21 };
    expect(resolveCampaignTown(p, undefined)).toEqual({ latest: 3, current: 3, celebrated: 3 });
    expect(resolveCampaignTown(p, { current: 1, celebrated: 2 })).toEqual({ latest: 3, current: 1, celebrated: 2 });
    expect(resolveCampaignTown(p, { current: 5, celebrated: 6 })).toEqual({ latest: 3, current: 3, celebrated: 3 });
    expect(resolveCampaignTown(p, { current: 0, celebrated: 0 })).toEqual({ latest: 3, current: 3, celebrated: 3 });
    expect(resolveCampaignTown(p, { current: 2.5, celebrated: '3' } as any)).toEqual({ latest: 3, current: 3, celebrated: 3 });
    const once = resolveCampaignTown(p, { current: 2, celebrated: 1 });
    expect(resolveCampaignTown(p, once)).toEqual(once);
  });
});
