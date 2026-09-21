// Authored solo objectives are separate from Conquest/party/rift rules.
/** @param {string} depth @param {Array<[number, string]>} gates */
const cooling = (depth, gates) => Object.freeze({
  id: `cinder_cooling_${depth}`, kind: 'cooling', holdSeconds: 2, radius: 1.6,
  padOffset: 3.5, heatSeconds: 4, warningSeconds: 1.4, ventSeconds: .8,
  gates: Object.freeze(gates.map(([roomId, label]) => Object.freeze({ roomId, label }))),
});
export const ROUTE_OBJECTIVES = Object.freeze({
  bellfall_crypt: Object.freeze({
    id: 'bellfall_bell_gates', holdSeconds: 2, radius: 3,
    gates: Object.freeze([
      Object.freeze({ roomId: 2, label: '1번 종문 · 북쪽 예배실' }),
      Object.freeze({ roomId: 3, label: '2번 종문 · 남쪽 회랑' }),
      Object.freeze({ roomId: 5, label: '3번 종문 · 남동쪽 납골실' }),
    ]),
  }),
  cinder_standard: cooling('standard', [[2, '1번 밸브 · 서쪽 수문'], [5, '2번 밸브 · 동쪽 수문']]),
  cinder_deep: cooling('deep', [[2, '1번 밸브 · 상류 냉각선'], [5, '2번 밸브 · 하류 냉각선'], [6, '3번 밸브 · 귀환 냉각선']]),
});

/** @param {any} stage */
export function routeObjectiveForStage(stage) {
  const expedition = stage?.expedition;
  if (stage?.party || stage?.riftId || expedition?.riftId || expedition?.conquestId ||
      expedition?.kind !== 'dungeon') return null;
  if (expedition.id === 'cinder_tide_lock') return expedition.depth === 'standard' ? ROUTE_OBJECTIVES.cinder_standard
    : expedition.depth === 'deep' ? ROUTE_OBJECTIVES.cinder_deep : null;
  return expedition.id === 'bellfall_crypt' && expedition.depth === 'standard' ? ROUTE_OBJECTIVES.bellfall_crypt : null;
}
