// Fish Audio 입력 대본을 영웅별 JSON으로 고정한다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HERO_IDS, HERO_LINES, toFishLines } from './ko-lines.mjs';

const outDir = process.argv[2] || 'work/voice-ko';
mkdirSync(outDir, { recursive: true });
for (const heroId of HERO_IDS) {
  const hero = HERO_LINES[heroId];
  const payload = {
    heroId,
    refText: hero.refText,
    lines: toFishLines(heroId),
    source: hero.lines,
    postProcessing: 'none',
    humanListening: 'pending',
  };
  writeFileSync(join(outDir, `${heroId}-lines.json`), JSON.stringify(payload, null, 2) + '\n');
  writeFileSync(join(outDir, `${heroId}-fish-lines.json`), JSON.stringify(payload.lines, null, 2) + '\n');
}
console.log(JSON.stringify({ outDir, heroes: HERO_IDS, linesPerHero: HERO_IDS.map(id => HERO_LINES[id].lines.length) }));
