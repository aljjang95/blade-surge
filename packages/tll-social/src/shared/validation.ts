import { PARTY_CODE, PARTY_HEROES, PLAYER_ID, SOCIAL_LIMITS, type Presence, type RunSummary } from './protocol';

export class SocialError extends Error {
  constructor(public code: string, public status = 400, public retryAfterMs?: number) { super(code); }
}
export function object(value: unknown, keys: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) throw new SocialError('schema');
  return value as Record<string, any>;
}
export function text(value: unknown, min: number, max: number, code = 'length'): string {
  if (typeof value !== 'string') throw new SocialError(code);
  const normalized = value.normalize('NFKC').trim();
  if ([...normalized].length < min || [...normalized].length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(normalized)) throw new SocialError(code);
  return normalized;
}
export function integer(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new SocialError('integer');
  return value as number;
}
export function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new SocialError('boolean');
  return value;
}
/** 선택적 자기 보고이며 서버 경과·보스 처치·수치 상한만 검증한다. */
export function runSummary(value: unknown, elapsedMs: number): RunSummary | null {
  if (value === undefined) return null;
  const s = object(value, ['elapsedMs', 'kills', 'roomsCleared', 'bossDefeated', 'hpLost']);
  const elapsed = integer(s.elapsedMs, 0, Math.ceil(SOCIAL_LIMITS.runMs * 1.2));
  if (s.bossDefeated !== true || elapsed < elapsedMs * 0.8 || elapsed > elapsedMs * 1.2) throw new SocialError('summary');
  return { elapsedMs: elapsed, kills: integer(s.kills, 0, 1000000), roomsCleared: integer(s.roomsCleared, 0, 10000), bossDefeated: true, hpLost: integer(s.hpLost, 0, 1000000000) };
}
export function playerId(value: unknown): string {
  if (typeof value !== 'string' || !PLAYER_ID.test(value)) throw new SocialError('player');
  return value;
}
export function partyCode(value: unknown): string {
  if (typeof value !== 'string' || !PARTY_CODE.test(value)) throw new SocialError('party-code');
  return value;
}
export function playerName(value: unknown): string {
  const name = text(value, 2, 12, 'name');
  if (!/^[가-힣A-Za-z0-9_]+$/.test(name)) throw new SocialError('name');
  return name;
}
export function playerHero(value: unknown): string {
  if (typeof value !== 'string' || !(PARTY_HEROES as readonly string[]).includes(value)) throw new SocialError('hero');
  return value;
}
export function presence(value: unknown): Presence {
  const p = object(value, ['state', 'where']);
  if (!['lobby', 'battle', 'party'].includes(p.state)) throw new SocialError('presence');
  return { state: p.state, ...(p.where === undefined ? {} : { where: text(p.where, 0, 24) }) };
}
export function channel(value: unknown, worldChannels: number): string {
  if (typeof value !== 'string') throw new SocialError('channel');
  if (/^world-[1-9]\d*$/.test(value) && Number(value.slice(6)) <= worldChannels) return value;
  if (value.startsWith('party:') && PARTY_CODE.test(value.slice(6))) return value;
  throw new SocialError('channel');
}
export function diagnostics(value: unknown): Record<string, string | number> | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SocialError('diag');
  const result: Record<string, string | number> = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    const cleanKey = text(key, 1, 64, 'diag');
    if (typeof item === 'string') result[cleanKey] = text(item, 0, 512, 'diag');
    else if (typeof item === 'number' && Number.isFinite(item)) result[cleanKey] = item;
    else throw new SocialError('diag');
  }
  if (new TextEncoder().encode(JSON.stringify(result)).length > 1024) throw new SocialError('diag');
  return result;
}
