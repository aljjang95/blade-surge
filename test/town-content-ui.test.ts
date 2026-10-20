import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { TownService } from '../src/game/town-service.js';
import { DUNGEONS } from '../src/data/expansion.js';
import { TownUI } from '../src/ui/town-ui.js';
import { CONTENT_TABS, TownContent, dungeonDestinationSpot, normalizeField, normalizeForge, normalizeQuests, normalizeStory, upgradeCandidates } from '../src/ui/town-content.js';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
let values: Map<string, string>;

// 화면 요소 대역: 마크업 문자열과 이벤트 연결만 검증한다. 실제 레이아웃 · 초점은 브라우저 검증 대상이다.
function makeEl(): any {
  const el: any = { dataset: {}, style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {} }, innerHTML: '', open: false, scrollTop: 0, listeners: {} as Record<string, any[]>,
    addEventListener(type: string, fn: any) { (el.listeners[type] ||= []).push(fn); }, setAttribute() {}, append() {}, remove() {}, focus() {}, insertAdjacentHTML() {},
    showModal() { el.open = true; }, close() { el.open = false; }, querySelector: () => el, querySelectorAll: () => [] };
  return el;
}

beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: makeEl, body: { append() {} }, querySelector: () => null, activeElement: null } });
});
afterEach(() => {
  for (const [name, saved] of [['localStorage', originalStorage], ['document', originalDocument]] as const) {
    if (saved) Object.defineProperty(globalThis, name, saved); else Reflect.deleteProperty(globalThis, name);
  }
});

function make() {
  const eco: any = new Economy();
  eco.s.gold = 200_000;
  eco.s.expedition.materials = { glass_leaf: 100, ember_core: 100, star_dust: 100 };
  const service: any = new TownService(eco);
  const started: any[] = [], toasts: string[] = [];
  const app: any = { eco, mode: 'lobby', stageStarting: false, towns: service, syncHub() {},
    ui: { toast: (message: string) => toasts.push(message) },
    expedition: { s: {}, snapshot: () => ({ stats: eco.s.expedition.stats, materials: eco.s.expedition.materials }), dungeonAccess: () => ({ ok: true }) },
    startExpedition: async (...args: any[]) => { started.push(args); return true; } };
  const ui: any = new TownUI(app, service);
  const click = (act: string, dataset: Record<string, string> = {}) => {
    const control = { disabled: false, dataset: { townAct: act, ...dataset } };
    ui.dialog.listeners.click[0]({ stopPropagation() {}, target: { closest: () => control } });
  };
  return { eco, service, app, ui, click, started, toasts };
}

test('서비스 응답을 의뢰 · 대장장이 · 이야기 · 필드 화면 모델로 바꾼다', () => {
  const { service } = make();
  const quests: any[] = normalizeQuests(service.requests('oathhold'))!;
  expect(quests.map(quest => quest.status)).toEqual(['available', 'available']);
  expect(quests[0]).toMatchObject({ id: 'oathhold_daily_clear', kind: 'daily', goal: '던전 클리어 1회' });
  expect(normalizeQuests(null)).toBeNull();
  expect(normalizeQuests(undefined)).toBeNull();

  const forge: any = normalizeForge(service.blacksmith('oathhold'))!;
  expect(forge.unlocked).toBe(true);
  expect(forge.recipes.length).toBe(2);
  expect(forge.recipes.find((recipe: any) => recipe.id === 'brew_tonic').repeatable).toBe(true);
  expect(normalizeForge(service.blacksmith('emberport'))!.unlocked).toBe(false);

  const story: any = normalizeStory(service.story('oathhold'))!;
  expect(story.steps.map((step: any) => step.status)).toEqual(['active', 'locked', 'locked']);
  expect(story.steps[0].attemptable).toBe(true);
  expect(story.steps.map((step: any) => step.index)).toEqual([1, 2, 3]);

  const field: any = normalizeField(service.field('oathhold'), service.towns()[0])!;
  expect(field).toMatchObject({ id: 'windmeadow', unlocked: true });
  expect(field.entries.map((entry: any) => entry.kind)).toEqual(['gather', 'elite', 'treasure', 'event']);
  expect(normalizeField(null, { id: 'x' })).toBeNull();
  expect(normalizeField(service.field('starcrest'), service.towns()[2])).toMatchObject({ unlocked: false, reason: 'locked' });
});

test('서비스가 모르는 기능은 빈 상태 안내로 남고 화면을 깨지 않는다', () => {
  const eco: any = new Economy();
  const app: any = { eco, mode: 'lobby', expedition: { s: {}, snapshot: () => ({ stats: {}, materials: {} }) } };
  const bare: any = { towns: () => [{ id: 'oathhold', name: '서약의 성채', unlocked: true, dungeonIds: [] }], currentTownId: () => 'oathhold' };
  const ui: any = new TownUI(app, bare);
  for (const tab of CONTENT_TABS) expect(typeof ui.content.html(tab.id)).toBe('string');
  expect(ui.content.html('quests')).toContain('아직 열리지 않았습니다');
  expect(ui.content.html('field')).toContain('아직 연결된 필드가 없습니다');
  expect(ui.content.claimable()).toBe(0);
});

test('마을 일 칩과 탭 클릭으로 의뢰를 수락하고 완료해 보상을 받는다', () => {
  const { eco, service, ui, click } = make();
  const chip = makeEl(), badge = makeEl(), row = makeEl(), place = makeEl(), map = makeEl(), root = makeEl();
  place.querySelector = (selector: string) => selector === '.town-place-row' ? row : selector === '.town-map-chip' ? map : chip;
  chip.querySelector = () => badge; root.querySelector = (selector: string) => selector === '.citadel-hub-place' ? place : chip;
  ui.renderPlace(root);
  chip.listeners.click[0]({ stopPropagation() {}, currentTarget: chip });
  expect(ui.dialog.open).toBe(true);
  expect(ui.view).toBe('dungeons');
  for (const tab of CONTENT_TABS) expect(ui.dialog.innerHTML).toContain('data-view="' + tab.id + '"');

  click('view', { view: 'quests' });
  expect(ui.dialog.innerHTML).toContain('data-town-act="quest-accept" data-offer="oathhold_daily_clear"');
  click('quest-accept', { offer: 'oathhold_daily_clear' });
  expect(service.requests('oathhold').find((quest: any) => quest.id === 'oathhold_daily_clear').accepted).toBe(true);
  expect(ui.dialog.innerHTML).not.toContain('data-town-act="quest-claim"');
  click('quest-accept', { offer: 'oathhold_daily_clear' });
  expect(ui.message).toBe('이미 수락한 의뢰입니다.');

  service.recordRequestProgress('oathhold', 'dungeon', 1);
  expect(ui.dialog.innerHTML).toContain('data-town-act="quest-claim" data-offer="oathhold_daily_clear"');
  expect(ui.content.claimable()).toBe(1);
  expect(badge.textContent).toBe('1');
  const gold = eco.s.gold;
  click('quest-claim', { offer: 'oathhold_daily_clear' });
  expect(eco.s.gold).toBe(gold + 450);
  expect(ui.tone).toBe('success');
  click('quest-claim', { offer: 'oathhold_daily_clear' });
  expect(eco.s.gold).toBe(gold + 450);
  expect(ui.tone).toBe('error');
  expect(badge.textContent).toBe('');
});

test('대장장이 제작은 재료 부족을 막고 성공하면 저장하며, 위험한 강화는 두 번 눌러야 한다', () => {
  const { eco, service, ui, click } = make();
  ui.open('forge');
  eco.s.gold = 10; click('forge-craft', { offer: 'storm_blade' });
  expect(ui.tone).toBe('error');
  expect(eco.s.inventory.some((item: any) => item.id === 'w_storm')).toBe(false);
  eco.s.gold = 200_000; click('forge-craft', { offer: 'storm_blade' });
  expect(ui.tone).toBe('success');
  expect(eco.s.inventory.some((item: any) => item.id === 'w_storm')).toBe(true);
  expect(service.blacksmith('oathhold').find((recipe: any) => recipe.id === 'storm_blade').crafted).toBe(true);
  expect(ui.dialog.innerHTML).not.toContain('data-offer="storm_blade"></button>');

  const uid = eco.s.invSeq++;
  eco.s.inventory.push({ uid, id: 'w_town_oath', enh: 10 }); eco.s.stones2 = 10;
  ui.content.armed = null; ui.render();
  expect(upgradeCandidates(eco.s).some(entry => entry.id === String(uid) && entry.down === 1)).toBe(true);
  const gold = eco.s.gold;
  click('forge-enhance', { offer: String(uid) });
  expect(eco.s.gold).toBe(gold); // 첫 클릭은 경고만 한다
  expect(ui.message).toContain('한 번 더');
  click('forge-enhance', { offer: String(uid) });
  expect(eco.s.gold).toBeLessThan(gold);
});

test('마을 이야기는 3단계 순서대로만 열리고 미달 시도는 거절된다', () => {
  const { service, ui, click, eco } = make();
  ui.open('story');
  expect((ui.dialog.innerHTML.match(/class="town-c-chapter"/g) || []).length).toBe(3);
  click('story-advance', { offer: 'oathhold_chapter_1' });
  expect(ui.tone).toBe('error');
  expect(service.story('oathhold')[0].complete).toBe(false);
  service.progressStory('oathhold', 'dungeon', 1);
  const gold = eco.s.gold;
  click('story-advance', { offer: 'oathhold_chapter_1' });
  expect(ui.tone).toBe('success');
  expect(eco.s.gold).toBe(gold + 500);
  expect(service.story('oathhold').map((step: any) => step.complete)).toEqual([true, false, false]);
  expect(ui.dialog.innerHTML).toContain('data-status="done"');
  click('story-advance', { offer: 'oathhold_chapter_1' });
  expect(ui.tone).toBe('error');
});

test('필드 입장은 마을의 fieldId로 기본 원정을 시작하고 저장된 마을 필드만 허용한다', async () => {
  const { ui, click, started, app } = make();
  ui.open('field');
  expect(ui.dialog.innerHTML).toContain('data-town-act="enter-field" data-field="windmeadow"');
  click('enter-field', { field: 'dawnward_city' }); // 다른 마을의 필드 id는 거절
  await Promise.resolve();
  expect(started).toEqual([]);
  expect(ui.tone).toBe('error');
  click('enter-field', { field: 'windmeadow' });
  await Promise.resolve();
  expect(started).toEqual([['dungeon', 'windmeadow', { depth: 'standard' }]]);
  expect(ui.dialog.open).toBe(false);
  app.expedition.dungeonAccess = () => ({ ok: false, error: '탐험 레벨 99 필요' });
  ui.open('field');
  expect(ui.dialog.innerHTML).toContain('탐험 레벨 99 필요');
});

test('던전 6곳은 허브가 아는 곳은 출격 준비 창으로, 모르는 곳은 한 번 더 눌러 직접 출격한다', async () => {
  const { ui, click, started, app } = make();
  ui.open('dungeons');
  const ids = ui.towns()[0].dungeonIds;
  expect(ids).toHaveLength(6);
  expect((ui.dialog.innerHTML.match(/data-town-act="enter-dungeon"/g) || []).length).toBe(6);
  const opened: any[] = [];
  app.hubUI = { openDestination: (spot: any) => { opened.push(spot.route); return true; } };
  const known = ids.find((id: string) => dungeonDestinationSpot(id)), unknown = ids.find((id: string) => !dungeonDestinationSpot(id));
  expect(known).toBeTruthy();
  click('enter-dungeon', { dungeon: known });
  expect(opened).toEqual([known]);
  expect(ui.dialog.open).toBe(false);
  if (unknown) {
    ui.open('dungeons');
    click('enter-dungeon', { dungeon: unknown });
    await Promise.resolve();
    expect(started).toEqual([]); // 첫 클릭은 비용 안내만
    expect(ui.message).toContain('한 번 더');
    click('enter-dungeon', { dungeon: unknown });
    await Promise.resolve();
    expect(started).toEqual([['dungeon', unknown, { depth: 'standard' }]]);
  }
  ui.open('dungeons');
  click('enter-dungeon', { dungeon: 'forged_dungeon' });
  expect(started.length).toBe(unknown ? 1 : 0);
  expect(ui.tone).toBe('error');
  expect(DUNGEONS.length).toBeGreaterThanOrEqual(ids.length);
});

test('해금은 처음 보는 저장에서는 조용하고, 이후 새로 열린 곳만 NEW와 안내로 알린다', () => {
  const { eco, service, ui, toasts } = make();
  expect(ui.content.unlockMap().has('town:oathhold')).toBe(true);
  expect(ui.content.checkUnlocks()).toEqual([]); // 기준선은 생성자에서 이미 잡았다
  expect(ui.content.fresh.size).toBe(0);
  for (const id of service.towns()[0].dungeonIds.slice(0, 4)) eco.s.expedition.stats[id] = 1;
  eco.s.heroes.knight.level = 6;
  const events = ui.content.checkUnlocks();
  expect(events.map((event: any) => event.key)).toContain('town:emberport');
  const lead = events.find((event: any) => event.key === 'town:emberport');
  expect(lead.text).toContain('함께 열린 곳');
  expect(ui.content.fresh.has('field')).toBe(true);
  expect(ui.content.checkUnlocks()).toEqual([]);
  ui.announce(events);
  expect(toasts[0]).toContain('잿불 항구');
  ui.open('field');
  expect(ui.content.fresh.has('field')).toBe(false);
  ui.announce([{ title: '테스트 <b>해금</b>', text: '열림', tab: 'quests' }]);
  ui.render();
  expect(ui.dialog.innerHTML).toContain('테스트 &lt;b&gt;해금&lt;/b&gt;');
  expect(ui.dialog.innerHTML).toContain('data-view="quests"');
  click_dismiss(ui);
  expect(ui.dialog.innerHTML).not.toContain('테스트');
});

function click_dismiss(ui: any) {
  const control = { disabled: false, dataset: { townAct: 'dismiss-notice', index: '0' } };
  ui.dialog.listeners.click[0]({ stopPropagation() {}, target: { closest: () => control } });
}

test('기존 마을 이동 · 상인 · 교관 화면은 그대로 열린다', () => {
  const { ui, click } = make();
  ui.openMap();
  expect(ui.dialog.innerHTML).toContain('data-town-act="travel"');
  expect(ui.dialog.innerHTML).toContain('data-view="dungeons"');
  click('view', { view: 'merchant' });
  expect(ui.dialog.innerHTML).toContain('data-town-act="buy"');
  click('view', { view: 'trainer' });
  expect(ui.dialog.innerHTML).toContain('data-town-act="hero"');
  click('view', { view: 'map' });
  expect(TownContent).toBeDefined();
});
