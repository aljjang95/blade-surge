// 기존 모바일 하네스의 실제 터치·자연 시계·미디어 관측을 그대로 사용한다.
export async function runMobileJourneyChecks({ page, device, nativeCall, shortTouch, state, step, screenshot, boot, clockProgress }) {
  const assert = (value, message) => { if (!value) throw Error(message); };
  const resize = async ({ width, height }) => {
    await nativeCall('Emulation.setDeviceMetricsOverride', { width, height, screenWidth: width, screenHeight: height,
      deviceScaleFactor: device.deviceScaleFactor, mobile: true,
      screenOrientation: { type: width > height ? 'landscapePrimary' : 'portraitPrimary', angle: width > height ? 90 : 0 } });
    await page.waitForFunction(({ width, height }) => Math.abs(innerWidth - width) <= 1 && Math.abs(innerHeight - height) <= 1, { width, height });
    if (await page.locator('#btn-ignore-rotate').isVisible()) await shortTouch('#btn-ignore-rotate');
  };
  const modal = '.citadel-hub-dialog';
  await step('Native fullscreen start and WebGL2 renderer', async row => {
    row.screen = await page.evaluate(() => ({ fullscreen: !!document.fullscreenElement, request: app.appModeView.lastLandscapeRequest }));
    assert(row.screen.request, 'Start never requested screen mode');
    if (row.screen.request.fullscreen === 'active') assert(row.screen.fullscreen, 'Fullscreen active without native element');
    row.renderer = await page.evaluate(() => { const gl = document.querySelector('#gl').getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info'); return { webgl2: !!gl, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null }; });
    assert(row.renderer.webgl2, 'WebGL2 missing');
  });
  await step('Menu sections reachable in portrait and short landscape', async row => {
    row.layouts = [];
    await shortTouch('#citadel-dungeon-journey');
    for (const viewport of [{ width: 844, height: 300 }, { width: 667, height: 280 }, { width: 844, height: 390 }, { width: 932, height: 430 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
      await resize(viewport);
      for (const tab of ['arena', 'forge', 'jobs', 'quests', 'dungeons']) {
        await shortTouch(`.adventure-nav [data-section="${tab}"]`);
        await page.waitForFunction(tab => app.expeditionUI.initialTab === tab && document.querySelector('.exp-shell'), tab);
        const layout = await page.evaluate(() => {
          const bounds = selector => { const el = document.querySelector(selector), r = el.getBoundingClientRect(); return { y: r.y, height: r.height, bottom: r.bottom, scrollHeight: el.scrollHeight }; };
          const controls = [...document.querySelectorAll('.adventure-nav button')].map(el => { const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { label: el.textContent, height: r.height, reachable: el.contains(hit) }; });
          return { panel: bounds('#tab-stage > .panel'), content: bounds('.exp-scroll'), nav: bounds('#meta .bottomnav'), controls, overflow: document.documentElement.scrollWidth > innerWidth };
        });
        row.layouts.push({ viewport, tab, ...layout });
        assert(layout.content.height >= 64, `${tab} content collapsed at ${viewport.width}x${viewport.height}`);
        assert(layout.content.y >= layout.panel.y && layout.content.bottom <= layout.panel.bottom + 1 && layout.content.bottom <= layout.nav.y + 1, `${tab} content escaped panel or overlaps dock`);
        assert(!layout.overflow && layout.controls.every(control => control.height >= 44 && control.reachable), `${tab} menu clipped/covered`);
        if (['arena', 'dungeons'].includes(tab)) await screenshot(`${viewport.width}x${viewport.height}-${tab}`);
      }
      await shortTouch('.adventure-nav [data-section="campaign"]');
      assert(await page.locator('#campaign-view:not([hidden])').isVisible(), 'Campaign unreachable');
      await shortTouch('.adventure-nav [data-section="dungeons"]');
    }
  });
  await resize({ width: 844, height: 390 });
  await step('Lv1 graphical journey, locked preview and cancel do not spend', async row => {
    assert(await page.locator('[data-journey-node]').count() === 12, 'Twelve route images missing');
    assert(await page.locator('[data-journey-node="glass_garden"]').getAttribute('aria-current') === 'step', 'Fresh Lv1 target incorrect');
    await shortTouch('[data-journey-node="star_archive"]'); await shortTouch('#journey-prepare');
    await page.locator(`${modal}[open]`).waitFor();
    assert(await page.locator(`${modal} .citadel-hub-go`).isDisabled(), 'Locked route allowed departure');
    await shortTouch(`${modal} .citadel-hub-cancel`);
    await shortTouch('[data-journey-node="glass_garden"]'); await shortTouch('#journey-prepare');
    await shortTouch(`${modal} .citadel-hub-cancel`);
    const after = await state();
    assert(after.energy === row.before.energy && after.gold === row.before.gold && after.pending === null, 'Preview/cancel mutated admission');
    await screenshot('lv1-dungeon-journey');
  });
  await step('Real touch Glass admission and natural victory', async row => {
    await shortTouch('#journey-prepare'); await shortTouch(`${modal} .citadel-hub-go`);
    await page.waitForFunction(() => app.battle.active && !app.stageStarting && !document.querySelector('.exp-cinematic'), null, { timeout: 180000 });
    if (await page.locator('#tutorial-skip').isVisible()) await shortTouch('#tutorial-skip');
    assert((await state()).energy === row.before.energy - 4, 'Glass admission must cost four once');
    if (!(await state()).autoBattle) await shortTouch('#btn-auto');
    const started = Date.now();
    while (Date.now() - started < 300000 && !await page.locator('.exp-result-shell').isVisible()) {
      const choice = page.locator('#masterworks[open] .mw-choices button:not([disabled]),#masterworks[open] .mw-story-choices button:not([disabled])').first();
      if (await choice.isVisible()) await shortTouch(choice);
      if (await page.locator('#modal.show #r-no').isVisible()) await shortTouch('#r-no');
      await page.waitForTimeout(1200);
    }
    const result = await state(); row.result = result;
    assert(result.battle.result?.win && result.battle.result.receipt?.ok && !result.pending, 'Natural victory/settlement failed');
    assert(result.expedition.stats.glass_garden === 1 && result.inventory > row.before.inventory, 'Real progress/loot missing');
    await screenshot('natural-glass-victory');
  });
  await step('Claim existing quest, next preparation and saved journey reload', async row => {
    await shortTouch('[data-next-dungeon="ember_vault"]');
    await page.locator(`${modal}[open]`).waitFor(); row.progress = await state();
    assert(row.progress.expedition.claimed.includes('garden_scout') && row.progress.expedition.level >= 2, 'Quest did not unlock next region');
    assert(row.progress.energy === row.before.energy && row.progress.pending === null, 'Next preparation consumed admission early');
    assert(await page.locator('#citadel-destination-title').innerText() === '잿불 금고', 'Prepared wrong region');
    await screenshot('next-ember-preparation');
    await shortTouch(`${modal} .citadel-hub-cancel`); await boot(true);
    const reloaded = await state();
    for (const key of ['gold', 'inventory', 'level', 'autoBattle']) assert(reloaded[key] === row.progress[key], `Reload lost ${key}`);
    assert(reloaded.expedition.stats.glass_garden === 1 && reloaded.expedition.claimed.includes('garden_scout'), 'Reload lost receipt');
    await shortTouch('#citadel-dungeon-journey');
    assert(await page.locator('[data-journey-node="glass_garden"]').getAttribute('data-state') === 'cleared', 'Map lost completed marker');
    assert(await page.locator('[data-journey-node="ember_vault"]').getAttribute('aria-current') === 'step', 'Map lost next target');
    await screenshot('restored-dungeon-journey');
  });
  await step('Next region actual admission and owned cleanup', async row => {
    await shortTouch('#journey-prepare'); await shortTouch(`${modal} .citadel-hub-go`);
    await page.waitForFunction(() => app.battle.active && !app.stageStarting && !document.querySelector('.exp-cinematic'), null, { timeout: 180000 });
    row.entered = await state();
    assert(row.entered.pending?.target === 'ember_vault' && row.entered.energy === row.before.energy - 4, 'Next region admission mismatch');
    await clockProgress(); await screenshot('next-region-real-battle');
    await shortTouch('#btn-pause'); await shortTouch('#btn-giveup');
    await page.locator('.exp-result-shell').waitFor();
    assert((await state()).pending === null, 'Cleanup kept admission');
    await shortTouch('.exp-result-shell .exp-close');
  });
}
