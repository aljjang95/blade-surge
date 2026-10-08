import { MP_BASE, skillMpCost } from '../game/progression.js';

const NEUTRAL = Object.freeze({ status: 'neutral', label: '', detail: '', progress: 0, ready: false, locked: false });
const write = (out, status, label, detail, progress = 0, ready = false, locked = false) => {
  out.status = status; out.label = label; out.detail = detail; out.progress = progress; out.ready = ready; out.locked = locked;
  return out;
};

/** 표시 전용 자원 상태. 실제 발동·모션 취소 판정은 Player에 남긴다. */
export function skillFeedback(battle, slot, out = { ...NEUTRAL }) {
  const player = battle?.player;
  if (!player || typeof player.combatSkillIndex !== 'function' || typeof player.unlocked !== 'function') return NEUTRAL;
  const index = player.combatSkillIndex(slot), skill = player.def?.skills?.[index];
  if (!skill) return NEUTRAL;
  if (!battle.active || !player.alive) return write(out, 'neutral', '', '전투 종료');
  if (battle.paused || battle.input?.enabled === false) return write(out, 'neutral', '', '전투 입력 정지 중');
  const mode = player.auto ? '자동 전투 · ' : '';
  if (!player.unlocked(index)) return write(out, 'locked', '', `${mode}Lv.${skill.unlock} 해금`, 0, false, true);
  const sourceCooldown = player.cds?.[index];
  if (skill.ult ? !Number.isFinite(player.ult) || !Number.isFinite(player.ultMax) || player.ultMax <= 0
    : !Number.isFinite(sourceCooldown) || !Number.isFinite(skill.cd) || skill.cd <= 0) {
    return write(out, 'neutral', '', '자원 상태 확인 중');
  }
  const cooldown = Math.max(0, sourceCooldown || 0);
  if (skill.ult && player.ult < player.ultMax) {
    const charge = Math.max(0, Math.min(1, player.ult / player.ultMax));
    const label = `${Math.floor(charge * 100)}%`;
    return write(out, 'charge', label, `${mode}궁극기 충전 ${label}`, 1 - charge);
  }
  if (!skill.ult && cooldown > 0) {
    // 0.01초가 남아도 0.0/준비로 보이지 않도록 위로 반올림한다.
    const label = cooldown >= 10 ? String(Math.ceil(cooldown)) : (Math.ceil(cooldown * 10) / 10).toFixed(1);
    return write(out, 'cooldown', label, `${mode}재사용 대기 ${label}초`, Math.max(0, cooldown / skill.cd));
  }
  const cost = skillMpCost(skill), mp = Number.isFinite(player.mp) ? player.mp : MP_BASE;
  if (cost > mp) return write(out, 'mana', 'MP 부족', `${mode}MP ${cost} 필요 · 현재 ${Math.floor(mp)}`);
  return write(out, 'ready', '', `${mode}자원 준비됨${cost ? ` · MP ${cost}` : ''}`, 0, true);
}
