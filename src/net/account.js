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

export async function setupAccount(app, { fetchImpl } = {}) {
  // 키 복구(IndexedDB 사본)는 소셜 클라이언트가 새 키를 만들기 전에 끝내야 한다. 네트워크는 기다리지 않는다.
  const [key, install] = await Promise.all([deviceKey(), installId()]).catch(() => [null, null]);
  const state = app.account = { status: 'connecting', authority: 'off', client: null, queue: null, receipts: [], deferred: null };
  if (!key) { state.status = 'unavailable'; mark(state); return state; }
  state.client = new AccountClient({ deviceKey: key, channel: STORE_CHANNEL, ...(fetchImpl ? { fetchImpl } : {}) });
  void connect(app, state, install).catch((error) => { state.status = 'offline'; state.error = error?.message; mark(state); });
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

async function connect(app, state, install) {
  const { client } = state, eco = app.eco;
  try { await client.session(); }
  catch (error) { state.status = error?.status === 503 ? 'disabled' : 'offline'; mark(state); return; }
  state.authority = client.account.authority; state.accountId = client.account.accountId;
  let me = await client.me();
  if (!me.legacy && eco.hasStoredSave) {
    state.import = await importLocalSave(client, install, eco).catch((error) => ({ error: error?.message }));
    me = await client.me();
  }
  if (state.authority === 'server') adopt(app, state, me.doc);
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
    const eligible = state.authority === 'server' && stage?.code && !stage.expedition && !stage.party && !stage.riftId;
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
    return { win, elapsedMs: Math.max(0, Math.round((battle.elapsed || 0) * 1000)), kills, ...(s ? { summonedKills: { normal: s.normal, elite: s.elite, boss: s.boss } } : {}),
      roomsCleared: Math.max(0, battle.roomsCleared | 0), damageDealt: Math.max(0, Math.round(battle.dmgDealt || 0)), ...extra };
  };
  const settle = async (run, body) => {
    try {
      const receipt = await client.settleRun(run.runId, body);
      state.receipts.push(receipt);
      adopt(app, state, receipt.doc);
      showReceipt(app, receipt);
    } catch (error) { state.lastError = error?.message; }
  };
  const completeStage = eco.completeStage.bind(eco);
  eco.completeStage = (stage, stars, opts = {}) => {
    const receipt = completeStage(stage, stars, opts), run = battle.v1Run;
    if (state.authority === 'server' && run && stage?.code === run.contentId) {
      battle.v1Run = null;
      void settle(run, facts(true, { stars: Math.max(1, Math.min(3, stars | 0)), fullClear: !!opts.fullClear }));
    } else if (state.authority === 'shadow') state.queue?.snapshot();
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
