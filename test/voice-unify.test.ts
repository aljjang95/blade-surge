import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { auditVoiceManifest } from '../tools/voice/voice-audit.mjs';
import { HEROES } from '../src/data/heroes.js';
import { heroVoiceName } from '../src/engine/hero-voice.js';

describe('보이스 통일 (직업별 한국어 한 목소리)', () => {
  const { errors, stats } = auditVoiceManifest({ heroes: HEROES }) as { errors: string[]; stats: any };

  test('매니페스트 감사 오류 0건', () => {
    expect(errors).toEqual([]);
  });

  test('영어(한국어 아닌) 대사 0건', () => {
    expect(stats.english).toBe(0);
    expect(stats.nonKorean).toBe(0);
    expect(stats.asrNonKorean).toBe(0);
  });

  test('소유자(직업·아나운서·보스)마다 목소리 정확히 1개', () => {
    expect(stats.ownersWithMultipleVoices).toBe(0);
  });

  test('모든 mp3 가 매니페스트에 있다', () => {
    const disk = readdirSync('public/sfx/voice').filter((f: string) => f.endsWith('.mp3')).length;
    expect(stats.files).toBe(disk);
  });

  test('kit 를 빌리는 영웅은 기준 직업 목소리를 쓴다', () => {
    expect(heroVoiceName('blackcat', 'atk')).toBe('hero_ranger_atk');
    expect(heroVoiceName('werewolf', 'ult')).toBe('hero_barbarian_ult');
    expect(stats.borrowers).toEqual({ blackcat: 'ranger', werewolf: 'barbarian' });
  });
});
