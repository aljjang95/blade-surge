// Portrait fit belongs only to solo Astral standard. The normal threat target,
// camera controls, authored preset/offset and every other route remain owners.
/** @param {any} stage */
export function minimumBattleAspect(stage) {
  const expedition = stage?.expedition;
  return !stage?.party && !stage?.riftId && !expedition?.riftId && !expedition?.conquestId
    && expedition?.kind === 'dungeon' && expedition.id === 'astral_leviathan_spire'
    && expedition.depth === 'standard' ? .8 : 0;
}
export function battleAspectScale(aspect, minimumAspect = 0) {
  if (!Number.isFinite(aspect) || aspect <= 0 || !Number.isFinite(minimumAspect)
    || minimumAspect <= 0 || minimumAspect > 1 || aspect >= minimumAspect) return 1;
  // Keep an exceptionally narrow viewport bounded. The cap is not a promise
  // that every viewport/control setting can display the whole station.
  return Math.min(2.4, minimumAspect / aspect);
}
/**
 * Scale the camera-to-look-point ray, not the actor/target or preset vector.
 * This preserves the actual optical direction as well as the user's controls.
 * Scale one returns the original values without extra floating-point math.
 */
export function fitBattleCameraOffset(offset, lookOffset, aspect, minimumAspect = 0) {
  const scale = battleAspectScale(aspect, minimumAspect);
  if (scale === 1) return offset;
  return { x: lookOffset.x + (offset.x - lookOffset.x) * scale,
    y: lookOffset.y + (offset.y - lookOffset.y) * scale,
    z: lookOffset.z + (offset.z - lookOffset.z) * scale };
}
