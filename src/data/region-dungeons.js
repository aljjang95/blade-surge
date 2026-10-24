// 던전 → 캠페인 지역(마을) 배정표. 지역 X 의 던전은 캠페인 (X-1)-10 을 처음 클리어해 지역 X 마을이 열린 뒤에 보인다.
// 기준: 각 던전이 처음부터 갖고 있던 기반 장(expansion.js dungeon(..., ch, ...))과 테마. 불·잿·제련은 2지역(불씨 용광로),
// 서리·별빛은 3지역(서리 서고), 조수·심연은 4지역(별잠 등대), 왕관·사막은 5지역(새벽 성문), 혜성은 6지역(귀환)이다.
// 예외 둘: 오로라 빙정호(기반 장 3, 서리)는 그대로 3지역, 왕관붕괴 빙하(기반 장 3)는 이름과 '왕관' 기믹을 따라 5지역으로 옮겼다.
// 표에 없는 경로(야외 필드 등)는 지역 잠금이 없다.
export const DUNGEON_REGION = Object.freeze({
  // 1 · 종지기 정원 마을 — 정원·종
  glass_garden: 1,
  bellfall_crypt: 1,
  rootbound_grotto: 1,
  hollowbell_arboretum: 1,
  // 2 · 불씨 용광로 마을 — 잿불·제련·용광로
  ember_vault: 2,
  cinder_tide_lock: 2,
  ashforge_catacomb: 2,
  slagwater_foundry: 2,
  emberwake_drydock: 2,
  sunbrass_quarry: 2,
  // 3 · 서리 서고 마을 — 별빛·서리
  star_archive: 3,
  nightglass_observatory: 3,
  astral_leviathan_spire: 3,
  aurora_icewell: 3,
  // 4 · 별잠 등대 마을 — 조수·심연
  eclipse_hydra_vault: 4,
  glacier_tide_basin: 4,
  verdigris_sanctum: 4,
  // 5 · 새벽 성문 마을 — 왕관·사막
  sable_mirage_basin: 5,
  crownfall_glacier: 5,
  // 6 · 함께 잇는 귀환 마을 — 혜성 요새
  comet_bastion: 6,
});

/** 던전의 배정 지역. 표에 없으면 0(지역 잠금 없음). */
export const dungeonRegion = (id) => (Object.hasOwn(DUNGEON_REGION, id) ? DUNGEON_REGION[id] : 0);

/** 지역 하나에 배정된 던전 id(배정표 순서). */
export const regionDungeonIds = (chapter) => Object.keys(DUNGEON_REGION).filter((id) => DUNGEON_REGION[id] === chapter);
