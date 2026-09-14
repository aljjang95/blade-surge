import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ITEM_BY_ID, RARITY_COLOR } from '../data/items.js';
import { applySurfaceDetail } from '../engine/surface-textures.js';

const shapes = new Map();
function geometryFor(slot, summonShape = '') {
  const cacheKey = `${slot}|${summonShape || 'base'}`;
  if (shapes.has(cacheKey)) return shapes.get(cacheKey);
  const parts = [[], []];
  const add = (geo, index, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x,y,z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,rz)), new THREE.Vector3(1,1,1));
    geo.applyMatrix4(matrix); parts[index].push(geo);
  };
  const box = (w,h,d,m,x,y,z) => add(new THREE.BoxGeometry(w,h,d),m,x,y,z);
  if (summonShape === 'lantern') {
    add(new THREE.CylinderGeometry(.2, .25, .42, 12), 0, 0, 0, 0);
    add(new THREE.TorusGeometry(.24, .035, 8, 20), 1, 0, .24, 0);
    add(new THREE.SphereGeometry(.12, 10, 8), 1, 0, 0, 0);
    box(.05, .16, .05, 1, 0, -.3, 0);
  } else if (summonShape === 'grimoire') {
    box(.48, .62, .12, 0, 0, 0, 0);
    box(.06, .62, .135, 1, 0, 0, .02);
    add(new THREE.TorusGeometry(.16, .028, 8, 16), 1, 0, .05, .08, Math.PI / 2);
  } else if (summonShape === 'aegis') {
    const aegis = new THREE.SphereGeometry(.38, 12, 8); aegis.scale(.78, 1, .18); add(aegis, 0, 0, 0, 0);
    add(new THREE.OctahedronGeometry(.2), 1, 0, .08, .3);
    add(new THREE.TorusGeometry(.34, .035, 8, 24), 1, 0, 0, .28, Math.PI / 2);
  } else if (summonShape === 'prism') {
    add(new THREE.TorusGeometry(.3, .065, 8, 20), 0);
    add(new THREE.OctahedronGeometry(.2), 1, 0, 0, .03);
    add(new THREE.TorusGeometry(.17, .025, 8, 16), 1, 0, 0, .03, Math.PI / 2);
  } else if (summonShape === 'treads') {
    for(const s of [-1,1]) {
      box(.22,.48,.24,0,s*.17,.06,0);
      box(.23,.18,.43,0,s*.17,-.26,.08);
      box(.25,.055,.45,1,s*.17,-.35,.08);
      box(.25,.07,.27,1,s*.17,.24,0);
      add(new THREE.TorusGeometry(.095, .018, 6, 14), 1, s*.17, .33, .08, Math.PI / 2);
    }
  } else if (slot === 'weapon') {
    // A long tapered blade, brass crossguard, grip and pommel.
    const blade = new THREE.Shape(); blade.moveTo(-.085,-.14); blade.lineTo(.085,-.14); blade.lineTo(.085,.53); blade.lineTo(0,.75); blade.lineTo(-.085,.53); blade.closePath();
    add(new THREE.ExtrudeGeometry(blade,{depth:.055,bevelEnabled:true,bevelSize:.015,bevelThickness:.01,bevelSegments:1,steps:1}),0);
    box(.5,.075,.13,1,0,-.18,.025); box(.09,.28,.1,1,0,-.35,.025);
    add(new THREE.OctahedronGeometry(.105),1,0,-.53,.025);
  } else if (slot === 'armor') {
    // Cuirass with a visible open neck, waist and paired shoulder guards.
    const plate = new THREE.Shape(); plate.moveTo(-.26,-.35); plate.lineTo(.26,-.35); plate.lineTo(.37,.32); plate.lineTo(.17,.4); plate.lineTo(.12,.25); plate.lineTo(-.12,.25); plate.lineTo(-.17,.4); plate.lineTo(-.37,.32); plate.closePath();
    add(new THREE.ExtrudeGeometry(plate,{depth:.2,bevelEnabled:true,bevelSize:.03,bevelThickness:.025,bevelSegments:2,steps:1}),0);
    for(const s of [-1,1]) add(new THREE.SphereGeometry(.19,8,6,0,Math.PI*2,0,Math.PI*.62),1,s*.39,.27,.1,0,0,s*.25);
    box(.56,.055,.27,1,0,-.3,.1); box(.07,.4,.04,1,0,0,.24);
  } else if (slot === 'boots') {
    for(const s of [-1,1]) {
      box(.22,.48,.24,0,s*.17,.06,0);
      box(.23,.18,.43,0,s*.17,-.26,.08);
      box(.25,.055,.45,1,s*.17,-.35,.08);
      box(.25,.07,.27,1,s*.17,.24,0);
      box(.09,.1,.04,1,s*.17,.04,.15);
    }
  } else {
    add(new THREE.TorusGeometry(.3,.072,7,20),0);
    add(new THREE.OctahedronGeometry(.18),1,0,.29,.04);
  }
  const geometries = parts.map(list => {
    const flat = list.map(g => g.index ? g.toNonIndexed() : g);
    const merged = mergeGeometries(flat);
    for(const g of new Set([...list,...flat])) g.dispose();
    return merged;
  });
  shapes.set(cacheKey,geometries); return geometries;
}

/** Shared slot geometry and cached materials survive pickup; no per-drop GL allocations. */
export function createLootVisual(item, cache = new Map()) {
  const def = ITEM_BY_ID[item.id], slot = def?.slot || 'weapon', rarity = item.rarity || def?.rarity || 'N', summonShape = def?.summonShape || '';
  const key = `${slot}|${rarity}|${summonShape || 'base'}`;
  if (!cache.has(key)) {
    const leather = slot === 'boots';
    const body = new THREE.MeshStandardMaterial({ color: leather ? 0x80654b : 0xd6e3e9, roughness: leather ? .88 : .55, metalness: leather ? 0 : .35,
      emissive: leather ? 0x493621 : 0x718490, emissiveIntensity: .28 });
    const trim = new THREE.MeshStandardMaterial({ color: RARITY_COLOR[rarity] || '#e7cb8c', roughness:.46, metalness:.35,
      emissive: RARITY_COLOR[rarity] || '#e7cb8c', emissiveIntensity:.22 });
    applySurfaceDetail(body, leather ? 'cloth' : 'metal'); applySurfaceDetail(trim,'metal');
    cache.set(key,[body,trim]);
  }
  const root = new THREE.Group(); root.name = `loot-${slot}-${item.id}`;
  root.userData.lootSlot = slot;
  if (def?.summon) root.userData.lootSummon = def.summon.id;
  geometryFor(slot, summonShape).forEach((geometry,i) => { const mesh = new THREE.Mesh(geometry,cache.get(key)[i]); mesh.castShadow = true; root.add(mesh); });
  root.rotation.x = -.3;
  return root;
}
