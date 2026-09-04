/**
 * 보이스 대본 — 영어 + 기합(비언어). 던파식 액션 VO.
 * 목소리 정체성은 VOICES(설명문 → Qwen VoiceDesign), 대사는 LINES(연기 지시 + 대사 → Seed Audio, @Audio1 클론).
 *   kind: 'bark' = 짧은 기합/외침(SFX 레이어, 겹쳐 재생, 1.2초 이내)  ·  'line' = 대사(나레이션 채널, 덕킹)
 *   text 는 ASR 로 대조한다. 기합은 길이로 대조한다.
 */
// 목소리 정체성 — 한국 애니/게임 더빙 성우 결. 초상화(img/hero_*.webp)에 맞춘다: 금발 소년 기사 · 짐승 같은 광전사 · 은발 쿨뷰티 마도사 · 후드 쓴 소년 암살자.
// (1차는 서양 판타지 트레일러 톤이라 "워크래프트 같다" 고 반려됐다 — 깊고 무거운 성인 남성 대신 젊고 맑고 에너지 높은 더빙 성우 톤으로)
export const VOICES = {
  knight:    { desc: 'Korean anime-dub style young male voice actor playing the blond shonen hero knight: bright, clear, youthful tenor around 18 years old, earnest and hot-blooded, energy bursting on every shout, never deep or gravelly. Speaks English.', ref: 'I won\'t lose! Not to you, not to anyone — this sword protects everyone!' },
  barbarian: { desc: 'Korean anime-dub style male voice actor playing a wild, bearded berserker: rough, hearty, big-brother "aniki" baritone, boisterous and laughing, more feral thug than fantasy king. Punchy anime delivery. Speaks English.', ref: 'Hahaha! Now THIS is a fight! Come on, hit me harder!' },
  mage:      { desc: 'Korean anime-dub style female voice actress playing an elegant silver-haired ice sorceress: cool, composed, slightly husky alto "noona" voice, refined and confident, sharp and commanding when she casts. Speaks English.', ref: 'How careless of you. Freeze — and don\'t move until I say so.' },
  rogue:     { desc: 'Korean anime-dub style young voice actor playing a small hooded assassin with glowing purple eyes: boyish, light, quick, slightly androgynous voice, cheeky and playful with a cold edge, whispers and sudden sharp bursts. Speaks English.', ref: 'Hehe… found you. Don\'t blink — you\'ll miss it.' },
  narrator:  { desc: 'Korean game-announcer style male voice: clear, energetic, charismatic mid-range, like a hype caster in a Korean action RPG — dramatic but bright, not a movie-trailer growl. Speaks English.', ref: 'Welcome, warrior! The Endless Castle awaits — let\'s climb!' },
  boss_warlord: { desc: 'Korean anime-dub style villain voice actor playing an undead skeleton warlord: theatrical, hollow, rasping, dramatic villain laugh, hammy and menacing. Speaks English.', ref: 'Kekeke… flesh! Warm flesh! You will join my legion, little knight!' },
  boss_demon:   { desc: 'Korean anime-dub style villain voice actor playing an archdemon: smooth, seductive, cruel and amused, sliding from purr to sudden roar, charismatic anime final boss. Speaks English.', ref: 'Ahh… your soul smells delicious. Come closer. Let me taste your fear.' },
  boss_dragon:  { desc: 'Korean anime-dub style elder voice actor playing an ancient dragon: slow, immense, contemptuous, gravel and echo, ancient god-beast looking down on insects. Speaks English.', ref: 'A thousand years I have slept… and you wake me for THIS?' },
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
  LINES.push(H(h, `hero_${h}_ult`, 'line', T.ult, 'roaring the ultimate attack name at full power, epic, the biggest moment of the fight, fast and punchy', { maxSec: 4.2 }));
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
