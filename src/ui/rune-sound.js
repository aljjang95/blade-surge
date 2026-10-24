/**
 * 룬 효과음(rune_insert·rune_merge). 파일이 아직 없으면(PR #254 머지 전) 조용히 기존 UI 음으로 대신한다.
 * 불러오기는 룬 화면을 처음 열 때 한 번만 시도한다(없는 파일을 매번 다시 요청하지 않는다).
 */
import { audio } from '../engine/audio.js';
import { RUNE_SOUNDS } from '../engine/combat-sound-library.js';

let warmed = false;
export function warmRuneSounds() {
  if (warmed || !audio.ctx) return;
  warmed = true;
  for (const name of Object.values(RUNE_SOUNDS)) audio._loadSfx(name, 4000);
}
/** @param {'insert'|'merge'} kind */
export function playRuneSound(kind) {
  warmRuneSounds();
  const name = RUNE_SOUNDS[kind];
  if (name && audio.buffers?.[name]) { audio.play(name, { vol: 0.8, vary: 0, min: 0.15, priority: 4 }); return true; }
  audio.play(kind === 'merge' ? 'ui_glass' : 'ui_confirm', { vol: 0.5 });
  return false;
}
