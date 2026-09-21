import { levelExp, levelGold } from '../data/heroes.js';

// 사냥으로 절반 이상 채운 레벨을 마무리한다. 골드만으로 연속 레벨업할 수 없다.
export function heroTrainingQuote(hero, gold) {
  if (!hero || !Number.isInteger(hero.level) || hero.level < 1 || hero.level > 80
    || !Number.isSafeInteger(hero.exp) || hero.exp < 0) return { ok: false, reason: 'invalid' };
  if (hero.level === 80) return { ok: false, reason: 'cap', level: 80, cost: 0 };
  const need = levelExp(hero.level), requiredExp = Math.ceil(need / 2);
  if (hero.exp >= need) return { ok: false, reason: 'invalid' };
  const remainingExp = need - hero.exp;
  const cost = Math.max(1, Math.ceil(levelGold(hero.level) * remainingExp / need));
  const reason = hero.exp < requiredExp ? 'hunt' : !Number.isSafeInteger(gold) || gold < cost ? 'gold' : null;
  return { ok: !reason, reason, level: hero.level, nextLevel: hero.level + 1,
    exp: hero.exp, need, requiredExp, remainingExp, cost };
}
