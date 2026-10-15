import { describe, expect, test } from 'bun:test';
import { dungeonLanding, recentDungeonRun } from '../src/ui/dungeon-landing.js';
import { ALL_DUNGEONS } from '../src/data/expansion.js';

// 기존 ExpeditionEconomy 와 같은 모양의 읽기 전용 가짜 서비스. 해금 · 단계 판정만 바꿔 경계를 만든다.
const service = (open: Record<string, string[]>, stats: Record<string, number> = {}) => ({
  s: { stats, level: 1 },
  dungeonAccess: (id: string, { depth = 'standard' }: { depth?: string } = {}) =>
    (open[id] || []).includes(depth) ? { ok: true, error: null } : { ok: false, error: depth === 'deep' ? '기본 원정을 먼저 클리어해 주세요.' : '탐험 레벨 2 필요' },
});
const run = (id: string, depth = 'standard', outcome = 'victory') => ({ outcome, details: { route: { kind: 'dungeon', id, depth, conquestId: null, riftId: null } } });

describe('던전 우선 로비 추천 정책', () => {
  test('첫 방문은 여정의 첫 던전을 추천하고 비용 · 보상을 카탈로그에서 읽는다', () => {
    const model: any = dungeonLanding({ expedition: service({ glass_garden: ['standard'] }), history: [], energy: 100 });
    expect(model.reason).toBe('journey');
    expect(model.dungeon.id).toBe(ALL_DUNGEONS[0].id);
    expect(model.cost).toBe(ALL_DUNGEONS[0].energy);
    expect(model.unlocked).toBe(true);
    expect(model.enoughEnergy).toBe(true);
    expect(model.rewards[0]).toEqual({ id: 'glass_leaf', amount: 3, name: '유리 잎' });
    expect(model.total).toBe(ALL_DUNGEONS.length);
  });

  test('최근 실제 원정이 지금 입장 가능하면 같은 던전 · 단계를 고른다', () => {
    const history = [run('glass_garden'), run('ember_vault', 'standard', 'defeat'), { outcome: 'victory', details: { route: { kind: 'campaign', id: '1-1' } } }];
    const model: any = dungeonLanding({ expedition: service({ glass_garden: ['standard'], ember_vault: ['standard'] }, { glass_garden: 1 }), history, energy: 50 });
    expect(model.reason).toBe('recent');
    expect(model.dungeon.id).toBe('ember_vault');
    expect(model.outcome).toBe('defeat');
    const deep: any = dungeonLanding({ expedition: service({ glass_garden: ['standard', 'deep'] }, { glass_garden: 2 }), history: [run('glass_garden', 'deep')], energy: 50 });
    expect(deep.depth).toBe('deep');
    expect(deep.depthLabel).toBe('심층 원정');
    expect(deep.cost).toBe(6);
  });

  test('최근 경로가 잠기면 여정 추천으로 돌아가고 이유를 남긴다', () => {
    const model: any = dungeonLanding({ expedition: service({ glass_garden: ['standard'] }), history: [run('glass_garden', 'deep')], energy: 100 });
    expect(model.reason).toBe('fallback');
    expect(model.depth).toBe('standard');
    expect(model.notice).toContain('지금 입장할 수 없습니다');
  });

  test('손상 · 미지원 기록은 건너뛰고 쓰지 않는다', () => {
    const history = [null, 7, { outcome: 'victory' }, { details: { route: { kind: 'dungeon', id: 'nope', depth: 'standard' } } }, run('glass_garden'), { details: { route: { kind: 'dungeon', id: 'glass_garden', depth: 'abyss' } } }];
    const frozen = JSON.stringify(history);
    expect(recentDungeonRun(history)?.route.id).toBe('glass_garden');
    expect(recentDungeonRun('x')).toBeNull();
    expect(JSON.stringify(history)).toBe(frozen);
  });

  test('에너지가 부족해도 준비 내용은 열 수 있게 던전을 유지한다', () => {
    const model: any = dungeonLanding({ expedition: service({ glass_garden: ['standard'] }), history: [], energy: 1 });
    expect(model.dungeon.id).toBe('glass_garden');
    expect(model.enoughEnergy).toBe(false);
    expect(model.unlocked).toBe(true);
  });

  test('열린 던전이 없어도 첫 미정복 던전과 잠금 사유를 보여 준다', () => {
    const model: any = dungeonLanding({ expedition: service({}), history: [], energy: 100 });
    expect(model.dungeon.id).toBe(ALL_DUNGEONS[0].id);
    expect(model.unlocked).toBe(false);
    expect(model.lockReason).toContain('필요');
    expect(model.open).toBe(0);
  });
});
