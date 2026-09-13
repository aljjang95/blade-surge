import { PARTY_ACTIONS } from './protocol.js';

export class RemoteInput {
  constructor() { this.move = { x: 0, y: 0 }; this.attackHeld = false; this.queue = []; this.enabled = true; this.last = 0; }
  receive(packet, now) {
    this.move.x = packet.x; this.move.y = packet.y; this.attackHeld = packet.attack;
    for (const action of packet.actions) this.press(action);
    this.last = now;
  }
  press(action) { if (PARTY_ACTIONS.includes(action) && !this.queue.includes(action)) this.queue.push(action); }
  consume(action) { const i = this.queue.indexOf(action); if (i < 0) return false; this.queue.splice(i, 1); return true; }
  clear() { this.move.x = this.move.y = 0; this.attackHeld = false; this.queue.length = 0; }
  expire(now) { if (now - this.last > 350) this.clear(); }
}

export function partyHeroState() { return { level: 20, star: 1, skills: [1, 1, 1, 1, 1, 1] }; }
export function normalizedPartyStats(base, scale) {
  return { ...base, hp: Math.round(base.hp * Math.pow(scale, .7)), atk: Math.round(base.atk * scale), def: Math.round(base.def * Math.pow(scale, .7)) };
}
export function actorSnapshot(actor, id) {
  return { id, x: actor.pos.x, z: actor.pos.z, yaw: actor.yaw, hp: Math.max(0, actor.hp), maxHp: actor.maxHp,
    state: actor.state || 'idle', anim: actor.actionName || null };
}
export function canonicalPartyCode(text) {
  let value = String(text || '').trim();
  if (/^https?:\/\//i.test(value)) { try { value = new URL(value).searchParams.get('party') || ''; } catch { return ''; } }
  return value.replace(/[\s-]/g, '').toUpperCase();
}
