export interface GameConfig {
  gameId: string;
  worldChannels: number;
  worldCapacity: number;
  contents: { id: string; name: string; minClearSec: number }[];
  titleTiers: { id: string; maxRank: number; label: string }[];
  founders: { maxNo: number; titleId: string; label: string };
  completion: { titleId: string; label: string };
  dmFriendsOnly: boolean;
  chat: { maxLen: number; minGapMs: number; burst: number; burstWindowMs: number; history: number };
  bannedWords: string[];
  // requireLinked=true면 외부 계정(구글 등)을 연결한 플레이어만 명예의 전당 순번·칭호를 받는다.
  fame?: { requireLinked?: boolean };
}
export interface Title { id: string; label: string }
export interface PublicMini { id: string; name: string; tag: string; no: number; title: Title | null; linked: boolean }
export interface Presence { state: 'lobby' | 'battle' | 'party'; where?: string }
export interface Msg {
  id: string;
  channel: string | null;
  kind: 'chat' | 'whisper' | 'system' | 'invite' | 'fame' | 'listing';
  from?: PublicMini;
  to?: string;
  text: string;
  at: number;
  data?: unknown;
}
export interface Session {
  sid: string;
  playerId: string;
  connectedAt: number;
  world: string | null;
  party: string | null;
  presence: Presence;
  presenceAt: number;
  hello: boolean;
  closed?: boolean;
}
export const SOCIAL_PREFIX = '/api/social';
export const DEVICE_KEY = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
export const PLAYER_ID = /^p_[a-f0-9]{24}$/;
export const PARTY_CODE = /^[A-F0-9]{20}$/;
export const NONCE = /^[A-Za-z0-9_-]{8,32}$/;
export const WS_TICKET = /^[a-f0-9]{32}$/;
export const AUTH_PROVIDERS = ['google'] as const;
export const POST_CATEGORIES = ['bug', 'idea', 'request', 'question', 'notice'] as const;
export const POST_STATUSES = ['open', 'reviewing', 'planned', 'done', 'wontfix'] as const;
export const SOCIAL_LIMITS = { bodyBytes: 8192, socketBytes: 2048, runMs: 7200000, listingMs: 600000, ticketMs: 60000 };
