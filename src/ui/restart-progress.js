// 설정 > 위험 구역 '처음부터 다시 시작'의 순수 로직: 내보내기 코드, 지울 저장 키, 확인 문구.
// 서비스워커 캐시·결제 대기·소셜 게스트 신원(install id·기기 키)·화면 설정은 건드리지 않는다.
import { SAVE_STORAGE_KEY } from '../game/economy.js';

export const RESTART_PHRASE = '처음부터';

/** 진행 상태에 속하는 저장 키. 복구 경로(_backup·_recovery)를 포함해 옛 저장이 되살아나지 않게 한다. */
export const RESTART_STORAGE_KEYS = Object.freeze([
  SAVE_STORAGE_KEY, SAVE_STORAGE_KEY + '_backup', SAVE_STORAGE_KEY + '_recovery',
  'bladesurge_funnel_v1',
  'blade-surge.starter-village.v1', 'blade-surge.town-content.seen.v1', 'blade-surge.stage-select.v1', 'blade-surge.tutorial-toggle-opened',
]);

export const phraseMatches = (input) => String(input ?? '').replace(/\s+/g, '') === RESTART_PHRASE;

const toBase64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

/** 현재 저장을 파일·복사용 코드로 만든다. 서버 비밀은 저장에 없다. */
export function buildSaveExport(state, now = Date.now()) {
  const json = JSON.stringify({ game: 'blade-surge', kind: 'save-export', version: 1, exportedAt: new Date(now).toISOString(), save: state }, null, 1);
  return { json, code: toBase64(json), fileName: `bladesurge-save-${new Date(now).toISOString().slice(0, 10)}.json` };
}

/** 키를 하나씩 지운다. 하나라도 지우지 못하면 false. */
export function clearRestartKeys(storage) {
  let ok = true;
  for (const key of RESTART_STORAGE_KEYS) { try { storage.removeItem(key); } catch { ok = false; } }
  return ok;
}
