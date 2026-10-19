import { SKILL_AIM_SHAPES } from '../skills.js';
import { TOWN_TRAINER_BY_ID } from '../../data/towns.js';
import { TOWN_COMBAT_ARTS } from '../../data/combat-arts.js';

function variant(player, id, name) {
  const learned = player.game?.app?.eco?.s?.towns?.learned;
  if (!learned) return false;
  for (const key in learned) {
    const ids = learned[key]; if (!Array.isArray(ids)) continue;
    for (let i = 0; i < ids.length; i++) {
      const offer = TOWN_TRAINER_BY_ID[ids[i]];
      if (offer?.skillId !== id || offer.heroId !== player.def.id || offer.variant !== name) continue;
      for (let j = 0; j < TOWN_COMBAT_ARTS.length; j++) if (TOWN_COMBAT_ARTS[j].skillId === id && TOWN_COMBAT_ARTS[j].variant === name) return true;
    }
  }
  return false;
}

/** 기본 판정/탐색 모양. angle은 hitArea와 같은 도 단위다. */
const FRAME_PAD = .25;
const SPLIT_ANGLE = .22, SPLIT_SPEED = 15, SPLIT_LIFE = .8, SPLIT_RADIUS = .55;
/**
 * 시전 중 적을 끌어당기는(gather/vacuum) 스킬이 일반 적을 끌어와 맞히는 한계 반지름(표시 중심 기준).
 * 근거: skills.js의 gatherEnemies/vacuum 반경 중 tools/aim-hitbox-truth-qa.mjs 실측(실제 Enemy 물리)에서 표시 밖 적이 맞은 값.
 * 정예는 몰이 속도 절반, 보스는 15%라 이 한계까지 끌려오지 못할 수 있다.
 */
const PULL_REACH = { shield_bash: 7, quake: 9, whirlwind: 5.5, hell_axe: 7.5 };
export function skillAimShape(skillId) { return SKILL_AIM_SHAPES[skillId] || null; }

/**
 * 표시 전용 보정(tools/aim-hitbox-truth-qa.mjs 실측 근거). 원본 SKILL_AIM_SHAPES는 판정 기준 수치(이동 거리·반경)를 그대로 둔다.
 *  - 투사체·돌진의 몸통은 경로 끝과 옆으로 반경(width / 2)만큼 더 훑는다. 끝은 tip, 부채꼴 옆은 꼭짓점을 뒤로 물린 back으로 그린다.
 *  - 무작위·고리 배치 다중 타격(meteor, magma_zone)은 어느 방향에서도 확정으로 맞는 반지름만 그리고, 운이 맞아야 닿는 바깥 한계는 envelope에 적는다.
 */
function bodyAdjust(out, skillId) {
  out.tip = 0; out.back = 0; out.coneRadius = 0; out.fanAngle = 0; out.fanRange = 0; out.fanBack = 0; out.envelope = 0; out.envelopeKind = '';
  const body = out.width > 0 ? out.width / 2 : 0;
  // 투사체는 life를 넘긴 마지막 프레임 걸음만큼 더 나간다(60fps에서 최대 약 0.3~0.5m). 절반쯤인 FRAME_PAD를 끝에 더한다.
  const pad = out.origin > 0 ? FRAME_PAD : 0;
  if (out.kind === 'line') out.tip = body + pad;
  if (out.kind === 'cone' && body > 0 && !out.projectileRange && out.angle > 0) {
    // 화살 부채: 각 화살 몸통이 훑는 영역의 바깥 선은 화살 방향선에서 body만큼 떨어진 평행선이다. 꼭짓점을 body / sin(반각)만큼 뒤로 물린 부채꼴이 그 선과 같다.
    const half = Math.min(out.angle, 170) * Math.PI / 360;
    out.tip = body + pad; out.back = body / Math.sin(half); out.coneRadius = out.range + out.origin + out.tip + out.back;
  }
  if (out.kind === 'cone' && body > 0 && out.projectileRange && out.projectileAngle > 0) {
    // 용살검 파동 세 줄기: 같은 방식의 바깥 부채(파동 몸통 반경 width / 2, 시작점 origin).
    const half = out.projectileAngle * Math.PI / 360;
    out.fanAngle = out.projectileAngle; out.fanBack = body / Math.sin(half);
    out.fanRange = out.origin + out.projectileRange + body + pad + out.fanBack;
  }
  // 반사창은 벽·적에 튕겨 열두 번째 반사 위치에서 터진다. 직선 끝에는 폭발이 없으므로 끝 원을 그리지 않는다.
  if (skillId === 'arc_reflect') out.radius = 0;
  if (skillId === 'meteor') { out.envelope = out.radius; out.radius = 3.4; out.envelopeKind = 'chance'; }
  if (skillId === 'magma_zone') { out.envelope = out.range; out.range = out.radius; out.envelopeKind = 'chance'; }
  if (PULL_REACH[skillId]) { out.envelope = PULL_REACH[skillId]; out.envelopeKind = 'pull'; }
  return out;
}

/** 장착 변형과 현재 자원은 렌더 전용 재사용 객체에 반영한다. */
export function playerSkillAimShape(player, skillId, out) {
  const base = skillAimShape(skillId);
  if (!base) return null;
  out.kind = base.kind; out.range = base.range; out.width = base.width || 0;
  out.angle = base.angle || 0; out.radius = base.radius || 0; out.origin = base.origin || 0;
  out.projectileRange = base.projectileRange || 0; out.projectileAngle = base.projectileAngle || 0;
  out.endOffset = base.endOffset || 0;
  if (skillId === 'guardian_rebuke' && player.jobResource >= 3) out.range = out.radius = 6;
  if (skillId === 'ranger_pierce') out.width = (player.jobResource >= 3 ? 2.6 : 1.3) * (variant(player, skillId, 'star') ? 1.4 : 1);
  if (skillId === 'ranger_volley' && variant(player, skillId, 'extra')) out.angle = .72 * 180 / Math.PI;
  if (skillId === 'holy_slash' && player.def.id === 'knight' && !player.game.stage?.party && player.game.procs?.has('arm_aegis_master')) {
    out.range = 32 * .85; out.width = .72 * 2;
  }
  if (skillId === 'whirlwind' && variant(player, skillId, 'wide')) out.range = out.radius = 4.8;
  if (skillId === 'blizzard' && variant(player, skillId, 'wide')) out.range = out.radius = 8.6;
  if (skillId === 'bloodquake' && variant(player, skillId, 'echo')) out.range = out.radius = 9.5;
  if (skillId === 'poison_bomb' && variant(player, skillId, 'wide')) out.radius = 5.4;
  if (skillId === 'night_parade' && variant(player, skillId, 'wide')) out.radius = 6.5;
  const split = skillId === 'fireball' && variant(player, skillId, 'split');
  if (split) out.radius = 5.2;
  bodyAdjust(out, skillId);
  if (split) {
    // 분열 화염: 옆으로 ±.22rad 갈라지는 작은 투사체 둘(속도 15, 수명 .8, 반경 .55). 그 몸통이 훑는 바깥 부채를 두 번째 부채로 그린다.
    const h = SPLIT_ANGLE, body = SPLIT_RADIUS;
    out.fanAngle = h * 360 / Math.PI; out.fanBack = Math.max(0, body / Math.sin(h) - out.origin);
    out.fanRange = out.fanBack + out.origin + SPLIT_SPEED * SPLIT_LIFE + body + FRAME_PAD;
  }
  return out;
}
