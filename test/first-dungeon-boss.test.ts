import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Enemy, nextBossPattern } from '../src/game/enemies.js';
import { buildExpeditionStage, FIRST_DUNGEON_BOSS } from '../src/game/expedition-combat.js';
import { ALL_DUNGEONS } from '../src/data/expansion.js';

// 첫 던전 '유리 정원' 보스: AUTO 로 12~15초에 끝나던 것을 35~50초(AUTO·app.step 실측)로 늘리고 예고형 패턴 3종을 순서대로 쓴다.
const garden = () => buildExpeditionStage('dungeon', 'glass_garden', null);

test('유리 정원 보스는 체력·공격이 올라가고 카탈로그 정의는 그대로다', () => {
  const stage: any = garden(), def: any = ALL_DUNGEONS.find((d: any) => d.id === 'glass_garden');
  expect(stage.expeditionEnemy.hp).toBe(FIRST_DUNGEON_BOSS.hp);
  expect(stage.expeditionEnemy.hp).toBeGreaterThan(8500 * 3);
  expect(stage.expeditionEnemy.atk).toBe(FIRST_DUNGEON_BOSS.atk);
  expect(stage.expeditionEnemy.name).toBe('유리 정원 수호자');
  // 지문 테스트가 보호하는 카탈로그 항목은 건드리지 않는다(보스 사본만 조정).
  expect(def.bossHp).toBeUndefined(); expect(def.stage.encounter.pattern).toBeUndefined();
});

test('보스는 예고를 피해야 하는 서로 다른 패턴 3종을 정해진 순서로 돈다', () => {
  const stage: any = garden();
  const turns = Array.from({ length: 6 }, (_, turn) => nextBossPattern(stage.expeditionEnemy, turn, 0));
  expect(turns).toEqual(['slam', 'spin', 'fan', 'slam', 'spin', 'fan']);
  expect(new Set(turns).size).toBeGreaterThanOrEqual(2);
});

test('세 패턴 모두 공격 전에 바닥 예고(telegraph)를 먼저 그린다', () => {
  const stage: any = garden();
  for (const [turn, special] of [[0, 'slam'], [1, 'spin'], [2, 'fan']] as const) {
    const warned: string[] = [];
    const mark = (kind: string) => (...args: any[]) => { const options = args.find(a => a && typeof a === 'object' && 'telegraph' in a); if (options?.telegraph) warned.push(kind); };
    const enemy: any = Object.create(Enemy.prototype);
    Object.assign(enemy, {
      def: { ...stage.expeditionEnemy, boss: true, kit: undefined }, isBoss: true, isElite: false, atk: stage.expeditionEnemy.atk, phase: 0, patternTurn: turn,
      pos: new THREE.Vector3(0, 0, 0), vel: new THREE.Vector3(), yaw: 0, A: (key: string) => key, playTimed: () => {}, announceSkill: () => {},
      clearDashWarning: () => {}, enraged: false, atkCd: 0,
      game: { enemies: [], scene: new THREE.Scene(), player: { pos: new THREE.Vector3(0, 0, 3) }, fx: { ring: mark('ring'), slashArc: mark('arc'), flash: mark('flash') } },
    });
    Object.defineProperty(enemy, 'player', { value: enemy.game.player });
    enemy.startAttack(3);
    expect(enemy.special).toBe(special);
    expect(warned).toHaveLength(1);
    expect(enemy.telegraph).toBeGreaterThan(0.3);   // 예고 시간이 있어 반응할 수 있다
  }
});

test('심층·전술 공략 판은 기존 정의를 그대로 쓴다', () => {
  const deep: any = buildExpeditionStage('dungeon', 'glass_garden', null, { depth: 'deep' });
  expect(deep.expeditionEnemy.hp).not.toBe(FIRST_DUNGEON_BOSS.hp);
  const other: any = buildExpeditionStage('dungeon', 'ember_vault', null);
  expect(other.expeditionEnemy.hp).toBe(10500);
});
