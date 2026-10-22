// MMO P1-D: 계정 문서(account_docs.core) ↔ EconomyCore. 서버 규칙은 클라이언트와 같은 Economy 소스를 실행한다.
// 서버 난수는 crypto 기반 주입 RNG, 시계는 서버 Date.now()다. 기기 시계는 어떤 계산에도 들어가지 않는다.
import { EconomyCore } from '../../src/game/economy-core.js';
import { cryptoRng } from '../../src/shared/rng.js';
import { HERO_ORDER } from '../../src/data/heroes.js';
import type { Projection } from './db';

export interface Clocked { now: number; rng?: () => number }
export interface DocText { text: string; bytes: number; projection: Projection; hash: string }

export function loadEconomy(state: unknown, { now, rng }: Clocked): any {
  const clock = () => now;
  const random = rng ?? cryptoRng();
  return EconomyCore.fromState(state, { now: clock, rng: random, gachaRng: random });
}

export function projectionOf(eco: any): Projection {
  const s = eco.s;
  const level = Math.max(1, ...Object.values(s.heroes as Record<string, { level: number }>).map(h => Number(h?.level) || 1));
  let power = 0;
  try { power = Math.floor(eco.heroPower(s.selected)) || 0; } catch { power = 0; }
  return { level, power, stageIdx: Number(s.progress?.unlocked) || 1, gold: Math.floor(Number(s.gold) || 0), gemsFree: Math.floor(Number(s.gems) || 0), gemsPaid: 0 };
}

export function docOf(eco: any): DocText {
  const text = JSON.stringify(eco.snapshot());
  return { text, bytes: new TextEncoder().encode(text).byteLength, projection: projectionOf(eco), hash: eco.stateHash() };
}

/** 새 계정 문서: 클라이언트 새 세이브와 같은 fresh() 상태를 서버 시계로 만든다. */
export function createAccountDoc(now: number): DocText {
  return docOf(loadEconomy(null, { now }));
}

export const HERO_IDS: readonly string[] = HERO_ORDER;
