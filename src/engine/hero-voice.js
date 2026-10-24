import { HEROES } from '../data/heroes.js';

// 모든 영웅의 선택·전투·생존 대사는 자신의 한국어 보이스 키를 사용한다.
// voiceId 가 있는 영웅(늑대인간 족장)은 그 보이스 세트를 빌려 쓴다.
export const heroVoiceName = (heroId, event) => `hero_${HEROES[heroId]?.voiceId || heroId}_${event}`;
