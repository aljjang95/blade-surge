import * as THREE from 'three';
import { audio } from '../engine/audio.js';
import { RARITY_COLOR, ITEM_BY_ID } from '../data/items.js';
import { LootModelLibrary, updateLootRim } from './loot-models.js';
import { LootAuras, LOOT_IMPACT_TIME } from './loot-auras.js';
import { frontierEffectForStage } from '../data/seasonal-content.js';
import { lootTable, pickLootRarity } from '../data/loot-tables.js';
import { killDrops, grantLootItem } from '../shared/settlement.js';

// 등급별 대기 반짝임(기존 glow 파티클 풀). [간격(초), 크기, 수명]. 저화질은 간격 2배 · S 생략.
const LOOT_SPARKLE = Object.freeze({ S: [1.1, .2, .8], E: [.5, .24, .9], U: [.3, .27, 1], L: [.17, .3, 1.1] });
const SPARKLE_COLORS = Object.fromEntries(Object.entries(RARITY_COLOR).map(([rarity, color]) => [rarity, new THREE.Color(color)]));
const SPARKLE_OPTIONS = Object.freeze({ grav: -1.2, drag: .97, shrink: .15 });
const LAND_SQUASH_TIME = .32;
// 시각 효과 전용 결정적 난수(드랍 번호 · 회차 해시). 게임 로직의 Math.random 흐름을 건드리지 않는다.
const hash01 = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

// Free AI practice pays its catalog reward only; it never creates field loot.
export const fieldDropsAllowed = stage => !stage?.party && stage?.expedition?.kind !== 'arena';

/**
 * 필드 드랍: 코인/장비/강화석이 3D 로 튀어나오고, 플레이어가 가까이 가면 자석처럼 빨려온다.
 * 몹몰이 → 광역 처치 → 드랍 비처럼 쏟아지는 도파민 루프의 핵심.
 */
export class DropSystem {
  constructor(game) {
    this.game = game; this.scene = game.scene;
    this.items = [];
    this.magnetR = 4.2;      // 자석 반경
    this.pickR = 1.1;
    this.gold = 0; this.stones = 0; this.stones2 = 0; this.stones3 = 0; this.fragments = 0; this.loot = [];
    this._geoCoin = null; this._matCache = {};
    // 장비 드랍 = 인벤토리와 같은 3D 원본(장비 id · 등급 단위 공유), 등급 연출 = 인스턴스 바닥 링 · 빛기둥(드로우콜 2).
    this._preparationVisuals = null;
    this._dropSerial = 0; this._time = 0;
  }
  // 라이브러리 · 연출 층은 처음 쓸 때 만든다(시스템이 여러 전투를 거쳐도 하나를 유지한다).
  get lootModels() { return this._lootModels ||= new LootModelLibrary(); }
  get auras() { return this._auras ||= new LootAuras(); }
  /** 실제 드랍과 같은 장비 · 등급 연출 재질을 준비하되 필드·보상 상태에는 등록하지 않는다. */
  preparationVisuals() {
    this._preparationVisuals ||= this.lootModels.preparation();
    // 비동기 준비마다 부모가 독립적인 껍데기를 빌려 주고 형상·재질은 공유한다.
    return [...this._preparationVisuals.map(root => root.clone()), ...this.auras.preparation()];
  }
  setup(dungeonGltf) {
    // 코인 메시 (던전 킷) — 없으면 실린더 폴백
    const src = dungeonGltf?.scene.getObjectByName('coin');
    if (src) { let m = null; src.traverse((o) => { if (!m && o.isMesh) m = o; }); if (m) { this._geoCoin = m.geometry; this._matCoin = m.material; } }
    if (!this._geoCoin) { this._geoCoin = new THREE.CylinderGeometry(0.18, 0.18, 0.05, 10); this._matCoin = new THREE.MeshStandardMaterial({ color: 0xffcf5a, metalness: 0.6, roughness: 0.35, emissive: 0x664400 }); }
    else { this._matCoin = this._matCoin.clone(); this._matCoin.emissive = new THREE.Color(0x553300); }
    this.auras.attach(this.scene);
  }
  _mat(color, emissive = 1.2) {
    const key = color + '|' + emissive;
    if (!this._matCache[key]) this._matCache[key] = new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(emissive), roughness: 0.3, metalness: 0.5 });
    return this._matCache[key];
  }
  /** kind: 'gold' | 'stone' | 'item' */
  spawn(pos, kind, payload, { count = 1, spread = 1 } = {}) {
    if (!fieldDropsAllowed(this.game.stage)) return;
    for (let i = 0; i < count; i++) {
      let mesh;
      if (kind === 'gold') { mesh = new THREE.Mesh(this._geoCoin, this._matCoin); mesh.scale.setScalar(1.1); }
      else if (kind === 'stone') { mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), this._mat(0x4cc3ff, 1.6)); mesh.userData.own = true; }
      else if (kind === 'stone2') { mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), this._mat(0x3a7bff, 2.0)); mesh.userData.own = true; }
      else if (kind === 'stone3') { mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.34), this._mat(0xffd35a, 2.4)); mesh.userData.own = true; }
      else if (kind === 'frag') { mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.1, 6), this._mat(0xb26bff, 2.0)); mesh.userData.own = true; }
      else if (['heroShard', 'transcendStone', 'material'].includes(kind)) {
        // 지역 재료도 기존 강화석과 같은 공유 형상을 재사용한다.
        this._geoMaterial ||= new THREE.OctahedronGeometry(.24);
        mesh = new THREE.Mesh(this._geoMaterial, this._mat(kind === 'transcendStone' ? 0xff5a8a : kind === 'heroShard' ? 0xffcf5a : 0x87cbb0, 1.6));
      }
      else { mesh = this.lootModels.build(payload, { heroId: this.game.heroId, prepare: this._compileLate ||= (object) => this.game.renderer?.r?.compileAsync?.(object, this.game.renderer.camera, this.scene) }); }
      // 시작 높이는 항상 대기 높이보다 위다(키 큰 무기 rest 높이 ≈1.0 이 0.6~0.9 시작보다 높아 첫 프레임에 착지하던 문제). 난수 소비 횟수는 그대로다.
      mesh.position.copy(pos); mesh.position.y = Math.max(0.6 + Math.random() * 0.3, (kind === 'item' ? mesh.userData.lootRestY || .72 : .28) + .25);
      mesh.castShadow = false;
      const a = Math.random() * Math.PI * 2, s = (1.5 + Math.random() * 2.5) * spread;
      const it = { mesh, kind, payload, restY: kind === 'item' ? mesh.userData.lootRestY || .72 : .28, vx: Math.cos(a) * s, vy: 4 + Math.random() * 3, vz: Math.sin(a) * s, t: 0, state: 'fly', spin: (Math.random() - 0.5) * 8 };
      this.scene.add(mesh); this.items.push(it);
      if (kind === 'item') {
        // 등급 연출 슬롯(바닥 링 · 기둥)과 착지 · 반짝임 시계. 반짝임 위치는 드랍 번호 해시라 게임 난수를 소비하지 않는다.
        it.rarity = payload.rarity || ITEM_BY_ID[payload.id]?.rarity || 'N';
        it.aura = this.auras.acquire(it.rarity); it.serial = this._dropSerial = (this._dropSerial || 0) + 1; it.land = -1; it.fade = 1; it.spark = 0; it.sparks = 0;
        // 병기고 원본이 늦게 읽히면 그 자리에서 바뀐 모델 높이로 대기 높이를 맞춘다.
        if (mesh.userData.lootPendingSource) mesh.userData.onLootReady = () => { it.restY = mesh.userData.lootRestY || it.restY; };
      }
      // 희귀 장비는 튀어나올 때 충격파·섬광(빛기둥은 착지 후 등급 연출 층이 세운다)
      if (kind === 'item' && ['E', 'U', 'L'].includes(payload.rarity)) {
        this.game.fx.groundTex(pos, 'shockwave', RARITY_COLOR[payload.rarity], { r0: 0.3, r1: 3, life: 0.6 });
        if (payload.rarity === 'L') { this.game.fx.holyBurst(pos, { size: 5, color: 0xff9a2e }); audio.play('jingle_legend', { vol: 0.7 }); this.game.renderer.flashScreen(0.25, 0xff9a2e); }
        else if (payload.rarity === 'U') { this.game.fx.holyBurst(pos, { size: 4, color: 0xc07cff }); audio.play('ui_glass', { vol: 0.7, rate: 0.9 }); }
        else audio.play('ui_glass', { vol: 0.6, rate: 1.2 });
      }
    }
  }
  update(dt) {
    const p = this.game.player; if (!p) return;
    const magnet = p.alive ? this.magnetR * (p.magnetMul || 1) : 0;
    this._time = (this._time || 0) + dt; updateLootRim(this._time);
    const auras = this.auras; if (auras.scene !== this.scene) auras.attach(this.scene);
    auras.setLite(!!this.game.fx?.lite);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]; it.t += dt;
      const m = it.mesh;
      if (it.state === 'fly') {
        it.vy -= 22 * dt;
        m.position.x += it.vx * dt; m.position.y += it.vy * dt; m.position.z += it.vz * dt;
        it.vx *= Math.pow(0.1, dt); it.vz *= Math.pow(0.1, dt);
        // 하강 중에만 착지한다: 솟구치는 동안 대기 높이 아래에 있어도 포물선 · 수평 퍼짐을 끝까지 탄다.
        if (it.vy < 0 && m.position.y <= it.restY) {
          m.position.y = it.restY; it.state = 'idle'; it.vy = 0;
          if (it.kind === 'item') { m.rotation.set(-.42, m.rotation.y, 0); it.land = 0; }
        }
        m.rotation.y += it.spin * dt; m.rotation.x += it.spin * 0.5 * dt;
      } else if (it.state === 'idle') {
        if (it.kind === 'item') {
          // 장비는 앞면(날 · 갑옷 정면)을 카메라 쪽으로 두고 천천히 흔들려 실루엣이 옆날로 사라지지 않는다.
          const cam = this.game.renderer?.camera?.position, face = cam ? Math.atan2(cam.x - m.position.x, cam.z - m.position.z) : m.rotation.y;
          const target = face + Math.sin(it.t * 1.25 + it.serial) * .55;
          m.rotation.y += Math.atan2(Math.sin(target - m.rotation.y), Math.cos(target - m.rotation.y)) * Math.min(1, dt * 5);
        } else m.rotation.y += 2.2 * dt;
        m.position.y = it.restY + Math.sin(it.t * 3.2) * (it.kind === 'item' ? .09 : .12);
        if (it.kind === 'item') this._idleItem(it, m, dt);
        const d = Math.hypot(p.pos.x - m.position.x, p.pos.z - m.position.z);
        if (d < magnet) { it.state = 'magnet'; if (it.kind === 'item') m.scale.setScalar(1); }
        else if (it.t > 22) { this._remove(i); continue; }  // 오래된 드랍 정리
      } else if (it.state === 'magnet') {
        const dx = p.pos.x - m.position.x, dy = (p.pos.y + 0.9) - m.position.y, dz = p.pos.z - m.position.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        const sp = 9 + it.t * 6;
        m.position.x += dx / d * sp * dt; m.position.y += dy / d * sp * dt; m.position.z += dz / d * sp * dt;
        m.rotation.y += 9 * dt;
        if (it.fade > 0) it.fade = Math.max(0, it.fade - dt * 7);
        if (d < this.pickR) { this.collect(it); this._remove(i); continue; }
      }
      if (it.aura !== undefined) {
        // 바닥 링은 착지점을 따라 머물고(자석 중에는 빠르게 사라짐), 기둥은 착지 후 솟는다.
        const landed = it.land >= 0, k = landed ? Math.min(1, it.land / LOOT_IMPACT_TIME) : 0;
        const rise = landed ? 1 - Math.pow(1 - Math.min(1, it.land / .35), 3) : 0;
        auras.set(it.aura, it.rarity, m.position.x, m.position.z, k, landed ? it.fade : 0, rise);
      }
    }
    auras.update(dt);
  }
  /** 대기 중 장비: 착지 스쿼시와 등급 반짝임. 할당 없이 미리 만든 색 · 옵션만 쓴다. */
  _idleItem(it, m, dt) {
    if (it.land >= 0 && it.land < 2) {
      it.land += dt;
      if (it.land < LAND_SQUASH_TIME) {
        const k = it.land / LAND_SQUASH_TIME, a = Math.sin(k * Math.PI * 2) * (1 - k) * .3;
        m.scale.set(1 + a * .5, 1 - a, 1 + a * .5);
      } else m.scale.setScalar(1);
    }
    const spec = LOOT_SPARKLE[it.rarity], fx = this.game.fx;
    if (!spec || !fx?.glow?.emitIfFree || (fx.lite && it.rarity === 'S')) return;
    it.spark += dt;
    const interval = spec[0] * (fx.lite ? 2 : 1);
    if (it.spark < interval) return;
    it.spark -= interval; const n = ++it.sparks, s = it.serial;
    const angle = hash01(s, n) * 6.2831853, radius = .25 + hash01(n, s) * .45;
    // 풀이 가득 차면 건너뛴다(emit 의 교체 분기는 Math.random 을 써서 시드 전투 결정성을 깬다).
    fx.glow.emitIfFree(m.position.x + Math.cos(angle) * radius, m.position.y - .35 + hash01(s + 3, n) * .7, m.position.z + Math.sin(angle) * radius,
      0, .55 + hash01(n + 7, s) * .6, 0, SPARKLE_COLORS[it.rarity], spec[1] * (.7 + hash01(s, n + 11) * .6), spec[2], SPARKLE_OPTIONS);
  }
  _remove(i) {
    const it = this.items[i]; this.scene.remove(it.mesh);
    if (it.mesh.userData.own) it.mesh.geometry.dispose();
    // 비동기 원본 교체가 남았다면 취소한다(형상 · 재질은 라이브러리가 소유한다).
    delete it.mesh.userData.lootPendingSource;
    if (it.aura !== undefined) this.auras.release(it.aura);
    this.items.splice(i, 1);
  }
  collect(it) {
    if (!fieldDropsAllowed(this.game.stage)) return;
    const g = this.game; const p = g.player;
    const pos = p.pos.clone().setY(1.3);
    if (it.kind === 'gold') {
      this.gold += it.payload; g.ui.flyReward(pos, `+${it.payload}`, g.renderer.camera, 'gold');
      audio.coinPick(this._coinIdx = ((this._coinIdx || 0) + 1) % 14);
      g.fx.burst(pos, 0xffcf5a, { n: 3, speed: 3, size: 0.25, life: 0.3 });
    } else if (it.kind === 'stone') {
      this.stones += it.payload; g.ui.flyReward(pos, `강화석 +${it.payload}`, g.renderer.camera, 'stone');
      audio.ice({ vol: 0.3, dur: 0.3 }); g.fx.burst(pos, 0x4cc3ff, { n: 5, speed: 4, size: 0.25, life: 0.35 });
    } else if (it.kind === 'stone2' || it.kind === 'stone3') {
      const hi = it.kind === 'stone3'; this[hi ? 'stones3' : 'stones2'] += it.payload;
      g.ui.flyReward(pos, `${hi ? '전설' : '상급'} 강화석 +${it.payload}`, g.renderer.camera, 'stone');
      audio.ice({ vol: 0.4, dur: 0.4 }); if (hi) audio.play('ui_glass', { vol: 0.5, rate: 1.4 });
      g.fx.burst(pos, hi ? 0xffd35a : 0x3a7bff, { n: 9, speed: 5, size: 0.3, life: 0.4 });
    } else if (it.kind === 'frag') {
      this.fragments += it.payload; g.ui.flyReward(pos, `세트 조각 +${it.payload}`, g.renderer.camera, 'stone');
      audio.magic({ vol: 0.25, base: 520, notes: [0, 7, 12], step: 0.04 }); g.fx.burst(pos, 0xb26bff, { n: 8, speed: 5, size: 0.3, life: 0.4 });
    } else if (['heroShard', 'transcendStone', 'material'].includes(it.kind)) {
      const ledger = this.fieldLedger();
      if (!ledger || ledger.settled) return;
      if (it.kind === 'heroShard') ledger.heroShards += it.payload;
      else if (it.kind === 'transcendStone') ledger.transcendStones += it.payload;
      else ledger.materials[it.payload.id] = (ledger.materials[it.payload.id] || 0) + it.payload.n;
      const name = it.kind === 'heroShard' ? '영웅 조각' : it.kind === 'transcendStone' ? '초월석' : '지역 재료';
      g.ui.flyReward(pos, `${name} +${it.payload.n || it.payload}`, g.renderer.camera, 'stone');
      g.fx.burst(pos, 0xffcf5a, { n: 5, speed: 4, size: .25, life: .35 });
    } else {
      this.loot.push(it.payload);
      const def = ITEM_BY_ID[it.payload.id];
      g.ui.lootPopup(def, it.payload.rarity);
      audio.loot(it.payload.rarity);
      g.fx.burst(pos, RARITY_COLOR[it.payload.rarity], { n: 14, speed: 6, size: 0.35, life: 0.5 });
      this._pickupFx(pos, it.payload.rarity);
      audio.vibe(it.payload.rarity === 'L' ? [40, 30, 90] : it.payload.rarity === 'U' ? [30, 20, 50] : 20);
      if (it.payload.rarity === 'L') audio.voice('legend_drop', { min: 5 }); else if (it.payload.rarity === 'U') audio.voice('unique_drop', { min: 8 });
    }
  }
  /** 획득 연출 강화: E 부터 등급 색 성광, U 는 바닥 고리, L 은 빛기둥·순간 광원까지. 이벤트 1회라 프레임 비용이 없다. */
  _pickupFx(pos, rarity) {
    const fx = this.game.fx, color = RARITY_COLOR[rarity];
    if (!fx || !['E', 'U', 'L'].includes(rarity)) return;
    fx.holyBurst(pos, { size: rarity === 'L' ? 4.6 : rarity === 'U' ? 3.4 : 2.4, color, life: .42 });
    fx.light?.(pos, color, rarity === 'L' ? 7 : 4, 7, .35);
    if (rarity === 'E') return;
    fx.ring?.(pos.clone().setY(0), color, { r0: .3, r1: rarity === 'L' ? 3.4 : 2.4, life: .45, width: .35 });
    if (rarity === 'L') {
      if (!fx.lite) fx.pillar?.(pos.clone().setY(0), color, { radius: .55, height: 7, life: .6 });
      fx.burst(pos, 0xfff0c0, { n: 18, speed: 7, size: .32, life: .6, up: .9 });
    }
  }
  /** 적 처치 시 드랍 롤 */
  onKill(enemy, stage) {
    if (!fieldDropsAllowed(stage) || !fieldDropsAllowed(this.game.stage)) return;
    // 무리 졸개는 몰이 밀도만 더한다. 보상은 기존 명단·방 정화에서만 나온다.
    if (enemy.packFollower) return;
    this.fieldLedger();
    const rank = enemy.isBoss ? 'boss' : enemy.isElite ? 'elite' : 'normal';
    // 서버 런 티켓(MMO P1)이 있으면 서버가 정산 때 같은 lootSeed로 재생성할 드랍을 그대로 보여 준다.
    if (Number.isInteger(this.game.v1Run?.lootSeed) && !stage.expedition) { this.onSeededKill(enemy, stage, rank); return; }
    const table = lootTable(stage.ch, rank, stage.difficultyId || stage.campaignDifficulty?.id || 'story');
    const pos = enemy.pos.clone();
    const g = enemy.def.gold || 1;
    const goldAmt = Math.max(1, Math.floor(g * stage.scale * table.goldMultiplier * (0.8 + Math.random() * 0.5)));
    this.spawn(pos, 'gold', goldAmt, { count: enemy.isBoss ? 8 : enemy.isElite ? 3 : 1, spread: enemy.isBoss ? 2 : 1 });
    const frontier = frontierEffectForStage(stage);
    if (!enemy.summoned && frontier?.kind === 'goldPerKill') this.spawn(pos, 'gold', frontier.value, { count: 1, spread: 0.7 });
    if (table.stoneChance === 1 || Math.random() < table.stoneChance) this.spawn(pos, 'stone', table.stones, { count: 1 });
    // 비석 상위 등급: 엘리트 → 상급, 보스 → 전설. 세트 조각은 엘리트·보스에서만 (제작 30개)
    if (table.stones2) this.spawn(pos, 'stone2', table.stones2, { count: 1 });
    if (table.stones3) this.spawn(pos, 'stone3', table.stones3, { count: 1 });
    if (table.fragments && (table.fragmentChance === 1 || Math.random() < table.fragmentChance)) this.spawn(pos, 'frag', table.fragments, { count: 1, spread: 1.5 });
    // 소환된 적은 기존처럼 기본 골드·강화석만 남기고 새 성장 재료는 주지 않는다.
    if (this._ledger && !enemy.summoned) {
      if (Math.random() < table.heroShards.chance) this.spawn(pos, 'heroShard', table.heroShards.n);
      if (Math.random() < table.transcendStones.chance) this.spawn(pos, 'transcendStone', table.transcendStones.n);
      for (const material of table.materials) {
        if (material.chance === 1 || Math.random() < material.chance) this.spawn(pos, 'material', { id: material.id, n: material.n });
      }
    }
    // 장비: 엘리트 확정, 보스 2개, 잡몹 낮은 확률
    // 장비: 보스 3, 엘리트 2, 잡몹 8% — 자주 떨어지되 대부분 흰·초록 (등급 가중치가 희소성을 만든다)
    const rolls = table.gearChance === 1 || Math.random() < table.gearChance ? table.gearRolls : 0;
    for (let i = 0; i < rolls; i++) {
      const eco = this.game.app?.eco, rarity = pickLootRarity(table.gearWeights);
      const inst = eco?.fieldDrop ? { ...eco.fieldDrop(rarity), rarity } : this.game.rollDrop(rank);
      if (inst) this.spawn(pos, 'item', inst, { count: 1, spread: 1.4 });
    }
  }
  /** 시드 드랍: 계급별 처치 순번으로 서버와 같은 순수 함수를 굴린다. 처치 수는 정산 보고에 쓴다. */
  onSeededKill(enemy, stage, rank) {
    const counts = enemy.summoned ? (this.summonedKills ||= { normal: 0, elite: 0, boss: 0 }) : (this.killCounts ||= { normal: 0, elite: 0, boss: 0 });
    const index = counts[rank]++, pos = enemy.pos.clone(), eco = this.game.app?.eco;
    for (const d of killDrops(stage, this.game.v1Run.lootSeed, rank, index, { summoned: !!enemy.summoned })) {
      if (d.kind === 'gold') this.spawn(pos, 'gold', d.amount, { count: d.count, spread: rank === 'boss' ? 2 : 1 });
      else if (d.kind === 'material') this.spawn(pos, 'material', { id: d.id, n: d.n });
      else if (d.kind === 'item') { if (!eco) continue; const inst = grantLootItem(eco, d); eco.save(); this.spawn(pos, 'item', { ...inst, rarity: d.rarity }, { count: 1, spread: 1.4 }); }
      else this.spawn(pos, d.kind, d.n, { count: 1, spread: d.kind === 'frag' ? 1.5 : 1 });
    }
  }
  fieldLedger() {
    if (!this._ledger || this._ledger.stage !== this.game.stage) this._ledger = this.game.app?.eco?.beginFieldRewards?.(this.game.stage, this.game.heroId);
    return this._ledger;
  }
  clear() {
    this.game.app?.eco?.discardFieldRewards?.(this._ledger); this._ledger = null;
    while (this.items.length) this._remove(this.items.length - 1);
    this.auras.update(0);
    this.gold = 0; this.stones = 0; this.stones2 = 0; this.stones3 = 0; this.fragments = 0; this.loot = [];
    this.killCounts = null; this.summonedKills = null;
  }
}
