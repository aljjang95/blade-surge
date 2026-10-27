// 캠페인의 모양(지역 수·지역당 관문 수) 정본. 서버 워커(party-state)와 데이터(loot-tables, stages)가 같은 값을 읽는다.
// 지역을 늘릴 때는 stages.js 의 CHAPTERS 에 항목을 더하고 여기 CHAPTER_COUNT 를 함께 올린다.
// 둘이 어긋나면 stages.js 가 불러올 때 바로 예외를 던지고 test/campaign-shape.test.ts 가 막는다.
export const CHAPTER_COUNT = 6;
export const STAGES_PER_CHAPTER = 10;
/** 캠페인 관문 총수(1부터 시작하는 stageIdx 의 상한). */
export const CAMPAIGN_STAGE_COUNT = CHAPTER_COUNT * STAGES_PER_CHAPTER;
