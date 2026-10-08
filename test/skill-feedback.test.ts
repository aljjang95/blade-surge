import { expect, test } from 'bun:test';
import { HEROES } from '../src/data/heroes.js';
import { Player } from '../src/game/player.js';
import { skillMpCost } from '../src/game/progression.js';
import { skillFeedback } from '../src/ui/skill-feedback.js';

// 렌더링을 생략한 컴포넌트 검증. 실제 Player의 슬롯·해금 조회만 사용한다.
function fixture(def: (typeof HEROES)[keyof typeof HEROES] = HEROES.knight, loadout = [4, 5]) {
  const player: any = Object.assign(Object.create(Player.prototype), {
    def, skillLoadout: loadout, heroLevel: 50, alive: true, auto: false,
    cds: def.skills.map(() => 0), mp: 100, ult: 100, ultMax: 100, state: 'idle',
  });
  const battle = { player, active: true, paused: false, input: { enabled: true } };
  return { player, battle };
}

for (const hero of Object.values(HEROES)) test(`${hero.id}: 장착 6슬롯의 실제 MP·충전·재사용 경계를 표시한다`, () => {
  const { player, battle } = fixture(hero);
  for (let slot = 0; slot < 6; slot++) {
    const { index, skill } = player.combatSkill(slot);
    expect(skillFeedback(battle, slot)).toMatchObject({ status: 'ready', ready: true, label: '' });
    if (skill.ult) {
      player.ult = 99.99;
      expect(skillFeedback(battle, slot)).toMatchObject({ status: 'charge', label: '99%', ready: false });
      player.ult = 100; player.mp = 0;
      expect(skillFeedback(battle, slot).ready).toBe(true);
    } else {
      player.cds[index] = .001;
      expect(skillFeedback(battle, slot)).toMatchObject({ status: 'cooldown', label: '0.1', ready: false });
      player.cds[index] = 1.01;
      expect(skillFeedback(battle, slot).label).toBe('1.1');
      player.cds[index] = 12.01;
      expect(skillFeedback(battle, slot).label).toBe('13');
      player.cds[index] = 0;
      const cost = skillMpCost(skill);
      player.mp = cost;
      expect(skillFeedback(battle, slot).ready).toBe(true);
      if (cost > 0) {
        player.mp = cost - .01;
        expect(skillFeedback(battle, slot)).toMatchObject({ status: 'mana', label: 'MP 부족', ready: false, progress: 0 });
        expect(skillFeedback(battle, slot).detail).toContain(`MP ${cost} 필요`);
      }
    }
    player.mp = 100;
  }
});

test('각성 슬롯 교체와 해금 변화는 실제 Player 인덱스를 따르고 이전 준비를 남기지 않는다', () => {
  const { player, battle } = fixture();
  for (const index of HEROES.knight.skills.map((_, index) => index).slice(4)) {
    player.skillLoadout = [index, index === 4 ? 5 : 4];
    const skill = player.combatSkill(4).skill;
    player.heroLevel = skill.unlock - 1;
    expect(skillFeedback(battle, 4)).toMatchObject({ status: 'locked', locked: true, ready: false });
    expect(skillFeedback(battle, 4).detail).toBe(`Lv.${skill.unlock} 해금`);
    player.heroLevel = skill.unlock;
    expect(skillFeedback(battle, 4)).toMatchObject({ status: 'ready', ready: true, locked: false });
  }
});

test('일시정지·사망·입력 차단·전투 종료는 준비 강조를 중립화하고 AUTO는 자원만 설명한다', () => {
  const { player, battle } = fixture();
  player.auto = true;
  expect(skillFeedback(battle, 0).detail).toContain('자동 전투 · 자원 준비됨');
  expect(skillFeedback(battle, 0).detail).not.toContain('누르기');
  battle.paused = true;
  expect(skillFeedback(battle, 0)).toMatchObject({ status: 'neutral', label: '', ready: false });
  battle.paused = false; battle.input.enabled = false;
  expect(skillFeedback(battle, 0).ready).toBe(false);
  battle.input.enabled = true; player.alive = false;
  expect(skillFeedback(battle, 0).ready).toBe(false);
  player.alive = true; battle.active = false;
  expect(skillFeedback(battle, 0).ready).toBe(false);
});

test('표시는 자원·입력·스킬을 변경하지 않고 프레임마다 같은 결과 객체를 재사용한다', () => {
  const { player, battle } = fixture(HEROES.ranger);
  const before = JSON.stringify(player), catalog = JSON.stringify(HEROES);
  Object.freeze(player.cds); Object.freeze(player); Object.freeze(battle);
  const result: any = {};
  for (let slot = 0; slot < 6; slot++) expect(skillFeedback(battle, slot, result)).toBe(result);
  expect(JSON.stringify(player)).toBe(before); expect(JSON.stringify(HEROES)).toBe(catalog);
  expect(skillFeedback(undefined, 0).ready).toBe(false);
  expect(skillFeedback(battle, 99).ready).toBe(false);
});

test('불완전한 동기화 자원값을 준비 완료로 표시하지 않는다', () => {
  const { player, battle } = fixture();
  for (const value of [undefined, NaN, Infinity]) {
    player.cds[0] = value;
    expect(skillFeedback(battle, 0)).toMatchObject({ status: 'neutral', ready: false });
    player.ult = value;
    expect(skillFeedback(battle, 3)).toMatchObject({ status: 'neutral', ready: false });
  }
});
