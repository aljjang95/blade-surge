import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CitadelCommand } from '../src/ui/citadel-command.js';
import { dungeonLanding } from '../src/ui/dungeon-landing.js';
import { ALL_DUNGEONS } from '../src/data/expansion.js';

// 읽기 전용 가짜 원정 서비스. 열린 던전과 클리어 횟수만 바꿔 카드 경계를 만든다.
const service = (open: string[], stats: Record<string, number> = {}) => ({
  s: { stats, level: 1 },
  dungeonAccess: (id: string, { depth = 'standard' }: { depth?: string } = {}) =>
    depth === 'standard' && open.includes(id) ? { ok: true, error: null } : { ok: false, error: depth === 'deep' ? '기본 원정을 먼저 클리어해 주세요.' : '탐험 레벨 2 필요' },
});
const OPEN = ['glass_garden', 'sunbrass_quarry'];
const run = (id: string, depth = 'standard') => ({ outcome: 'victory', details: { route: { kind: 'dungeon', id, depth, conquestId: null, riftId: null } } });

describe('로비 던전 카드 모델', () => {
  test('카드는 전체 던전을 순서대로 담고 비용 · 잠금 · 해금 조건을 읽는다', () => {
    const model: any = dungeonLanding({ expedition: service(OPEN), history: [], energy: 100 });
    expect(model.cards.map((card: any) => card.id)).toEqual(ALL_DUNGEONS.map((dungeon) => dungeon.id));
    const garden = model.cards[0], locked = model.cards.find((card: any) => card.id === 'ember_vault');
    expect(garden).toMatchObject({ unlocked: true, lockReason: '', cost: 4 });
    expect(locked).toMatchObject({ unlocked: false, lockReason: '탐험 레벨 2 필요' });
    expect(model.cards.every((card: any) => !!card.art && !!card.name)).toBe(true);
    expect(model.recommendedId).toBe('glass_garden');
    expect(model.selectedId).toBe('glass_garden');
  });

  test('카드로 고른 던전은 기본 단계 상세로 바뀌고 추천 던전을 다시 고르면 추천 그대로다', () => {
    const picked: any = dungeonLanding({ expedition: service(OPEN), history: [], energy: 100, selectedId: 'sunbrass_quarry' });
    expect(picked.dungeon.id).toBe('sunbrass_quarry');
    expect(picked.reason).toBe('selected');
    expect(picked.label).toBe('선택한 던전');
    expect(picked.depth).toBe('standard');
    expect(picked.name).toBe(ALL_DUNGEONS.find((dungeon) => dungeon.id === 'sunbrass_quarry')!.name);
    expect(picked.recommendedId).toBe('glass_garden');
    // 최근 원정이 심층이면 추천 카드를 다시 골라도 심층 상세를 유지한다.
    const deepOpen = { ...service(OPEN), dungeonAccess: () => ({ ok: true, error: null }) };
    const again: any = dungeonLanding({ expedition: deepOpen, history: [run('glass_garden', 'deep')], energy: 100, selectedId: 'glass_garden' });
    expect(again.reason).toBe('recent');
    expect(again.depth).toBe('deep');
  });

  test('잠긴 던전을 골라도 잠금 사유가 모델에 남고 알 수 없는 id는 추천으로 돌아간다', () => {
    const locked: any = dungeonLanding({ expedition: service(OPEN), history: [], energy: 100, selectedId: 'ember_vault' });
    expect(locked.dungeon.id).toBe('ember_vault');
    expect(locked.unlocked).toBe(false);
    expect(locked.lockReason).toBe('탐험 레벨 2 필요');
    const unknown: any = dungeonLanding({ expedition: service(OPEN), history: [], energy: 100, selectedId: 'nope' });
    expect(unknown.dungeon.id).toBe('glass_garden');
    expect(unknown.reason).toBe('journey');
  });
});

describe('CitadelCommand 카드 선택과 출격', () => {
  const command = (open: string[], history: unknown[] = []) => {
    const opened: any[] = [];
    const app: any = {
      mode: 'lobby', stageStarting: false, meta: { tab: 'home', openTab() {} }, syncHub() {}, citadel: { clearInput() {} },
      eco: { s: { masterworks: { history }, energy: 100 } },
      expedition: service(open),
      expeditionUI: { focusDungeon: null, open: (...args: any[]) => opened.push(['list', ...args]) },
      hubUI: { openDestination: (spot: any, trigger: any, options: any) => { opened.push(['prep', spot.id || spot, options]); return true; } },
    };
    const view: any = Object.assign(Object.create(CitadelCommand.prototype), { app, selectedId: null, lastRecommendedId: null, visible: true, refresh(this: any) { this.model = this.readModel(); } });
    view.prepare = { isConnected: true, closest: () => ({}) };
    return { view, app, opened };
  };

  test('카드를 고르면 상세 모델이 그 던전으로 바뀐다', () => {
    const { view } = command(OPEN);
    view.refresh();
    expect(view.model.dungeon.id).toBe('glass_garden');
    view.select('sunbrass_quarry');
    expect(view.selectedId).toBe('sunbrass_quarry');
    expect(view.model.dungeon.id).toBe('sunbrass_quarry');
    expect(view.model.label).toBe('선택한 던전');
  });

  test('출격은 선택한 던전의 기존 준비창을 연다', () => {
    const { view, opened } = command([...OPEN, 'ember_vault']);
    view.select('ember_vault');
    expect(view.openPreparation()).toBe(true);
    expect(opened).toHaveLength(1);
    expect(opened[0][0]).toBe('prep');
    expect(JSON.stringify(opened[0])).toContain('ember_vault');
    expect(opened[0][2]).toEqual({ depth: 'standard' });
  });

  test('잠긴 던전을 골라도 출격은 기존 준비창으로 가서 잠금 사유를 읽게 하며 모델은 잠김을 알린다', () => {
    const { view, opened } = command(OPEN);
    view.select('ember_vault');
    expect(view.model.unlocked).toBe(false);
    expect(view.model.lockReason).toContain('필요');
    view.openPreparation();
    expect(JSON.stringify(opened[0])).toContain('ember_vault');
  });

  test('추천 던전이 바뀌면 이전 선택을 버린다', () => {
    const { view, app } = command(OPEN);
    view.select('sunbrass_quarry');
    expect(view.selectedId).toBe('sunbrass_quarry');
    app.expedition = service(['ember_vault', 'sunbrass_quarry'], { glass_garden: 1 });
    view.refresh();
    expect(view.selectedId).toBeNull();
    expect(view.model.dungeon.id).toBe('ember_vault');
  });
});

describe('왼쪽 세로 탭과 카드 줄 배치 계약', () => {
  const css = readFileSync('src/ui/lobby-carousel.css', 'utf8');
  test('기존 하단 탭 버튼을 가로 화면에서 왼쪽 세로 탭으로 재배치하고 걷기 모드에서만 숨긴다', () => {
    expect(css).toMatch(/@media \(orientation: landscape\) \{[^@]*#meta \.bottomnav \{[^}]*flex-direction: column/);
    expect(css).toContain('body.citadel-hub-active #meta .bottomnav { display: none !important; }');
  });
  test('상세 패널 · 카드 줄 · 원형 출격은 영웅 쪽(왼쪽)으로 넘어가지 않는 오른쪽 아래 도크에 있다', () => {
    expect(css).toMatch(/\.dl-dock \{[^}]*position: absolute; right:/);
    expect(css).toMatch(/\.dl-cta \{[^}]*border-radius: 50%/);
    expect(css).toMatch(/\.dl-cards \{[^}]*overflow-x: auto/);
  });
});
