// 영웅 문맥 무기 형태 표 생성기. 실행: bun tools/item-visual-forms.mjs [--check]
// 실제 장착 규칙(src/game/look.js LOOKS → src/engine/item-forge.js ITEM_WEAPON_FORMS,
// src/data/weapon-looks.js 의 병기고 전용 모델/장식 판정)을 그대로 읽어 src/data/item-presentation-forms.json 을 만든다.
// 화면 descriptor(src/ui/item-visual-forms.js)는 three·게임 모듈을 불러오지 않고 이 표만 읽는다.
// test/item-visual-forms.test.ts 가 같은 derive 결과와 표를 비교하므로 규칙이 바뀌면 표를 다시 만들어야 한다.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LOOKS } from '../src/game/look.js';
import { ITEM_WEAPON_FORMS } from '../src/engine/item-forge.js';
import { weaponLook } from '../src/data/weapon-looks.js';
import { HERO_ORDER, HEROES } from '../src/data/heroes.js';
import { ARMORY_ITEMS } from '../src/data/armory.js';

// 화면 이름표. 같은 형태가 두 손에 하나씩 보이면 -pair 형태다.
export const FORM_LABELS = Object.freeze({
  sword: '한손검', greatsword: '양손 대검', axe: '한손 도끼', 'axe-pair': '쌍도끼', greataxe: '양손 도끼',
  wand: '마법봉', staff: '대마법 지팡이', dagger: '단검', 'dagger-pair': '쌍단검', bow: '장궁',
});

const heldForm = (nodes) => {
  const forms = nodes.map((node) => ITEM_WEAPON_FORMS[node]).filter(Boolean);
  if (!forms.length) throw Error('무기 형태 없음: ' + nodes.join(','));
  if (new Set(forms).size !== 1) throw Error('한 등급에 서로 다른 무기 형태: ' + nodes.join(','));
  return { nodes: [...nodes], form: forms[0], count: forms.length };
};

export function deriveItemForms() {
  const armoryWeapon = ARMORY_ITEMS.find((item) => item.slot === 'weapon');
  const armoryRarities = [...new Set(ARMORY_ITEMS.filter((item) => item.slot === 'weapon').map((item) => item.rarity))];
  if (!armoryWeapon || armoryRarities.length !== 1) throw Error('병기고 무기 등급이 하나가 아님');
  const heroes = {};
  for (const heroId of HERO_ORDER) {
    const look = LOOKS[heroId];
    if (!look) continue;
    const weapon = {};
    for (const [rarity, nodes] of Object.entries(look.weapon)) weapon[rarity] = heldForm(nodes);
    // weaponLook 은 look.js 와 같은 조건으로 병기고 무기의 전용 메시 여부를 판정한다(nodes 가 비면 전용 모델).
    const armoryLook = weaponLook(heroId, { id: armoryWeapon.id, enh: 0 }, LOOKS);
    const armory = armoryLook?.nodes.length ? { mode: 'ornament', ...heldForm(armoryLook.nodes) } : { mode: 'own-mesh' };
    heroes[heroId] = { model: HEROES[heroId].model, weapon, armoryWeapon: armory };
  }
  return { generator: 'tools/item-visual-forms.mjs', canonicalWeaponForm: 'sword', armoryRarity: armoryRarities[0], formLabels: { ...FORM_LABELS }, heroes };
}

if (import.meta.main) {
  const path = fileURLToPath(new URL('../src/data/item-presentation-forms.json', import.meta.url));
  const next = JSON.stringify(deriveItemForms(), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    const current = await readFile(path, 'utf8').catch(() => '');
    if (current !== next) { console.error('item-presentation-forms.json 이 실제 LOOKS 와 다르다. bun tools/item-visual-forms.mjs 로 다시 만든다.'); process.exit(1); }
    console.log('item-presentation-forms.json 일치');
  } else {
    await writeFile(path, next);
    console.log('영웅 무기 형태 표 작성: ' + Object.keys(JSON.parse(next).heroes).length + '명');
  }
}
