import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildEnvironmentInstances } from '../engine/environment-kit-asset.js';
/** Original, runtime-authored citadel surroundings. Six static batches, no textures,
 * lights, particle emitters or combat navigation changes. */
/** @param {{ quality?: string, townId?: string | null, skin?: any }} [options] */
export function buildLobbyWorld({ quality = 'high', townId = null, skin = null, starter = false } = {}) {
 // 캠페인 2~6지역 마을(campaign-towns.js)은 서비스 마을과 무관하게 자기 풍경을 쓴다. 1지역은 아래 원형 성채 숲 마을이다.
 if (skin?.scenery) return buildRegionWorld(skin, { quality });
 // 잿불 항구·별마루 설원은 자기 풍경을 쓰고, 서약의 성채(기본)는 아래 원형을 그대로 만든다.
 if (townId === 'emberport' || townId === 'starcrest') return buildTownWorld(townId, { quality });
 const root=new THREE.Group();root.name='TLL_CitadelWorld';
 const colours=[0x576e70,0x97a69b,0x36565c,0xa58756,0x4a6960];
 const mats=colours.map(color=>new THREE.MeshLambertMaterial({color,flatShading:true}));
 const bins=mats.map(()=>[]),tr=new THREE.Object3D();let parts=0;
 function add(g,m,x,y,z,rx=0,ry=0){
  // 초목의 Icosahedron과 지형의 indexed primitive를 같은 속성 배치로 맞춘다.
  if(m===4&&g.index){const expanded=g.toNonIndexed();g.dispose();g=expanded;}
  tr.position.set(x,y,z);tr.rotation.set(rx,ry,0);tr.updateMatrix();g.applyMatrix4(tr.matrix);bins[m].push(g);parts++;
 }
 const box=(w,h,d,m,x,y,z,ry=0)=>add(new THREE.BoxGeometry(w,h,d),m,x,y,z,0,ry);
 const col=(r,h,m,x,y,z,n=10)=>add(new THREE.CylinderGeometry(r,r*1.12,h,n),m,x,y,z);
 const arch=(x,z,w,h,ry=0)=>{for(const sign of [-1,1]){const dx=sign*w*.5;box(.42,h,.55,1,x+dx*Math.cos(ry),h*.5-.2,z-dx*Math.sin(ry),ry);}add(new THREE.TorusGeometry(w*.5,.22,5,24,Math.PI),1,x,h-.2,z,0,ry);};
 // 숲과 마을은 공중 소품이 아니라 광장과 이어진 넓은 지형 위에 놓인다.
 col(53,1.15,4,0,-1.25,0,64);
 for (const side of [-1, 1]) {
  box(14,.22,38,4,side*19,-.66,-1);
  box(5,.09,24,1,side*16,-.43,0);
  for (const z of [-12,-4,4,12]) box(13,.09,2.8,1,side*21,-.42,z);
 }
 // Clear, continuous apron around the original hero dais, then a bridge into the city.
 col(12,.38,0,0,-.68,0,64);col(11.7,.12,1,0,-.45,0,64);
 box(6,.4,25,0,0,-.72,21);box(5.7,.10,25,1,0,-.46,21);
 for(let z=10;z<=32;z+=2){box(5.5,.025,.055,3,0,-.4,z);for(const side of [-1,1]){col(.14,1.1,1,side*2.9,.08,z);box(.22,.18,2.1,3,side*2.9,.68,z+1);}}
 // 초보자 마을(starter)은 입구 쪽 카메라가 첫 아치(z 15)에 가리지 않게 그 아치만 뺀다.
 for(const z of starter?[24,33]:[15,24,33]){arch(0,z,6.8,4.2);for(const side of [-1,1]){col(.7,6,0,side*4,2.4,z,8);col(.85,.22,1,side*4,5.5,z,8);add(new THREE.ConeGeometry(.95,1.7,8),2,side*4,6.4,z);}}
 // Repeated terraces recede in actual depth, including the formerly empty front hemisphere.
 for(let i=0;i<24;i++){
  if(i%3!==0)continue;
  const a=i*Math.PI/12,r=24+(i%3)*4,x=Math.sin(a)*r,z=Math.cos(a)*r;
  const h=3.5+(i*7%9)*.55,w=2.8+(i%3)*.4;
  box(w+1,1,w+1,0,x,-1.2,z,a);box(w,h,w, i%3===0?0:2,x,h*.5-.7,z,a);
  col(w*.55,.25,1,x,h-.6,z,8);add(new THREE.ConeGeometry(w*.7,2.5,8),2,x,h+.65,z);
  // Inlaid windows and balcony cornices read as architecture rather than a blank wall.
  for(let floor=1;floor<h-1;floor+=1.4)for(const sign of [-1,1]){box(.22,.65,.04,3,x+sign*.6*Math.cos(a)+Math.sin(a)*(w*.51),floor,z-sign*.6*Math.sin(a)+Math.cos(a)*(w*.51),a);}
 }
 for(const side of [-1,1]){box(13,.4,4,0,side*15,-.66,2);arch(side*15,2,4.2,4.4,Math.PI/2);for(let j=0;j<5;j++){col(.16,1,1,side*(10+j*2),0,4);box(2.2,.16,.25,3,side*(10+j*2),.6,4);}}
 for(let i=0;i<18;i++){const a=i*Math.PI/9,r=52,x=Math.sin(a)*r,z=Math.cos(a)*r;const h=9+(i*11%13);add(new THREE.ConeGeometry(8,h,5),2,x,h*.5-5,z);if(i%2===0)add(new THREE.IcosahedronGeometry(3,0),4,x,3,z);}
 for(let i=0;i<bins.length;i++){const geometry=mergeGeometries(bins[i]);bins[i].forEach(g=>g.dispose());const mesh=new THREE.Mesh(geometry,mats[i]);mesh.name='Citadel_static_'+i;mesh.receiveShadow=false;mesh.castShadow=false;root.add(mesh);}
 const sky=new THREE.SphereGeometry(95,32,16),p=sky.attributes.position,c=[];
 const horizon=new THREE.Color(0x91afb2),zenith=new THREE.Color(0x284b6d),v=new THREE.Color();
 for(let i=0;i<p.count;i++){v.copy(horizon).lerp(zenith,Math.min(1,Math.max(0,p.getY(i)/65)));c.push(v.r,v.g,v.b);}
 sky.setAttribute('color',new THREE.Float32BufferAttribute(c,3));const sm=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.BackSide,fog:false,depthWrite:false});
 const dome=new THREE.Mesh(sky,sm);dome.name='Citadel_sky';dome.renderOrder=-10;root.add(dome);
 const placements = [], low = quality === 'low', count = low ? 20 : 36;
 // 네 구역으로 나눠 보이지 않는 숲까지 한 번에 그리는 거대한 배치를 피한다.
 for(let row=0;row<3;row++)for(let i=0;i<count;i++){
  const a=(i+.23*(row%2))*Math.PI*2/count,r=22+row*10+(i*7%5),x=Math.sin(a)*r,z=Math.cos(a)*r;
  if(row===0&&Math.abs(x)<5.5)continue;
  const chunk=`forest-${Math.floor((a%(Math.PI*2))/(Math.PI/2))}`;
  placements.push({asset:i%3===0?'broadleaf-tree':'evergreen-tree',x,z,y:-.55,yaw:a+.4,scale:.8+(i%4)*.12,chunk});
  if(row===0&&i%4===0)placements.push({asset:'mossy-rock-cluster',x:x*.95,z:z*.95,y:-.5,yaw:a,scale:1.2,chunk});
 }
 for(const side of [-1,1])for(let i=0;i<(low?3:5);i++){
  const x=side*(18.7+(i%2)*5.7),z=-13+i*6.4;
  placements.push({asset:'timber-cottage',x,z,y:-.36,yaw:-side*Math.PI/2,scale:.84+(i%2)*.08,chunk:`village-${side}`});
  placements.push({asset:'lantern',x:x-side*3.1,z:z+2,y:-.37,scale:.85,chunk:`village-${side}`});
 }
 placements.push({asset:'village-gate',x:0,z:33,y:-.4,yaw:Math.PI,scale:1.1,chunk:'city-bridge'});
 const environment = buildEnvironmentInstances(placements, { name: 'Citadel_ForestVillage' });
 if(environment.userData.batchCount)root.add(environment);
 root.userData={version:'citadel-forest-village-v2',parts,batches:6+environment.userData.batchCount,interactive:false,environmentInstances:environment.userData.instanceCount};let disposed=false;
 const ownedMeshes = root.children.filter(o=>o.isMesh);
 root.userData.dispose=()=>{if(disposed)return;disposed=true;environment.userData.dispose();for(const o of ownedMeshes){o.geometry.dispose();o.material.dispose();}root.removeFromParent();};
 return root;
}

/**
 * 잿불 항구·별마루 설원 마을의 광장 바깥 풍경. 서약의 성채는 lobby-world.js 원형을 그대로 쓴다.
 * 정적 병합 배치만 쓰며 조명·파티클·충돌을 만들지 않는다(걷기 데이터는 data/citadel-hub.js 하나).
 */
function createBatcher(materials) {
  const bins = materials.map(() => []), tr = new THREE.Object3D();
  let parts = 0;
  const add = (geometry, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    tr.position.set(x, y, z); tr.rotation.set(rx, ry, rz); tr.scale.set(sx, sy, sz); tr.updateMatrix();
    // 인덱스 유무가 섞이면 병합이 실패하므로 모두 비인덱스로 맞춘다.
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    flat.applyMatrix4(tr.matrix); bins[m].push(flat); parts++;
  };
  return {
    add,
    box: (w, h, d, m, x, y, z, ry = 0) => add(new THREE.BoxGeometry(w, h, d), m, x, y, z, 0, ry),
    cyl: (r, h, m, x, y, z, sides = 10, rTop = r) => add(new THREE.CylinderGeometry(rTop, r, h, sides), m, x, y, z),
    cone: (r, h, m, x, y, z, sides = 8, ry = 0, sx = 1, sz = 1) => add(new THREE.ConeGeometry(r, h, sides), m, x, y, z, 0, ry, 0, sx, 1, sz),
    ball: (r, m, x, y, z, sx = 1, sy = 1, sz = 1) => add(new THREE.SphereGeometry(r, 10, 7), m, x, y, z, 0, 0, 0, sx, sy, sz),
    get parts() { return parts; },
    finish(materialList, root, geometryOwned) {
      bins.forEach((pieces, index) => {
        if (!pieces.length) return;
        const geometry = mergeGeometries(pieces); pieces.forEach(piece => piece.dispose());
        if (!geometry) return;
        geometryOwned.push(geometry);
        const mesh = new THREE.Mesh(geometry, materialList[index]); mesh.name = 'Town_static_' + index;
        mesh.receiveShadow = false; mesh.castShadow = false; root.add(mesh);
      });
    },
  };
}

function skyDome(horizon, zenith, ground) {
  const geometry = new THREE.SphereGeometry(95, 32, 16), position = geometry.attributes.position, colors = [];
  const h = new THREE.Color(horizon), z = new THREE.Color(zenith), g = new THREE.Color(ground), v = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    if (y < 0) v.copy(h).lerp(g, Math.min(1, -y / 30)); else v.copy(h).lerp(z, Math.min(1, y / 62));
    colors.push(v.r, v.g, v.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  mesh.name = 'Town_sky'; mesh.renderOrder = -10; return mesh;
}

/** 중심에서 가장자리로 색이 번지는 지면/수면 원반. */
function groundDisc(radius, y, inner, outer, name) {
  const geometry = new THREE.CircleGeometry(radius, 64); geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position, colors = [], a = new THREE.Color(inner), b = new THREE.Color(outer), v = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const r = Math.hypot(position.getX(i), position.getZ(i)) / radius;
    v.copy(a).lerp(b, Math.min(1, Math.max(0, (r - .15) / .85))); colors.push(v.r, v.g, v.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.position.y = y; mesh.name = name; return mesh;
}

/** 하늘에 걸린 빛의 띠. 꼭짓점 색에 알파를 실어 위로 갈수록 사라지게 한다. */
function auroraRibbon({ radius, from, to, base, height, wave, bottom, top, phase }) {
  const steps = 48, position = [], colors = [], index = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, angle = from + (to - from) * t;
    const low = base + Math.sin(t * 9 + phase) * wave, high = low + height * (.7 + .3 * Math.sin(t * 5 + phase * 2));
    const edge = Math.sin(Math.PI * t);
    for (const [y, color, alpha] of [[low, bottom, .62 * edge], [high, top, 0]]) {
      position.push(Math.sin(angle) * radius, y, -Math.cos(angle) * radius);
      colors.push(color.r, color.g, color.b, alpha);
    }
    if (i < steps) { const k = i * 2; index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4)); geometry.setIndex(index);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  mesh.name = 'Town_aurora'; mesh.renderOrder = -9; return mesh;
}

function glowDisc(color, radius, x, y, z, opacity) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 36),
    new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, fog: false, depthWrite: false }));
  mesh.position.set(x, y, z); mesh.rotation.y = Math.atan2(-x, -z); mesh.renderOrder = -9; return mesh;
}

function finishRoot(root, { batches, meshes, environment, ownedMaterials, ownedGeometry, parts, townId }) {
  let disposed = false;
  root.userData = { version: 'town-scenery-v1', townId, parts, batches: batches + environment.userData.batchCount, interactive: false,
    environmentInstances: environment.userData.instanceCount,
    dispose() {
      if (disposed) return; disposed = true; environment.userData.dispose();
      for (const geometry of ownedGeometry) geometry.dispose();
      for (const mesh of meshes) { mesh.geometry.dispose(); mesh.material.dispose(); }
      for (const material of ownedMaterials) material.dispose();
      root.removeFromParent();
    } };
  return root;
}
const tintGroup = (group, color, amount) => {
  const target = new THREE.Color(color);
  group.traverse(node => {
    if (!node.isMesh) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.color?.lerp(target, amount);
  });
};

// ---------------------------------------------------------------- 잿불 항구 마을
function buildEmberport({ quality }) {
  const root = new THREE.Group(); root.name = 'TLL_Emberport';
  const lambert = color => new THREE.MeshLambertMaterial({ color, flatShading: true });
  const materials = [0xcf9f6c, 0xb0603f, 0x5a3e30, 0x92312b, 0x4f3a3a, 0x7c6f68, 0xf0e2cc, 0xf4dfb8, 0x2b3a52, 0x8a3a2c, 0x38485c].map(lambert);
  const windowGlow = new THREE.MeshBasicMaterial({ color: 0xffc468 }), beam = new THREE.MeshBasicMaterial({ color: 0xfff0b8 });
  materials.push(windowGlow, beam);
  const SAND = 0, TERRA = 1, TIMBER = 2, ROOF = 3, ROOF_DARK = 4, STONE = 5, WHITE = 6, SAIL = 7, HULL_NAVY = 8, HULL_RED = 9, ROCK = 10, GLOW = 11, BEAM = 12;
  const b = createBatcher(materials), meshes = [], ownedGeometry = [];
  // 부두 받침(광장 아래)과 바다 쪽으로 뻗은 잔교.
  b.box(31, .5, 31, STONE, 0, -.78, 0); b.box(32, .18, 32, TIMBER, 0, -.5, 0);
  for (const z of [-9, 0, 9]) {
    b.box(21, .3, 3.2, TIMBER, -26, -.55, z);
    for (let i = 0; i < 7; i++) for (const side of [-1, 1]) { b.cyl(.17, 1.7, TIMBER, -16.5 - i * 3, -.1, z + side * 1.7, 7); }
    b.cyl(.2, 1.2, STONE, -36, -.3, z, 8); b.box(.4, .3, .4, GLOW, -36, .6, z);
  }
  // 서쪽은 바다로 열려 있고 북·동·남에 돌 부두 땅이 이어진다.
  b.box(72, .8, 24, STONE, 0, -.85, -28); b.box(22, .8, 44, STONE, 27, -.85, 2); b.box(56, .8, 20, STONE, 10, -.85, 26);
  const ship = (x, z, yaw, sc, hull, sail) => {
    const c = Math.cos(yaw), n = Math.sin(yaw), at = (lx, lz) => [x + (lx * c + lz * n) * sc, z + (-lx * n + lz * c) * sc];
    const part = (w, h, d, m, lx, ly, lz, ry = 0) => { const [px, pz] = at(lx, lz); b.add(new THREE.BoxGeometry(w * sc, h * sc, d * sc), m, px, ly * sc - .4, pz, 0, yaw + ry); };
    part(3.1, 1.5, 8, hull, 0, .35, 0); part(2.2, 1.5, 2.2, hull, 0, .35, 4.1, Math.PI / 4);
    part(2.7, .2, 7.4, TIMBER, 0, 1.2, 0); part(1.6, 1.1, 1.8, TERRA, 0, 1.9, -2.6); part(3.2, .16, 8.2, TIMBER, 0, .55, 0);
    const [mx, mz] = at(0, .7);
    b.cyl(.13 * sc, 9 * sc, TIMBER, mx, 4.8 * sc - .4, mz, 6);
    part(.07, 5.2, 3.1, sail, 0, 4.5, .9, Math.PI / 2);
    part(.4, .4, .4, GLOW, 0, 2.1, -3.6);
  };
  ship(-27, -4.5, Math.PI / 2 + .05, 1, HULL_RED, SAIL); ship(-30, 4.5, Math.PI / 2 - .08, 1.1, HULL_NAVY, TERRA);
  ship(-38, -14, .45, .9, HULL_NAVY, SAIL); ship(-32, 16, .3, .9, HULL_RED, SAIL);
  // 창고 줄: 회벽 몸체, 사각뿔 지붕, 따뜻하게 켜진 창.
  const warehouse = (x, z, w, h, d, wall, roof, yaw = 0) => {
    const c = Math.cos(yaw), n = Math.sin(yaw), at = (lx, lz) => [x + lx * c + lz * n, z - lx * n + lz * c];
    b.box(w, h, d, wall, x, h / 2 - .6, z, yaw); b.box(w + .5, .3, d + .5, TIMBER, x, h - .5, z, yaw);
    b.cone(Math.max(w, d) * .75, 2.4, roof, x, h + .75, z, 4, Math.PI / 4 + yaw, w / Math.max(w, d), d / Math.max(w, d));
    for (let i = -1; i <= 1; i += 2) { const [px, pz] = at(i * w * .22, d / 2 + .02); b.box(.55, .75, .05, GLOW, px, h * .55 - .6, pz, yaw); }
    const [dx, dz] = at(0, d / 2 + .03); b.box(1.5, 2.2, .06, TIMBER, dx, 1.1 - .6, dz, yaw);
  };
  warehouse(-17, -20, 7, 4.2, 5.2, SAND, ROOF); warehouse(-8, -23, 6, 3.6, 5, TERRA, ROOF_DARK);
  warehouse(8, -23, 6.5, 4, 5, TERRA, ROOF); warehouse(17.5, -19.5, 7, 4.6, 5.4, SAND, ROOF_DARK);
  warehouse(26, -8, 5.2, 3.6, 6.4, SAND, ROOF, Math.PI / 2); warehouse(27, 5, 5.2, 4, 6.4, TERRA, ROOF_DARK, Math.PI / 2);
  warehouse(-12, 23, 6, 3.8, 5, SAND, ROOF_DARK, .3); warehouse(22, 19, 6, 4, 5, TERRA, ROOF, -.6);
  // 등대: 붉고 흰 줄무늬, 가장 높은 실루엣.
  for (let i = 0; i < 4; i++) b.cyl(2.15 - i * .22, 3.4, i % 2 ? TERRA : WHITE, 31, 1.4 + i * 3.4, -17, 12, 1.93 - i * .22);
  b.cyl(2.2, .3, TIMBER, 31, 15.1, -17, 12); b.cyl(1.2, 1.7, BEAM, 31, 16.1, -17, 10); b.cone(1.7, 1.6, ROOF, 31, 17.8, -17, 10);
  b.cyl(3.4, 1.4, STONE, 31, -.1, -17, 10, 3.9);
  // 먼 바다의 바위섬.
  for (const [x, z, r, h] of [[-52, -30, 6, 9], [-58, 8, 5, 6], [46, -42, 7, 10], [30, 50, 6, 6], [-18, 56, 5, 7]]) b.cone(r, h, ROCK, x, h / 2 - 1.4, z, 6, x * .1, 1.1, 1);
  b.finish(materials, root, ownedGeometry);
  const sea = groundDisc(88, -1.4, 0x1f5566, 0xd98458, 'Town_sea'); root.add(sea); meshes.push(sea);
  const sky = skyDome(0xf2a46a, 0x2a2457, 0x41303a); root.add(sky); meshes.push(sky);
  const sun = glowDisc(0xffcb86, 6.5, -42, 12, -72, 1), halo = glowDisc(0xff9a54, 17, -41.5, 12, -71.5, .3);
  root.add(sun, halo); meshes.push(sun, halo);
  const ownedMaterials = materials;
  const low = quality === 'low', placements = [];
  for (const side of [-1, 1]) for (const z of [-14, -8, -2, 4, 10]) placements.push({ asset: 'lantern', x: side * 14.8, z, y: -.3, scale: .95, chunk: 'quay' });
  placements.push({ asset: 'village-gate', x: 0, z: -29, y: -.4, yaw: 0, scale: 1.1, chunk: 'gate' });
  for (const [x, z, yaw] of [[24, -13, -1.4], [24, 13, -1.4], [-12, -17.5, 0], [12, -17.5, 0]]) if (!low || x > 0) placements.push({ asset: 'timber-cottage', x, z, y: -.4, yaw, scale: .82, chunk: 'cottage' });
  const environment = buildEnvironmentInstances(placements, { name: 'Emberport_Environment' });
  tintGroup(environment, 0xffa860, .42); if (environment.userData.batchCount) root.add(environment);
  return finishRoot(root, { batches: materials.length, meshes, environment, ownedMaterials, ownedGeometry, parts: b.parts, townId: 'emberport' });
}

// ---------------------------------------------------------------- 별마루 설원 마을
function buildStarcrest({ quality }) {
  const root = new THREE.Group(); root.name = 'TLL_Starcrest';
  const lambert = color => new THREE.MeshLambertMaterial({ color, flatShading: true });
  const materials = [0xeaf3ff, 0x9cc6e8, 0x58708f, 0x5b4a45, 0x8a6a55, 0xf4f9ff, 0xb8c7dd, 0xcdd9ee, 0x274866].map(lambert);
  const warm = new THREE.MeshBasicMaterial({ color: 0xffcf7a }), crystal = new THREE.MeshBasicMaterial({ color: 0x8fe8ff });
  materials.push(warm, crystal);
  const SNOW = 0, ICE = 1, ROCK = 2, WOOD = 3, WALL = 4, ROOF = 5, METAL = 6, DOME = 7, PINE = 8, WARM = 9, CRYSTAL = 10;
  const b = createBatcher(materials), meshes = [], ownedGeometry = [];
  b.cyl(16.4, .6, SNOW, 0, -.8, 0, 40); b.cyl(17, .3, ICE, 0, -1, 0, 40);
  // 둥근 설구와 눈 덮인 산.
  for (const [x, z, sx, sy, sz] of [[-30, -6, 14, 3.6, 11], [32, -8, 13, 4, 12], [-8, -34, 16, 4.4, 10], [14, -38, 14, 3.2, 10], [-34, 16, 12, 3, 9], [34, 18, 12, 3.4, 9]])
    b.ball(1, SNOW, x, -1.8, z, sx, sy, sz);
  const peaks = [[-46, -40, 12, 24], [-26, -52, 14, 28], [0, -58, 18, 34], [26, -54, 14, 26], [48, -38, 12, 22], [-56, -10, 11, 20], [56, -8, 11, 21]];
  for (const [x, z, r, h] of peaks) {
    b.cone(r, h, ROCK, x, h / 2 - 2, z, 6, x * .07);
    b.cone(r * .46, h * .42, SNOW, x, h * .79 - 2, z, 6, x * .07);
  }
  // 오두막: 눈 지붕 A자 집과 따뜻한 창.
  const cabin = (x, z, yaw, s = 1) => {
    const c = Math.cos(yaw), s2 = Math.sin(yaw), at = (lx, lz) => [x + lx * c + lz * s2, z - lx * s2 + lz * c];
    const [fx, fz] = at(0, 1.6 * s);
    b.add(new THREE.BoxGeometry(3.6 * s, 2.2 * s, 3.2 * s), WALL, x, 1.1 * s - .6, z, 0, yaw);
    for (const side of [-1, 1]) { const [rx, rz] = at(side * 1.15 * s, 0); b.add(new THREE.BoxGeometry(.28 * s, 3.5 * s, 3.8 * s), ROOF, rx, 3 * s - .6, rz, 0, yaw, side * .95); }
    b.add(new THREE.BoxGeometry(.7 * s, .8 * s, .06), WARM, fx, 1.3 * s - .6, fz, 0, yaw);
    b.add(new THREE.BoxGeometry(.9 * s, 1.5 * s, .08), WOOD, ...[at(-1.1 * s, 1.62 * s)[0], .75 * s - .6, at(-1.1 * s, 1.62 * s)[1]], 0, yaw);
    const [cx, cz] = at(1 * s, -.8 * s); b.add(new THREE.BoxGeometry(.5 * s, 1.6 * s, .5 * s), ROCK, cx, 3.4 * s - .6, cz, 0, yaw);
  };
  cabin(-19.5, -5, Math.PI / 2 - .1); cabin(19.5, -6.5, -Math.PI / 2 + .12); cabin(-21.5, 6, Math.PI / 2 + .2, 1.1);
  cabin(21.5, 5.5, -Math.PI / 2 - .15, .95); cabin(-8, -22, .15, 1.2); cabin(9, -21.5, -.2);
  // 천문대: 언덕 위 은빛 돔과 열린 틈.
  b.ball(1, SNOW, -26, -2.4, -27, 10, 4.6, 9);
  b.cyl(2.6, 6, METAL, -26, 2.6, -27, 14, 2.3);
  b.add(new THREE.SphereGeometry(2.7, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), DOME, -26, 5.6, -27);
  b.add(new THREE.BoxGeometry(.45, 3.1, .25), CRYSTAL, -26, 6.2, -24.5, -.55);
  b.add(new THREE.CylinderGeometry(.22, .3, 3.2, 8), METAL, -24.6, 7.6, -25.2, 0, 0, -.9);
  // 푸른 결정 기둥 군락.
  for (const [cx, cz] of [[26, -24], [-34, -14], [4, -30]]) for (let i = 0; i < 6; i++) {
    const a = i * 1.05 + cx * .1, r = i === 0 ? 0 : 1.4 + (i % 2) * .6, h = i === 0 ? 8 : 3.2 + (i % 3) * 1.3;
    b.add(new THREE.ConeGeometry(.72 - i * .04, h, 5), CRYSTAL, cx + Math.cos(a) * r, h / 2 - .6, cz + Math.sin(a) * r, 0, a, (i % 2 ? .12 : -.1));
  }
  // 얼어붙은 연못.
  b.cyl(7.2, .12, ICE, 15, -.55, -21, 24); b.cyl(6.6, .14, CRYSTAL, 15, -.52, -21, 24, 6.2);
  b.finish(materials, root, ownedGeometry);
  const snowfield = groundDisc(88, -.72, 0xe3eefc, 0x5b78a8, 'Town_snow'); root.add(snowfield); meshes.push(snowfield);
  const sky = skyDome(0x3c5a9a, 0x050a22, 0x1a2a52); root.add(sky); meshes.push(sky);
  const ribbons = [
    auroraRibbon({ radius: 78, from: -1.25, to: 1.1, base: 22, height: 26, wave: 4, bottom: new THREE.Color(.25, 1, .62), top: new THREE.Color(.45, .45, 1), phase: 0 }),
    auroraRibbon({ radius: 72, from: -.9, to: 1.35, base: 28, height: 22, wave: 3, bottom: new THREE.Color(.2, .9, .9), top: new THREE.Color(.7, .35, 1), phase: 2.1 }),
  ];
  for (const ribbon of ribbons) { root.add(ribbon); meshes.push(ribbon); }
  // 별: 하늘 위쪽에 점으로 흩뿌린다. 고정 시드라 같은 하늘이 나온다.
  const stars = [];
  let state = 1234567;
  const random = () => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < (quality === 'low' ? 180 : 360); i++) {
    const theta = random() * Math.PI * 2, y = .1 + random() * .86, ring = Math.sqrt(1 - y * y);
    stars.push(Math.cos(theta) * ring * 90, y * 90, Math.sin(theta) * ring * 90);
  }
  const starGeometry = new THREE.BufferGeometry(); starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(stars, 3));
  const starPoints = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xf2f7ff, size: .9, fog: false, depthWrite: false }));
  starPoints.name = 'Town_stars'; starPoints.renderOrder = -9; root.add(starPoints); meshes.push(starPoints);
  const moon = glowDisc(0xf3f8ff, 4.4, 30, 40, -74, 1), moonHalo = glowDisc(0xaec8ff, 11, 29.5, 40, -73.5, .22);
  root.add(moon, moonHalo); meshes.push(moon, moonHalo);
  const ownedMaterials = materials;
  const low = quality === 'low', placements = [];
  for (let row = 0; row < 3; row++) for (let i = 0; i < (low ? 14 : 26); i++) {
    const count = low ? 14 : 26, a = (i + .3 * (row % 2)) * Math.PI * 2 / count + .1, r = 24 + row * 9 + (i * 7 % 5), x = Math.sin(a) * r, z = -Math.cos(a) * r;
    if (z > 12 || (row === 0 && Math.abs(x) < 5.5 && z < -19 && z > -25)) continue;
    placements.push({ asset: 'evergreen-tree', x, z, y: -.55, yaw: a, scale: .85 + (i % 4) * .13, chunk: 'pines-' + Math.floor(((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI / 2)) });
  }
  for (const side of [-1, 1]) for (const z of [-12, -4, 4]) placements.push({ asset: 'lantern', x: side * 16.4, z, y: -.3, scale: .92, chunk: 'lanterns' });
  placements.push({ asset: 'village-gate', x: 0, z: -30, y: -.4, scale: 1.05, chunk: 'gate' });
  const environment = buildEnvironmentInstances(placements, { name: 'Starcrest_Environment' });
  tintGroup(environment, 0xe4f1ff, .6); if (environment.userData.batchCount) root.add(environment);
  return finishRoot(root, { batches: materials.length, meshes, environment, ownedMaterials, ownedGeometry, parts: b.parts, townId: 'starcrest' });
}

/** 잿불 항구·별마루 설원의 광장 바깥 풍경. */
export function buildTownWorld(townId, { quality = 'high' } = {}) {
  return townId === 'starcrest' ? buildStarcrest({ quality }) : buildEmberport({ quality });
}

// ---------------------------------------------------------------- 캠페인 지역 마을 풍경 (2~6지역)
// 지역 던전의 색과 기존 환경 조각(등불·마을 문·나무)만 쓴다. 새 자산·조명·충돌 없이 병합 정적 배치다.
const seededRandom = (seed) => { let state = seed >>> 0; return () => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296; };
const ringPoint = (angle, radius) => [Math.sin(angle) * radius, -Math.cos(angle) * radius];

function regionPoints(count, radius, y0, y1, color, size, seed) {
  const random = seededRandom(seed), positions = [];
  for (let i = 0; i < count; i++) {
    const theta = random() * Math.PI * 2, r = radius * (.35 + random() * .65);
    positions.push(Math.cos(theta) * r, y0 + random() * (y1 - y0), Math.sin(theta) * r);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size, fog: false, depthWrite: false }));
  points.name = 'Town_motes'; points.renderOrder = -9; return points;
}

// 건물 한 채: 몸체·테두리·사각뿔 지붕·불 켜진 창과 문. yaw 만큼 돌려 광장을 바라보게 한다.
function regionHouse(b, { x, z, w, h, d, wall, roof, trim, glow, door, yaw = 0, roofH = 2.4 }) {
  const c = Math.cos(yaw), n = Math.sin(yaw), at = (lx, lz) => [x + lx * c + lz * n, z - lx * n + lz * c];
  b.box(w, h, d, wall, x, h / 2 - .6, z, yaw); b.box(w + .5, .3, d + .5, trim, x, h - .5, z, yaw);
  b.cone(Math.max(w, d) * .75, roofH, roof, x, h + roofH / 2 - .4, z, 4, Math.PI / 4 + yaw, w / Math.max(w, d), d / Math.max(w, d));
  for (let i = -1; i <= 1; i += 2) { const [px, pz] = at(i * w * .22, d / 2 + .02); b.box(.55, .75, .05, glow, px, h * .55 - .6, pz, yaw); }
  const [dx, dz] = at(0, d / 2 + .03); b.box(1.5, 2.2, .06, door, dx, .5, dz, yaw);
}

function buildRegionWorld(spec, { quality }) {
  const root = new THREE.Group(); root.name = 'TLL_Region_' + spec.id;
  const lambert = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true }), basic = (color) => new THREE.MeshBasicMaterial({ color });
  const low = quality === 'low', meshes = [], ownedGeometry = [], placements = [];
  const kit = REGION_KITS[spec.scenery];
  const materials = [...kit.solid.map(lambert), ...kit.glow.map(basic)];
  const S = Object.fromEntries([...kit.names].map((name, i) => [name, i]));
  const b = createBatcher(materials);
  // 광장 아래 받침과 바깥 지면(지역마다 색이 다르다).
  b.cyl(17.5, .9, S.base, 0, -.85, 0, 44); b.cyl(18.2, .25, S.trim, 0, -.42, 0, 44, 17.9);
  kit.build({ b, S, low, placements, random: seededRandom(spec.chapter * 7919), root, meshes });
  b.finish(materials, root, ownedGeometry);
  const floor = groundDisc(88, spec.ground.y, spec.ground.inner, spec.ground.outer, 'Town_ground'); root.add(floor); meshes.push(floor);
  const sky = skyDome(spec.sky.horizon, spec.sky.zenith, spec.sky.ground); root.add(sky); meshes.push(sky);
  for (const extra of kit.sky({ low, random: seededRandom(spec.chapter * 104729), root, meshes })) { root.add(extra); meshes.push(extra); }
  const environment = buildEnvironmentInstances(placements, { name: 'Region_' + spec.id });
  if (kit.tint) tintGroup(environment, ...kit.tint); if (environment.userData.batchCount) root.add(environment);
  const result = finishRoot(root, { batches: materials.length, meshes, environment, ownedMaterials: materials, ownedGeometry, parts: b.parts, townId: spec.id });
  result.userData.version = 'campaign-region-town-v1'; result.userData.campaignChapter = spec.chapter;
  return result;
}

const lanternRow = (placements, radius, scale = .95) => {
  for (const side of [-1, 1]) for (const z of [-14, -8, -2, 4, 10]) placements.push({ asset: 'lantern', x: side * radius, z, y: -.3, scale, chunk: 'lanterns' });
};

const REGION_KITS = {
  // ---- 2지역 불씨 용광로: 현무암 대장간 거리, 용암 수로, 굴뚝과 불똥
  forge: {
    names: ['base', 'trim', 'brick', 'roof', 'iron', 'basalt', 'door', 'lava', 'ember', 'window'],
    solid: [0x3a2b27, 0x6a4a3c, 0x7a3e2c, 0x1e1516, 0x59616c, 0x2a2120, 0x3a251a], glow: [0xff4a12, 0xffc060, 0xffa24a],
    tint: [0xff8a50, .4],
    build({ b, S, low, placements, random }) {
      for (const angle of [.5, 1.7, 3.0, 4.2, 5.4]) { // 광장 바깥으로 흐르는 용암 수로
        const [x, z] = ringPoint(angle, 34); b.add(new THREE.BoxGeometry(2.6, .14, 34), S.lava, x * .93, -.62, z * .93, 0, angle + Math.PI);
      }
      b.cyl(11, .12, S.lava, -30, -.9, -30, 24);
      // 뒤편 대형 주조소: 굴뚝 셋, 용광로 아가리, 벽돌 몸체
      b.box(22, 9, 10, S.brick, 0, 3.9, -34); b.box(23, .6, 11, S.basalt, 0, 8.7, -34);
      for (const x of [-7, 0, 7]) { b.cyl(1.5, 15, S.basalt, x, 9, -37, 10, 1.1); b.cyl(1.6, .7, S.lava, x, 16.8, -37, 10); }
      b.box(6, 4.5, .2, S.lava, 0, 1.9, -28.9); b.box(7.4, .5, .5, S.iron, 0, 4.4, -28.8); b.box(.6, 5, .5, S.iron, -3.4, 1.9, -28.8); b.box(.6, 5, .5, S.iron, 3.4, 1.9, -28.8);
      // 대장간 집 열 채
      const houses = low ? 6 : 10;
      for (let i = 0; i < houses; i++) {
        const angle = (i + .5) * Math.PI * 2 / houses + .15, [x, z] = ringPoint(angle, 26 + (i % 3) * 3);
        if (z < -22 && Math.abs(x) < 16) continue;
        regionHouse(b, { x, z, w: 5.6 + (i % 2), h: 3.6 + (i % 3) * .5, d: 5, wall: i % 2 ? S.brick : S.basalt, roof: S.roof, trim: S.iron, glow: S.window, door: S.door, yaw: angle + Math.PI });
        if (i % 3 === 0) { b.cyl(.55, 4.4, S.basalt, x + 1.2, 5.4, z, 8); b.cyl(.6, .3, S.lava, x + 1.2, 7.7, z, 8); }
      }
      // 모루와 망치 기념물
      for (const side of [-1, 1]) { b.box(3.4, 1.1, 1.8, S.iron, side * 19, .0, -9); b.box(2, 1.4, 1.2, S.iron, side * 19, 1.0, -9); b.box(1, .5, 3.2, S.iron, side * 19.4, 1.9, -9, .5 * side); b.box(.35, 3, .35, S.door, side * 19.2, 1.9, -7.4); }
      for (const side of [-1, 1]) for (const z of [-14, -4, 6]) { b.cyl(.28, 3.2, S.iron, side * 15.4, 1, z, 6); b.cyl(.55, .5, S.lava, side * 15.4, 2.8, z, 7); }
      lanternRow(placements, 14.8);
      placements.push({ asset: 'village-gate', x: 0, z: -27, y: -.4, yaw: 0, scale: 1.1, chunk: 'gate' });
    },
    sky({ low, random }) {
      const sun = glowDisc(0xff6a2a, 8, 34, 9, -74, 1), halo = glowDisc(0xff3a14, 22, 33.5, 9, -73.5, .28);
      return [sun, halo, regionPoints(low ? 120 : 260, 80, 4, 38, 0xff9a3c, 1.1, 91)];
    },
  },
  // ---- 3지역 서리 서고: 보랏빛 눈밭, 층층 도서관, 거꾸로 흐르는 책장
  archive: {
    names: ['base', 'trim', 'pale', 'lilac', 'slate', 'wood', 'bookA', 'bookB', 'bookC', 'page', 'crystal'],
    solid: [0x6f679c, 0xd2cdea, 0xe9e4fa, 0x9c90d6, 0x4a4478, 0x6a5878, 0x7a4ab0, 0x3a6fb0, 0xb04a6a], glow: [0xe6e0ff, 0xa7b8ff],
    tint: [0xd8d0ff, .55],
    build({ b, S, low, placements, random }) {
      // 층층이 쌓인 대서고와 첨탑
      [[22, 4, 11], [17, 4, 9], [12, 4, 7], [7, 4, 5]].forEach(([w, h, d], i) => { b.box(w, h, d, i % 2 ? S.lilac : S.pale, 0, 1.4 + i * 4, -35); b.box(w + .8, .45, d + .8, S.slate, 0, 3.6 + i * 4, -35); });
      b.cone(3.4, 13, S.slate, 0, 25, -35, 6); b.cyl(.2, 6, S.crystal, 0, 33, -35, 6);
      for (let row = 0; row < 4; row++) for (let i = -4; i <= 4; i++) b.box(1.4, 1.9, .12, [S.bookA, S.bookB, S.bookC][(i + row + 9) % 3], i * 2 * (1 - row * .17), 1.9 + row * 4, -29.4 + row * .8 - (row ? .0 : 0));
      // 둥근 독서탑과 서가 담장
      for (const [x, z, r, h] of [[-26, -18, 3.4, 12], [26, -18, 3.4, 11], [-30, 2, 2.6, 8], [30, 4, 2.6, 8]]) { b.cyl(r, h, S.lilac, x, h / 2 - .6, z, 12, r * .92); b.cone(r * 1.2, 3.2, S.slate, x, h + 1, z, 12); }
      const shelves = low ? 5 : 9;
      for (let i = 0; i < shelves; i++) {
        const angle = (i + .3) * Math.PI * 2 / shelves, [x, z] = ringPoint(angle, 24 + (i % 2) * 3);
        if (z < -20 && Math.abs(x) < 14) continue;
        b.box(7.4, 3.4, 1.2, S.wood, x, 1.1, z, angle + Math.PI / 2); b.box(7.4, .3, 1.5, S.slate, x, 2.9, z, angle + Math.PI / 2);
        for (let k = -3; k <= 3; k++) { const dx = k * .95 * Math.cos(angle + Math.PI / 2), dz = -k * .95 * Math.sin(angle + Math.PI / 2); b.box(.6, 2.4, .3, [S.bookA, S.bookB, S.bookC][(k + i + 6) % 3], x + dx, 1.2, z + dz, angle + Math.PI / 2); }
      }
      // 서리 낀 침엽수와 얼음 기둥
      for (let i = 0; i < (low ? 8 : 16); i++) { const angle = i * .41 + .2, [x, z] = ringPoint(angle, 36 + (i % 3) * 5); b.cone(2.3, 8 + (i % 4), S.pale, x, 3.4, z, 7); b.cone(1.5, 5, S.lilac, x, 8, z, 7); }
      // 거꾸로 흐르는 책장: 하늘로 떠오르는 책과 쪽지
      for (let i = 0; i < (low ? 16 : 30); i++) {
        const angle = i * .9, [x, z] = ringPoint(angle, 20 + (i % 5) * 4), y = 5 + (i * 7 % 17);
        b.add(new THREE.BoxGeometry(2.4, 3.2, .08), S.page, x, y, z, i * .31, angle + .5, i * .2);
        if (i % 3 === 0) b.add(new THREE.BoxGeometry(1.1, .26, .8), [S.bookA, S.bookB, S.bookC][i % 3 + (i % 2)], x + 1, y + 1.6, z, .4, angle, .5);
      }
      for (const side of [-1, 1]) for (const z of [-12, -4, 4]) placements.push({ asset: 'lantern', x: side * 16.4, z, y: -.3, scale: .92, chunk: 'lanterns' });
      placements.push({ asset: 'village-gate', x: 0, z: -27, y: -.4, scale: 1.05, chunk: 'gate' });
    },
    sky({ low }) {
      const moon = glowDisc(0xf0ecff, 4.6, -30, 38, -74, 1), halo = glowDisc(0xb4a8ff, 12, -29.5, 38, -73.5, .22);
      return [moon, halo, regionPoints(low ? 160 : 340, 84, 6, 70, 0xf2eeff, .9, 77)];
    },
  },
  // ---- 4지역 별잠 등대: 가라앉은 선단, 산호, 떠다니는 푸른 불빛
  tide: {
    names: ['base', 'trim', 'deck', 'hull', 'mast', 'sail', 'coral', 'coral2', 'rock', 'beacon', 'jelly'],
    solid: [0x2b4f58, 0x7ab8b0, 0x5a6a62, 0x2a3c44, 0x5a4a3a, 0x9fd8d0, 0x1fa3a8, 0xd9628a, 0x1e3a44], glow: [0xfff2b0, 0x6fe3d6],
    tint: [0x5ee0d0, .4],
    build({ b, S, low, placements, random }) {
      // 등대: 줄무늬 탑과 빛나는 등롱
      for (let i = 0; i < 4; i++) b.cyl(2.3 - i * .25, 3.6, i % 2 ? S.coral2 : S.sail, -30, 1.2 + i * 3.6, -26, 12, 2.05 - i * .25);
      b.cyl(2.4, .3, S.deck, -30, 15.6, -26, 12); b.cyl(1.3, 1.8, S.beacon, -30, 16.7, -26, 10); b.cone(1.9, 1.8, S.hull, -30, 18.5, -26, 10);
      b.cyl(4, 1.6, S.rock, -30, -.1, -26, 10, 3.2);
      // 가라앉은 배: 기울어진 선체와 돛대
      const wreck = (x, z, yaw, tilt, scale) => {
        b.add(new THREE.BoxGeometry(4 * scale, 2.2 * scale, 11 * scale), S.hull, x, -.2, z, tilt, yaw, tilt * .6);
        b.add(new THREE.BoxGeometry(3.4 * scale, .3, 10 * scale), S.deck, x, .9 * scale, z, tilt, yaw, tilt * .6);
        b.add(new THREE.CylinderGeometry(.18 * scale, .24 * scale, 12 * scale, 6), S.mast, x + 1.2, 6 * scale, z, tilt * .5, 0, tilt);
        b.add(new THREE.BoxGeometry(.08, 6 * scale, 3.4 * scale), S.sail, x + 1.2, 7 * scale, z + 1.2, tilt * .5, yaw, tilt);
      };
      wreck(24, -30, .5, .22, 1.1); wreck(-20, 22, -.8, -.18, 1); wreck(34, 10, 1.4, .26, .9); wreck(-38, -6, .2, -.2, 1.2);
      // 부두 길과 말뚝
      b.box(4, .3, 20, S.deck, 0, -.55, 28); for (let i = 0; i < 6; i++) for (const side of [-1, 1]) b.cyl(.16, 1.8, S.mast, side * 2.2, -.2, 20 + i * 3.4, 7);
      // 산호 첨탑과 바위
      for (let i = 0; i < (low ? 14 : 28); i++) {
        const angle = i * .57 + .3, [x, z] = ringPoint(angle, 22 + (i * 5 % 9) * 2.2);
        if (Math.abs(x) < 5.5 && z > 8) continue;
        const h = 3 + (i * 3 % 6), m = i % 3 ? S.coral : S.coral2;
        b.cone(1 + (i % 3) * .3, h, m, x, h / 2 - .8, z, 6, angle); if (i % 2) b.cone(.7, h * .7, m, x + 1.1, h * .35 - .8, z + .6, 5, angle + 1);
      }
      for (const [x, z, r, h] of [[-52, -30, 7, 9], [50, -38, 8, 11], [-46, 24, 6, 7], [44, 30, 6, 8]]) b.cone(r, h, S.rock, x, h / 2 - 1.4, z, 6, x * .1);
      // 떠다니는 푸른 해파리 등
      for (let i = 0; i < (low ? 10 : 22); i++) { const angle = i * 1.7, [x, z] = ringPoint(angle, 14 + (i % 6) * 4); b.ball(.35 + (i % 3) * .12, S.jelly, x, 4 + (i * 5 % 11), z, 1, 1.3, 1); }
      lanternRow(placements, 14.8);
      placements.push({ asset: 'village-gate', x: 0, z: -27, y: -.4, yaw: 0, scale: 1.1, chunk: 'gate' });
    },
    sky({ low }) {
      const glow = glowDisc(0x7ff6e6, 9, 28, 30, -74, .9), halo = glowDisc(0x3ac8d8, 24, 27.5, 30, -73.5, .2);
      return [glow, halo, regionPoints(low ? 140 : 300, 80, 2, 50, 0x8ff6ea, 1, 53)];
    },
  },
  // ---- 5지역 새벽 성문: 다섯 왕좌 기둥, 깨진 금빛 왕관, 새벽을 가르는 빛줄기
  crown: {
    names: ['base', 'trim', 'marble', 'dark', 'gold', 'violet', 'stone', 'beam', 'dawn'],
    solid: [0x3a2c4a, 0x8a7a2a, 0xcfc4d8, 0x2e2240, 0xf2c45c, 0x7a50a0, 0x5a4c6a], glow: [0xffe3a0, 0xffb070],
    tint: [0xc896e8, .45],
    build({ b, S, low, placements }) {
      // 다섯 왕좌 기둥이 반원으로 서고 각각 금빛 빛줄기를 올린다.
      for (let i = 0; i < 5; i++) {
        const angle = (i - 2) * .5, [x, z] = ringPoint(angle + Math.PI, -30);
        b.cyl(2.2, 1, S.stone, x, -.2, z, 10); b.cyl(1.3, 11, S.marble, x, 5.4, z, 10, 1.05); b.cyl(1.9, .6, S.gold, x, 11.2, z, 10);
        for (let k = 0; k < 6; k++) b.cone(.34, 1.7, S.gold, x + Math.cos(k * 1.047) * 1.3, 12.3, z + Math.sin(k * 1.047) * 1.3, 4);
        b.cone(.9, 44, S.beam, x, 33, z, 8);
        b.box(3.4, 1, 2.4, S.violet, x, .3, z + 3.4); b.box(2.6, 2.2, .5, S.gold, x, 1.6, z + 4.5);
      }
      // 허공에 걸린 깨진 금빛 왕관
      b.add(new THREE.TorusGeometry(10, .9, 6, 40, Math.PI * 1.65), S.gold, 0, 30, -46, Math.PI / 2 - .35, 0, .3);
      for (let k = 0; k < 7; k++) { const a = k * .72 + .4; b.cone(1, 5 + (k % 3), S.gold, Math.cos(a) * 10, 30 + 3.2 + Math.sin(a) * 4.6 * .35, -46 + Math.sin(a) * 3.2, 5); }
      // 갈라진 타일 광장 바깥 원형 문양과 낮은 성벽
      for (const r of [20, 26]) { for (let i = 0; i < 40; i++) { const a = i * Math.PI / 20; b.box(2.2, .12, .3, S.gold, Math.sin(a) * r, -.4, -Math.cos(a) * r, a); } }
      for (let i = 0; i < (low ? 8 : 14); i++) {
        const angle = (i + .5) * Math.PI * 2 / (low ? 8 : 14), [x, z] = ringPoint(angle, 36 + (i % 2) * 4), h = 5 + (i * 3 % 7);
        if (z < -26 && Math.abs(x) < 24) continue;
        b.box(3.4, h, 3.4, S.dark, x, h / 2 - .6, z, angle); b.box(4, .5, 4, S.stone, x, h - .4, z, angle); if (i % 2) b.cone(2.6, 3, S.violet, x, h + 1.2, z, 4, angle + Math.PI / 4);
      }
      lanternRow(placements, 14.8);
      placements.push({ asset: 'village-gate', x: 0, z: -27, y: -.4, yaw: 0, scale: 1.15, chunk: 'gate' });
    },
    sky({ low }) {
      const dawn = glowDisc(0xffb070, 16, -26, 3, -76, 1), halo = glowDisc(0xff8a58, 38, -25.5, 3, -75.5, .22);
      return [dawn, halo, regionPoints(low ? 160 : 320, 86, 10, 72, 0xffe9c0, .9, 61)];
    },
  },
  // ---- 6지역 함께 잇는 귀환로: 햇살 들판, 둥근 돌다리, 깃발 줄, 따뜻한 집들
  homeward: {
    names: ['base', 'trim', 'wallA', 'wallB', 'roofA', 'roofB', 'wood', 'stone', 'green', 'flagA', 'flagB', 'flagC', 'window'],
    solid: [0x7f8f66, 0xb8b4a0, 0xf1e6cc, 0xd9b98a, 0xc65a3b, 0x4f7fb0, 0x7b5a3c, 0xb8b4a0, 0x4f8a4a], glow: [0xff6b6b, 0x6bb5ff, 0xffd36b, 0xffe9a8],
    tint: null,
    build({ b, S, low, placements }) {
      // 완만한 언덕과 돌다리
      for (const [x, z, sx, sy, sz] of [[-34, -20, 18, 4.4, 12], [32, -26, 16, 5, 13], [-8, -46, 24, 6, 12], [50, 6, 14, 3.4, 12], [-48, 14, 14, 3.4, 12], [10, 44, 18, 3, 10]]) b.ball(1, S.green, x, -1.6, z, sx, sy, sz);
      b.add(new THREE.TorusGeometry(9, .7, 6, 24, Math.PI), S.stone, 0, -3, -27, 0, 0, 0); b.box(19, .5, 4.4, S.stone, 0, 6.1, -27); b.box(19, 1.1, .4, S.trim, 0, 6.9, -25); b.box(19, 1.1, .4, S.trim, 0, 6.9, -29);
      b.box(4.4, .4, 14, S.stone, 0, -.6, -19.5);
      // 귀환 마을의 따뜻한 집들
      const houses = low ? 7 : 12;
      for (let i = 0; i < houses; i++) {
        const angle = (i + .4) * Math.PI * 2 / houses + .1, [x, z] = ringPoint(angle, 25 + (i % 3) * 2.6);
        if (z < -18 && Math.abs(x) < 7) continue;
        regionHouse(b, { x, z, w: 5 + (i % 2), h: 3 + (i % 3) * .5, d: 4.6, wall: i % 2 ? S.wallA : S.wallB, roof: i % 3 ? S.roofA : S.roofB, trim: S.wood, glow: S.window, door: S.wood, yaw: angle + Math.PI, roofH: 2.8 });
      }
      // 깃발 줄: 등불 기둥 사이에 색색 깃발
      for (const side of [-1, 1]) {
        for (const z of [-14, -8, -2, 4, 10]) b.cyl(.15, 3.6, S.wood, side * 14.8, 1.2, z, 6);
        for (let z = -14; z < 10; z += 1.2) b.box(.06, .6, .5, [S.flagA, S.flagB, S.flagC][Math.floor((z + 14) / 1.2) % 3], side * 14.8, 2.7 - Math.sin((z + 14) / 24 * Math.PI) * .15, z + .6);
      }
      // 낮은 구름
      for (let i = 0; i < 9; i++) { const angle = i * .75, [x, z] = ringPoint(angle, 60); b.ball(1, S.wallA, x, 30 + (i % 3) * 3, z, 9, 2, 5); }
      for (let i = 0; i < (low ? 14 : 28); i++) { const angle = i * .43 + .2, r = 36 + (i % 4) * 5, [x, z] = ringPoint(angle, r); placements.push({ asset: i % 3 ? 'broadleaf-tree' : 'evergreen-tree', x, z, y: -.55, yaw: angle, scale: .85 + (i % 4) * .12, chunk: 'trees-' + (i % 4) }); }
      for (const side of [-1, 1]) for (const z of [-14, -8, -2, 4, 10]) placements.push({ asset: 'lantern', x: side * 13.7, z, y: -.3, scale: .95, chunk: 'lanterns' });
      placements.push({ asset: 'village-gate', x: 0, z: -34, y: -.4, yaw: 0, scale: 1.1, chunk: 'gate' });
    },
    sky() {
      const sun = glowDisc(0xfff0b8, 6.5, -30, 16, -72, 1), halo = glowDisc(0xffd78a, 24, -29.5, 16, -71.5, .28);
      return [sun, halo];
    },
  },
  // ---- 7지역 금 간 종탑의 도시: 석회 몸체와 청동 종루, 금 간 대종, 낮게 깔린 안개
  belltower: {
    names: ['base', 'trim', 'lime', 'limeDark', 'bronze', 'slate', 'wood', 'crack', 'window', 'mote'],
    solid: [0x6b665a, 0x9a937f, 0xc9c1ab, 0x8b8472, 0x8a6a3c, 0x464a52, 0x5a4a3a, 0x1c1a1e], glow: [0xe0c68c, 0xc9d6d2],
    tint: [0xd8d0b8, .45],
    build({ b, S, low, placements }) {
      // 뒤편 대종탑: 석회 몸체, 슬레이트 뾰족지붕, 열린 종루와 금 간 대종
      b.box(9, 24, 9, S.lime, 0, 11.4, -38); b.box(10.4, .8, 10.4, S.trim, 0, 6, -38); b.box(10.4, .8, 10.4, S.trim, 0, 23.8, -38);
      b.cone(6.8, 9, S.slate, 0, 28.7, -38, 4, Math.PI / 4);
      b.box(5, 6.4, .3, S.crack, 0, 18, -33.4); b.box(5.6, .5, .6, S.bronze, 0, 21.4, -33.3);
      b.cyl(2.4, 4.2, S.bronze, 0, 17.2, -32.6, 14, 1.1); b.cyl(2.7, .5, S.bronze, 0, 14.9, -32.6, 14); b.ball(.5, S.bronze, 0, 14.4, -32.6);
      b.box(.16, 3.4, .08, S.crack, .6, 17.2, -31.4, .12);
      // 가운데 광장 바닥의 깨진 종 파편 고리
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6, [x, z] = ringPoint(a, 9); b.box(1.6, .16, .5, i % 3 ? S.trim : S.bronze, x, -.45, z, a); }
      // 종탑 마을의 석회 집들
      const houses = low ? 7 : 11;
      for (let i = 0; i < houses; i++) {
        const angle = (i + .45) * Math.PI * 2 / houses + .12, [x, z] = ringPoint(angle, 24 + (i % 3) * 3);
        if (z < -20 && Math.abs(x) < 9) continue;
        regionHouse(b, { x, z, w: 5 + (i % 2), h: 3.4 + (i % 3) * .6, d: 4.8, wall: i % 2 ? S.lime : S.limeDark, roof: S.slate, trim: S.bronze, glow: S.window, door: S.wood, yaw: angle + Math.PI, roofH: 3 });
        if (i % 4 === 0) { b.cyl(.35, 7, S.lime, x + 1.4, 3.6, z, 8, .28); b.cone(.8, 1.6, S.slate, x + 1.4, 7.9, z, 4, Math.PI / 4); }
      }
      // 광장 좌우의 작은 종 기둥
      for (const side of [-1, 1]) for (const z of [-12, -2, 8]) { b.cyl(.2, 3.6, S.wood, side * 15.2, 1.2, z, 6); b.cone(.65, .9, S.bronze, side * 15.2, 3.4, z, 10); b.ball(.14, S.window, side * 15.2, 2.8, z); }
      // 낮게 깔린 안개 덩어리
      for (let i = 0; i < 10; i++) { const angle = i * .66, [x, z] = ringPoint(angle, 44 + (i % 3) * 8); b.ball(1, S.limeDark, x, 1.2 + (i % 2), z, 11, 1.1, 6); }
      lanternRow(placements, 14.8);
      placements.push({ asset: 'village-gate', x: 0, z: -27, y: -.4, yaw: 0, scale: 1.1, chunk: 'gate' });
    },
    sky({ low }) {
      const sun = glowDisc(0xe8e0c8, 5.5, -28, 15, -74, .75), halo = glowDisc(0xcfd6d2, 22, -27.5, 15, -73.5, .2);
      return [sun, halo, regionPoints(low ? 100 : 200, 70, 1, 18, 0xcfd6d2, 1.3, 77)];
    },
  },
};
