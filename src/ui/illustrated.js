import { ENGRAVING_ART } from '../data/engraving-art.js';

// Authored engravings and original GUI artwork; visible names stay selectable interface text.
export const uiArt = id => Object.hasOwn(ENGRAVING_ART,id)?ENGRAVING_ART[id]:`/img/ui-crafted/${id}.webp`;
export const RESOURCE_ART = {
  gold:'gold', gems:'gems', gem:'gems', energy:'energy', xp:'hero-xp', heroExp:'hero-xp', renown:'renown',
  glass_leaf:'material-leaf', ember_core:'material-ember', star_dust:'material-stardust',
  stones:'material-stone', stones2:'material-ember', stones3:'material-stardust',
  protect:'material-guard-stone', bless:'material-essence', fragments:'material-essence',
  hp_tonic:'potion-health', overdrive:'potion-power', aegis:'potion-guard',
  sweep:'sweep-ticket', ticket:'sweep-ticket', tickets:'sweep-ticket', chest:'treasure-chest',
};
export const resourceArt = id => uiArt(RESOURCE_ART[id] || 'treasure-chest');
