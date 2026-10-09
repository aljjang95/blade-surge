import { expect, test } from 'bun:test';
import { requestLandscapeScreen } from '../src/platform/landscape-screen.js';

test('전체화면 호출은 터치 스택에서 동기 실행되고 가로 잠금은 승인 뒤 실행한다', async () => {
  const calls: string[] = [];
  let accept: () => void = () => {};
  const doc: any = { fullscreenEnabled: true, documentElement: {
    requestFullscreen: () => { calls.push('fullscreen'); return new Promise<void>(resolve => { accept = resolve; }); },
  } };
  const view: any = { screen: { orientation: { lock: async (mode: string) => { calls.push(mode); } } } };
  const request = requestLandscapeScreen(view, doc);
  expect(calls).toEqual(['fullscreen']);
  accept();
  expect(await request).toEqual({ fullscreen: 'active', orientation: 'locked' });
  expect(calls).toEqual(['fullscreen', 'landscape']);
});

test('전체화면 거절은 방향 잠금을 호출하지 않고 시작 가능한 결과로 반환한다', async () => {
  let locks = 0;
  const view: any = { screen: { orientation: { lock: () => { locks++; } } } };
  const doc: any = { fullscreenEnabled: true, documentElement: { requestFullscreen: () => Promise.reject(Error('denied')) } };
  expect(await requestLandscapeScreen(view, doc)).toEqual({ fullscreen: 'unavailable', orientation: 'unsupported' });
  expect(locks).toBe(0);
});

test('방향 잠금 미지원과 Safari 형태의 API 부재가 전체화면·게임 시작을 실패시키지 않는다', async () => {
  const doc: any = { fullscreenEnabled: true, documentElement: { requestFullscreen: () => Promise.resolve() } };
  const view: any = { screen: { orientation: { lock: () => Promise.reject(Error('unsupported')) } } };
  expect(await requestLandscapeScreen(view, doc)).toEqual({ fullscreen: 'active', orientation: 'unavailable' });
  expect(await requestLandscapeScreen({} as any, { documentElement: {} } as any)).toEqual({ fullscreen: 'unsupported', orientation: 'unsupported' });
});

test('이미 전체화면인 새로고침은 전체화면 토글 없이 가로 잠금만 시도한다', async () => {
  const modes: string[] = [];
  const view: any = { screen: { orientation: { lock: async (mode: string) => { modes.push(mode); } } } };
  const doc: any = { fullscreenElement: {}, documentElement: { requestFullscreen: () => { throw Error('must not toggle'); } } };
  expect(await requestLandscapeScreen(view, doc)).toEqual({ fullscreen: 'active', orientation: 'locked' });
  expect(modes).toEqual(['landscape']);
});
