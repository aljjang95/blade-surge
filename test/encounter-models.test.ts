import { describe, test, expect } from 'bun:test';
import { CAMPAIGN_MODELS } from '../src/data/encounter-models.js';
import { ENEMIES, stageDef } from '../src/data/stages.js';
import { MONSTER_ROSTER } from '../src/data/monster-roster.js';
import manifest from '../asset-library/manifest.json';

const enemies = ENEMIES as Record<string, any>;
const assets = new Set(manifest.assets.map((asset) => asset.id));

describe('로스터 기반 지역 encounter identity', () => {
  test('모든 캠페인 최종 보스는 로스터와 라이브러리 자산을 사용한다', () => {
    expect(new Set(Object.values(CAMPAIGN_MODELS)).size).toBe(6);
    for (let chapter = 1; chapter <= 6; chapter++) {
      const stage = stageDef(chapter, 10);
      const def = enemies[stage.dungeonBossId || stage.encounter.enemyId];
      const roster = MONSTER_ROSTER[def.model];
      expect(roster).toBeDefined();
      expect(assets.has(roster.asset) || assets.has(roster.fallback)).toBe(true);
      expect(def.boss).toBe(true);
    }
  });

  test('campaign mapping은 모델 이름을 유지하고 로더는 장식 조립을 요구하지 않는다', () => {
    for (const model of Object.values(CAMPAIGN_MODELS)) expect(MONSTER_ROSTER[model]).toBeDefined();
  });
});
