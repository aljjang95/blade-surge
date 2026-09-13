// Real local workerd + Durable Object + WebSocket proof. No network deployment.
// Run: node tools/party-relay-proof.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const bundle = await build({ stdin: { contents: `import { PartyRoom, handlePartyRequest } from './worker/party.ts';
export { PartyRoom }; export default { fetch: handlePartyRequest };`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'browser' });
const mf = new Miniflare(convertV4MiniflareOptions({ name: 'party-proof', modules: true, script: bundle.outputFiles[0].text,
  compatibilityDate: '2025-06-01', bindings: { APP_ORIGIN: 'https://game.example' },
  durableObjects: { PARTIES: { className: 'PartyRoom', useSQLite: true } } }));
const headers = { Origin: 'https://game.example' };
const sockets = [];
async function join(code, hero, ticket) {
  const query = new URLSearchParams({ hero, name: hero });
  if (ticket) query.set('ticket', ticket);
  const response = await mf.dispatchFetch(`https://game.example/api/party/${code}?${query}`, {
    headers: { ...headers, Upgrade: 'websocket' },
  });
  if (response.status !== 101) return { response };
  const socket = response.webSocket;
  sockets.push(socket);
  const messages = [];
  const waiters = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data); messages.push(message);
    for (const wake of [...waiters]) wake();
  });
  socket.accept();
  return { response, socket, messages, send: data => socket.send(JSON.stringify(data)),
    wait(type) { return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(Error(`Timed out waiting for ${type}: ${JSON.stringify(messages)}`)); }, 5000);
      const cleanup = () => { clearTimeout(timer); const i = waiters.indexOf(check); if (i >= 0) waiters.splice(i, 1); };
      const check = () => { const i = messages.findIndex(m => m.type === type); if (i >= 0) { const m = messages.splice(i, 1)[0]; cleanup(); resolve(m); } };
      waiters.push(check); check();
    }); } };
}
try {
  const denied = await mf.dispatchFetch('https://game.example/api/party', { method: 'POST', headers: { Origin: 'https://evil.example' } });
  assert.equal(denied.status, 403);
  const created = await mf.dispatchFetch('https://game.example/api/party', { method: 'POST', headers });
  assert.equal(created.status, 201);
  const { code, hostTicket } = await created.json(); assert.match(code, /^[A-F0-9]{20}$/);
  const forged = await join(code, 'knight', 'forged'); assert.equal(forged.response.status, 403);
  const host = await join(code, 'knight', hostTicket), hw = await host.wait('welcome');
  const guest = await join(code, 'ranger'), gw = await guest.wait('welcome');
  assert.notEqual(hw.playerId, gw.playerId); assert.equal(gw.party.hostId, hw.playerId);
  guest.send({ type: 'start', stageIdx: 1, seed: 123 });
  assert.equal((await guest.wait('error')).error, 'host-only');
  host.send({ type: 'stage', stageIdx: 60 });
  for (;;) { const message = await guest.wait('party'); if (message.party.stageIdx === 60) { assert.equal(message.party.members.every(p => !p.ready), true); break; } }
  host.send({ type: 'ready', ready: true }); guest.send({ type: 'ready', ready: true });
  // Each queue contains old membership events; wait until both ready changes arrived.
  for (;;) { const message = await host.wait('party'); if (message.party.members.length === 2 && message.party.members.every(p => p.ready)) break; }
  host.send({ type: 'start', stageIdx: 60, seed: 123 });
  const hs = await host.wait('start'), gs = await guest.wait('start');
  assert.equal(hs.run.runId, gs.run.runId);
  assert.equal(gs.run.stageIdx, 60);
  guest.send({ type: 'input', seq: 1, x: 1, y: 0, attack: true, actions: ['skill4'] });
  assert.equal((await host.wait('input')).playerId, gw.playerId);
  const snapshot = { tick: 1, elapsed: 0.1, players: hs.members.map(p => ({ id: p.id, heroId: p.heroId,
    x: 0, z: 0, yaw: 0, hp: 100, maxHp: 100, state: 'idle', anim: 'Idle', ult: 0, cds: [0,0,0,0,0,0] })),
    enemies: [], rooms: [], roomsCleared: 0, bossDefeated: false, portal: null, events: [], projectiles: [] };
  guest.send({ type: 'snapshot', seq: 1, snapshot }); assert.equal((await guest.wait('error')).error, 'host-only');
  host.send({ type: 'snapshot', seq: 1, snapshot }); assert.equal((await guest.wait('snapshot')).snapshot.tick, 1);
  const late = await join(code, 'mage'); assert.equal(late.response.status, 409);
  host.socket.close(1000, 'proof-disconnect');
  assert.equal((await guest.wait('abort')).reason, 'host-left');
  assert.equal(guest.messages.some(m => m.type === 'finish'), false);
  const second = await (await mf.dispatchFetch('https://game.example/api/party', { method: 'POST', headers })).json();
  const h2 = await join(second.code, 'knight', second.hostTicket), g2 = await join(second.code, 'ranger');
  await h2.wait('welcome'); await g2.wait('welcome');
  h2.send({ type: 'ready', ready: true }); g2.send({ type: 'ready', ready: true });
  for (;;) { const m = await h2.wait('party'); if (m.party.members.length === 2 && m.party.members.every(p => p.ready)) break; }
  h2.send({ type: 'start', stageIdx: 1, seed: 456 });
  const r2 = await h2.wait('start'); await g2.wait('start');
  const finalSnapshot = { ...snapshot, bossDefeated: true, roomsCleared: 1,
    players: r2.members.map((p, i) => ({ ...snapshot.players[i], id: p.id, heroId: p.heroId })) };
  h2.send({ type: 'snapshot', seq: 1, snapshot: finalSnapshot }); await g2.wait('snapshot');
  h2.send({ type: 'finish', runId: r2.run.runId, win: true, stats: { elapsed: 30, kills: 5, roomsCleared: 1 } });
  const hf = await h2.wait('finish'), gf = await g2.wait('finish');
  assert.deepEqual(hf, gf); assert.equal(gf.win, true);
  console.log(JSON.stringify({ ok: true, runtime: 'local-workerd', origin: 'denied-cross-origin',
    players: 2, hostTicket: 'verified-no-secret-output', inputRelay: true, snapshotRelay: true,
    forgedHostDenied: true, midRunJoinDenied: true, lobbyStageSync: true, hostDisconnect: 'abort-no-reward', sharedFinish: true }));
} finally {
  for (const socket of sockets) { try { socket.close(1000, 'proof-complete'); } catch {} }
  await mf.dispose();
}
