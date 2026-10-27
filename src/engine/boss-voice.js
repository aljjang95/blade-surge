import { bossLore } from '../data/lore.js';

// 챕터 보스(X-5 중간·X-10 최종)는 등장 외침이 보스마다 따로 있다(boss_c<장>_<mid|fin>_appear, tools/voice/voice-plan.mjs).
// 그 밖의 보스는 기존 규칙 `${bossKey}_appear` 를 그대로 쓴다. 2페이즈·광폭화·사망 대사는 bossKey 공용 파일.
export function bossAppearVoiceName(stage, bossKey) {
  if (bossLore(stage)) return `boss_c${stage.ch}_${stage.encounter.rank === 'midboss' ? 'mid' : 'fin'}_appear`;
  return `${bossKey}_appear`;
}
