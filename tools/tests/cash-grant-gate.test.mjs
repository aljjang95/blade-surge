import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Economy } from '../../src/game/economy.js';
import { Meta } from '../../src/ui/meta.js';

function economyWithSave() {
  const economy = Object.create(Economy.prototype);
  economy.s = {
    gems: 200, purchases: [], spentKRW: 0, vip: 0,
    firstPurchaseUsed: {}, pass: { premium: false },
  };
  let rewards = 0;
  let saves = 0;
  economy.addRewards = () => { rewards++; return [{ k: 'energy', n: 120 }]; };
  economy.emit = () => { saves++; };
  return { economy, counts: () => ({ rewards, saves }) };
}

test('cash SKUs and premium pass cannot mint rewards without verified billing', () => {
  const { economy, counts } = economyWithSave();
  const before = structuredClone(economy.s);

  assert.deepEqual(economy.purchase('starter'), { ok: false, reason: 'billing-unavailable' });
  assert.deepEqual(economy.buyPass(), { ok: false, reason: 'billing-unavailable' });
  assert.deepEqual(economy.s, before);
  assert.deepEqual(counts(), { rewards: 0, saves: 0 });
});

test('earned-gem purchases still spend gems and grant their reward', () => {
  const { economy, counts } = economyWithSave();
  const result = economy.purchase('en2');

  assert.equal(result.ok, true);
  assert.deepEqual(result.got, [{ k: 'energy', n: 120 }]);
  assert.equal(economy.s.gems, 100);
  assert.deepEqual(counts(), { rewards: 1, saves: 0 });
});

test('premium pass UI never celebrates a rejected grant', async () => {
  let celebrated = false;
  let rendered = false;
  const view = {
    eco: { s: { pass: { premium: false } }, buyPass: () => ({ ok: false, reason: 'billing-unavailable' }) },
    ui: { paySheet: async () => true, purchaseDone: () => { celebrated = true; } },
    renderPass: () => { rendered = true; },
  };

  await Meta.prototype.buyPass.call(view);
  assert.equal(celebrated, false);
  assert.equal(rendered, false);
});
