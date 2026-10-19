// 조준 표시 = 실제 판정 범위 진실 검사.
// 영웅이 고정 조준(방향·거리 고정)으로 스킬을 시전하고, 표시 모양(playerSkillAimShape)의 안쪽 경계 0.5m 안과 바깥 경계 0.8m 밖에 놓은
// 고정 표본 적(움직이지도 공격하지도 않음, 체력 사실상 무한)이 실제로 피해를 받는지 e.hurt 호출로 기록한다.
//   - 안쪽 표본은 모두 맞아야 하고, 바깥 표본은 하나도 맞지 않아야 통과한다. 범위 스킬인데 맞은 안쪽 표본이 0이면 실패다.
//   - 표본은 시전마다 하나씩 따로 세운다(투사체가 먼저 닿은 표본에서 멈추거나 연쇄가 이웃으로 번지는 상호 간섭을 없애기 위해).
//   - 개발 서버 전용 import를 쓰지 않는다. window.app, window.__skillAimShape(src/main.js 노출), window.__THREE, window.__EN만 쓰므로 정식 빌드에서도 돈다.
//   - 적은 update를 막아 움직임이 없다. 단, 끌어당김(몰이: gather/vacuum) 스킬은 PULL_SKILLS 표본만 실제 Enemy.update(AI는 spawn 상태로 고정,
//     이동은 몰이·넉백 물리만)로 돌려 끌려온 위치 기준으로 맞는지 잰다. 규칙: 끌려오는 범위 안(envelope, envelopeKind='pull')의 일반 적은 맞고,
//     그 바깥 0.8m 밖은 맞지 않아야 한다. 정예는 몰이 속도 절반, 보스는 15%라 일반 적 기준 한계 안쪽까지만 보장하지 않는다.
//   - 교관 강화 변형(town trainer)은 app.eco.s.towns.learned에 실제 교관 id를 넣어 playerSkillAimShape와 실제 시전이 모두 그 변형으로 돌게 한다.
//   - chain은 첫 표적(탐색 반경)과 후속 도약(직전 표적에서 7m)을 따로 잰다: 도약 안(6.5m)은 맞고 도약 밖(7.8m)은 맞지 않아야 한다.
// 사용: node tools/aim-hitbox-truth-qa.mjs <origin> [출력폴더] [영웅목록 knight,guardian,barbarian,mage,rogue,ranger]
//   환경변수 AIM_ONLY=skill_id,skill_id 로 일부 스킬만 돌릴 수 있다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const origin = (process.argv[2] || 'http://127.0.0.1:5195').replace(/\/$/, '');
const out = path.resolve(process.argv[3] || 'work/cycles/20261019-aim-hitbox-truth/qa');
const heroArg = (process.argv[4] || 'knight,guardian,barbarian,mage,rogue,ranger').split(',');
const only = process.env.AIM_ONLY ? process.env.AIM_ONLY.split(',') : null;
const IN_DEPTH = 0.5, OUT_GAP = 0.8, ENEMY_RADIUS = 0.7;
await fs.mkdir(out, { recursive: true });

// 표시 모양이 범위를 그리지 않는 자기 강화 스킬. 이유를 보고서에 그대로 적는다.
const NO_AREA = {
  berserk: '자기 강화(8초 공격력 +60%): 피해 판정이 없고 표시도 범위를 그리지 않는다.',
  guardian_guard: '자기 방어(0.75초 방패): 피해 판정이 없고 표시도 범위를 그리지 않는다. 방어 성공 시 반격 4m는 별도 이벤트다.',
};
// 시전마다 무작위가 판정에 들어가는 스킬. 시드를 여러 개 돌려 안쪽은 전부 맞고 바깥은 한 번도 안 맞아야 통과한다.
const RANDOM_SEEDS = { meteor: 6, thousand: 6, void_step: 4, arc_reflect: 3 };
// 교관 강화 변형: [표시 이름, 교관 id]. 해당 영웅이 배운 상태로 shape와 시전을 함께 잰다(src/data/towns.js TOWN_TRAINER).
const TOWN_VARIANTS = {
  shield_bash: [['교관 여진', 'oathhold_knight_aftershock']], quake: [['교관 여진', 'oathhold_barbarian_aftershock']],
  fireball: [['교관 분열', 'oathhold_mage_split']], poison_bomb: [['교관 확장', 'oathhold_rogue_wide']], ranger_volley: [['교관 추가탄', 'oathhold_ranger_extra']],
  judgment: [['교관 인력', 'emberport_knight_pull']], whirlwind: [['교관 확장', 'emberport_barbarian_wide']], chain: [['교관 빙결', 'emberport_mage_bind']],
  flurry: [['교관 잔향', 'emberport_rogue_echo']], ranger_binding: [['교관 속박', 'emberport_ranger_root']], holy_slash: [['교관 여명', 'starcrest_knight_nova']],
  bloodquake: [['교관 혈진', 'starcrest_barbarian_blood']], blizzard: [['교관 확장', 'starcrest_mage_blizzard']], night_parade: [['교관 확장', 'starcrest_rogue_parade']],
  ranger_pierce: [['교관 판정강화', 'starcrest_ranger_pierce']],
};
// 끌어당김(몰이) 스킬: 실제 Enemy 물리로 끌려온 위치 기준으로 잰다. 필수 네 가지(shield_bash·quake·whirlwind·hell_axe) 외에 같은 방식으로 환경변수로 늘릴 수 있다.
const PULL_SKILLS = (process.env.AIM_PULL || '*').split(',').filter(Boolean);

// 브라우저 안에서 도는 함수(직렬화되므로 바깥 변수를 쓰지 않는다).
function pageRun({ hero, jobId, inDepth, outGap, enemyRadius, only, noArea, randomSeeds, townVariants, pullSkills }) {
  const app = window.app, THREE = window.__THREE, shapeOf = window.__skillAimShape, ENEMIES = window.__EN;
  const b = app.battle, p = b.player;
  const theta = 0.6, ux = Math.sin(theta), uz = Math.cos(theta), vx = Math.cos(theta), vz = -Math.sin(theta);
  const o0 = { x: p.pos.x, z: p.pos.z };
  const W = b.world;
  if (W) { W.resolve = (x0, z0, x1, z1) => [x1, z1]; W.walkable = () => true; }
  p.auto = false; p.invuln = 1e9; p.heroLevel = 60; p.maxHp = p.hp = 1e9;
  const noop = () => {};
  const freeze = e => { e.update = noop; e.spawning = false; e.state = 'chase'; e.maxHp = e.hp = 1e12; e.radius = enemyRadius; };
  const defKey = Object.keys(ENEMIES).find(k => { const d = ENEMIES[k]; return !d.boss && !d.elite && !d.dodge && !d.behavior && app.models[d.model]; });
  const pool = [];
  const park = e => { e.pos.set(o0.x + 5000, 0, o0.z + 5000); };
  for (const e of b.enemies) { freeze(e); park(e); }
  const pt = (a, c) => ({ x: o0.x + ux * a + vx * c, z: o0.z + uz * a + vz * c });
  const sdCircle = (a, c, ca, cc, r) => Math.hypot(a - ca, c - cc) - r;
  const sdRect = (a, c, a0, a1, hw) => { const qa = Math.abs(a - (a0 + a1) / 2) - (a1 - a0) / 2, qc = Math.abs(c) - hw; return Math.hypot(Math.max(qa, 0), Math.max(qc, 0)) + Math.min(Math.max(qa, qc), 0); };
  // 꼭짓점이 영웅 뒤 back 위치에 있는 부채꼴(back=0이면 영웅 위치). a0는 영웅 기준 앞쪽 거리.
  const sdSector = (a0, c, R, hDeg, back) => {
    const a = a0 + (back || 0), h = hDeg * Math.PI / 360, d = Math.hypot(a, c), ang = Math.atan2(Math.abs(c), a);
    if (h >= Math.PI - 1e-6) return d - R;
    if (ang <= h) return Math.max(d - R, -Math.min(R - d, h - ang < Math.PI / 2 ? d * Math.sin(h - ang) : d));
    const t = d * Math.cos(ang - h); if (t <= 0) return d; if (t >= R) return Math.hypot(t - R, d * Math.sin(ang - h));
    return d * Math.sin(ang - h);
  };
  // 표시 모양(src/game/skill-aim/aim-view.js update)을 같은 식으로 풀어 낸 하위 도형 목록.
  const parts = (s, frac) => {
    const o = s.origin || 0, tip = s.tip || 0, list = [];
    const line = s.kind === 'line', cone = s.kind === 'cone', circle = s.kind === 'circle';
    if (line || (cone && s.projectileRange)) list.push({ t: 'rect', a0: o, a1: o + (s.projectileRange || s.range) + (line ? tip : 0), hw: Math.max(0.7, s.width || 0.3) / 2 });
    // 화살 다발(레인만 있고 투사체 직선이 없는 부채꼴)은 부채꼴을 채우지 않는다. 용살검처럼 근접 부채꼴이 따로 있으면 그린다.
    if (cone && !(s.lanes > 0 && !s.projectileRange)) list.push({ t: 'sector', R: s.range, angle: s.angle, back: 0 });
    for (const q of laneParts(s)) list.push(q);
    if (line && s.radius > 0) list.push({ t: 'circle', ca: o + (s.projectileRange || s.range) + (s.endOffset || 0), cc: 0, r: s.radius });
    if (circle) list.push({ t: 'circle', ca: s.range * frac, cc: 0, r: s.radius });
    if (s.kind === 'self') list.push({ t: 'circle', ca: 0, cc: 0, r: Math.max(0.8, s.range + o) });
    return list;
  };
  const sdLane = (a, c, q) => { const ra = a - q.sa, rc = c - q.sc, cs = Math.cos(q.ang), sn = Math.sin(q.ang); return sdRect(ra * cs + rc * sn, -ra * sn + rc * cs, 0, q.len, q.hw); };
  const sdOf = (list, a, c) => Math.min(...list.map(q => q.t === 'rect' ? sdRect(a, c, q.a0, q.a1, q.hw) : q.t === 'lane' ? sdLane(a, c, q) : q.t === 'sector' ? sdSector(a, c, q.R, q.angle, q.back) : sdCircle(a, c, q.ca, q.cc, q.r)));
  // 갈라지는 다발의 레인(src/game/skill-aim/aim-view.js와 같은 식): 레인 i의 방향각 (i-(n-1)/2)*step, 시작점 = (laneBaseA, laneBaseC) + 레인 방향 × laneReach.
  const laneStart = (s, ang) => [s.laneBaseA + s.laneReach * Math.cos(ang), s.laneBaseC + s.laneReach * Math.sin(ang)];
  function laneParts(s) {
    const list = [], n = s.lanes | 0;
    for (let i = 0; i < n; i++) {
      const off = i - (n - 1) / 2; if (s.laneSkipCenter && off === 0) continue;
      const ang = off * s.laneStep, [sa, sc] = laneStart(s, ang);
      list.push({ t: 'lane', ang, hw: Math.max(0.7, s.laneHalf * 2) / 2, len: s.laneLen, sa, sc });
    }
    return list;
  }
  const polar = (d, ang) => [d * Math.cos(ang), d * Math.sin(ang)];
  const samplesFor = (s, list, frac, skillId) => {
    const c = [], o = s.origin || 0;
    const add = (group, name, a, cc, anchor) => c.push(anchor ? { group, name, a, c: cc, anchor } : { group, name, a, c: cc });
    // 중심 ca·표시 반지름 r의 원: 45° 간격 8방향 안/밖 표본. envelope(운이 맞아야 닿는 바깥 한계)가 있으면 바깥 필수 표본은 envelope 밖에 두고
    // 표시 반지름 밖~envelope 사이는 정보용 band 표본(적중률만 기록)으로 둔다.
    const ring = (ca, r, env, kind) => {
      for (let k = 0; k < 8; k++) {
        const f = (15 + k * 45) * Math.PI / 180, lab = Math.round(15 + k * 45) + '°', at = rr => [ca + rr * Math.cos(f), rr * Math.sin(f)];
        add('in', '안 ' + lab, ...at(r - inDepth));
        if (env > r && kind === 'pull') {
          // 끌려와 맞는 한계(일반 적): 표시 밖 0.8m, 중간, 한계 안 0.4m는 모두 맞아야 하고 한계 밖 0.8m는 맞지 않아야 한다.
          if (r + outGap < env - 0.1) add('pull', '끌림 ' + lab, ...at(r + outGap));
          add('pull', '끌림 중간 ' + lab, ...at((r + env) / 2)); add('pull', '끌림 한계 안 ' + lab, ...at(env - 0.4)); add('out', '밖 ' + lab, ...at(env + outGap));
        } else if (env > r) { add('band', '띠 ' + lab, ...at(r + outGap)); add('band', '띠 중간 ' + lab, ...at((r + env) / 2)); add('out', '밖 ' + lab, ...at(env + outGap)); }
        else add('out', '밖 ' + lab, ...at(r + outGap));
      }
    };
    if (s.kind === 'line') {
      const len = s.projectileRange || s.range, hw = Math.max(0.7, s.width || 0.3) / 2, d = Math.min(inDepth, hw);
      const endA = o + len + (s.endOffset || 0), er = s.radius || 0;
      const far = Math.max(o + len + (s.tip || 0), er ? endA + er : 0);
      add('in', '끝 안', far - inDepth, 0);
      const mid = er ? Math.max(o + 0.5, (o + endA - er) / 2) : o + len / 2;
      add('in', '옆 안(오른)', mid, hw - d); add('in', '옆 안(왼)', mid, -(hw - d));
      add('in', '시작 안', o + 0.6, 0);
      add('out', '끝 밖', far + outGap, 0);
      add('out', '옆 밖(오른)', mid, hw + outGap); add('out', '옆 밖(왼)', mid, -(hw + outGap));
      if (er) { add('in', '끝원 옆 안(오른)', endA, er - inDepth); add('out', '끝원 옆 밖(오른)', endA, er + outGap); add('out', '끝원 옆 밖(왼)', endA, -(er + outGap)); }
    } else if (s.kind === 'cone') {
      // 부채꼴(꼭짓점 back, 반지름 R)의 경계 표본. 극좌표는 꼭짓점 기준이라 앞쪽 거리로 바꿀 때 back을 뺀다.
      const coneSet = (tag, back, R, angleDeg) => {
        const h = angleDeg * Math.PI / 360, dm = R * 0.6, P = (d, ang) => { const [x, y] = polar(d, ang); return [x - back, y]; };
        add('in', tag + '호 안', ...P(R - inDepth, 0));
        for (const sg of [1, -1]) {
          const side = sg > 0 ? '오른' : '왼';
          add('in', tag + '각 경계 안(' + side + ')', ...P(dm, sg * Math.max(0, h - inDepth / dm)));
          add('in', tag + '호 모서리 안(' + side + ')', ...P(R - inDepth, sg * Math.max(0, h - inDepth / (R - inDepth))));
        }
        add('out', tag + '호 밖', ...P(R + outGap, 0));
        if (h < Math.PI - 0.05) for (const sg of [1, -1]) {
          const side = sg > 0 ? '오른' : '왼';
          add('out', tag + '각 경계 밖(' + side + ')', ...P(dm, sg * Math.min(Math.PI, h + outGap / dm)));
          add('out', tag + '호 모서리 밖(' + side + ')', ...P(R - 0.5, sg * Math.min(Math.PI, h + outGap / (R - 0.5))));
        } else add('out', tag + '뒤 밖', ...P(-(R + outGap), 0));
      };
      if (!(s.lanes > 0 && !s.projectileRange)) coneSet('', 0, s.range, s.angle);
    } else if (s.kind === 'circle') {
      // 원은 중심에서 15° 비켜 45° 간격 8방향을 모두 잰다(방향이 정해진 기둥·낙하 지점이 만드는 부분 틈을 놓치지 않기 위해).
      const ca = s.range * frac, r = s.radius;
      ring(ca, r, s.envelope, s.envelopeKind);
    } else {
      const R = Math.max(0.8, s.range + o);
      ring(0, R, s.envelope, s.envelopeKind);
      // chain: 첫 표적(탐색 R)은 위 ring이 재고, 후속 도약은 직전 표적에서 7m다. 첫 표적 A(정면 6m)를 두고 도약 안 6.5m와 도약 밖 7.8m의 B를 정면·옆으로 잰다.
      if (skillId === 'chain') for (const [name, da, dc] of [['정면', 1, 0], ['오른쪽', 0, 1], ['왼쪽', 0, -1]]) {
        add('hop-in', '도약 안 6.5m ' + name, 6 + 6.5 * da, 6.5 * dc, { a: 6, c: 0 });
        add('hop-out', '도약 밖 7.8m ' + name, 6 + 7.8 * da, 7.8 * dc, { a: 6, c: 0 });
      }
    }
    // 실제 경계 거리로 검증: 안쪽은 표시 안(sd<0), 바깥은 0.75m 이상 밖이어야 한다. 다른 하위 도형 안에 들어가 어긋난 후보는 버린다.
    // 몰이 한계(envelope)가 영웅 중심 원인 선·부채꼴 스킬(dragon_slash·flurry)은 그 원 안쪽 한계 안 0.4m와 바깥 0.8m를 8방향으로 잰다.
    if (s.envelopeKind === 'pull' && s.envelope > 0 && (s.kind === 'cone' || s.kind === 'line')) {
      for (let k = 0; k < 8; k++) {
        const f = (15 + k * 45) * Math.PI / 180, lab = Math.round(15 + k * 45) + '°', at = rr => [rr * Math.cos(f), rr * Math.sin(f)];
        add('pull', '끌림 한계 안 ' + lab, ...at(s.envelope - 0.4)); add('out', '끌림 밖 ' + lab, ...at(s.envelope + outGap));
      }
    }
    // 레인 다발: 레인마다 끝·옆 안/밖 표본, 레인 사이 틈(이웃 레인 방향의 이등분선) 표본. 틈 표본은 표시 밖이므로 맞지 않아야 한다.
    if (s.lanes > 0) {
      const n = s.lanes | 0, hw = Math.max(0.7, s.laneHalf * 2) / 2, len = s.laneLen, d = Math.min(inDepth, hw);
      const at = (sa, sc, ang, along, across) => [sa + along * Math.cos(ang) - across * Math.sin(ang), sc + along * Math.sin(ang) + across * Math.cos(ang)];
      for (let i = 0; i < n; i++) {
        const off = i - (n - 1) / 2, ang = off * s.laneStep, tag = '레인' + (i + 1) + ' ';
        if (!(s.laneSkipCenter && off === 0)) {
          const [sa, sc] = laneStart(s, ang);
          add('in', tag + '끝 안', ...at(sa, sc, ang, len - inDepth, 0));
          for (const sg of [1, -1]) {
            const side = sg > 0 ? '오른' : '왼';
            add('in', tag + '옆 안(' + side + ')', ...at(sa, sc, ang, len * 0.6, sg * (hw - d)));
            add('out', tag + '옆 밖(' + side + ')', ...at(sa, sc, ang, len * 0.6, sg * (hw + outGap)));
          }
          add('out', tag + '끝 밖', ...at(sa, sc, ang, len + outGap, 0));
        }
        if (i < n - 1) {
          const mid = (ang + (off + 1) * s.laneStep) / 2;
          for (const f of [0.95, 0.75, 0.55, 0.35]) add('out', '틈 ' + (i + 1) + '-' + (i + 2) + ' ' + Math.round(f * 100) + '%', ...polar(o + len * f, mid));
        }
      }
    }
    const inEnv = q => (s.kind === 'cone' || s.kind === 'line') && s.envelopeKind === 'pull' && s.envelope > 0 && Math.hypot(q.a, q.c) < s.envelope + outGap - 0.05 && !(q.name || '').startsWith('끌림');
    return c.map(q => ({ ...q, a: +q.a.toFixed(3), c: +q.c.toFixed(3), sd: +sdOf(list, q.a, q.c).toFixed(3) })).filter(q => q.group === 'in' ? q.sd < -0.05 : q.group === 'band' || q.group === 'pull' ? q.sd > 0.3 : q.group.startsWith('hop') ? true : q.sd >= outGap - 0.05 && !(q.group === 'out' && inEnv(q)));
  };
  const spawnPool = n => { for (let i = pool.length; i < n; i++) { const e = b.spawnEnemy(defKey, null, null, new THREE.Vector3(o0.x + 5000, 0, o0.z + 5000)); if (!e) throw new Error('표본 적 생성 실패: ' + defKey); freeze(e); park(e); pool.push(e); } };
  const realRandom = Math.random;
  const seeded = seed => { let st = (seed * 2654435761) >>> 0 || 1; Math.random = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const quiet = () => b.timers.length === 0 && b.projectiles.length === 0 && (!p.skillCtx || p.skillCtx.done);
  const resetPlayer = () => {
    p.pos.set(o0.x, 0, o0.z); p.vel.set(0, 0, 0); p.kb?.set?.(0, 0, 0); p.state = 'idle'; p.skillCtx = null; p.stun = 0; p.invuln = 1e9; p.hp = p.maxHp = 1e9;
    p.cds.fill(0); p.mp = p.maxMp = 9999; p.ult = p.ultMax; p.sanctum = null; p.dr = 0; p.drT = 0; p.guardT = 0; p.jobResource = 0; if (p.buffs) p.buffs.t = 0; p.stopTrail?.();
    b.timers.length = 0; b.pending.length = 0; b.maxAlive = 0;
    for (const q of b.projectiles) q.mesh?.removeFromParent?.(); b.projectiles.length = 0;
    for (const e of b.enemies) if (!pool.includes(e)) { freeze(e); park(e); }
    for (const e of pool) { park(e); e.hp = e.maxHp = 1e12; e.alive = true; e.kb.set(0, 0, 0); e.vel.set(0, 0, 0); e.stun = 0; e.gatherT = 0; e.gatherBlockT = 0; e.slow = 0; }
  };
  const results = [];
  const frac = 1;
  const towns = app.eco.s.towns, savedLearned = towns.learned;
  for (let idx = 0; idx < p.def.skills.length; idx++) {
    const sk = p.def.skills[idx];
    if (only && !only.includes(sk.id)) continue;
    const row = { hero, jobId: jobId || null, slotIndex: idx, skill: sk.id, name: sk.name, ult: !!sk.ult, unlock: sk.unlock || 0, variants: [] };
    if (!shapeOf) { row.error = 'window.__skillAimShape 없음'; results.push(row); continue; }
    // 변형 목록: 기본, 직업 자원 강화, 교관 강화(실제 교관 id), 장비 효과. playerSkillAimShape가 바꾸는 변형을 모두 포함한다.
    const variants = [['기본', {}]];
    if (sk.id === 'guardian_rebuke') variants.push(['결의 3 강화', { job: 3 }]);
    if (sk.id === 'ranger_pierce') variants.push(['집중 3 강화', { job: 3 }]);
    for (const [vn, id] of townVariants[sk.id] || []) variants.push([vn, { town: id }]);
    if (sk.id === 'ranger_pierce') variants.push(['집중 3 + 교관 판정강화', { job: 3, town: townVariants.ranger_pierce[0][1] }]);
    if (sk.id === 'holy_slash' && hero === 'knight') variants.push(['방패 달인 장비(arm_aegis_master)', { proc: 'arm_aegis_master' }]);
    for (const [vname, opt] of variants) {
      const hadProc = opt.proc ? b.procs.has(opt.proc) : false;
      towns.learned = opt.town ? { [p.def.id]: [opt.town] } : {};
      if (opt.proc) b.procs.add(opt.proc);
      const arm = () => { resetPlayer(); if (opt.job) p.jobResource = opt.job; };
      arm();
      const shape = shapeOf(p, sk.id, {}); const vr = { variant: vname, opt, shape: shape && { ...shape }, samples: [] };
      row.variants.push(vr);
      if (!shape) { vr.error = '표시 모양 없음'; towns.learned = savedLearned; continue; }
      if (noArea[sk.id]) { vr.exception = noArea[sk.id]; towns.learned = savedLearned; if (opt.proc && !hadProc) b.procs.delete(opt.proc); continue; }
      const list = parts(shape, frac); vr.parts = list;
      const samples = samplesFor(shape, list, frac, sk.id); spawnPool(2);
      const pull = pullSkills.includes('*') || pullSkills.includes(sk.id);
      const seeds = randomSeeds[sk.id] || 1;
      for (const sm of samples) {
        const w = pt(sm.a, sm.c); sm.x = +(w.x - o0.x).toFixed(3); sm.z = +(w.z - o0.z).toFixed(3);
        let hitSeeds = 0, castOk = true, firstT = null, hpLost = 0, steps = 0;
        for (let s = 0; s < seeds; s++) {
          seeded(1000 + s * 17 + idx);
          arm();
          const e = pool[0]; e.pos.set(w.x, 0, w.z);
          if (sm.anchor) { const q = pt(sm.anchor.a, sm.anchor.c); pool[1].pos.set(q.x, 0, q.z); }
          // 끌어당김 스킬은 실제 Enemy 물리(몰이·넉백)를 켠다. AI는 spawn 상태 고정으로 막고, 맞을 때마다 상태를 되돌려 추격하지 못하게 한다.
          const origSpawnLen = e.spawnLen;
          if (pull) { delete e.update; e.state = 'spawn'; e.stateT = 0; e.spawnLen = 1e9; }
          const t0 = b.elapsed; let hits = 0; const origHurt = Object.getPrototypeOf(e).hurt;
          e.hurt = function (dmg, o) { const r = origHurt.call(this, dmg, o); if (pull) { this.state = 'spawn'; this.stateT = 0; } if (r > 0 || dmg > 0) { hits++; if (firstT === null) { firstT = +(b.elapsed - t0).toFixed(3); if (window.__aimDebug) sm.stack = new Error().stack.split('\n').slice(1, 6).join(' | ') + ' src=' + (o && o.source ? 'p' : '?') + ' kind=' + (o && o.kind); } } return r; };
          const ok = p.tryCastSkill(idx, { x: ux, z: uz, dist01: frac });
          if (!ok) { castOk = false; delete e.hurt; if (pull) { e.update = noop; e.state = 'chase'; e.spawnLen = origSpawnLen; } break; }
          // 늦게 맞는 스킬(투사체·낙하·지속 장판·fx 구동 반사창)을 위해 바깥 표본은 최소 4초(240걸음)를 흘리고, 안쪽 표본은 맞는 즉시 끝낸다.
          const early = sm.group === 'in' || sm.group === 'pull' || sm.group === 'hop-in';
          let n = 0;
          for (; n < 720; n++) {
            app.step(1 / 60, false);
            if (early && hits > 0 && n > 3) break;
            if (n > 240 && quiet()) break;
          }
          steps = Math.max(steps, n); hpLost = Math.max(hpLost, 1e12 - e.hp);
          delete e.hurt; if (pull) { e.update = noop; e.state = 'chase'; e.spawnLen = origSpawnLen; }
          if (hits > 0) hitSeeds++;
        }
        Math.random = realRandom;
        sm.castOk = castOk; sm.seeds = seeds; sm.hitSeeds = hitSeeds; sm.hit = hitSeeds > 0; sm.hitAll = hitSeeds === seeds; sm.hitRate = +(hitSeeds / seeds).toFixed(2);
        sm.firstHitSec = firstT; sm.hpLost = Math.round(hpLost); sm.steps = steps;
        sm.pull = pull;
        sm.pass = castOk && (sm.group === 'in' || sm.group === 'pull' || sm.group === 'hop-in' ? sm.hitAll : sm.group === 'band' ? true : !sm.hit);
        vr.samples.push(sm);
      }
      towns.learned = savedLearned; if (opt.proc && !hadProc) b.procs.delete(opt.proc);
    }
    results.push(row);
  }
  Math.random = realRandom;
  return results;
}

const browser = await chromium.launch({ args: ['--use-angle=d3d11'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 590 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 120000 }); await page.click('#boot-start');
await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot').classList.contains('show'), null, { timeout: 120000 });
const build = await page.evaluate(() => ({ title: document.title, shapeFn: typeof window.__skillAimShape, version: window.app?.version || null }));
if (build.shapeFn !== 'function') throw new Error('window.__skillAimShape 가 없다. src/main.js 노출이 들어간 빌드인지 확인');
if (process.env.AIM_DEBUG) await page.evaluate(() => { window.__aimDebug = true; });
const rows = [];
for (const spec of heroArg) {
  const guardian = spec === 'guardian', hero = guardian ? 'knight' : spec;
  await page.evaluate(async ({ hero, guardian }) => {
    app.ui.closeModal?.(); app.eco.s.energy = 100; app.eco.s.selected = hero;
    const ex = app.eco.s.expedition; ex.unlockedJobs = guardian ? ['guardian'] : []; ex.selectedJob = guardian ? 'guardian' : null;
    if (!await app.startStage(app.eco.nextStage())) throw Error('stage');
    app.companionAgent?.endBattle?.();
  }, { hero, guardian });
  await page.waitForFunction(() => app.battle?.active && app.battle.player, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const res = await page.evaluate(pageRun, { hero: spec, jobId: guardian ? 'guardian' : null, inDepth: IN_DEPTH, outGap: OUT_GAP, enemyRadius: ENEMY_RADIUS, only, noArea: NO_AREA, randomSeeds: RANDOM_SEEDS, townVariants: TOWN_VARIANTS, pullSkills: PULL_SKILLS });
  rows.push(...res);
  await page.evaluate(() => app.toLobby?.()); await page.waitForTimeout(500);
  console.error(spec, '완료', res.length, '스킬');
}
// ---- 판정 ----
// 기본 스킬(guardian 직업은 슬롯 0·1만 직업 스킬)만 겹치지 않게 guardian 행에서는 직업 스킬만 남긴다.
const jobOnly = new Set(['guardian_guard', 'guardian_rebuke']);
const finalRows = rows.filter(r => r.jobId !== 'guardian' || jobOnly.has(r.skill));
for (const r of finalRows) {
  const issues = [];
  let inN = 0, inHit = 0, outN = 0, outHit = 0, bandN = 0, bandHit = 0, bandRate = 0, pullN = 0, pullHit = 0, hopInN = 0, hopInHit = 0, hopOutN = 0, hopOutHit = 0, exception = null;
  for (const v of r.variants) {
    if (v.exception) { exception = v.exception; continue; }
    if (v.error) { issues.push(v.error); continue; }
    const issuesBefore = issues.length;
    for (const s of v.samples) {
      if (!s.castOk) issues.push((v.variant) + ' 시전 실패');
      if (s.group === 'in') { inN++; if (s.hit) inHit++; if (!s.hitAll) issues.push(v.variant + ' ' + s.name + ' 안쪽 표본 미적중(' + s.hitSeeds + '/' + s.seeds + ')'); }
      else if (s.group === 'pull') { pullN++; if (s.hit) pullHit++; if (!s.hitAll) issues.push(v.variant + ' ' + s.name + ' 끌림 표본 미적중(' + s.hitSeeds + '/' + s.seeds + ')'); }
      else if (s.group === 'hop-in') { hopInN++; if (s.hit) hopInHit++; if (!s.hitAll) issues.push(v.variant + ' ' + s.name + ' 도약 안쪽 미적중'); }
      else if (s.group === 'hop-out') { hopOutN++; if (s.hit) hopOutHit++; if (s.hit) issues.push(v.variant + ' ' + s.name + ' 도약 바깥 적중'); }
      else if (s.group === 'band') { bandN++; if (s.hit) bandHit++; bandRate += s.hitRate; }
      else { outN++; if (s.hit) outHit++; if (s.hit) issues.push(v.variant + ' ' + s.name + ' 바깥 표본 적중(' + s.hitSeeds + '/' + s.seeds + ')'); }
    }
    v.verdict = issues.length > issuesBefore ? 'fail' : 'pass';
  }
  r.summary = { inN, inHit, outN, outHit, bandN, bandHit, bandMeanHitRate: bandN ? +(bandRate / bandN).toFixed(2) : null, pullN, pullHit, hopInN, hopInHit, hopOutN, hopOutHit };
  if (exception) { r.verdict = 'exception'; r.exception = exception; continue; }
  if (inN === 0) issues.push('안쪽 표본을 만들지 못했다');
  else if (inHit === 0) issues.push('판정 0건: 범위 스킬인데 안쪽 표본이 하나도 맞지 않았다');
  r.issues = issues; r.verdict = issues.length ? 'fail' : 'pass';
}
const pass = finalRows.every(r => r.verdict !== 'fail') && !errors.length;
const RULES = [
  '확정 영역(표시의 실선·채움) 안쪽 0.5m 표본은 모두 맞고, 표시 바깥 0.8m 표본은 맞지 않는다.',
  '확률 띠(envelopeKind=chance: meteor, magma_zone): 표시 반지름 밖~envelope 사이 표본은 필수 판정이 아니라 적중률만 기록하고, envelope 바깥 0.8m는 맞지 않는다.',
  '몰이 스킬(envelopeKind=pull, PULL_SKILLS=' + PULL_SKILLS.join(',') + '): 표본 적이 실제 몰이 물리로 끌려온 위치 기준으로 맞는다. 표시 밖~몰이 한계(envelope) 사이 일반 적은 끌려와 맞고, 한계 바깥 0.8m는 맞지 않는다. 정예는 몰이 속도 절반, 보스는 15%이므로 이 보장은 일반 적에만 해당한다.',
  'chain: 표시 12m는 첫 표적 탐색 반경이다. 후속 도약은 직전 표적에서 7m 안(6.5m는 맞고 7.8m는 맞지 않음)이라 첫 표적을 거쳐 표시 밖 적도 맞을 수 있다.',
  '변형: 직업 자원 강화와 교관 강화(playerSkillAimShape가 바꾸는 8개 + 모양이 같은 변형)를 실제 교관 id로 켜고 shape와 시전을 함께 잰다.',
];
const report = { scope: '격리 Chromium, 실제 게임 루프(app.step)와 실제 스킬 시전. 표본 적은 고정(update 차단, 몰이 스킬 표본만 실제 몰이 물리)·체력 무한·영웅 무적. 실기기 아님.', origin, build, tolerance: { insideM: IN_DEPTH, outsideM: OUT_GAP, sampleEnemyRadius: ENEMY_RADIUS }, rules: RULES, pullSkills: PULL_SKILLS, pass, errors, skills: finalRows };
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));

// ---- 겹침 캡처: 표시 모양(청록)과 표본(적중=채움, 안쪽 미적중=X) 위에서 내려다본 그림 ----
const dp = await ctx.newPage();
await dp.setViewportSize({ width: 1500, height: 1000 });
const sheets = [];
for (const hero of [...new Set(finalRows.map(r => r.hero))]) {
  const list = finalRows.filter(r => r.hero === hero && r.variants[0]?.shape);
  const png = await dp.evaluate(({ list, hero }) => {
    const cols = 4, cw = 360, ch = 330, rowsN = Math.ceil(list.length / cols);
    const cv = document.createElement('canvas'); cv.width = cols * cw; cv.height = rowsN * ch + 36; const g = cv.getContext('2d');
    g.fillStyle = '#10151c'; g.fillRect(0, 0, cv.width, cv.height); g.font = '16px sans-serif'; g.fillStyle = '#ddd'; g.fillText(hero + ' — 청록: 표시 모양 / 초록 채움: 맞음(안) / 빨강 X: 안쪽인데 안 맞음 / 빨강 채움: 바깥인데 맞음 / 회색 원: 바깥, 안 맞음 / 노랑: 확률 띠(적중률 농도)', 10, 22);
    const theta = 0.6, ux = Math.sin(theta), uz = Math.cos(theta), vx = Math.cos(theta), vz = -Math.sin(theta);
    list.forEach((r, i) => {
      const v = r.variants[0], s = v.shape; const cx0 = (i % cols) * cw, cy0 = Math.floor(i / cols) * ch + 36;
      g.strokeStyle = '#333'; g.strokeRect(cx0 + 2, cy0 + 2, cw - 4, ch - 24);
      g.fillStyle = r.verdict === 'pass' ? '#7f7' : r.verdict === 'exception' ? '#ec6' : '#f66'; g.font = '13px sans-serif';
      g.fillText(r.skill + ' [' + s.kind + '] ' + r.verdict, cx0 + 8, cy0 + 18);
      if (!v.parts) return;
      // 월드 -> (a,c) 좌표 -> 화면. a는 위쪽, c는 오른쪽.
      let ext = 2;
      for (const q of v.parts) { if (q.t === 'rect') ext = Math.max(ext, q.a1, q.hw); if (q.t === 'lane') ext = Math.max(ext, Math.abs(q.sa + q.len * Math.cos(q.ang)) + q.hw, Math.abs(q.sc + q.len * Math.sin(q.ang)) + q.hw); if (q.t === 'sector') ext = Math.max(ext, q.R - (q.back || 0)); if (q.t === 'circle') ext = Math.max(ext, Math.abs(q.ca) + q.r, q.r); }
      const envC = s.envelope > 0 ? (s.kind === 'circle' ? s.range : 0) : null; if (envC !== null) ext = Math.max(ext, Math.abs(envC) + s.envelope);
      for (const m of v.samples) ext = Math.max(ext, Math.abs(m.a) + 1, Math.abs(m.c) + 1);
      const sc = Math.min((cw - 30) / (2 * ext), (ch - 60) / (2 * ext)), ox = cx0 + cw / 2, oy = cy0 + (ch - 22) / 2 + 8;
      const X = c => ox + c * sc, Y = a => oy - a * sc;
      g.strokeStyle = '#5fe6ff'; g.fillStyle = 'rgba(95,230,255,.18)'; g.lineWidth = 1.5;
      for (const q of v.parts) {
        g.beginPath();
        if (q.t === 'rect') g.rect(X(-q.hw), Y(q.a1), 2 * q.hw * sc, (q.a1 - q.a0) * sc);
        else if (q.t === 'lane') {
          const cs = Math.cos(q.ang), sn = Math.sin(q.ang);
          [[0, -q.hw], [q.len, -q.hw], [q.len, q.hw], [0, q.hw]].forEach(([al, ac], k) => { const a = q.sa + al * cs - ac * sn, c = q.sc + al * sn + ac * cs; if (k === 0) g.moveTo(X(c), Y(a)); else g.lineTo(X(c), Y(a)); });
          g.closePath();
        }
        else if (q.t === 'circle') g.arc(X(q.cc), Y(q.ca), q.r * sc, 0, Math.PI * 2);
        else { const h = q.angle * Math.PI / 360, bk = q.back || 0; g.moveTo(X(0), Y(-bk)); g.arc(X(0), Y(-bk), q.R * sc, -Math.PI / 2 - h, -Math.PI / 2 + h); g.closePath(); }
        g.fill(); g.stroke();
      }
      // 확률 띠/몰이 한계(envelope): 확정 영역(청록 실선·채움)과 구분되는 호박색 점선 원.
      if (envC !== null) { g.save(); g.setLineDash([5, 4]); g.strokeStyle = '#ffc46b'; g.fillStyle = 'rgba(255,196,107,.07)'; g.beginPath(); g.arc(X(0), Y(envC), s.envelope * sc, 0, Math.PI * 2); g.fill(); g.stroke(); g.restore(); }
      g.fillStyle = '#fff'; g.beginPath(); g.arc(X(0), Y(0), 4, 0, Math.PI * 2); g.fill();
      for (const m of v.samples) {
        const x = X(m.c), y = Y(m.a); g.lineWidth = 2;
        if (m.group === 'in' || m.group === 'pull' || m.group === 'hop-in') {
          if (m.hitAll) { g.fillStyle = '#4c4'; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
          else { g.strokeStyle = '#f44'; g.beginPath(); g.moveTo(x - 6, y - 6); g.lineTo(x + 6, y + 6); g.moveTo(x + 6, y - 6); g.lineTo(x - 6, y + 6); g.stroke(); }
        } else if (m.group === 'band') { g.fillStyle = m.hit ? 'rgba(255,200,60,' + (0.35 + 0.65 * m.hitRate) + ')' : 'rgba(120,120,120,.5)'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
        else if (m.hit) { g.fillStyle = '#f44'; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
        else { g.strokeStyle = '#999'; g.beginPath(); g.arc(x, y, 5, 0, 7); g.stroke(); }
      }
      if (r.exception) { g.fillStyle = '#ec6'; g.fillText('예외: 범위 없음', cx0 + 8, cy0 + 40); }
    });
    return cv.toDataURL('image/png');
  }, { list, hero });
  const file = path.join(out, 'overlay-' + hero + '.png');
  await fs.writeFile(file, Buffer.from(png.split(',')[1], 'base64')); sheets.push(file);
}
await browser.close();
const table = finalRows.map(r => [r.hero, r.skill, r.variants[0]?.shape?.kind, r.verdict, r.summary.inHit + '/' + r.summary.inN, r.summary.outHit + '/' + r.summary.outN + (r.summary.bandN ? ' 띠' + r.summary.bandMeanHitRate : ''), (r.issues || []).slice(0, 2).join(' | ')]);
console.log(JSON.stringify({ pass, errors: errors.slice(0, 3), sheets }));
for (const t of table) console.log(t.join('\t'));
if (!pass) process.exitCode = 1;

