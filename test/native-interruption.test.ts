import { expect, test } from 'bun:test';
import { setupNativeApp } from '../src/platform/native-app.js';

function fixture() {
  const callbacks: Record<string, Function> = {}, reasons = new Set(['manual']);
  let saves = 0;
  const app: any = { battle: { active: true, pauseReasons: reasons,
    setPaused: (r: string, on: boolean) => on ? reasons.add(r) : reasons.delete(r) },
    input: { clear() {} }, eco: { save() { saves++; return true; } } };
  const App = { addListener: async (name: string, fn: Function) => {
    callbacks[name] = fn; return { remove: async () => {} };
  }, getState: async () => ({ isActive: true }) };
  return { app, App, callbacks, reasons, saves: () => saves };
}

test('늦게 도착한 초기 활성 상태는 더 최신의 백그라운드 전환을 되돌리지 않는다', async () => {
  const f = fixture(); let finish!: (state: { isActive: boolean }) => void;
  let requested!: () => void;
  const started = new Promise<void>(resolve => { requested = resolve; });
  f.App.getState = () => { requested(); return new Promise(resolve => { finish = resolve; }); };
  const api = setupNativeApp(f.app, { native: true, loadPlugin: async () => ({ App: f.App }) });
  await started; api.setActive(false); finish({ isActive: true }); await api.ready;
  try { expect(f.reasons.has('native-background')).toBe(true); expect(f.reasons.has('manual')).toBe(true); }
  finally { await api.dispose(); }
});

test('동일한 백그라운드 이벤트는 진행 저장을 중복 실행하지 않는다', async () => {
  const f = fixture(), api = setupNativeApp(f.app, { native: true, loadPlugin: async () => ({ App: f.App }) });
  await api.ready; api.setActive(false); api.setActive(false); f.callbacks.appStateChange({ isActive: false });
  try { expect(f.saves()).toBe(1); } finally { await api.dispose(); }
});

test('Android onPause는 전투를 멈추고 onResume는 수동 일시정지를 보존한다', async () => {
  const f = fixture(), api = setupNativeApp(f.app, { native: true, loadPlugin: async () => ({ App: f.App }) });
  await api.ready;
  try {
    expect(typeof f.callbacks.pause).toBe('function');
    f.callbacks.pause(); expect(f.reasons.has('native-background')).toBe(true);
    f.callbacks.resume(); expect([...f.reasons]).toEqual(['manual']);
  } finally { await api.dispose(); }
});

test('네이티브 활성화와 문서 표시가 모두 회복되어야 전투가 재개된다', async () => {
  const f = fixture(), api = setupNativeApp(f.app, { native: true, loadPlugin: async () => ({ App: f.App }) });
  await api.ready;
  try {
    api.setVisible(false); api.setActive(false); api.setVisible(true);
    expect(f.reasons.has('native-background')).toBe(true);
    api.setActive(true); expect([...f.reasons]).toEqual(['manual']);
    api.setVisible(false); api.setActive(true);
    expect(f.reasons.has('native-background')).toBe(true);
    expect(f.saves()).toBe(2);
    api.setVisible(true); expect([...f.reasons]).toEqual(['manual']);
  } finally { await api.dispose(); }
});

test('문서 표시 이벤트는 네이티브 초기 비활성 응답을 무효화하지 않는다', async () => {
  const f = fixture(); let finish!: (state: { isActive: boolean }) => void;
  let requested!: () => void;
  const started = new Promise<void>(resolve => { requested = resolve; });
  f.App.getState = () => { requested(); return new Promise(resolve => { finish = resolve; }); };
  const api = setupNativeApp(f.app, { native: true, loadPlugin: async () => ({ App: f.App }) });
  await started; api.setVisible(false); api.setVisible(true); finish({ isActive: false }); await api.ready;
  try { expect(f.reasons.has('native-background')).toBe(true); }
  finally { await api.dispose(); }
});

test('리스너 등록 중 발생한 onPause도 초기 활성 응답보다 우선한다', async () => {
  const f = fixture(), original = f.App.addListener;
  f.App.addListener = async (name: string, fn: Function) => {
    const handle = await original(name, fn); if (name === 'pause') fn(); return handle;
  };
  const api = setupNativeApp(f.app, { native: true, loadPlugin: async () => ({ App: f.App }) });
  await api.ready;
  try { expect(f.reasons.has('native-background')).toBe(true); expect(f.saves()).toBe(1); }
  finally { await api.dispose(); }
});
