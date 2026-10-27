import { test } from 'bun:test';
import { DUNGEONS, ARENA_RIVALS } from '../src/data/expansion.js';
import { EXPEDITION_DEPTHS } from '../src/data/expedition-depths.js';
import { EXPEDITION_CONQUESTS } from '../src/data/expedition-conquests.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { towerStage } from '../src/game/endgame-core.js';
test('enum', () => {
  const fails: string[] = [];
  const t = (label: string, f: () => void) => { try { f(); } catch (e: any) { fails.push(label + ' :: ' + e?.message + '\n' + String(e?.stack).split('\n').slice(1,4).join('\n')); } };
  for (const d of DUNGEONS) { t('std ' + d.id, () => buildExpeditionWorld(buildExpeditionStage('dungeon', d.id, {} as any)));
    if (EXPEDITION_DEPTHS.find((x: any) => x.id === d.id)) t('deep ' + d.id, () => buildExpeditionWorld(buildExpeditionStage('dungeon', d.id, {} as any, { depth: 'deep' })));
    for (const c of EXPEDITION_CONQUESTS.filter((c: any) => c.routeId === d.id || c.dungeonId === d.id)) t('conq ' + c.id, () => buildExpeditionWorld(buildExpeditionStage('dungeon', d.id, {} as any, { depth: 'deep', conquestId: c.id }))); }
  for (const a of ARENA_RIVALS) t('arena ' + a.id, () => buildExpeditionWorld(buildExpeditionStage('arena', a.id, {} as any)));
  for (let f = 1; f <= 300; f++) t('tower ' + f, () => towerStage(f));
  console.log('FAILS', fails.length, '\n' + fails.join('\n'));
});
