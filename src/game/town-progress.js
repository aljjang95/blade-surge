import { TOWNS, TOWN_REQUESTS, TOWN_REQUEST_BY_ID, TOWN_STORY } from '../data/towns.js';
import { FIELD_DUNGEONS } from '../data/open-fields.js';
import { dayKey } from './blessing-core.js';

// 마을 의뢰 · 이야기 진행 기록(docs/TOWN_AUDIT.md). 원정 정산(ExpeditionEconomy.settle) 트랜잭션 안에서 한 번만 부른다.
// 같은 저장에 함께 쓰이므로 정산이 실패하면 진행도 같이 되돌아가고, 티켓이 한 번만 정산되므로 두 번 세지 않는다.

const FIELD_IDS = new Set(FIELD_DUNGEONS.map(field => field.id));
const nat = value => Number.isSafeInteger(value) && value > 0 ? Math.min(value, 100000) : 0;

/** 의뢰 일자 키. 한국 05:00에 바뀐다(축복 굴림과 같은 기준). 문자열로 저장한다. */
export const townRequestDay = (now = Date.now()) => 'kst5:' + dayKey(now);

/**
 * 원정 승리 하나를 진행 종류별 양으로 바꾼다.
 * dungeon: 던전 클리어(필드 제외) 1 · field: 필드 클리어 1 · elite: 정예 처치 수 · treasure: 숨은 보물 방 · kills: 처치 수.
 * @param {{ target?: string, elites?: number, treasureRooms?: number, kills?: number }} [run]
 * @returns {Record<string, number>}
 */
export function townRunAmounts({ target, elites = 0, treasureRooms = 0, kills = 0 } = {}) {
  if (typeof target !== 'string' || !target) return {};
  const field = FIELD_IDS.has(target);
  return { [field ? 'field' : 'dungeon']: 1, elite: nat(elites), treasure: nat(treasureRooms), kills: nat(kills) };
}

/** 하루가 바뀌었으면 일일 의뢰를 비운다. 바꿨으면 true. */
export function rotateTownRequests(state, now = Date.now()) {
  const requests = state?.requests; if (!requests) return false;
  // 예전 저장은 반복 의뢰도 '완료'로 남겼다. 반복 의뢰는 완료 목록에 머물지 않는다(다시 수락 가능).
  if (requests.completed.some(id => TOWN_REQUEST_BY_ID[id]?.kind === 'repeatable')) requests.completed = requests.completed.filter(id => TOWN_REQUEST_BY_ID[id]?.kind !== 'repeatable');
  const day = townRequestDay(now);
  if (requests.day === day) return false;
  requests.day = day;
  const daily = id => TOWN_REQUEST_BY_ID[id]?.kind === 'daily';
  requests.active = requests.active.filter(id => !daily(id));
  requests.completed = requests.completed.filter(id => !daily(id));
  for (const id of Object.keys(requests.progress)) if (daily(id)) delete requests.progress[id];
  return true;
}

/**
 * 수락한 의뢰와 현재 마을 이야기의 진행을 올린다. state는 저장의 towns(normalizeTownState 결과)다.
 * @returns {{ requests: string[], story: string|null }} 진행이 오른 의뢰 id와 이야기 마을 id
 */
export function recordTownRun(state, run, now = Date.now()) {
  const out = { requests: [], story: null };
  if (!state?.requests || !Array.isArray(state.requests.active)) return out;
  const amounts = townRunAmounts(run);
  if (!Object.keys(amounts).length) return out;
  rotateTownRequests(state, now);
  const active = new Set(state.requests.active);
  for (const request of TOWN_REQUESTS) {
    const amount = amounts[request.target.type];
    if (!amount || !active.has(request.id)) continue;
    const before = state.requests.progress[request.id] || 0;
    if (before >= request.target.amount) continue;
    state.requests.progress[request.id] = Math.min(request.target.amount, before + amount);
    out.requests.push(request.id);
  }
  // 이야기는 지금 머무는 마을의 현재 장만 진행한다(장이 넘어가면 진행은 새로 센다).
  const townId = TOWNS.some(town => town.id === state.currentTownId) ? state.currentTownId : 'oathhold';
  const story = state.story?.[townId], chapter = story && TOWN_STORY[townId]?.[story.stage];
  if (chapter && state.unlockedTownIds?.includes(townId)) {
    const amount = amounts[chapter.target.type];
    if (amount) {
      story.progress[chapter.target.type] = Math.min(chapter.target.amount, (story.progress[chapter.target.type] || 0) + amount);
      out.story = townId;
    }
  }
  return out;
}
