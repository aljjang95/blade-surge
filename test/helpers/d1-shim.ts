// bun:sqlite 위에 D1 API(prepare/bind/first/all/run/batch)를 흉내 낸다. batch는 실제 D1처럼 한 트랜잭션이다.
import { Database } from 'bun:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import type { D1Database, D1Statement, D1Value } from '../../worker/v1/db';
import { applyMigrations } from '../../worker/v1/db';

export interface ShimD1 extends D1Database { sqlite: Database; close(): void }

export function createD1(): ShimD1 {
  const sqlite = new Database(':memory:');
  const statement = (sql: string, values: D1Value[] = []): D1Statement => ({
    bind: (...args) => statement(sql, args),
    first: async <T>() => (sqlite.query(sql).get(...values) as T | null) ?? null,
    all: async <T>() => ({ success: true, results: sqlite.query(sql).all(...values) as T[] }),
    run: async () => { const r = sqlite.query(sql).run(...values); return { success: true, meta: { changes: r.changes } }; },
  });
  // 실제 D1 batch는 직렬 트랜잭션이다. 동시 호출은 큐로 한 줄 세운다.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    sqlite,
    close: () => sqlite.close(),
    prepare: (sql: string) => statement(sql),
    batch: <T>(statements: D1Statement[]) => {
      const job = queue.then(async () => {
        sqlite.exec('BEGIN IMMEDIATE');
        try {
          const out = [];
          for (const s of statements) out.push(await s.run());
          sqlite.exec('COMMIT');
          return out as any as T[];
        } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      });
      queue = job.catch(() => {});
      return job;
    },
  } as ShimD1;
}

export function migrationTexts(): string[] {
  const dir = new URL('../../worker/v1/migrations/', import.meta.url);
  return readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => readFileSync(new URL(f, dir), 'utf8'));
}

export async function migratedD1(now = 1): Promise<ShimD1> {
  const db = createD1();
  await applyMigrations(db, migrationTexts(), now);
  return db;
}
