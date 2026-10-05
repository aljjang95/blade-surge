import { ROOM_TYPE } from '../game/world.js';
import { battleObjectiveView, discoveredMapView, discoveredPoint } from './battle-objective-view.js';

/** 두 지도 크기가 발견한 지형만 공유하며 숨겨진 전체 경계는 읽지 않는다. */
export class Minimap {
  constructor(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.floor = null;
    this.terrainCanvas = (canvas.ownerDocument || document).createElement('canvas');
    this.terrainContext = this.terrainCanvas.getContext('2d'); this.terrainView = null;
    this.cssWidth = this.cssHeight = 88; this.sizeMeasured = false;
    this.measureSize();
    if (typeof ResizeObserver === 'function') {
      // 프레임마다 DOM 크기를 읽으면 직전 HUD 변경의 레이아웃 계산을 강제한다.
      this.resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) if (entry.target === this.c) this.cacheSize(entry.contentRect.width, entry.contentRect.height);
      });
      this.resizeObserver.observe(this.c);
    } else {
      this.onResize = () => this.measureSize();
      window.addEventListener('resize', this.onResize);
      window.addEventListener('orientationchange', this.onResize);
    }
  }
  cacheSize(width, height) {
    // 닫힌 지도나 숨겨진 HUD의 0 크기로 마지막 실제 표시 크기를 덮지 않는다.
    if (!(width > 0) || !(height > 0)) return;
    this.cssWidth = Math.max(1, Math.round(width)); this.cssHeight = Math.max(1, Math.round(height)); this.sizeMeasured = true;
  }
  measureSize() { this.cacheSize(this.c.clientWidth, this.c.clientHeight); }
  setFloor(floor) {
    if (this.floor !== floor) this.terrainView = null;
    this.floor = floor;
    if (!this.sizeMeasured || !this.resizeObserver) this.measureSize();
  }
  px(x, z) { return [this.width / 2 + (x - this.ox) * this.scale, this.height / 2 + (z - this.oz) * this.scale]; }
  terrainChanged() {
    if (!this.terrainView || this.terrainSealed !== !!this.floor.sealed
      || this.terrainCorridorWidth !== (this.floor.layout?.width || 6)) return true;
    let index = 0;
    // 미발견 방의 지형은 읽지 않고 공개된 방의 실제 변경만 비교한다.
    for (const room of this.floor.rooms) {
      if (!room.discovered) continue;
      const previous = this.terrainRoomStates[index++];
      if (!previous || previous.id !== room.id || previous.gx !== room.gx || previous.gy !== room.gy
        || previous.x !== room.x || previous.z !== room.z || previous.w !== room.w || previous.h !== room.h
        || previous.type !== room.type || previous.label !== (room.label || '') || previous.cleared !== !!room.cleared
        || previous.attunementPending !== !!room.attunementPending || previous.attuned !== !!room.attuned
        || previous.conquestLabel !== (room.conquestLabel || '')) return true;
    }
    if (index !== this.terrainRoomStates.length) return true;
    index = 0;
    for (const [from, to] of this.floor.linkPending || []) {
      const a = this.terrainCells.get(from[0])?.get(from[1]), b = this.terrainCells.get(to[0])?.get(to[1]);
      if (!a || !b) continue;
      const previous = this.terrainView.corridors[index++];
      if (!previous || previous.fromId !== a.id || previous.toId !== b.id
        || previous.sealed !== (!!this.floor.sealed && (a.id === this.floor.bossRoom?.id || b.id === this.floor.bossRoom?.id))) return true;
    }
    return index !== this.terrainView.corridors.length;
  }
  refreshTerrain() {
    if (!this.terrainChanged()) return;
    this.terrainView = discoveredMapView(this.floor); this.terrainDirty = true;
    this.terrainSealed = !!this.floor.sealed; this.terrainCorridorWidth = this.floor.layout?.width || 6;
    this.terrainRoomStates = []; this.terrainCells = new Map();
    this.roomMinX = this.roomMinZ = Infinity; this.roomMaxX = this.roomMaxZ = -Infinity;
    for (const room of this.floor.rooms) {
      if (!room.discovered) continue;
      const state = { id: room.id, gx: room.gx, gy: room.gy, x: room.x, z: room.z, w: room.w, h: room.h,
        type: room.type, label: room.label || '', cleared: !!room.cleared, attunementPending: !!room.attunementPending,
        attuned: !!room.attuned, conquestLabel: room.conquestLabel || '' };
      this.terrainRoomStates.push(state);
      if (!this.terrainCells.has(room.gx)) this.terrainCells.set(room.gx, new Map());
      this.terrainCells.get(room.gx).set(room.gy, state);
      this.roomMinX = Math.min(this.roomMinX, room.x - room.w / 2); this.roomMaxX = Math.max(this.roomMaxX, room.x + room.w / 2);
      this.roomMinZ = Math.min(this.roomMinZ, room.z - room.h / 2); this.roomMaxZ = Math.max(this.roomMaxZ, room.z + room.h / 2);
    }
  }
  drawTerrain(currentRoomId, objectiveRoomId) {
    const view = this.terrainView, rooms = view.rooms, width = this.width, height = this.height, g = this.terrainContext;
    if (this.terrainCanvas.width !== this.c.width || this.terrainCanvas.height !== this.c.height) {
      this.terrainCanvas.width = this.c.width; this.terrainCanvas.height = this.c.height;
    }
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // 반투명 배경은 다시 그리기 전에 지워 색 누적과 이전 지형 잔상을 막는다.
    g.clearRect(0, 0, width, height); g.fillStyle = '#0d211ee8'; g.fillRect(0, 0, width, height);
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
      g.fillRect(x, y, w, h); g.lineWidth = room.id === currentRoomId ? 2 : 1;
      g.strokeStyle = room.id === currentRoomId ? '#f7efcc' : '#cad1b980'; g.strokeRect(x, y, w, h);
      const glyph = room.conquestLabel || (boss ? '♜' : treasure && !room.cleared ? '◇' : elite && !room.cleared ? '!' : '');
      if (glyph) { const [cx, cy] = this.px(room.x, room.z); g.fillStyle = '#102b24';
        g.font = `700 ${width > 160 ? 14 : 10}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(glyph, cx, cy); }
      if (boss && view.sealed) { g.strokeStyle = '#f0cf8c'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y + h); g.stroke(); }
    }
    const objectiveRoom = rooms.find(room => room.id === objectiveRoomId);
    if (objectiveRoom) { const [x, y] = this.px(objectiveRoom.x - objectiveRoom.w / 2, objectiveRoom.z - objectiveRoom.h / 2);
      g.strokeStyle = '#e6c88c'; g.lineWidth = 2; g.setLineDash([3, 2]);
      g.strokeRect(x - 2, y - 2, objectiveRoom.w * this.scale + 4, objectiveRoom.h * this.scale + 4); g.setLineDash([]); }
    this.terrainDirty = false;
  }
  draw(battle) {
    if (!this.floor || this.floor !== battle?.world || !battle.player) return;
    this.refreshTerrain();
    const view = this.terrainView, width = this.cssWidth, height = this.cssHeight;
    if (!view.rooms.length) { this.g.clearRect(0, 0, this.width || width, this.height || height); return; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.width !== width || this.height !== height || this.dpr !== dpr) {
      this.width = width; this.height = height; this.dpr = dpr; this.terrainDirty = true;
      this.c.width = Math.round(width * dpr); this.c.height = Math.round(height * dpr);
      this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const p = battle.player;
    // 현재 위치의 여유 6m를 그대로 포함하며 숨겨진 전체 맵 경계는 사용하지 않는다.
    const minX = Math.min(p.pos.x - 6, this.roomMinX), maxX = Math.max(p.pos.x + 6, this.roomMaxX);
    const minZ = Math.min(p.pos.z - 6, this.roomMinZ), maxZ = Math.max(p.pos.z + 6, this.roomMaxZ);
    const currentRoomId = battle.curRoom?.id ?? null, objectiveRoomId = battleObjectiveView(battle).roomId;
    if (this.minX !== minX || this.maxX !== maxX || this.minZ !== minZ || this.maxZ !== maxZ
      || this.currentRoomId !== currentRoomId || this.objectiveRoomId !== objectiveRoomId) this.terrainDirty = true;
    this.minX = minX; this.maxX = maxX; this.minZ = minZ; this.maxZ = maxZ;
    this.currentRoomId = currentRoomId; this.objectiveRoomId = objectiveRoomId;
    this.ox = (minX + maxX) / 2; this.oz = (minZ + maxZ) / 2;
    this.scale = Math.min((width - 18) / Math.max(1, maxX - minX), (height - 18) / Math.max(1, maxZ - minZ));
    if (this.terrainDirty) this.drawTerrain(currentRoomId, objectiveRoomId);
    const g = this.g; g.clearRect(0, 0, width, height);
    g.drawImage(this.terrainCanvas, 0, 0, width, height); g.lineJoin = 'round'; g.lineCap = 'round';
    const tactics = battle.mapTactics?.snapshot(battle);
    if (tactics?.roomDiscovered) for (const device of tactics.nodes) {
      if (!discoveredPoint(view, device.operator.x, device.operator.z)) continue;
      const worldX = device.operator.x, worldZ = device.operator.z;
      const x = this.width / 2 + (worldX - this.ox) * this.scale, y = this.height / 2 + (worldZ - this.oz) * this.scale, size = width > 160 ? 5 : 3;
      g.fillStyle = tactics.used ? '#7d8c7a' : device.id === tactics.nearbyId && tactics.actionable ? '#a6f0d4' : device.id === 'gather' ? '#68bea5' : '#c4a46d';
      g.strokeStyle = '#13291f'; g.lineWidth = 1;
      g.beginPath(); if (device.id === 'gather') { g.moveTo(x, y - size); g.lineTo(x + size, y); g.lineTo(x, y + size); g.lineTo(x - size, y); }
      else g.rect(x - size, y - size, size * 2, size * 2); g.closePath(); g.fill(); g.stroke();
    }
    for (const enemy of battle.enemies || []) {
      if (!enemy.alive || !enemy.pos || !discoveredPoint(view, enemy.pos.x, enemy.pos.z)
        || Math.hypot(enemy.pos.x - p.pos.x, enemy.pos.z - p.pos.z) > 28) continue;
      const worldX = enemy.pos.x, worldZ = enemy.pos.z;
      const x = this.width / 2 + (worldX - this.ox) * this.scale, y = this.height / 2 + (worldZ - this.oz) * this.scale; g.fillStyle = enemy.isBoss ? '#ff6478' : '#eaae8c';
      g.beginPath(); g.arc(x, y, enemy.isBoss ? 3 : 1.8, 0, Math.PI * 2); g.fill();
    }
    for (const item of battle.drops?.items || []) {
      const point = item.mesh?.position;
      if (item.kind !== 'item' || !point || !discoveredPoint(view, point.x, point.z)) continue;
      const worldX = point.x, worldZ = point.z;
      const x = this.width / 2 + (worldX - this.ox) * this.scale, y = this.height / 2 + (worldZ - this.oz) * this.scale; g.fillStyle = '#ebcf8c'; g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill();
    }
    if (battle.stage?.party && battle.app?.party) for (const member of battle.app.party.members) {
      const ally = battle.app.party.players.get(member.id);
      if (!ally || ally === p || !discoveredPoint(view, ally.pos.x, ally.pos.z)) continue;
      const worldX = ally.pos.x, worldZ = ally.pos.z;
      const x = this.width / 2 + (worldX - this.ox) * this.scale, y = this.height / 2 + (worldZ - this.oz) * this.scale; g.fillStyle = ally.alive ? '#78ddff' : '#a89681';
      g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
    }
    const worldX = p.pos.x, worldZ = p.pos.z;
    const px = this.width / 2 + (worldX - this.ox) * this.scale, py = this.height / 2 + (worldZ - this.oz) * this.scale; g.save(); g.translate(px, py); g.rotate(-p.yaw + Math.PI);
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
