// 영웅별 한국어 보이스 대본. 기합은 단어를 읽는 대사가 아니라 짧은 비언어 발성으로 유지한다.
const line = (id, text, emotion, kind = 'line') => ({ id, text, emotion, kind });

const HERO_LINE_DATA = {
  knight: {
    refText: '나는 검성 아르카다. 모두를 지키기 위해, 이 성검과 함께 끝까지 싸우겠다.',
    lines: [
      line('select', '나는 검성 아르카다. 모두를 지키기 위해, 이 성검과 함께 끝까지 싸우겠다.', 'determined'),
      line('atk0', '하!', 'excited', 'bark'), line('atk1', '타앗!', 'excited', 'bark'), line('atk2', '흐읍!', 'determined', 'bark'), line('atk3', '하아앗!', 'excited', 'bark'),
      line('fin0', '하앗!', 'excited', 'bark'), line('fin1', '쓰러져라!', 'angry', 'bark'),
      line('skill0', '성검 일섬!', 'determined', 'bark'), line('skill1', '철벽 강타!', 'angry', 'bark'), line('skill2', '심판의 빛!', 'confident', 'bark'),
      line('skill6', '성검, 태양파쇄!', 'excited', 'bark'), line('ult', '용살검, 천공!', 'excited'),
      line('hurt0', '윽!', 'pain', 'bark'), line('hurt1', '큭!', 'pain', 'bark'), line('hurt2', '흣!', 'pain', 'bark'),
      line('low_hp', '아직… 쓰러질 수 없어. 모두를 지켜야 해.', 'determined'), line('perfect', '느려!', 'confident', 'bark'),
      line('win', '빛은 꺼지지 않는다. 다음 전장으로 가자.', 'triumphant'), line('death', '미안해… 여기까지인가…', 'sad'), line('revive', '다시 일어선다! 아직 끝나지 않았어!', 'determined'),
    ],
  },
  barbarian: {
    refText: '나는 광전사 드라칸이다. 피가 끓는구나. 오늘 이 전장을 전부 부숴 버리겠다.',
    lines: [
      line('select', '나는 광전사 드라칸이다. 피가 끓는구나. 오늘 이 전장을 전부 부숴 버리겠다.', 'excited'),
      line('atk0', '라아!', 'excited', 'bark'), line('atk1', '흐읏!', 'angry', 'bark'), line('atk2', '그라아!', 'excited', 'bark'), line('atk3', '으랴아!', 'angry', 'bark'),
      line('fin0', '박살이다!', 'excited', 'bark'), line('fin1', '부숴라!', 'angry', 'bark'),
      line('skill0', '회오리 참격!', 'excited', 'bark'), line('skill1', '대지 분쇄!', 'angry', 'bark'), line('skill2', '광폭화!', 'angry', 'bark'),
      line('skill6', '혈왕, 대지붕괴!', 'angry', 'bark'), line('ult', '지옥의 도끼다!', 'excited'),
      line('hurt0', '크윽!', 'pain', 'bark'), line('hurt1', '그흑!', 'pain', 'bark'), line('hurt2', '아악!', 'pain', 'bark'),
      line('low_hp', '피가 더 필요해… 좋아, 이제 진짜 화가 났다!', 'angry'), line('perfect', '하! 그게 전부냐?', 'confident', 'bark'),
      line('win', '하하하! 이 정도로는 배가 안 차는군. 다음은 누구냐!', 'triumphant'), line('death', '이런… 아직… 더 부술 수 있는데…', 'sad'), line('revive', '아직 안 끝났다! 다시 간다!', 'excited'),
    ],
  },
  mage: {
    refText: '나는 대마도사 리아. 별의 흐름은 이미 정해졌다. 이제 조용히, 내 마법을 지켜봐.',
    lines: [
      line('select', '나는 대마도사 리아. 별의 흐름은 이미 정해졌다. 이제 조용히, 내 마법을 지켜봐.', 'calm'),
      line('atk0', '하!', 'calm', 'bark'), line('atk1', '흐읍!', 'determined', 'bark'), line('atk2', '가라!', 'excited', 'bark'), line('atk3', '지금이야!', 'excited', 'bark'),
      line('fin0', '끝내!', 'angry', 'bark'), line('fin1', '부서져!', 'excited', 'bark'),
      line('skill0', '화염구!', 'excited', 'bark'), line('skill1', '번개 사슬!', 'angry', 'bark'), line('skill2', '빙결 폭풍!', 'determined', 'bark'),
      line('skill6', '성좌, 별감옥!', 'confident', 'bark'), line('ult', '메테오 스톰!', 'excited'),
      line('hurt0', '아!', 'pain', 'bark'), line('hurt1', '큭!', 'pain', 'bark'), line('hurt2', '흣!', 'pain', 'bark'),
      line('low_hp', '마력이… 아직 남아 있어. 조금만 더 버티면 돼.', 'frustrated'), line('perfect', '예측했어.', 'confident', 'bark'),
      line('win', '계산대로야. 별들이 조용해졌네.', 'triumphant'), line('death', '별빛이… 보이지 않아…', 'sad'), line('revive', '아직 내 마법은 끝나지 않았어.', 'determined'),
    ],
  },
  rogue: {
    refText: '나는 암살자 카인. 조용히 다가가, 한 번에 끝내겠어.',
    lines: [
      line('select', '나는 암살자 카인. 조용히 다가가, 한 번에 끝내겠어.', 'playful'),
      line('atk0', '쳇!', 'playful', 'bark'), line('atk1', '흣!', 'excited', 'bark'), line('atk2', '하!', 'excited', 'bark'), line('atk3', '쉿!', 'calm', 'bark'),
      line('fin0', '끝이야.', 'confident', 'bark'), line('fin1', '사라져.', 'angry', 'bark'),
      line('skill0', '그림자 질주!', 'excited', 'bark'), line('skill1', '독무 폭탄!', 'angry', 'bark'), line('skill2', '환영 난무!', 'excited', 'bark'),
      line('skill6', '야행, 그림자연무!', 'confident', 'bark'), line('ult', '천 개의 칼날!', 'excited'),
      line('hurt0', '큭!', 'pain', 'bark'), line('hurt1', '칫!', 'pain', 'bark'), line('hurt2', '아!', 'pain', 'bark'),
      line('low_hp', '방심했어… 하지만 아직 내 그림자는 살아 있어.', 'frustrated'), line('perfect', '아쉽네.', 'playful', 'bark'),
      line('win', '깔끔하네. 다음 목표로 가자.', 'confident'), line('death', '이게… 마지막 그림자인가…', 'sad'), line('revive', '죽음아, 조금만 기다려.', 'confident'),
    ],
  },
  ranger: {
    refText: '나는 바람추적자 실바. 숲의 바람이 길을 알려 주는 한, 내 화살은 한 번도 빗나가지 않아.',
    lines: [
      line('select', '나는 바람추적자 실바. 숲의 바람이 길을 알려 주는 한, 내 화살은 한 번도 빗나가지 않아.', 'confident'),
      line('atk0', '하!', 'determined', 'bark'), line('atk1', '타앗!', 'excited', 'bark'), line('atk2', '흐읍!', 'determined', 'bark'), line('atk3', '놓치지 않아!', 'excited', 'bark'),
      line('fin0', '받아라!', 'excited', 'bark'), line('fin1', '바람과 함께!', 'determined', 'bark'),
      line('skill0', '바람 관통화살!', 'excited', 'bark'), line('skill1', '삼중 추적화살!', 'confident', 'bark'), line('skill2', '바람의 이탈!', 'determined', 'bark'),
      line('skill6', '질풍, 사냥각인!', 'excited', 'bark'), line('ult', '폭풍의 일곱 화살!', 'excited'),
      line('hurt0', '아!', 'pain', 'bark'), line('hurt1', '큭!', 'pain', 'bark'), line('hurt2', '흣!', 'pain', 'bark'),
      line('low_hp', '바람이 흔들려… 그래도 내 활은 아직 멈추지 않아.', 'determined'), line('perfect', '바람이 먼저 알려 줬어.', 'confident', 'bark'),
      line('win', '숲의 바람이 다시 고요해졌네. 잘했어.', 'triumphant'), line('death', '숲이… 멀어져…', 'sad'), line('revive', '바람이 다시 불어. 이번엔 내가 길을 열게!', 'determined'),
    ],
  },
};

export const HERO_LINES = Object.freeze(HERO_LINE_DATA);
export const HERO_IDS = Object.freeze(Object.keys(HERO_LINE_DATA));

export function toFishLines(heroId) {
  const hero = HERO_LINES[heroId];
  if (!hero) throw new Error(`unknown hero: ${heroId}`);
  return hero.lines.map(({ id, text, emotion }) => ({ id, text: `[${emotion}] ${text}`, ...((heroId === 'barbarian' || heroId === 'rogue') && id === 'ult' ? { temperature: 0.35, top_p: 0.55 } : {}) }));
}
