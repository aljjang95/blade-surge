// 마을 NPC 한 줄 대사(docs/TOWN_AUDIT.md · docs/WORLD_BIBLE.md 0장): 말풍선 하나에 18자 이하, 한 가지 사실만.
// 걷기 HUD의 가까운 지점 카드 머리 줄에 보인다. 읽지 않아도 진행에는 지장이 없다. 키는 캠페인 지역(1~7)과 상호작용 종류다.
export const TOWN_LINE_MAX = 18;

export const TOWN_LINES = Object.freeze({
  1: Object.freeze({ guide: '처음이죠? 천천히 둘러봐요', merchant: '이름을 불러 주면 덤을 줘요', trainer: '종이 울리면 몸이 기억해요', steward: '검끼리는 이름을 안 잊지', smith: '날 세우면 이름도 새겨 주지', waystone: '누가 당신 이름을 불렀어요' }),
  2: Object.freeze({ merchant: '식기 전에 데워 둔 물약이야', trainer: '같은 하루라도 손은 늘어', steward: '불씨처럼 버텨 봐', smith: '망치는 멈춰도 온기는 남아', waystone: '다른 불가로 데려다 줄게' }),
  3: Object.freeze({ merchant: '내일 팔 물건이 어제 왔어요', trainer: '기록보다 몸이 먼저예요', steward: '얼음 위에선 발부터 봐', smith: '서리 낀 칼도 갈면 빛나', waystone: '책장 사이 길을 열게요' }),
  4: Object.freeze({ merchant: '젖은 물약은 반값이야', trainer: '파도는 같은 박자로 와', steward: '등대 아래선 숨을 골라', smith: '녹슨 닻도 다시 벼려 주지', waystone: '진짜 등대 쪽으로 가요' }),
  5: Object.freeze({ merchant: '새벽이 오면 값을 받죠', trainer: '혼자 짊어지지 마요', steward: '왕관 없이도 이길 수 있어', smith: '빈 왕좌보다 단단히 벼려', waystone: '새벽 쪽으로 걸어요' }),
  6: Object.freeze({ merchant: '돌아온 기념으로 하나 더', trainer: '같이 걸으면 덜 지쳐요', steward: '집에 가기 전 한 판?', smith: '집에 걸어 둘 칼 하나', waystone: '누구든 집으로 데려다 줘요' }),
  7: Object.freeze({ merchant: '종이 어긋나도 장사는 해요', trainer: '세 박자를 맞춰 봐요', steward: '금 간 종처럼 버텨', smith: '금 간 날은 다시 붙여 주지', waystone: '종탑 너머로 갈 수 있어요' }),
});

/** 지역·종류의 한 줄 대사. 없으면 null(카드는 기존 머리 줄을 쓴다). */
export function townLine(chapter, kind) {
  return TOWN_LINES[chapter]?.[kind] || null;
}
