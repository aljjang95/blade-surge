import { normalizeSave as normalizeBaseSave } from './save-base.js';
import { ENEMIES } from '../data/stages.js';
import { normalizeRpg } from './rpg-core.js';
import { normalizeMasterworks } from './masterworks-core.js';
import { normalizeJourney } from './journey-core.js';
import { normalizeArsenal } from './arsenal-core.js';
import { normalizeEndgame, migrateEndgame } from './endgame-core.js';
import { normalizeLegend } from './legend-rank.js';
import { normalizeRunes, normalizeBlessing, restoreSockets } from './rune-economy.js';
import { normalizeClearCard } from './clear-loop.js';

/** Additive migration: inventory, currency, campaign and hero records retain their existing validation. */
export function normalizeSave(raw, fresh) {
  const save = normalizeBaseSave(raw, fresh);
  save.rpg = normalizeRpg(raw.rpg, Object.keys(ENEMIES));
  save.masterworks = normalizeMasterworks(raw.masterworks);
  save.journey = normalizeJourney(raw.journey);
  save.arsenal = normalizeArsenal(raw.arsenal);
  // 엔드게임 도입 전 저장은 별점(스토리 클리어)과 최근 전투 기록의 난이도 승리를 최고 난이도 기록으로 이월한다.
  save.endgame = raw.endgame && typeof raw.endgame === 'object' ? normalizeEndgame(raw.endgame) : migrateEndgame(save);
  // 전설 수련(Lv.80 이후 EXP 축, docs/SPEC_720H.md 3.1). 계정 공통, 없는 저장은 기본값에서 시작한다.
  save.legend = normalizeLegend(raw.legend);
  // 룬·전운(2026-10-24). 룬 도입 전 세이브는 네 가문 I 룬 1개씩을 한 번 받는다(giftClaimed).
  save.runes = normalizeRunes(raw.runes);
  save.blessing = normalizeBlessing(raw.blessing);
  // save-base 는 인벤토리 인스턴스를 { uid, id, enh } 로 다시 만들어 sockets 를 버린다. 원본에서 다시 붙인다.
  restoreSockets(save, raw.inventory);
  // 클리어 카드(docs/CLEAR_LOOP.md): 마지막 승리의 카드 3장과 고른 칸. 없으면 필드를 두지 않는다(이전 저장은 그대로).
  delete save.clearCard;
  const clearCard = normalizeClearCard(raw.clearCard);
  if (clearCard) save.clearCard = clearCard;
  return save;
}
