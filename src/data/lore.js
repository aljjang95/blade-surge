// 세계관 연출 데이터 정본(docs/WORLD_BIBLE.md). 긴 글 대신 짧은 장면·보스 칭호·선택형 도감으로 정체성을 준다.
// 지역 이름·관문 제목·장면 문장 원문은 stages.js(CHAPTERS)·campaign-story.js 가 정본이고, 여기는 연출용 짧은 대사만 둔다.
// 말풍선·외침은 BUBBLE_MAX(18자) 이하 — 공백 포함 글자 수. test/lore.test.ts 가 막는다.

export const BUBBLE_MAX = 18;

/** 장면 화자. name 이 빈 문자열이면 해설(이름표 없음). */
export const LORE_SPEAKERS = Object.freeze({
  narrator: { name: '', color: '#d8d2c4' },
  neb: { name: '네브', color: '#f2d27a' },
  knight: { name: '아르카', color: '#9cc6ff' },
  barbarian: { name: '드라칸', color: '#ff9a62' },
  mage: { name: '리아', color: '#b9a4ff' },
  rogue: { name: '카인', color: '#7fd8c8' },
  ranger: { name: '실바', color: '#9be27a' },
  blackcat: { name: '그믐밤 사냥꾼', color: '#c7a3ff' },
  werewolf: { name: '늑대인간 족장', color: '#ff7a7a' },
  boss: { name: '', color: '#ffcf5a' },
});

/**
 * 장(1부터)마다: scene = 처음 입장 장면(말풍선 4~6개, 10~20초), bosses = 'midboss'·'finalboss' 등장 띠 문구.
 * boss.who 는 화자 이름표로 쓰지 않고 띠에 '칭호 · 이름'으로 쓴다.
 * @typedef {{ who: keyof typeof LORE_SPEAKERS, line: string }} LoreLine
 * @typedef {{ name: string, title: string, shout: string }} BossLore
 * @typedef {{ ch: number, scene: LoreLine[], bosses: { midboss: BossLore, finalboss: BossLore } }} ChapterLore
 */
/** @type {ReadonlyArray<ChapterLore>} */
export const CHAPTER_LORE = Object.freeze([
  {
    ch: 1,
    scene: [
      { who: 'narrator', line: '자정마다 어제가 지워진다.' },
      { who: 'narrator', line: '불리지 않은 이름은 사라진다.' },
      { who: 'neb', line: '여기 묘비, 네 이름이야.' },
      { who: 'knight', line: '…기억나지 않는다.' },
      { who: 'neb', line: '괜찮아. 내가 기억해.' },
      { who: 'neb', line: '종을 깨우러 가자.' },
    ],
    bosses: {
      midboss: { name: '세렌', title: '애도의 기사', shout: '다시는 보내지 않는다!' },
      finalboss: { name: '에일른', title: '기억을 가둔 종왕', shout: '아무도 잊지 않게, 가둔다.' },
    },
  },
]);

export function chapterLore(ch) {
  return CHAPTER_LORE.find((row) => row.ch === ch) || null;
}

/** 캠페인 관문(stageDef 결과)의 보스 등장 문구. X-5·X-10 이 아니거나 원정·아레나면 null. */
export function bossLore(stage) {
  if (!stage || stage.expedition || !Number.isInteger(stage.ch)) return null;
  const rank = stage.encounter?.rank;
  if (rank !== 'midboss' && rank !== 'finalboss') return null;
  return chapterLore(stage.ch)?.bosses?.[rank] || null;
}
