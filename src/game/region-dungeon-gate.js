// 지역 마을 해금에 따른 던전 노출 판정. 저장 객체(eco.s)만 읽는 순수 함수이며 아무것도 쓰지 않는다.
// 규칙(docs/region-dungeon-unlock.md):
// - 지역 X 의 던전은 캠페인 (X-1)-10 첫 클리어로 지역 X 마을이 열렸을 때 보이고 열린다(latestTownChapter).
// - 입장·클리어 기록이 있는 던전은 지역이 아직 잠겨 있어도 절대 숨기지 않는다(소급 보존).
// - 아직 열리지 않은 지역 중 바로 다음 지역 하나만 '다른 던전' 목록에서 잠금 줄로 예고한다(teaser).
// 로비 카드 줄·3D 관문·마을 둘러보기·추천·스테이지 선택 화면이 모두 이 판정을 쓴다.
import { ALL_DUNGEONS, CONCEPT_DUNGEONS } from '../data/expansion.js';
import { DUNGEON_REGION, dungeonRegion } from '../data/region-dungeons.js';
import { campaignTown, latestTownChapter, resolveCampaignTown } from '../data/campaign-towns.js';
import { normalizeRunRoute } from './run-history.js';
import { weeklyFrontier } from '../data/seasonal-content.js';

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;
export const REGION_GATE_VERSION = 1;
const GATE_SLOTS = 6;
// 컨셉 던전(빙하 조수 분지·석양 황동 채석장)은 처음부터 광장 관문이 없는 목록 전용 던전이다(concept-dungeons 계약). 관문 후보에서 뺀다.
const GATELESS = new Set(CONCEPT_DUNGEONS.map((dungeon) => dungeon.id));

/** 저장에 남은 던전 기록(승리·심층 승리·진행 중 입장권·원정 기록·전술 공략·이관 때 보존한 목록). */
export function dungeonRecordIds(save) {
  const ids = new Set();
  const expedition = record(save?.expedition) ? save.expedition : {};
  for (const id of Object.keys(DUNGEON_REGION)) {
    if (positive(expedition.stats?.[id]) || positive(expedition.depthWins?.[id])) ids.add(id);
  }
  if (record(expedition.pending) && expedition.pending.kind === 'dungeon' && Object.hasOwn(DUNGEON_REGION, expedition.pending.target)) ids.add(expedition.pending.target);
  const history = Array.isArray(save?.masterworks?.history) ? save.masterworks.history : [];
  for (const entry of history) {
    const route = normalizeRunRoute(entry?.details?.route);
    if (route?.kind === 'dungeon' && Object.hasOwn(DUNGEON_REGION, route.id)) ids.add(route.id);
  }
  const kept = Array.isArray(save?.regionGate?.kept) ? save.regionGate.kept : [];
  for (const id of kept) if (typeof id === 'string' && Object.hasOwn(DUNGEON_REGION, id)) ids.add(id);
  return ids;
}

/**
 * 저장 이관. regionGate 가 없는 기존 저장은 지금 남은 모든 던전 기록을 kept 에 한 번 고정한다
 * (원정 기록은 최근 20개만 남으므로, 패배만 있던 던전도 나중에 기록이 밀려나 숨겨지지 않게 한다).
 * 이미 이관된 저장은 kept 를 검증만 한다. 순수 함수이고 여러 번 적용해도 같다.
 * @param {unknown} raw 저장된 regionGate 값
 * @param {any} save 같은 저장의 나머지(expedition·masterworks·progress)
 */
export function normalizeRegionGate(raw, save) {
  if (record(raw) && raw.v === REGION_GATE_VERSION && Array.isArray(raw.kept)) {
    const kept = [...new Set(raw.kept.filter((id) => typeof id === 'string' && Object.hasOwn(DUNGEON_REGION, id)))];
    return { v: REGION_GATE_VERSION, kept: Object.keys(DUNGEON_REGION).filter((id) => kept.includes(id)) };
  }
  const ids = dungeonRecordIds({ ...save, regionGate: null });
  return { v: REGION_GATE_VERSION, kept: Object.keys(DUNGEON_REGION).filter((id) => ids.has(id)) };
}

const lockReason = (region) => `${region - 1}-10 클리어 시 새 마을 「${campaignTown(region).name}」에서 열림`;

/**
 * 던전 하나가 이 저장에서 보이는가/열렸는가. 레벨 조건은 따로(dungeonAccess)이며 여기서는 지역만 본다.
 * @returns {{ id: string, region: number, town: string|null, visible: boolean, open: boolean, preserved: boolean, teaser: boolean, reason: string }}
 */
export function dungeonVisibility(save, id, records = dungeonRecordIds(save)) {
  const region = dungeonRegion(id), latest = latestTownChapter(save?.progress);
  const preserved = records.has(id);
  const open = !region || region <= latest || preserved;
  return {
    id, region, town: region ? campaignTown(region).name : null,
    visible: open, open, preserved: preserved && !!region && region > latest,
    teaser: !open && region === latest + 1,
    reason: open ? '' : lockReason(region),
  };
}

/**
 * 저장 전체의 지역 던전 상태. ALL_DUNGEONS 순서로 판정을 돌려준다.
 * - visibleIds: 지금 보이는 던전(현재 마을 지역 → 다른 열린 지역 → 소급 보존 순).
 * - teaserIds: '다른 던전' 목록에서만 잠금 줄로 보일 다음 지역 던전.
 * - gateIds: 현재 로비 마을의 3D 관문(최대 6). 현재 지역 던전 + 아직 마을이 없는 소급 보존 던전. 관문 없는 컨셉 던전은 제외.
 */
export function regionDungeonState(save) {
  const records = dungeonRecordIds(save);
  const town = resolveCampaignTown(save?.progress, save?.campaignTown);
  const entries = ALL_DUNGEONS.map((dungeon) => dungeonVisibility(save, dungeon.id, records));
  const rank = (entry) => (entry.region === town.current ? 0 : entry.preserved ? 2 : 1);
  const visible = entries.filter((entry) => entry.visible);
  const ordered = visible.map((entry, index) => ({ entry, index }))
    .sort((a, b) => rank(a.entry) - rank(b.entry) || (rank(a.entry) === 1 ? a.entry.region - b.entry.region : 0) || a.index - b.index)
    .map(({ entry }) => entry.id);
  const gateIds = visible.filter((entry) => !GATELESS.has(entry.id) && (entry.region === town.current || entry.preserved)).map((entry) => entry.id)
    .sort((a, b) => Number(dungeonRegion(a) !== town.current) - Number(dungeonRegion(b) !== town.current)).slice(0, GATE_SLOTS);
  const next = town.latest + 1;
  return {
    latest: town.latest, current: town.current,
    entries, byId: Object.fromEntries(entries.map((entry) => [entry.id, entry])),
    visibleIds: ordered,
    teaserIds: entries.filter((entry) => entry.teaser).map((entry) => entry.id),
    teaser: entries.some((entry) => entry.teaser) ? { region: next, town: campaignTown(next).name, accent: campaignTown(next).accent, unlockCode: `${next - 1}-10`, reason: lockReason(next) } : null,
    gateIds,
  };
}

/** 이 저장에서 지금 열린(보이는) 던전 id 집합. */
export const visibleDungeonIds = (save) => new Set(regionDungeonState(save).visibleIds);

/** 이 저장에서 보이는 이번 주 프론티어. 화면 표시와 출격·정산이 같은 판정을 쓰도록 호출부는 이 함수만 쓴다. */
export const frontierForSave = (save, date = new Date()) => weeklyFrontier(date, visibleDungeonIds(save));
