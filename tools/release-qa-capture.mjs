// 런타임 검증용 어댑터. 결과를 만들지 않고 실제 지연 결과 화면을 기다린다.
export async function captureVictory(page, file) {
  await page.evaluate(() => {
    const a = window.app;
    if (!a?.battle?.result?.win || a.battle.active) throw new Error('실제 승리 판정 전에는 결과를 캡처할 수 없습니다.');
    a.testPause = false;
  });
  await page.locator('#result.show').waitFor({ state: 'visible', timeout: 15000 });
  const state = await page.evaluate(() => {
    const a = window.app, panel = document.querySelector('#result.show');
    if (!a.battle.result?.win || a.battle.active || !panel) throw new Error('결과 화면 상태가 바뀌었습니다.');
    a.renderer.render();
    return { won: true, resultVisible: true, text: panel.textContent.slice(0, 500) };
  });
  await page.screenshot({ path: file });
  return state;
}

export async function captureCrowd(page, file) {
  const state = await page.evaluate(() => {
    const a = window.app, b = a.battle;
    a.step(1 / 60, true);
    return { near: b.enemies.filter(e => e.alive && Math.hypot(e.pos.x - b.player.pos.x, e.pos.z - b.player.pos.z) < 5).length };
  });
  if (state.near < 5) return { ...state, captured: false };
  await page.screenshot({ path: file });
  return { ...state, captured: true };
}
