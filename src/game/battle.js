import * as THREE from 'three';
import { CAMERA_PRESETS } from '../engine/renderer.js';
import { Player } from './player.js';
import { Enemy } from './enemies.js';
import { DropSystem } from './drops.js';
import { Floor, ROOM_TYPE } from './world.js';
import { ENEMIES } from '../data/stages.js';
import { HEROES, heroStats } from '../data/heroes.js';
import { loadModel } from '../engine/assets.js';
import { RARITY_WEIGHT_STAGE, RARITY_WEIGHT_ELITE, RARITY_WEIGHT_BOSS } from '../data/items.js';
import { audio } from '../engine/audio.js';
import { SetProcs } from './setprocs.js';

const _v = new THREE.Vector3();
const pickWeighted = (w) => { const tot = Object.values(w).reduce((a, b) => a + b, 0); let r = Math.random() * tot; for (const k in w) { r -= w[k]; if (r <= 0) return k; } return Object.keys(w)[0]; };

/** 히트스탑 / 슬로우모션 타임 컨트롤 */
export class TimeCtl {
  constructor() { this.stop = 0; this.slow = 1; this.slowT = 0; this.scale = 1; }
  hitstop(sec) { this.stop = Math.max(this.stop, sec); }
  slowmo(scale, sec) { this.slow = Math.min(this.slow, scale); this.slowT = Math.max(this.slowT, sec); }
  step(realDt) {
    if (this.stop > 0) { this.stop -= realDt; this.scale = 0; return 0; }
    if (this.slowT > 0) { this.slowT -= realDt; if (this.slowT <= 0) this.slow = 1; }
    this.scale = this.slow; return realDt * this.slow;
  }
}

export class Battle {
  constructor(app) {
    this.app = app; this.scene = app.renderer.scene; this.renderer = app.renderer; this.fx = app.fx; this.input = app.input; this.ui = app.ui; this.arena = app.arena;
    this.timeCtl = new TimeCtl();
    this.enemies = []; this.projectiles = []; this.timers = [];
    this.drops = new DropSystem(this);
    this.player = null; this.active = false; this.paused = false;
    this.combo = 0; this.comboT = 0; this.kills = 0; this.maxCombo = 0; this.dmgDealt = 0; this.elapsed = 0;
    this.wave = 0; this.waveT = 0; this.stage = null; this.boss = null; this.result = null; this.revived = 0;
    this.pending = []; // 지속 스폰 큐
    this.maxAlive = 34; this.peakAlive = 0;
  }
  after(sec, fn) { this.timers.push({ t: sec, fn }); }
  rollDrop(table) {
    const w = table === 'boss' ? RARITY_WEIGHT_BOSS : table === 'elite' ? RARITY_WEIGHT_ELITE : RARITY_WEIGHT_STAGE;
    const rar = pickWeighted(w);
    const inst = this.app.eco.fieldDrop(rar);
    return { ...inst, rarity: rar };
  }

  async start(stage, heroId, heroState, equipBonus) {
    this.stage = stage; this.active = true; this.paused = false; this.result = null; this.revived = 0;
    this.enemies.length = 0; this.projectiles.length = 0; this.timers.length = 0; this.pending.length = 0; this.fx.clearAll(); this.drops.clear(); this.holes = [];
    this.combo = 0; this.kills = 0; this.maxCombo = 0; this.dmgDealt = 0; this.elapsed = 0; this.boss = null; this.peakAlive = 0;
    if (this.portal) { this.scene.remove(this.portal.mesh); this.portal = null; }
    const def = HEROES[heroId]; const stats = heroStats(def, heroState, equipBonus);
    this.setBonus = equipBonus.active || [];
    this.procs = new Set(equipBonus.procs || []);   // 테마 세트 발동 효과 (items.js SETS.*.procs)
    this.holes = []; this.rebirthUsed = false;
    this.sp = this.sp || new SetProcs(this); this.sp.clear();   // 회전 8 테마 세트 (서리·역병·룬·사슬)

    // ---- 무한의 성: 한 층 절차 생성 ----
    this.world = new Floor(stage.idx, stage.chapter.theme);
    this.arena.buildFloor(this.world, stage.chapter.theme);
    this.roomsCleared = 0; this.bossFound = false;

    const gltf = await loadModel(def.model);
    this.player = new Player(this, gltf, def, stats, heroState.skills || [1, 1, 1, 1, 1, 1], this.app.eco.heroEquipInsts(heroId), heroState.level || 1);
    const sr = this.world.startRoom;
    this.player.pos.set(sr.x, 0, sr.z); this.player.yaw = 0;
    this.drops.setup(this.app.models.dungeon);
    this.renderer.rig.mode = 'battle'; this.renderer.rig.target.copy(this.player.pos); this.renderer.rig.pos.copy(this.player.pos).add(this.renderer.rig.offset);
    this.weaponsGltf = await loadModel('skel_weapons');
    this.ui.setupHud(def, this.player);
    this.ui.setupMinimap(this.world);
    this.input.enabled = true; this.input.clear();
    audio.playMusic(Math.random() < 0.5 ? 'bgm_battle' : 'bgm_battle2');
    this.ui.showHud(true);
    const q = this.app.eco.s.settings.quality;
    this.maxAlive = q === 'low' ? 16 : q === 'mid' ? 24 : 34;
    this.curRoom = sr; sr.discovered = true;
    this.ui.setObjective(this.world);
    this.ui.setFloorLabel(stage.idx, this.world);
    this.ui.waveBanner(`${stage.idx}층`);
    audio.waveHorn({ vol: 0.45 });
    this.heroId = heroId; this.bossKey = stage.chapter.boss;
    this.after(0.25, () => { if (this.active) audio.voice(`hero_${heroId}_select`, { min: 20 }); });
    this.after(3.2, () => { if (this.active) audio.voice('floor_start', { min: 30 }); });   // 층 시작 안내 ("The seal is broken" 는 unsealBoss 의 seal_break 가 맡는다)
    // 테마 세트가 켜져 있으면 알려준다 — 발동 효과는 눈에 띄어야 세트를 모을 이유가 된다
    const themed = this.setBonus.filter((a) => a.set.themed);
    themed.forEach((a, i) => this.after(1.2 + i * 0.9, () => { if (!this.active) return; this.ui.toast(`${a.set.name} ${a.tier}세트 발동 — ${a.set[a.tier === 4 ? 'four' : 'two'].text}`, 'gold'); this.fx.holyBurst(this.player.pos, { size: 6, life: 0.5, color: a.set.color }); audio.magic({ vol: 0.3, base: 440, notes: [0, 4, 7], step: 0.07 }); if (a.set.voiced) audio.voice('set_' + a.set.id, { min: 5 }); }));
  }
  hasProc(name) { return this.procs && this.procs.has(name); }

  // ---------------- 테마 세트 발동 효과 ----------------
  /** 폭풍 2세트: 마무리 타격 지점에서 가까운 적 3명을 번개로 연쇄 */
  stormChain(from, dmg) {
    let cur = from.clone().setY(1.2); const hit = new Set(); let n = 0;
    for (let k = 0; k < 3; k++) {
      let best = null, bd = 8;
      for (const e of this.enemies) { if (!e.alive || e.spawning || hit.has(e)) continue; const d = Math.hypot(e.pos.x - cur.x, e.pos.z - cur.z); if (d < bd) { bd = d; best = e; } }
      if (!best) break;
      hit.add(best); const to = best.pos.clone().setY(1.1 * best.def.scale);
      this.fx.boltTex(cur, to, 0x9fe4ff, { life: 0.25 });
      this.damageEnemy(best, dmg, { kb: 3, kind: 'magic', stun: 0.3, dirx: to.x - cur.x, dirz: to.z - cur.z });
      this.fx.flash(to, 0x9fe4ff, { size: 2.2, life: 0.15 });
      cur = to; n++;
    }
    if (n) { audio.magic({ vol: 0.3, base: 880, notes: [0, 12, 7], step: 0.03, type: 'sawtooth' }); audio.vibe(10); }
    return n;
  }
  /** 폭풍 4세트: 회피 경로에 낙뢰 */
  stormStrike(pos, dmg) {
    const top = pos.clone().setY(9);
    this.fx.boltTex(top, pos.clone().setY(0.2), 0xbfefff, { life: 0.3, width: 2 });
    this.fx.shockTex(pos, 0x9fe4ff, { r1: 3.5, life: 0.35 }); this.fx.flash(pos.clone().setY(0.8), 0xbfefff, { size: 3, life: 0.18 });
    this.hitRadius(pos, 2.6, dmg, { kb: 6, kind: 'magic', stun: 0.4, dirFrom: pos });
    audio.play('hit_bell', { vol: 0.3, rate: 2.2 }); audio.boom({ vol: 0.35, dur: 0.25, low: 120 });
  }
  /** 흡혈 4세트: 피격 시 피의 폭발 */
  bloodBurst(p) {
    this.fx.texFlash(p.pos, 'blood_burst', 0xff3a5a, { size: 7, life: 0.45, spin: 0.3, grow: 1.5, y: 1 });
    this.fx.burst(p.pos.clone().setY(1), 0xff2040, { n: 24, speed: 9, size: 0.35 });
    this.hitRadius(p.pos, 4.2, p.atk * 1.2, { kb: 11, kind: 'slash', dirFrom: p.pos });
    audio.dark({ vol: 0.5, base: 140, dur: 0.4 }); this.renderer.shake(0.3);
  }
  /** 중력 4세트: 특이점 — 2초간 반경 7 흡인 */
  singularity(pos) {
    const c = pos.clone().setY(0);
    this.holes.push({ pos: c, t: 2 });
    this.fx.groundTex(c, 'singularity', 0xb26bff, { r0: 2, r1: 9, life: 2.1, spin: 2.4, y: 0.09, fadeIn: 0.15, hold: 1.6 });
    this.fx.embers(c, 0xb26bff, { n: 24, radius: 4, life: 1.6, rise: 1.5 });
    audio.suck({ vol: 0.4, dur: 1.8 }); audio.dark({ vol: 0.35, base: 60, dur: 1.5 });
  }
  /** 불사조 2세트: 궁극기 시전 시 화염 폭발 */
  phoenixBurn(p) {
    this.fx.texFlash(p.pos, 'phoenix', 0xffa040, { size: 11, life: 0.7, spin: 0, grow: 1.5, y: 2.2 });
    this.fx.firePillar(p.pos, { height: 8, width: 3, life: 0.7, color: 0xff8030 });
    this.fx.burst(p.pos.clone().setY(1.5), 0xffa040, { n: 40, speed: 11, size: 0.45, up: 1 });
    this.hitRadius(p.pos, 6.5, p.atk * 3, { kb: 9, kind: 'magic', dirFrom: p.pos });
    audio.boom({ vol: 0.7, dur: 0.6, low: 60 }); audio.magic({ vol: 0.35, base: 330, notes: [0, 7, 12, 19], step: 0.05 }); this.renderer.flashScreen(0.3, 0xffa040);
  }
  /** 불사조 4세트: 층당 1회 부활 */
  phoenixRebirth() {
    const p = this.player; this.rebirthUsed = true;
    this.after(1.1, () => {
      if (!this.active) return;
      p.revive(); p.hp = Math.floor(p.maxHp * 0.5); this.renderer.desat = 0; this.timeCtl.slowmo(0.4, 0.6);
      this.ui.toast('불사조의 부활!', 'gold'); audio.voice('rebirth'); this.after(2.2, () => audio.voice(`hero_${this.heroId}_revive`));
      this.fx.texFlash(p.pos, 'phoenix', 0xffc060, { size: 14, life: 0.9, grow: 1.6, y: 2.5 }); this.fx.holyBurst(p.pos, { size: 12, life: 0.7, color: 0xffa040 });
      this.hitRadius(p.pos, 8, p.atk * 2.5, { kb: 14, stun: 1.2, kind: 'magic', dirFrom: p.pos });
      audio.playMusic(this.boss ? 'bgm_boss' : 'bgm_battle'); audio.boom({ vol: 0.9, dur: 1, low: 45 }); audio.magic({ vol: 0.5, base: 523, notes: [0, 4, 7, 12, 16], step: 0.07 }); audio.vibe([60, 40, 120]);
      this.renderer.flashScreen(0.6, 0xffc060); this.renderer.shake(0.7);
    });
  }


  // ---------------- 방 진입 / 클리어 ----------------
  /** 방 정원 — 방 면적으로 뽑는다. 몹몰이는 무리가 보여야 성립하므로 작은 방도 두 자릿수 */
  rosterSize(room) {
    if (room.type === ROOM_TYPE.BOSS || room.type === ROOM_TYPE.START) return 0;
    const area = room.w * room.h;   // 변 14~24 → 196~576
    const base = room.type === ROOM_TYPE.ELITE ? 6 + Math.round(area / 50)
      : room.type === ROOM_TYPE.TREASURE ? 4 + Math.round(area / 70)
      : 8 + Math.round(area / 40);
    return Math.min(24, base + Math.floor(this.stage.idx * 0.45));
  }
  roomRoster(room) {
    const R = this.stage.rosterFor(room.type);
    // 증원으로 이미 달려나간 만큼은 정원에서 뺀다 (총량 보존)
    const n = Math.max(0, this.rosterSize(room) - (room.reinforced || 0));
    const list = [];
    for (let i = 0; i < n; i++) list.push((i % 6 === 5 ? R.ranged : R.trash)[(i * 3 + room.id) % (i % 6 === 5 ? R.ranged.length : R.trash.length)]);
    if (room.type === ROOM_TYPE.ELITE) { list.push(R.elite[room.id % R.elite.length]); if (this.stage.idx > 8) list.push(R.elite[(room.id + 1) % R.elite.length]); }
    else if (room.type === ROOM_TYPE.NORMAL && Math.random() < 0.35) list.push(R.elite[room.id % R.elite.length]);
    if (room.type === ROOM_TYPE.BOSS) list.push(this.stage.chapter.boss, R.trash[0], R.trash[1], R.trash[0], R.trash[2], R.ranged[0], R.trash[1]);
    return list;
  }
  /** 증원 — 이웃 방의 무리가 싸움 소리를 듣고 복도로 몰려온다. 이웃 정원에서 미리 뺀 몫이라 층 총량은 같다 */
  callReinforcements(room) {
    const R = this.stage.rosterFor(room.type); let wave = 0;
    for (const nid of room.links || []) {
      const nb = this.world.rooms[nid];
      if (!nb || nb.cleared || nb.spawned || nb.type === ROOM_TYPE.BOSS || nb.type === ROOM_TYPE.START) continue;
      if ((room.id * 7 + nb.id * 13 + this.stage.idx) % 5 >= 3) continue;   // 이웃 5곳 중 3곳꼴, 시드 결정적
      // 이웃 쪽 방 가장자리(복도 입구 근처)에서 쏟아져 들어온다
      const dx = nb.x - room.x, dz = nb.z - room.z; const l = Math.hypot(dx, dz) || 1;
      const ex = THREE.MathUtils.clamp(room.x + dx / l * room.w / 2, room.x - room.w / 2 + 2.5, room.x + room.w / 2 - 2.5);
      const ez = THREE.MathUtils.clamp(room.z + dz / l * room.h / 2, room.z - room.h / 2 + 2.5, room.z + room.h / 2 - 2.5);
      const delay = 1.1 + wave * 0.9; wave++;
      this.after(delay, () => {
        // 도착 시점에 판단·차감한다 — 미리 빼두면 방이 먼저 닫혔을 때 그 몫이 층에서 증발한다
        if (!this.active || nb.spawned || nb.cleared || this.curRoom !== room) return;
        const k = Math.min(8, Math.floor((this.rosterSize(nb) - (nb.reinforced || 0)) * 0.4));
        if (k < 3) return;
        nb.reinforced = (nb.reinforced || 0) + k;
        this.ui.toast('증원이 몰려온다!', 'red'); audio.waveHorn({ vol: 0.3 }); audio.voice('reinforce', { min: 12 });
        this.fx.groundTex(new THREE.Vector3(ex, 0, ez), 'shockwave', 0xff6040, { r0: 0.4, r1: 4, life: 0.5 });
        for (let i = 0; i < k; i++) this.after(i * 0.1, () => {
          if (!this.active) return;
          const t = (i % 5 === 4 ? R.ranged : R.trash)[(i * 5 + nb.id) % (i % 5 === 4 ? R.ranged.length : R.trash.length)];
          let alive = 0; for (const e of this.enemies) if (e.alive) alive++;
          if (alive >= this.maxAlive) { this.pending.push({ t, room }); return; }
          const a = (i / k) * Math.PI * 2, r = 0.8 + (i % 3) * 0.7;
          this.spawnEnemy(t, null, room, new THREE.Vector3(ex + Math.cos(a) * r, 0, ez + Math.sin(a) * r));
        });
      });
    }
  }
  enterRoom(room) {
    if (!room || room === this.curRoom) return;
    this.curRoom = room;
    room.discovered = true;
    if (room.type === ROOM_TYPE.BOSS && !this.bossFound) { this.bossFound = true; this.ui.toast('보스의 기척이 느껴진다…', 'red'); audio.waveHorn({ vol: 0.55, boss: true }); audio.voice('boss_found'); }
    if (room.cleared || room.spawned) return;
    room.spawned = true;
    const list = this.roomRoster(room);
    if (!list.length) { this.markCleared(room); return; }
    const isBoss = room.type === ROOM_TYPE.BOSS;
    if (isBoss) {
      audio.playMusic(Math.random() < 0.5 ? 'bgm_boss' : 'bgm_boss2'); this.ui.waveBanner('BOSS'); this.renderer.shake(0.5); this.after(0.6, () => audio.voice(`${this.bossKey}_appear`, { min: 10 }));
      // 보스방 입구의 제물 — 봉인 뒤 가장 먼 방까지 걸어오는 20초 + 보스전 초반 20초가 무보상 40초로 이어졌다 (longestDryStreakSec 실측)
      const p = this.player.pos, dx = room.x - p.x, dz = room.z - p.z, l = Math.hypot(dx, dz) || 1;
      const at = new THREE.Vector3(p.x + dx / l * 3.5, 0.6, p.z + dz / l * 3.5);
      this.after(0.5, () => { for (let i = 0; i < 2; i++) { const inst = this.rollDrop('elite'); if (inst) this.drops.spawn(at, 'item', inst, { count: 1, spread: 1.8 }); } this.drops.spawn(at, 'stone', 3, { count: 3, spread: 2 }); this.fx.groundTex(at.clone().setY(0), 'circle_gold', 0xffd060, { r0: 1, r1: 5, life: 0.8, spin: 1 }); });
    }
    else if (room.type === ROOM_TYPE.ELITE) { this.ui.waveBanner('ELITE'); audio.waveHorn({ vol: 0.42 }); audio.voice('elite', { min: 8 }); }
    else if (room.type === ROOM_TYPE.TREASURE) audio.voice('treasure', { min: 8 });
    // 한 번에 다 깔되 동시 상한을 넘으면 큐로
    const initial = Math.min(list.length, this.maxAlive - this.enemies.filter((e) => e.alive).length);
    for (let i = 0; i < initial; i++) this.after(0.08 + i * 0.07, () => this.spawnEnemy(list[i], null, room));
    for (const t of list.slice(initial)) this.pending.push({ t, room });   // 덮어쓰면 이전 방 잔여가 증발해 그 방이 영영 안 닫힌다
    room.pendingCount = list.length;
    if (!isBoss) this.callReinforcements(room);
  }
  markCleared(room) {
    if (room.cleared) return;
    room.cleared = true; this.roomsCleared++;
    if (room.type !== ROOM_TYPE.START) {
      this.ui.toast(`${room.type === ROOM_TYPE.BOSS ? '보스방' : room.type === ROOM_TYPE.ELITE ? '엘리트 구역' : room.type === ROOM_TYPE.TREASURE ? '보물방' : '구역'} 클리어!`, 'gold');
      audio.play('jingle_win1', { vol: 0.45 });
      // 구역 정화 보상 — 장비 1개 확정. 잡몹 8% 드랍만으로는 엘리트 없는 방 두 개가 연달아 빈손이라 무보상 50초가 났다 (하네스 실측)
      if (room.type === ROOM_TYPE.NORMAL || room.type === ROOM_TYPE.ELITE) {
        const p = this.player.pos, f = this.player.forward(new THREE.Vector3());
        const at = new THREE.Vector3(p.x + f.x * 1.5, 0.6, p.z + f.z * 1.5);
        const inst = this.rollDrop(room.type === ROOM_TYPE.ELITE ? 'elite' : 'normal'); if (inst) this.drops.spawn(at, 'item', inst, { count: 1, spread: 1.2 });
        this.drops.spawn(at, 'gold', Math.max(2, Math.floor(6 * this.stage.scale)), { count: 3, spread: 1.6 });
        this.fx.groundTex(at.clone().setY(0), 'circle_gold', 0xffd060, { r0: 0.6, r1: 3.5, life: 0.6, spin: 1 });
      }
      // 보물방은 클리어 시 장비 상자
      if (room.type === ROOM_TYPE.TREASURE) {
        for (let i = 0; i < 3; i++) { const inst = this.rollDrop('elite'); if (inst) this.drops.spawn(new THREE.Vector3(room.x, 0.6, room.z), 'item', inst, { count: 1, spread: 1.6 }); }
        this.drops.spawn(new THREE.Vector3(room.x, 0.6, room.z), 'stone', 8, { count: 3, spread: 2 });
      }
    }
    this.ui.setObjective(this.world); this.ui.setFloorLabel(this.stage.idx, this.world);
    if (room.type === ROOM_TYPE.BOSS) this.after(2.4, () => this.victory());
    if (room.type !== ROOM_TYPE.START && room.type !== ROOM_TYPE.BOSS && this.world.remaining === 1 && !this.world.bossRoom.cleared) this.after(1.2, () => this.unsealBoss());
  }
  /** 보스 봉인 해제 — 마지막 구역을 정화한 순간. 결계가 깨지고 AUTO 도 이제 보스방을 목표로 잡는다 */
  unsealBoss() {
    if (!this.active || !this.world || !this.world.sealed) return;
    this.world.unseal(); this.arena.openSeal(this.fx);
    this.ui.toast('보스의 봉인이 풀렸다!', 'red'); this.ui.waveBanner('봉인 해제'); this.renderer.shake(0.5); this.renderer.flashScreen(0.25, 0xff3050);
    audio.waveHorn({ vol: 0.5, boss: true }); audio.boom({ vol: 0.6, dur: 0.7, low: 60 }); audio.voice('seal_break', { min: 30 });
    this.ui.setObjective(this.world);
    this.openPortal();
  }
  /** 봉인 해제 포탈 — 마지막 구역에서 보스방 문 앞까지. 가장 먼 방까지 20초 넘게 걷는 동안 보상이 끊겼다 (longestDryStreakSec 40~44 실측) */
  openPortal() {
    const W = this.world, B = W.bossRoom, g = W.gates[0]; if (!g) return;
    const p = this.player.pos; const f = this.player.forward(new THREE.Vector3());
    let [px, pz] = W.resolve(p.x, p.z, p.x + f.x * 3, p.z + f.z * 3, 0.8);
    if (Math.hypot(px - p.x, pz - p.z) < 1.5) { px = p.x; pz = p.z; }   // 벽 앞이면 제자리
    const dx = g.x - B.x, dz = g.z - B.z, l = Math.hypot(dx, dz) || 1;
    const exit = new THREE.Vector3(g.x + dx / l * 3.5, 0, g.z + dz / l * 3.5);   // 문 바깥 복도
    const mesh = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.7, 40),
      new THREE.MeshBasicMaterial({ color: 0xff4060, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(px, 0.1, pz); mesh.renderOrder = 3; this.scene.add(mesh);
    this.portal = { pos: new THREE.Vector3(px, 0, pz), exit, mesh, t: 0, cd: 0 };
    this.fx.castCircle(this.portal.pos, 0xff4060, { radius: 2.2, life: 1.2, demon: true }); this.fx.firePillar(this.portal.pos, { height: 5, width: 2.4, life: 0.8, color: 0xff4060 });
    this.ui.toast('보스방으로 가는 포탈이 열렸다', 'gold'); this.after(2.5, () => audio.voice('portal', { min: 30 }));
  }
  usePortal() {
    const P = this.portal; if (!P) return;
    const p = this.player;
    this.fx.firePillar(p.pos, { height: 6, width: 2.4, life: 0.5, color: 0xff4060 }); this.fx.ghost(p.model, 0xff4060, { life: 0.4, opacity: 0.6 });
    p.pos.copy(P.exit); p.kb.set(0, 0, 0); p.vel.set(0, 0, 0); p.invuln = Math.max(p.invuln || 0, 1);
    const rig = this.renderer.rig; rig.target.copy(p.pos); rig.pos.copy(p.pos).add(rig.offset);
    this.fx.castCircle(P.exit, 0xff4060, { radius: 2.4, life: 1, demon: true }); this.fx.burst(P.exit.clone().setY(1.2), 0xff8090, { n: 24, speed: 7, size: 0.4, up: 1 });
    this.renderer.flashScreen(0.5, 0xff3050); audio.whoosh({ vol: 0.6, pitch: 0.6, dur: 0.6 }); audio.vibe(30);
    this.scene.remove(P.mesh); this.portal = null;
  }

  stop() { this.active = false; if (this.portal) { this.scene.remove(this.portal.mesh); this.portal = null; } this.input.enabled = false; this.input.clear(); this.ui.showHud(false); for (const e of this.enemies) e.dispose(); this.enemies.length = 0; for (const p of this.projectiles) if (p.mesh) this.scene.remove(p.mesh); this.projectiles.length = 0; this.player?.dispose(); this.player = null; this.fx.clearAll(); this.drops.clear(); this.timers.length = 0; this.pending.length = 0; this.sp?.clear(); this.renderer.desat = 0; this.world = null; }

  spawnEnemy(type, near = null, room = null, at = null) {
    const def = ENEMIES[type]; if (!def) return; const gltf = this.app.models[def.model]; if (!gltf) return;
    const rm = room || this.curRoom || this.world?.startRoom;
    let pos;
    if (at) { const [x, z] = this.world ? this.world.resolve(rm.x, rm.z, at.x, at.z, 0.6) : [at.x, at.z]; pos = new THREE.Vector3(x, 0, z); }
    else if (near) { const a = Math.random() * Math.PI * 2; pos = near.clone().add(new THREE.Vector3(Math.cos(a) * 3, 0, Math.sin(a) * 3)); }
    else if (this.world && rm) {
      let best = null;
      for (let k = 0; k < 12; k++) {
        const [x, z] = this.world.randomIn(rm, def.boss ? 4 : 2.2);
        const d = this.player ? Math.hypot(x - this.player.pos.x, z - this.player.pos.z) : 99;
        if (!best || d > best.d) best = { x, z, d };
        if (d > (def.boss ? 7 : 5)) break;
      }
      pos = new THREE.Vector3(best.x, 0, best.z);
    } else { const a = Math.random() * Math.PI * 2, r = 11; pos = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r); }
    const e = new Enemy(this, gltf, this.weaponsGltf, def, this.stage.scale, pos);
    e.homeRoom = rm;
    this.enemies.push(e);
    if (def.boss) { this.boss = e; this.ui.showBoss(def.name, true, def.portrait); }
    return e;
  }
  summonMinions(boss, n) { const t = boss.def.summon || 'skel_minion'; for (let i = 0; i < n; i++) this.after(i * 0.12, () => this.spawnEnemy(t, boss.pos)); this.ui.toast(`${boss.def.name}이(가) 병사를 소환했다!`, 'red'); audio.magic({ vol: 0.4, base: 150, notes: [0, -2, -4], step: 0.12, type: 'sawtooth' }); }
  /** 보스 갑옷 파편 — HP 20% 마다 장비·재화가 튄다. 50초 보스전에 60/30% 페이즈 드랍만으로는 보상 공백이 36초까지 벌어졌다 (하네스 실측) */
  bossShed(boss) {
    const at = boss.pos.clone().setY(0.6);
    this.drops.spawn(at, 'gold', Math.max(2, Math.floor((boss.def.gold || 20) * this.stage.scale * 0.25)), { count: 4, spread: 2.5 });
    this.drops.spawn(at, 'stone', 2, { count: 2, spread: 2 });
    const inst = this.rollDrop('elite'); if (inst) this.drops.spawn(at, 'item', inst, { count: 1, spread: 2.2 });
    this.fx.burst(at.clone().setY(1.6 * boss.def.scale), 0xffd080, { n: 16, speed: 7, size: 0.4, up: 1 }); audio.play('hit_plate', { vol: 0.5, rate: 0.8 });
  }
  bossPhase(boss, phase) {
    if (phase === 1) { this.ui.toast('보스 2페이즈!', 'red'); audio.voice(`${this.bossKey}_phase`); this.fx.shockTex(boss.pos, 0xff3030, { r1: 9, life: 0.8 }); }
    else { this.ui.toast(`${boss.def.name} 광폭화!`, 'red'); audio.voice(`${this.bossKey}_enrage`); this.fx.firePillar(boss.pos, { height: 11, width: 3.5, life: 1.2, color: 0xff2020 }); this.renderer.flashScreen(0.4, 0xff2020); this.renderer.shake(0.8); audio.boom({ vol: 0.8, dur: 0.8 }); }
  }
  onEnemyDeath(e) {
    this.kills++; this.waveKilled++; this.player.addUlt(e.isBoss ? 30 : e.isElite ? 16 : 5);
    if (this.sp) this.sp.onKill(e);
    if (this.hasProc('blood_leech') && this.player.alive) { const heal = Math.floor(this.player.maxHp * 0.03); this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal); this.fx.embers(this.player.pos, 0xff3a5a, { n: 4, radius: 0.6, life: 0.6, rise: 2 }); if (this.fx.dmgLayer.children.length < 20) this.fx.damage(this.player.pos, heal, { kind: 'heal', text: '+' + heal }); }
    this.app.eco.s.quests.kills++;
    this.drops.onKill(e, this.stage);
    const big = e.isBoss || e.isElite;
    this.fx.burst(e.pos.clone().setY(1), 0xe0e0ff, { n: big ? 40 : 12, speed: 8, size: 0.4, up: 1 });
    if (big) { this.fx.explosion(e.pos, { size: e.isBoss ? 7 : 4, color: e.isBoss ? 0xff8080 : 0xffd080 }); this.renderer.shake(0.4); }
    else this.fx.dustPuff(e.pos, { size: 2, life: 0.6 });
    audio.play('hit_wood', { vol: 0.3, rate: 1.35, min: 0.05 }); if (big) audio.dark({ vol: 0.4, base: 200, dur: 0.5 });
    // 지속 스폰: 죽은 만큼 큐에서 보충
    if (this.pending.length && this.active) this.after(0.5 + Math.random() * 0.5, () => { if (this.pending.length && this.active) { const n = this.pending.shift(); this.spawnEnemy(n.t, null, n.room); } });
    if (e.isBoss) {
      this.ui.showBoss('', false); this.boss = null;
      this.timeCtl.slowmo(0.15, 1.8); this.renderer.punch(1.4); this.renderer.flashScreen(0.9, 0xffffff); this.renderer.aberr = 2; this.renderer.shake(1);
      this.fx.explosion(e.pos, { size: 12, life: 0.8, color: 0xffd0a0 }); this.fx.holyBurst(e.pos, { size: 14, life: 0.7 });
      this.fx.burst(e.pos.clone().setY(1.5), 0xff5050, { n: 80, speed: 14, size: 0.6, up: 1 }); this.fx.shockTex(e.pos, 0xffd060, { r1: 16, life: 0.9 });
      audio.boom({ vol: 1, dur: 1.4, low: 40 }); audio.play('jingle_win1', { vol: 0.8, delay: 0.8 }); audio.vibe([100, 50, 100, 50, 200]); this.after(0.3, () => audio.voice(`${this.bossKey}_death`)); this.after(3.4, () => audio.voice('boss_kill'));
      this.after(2.6, () => this.victory());
    }
    // 이 방 소속 적이 전멸하면 방 클리어
    const rm = e.homeRoom;
    if (rm && !rm.cleared) {
      const left = this.enemies.some((x) => x.alive && x.homeRoom === rm) || this.pending.some((n) => n.room === rm);
      if (!left) this.markCleared(rm);
    }
  }
  onPlayerDeath() {
    this.renderer.desat = 0.7; this.timeCtl.slowmo(0.3, 1.5); this.renderer.shake(0.6); audio.playMusic(null);
    if (this.hasProc('phoenix_rebirth') && !this.rebirthUsed) { this.phoenixRebirth(); return; }
    audio.voice(`hero_${this.heroId}_death`); this.after(1.6, () => audio.voice('defeat'));
    this.after(1.8, () => { if (this.active) this.ui.showRevive(this); });
  }
  revivePlayer() {
    this.player.revive(); this.renderer.desat = 0; this.revived++; audio.voice(`hero_${this.heroId}_revive`);
    this.fx.holyBurst(this.player.pos, { size: 9, life: 0.6 }); this.fx.shockTex(this.player.pos, 0xffd060, { r1: 9, life: 0.7 });
    this.hitRadius(this.player.pos, 7, 1, { kb: 14, stun: 1.5, kind: 'magic', source: this.player, dirFrom: this.player.pos });
    audio.playMusic(this.boss ? 'bgm_boss' : 'bgm_battle'); audio.magic({ vol: 0.5, base: 523, notes: [0, 4, 7, 12], step: 0.08 });
  }
  defeat() { this.active = false; this.result = { win: false, kills: this.kills, maxCombo: this.maxCombo, dmg: this.dmgDealt, time: this.elapsed }; this.ui.showResult(this, false); }
  victory() {
    if (!this.active) return; this.active = false; this.input.enabled = false; this.input.clear();
    this.player.play('Cheer', { fade: 0.2 }); audio.playMusic(null); audio.play('jingle_win0', { vol: 0.9 }); this.ui.showBoss('', false); setTimeout(() => audio.voice(`hero_${this.heroId}_win`), 1200); setTimeout(() => audio.voice('floor_clear'), 3800);
    this.fx.burst(this.player.pos.clone().setY(1), 0xffd060, { n: 60, speed: 9, size: 0.5, up: 1.5, grav: 6, life: 1.2 }); this.fx.embers(this.player.pos, 0xffe080, { n: 40, radius: 2, life: 2, rise: 3 });
    // 남은 드랍 자동 수거
    this.player.magnetMul = 99;
    const explored = this.world ? this.world.rooms.filter((r) => r.cleared).length / this.world.rooms.length : 1;
    const hpRatio = this.player.hp / this.player.maxHp;
    const stars = this.revived ? 1 : (hpRatio > 0.6 && explored > 0.8) ? 3 : (hpRatio > 0.3 || explored > 0.6) ? 2 : 1;
    this.result = { win: true, stars, kills: this.kills, maxCombo: this.maxCombo, dmg: this.dmgDealt, time: this.elapsed, rooms: this.roomsCleared, totalRooms: this.world ? this.world.rooms.length : 0 };
    this.after(1.6, () => this.ui.showResult(this, true));
  }

  // ---------------- 히트 판정 ----------------
  hitArea(src, pos, yaw, range, arcDeg, dmg, opts = {}) {
    const half = THREE.MathUtils.degToRad(arcDeg) / 2; let n = 0;
    const r2 = (range + 1.5) * (range + 1.5);
    for (const e of this.enemies) {
      if (!e.alive || e.spawning) continue;
      const dx = e.pos.x - pos.x, dz = e.pos.z - pos.z;
      if (dx * dx + dz * dz > r2) continue;
      const d = Math.hypot(dx, dz) - e.radius * 0.6;
      if (d > range) continue;
      const ang = Math.atan2(dx, dz); let diff = Math.abs(ang - yaw); diff = Math.min(diff, Math.PI * 2 - diff);
      if (diff > half && d > 0.9) continue;
      this.damageEnemy(e, dmg, { ...opts, dirx: dx, dirz: dz }); n++;
      if (n >= 24) break;
    }
    return n;
  }
  hitRadius(center, radius, dmg, opts = {}) {
    let n = 0; const r2 = (radius + 1.5) * (radius + 1.5);
    for (const e of this.enemies) {
      if (!e.alive || e.spawning) continue;
      const dx = e.pos.x - center.x, dz = e.pos.z - center.z;
      if (dx * dx + dz * dz > r2) continue;
      if (Math.hypot(dx, dz) - e.radius * 0.5 > radius) continue;
      const from = opts.dirFrom || center;
      this.damageEnemy(e, dmg, { ...opts, dirx: e.pos.x - from.x, dirz: e.pos.z - from.z }); n++;
      if (n >= 30) break;
    }
    return n;
  }
  /** 몹몰이 진공: 반경 안 적을 중심으로 끌어당김 */
  vacuum(center, radius, force = 14) {
    let n = 0;
    if (this._vacSfx === undefined || this.elapsed - this._vacSfx > 0.45) { this._vacSfx = this.elapsed; audio.suck({ vol: 0.22, dur: 0.4 }); }
    for (const e of this.enemies) { if (!e.alive || e.spawning) continue; const dx = e.pos.x - center.x, dz = e.pos.z - center.z; if (dx * dx + dz * dz > radius * radius) continue; e.pull(center.x, center.z, force); n++; }
    return n;
  }
  damageEnemy(e, dmg, opts = {}) {
    const p = this.player; const crit = Math.random() < p.stats.crit;
    let amount = dmg * (0.9 + Math.random() * 0.2) * (crit ? p.stats.critDmg : 1);
    if (this.sp) amount *= this.sp.dmgMul(e);   // 서리 세트: 결정화된 적은 받는 피해 +30%
    const dealt = e.hurt(amount, { ...opts, crit });
    if (dealt <= 0) return;
    if (this.sp && !opts.noProc) this.sp.onHit(e);
    this.dmgDealt += dealt;
    this.combo++; this.comboT = 2.5; this.maxCombo = Math.max(this.maxCombo, this.combo); this.ui.setCombo(this.combo);
    p.addUlt((crit ? 3 : 2) * (p.stats.ultGain || 1));
    const hitPos = e.pos.clone().setY(1.1 * e.def.scale);
    // 다수 타격 시 데미지 숫자 솎아내기 (성능)
    if (this.fx.dmgLayer.children.length < 26 || crit) this.fx.damage(hitPos, dealt, { crit, kind: opts.kind === 'magic' ? 'skill' : '' });
    const dirx = opts.dirx || 0, dirz = opts.dirz || 0;
    const color = opts.kind === 'magic' ? 0xa0e0ff : crit ? 0xffd040 : 0xfff0d0;
    if (!opts.quiet) {
      const heavy = opts.finisher || crit;
      this.fx.flash(hitPos, color, { size: crit ? 3 : 1.8, life: 0.14 });
      this.fx.directional(hitPos, _v.set(dirx, 0, dirz).normalize(), color, { n: crit ? 18 : 8, speed: crit ? 12 : 8 });
      if (crit) { this.fx.texFlash(hitPos, 'holy_burst', 0xffd040, { size: 2.6, life: 0.22, y: 0, grow: 1.4 }); this.fx.light(e.pos, 0xffd040, 6, 6, 0.25); }
      audio.hit(opts.kind || 'slash', { crit, heavy });
      if (!opts.quietStop) this.timeCtl.hitstop(opts.finisher ? 0.1 : crit ? 0.06 : 0.035);
      this.renderer.shake(opts.finisher ? 0.5 : crit ? 0.3 : 0.12);
      if (heavy) audio.vibe(crit ? [10, 10, 25] : 20);
    }
  }

  // ---------------- 투사체 ----------------
  spawnProjectile({ pos, dir, speed, radius, dmg, color, size = 0.4, owner, kb = 2, kind = 'magic', life = 1.2, pierce = false, trail = null, explode = null, hostile = false, visual = undefined }) {
    let mesh = null;
    if (visual !== null && size > 0) { mesh = this.fx.orb(color, size); mesh.position.copy(pos); this.scene.add(mesh); }
    this.projectiles.push({ pos: pos.clone(), dir: dir.clone().normalize(), speed, radius, dmg, color, owner, kb, kind, life, t: 0, pierce, hit: new Set(), mesh, trail, explode, hostile });
  }
  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]; p.t += dt; p.pos.addScaledVector(p.dir, p.speed * dt); if (p.mesh) { p.mesh.position.copy(p.pos); p.mesh.rotation.y += dt * 8; }
      if (p.trail) this.fx.embers(p.pos, p.trail, { n: 2, radius: 0.15, life: 0.35, size: 0.35, rise: 0.5 });
      let done = p.t >= p.life || Math.hypot(p.pos.x, p.pos.z) > 17;
      if (p.hostile) {
        const pl = this.player; if (pl && pl.alive && Math.hypot(pl.pos.x - p.pos.x, pl.pos.z - p.pos.z) < p.radius + 0.6) { pl.hurt(p.dmg, { dirx: p.dir.x, dirz: p.dir.z, kb: p.kb, kind: p.kind }); done = true; this.fx.burst(p.pos, p.color, { n: 12, speed: 5, size: 0.3 }); }
      } else {
        for (const e of this.enemies) {
          if (!e.alive || e.spawning || p.hit.has(e)) continue;
          if (Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) < p.radius + e.radius) {
            p.hit.add(e);
            if (p.explode) { this.explode(p); done = true; break; }
            this.damageEnemy(e, p.dmg, { kb: p.kb, kind: p.kind, dirx: p.dir.x, dirz: p.dir.z, source: p.owner });
            if (!p.pierce) { done = true; this.fx.burst(p.pos, p.color, { n: 10, speed: 5, size: 0.3 }); break; }
          }
        }
      }
      if (done) { if (p.explode && p.t >= p.life && !p.hit.size) this.explode(p); if (p.mesh) this.scene.remove(p.mesh); this.projectiles.splice(i, 1); }
    }
  }
  explode(p) {
    const c = p.pos.clone().setY(0); const ex = p.explode;
    this.hitRadius(c, ex.radius, p.dmg, { kb: p.kb, kind: 'magic', up: true, source: p.owner, dirFrom: c });
    this.fx.explosion(c, { size: ex.radius * 2.2, color: ex.color, life: 0.55 });
    this.fx.shockTex(c, ex.color, { r1: ex.radius * 1.8, life: 0.45 });
    this.fx.burst(c.clone().setY(0.6), ex.color, { n: 30, speed: 11, size: 0.5, up: 1.2, grav: 14 });
    this.fx.dustPuff(c, { size: ex.radius * 1.6 }); this.fx.light(c, ex.color, 12, 12, 0.5); this.fx.scorch(c, { radius: ex.radius * 0.8, life: 4 });
    this.renderer.shake(0.6); this.renderer.punch(0.6); audio.boom({ vol: 0.8, dur: 0.6, low: 60 }); audio.fire({ vol: 0.3, dur: 0.5 }); audio.vibe([40, 20, 50]);
  }

  /** 퍼펙트 회피 — 슬로우모 + 궁극기 게이지 + 반격 창 */
  onPerfectDodge(p) {
    this.timeCtl.slowmo(0.28, 0.42);
    this.renderer.punch(0.7); this.renderer.aberr = 0.6; this.renderer.flashScreen(0.18, 0x9fe4ff);
    this.fx.shockTex(p.pos, 0x9fe4ff, { r1: 4.5, life: 0.4 });
    this.fx.ghost(p.model, 0x9fe4ff, { life: 0.5, opacity: 0.7 });
    this.fx.burst(p.pos.clone().setY(1), 0x9fe4ff, { n: 18, speed: 7, size: 0.35 });
    p.addUlt(14 * (p.stats.ultGain || 1));
    p.buffs.atk = Math.max(p.buffs.atk, 1.35); p.buffs.atkSpd = Math.max(p.buffs.atkSpd, 1.25); p.buffs.t = Math.max(p.buffs.t, 3);
    this.ui.perfectDodge(); audio.bark(`hero_${this.heroId}_perfect`, { vol: 0.95, min: 1.2 }); audio.voice('perfect', { min: 12, duck: 0.7, dur: 0.8 });
    audio.ice({ vol: 0.4, dur: 0.35 }); audio.ting({ vol: 0.45, freq: 2400 }); audio.vibe([15, 25, 40]);
  }

  // ---------------- 궁극기 연출 ----------------
  ultCinematic(sk, p) {
    this.ui.ultCinema(sk.name, p.def);
    this.timeCtl.slowmo(0.25, 0.7); this.renderer.radial = 0.35; this.renderer.punch(1.2); this.renderer.aberr = 0.8;
    audio.duck(0.2, 2.5); audio.play('ui_max', { vol: 0.8, rate: 0.6 }); audio.vibe([60, 30, 60, 30, 120]);
    this.fx.castCircle(p.pos, p.def.color, { radius: 5, life: 1.2 });
    this.fx.light(p.pos, p.def.color, 12, 14, 1.2);
    for (const e of this.enemies) if (e.alive) e.stun = Math.max(e.stun, 0.8);
  }

  // ---------------- 프레임 ----------------
  update(realDt) {
    if (!this.player) return;
    if (this.paused) return;
    const dt = this.timeCtl.step(realDt);
    this.elapsed += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) { const t = this.timers[i]; t.t -= dt; if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); } }
    this.input.update();
    if (this.active) this.player.handleInput(this.input, dt);
    this.player.update(dt);
    if (this.portal) { const P = this.portal; P.t += dt; P.mesh.rotation.z += dt * 1.5; P.mesh.material.opacity = 0.6 + Math.sin(P.t * 5) * 0.25; if (Math.random() < dt * 10) this.fx.embers(P.pos, 0xff6080, { n: 1, radius: 1.2, life: 0.8, size: 0.3, rise: 2.5 }); if (P.t > 0.8 && this.player.alive && this.player.distTo({ pos: P.pos }) < 1.4) this.usePortal(); }
    let alive = 0;
    for (let i = this.enemies.length - 1; i >= 0; i--) { const e = this.enemies[i]; e.update(dt); if (e.dead) { e.dispose(); this.enemies.splice(i, 1); } else if (e.alive && !e.spawning) alive++; }
    if (alive > this.peakAlive) this.peakAlive = alive;   // 층 내 동시 생존 최대 (하네스 maxAliveSeen)
    this.updateProjectiles(dt);
    for (let i = this.holes.length - 1; i >= 0; i--) { const h = this.holes[i]; h.t -= dt; this.vacuum(h.pos, 7, 1.1); if (h.t <= 0) this.holes.splice(i, 1); }
    if (this.sp) this.sp.update(dt);
    this.drops.update(dt);
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) { this.combo = 0; this.ui.setCombo(0); } }
    if (this.player.alive && this.player.hp < this.player.maxHp * 0.25) { audio.voice(`hero_${this.heroId}_low_hp`, { min: 12 }); audio.voice('low_hp', { min: 25 }); }
    // 카메라: 적 밀도에 따라 살짝 줌아웃 (몹몰이 시야 확보)
    const rig = this.renderer.rig;
    // 카메라 리드: 진행 방향으로 살짝 앞서 보고, 락온 대상 쪽으로 조금 당긴다
    _v.copy(this.player.pos);
    const mv = this.player.vel; const sp = Math.hypot(mv.x, mv.z);
    if (sp > 0.5) _v.x += mv.x / sp * Math.min(3.2, sp * 0.42), _v.z += mv.z / sp * Math.min(3.2, sp * 0.42);
    const lt = this.player.lockTarget;
    if (lt && lt.alive) { _v.x += (lt.pos.x - this.player.pos.x) * 0.12; _v.z += (lt.pos.z - this.player.pos.z) * 0.12; }
    rig.target.lerp(_v, 1 - Math.exp(-realDt * 7));
    const near = this.enemies.reduce((a, e) => a + (e.alive && e.distTo(this.player) < 9 ? 1 : 0), 0);
    const zoomOut = Math.min(1, near / 14);
    const bossUp = !!(this.boss && this.boss.alive);
    // AUTO 카메라: 탐험(적 없음·이동 중) → 액션, 난전 → 탑다운, 보스 → 시네마틱. 목표 프리셋을 정하고 base 를 그쪽으로 천천히 보간
    if (rig.preset === 'auto') {
      const want = bossUp ? CAMERA_PRESETS.wide : (near === 0 && sp > 2) ? CAMERA_PRESETS.action : CAMERA_PRESETS.top;
      const k = Math.min(1, realDt * 1.2);
      for (const key of ['y', 'z', 'fov', 'lookY', 'lag']) rig.base[key] += (want[key] - rig.base[key]) * k;
    }
    const b = rig.base;
    const wantY = b.y + zoomOut * 2.2 + (bossUp ? 1.2 : 0), wantZ = b.z + zoomOut * 1.8 + (bossUp ? 1.0 : 0);
    rig.offset.y += (wantY - rig.offset.y) * Math.min(1, realDt * 2);
    rig.offset.z += (wantZ - rig.offset.z) * Math.min(1, realDt * 2);
    rig.fov = b.fov + zoomOut * 3; rig.lag = b.lag; rig.lookOffset.y = b.lookY;
    // 액션 시점일수록 이동 방향으로 살짝 옆에서 본다 (낮은 카메라에서 정면 이동은 캐릭터가 화면을 가린다)
    const actionK = Math.max(0, Math.min(1, (11 - rig.offset.y) / 3));
    const wantSide = sp > 0.5 ? -(mv.x / sp) * 1.6 * actionK : 0;
    rig.side += (wantSide - rig.side) * Math.min(1, realDt * 1.5);
    if (this.world && this.active) {
      const rm = this.world.roomAt(this.player.pos.x, this.player.pos.z);
      if (rm && rm !== this.curRoom) this.enterRoom(rm);
      // 인접 방 살짝 미리보기 (복도에서 보이도록)
      if (this.roomPeekT === undefined) this.roomPeekT = 0;
      this.roomPeekT -= dt;
      if (this.roomPeekT <= 0) { this.roomPeekT = 0.4;
        for (const r of this.world.rooms) {
          if (r.discovered || Math.hypot(r.x - this.player.pos.x, r.z - this.player.pos.z) > r.w / 2 + 12) continue;
          r.discovered = true;
          if (r.type === ROOM_TYPE.BOSS && !this.bossFound) { this.bossFound = true; this.ui.toast('보스의 기척이 느껴진다…', 'red'); audio.waveHorn({ vol: 0.5, boss: true }); this.ui.setObjective(this.world); }
        }
      }
    }
    this.arena.update(realDt, this.fx, this.player.pos);
    this.ui.updateHud(this, realDt);
  }
}
