// Cosmetic DTO only. No callbacks, model paths, damage or arbitrary renderer methods.
export const PARTY_VISUAL_LIMIT = 24;
export const PARTY_VISUAL_BUDGET = 48;
const spec = (layout, color, options, weight = 1) => ({layout, color, options, weight});
export const PARTY_VISUALS = Object.freeze({
  castCircle: spec('color', 0xffd060, {radius:2.4, life:.9, demon:false}),
  groundTex: spec('texture', 0xffffff, {r0:.2, r1:4, life:.5, spin:1, y:.06, fadeIn:.15, hold:0}),
  shockTex: spec('color', 0xffe080, {r1:6, life:.45}),
  boltTex: spec('target', 0x9ad8ff, {width:1.6, life:.25}, 2),
  slashSprite: spec('target', 0xfff0a0, {size:3, life:.5, speed:0, tilt:-.6, flip:false}),
  explosion: spec('options', 0xffffff, {size:4, life:.55}),
  firePillar: spec('options', 0xffb060, {height:6, width:2.2, life:.8}, 2),
  iceBurst: spec('options', 0xc0f0ff, {size:3, life:.5}),
  holyBurst: spec('options', 0xfff0c0, {size:6, life:.4}),
  texFlash: spec('texture', 0xffffff, {size:3, life:.35, spin:0, grow:1.3, y:1}),
});
const textures = ['circle_gold','circle_demon','shockwave','ice','singularity','holy_burst'];
const ranges = {life:[.05,8], radius:[.1,32], r0:[0,32], r1:[.1,32], size:[.1,32], width:[.05,8],
  height:[.1,24], speed:[-40,40], spin:[-8,8], tilt:[-Math.PI,Math.PI], y:[0,8], fadeIn:[.01,.9], hold:[0,8], grow:[.1,3]};
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v, min, max) => Number.isFinite(v) && typeof v === 'number' && v >= min && v <= max;
const keys = (v, allowed) => Object.keys(v).every(k => allowed.includes(k));
const vector = v => object(v) && keys(v,['x','y','z']) && ['x','y','z'].every(k=>number(v[k],-2000,2000));
const round = v => Math.round(v * 1000) / 1000;
const copyVector = v => v && ({x:round(v.x), y:round(v.y), z:round(v.z)});
const getSpec = kind => Object.hasOwn(PARTY_VISUALS, kind) ? PARTY_VISUALS[kind] : null;

export function validPartyVisual(v) {
  if (!object(v) || !keys(v,['kind','at','pos','target','texture','color','options'])) return false;
  const s = getSpec(v.kind);
  if (!s || !number(v.at,0,3600) || !vector(v.pos) || !Number.isInteger(v.color) || !number(v.color,0,0xffffff) || !object(v.options)) return false;
  if (s.layout === 'target' ? !vector(v.target) : v.target !== undefined) return false;
  if (s.layout === 'texture' ? !textures.includes(v.texture) : v.texture !== undefined) return false;
  return keys(v.options,Object.keys(s.options)) && Object.entries(s.options).every(([key,value]) =>
    typeof value === 'boolean' ? typeof v.options[key] === 'boolean' : number(v.options[key],...ranges[key]));
}

/** Copy transient Three.js vectors now; skills often reuse them on the next tick. */
export function capturePartyVisual(kind, args, at) {
  const s = getSpec(kind); if (!s) return null;
  const index = s.layout === 'options' ? 1 : s.layout === 'color' ? 2 : 3;
  const source = args[index] || {};
  const v = {kind, at, pos:copyVector(args[0]), color:s.layout === 'options' ? source.color ?? s.color : args[index-1] ?? s.color, options:{}};
  if (s.layout === 'target') v.target = copyVector(args[1]);
  if (s.layout === 'texture') v.texture = args[1];
  for (const [key,fallback] of Object.entries(s.options)) {
    const value = source[key] ?? fallback;
    if (typeof fallback === 'boolean') v.options[key] = typeof value === 'boolean' ? value : fallback;
    else { const [min,max] = ranges[key]; v.options[key] = Math.min(max,Math.max(min,Number.isFinite(value) ? value : fallback)); }
  }
  return validPartyVisual(v) ? v : null;
}

/** Keep durable ground cues ahead of short decoration when a battle is busy. */
export function queuePartyVisual(queue, visual) {
  if (!validPartyVisual(visual)) return;
  if (queue.length < PARTY_VISUAL_LIMIT) { queue.push(visual); return; }
  if (visual.kind !== 'castCircle' && visual.kind !== 'groundTex') return;
  const i = queue.findIndex(v=>v.kind !== 'castCircle' && v.kind !== 'groundTex');
  if (i >= 0) queue.splice(i,1,visual);
}

/** Older cached clients validate snapshot keys strictly. Keep their combat compatible. */
export function partyVisualMessage(message, enabled) {
  if (enabled || message.type !== 'snapshot' || !message.snapshot?.visuals) return message;
  const {visuals, ...snapshot} = message.snapshot;
  return {...message,snapshot};
}
