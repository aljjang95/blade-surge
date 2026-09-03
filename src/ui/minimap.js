import { ROOM_TYPE } from '../game/world.js';

/** 우측 상단 미니맵 — 탐험한 방만 보이고, 보스방은 발견해야 표시된다 */
export class Minimap {
  constructor(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d');
    this.floor = null; this.scale = 1; this.ox = 0; this.oz = 0;
    this.acc = 0;
  }
  setFloor(floor) {
    this.floor = floor;
    const b = floor.bounds;
    const w = b.maxX - b.minX, h = b.maxZ - b.minZ;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = this.c.clientWidth || 132;
    this.c.width = size * dpr; this.c.height = size * dpr;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.size = size;
    this.scale = (size - 10) / Math.max(w, h);
    this.ox = (b.minX + b.maxX) / 2; this.oz = (b.minZ + b.maxZ) / 2;
  }
  px(x, z) { return [this.size / 2 + (x - this.ox) * this.scale, this.size / 2 + (z - this.oz) * this.scale]; }
  draw(battle) {
    const f = this.floor; if (!f || !battle?.player) return;
    const g = this.g, S = this.size;
    g.clearRect(0, 0, S, S);
    g.fillStyle = 'rgba(8,6,16,.72)'; g.fillRect(0, 0, S, S);
    // 복도 (인접 방이 하나라도 발견되면 표시)
    g.fillStyle = 'rgba(150,150,190,.28)';
    for (const c of f.corridors) {
      const [x, y] = this.px(c.x - c.w / 2, c.z - c.h / 2);
      g.fillRect(x, y, Math.max(1.5, c.w * this.scale), Math.max(1.5, c.h * this.scale));
    }
    // 방
    for (const r of f.rooms) {
      const [x, y] = this.px(r.x - r.w / 2, r.z - r.h / 2);
      const w = r.w * this.scale, h = r.h * this.scale;
      if (!r.discovered) { g.fillStyle = 'rgba(90,90,120,.18)'; g.fillRect(x, y, w, h); continue; }
      let col = r.cleared ? 'rgba(120,130,170,.55)' : 'rgba(180,190,230,.75)';
      if (r.type === ROOM_TYPE.BOSS) col = r.cleared ? 'rgba(120,60,70,.6)' : 'rgba(255,60,90,.85)';
      else if (r.type === ROOM_TYPE.ELITE) col = r.cleared ? 'rgba(130,110,60,.55)' : 'rgba(255,200,70,.8)';
      else if (r.type === ROOM_TYPE.TREASURE) col = r.cleared ? 'rgba(70,130,110,.55)' : 'rgba(90,255,200,.8)';
      g.fillStyle = col; g.fillRect(x, y, w, h);
      if (!r.cleared && r.type !== ROOM_TYPE.START) {
        // 미클리어 방은 테두리 강조
        g.strokeStyle = col.replace(/[\d.]+\)$/, '1)'); g.lineWidth = 1.4; g.strokeRect(x, y, w, h);
      }
      if (r.type === ROOM_TYPE.BOSS) {
        const [cx, cy] = this.px(r.x, r.z);
        g.fillStyle = '#fff'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('☠', cx, cy);
      } else if (r.type === ROOM_TYPE.TREASURE && !r.cleared) {
        const [cx, cy] = this.px(r.x, r.z);
        g.fillStyle = '#0a2018'; g.font = 'bold 10px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', cx, cy);
      }
    }
    // 살아있는 적 (시야 내)
    const p = battle.player;
    g.fillStyle = 'rgba(255,90,110,.9)';
    for (const e of battle.enemies) {
      if (!e.alive) continue;
      const [x, y] = this.px(e.pos.x, e.pos.z);
      const s = e.isBoss ? 3.4 : e.isElite ? 2.6 : 1.6;
      g.fillStyle = e.isBoss ? '#ff3050' : e.isElite ? '#ffc040' : 'rgba(255,110,130,.9)';
      g.beginPath(); g.arc(x, y, s, 0, 6.283); g.fill();
    }
    // 드랍
    g.fillStyle = 'rgba(255,220,120,.9)';
    for (const it of battle.drops.items) { if (it.kind !== 'item') continue; const [x, y] = this.px(it.mesh.position.x, it.mesh.position.z); g.beginPath(); g.arc(x, y, 2, 0, 6.283); g.fill(); }
    // 플레이어 (방향 삼각형)
    const [px, py] = this.px(p.pos.x, p.pos.z);
    g.save(); g.translate(px, py); g.rotate(-p.yaw + Math.PI);
    g.fillStyle = '#6bff8f'; g.beginPath(); g.moveTo(0, -5); g.lineTo(3.6, 4); g.lineTo(-3.6, 4); g.closePath(); g.fill();
    g.restore();
    // 보스 방향 화살표 (미발견이면 가장자리에 힌트)
    const boss = f.bossRoom;
    if (boss && !boss.cleared) {
      const [bx, by] = this.px(boss.x, boss.z);
      if (!boss.discovered) {
        const a = Math.atan2(by - py, bx - px);
        const r = S / 2 - 8;
        const ex = S / 2 + Math.cos(a) * r, ey = S / 2 + Math.sin(a) * r;
        g.save(); g.translate(ex, ey); g.rotate(a + Math.PI / 2);
        g.fillStyle = 'rgba(255,60,90,.9)'; g.beginPath(); g.moveTo(0, -5); g.lineTo(4, 4); g.lineTo(-4, 4); g.closePath(); g.fill();
        g.restore();
      }
    }
    // 테두리
    g.strokeStyle = 'rgba(255,215,120,.5)'; g.lineWidth = 1; g.strokeRect(0.5, 0.5, S - 1, S - 1);
  }
}
