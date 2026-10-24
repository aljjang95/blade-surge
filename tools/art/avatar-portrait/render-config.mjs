// 아바타 상점 초상 규격(render.mjs 와 test/avatars.test.ts 가 함께 쓴다). 512×512 webp, public/img/tll/avatars/<id>-v<rev>.webp.
// 아바타 id → 배경(PC_BRIEF.md C절 표). 할로윈 5종은 몸이 들어오면 같은 명령으로 굽는다.
export const PORTRAIT_BACKGROUNDS = Object.freeze({
  avatar_knight_sakura: 'bg_knight_sakura.png',
  avatar_barbarian_oni: 'bg_barbarian_oni.png',
  avatar_mage_astral: 'bg_mage_astral.png',
  avatar_rogue_crow: 'bg_rogue_crow.png',
  avatar_ranger_fox: 'bg_ranger_fox.png',
  avatar_knight_pumpkin: 'bg_knight_pumpkin.png',
  avatar_mage_pumpkin: 'bg_mage_pumpkin.png',
  avatar_rogue_vampire: 'bg_rogue_vampire.png',
  avatar_ranger_blackcat: 'bg_ranger_blackcat.png',
  avatar_barbarian_werewolf: 'bg_barbarian_werewolf.png',
});
export const PORTRAIT_REVISION = 'v1';
export const portraitPath = (id) => `/img/tll/avatars/${id}-${PORTRAIT_REVISION}.webp`;
