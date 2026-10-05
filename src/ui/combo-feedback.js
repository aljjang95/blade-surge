const NEUTRAL = Object.freeze({ status: 'neutral', label: '공격', detail: '', stage: 0, total: 0,
  progress: 0, finisher: false, nextStage: null });

/** Presentation only. Player methods remain the authority for progression and input acceptance. */
export function comboFeedback(battle) {
  const player = battle?.player;
  if (!battle?.active || battle.paused || !player?.alive || player.auto || player.state !== 'attack') return NEUTRAL;
  const combo = player.def?.combo, index = player.comboIdx;
  if (!Array.isArray(combo) || !Number.isSafeInteger(index) || index < 0 || index >= combo.length
    || !player.current || player.current !== combo[index]
    || typeof player.attackProgress !== 'function' || typeof player.canQueueCombo !== 'function') return NEUTRAL;
  const progress = player.attackProgress();
  if (!Number.isFinite(progress) || progress < 0 || progress >= 1) return NEUTRAL;
  const stage = index + 1, total = combo.length, finisher = player.current.finisher === true;
  const nextStage = stage < total ? stage + 1 : 1;
  const status = player.comboQueued ? 'queued' : player.canQueueCombo() ? 'ready' : 'windup';
  const prefix = finisher ? `${stage}/${total}타 · 마무리` : `${stage}/${total}타`;
  return { status, stage, total, progress, finisher, nextStage: status === 'queued' ? nextStage : null,
    label: status === 'queued' ? '예약됨' : status === 'ready' ? '연계' : '공격',
    detail: `${prefix} · ${status === 'queued' ? `다음 ${nextStage}타` : status === 'ready' ? '다시 누르기' : '준비'}` };
}
