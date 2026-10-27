import { expect, test } from 'bun:test';
import { SEASON, TORMENT } from '../src/data/content-90d.js';
import { LEGEND, LEGEND_KEYSTONES, legendExpFor, nodeValue } from '../src/game/legend-rank.js';
import { DIFFICULTIES, resolveDifficulty, tormentId } from '../src/game/difficulty.js';
import { Economy } from '../src/game/economy.js';
import { stageDef } from '../src/data/stages.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { campaignStages, entryAction, stageSelectModel, selectedEntry } from '../src/game/stage-select-model.js';
import { SERVER_HELL_LOCK, difficultyPicker, resultStrip, tormentInfo, tormentLock } from '../src/game/torment-ui-model.js';
import { LEGEND_UNLOCK_LEVEL, legendBoard, statText } from '../src/game/legend-ui-model.js';
import { tierName, tierNote, tierTag, tierTone } from '../src/game/item-tier-label.js';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const DAY = 86400000, clock = { now: SEASON.startMs + 3 * DAY + 12 * 3600000 };
const newEco = () => new Economy({ now: () => clock.now, storage: memory(), rng: () => .5 });
const hellCleared = (eco: any, chapters = [1], stages = 10) => {
  eco.s.progress.unlocked = 60;
  for (const ch of chapters) for (let st = 1; st <= stages; st++) eco.s.endgame.peak[`${ch}-${st}`] = 3;
  return eco;
};

// ------------------------------------------------------------------ 고통 단계 난이도 줄
test('고통 단계 잠금 사유: 지역 진행(n/10) → 관문 → 서버 권위 순서, 열리면 null', () => {
  const eco = newEco();
  expect(tormentLock(eco.s, 1, 1)).toEqual({ code: 'region', reason: '지옥 1장 10관문 클리어 시 T1 (0/10)' });
  hellCleared(eco, [1], 4);
  expect(tormentLock(eco.s, 1, 1)?.reason).toBe('지옥 1장 10관문 클리어 시 T1 (4/10)');
  expect(tormentLock(eco.s, 3, 2)?.reason).toBe('지옥 3장 10관문 클리어 시 T1 (0/10)');
  hellCleared(eco, [1]);
  expect(tormentLock(eco.s, 1, 7)).toBeNull();
  // 다른 지역: T1 은 열려 있어도 그 관문을 지옥으로 깨지 않았으면 닫힌다(difficulty.js stageClearedAtHell 규칙)
  expect(tormentLock(eco.s, 2, 1)).toMatchObject({ code: 'stage' });
  // 서버 권위 계정은 main.js 와 같은 문구로 닫힌다(다른 조건보다 먼저)
  expect(tormentLock(eco.s, 1, 1, { serverAuthority: true })).toEqual({ code: 'server', reason: SERVER_HELL_LOCK });
  expect(SERVER_HELL_LOCK).toBe('서버 계정의 지옥·고통 단계 정산을 준비 중입니다.');
});

test('난이도판 모델: 5개 선택지, 해금 단계까지만 고르고 50단계를 나열하지 않는다', () => {
  const eco = hellCleared(newEco()); eco.s.endgame.torment.best = 6;
  const status = eco.tormentStatus();
  const picker = difficultyPicker({ save: eco.s, ch: 1, st: 1, current: 'hell', status });
  expect(picker.options.map((o: any) => o.id)).toEqual(['story', 'adept', 'nightmare', 'hell', 'torment']);
  expect(picker.options.find((o: any) => o.id === 'torment')).toMatchObject({ unlocked: true, active: false });
  expect(picker.options.find((o: any) => o.id === 'hell')).toMatchObject({ active: true });
  expect(picker.torment).toMatchObject({ unlocked: true, top: 7, best: 6, tier: 7, canUp: false, canDown: true, id: 'torment-7' });
  // 단계가 고정 길이 목록이 아니라 현재/최대 두 수로만 표현된다
  expect(Object.keys(picker.torment)).not.toContain('tiers');
  // 활성 단계가 있으면 그 단계, 없으면 마지막으로 고른 단계(해금 범위 안), 그것도 없으면 최고 해금 단계
  expect(difficultyPicker({ save: eco.s, ch: 1, st: 1, current: 'torment-3', status }).torment).toMatchObject({ tier: 3, canUp: true, canDown: true });
  expect(difficultyPicker({ save: eco.s, ch: 1, st: 1, current: 'story', status, lastTier: 4 }).torment.tier).toBe(4);
  expect(difficultyPicker({ save: eco.s, ch: 1, st: 1, current: 'story', status, lastTier: 40 }).torment.tier).toBe(7);
  expect(difficultyPicker({ save: eco.s, ch: 1, st: 1, current: 'torment-1', status }).torment).toMatchObject({ tier: 1, canDown: false });
});

test('난이도판 모델: 잠긴 고통·서버 권위 사유와 기존 난이도 잠금 문구', () => {
  const eco = newEco();
  const locked = difficultyPicker({ save: eco.s, ch: 1, st: 1, current: 'story', status: eco.tormentStatus() });
  const torment = locked.options.find((o: any) => o.id === 'torment');
  expect(torment).toMatchObject({ unlocked: false, requirement: '지옥 1장 10관문 클리어 시 T1 (0/10)', lockCode: 'region' });
  expect(locked.torment).toMatchObject({ unlocked: false, top: 0, tier: 0, canUp: false, canDown: false, info: null });
  expect(locked.options.find((o: any) => o.id === 'adept')).toMatchObject({ unlocked: false, requirement: '1개 스테이지 클리어' });
  expect(locked.options.find((o: any) => o.id === 'nightmare')).toMatchObject({ requirement: '이 스테이지 ★3' });
  expect(locked.options.find((o: any) => o.id === 'hell')).toMatchObject({ requirement: '지역 10관문 악몽 클리어' });
  hellCleared(eco); eco.s.progress.stars['1-1'] = 3;
  const server = difficultyPicker({ save: eco.s, ch: 1, st: 1, current: 'hell', status: eco.tormentStatus(), serverAuthority: true });
  expect(server.options.find((o: any) => o.id === 'hell')).toMatchObject({ unlocked: false, requirement: SERVER_HELL_LOCK });
  expect(server.options.find((o: any) => o.id === 'torment')).toMatchObject({ unlocked: false, requirement: SERVER_HELL_LOCK, lockCode: 'server' });
  expect(server.options.find((o: any) => o.id === 'story')).toMatchObject({ unlocked: true });
});

test('고통 단계 정보: 배율은 규칙 함수 그대로, 에너지 0, 풀 보상 남은 판과 감쇠 안내', () => {
  const info = tormentInfo(10, { fullRuns: 24, fullLeft: 24 });
  expect(info).toMatchObject({ tier: 10, energy: 0, fullRuns: 24, fullLeft: 24, decayed: false, decayNote: '', energyText: '에너지 0', fullText: '오늘 풀 보상 24/24판 남음' });
  expect(info.rewardMul).toBeCloseTo(1 + TORMENT.rewardStep * 10, 10);
  expect(info.expMul).toBeCloseTo(TORMENT.expBase + TORMENT.expStep * 10, 10);
  expect(info.enemyText).toMatch(/^적 체력·공격 지옥 ×\d/);
  const part = tormentInfo(10, { fullRuns: 24, fullLeft: 9 });
  expect(part.fullText).toBe('오늘 풀 보상 9/24판 남음');
  const spent = tormentInfo(10, { fullRuns: 24, fullLeft: 0 });
  expect(spent).toMatchObject({ decayed: true, decayPct: 35, decayNote: '오늘은 재화 35%, 경험치 100%', fullText: '오늘 풀 보상 판 모두 사용' });
  // 범위 밖·잘못된 입력은 1~50 으로 맞추고 상태가 없으면 풀 보상 전부 남음
  expect(tormentInfo(999, null).tier).toBe(50);
  expect(tormentInfo(0, undefined)).toMatchObject({ tier: 1, fullLeft: TORMENT.fullRuns });
  // 실제 Economy 상태에서 남은 판이 줄어든다
  const eco = hellCleared(newEco());
  expect(tormentInfo(1, eco.tormentStatus()).fullLeft).toBe(TORMENT.fullRuns);
});

test('관문 선택 모델: 고통 단계 관문은 에너지 0·난이도 이름·단계를 가진다(난이도 맵은 저장의 실제 해금 규칙)', () => {
  const eco = hellCleared(newEco()); eco.s.endgame.torment.best = 2;
  const expedition = new ExpeditionEconomy(eco);
  eco.setDifficulty(tormentId(2), 1, 1);
  const model: any = stageSelectModel({ progress: eco.s.progress, expedition, power: 99999, heroLevel: 80, energy: 0, chapter: 1, difficulty: (ch: number, st: number) => eco.difficultyFor(ch, st), prefer: { tab: 'campaign', ch: 1, st: 1 } });
  const stage = model.campaign.stages[0];
  expect(stage).toMatchObject({ difficultyId: 'torment-2', difficultyName: '고통 2단계', tormentTier: 2, cost: 0, enoughEnergy: true });
  expect(entryAction(selectedEntry(model))).toMatchObject({ enabled: true, reason: '' });
  // 에너지가 0 이어도 입장 가능(고통 단계는 에너지를 쓰지 않는다). 같은 관문의 일반 난이도는 기존 에너지를 쓴다.
  eco.setDifficulty('story', 1, 1);
  const story: any = campaignStages({ progress: eco.s.progress, chapter: 1, power: 1, heroLevel: 1, energy: 0, difficulty: (ch: number, st: number) => eco.difficultyFor(ch, st) });
  expect(story.stages[0]).toMatchObject({ difficultyId: 'story', tormentTier: 0 });
  expect(story.stages[0].cost).toBeGreaterThan(0);
  expect(story.stages[0].enoughEnergy).toBe(false);
});

test('난이도 적용: setDifficulty 로 고른 단계가 해금 단계를 넘으면 해금된 최고 단계로 내려온다', () => {
  const eco = hellCleared(newEco()); eco.s.endgame.torment.best = 2;
  expect(eco.setDifficulty('torment-9', 1, 1).id).toBe('torment-3');
  expect(eco.setDifficulty('torment-1', 1, 1).id).toBe('torment-1');
  expect(eco.s.progress.difficulty).toBe('torment-1');
  expect(resolveDifficulty(eco.s, 1, 1, 'torment-1')).toBe(DIFFICULTIES['torment-1']);
});

// ------------------------------------------------------------------ 결과 띠
test('결과 띠: 고통 단계(새 최고 기록·남은 풀 보상 판·감쇠)와 전설 EXP·단계·키스톤', () => {
  expect(resultStrip(null)).toBeNull();
  expect(resultStrip({ torment: null, legend: null })).toBeNull();
  const normal = resultStrip({ torment: { tier: 3, full: true, runs: 5, best: 2, newBest: false, fullLeft: 19 } });
  expect(normal?.parts).toHaveLength(1);
  expect(normal?.parts[0]).toMatchObject({ kind: 'torment', tone: 'full' });
  expect(normal?.parts[0].text).toBe('고통 3단계 · 최고 T2 · 풀 보상 판 · 남은 풀 보상 19판');
  const best = resultStrip({ torment: { tier: 3, full: true, runs: 5, best: 3, newBest: true, fullLeft: 19 } })!;
  expect(best.parts[0]).toMatchObject({ tone: 'best' });
  expect(best.parts[0].text).toContain('새 최고 기록 T3 · T4 열림');
  const top = resultStrip({ torment: { tier: 50, full: true, runs: 1, best: 50, newBest: true, fullLeft: 23 } })!;
  expect(top.parts[0].text).not.toContain('열림'); // 최고 단계 다음은 없다
  const decay = resultStrip({ torment: { tier: 3, full: false, runs: 30, best: 2, newBest: false, fullLeft: 0 } })!;
  expect(decay.parts[0]).toMatchObject({ tone: 'decay' });
  expect(decay.parts[0].text).toBe('고통 3단계 · 최고 T2 · 오늘 풀 보상 끝 · 재화 35%, 경험치 100%');
  // 전설 수련: 단계가 오르지 않은 판은 진행률, 오른 판은 단계·점수, 키스톤이 열리면 이름
  const progress = resultStrip({ legend: { gained: 13310, ranks: 0, rank: 12, exp: Math.floor(legendExpFor(12) * 0.17), points: 4, keystones: [] } })!;
  expect(progress.parts[0]).toMatchObject({ kind: 'legend', tone: 'exp' });
  expect(progress.parts[0].text).toBe('전설 EXP +13,310 · 전설 12단계 17%');
  const rankUp = resultStrip({ legend: { gained: 5, ranks: 2, rank: 14, exp: 1, points: 6, keystones: [] } })!;
  expect(rankUp.parts[0]).toMatchObject({ tone: 'rank' });
  expect(rankUp.parts[0].text).toBe('전설 EXP +5 · 전설 14단계 (+2) · 점수 +2');
  const ks = LEGEND_KEYSTONES[0];
  const keystone = resultStrip({ legend: { gained: 5, ranks: 1, rank: ks.unlockRank, exp: 0, points: 1, keystones: [ks.id] } })!;
  expect(keystone.parts[0]).toMatchObject({ tone: 'keystone' });
  expect(keystone.parts[0].text).toContain(`새 키스톤 ${ks.name}`);
  // 한 줄 텍스트: 두 조각을 한 번에 읽는다
  const both = resultStrip({ torment: { tier: 1, full: true, runs: 1, best: 0, newBest: false, fullLeft: 23 }, legend: { gained: 1, ranks: 0, rank: 0, exp: 1, points: 0, keystones: [] } })!;
  expect(both.parts.map((p: any) => p.kind)).toEqual(['torment', 'legend']);
  expect(both.text).toContain('  |  ');
  // 받은 EXP 가 0 이면 전설 띠가 없다
  expect(resultStrip({ legend: { gained: 0, ranks: 0, rank: 3, exp: 0, points: 0, keystones: [] } })).toBeNull();
});

test('결과 띠: 실제 정산 영수증(Economy.completeStage)에서 고통 단계 줄을 만든다', () => {
  const eco = hellCleared(newEco()); eco.s.endgame.torment.best = 2;
  const stage: any = { ...stageDef(1, 1), difficultyId: 'torment-3' };
  const receipt = eco.completeStage(stage, 3);
  const strip = resultStrip(receipt)!;
  expect(strip.parts[0].kind).toBe('torment');
  expect(strip.parts[0].text).toContain('고통 3단계');
  expect(strip.parts[0].text).toContain(`남은 풀 보상 ${TORMENT.fullRuns - 1}판`);
});

// ------------------------------------------------------------------ 전설 수련 판
const legendState = (extra: any = {}) => ({ version: 1, rank: 40, exp: 0, points: 0, nodes: { blade_edge: 5, wall_bulk: 3 }, ...extra });

test('전설 수련 판: Lv.80 전에는 잠금 사유와 미리보기(찍기 전부 비활성)', () => {
  const board = legendBoard({ version: 1, rank: 0, exp: 0, points: 0, nodes: {} }, { maxHeroLevel: 30, gold: 5_000_000 });
  expect(board.locked).toBe(true);
  expect(board.lockReason).toBe(`영웅 Lv.${LEGEND_UNLOCK_LEVEL} 달성 시 열립니다 (지금 최고 Lv.30)`);
  expect(board.branches).toHaveLength(4);
  for (const branch of board.branches) {
    expect(branch.nodes).toHaveLength(6);
    for (const node of branch.nodes) { expect(node).toMatchObject({ canOne: false, canFive: false, canMax: false, level: 0 }); expect(node.nextText).toMatch(/^\+/); }
  }
  expect(board.respec.enabled).toBe(false);
  // 점수가 한 번이라도 쌓였거나 Lv.80 이면 열린다
  expect(legendBoard({ version: 1, rank: 0, exp: 0, points: 0, nodes: {} }, { maxHeroLevel: 80 }).locked).toBe(false);
  expect(legendBoard({ version: 1, rank: 3, exp: 0, points: 0, nodes: {} }, { maxHeroLevel: 1 }).locked).toBe(false);
});

test('전설 수련 판: 노드의 현재/다음 효과는 nodeValue 와 같고, 찍기 가능 수(+1·+5·최대)는 점수·상한으로 정해진다', () => {
  const board = legendBoard(legendState(), { maxHeroLevel: 80, gold: 9_000_000 });
  expect(board).toMatchObject({ locked: false, rank: 40, points: 32, spent: 8 });
  const blade = board.branches[0], edge = blade.nodes.find((n: any) => n.id === 'blade_edge')!;
  expect(edge).toMatchObject({ level: 5, max: LEGEND.maxNodeLevel, canOne: true, canFive: true, canMax: true, maxN: 32 });
  expect(edge.value).toBeCloseTo(nodeValue({ eff: 0.20 } as any, 5), 12);
  expect(edge.next).toBeCloseTo(nodeValue({ eff: 0.20 } as any, 6), 12);
  expect(edge.valueText).toBe('+3.3%');
  expect(edge.nextText).toBe('+3.9%');
  expect(edge.deltaText).toBe('(+0.54%p)');
  expect(blade.spent).toBe(5);
  expect(board.branches[1].spent).toBe(3);
  // 점수가 부족하면 +5 가 꺼지고, 남은 점수가 4면 최대도 4
  const low = legendBoard(legendState({ rank: 12 }), { maxHeroLevel: 80 });
  const lowEdge = low.branches[0].nodes.find((n: any) => n.id === 'blade_edge')!;
  expect(low.points).toBe(4);
  expect(lowEdge).toMatchObject({ canOne: true, canFive: false, canMax: true, maxN: 4 });
  // 점수 0 이면 모두 꺼지고 사유가 붙는다
  const none = legendBoard(legendState({ rank: 8 }), { maxHeroLevel: 80 });
  expect(none.points).toBe(0);
  expect(none.branches[0].nodes[0]).toMatchObject({ canOne: false, canFive: false, canMax: false, reason: '남은 점수가 없습니다' });
  // 50단계 노드는 최대 표시
  const maxed = legendBoard(legendState({ rank: 60, nodes: { blade_edge: 50 } }), { maxHeroLevel: 80 });
  const m = maxed.branches[0].nodes[0];
  expect(m).toMatchObject({ maxed: true, nextText: '최대', canOne: false, reason: '최대 단계입니다' });
  // 50 에 가까우면 +5 가 꺼진다(46 → +5 는 51)
  const near = legendBoard(legendState({ rank: 90, nodes: { blade_edge: 46 } }), { maxHeroLevel: 80 }).branches[0].nodes[0];
  expect(near).toMatchObject({ canOne: true, canFive: false, maxN: 4 });
});

test('전설 수련 판: 상한이 있는 노드는 합계 상한 문구, 방어는 정수·나머지는 % 표기', () => {
  expect(statText('atkPct', 0.0328)).toBe('+3.3%');
  expect(statText('def', 123.9)).toBe('+123');
  expect(statText('cdr', 0.1)).toBe('+10.0%');
  const plunder = legendBoard(legendState(), { maxHeroLevel: 80 }).branches[3];
  expect(plunder.nodes.find((n: any) => n.id === 'plunder_gold')?.capText).toBe('합계 상한 30%');
  expect(plunder.nodes.find((n: any) => n.id === 'plunder_drop')?.capText).toBe('합계 상한 20%');
  expect(plunder.nodes.find((n: any) => n.id === 'plunder_ore')?.capText).toBe('');
});

test('전설 수련 판: 키스톤은 5단계마다 하나씩 갈래 순서로 열리고 진행(남은 단계)이 보인다', () => {
  const at = (rank: number) => legendBoard(legendState({ rank }), { maxHeroLevel: 80 });
  expect(at(4).branches.map((b: any) => b.openKeystones)).toEqual([0, 0, 0, 0]);
  expect(at(4).upcoming).toMatchObject({ unlockRank: 5, branch: 'blade', remaining: 1 });
  expect(at(4).upcomingText).toContain('5단계');
  expect(at(5).branches.map((b: any) => b.openKeystones)).toEqual([1, 0, 0, 0]);
  expect(at(20).branches.map((b: any) => b.openKeystones)).toEqual([1, 1, 1, 1]);
  const full = at(100);
  expect(full.branches.map((b: any) => b.openKeystones)).toEqual([5, 5, 5, 5]);
  expect(full.upcoming).toBeNull();
  expect(full.upcomingText).toBe('모든 키스톤이 열렸습니다');
  const blade = at(40).branches[0];
  expect(blade.keystones.map((k: any) => k.open)).toEqual([true, true, false, false, false]);
  expect(blade.nextKeystone).toMatchObject({ unlockRank: 45, remaining: 5 });
  // 효과 설명은 규칙 데이터 그대로(스탯 키스톤 없음)
  for (const k of blade.keystones) expect(LEGEND_KEYSTONES.find((x: any) => x.id === k.id)?.effect).toBe(k.effect);
});

test('전설 수련 판: 재분배 비용·가능 여부·사유(찍은 점수 없음 / 골드 부족)', () => {
  const none = legendBoard(legendState({ nodes: {}, rank: 10 }), { maxHeroLevel: 80, gold: 99 });
  expect(none.respec).toEqual({ spent: 0, cost: 0, canAfford: true, enabled: false, reason: '되돌릴 점수가 없습니다' });
  const spent = legendBoard(legendState(), { maxHeroLevel: 80, gold: 1_000_000 });
  expect(spent.respec).toMatchObject({ spent: 8, cost: LEGEND.respecBase + LEGEND.respecPerPoint * 8, canAfford: false, enabled: true });
  expect(spent.respec.reason).toContain('골드가 부족합니다');
  const rich = legendBoard(legendState(), { maxHeroLevel: 80, gold: 5_000_000 });
  expect(rich.respec).toMatchObject({ canAfford: true, enabled: true, reason: '' });
});

test('전설 수련 판: 전투력 미리보기는 주어진 함수로만 계산하고 점수가 모자라면 생략한다', () => {
  const calls: any[] = [];
  const power = (state: any) => { calls.push(state); return 1000 + Object.values(state.nodes as Record<string, number>).reduce((a, b) => a + b, 0) * 10; };
  const board = legendBoard(legendState(), { maxHeroLevel: 80, power, selectedNodeId: 'blade_fury' });
  const node = board.branches[0].nodes.find((n: any) => n.id === 'blade_fury')!;
  expect(node.previewOne).toEqual({ before: 1080, after: 1090, delta: 10 });
  expect(node.previewFive).toEqual({ before: 1080, after: 1130, delta: 50 });
  // 가설 상태는 원본을 바꾸지 않고 점수만 줄여 넘긴다
  expect(calls.some((s) => s.nodes.blade_fury === 5 && s.points === 27)).toBe(true);
  // 함수가 없으면 미리보기 없음, 점수가 0 이면 항상 없음
  expect(legendBoard(legendState(), { maxHeroLevel: 80 }).branches[0].nodes[0].previewOne).toBeNull();
  expect(legendBoard(legendState({ rank: 8 }), { maxHeroLevel: 80, power, selectedNodeId: 'blade_edge' }).branches[0].nodes[0].previewOne).toBeNull();
  // 선택 노드만 계산한다: 다른 노드는 미리보기 없음, power 호출은 기준 1회 + 선택 노드 +1·+5 두 번
  calls.length = 0;
  const only = legendBoard(legendState(), { maxHeroLevel: 80, power, selectedNodeId: 'blade_fury' });
  expect(calls).toHaveLength(3);
  expect(only.branches.flatMap((b: any) => b.nodes).filter((n: any) => n.previewOne || n.previewFive).map((n: any) => n.id)).toEqual(['blade_fury']);
  calls.length = 0; legendBoard(legendState(), { maxHeroLevel: 80, power }); expect(calls).toHaveLength(1);
  expect(legendBoard(legendState({ rank: 12 }), { maxHeroLevel: 80, power, selectedNodeId: 'blade_fury' }).branches[0].nodes.find((n: any) => n.id === 'blade_fury')!.previewFive).toBeNull();
});

test('전설 수련 판: 실제 Economy 의 찍기·재분배 결과가 판 모델과 맞는다', () => {
  const eco = newEco();
  eco.s.legend = { version: 1, rank: 20, exp: 0, points: 0, nodes: {} }; eco.s.gold = 10_000_000;
  const heroLevels = () => Math.max(...Object.values(eco.s.heroes as Record<string, any>).map((h: any) => h.level || 1));
  const read = () => legendBoard(eco.legendState(), { maxHeroLevel: Math.max(80, heroLevels()), gold: eco.s.gold });
  expect(read().points).toBe(20);
  expect(eco.legendAllocate('blade_edge', 1)).toMatchObject({ ok: true, level: 1, points: 19 });
  expect(eco.legendAllocate('blade_edge', 5)).toMatchObject({ ok: true, level: 6, points: 14 });
  expect(eco.legendAllocate('blade_edge', 15)).toMatchObject({ ok: false, error: 'points' });
  expect(read().branches[0].nodes[0]).toMatchObject({ level: 6, canFive: true, maxN: 14 });
  const board = read();
  expect(board.respec.cost).toBe(eco.legendRespecCost());
  const gold = eco.s.gold, res = eco.legendRespec();
  expect(res).toMatchObject({ ok: true, refunded: 6, cost: board.respec.cost });
  expect(eco.s.gold).toBe(gold - board.respec.cost);
  expect(read()).toMatchObject({ points: 20, spent: 0, respec: { enabled: false } });
  // 골드가 모자라면 아무것도 바뀌지 않는다
  eco.legendAllocate('wall_bulk', 3); eco.s.gold = 10;
  const before = structuredClone(eco.legendState());
  expect(eco.legendRespec()).toMatchObject({ ok: false, error: 'gold' });
  expect(eco.legendState()).toEqual(before);
  expect(eco.s.gold).toBe(10);
});

// ------------------------------------------------------------------ 장비 접두
test('장비 접두·단계 표기: 10 이상 고대, 25 이상 태고, 그 밑은 단계만, 고통 단계 아닌 장비는 아무것도 붙지 않는다', () => {
  expect(tierName('성검', { tp: 25 })).toBe('태고 성검');
  expect(tierName('성검', { tp: 50 })).toBe('태고 성검');
  expect(tierName('성검', { tp: 24 })).toBe('고대 성검');
  expect(tierName('성검', { tp: 10 })).toBe('고대 성검');
  expect(tierName('성검', { tp: 9 })).toBe('성검');
  for (const bad of [undefined, null, {}, { tp: 0 }, { tp: -3 }, { tp: 1.5 }, { tp: '12' }, { tp: NaN }]) {
    expect(tierName('성검', bad as any)).toBe('성검'); expect(tierTag(bad as any)).toBe(''); expect(tierTone(bad as any)).toBe(''); expect(tierNote(bad as any)).toBe('');
  }
  expect(tierTag({ tp: 12 })).toBe('T12');
  expect(tierTag({ tp: 3 })).toBe('T3');
  expect(tierTone({ tp: 3 })).toBe('tp');
  expect(tierTone({ tp: 10 })).toBe('godae');
  expect(tierTone({ tp: 25 })).toBe('taego');
  expect(tierNote({ tp: 30 })).toBe('고통 30단계 장비 · 태고');
  expect(tierNote({ tp: 3 })).toBe('고통 3단계 장비');
});

test('장비 접두: 실제 고통 단계 드랍 인스턴스에서 같은 표기가 나온다', () => {
  const eco = newEco();
  const inst = eco.addItem('L', 'weapon', () => .5, 12), plain = eco.addItem('L', 'weapon', () => .5);
  expect(tierName('황혼 성검', inst)).toBe('고대 황혼 성검');
  expect(tierTag(inst)).toBe('T12');
  expect(tierName('황혼 성검', plain)).toBe('황혼 성검');
  expect(tierTag(plain)).toBe('');
});
