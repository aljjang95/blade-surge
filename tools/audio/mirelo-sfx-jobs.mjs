// Mirelo SFX 1.5(Runware mirelo:1@1) 효과음 작업 목록. 출처·재현용 정본이다.
// node tools/audio/mirelo-sfx-jobs.mjs > jobs.json  → 생성기(tools/audio/mirelo-generate.mjs)가 읽는다.
const S = ', fantasy action game sound effect, close-miked, punchy and clean, dry, no music, no voice, no speech';
export const MIRELO_JOBS = [];
const add = (id, prompt, duration = 1.5) => MIRELO_JOBS.push({ id, prompt: prompt + S, duration });

// 영웅별 무기 세트: 휘두름 3, 마무리 1, 타격 2, 궁극기 충격 1
export const HERO_SETS = {
  knight: { swing: 'fast silver longsword swing whoosh with a bright metallic shimmer', fin: 'heavy two-handed overhead longsword chop with a ringing holy chime on impact', hit: 'longsword blade biting into plate armor with a bright metallic clang and faint holy sparkle', ult: 'colossal heavenly sword strike splitting the sky, deep boom with choir-like shimmering tail' },
  barbarian: { swing: 'heavy battle axe swing, deep low whoosh with weighty air displacement', fin: 'massive axe slam into the ground, crunching rock and deep thud', hit: 'brutal axe chop into flesh and bone, wet crunch with heavy low impact', ult: 'giant flaming axe crashing from the sky, huge explosion with roaring fire and rumbling earth' },
  mage: { swing: 'quick arcane staff flick launching a magic bolt, airy whoosh with sparkling energy', fin: 'charged arcane staff blast, rising magical hum then bright burst', hit: 'arcane magic bolt bursting on impact, crisp sparkling pop with glassy shimmer', ult: 'meteor shower falling from the sky, multiple fiery whistles and heavy explosions' },
  rogue: { swing: 'very fast twin dagger slashes, two short sharp swishes', fin: 'quick dagger cross-slash finisher, sharp double metallic schwing', hit: 'dagger stab piercing quickly, short sharp flesh stab with tiny metal tick', ult: 'thousands of blades raining down, rapid metallic hail of slicing shings ending in a heavy shadow burst' },
  ranger: { swing: 'longbow arrow release, taut string twang and arrow whoosh', fin: 'powerful charged bow shot, deep string thrum and fast arrow whizz', hit: 'arrow thunking into a target with a sharp wooden thwack', ult: 'seven arrows fired in a wide fan at once, layered string twangs and a storm wind gust' },
};
// 스킬마다 고유 시전음
export const SKILL_PROMPTS = {
  holy_slash: 'giant beam of holy light slash flying forward, bright shimmering swoosh with sustained radiant hum',
  shield_bash: 'heavy metal shield slamming the ground, deep metallic clang and stone thud shockwave',
  judgment: 'pillars of holy light crashing down from the sky one after another, bright booming impacts with angelic shimmer',
  dragon_slash: 'mighty sky-splitting sword slash, huge rising whoosh then thunderous radiant impact',
  chain_bind: 'chains of light lashing out and binding enemies, rattling magical chains then a bright snapping burst',
  sanctuary: 'holy sanctuary barrier forming, rising choir-like shimmer and protective glassy dome hum',
  sunbreaker: 'blazing solar shockwave surging forward and returning, roaring bright whoosh with fiery holy crackle',
  heavenfall: 'divine judgment descending, building vacuum suction then a massive radiant explosion from above',
  whirlwind: 'spinning axe whirlwind, repeated heavy whooshing spins with wind rush',
  quake: 'axe smashing the ground creating an earthquake shockwave, deep crunching rumble',
  berserk: 'berserker rage power-up, deep growling surge with fiery roar and heartbeat thump',
  hell_axe: 'burning giant axe falling from the sky and exploding, fiery roar and massive boom',
  bull_rush: 'charging rush pushing enemies, heavy thundering footsteps and crunching shoulder impact explosion',
  magma_zone: 'lava pillars erupting from the ground one after another, bubbling magma and fiery bursts',
  bloodquake: 'ground collapsing twice under a blood-red shockwave, deep double crumble with rumbling rock',
  cataclysm: 'leap then volcanic eruption slam, rising whoosh then enormous explosion of rock and fire',
  fireball: 'fireball launched and exploding, whooshing flame then fiery burst',
  chain: 'chain lightning arcing between enemies, sharp electric crackles jumping rapidly',
  blizzard: 'icy blizzard storm swirling, howling cold wind with crystalline ice shards',
  meteor: 'meteor storm, multiple falling fiery whistles and heavy impacts',
  arc_reflect: 'prism light spear ricocheting many times, bright laser pings bouncing with rising pitch',
  chrono_seal: 'time freeze spell, ticking clockwork slowing down with a deep reversed whoosh and frozen hum',
  star_prison: 'cosmic gravity prison collapsing to a point then exploding, deep sucking implosion then starry burst',
  absolute_zero: 'absolute zero freezing a wide area then shattering, deep cracking ice then massive glass shatter',
  shadow_dash: 'shadow dash through enemies, dark quick whoosh with multiple blade slices',
  poison_bomb: 'poison smoke bomb thrown and bursting, glass vial shatter with hissing toxic gas',
  flurry: 'rapid flurry of eight dagger stabs, very fast succession of sharp stab sounds',
  thousand: 'thousands of blades raining from the sky, rapid metallic hail of slicing sounds',
  shadow_mark: 'shadow marks placed and clones teleporting to slash, dark whispery pops and quick slices',
  void_step: 'void teleport blinks repeated many times, warped dark whooshes with reverse swells',
  night_parade: 'shadow clones slashing around and pulling enemies inward, swirling dark blade storm',
  eclipse_edge: 'chain of slashes ending in an eclipse explosion, quick slices then deep dark boom',
  ranger_pierce: 'piercing wind arrow shot, string twang and sharp whistling arrow tearing through',
  ranger_volley: 'three arrows fired in a fan, triple string twang and whooshes',
  ranger_retreat: 'archer leaping backward while shooting, quick footstep scuff, string twang and wind whoosh',
  ranger_tempest: 'seven storm arrows fired with howling wind, layered twangs and gust',
  ranger_quickshot: 'three rapid piercing arrow shots in quick succession, tight string twangs',
  ranger_binding: 'nature binding arrows, string twangs then creaking vines and rustling leaves wrapping',
  gale_hunt: 'gale hunting arrows fired rapidly through a crowd, rushing wind and arrow whizzes',
  skyfall_arrows: 'rain of meteor-like arrows falling over a wide area, whistling descent then rapid thudding impacts',
};
export const HERO_SKILLS = {
  knight: ['holy_slash', 'shield_bash', 'judgment', 'dragon_slash', 'chain_bind', 'sanctuary', 'sunbreaker', 'heavenfall'],
  barbarian: ['whirlwind', 'quake', 'berserk', 'hell_axe', 'bull_rush', 'magma_zone', 'bloodquake', 'cataclysm'],
  mage: ['fireball', 'chain', 'blizzard', 'meteor', 'arc_reflect', 'chrono_seal', 'star_prison', 'absolute_zero'],
  rogue: ['shadow_dash', 'poison_bomb', 'flurry', 'thousand', 'shadow_mark', 'void_step', 'night_parade', 'eclipse_edge'],
  ranger: ['ranger_pierce', 'ranger_volley', 'ranger_retreat', 'ranger_tempest', 'ranger_quickshot', 'ranger_binding', 'gale_hunt', 'skyfall_arrows'],
};
const ULTS = new Set(['dragon_slash', 'hell_axe', 'meteor', 'thousand', 'ranger_tempest']);
for (const [h, d] of Object.entries(HERO_SETS)) {
  for (let i = 0; i < 3; i++) add(`hero/${h}/swing_${i}`, d.swing, 0.9 + i * 0.1);
  add(`hero/${h}/finisher`, d.fin, 1.4);
  for (let i = 0; i < 2; i++) add(`hero/${h}/hit_${i}`, d.hit, 0.9);
  add(`hero/${h}/ult_impact`, d.ult, 3);
  for (const id of HERO_SKILLS[h]) add(`hero/${h}/skill_${id}`, SKILL_PROMPTS[id], ULTS.has(id) ? 3 : 2);
}
// 공용 타격·처치·콤보 — 파일 id 는 기존 hit-v2 와 같다(코드 매핑 유지)
const HIT = {
  t_slash: ['sharp blade slash contact transient, crisp metallic swish snap', 3], t_blunt: ['blunt club impact transient, short wooden thock', 2], t_magic: ['magic spell impact transient, short sparkling zap pop', 2], t_pierce: ['arrow pierce impact transient, sharp short thwip thunk', 1], t_heavy: ['heavy weapon impact transient, crunchy metallic crack', 2], t_counter: ['perfect parry counter hit, bright ringing metallic clash', 1], t_finisher: ['finishing blow impact transient, sharp crack with metallic ring', 2], t_boss: ['impact on a giant armored boss, heavy metallic gong-like crack', 1], t_crit: ['critical hit accent, bright high glassy ting with sparkle', 1],
  b_light: ['light body hit, soft short punch thud', 2], b_basic: ['body hit impact, medium punchy thud', 2], b_heavy: ['heavy body impact, deep punchy thump with low end', 2], b_magic: ['magical impact body, deep whomp with energy tail', 2], b_counter: ['counter hit body impact, solid deep thump with sharp edge', 1], b_finisher: ['finisher body impact, huge deep slam thump with short rumble', 2], b_boss: ['massive boss body impact, enormous deep thud with rumble tail', 1],
  k_pop: ['enemy defeated, satisfying soft pop with a quick dissolve sparkle', 3], k_elite: ['elite enemy defeated, heavier burst with bright shimmering dissolve', 1], k_boss: ['boss defeated, huge cinematic impact boom with long shimmering dissolve tail', 1],
};
for (const [id, [p, n]] of Object.entries(HIT)) for (let i = 0; i < n; i++) add(`hit/${id}_${i}`, p, id === 'k_boss' ? 3 : id.startsWith('b_') ? 0.8 : 0.6);
add('hit/c_10', 'combo milestone stinger, short rising bright whoosh with sparkle chime', 1.5);
add('hit/c_25', 'big combo milestone stinger, rising energetic whoosh into a bright impact chime', 2);
add('hit/c_50', 'huge combo milestone stinger, epic rising surge into a powerful radiant boom', 3);
// 예전 합성음 계열을 대체하는 효과 샘플
export const FX_FAMILIES = {
  whoosh: ['fast air whoosh swish', 3, 0.6], boom: ['big explosion boom with debris', 2, 1.5], zap: ['electric zap crackle', 2, 0.8], magic: ['magic spell sparkle cast, rising shimmer', 2, 1], fire: ['fire burst whoosh with crackling flames', 1, 1.2], ice: ['ice crystals forming and cracking, glassy chime', 1, 1], holy: ['holy light burst, bright angelic shimmer', 1, 1.2], dark: ['dark curse, deep descending ominous swell', 1, 1], suck: ['vacuum suction pulling inward, rising air swirl', 1, 0.8], buff: ['power up buff, rising positive shimmer', 1, 1], charge: ['energy charging up, rising hum', 1, 1], clang: ['metal clang ring', 2, 0.6], thump: ['deep low thump', 1, 0.5], ting: ['small bright metallic ting', 1, 0.5], shatter: ['equipment shattering, glass and metal breaking with low impact', 1, 1.5], levelup: ['level up fanfare chime, bright ascending sparkle', 1, 2], fail: ['enhancement failed, dull descending clunk', 1, 1], hurt: ['player getting hit, short painful body impact thud', 2, 0.6], dodge: ['quick dodge roll, cloth swish and foot scuff', 2, 0.6], dodge_perfect: ['perfect dodge, slow-motion whoosh with bright time-shimmer', 1, 1.2], tele_melee: ['enemy winding up a melee attack, short low rising whoosh warning', 1, 0.8], tele_magic: ['enemy charging a magic attack, ominous rising hum warning', 1, 1], tele_slam: ['giant enemy lifting for a slam, deep creaking rumble warning', 1, 1], rel_melee: ['monster claw swipe attack, heavy whoosh', 1, 0.6], rel_magic: ['monster magic projectile burst, dark zap release', 1, 0.8], rel_slam: ['monster ground slam, heavy boom with debris', 1, 1.2],
};
for (const [id, [p, n, d]] of Object.entries(FX_FAMILIES)) for (let i = 0; i < n; i++) add(`fx/${id}_${i}`, p, d);
// UI·보상 — 파일 이름은 기존과 같다
const UI = {
  ui_click: 'mobile game UI button tap, soft crisp click', ui_confirm: 'UI confirm, pleasant bright two-note chime', ui_select: 'UI select, light tick', ui_back: 'UI back, soft low tick', ui_error: 'UI error, short dull buzz', ui_open: 'UI panel open, soft paper whoosh', ui_close: 'UI panel close, soft reverse whoosh', ui_max: 'UI maxed out, sparkly ding', ui_drop: 'item drop into inventory, soft thunk', ui_bong: 'UI notification bong, warm soft bell', ui_glass: 'UI success, bright glassy chime', ui_pluck: 'UI pluck, short harp-like pluck',
  coin0: 'single gold coin pickup clink', coin1: 'gold coin pickup jingle', coin_stack: 'stack of gold coins pouring jingle', pack_open: 'treasure chest opening with magical sparkle', card_fan: 'cards fanning out swish', card_place: 'card placed on table snap',
  jingle_win0: 'victory jingle, short bright fanfare chime', jingle_win1: 'reward jingle, bright sparkling success chime', jingle_legend: 'legendary item reveal, epic shimmering rising fanfare boom',
  hit_bell: 'large bell strike ringing', hit_glass: 'glass hit clink', hit_metal0: 'metal hit clang', hit_metal1: 'metal hit clang variation', hit_metal2: 'metal hit short clank', hit_mining: 'pickaxe hitting stone', hit_plate: 'hit on metal plate armor', hit_punch0: 'punch impact', hit_punch1: 'punch impact variation', hit_punch2: 'short punch thud', hit_soft0: 'soft hit thud', hit_soft1: 'soft hit thump', hit_wood: 'hit on wood thock',
};
for (const [id, p] of Object.entries(UI)) add(`ui/${id}`, p, /^jingle|pack_open|hit_bell/.test(id) ? 2 : 0.7);

if (import.meta.main || process.argv[1]?.endsWith('mirelo-sfx-jobs.mjs')) console.log(JSON.stringify(MIRELO_JOBS));
