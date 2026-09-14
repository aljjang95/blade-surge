import { test, expect } from 'bun:test';
import { captureVictory, captureCrowd } from '../tools/release-qa-capture.mjs';
function fixture({ win = true, active = false, timeout = false, change = false, near = 5 } = {}) {
  const calls: string[] = []; let visible = false;
  const app: any = { testPause: true, battle: { result: { win }, active, player: { pos: { x: 0, z: 0 } }, enemies: Array.from({ length: near }, () => ({ alive: true, pos: { x: 1, z: 1 } })) },
    renderer: { render: () => calls.push('render') }, step: (dt: number, render: boolean) => { expect(dt).toBe(1 / 60); expect(render).toBe(true); calls.push('step-render'); } };
  const page: any = {
    evaluate(fn: () => unknown) {
      const g: any = globalThis, oldWindow = g.window, oldDocument = g.document;
      g.window = { app }; g.document = { querySelector: () => visible ? { textContent: 'VICTORY 보상 다음 층' } : null };
      try { return fn(); } finally { g.window = oldWindow; g.document = oldDocument; }
    },
    locator(selector: string) { expect(selector).toBe('#result.show'); return { async waitFor(options: any) {
      expect(app.testPause).toBe(false); expect(options).toEqual({ state: 'visible', timeout: 15000 }); calls.push('wait-visible');
      if (timeout) throw Error('result timeout'); visible = true; if (change) app.battle.result.win = false;
    } }; },
    async screenshot() { calls.push('screenshot'); },
  };
  return { app, page, calls };
}
test('victory capture resumes actual timers, waits for real panel, renders then captures', async () => {
  const f = fixture(); const result = await captureVictory(f.page, 'fixture.png');
  expect(result.resultVisible).toBe(true); expect(f.calls).toEqual(['wait-visible', 'render', 'screenshot']);
});
test('no win or active battle is never promoted to a result screenshot', async () => {
  for (const options of [{ win: false }, { active: true }]) { const f = fixture(options); await expect(captureVictory(f.page, 'fixture.png')).rejects.toThrow(); expect(f.app.testPause).toBe(true); expect(f.calls).toEqual([]); }
});
test('result timeout preserves failure instead of capturing an old frame', async () => {
  const f = fixture({ timeout: true }); await expect(captureVictory(f.page, 'fixture.png')).rejects.toThrow('result timeout'); expect(f.calls).toEqual(['wait-visible']);
});
test('state changed while waiting is rejected before rendering or screenshot', async () => {
  const f = fixture({ change: true }); await expect(captureVictory(f.page, 'fixture.png')).rejects.toThrow(); expect(f.calls).toEqual(['wait-visible']);
});
test('distant or insufficient crowd does not produce a misleading crowd screenshot', async () => {
  const f = fixture({ near: 4 }); const result = await captureCrowd(f.page, 'fixture.png'); expect(result).toEqual({ near: 4, captured: false }); expect(f.calls).toEqual(['step-render']);
});
test('crowd is counted after a real rendered step before capture', async () => {
  const f = fixture(); const result = await captureCrowd(f.page, 'fixture.png'); expect(result).toEqual({ near: 5, captured: true }); expect(f.calls).toEqual(['step-render', 'screenshot']);
});
