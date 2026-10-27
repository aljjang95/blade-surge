import { expect, test } from 'bun:test';
import { Economy } from '../src/game/economy.js';
import { createMemoryStorage } from '../src/game/economy-core.js';
import { RESTART_PHRASE, RESTART_STORAGE_KEYS, buildSaveExport, clearRestartKeys, phraseMatches } from '../src/ui/restart-progress.js';

const seed = (storage: any) => { const eco: any = new Economy({ storage }); eco.s.gold = 9e9; eco.s.progress.unlocked = 40; eco.s.adsRemoved = true; eco.s.iapApplied = ['op-1']; eco.s.spentKRW = 4900; eco.save(); eco.save(); return eco; };

test('확인 문구는 공백만 무시하고 정확히 일치해야 한다', () => {
  expect(phraseMatches(RESTART_PHRASE)).toBe(true); expect(phraseMatches(' 처음 부터 ')).toBe(true);
  expect(phraseMatches('처음')).toBe(false); expect(phraseMatches('')).toBe(false); expect(phraseMatches(undefined)).toBe(false);
});

test('내보내기 코드는 한국어 이름까지 왕복되고 현재 저장을 담는다', () => {
  const out = buildSaveExport({ name: '보스', gold: 5 }, Date.UTC(2026, 9, 28));
  expect(out.fileName).toBe('bladesurge-save-2026-10-28.json');
  const back = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(out.code), c => c.charCodeAt(0))));
  expect(back.save).toEqual({ name: '보스', gold: 5 }); expect(back.game).toBe('blade-surge');
});

test('처음부터 다시 시작: 저장·백업·복구본과 진행 보조 키를 지우고 시작 영웅 선택 상태로 돌아간다', () => {
  const storage: any = createMemoryStorage(); const eco = seed(storage);
  storage.setItem('bladesurge_save_v1_recovery', '{"old":1}');
  for (const key of RESTART_STORAGE_KEYS) storage.setItem(key, storage.getItem(key) ?? 'x');
  storage.setItem('bladesurge_install_id', 'keep-me'); storage.setItem('bladesurge_web_pay_pending_v1', '[1]'); storage.setItem('bladesurge.ui.windows.v1', '{}');
  expect(clearRestartKeys(storage)).toBe(true);
  expect(eco.reset({ keepEntitlements: true })).toBe(true);
  expect(storage.getItem('bladesurge_save_v1_recovery')).toBeNull();
  for (const key of RESTART_STORAGE_KEYS.filter(k => !k.startsWith('bladesurge_save_v1'))) expect(storage.getItem(key)).toBeNull();
  expect(storage.getItem('bladesurge_install_id')).toBe('keep-me'); expect(storage.getItem('bladesurge_web_pay_pending_v1')).toBe('[1]'); expect(storage.getItem('bladesurge.ui.windows.v1')).toBe('{}');
  // 새로 읽어도 옛 진행이 되살아나지 않고, 결제 권한만 남는다.
  const reloaded: any = new Economy({ storage });
  expect(reloaded.s.gold).toBe(12000); expect(reloaded.s.progress.unlocked).toBe(1); expect(reloaded.s.roster.starterChosen).toBe(false);
  expect(reloaded.s.adsRemoved).toBe(true); expect(reloaded.s.iapApplied).toEqual(['op-1']); expect(reloaded.s.spentKRW).toBe(4900);
});

test('권한 보존 없이 reset 하면 기존처럼 모두 비운다', () => {
  const storage: any = createMemoryStorage(); const eco = seed(storage);
  expect(eco.reset()).toBe(true);
  const reloaded: any = new Economy({ storage });
  expect(reloaded.s.adsRemoved).toBe(false); expect(reloaded.s.gold).toBe(12000);
});
