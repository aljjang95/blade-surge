// 지역 고유 적 행동 — 같은 해골·오크라도 '그 지역에서 싸우면' 다르게 움직인다. 지역마다 기존 상징 행동(잠복형·종지기) 위에 하나 이상을 더한다.
// 정원·종탑: 망각의 잔향(평타로 쓰러진 해골은 한 번 다시 일어남 → 마무리 타격·스킬로 뼈를 부숴라)
// 용광로: 용융 잔해(쓰러진 자리에 쇳물) · 서리: 서리 손톱(맞을수록 느려지고 세 겹이면 잠시 얼어붙음, 회피로 털어 냄)
// 심해: 역류 소용돌이(쓰러진 자리의 소용돌이가 주변 적을 빨아들임 = 몰이 보조) + 촉수 낚아채기(부유 촉수의 사슬 끌기)
// 왕관: 왕의 칙령(분대 기수가 살아 있는 동안 분대 피해 감소) + 그림자 걸음(그림자 닌자가 영웅 뒤로 도약)
// 캠페인 전투만(원정·파티 제외). 시간은 dt 만 쓰고 프레임 루프에서 새 객체를 만들지 않는다(고정 풀).
import * as THREE from 'three';
import { audio } from '../engine/audio.js';
import { EliteAffixes } from './elite-affixes.js';

export const REGION_TRAITS = {
  garden: { id: 'echo', name: '망각의 잔향', hint: '평타로 쓰러진 해골은 한 번 다시 일어납니다. 마무리 타격·스킬로 뼈를 부수세요.' },
  crypt: { id: 'echo', name: '망각의 잔향', hint: '평타로 쓰러진 해골은 한 번 다시 일어납니다. 마무리 타격·스킬로 뼈를 부수세요.' },
  forge: { id: 'slag', name: '용융 잔해', hint: '쓰러진 적 일부가 쇳물을 남깁니다. 쇳물 밖에서 싸우세요.' },
  frost: { id: 'chill', name: '서리 손톱', hint: '서리 적에게 맞을수록 느려지고 세 겹이면 잠시 얼어붙습니다. 회피로 털어 내세요.' },
  tide: { id: 'undertow', name: '역류 소용돌이', hint: '쓰러진 심해 적의 소용돌이가 주변 적을 빨아들입니다. 그 자리를 쓸어 내세요.' },
  crown: { id: 'decree', name: '왕의 칙령', hint: '금빛 기수가 살아 있는 동안 그 분대가 단단합니다. 기수부터 쓰러뜨리세요.' },
};
// 지역 전용 종에 붙는 두 번째 동사(기존 정예 접두사 동작을 일반 몹 주기로 재사용).
export const REGION_SPECIES_VERBS = {
  tide: { squidle: { key: 'tether', name: '촉수 낚아채기' } },
  crown: { ninja: { key: 'blink', name: '그림자 걸음' } },
};
const SKELETAL = /^Skeleton_|Skull/;
const POOLS = 12;
const _v = new THREE.Vector3();

export function regionTheme(stage) {
  if (!stage || !Number.isInteger(stage.st) || stage.expedition || stage.party) return null;
  return stage.chapter?.id === 7 ? 'crypt' : stage.chapter?.theme || null;
}

export class RegionTraits {
  constructor(game) {
    this.game = game; this.theme = regionTheme(game.stage);
    this.trait = this.theme ? REGION_TRAITS[this.theme] : null;
    this.pools = Array.from({ length: POOLS }, () => ({ x: 0, z: 0, life: 0, arm: 0, kind: '' })); this.poolI = 0; this.burnT = 0;
    this.chill = 0; this.chillT = 0; this.announced = false;
  }
  get active() { return !!this.trait; }
  announce() {
    if (this.announced || !this.trait) return; this.announced = true;
    this.game.ui?.toast?.(`지역 특성 · ${this.trait.name} — ${this.trait.hint}`, 'gold');
  }
  /** 생성 직후: 지역 전용 종 동사와 왕관 기수. */
  attach(e, role) {
    if (!this.trait || e.isBoss || e.isElite || e.summoned) return;
    const verb = REGION_SPECIES_VERBS[this.theme]?.[e.runtimeSpeciesId];
    if (verb && !e.affixes) {
      e.affixes = new EliteAffixes(e, [verb.key], { trash: true }); e.regionVerb = verb.name;
      if (!this.verbAnnounced) { this.verbAnnounced = true; this.game.ui?.toast?.(`지역 적 · ${e.def.name} — ${verb.name}: ${verb.key === 'tether' ? '예고선 뒤 영웅을 끌어당깁니다. 선이 닿기 전에 회피하세요.' : '멀어지면 영웅 뒤로 도약합니다. 도착 원을 보고 비키세요.'}`, 'gold'); }
    }
    if (this.trait.id === 'decree' && role === 'line' && e.pack && !e.pack.herald) {
      e.herald = true; e.tintEmissive = new THREE.Color(.45, .32, .05);
      e.pack.herald = e; this.announce();
    }
  }
  /** 받는 피해: 칙령 기수가 살아 있는 분대는 35% 덜 받는다. */
  filter(e, dmg) {
    const h = e.pack?.herald;
    return h && h !== e && h.alive && h.distTo(e) < 8 ? dmg * .65 : dmg;
  }
  /** 적이 영웅을 때렸을 때(서리 손톱). */
  onPlayerHit(enemy, target) {
    if (this.trait?.id !== 'chill' || enemy.isBoss || !target || target !== this.game.player) return;
    this.chill = Math.min(3, this.chill + 1); this.chillT = 4;
    target.slow = .5; target.slowT = Math.max(target.slowT || 0, 1.6);
    if (this.chill >= 3) {
      this.chill = 0; target.stun = Math.max(target.stun || 0, .7);
      this.game.fx.damage(target.pos, 0, { text: '빙결!' }); this.game.fx.shockTex(target.pos, 0x85dfff, { r1: 2.2, life: .35 }); audio.shatter?.({ vol: .4 });
    }
  }
  /** 적이 쓰러졌을 때. flair 가 없으면 평타 처치다. */
  onDeath(e, flair) {
    if (!this.trait || e.isBoss) return;
    const g = this.game, id = this.trait.id;
    if (id === 'echo' && !flair && !e.echoed && !e.summoned && !e.isElite && SKELETAL.test(e.def.model || '')) {
      const room = e.homeRoom, type = e.runtimeSpeciesId, x = e.pos.x, z = e.pos.z;
      if (!room || !type) return;
      room.spawnsDue = (room.spawnsDue || 0) + 1;
      g.fx.groundTex(_v.set(x, 0, z), 'circle_demon', 0xbfe8ff, { r0: .6, r1: 1.6, life: 1.6, spin: 1.2, fadeIn: .1, hold: 1.2 });
      g.after(1.6, () => {
        if (g.active && !room.cleared) {
          const r = g.spawnEnemy(type, null, room, new THREE.Vector3(x, 0, z));
          if (r) {
            r.echoed = true; r.summoned = true; r.xpReward = 0; r.hp = r.maxHp * .4; r.reactT = 0; if (r.pack) r.pack.aggro = true;
            r.tintEmissive = new THREE.Color(.15, .3, .45);
            g.fx.damage(r.pos, 0, { text: '잔향' });
          }
        }
        g.settleRoomSpawn?.(room);
      });
      this.announce();
    } else if (id === 'slag' && !e.summoned && (e.packId % 4 === 0) && this.activePools('slag') < 4) {
      this.pool(e.pos.x, e.pos.z, 'slag', 3.5); this.announce();
    } else if (id === 'undertow' && !e.summoned && (e.packId % 2 === 0)) {
      this.pool(e.pos.x, e.pos.z, 'undertow', 1.2); this.announce();
      g.fx.groundTex(_v.set(e.pos.x, 0, e.pos.z), 'circle_gold', 0x48dabd, { r0: 5, r1: .6, life: 1.2, spin: -2.5, fadeIn: .05 });
    }
  }
  activePools(kind) { let n = 0; for (const p of this.pools) if (p.life > 0 && p.kind === kind) n++; return n; }
  pool(x, z, kind, life) {
    // 쇳물은 0.9초 동안 식은 테두리로 예고한 뒤에만 데운다(몰이 중 발밑에서 바로 데이지 않게).
    const p = this.pools[this.poolI++ % POOLS]; p.x = x; p.z = z; p.life = life + (kind === 'slag' ? .9 : 0); p.arm = kind === 'slag' ? .9 : 0; p.kind = kind;
    if (kind === 'slag') {
      this.game.fx.ring(_v.set(x, 0, z), 0xff6a1a, { r0: 1.1, r1: 1.3, telegraph: true, life: .9, y: .06, width: 1 });
      this.game.fx.groundTex(_v, 'circle_demon', 0xff6a1a, { r0: 1.2, r1: 1.3, life: life + .9, spin: .2, fadeIn: .9, hold: life - .6 });
    }
  }
  update(dt) {
    if (!this.trait) return;
    const g = this.game, p = g.player;
    if (this.chillT > 0 && (this.chillT -= dt) <= 0) this.chill = 0;
    if (p?.state === 'dodge') this.chill = 0;
    this.burnT -= dt;
    for (const pl of this.pools) {
      if (pl.life <= 0) continue;
      pl.life -= dt; if (pl.arm > 0 && (pl.arm -= dt) > 0) continue;
      if (pl.kind === 'slag') {
        if (p?.alive && this.burnT <= 0 && Math.hypot(p.pos.x - pl.x, p.pos.z - pl.z) < 1.3) { this.burnT = .5; p.hurt(p.maxHp * .015, { dirx: 0, dirz: 0, kb: 0, kind: 'fire' }); }
      } else if (pl.kind === 'undertow') {
        for (const e of g.enemies) if (e.alive && !e.spawning && !e.isBoss && Math.hypot(e.pos.x - pl.x, e.pos.z - pl.z) < 5) e.gather?.(pl.x, pl.z, 6, .12);
      }
    }
    if (this.trait.id === 'decree') {
      // 기수는 1.5초마다 금빛 고리를 울려 눈에 띈다.
      this.heraldT = (this.heraldT || 0) - dt;
      if (this.heraldT <= 0) { this.heraldT = 1.5; for (const e of g.enemies) if (e.herald && e.alive) g.fx.ring(e.pos, 0xffd060, { r0: .8, r1: 1.4, life: .5, y: .06, width: .5 }); }
    }
  }
}
