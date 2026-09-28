// 소환 구성품·무기 외형 미리보기 화면. Meta가 this로 호출한다 (showGachaContents.call(meta, ...)).
import { HEROES, HERO_ORDER } from '../data/heroes.js';
import { ITEM_BY_ID, ITEM_ICON, RARITY_INFO, RARITY_COLOR } from '../data/items.js';
import { GACHA } from '../data/shop.js';
import { REWARD_LABEL, gachaContents } from '../game/economy.js';
import { weaponLook, weaponLookText, ENHANCE_STEPS } from '../data/weapon-looks.js';
import { LOOKS } from '../game/look.js';
import { resourceArt } from './illustrated.js';

const pct = (p, d = 2) => (p * 100).toFixed(d) + '%';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MATERIAL_NOTE = { stones: '+3~+9 강화용', stones2: '+10~+14 강화용', protect: '+12 이상 파괴 방지', bless: '강화 성공률 +20%' };
const TABS = [['weapon', '무기'], ['armor', '방어구'], ['ring', '반지'], ['boots', '신발'], ['hero', '영웅'], ['material', '강화 재료']];

function labelOf(x) { return x.kind === 'hero' ? HEROES[x.id].name : x.kind === 'material' ? (REWARD_LABEL[x.id]?.[0] || x.id) + ' ×' + x.n : ITEM_BY_ID[x.id].name; }
function iconOf(x) { return x.kind === 'hero' ? HEROES[x.id].portrait : x.kind === 'material' ? resourceArt(x.id) : ITEM_ICON(ITEM_BY_ID[x.id]); }
function noteOf(x, heroId) {
  if (x.kind === 'hero') return x.id === GACHA.featured ? '픽업 영웅' : '영웅';
  if (x.kind === 'material') return MATERIAL_NOTE[x.id] || '';
  const it = ITEM_BY_ID[x.id];
  if (x.slot === 'weapon') return weaponLookText(weaponLook(heroId, { id: x.id, enh: 0 }, LOOKS));
  return RARITY_INFO[it.rarity].name + (it.summon ? ' · ' + it.summon.name + ' 소환' : '');
}

/** 소환 구성품 전체: 등급별 영웅·장비·강화 재료와 개별 확률. 무기는 누르면 외형 미리보기로 간다. */
export function showGachaContents(filter = 'weapon') {
  const list = gachaContents(), heroId = this.eco.s.selected;
  const shown = list.filter((x) => (filter === 'hero' || filter === 'material') ? x.kind === filter : x.kind === 'gear' && x.slot === filter);
  const rows = ['SSR', 'SR', 'R'].map((g) => {
    const items = shown.filter((x) => x.grade === g); if (!items.length) return '';
    return '<h3 class="gc-grade gc-' + g + '">' + g + ' · ' + pct(items.reduce((a, x) => a + x.p, 0)) + '</h3><div class="gc-grid">' + items.map((x) => {
      const preview = x.kind === 'gear' && x.slot === 'weapon';
      // 무기만 미리보기 버튼이다. 나머지는 정보 카드(div)로 두어 화면 낭독기가 '사용할 수 없음'으로 읽지 않게 한다.
      const tag = preview ? 'button' : 'div', p = pct(x.p, x.p < 0.001 ? 3 : 2);
      return '<' + tag + (preview ? ' type="button" data-preview="' + x.id + '" aria-label="' + esc(labelOf(x)) + ' ' + p + ', 외형 미리보기"' : '') + ' class="gc-item' + (x.rarity ? ' rar-' + x.rarity : '') + '">'
        + '<img src="' + iconOf(x) + '" alt="" onerror="this.remove()"><span class="gc-name">' + esc(labelOf(x)) + '</span><span class="gc-note">' + esc(noteOf(x, heroId)) + '</span><b class="gc-p">' + p + '</b></' + tag + '>';
    }).join('') + '</div>';
  }).join('');
  const help = '1회 소환 기준 개별 확률 · 61번째 상승과 10회 SR 보장 보정 제외' + (filter === 'weapon' ? ' · 무기를 누르면 착용 모습을 볼 수 있어요' : '');
  this.ui.modal('<div class="gc-wrap"><h2>소환 구성품</h2><p class="setting-help">' + help + '</p><div class="gc-tabs" role="group" aria-label="구성품 종류">'
    + TABS.map(([id, n]) => '<button type="button" aria-pressed="' + (id === filter) + '" class="' + (id === filter ? 'on' : '') + '" data-gc="' + id + '">' + n + '</button>').join('')
    + '</div>' + rows + '<div class="modal-btns"><button class="btn btn-ghost" id="m-back">확률표</button><button class="btn btn-ghost" id="m-cancel">닫기</button></div></div>', { onOpen: (b) => {
    b.querySelector('#m-cancel').onclick = () => this.ui.closeModal();
    b.querySelector('#m-back').onclick = () => this.showRates();
    b.querySelectorAll('[data-gc]').forEach((el) => el.onclick = () => showGachaContents.call(this, el.dataset.gc));
    b.querySelectorAll('[data-preview]').forEach((el) => el.onclick = () => showWeaponPreview.call(this, el.dataset.preview));
  } });
}

/** 무기 외형 미리보기: 영웅마다 무기 모양·속성 발광·강화 오라가 어떻게 바뀌는지 실제 3D 모델로 보여준다. */
export function showWeaponPreview(itemId, heroId = this.eco.s.selected, enh = 0) {
  const it = ITEM_BY_ID[itemId]; if (!it || it.slot !== 'weapon') return;
  const look = weaponLook(heroId, { id: itemId, enh }, LOOKS);
  const heroes = HERO_ORDER.filter((id) => this.app.models?.[HEROES[id].model]);
  const p = gachaContents().find((x) => x.id === itemId)?.p || 0;
  const close = () => this.app.wardrobe?.previewStop?.();
  this.ui.modal('<div class="wp-wrap"><h2 style="color:' + RARITY_COLOR[it.rarity] + '">' + esc(it.name) + '</h2><p class="setting-help">' + RARITY_INFO[it.rarity].name + ' 무기 · 소환 확률 ' + pct(p, 3) + '</p>'
    + '<div class="wp-body"><div class="wp-stage" id="wp-stage" role="img" aria-label="' + esc(HEROES[heroId].name + '이(가) ' + it.name + ' +' + enh + '을(를) 든 모습: ' + weaponLookText(look)) + '"></div>'
    + '<div class="wp-side"><div class="wp-look"><i style="background:' + look.color + '"></i><b>' + esc(HEROES[heroId].name) + '</b><span>' + esc(weaponLookText(look)) + '</span></div>'
    + '<div class="wp-label">영웅</div><div class="wp-seg">' + heroes.map((id) => '<button type="button" data-hero="' + id + '" class="' + (id === heroId ? 'on' : '') + '" aria-pressed="' + (id === heroId) + '">' + esc(HEROES[id].name.split(' ').pop()) + '</button>').join('') + '</div>'
    + '<div class="wp-label">강화 단계</div><div class="wp-seg">' + ENHANCE_STEPS.map((n) => '<button type="button" data-enh="' + n + '" class="' + (n === enh ? 'on' : '') + '" aria-pressed="' + (n === enh) + '">+' + n + '</button>').join('') + '</div>'
    + '<p class="wp-hint">+5 은은한 광 · +10 속성 오라 · +15 금빛 오라 · +20 신화 오라</p>'
    + '<div class="modal-btns"><button class="btn btn-ghost" id="m-back">구성품</button><button class="btn btn-ghost" id="m-cancel">닫기</button></div></div></div></div>', { onOpen: (b) => {
    b.querySelector('#m-cancel').onclick = () => { close(); this.ui.closeModal(); };
    b.querySelector('#m-back').onclick = () => { close(); showGachaContents.call(this, 'weapon'); };
    b.querySelectorAll('[data-hero]').forEach((el) => el.onclick = () => showWeaponPreview.call(this, itemId, el.dataset.hero, enh));
    b.querySelectorAll('[data-enh]').forEach((el) => el.onclick = () => showWeaponPreview.call(this, itemId, heroId, +el.dataset.enh));
    this.app.wardrobe?.preview?.(b.querySelector('#wp-stage'), heroId, { weapon: { id: itemId, enh } });
  } });
}
