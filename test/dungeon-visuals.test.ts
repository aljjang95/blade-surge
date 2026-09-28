import { expect, test } from 'bun:test';
import { DUNGEON_VISUALS, dungeonVisualFor, dungeonVisualKeyFor } from '../src/data/dungeon-visuals.js';

test('story routes resolve to authored landmark families', () => {
  expect(dungeonVisualFor({ dungeon: { id: 'procession' } }).landmark).toBe('memorial');
  expect(dungeonVisualFor({ dungeon: { id: 'kiln' } }).landmark).toBe('kiln');
  expect(dungeonVisualFor({ dungeon: { id: 'beacon' } }).landmark).toBe('beacon');
  expect(dungeonVisualFor({ dungeon: { id: 'tribunal' } }).landmark).toBe('tribunal');
});

test('expeditions do not collapse into a single theme camera', () => {
  const ids = ['glass_garden', 'ember_vault', 'star_archive', 'eclipse_hydra_vault', 'sable_mirage_basin', 'verdigris_sanctum'];
  const profiles = ids.map(id => dungeonVisualFor({ expedition: { id } }));
  expect(new Set(profiles.map(profile => profile.landmark)).size).toBe(6);
  expect(new Set(profiles.map(profile => `${profile.camera.y}:${profile.camera.z}:${profile.camera.yaw}`)).size).toBe(6);
  expect(new Set(profiles.map(profile => profile.sky.horizon)).size).toBe(6);
});

test('visual profiles are complete and route aliases are deterministic', () => {
  for (const profile of Object.values(DUNGEON_VISUALS)) {
    expect(profile.sky.top).toBeNumber();
    expect(profile.sky.horizon).toBeNumber();
    expect(profile.camera.fov).toBeGreaterThan(0);
    expect(profile.camera.lag).toBeGreaterThan(0);
  }
  expect(dungeonVisualKeyFor('lostShip')).toBe('beacon');
  expect(dungeonVisualKeyFor('addresses')).toBe('confluence');
});
