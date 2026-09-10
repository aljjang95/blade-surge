/**
 * Installs the deterministic in-page part of the RSI metrics harness.
 * The function is self-contained so a native IAB/CDP session can inject the
 * exact same driver with `Runtime.callFunctionOn` or an equivalent evaluator.
 */
export function installMetricsDriver({ app = globalThis.app, storyEvents = [] } = {}) {
  if (!app?.battle || typeof app.step !== 'function') throw new TypeError('Metrics driver requires a running app');
  const stories = new Map(storyEvents.map((event) => [event.id, event]));
  const choices = [];

  const resolveOffers = () => {
    const battle = app.battle;
    let resolved = 0;
    // More than one offer can be queued after a room clear. Drain the queue at
    // the same game-time instant so UI reading time never changes the sample.
    for (let guard = 0; guard < 12 && battle.active; guard++) {
      const offer = battle.currentOffer?.();
      if (!offer) break;
      let result, choice;
      if (offer.kind === 'boon') {
        choice = offer.ids?.[0];
        if (!choice) throw new Error('Boon offer has no deterministic first choice');
        result = battle.selectBoon?.(choice);
        if (result?.ok) choices.push(`boon:${choice}`);
      } else if (offer.kind === 'story') {
        const event = stories.get(offer.id);
        const remembered = battle.masterworks?.s?.story?.[offer.id];
        choice = event?.choices?.find((entry) => entry.id === remembered)?.id || event?.choices?.[0]?.id;
        if (!choice) throw new Error(`Story offer has no valid choice: ${offer.id}`);
        result = battle.selectStory?.(choice);
        if (result?.ok) choices.push(`story:${offer.id}:${choice}`);
      } else throw new Error(`Unknown metrics offer kind: ${offer.kind}`);
      if (!result?.ok) throw new Error(`Metrics choice rejected: ${offer.kind}:${choice}`);
      resolved++;
    }
    return resolved;
  };

  const driver = {
    choices,
    resolveOffers,
    step(dt, render = false) {
      // A queued offer is not actionable until its native view owns the pause.
      // Consuming it earlier can leave the later presentation callback with an
      // empty dialog, which is behavior a real player can never produce.
      if (app.battle.paused) resolveOffers();
      if (!app.battle.active) return 0;
      if (app.battle.paused) throw new Error('Battle paused without a resolvable metrics offer');
      app.step(dt, render);
      if (app.battle.paused) resolveOffers();
      if (app.battle.active && app.battle.paused) throw new Error('Battle paused without a resolvable metrics offer');
      return Number.isFinite(dt) && dt > 0 ? dt : 0;
    },
    snapshot() { return { choices: [...choices] }; },
  };
  globalThis.__metricsDriver = driver;
  return driver.snapshot();
}

export const METRICS_DRIVER_SOURCE = installMetricsDriver.toString();
