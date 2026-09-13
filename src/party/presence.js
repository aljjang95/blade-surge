// Transport replies and world snapshots have different meanings. A healthy relay
// must never make a stopped host simulation look live.
export const PARTY_PRESENCE = Object.freeze({ pingMs: 4000, warnMs: 8000, timeoutMs: 16000,
  worldWarnMs: 3000, worldTimeoutMs: 60000 });

export class PartyPresence {
  constructor(now) { this.reset(now); }
  reset(now) { this.lastReply = this.lastSnapshot = this.resumedAt = now; this.lastPing = -Infinity; this.checking = false; this.waitingForSnapshot = false; }
  reply(now) { this.lastReply = now; this.checking = false; }
  snapshot(now) { this.lastSnapshot = now; this.waitingForSnapshot = false; }
  resume(now) { this.resumedAt = now; this.lastPing = -Infinity; this.checking = true; this.waitingForSnapshot = true; }
  shouldPing(now) {
    if (now - this.lastPing < PARTY_PRESENCE.pingMs) return false;
    this.lastPing = now; return true;
  }
  worldAge(now) { return now - Math.max(this.lastSnapshot, this.resumedAt); }
  worldWaiting(now) { return this.waitingForSnapshot || this.worldAge(now) >= PARTY_PRESENCE.worldWarnMs; }
  status(now, { running = false, isHost = false, paused = false } = {}) {
    const age = now - Math.max(this.lastReply, this.resumedAt);
    if (age >= PARTY_PRESENCE.timeoutMs) return { kind: 'ended', reason: 'relay-timeout' };
    if (age >= PARTY_PRESENCE.warnMs || this.checking) return { kind: 'checking' };
    if (running && !isHost) {
      if (this.worldAge(now) >= PARTY_PRESENCE.worldTimeoutMs) return { kind: 'ended', reason: 'host-timeout' };
      if (this.worldWaiting(now)) return { kind: 'host-waiting' };
      if (paused) return { kind: 'host-paused' };
    }
    return { kind: 'connected' };
  }
}
