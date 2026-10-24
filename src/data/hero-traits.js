// 영웅 비교 표시용 특성: 역할·한 줄 특징·소개·난이도, 그리고 영웅 base 스탯에서 계산하는 공격·생존·난이도 막대.
// 시작 영웅 선택과 영웅 탭 잠금 상세가 같은 계산을 쓴다. 막대 숫자는 UI에 흩지 않고 여기서만 정한다.
import { HEROES, HERO_ORDER } from './heroes.js';

/** 영웅별 역할·한 줄 특징·소개. 새 영웅이 데이터에 생기면 title 로 대신한다. */
export const HERO_TRAITS = Object.freeze({
  knight: { role: '근접 · 수호', line: '균형 잡힌 공격과 방어', intro: '성검과 방패를 든 계승자. 앞에서 버티며 안정적으로 전장을 이끕니다.' },
  barbarian: { role: '근접 · 광역', line: '단단한 몸으로 휘두르는 광역 공격', intro: '피의 도끼를 휘두르는 전사. 적진 한가운데서 전부 쓸어버립니다.' },
  mage: { role: '원거리 · 마법', line: '넓은 폭발로 전장을 지배', intro: '별의 지식을 다루는 고귀한 마도사. 광대한 마력으로 전장을 지배합니다.' },
  rogue: { role: '근접 · 치명', line: '빠른 단검으로 급소를 노림', intro: '그림자처럼 움직이는 암살자. 한 번의 급소 공격으로 승부를 가릅니다.' },
  ranger: { role: '원거리 · 기동', line: '거리를 두고 안전하게 사냥', intro: '바람을 따라 달리는 추적자. 멀리서 정확하게 적을 꿰뚫습니다.' },
});

/** 조작 난이도 1~3(별 개수). 스탯으로 계산되지 않는 값이라 데이터 상수 하나로만 둔다. */
export const HERO_DIFFICULTY = Object.freeze({ knight: 1, barbarian: 2, mage: 2, rogue: 3, ranger: 2 });
export const DIFFICULTY_MAX = 3;
/** 생존 막대에서 방어 1점이 체력 몇 점에 해당하는지. */
export const SURVIVAL_DEF_WEIGHT = 10;

/** 공격 원값: base.atk. 생존 원값: base.hp + base.def × 가중치. */
const attackRaw = (id) => HEROES[id].base.atk;
const survivalRaw = (id) => HEROES[id].base.hp + HEROES[id].base.def * SURVIVAL_DEF_WEIGHT;

/** 영웅 하나의 비교 정보. 공격·생존은 현재 영웅 5명 안의 최댓값을 1 로 정규화한다. 순수 함수. */
export function heroCompare(id, ids = HERO_ORDER.filter((hid) => HEROES[hid])) {
  const def = HEROES[id], trait = HERO_TRAITS[id];
  if (!def) return null;
  const maxOf = (fn) => Math.max(...ids.map(fn), 1);
  const difficulty = Math.min(DIFFICULTY_MAX, Math.max(1, HERO_DIFFICULTY[id] || 1));
  return {
    id, name: def.name, title: def.title, portrait: def.portrait || '', color: def.color,
    role: trait?.role || def.title, line: trait?.line || def.title, intro: trait?.intro || def.title,
    attack: attackRaw(id) / maxOf(attackRaw), survival: survivalRaw(id) / maxOf(survivalRaw),
    difficulty, difficultyBar: difficulty / DIFFICULTY_MAX,
  };
}
