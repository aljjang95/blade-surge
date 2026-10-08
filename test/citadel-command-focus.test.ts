import { afterEach, expect, test } from 'bun:test';
import { CitadelHubUI } from '../src/ui/citadel-hub.js';
import { CitadelShop } from '../src/ui/citadel-shop.js';

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
afterEach(() => {
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else Reflect.deleteProperty(globalThis, 'document');
});

test('native preparation and supply closure enable the walking trigger before restoring focus', () => {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => null } });
  for (const kind of ['preparation', 'shop']) {
    let focused = false, syncs = 0;
    const trigger = { isConnected: true, disabled: true, closest: () => null, getClientRects: () => [{}], focus: () => { focused = true; } };
    const app = { mode: 'lobby', meta: { tab: 'home' }, lobbyVisible: true, stageStarting: false,
      canWalkHub: () => true, syncHub: () => { syncs++; trigger.disabled = false; } };
    if (kind === 'preparation') {
      const dialog = { open: true, close() { this.open = false; } };
      const view: any = Object.assign(Object.create(CitadelHubUI.prototype), { app, dialog, opened: true, visible: true,
        busy: false, returnFocus: trigger, nearest: null, update() {} });
      view.close(); expect(dialog.open).toBe(false); expect(view.opened).toBe(false);
    } else {
      const view: any = Object.assign(Object.create(CitadelShop.prototype), { app, opened: true, trigger, clearInput() {} });
      view.finishClose(); expect(view.opened).toBe(false);
    }
    expect(syncs).toBe(1); expect(focused).toBe(true);
  }
});

test('preparation can return to a rendered selection card while walking is disabled', () => {
  let modal = false, hidden = false, rendered = true;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => modal ? {} : null } });
  const app = { mode: 'lobby', meta: { tab: 'home' }, lobbyVisible: true, stageStarting: false, canWalkHub: () => false };
  const view: any = Object.assign(Object.create(CitadelHubUI.prototype), { app, busy: false, opened: false, dialog: { open: false } });
  const card = { isConnected: true, disabled: false, closest: () => hidden ? {} : null, getClientRects: () => rendered ? [{}] : [] };
  expect(view.canReturnFocus(card)).toBe(true);
  modal = true; expect(view.canReturnFocus(card)).toBe(false); modal = false;
  hidden = true; expect(view.canReturnFocus(card)).toBe(false); hidden = false;
  rendered = false; expect(view.canReturnFocus(card)).toBe(false); rendered = true;
  app.stageStarting = true; expect(view.canReturnFocus(card)).toBe(false); app.stageStarting = false;
  view.busy = true; expect(view.canReturnFocus(card)).toBe(false); view.busy = false;
  view.opened = true; expect(view.canReturnFocus(card)).toBe(false); view.opened = false;
  app.meta.tab = 'heroes'; expect(view.canReturnFocus(card)).toBe(false);
});
