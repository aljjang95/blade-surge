// MMO P1-F: 계정 연결 진입점. main.js 부트에서 한 번 부른다.
// - 서버가 v1을 열지 않았으면(503) 아무것도 바꾸지 않는다(기존 로컬 저장 그대로).
// - 그림자(shadow): 로컬이 정본. 결정적 명령은 패리티 해시와 함께 서버로, 전투 보상 뒤에는 그림자 문서 재동기화.
// - 서버 권위(server): 서버 문서가 정본. 부트 때 서버 문서로 복구하고, 캠페인 판은 서버 티켓·영수증으로 정산한다.
// 로컬 세이브는 어떤 경우에도 지우지 않는다(서버 문서 적용은 같은 저장 키에 덮어쓰기 전 백업 규칙을 따른다).
import { STORE_CHANNEL } from '../platform/store-channel.js';
import { AccountClient, newCid } from './account-client.js';
import { CommandQueue } from './command-queue.js';
import { importLocalSave } from './import.js';
import { deviceKey, installId } from './secure-storage.js';
import { mergeServerOwned, parityHash } from '../shared/state-hash.js';
import { showReceipt } from '../ui/account.js';

const mark = (state) => { try { document.documentElement.dataset.v1 = `${state.status}:${state.authority}`; } catch {} };

export const REGISTERED_KEY = 'blade.v1.registered';
const readMark = () => { try { return globalThis.localStorage?.getItem(REGISTERED_KEY) === '1'; } catch { return false; } };
const writeMark = () => { try { globalThis.localStorage?.setItem(REGISTERED_KEY, '1'); } catch {} };
export const clearRegisteredMark = () => { try { globalThis.localStorage?.removeItem(REGISTERED_KEY); } catch {} };
/** 로컬 저장에 클리어한 판이 하나라도 있으면 true(1-1 이상 진행). */
const hasClearedStage = (eco) => Object.values(eco?.s?.progress?.stars || {}).some((n) => n > 0);

/**
 * 계정 연결. 게스트 서버 행은 지연 생성한다(deferGuest 기본 true):
 * 등록 표시가 있거나, 로컬에 클리어 진행이 있을 때 바로 연결하고,
 * 아니면 첫 스테이지 클리어 뒤 또는 사용자가 연동을 시작할 때(state.ensure()) 연결한다.
 * @param {any} app
 * @param {{ fetchImpl?: typeof fetch, deferGuest?: boolean }} [options]
 */
export async function setupAccount(app, { fetchImpl, deferGuest = true } = {}) {
  // 키 복구(IndexedDB 사본)는 소셜 클라이언트가 새 키를 만들기 전에 끝내야 한다. 네트워크는 기다리지 않는다.
  const [key, install] = await Promise.all([deviceKey(), installId()]).catch(() => [null, null]);
  /** @type {any} */
  const state = app.account = { status: 'connecting', authority: 'off', client: null, queue: null, receipts: [], deferred: null, forceAdopt: false, connecting: null };
  if (!key) { state.status = 'unavailable'; mark(state); return state; }
  state.client = new AccountClient({ deviceKey: key, channel: STORE_CHANNEL, ...(fetchImpl ? { fetchImpl } : {}) });
  const run = () => {
    if (!state.connecting) {
      // 세션 발급 시점을 따로 알린다: 연동은 세션만 있으면 되고, 전체 연결(가져오기)은 첫 저장까지 기다릴 수 있다.
      state.sessionReady = new Promise((resolve) => { state.sessionDone = resolve; });
      state.connecting = connect(app, state, install)
        .catch((error) => { state.status = 'offline'; state.error = error?.message; mark(state); })
        .finally(() => state.sessionDone?.(!!state.client.token))
        // 연결이 ready까지 가지 못했으면(일시적 네트워크 오류·503) 다음 ensure()가 다시 시도하게 약속을 비운다.
        .finally(() => { if (state.status !== 'ready') state.connecting = null; });
    }
    return state.connecting;
  };
  /** 서버 세션을 보장한다(이미 연결 중이면 같은 약속). 연동 시작에서 부른다. 세션이 생기면 true. */
  state.ensure = async () => { void run(); return state.sessionReady; };
  /** 로그인 복구 직후: 기기 키가 다른 계정으로 옮겨졌으니 세션을 새로 받고 서버 문서를 한 번 적용한다(그림자 모드여도). */
  state.refreshFromServer = async () => {
    state.forceAdopt = true;
    if (!state.connecting) { state.status = 'connecting'; await run(); return state.status === 'ready'; }
    await state.connecting;
    if (state.status !== 'ready') return false;
    state.queue?.reset(); // 이전 계정의 대기 명령·스냅샷을 새 계정 토큰으로 보내지 않는다
    state.client.token = null;
    await state.client.session();
    state.authority = state.client.account.authority; state.accountId = state.client.account.accountId;
    const me = await state.client.me();
    adoptNow(app, state, me.doc); state.forceAdopt = false; mark(state);
    return true;
  };
  if (!deferGuest || readMark() || hasClearedStage(app.eco)) { void run(); return state; }
  // 지연: 서버 행이 아직 없다. 첫 스테이지 클리어 뒤에 연결한다.
  state.status = 'deferred'; mark(state);
  const eco = app.eco, completeStage = eco.completeStage?.bind(eco);
  if (completeStage) {
    eco.completeStage = (...args) => {
      const receipt = completeStage(...args);
      if (state.status === 'deferred') { state.status = 'connecting'; mark(state); void run(); }
      return receipt;
    };
  }
  return state;
}

function adoptNow(app, state, doc) {
  const eco = app.eco;
  // 서버가 소유한 필드만 덮어쓴다(설정·튜토리얼·원정 등 P1 밖 로컬 필드는 유지).
  const apply = () => { eco.s = eco.migrate(mergeServerOwned(eco.s, doc)); eco.emit(); };
  if (state.queue) state.queue.quiet(apply); else apply();
  state.lastAdoptHash = parityHash(eco.s);
}
/** 전투 중에는 문서를 바꾸지 않고 전투가 끝난 뒤 적용한다. */
function adopt(app, state, doc) {
  if (!doc) return;
  if (app.battle?.active) { state.deferred = doc; return; }
  adoptNow(app, state, doc);
}

/** 로컬 저장이 처음 생길 때까지 기다린다(시작 영웅 선택 등 첫 저장). 그사이 다른 계정으로 복구하면 바로 멈춘다. */
function waitForStoredSave(eco, state) {
  const done = () => eco.hasStoredSave || state.forceAdopt;
  if (done()) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setInterval(() => { if (done()) { clearInterval(timer); resolve(); } }, 500);
  });
}

async function connect(app, state, install) {
  const { client } = state, eco = app.eco;
  try { await client.session(); }
  catch (error) { state.status = error?.status === 503 ? 'disabled' : 'offline'; mark(state); return; }
  state.sessionDone?.(true);
  writeMark(); // 첫 세션 성공: 다음 부팅부터는 바로 연결한다
  state.authority = client.account.authority; state.accountId = client.account.accountId;
  // 무한의 성 상한·주간 보급·시즌 이벤트는 연결된 동안 서버 시각을 쓴다(기기 시계 앞당김 방지).
  eco.trustedClock = () => client.serverNow();
  let me = await client.me();
  // 가져오기(그림자 기준선)는 계정마다 한 번 꼭 필요하다(없으면 이후 그림자 스냅샷이 import-required로 거부된다).
  // 시작 영웅을 고르기 전에 연동해 만든 계정은 저장이 생길 때(영웅 선택)까지 기다렸다가 가져온다:
  // 먼저 가져오면 서버가 기본 영웅을 시작 영웅으로 굳혀 이후 선택이 거부된다. 그동안 명령 큐도 만들지 않는다.
  // 복구(다른 계정으로 전환) 직후에는 서버 문서를 쓴다.
  if (!me.legacy && !(state.forceAdopt && me.doc) && !eco.hasStoredSave) {
    state.status = 'awaiting-save'; mark(state);
    await waitForStoredSave(eco, state);
  }
  if (!me.legacy && !(state.forceAdopt && me.doc)) {
    state.import = await importLocalSave(client, install, eco).catch((error) => ({ error: error?.message }));
    me = await client.me();
  }
  if (state.authority === 'server') adopt(app, state, me.doc);
  else if (state.forceAdopt && me.doc) { adoptNow(app, state, me.doc); me.stateHash = parityHash(eco.s); }
  state.forceAdopt = false;
  state.queue = new CommandQueue(eco, client, {
    authority: () => state.authority,
    adopt: (doc) => adopt(app, state, doc),
    onError: (error) => { state.lastError = error?.message; },
  });
  if (state.authority === 'shadow' && me.stateHash !== parityHash(eco.s)) state.queue.snapshot();
  hookRuns(app, state);
  setInterval(() => { if (state.deferred && !app.battle?.active) { const doc = state.deferred; state.deferred = null; adoptNow(app, state, doc); } }, 1000);
  state.status = 'ready'; mark(state);
}

/** 캠페인 판: 서버 권위면 티켓을 받고 영수증으로 정산한다. 그림자면 보상 뒤 그림자 문서를 다시 맞춘다. */
function hookRuns(app, state) {
  const battle = app.battle, eco = app.eco, client = state.client;
  if (!battle || battle.__v1Hooked) return;
  battle.__v1Hooked = true;
  const start = battle.start.bind(battle);
  battle.start = async (stage, heroId, ...rest) => {
    battle.v1Run = null;
    // 무한의 성(stage.tower)은 아직 서버 런 종류가 없어 서버 권위 정산에서 제외한다(app.startTower 가 server 모드 진입을 막는다).
    const eligible = state.authority === 'server' && stage?.code && !stage.expedition && !stage.party && !stage.riftId && !stage.tower;
    let ticket = null;
    if (eligible) {
      const request = client.startRun({ kind: 'campaign', contentId: stage.code, difficulty: stage.difficultyId || 'story', heroId, cid: newCid() }).catch((error) => { state.lastError = error?.message; return null; });
      ticket = await Promise.race([request, new Promise((r) => setTimeout(() => r(null), 4000))]);
      battle.v1Run = ticket;
    }
    const out = await start(stage, heroId, ...rest);
    battle.v1Run = ticket;
    return out;
  };
  const facts = (win, extra = {}) => {
    const k = battle.drops?.killCounts || {}, s = battle.drops?.summonedKills || null;
    const kills = { normal: k.normal || 0, elite: k.elite || 0, boss: k.boss || 0 };
    // 처치 종(서버 처치 원장). 형식 상한(64종) 안에서만 보낸다.
    const sp = battle.drops?.speciesKills, species = sp ? Object.fromEntries(Object.entries(sp).filter(([id, n]) => /^[a-z][a-z0-9_]{0,47}$/.test(id) && n > 0).slice(0, 64)) : null;
    return { win, elapsedMs: Math.max(0, Math.round((battle.elapsed || 0) * 1000)), kills, ...(s ? { summonedKills: { normal: s.normal, elite: s.elite, boss: s.boss } } : {}),
      ...(species && Object.keys(species).length ? { species } : {}),
      roomsCleared: Math.max(0, battle.roomsCleared | 0), damageDealt: Math.max(0, Math.round(battle.dmgDealt || 0)), ...extra };
  };
  const settle = async (run, body) => {
    try {
      const receipt = await client.settleRun(run.runId, body);
      state.receipts.push(receipt);
      // 처치 수는 서버 원장이 정본이다(docs/SERVER_AUTHORITY_GATES.md). 기기 값이 더 크면 서버 값으로 덮이며 차이를 남긴다.
      const local = eco.s.quests?.kills | 0, server = receipt.doc?.quests?.kills;
      if (Number.isSafeInteger(server) && local > server) { state.killDrift = { local, server, at: Date.now() }; console.info('[v1] 처치 수 서버 값 우선', state.killDrift); }
      adopt(app, state, receipt.doc);
      showReceipt(app, receipt);
    } catch (error) { state.lastError = error?.message; }
  };
  const completeStage = eco.completeStage.bind(eco);
  eco.completeStage = (stage, stars, opts = {}) => {
    const receipt = completeStage(stage, stars, opts), run = battle.v1Run;
    if (state.authority === 'server' && run && stage?.code === run.contentId) {
      battle.v1Run = null;
      void settle(run, facts(true, { hpLost: Math.max(0, battle.result?.hpLost | 0), revives: Math.max(0, battle.revived | 0) }));
    } else if (state.authority === 'shadow') state.queue?.snapshot();
    return receipt;
  };
  // 주간 보급은 아직 서버 명령이 없다: 서버 권위 계정에서는 막고(문서가 덮어써 이중 지급·유실 방지), 그림자 모드는 스냅샷을 보낸다.
  const claimTowerChest = eco.claimTowerChest.bind(eco);
  eco.claimTowerChest = () => {
    if (state.authority === 'server') return { ok: false, error: 'server' };
    const receipt = claimTowerChest();
    if (state.authority === 'shadow' && receipt.ok) state.queue?.snapshot();
    return receipt;
  };
  const completeTowerFloor = eco.completeTowerFloor.bind(eco);
  eco.completeTowerFloor = (stage, opts = {}) => {
    const receipt = completeTowerFloor(stage, opts);
    if (state.authority === 'shadow') state.queue?.snapshot();
    return receipt;
  };
  const defeat = battle.defeat.bind(battle);
  battle.defeat = (...args) => {
    const run = battle.v1Run, out = defeat(...args);
    if (state.authority === 'server' && run) { battle.v1Run = null; void settle(run, facts(false)); }
    else if (state.authority === 'shadow') state.queue?.snapshot();
    return out;
  };
}
