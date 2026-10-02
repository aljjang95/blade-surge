// Prepared only: NOT_RUN. Execute sequentially after the owning release loop
// authorizes browser QA. No metrics, unlock edits, forced kills or teleports.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createExpeditionQa, nativeGameplayFocus, nativeInputObservation, qaArgument, qaHash } from './expedition-qa-runtime.mjs';

const root = path.resolve(import.meta.dirname, '..');
const saveArg = qaArgument('save');
if (!saveArg || !path.isAbsolute(saveArg)) throw Error('Required --save=/absolute/naturally-earned-save.json');
const savePath = path.resolve(saveArg), bytes = await readFile(savePath), rawSave = bytes.toString('utf8'), saved = JSON.parse(rawSave);
const acquisitionPath = qaArgument('acquisition') || path.join(path.dirname(savePath), 'report.json');
if (!path.isAbsolute(acquisitionPath)) throw Error('Acquisition report path must be absolute');
const acquisitionBytes = await readFile(acquisitionPath), acquisition = JSON.parse(acquisitionBytes);
if (!(saved.expedition?.level >= 3) || !(saved.energy >= 12) || saved.selected !== 'knight') throw Error('Earned native save requires free Knight, expedition Lv3 and energy>=12');
if (acquisition.kind !== 'earned-expedition-save' || acquisition.status !== 'pass' || acquisition.naturalStart !== true ||
    !/^[0-9a-f]{40}$/.test(acquisition.head || '') || acquisition.head !== acquisition.expectedSha ||
    acquisition.build?.sha !== acquisition.head || acquisition.build?.dirty !== false || typeof acquisition.build?.pwaRelease !== 'string' ||
    acquisition.synthetic !== false || acquisition.contextInitiallyEmpty !== true || acquisition.earnedSave?.natural !== true ||
    acquisition.earnedSave?.sha256 !== qaHash(bytes) || acquisition.earnedSave?.bytes !== bytes.length ||
    acquisition.earnedSave?.level !== saved.expedition.level || acquisition.earnedSave?.xp !== saved.expedition.xp ||
    acquisition.earnedSave?.seq !== saved.expedition.seq || acquisition.earnedSave?.energy !== saved.energy ||
    JSON.stringify(acquisition.earnedSave?.stats) !== JSON.stringify(saved.expedition.stats) ||
    JSON.stringify(acquisition.earnedSave?.history) !== JSON.stringify(saved.masterworks?.history) || acquisition.mediaGates !== 'pass' ||
    acquisition.errors?.length !== 0 || acquisition.httpErrors?.length !== 0 || acquisition.mediaCheckpointDiagnostics?.length !== 0 || acquisition.mediaCancellations?.unresolved?.length !== 0 ||
    !acquisition.runs?.length || !acquisition.runs.every(run => run.status === 'pass' && run.actual?.paid && run.after?.result?.win === true &&
      run.afterReload?.selected === 'knight' && run.afterReload?.pending === null && run.afterReload?.active === false)) {
  throw Error('Expected exact native save exported by successful natural UI acquisition with strict media/release gates');
}
const report = { status: 'running', releaseApproved: false, base: '0cf61344eccfa08a05bc77303d7f1c1c87114cda',
  saveSha256: qaHash(bytes), acquisition: { path: acquisitionPath, sha256: qaHash(acquisitionBytes), head: acquisition.head,
    build: acquisition.build, runs: acquisition.runs.length, nativeSave: acquisition.earnedSave },
  scope: 'Exact clean committed production preview/fixed release, restored exact naturally-earned free-Knight native save, actual standard dungeon UI admission, production AUTO combat/choices and keyboard input. Fixed 50ms app.step clock only. Reads displayed HUD clues; no hidden station answers/secrets, actor position/HP/enemy/room/progress/seal/unlock writes. Not a fresh-account Astral clear, physical phone, visual approval or FPS benchmark.',
  required: {}, events: [], coverage: { damageDuringSelection: 'NOT_OBSERVED', physicalPhone: 'NOT_RUN', formalMetrics: 'NOT_RUN', visualApproval: 'NOT_RUN' } };
const qa = await createExpeditionQa({ root, driver: import.meta.filename, report,
  sourceFiles: ['tools/astral-constellation-qa.mjs', 'tools/expedition-qa-runtime.mjs', 'tools/conquest-media-observer.mjs', 'tools/qa-media-checkpoints.mjs',
    'src/game/astral-constellations.js', 'src/game/astral-constellation-view.js', 'src/data/route-objectives.js'] });
const out = qa.out;
let page, lastHp = null, observedDamage = 0;
const saveReport = qa.save;
const assert = (condition, message) => { if (!condition) throw Error(message); };
async function observeResources(label, watchOwned = false) {
  const evidence = await page.evaluate(({ watchOwned }) => {
    const a = window.app, r = a.renderer, view = a.battle.routeObjectives?.view;
    const targets = [r.composer.renderTarget1, r.composer.renderTarget2, r.bloom.renderTargetBright,
      ...r.bloom.renderTargetsHorizontal, ...r.bloom.renderTargetsVertical];
    const observations = window.__astralQaResourceObservations ||= [];
    if (watchOwned && view && !observations.some(row => row.viewId === view.group.uuid)) {
      const owned = [...view.geometries, ...view.materials, ...view.textures];
      const row = { viewId: view.group.uuid, geometries: view.geometries.size, materials: view.materials.size,
        textures: view.textures.size, disposalCounts: Object.fromEntries(owned.map(item => [item.uuid, 0])) };
      // Passive dispose events only; callbacks retain the plain record, not a
      // resource/view/actor. The actual lobby/retry owns every disposal call.
      for (const item of owned) { const id = item.uuid; item.addEventListener('dispose', () => row.disposalCounts[id]++); }
      observations.push(row);
    }
    return { targets: targets.map(target => target.texture.uuid), memory: { ...r.r.info.memory },
      programs: r.r.info.programs.length, viewPresent: !!view, observations: structuredClone(observations) };
  }, { watchOwned });
  report.resourceObservations ||= [];
  if (report.resourceObservations.length) assert(JSON.stringify(evidence.targets) === JSON.stringify(report.resourceObservations[0].evidence.targets), `${label}: Astral added/replaced render targets`);
  report.resourceObservations.push({ label, evidence }); await saveReport(); return evidence;
}
const snapshot = () => page.evaluate(() => {
  const app = window.app, g = app.battle, r = g.routeObjectives, p = g.player;
  const current = r?.gates[r.progress], entry = r?.view?.entries[r.progress];
  return { active: g.active, paused: g.paused, elapsed: g.elapsed, auto: p?.auto, state: p?.state, hp: p?.hp, mp: p?.mp, maxMp: p?.maxMp, cds: p?.cds?.slice(),
    pos: p && { x: p.pos.x, z: p.pos.z }, progress: r?.progress, read: r?.read, hold: r?.hold, mistakes: r?.mistakes,
    phase: r?.phase, closed: r?.closed, current: current && { stationId: current.stationId, ready: current.ready, available: current.available,
      roomId: current.room.id, pos: { x: current.pos.x, z: current.pos.z },
      pads: current.pads.map(pad => ({ code: pad.code, glyph: pad.glyph, name: pad.name, x: pad.pos.x, z: pad.pos.z })) },
    clueVisible: !!entry?.title.sprite.visible, padsVisible: entry?.pads.map(pad => pad.root.visible),
    hud: document.querySelector('#objective')?.textContent, kills: g.kills, sealed: g.world?.sealed,
    nonbossRemaining: g.world?.rooms.filter(room => !['start', 'boss'].includes(room.type) && !room.cleared).length,
    bossDefeated: g.bossDefeated, bossRoomCleared: g.world?.bossRoom.cleared,
    report: g.result?.routeObjective, result: g.result && { win: g.result.win, paid: !!g.result.expeditionReceipt?.ok },
    currency: { gold: app.eco.s.gold, gems: app.eco.s.gems, energy: app.eco.s.energy },
    stats: app.expedition.s.stats.astral_leviathan_spire, ticket: app.expeditionTicket?.id,
  };
});
async function focusGameplay() { const evidence = await nativeGameplayFocus(page); report.events.push({ label: 'native gameplay canvas focus', evidence }); return evidence; }
async function steps(count, render = true) {
  await page.evaluate(({ count, render }) => { for (let i = 0; i < count; i++) window.app.step(.05, render && i === count - 1); }, { count, render });
  const s = await snapshot(); if (lastHp !== null && s.hp < lastHp) observedDamage += lastHp - s.hp; lastHp = s.hp;
  return s;
}
async function renderCurrentFrame(label) {
  const before = await snapshot();
  await page.evaluate(() => window.app.renderer.render()); // No additional simulation tick.
  const after = await snapshot();
  for (const key of ['elapsed', 'phase', 'progress', 'read', 'hold', 'mistakes', 'hp', 'paused']) {
    assert(after[key] === before[key], `${label}: drawing advanced actual gameplay (${key})`);
  }
  report.events.push({ label: 'current GPU frame for ' + label, before, after });
  await saveReport();
  return after;
}
async function viewport(width, height, label) {
  // Real resize boundaries clear production Input. Release actual browser
  // keys and use the existing native portrait continuation before observing.
  for (const key of ['w', 'a', 's', 'd', 'j', 'k', '1']) await page.keyboard.up(key);
  await page.setViewportSize({ width, height });
  const continueButton = page.locator('#btn-ignore-rotate');
  if (await continueButton.isVisible()) {
    report.events.push({ label: 'native portrait continuation', text: await continueButton.innerText() });
    await continueButton.click(); await continueButton.waitFor({ state: 'hidden' });
  }
  await page.waitForTimeout(150); // Real responsive resize/clear delivery.
  await focusGameplay(); return renderCurrentFrame(label);
}
async function until(predicate, budget, label, allowPendingVictory = false) {
  for (let i = 0; i < budget; i++) {
    const s = await steps(1, i % 10 === 0);
    if (predicate(s)) return renderCurrentFrame(label);
    if (s.paused) {
      const offered = page.locator('#masterworks[open] .mw-choices button:not([disabled]), #masterworks[open] .mw-story-choices button:not([disabled])').first();
      if (await offered.isVisible()) {
        report.events.push({ label: 'native offered growth/story choice', text: await offered.innerText() });
        await offered.click(); await focusGameplay(); continue;
      }
    }
    const waitingForPaidWin = allowPendingVictory && s.result?.win === true && !s.result.paid && s.hp > 0;
    if ((!s.active || !(s.hp > 0)) && !waitingForPaidWin) throw Error(`${label}: expedition ended naturally before the required observation`);
    if (i % 120 === 0) { report.lastCheckpoint = { label, tick: i, state: s }; await saveReport(); }
  }
  throw Error(`${label}: production input did not reach target in ${budget} fixed ticks`);
}
async function auto(on) {
  if ((await snapshot()).auto !== on) await page.locator('#btn-auto').click();
  await focusGameplay(); assert((await snapshot()).auto === on, 'AUTO UI did not change production mode');
}
async function navigate(point, label, arrival = .4) {
  const initial = (await snapshot()).pos; let held = [];
  try {
    for (let i = 0; i < 1800; i++) {
      const nav = await page.evaluate(point => {
        const app = window.app, g = app.battle, p = g.player, d = Math.hypot(point.x - p.pos.x, point.z - p.pos.z);
        const direction = d > 3 ? g.world.flowDir(g.world.buildFlow(point.x, point.z), p.pos.x, p.pos.z) : null;
        const dx = direction?.[0] ?? point.x - p.pos.x, dz = direction?.[1] ?? point.z - p.pos.z;
        const yaw = app.input.getCameraYaw?.() || 0, c = Math.cos(yaw), s = Math.sin(yaw), length = Math.hypot(dx, dz) || 1;
        return { distance: d, x: (dx * c - dz * s) / length, y: (dx * s + dz * c) / length,
          keys: Object.fromEntries(['w', 'a', 's', 'd'].map(key => [key, !!app.input.keys['Key' + key.toUpperCase()]])) };
      }, point);
      if (nav.distance < arrival) break;
      const keys = [nav.x > .28 ? 'd' : nav.x < -.28 ? 'a' : null, nav.y > .28 ? 's' : nav.y < -.28 ? 'w' : null].filter(Boolean);
      for (const key of held) if (!keys.includes(key)) await page.keyboard.up(key);
      for (const key of keys) if (!held.includes(key) || !nav.keys[key]) {
        if (held.includes(key) && !nav.keys[key]) await page.keyboard.up(key); // A new down must not be ignored as repeat.
        await page.keyboard.down(key); const accepted = await nativeInputObservation(page);
        assert(accepted.input.keys['Key' + key.toUpperCase()] && !accepted.focus.blocked, `${label}: real movement keydown was ignored`);
      }
      held = keys; const s = await steps(1, i % 10 === 0); assert(s.active && s.hp > 0, `${label}: natural death during movement`);
      if (i % 100 === 0) { report.lastCheckpoint = { label, tick: i, nav, state: s }; await saveReport(); }
      if (i === 1799) throw Error(`${label}: actual keyboard movement failed to reach Floor target`);
    }
  } finally { for (const key of held) await page.keyboard.up(key); }
  const s = await steps(1), travel = Math.hypot(s.pos.x - initial.x, s.pos.z - initial.z);
  assert(Math.hypot(s.pos.x - point.x, s.pos.z - point.z) < (arrival > 1 ? 1.2 : .9), `${label}: keyboard input did not reach advertised pad`);
  report.events.push({ label, source: 'Playwright keyboard -> production Input -> Player -> Floor', travel, state: s });
  return s;
}
function visibleClue(s) {
  const code = s.hud?.match(/단서 ([ABC]) [△○◇]/)?.[1] || s.hud?.match(/ · ([ABC]) [△○◇] (?:삼각|원|마름모) 판/)?.[1];
  assert(code && s.clueVisible, 'No actually displayed HUD/hourglass clue; helper will not inspect hidden answer fields');
  return { code, pad: s.current.pads.find(pad => pad.code === code) };
}
async function freshRead() {
  const s = await snapshot(); await navigate(s.current.pos, 'leave all choice circles');
  return until(s => s.phase === 'select' && s.read >= 1 && s.clueVisible, 120, 'read advertised clue');
}
async function partialChoice(label) {
  const s = await until(s => s.hold >= .3 && s.hold < .75, 16, label);
  assert(s.progress === 0 && s.read >= 1, `${label}: station was already confirmed before interruption`);
  return s;
}
async function actionInterrupt(key, allowedStates, label) {
  if (label === 'skill') {
    const before = await snapshot(); await navigate(before.current.pos, 'safe center for natural skill readiness');
    await until(s => s.cds?.[0] <= 0 && s.mp >= s.maxMp, 2400, 'natural skill cooldown and MP recovery');
  }
  const s = await freshRead(), clue = visibleClue(s); await navigate(clue.pad, `${label} correct-pad approach`, 1.17);
  const partial = await partialChoice(`${label} incomplete manual hold`);
  const beforeInput = await focusGameplay(); await page.keyboard.down(key);
  const keyDown = await nativeInputObservation(page), code = key === 'j' ? 'KeyJ' : key === 'k' ? 'KeyK' : 'Digit1';
  const queued = key === 'j' ? 'attack' : key === 'k' ? 'dodge' : 'skill0';
  assert(keyDown.input.keys[code] && keyDown.input.queue.includes(queued) && !keyDown.focus.blocked, `${label}: native keydown did not reach production input`);
  const action = await steps(1); await page.keyboard.up(key); const keyUp = await nativeInputObservation(page);
  assert(!keyUp.input.keys[code], `${label}: native key release remained held`);
  assert(allowedStates.includes(action.state), `${label}: keyboard did not execute a production action (${action.state})`);
  assert(action.progress === 0 && action.read === 0 && action.hold === 0, `${label}: action failed to reset current read/choice`);
  report.required[label] = { partial, beforeInput, keyDown, action, keyUp };
  await until(s => ['idle', 'move'].includes(s.state), 160, `${label} real recovery`);
}
async function enterFromUI() {
  await page.locator('#btn-expedition').click(); await page.locator('[data-section="dungeons"]').click();
  await page.getByRole('button', { name: '기본 원정', exact: true }).click();
  const card = page.locator('[data-dungeon="astral_leviathan_spire"][data-depth="standard"]');
  const enter = card.getByRole('button', { name: '던전 입장', exact: true }); assert(await enter.isEnabled(), 'Actual standard access is locked in supplied save');
  await enter.click(); await page.waitForFunction(() => window.app?.battle?.active && !window.app.stageStarting, null, { timeout: 180000 });
  await focusGameplay(); const s = await snapshot(); assert(s.progress === 0 && s.sealed && s.ticket, 'Normal UI admission did not start a fresh sealed 0/4 ticket');
  return s;
}
try {
  page = await qa.start({ viewport: { width: 1200, height: 800 } });
  await page.addInitScript(rawSave => { if (!sessionStorage.getItem('astral-qa-save-installed')) {
    localStorage.setItem('bladesurge_save_v1', rawSave); sessionStorage.setItem('astral-qa-save-installed', '1');
  } }, rawSave);
  await qa.boot();
  await observeResources('native earned lobby');
  report.access = await page.evaluate(() => ({ level: window.app.expedition.s.level,
    access: window.app.expedition.dungeonAccess('astral_leviathan_spire'), selected: window.app.eco.s.selected }));
  assert(report.access.level >= 3 && report.access.access.ok, 'Production service rejected supplied earned save');
  report.entry = await enterFromUI(); await auto(true);
  const combat = await until(s => s.kills > 0 && s.current.ready, 12000, 'natural first-room AUTO combat'); await auto(false);
  await observeResources('first actual Astral view', true);
  assert(combat.progress === 0, 'AUTO restored first station before manual proof'); report.required.naturalCombat = { combat, observedHpLoss: observedDamage };
  let s = await freshRead(); const clue = visibleClue(s), wrong = s.current.pads.find(pad => pad.code !== clue.code);
  await page.screenshot({ path: path.join(out, '01-desktop-clue.png') });
  await viewport(390, 844, 'small-screen actual clue'); await page.screenshot({ path: path.join(out, '02-small-clue.png') });
  await viewport(1200, 800, 'desktop after actual portrait continuation');
  await navigate(wrong, 'actual wrong-pad movement', 1.17); s = await until(s => s.mistakes === 1 && s.phase === 'retry', 60, 'wrong-pad confirmation');
  assert(s.progress === 0 && s.sealed, 'Wrong pad advanced objective or opened seal'); report.required.wrongRetry = s;
  await page.screenshot({ path: path.join(out, '03-wrong-retry.png') });
  s = await freshRead(); await navigate(visibleClue(s).pad, 'small-screen partial hold', 1.17); await partialChoice('small-screen incomplete hold');
  await viewport(390, 844, 'small-screen actual partial hold'); await page.screenshot({ path: path.join(out, '03-small-pad-hold.png') });
  await viewport(1200, 800, 'desktop after actual partial hold');
  await actionInterrupt('j', ['attack'], 'attack');
  await actionInterrupt('1', ['skill', 'ult'], 'skill');
  await actionInterrupt('k', ['dodge'], 'dodge');
  s = await freshRead(); await navigate(visibleClue(s).pad, 'pause partial correct choice', 1.17); const partial = await partialChoice('pause incomplete manual hold');
  await page.locator('#btn-pause').click(); s = await steps(20); assert(s.paused && s.hold === 0 && s.read === 0, 'Actual pause did not reset choice');
  report.required.pause = { partial, paused: s }; await page.locator('#btn-resume').click(); await focusGameplay();
  s = await freshRead(); await navigate(visibleClue(s).pad, 'actual correct-pad movement', 1.17);
  s = await until(s => s.progress === 1, 60, 'manual correct selection'); assert(s.sealed && s.nonbossRemaining > 0, '1/4 opened boss seal');
  report.required.manualCorrect = s; await page.screenshot({ path: path.join(out, '04-restored-1-of-4.png') });
  await auto(true); const progression = []; let previousProgress = 1;
  s = await until(s => {
    if (s.progress !== previousProgress) { progression.push(s); previousProgress = s.progress; }
    if (!s.sealed) assert(s.progress === 4 && s.nonbossRemaining === 0, 'Seal opened without 4/4 plus every nonboss room');
    return s.result?.paid;
  }, 24000, 'natural AUTO completion and actual boss settlement', true);
  assert(s.result.win && s.report?.complete && s.report.progress === 4 && !s.sealed && s.bossDefeated && s.bossRoomCleared, 'Actual win omitted a station/seal/boss gate');
  report.required.actualWin = { progression, result: s }; await page.screenshot({ path: path.join(out, '05-natural-win-result.png') });
  await observeResources('actual paid win');
  const duplicate = await page.evaluate(() => {
    const app = window.app, g = app.battle, before = { gold: app.eco.s.gold, gems: app.eco.s.gems, wins: app.expedition.s.stats.astral_leviathan_spire };
    // Deliberate duplicate UI delivery, through the existing result authority.
    // No reward or result field is synthesized by the probe.
    g.victory(); app.expeditionUI.showResult(g, true); app.expeditionUI.showResult(g, true);
    const after = { gold: app.eco.s.gold, gems: app.eco.s.gems, wins: app.expedition.s.stats.astral_leviathan_spire };
    const stored = JSON.parse(localStorage.getItem('bladesurge_save_v1'));
    return { before, after, persisted: stored.gold === after.gold && stored.expedition.stats.astral_leviathan_spire === after.wins };
  });
  assert(JSON.stringify(duplicate.before) === JSON.stringify(duplicate.after) && duplicate.persisted, 'Repeated actual result delivery paid again or was not persisted');
  report.required.duplicateSettlement = duplicate;
  await page.locator('.exp-result-footer').getByRole('button', { name: /^다시 도전(?: · 에너지 4)?$/ }).click();
  await page.waitForFunction(() => window.app?.battle?.active && !window.app.stageStarting, null, { timeout: 180000 }); await auto(false);
  s = await snapshot(); assert(s.progress === 0 && s.read === 0 && s.mistakes === 0 && s.sealed && s.ticket, 'Normal retry retained old run state');
  report.required.newRun = s; await auto(true); await until(s => s.current?.ready, 12000, 'second run first-room combat'); await auto(false);
  await observeResources('actual fresh retry view', true);
  await freshRead(); const lossBefore = await snapshot(); await page.locator('#btn-pause').click(); await page.locator('#btn-giveup').click();
  s = await snapshot(); assert(s.result?.win === false && s.report?.complete === false && s.report.progress === 0 && s.read === 0 && s.hold === 0, 'Actual giveup failed to close partial selection');
  assert(s.currency.gold === lossBefore.currency.gold && s.stats === lossBefore.stats, 'Giveup paid a win reward'); report.required.lossReset = s;
  await page.screenshot({ path: path.join(out, '06-giveup-result.png') });
  await page.locator('.exp-close').click(); s = await snapshot();
  assert(s.closed === undefined, 'Old route controller survived lobby stop');
  const cleaned = await page.evaluate(() => !window.app.scene.getObjectByName('TLL_AstralConstellations'));
  assert(cleaned, 'Astral view survived actual lobby teardown'); report.required.cleaned = true;
  const finalResources = await observeResources('actual lobby teardown');
  assert(finalResources.observations.length === 2 && finalResources.observations.every(row => Object.values(row.disposalCounts).every(count => count === 1)), 'Actual retry/lobby did not dispose both owned views exactly once');
  await qa.finishObservations(); await qa.close(); report.status = 'pass';
} catch (error) { report.status = 'fail'; report.error = String(error.stack || error); process.exitCode = 1; }
finally {
  try { await qa.close(); } catch (error) { report.status = 'fail'; report.cleanupFailure = String(error?.stack || error); process.exitCode = 1; }
  report.finished = new Date().toISOString(); await saveReport();
}
console.log(JSON.stringify({ status: report.status, releaseApproved: false, out, error: report.error, remaining: report.coverage }));
