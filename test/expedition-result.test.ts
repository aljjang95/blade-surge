import { expect, spyOn, test } from 'bun:test';
import { ExpeditionResult, ExpeditionUI } from '../src/expansion/hub.jsx';
import { ITEM_BY_ID } from '../src/data/items.js';
import { EXPEDITION_CONQUESTS } from '../src/data/expedition-conquests.js';
import { audio } from '../src/engine/audio.js';

// Expand the real, stateless result component so event guards can be exercised without a browser.
function expand(node: any): any[] {
  if (node == null || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap(expand);
  if (typeof node !== 'object') return [node];
  if (typeof node.type === 'function') return expand(node.type(node.props));
  if (typeof node.type === 'symbol') return expand(node.props.children);
  return [{ type: node.type, props: node.props, children: expand(node.props.children) }];
}
const all = (node: any): any[] => typeof node !== 'object' ? [] : [node, ...node.children.flatMap(all)];
const text = (node: any): string => typeof node !== 'object' ? String(node) : node.children.map(text).join('');

function fixture(overrides: any = {}) {
  const calls: any[] = [], item = Object.values(ITEM_BY_ID)[0];
  const result: any = { win: true, kind: 'dungeon', id: 'glass_garden', name: '유리 정원', depth: 'standard',
    kills: 37, combo: 12, time: 109.7, saveError: null,
    rewards: { gold: 1234, xp: 150, heroExp: 150, stones: 3,
      loot: Array.from({ length: 45 }, (_, i) => ({ uid: i + 1, id: item.id })) }, ...overrides };
  const app: any = { stageStarting: false, battle: { result: { masterworks: { renown: 5, breaks: 2, perfects: 3, boons: [] } },
    chronicle: { open: (tab: string) => calls.push(['mastery', tab]) } },
    journeyView: { open: (tab: string) => calls.push(['journey', tab]) }, toLobby: () => calls.push(['lobby']) };
  const controller: any = { app, result, close: () => calls.push(['close']), open: (tab: string) => calls.push(['open', tab]),
    showResult: (...args: any[]) => calls.push(['save', ...args]) };
  const launch = (...args: any[]) => calls.push(['launch', ...args]);
  const render = () => expand(ExpeditionResult({ controller, launch, message: '', focusRef: { current: null } }))[0];
  const view = render(), nodes = all(view), buttons = nodes.filter(n => n.type === 'button');
  const button = (label: string) => buttons.find(n => text(n) === label);
  return { app, controller, result, calls, view, nodes, buttons, button, render };
}

test('victory summary precedes folded growth and loot; all departure actions remain outside the single scroll body', () => {
  const f = fixture(), scroll = f.nodes.find(n => n.props.className === 'exp-scroll exp-result-scroll');
  const footer = f.nodes.find(n => n.type === 'footer'), details = f.nodes.filter(n => n.type === 'details');
  expect(f.view.children).toContain(footer); expect(all(scroll)).not.toContain(footer);
  expect(f.nodes.filter(n => n.props.className?.split(' ').includes('exp-scroll'))).toHaveLength(1);
  expect(footer.children.filter((n: any) => n.type === 'button')).toHaveLength(3);
  expect(details).toHaveLength(2); expect(details.every(n => !n.props.open)).toBe(true);
  const summary = f.nodes.find(n => n.props.className === 'exp-result-summary');
  expect(text(summary)).toContain('원정 승리'); expect(text(summary)).toContain('유리 정원');
  expect(text(summary)).toContain('37처치'); expect(text(summary)).toContain('12최대 콤보'); expect(text(summary)).toContain('109초');
  expect(text(f.view)).toContain('골드 +1,234'); expect(text(f.view)).toContain('획득 장비 45개');
  expect(f.nodes.indexOf(summary)).toBeLessThan(f.nodes.indexOf(details[0])); expect(f.calls).toEqual([]);
});

test('defeat reports the actual route and no clear rewards', () => {
  const f = fixture({ win: false, kind: 'arena', name: '연습 상대', rewards: {} });
  expect(text(f.view)).toContain('원정 패배'); expect(text(f.view)).toContain('연습 상대');
  expect(text(f.view)).toContain('결투장'); expect(text(f.view)).toContain('클리어 보상은 없습니다');
  expect(text(f.view)).not.toContain('영웅 EXP +'); expect(f.button('다시 도전').props.disabled).toBe(false);
});

test('failed save disables every departure, blocks direct callbacks and exposes only the existing save retry', () => {
  const f = fixture({ saveError: 'storage' });
  const save = f.button('정산 다시 저장'); expect(save).toBeDefined();
  for (const button of f.buttons.filter(b => b !== save)) {
    expect(button.props.disabled).toBe(true); button.props.onClick();
  }
  expect(text(f.view)).not.toContain('전리품 보기'); expect(f.calls).toEqual([]);
  save.props.onClick(); expect(f.calls).toEqual([['save', f.app.battle, true]]);
});

for (const gate of ['failed-later', 'stale', 'starting']) test(`${gate} blocks previously rendered departure handlers`, () => {
  const f = fixture();
  if (gate === 'failed-later') f.result.saveError = 'storage';
  if (gate === 'stale') f.controller.result = { ...f.result };
  if (gate === 'starting') f.app.stageStarting = true;
  for (const button of f.buttons) button.props.onClick();
  expect(f.calls).toEqual([]);
});

test('retry preserves deep, rift and conquest identity; forge and quests clear the result only on departure', () => {
  const f = fixture({ depth: 'deep', riftId: 'glass_garden', conquestId: EXPEDITION_CONQUESTS[0].id });
  f.button('다시 도전').props.onClick();
  expect(f.calls).toEqual([['launch', 'dungeon', 'glass_garden', { rift: true, depth: 'deep', conquestId: EXPEDITION_CONQUESTS[0].id }]]);
  expect(f.controller.result).toBe(f.result);
  for (const [label, tab] of [['전리품 정비', 'forge'], ['퀘스트 확인', 'quests']]) {
    const next = fixture(); next.button(label).props.onClick();
    expect(next.controller.result).toBeNull(); expect(next.calls).toEqual([['lobby'], ['open', tab]]);
  }
});

test('growth and journey keep their existing destinations after a successful save', () => {
  const f = fixture();
  f.button('명성으로 영구 숙련 배우기').props.onClick(); f.button('성장 여정 · 의뢰 보상').props.onClick();
  expect(f.calls).toEqual([['mastery', 'mastery'], ['journey', 'contracts']]);
});

test('controller retries a failed receipt but never settles an already successful result again', () => {
  const played = spyOn(audio, 'play').mockImplementation(() => undefined);
  try {
    let settlements = 0;
    const receipt = { ok: true, rewards: { gold: 100, loot: [] } }, ticket = { id: 7 };
    const app: any = { expeditionTicket: ticket, expedition: { settle: () => ++settlements === 1 ? { ok: false, error: 'storage' } : receipt },
      ui: { showHud() {}, show() {}, closeModal() {}, el: { pause: {} } } };
    const controller: any = Object.assign(Object.create(ExpeditionUI.prototype), { app, open() {} });
    const battle: any = { result: {}, stage: { expedition: { kind: 'dungeon', id: 'glass_garden', depth: 'deep' }, title: '깊은 정원' },
      drops: { gold: 100, stones: 0, stones2: 0, stones3: 0, fragments: 0, loot: [] }, kills: 10, maxCombo: 5, elapsed: 60 };
    controller.showResult(battle, true); expect(controller.result.saveError).toBe('storage'); expect(app.expeditionTicket).toBe(ticket);
    controller.showResult(battle, true); expect(controller.result.saveError).toBeNull(); expect(app.expeditionTicket).toBeNull();
    controller.showResult(battle, true); expect(settlements).toBe(2); expect(battle.result.expeditionReceipt).toBe(receipt);
    expect(controller.result.rewards).toBe(receipt.rewards); expect(controller.result.depth).toBe('deep');
  } finally { played.mockRestore(); }
});
