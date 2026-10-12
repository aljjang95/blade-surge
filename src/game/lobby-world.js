import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildEnvironmentInstances } from '../engine/environment-kit-asset.js';
/** Original, runtime-authored citadel surroundings. Six static batches, no textures,
 * lights, particle emitters or combat navigation changes. */
/** @param {{ quality?: string, townId?: string | null }} [options] */
export function buildLobbyWorld({ quality = 'high', townId = null } = {}) {
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
 for(const z of [15,24,33]){arch(0,z,6.8,4.2);for(const side of [-1,1]){col(.7,6,0,side*4,2.4,z,8);col(.85,.22,1,side*4,5.5,z,8);add(new THREE.ConeGeometry(.95,1.7,8),2,side*4,6.4,z);}}
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
