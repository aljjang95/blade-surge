/**
 * 보이스 대본 — 영어 + 기합(비언어). 던파식 액션 VO.
 * 목소리 정체성은 VOICES(설명문 → Qwen VoiceDesign), 대사는 LINES(연기 지시 + 대사 → Seed Audio, @Audio1 클론).
 *   kind: 'bark' = 짧은 기합/외침(SFX 레이어, 겹쳐 재생, 1.2초 이내)  ·  'line' = 대사(나레이션 채널, 덕킹)
 *   text 는 ASR 로 대조한다. 기합은 길이로 대조한다.
 */
export const VOICES = {
  knight:    { desc: 'Young heroic male knight, bright resonant baritone, noble and fearless, the voice of a champion who fights with his whole heart. Clean English, no accent.', ref: 'By my sword and by the light — I will not fall. Stand with me!' },
  barbarian: { desc: 'Massive barbarian warrior. Deep, gravelly, chest-rumbling bass, wild and ferocious, always on the edge of a roar. English.', ref: 'Blood and thunder! Come on, then — I will split you in two!' },
  mage:      { desc: 'Young woman archmage. Clear, crystalline, precise voice with calm authority that turns fierce and commanding when she casts. English.', ref: 'The stars answer to me. Burn, freeze, and fall — every one of you.' },
  rogue:     { desc: 'Male assassin. Low, sly, whispery tenor, cold and quick, a blade in the dark who never raises his voice unless he is killing. English.', ref: 'You never saw me coming. Nobody ever does. Goodbye.' },
  narrator:  { desc: 'Epic fantasy game announcer. Deep, dramatic, resonant male voice with gravitas, like a movie trailer narrator announcing a boss fight. English.', ref: 'The tower has no end. Climb, warrior — the castle is waiting for you.' },
  boss_warlord: { desc: 'Undead skeleton warlord. Hollow, rasping, bone-dry voice that booms from an empty ribcage, ancient and hateful. English.', ref: 'Flesh. Warm flesh. You will join my legion, little knight.' },
  boss_demon:   { desc: 'Archdemon of the abyss. Guttural, layered, growling voice, cruel and amused, every word dripping with malice. English.', ref: 'Your soul smells delicious. Come closer. Let me taste your fear.' },
  boss_dragon:  { desc: 'Ancient colossal dragon. Slow, thunderous, immense voice, each word like a mountain moving, contemptuous of mortals. English.', ref: 'A thousand years I have slept. And you… wake me for this?' },
};

const H = (voice, key, kind, text, act, opt = {}) => ({ name: key, voice, kind, text, act, ...opt });

// 영웅 공통 템플릿 — 스킬 이름은 영어로
const HERO = {
  knight:    { select: 'By my sword, I answer the call.', skills: ['Holy Slash!', 'Shield Bash!', 'Judgment!'], ult: 'Dragon Slash — Heaven\'s Rend!', win: 'The light prevails. Onward.', low: 'Not… yet. I can still stand.', death: 'Forgive me…', revive: 'I rise again!', perfect: 'Too slow!' },
  barbarian: { select: 'Point me at something to kill.', skills: ['Whirlwind!', 'Quake!', 'BERSERK!'], ult: 'HELL AXE! BURN!', win: 'Hah! Is that all?!', low: 'Blood… good. Now I\'m angry.', death: 'Not… like… this…', revive: 'I\'M NOT DONE!', perfect: 'Missed me!' },
  mage:      { select: 'The stars are aligned. Let us begin.', skills: ['Fireball!', 'Chain Lightning!', 'Blizzard!'], ult: 'Meteor Storm — fall!', win: 'As calculated.', low: 'My mana… hold on…', death: 'The stars… go dark…', revive: 'I am not finished!', perfect: 'Predictable.' },
  rogue:     { select: 'Quietly, now.', skills: ['Shadow Dash.', 'Poison Bomb.', 'Flurry!'], ult: 'A Thousand Blades!', win: 'Clean. Next.', low: 'Tch… careless.', death: 'So this is… the dark…', revive: 'Death can wait.', perfect: 'Nice try.' },
};
const GRUNT = {
  knight: ['Hah!', 'Tah!', 'Hyaah!', 'Sei!'], barbarian: ['RAAH!', 'HUH!', 'GRAAH!', 'HRRAH!'], mage: ['Ha!', 'Hup!', 'Go!', 'Now!'], rogue: ['Tch!', 'Hsss!', 'Ha!', 'Shh!'],
};
const FIN = { knight: ['HAAAAH!', 'Fall!'], barbarian: ['DIE!', 'CRUSH!'], mage: ['Burst!', 'Shatter!'], rogue: ['End.', 'Gone.'] };
const HURT = { knight: ['Ugh!', 'Guh!', 'Ngh!'], barbarian: ['Grr!', 'Hrgh!', 'Agh!'], mage: ['Ah!', 'Kya!', 'Ngh!'], rogue: ['Tsk!', 'Gh!', 'Ah!'] };

export const LINES = [];
for (const h of Object.keys(HERO)) {
  const T = HERO[h];
  LINES.push(H(h, `hero_${h}_select`, 'line', T.select, 'confident, ready for battle, spoken to the player who just chose them'));
  GRUNT[h].forEach((g, i) => LINES.push(H(h, `hero_${h}_atk${i}`, 'bark', g, 'a single, very short (half a second) explosive martial-arts attack grunt on a sword strike — pure exhale, no words, no trailing breath', { maxSec: 1.2 })));
  FIN[h].forEach((g, i) => LINES.push(H(h, `hero_${h}_fin${i}`, 'bark', g, 'a short, powerful finishing-blow shout at full force, under one second', { maxSec: 1.4 })));
  T.skills.forEach((g, i) => LINES.push(H(h, `hero_${h}_skill${i}`, 'bark', g, 'shouting the skill name as the attack is unleashed, fierce and punchy, under 1.5 seconds', { maxSec: 2.0 })));
  LINES.push(H(h, `hero_${h}_ult`, 'line', T.ult, 'roaring the ultimate attack name at full power, epic, the biggest moment of the fight', { maxSec: 3.5 }));
  HURT[h].forEach((g, i) => LINES.push(H(h, `hero_${h}_hurt${i}`, 'bark', g, 'a short pained grunt on taking a hit, half a second, no words', { maxSec: 1.2 })));
  LINES.push(H(h, `hero_${h}_low_hp`, 'line', T.low, 'wounded, breathing hard, through gritted teeth, but refusing to give up'));
  LINES.push(H(h, `hero_${h}_perfect`, 'bark', T.perfect, 'a quick cocky taunt right after dodging an attack perfectly', { maxSec: 2.0 }));
  LINES.push(H(h, `hero_${h}_win`, 'line', T.win, 'victorious, catching breath, satisfied'));
  LINES.push(H(h, `hero_${h}_death`, 'line', T.death, 'dying, weak, fading, last breath'));
  LINES.push(H(h, `hero_${h}_revive`, 'line', T.revive, 'bursting back to life with a defiant shout'));
}
// 보스
const BOSS = {
  warlord: { appear: 'Another skull for my throne. Come, little knight.', phase: 'You dare wound ME?!', enrage: 'ENOUGH! Legion — RISE!', death: 'Impossible… my legion… crumbles…' },
  demon:   { appear: 'Ahh… fresh souls. Come closer.', phase: 'Now you have my attention.', enrage: 'I WILL DEVOUR YOU WHOLE!', death: 'No… back to the abyss… NO!' },
  dragon:  { appear: 'You wake me… for THIS?', phase: 'Insect. Burn.', enrage: 'THE SKY ITSELF WILL FALL ON YOU!', death: 'A thousand years… ended… by you…' },
};
for (const b of Object.keys(BOSS)) {
  const T = BOSS[b];
  LINES.push(H(`boss_${b}`, `boss_${b}_appear`, 'line', T.appear, 'boss entrance, menacing, savoring the moment'));
  LINES.push(H(`boss_${b}`, `boss_${b}_phase`, 'line', T.phase, 'wounded and furious, second phase begins'));
  LINES.push(H(`boss_${b}`, `boss_${b}_enrage`, 'line', T.enrage, 'enraged, screaming at the top of his lungs'));
  LINES.push(H(`boss_${b}`, `boss_${b}_death`, 'line', T.death, 'dying, disbelieving, voice breaking apart'));
}
// 나레이터
const N = (key, text, act = 'epic announcer, dramatic') => LINES.push(H('narrator', key, 'line', text, act));
N('welcome', 'Welcome back, warrior. The Endless Castle awaits.', 'warm but epic greeting');
N('floor_start', 'The castle stirs. Purify every sector — then the boss is yours.', 'ominous, then a rising challenge');
N('floor_clear', 'Floor cleared! Magnificent!', 'triumphant, booming');
N('boss_found', 'The boss is near. Steady yourself.', 'low, ominous warning');
N('boss_kill', 'The boss has fallen! Glory is yours!', 'ecstatic, huge');
N('elite', 'An elite approaches!', 'sharp warning');
N('treasure', 'A treasure room! Take everything.', 'delighted, greedy grin');
N('reinforce', 'Reinforcements incoming! Hold the line!', 'alarmed, urgent');
N('legend_drop', 'LEGENDARY! A legendary item has dropped!', 'losing his mind with excitement');
N('unique_drop', 'A unique item! Fortune smiles on you.', 'impressed, excited');
N('low_hp', 'You are dying! Fall back — now!', 'panicked shout');
N('perfect', 'PERFECT dodge!', 'sharp, thrilled, quick');
N('defeat', 'You have fallen… but the castle remembers your name.', 'somber, grave');
N('rebirth', 'The phoenix rises! Not today, death!', 'awed, triumphant');
N('ult', 'ULTIMATE!', 'explosive single word');
N('enh_success', 'Enhancement… SUCCESS!', 'suspense, then explosion of joy');
N('enh_fail', 'Enhancement failed. The stone crumbles.', 'disappointed sigh');
N('enh_destroy', 'It… shattered. Your weapon is gone.', 'horrified, hollow');
N('set_blood', 'Blood Set awakened. Feed.', 'dark, hungry whisper');
N('set_gravity', 'Gravity Set awakened. Nothing escapes.', 'heavy, cosmic');
N('set_phoenix', 'Phoenix Set awakened. Burn and be reborn.', 'blazing, majestic');
N('set_storm', 'Storm Set awakened. Ride the lightning.', 'electric, fast');
N('boss_appear', 'A boss appears!', 'booming announcement');
N('boss_phase', 'The boss grows stronger!', 'warning');
N('boss_enrage', 'The boss is ENRAGED!', 'alarmed shout');
N('seal_break', 'All sectors purified. The seal shatters!', 'thunderous, momentous');
N('portal', 'A portal opens. Step through when ready.', 'calm guidance');
