import { describe, expect, test } from 'bun:test';
import { CHAPTERS, ENEMIES, STAGES_PER_CHAPTER, stageDef } from '../src/data/stages.js';
import {
  BUBBLE_MAX, CHAPTER_LORE, CODEX, CODEX_TABS, DEX_SENTENCE_MAX, LORE_SPEAKERS,
  bossLore, chapterLore, chapterSceneLines, codexEntries,
} from '../src/data/lore.js';

const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean);

describe('챕터 장면', () => {
  test('모든 장에 장면이 있고 말풍선은 4~6개', () => {
    for (const chapter of CHAPTERS) {
      const lore = chapterLore(chapter.id);
      expect(lore, `${chapter.id}장`).not.toBeNull();
      const lines = chapterSceneLines(chapter.id);
      expect(lines.length).toBeGreaterThanOrEqual(4);
      expect(lines.length).toBeLessThanOrEqual(6);
    }
    expect(chapterSceneLines(99)).toEqual([]);
  });

  test('모든 말풍선·외침은 18자 이하이고 화자가 등록돼 있다', () => {
    for (const row of CHAPTER_LORE) {
      for (const { who, line } of row.scene) {
        expect(Object.keys(LORE_SPEAKERS)).toContain(who);
        expect(line.length, `${row.ch}장 '${line}'`).toBeLessThanOrEqual(BUBBLE_MAX);
        expect(line.length).toBeGreaterThan(0);
      }
      for (const boss of Object.values(row.bosses)) expect(boss.shout.length, `${row.ch}장 '${boss.shout}'`).toBeLessThanOrEqual(BUBBLE_MAX);
    }
  });

  test('합류 영웅이 장면에서 한 줄 말한다', () => {
    const joiner: Record<number, string> = { 1: 'knight', 2: 'barbarian', 3: 'mage', 4: 'rogue', 6: 'ranger', 7: 'blackcat' };
    for (const [ch, who] of Object.entries(joiner)) expect(chapterSceneLines(Number(ch)).some((l) => l.who === who), `${ch}장 ${who}`).toBe(true);
  });

  test('장마다 중간·지역 보스가 있고 관문 5·10 에서만 bossLore 가 나온다', () => {
    for (const chapter of CHAPTERS) {
      const bosses = chapterLore(chapter.id)!.bosses;
      for (const key of ['midboss', 'finalboss'] as const) {
        expect(bosses[key].name).toBeTruthy();
        expect(bosses[key].title).toBeTruthy();
        expect(bosses[key].shout).toBeTruthy();
      }
      expect(bossLore(stageDef(chapter.id, 5))).toEqual(bosses.midboss);
      expect(bossLore(stageDef(chapter.id, STAGES_PER_CHAPTER))).toEqual(bosses.finalboss);
      expect(bossLore(stageDef(chapter.id, 3))).toBeNull();
    }
  });
});

describe('도감', () => {
  test('탭 4개, id 중복 없음, 문장 길이·개수', () => {
    expect(CODEX_TABS).toEqual(['region', 'boss', 'monster', 'hero']);
    const ids = CODEX.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of CODEX) {
      expect(CODEX_TABS).toContain(e.tab);
      const ss = sentences(e.text);
      expect(ss.length, e.id).toBeGreaterThanOrEqual(2);
      expect(ss.length, e.id).toBeLessThanOrEqual(3);
      for (const s of ss) expect(s.length, `${e.id} '${s}'`).toBeLessThanOrEqual(DEX_SENTENCE_MAX);
    }
  });

  test('지역 7·보스 14·영웅 8, 이름이 정본과 같다', () => {
    const by = (tab: string) => CODEX.filter((e) => e.tab === tab);
    expect(by('region')).toHaveLength(CHAPTERS.length);
    expect(by('boss')).toHaveLength(CHAPTERS.length * 2);
    expect(by('hero')).toHaveLength(8);
    for (const e of by('region')) expect(e.name).toBe(CHAPTERS[e.ch - 1].name);
    for (const e of by('boss')) {
      const key = e.unlock.stage.endsWith('-5') ? 'midboss' : 'finalboss';
      expect(e.name).toBe(chapterLore(e.ch)!.bosses[key].name);
      expect(e.title).toBe(chapterLore(e.ch)!.bosses[key].title);
    }
  });

  test('몬스터 도감이 1~7장 로스터의 모든 적 id 를 덮고 이름이 ENEMIES 와 같다', () => {
    const roster = new Set<string>();
    for (let ch = 1; ch <= CHAPTERS.length; ch++) for (let st = 1; st <= STAGES_PER_CHAPTER; st++) {
      const stage = stageDef(ch, st);
      for (const wave of stage.waves) for (const id of wave) roster.add(id);
      // 보상 명단과 실제 전투 방 편성(장 전용 몸 적 포함) 모두 도감에 있어야 한다.
      for (const R of [stage.rosterFor(), (stage as any).combatRosterFor()]) for (const id of [...R.trash, ...R.ranged, ...R.elite]) roster.add(id);
    }
    const covered = new Map(CODEX.filter((e) => e.tab === 'monster').map((e) => [e.id.slice('monster-'.length), e]));
    for (const id of roster) {
      expect(covered.has(id), `도감에 없는 적 ${id}`).toBe(true);
      expect(covered.get(id)!.name, id).toBe((ENEMIES as Record<string, { name: string }>)[id].name);
    }
    for (const id of covered.keys()) expect(roster.has(id), `로스터에 없는 도감 몬스터 ${id}`).toBe(true);
  });

  test('해금 관문이 실제로 존재한다', () => {
    for (const e of CODEX) {
      const m = /^(\d+)-(\d+)$/.exec(e.unlock.stage);
      expect(m, e.id).not.toBeNull();
      expect(() => stageDef(Number(m![1]), Number(m![2]))).not.toThrow();
    }
  });

  test('codexEntries 는 잠금·해금을 가린다', () => {
    const locked = codexEntries({});
    expect(locked).toHaveLength(CODEX.length);
    for (const e of locked) {
      expect(e.unlocked).toBe(false);
      expect(e.text).toBe('');
      expect(e.hint).toBe(`${e.unlock.stage} 클리어 시 해금`);
    }
    const open = codexEntries({ stars: { '1-1': 1, '1-5': 3, '2-1': 0 } });
    const get = (id: string) => open.find((e) => e.id === id)!;
    expect(get('region-1').unlocked).toBe(true);
    expect(get('region-1').text).not.toBe('');
    expect(get('region-1').hint).toBe('');
    expect(get('boss-1-midboss').unlocked).toBe(true);
    expect(get('boss-1-finalboss').unlocked).toBe(false);
    expect(get('region-2').unlocked).toBe(false);
    expect(get('hero-neb').unlocked).toBe(true);
    expect(get('hero-werewolf').hint).toBe('7-10 클리어 시 해금');
    expect(codexEntries(undefined as never).every((e) => !e.unlocked)).toBe(true);
  });
});
