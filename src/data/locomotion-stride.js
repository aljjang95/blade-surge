// 몬스터 걷기·달리기 클립의 보폭 속도(m/s, 액터 배율 1 기준). 클립을 배율 1 로 제자리 재생할 때 디딤발(스키닝 정점)이
// 뒤로 가는 화면 속도를 tools/anim-audit-qa.mjs 로 잰 값이다(2026-10-22, 같은 모델은 액터 배율에 정비례).
// 다리가 없는 슬라임·비행형은 없다. 모델·클립을 바꾸면 감사 도구를 다시 돌려 이 표를 갱신한다.
export const MONSTER_STRIDE = Object.freeze({
  Big_Alien: Object.freeze({ run: 2.162, walk: 0.802 }),
  Big_ArchiveMonarch: Object.freeze({ run: 0.95, walk: 0.493 }),
  Big_BlueDemon: Object.freeze({ run: 1.536, walk: 0.749 }),
  Big_Demon: Object.freeze({ run: 1.682, walk: 0.82 }),
  Big_KilnTyrant: Object.freeze({ run: 1.682, walk: 0.821 }),
  Big_MushroomKing: Object.freeze({ run: 1.112, walk: 0.741 }),
  Big_Ninja: Object.freeze({ run: 2.08, walk: 0.772 }),
  Big_Orc: Object.freeze({ run: 1.688, walk: 0.886 }),
  Big_Orc_Skull: Object.freeze({ run: 1.394, walk: 0.767 }),
  Big_PulleyColossus: Object.freeze({ run: 2.463, walk: 0.914 }),
  Big_Tribal: Object.freeze({ run: 2.52, walk: 0.902 }),
  Big_Yeti: Object.freeze({ run: 0.95, walk: 0.494 }),
  Blob_Mushnub: Object.freeze({ run: 1.584, walk: 1.055 }),
  Blob_Mushnub_Evolved: Object.freeze({ run: 2.124, walk: 1.414 }),
  Blob_Orc: Object.freeze({ run: 2.496, walk: 0.894 }),
  Skeleton_BellKing: Object.freeze({ run: 3.698, walk: 1.331 }),
  Skeleton_Bulwark: Object.freeze({ run: 3.698, walk: 1.331 }),
  Skeleton_OathRemnant: Object.freeze({ run: 1.94, walk: 1.068 }),
  Skeleton_Runekeeper: Object.freeze({ run: 4.411, walk: 0.955 }),
  Skeleton_Skirmisher: Object.freeze({ run: 2.737, walk: 1.015 }),
  Skeleton_Vanguard: Object.freeze({ run: 3.088, walk: 1.111 }),
});
