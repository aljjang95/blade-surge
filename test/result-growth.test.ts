import { afterEach, beforeEach, expect, test } from 'bun:test';
import { UI } from '../src/ui/ui.js';
import { Battle as MasterworksBattle } from '../src/game/masterworks-battle.js';
import { Economy } from '../src/game/economy.js';
import { grantCombatXp } from '../src/game/rpg-core.js';
import { normalizeMasterworks } from '../src/game/masterworks-core.js';
import { stageDef } from '../src/data/stages.js';
import { ITEM_BY_ID } from '../src/data/items.js';
import { levelExp } from '../src/data/heroes.js';

// Exercise the real UI methods and economy at a small DOM boundary; no browser dependency.
class El {
  children: El[] = []; parentElement: El | null = null; id = ''; className = ''; dataset: any = {}; style: any = {};
  attrs: any = {}; hidden = false; disabled = false; open = false; tabIndex = -1; scrollTop = 0; focused = false;
  src = ''; alt = ''; title = ''; type = ''; value: any; max: any; ownText = ''; html = ''; onclick: any;
  events: Record<string, Function> = {};
  constructor(public tagName: string) {}
  get classList() { return { contains: (c: string) => this.className.split(' ').includes(c),
    toggle: (c: string, on?: boolean) => { const set = new Set(this.className.split(' ').filter(Boolean)); if (on ?? !set.has(c)) set.add(c); else set.delete(c); this.className = [...set].join(' '); },
    add: (c: string) => { this.classList.toggle(c, true); }, remove: (c: string) => { this.classList.toggle(c, false); } }; }
  get textContent(): string { return this.ownText + this.children.map(c => c.textContent).join(''); }
  set textContent(text: string) { this.replaceChildren(); this.ownText = text; }
  set innerHTML(html: string) { this.replaceChildren(); this.html = html; }
  get innerHTML() { return this.html; }
  get firstChild() { return this.children[0] || null; }
  append(...nodes: El[]) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  appendChild(node: El) { this.append(node); return node; }
  replaceChildren(...nodes: El[]) { for (const child of [...this.children]) child.remove(); this.ownText = ''; this.html = ''; this.append(...nodes); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this); this.parentElement = null; }
  insertBefore(node: El, before: El) { node.remove(); const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, node); node.parentElement = this; }
  all(): El[] { return this.children.flatMap(c => [c, ...c.all()]); }
  matches(selector: string) { return selector.startsWith('.') ? this.classList.contains(selector.slice(1)) : selector.startsWith('#') ? this.id === selector.slice(1) : this.tagName === selector; }
  querySelectorAll(selector: string) { return this.all().filter(c => c.matches(selector)); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] || null; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  addEventListener(k: string, fn: Function) { this.events[k] = fn; }
  focus() { this.focused = true; }
  click() { if (!this.disabled) { this.onclick?.(); this.events.click?.(); } }
}

const originals = new Map<string, PropertyDescriptor | undefined>();
let nodes: Map<string, El>, timers: Map<number, Function>, timerId: number, storageFail: boolean;
const get = (id: string): El => { if (!nodes.has(id)) { const node = new El('div'); node.id = id; nodes.set(id, node); } return nodes.get(id)!; };
beforeEach(() => {
  nodes = new Map(); timers = new Map(); timerId = 0; storageFail = false;
  const values = new Map<string, string>();
  const globals: Record<string, any> = {
    localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { if (storageFail) throw new Error('storage'); values.set(key, value); }, removeItem: (key: string) => values.delete(key) },
    document: { createElement: (tag: string) => new El(tag), getElementById: (id: string) => {
      for (const root of nodes.values()) { const found = root.all().find(n => n.id === id); if (found) return found; }
      return get(id);
    }, addEventListener: () => {} },
    setTimeout: (fn: Function) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id: number) => timers.delete(id),
  };
  for (const [key, value] of Object.entries(globals)) { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); }
});
afterEach(() => { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } originals.clear(); });

function fixture(win = true, lootCount = 1) {
  const eco = new Economy(), save: any = eco.s;
  save.selected = 'mage'; save.gold = 0; save.stones = 12;
  save.masterworks = normalizeMasterworks({ earnedRenown: 6, renown: 6 });
  const weapon = Object.values(ITEM_BY_ID).find(item => item.slot === 'weapon')!;
  for (let i = 0; i < lootCount; i++) save.inventory.push({ uid: i + 1, id: weapon.id, enh: 0 });
  save.invSeq = lootCount + 1; save.heroes.mage.equip.weapon = lootCount ? 1 : null;
  const result: any = { win, stars: 3, fullClear: false }, calls: string[] = [];
  const battle: any = { result, active: false, rpgDirty: false, stage: stageDef(1, 1), heroId: 'mage',
    growthStart: { heroId: 'mage', level: 1, exp: 0 }, combatXp: 130, kills: 12, maxCombo: 20, dmgDealt: 8400, elapsed: 30,
    drops: { gold: 1200, stones: 2, stones2: 0, stones3: 0, fragments: 0, loot: [...save.inventory] },
    chronicle: { open: (tab: string) => calls.push(`mastery:${tab}`), dialog: new El('dialog') },
    flushRpg: () => { const saved = eco.save(); battle.rpgDirty = !saved; return saved; },
  };
  grantCombatXp(save.heroes.mage, battle.combatXp, levelExp);
  const ui: any = Object.assign(Object.create(UI.prototype), { eco, resultData: null, resultTimers: [], adResult: null,
    el: { result: get('result'), modalBox: get('modal-box'), pause: get('pause-overlay') }, lootLayer: new El('div'),
    showHud: () => {}, toast: (message: string) => calls.push(`toast:${message}`), awakenBanner: () => {},
  });
  const app: any = { eco, battle, ui, stageStarting: false, mode: 'battle', toLobby: () => { calls.push('lobby'); app.mode = 'lobby'; ui.hideResult(); },
    startStage: () => calls.push('start'), meta: { heroSel: null, openTab: (tab: string) => calls.push(`tab:${tab}`),
      showEnhance: (uid: string, hero: string) => calls.push(`equipment:${uid}:${hero}`),
      showSkill: (hero: string, index: number) => calls.push(`skill:${hero}:${index}`), showItem: () => calls.push('item') },
  }; ui.app = app;
  const box = new El('div'); box.className = 'result-box'; get('result').append(box);
  box.append(get('result-title'), get('result-stars'), get('result-stats'), get('result-story'), get('result-growth'), get('result-loot'));
  get('result-growth').className = 'result-growth'; get('result-stars').append(new El('i'), new El('i'), new El('i'));
  const footer = new El('div'); footer.className = 'result-btns';
  for (const id of ['btn-result-lobby', 'btn-result-retry', 'btn-result-next']) { const b = get(id); b.tagName = 'button'; footer.append(b); }
  get('btn-result-next').append(new El('small'));
  box.append(footer, get('btn-result-double'));
  ui._bindGlobal();
  let settlements = 0; const complete = eco.completeStage.bind(eco);
  eco.completeStage = (...args: any[]) => { settlements++; return (complete as any)(...args); };
  const flushTimers = () => { for (let wave = 0; timers.size && wave < 10; wave++) { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); } };
  const action = (kind: string) => get('result-growth').all().find(n => n.dataset.growth === kind)!;
  return { ui, app, eco, save, battle, result, calls, box, footer, action, flushTimers, settlements: () => settlements };
}

test('real defeat chain exposes a later chronicle save failure and retries without duplicate history', () => {
  const f = fixture(false);
  Object.setPrototypeOf(f.battle, MasterworksBattle.prototype);
  Object.assign(f.battle, {
    app: f.app, ui: f.ui, active: true, result: null, rpgDirty: true,
    input: { enabled: true, clear() {} }, player: { alive: false },
    run: { enabled: true, settled: false, id: 1, picked: [], queue: [], renown: 0, breaks: 0, perfects: 0 },
    masterworks: { s: f.save.masterworks }, rpgView: { refresh() {} },
    chronicle: { close() {}, refresh() {} },
  });
  const save = f.eco.save.bind(f.eco);
  let failChronicle = true;
  f.eco.save = () => { storageFail = failChronicle && f.save.masterworks.history.length > 0; return save(); };
  f.battle.defeat();
  expect(f.save.masterworks.history).toHaveLength(1);
  expect(f.battle.rpgDirty).toBe(true);
  expect(f.action('save')).toBeDefined();
  expect(get('btn-result-lobby').disabled).toBe(true);
  expect(get('btn-result-retry').disabled).toBe(true);
  failChronicle = false; f.action('save').click();
  expect(f.battle.rpgDirty).toBe(false); expect(f.save.masterworks.history).toHaveLength(1);
  expect(get('btn-result-lobby').disabled).toBe(false); expect(f.settlements()).toBe(0);
});

test('victory settles before offering affordable actions and shows actual hunt XP and level growth', () => {
  const f = fixture(); f.ui.showResult(f.battle, true);
  expect(f.settlements()).toBe(1); expect(f.action('equipment')).toBeDefined(); expect(f.action('skill')).toBeDefined(); expect(f.action('mastery')).toBeDefined();
  expect(get('result-growth').hidden).toBe(false);
  expect(get('result-growth').textContent).toContain('처치 XP +130');
  expect(get('result-growth').textContent).toContain(`클리어 XP +${f.result.reward.exp}`);
  expect(get('result-growth').textContent).toContain('Lv.1 →'); expect(get('result-growth').textContent).toContain('다음 해금 · Lv.10');
  const before = JSON.stringify(f.save); f.ui.showResult(f.battle, true);
  expect(f.settlements()).toBe(1); expect(JSON.stringify(f.save)).toBe(before);
});

for (const kind of ['equipment', 'skill', 'mastery']) test(`victory ${kind} opens its real destination without consuming resources`, () => {
  const f = fixture(); f.ui.showResult(f.battle, true); const before = JSON.stringify(f.save);
  f.action(kind).click();
  const destination = kind === 'equipment' ? 'equipment:1:mage' : kind === 'skill' ? 'skill:mage:0' : 'mastery:mastery';
  expect(f.calls).toContain(destination); expect(f.calls[0]).toBe('lobby'); expect(JSON.stringify(f.save)).toBe(before);
  expect(f.app.meta.heroSel).toBe(kind === 'mastery' ? null : 'mage');
});

test('45 loot items stay inside a collapsed detail and cannot displace the separate next-departure footer', () => {
  const f = fixture(true, 45); f.ui.showResult(f.battle, true); f.flushTimers();
  const scroll = f.box.querySelector('.result-scroll')!, details = get('result-loot').parentElement!;
  expect(details.tagName).toBe('details'); expect(details.open).toBe(false); expect(details.textContent).toContain('장비 45개');
  expect(get('result-loot').querySelectorAll('button')).toHaveLength(45);
  expect(f.footer.parentElement).toBe(f.box); expect(scroll.children).not.toContain(f.footer);
  expect(scroll.children.indexOf(get('result-growth'))).toBeLessThan(scroll.children.indexOf(details));
  expect(get('btn-result-next').disabled).toBe(false); get('btn-result-next').click(); expect(f.calls).toContain('start');
});

test('a free first-gear suggestion opens comparison without equipping, spending, or using enhance', () => {
  const f = fixture(); f.save.heroes.mage.equip.weapon = null;
  f.ui.showResult(f.battle, true);
  const before = JSON.stringify(f.save), button = f.action('equipment');
  expect(button.textContent).toContain('비교 후 무료 장착');
  button.click(); expect(f.calls).toContain('item');
  expect(f.calls.some(s => s.startsWith('equipment:'))).toBe(false);
  expect(JSON.stringify(f.save)).toBe(before);
});

test('a first-gear suggestion rechecks ownership before leaving the result', () => {
  const f = fixture(); f.save.heroes.mage.equip.weapon = null;
  f.ui.showResult(f.battle, true); const button = f.action('equipment');
  f.save.heroes.knight.equip.weapon = f.save.inventory[0].uid;
  button.click(); expect(f.calls).not.toContain('item'); expect(f.calls).not.toContain('lobby');
});

test('changed currency rerenders choices, preserves the hunt snapshot, and never follows a stale option', () => {
  const f = fixture(); f.ui.showResult(f.battle, true); const button = f.action('skill');
  f.save.gold = 0; f.save.heroes.mage.level = 50; button.click();
  expect(f.action('skill')).toBeUndefined(); expect(f.calls).not.toContain('lobby');
  expect(get('result-growth').textContent).not.toContain('Lv.50');
  expect(f.action('mastery').focused).toBe(true);
});

for (const gate of ['stale', 'active', 'starting', 'hidden', 'failed', 'rpgDirty', 'campaign']) test(`${gate} blocks growth, loot and every result exit`, () => {
  const f = fixture(); f.ui.showResult(f.battle, true); f.flushTimers();
  const growth = f.action('skill'), loot = get('result-loot').querySelector('button')!;
  if (gate === 'stale') f.battle.result = { win: true };
  if (gate === 'active') f.battle.active = true;
  if (gate === 'starting') f.app.stageStarting = true;
  if (gate === 'hidden') get('result').classList.remove('show');
  if (gate === 'failed') f.result.reward.saveError = true;
  if (gate === 'rpgDirty') f.battle.rpgDirty = true;
  if (gate === 'campaign') { f.app.expedition = {}; f.result.expeditionRecorded = false; }
  const before = JSON.stringify(f.save); f.calls.length = 0;
  growth.onclick(); loot.onclick();
  for (const id of ['btn-result-lobby', 'btn-result-retry', 'btn-result-next', 'btn-result-double']) get(id).events.click();
  expect(f.calls).toEqual([]); expect(JSON.stringify(f.save)).toBe(before);
});

test('failed settlement disables all exits; repeated save retries never settle or award XP twice', () => {
  const f = fixture(); storageFail = true; f.ui.showResult(f.battle, true); f.flushTimers();
  expect(f.result.reward).toMatchObject({ ok: false, saveError: true });
  for (const id of ['btn-result-lobby', 'btn-result-retry', 'btn-result-next', 'btn-result-double']) expect(get(id).disabled).toBe(true);
  expect(get('result-loot').querySelector('button')!.disabled).toBe(true); expect(f.action('skill')).toBeUndefined();
  const settled = JSON.stringify(f.save); f.action('save').click();
  expect(f.settlements()).toBe(1); expect(JSON.stringify(f.save)).toBe(settled); expect(f.result.reward.saveError).toBe(true);
  storageFail = false; f.action('save').click();
  expect(f.result.reward).toMatchObject({ ok: true, saveError: false }); expect(f.settlements()).toBe(1);
  expect(JSON.stringify(f.save)).toBe(settled); expect(f.action('skill')).toBeDefined(); expect(get('btn-result-next').disabled).toBe(false);
  expect(get('result-loot').querySelector('button')!.disabled).toBe(false);
  expect(new Economy().s.heroes.mage).toEqual(f.save.heroes.mage);
});

test('campaign record retry retains one receipt ID and never repeats the stage reward', () => {
  const f = fixture(); let records = 0, allowRecord = false; const ids: string[] = [];
  f.app.expedition = { recordCampaign: (result: any) => { records++; ids.push(result.receiptId); return allowRecord ? { ok: true, rewards: { xp: 35 } } : { ok: false, error: 'storage' }; } };
  storageFail = true; f.ui.showResult(f.battle, true);
  expect(records).toBe(0); const reward = f.result.reward, after = JSON.stringify(f.save);
  storageFail = false; f.action('save').click();
  expect(records).toBe(1); expect(get('btn-result-next').disabled).toBe(true); expect(f.result.reward).toBe(reward);
  allowRecord = true; f.action('save').click();
  expect(records).toBe(2); expect(new Set(ids).size).toBe(1); expect(ids[0].length).toBeGreaterThan(0);
  expect(f.result.campaignReward).toEqual({ xp: 35 }); expect(f.action('skill')).toBeDefined();
  expect(f.settlements()).toBe(1); expect(JSON.stringify(f.save)).toBe(after);
  f.ui.retryResultSave(f.result); expect(records).toBe(2); expect(f.settlements()).toBe(1);
});

test('saving a defeat retries pending combat XP persistence, retaining the exact hero level', () => {
  const f = fixture(false); storageFail = true; f.battle.rpgDirty = true; f.ui.showResult(f.battle, false);
  expect(f.action('save')).toBeDefined(); expect(get('btn-result-lobby').disabled).toBe(true);
  const before = JSON.stringify(f.save); storageFail = false; f.action('save').click();
  expect(f.battle.rpgDirty).toBe(false); expect(f.settlements()).toBe(0); expect(JSON.stringify(f.save)).toBe(before);
  expect(get('result-growth').textContent).toContain('처치 XP +130'); expect(get('btn-result-lobby').disabled).toBe(false);
});

test('defeat uses synchronous Battle XP and start snapshot without claiming clear XP or settling a win', () => {
  const f = fixture(false); f.save.gold = 1000; f.ui.showResult(f.battle, false);
  expect(f.settlements()).toBe(0); expect(get('result-growth').textContent).toContain('처치 XP +130');
  expect(get('result-growth').textContent).toContain('Lv.1 → 2'); expect(get('result-growth').textContent).not.toContain('클리어 XP');
  f.action('skill').click(); expect(f.calls).toContain('skill:mage:0');
});

test('late timers and stale save retry cannot revive an old result or settle an active battle', () => {
  const f = fixture(); f.ui.showResult(f.battle, true); f.ui.hideResult(); f.flushTimers();
  expect(get('result-loot').children).toHaveLength(0); expect(f.ui.retryResultSave(f.result)).toBe(false);
  f.battle.active = true; f.ui.showResult(f.battle, true); expect(f.ui.resultData).toBeNull(); expect(f.settlements()).toBe(1);
});
