// Standard-route objectives are separate from deep expedition/Conquest altars.
export const ROUTE_OBJECTIVES = Object.freeze({
  bellfall_crypt: Object.freeze({
    id: 'bellfall_bell_gates', holdSeconds: 2, radius: 3,
    gates: Object.freeze([
      Object.freeze({ roomId: 2, label: '1번 종문 · 북쪽 예배실' }),
      Object.freeze({ roomId: 3, label: '2번 종문 · 남쪽 회랑' }),
      Object.freeze({ roomId: 5, label: '3번 종문 · 남동쪽 납골실' }),
    ]),
  }),
});

/** @param {any} stage */
export function routeObjectiveForStage(stage) {
  const expedition = stage?.expedition;
  if (stage?.party || stage?.riftId || expedition?.riftId || expedition?.conquestId ||
      expedition?.kind !== 'dungeon' || expedition?.depth !== 'standard') return null;
  return expedition.id === 'bellfall_crypt' ? ROUTE_OBJECTIVES.bellfall_crypt : null;
}
