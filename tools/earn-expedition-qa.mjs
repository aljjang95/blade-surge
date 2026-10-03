// Source-only natural acquisition helper: execution/acceptance NOT_RUN.
// Fresh isolated free Knight, real Glass Garden UI admission/AUTO/choices and
// actual saved victories. No restored save, grants, stat/clock/PRNG/actor edits.
import fs from 'node:fs/promises';
import path from 'node:path';
import { ENERGY } from '../src/data/shop.js';
import { DUNGEONS, accountLevelXp } from '../src/data/expansion.js';
import { applyFrontierRewards } from '../src/data/seasonal-content.js';
import { createExpeditionQa, nativeGameplayFocus, qaArgument, qaAssert, qaHash } from './expedition-qa-runtime.mjs';

const root = path.resolve(import.meta.dirname, '..'), maxRuns = Number(qaArgument('max-runs') || 8);
qaAssert(Number.isInteger(maxRuns) && maxRuns >= 1 && maxRuns <= 12, '--max-runs must be 1..12');
const report = { kind: 'earned-expedition-save', naturalStart: true, synthetic: false, runs: [],
  scope: 'Exact clean production preview/fixed live release. Fresh native save, original free Knight, normal Glass Garden UI victories, actual native AUTO button and displayed boon/story choices. Only fixed 1/60s app.step pacing. No restored profile, currency/level/HP/position/enemy/kills/outcome edits, direct quest/equip/settlement calls, purchases, Date or random overrides. No quests are claimed by this helper. Not manual-play balance, phone/FPS, long-term retention, media cause attribution or AAA approval.',
  remaining: { browserAcceptance: 'NOT_RUN until this helper succeeds', physicalPhone: 'NOT_RUN', formalMetrics: 'NOT_RUN', astralClear: 'NOT_RUN' } };
const qa = await createExpeditionQa({ root, driver: import.meta.filename, report,
  sourceFiles: ['tools/earn-expedition-qa.mjs', 'tools/expedition-qa-runtime.mjs', 'tools/conquest-media-observer.mjs', 'tools/qa-media-checkpoints.mjs', 'src/data/shop.js', 'src/data/expansion.js', 'src/data/seasonal-content.js'] });
let page;
async function state() {
  return page.evaluate(() => {
    const a = window.app, b = a.battle;
    return { selected: a.eco.s.selected, hero: { level: a.eco.hero().level, star: a.eco.hero().star, equip: structuredClone(a.eco.hero().equip) },
      level: a.expedition.s.level, xp: a.expedition.s.xp, energy: a.eco.s.energy, energyT: a.eco.s.energyT, energyMax: a.eco.energyMax, observedAt: Date.now(), gold: a.eco.s.gold,
      seq: a.expedition.s.seq, claimed: structuredClone(a.expedition.s.claimed), stats: structuredClone(a.expedition.s.stats), pending: structuredClone(a.expedition.s.pending),
      purchases: structuredClone(a.eco.s.purchases), spentKRW: a.eco.s.spentKRW, progress: structuredClone(a.eco.s.progress),
      history: structuredClone(a.eco.s.masterworks.history), inventoryCount: a.eco.s.inventory.length,
      active: b.active, paused: b.paused, hp: b.player?.hp, elapsed: b.elapsed, kills: b.kills,
      auto: b.player?.auto, result: a.expeditionUI.result ? structuredClone(a.expeditionUI.result) : null };
  });
}
function nativeEnergyTransition(before, after, cost, label) {
  // Observe the unchanged production policy; never call tick/spend or fix Date.
  const period = ENERGY.regenSec * 1000, max = before.energyMax;
  qaAssert(Number.isSafeInteger(before.energy) && Number.isSafeInteger(after.energy)
    && Number.isFinite(before.energyT) && Number.isFinite(after.energyT)
    && before.energyT <= before.observedAt && after.energyT <= after.observedAt
    && after.observedAt >= before.observedAt && max === after.energyMax && max === ENERGY.max,
  `${label}: ambiguous native energy observation/policy`);
  let regained = 0, saturated = false;
  if (before.energy >= max) {
    // The production policy resets its timer while full and at actual spend.
    qaAssert(before.energy === max && after.energy === max - cost
      && after.energyT >= before.observedAt, `${label}: native full-energy charge differs from catalog`);
  } else {
    const timerAdvance = after.energyT - before.energyT, ticks = timerAdvance / period;
    const due = Math.floor((after.observedAt - before.energyT) / period);
    if (Number.isSafeInteger(ticks) && ticks >= 0 && ticks <= due && before.energy + ticks < max) {
      regained = ticks;
      qaAssert(after.energy === before.energy + regained - cost, `${label}: unexplained native energy delta`);
    } else {
      // At the cap production resets energyT to its real current Date, rather
      // than preserving an integer timer advance. Require enough native time.
      saturated = true; regained = max - before.energy;
      qaAssert(due >= regained && after.energy === max - cost && after.energyT >= before.observedAt
        && after.energyT >= before.energyT + regained * period,
        `${label}: native energy cap/reset is not explained by elapsed regeneration`);
    }
  }
  return { cost, regained, saturated, regenSec: ENERGY.regenSec, before: { energy: before.energy, energyT: before.energyT, observedAt: before.observedAt },
    after: { energy: after.energy, energyT: after.energyT, observedAt: after.observedAt } };
}
async function admission() {
  const before = await state(); qaAssert(before.energy >= 4 + 12, 'Do not spend the twelve energy reserved for the subsequent Astral validation');
  const row = { index: report.runs.length + 1, status: 'running', before, admission: 'native standard Glass Garden card after native document boot', choices: [] };
  report.runs.push(row); await qa.save();
  await page.locator('#btn-expedition').click(); await page.locator('.adventure-nav [data-section="dungeons"]').click();
  await page.locator('.exp-route-tabs').getByRole('button', { name: '기본 원정', exact: true }).click();
  const card = page.locator('[data-dungeon="glass_garden"][data-depth="standard"]');
  row.cardText = await card.innerText(); const button = card.getByRole('button', { name: '던전 입장', exact: true });
  qaAssert(await button.isEnabled(), 'Fresh free Glass Garden admission is not enabled'); await button.click();
  await page.waitForFunction(() => window.app.battle.active && !window.app.stageStarting, null, { timeout: 120000 });
  row.started = await page.evaluate(() => {
    const a = window.app, b = a.battle;
    return { route: structuredClone(b.stage.expedition), riftId: b.stage.riftId || null, heroId: b.heroId,
      auto: b.player.auto, energy: a.eco.s.energy, energyT: a.eco.s.energyT, energyMax: a.eco.energyMax, observedAt: Date.now(), pending: structuredClone(a.expedition.s.pending),
      history: structuredClone(a.eco.s.masterworks.history) };
  });
  qaAssert(row.started.route.id === 'glass_garden' && row.started.route.depth === 'standard' && !row.started.route.conquestId && !row.started.riftId && row.started.heroId === 'knight', 'Native admission changed the intended free Knight/standard route');
  row.energyAdmission = nativeEnergyTransition(before, row.started, 4, 'actual standard admission');
  qaAssert(row.started.pending?.energy === 4 && row.started.pending.id === before.seq + 1, 'Native admission did not charge the catalog cost exactly once');
  qaAssert(JSON.stringify(row.started.history) === JSON.stringify(before.history), 'Admission invented a completed run record');
  if (!row.started.auto) await page.locator('#btn-auto').click();
  row.focus = await nativeGameplayFocus(page);
  row.nativeAuto = await page.evaluate(() => ({ player: window.app.battle.player.auto, persisted: window.app.journey.s.autoBattle }));
  qaAssert(row.nativeAuto.player === true && row.nativeAuto.persisted === true, 'Native AUTO button did not activate/persist actual automatic play');
  await qa.save(); return row;
}
async function complete(row) {
  for (let chunk = 0; chunk < 180; chunk++) {
    row.last = await page.evaluate(() => {
      const a = window.app, b = a.battle;
      for (let frame = 0; frame < 600 && b.active && !b.paused; frame++) a.step(1 / 60, frame % 90 === 0);
      return { active: b.active, paused: b.paused, hp: b.player?.hp, elapsed: b.elapsed, kills: b.kills,
        win: b.result?.win, pauseReasons: [...b.pauseReasons], auto: b.player?.auto };
    });
    qaAssert(row.last.auto === true, 'Production AUTO became inactive without a native choice');
    if (row.last.paused) {
      const buttons = page.locator('#masterworks[open] .mw-choices button:not([disabled]), #masterworks[open] .mw-story-choices button:not([disabled])');
      const button = buttons.first(); await button.waitFor({ state: 'visible', timeout: 10000 });
      row.choices.push({ text: await button.innerText(), identity: await button.evaluate(e => ({ boon: e.dataset.boon || null, story: e.dataset.storyChoice || null })), elapsed: row.last.elapsed });
      await button.click(); // The actual offered UI controls its own state/reward.
    }
    if (!row.last.active) break;
    if (chunk % 12 === 0) { await qa.save(); console.log(JSON.stringify({ run: row.index, phase: 'natural-combat', ...row.last })); }
    if (chunk === 179) throw Error('Natural Glass Garden did not finish within bounded fixed steps');
  }
  qaAssert(row.last.win === true && row.last.hp > 0, 'Actual free-Knight AUTO ended in defeat; preserve it, do not manufacture victory');
  for (let chunk = 0; chunk < 20 && !await page.locator('.exp-result-shell').isVisible(); chunk++) {
    await page.evaluate(() => { for (let frame = 0; frame < 120 && !window.app.expeditionUI.result; frame++) window.app.step(1 / 60, frame === 119); });
  }
  await page.locator('.exp-result-shell').waitFor({ state: 'visible', timeout: 30000 });
  row.after = await state();
  row.actual = await page.evaluate(() => {
    const a = window.app, b = a.battle;
    return { route: structuredClone(b.stage.expedition), heroId: b.heroId, heroLevel: b.growthStart?.level ?? null,
      kills: b.kills, roomsCleared: b.roomsCleared, totalRooms: b.world.rooms.length,
      timeSec: b.result.time, bossDefeated: b.bossDefeated, fullClear: b.result.fullClear,
      paid: !!b.result.expeditionReceipt?.ok, receipt: structuredClone(b.result.expeditionReceipt), dirty: !!b.rpgDirty };
  });
  qaAssert(row.after.result?.win === true && !row.after.result.saveError && row.actual.paid && !row.actual.dirty && row.after.pending === null, 'Natural victory did not reach persisted native settlement');
  // Public catalog policy is read solely to verify the actual saved UI payout.
  // This pure calculation never invokes a game reward/settlement authority.
  const catalog = DUNGEONS.find(dungeon => dungeon.id === 'glass_garden');
  const normalXp = applyFrontierRewards(catalog.rewards, row.started.pending.frontier).xp;
  let expectedLevel = row.before.level, expectedXp = row.before.xp + normalXp;
  while (expectedLevel < 50 && expectedXp >= accountLevelXp(expectedLevel)) { expectedXp -= accountLevelXp(expectedLevel); expectedLevel++; }
  if (expectedLevel === 50) expectedXp = Math.min(expectedXp, accountLevelXp(50));
  row.expectedProgression = { xpEarned: normalXp, level: expectedLevel, xp: expectedXp };
  qaAssert(row.actual.receipt.rewards.xp === normalXp && row.after.level === expectedLevel && row.after.xp === expectedXp
    && row.after.seq === row.before.seq + 1 && JSON.stringify(row.after.claimed) === JSON.stringify(row.before.claimed), 'Native saved XP/level/ticket differs from normal actual UI reward, or a quest was injected');
  const expectedStats = { ...row.before.stats, glass_garden: row.before.stats.glass_garden + 1, dungeonWins: row.before.stats.dungeonWins + 1 };
  qaAssert(JSON.stringify(row.after.stats) === JSON.stringify(expectedStats), 'Native victory stats were missing, duplicated or changed another route');
  qaAssert(row.after.history.length === row.before.history.length + 1, 'Exactly one native history record per saved victory is required');
  const record = row.after.history.at(-1);
  qaAssert(record.outcome === 'victory' && !row.before.history.some(old => old.runId === record.runId), 'Native history reused an outcome/identity');
  // ee01097 history has only {runId,floor,outcome,boonIds}; future replay details
  // are recorded when present without pretending they exist in the base.
  row.record = record;
  if (record.details) qaAssert(record.details.route?.id === 'glass_garden' && record.details.route.depth === 'standard' && record.details.heroId === 'knight' && record.details.control === 'auto', 'Native enriched history differs from observed route/free AUTO Knight');
  await qa.captureMedia(`glass-garden-win-${row.index}`);
  await page.screenshot({ path: path.join(qa.out, `earned-result-${row.index}.png`) });
  row.status = 'pass'; await qa.save();
}
async function nativeReloadAfterVictory(row) {
  // Exactly one paid garden departure per actual document. Ambiguous repeated
  // same-URL native media failures are not relabeled or filtered to pass.
  await page.locator('.exp-result-shell .exp-close').click();
  await page.waitForFunction(() => window.app.mode === 'lobby' && !window.app.battle.active);
  row.beforeReload = await state();
  const before = row.beforeReload;
  qaAssert(before.pending === null && before.level === row.after.level && before.xp === row.after.xp
    && JSON.stringify(before.history) === JSON.stringify(row.after.history), 'Actual result close lost natural paid progression');
  await qa.boot({ reload: true }); row.afterReload = await state();
  const after = row.afterReload;
  row.energyReload = nativeEnergyTransition(before, after, 0, 'native reload');
  qaAssert(after.selected === 'knight' && after.pending === null && !after.active
    && after.level === before.level && after.xp === before.xp
    && after.gold === before.gold && after.seq === before.seq && after.inventoryCount === before.inventoryCount
    && JSON.stringify(after.hero) === JSON.stringify(before.hero)
    && JSON.stringify(after.claimed) === JSON.stringify(before.claimed)
    && JSON.stringify(after.stats) === JSON.stringify(before.stats)
    && JSON.stringify(after.history) === JSON.stringify(before.history)
    && after.purchases.length === 0 && after.spentKRW === 0, 'Native reload did not preserve exactly the earned progression');
  await qa.captureMedia(`native-reload-after-paid-win-${row.index}`); await qa.save();
}
try {
  page = await qa.start(); await qa.boot(); report.initial = await state();
  const initial = report.initial;
  qaAssert(report.contextInitiallyEmpty && initial.selected === 'knight' && initial.hero.level === 1 && initial.hero.star === 1 &&
    Object.values(initial.hero.equip).every(value => value === null) && initial.level === 1 && initial.xp === 0 &&
    initial.history.length === 0 && initial.stats.glass_garden === 0 && initial.stats.dungeonWins === 0 &&
    initial.pending === null && initial.progress.unlocked === 1 && initial.purchases.length === 0 && initial.spentKRW === 0,
  'Expected untouched fresh original free Knight and expedition progression');
  for (let index = 0; index < maxRuns; index++) {
    const row = await admission(); await complete(row); await nativeReloadAfterVictory(row);
    if (row.afterReload.level >= 3 && row.afterReload.energy >= 12) break;
    if (index === maxRuns - 1) throw Error('Bounded natural victories did not earn the required Lv3 save');
  }
  const earned = await state(); report.final = earned;
  qaAssert(earned.level >= 3 && earned.energy >= 12 && earned.selected === 'knight' && earned.pending === null && !earned.active &&
    earned.purchases.length === 0 && earned.spentKRW === 0, 'Native stop condition was not earned');
  // Reloaded native lobby state is the reusable save. No write/injection into
  // profile, localStorage, progression or battle is performed by this helper.
  const exported = await page.evaluate(() => ({ raw: localStorage.getItem('bladesurge_save_v1'),
    level: window.app.expedition.s.level, xp: window.app.expedition.s.xp, seq: window.app.expedition.s.seq, stats: structuredClone(window.app.expedition.s.stats), energy: window.app.eco.s.energy, history: structuredClone(window.app.eco.s.masterworks.history), pending: window.app.expedition.s.pending }));
  qaAssert(exported.raw && exported.level >= 3 && exported.energy >= 12 && exported.pending === null, 'Native stored stop condition missing');
  const persisted = JSON.parse(exported.raw);
  qaAssert(persisted.selected === 'knight' && persisted.expedition.level === exported.level && persisted.energy === exported.energy &&
    persisted.expedition.pending === null && persisted.expedition.xp === exported.xp && persisted.expedition.seq === exported.seq
    && JSON.stringify(persisted.expedition.stats) === JSON.stringify(exported.stats) && JSON.stringify(persisted.masterworks.history) === JSON.stringify(exported.history), 'Exact native primary save differs from observed earned state');
  await qa.finishObservations();
  await qa.close(); // Final strict classification AFTER pending captures/cleanup.
  const bytes = Buffer.from(exported.raw, 'utf8');
  await fs.writeFile(path.join(qa.out, 'earned-save.json'), bytes, { flag: 'wx' });
  report.earnedSave = { path: 'earned-save.json', bytes: bytes.length, sha256: qaHash(bytes), level: exported.level,
    energy: exported.energy, xp: exported.xp, seq: exported.seq, stats: exported.stats, selected: 'knight', pending: null, history: exported.history, natural: true };
  report.remaining.browserAcceptance = 'pass for earned-save acquisition only'; report.status = 'pass';
} catch (error) { report.status = 'fail'; report.failure = String(error?.stack || error); process.exitCode = 1; }
finally {
  try { await qa.close(); } catch (error) { report.status = 'fail'; report.cleanupFailure = String(error?.stack || error); process.exitCode = 1; }
  report.finished = new Date().toISOString(); await qa.save();
}
console.log(JSON.stringify({ status: report.status, out: qa.out, earnedSave: report.earnedSave && { path: report.earnedSave.path, sha256: report.earnedSave.sha256, level: report.earnedSave.level, energy: report.earnedSave.energy }, releaseApproved: false, failure: report.failure, cleanupFailure: report.cleanupFailure }));
