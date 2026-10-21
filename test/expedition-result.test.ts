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

function fixture(overrides: any = {}, appExtra: any = {}) {
  const calls: any[] = [], item = Object.values(ITEM_BY_ID)[0];
  const result: any = { win: true, kind: 'dungeon', id: 'glass_garden', name: '유리 정원', depth: 'standard',
    kills: 37, combo: 12, time: 109.7, saveError: null,
    rewards: { gold: 1234, xp: 150, heroExp: 150, stones: 3,
      loot: Array.from({ length: 45 }, (_, i) => ({ uid: i + 1, id: item.id })) }, ...overrides };
  const app: any = { stageStarting: false, battle: { result: { masterworks: { renown: 5, breaks: 2, perfects: 3, boons: [] } },
    chronicle: { open: (tab: string) => calls.push(['mastery', tab]) } },
    journeyView: { open: (tab: string) => calls.push(['journey', tab]) }, toLobby: () => calls.push(['lobby']),
    meta: { openTab: (tab: string) => calls.push(['tab', tab]) } };
  Object.assign(app, appExtra);
  const controller: any = { app, result, close: () => calls.push(['close']), open: (tab: string) => calls.push(['open', tab]),
    showResult: (...args: any[]) => calls.push(['save', ...args]) };
  const launch = (...args: any[]) => calls.push(['launch', ...args]);
  const render = () => expand(ExpeditionResult({ controller, launch, message: '', focusRef: { current: null } }))[0];
  const view = render(), nodes = all(view), buttons = nodes.filter(n => n.type === 'button');
  const button = (label: string) => buttons.find(n => text(n) === label || (label === '다시 도전' && text(n).startsWith('다시 도전 · ')));
  return { app, controller, result, calls, view, nodes, buttons, button, render };
}

test('victory summary precedes folded growth and loot; all departure actions remain outside the single scroll body', () => {
  const f = fixture(), scroll = f.nodes.find(n => n.props.className === 'exp-scroll exp-result-scroll');
  const footer = f.nodes.find(n => n.type === 'footer'), details = f.nodes.filter(n => n.type === 'details');
  expect(f.view.children).toContain(footer); expect(all(scroll)).not.toContain(footer);
  expect(f.nodes.filter(n => n.props.className?.split(' ').includes('exp-scroll'))).toHaveLength(1);
  // 결과 하단은 다시 도전 · 장비 정비 두 행동(다음 던전이 있으면 그 앞에 하나 더). 로비는 머리글이다.
  expect(footer.children.filter((n: any) => n.type === 'button')).toHaveLength(2);
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

for (const [kind,id,depth,energy] of [['dungeon','glass_garden','standard',4],['dungeon','glass_garden','deep',6],['dungeon','comet_bastion','deep',8],['arena','rookie','standard',0]] as const)
test(`${kind}/${id}/${depth} retry displays the catalog cost without spending or altering its departure`,()=>{
  const f=fixture({kind,id,depth});expect(text(f.button('다시 도전'))).toBe(`다시 도전 · 에너지 ${energy}`);expect(f.calls).toEqual([]);
  f.button('다시 도전').props.onClick();expect(f.calls).toEqual([['launch',kind,id,{rift:false,depth,conquestId:undefined}]]);
});

test('record result shows only the frozen restored pages, including partial defeat', () => {
  const report = Object.freeze({ progress: 1, target: 3, complete: false,
    pages: Object.freeze([Object.freeze({ pageId: 3, label: '3쪽 · 귀환 경로' })]) });
  const f = fixture({ win: false, routeObjective: report, rewards: {} });
  expect(text(f.view)).toContain('기록 복원 1/3');
  expect(text(f.view)).toContain('3쪽 · 귀환 경로');
  expect(text(f.view)).not.toContain('1쪽 · 출발 좌표');
  expect(f.result.routeObjective).toBe(report);
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

test('retry preserves deep, rift and conquest identity; gear maintenance clears the result only on departure', () => {
  const f = fixture({ depth: 'deep', riftId: 'glass_garden', conquestId: EXPEDITION_CONQUESTS[0].id });
  f.button('다시 도전').props.onClick();
  expect(f.calls).toEqual([['launch', 'dungeon', 'glass_garden', { rift: true, depth: 'deep', conquestId: EXPEDITION_CONQUESTS[0].id }]]);
  expect(f.controller.result).toBe(f.result);
  // 정산 → 장비 확인을 한 번에 잇는다. 제작 공방 · 퀘스트는 결과 하단의 동급 버튼이 아니라 메뉴에서 연다.
  const gear = fixture(); gear.button('장비 정비').props.onClick();
  expect(gear.controller.result).toBeNull(); expect(gear.calls).toEqual([['lobby'], ['tab', 'heroes']]);
  expect(gear.button('전리품 정비')).toBeUndefined(); expect(gear.button('퀘스트 확인')).toBeUndefined();
  const blocked = fixture({ saveError: 'storage' });
  expect(blocked.button('장비 정비').props.disabled).toBe(true);
});

// item-identity: 결과 전리품은 출전 영웅이 실제로 드는 형태의 그림이다(가방 · 장착 칸과 같은 그림). 장비 정비는 그 영웅의 장비 화면을 연다.
test('ranger result loot uses the bow-form weapon art and gear maintenance opens that hero', () => {
  const f = fixture({ rewards: { gold: 1, xp: 1, heroExp: 1, stones: 0, loot: [{ uid: 9, id: 'w_storm' }] } }, { eco: { s: { selected: 'ranger' } } });
  const srcs = f.nodes.filter(n => n.type === 'img').map(n => String(n.props.src));
  expect(srcs.some(src => src.endsWith('/forms/w_storm--bow.webp'))).toBe(true);
  f.button('장비 정비').props.onClick();
  expect(f.app.meta.heroSel).toBe('ranger'); expect(f.calls).toEqual([['lobby'], ['tab', 'heroes']]);
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
    const battle: any = { result: { time: 58.383333333 }, stage: { expedition: { kind: 'dungeon', id: 'glass_garden', depth: 'deep' }, title: '깊은 정원' },
      drops: { gold: 100, stones: 0, stones2: 0, stones3: 0, fragments: 0, loot: [] }, kills: 10, maxCombo: 5, elapsed: 60 };
    controller.showResult(battle, true); expect(controller.result.saveError).toBe('storage'); expect(app.expeditionTicket).toBe(ticket);
    controller.showResult(battle, true); expect(controller.result.saveError).toBeNull(); expect(app.expeditionTicket).toBeNull();
    controller.showResult(battle, true); expect(settlements).toBe(2); expect(battle.result.expeditionReceipt).toBe(receipt);
    expect(controller.result.rewards).toBe(receipt.rewards); expect(controller.result.depth).toBe('deep');
    expect(controller.result.time).toBe(58.383333333); // terminal combat clock, not celebration/save retries
    battle.elapsed = 150; controller.showResult(battle, true);
    expect(controller.result.time).toBe(58.383333333); expect(settlements).toBe(2);
  } finally { played.mockRestore(); }
});

test('Astral result shows only frozen restored identities and wrong attempts, including zero and partial defeat', () => {
  for (const progress of [0, 1, 4]) {
    const report = Object.freeze({ progress, target: 4, complete: progress === 4, mistakes: 2,
      constellations: Object.freeze(Array.from({ length: progress }, (_, i) => Object.freeze({ stationId: i + 1, label: `${i + 1}번 조율판` }))) });
    const f = fixture({ win: progress === 4, routeObjective: report, rewards: {} });
    expect(text(f.view)).toContain(`별자리 복원 ${progress}/4`); expect(text(f.view)).toContain('오답 2회');
    expect(text(f.view)).not.toContain('기록 복원');
    if (progress === 0) expect(text(f.view)).toContain('복원한 별자리 없음');
    for (let i = 0; i < progress; i++) expect(text(f.view)).toContain(`${i + 1}번 조율판`);
    if (progress < 4) expect(text(f.view)).not.toContain(`${progress + 1}번 조율판`);
  }
});

test('보상 칩 띠가 요약 바로 다음, 접힌 상세보다 앞에 오고 장비 칩은 최고 희귀도 색을 쓴다', () => {
  const f = fixture(), strip = f.nodes.find(n => n.props.className === 'exp-chips exp-reward-strip');
  const summary = f.nodes.find(n => n.props.className === 'exp-result-summary'), details = f.nodes.filter(n => n.type === 'details');
  expect(strip).toBeDefined();
  expect(f.nodes.indexOf(summary)).toBeLessThan(f.nodes.indexOf(strip)); expect(f.nodes.indexOf(strip)).toBeLessThan(f.nodes.indexOf(details[0]));
  const chips = f.nodes.filter(n => n.props.className === 'exp-reward-chip');
  expect(chips.map(text)).toEqual(expect.arrayContaining(['골드 +1,234', '영웅 EXP +150', '강화석 +3']));
  const gear = chips.find(n => n.props['data-tier'] === 'loot');
  expect(text(gear)).toBe('장비 +45'); expect(gear.props.style['--chip-color']).toMatch(/^#[0-9a-f]{6}$/i);
});

test('미사용 정원의 장치는 한 줄 라벨로만 접고 사용했다면 설명 블록을 유지한다', () => {
  const find = (receipt: any) => fixture({ mapTactics: receipt }).nodes.find(n => n.props['data-map-tactics-result'] !== undefined);
  const unused = find({ id: 'garden_plinths_standard', roomId: 3, used: false, canceled: false });
  expect(unused.type).toBe('p'); expect(unused.props.className).toContain('map-tactics-unused'); expect(text(unused)).toBe('정원의 장치 · 미사용');
  const used = find({ id: 'garden_plinths_standard', roomId: 3, used: true, canceled: false, selectedId: 'gather', affectedCount: 4 });
  expect(used.type).toBe('section'); expect(text(used)).toContain('제어 대상 4명');
});

test('보상 숫자 카운트업은 모션 줄이기 설정에서 즉시 최종값을 쓴다', async () => {
  const { countUpRef } = await import('../src/expansion/hub.jsx');
  const el: any = { dataset: { count: '1234' }, textContent: '', isConnected: true };
  const g: any = globalThis, prev = g.matchMedia;
  g.matchMedia = () => ({ matches: true });
  try { countUpRef(el); expect(el.textContent).toBe('+1,234'); } finally { g.matchMedia = prev; }
  countUpRef(null);
});
