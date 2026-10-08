const NEUTRAL = Object.freeze({ status: 'neutral', label: '공격', detail: '', stage: 0, total: 0,
  progress: 0, finisher: false, nextStage: null, stageLabel: '', cue: '', counterActive: false, counterSeconds: 0 });
const remaining = value => (Math.ceil(value * 10) / 10).toFixed(1);

/** 표시 전용. 연계 보존과 마무리 강화는 서로 다른 실제 Player 상태다. */
export function comboFeedback(battle) {
  const player = battle?.player;
  if (!battle?.active || battle.paused || battle.input?.enabled === false || !player?.alive || player.auto || player.stun > 0) return NEUTRAL;
  const combo = player.def?.combo, index = player.comboIdx;
  if (!Array.isArray(combo) || !combo.length) return NEUTRAL;
  const counterActive = Number.isFinite(player.counterWindow) && player.counterWindow > 0;
  const counterSeconds = counterActive ? Number(remaining(player.counterWindow)) : 0;
  const counterDetail = counterActive ? ` · 마무리 강화 ${counterSeconds.toFixed(1)}초` : '';
  if (player.state !== 'attack') {
    if (!['idle', 'move', 'dodge'].includes(player.state)) return NEUTRAL;
    const resume = player.comboResume;
    const canResume = Number.isSafeInteger(resume?.idx) && resume.idx >= 0 && resume.idx < combo.length
      && Number.isFinite(resume.t) && resume.t > 0;
    if (!canResume && !counterActive) return NEUTRAL;
    const dodging = player.state === 'dodge';
    if (canResume) {
      const stage = resume.idx + 1, total = combo.length, seconds = remaining(resume.t);
      const finisher = combo[resume.idx].finisher === true;
      return { status: dodging ? 'dodge-resume' : 'resume', stage, total, progress: 0,
        finisher, nextStage: null, counterActive, counterSeconds,
        label: dodging ? '회피 중' : '이어치기',
        stageLabel: counterActive && finisher ? `${stage}/${total}타 · 강화` : `다음 ${stage}/${total}타`, cue: `연계 ${seconds}초`,
        detail: `${dodging ? '회피 후 ' : ''}다음 ${stage}/${total}타 · 연계 보존 ${seconds}초${counterDetail}` };
    }
    return { status: dodging ? 'dodge-counter' : 'counter', stage: 0, total: combo.length, progress: 0,
      finisher: false, nextStage: null, counterActive, counterSeconds, label: dodging ? '회피 중' : '공격',
      stageLabel: '마무리 강화', cue: `${counterSeconds.toFixed(1)}초`,
      detail: `${dodging ? '회피 후 공격 가능 · ' : ''}연계의 마무리 강화 ${counterSeconds.toFixed(1)}초` };
  }
  if (!Number.isSafeInteger(index) || index < 0 || index >= combo.length
    || !player.current || player.current !== combo[index]
    || typeof player.attackProgress !== 'function' || typeof player.canQueueCombo !== 'function') return NEUTRAL;
  const progress = player.attackProgress();
  if (!Number.isFinite(progress) || progress < 0 || progress >= 1) return NEUTRAL;
  const stage = index + 1, total = combo.length, finisher = player.current.finisher === true;
  const nextStage = stage < total ? stage + 1 : 1;
  const status = player.comboQueued ? 'queued' : player.canQueueCombo() ? 'ready' : 'windup';
  const prefix = finisher ? `${stage}/${total}타 · 마무리` : `${stage}/${total}타`;
  const cue = status === 'queued' ? `다음 ${nextStage}타` : status === 'ready' ? '다시 누르기' : '준비';
  return { status, stage, total, progress, finisher, nextStage: status === 'queued' ? nextStage : null,
    counterActive, counterSeconds, stageLabel: counterActive && finisher ? `${stage}/${total}타 · 강화` : prefix, cue,
    label: status === 'queued' ? '예약됨' : status === 'ready' ? '연계' : '공격',
    detail: `${prefix} · ${cue}${counterDetail}` };
}
