/** QA oracle only: require actual HP loss while preserving the existing dodge rule. */
export function validateRuptureEvidence(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 2) return false;
  if (new Set(rows.map(row => row.targetId)).size !== rows.length) return false;
  return rows.some(row => row.delta > 0) && rows.every(row => {
    if (!Number.isInteger(row.targetId) || row.targetId <= 0) return false;
    if (![row.before, row.after, row.delta].every(Number.isFinite)) return false;
    if (row.before <= 0 || row.after < 0 || row.delta !== row.before - row.after) return false;
    if (row.isLinkPrimary !== false) return false;
    if (row.quiet !== true || row.noProc !== true || row.apexProc !== true) return false;
    if (row.delta > 0) return true;
    return row.delta === 0 && row.missObserved === true && row.beforeState === 'chase'
      && row.afterState === 'dodge' && row.beforeStun === 0 && row.dodgeChance > 0;
  });
}
