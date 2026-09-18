// 필드 자동 장착 — 드랍을 집는 순간 장비가 몸에 붙는다.
// PRD §1 도파민 리듬의 '세트 한 칸 채움(진전)' 박자는 층 안에서 일어나야 한다. 이전에는 드랍이 가방으로만 들어가
// 로비를 다녀와야 세트가 켜질 수 있었고, 첫 플레이어(장비 없음)는 1층에서 이 박자를 한 번도 보지 못했다.
//  · 기본(empty): 빈 슬롯만 채운다 — 플레이어가 고른 장비는 건드리지 않는다 (_autopipe/progression.md 의 선택권 보존)
//  · better: 전투력이 오르면 교체한다 (세트 해제까지 포함해 previewItem 이 계산한 최종 전투력으로 비교)
//  · off: 끈다
import { HEROES, heroStats } from '../data/heroes.js';
import { ITEM_BY_ID, SETS, SLOT_NAME } from '../data/items.js';

export const AUTO_EQUIP_MODES = ['empty', 'better', 'off'];
export const AUTO_EQUIP_LABEL = { empty: '빈 슬롯만', better: '더 강하면 교체', off: '끄기' };
export const AUTO_EQUIP_DESC = {
  empty: '집은 장비가 빈 부위면 바로 장착합니다. 이미 고른 장비는 바꾸지 않습니다.',
  better: '집은 장비로 전투력이 오르면 그 자리에서 교체합니다. 세트가 풀려 전투력이 내려가면 바꾸지 않습니다.',
  off: '드랍은 가방에만 들어가고, 장착은 로비에서 직접 합니다.',
};
export const normalizeAutoEquip = (v) => AUTO_EQUIP_MODES.includes(v) ? v : 'empty';

const STAT_NAME = { atk: '공격력', hp: 'HP', crit: '치명타', critDmg: '치명 피해', ultGain: '궁극기 수급' };
/** 세트 단계 효과를 한 줄로 — 테마 세트는 text, 스탯 세트는 수치 나열 */
export function setTierText(set, tier) {
  const o = tier >= 4 ? set.four : set.two; if (!o) return '';
  if (o.text) return o.text;
  return Object.entries(o).filter(([k, v]) => typeof v === 'number' && STAT_NAME[k]).map(([k, v]) => `${STAT_NAME[k]} +${Math.round(v * 100)}%`).join(' · ');
}

/** 장착 여부 결정. 세이브를 바꾸지 않는다. */
export function decideFieldEquip(eco, heroId, uid, mode = eco.s.settings?.autoEquip) {
  mode = normalizeAutoEquip(mode);
  if (mode === 'off') return { equip: false, reason: 'off' };
  const preview = eco.previewItem(heroId, uid);
  if (!preview || preview.remove) return { equip: false, reason: 'invalid' };
  // 다른 영웅이 쓰고 있는 장비를 필드에서 빼앗아 오지 않는다
  if (preview.owner && preview.owner !== heroId) return { equip: false, reason: 'owned', preview };
  if (!preview.current) return { equip: true, reason: 'empty', preview };
  if (mode === 'better' && preview.after.power > preview.before.power) return { equip: true, reason: 'better', preview };
  return { equip: false, reason: mode === 'better' ? 'weaker' : 'occupied', preview };
}

/** 세트별 (장착 수, 켜진 단계) 스냅샷 — 장착 전후 비교용 */
export function setSnapshot(bonus) {
  const out = {};
  for (const sid in bonus.sets) out[sid] = { n: bonus.sets[sid], tier: bonus.active.find((a) => a.set.id === sid)?.tier || 0 };
  return out;
}

/**
 * 전투 중 실제 장착. 스탯·외형·세트 상태를 즉시 갱신하고 무엇이 바뀌었는지 돌려준다.
 * @param battle  Battle (player, heroId, app.eco)
 * @param inst    { uid, id, enh }  — 방금 집은 인벤토리 인스턴스
 */
export function applyFieldEquip(battle, inst) {
  const eco = battle.app?.eco, p = battle.player, heroId = battle.heroId;
  if (!eco || !p || !heroId || !inst || battle.stage?.party) return null;
  const decision = decideFieldEquip(eco, heroId, inst.uid);
  if (!decision.equip) return { ...decision, equipped: false };
  const def = ITEM_BY_ID[inst.id]; if (!def) return { equip: false, reason: 'invalid', equipped: false };
  const before = setSnapshot(eco.heroEquipBonus(heroId));
  const replaced = decision.preview.current;
  eco.equip(heroId, inst.uid);
  const bonus = battle.refreshHeroLoadout ? battle.refreshHeroLoadout() : eco.heroEquipBonus(heroId);
  const after = setSnapshot(bonus);
  // 이 장비가 속한 세트의 진행 — 팝업 한 줄 ("신병 세트 2/4")
  const set = def.set ? SETS[def.set] : null;
  const progress = set ? { set, n: after[set.id]?.n || 0, tier: after[set.id]?.tier || 0 } : null;
  // 방금 새로 켜진 세트 단계 (2 → 4 도 포함). 진전 박자의 실제 발화 지점
  const activated = Object.keys(after).filter((sid) => SETS[sid] && (after[sid].tier || 0) > (before[sid]?.tier || 0)).map((sid) => ({ set: SETS[sid], tier: after[sid].tier, n: after[sid].n, text: setTierText(SETS[sid], after[sid].tier) }));
  return { ...decision, equipped: true, def, slot: def.slot, slotName: SLOT_NAME[def.slot], replaced, progress, activated, power: decision.preview.after.power };
}

/** 현재 장착 기준으로 전투 중 영웅 스탯을 다시 계산한다 (레벨업 경로와 같은 규칙 — 잃은 체력은 보존, 부활·쿨타임 초기화 없음) */
export function recomputeHeroStats(battle) {
  const p = battle.player, eco = battle.app?.eco, heroId = battle.heroId;
  if (!p || !eco || !heroId) return null;
  const hero = eco.hero(heroId), bonus = eco.heroEquipBonus(heroId);
  const next = heroStats(p.def || HEROES[heroId], hero, bonus);
  const oldMax = p.maxHp;
  p.stats = battle.upgradeHeroStats?.(next) || next;
  p.maxHp = p.stats.hp;
  if (p.alive) p.hp = Math.min(p.maxHp, p.hp + Math.max(0, p.maxHp - oldMax));
  return bonus;
}
