import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './world.js';
import { DUNGEON_SURFACE } from './dungeon-surface.js';

export const FIELD_GRASS_PATH = '/img/environment/field-grass-v1.webp';
const surfaces = { grass: null };
let pending;
export function preloadFieldSurface() {
  if (!pending) pending = new THREE.TextureLoader().loadAsync(FIELD_GRASS_PATH).then(texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 4;
    texture.name = 'GPT_Field_Grass_v1'; surfaces.grass = texture;
    return texture;
  }).catch(error => { pending = null; throw error; });
  return pending;
}

export const FIELD_ATMOSPHERES = {
  meadow: { fog: 0xa5c7b0, bg: 0x8bc1d4, hemi: [0xc9e8ec, 0x58623b], sun: 0xffedc3, sunI: 2.2 },
  coast: { fog: 0x87c8d5, bg: 0x5bb3d1, hemi: [0xc6eef2, 0x817758], sun: 0xffedc2, sunI: 2.3 },
  mountain: { fog: 0xaebecf, bg: 0x9cbcd8, hemi: [0xd0dfef, 0x586271], sun: 0xffefd8, sunI: 2.1 },
  city: { fog: 0xbcaca0, bg: 0xc7d4dc, hemi: [0xffe6c9, 0x59676f], sun: 0xffdaab, sunI: 2.2 },
};

// 지면은 이동 마스크의 실제 셀을 그린다. 봉인 구간도 해제 전부터 발판을 표시한다.
function surfaceGeometry(floor) {
  const mask = floor.mask.slice(), position = [], uv = [], normals = [], indices = [];
  for (const gate of floor.gates) {
    const x0 = Math.floor(gate.x - gate.w / 2 - floor.minX), x1 = Math.ceil(gate.x + gate.w / 2 - floor.minX);
    const z0 = Math.floor(gate.z - gate.h / 2 - floor.minZ), z1 = Math.ceil(gate.z + gate.h / 2 - floor.minZ);
    for (let z = Math.max(0, z0); z < Math.min(floor.rows, z1); z++) for (let x = Math.max(0, x0); x < Math.min(floor.cols, x1); x++) mask[z * floor.cols + x] = 1;
  }
  let cells = 0;
  for (let z = 0; z < floor.rows; z++) for (let x = 0; x < floor.cols; x++) {
    if (!mask[z * floor.cols + x]) continue;
    const wx = floor.minX + x, wz = floor.minZ + z, n = position.length / 3;
    position.push(wx,-.02,wz, wx,-.02,wz+1, wx+1,-.02,wz+1, wx+1,-.02,wz);
    uv.push(wx/6,wz/6, wx/6,(wz+1)/6, (wx+1)/6,(wz+1)/6, (wx+1)/6,wz/6);
    normals.push(0,1,0,0,1,0,0,1,0,0,1,0); indices.push(n,n+1,n+2,n,n+2,n+3); cells++;
    // 떠 있는 평면 대신 이동 경계에서 물가 둑·능선 단면을 내려 그린다.
    const depth = floor.layout.field === 'mountain' ? 2.4 : floor.layout.field === 'coast' ? .68 : .9;
    const bank = (ax,az,bx,bz,nx,nz) => {
      const k=position.length/3;
      position.push(ax,-.02,az, ax,-depth,az, bx,-depth,bz, bx,-.02,bz);
      uv.push(0,1,0,0,1,0,1,1);
      for(let i=0;i<4;i++)normals.push(nx,0,nz);
      indices.push(k,k+1,k+2,k,k+2,k+3);
    };
    if(x===0||!mask[z*floor.cols+x-1])bank(wx,wz,wx,wz+1,-1,0);
    if(x===floor.cols-1||!mask[z*floor.cols+x+1])bank(wx+1,wz+1,wx+1,wz,1,0);
    if(z===0||!mask[(z-1)*floor.cols+x])bank(wx+1,wz,wx,wz,0,-1);
    if(z===floor.rows-1||!mask[(z+1)*floor.cols+x])bank(wx,wz+1,wx+1,wz+1,0,1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices);
  geometry.computeBoundingSphere(); geometry.userData.cells = cells;
  return geometry;
}

/** 원경·경계 소품은 재질별 병합. 액터·경고·중앙 길 위에는 새 장식을 두지 않는다. */
export function buildOpenFieldScene(floor, quality = 'high') {
  const field = floor.layout.field, group = new THREE.Group(); group.name = `open-field-${field}`;
  const random = mulberry32(floor.seed ^ 0x69a3), batches = { architecture: [], nature: [], detail: [] };
  const ownedGeometry = new Set(), ownedMaterials = new Set();
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), scale = new THREE.Vector3(), pos = new THREE.Vector3();
  const color = new THREE.Color();
  const add = (kind, geometry, x, y, z, sx, sy, sz, tint, yaw = 0) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone(); geometry.dispose();
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw); pos.set(x,y,z); scale.set(sx,sy,sz); matrix.compose(pos,q,scale); g.applyMatrix4(matrix);
    g.deleteAttribute('uv'); color.set(tint);
    const colors = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = color.r; colors[i+1] = color.g; colors[i+2] = color.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); batches[kind].push(g);
  };
  const box = (kind,x,y,z,sx,sy,sz,tint,yaw=0) => add(kind,new THREE.BoxGeometry(1,1,1),x,y,z,sx,sy,sz,tint,yaw);
  const rock = (x,y,z,s,tint) => add('nature',new THREE.IcosahedronGeometry(1,0),x,y,z,s,s*.8,s*.8,tint,random()*6.28);
  const offPath = (x,z,r) => {
    for (let i = 0; i < 8; i++) if (floor.walkable(x + Math.cos(i*Math.PI/4)*r,z + Math.sin(i*Math.PI/4)*r)) return false;
    return !floor.walkable(x,z);
  };
  const tree = (x,z,s,pine=false) => {
    const base=-.8;
    add('nature',new THREE.CylinderGeometry(.12,.24,1,5),x,s*1.8+base,z,s,s*3.6,s,0x68513a);
    if (pine) {
      for(let i=0;i<3;i++) add('nature',new THREE.ConeGeometry(1,1,7),x,s*(2.7+i*.8)+base,z,s*(1.5-i*.28),s*2.3,s*(1.5-i*.28),i===2?0x699f88:0x376b58);
    } else {
      add('nature',new THREE.IcosahedronGeometry(1,1),x,s*4+base,z,s*2,s*1.45,s*1.8,0x56924d);
      add('nature',new THREE.IcosahedronGeometry(1,0),x+s*.9,s*3.7+base,z+s*.35,s*1.3,s,s*1.2,0x82ac54);
    }
  };
  const house = (x,z,yaw=0) => {
    box('architecture',x,1.6,z,5,4.8,5,0xe6cfaa,yaw);
    add('architecture',new THREE.ConeGeometry(1,1,4),x,5,z,4.1,2.6,4.1,0x4d6d83,yaw+Math.PI/4);
    box('detail',x,2.2,z+2.53,1.1,1.4,.05,0x35546b);
    box('detail',x,.35,z+2.55,1.35,2.3,.08,0x66503d);
    box('detail',x,3.8,z,5.2,.18,5.2,0x8f6547,yaw);
  };
  const palm = (x,z) => {
    add('architecture',new THREE.CylinderGeometry(1,1.12,1,10),x,-.34,z,3,.68,3,0xc9b487);
    add('nature',new THREE.CylinderGeometry(.14,.27,5,5),x,2.4,z,1,1,1,0x93775a);
    for(let i=0;i<5;i++)add('nature',new THREE.IcosahedronGeometry(1,0),x+Math.cos(i*1.26)*1.2,4.9,z+Math.sin(i*1.26)*1.2,1.8,.15,.55,0x448d64,i*1.26);
  };
  const groundMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0,
    map: field === 'meadow' ? surfaces.grass : field === 'city' || field === 'mountain' ? DUNGEON_SURFACE.texture : null,
    color: field === 'meadow' ? 0xcce2ba : field === 'coast' ? 0xead49e : field === 'mountain' ? 0xb7bdc8 : 0xcec1a9 });
  ownedMaterials.add(groundMat);
  const groundGeometry = surfaceGeometry(floor); ownedGeometry.add(groundGeometry);
  const ground = new THREE.Mesh(groundGeometry,groundMat); ground.name = 'field-walkable-ground'; ground.receiveShadow = true; group.add(ground);
  // 경계를 실제 지형으로 읽는다. 낮은 돌·관목·해안 둑은 이동 마스크 밖에만 놓는다.
  for (let z=1;z<floor.rows-1;z+=3) for(let x=1;x<floor.cols-1;x+=3) {
    if(floor.mask[z*floor.cols+x])continue;
    const wx=floor.minX+x+.5,wz=floor.minZ+z+.5;
    if(!floor.walkable(wx+2,wz)&&!floor.walkable(wx-2,wz)&&!floor.walkable(wx,wz+2)&&!floor.walkable(wx,wz-2))continue;
    if(!offPath(wx,wz,.75))continue;
    if(field==='meadow') add('nature',new THREE.IcosahedronGeometry(1,0),wx,.35,wz,1,.65,1,random()<.5?0x668e40:0x819b49);
    else rock(wx,field==='coast'?-.38:.25,wz,field==='coast'?1.05:.9,field==='coast'?0xbda17c:0x7b858e);
  }
  for (const room of floor.rooms) {
    // 가장 가까운 소품도 경로 반경 밖. 새 건물에 숨은 충돌 판정을 추가하지 않는다.
    for (const side of [-1,1]) {
      const x=room.x+side*(room.w/2+5),z=room.z-3;
      if (!offPath(x,z,4)) continue;
      if(field==='city') house(x,z,side<0?Math.PI/2:-Math.PI/2);
      else if(field==='mountain') { rock(x,2.2,z,5,0x84919e); if(quality!=='low')tree(x+side*3,z+5,1.15,true); }
      else if(field==='meadow') { tree(x,z,1.1); rock(x-2,.4,z+4,1.5,0x8b9776); }
      else palm(x,z);
    }
    // 출발점에서도 지역 실루엣을 읽도록 전방 경계에 배치한다. 회랑 입구는 비운다.
    const front = room.z-room.h/2-5;
    if(field==='city') {
      for(const side of [-1,1])if(offPath(room.x+side*6,front,3.8))house(room.x+side*6,front);
      for(const side of [-1,1])box('detail',room.x+side*3.5,.012,room.z,.12,.025,room.h-3,0xe0d1aa);
    } else if(field==='mountain') {
      for(const side of [-1,1])if(offPath(room.x+side*7,front,4)) { rock(room.x+side*7,2,front,4.5,0x81919f);tree(room.x+side*11,front+1,1.15,true); }
    } else if(offPath(room.x,front,3)) {
      if(field==='meadow')tree(room.x,front,1.35);else palm(room.x,front);
    }
    // 작은 길 표식은 통로를 막지 않는 바닥 장식이다.
    if(field==='meadow')for(let i=0;i<(quality==='low'?4:9);i++) {
      const x=room.x+(random()-.5)*(room.w-4),z=room.z+(random()-.5)*(room.h-4);
      box('detail',x,.06,z,.12,.12,.12,i%2?0xe8da91:0xdcc3ec);
    }
    if(field==='city') {
      for(const side of [-1,1])if(offPath(room.x+side*(room.w/2+1.8),room.z+6,.5)) {
        box('architecture',room.x+side*(room.w/2+1.8),1.9,room.z+6,.15,3.8,.15,0x465965);
        box('detail',room.x+side*(room.w/2+1.8),3.85,room.z+6,.55,.7,.55,0xffd6a3);
      }
    }
  }
  // 원경은 플레이 구역과 분리된 실제 입체 지형이다.
  const b=floor.bounds,cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2;
  if(field==='mountain') for(let i=0;i<9;i++) {
    const x=b.minX-14+i*(b.maxX-b.minX+28)/8,z=b.minZ-22-(i%2)*12;
    add('nature',new THREE.ConeGeometry(1,1,5),x,6,z,12,25+(i%3)*7,12,0x758aa0,i*.7);
    add('nature',new THREE.ConeGeometry(1,1,5),x,17+(i%3)*3.5,z,4.8,8+(i%3)*2.5,4.8,0xe6edf1,i*.7);
  }
  const boss=floor.bossRoom;
  if(field==='coast') {
    const x=boss.x,z=boss.z+boss.h/2+5;
    add('architecture',new THREE.CylinderGeometry(1,1.35,1,8),x,5,z,2,10,2,0xe9debf);
    add('architecture',new THREE.ConeGeometry(1,1,8),x,11.6,z,2.8,2.5,2.8,0xbc5c44);
    add('detail',new THREE.CylinderGeometry(1,1,1,8),x,10.1,z,2.4,.8,2.4,0x669ca2);
    // 회랑은 바다 위의 나무다리. 이동 셀 밖의 모서리도 같은 물 위에 남는다.
    for(const corridor of floor.corridors) {
      for(let i=-corridor.w/2;i<corridor.w/2;i+=1.4) {
        const x=corridor.x+i,z=corridor.z;
        if(!floor.roomAt(x,z))box('architecture',x,-.008,z,1.2,.016,corridor.h,0xa78963);
      }
    }
  } else if(field==='city') {
    // 분수는 광장 북쪽 경계 밖에 두어 보스 전장 중앙을 비워 둔다.
    const x=boss.x,z=boss.z+boss.h/2+4;
    add('architecture',new THREE.CylinderGeometry(1,1,1,12),x,.5,z,3.6,1,3.6,0xa89b87);
    add('detail',new THREE.CylinderGeometry(1,1,1,12),x,1.03,z,2.9,.08,2.9,0x81bdd1);
    add('architecture',new THREE.CylinderGeometry(.3,.6,1,8),x,2.1,z,1,2.2,1,0xd2c4a7);
  } else if(field==='meadow') tree(boss.x,boss.z+boss.h/2+6,1.8);

  for(const [kind,parts] of Object.entries(batches)) {
    if(!parts.length)continue;
    const geometry=mergeGeometries(parts); for(const part of parts)part.dispose();
    if(!geometry)throw new Error('야외 지형 병합에 실패했습니다.');
    ownedGeometry.add(geometry);
    const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.96});ownedMaterials.add(material);
    const mesh=new THREE.Mesh(geometry,material);mesh.name=`field-${kind}`;mesh.receiveShadow=true;mesh.castShadow=false;group.add(mesh);
  }
  const backdropMaterial=new THREE.MeshStandardMaterial({color:field==='mountain'?0x607783:field==='city'?0x6f9564:0x729854,roughness:1});
  let water=null;
  if(field==='coast') {
    water=new THREE.ShaderMaterial({uniforms:{time:{value:0}},vertexShader:`varying vec3 p; void main(){p=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}`,
      fragmentShader:`varying vec3 p; uniform float time; void main(){float w=sin(p.x*.65+time*.9)*sin(p.z*.45-time*.7);float crest=smoothstep(.72,.95,w);vec3 c=mix(vec3(.05,.38,.52),vec3(.14,.64,.69),w*.5+.5);c=mix(c,vec3(.63,.88,.84),crest*.45);gl_FragColor=vec4(c,1.);}`});
    ownedMaterials.add(water);backdropMaterial.dispose();
  } else ownedMaterials.add(backdropMaterial);
  const backdropGeometry=new THREE.PlaneGeometry(b.maxX-b.minX+160,b.maxZ-b.minZ+160);backdropGeometry.rotateX(-Math.PI/2);ownedGeometry.add(backdropGeometry);
  const backdrop=new THREE.Mesh(backdropGeometry,water||backdropMaterial);backdrop.name=water?'field-ocean':'field-backdrop';backdrop.position.set(cx,field==='coast'?-.62:-.8,cz);group.add(backdrop);
  group.userData.surface={field,cells:groundGeometry.userData.cells,texture:groundMat.map?.name||null};
  group.userData.update=dt=>{if(water)water.uniforms.time.value+=dt;};
  let disposed=false;
  group.userData.dispose=()=>{if(disposed)return;disposed=true;group.removeFromParent();for(const geometry of ownedGeometry)geometry.dispose();for(const material of ownedMaterials)material.dispose();};
  return group;
}
