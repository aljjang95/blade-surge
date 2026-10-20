// 모든 영웅의 선택·전투·생존 대사는 자신의 한국어 보이스 키를 사용한다.
export const heroVoiceName = (heroId, event) => `hero_${heroId}_${event}`;
