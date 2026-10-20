// 자체 제작 장비의 외형 정본. 기존 저장 ID와 등급 세트를 그대로 이어받는다.
// 형상 축은 아이콘 크기에서도 실루엣으로 읽히는 값만 둔다. 같은 부위 안에서 형상 키가 겹치지 않는다.
const profiles = ['straight', 'broad', 'curved', 'serrated', 'leaf', 'flamberge', 'cleaver', 'needle'];
const guards = ['cross', 'disc', 'wing', 'basket', 'crescent', 'none'];
const pommels = ['ball', 'ring', 'spike', 'gem', 'tassel'];
const crests = ['orb', 'crystal', 'crescent', 'cage', 'flame', 'star', 'none'];
const cuts = ['leather', 'robe', 'padded', 'plate', 'chain', 'scale', 'crystal', 'brigandine'];
const shoulders = ['round', 'spiked', 'layered', 'wing', 'fur', 'none'];
const collars = ['high', 'fur', 'ring', 'hood', 'none'];
const bands = ['plain', 'twist', 'claw', 'double', 'signet', 'wave', 'bypass'];
const stones = ['round', 'square', 'marquise', 'cluster', 'none'];
const ringShoulders = ['none', 'gems', 'wings', 'beads'];
const shapes = ['shoe', 'boot', 'greave', 'sandal', 'sabaton', 'clog', 'slipper'];
const cuffs = ['fold', 'fur', 'plate', 'wing', 'none'];
const straps = ['none', 'buckles', 'laces', 'studs'];
const hashId = (id) => [...id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

/** 부위별 형상 축. 연속값(길이·반지름)과 팔레트는 고유성 판정에서 제외한다. */
export const SHAPE_AXES = Object.freeze({
  weapon: [['profile', profiles], ['guard', guards], ['pommel', pommels]],
  ring: [['band', bands], ['stone', stones], ['shoulder', ringShoulders]],
  boots: [['shape', shapes], ['cuff', cuffs], ['strap', straps]],
});
export const shapeKey = (slot, look) => SHAPE_AXES[slot].map(([key]) => look?.[key]).join('/');

const p3 = (metal, accent, grip) => ({ metal, accent, grip });
const PALETTES = {
  steel: p3('#aebbc8', '#cfd8e3', '#344457'),
  iron: p3('#909da9', '#bac6d0', '#453226'),
  rust: p3('#887260', '#a65d32', '#513722'),
  wood: p3('#a57945', '#d2a76c', '#624325'),
  bronze: p3('#ba8746', '#d99a52', '#493022'),
  forest: p3('#a7b7a7', '#9bdc6a', '#354730'),
  flame: p3('#bf3619', '#ff6a2a', '#35221d'),
  frost: p3('#a5d8ed', '#8fe3ff', '#315778'),
  rune: p3('#9eabc4', '#ffd35a', '#443653'),
  knight: p3('#c6d3df', '#7fb8ff', '#263f77'),
  dragon: p3('#402b2c', '#d6a344', '#5b201b'),
  sun: p3('#d6a646', '#ffd060', '#5e3621'),
  king: p3('#e3e0d8', '#fff0a8', '#493364'),
  void: p3('#443c58', '#a795d3', '#292237'),
  blood: p3('#704b51', '#e45b68', '#432b32'),
  leather: p3('#3a2a1c', '#c9a46a', '#8a5a34'),
  cloth: p3('#5a4a3c', '#7c6a52', '#b9ad94'),
  straw: p3('#a8823e', '#d9b85a', '#e0c46a'),
  bone: p3('#e8dcc0', '#c9b48a', '#bfae8a'),
  silver: p3('#e4e9ef', '#bcd7ff', '#3a4a5c'),
  star: p3('#c8d6f0', '#fff6b0', '#2a3a6a'),
  dusk: p3('#8a6a8a', '#ff9a6a', '#3a2440'),
  cleave: p3('#6d7680', '#c9d2da', '#2e2420'),
};
// 표 밖 장비의 팔레트는 이름의 원료에서 고른다. 해시는 형상 결정에만 사용한다.
function materialPalette(id, name = '') {
  const text = `${id} ${name}`;
  const matches = [
    ['rust', /rusty|scrap|녹슨|고철/], ['bone', /bone|뼈/], ['straw', /straw|짚/], ['cloth', /cloth|silk|padded|비단|누빔|로브/],
    ['leather', /leather|worn|가죽|털신|단화/], ['wood', /wood|목검|나막신/],
    ['bronze', /bronze|copper|amber|청동|구리|호박/], ['flame', /flame|phoenix|ember|화염|불사조|잿불/],
    ['frost', /frost|rime|mithril|sapphire|sky|moon|glass|서리|얼음|미스릴|푸른|빛결정/], ['rune', /rune|sigil|룬|각인/],
    ['forest', /hunter|ranger|jade|emerald|plague|wind|사냥|순찰|잎새|솔빛|바람/], ['dragon', /dragon|wyvern|용살자|용골|용비늘|용안/],
    ['sun', /sun|solar|태양|황금/], ['king', /king|pearl|왕의|왕관|성검/], ['star', /star|astral|comet|별/],
    ['void', /void|gravity|abyss|shadow|tether|chain|공허|심연|그늘/],
    ['blood', /blood|ruby|피의|붉은/], ['knight', /knight|paladin|guard|aegis|town_oath|기사|성문|수비대/], ['iron', /iron|anchor|철검|식칼/],
  ];
  return PALETTES[matches.find(([, pattern]) => pattern.test(text))?.[0] || 'steel'];
}

function design(id, slot, index = hashId(id), name = '') {
  const h = hashId(id), n = index;
  const palette = { ...materialPalette(id, name) };
  if (slot === 'weapon') return { weapon: {
    profile: profiles[n % 8], guard: guards[Math.floor(n / 2) % 6], pommel: pommels[Math.floor(n / 3) % 5], crest: crests[n % 7],
    length: .85 + (h % 401) / 1000, width: .8 + ((h >>> 10) % 501) / 1000, palette, gem: palette.accent,
  } };
  if (slot === 'armor') return { armor: {
    cut: cuts[n % 8], pauldron: shoulders[Math.floor(n / 2) % 6], collar: collars[Math.floor(n / 3) % 5],
    cape: ['none', 'short', 'long', 'tattered'][Math.floor(n / 4) % 4], belt: ['plain', 'plates', 'sash', 'chain'][n % 4],
    emblem: ['sphere', 'star', 'diamond', 'crest', 'skull', 'none'][n % 6], palette: { body: palette.grip, trim: palette.metal, accent: palette.accent },
  } };
  if (slot === 'ring') return { ring: { band: bands[n % 7], stone: stones[Math.floor(n / 7) % 5], shoulder: ringShoulders[Math.floor(n / 35) % 4], radius: .27, palette } };
  return { boots: { shape: shapes[n % 7], cuff: cuffs[Math.floor(n / 7) % 5], strap: straps[Math.floor(n / 35) % 4], length: .95 + (h % 101) / 1000, palette } };
}

// 무기: [팔레트, 날, 가드, 폼멜, 문장, 표면]. 기존 저장 ID의 이름·원료·속성을 명시한다.
const WEAPON_TABLE = {
  w_iron: ['iron', 'straight', 'cross', 'ball', 'none'], w_rusty: ['rust', 'straight', 'disc', 'ring', 'none', 'rust'],
  w_wood: ['wood', 'straight', 'none', 'tassel', 'none', 'wood'], w_cleaver: ['iron', 'cleaver', 'none', 'ring', 'none'],
  w_steel: ['steel', 'broad', 'cross', 'spike', 'none'], w_bronze: ['bronze', 'curved', 'wing', 'ring', 'star'],
  w_hunter: ['forest', 'leaf', 'crescent', 'tassel', 'crescent'], w_guard: ['knight', 'straight', 'basket', 'ball', 'orb'],
  w_flame: ['flame', 'flamberge', 'crescent', 'spike', 'flame', 'lava'], w_frost: ['frost', 'leaf', 'wing', 'gem', 'crystal', 'ice'],
  w_rune: ['rune', 'straight', 'cross', 'gem', 'star', 'rune'], w_knight: ['knight', 'straight', 'wing', 'ball', 'crescent'],
  w_storm: ['knight', 'serrated', 'wing', 'spike', 'star'], w_blood: ['blood', 'needle', 'basket', 'spike', 'crescent'],
  w_gravity: ['void', 'broad', 'disc', 'gem', 'orb'], w_phoenix: ['flame', 'curved', 'crescent', 'tassel', 'flame', 'lava'],
  w_rime: ['frost', 'serrated', 'cross', 'gem', 'crystal', 'ice'], w_plague: ['forest', 'curved', 'none', 'spike', 'cage'],
  w_sigil: ['rune', 'broad', 'wing', 'gem', 'star', 'rune'], w_chain: ['void', 'serrated', 'disc', 'ring', 'cage'],
  w_void: ['void', 'cleaver', 'disc', 'gem', 'crescent'], w_dragon: ['dragon', 'broad', 'crescent', 'spike', 'flame'],
  w_sun: ['sun', 'flamberge', 'wing', 'gem', 'star'], w_king: ['king', 'straight', 'crescent', 'gem', 'crystal'],
};
// 반지: [띠, 보석, 어깨 장식, 팔레트(띠, 보석, 보조 띠), 표면]
const RING_TABLE = {
  r_copper: ['plain', 'none', 'none', p3('#b8693a', '#5fb3a0', '#8a4a2a')],
  r_bone: ['claw', 'round', 'none', p3('#e8dcc0', '#c9b48a', '#cfc2a2'), 'bone'],
  r_wood: ['twist', 'none', 'none', p3('#8a5a32', '#c58f52', '#5e3a1e'), 'wood'],
  r_iron: ['signet', 'none', 'none', p3('#5d646c', '#8a939c', '#3e4349')],
  r_silver: ['plain', 'round', 'none', p3('#e4e9ef', '#bcd7ff', '#a9b2bc')],
  r_jade: ['double', 'none', 'none', p3('#5fae7c', '#a8e6c0', '#3f8a5c')],
  r_amber: ['claw', 'square', 'none', p3('#c9a35a', '#ff9d2e', '#8a6a30')],
  r_pearl: ['double', 'round', 'none', p3('#d9dde2', '#fff6ea', '#b8bec6')],
  r_ruby: ['plain', 'square', 'none', p3('#d2a64a', '#e0233c', '#9a7428')],
  r_sapphire: ['twist', 'square', 'none', p3('#c9d2dc', '#2f6fe0', '#9aa6b4')],
  r_emerald: ['plain', 'marquise', 'none', p3('#d6b25a', '#21b56b', '#a07e30')],
  r_moon: ['twist', 'round', 'none', p3('#b9c7da', '#dfe9ff', '#7d8fb0')],
  r_storm: ['wave', 'square', 'none', p3('#5f7fb8', '#9fd0ff', '#34507e')],
  r_blood: ['bypass', 'round', 'none', p3('#5a2a33', '#ff3a5a', '#3a1a20')],
  r_gravity: ['bypass', 'square', 'none', p3('#3a3150', '#b26bff', '#221c30')],
  r_phoenix: ['wave', 'marquise', 'none', p3('#c25a28', '#ffb347', '#7a3010')],
  r_rime: ['wave', 'cluster', 'none', p3('#a8d8ea', '#e8fbff', '#6aa8c0')],
  r_plague: ['wave', 'none', 'none', p3('#5d7040', '#a4d860', '#3d4a2a')],
  r_sigil: ['signet', 'marquise', 'gems', p3('#3e4a80', '#ffd35a', '#262e56')],
  r_chain: ['bypass', 'none', 'none', p3('#2c4f4a', '#50f0d0', '#1a302c')],
  r_void: ['double', 'cluster', 'none', p3('#2d2640', '#8a6cff', '#1c1828')],
  r_abyss: ['twist', 'marquise', 'none', p3('#14202e', '#2fd3c0', '#0a1018')],
  r_sun: ['signet', 'round', 'beads', p3('#e0aa3e', '#fff1a0', '#a87820')],
  r_king: ['claw', 'cluster', 'wings', p3('#ece6d6', '#7fd8ff', '#c8c0a8')],
};
// 신발: [모양, 목 장식, 끈 장식, 팔레트(밑창·판금, 장식, 몸통), 표면]
const BOOT_TABLE = {
  b_cloth: ['shoe', 'fold', 'none', p3('#5a4a3c', '#7c6a52', '#b9ad94'), 'cloth'],
  b_straw: ['sandal', 'none', 'none', p3('#a8823e', '#d9b85a', '#e0c46a'), 'straw'],
  b_worn: ['boot', 'none', 'buckles', p3('#3e3a36', '#5a524a', '#7d7268'), 'leather'],
  b_wooden: ['clog', 'none', 'none', p3('#6b4423', '#3d2a18', '#a8743f'), 'wood'],
  b_swift: ['boot', 'wing', 'none', p3('#2f3b4a', '#e9eef5', '#4f8fd6'), 'leather'],
  b_ranger: ['boot', 'fold', 'laces', p3('#3b2f22', '#a88a5a', '#55704a'), 'leather'],
  b_chain: ['greave', 'none', 'studs', p3('#8a949e', '#b9c2cc', '#4a5058')],
  b_silk: ['slipper', 'none', 'none', p3('#5a3b55', '#f3e3c2', '#d98fb8'), 'cloth'],
  b_wind: ['sandal', 'wing', 'none', p3('#c9d8e0', '#ffffff', '#7fd0c6')],
  b_knight: ['sabaton', 'plate', 'none', p3('#c6d3df', '#d9b85a', '#2d4677')],
  b_shadow: ['slipper', 'fold', 'none', p3('#1e1a24', '#8a7ab8', '#3a3346'), 'cloth'],
  b_mithril: ['greave', 'plate', 'none', p3('#cfe6f2', '#e8fbff', '#8fb8cf')],
  b_storm: ['sandal', 'plate', 'none', p3('#4a6aa0', '#9fd0ff', '#25385c')],
  b_blood: ['slipper', 'plate', 'none', p3('#4a1e26', '#ff4a5e', '#7a2a36')],
  b_gravity: ['sandal', 'fur', 'none', p3('#2c2540', '#b26bff', '#4a3a6a')],
  b_phoenix: ['sabaton', 'wing', 'studs', p3('#8a2e14', '#ffc04a', '#d0581f')],
  b_rime: ['greave', 'wing', 'buckles', p3('#b8e2f0', '#effbff', '#5f9fbf')],
  b_plague: ['boot', 'none', 'none', p3('#3d4a2a', '#c8e070', '#6a8040'), 'leather'],
  b_sigil: ['sabaton', 'plate', 'buckles', p3('#2e3a66', '#ffd35a', '#4c5a96')],
  b_bind: ['greave', 'plate', 'laces', p3('#1f3f3a', '#50f0d0', '#2f6a60')],
  b_void: ['sabaton', 'wing', 'none', p3('#1a1626', '#7a5cff', '#2e2640')],
  b_sky: ['greave', 'wing', 'none', p3('#e8f2ff', '#ffffff', '#8fc4f0')],
  b_sun: ['sabaton', 'fold', 'none', p3('#c8902e', '#fff2a0', '#e8b84a')],
  b_king: ['boot', 'fur', 'none', p3('#e8e2d2', '#f4efe6', '#5a2a6a'), 'leather'],
};

export const LEGACY_LOOKS = {};
for (const [id, [palette, profile, guard, pommel, crest, surface = 'metal']] of Object.entries(WEAPON_TABLE)) {
  const base = design(id, 'weapon', 0).weapon;
  LEGACY_LOOKS[id] = { weapon: { ...base, profile, guard, pommel, crest, surface, palette: { ...PALETTES[palette] }, gem: PALETTES[palette].accent } };
}
LEGACY_LOOKS.w_guard.weapon.palette.accent = '#9fb4cc';
for (const [id, [band, stone, shoulder, palette, surface = 'metal']] of Object.entries(RING_TABLE)) {
  LEGACY_LOOKS[id] = { ring: { band, stone, shoulder, radius: .27, palette, surface } };
}
for (const [id, [shape, cuff, strap, palette, surface = 'metal']] of Object.entries(BOOT_TABLE)) {
  LEGACY_LOOKS[id] = { boots: { shape, cuff, strap, length: 1, palette, surface } };
}

/** 표 밖 장비도 해시로 재현하며, 소비자가 새 난수를 사용하지 않는다. */
export function gearLook(item) {
  if (item?.look) return item.look;
  // 기존 방어구는 armor-appearance.js가 유일한 정본이다. 여기서 중복 외형을 만들지 않는다.
  if (item?.slot === 'armor') return {};
  return LEGACY_LOOKS[item?.id] || design(item?.id || 'unarmed', item?.slot || 'weapon', hashId(item?.id || 'unarmed'), item?.name);
}

/**
 * 등록된 전체 장비에 형상 키가 겹치지 않는 외형을 배정한다.
 * 명시 표가 있으면 그대로 쓰고, 표 밖 장비(병기고·소환·원정·마을)는 ID 해시에서 시작해 빈 조합으로 넘긴다.
 * ID 정렬 순서로 처리해 실행 순서와 무관하게 같은 결과를 낸다.
 */
export function assignGearLooks(itemsById) {
  for (const [slot, axes] of Object.entries(SHAPE_AXES)) {
    const entries = Object.values(itemsById).filter(item => item.slot === slot).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const used = new Map(), pending = [];
    for (const item of entries) {
      const look = item.look?.[slot] || LEGACY_LOOKS[item.id]?.[slot];
      if (!look) { pending.push(item); continue; }
      const key = shapeKey(slot, look);
      if (used.has(key)) throw Error(`장비 형상 중복: ${used.get(key)} · ${item.id} (${key})`);
      used.set(key, item.id);
    }
    const space = axes.reduce((count, [, values]) => count * values.length, 1);
    if (used.size + pending.length > space) throw Error(`${slot} 형상 조합 부족: ${used.size + pending.length}/${space}`);
    for (const item of pending) {
      const look = design(item.id, slot, hashId(item.id), item.name)[slot];
      for (let n = hashId(item.id) % space; ; n = (n + 1) % space) {
        let rest = n;
        for (const [key, values] of axes) { look[key] = values[rest % values.length]; rest = Math.floor(rest / values.length); }
        const key = shapeKey(slot, look);
        if (!used.has(key)) { used.set(key, item.id); break; }
      }
      item.look = { [slot]: look };
    }
  }
  return itemsById;
}

const titles = {
  weapon: ['초소의 직검', '산길의 넓은날', '나그네 곡검', '톱날 전투검', '잎새 수호검', '물결 장검', '파쇄 도살검', '은빛 세검', '성문 수호검', '별의 대검', '용비늘 검', '황혼 성검'],
  armor: ['여행자 가죽옷', '견습생 로브', '초소 누빔옷', '강철 초병갑', '은사슬 전투복', '산악 비늘갑', '빛결정 흉갑', '수비대 조각갑', '그늘 가죽옷', '새벽 예복', '용골 누빔갑', '황금 성문갑'],
  ring: ['초소 고리', '꼬인 은선', '발톱 고리', '이중 서약', '수비대 인장', '솔빛 반지', '붉은 광석환', '푸른 매듭환', '별빛 이중환', '성문 보석인', '왕관 고리', '용안 반지'],
  boots: ['여행자 단화', '초소 장화', '수비대 각반', '모래길 샌들', '철판 전투화', '산길 털신', '순찰 장화', '빛결정 각반', '바람 샌들', '왕관 철화', '새벽 비단화', '용골 장화'],
};
// 신규 무기: [팔레트, 날, 가드, 폼멜, 문장, 속성명]
const NEW_WEAPONS = [
  ['steel', 'straight', 'cross', 'ring', 'none', '강철'], ['iron', 'broad', 'none', 'ball', 'none', '무쇠'],
  ['bronze', 'curved', 'cross', 'ball', 'orb', '청동'], ['steel', 'serrated', 'none', 'ball', 'none', '톱날 강철'],
  ['forest', 'leaf', 'cross', 'ring', 'crescent', '숲'], ['frost', 'flamberge', 'disc', 'ball', 'crystal', '물결'],
  ['cleave', 'cleaver', 'cross', 'spike', 'cage', '파쇄'], ['silver', 'needle', 'crescent', 'gem', 'star', '은광'],
  ['knight', 'straight', 'basket', 'gem', 'orb', '수비대 청광'], ['star', 'broad', 'wing', 'spike', 'star', '별빛'],
  ['dragon', 'serrated', 'crescent', 'spike', 'flame', '용염'], ['dusk', 'flamberge', 'basket', 'tassel', 'crescent', '황혼'],
];
const NEW_RINGS = [
  ['double', 'square', 'none', p3('#7c858e', '#a3acb5', '#545b63')], ['twist', 'cluster', 'none', p3('#d8dee6', '#9fb7d6', '#9aa4ae')],
  ['claw', 'marquise', 'none', p3('#a8763a', '#d9c27a', '#6e4a20')], ['double', 'marquise', 'none', p3('#d4b062', '#9fe0ff', '#dfe5ec')],
  ['signet', 'marquise', 'none', p3('#9fb0c4', '#2e4f86', '#6a7a90')], ['plain', 'cluster', 'none', p3('#c7b27a', '#3f9b5a', '#8a7a4a')],
  ['signet', 'cluster', 'none', p3('#4a3a36', '#ff4a2a', '#2e2420')], ['wave', 'round', 'none', p3('#7fa7d9', '#1f5fd0', '#4a70a8')],
  ['bypass', 'cluster', 'none', p3('#c8d6f0', '#fff6b0', '#8a9ec8')], ['signet', 'square', 'gems', p3('#e6c35a', '#5fd0ff', '#a88a30')],
  ['claw', 'none', 'none', p3('#f0d070', '#ff4f7a', '#b89040')], ['bypass', 'marquise', 'none', p3('#3a1e1e', '#ffb020', '#200e0e')],
];
const NEW_BOOTS = [
  ['shoe', 'none', 'laces', p3('#3a2a1c', '#c9a46a', '#8a5a34'), 'leather'], ['boot', 'plate', 'buckles', p3('#7a7f86', '#b09070', '#5a4636'), 'leather'],
  ['greave', 'fold', 'none', p3('#9aa6b2', '#c0ccd8', '#3a4a66')], ['sandal', 'fold', 'none', p3('#7a5a3a', '#e8cf98', '#c9a878'), 'leather'],
  ['sabaton', 'none', 'studs', p3('#7c858e', '#a3acb5', '#3e4349')], ['shoe', 'fur', 'none', p3('#3a2a1e', '#ece2d0', '#6a4a32'), 'leather'],
  ['greave', 'fur', 'none', p3('#2e3a26', '#c8b48a', '#4f6a3a')], ['shoe', 'wing', 'none', p3('#bfe8f5', '#e8fdff', '#6aa8c8')],
  ['slipper', 'wing', 'none', p3('#e0eef0', '#ffffff', '#5fc0b0'), 'cloth'], ['shoe', 'plate', 'none', p3('#c0c8d0', '#f0c860', '#40465a')],
  ['slipper', 'fur', 'none', p3('#f0d0a0', '#fff0d8', '#f08a7a'), 'cloth'], ['sabaton', 'fur', 'none', p3('#e6dcc2', '#d6a344', '#5a1e1e')],
];
function newLook(slot, index, id, name) {
  if (slot === 'weapon') {
    const [palette, profile, guard, pommel, crest, element] = NEW_WEAPONS[index];
    const base = design(id, slot, index + 24, name).weapon;
    return { weapon: { ...base, profile, guard, pommel, crest, element, palette: { ...PALETTES[palette] }, gem: PALETTES[palette].accent } };
  }
  if (slot === 'ring') {
    const [band, stone, shoulder, palette, surface = 'metal'] = NEW_RINGS[index];
    return { ring: { band, stone, shoulder, radius: .27, palette, surface } };
  }
  if (slot === 'boots') {
    const [shape, cuff, strap, palette, surface = 'metal'] = NEW_BOOTS[index];
    return { boots: { shape, cuff, strap, length: .95 + (index % 3) * .05, palette, surface } };
  }
  return design(id, slot, index + 24, name);
}
// 수치 기준은 items.js의 SLOT_BASE·RARITY_INFO와 동일하며 등록 테스트로 대조한다.
const bases = { weapon: { atk: 20 }, armor: { hp: 130, def: 3 }, ring: { atk: 9 }, boots: { hp: 65, atk: 4 } };
const rarities = ['N', 'S', 'E', 'L'], multipliers = [1, 1.6, 2.6, 5.5], sets = ['recruit', 'merc', 'knight', 'dragon'];
export const GEAR_ITEMS = Object.entries(titles).flatMap(([slot, names]) => names.map((name, index) => {
  const tier = Math.floor(index / 3), id = `gear_${slot}_${rarities[tier].toLowerCase()}_${index % 3 + 1}`;
  return { id, name, slot, rarity: rarities[tier], set: sets[tier], icon: `/img/gear/${id}.webp`,
    ...Object.fromEntries(Object.entries(bases[slot]).map(([stat, value]) => [stat, Math.round(value * multipliers[tier])])),
    crit: (index % 3) * .01, look: newLook(slot, index, id, name),
  };
}));

