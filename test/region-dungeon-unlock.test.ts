import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ALL_DUNGEONS } from '../src/data/expansion.js';
import { DUNGEON_REGION, dungeonRegion, regionDungeonIds } from '../src/data/region-dungeons.js';
import { CAMPAIGN_TOWNS } from '../src/data/campaign-towns.js';
import { dungeonVisibility, dungeonRecordIds, normalizeRegionGate, regionDungeonState, visibleDungeonIds } from '../src/game/region-dungeon-gate.js';
import { normalizeSave } from '../src/game/save-base.js';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { dungeonLanding } from '../src/ui/dungeon-landing.js';
import { markEmergingGates, takeEmergingGates } from '../src/data/citadel-hub.js';

// 지역 마을 해금(docs/region-dungeon-unlock.md). 저장 픽스처는 모두 손으로 만든 JSON 이며, 정규화는 실제 normalizeSave 를 쓴다.
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key),
  } });
});
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

const fresh = () => new Economy().fresh();
const load = (raw: any) => normalizeSave(raw, fresh());
const stars = (ch: number, upto = 10) => Object.fromEntries(Array.from({ length: upto }, (_, i) => [`${ch}-${i + 1}`, 3]));
const REGION1 = ['glass_garden', 'bellfall_crypt', 'rootbound_grotto', 'hollowbell_arboretum'];
const run = (id: string, outcome = 'defeat') => ({ runId: 1, floor: 1, outcome, boonIds: [], details: { route: { kind: 'dungeon', id, depth: 'standard', conquestId: null, riftId: null } } });

describe('던전 → 지역 배정표', () => {
  test('모든 던전이 지역 1~6 중 하나에 배정되고 지역마다 하나 이상이다', () => {
    expect(Object.keys(DUNGEON_REGION).sort()).toEqual(ALL_DUNGEONS.map((d: any) => d.id).sort());
    for (const town of CAMPAIGN_TOWNS) expect(regionDungeonIds(town.chapter).length).toBeGreaterThan(0);
    expect(regionDungeonIds(1)).toEqual(REGION1);
    expect(dungeonRegion('windmeadow')).toBe(0); // 야외 필드는 지역 잠금이 없다
  });

  test('테마가 지역 마을과 맞는다(불·잿 → 2 불씨 용광로, 서리·별빛 → 3, 조수 → 4)', () => {
    const theme = Object.fromEntries(ALL_DUNGEONS.map((d: any) => [d.id, d.theme]));
    expect(dungeonRegion('ember_vault')).toBe(2);
    for (const id of regionDungeonIds(2)) expect(theme[id]).toBe('forge');
    for (const id of regionDungeonIds(1)) expect(theme[id]).toBe('garden');
    for (const id of regionDungeonIds(3)) expect(theme[id]).toBe('frost');
    expect(regionDungeonIds(4)).toContain('eclipse_hydra_vault');
  });
});

describe('새 저장 · 진행 저장의 노출', () => {
  test('새 저장(Lv.1): 첫 마을에는 지역 1 던전만, 다음 마을 하나만 예고, 관문도 4곳', () => {
    const s = load(fresh());
    expect(s.regionGate).toEqual({ v: 1, kept: [] });
    const state = regionDungeonState(s);
    expect(state.latest).toBe(1); expect(state.current).toBe(1);
    expect(state.visibleIds).toEqual(REGION1);
    expect(state.gateIds).toEqual(REGION1);
    expect(state.teaser).toMatchObject({ region: 2, town: '불씨 용광로 마을', unlockCode: '1-10' });
    expect(state.teaserIds).toEqual(regionDungeonIds(2));
    // 사용자가 말한 '잿빛' = 둘째 카드였던 잿불 금고. 이제 보이지 않고, 이유는 1-10 클리어 시 새 마을에서 열림이다.
    expect(dungeonVisibility(s, 'ember_vault')).toMatchObject({ visible: false, open: false, teaser: true, region: 2, reason: '1-10 클리어 시 새 마을 「불씨 용광로 마을」에서 열림' });
    expect(dungeonVisibility(s, 'star_archive')).toMatchObject({ visible: false, teaser: false });
  });

  test('1-10 클리어 저장: 지역 2 마을로 바뀌고 그 마을 던전이 먼저, 관문은 지역 2 던전 6곳', () => {
    const s = load({ ...fresh(), progress: { unlocked: 11, stars: stars(1), difficulty: 'story' } });
    const state = regionDungeonState(s);
    expect(state.latest).toBe(2); expect(state.current).toBe(2);
    expect(state.visibleIds.slice(0, 6)).toEqual(regionDungeonIds(2));
    expect(state.visibleIds.slice(6)).toEqual(REGION1);
    expect(state.gateIds).toEqual(regionDungeonIds(2));
    expect(state.teaser?.region).toBe(3);
    // 이전 마을(1지역)을 로비 마을로 고르면 그 마을 관문으로 돌아간다.
    const back = regionDungeonState({ ...s, campaignTown: { current: 1, celebrated: 2 } });
    expect(back.gateIds).toEqual(REGION1);
    expect(back.visibleIds.slice(0, 4)).toEqual(REGION1);
  });

  test('3지역 진행 저장(2-10 클리어): 지역 1~3 열림, 4지역만 예고', () => {
    const s = load({ ...fresh(), progress: { unlocked: 21, stars: { ...stars(1), ...stars(2) }, difficulty: 'story' } });
    const state = regionDungeonState(s);
    expect(state.latest).toBe(3);
    expect(new Set(state.visibleIds)).toEqual(new Set([...regionDungeonIds(1), ...regionDungeonIds(2), ...regionDungeonIds(3)]));
    expect(state.teaser?.region).toBe(4);
    expect(state.gateIds).toEqual(regionDungeonIds(3));
  });

  test('별 기록만 있는 옛 저장(unlocked·campaignTown·regionGate 없음): 별에서 진행을 복원해 마을과 던전을 연다', () => {
    const raw: any = { gold: 100, progress: { stars: stars(1) } };
    const s = load(raw);
    expect(s.progress.unlocked).toBe(11);
    expect(s.campaignTown).toEqual({ current: 2, celebrated: 2 });
    expect(visibleDungeonIds(s).has('ember_vault')).toBe(true);
    expect(visibleDungeonIds(s).has('star_archive')).toBe(false);
  });
});

describe('기존 저장 소급 보존', () => {
  test('던전만 깨고 캠페인은 안 한 저장: 기록 있는 던전은 지역이 잠겨도 보이고 열리며 지금 마을 관문에 선다', () => {
    const raw: any = { ...fresh(), regionGate: undefined,
      expedition: { level: 5, stats: { glass_garden: 3, ember_vault: 2 }, depthWins: {} },
      masterworks: { history: [run('star_archive', 'defeat')] } };
    delete raw.regionGate;
    const s = load(raw);
    expect(s.progress.unlocked).toBe(1);
    expect(s.regionGate.kept).toEqual(['glass_garden', 'ember_vault', 'star_archive']);
    const state = regionDungeonState(s);
    for (const id of ['ember_vault', 'star_archive']) expect(state.byId[id]).toMatchObject({ visible: true, open: true, preserved: true });
    expect(state.visibleIds).toEqual([...REGION1, 'ember_vault', 'star_archive']);
    expect(state.gateIds).toEqual([...REGION1, 'ember_vault', 'star_archive']);
    // 원정 기록(최근 20개)이 밀려나도 이관 때 고정한 목록으로 계속 보인다.
    const trimmed = { ...s, masterworks: { history: [] } };
    expect(visibleDungeonIds(trimmed).has('star_archive')).toBe(true);
    // 재정규화(다시 불러오기)는 멱등이다.
    const again = load(JSON.parse(JSON.stringify(s)));
    expect(again.regionGate).toEqual(s.regionGate);
    expect(normalizeRegionGate(s.regionGate, s)).toEqual(s.regionGate);
  });

  test('이관된 저장은 kept 를 검증만 하고 알 수 없는 id·형식을 버린다', () => {
    expect(normalizeRegionGate({ v: 1, kept: ['ember_vault', 'nope', 7, 'ember_vault'] }, {})).toEqual({ v: 1, kept: ['ember_vault'] });
    expect(normalizeRegionGate('garbage', {})).toEqual({ v: 1, kept: [] });
  });

  test('심층 승리·진행 중 입장권도 기록으로 센다', () => {
    const ids = dungeonRecordIds({ expedition: { stats: {}, depthWins: { comet_bastion: 1 }, pending: { kind: 'dungeon', target: 'sable_mirage_basin' } } });
    expect([...ids].sort()).toEqual(['comet_bastion', 'sable_mirage_basin']);
  });
});

describe('입장 판정과 추천 정책', () => {
  test('보이지 않는 던전은 입장도 막히고 에너지를 쓰지 않는다. 지역이 열리면 레벨 조건만 남는다', () => {
    const eco = new Economy(), x = new ExpeditionEconomy(eco), energy = eco.s.energy;
    x.s.level = 10;
    const blocked = x.begin('dungeon', 'sunbrass_quarry');
    expect(blocked).toEqual({ ok: false, error: '1-10 클리어 시 새 마을 「불씨 용광로 마을」에서 열림' });
    expect(eco.s.energy).toBe(energy);
    expect(x.dungeonVisibility('sunbrass_quarry').visible).toBe(false);
    eco.s.progress.unlocked = 11;
    expect(x.dungeonAccess('sunbrass_quarry')).toEqual({ ok: true, error: null });
    expect(x.dungeonAccess('star_archive').ok).toBe(false);
  });

  test('로비 추천·카드·선택은 보이는 던전만 쓰고 전체 수도 보이는 던전 기준이다', () => {
    const eco = new Economy(), x = new ExpeditionEconomy(eco);
    const model: any = dungeonLanding({ expedition: x, history: [], energy: 100, selectedId: 'ember_vault' });
    expect(model.cards.map((card: any) => card.id)).toEqual(REGION1);
    expect(model.total).toBe(4);
    expect(model.dungeon.id).toBe('glass_garden'); // 숨은 던전을 고른 선택은 무시
    expect(model.teaser?.town).toBe('불씨 용광로 마을');
    // 1-10 클리어 뒤에는 새 마을(지역 2) 던전을 먼저 추천한다(입장 가능한 첫 미정복).
    eco.s.progress.unlocked = 11; eco.s.campaignTown = { current: 2, celebrated: 2 };
    const after: any = dungeonLanding({ expedition: x, history: [], energy: 100 });
    expect(after.cards.slice(0, 6).map((card: any) => card.id)).toEqual(regionDungeonIds(2));
    expect(after.dungeon.id).toBe('sunbrass_quarry'); // 지역 2 중 Lv.1 로 입장 가능한 첫 던전
    expect(after.unlocked).toBe(true);
    expect(after.total).toBe(10);
  });
});

test('새로 선 관문 표시는 한 번만 꺼내진다(장면 상태)', () => {
  takeEmergingGates();
  markEmergingGates(['ember_vault', 'cinder_tide_lock']);
  expect([...takeEmergingGates()]).toEqual(['ember_vault', 'cinder_tide_lock']);
  expect([...takeEmergingGates()]).toEqual([]);
});
