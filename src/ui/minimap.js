import { ROOM_TYPE } from '../game/world.js';
import { battleObjectiveView, discoveredMapBounds, discoveredMapView, discoveredPoint } from './battle-objective-view.js';

/** 두 지도 크기가 발견한 지형만 공유하며 숨겨진 전체 경계는 읽지 않는다. */
export class Minimap {
  constructor(canvas) { this.c = canvas; this.g = canvas.getContext('2d'); this.floor = null; }
  setFloor(floor) { this.floor = floor; }
  px(x, z) { return [this.width / 2 + (x - this.ox) * this.scale, this.height / 2 + (z - this.oz) * this.scale]; }
  draw(battle) {
    if (!this.floor || this.floor !== battle?.world || !battle.player) return;
    const view = discoveredMapView(this.floor), rooms = view.rooms;
    if (!rooms.length) return;
    const width = this.c.clientWidth || 88, height = this.c.clientHeight || width;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.width !== width || this.height !== height || this.dpr !== dpr) {
      this.width = width; this.height = height; this.dpr = dpr;
      this.c.width = Math.round(width * dpr); this.c.height = Math.round(height * dpr);
      this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const { minX, maxX, minZ, maxZ } = discoveredMapBounds(view, battle.player.pos);
    this.ox = (minX + maxX) / 2; this.oz = (minZ + maxZ) / 2;
    this.scale = Math.min((width - 18) / Math.max(1, maxX - minX), (height - 18) / Math.max(1, maxZ - minZ));
    const g = this.g; g.clearRect(0, 0, width, height); g.fillStyle = '#0d211ee8'; g.fillRect(0, 0, width, height);
    g.lineJoin = 'round'; g.lineCap = 'round';
    for (const corridor of view.corridors) {
      g.strokeStyle = corridor.sealed ? '#b3915670' : '#9eafa566';
      g.lineWidth = Math.max(2, (this.floor.layout?.width || 6) * this.scale);
      g.beginPath(); corridor.points.forEach(([x, z], index) => { const point = this.px(x, z); index ? g.lineTo(...point) : g.moveTo(...point); }); g.stroke();
    }
    for (const room of rooms) {
      const [x, y] = this.px(room.x - room.w / 2, room.z - room.h / 2);
      const w = Math.max(2, room.w * this.scale), h = Math.max(2, room.h * this.scale);
      const boss = room.type === ROOM_TYPE.BOSS, elite = room.type === ROOM_TYPE.ELITE, treasure = room.type === ROOM_TYPE.TREASURE;
      g.fillStyle = room.cleared ? '#526b6070' : boss ? '#c86f76' : elite ? '#b39156' : treasure ? '#a6f0d4' : '#b6b89e';
      g.fillRect(x, y, w, h); g.lineWidth = room.id === battle.curRoom?.id ? 2 : 1;
      g.strokeStyle = room.id === battle.curRoom?.id ? '#f7efcc' : '#cad1b980'; g.strokeRect(x, y, w, h);
      const glyph = room.conquestLabel || (boss ? '♜' : treasure && !room.cleared ? '◇' : elite && !room.cleared ? '!' : '');
      if (glyph) { const [cx, cy] = this.px(room.x, room.z); g.fillStyle = '#102b24';
        g.font = `700 ${width > 160 ? 14 : 10}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(glyph, cx, cy); }
      if (boss && view.sealed) { g.strokeStyle = '#f0cf8c'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y + h); g.stroke(); }
    }
    const p = battle.player;
    const objective = battleObjectiveView(battle), objectiveRoom = rooms.find(room => room.id === objective.roomId);
    if (objectiveRoom) { const [x, y] = this.px(objectiveRoom.x - objectiveRoom.w / 2, objectiveRoom.z - objectiveRoom.h / 2);
      g.strokeStyle = '#e6c88c'; g.lineWidth = 2; g.setLineDash([3, 2]);
      g.strokeRect(x - 2, y - 2, objectiveRoom.w * this.scale + 4, objectiveRoom.h * this.scale + 4); g.setLineDash([]); }
    const tactics = battle.mapTactics?.snapshot(battle);
    if (tactics?.roomDiscovered) for (const device of tactics.nodes) {
      if (!discoveredPoint(view, device.operator.x, device.operator.z)) continue;
      const [x, y] = this.px(device.operator.x, device.operator.z), size = width > 160 ? 5 : 3;
      g.fillStyle = tactics.used ? '#7d8c7a' : device.id === tactics.nearbyId && tactics.actionable ? '#a6f0d4' : device.id === 'gather' ? '#68bea5' : '#c4a46d';
      g.strokeStyle = '#13291f'; g.lineWidth = 1;
      g.beginPath(); if (device.id === 'gather') { g.moveTo(x, y - size); g.lineTo(x + size, y); g.lineTo(x, y + size); g.lineTo(x - size, y); }
      else g.rect(x - size, y - size, size * 2, size * 2); g.closePath(); g.fill(); g.stroke();
    }
    for (const enemy of battle.enemies || []) {
      if (!enemy.alive || !enemy.pos || !discoveredPoint(view, enemy.pos.x, enemy.pos.z)
        || Math.hypot(enemy.pos.x - p.pos.x, enemy.pos.z - p.pos.z) > 28) continue;
      const [x, y] = this.px(enemy.pos.x, enemy.pos.z); g.fillStyle = enemy.isBoss ? '#ff6478' : '#eaae8c';
      g.beginPath(); g.arc(x, y, enemy.isBoss ? 3 : 1.8, 0, Math.PI * 2); g.fill();
    }
    for (const item of battle.drops?.items || []) {
      const point = item.mesh?.position;
      if (item.kind !== 'item' || !point || !discoveredPoint(view, point.x, point.z)) continue;
      const [x, y] = this.px(point.x, point.z); g.fillStyle = '#ebcf8c'; g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill();
    }
    if (battle.stage?.party && battle.app?.party) for (const member of battle.app.party.members) {
      const ally = battle.app.party.players.get(member.id);
      if (!ally || ally === p || !discoveredPoint(view, ally.pos.x, ally.pos.z)) continue;
      const [x, y] = this.px(ally.pos.x, ally.pos.z); g.fillStyle = ally.alive ? '#78ddff' : '#a89681';
      g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
    }
    const [px, py] = this.px(p.pos.x, p.pos.z); g.save(); g.translate(px, py); g.rotate(-p.yaw + Math.PI);
    g.fillStyle = '#e7fff2'; g.strokeStyle = '#17352a'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -6); g.lineTo(4, 5); g.lineTo(-4, 5); g.closePath(); g.fill(); g.stroke(); g.restore();
    // 기존 보스 기척은 방향 단서로만 유지하며 미발견 방의 형태는 표시하지 않는다.
    const boss = this.floor.bossRoom;
    if (boss && !boss.discovered && !boss.cleared) {
      const angle = Math.atan2(boss.z - p.pos.z, boss.x - p.pos.x);
      const cx = width / 2 + Math.cos(angle) * (width / 2 - 10), cy = height / 2 + Math.sin(angle) * (height / 2 - 10);
      g.fillStyle = this.floor.sealed ? '#c4a98b' : '#ef9c9c'; g.font = '700 12px sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', cx, cy);
    }
  }
}
