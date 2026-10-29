// MMO P1-D: 서버 /cmd 허용 명령표. 클라이언트 명령 큐와 서버 규칙 엔진이 같은 표를 쓴다.
// 각 명령은 기존 Economy 메서드를 그대로 호출한다(규칙을 서버에 다시 쓰지 않는다).
// args는 위치 인자 배열이며 형식이 맞지 않으면 실행하지 않는다.

const str = (v, max = 40) => typeof v === 'string' && v.length > 0 && v.length <= max && /^[A-Za-z0-9_-]+$/.test(v);
const int = (v, min = 0, max = 1e9) => Number.isSafeInteger(v) && v >= min && v <= max;
const bool = (v) => typeof v === 'boolean';
const SLOT = (v) => ['weapon', 'armor', 'ring', 'boots'].includes(v);

/** 성공 판정: 기존 메서드 반환 형태가 제각각이라 명령별로 정한다. */
const okBool = (r) => r === true;
const okResult = (r) => !!r && r.ok === true;
const okValue = (r) => r !== null && r !== undefined && r !== false;

/**
 * @type {Record<string, { args: ((v: unknown) => boolean)[], optional?: number, run: (eco: any, ...args: any[]) => unknown, ok: (r: unknown) => boolean, random?: boolean, offline?: boolean }>}
 */
export const OPS = {
  // 성장 (난수 없음)
  levelUpHero: { args: [str], run: (e, h) => e.levelUpHero(h), ok: okBool },
  promoteHero: { args: [str], run: (e, h) => e.promoteHero(h), ok: okBool },
  transcend: { args: [str], run: (e, h) => e.transcend(h), ok: okResult },
  learnSkill: { args: [str, (v) => int(v, 0, 32)], run: (e, h, i) => e.learnSkill(h, i), ok: okResult },
  resetSkills: { args: [str, bool], run: (e, h, useGems) => e.resetSkills(h, { useGems }), ok: okResult },
  setSkillLoadout: { args: [str, (v) => int(v, 0, 1), (v) => int(v, 0, 32)], run: (e, h, slot, i) => e.setSkillLoadout(h, slot, i), ok: okBool, offline: true },
  // 소유 정책(수익화 1단계): 시작 영웅 선택과 무료 해금. 서버 규칙 엔진이 같은 Economy 메서드를 부른다(유료 권한은 결제 검증만 연다).
  chooseStarter: { args: [str], run: (e, h) => e.chooseStarter(h), ok: okResult },
  unlockHeroFree: { args: [str], run: (e, h) => e.unlockHeroFree(h), ok: okResult },
  selectHero: { args: [str], run: (e, h) => { if (!e.ownHero(h) || e.s.selected === h) return false; e.s.selected = h; e.emit(); return true; }, ok: okBool, offline: true },
  // 장비 (난수 없음)
  equip: { args: [str, (v) => int(v, 1)], run: (e, h, uid) => { if (!e.ownHero(h) || !e.s.inventory.some((x) => x.uid === uid)) return false; return e.equip(h, uid) !== false; }, ok: okBool, offline: true },
  unequip: { args: [str, SLOT], run: (e, h, slot) => { if (!e.ownHero(h)) return false; e.unequip(h, slot); return true; }, ok: okBool, offline: true },
  sellItem: { args: [(v) => int(v, 1)], run: (e, uid) => e.sellItem(uid), ok: okValue },
  salvage: { args: [(v) => Array.isArray(v) && v.length > 0 && v.length <= 200 && v.every((x) => int(x, 1))], run: (e, uids) => e.salvage(uids), ok: okResult },
  // 금고(docs/GEAR_OWNERSHIP_VAULT.md): 서버 시계로 하루 유료 꺼내기를 센다.
  vaultDeposit: { args: [(v) => int(v, 1)], run: (e, uid) => e.vaultDeposit(uid), ok: okResult },
  vaultWithdraw: { args: [(v) => int(v, 1), str], run: (e, uid, h) => e.vaultWithdraw(uid, h), ok: okResult },
  vaultRitual: { args: [(v) => int(v, 1), str], run: (e, uid, h) => e.vaultRitual(uid, h), ok: okResult },
  gearDexClaim: { args: [str, str], run: (e, h, m) => e.gearDexClaim(h, m), ok: okResult },
  claimJourneySigil: { args: [(v) => v === 'daily' || v === 'weekly', str], run: (e, kind, id) => e.claimJourneySigil(kind, id), ok: okResult },
  vaultExpand: { args: [], run: (e) => e.vaultExpand(), ok: okResult },
  // 클리어 루프(docs/CLEAR_LOOP.md): 카드는 정산 때 해시로 정해져 고르기만 한다. 수리는 닳은 만큼 골드.
  pickClearCard: { args: [(v) => int(v, 0, 2)], run: (e, i) => e.pickClearCard(i), ok: okResult },
  repairItem: { args: [(v) => int(v, 1)], run: (e, uid) => e.repairItem(uid), ok: okResult },
  craftSetItem: { args: [str, SLOT], run: (e, set, slot) => e.craftSetItem(set, slot), ok: okResult },
  // 장비 (서버 난수)
  // 네 번째 인자 sure(확정 강화, 골드 웃돈)는 선택이다: 이전 클라이언트의 3인자 명령도 그대로 받는다.
  enhance: { args: [(v) => int(v, 1), bool, bool, bool], optional: 1, run: (e, uid, protect, bless, sure = false) => e.enhance(uid, { protect, bless, sure }), ok: okResult, random: true },
  // 소환 (서버 난수·서버 시계 픽업). 배너 표는 src/data/gacha-banners.js 하나를 클라이언트·서버가 함께 읽는다.
  pull: { args: [(v) => v === 1 || v === 10, (v) => v === 'hero' || v === 'gear' || v === 'beginner'], run: (e, n, banner) => e.pull(n, banner), ok: okValue, random: true },
  pullSSR: { args: [], run: (e) => e.pullSSR(), ok: okValue, random: true },
  exchangeMileage: { args: [], run: (e) => e.exchangeMileage(), ok: okValue },
  // 일일·보상 수령 (서버 시계)
  claimDaily: { args: [], run: (e) => e.claimDaily(), ok: okValue },
  claimMonthly: { args: [], run: (e) => e.claimMonthly(), ok: okBool },
  claimPass: { args: [(v) => int(v, 1, 1000), bool], run: (e, lv, prem) => e.claimPass(lv, prem), ok: okValue },
  claimMail: { args: [(v) => int(v, 0)], run: (e, id) => e.claimMail(id), ok: okValue },
  claimQuest: { args: [str], run: (e, id) => e.claimQuest(id), ok: okValue },
  // 외형·설정
  buyAvatar: { args: [str], run: (e, id) => e.buyAvatar(id), ok: okResult },
  equipAvatar: { args: [str, (v) => v === null || str(v)], run: (e, h, id) => e.equipAvatar(h, id), ok: okResult, offline: true },
  setDifficulty: { args: [str, (v) => int(v, 1, 99), (v) => int(v, 1, 99)], run: (e, id, ch, st) => e.setDifficulty(id, ch, st), ok: okValue, offline: true },
};

export const OP_NAMES = Object.freeze(Object.keys(OPS));

/** 명령 형식 검사. 통과하면 실행 가능한 명령 정의를 돌려준다. */
export function validateOp(op, args) {
  if (typeof op !== 'string' || !Object.hasOwn(OPS, op)) return null;
  const def = OPS[op];
  if (!Array.isArray(args) || args.length > def.args.length || args.length < def.args.length - (def.optional || 0)) return null;
  return args.every((value, i) => def.args[i](value)) ? def : null;
}
