import { expect, test } from 'bun:test';
import { PartyPresence } from '../src/party/presence.js';

test('idle lobbies probe without animation frames, recover on reply, and time out a silent relay', () => {
  const p = new PartyPresence(1000);
  expect(p.shouldPing(1000)).toBe(true);
  expect(p.shouldPing(4999)).toBe(false);
  expect(p.shouldPing(5000)).toBe(true);
  expect(p.status(9000).kind).toBe('checking');
  p.reply(10000);
  expect(p.status(10001).kind).toBe('connected');
  expect(p.status(26000)).toEqual({ kind: 'ended', reason: 'relay-timeout' });
});

test('relay pongs cannot hide a host that stopped sending world snapshots', () => {
  const p = new PartyPresence(1000), guest = { running: true, isHost: false };
  p.snapshot(2000);
  for (let time = 5000; time <= 65000; time += 4000) p.reply(time);
  expect(p.status(65000, guest)).toEqual({ kind: 'ended', reason: 'host-timeout' });
  expect(p.status(65000, { running: true, isHost: true }).kind).toBe('connected');
});

test('fresh paused snapshots explain the wait, stale snapshots suppress input, and a real snapshot recovers', () => {
  const p = new PartyPresence(1000), guest = { running: true, paused: true };
  p.reply(4000); p.snapshot(4000);
  expect(p.status(4001, guest).kind).toBe('host-paused');
  expect(p.worldWaiting(6999)).toBe(false);
  expect(p.worldWaiting(7000)).toBe(true);
  expect(p.status(7000, guest).kind).toBe('host-waiting');
  p.reply(7200); p.snapshot(7200);
  expect(p.status(7201, { running: true }).kind).toBe('connected');
});

test('returning from OS suspension asks for a fresh reply without inventing a received world snapshot', () => {
  const p = new PartyPresence(1000);
  p.snapshot(2000); p.reply(2100); p.shouldPing(3000);
  p.resume(120000);
  expect(p.shouldPing(120000)).toBe(true);
  expect(p.status(120000, { running: true }).kind).toBe('checking');
  expect(p.worldWaiting(120000)).toBe(true);
  expect(p.lastReply).toBe(2100); expect(p.lastSnapshot).toBe(2000);
  p.reply(120100);
  expect(p.worldWaiting(120100)).toBe(true);
  expect(p.status(123000, { running: true }).kind).toBe('host-waiting');
  expect(p.status(136100, { running: true })).toEqual({ kind: 'ended', reason: 'relay-timeout' });
});

test('new room state has no inherited stale or pending probe state', () => {
  const p = new PartyPresence(1000);
  p.resume(9000); p.shouldPing(9000);
  p.reset(10000);
  expect(p.status(10000).kind).toBe('connected');
  expect(p.worldWaiting(10000)).toBe(false);
  expect(p.shouldPing(10000)).toBe(true);
});
