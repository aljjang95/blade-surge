import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyDungeonStoneDetail, applySurfaceDetail } from '../engine/surface-textures.js';
import { GARDEN_MASTERY } from '../data/garden-mastery.js';

const PALETTES = {
  crypt: [0x8e98ae, 0x938269, 0x749ebd],
  throne: [0xab9480, 0xc6a061, 0xd9a26f],
  abyss: [0x817a98, 0xa497b7, 0x9c85cf],
  garden: [0x7f9690, 0xb39156, 0x7fb8a0],
  forge: [0x353a42, 0xa78556, 0xff7638],
  frost: [0x788caa, 0xc6c9d5, 0x86d9eb],
  tide: [0x46666d, 0xc1a569, 0x74cbd0],
  crown: [0xafa698, 0xcfad62, 0xffd9a2],
};

// 연결된 이웃 중 한 매크로 셀 폭만 묶어 층 전체가 하나의 컬링 구가 되지 않게 한다.
function architectureBatches(floor) {
  const remaining = new Set(floor.rooms), batches = [];
  const [spacingX, spacingZ] = floor.layout?.spacing || [34, 34];
  for (const room of floor.rooms) {
    if (!remaining.has(room)) continue;
    const rooms = [room]; remaining.delete(room);
    while (rooms.length < 3) {
      const next = floor.rooms.find(candidate => {
        if (!remaining.has(candidate)) return false;
        const adjacent = rooms.some(member =>
          ((member.links || []).includes(candidate.id) || (candidate.links || []).includes(member.id))
          && Math.abs(member.gx - candidate.gx) + Math.abs(member.gy - candidate.gy) === 1);
        if (!adjacent) return false;
        const members = [...rooms, candidate];
        const span = key => Math.max(...members.map(member => member[key])) - Math.min(...members.map(member => member[key]));
        return span('gx') <= 1 && span('gy') <= 1
          && span('x') <= spacingX + 6 && span('z') <= spacingZ + 6;
      });
      if (!next) break;
      rooms.push(next); remaining.delete(next);
    }
    batches.push({ rooms, chunks: [[], [], []], ranges: [[], [], []], vertices: [0, 0, 0] });
  }
  return batches;
}

/** 지역 건축은 가까운 방의 같은 재질·그림자끼리 병합하고 소유 자원만 회수한다. */
export function buildRegionArchitecture(floor, theme) {
  const group = new THREE.Group(); group.name = `region-${theme}`;
  const colors = PALETTES[theme];
  const ownedGeometry = [], materials = [];
  let disposed = false;
  group.userData.dispose = () => {
    if (disposed) return;
    disposed = true;
    group.removeFromParent();
    for (const geometry of ownedGeometry) geometry.dispose();
    for (const material of materials) material.dispose();
  };
  if (!colors) return group;
  materials.push(
    new THREE.MeshStandardMaterial({ color: colors[0], roughness: .78, metalness: .12, vertexColors: true }),
    new THREE.MeshStandardMaterial({ color: colors[1], roughness: .36, metalness: .72 }),
    new THREE.MeshStandardMaterial({ color: colors[2], emissive: colors[2], emissiveIntensity: .42, roughness: .4, metalness: .2 }),
  );
  applyDungeonStoneDetail(materials[0]); applySurfaceDetail(materials[1], 'metal');
  group.userData.landmarks = [];
  const batches = architectureBatches(floor), roomBatches = new Map();
  group.userData.architectureBatches = batches.map((batch, batchId) => {
    for (const room of batch.rooms) roomBatches.set(room, batchId);
    return { batchId, roomIds: batch.rooms.map(room => room.id) };
  });
  group.userData.roomGeometry = [];
  for (const room of floor.rooms) {
    const chunks = [[], [], []];
    const loopThreshold = theme === 'garden' && floor.rooms.length === 5 && [2,3].includes(room.id)
      && floor.rooms[2].type === 'treasure' && floor.rooms[3].type === 'normal'
      && floor.rooms[2].links?.includes(3) && floor.rooms[3].links?.includes(2) && floor.mask;
    const neighbors = (room.links || []).map((id) => floor.rooms[id]);
    const sideOccupied = (sx, sz) => neighbors.some((n) => sx ? Math.sign(n.gx-room.gx)===sx && n.gy===room.gy : Math.sign(n.gy-room.gy)===sz && n.gx===room.gx);
    // 중앙 후면 랜드마크는 복도 없는 면으로 돌린다. 통로 4개가 만나는 교차실은 바닥 문양만 유지한다.
    const freeSide = [[0,-1],[-1,0],[1,0],[0,1]].find(([sx,sz]) => !sideOccupied(sx,sz));
    const landmarkRotation = freeSide ? Math.atan2(-freeSide[0],-freeSide[1]) : 0;
    const landmark = (geometry, material, x, y, z, rx=0, ry=0, rz=0) => {
      if (!freeSide) { geometry.dispose(); return; }
      const dx=x-room.x, dz=z-room.z;
      // 직사각형 방의 반폭 차이를 보정하여 벽 바깥 거리를 유지한다.
      const distance=room.h/2+2.2;
      const targetDistance=(freeSide[0] ? room.w/2 : room.h/2)+2.2;
      const factor=targetDistance/distance;
      const c=Math.cos(landmarkRotation), s=Math.sin(landmarkRotation);
      add(geometry,material,room.x+dx*c+dz*s*factor,y,room.z-dx*s+dz*c*factor,rx,ry+landmarkRotation,rz);
    };
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
    const position = new THREE.Vector3(), scale = new THREE.Vector3(1, 1, 1);
    let buildingLandmark = false;
    const add = (geometry, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
      if (buildingLandmark) {
        buildingLandmark=false;
        landmark(geometry,material,x,y,z,rx,ry,rz);
        buildingLandmark=true;
        return;
      }
      rotation.setFromEuler(new THREE.Euler(rx, ry, rz));
      matrix.compose(position.set(x, y, z), rotation, scale);
      geometry.applyMatrix4(matrix);
      if (loopThreshold) {
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox;
        if (bounds.max.y > .2) {
          // 새 회랑 양끝의 높은 장식은 중심점 대신 전체 바닥 면적과 실제 마스크 셀을 대조한다.
          const x0 = Math.max(0, Math.floor(bounds.min.x - floor.minX));
          const x1 = Math.min(floor.cols - 1, Math.floor(bounds.max.x - floor.minX));
          const z0 = Math.max(0, Math.floor(bounds.min.z - floor.minZ));
          const z1 = Math.min(floor.rows - 1, Math.floor(bounds.max.z - floor.minZ));
          let intersects = false;
          for (let row = z0; row <= z1 && !intersects; row++)
            for (let col = x0; col <= x1; col++) if (floor.mask[row * floor.cols + col]) { intersects = true; break; }
          if (intersects) { geometry.dispose(); return; }
        }
      }
      if (material === 0 && !geometry.getAttribute('color')) {
        const values = new Float32Array(geometry.getAttribute('position').count * 3).fill(1);
        geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
      }
      const flat = geometry.index ? geometry.toNonIndexed() : geometry;
      if (flat !== geometry) geometry.dispose();
      chunks[material].push(flat);
    };
    const box = (x,y,z,w,h,d,m=0,ry=0,rz=0) => add(new THREE.BoxGeometry(w,y < .2 ? Math.min(h,.04) : h,d),m,x,y < .2 ? .055 : y,z,0,ry,rz);
    const cylinder = (x,y,z,top,bottom,h,m=0,segments=12) => add(new THREE.CylinderGeometry(top,bottom,h,segments),m,x,y,z);
    const ring = (x,y,z,r,t,m=1,rx=Math.PI/2,ry=0) => add(y < .2 ? new THREE.RingGeometry(r-t,r+t,48) : new THREE.TorusGeometry(r,t,5,40),m,x,y < .2 ? .065 : y,z,y < .2 ? -Math.PI/2 : rx,ry);
    const x = room.x, z = room.z, hw = room.w/2, hh = room.h/2;
    // 높은 구조물은 후면 외곽에 둬 중앙 전투 공간과 입구를 비운다.
    const rear = z - hh - 2.2;
    const crownRoom = room.type === 'boss';
    const height = crownRoom ? 1.2 : 1;
    const tower = ['crypt','throne','abyss'].includes(theme);
    if (tower) {
      // A wall niche, not loose props: paired piers, capitals, recessed effigy and cornice.
      // Rotate the entire structure onto a disconnected wall; crossing rooms retain only floor work.
      buildingLandmark=true;
      const span = crownRoom ? 4.2 : 3.2;
      box(x,.38,rear,span*2+1.4,.75,2.8);
      for (const side of [-1,1]) {
        const px=x+side*span;
        box(px,2.4,rear,.75,4.8,1.5);
        box(px,.75,rear,1.1,.28,1.8,1);
        box(px,4.75,rear,1.15,.28,1.85,1);
        box(px,2.65,rear+.8,.18,2.8,.08,1);
      }
      box(x,5.05,rear,span*2+1.5,.35,1.9,1);
      box(x,5.36,rear,span*2+1,.25,1.55);
      if(theme==='crypt') {
        // Hooded custodian relief, robe, shoulders, face and a vertical staff.
        cylinder(x,1.85,rear,.34,.94,2.5,0,8);
        box(x,2.78,rear,1.5,.48,.72);
        add(new THREE.SphereGeometry(.33,8,6),1,x,3.32,rear+.2);
        add(new THREE.ConeGeometry(.55,.9,8),0,x,3.62,rear-.05);
        cylinder(x+1.06,2.4,rear+.35,.065,.065,3.5,1,6);
        ring(x+1.06,4.15,rear+.35,.24,.06,1,0);
      } else if(theme==='throne') {
        // Ceremonial high-backed seat with stepped arms and three heraldic teeth.
        box(x,1.3,rear,2.2,.4,1.7,1);
        box(x,2.5,rear-.5,2.1,2.6,.35);
        for(const side of [-1,1]) box(x+side*1.1,1.8,rear,.32,1.1,1.8,1);
        for(let i=-1;i<=1;i++) add(new THREE.ConeGeometry(.38,.9,4),1,x+i*.75,4.13,rear-.5,0,Math.PI/4);
      } else {
        // Split celestial dial held by an architectural cradle; no floating clutter.
        cylinder(x,1.1,rear,.55,.9,1.4);
        ring(x,2.9,rear,1.35,.14,1,0);
        ring(x,2.9,rear,1.02,.07,2,0);
        box(x,2.9,rear,.12,2.5,.14,1,0,.6);
        box(x,2.9,rear,2.5,.12,.14,1,0,.6);
      }
      buildingLandmark=false;
    } else if (theme === 'garden') {
      for (const side of [-1,1]) {
        const px = x + side*(hw-2.5);
        box(px, .3, rear, 4, .6, 4);
        for (const dx of [-1.2,1.2]) {
          cylinder(px+dx, 2.9*height, rear, .28, .42, 5.8*height);
          cylinder(px+dx, 5.6*height, rear, .52, .52, .28, 1);
        }
        // 종탑의 종과 반원 아치.
        add(new THREE.TorusGeometry(1.2,.22,6,20,Math.PI),0,px,5.4*height,rear);
        cylinder(px,4.3*height,rear,.35,.83,1.3,1);
        cylinder(px,3.58*height,rear,.89,.89,.13,1);
        for (let i=0;i<5;i++) add(new THREE.IcosahedronGeometry(.48,0),2,px+Math.sin(i*2)*.9,1+i*.55,rear+.5);
        box(x+side*(hw+1.5),.2,z,1.6,.4,Math.max(6,room.h-10));
      }
    } else if (theme === 'forge') {
      for (const side of [-1,1]) {
        const px=x+side*(hw-2);
        box(px,1.6,rear,3.6,3.2,3.4);
        cylinder(px,3.8,rear,1.3,1.6,1.2,1);
        cylinder(px,4.3,rear,1.16,1.16,.12,2);
        cylinder(px,6.3*height,rear+.8,.7,1.1,4*height);
        for(let i=0;i<3;i++) cylinder(px,5+i*1.3,rear+.8,.82,.82,.18,1);
        // 측면 냉각수로와 금속 교량 리벳. 중앙 이동 영역을 비운다.
        box(x+side*(hw+1.4),.08,z,1.8,.1,room.h,2);
        for(let i=-2;i<=2;i++) box(x+side*(hw+1.4),.24,z+i*3,2.3,.18,.32,1);
        box(px,5.3,rear,1, .35,6,1,0,side*.16);
      }
      for(const side of [-1,1]) box(x+side*(hw-1),.07,z,.16,.05,room.h-4,1);
      for(let i=-2;i<=2;i++) box(x+i*2,.08,z-hh+2,1.1,.04,.22,2);
    } else if (theme === 'frost') {
      for(const side of [-1,1]) {
        const px=x+side*(hw+1);
        for(let b=0;b<3;b++) {
          const pz=z+(b-1)*5;
          if (b===1 && sideOccupied(side,0)) continue;
          box(px,2.8,pz,1.4,5.6,3.7);
          for(let shelf=0;shelf<4;shelf++) {
            box(px-side*.5,1+shelf*1.1,pz,1.2,.13,3.9,1);
            for(let book=0;book<5;book++) box(px-side*.74,1.44+shelf*1.1,pz-1.35+book*.65,.45,.67+(book%2)*.13,.4,book%3===0?2:1);
          }
        }
      }
      // 뒤집힌 기록고는 전투 공간 밖의 높은 후면에 매단다.
      buildingLandmark=true;
      box(x,6.9*height,rear,8,.5,2.6,1);
      for(let i=-2;i<=2;i++) {
        box(x+i*1.45,5.5*height,rear,.55,2.2,1.8);
        add(new THREE.ConeGeometry(.8,2.9,5),2,x+i*1.6,1.6,rear+1,0,0,i*.2);
      }
      buildingLandmark=false;
      for(const side of [-1,1]) box(x+side*(hw-2),.085,z,.1,.04,room.h-3,2);
    } else if (theme === 'tide') {
      // 천문 관측기의 교차 고리: 바닥 외곽에서 하늘을 향한 명확한 실루엣.
      buildingLandmark=true;
      cylinder(x,.5,rear,3.4,4,.9);
      cylinder(x,2.3,rear,.45,.8,3.4,1);
      ring(x,4.8*height,rear,3.1,.13,1,0);
      ring(x,4.8*height,rear,2.6,.12,1,0,Math.PI/2);
      ring(x,4.8*height,rear,2.9,.07,2,Math.PI/3,Math.PI/4);
      add(new THREE.IcosahedronGeometry(.68,1),2,x,4.8*height,rear);
      buildingLandmark=false;
      for(const side of [-1,1]) {
        box(x+side*(hw+1.9),-.05,z,2.5,.16,room.h,2);
        for(let i=-1;i<=1;i++) {
          if (i===0 && sideOccupied(side,0)) continue;
          cylinder(x+side*(hw+1.9),1,z+i*5,.34,.58,2,1);
          add(new THREE.OctahedronGeometry(.48),2,x+side*(hw+1.9),2.3,z+i*5);
        }
      }
    } else if (theme === 'crown') {
      // 바닥과 떨어진 제단 위의 왕관 파편. 앞쪽 화면을 덮는 천장은 사용하지 않는다.
      buildingLandmark=true;
      box(x,1.3,rear,9,.6,3.2);
      box(x,1.65,rear,8,.14,2.7,1);
      for(let i=-2;i<=2;i++) {
        box(x+i*1.7,3.1+Math.abs(i)*.22,rear,.68,2.7,1,1,0,i*.15);
        add(new THREE.ConeGeometry(.6,1.3,4),1,x+i*1.9,5+Math.abs(i)*.22,rear,0,Math.PI/4,i*.16);
      }
      buildingLandmark=false;
      for(const side of [-1,1]) {
        const px=x+side*(hw+1.2);
        for(const depth of [-.55,.55]) {
          cylinder(px,3.8,z+hh*depth,.4,.65,7.6);
          cylinder(px,7.5,z+hh*depth,.8,.8,.25,1);
        }
        box(px,6.6,z, .3,.4,room.h*.6,1);
      }
    }
    // 전투 카메라 안에서 읽히는 얕은 바닥 건축. 위험 표시(.11) 아래에 모두 둔다.
    // 별도 메시 없이 기존 재질에 병합하고 중앙 통행은 그대로 유지한다.
    let inlayLayer = 0;
    const inlay = (geometry, px, pz, color=0x28313b, ry=0, y=null) => {
      const rgb=new THREE.Color(color), values=new Float32Array(geometry.getAttribute('position').count*3);
      for(let i=0;i<values.length;i+=3) { values[i]=rgb.r; values[i+1]=rgb.g; values[i+2]=rgb.b; }
      geometry.setAttribute('color',new THREE.BufferAttribute(values,3));
      // 기존 타일 윗면(.04997) 위, 금속 테두리(.065)와 위험 표시(.11) 아래.
      add(geometry,0,px,y ?? .052 + inlayLayer++ * .00035,pz,-Math.PI/2,0,ry);
    };
    const slab = (px,pz,w,d,color,ry=0,y=null) => inlay(new THREE.PlaneGeometry(w,d),px,pz,color,ry,y);
    // 실제 회랑과 맞닿은 문턱만 길을 표시한다. 장식 원반은 전투 중심을 비운다.
    const dark = theme === 'garden' ? 0x344d45 : theme === 'forge' ? 0x273239
      : theme === 'frost' ? 0x425b73 : theme === 'tide' ? 0x2b525d
      : theme === 'crown' ? 0x534c59 : theme === 'throne' ? 0x59463e
      : theme === 'abyss' ? 0x423b58 : 0x404a60;
    const pale = theme === 'garden' ? 0xc5c5a9 : theme === 'forge' ? 0x9aa49e
      : theme === 'frost' ? 0xabc4ce : theme === 'tide' ? 0x9abfba
      : theme === 'crown' ? 0xc0b398 : theme === 'throne' ? 0xac9575
      : theme === 'abyss' ? 0xaaa2be : 0x9daab8;
    // 양쪽 가장자리는 얕은 석재 보행 띠다. 별도 재질이나 이동 마스크를 만들지 않는다.
    // 정원의 평면 모서리 장식은 석재 배치에 넣어 금속 랜드마크의 컬링/그림자 범위를 넓히지 않는다.
    // 기존 금속 알베도를 석재 기본색으로 나눠 같은 황동/밝은 색 의도를 보존한다.
    const cornerColor = new THREE.Color(colors[1]), stoneColor = materials[0].color;
    cornerColor.r /= Math.max(.01,stoneColor.r);
    cornerColor.g /= Math.max(.01,stoneColor.g);
    cornerColor.b /= Math.max(.01,stoneColor.b);
    for (const side of [-1,1]) {
      slab(x + side * (hw - 1.5), z, .55, room.h - 2.1, dark);
      slab(x, z + side * (hh - 1.5), room.w - 2.1, .55, dark);
      for (const corner of [-1,1]) {
        if (theme === 'garden') {
          slab(x + side * (hw - 1.5), z + corner * (hh - 1.5), .08, .8, cornerColor, 0, .065);
          slab(x + side * (hw - 1.5), z + corner * (hh - 1.5), .8, .08, cornerColor, 0, .065);
        } else {
          box(x + side * (hw - 1.5), .055, z + corner * (hh - 1.5), .08, .02, .8, 1);
          box(x + side * (hw - 1.5), .055, z + corner * (hh - 1.5), .8, .02, .08, 1);
        }
      }
    }
    const sills = new Set();
    for (const corridor of floor.corridors || []) for (const axis of ['x','z']) for (const side of [-1,1]) {
      const edge = axis === 'x' ? x + side * hw : z + side * hh;
      const c = axis === 'x' ? corridor.x : corridor.z;
      const half = (axis === 'x' ? corridor.w : corridor.h) / 2;
      if (c - half >= edge || c + half <= edge) continue;
      const cross = axis === 'x' ? corridor.z : corridor.x;
      const crossHalf = (axis === 'x' ? corridor.h : corridor.w) / 2;
      const center = axis === 'x' ? z : x, roomHalf = axis === 'x' ? hh : hw;
      const lo = Math.max(cross - crossHalf, center - roomHalf + .5);
      const hi = Math.min(cross + crossHalf, center + roomHalf - .5);
      if (hi - lo < 1) continue;
      const key = `${axis}:${side}:${lo.toFixed(1)}:${hi.toFixed(1)}`;
      if (sills.has(key)) continue;
      sills.add(key);
      const mid = (lo + hi) / 2;
      const along = Math.min(axis === 'x' ? hw - 3.2 : hh - 3.2, 6);
      const stripeWidth = Math.min(2.35, hi - lo - .5);
      // 문턱의 실제 폭과 L자 회랑의 어긋난 입구 위치를 보존한다.
      slab(axis === 'x' ? edge : mid, axis === 'x' ? mid : edge,
        axis === 'x' ? 1.05 : hi - lo, axis === 'x' ? hi - lo : 1.05, pale);
      if (along > .5 && stripeWidth > .5) {
        const into = edge - side * (along / 2 + .7);
        slab(axis === 'x' ? into : mid, axis === 'x' ? mid : into,
          axis === 'x' ? along : stripeWidth, axis === 'x' ? stripeWidth : along,
          theme === 'garden' ? 0x98a79b : dark);
      }
      // 입구 양옆의 표식은 방 역할을 나타내며 중앙 발밑을 덮지 않는다.
      const role = room.type, count = role === 'boss' ? 3 : role === 'elite' ? 2 : 1;
      for (const wing of [-1,1]) for (let mark = 0; mark < count; mark++) {
        const inward = edge - side * (1.9 + mark * .62);
        const across = mid + wing * Math.min((hi - lo) / 2 + .42, roomHalf - .9);
        if (Math.abs(across - center) > roomHalf - .4) continue;
        const px = axis === 'x' ? inward : across, pz = axis === 'x' ? across : inward;
        const diamond = role === 'treasure';
        slab(px, pz, diamond ? .64 : axis === 'x' ? .23 : .64,
          diamond ? .64 : axis === 'x' ? .64 : .23, pale, diamond ? Math.PI / 4 : 0);
      }
      if (room.type === 'start') {
        const inward = edge - side * 2;
        slab(axis === 'x' ? inward : mid, axis === 'x' ? mid : inward,
          axis === 'x' ? .15 : stripeWidth, axis === 'x' ? stripeWidth : .15, pale);
      }
    }
    if (theme === 'garden') {
      // 네 외곽 정원 패널과 잎의 큰 면: 두꺼운 검은 원반 대신 비워 둔 옥빛 중정.
      for (const sx of [-1,1]) for (const sz of [-1,1]) {
        const px = x + sx * (hw - 3.2), pz = z + sz * (hh - 3.2);
        slab(px, pz, 2.6, 1.9, dark);
        slab(px, pz, .8, 1.35, pale, sx * sz * Math.PI / 4);
        slab(px + sx * .55, pz + sz * .25, .42, .85, 0x829b84, sx * sz * Math.PI / 4);
      }
      if (room.gardenMastery?.version === GARDEN_MASTERY.version) {
        // 열린 하단의 두 대각선을 얕은 이음선으로 읽힌다. 기존 석재 배치에 병합한다.
        // 예고가 덮은 순간에는 안전한 길이 아니다. 물리 마스크와 조작판은 그대로 둔다.
        for (const path of room.gardenMastery.diagonals) {
          const dx = path.toX - path.fromX, dz = path.toZ - path.fromZ, length = Math.hypot(dx, dz);
          const rotation = -Math.atan2(dz, dx);
          slab((path.fromX + path.toX) / 2, (path.fromZ + path.toZ) / 2, length, .12, 0x9aab9d, rotation);
          slab(path.toX, path.toZ, .65, .12, pale, rotation + Math.PI / 2);
        }
      }
    } else if (theme === 'forge') {
      // 냉각 격자는 양쪽 가장자리로 밀어 근접 전투와 위험 예고의 중앙을 비운다.
      for (const side of [-1,1]) {
        const px = x + side * (hw - 3.25);
        slab(px,z,1.6,Math.max(4,room.h - 8),dark);
        for (let dz = -hh + 4; dz <= hh - 4; dz += 1.8)
          slab(px,z + dz,1.5,.13,pale);
      }
    } else if (theme === 'frost') {
      for (const sx of [-1,1]) for (const sz of [-1,1]) {
        const px = x + sx * (hw - 3), pz = z + sz * (hh - 3);
        slab(px,pz,1.7,.16,pale,Math.PI / 4);
        slab(px,pz,1.7,.16,pale,-Math.PI / 4);
      }
    } else if (theme === 'tide') {
      for (const side of [-1,1]) {
        const px = x + side * (hw - 3);
        slab(px,z,.65,room.h - 7,dark);
        for (let dz = -hh + 4; dz < hh - 3; dz += 2.2) slab(px,z + dz,.6,.10,pale);
      }
    } else if (theme === 'crown' || tower) {
      for (const sx of [-1,1]) for (const sz of [-1,1]) {
        const px = x + sx * (hw - 2.6), pz = z + sz * (hh - 2.6);
        slab(px,pz,.9,.9,dark,Math.PI / 4);
        if (room.type === 'boss' || room.type === 'treasure') slab(px,pz,.36,.36,pale,Math.PI / 4);
      }
    }
    group.userData.roomDetails ||= [];
    group.userData.roomDetails.push({ roomId: room.id, theme, role: room.type, thresholds: sills.size, landmark: !!freeSide, centerClear: true });
    // Story structures are wall-mounted outside the playable rectangles. They add no hidden
    // collision: room/corridor rectangles remain the single map and AUTO authority.
    if (room.landmark && freeSide && ['start','elite','boss'].includes(room.type)) {
      buildingLandmark = true;
      const mark = room.landmark;
      if (mark === 'memorial') {
        for (let i=-2;i<=2;i++) {
          box(x+i*1.5,1.5,rear,1.05,3,.42);
          box(x+i*1.5,2.1,rear+.26,.12,.8,.08,2);
          box(x+i*1.5,1.6,rear+.26,.54,.09,.08,1);
        }
        box(x,.2,rear,9,.4,2,1);
      } else if (mark === 'kiln') {
        for (const side of [-1,1]) {
          cylinder(x+side*2.8,2.2,rear,1.1,1.5,4.4,0,8);
          ring(x+side*2.8,3.9,rear,1.18,.13,2);
          box(x+side*2.8,1.6,rear+1.3,1.3,1.5,.12,2);
        }
        box(x,4.4,rear,8,.4,.7,1);
      } else if (mark === 'archive') {
        for(let i=-1;i<=1;i++) {
          box(x+i*2.5,2.4,rear,2.1,4.8,.6);
          for(let shelf=1;shelf<=4;shelf++) {
            box(x+i*2.5,shelf,rear+.5,2.2,.12,.9,1);
            for(let book=0;book<4;book++) box(x+i*2.5-.7+book*.45,shelf+.35,rear+.5,.22,.58,.42,book%2+1);
          }
        }
      } else if (mark === 'beacon') {
        cylinder(x,2.8,rear,1,1.8,5.6,0,12);
        cylinder(x,5.8,rear,1.5,1.5,.35,1,12);
        cylinder(x,6.6,rear,.7,.7,1.3,2,8);
        add(new THREE.ConeGeometry(1.5,1.1,12),1,x,7.8,rear);
        for(const side of [-1,1]) box(x+side*3,1,rear,2,.35,2,1);
      } else if (mark === 'tribunal') {
        for(const side of [-1,1]) {
          cylinder(x+side*3.2,2.4,rear,.45,.6,4.8,0,8);
          box(x+side*3.2,4.9,rear,1.2,.3,1.2,1);
        }
        box(x,5.2,rear,8,.35,1.3,1);
        ring(x,3.3,rear,1.3,.1,2,0);
        box(x,1.1,rear,2.6,.5,1.6,1);
      } else if (mark === 'confluence') {
        for(let i=-1;i<=1;i++) {
          add(new THREE.TorusGeometry(1,.16,6,18,Math.PI),1,x+i*2.6,3.2,rear);
          for(const side of [-1,1]) box(x+i*2.6+side,1.6,rear,.25,3.2,.6);
          box(x+i*2.6,.22,rear,1.5,.15,2.2,2);
        }
        box(x,4.5,rear,8.5,.5,1,1);
      }
      buildingLandmark = false;
    }
    const batchId = roomBatches.get(room), batch = batches[batchId];
    for (let i = 0; i < chunks.length; i++) {
      if (!chunks[i].length) continue;
      const count = chunks[i].reduce((sum, part) => sum + part.getAttribute('position').count, 0);
      // 원래 방의 정점 순서를 유지해 디버그·통로 검사가 이웃 방을 포함하지 않게 한다.
      const range = { roomId: room.id, materialRole: i, batchId, start: batch.vertices[i], count };
      batch.ranges[i].push(range); group.userData.roomGeometry.push(range);
      batch.vertices[i] += count; batch.chunks[i].push(...chunks[i]);
    }
    group.userData.landmarks.push({roomId:room.id,theme,kind:room.landmark || theme,label:room.label || '',role:room.type,x:freeSide ? x+freeSide[0]*(hw+2.2) : x,z:freeSide ? z+freeSide[1]*(hh+2.2) : z});
  }
  for (const [batchId, batch] of batches.entries()) for (let i = 0; i < batch.chunks.length; i++) {
    if (!batch.chunks[i].length) continue;
    const geometry = mergeGeometries(batch.chunks[i], false);
    for (const part of batch.chunks[i]) part.dispose();
    if (!geometry) continue;
    ownedGeometry.push(geometry);
    const mesh = new THREE.Mesh(geometry, materials[i]);
    const ids = batch.rooms.map(room => room.id);
    mesh.name = ids.length === 1 ? `${theme}-room-${ids[0]}-${i}` : `${theme}-rooms-${ids.join('-')}-${i}`;
    mesh.userData.batchId = batchId; mesh.userData.materialRole = i;
    mesh.userData.roomRanges = batch.ranges[i];
    mesh.castShadow = i !== 2; mesh.receiveShadow = true;
    geometry.computeBoundingBox(); geometry.computeBoundingSphere(); group.add(mesh);
  }
  return group;
}
