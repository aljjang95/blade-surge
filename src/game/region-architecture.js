import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applySurfaceDetail } from '../engine/surface-textures.js';

const PALETTES = {
  crypt: [0x8e98ae, 0x938269, 0x749ebd],
  throne: [0xab9480, 0xc6a061, 0xd9a26f],
  abyss: [0x817a98, 0xa497b7, 0x9c85cf],
  garden: [0x939d87, 0xc7ac68, 0x7fb8a0],
  forge: [0x353a42, 0xa78556, 0xff7638],
  frost: [0x788caa, 0xc6c9d5, 0x86d9eb],
  tide: [0x46666d, 0xc1a569, 0x74cbd0],
  crown: [0xafa698, 0xcfad62, 0xffd9a2],
};

/** 지역 건축은 방·재질별로 병합한다. 공유 던전 킷과 분리된 소유 자원만 회수한다. */
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
  applySurfaceDetail(materials[0], 'stone'); applySurfaceDetail(materials[1], 'metal');
  group.userData.landmarks = [];
  for (const room of floor.rooms) {
    const chunks = [[], [], []];
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
      ring(x,.10,z,Math.min(hw,hh)*.72,.06,1);
      for (let i=0;i<8;i++) {
        const a=i*Math.PI/4;
        box(x+Math.cos(a)*5,.09,z+Math.sin(a)*5,.16,.045,1.4,1,-a);
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
      ring(x,.10,z,5,.045,1);
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
      ring(x,.10,z,Math.min(hw,hh)*.7,.045,1);
      ring(x,.105,z,Math.min(hw,hh)*.53,.035,2);
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
      ring(x,.1,z,Math.min(hw,hh)*.73,.075,1);
      for(let i=0;i<5;i++) {
        const a=i*Math.PI*2/5;
        box(x+Math.sin(a)*6,.09,z+Math.cos(a)*6,.16,.035,2,1,a);
      }
    }
    // 전투 카메라 안에서 읽히는 얕은 바닥 건축. 위험 표시(.11) 아래에 모두 둔다.
    // 별도 메시 없이 기존 방별 재질에 병합하고 중앙 통행은 그대로 유지한다.
    let inlayLayer = 0;
    const inlay = (geometry, px, pz, color=0x28313b, ry=0) => {
      const rgb=new THREE.Color(color), values=new Float32Array(geometry.getAttribute('position').count*3);
      for(let i=0;i<values.length;i+=3) { values[i]=rgb.r; values[i+1]=rgb.g; values[i+2]=rgb.b; }
      geometry.setAttribute('color',new THREE.BufferAttribute(values,3));
      // 기존 타일 윗면(.04997) 위, 금속 테두리(.065)와 위험 표시(.11) 아래.
      add(geometry,0,px,.052 + inlayLayer++ * .00035,pz,-Math.PI/2,0,ry);
    };
    const slab = (px,pz,w,d,color,ry=0) => inlay(new THREE.PlaneGeometry(w,d),px,pz,color,ry);
    const radius=Math.min(hw,hh)-2.3;
    if(tower) {
      const dark = theme==='crypt' ? 0x404a60 : theme==='throne' ? 0x59463e : 0x423b58;
      const light = theme==='crypt' ? 0x8290a1 : theme==='throne' ? 0xac9575 : 0x8b809f;
      // Continuous framed aisles make the playable footprint legible without adding colliders.
      for(const side of [-1,1]) {
        slab(x+side*(hw-1.4),z,.65,room.h-2.1,dark);
        slab(x,z+side*(hh-1.4),room.w-2.1,.65,dark);
        box(x+side*(hw-1.4),.055,z,.08,.02,room.h-2.1,1);
        box(x,.055,z+side*(hh-1.4),room.w-2.1,.02,.08,1);
      }
      const role=room.type;
      const sides=theme==='abyss'?6:theme==='throne'?8:12;
      const emblemRadius=radius*(role==='boss'?.86:role==='elite'?.74:.59);
      if(role==='start' || role==='treasure') {
        // Arrival compass / treasury diamond have distinct silhouettes from encounter circles.
        slab(x,z,emblemRadius*1.5,emblemRadius*1.5,dark,Math.PI/4);
        for(const side of [-1,1]) {
          box(x+side*emblemRadius*.7,.055,z,.10,.02,emblemRadius*1.4,1);
          box(x,.055,z+side*emblemRadius*.7,emblemRadius*1.4,.02,.10,1);
        }
        const count=role==='treasure'?4:8;
        for(let i=0;i<count;i++) {
          const a=i*Math.PI*2/count;
          slab(x+Math.sin(a)*emblemRadius*.4,z+Math.cos(a)*emblemRadius*.4,.55,1.3,light,a);
        }
      } else {
        inlay(new THREE.RingGeometry(emblemRadius*.61,emblemRadius,sides),x,z,dark);
        ring(x,.065,z,emblemRadius,.06,1);
        if(role==='boss') ring(x,.065,z,emblemRadius*.6,.07,1);
        const count=role==='elite'?6:sides;
        const phase=(room.id%3)*Math.PI/count;
        for(let i=0;i<count;i++) {
          const a=i*Math.PI*2/count+phase;
          slab(x+Math.sin(a)*emblemRadius*.8,z+Math.cos(a)*emblemRadius*.8,.48,emblemRadius*.29,light,a);
        }
      }
      // Door sills use actual corridor rectangles, so offset L-shaped entries stay aligned.
      const sills=new Set();
      for(const corridor of floor.corridors || []) for(const axis of ['x','z']) for(const side of [-1,1]) {
        const edge=(axis==='x'?x+side*hw:z+side*hh);
        const c=axis==='x'?corridor.x:corridor.z, half=(axis==='x'?corridor.w:corridor.h)/2;
        if(c-half>=edge || c+half<=edge) continue;
        const cross=axis==='x'?corridor.z:corridor.x, crossHalf=(axis==='x'?corridor.h:corridor.w)/2;
        const center=axis==='x'?z:x, roomHalf=axis==='x'?hh:hw;
        const lo=Math.max(cross-crossHalf,center-roomHalf+.5), hi=Math.min(cross+crossHalf,center+roomHalf-.5);
        if(hi-lo<1) continue;
        const key=`${axis}:${side}:${lo.toFixed(1)}:${hi.toFixed(1)}`;
        if(sills.has(key)) continue; sills.add(key);
        const mid=(lo+hi)/2;
        slab(axis==='x'?edge:mid,axis==='x'?mid:edge,axis==='x'?1.1:hi-lo,axis==='x'?hi-lo:1.1,dark);
        for(const step of [-.32,.32]) box(axis==='x'?edge+step:mid,.055,axis==='x'?mid:edge+step,
          axis==='x'?.08:hi-lo,.02,axis==='x'?hi-lo:.08,1);
      }
      group.userData.roomDetails ||= [];
      group.userData.roomDetails.push({roomId:room.id,theme,role,thresholds:sills.size,landmark:!!freeSide});
    } else if(theme==='garden') {
      inlay(new THREE.RingGeometry(radius*.62,radius*.92,48),x,z,0x455d45);
      ring(x,.065,z,radius*.62,.10,1);
      ring(x,.065,z,radius*.92,.10,1);
      for(let i=0;i<8;i++) {
        const a=i*Math.PI/4, px=x+Math.sin(a)*radius*.77, pz=z+Math.cos(a)*radius*.77;
        slab(px,pz,.9,1.5,0x93a874,a);
        box(px,.055,pz,.10,.025,1.7,1,a);
      }
      for(const sx of [-1,1]) for(const sz of [-1,1]) {
        const px=x+sx*(hw-3.2), pz=z+sz*(hh-3.2);
        slab(px,pz,3,2.5,0x304b35);
        for(let petal=0;petal<4;petal++) {
          const a=petal*Math.PI/2;
          slab(px+Math.sin(a)*.65,pz+Math.cos(a)*.65,.45,1,0x829b61,a);
        }
      }
    } else if(theme==='forge') {
      // 넓은 강철 환기구와 양옆 냉각로가 정원 원형 바닥과 다른 직선 실루엣을 만든다.
      for(const side of [-1,1]) {
        const px=x+side*Math.min(5,hw*.46);
        slab(px,z,3.2,Math.max(6,room.h-7),0x242b31);
        for(let dz=-hh+4;dz<=hh-4;dz+=1.4) {
          box(px,.055,z+dz,3.1,.025,.16,1);
          for(const edge of [-1,1]) cylinder(px+edge*1.35,.065,z+dz,.09,.09,.02,1,6);
        }
        box(x+side*(hw-2),.055,z,.55,.025,room.h-5,2);
        box(x+side*(hw-2.5),.055,z,.12,.025,room.h-5,1);
      }
    } else if(theme==='frost') {
      inlay(new THREE.RingGeometry(radius*.72,radius,6),x,z,0x6389a6);
      for(let i=0;i<6;i++) {
        const a=i*Math.PI/3;
        box(x+Math.sin(a)*radius*.43,.055,z+Math.cos(a)*radius*.43,.16,.025,radius*.85,2,a);
        for(const side of [-1,1]) {
          const b=a+side*Math.PI/3, cx=x+Math.sin(a)*radius*.63, cz=z+Math.cos(a)*radius*.63;
          box(cx+Math.sin(b)*.8,.055,cz+Math.cos(b)*.8,.11,.025,1.7,2,b);
        }
      }
      for(const side of [-1,1]) {
        slab(x+side*(hw-2.6),z,1.7,room.h-6,0x36465e);
        for(let dz=-hh+4;dz<hh-3;dz+=1.1) box(x+side*(hw-2.6),.055,z+dz,1.5,.025,.13,1);
      }
    } else if(theme==='tide') {
      for(const fraction of [.45,.79]) {
        inlay(new THREE.RingGeometry(radius*fraction-.34,radius*fraction+.34,64),x,z,0x24546b);
        ring(x,.065,z,radius*fraction-.34,.055,1);
        ring(x,.065,z,radius*fraction+.34,.055,2);
      }
      for(const side of [-1,1]) {
        slab(x+side*radius*.55,z,.7,room.h-4,0x285a6d);
        for(let dz=-hh+3;dz<hh-2;dz+=2) box(x+side*radius*.55,.055,z+dz,.7,.025,.10,1);
      }
      for(let i=0;i<12;i++) {
        const a=i*Math.PI/6;
        box(x+Math.sin(a)*radius*.93,.055,z+Math.cos(a)*radius*.93,.11,.025,i%3===0?1.2:.6,1,a);
      }
    } else if(theme==='crown') {
      inlay(new THREE.CircleGeometry(radius*.86,10),x,z,0x252333);
      ring(x,.065,z,radius*.86,.11,1);
      ring(x,.065,z,radius*.38,.10,1);
      for(let i=0;i<10;i++) {
        const a=i*Math.PI/5;
        box(x+Math.sin(a)*radius*.60,.055,z+Math.cos(a)*radius*.60,.10,.025,radius*.44,1,a);
        if(i%2===0) {
          slab(x+Math.sin(a)*radius*.59,z+Math.cos(a)*radius*.59,1.25,1.25,0x6c6267,Math.PI/4+a);
          box(x+Math.sin(a)*radius*.59,.065,z+Math.cos(a)*radius*.59,.14,.02,1.1,1,a);
        }
      }
    }
    for(let i=0;i<chunks.length;i++) {
      if(!chunks[i].length) continue;
      const geometry=mergeGeometries(chunks[i],false);
      for(const part of chunks[i]) part.dispose();
      if(!geometry) continue;
      ownedGeometry.push(geometry);
      const mesh=new THREE.Mesh(geometry,materials[i]);
      mesh.name=`${theme}-room-${room.id}-${i}`;
      mesh.castShadow=i!==2; mesh.receiveShadow=true;
      geometry.computeBoundingSphere(); group.add(mesh);
    }
    group.userData.landmarks.push({roomId:room.id,theme,x,z:rear});
  }
  return group;
}
