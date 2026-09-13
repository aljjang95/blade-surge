import { PARTY_HEROES, PARTY_LIMITS, sanitizePartyName, validPartyInput, validPartySnapshot, validPartyStats } from '../src/party/protocol.js';

export class PartyError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}
export interface Member { id: string; name: string; heroId: string; ready: boolean }
export interface Run { runId: string; stageIdx: number; seed: number; startedAt: number }
export interface Effect { to?: string; except?: string; message: Record<string, unknown> }
type Rate = { second: number; count: number; bytes: number; inputs: number; snapshots: number; inputSeq: number; snapshotSeq: number };
export class PartyState {
  status: 'lobby' | 'running' | 'finished' | 'closed' = 'lobby';
  members = new Map<string, Member>();
  hostId: string | null = null;
  stageIdx = 1;
  run: Run | null = null;
  private rates = new Map<string, Rate>();
  private lastTick = -1;
  constructor(public readonly code: string, private readonly hostTicket: string,
    public readonly expiresAt: number, private readonly uuid = () => crypto.randomUUID() as string) {}
  view() { return { code: this.code, status: this.status, hostId: this.hostId, stageIdx: this.stageIdx,
    members: [...this.members.values()], run: this.run, expiresAt: this.expiresAt }; }
  private party(): Effect { return { message: { type: 'party', party: this.view() } }; }
  private ensure(now: number) {
    if (now >= this.expiresAt) { this.status = 'closed'; throw new PartyError('expired', 410); }
    if (this.status === 'closed' || this.status === 'finished') throw new PartyError('closed', 410);
  }
  join(name: string, heroId: string, ticket: string | null, now: number): { id: string; effects: Effect[] } {
    this.ensure(now);
    if (this.status !== 'lobby') throw new PartyError('already-started', 409);
    if (!PARTY_HEROES.includes(heroId)) throw new PartyError('hero');
    if (ticket && ticket !== this.hostTicket) throw new PartyError('ticket', 403);
    const host = ticket === this.hostTicket;
    if (host && this.hostId) throw new PartyError('host-connected', 409);
    if (!host && !this.hostId) throw new PartyError('host-not-connected', 409);
    if (this.members.size >= PARTY_LIMITS.members) throw new PartyError('full', 409);
    const id = this.uuid();
    this.members.set(id, { id, name: sanitizePartyName(name), heroId, ready: false });
    this.rates.set(id, { second: -1, count: 0, bytes: 0, inputs: 0, snapshots: 0, inputSeq: -1, snapshotSeq: -1 });
    if (host) this.hostId = id;
    return { id, effects: [{ to: id, message: { type: 'welcome', playerId: id, party: this.view() } }, this.party()] };
  }
  receive(id: string, text: string, now: number): Effect[] {
    this.ensure(now);
    const member = this.members.get(id), rate = this.rates.get(id);
    if (!member || !rate) throw new PartyError('member', 403);
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > PARTY_LIMITS.bytes) throw new PartyError('size', 413);
    const second = Math.floor(now / 1000);
    if (rate.second !== second) { rate.second = second; rate.count = rate.bytes = rate.inputs = rate.snapshots = 0; }
    rate.count++; rate.bytes += bytes;
    if (rate.count > PARTY_LIMITS.messagesPerSecond || rate.bytes > PARTY_LIMITS.bytesPerSecond) throw new PartyError('rate', 429);
    let m: any;
    try { m = JSON.parse(text); } catch { throw new PartyError('json'); }
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new PartyError('schema');
    if (m.type === 'ready') {
      if (this.status !== 'lobby' || typeof m.ready !== 'boolean') throw new PartyError('ready');
      member.ready = m.ready;
      return [this.party()];
    }
    if (m.type === 'stage') {
      if (id !== this.hostId) throw new PartyError('host-only', 403);
      if (this.status !== 'lobby') throw new PartyError('state', 409);
      if (!Number.isInteger(m.stageIdx) || m.stageIdx < 1 || m.stageIdx > 60) throw new PartyError('stage-schema');
      if (m.stageIdx !== this.stageIdx) {
        this.stageIdx = m.stageIdx;
        for (const member of this.members.values()) member.ready = false;
      }
      return [this.party()];
    }
    if (m.type === 'start') {
      if (id !== this.hostId) throw new PartyError('host-only', 403);
      if (this.status !== 'lobby') throw new PartyError('state', 409);
      if (this.members.size < 2 || [...this.members.values()].some(p => !p.ready)) throw new PartyError('not-ready', 409);
      if (!Number.isInteger(m.stageIdx) || m.stageIdx < 1 || m.stageIdx > 60
        || !Number.isInteger(m.seed) || m.seed < 1 || m.seed > 2147483647) throw new PartyError('start-schema');
      if (m.stageIdx !== this.stageIdx) throw new PartyError('stage-mismatch', 409);
      this.run = { runId: this.uuid(), stageIdx: m.stageIdx, seed: m.seed, startedAt: now };
      this.status = 'running';
      return [{ message: { type: 'start', run: this.run, members: [...this.members.values()] } }, this.party()];
    }
    if (this.status !== 'running') throw new PartyError('not-running', 409);
    if (m.type === 'input') {
      if (id === this.hostId) throw new PartyError('guest-only', 403);
      if (++rate.inputs > PARTY_LIMITS.inputsPerSecond) throw new PartyError('rate', 429);
      if (!validPartyInput(m)) throw new PartyError('input-schema');
      if (m.seq <= rate.inputSeq) throw new PartyError('sequence');
      rate.inputSeq = m.seq;
      return [{ to: this.hostId!, message: { type: 'input', playerId: id, seq: m.seq,
        x: m.x, y: m.y, attack: m.attack, actions: m.actions } }];
    }
    if (m.type === 'snapshot') {
      if (id !== this.hostId) throw new PartyError('host-only', 403);
      if (++rate.snapshots > PARTY_LIMITS.snapshotsPerSecond) throw new PartyError('rate', 429);
      if (!Number.isInteger(m.seq) || m.seq < 0 || m.seq > 2147483647 || !validPartySnapshot(m.snapshot)) throw new PartyError('snapshot-schema');
      if (m.seq <= rate.snapshotSeq || m.snapshot.tick <= this.lastTick) throw new PartyError('sequence');
      if (m.snapshot.players.length !== this.members.size || m.snapshot.players.some((p: any) =>
        this.members.get(p.id)?.heroId !== p.heroId)) throw new PartyError('snapshot-members');
      rate.snapshotSeq = m.seq; this.lastTick = m.snapshot.tick;
      return [{ except: id, message: { type: 'snapshot', seq: m.seq, snapshot: m.snapshot } }];
    }
    if (m.type === 'finish') {
      if (id !== this.hostId) throw new PartyError('host-only', 403);
      if (m.runId !== this.run?.runId || typeof m.win !== 'boolean' || !validPartyStats(m.stats)) throw new PartyError('finish-schema');
      if (this.lastTick < 0) throw new PartyError('no-snapshot');
      this.status = 'finished';
      return [{ message: { type: 'finish', runId: this.run!.runId, win: m.win, stats: m.stats } }, this.party()];
    }
    throw new PartyError('message-type');
  }
  disconnect(id: string): Effect[] {
    if (!this.members.delete(id)) return [];
    this.rates.delete(id);
    if (this.status === 'finished' || this.status === 'closed') return [];
    if (id === this.hostId || this.status === 'running') return this.abort(id === this.hostId ? 'host-left' : 'member-left');
    return [this.party()];
  }
  abort(reason: string): Effect[] {
    if (this.status === 'closed' || this.status === 'finished') return [];
    this.status = 'closed';
    return [{ message: { type: 'abort', reason, runId: this.run?.runId ?? null } }, this.party()];
  }
}
