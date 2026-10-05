import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { ExpeditionEconomy } from '../src/game/expedition-economy.js';
import { MasterworksService } from '../src/game/masterworks-service.js';
import { citadelPreparation } from '../src/game/citadel-preparation.js';
import { CitadelHubUI } from '../src/ui/citadel-hub.js';
import { CITADEL_HUB_HOTSPOTS } from '../src/data/citadel-hub.js';
import { DUNGEONS } from '../src/data/expansion.js';
import { EXPEDITION_DEPTHS } from '../src/data/expedition-depths.js';

const primaryKey = 'bladesurge_save_v1';
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values: Map<string, string>, failPrimary: boolean;
beforeEach(() => {
  values = new Map(); failPrimary = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (key === primaryKey && failPrimary) throw new Error('quota');
      values.set(key, value);
    },
    removeItem: (key: string) => values.delete(key),
  } });
});
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

// 기존 dialog의 요소 경계만 모델링한다. 실제 준비/핸들러/저장/입장 서비스는 그대로 실행한다.
class GateNode {
  textContent = ''; innerHTML = ''; hidden = false; disabled = false; checked = false;
  dataset: Record<string, string> = {}; attributes: Record<string, string> = {};
  style = { setProperty() {}, backgroundImage: '' };
  classList = { toggle() {} };
  children = new Map<string, GateNode>();
  querySelector(selector: string) {
    let child = this.children.get(selector);
    if (!child) { child = new GateNode(); this.children.set(selector, child); }
    return child;
  }
  closest() { return this.querySelector('label'); }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
}

function fixture() {
  const eco = new Economy(), expedition = new ExpeditionEconomy(eco);
  const app: any = { eco, expedition, mode: 'lobby', stageStarting: false, battle: { active: false, rpgDirty: false },
    expeditionUI: { result: null }, ui: { resultData: null } };
  app.masterworks = new MasterworksService(app);
  const dialog = Object.assign(new GateNode(), { open: true });
  const spot = CITADEL_HUB_HOTSPOTS.find(candidate => candidate.kind === 'dungeon' && candidate.route === 'glass_garden')!;
  const definition = DUNGEONS.find(candidate => candidate.id === 'glass_garden')!;
  const calls: any[] = [];
  const view: any = Object.assign(Object.create(CitadelHubUI.prototype), { app, dialog, dialogSpot: spot as typeof spot | null,
    opened: true, busy: false, selectedDepth: 'standard', challengeNotice: '', reviewedPreparation: null,
    close() { calls.push('close'); this.opened = false; this.dialog.open = false; this.dialogSpot = null; this.reviewedPreparation = null; } });
  app.startExpedition = async (kind: string, id: string, options: any) => {
    calls.push({ kind, id, options });
    return expedition.begin(kind, id, options).ok;
  };
  view.refreshDestination();
  return { app, eco, expedition, view, dialog, spot, definition, calls };
}

test('native gate fury choice saves once through the existing service, preserves other vows and economy, and survives reload', () => {
  const { app, eco, expedition, view, dialog, spot } = fixture();
  app.masterworks.s.challengeIds = ['iron', 'siege']; view.refreshDestination();
  const before = structuredClone(eco.s); let notifications = 0;
  eco.onChange(() => notifications++);
  expect(view.toggleFury(spot).ok).toBe(true);
  expect(eco.s.masterworks.challengeIds).toEqual(['iron', 'siege', 'fury']);
  expect(notifications).toBe(1);
  expect(dialog.querySelector('.citadel-hub-fury').attributes['aria-pressed']).toBe('true');
  expect(dialog.querySelector('#citadel-challenge-active').textContent).toContain('철의 적 · 분노의 적 · 포위망');
  expect(dialog.querySelector('[data-citadel-challenge-effects]').textContent).toContain('공격력 ×1.20');
  expect(dialog.querySelector('[data-citadel-fury-preview]').textContent).toContain('공격력 ×1.08');
  const after = structuredClone(eco.s); after.masterworks.challengeIds = before.masterworks.challengeIds;
  expect(after).toEqual(before); expect(expedition.s.pending).toBeNull();
  const reloaded = new Economy();
  const loadedApp: any = { eco: reloaded, expedition: new ExpeditionEconomy(reloaded), battle: { active: false } };
  expect(new MasterworksService(loadedApp).s.challengeIds).toEqual(['iron', 'siege', 'fury']);
  expect(reloaded.s.gold).toBe(before.gold); expect(reloaded.s.energy).toBe(before.energy);
  expect(view.toggleFury(spot).ok).toBe(true);
  expect(eco.s.masterworks.challengeIds).toEqual(['iron', 'siege']);
});

test('failed native choice storage restores the original vows and preview and can recover without an extra reward or entry', () => {
  const { app, eco, view, dialog, spot, calls } = fixture();
  app.masterworks.s.challengeIds = ['iron', 'siege']; eco.save(); view.refreshDestination();
  const before = structuredClone(eco.s), raw = values.get(primaryKey), backup = values.get(primaryKey + '_backup');
  failPrimary = true;
  expect(view.toggleFury(spot)).toMatchObject({ ok: false, error: '저장 공간을 확인해 주세요.' });
  expect(eco.s).toEqual(before); expect(values.get(primaryKey)).toBe(raw); expect(values.get(primaryKey + '_backup')).toBe(backup);
  expect(dialog.querySelector('.citadel-hub-fury').attributes['aria-pressed']).toBe('false');
  expect(dialog.querySelector('.citadel-hub-challenge-notice').textContent).toContain('저장 공간');
  expect(calls).toEqual([]);
  failPrimary = false;
  // 저장 불가 상태에서는 기존 입장 가드를 유지한다. 정상 저장이 복구된 뒤 선택을 받는다.
  expect(view.toggleFury(spot).ok).toBe(false);
  expect(eco.save()).toBe(true); view.refreshDestination();
  expect(view.toggleFury(spot).ok).toBe(true);
  expect(eco.s.masterworks.challengeIds).toEqual(['iron', 'siege', 'fury']);
  expect(eco.s.gold).toBe(before.gold); expect(eco.s.energy).toBe(before.energy);
});

for (const reason of ['active', 'starting', 'pending', 'settlement', 'dirty', 'refund', 'campaign-save', 'party', 'mode', 'energy', 'locked-deep']) {
  test(`${reason} changed after rendering prevents the gate choice from writing or replacing its session authority`, () => {
    const { app, eco, expedition, view, dialog, spot, calls } = fixture();
    if (reason === 'active') app.battle.active = true;
    if (reason === 'starting') app.stageStarting = true;
    if (reason === 'pending') expedition.s.pending = { id: 77, kind: 'dungeon', target: 'glass_garden', depth: 'standard', energy: 4 };
    if (reason === 'settlement') app.expeditionUI.result = { saveError: 'disk' };
    if (reason === 'dirty') app.battle.rpgDirty = true;
    if (reason === 'refund') app.expeditionRefundPending = true;
    if (reason === 'campaign-save') app.ui.resultData = { reward: { saveError: 'disk' } };
    if (reason === 'party') app.party = { party: { status: 'lobby' } };
    if (reason === 'mode') app.mode = 'battle';
    if (reason === 'energy') eco.s.energy = 0;
    if (reason === 'locked-deep') view.selectedDepth = 'deep';
    const before = structuredClone(eco.s), saved = [...values];
    expect(view.toggleFury(spot).ok).toBe(false);
    expect(eco.s).toEqual(before); expect([...values]).toEqual(saved); expect(calls).toEqual([]);
    // stageStarting exits before refreshing; the live action must still refuse it.
    if (reason !== 'starting') expect(dialog.querySelector('.citadel-hub-fury').disabled).toBe(true);
  });
}

test('a stale fury label first refreshes the unseen persistent selection and requires a new explicit choice', () => {
  const { app, eco, view, dialog, spot } = fixture();
  expect(app.masterworks.challenge('fury').ok).toBe(true);
  const saved = [...values], before = structuredClone(eco.s);
  expect(view.toggleFury(spot).ok).toBe(false);
  expect(eco.s).toEqual(before); expect([...values]).toEqual(saved);
  expect(dialog.querySelector('.citadel-hub-fury').attributes['aria-pressed']).toBe('true');
  expect(dialog.querySelector('.citadel-hub-challenge-notice').textContent).toContain('새 준비 내용을 확인');
  expect(view.challengeNotice).toContain('새 준비 내용을 확인');
  expect(view.toggleFury(spot).ok).toBe(true);
  expect(eco.s.masterworks.challengeIds).toEqual([]);
});

test('Go refreshes unseen vow changes before spending; the next intentional click uses the existing exact-price departure', async () => {
  const { app, eco, expedition, view, dialog, spot, definition, calls } = fixture();
  app.masterworks.challenge('iron');
  const before = structuredClone(eco.s), saved = [...values];
  expect(await view.startDestination(definition, spot)).toBe(false);
  expect(eco.s).toEqual(before); expect([...values]).toEqual(saved); expect(calls).toEqual([]);
  expect(dialog.querySelector('#citadel-challenge-active').textContent).toContain('철의 적');
  expect(await view.startDestination(definition, spot)).toBe(true);
  expect(calls).toEqual(['close', { kind: 'dungeon', id: 'glass_garden', options: { depth: 'standard' } }]);
  expect(eco.s.energy).toBe(before.energy - definition.energy);
  expect(expedition.s.seq).toBe(before.expedition.seq + 1); expect(expedition.s.pending?.target).toBe(definition.id);
  expect(eco.s.masterworks.challengeIds).toEqual(['iron']); expect(eco.s.gold).toBe(before.gold);
  expect(view.busy).toBe(false);
});

test('ordinary no-vow entry retains its existing route, cost, rewards and control setting', async () => {
  const { eco, expedition, view, spot, definition, calls } = fixture(), before = structuredClone(eco.s);
  const preview = citadelPreparation(view.app, definition.id);
  if (!preview.ok || !('challenges' in preview) || !preview.challenges) throw new Error('유효한 서약 준비가 필요합니다.');
  expect(preview.challenges.furyActive).toBe(false);
  expect(await view.startDestination(definition, spot)).toBe(true);
  expect(calls).toEqual(['close', { kind: 'dungeon', id: definition.id, options: { depth: 'standard' } }]);
  expect(eco.s.energy).toBe(before.energy - definition.energy); expect(eco.s.gold).toBe(before.gold);
  expect(expedition.s.consumables).toEqual(before.expedition.consumables);
  expect(eco.s.journey.autoBattle).toBe(before.journey.autoBattle); expect(eco.s.masterworks.challengeIds).toEqual([]);
});

test('Go first displays a changed catalog cost without charging and only an explicit reviewed retry can spend the new price', async () => {
  const { eco, view, dialog, spot, definition, calls } = fixture(), originalCost = definition.energy;
  const before = structuredClone(eco.s), saved = [...values];
  try {
    definition.energy = originalCost + 1;
    expect(await view.startDestination(definition, spot)).toBe(false);
    expect(eco.s).toEqual(before); expect([...values]).toEqual(saved); expect(calls).toEqual([]);
    expect(dialog.querySelector('[data-citadel-cost]').textContent).toBe(`에너지 ${originalCost + 1}`);
    expect(await view.startDestination(definition, spot)).toBe(true);
    expect(eco.s.energy).toBe(before.energy - originalCost - 1);
  } finally { definition.energy = originalCost; }
});

test('a pending native departure cannot charge a second time while the existing start promise is unresolved', async () => {
  const { app, eco, expedition, view, spot, definition, calls } = fixture(), before = structuredClone(eco.s);
  let finish!: (value: boolean) => void;
  app.startExpedition = (kind: string, id: string, options: any) => {
    calls.push({ kind, id, options });
    const admitted = expedition.begin(kind, id, options);
    return new Promise<boolean>(resolve => { finish = () => resolve(admitted.ok); });
  };
  const first = view.startDestination(definition, spot);
  expect(view.busy).toBe(true);
  expect(await view.startDestination(definition, spot)).toBe(false);
  expect(view.toggleFury(spot).ok).toBe(false);
  expect(eco.s.energy).toBe(before.energy - definition.energy);
  expect(expedition.s.seq).toBe(before.expedition.seq + 1);
  expect(calls).toHaveLength(2);
  finish(true); expect(await first).toBe(true); expect(view.busy).toBe(false);
});

test('changing to an eligible deep route refreshes its canonical cost and the persistent fury state without adding a rift or conquest', async () => {
  const { app, eco, expedition, view, spot, definition, calls } = fixture();
  const deep = EXPEDITION_DEPTHS.find(candidate => candidate.id === definition.id)!;
  expedition.s.level = deep.minLevel; expedition.s.stats[definition.id] = 1; eco.s.progress.stars[deep.unlockCode] = 1;
  app.masterworks.challenge('fury'); view.selectedDepth = 'deep'; view.refreshDestination();
  const before = structuredClone(eco.s);
  expect(await view.startDestination(definition, spot)).toBe(true);
  expect(calls[1]).toEqual({ kind: 'dungeon', id: definition.id, options: { depth: 'deep' } });
  expect(expedition.s.pending?.depth).toBe('deep'); expect(expedition.s.pending).not.toHaveProperty('riftId');
  expect(expedition.s.pending).not.toHaveProperty('conquestId'); expect(eco.s.energy).toBe(before.energy - deep.energy);
  expect(eco.s.masterworks.challengeIds).toEqual(['fury']);
});

test('closed or replaced dialogs and forged destination arguments cannot change vows or initiate a departure', async () => {
  const { eco, view, dialog, spot, definition, calls } = fixture(), before = structuredClone(eco.s);
  dialog.open = false;
  expect(view.toggleFury(spot).ok).toBe(false); expect(await view.startDestination(definition, spot)).toBe(false);
  dialog.open = true;
  expect(view.toggleFury({ ...spot }).ok).toBe(false); expect(await view.startDestination(definition, { ...spot })).toBe(false);
  expect(await view.startDestination({ ...definition }, spot)).toBe(false);
  expect(await view.startDestination(DUNGEONS.find(candidate => candidate.id !== definition.id), spot)).toBe(false);
  expect(eco.s).toEqual(before); expect(calls).toEqual([]); expect(values.size).toBe(0);
});
