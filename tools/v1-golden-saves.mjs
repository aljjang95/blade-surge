// MMO P1-G 골든 세이브 생성기. 고정 시계로 만든 대표 로컬 세이브 6종을 test/fixtures/saves에 쓴다.
// 실행: bun tools/v1-golden-saves.mjs (결과 파일은 커밋한다. 재생성 시 기대값 테스트가 함께 바뀌는지 확인)
import { writeFileSync } from 'node:fs';
import { EconomyCore } from '../src/game/economy-core.js';
import { createSeededRng } from '../src/shared/rng.js';

const NOW = Date.UTC(2026, 9, 20);
const DAY = 86400000;
const make = (days, edit) => {
  const eco = EconomyCore.fromState(null, { now: () => NOW - days * DAY, rng: createSeededRng(days + 1) });
  edit(eco);
  return eco.snapshot();
};
const out = new URL('../test/fixtures/saves/', import.meta.url);
const write = (name, value) => writeFileSync(new URL(name, out), typeof value === 'string' ? value : JSON.stringify(value, null, 1) + '\n');

write('new.json', make(0, () => {}));
write('mid.json', make(10, (e) => {
  e.s.gold = 2_400_000; e.s.gems = 9_000; e.s.stones = 900; e.s.tickets = 25;
  e.s.progress.unlocked = 25; for (let i = 1; i <= 24; i++) e.s.progress.stars[`${Math.ceil(i / 10)}-${((i - 1) % 10) + 1}`] = 3;
  e.s.heroes.knight.level = 32; for (const r of ['E', 'U', 'S', 'N']) e.addItem(r);
  e.equip('knight', e.s.inventory[0].uid);
}));
write('late.json', make(60, (e) => {
  e.s.gold = 90_000_000; e.s.gems = 120_000; e.s.stones3 = 1500; e.s.progress.unlocked = 60;
  for (let i = 1; i <= 59; i++) e.s.progress.stars[`${Math.ceil(i / 10)}-${((i - 1) % 10) + 1}`] = 3;
  for (const id of Object.keys(e.s.heroes)) e.s.heroes[id].level = 70;
  e.s.avatars.owned = []; for (let i = 0; i < 30; i++) e.addItem(['L', 'U', 'E'][i % 3]);
}));
write('gold-1e15.json', make(5, (e) => { e.s.gold = 1e15; e.s.gems = 9e12; e.s.purchases = ['gems_big']; e.s.spentKRW = 999000; e.s.vip = 5; e.s.vipUntil = NOW + 30 * DAY; e.s.pass.premium = true; }));
write('corrupt.json', '{"gold": 12000, "heroes": {"knight": {"level": 3}}, "inventory": [ {"uid": 1, "id": ');
const legacy = make(20, (e) => { e.s.gold = 50_000; });
delete legacy.schemaVersion; delete legacy.gacha; legacy.pity = 77; for (const h of Object.values(legacy.heroes)) { delete h.grade; h.skills = [1, 1, 1, 1]; }
write('legacy-v0.json', legacy);
console.log('golden saves written', NOW);
