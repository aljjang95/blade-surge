import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HERO_IDS, HERO_LINES } from '../tools/voice/ko-lines.mjs';
import { heroVoiceName } from '../src/engine/hero-voice.js';

describe('한국어 영웅 보이스 계약', () => {
  test('다섯 영웅이 같은 20개 키를 갖고 실제 MP3를 제공한다', () => {
    const keys = HERO_IDS.map(id => HERO_LINES[id].lines.map(item => item.id));
    for (const heroKeys of keys) expect(heroKeys).toEqual(keys[0]);
    for (const heroId of HERO_IDS) for (const key of keys[0]) expect(existsSync(join('public/sfx/voice', `hero_${heroId}_${key}.mp3`))).toBe(true);
  });

  test('스킬 대사는 한국어 스킬명을 사용하고 레인저 선택 대사는 차용하지 않는다', () => {
    const rangerSelect = HERO_LINES.ranger.lines.find(item => item.id === 'select');
    expect(rangerSelect.text).toContain('바람추적자 실바');
    expect(HERO_LINES.knight.lines.find(item => item.id === 'skill0').text).toContain('성검 일섬');
    expect(heroVoiceName('ranger', 'select')).toBe('hero_ranger_select');
    expect(readFileSync('src/engine/hero-voice.js', 'utf8')).not.toContain('floor_start');
  });
});
