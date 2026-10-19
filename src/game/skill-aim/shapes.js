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
/** 화살 다발 스킬의 화살 사이 각(rad, skills.js rangerArrows .18 / volley .24). 화살 수는 angle(전체 퍼짐)에서 구한다. */
const ARROW_STEP = { ranger_volley: .24, ranger_tempest: .18, ranger_binding: .18, gale_hunt: .18 };
/**
 * 활 화살의 시작점 = 활 소켓(영웅 기준 앞 .64, 오른쪽 .07) + 화살 방향 × .35 (player.js arrowOrigin). 실측: 세 발·네 발·일곱 발 모두 같은 값(tools 측정, 소수 셋째 자리까지).
 * 화살마다 시작점이 방향에 따라 옆으로 달라지므로 레인의 시작점도 같은 식으로 둔다.
 */
export const BOW_SOCKET = Object.freeze({ a: .64, c: .07, reach: .35 });
const DRAGON_WAVE_STEP = .32;
/**
 * 시전 중 적을 끌어당기는(gather/vacuum) 스킬이 일반 적을 끌어와 맞히는 한계 반지름(표시 중심 기준).
 * 근거: skills.js의 gatherEnemies/vacuum 반경 중 tools/aim-hitbox-truth-qa.mjs 실측(실제 Enemy 물리)에서 표시 밖 적이 맞은 값.
 * 정예는 몰이 속도 절반, 보스는 15%라 이 한계까지 끌려오지 못할 수 있다.
 */
const PULL_REACH = {
  shield_bash: 7, quake: 9, whirlwind: 5.5, hell_axe: 7.5,
  // 지점·자기 중심 몰이 필살기(skills.js vacuum 반경 안에서 tools/aim-hitbox-truth-qa.mjs 실측으로 줄인 값). 예: star_prison은 vacuum 13이지만
  // 힘 28로 .24초 안에 끌려와 맞는 한계는 12까지다.
  heavenfall: 12, star_prison: 12, absolute_zero: 12, night_parade: 9, eclipse_edge: 10, bloodquake: 9,
  // 영웅 중심 몰이: dragon_slash 채널 vacuum 12, flurry vacuum 4.5, blizzard gatherEnemies 8.5(교관 확장 10.5), sanctuary 경계 벽 R+3.5.
  dragon_slash: 12, flurry: 4.5, blizzard: 8.5, sanctuary: 11.5,
};
export function skillAimShape(skillId) { return SKILL_AIM_SHAPES[skillId] || null; }

/**
 * 표시 전용 보정(tools/aim-hitbox-truth-qa.mjs 실측 근거). 원본 SKILL_AIM_SHAPES는 판정 기준 수치(이동 거리·반경)를 그대로 둔다.
 *  - 투사체·돌진의 몸통은 경로 끝과 옆으로 반경(width / 2)만큼 더 훑는다. 끝은 tip으로 그린다.
 *  - 여러 발이 갈라지는 다발(화살 부채·용살검 파동·분열 화염)은 부채꼴로 채우지 않는다. 화살 각도마다 좁은 레인(lanes)으로 그려 발 사이 틈을 비워 둔다.
 *  - 무작위·고리 배치 다중 타격(meteor, magma_zone)은 어느 방향에서도 확정으로 맞는 반지름만 그리고, 운이 맞아야 닿는 바깥 한계는 envelope에 적는다.
 */
function bodyAdjust(out, skillId) {
  out.tip = 0; out.envelope = 0; out.envelopeKind = '';
  // 레인: 개수, 사이 각(rad), 반폭, 길이(시작점부터, 몸통·보정 포함), 시작점 = (앞 laneBaseA, 오른쪽 laneBaseC) + 레인 방향 × laneReach, 가운데 레인 생략(1)
  out.lanes = 0; out.laneStep = 0; out.laneHalf = 0; out.laneLen = 0; out.laneBaseA = 0; out.laneBaseC = 0; out.laneReach = 0; out.laneSkipCenter = 0;
  const body = out.width > 0 ? out.width / 2 : 0;
  // 투사체는 life를 넘긴 마지막 프레임 걸음만큼 더 나간다(60fps에서 최대 약 0.3~0.5m). 절반쯤인 FRAME_PAD를 끝에 더한다.
  const pad = out.origin > 0 ? FRAME_PAD : 0;
  if (out.kind === 'line') out.tip = body + pad;
  const step = ARROW_STEP[skillId];
  if (out.kind === 'cone' && body > 0 && !out.projectileRange && out.angle > 0 && step) {
    // 화살 다발: 화살마다 시작점(origin, 화살 방향)에서 range만큼 나가는 몸통 반폭 body짜리 레인. 발 사이는 비워 둔다.
    out.tip = body + pad;
    out.lanes = Math.round(out.angle * Math.PI / 180 / step) + 1; out.laneStep = step; out.laneHalf = body; out.laneLen = out.range + out.tip;
    out.laneBaseA = BOW_SOCKET.a; out.laneBaseC = BOW_SOCKET.c; out.laneReach = BOW_SOCKET.reach;
  }
  if (out.kind === 'cone' && body > 0 && out.projectileRange && out.projectileAngle > 0) {
    // 용살검 파동 세 줄기(±.32rad, 몸통 반폭 width / 2)는 근접 부채꼴(angle)과 별개로 레인으로 그린다.
    out.lanes = Math.round(out.projectileAngle * Math.PI / 180 / DRAGON_WAVE_STEP) + 1; out.laneStep = DRAGON_WAVE_STEP; out.laneHalf = body;
    out.laneLen = out.projectileRange + body + pad; out.laneReach = out.origin;
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
  // 교관 확장 변형은 몰이 반경도 함께 커진다(night_parade wide: vacuum 13, 실측 한계 10.5). 몰이가 확정 영역 안에 들면 따로 그리지 않는다(bloodquake 혈진 9.5).
  if (skillId === 'night_parade' && variant(player, skillId, 'wide')) out.envelope = 10.5;
  if (skillId === 'blizzard' && variant(player, skillId, 'wide')) out.envelope = 10.5;
  if (out.envelopeKind === 'pull' && out.envelope <= (out.kind === 'circle' ? out.radius : out.range)) { out.envelope = 0; out.envelopeKind = ''; }
  if (split) {
    // 분열 화염: 주 투사체 직선 옆으로 ±.22rad 갈라지는 작은 투사체 둘(속도 15, 수명 .8, 반경 .55). 둘 다 조준 축 위 시작점(origin)에서 출발한다.
    out.lanes = 3; out.laneStep = SPLIT_ANGLE; out.laneHalf = SPLIT_RADIUS; out.laneLen = SPLIT_SPEED * SPLIT_LIFE + SPLIT_RADIUS + FRAME_PAD;
    out.laneBaseA = out.origin; out.laneSkipCenter = 1;
  }
  return out;
}
