import { CITADEL_TOWN_IDS, TOWN_THEMES, defaultTownDungeonIds } from '../data/citadel-hub.js';
import { TownService } from '../game/town-service.js';

/** 계약 API 모양만 갖춘 대체 서비스. 실제 TownService를 만들지 못할 때만 쓰며 상점·교관은 비어 있고 저장하지 않는다. */
export class ProvisionalTownService {
  constructor(app) { this.app = app; this.current = 'oathhold'; this.listeners = new Set(); this.provisional = true; }
  wins(id) { try { return this.app.expedition?.snapshot().stats?.[id] || 0; } catch { return 0; } }
  unlockedIds() {
    const open = new Set([CITADEL_TOWN_IDS[0]]);
    CITADEL_TOWN_IDS.forEach((id, index) => {
      if (!index) return;
      const previous = defaultTownDungeonIds(CITADEL_TOWN_IDS[index - 1]);
      if (open.has(CITADEL_TOWN_IDS[index - 1]) && previous.filter(dungeon => this.wins(dungeon) > 0).length >= 4) open.add(id);
    });
    return open;
  }
  towns() {
    const open = this.unlockedIds();
    return CITADEL_TOWN_IDS.map((id, index) => {
      const previous = index ? defaultTownDungeonIds(CITADEL_TOWN_IDS[index - 1]) : [];
      const cleared = index ? previous.filter(dungeon => this.wins(dungeon) > 0).length : 0;
      const theme = TOWN_THEMES[id];
      return { id, name: theme.name, subtitle: theme.subtitle, tier: index + 1, theme: id, fieldId: { oathhold: 'windmeadow', emberport: 'dawnward_city', starcrest: 'skywind_pass' }[id], dungeonIds: defaultTownDungeonIds(id),
        unlocked: open.has(id), progress: { cleared, required: index ? 4 : 0 },
        requirement: { text: index ? '이전 마을 던전 6곳 중 4곳 클리어' : '처음부터 열려 있습니다' } };
    });
  }
  currentTownId() { return this.unlockedIds().has(this.current) ? this.current : CITADEL_TOWN_IDS[0]; }
  travel(id) {
    const town = this.towns().find(entry => entry.id === id);
    if (!town) return { ok: false, reason: '알 수 없는 마을입니다.' };
    if (!town.unlocked) return { ok: false, reason: town.requirement.text };
    this.current = id; for (const listener of this.listeners) listener();
    return { ok: true };
  }
  shop() { return []; }
  buy() { return { ok: false, reason: '이 마을의 상점은 준비 중입니다.' }; }
  trainer() { return []; }
  learn() { return { ok: false, reason: '이 마을의 교관은 준비 중입니다.' }; }
  onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}

/** app.towns 를 우선하고, 없으면 실제 TownService(계약 §1)를, 만들 수 없을 때만 대체 서비스를 쓴다. */
export function townServiceFor(app) {
  if (app.towns) return app.towns;
  try { app.towns = new TownService(app.eco); } catch (error) { console.warn('TownService unavailable, using provisional service', error); app.towns = new ProvisionalTownService(app); }
  return app.towns;
}
