// Silva uses existing neutral narration; character-name lines stay with their
// original cast. Wordless combat efforts are selected separately by voiceId.
const rangerNarration = { select: 'floor_start', revive: 'rebirth', death: 'defeat', win: 'floor_clear', low_hp: 'low_hp' };
export const heroVoiceName = (heroId, event) => heroId === 'ranger' ? rangerNarration[event] : `hero_${heroId}_${event}`;
