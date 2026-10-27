// 고통 단계 장비 표시(순수): 접두 '고대'·'태고'(item-tier.js)와 드랍 단계 표기. 장비 인스턴스 tp(1~50)가 없으면 아무것도 붙이지 않는다.
import { itemTierPrefix } from '../data/item-tier.js';

const validTp = (inst) => (Number.isSafeInteger(inst?.tp) && inst.tp > 0 ? inst.tp : 0);
/** 장비 이름 앞에 접두를 붙인 표시 이름. */
export const tierName = (name, inst) => { const prefix = itemTierPrefix(validTp(inst) || undefined); return prefix ? `${prefix} ${name}` : name; };
/** 단계 표기 'T12'(없으면 ''). */
export const tierTag = (inst) => { const tp = validTp(inst); return tp ? `T${tp}` : ''; };
/** 색 구분용 톤: taego(25+) · godae(10+) · tp(그 밑 고통 단계 장비) · ''(일반). */
export const tierTone = (inst) => { const tp = validTp(inst); return !tp ? '' : tp >= 25 ? 'taego' : tp >= 10 ? 'godae' : 'tp'; };
/** 접근성·툴팁용 한 줄 설명. */
export const tierNote = (inst) => { const tp = validTp(inst); return tp ? `고통 ${tp}단계 장비${itemTierPrefix(tp) ? ` · ${itemTierPrefix(tp)}` : ''}` : ''; };
