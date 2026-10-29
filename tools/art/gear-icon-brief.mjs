// 새 톤 장비 아이콘 생성 요청서(콜라주 묶음)를 만든다. 승인된 60종(R2 tripo-image/A·C)과 같은 톤.
// 사용: node tools/art/gear-icon-brief.mjs [--done <id,id,...>] > art-src/gear-icons/brief.json
// 묶음 하나 = 같은 부위·비슷한 등급 6종을 3열×2행 콜라주로 한 장. 나눠 자르기는 tools/art/icon-collage-split.py.
import { ITEM_BY_ID } from '../../src/data/items.js';

// 대표님 승인 60종(이 목록은 요청서에서 뺀다)
const APPROVED = new Set(('w_iron w_flame w_dragon a_leather a_knight a_titan r_copper r_ruby r_king b_worn b_wind b_sky '
  + 'w_rusty w_wood w_cleaver w_steel w_bronze w_hunter w_guard w_frost w_rune w_knight w_sun w_king '
  + 'a_cloth a_padded a_scrap a_chain a_scale a_ranger a_bronze a_mithril a_wyvern a_paladin a_sun a_king '
  + 'r_bone r_wood r_iron r_silver r_jade r_amber r_pearl r_sapphire r_emerald r_moon r_abyss r_sun '
  + 'b_cloth b_straw b_wooden b_swift b_ranger b_chain b_silk b_knight b_shadow b_mithril b_sun b_king').split(' '));

export const STYLE = 'Stylized hand-painted fantasy RPG game item icons, chunky low-poly forms with soft cel shading, '
  + 'warm key light from the upper left, thick dark navy outline (#0b1424) around every object, rich but not neon colors, '
  + 'each object centered in its own cell, three-quarter view, isolated on a flat pure white background (#ffffff), '
  + 'no ground shadow, no text, no labels, no frames, no cell borders, generous empty white space between objects.';

export const SLOT_VIEW = {
  weapon: 'Every weapon is drawn diagonally at 45 degrees, hilt at the lower left and tip at the upper right, blade at least 18% of the cell width.',
  armor: 'Every armor is a front-facing chest piece seen slightly from above, shoulders wider than the torso, visible neck opening and belt.',
  ring: 'Every ring is a thick band tilted toward the viewer with its gem or crest on top; the gem is the color hero of the icon.',
  boots: 'Every boots item is a matching pair standing side by side, angled three-quarter, shaft reaching at least half the cell height.',
};

export const RARITY_RULE = {
  N: 'common: muted plain materials (iron, leather, cloth, wood), single simple silhouette, no glow, no gems',
  S: 'uncommon: one decorative accent (a green #5ce07a gem or leaf motif), cleaner metal',
  E: 'rare: two decorative accents in blue #4cc3ff (gems, inlay), polished metal with a subtle edge glint',
  U: 'unique set item: the set theme drives the whole shape and color, with a small magical aura of the theme color',
  L: 'legendary: orange-gold #ff9a2e and gold trim with a big crowning element (halo, wings, crown or radiant spikes), soft golden glow',
};

// 세트 테마(U). 같은 세트 4부위가 한 가족으로 읽히게 같은 모티프·색을 반복한다.
const SET_THEME = {
  storm: 'Storm set: steel-blue metal with crackling cyan #7fd9ff lightning bolts, jagged thunder-cloud edges',
  blood: 'Vampire blood set: dark crimson #ff3a5a and black iron, fang and bat-wing motifs, dripping blood-gem',
  gravity: 'Gravity set: dark-matter black metal with violet #b26bff swirling singularity orb and orbiting rings',
  phoenix: 'Phoenix set: flame-orange #ffa040 and gold feathers, ember sparks, rising fire-bird shapes',
  frost: 'Frost crystal set: pale ice-blue #8fd8e8 translucent crystal shards, snowflake inlay, silver',
  plague: 'Plague spore set: sickly green #9ade5a mushroom caps, spore puffs, organic fungal growth on dark leather',
  rune: 'Rune set: dark stone and bronze engraved with glowing gold #ffc94a runes',
  tether: 'Abyss chain set: deep teal #50f0d0 abyssal metal wrapped with heavy chain links',
  arm_anchor: 'Harbor oath set: sea-teal #56c8bf and brass, ship anchor and rope motifs',
  arm_echo: 'Echo duel set: lavender #b3a0ef silver, tuning-fork and sound-ripple rings',
  arm_mercy: 'Lantern pilgrim set: warm cream-gold #f2c77f, lighthouse lantern and candle-flame motifs, pilgrim cloth',
  arm_lance: 'Hawk hunt set: leaf green #90c87b and white feathers, hawk wing and talon motifs',
  arm_relay: 'Weaver set: coral #eb9b8f woven threads, spindle and thread-spool motifs',
  arm_aegis: 'Bastion set: steel blue #94b6e6 heavy plate, castle battlement and tower-shield motifs',
  glasswarden: 'Glass warden set: clear glass-leaf panels with cyan #7fd9ff lightning veins, silver frame',
  emberknight: 'Ember knight set: blackened steel with glowing orange #ffa040 ember cores and cracks',
  starreader: 'Star reader set: midnight blue cloth and silver, star-dust sparkles, ice-blue #8fd8e8 constellation lines',
};

// 아이템별 형태 메모. 없으면 이름·look 으로 자동 서술.
const DESC = {
  w_storm: 'a broad longsword whose blade is a lightning bolt',
  w_blood: 'a curved dagger-sword shaped like a vampire fang',
  w_gravity: 'a huge greatsword with a black-hole orb in the guard',
  w_phoenix: 'a sword with a flaming feather blade and phoenix-head guard',
  w_rime: 'a slender sword of layered ice crystal',
  w_plague: 'a scythe with a mushroom-spored blade',
  w_sigil: 'a rune-carved greatsword',
  w_chain: 'a sword whose blade is wrapped in chain, chain trailing from the pommel',
  w_void: 'a shattered-glass blade floating in fragments, void purple #c07cff core (no set)',
  arm_anchor_weapon: 'a leaf-shaped sword with an anchor-shaped guard',
  arm_echo_weapon: 'a sword whose blade splits like a tuning fork',
  arm_mercy_weapon: 'a pilgrim staff topped with a lighthouse lantern',
  arm_lance_weapon: 'a spear with a feathered wing blade',
  arm_relay_weapon: 'a short dagger shaped like a weaving shuttle with thread',
  arm_aegis_weapon: 'a heavy gate greatsword shaped like a castle tower',
  sg_ember_lantern: 'a summoning lantern on a short rod with a little ember fox flame inside, orange #ff8030 (unique summon item)',
  sg_solar_grimoire: 'a golden sun grimoire book with a radiant sun clasp and a tiny golden hawk emblem (legendary summon item)',
  exp_glasswarden_weapon: 'a serrated glass sword with a crescent guard and tassel',
  exp_emberknight_weapon: 'a knight sword with glowing ember cracks along the blade',
  exp_starreader_weapon: 'a slim star-tipped sword with constellation engraving',
  a_storm: 'a thunder-cloud shoulder chest plate', a_blood: 'a bat-wing collared crimson breastplate',
  a_gravity: 'a black armor with a violet singularity core on the chest', a_phoenix: 'a feather-layered fire armor',
  a_rime: 'an ice-crystal plated armor', a_plague: 'a fungal leather husk armor with mushroom shoulders',
  a_sigil: 'a rune-engraved stone breastplate', a_bind: 'a chain-bound teal armor',
  a_void: 'a cracked void armor with floating purple #c07cff shards (no set)',
  arm_anchor_armor: 'a harbor breastplate with anchor emblem', arm_echo_armor: 'a lavender duelist armor with ripple rings',
  arm_mercy_armor: 'a pilgrim long coat with lantern buckle', arm_lance_armor: 'a feathered hawk breastplate',
  arm_relay_armor: 'a woven-thread armor', arm_aegis_armor: 'a heavy bastion plate armor with battlement shoulders',
  sg_moonward_aegis: 'a moonlit silver guardian armor with a crescent moon chest emblem, pale blue #8fd8e8 (unique summon item)',
  sg_abyss_husk: 'a living symbiotic abyss armor, violet #b26bff carapace with golden legendary trim and a halo of tendrils (legendary summon item)',
  exp_glasswarden_armor: 'a glass-paneled warden armor', exp_emberknight_armor: 'a blackened knight armor with ember cores',
  exp_starreader_armor: 'a midnight star-reader robe armor',
  r_storm: 'a ring with a lightning gem', r_blood: 'a blood-oath ring with a crimson drop gem',
  r_gravity: 'a ring holding a tiny black hole with an orbit ring', r_phoenix: 'an ember ring with a flame gem',
  r_rime: 'a snowflake crystal ring', r_plague: 'a plague signet with a spore cluster',
  r_sigil: 'a rune-loaded ring', r_chain: 'a ring made of abyss chain links',
  r_void: 'a void signet with a purple #c07cff shard gem (no set)',
  arm_anchor_ring: 'an anchor-loop ring', arm_echo_ring: 'a resonance ring with ripple halo',
  arm_mercy_ring: 'an ember-flame candle ring', arm_lance_ring: 'a hawk-eye signet ring',
  arm_relay_ring: 'a thread-spool ring', arm_aegis_ring: 'a castle-wall signet ring',
  sg_astral_prism: 'a ring holding a floating nebula prism crystal, blue #70b8ff (unique summon item)',
  sg_orbit_crown: 'a ring shaped like a tiny crown with small orbiting golden spheres (legendary summon item)',
  exp_glasswarden_ring: 'a glass-leaf ring', exp_emberknight_ring: 'an ember-core knight ring', exp_starreader_ring: 'a star-dust ring',
  b_storm: 'lightning-step boots', b_blood: 'blood-pool crimson boots', b_gravity: 'floating antigravity boots with violet rings',
  b_phoenix: 'phoenix-talon fire boots', b_rime: 'frozen crystal greaves', b_plague: 'mycelium fungal boots',
  b_sigil: 'rune-engraved boots', b_bind: 'chain-bound greaves', b_void: 'void boots with floating purple #c07cff shards (no set)',
  arm_anchor_boots: 'brass diving boots', arm_echo_boots: 'lavender echo greaves', arm_mercy_boots: 'pilgrim guide boots with lantern charm',
  arm_lance_boots: 'winged soaring greaves', arm_relay_boots: 'cross-laced woven boots', arm_aegis_boots: 'heavy bastion iron boots',
  sg_stormstep_treads: 'storm treads with little wind spirits swirling at the ankles, mint #7affe0 (unique summon item)',
  sg_comet_stride: 'comet marching boots trailing pink #ff9ad8 comet tails with golden wings (legendary summon item)',
  exp_glasswarden_boots: 'glass warden boots', exp_emberknight_boots: 'ember knight boots', exp_starreader_boots: 'star reader boots',
  gear_armor_n_1: 'a plain brown leather traveler tunic', gear_armor_n_2: 'a simple apprentice robe', gear_armor_n_3: 'a padded quilted outpost jacket',
  gear_armor_s_1: 'a steel sentry breastplate', gear_armor_s_2: 'a silver chain battle vest', gear_armor_s_3: 'a mountain scale armor',
  gear_armor_e_1: 'a light-crystal breastplate', gear_armor_e_2: 'a garrison plate armor', gear_armor_e_3: 'a shadow leather coat',
  gear_armor_l_1: 'a dawn ceremonial robe-armor', gear_armor_l_2: 'a dragon-bone quilted armor', gear_armor_l_3: 'a golden gate plate armor',
  a_town_oath: 'an oath guard armor with blue tabard', a_town_ember: 'an ember sailor armor with red-orange trim', a_town_star: 'a starlit snowfield armor, white and gold',
  gear_ring_n_1: 'a plain iron band', gear_ring_n_2: 'a twisted silver wire ring', gear_ring_n_3: 'a claw ring holding a dull stone',
  gear_ring_s_1: 'a double oath ring (two linked bands)', gear_ring_s_2: 'a garrison signet ring', gear_ring_s_3: 'a pine-light ring',
  gear_ring_e_1: 'a red ore ring', gear_ring_e_2: 'a blue knot ring', gear_ring_e_3: 'a starlight double ring',
  gear_ring_l_1: 'a gate jewel signet', gear_ring_l_2: 'a crown ring', gear_ring_l_3: 'a dragon-eye ring',
  gear_boots_n_1: 'simple traveler shoes', gear_boots_n_2: 'outpost boots', gear_boots_n_3: 'garrison greaves',
  gear_boots_s_1: 'sand-road sandals with ankle wraps', gear_boots_s_2: 'iron-plated battle boots', gear_boots_s_3: 'mountain fur boots',
  gear_boots_e_1: 'patrol boots', gear_boots_e_2: 'light-crystal greaves', gear_boots_e_3: 'wind sandals with feather wings',
  gear_boots_l_1: 'crown iron boots', gear_boots_l_2: 'dawn silk shoes', gear_boots_l_3: 'dragon-bone boots',
};

const PROFILE = { straight: 'straight double-edged blade', broad: 'broad wide blade', curved: 'curved saber blade', serrated: 'saw-toothed blade',
  leaf: 'leaf-shaped blade', flamberge: 'wavy flamberge blade', cleaver: 'heavy cleaver blade', needle: 'thin needle rapier blade' };
const GUARD = { cross: 'cross guard', none: 'no guard', disc: 'round disc guard', crescent: 'crescent guard', basket: 'basket hilt', wing: 'winged guard' };
const POMMEL = { ring: 'ring pommel', ball: 'round pommel', spike: 'spiked pommel', gem: 'gem pommel', tassel: 'tassel pommel' };
const CREST = { none: '', orb: 'an orb set in the guard', crescent: 'a crescent ornament', crystal: 'a crystal inset', cage: 'a caged core', star: 'a star ornament', flame: 'a flame ornament' };

function describe(item) {
  if (DESC[item.id]) return DESC[item.id];
  const w = item.look?.weapon;
  if (w) {
    const parts = [PROFILE[w.profile] || 'blade', GUARD[w.guard], POMMEL[w.pommel], CREST[w.crest]].filter(Boolean);
    return `a sword with a ${parts.join(', ')}, metal ${w.palette?.metal}, accent ${w.palette?.accent}, grip ${w.palette?.grip}`;
  }
  return item.id;
}

const ORDER = { N: 0, S: 1, E: 2, L: 3, U: 4 };
const SLOT_ORDER = ['weapon', 'armor', 'ring', 'boots'];

const CELL_POS = { 6: ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'], 4: ['top-left', 'top-right', 'bottom-left', 'bottom-right'] };
const SUMMON_U = ['sg_ember_lantern', 'sg_moonward_aegis', 'sg_astral_prism', 'sg_stormstep_treads'];
const SUMMON_L = ['sg_solar_grimoire', 'sg_abyss_husk', 'sg_orbit_crown', 'sg_comet_stride'];

function sheet(id, cells, family = null) {
  const n = cells.length <= 4 ? 4 : 6;
  const grid = n === 4 ? [2, 2] : [3, 2];
  const views = [...new Set(cells.map((it) => it.slot))].map((slot) => SLOT_VIEW[slot]).join(' ');
  const lines = cells.map((it, k) => {
    const theme = !family && it.set && SET_THEME[it.set] ? ` [${SET_THEME[it.set]}]` : '';
    return `${k + 1}. (${CELL_POS[n][k]}) ${it.slot}: ${describe(it)} — ${RARITY_RULE[it.rarity]}${theme}`;
  });
  const fam = family ? ` All ${cells.length} items belong to one matching set and must read as one family: ${family}.` : '';
  const prompt = `${STYLE} ${views} A ${grid[0]} by ${grid[1]} grid sheet of ${cells.length} different items, in this exact order:${fam}\n${lines.join('\n')}`;
  return { id, grid, cells: cells.map((it) => ({ id: it.id, slot: it.slot, name: it.name, rarity: it.rarity, set: it.set || null })), prompt };
}

export function buildBrief(done = new Set()) {
  const todo = Object.values(ITEM_BY_ID).filter((it) => !APPROVED.has(it.id) && !done.has(it.id));
  const bySlot = (a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot);
  const sheets = [];
  const taken = new Set();
  // ① 테마 세트: 한 세트 4부위를 2×2 한 장(가족으로 읽히게)
  const sets = [...new Set(todo.filter((it) => it.set && SET_THEME[it.set]).map((it) => it.set))];
  for (const set of sets) {
    const cells = todo.filter((it) => it.set === set).sort(bySlot);
    cells.forEach((it) => taken.add(it.id));
    sheets.push(sheet(`set-${set}`, cells, SET_THEME[set]));
  }
  // ② 세트 없는 U(공허)·소환 장비
  const voids = todo.filter((it) => /_void$/.test(it.id)).sort(bySlot);
  if (voids.length) { voids.forEach((it) => taken.add(it.id)); sheets.push(sheet('set-void', voids, 'Void relics: cracked obsidian-black material with floating purple #c07cff shards and a faint void glow')); }
  for (const [name, ids] of [['summon-u', SUMMON_U], ['summon-l', SUMMON_L]]) {
    const cells = ids.map((id) => ITEM_BY_ID[id]).filter((it) => it && !taken.has(it.id) && todo.includes(it));
    cells.forEach((it) => taken.add(it.id));
    if (cells.length) sheets.push(sheet(name, cells));
  }
  // ③ 나머지(N~L 도감·마을 장비): 부위별 6장씩, 등급 순
  for (const slot of SLOT_ORDER) {
    const list = todo.filter((it) => it.slot === slot && !taken.has(it.id))
      .sort((a, b) => ORDER[a.rarity] - ORDER[b.rarity] || a.id.localeCompare(b.id));
    for (let i = 0; i < list.length; i += 6) {
      const cells = list.slice(i, i + 6);
      cells.forEach((it) => taken.add(it.id));
      sheets.push(sheet(`${slot}-${String(i / 6 + 1).padStart(2, '0')}`, cells));
    }
  }
  const missed = todo.filter((it) => !taken.has(it.id)).map((it) => it.id);
  if (missed.length) throw new Error('요청서에서 빠진 장비: ' + missed.join(','));
  return { generatedFor: 'blade-surge gear icon tone (approved 2026-10-29 sheet_C)', style: STYLE, total: todo.length, sheetCount: sheets.length, sheets };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const k = process.argv.indexOf('--done');
  const done = new Set(k > 0 ? process.argv[k + 1].split(',') : []);
  process.stdout.write(JSON.stringify(buildBrief(done), null, 2) + '\n');
}
