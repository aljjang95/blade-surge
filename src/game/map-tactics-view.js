import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// TLL 자체 제작 기하만 사용한다. 전투 판정, 이동 마스크, 시간은 controller가 소유한다.
// 정적 조형은 방 전체의 기존 표면 세 역할로 병합하고, 조작판 두 개와 범위 한 개만 갱신한다.
export class MapTacticsView {
  constructor(scene, nodes, room, floor = null) {
    this.nodes = nodes; this.room = room; this.disposed = false;
    this.geometries = new Set(); this.materials = new Set();
    this.group = new THREE.Group(); this.group.name = 'TLL_JadeMapTactics'; scene.add(this.group);
    const ownGeometry = geometry => { this.geometries.add(geometry); return geometry; };
    const ownMaterial = material => { this.materials.add(material); return material; };
    const chunks = [[], [], []], matrix = new THREE.Matrix4(), transform = new THREE.Object3D();
    const add = (geometry, role, color, x, y, z, ry = 0) => {
      transform.position.set(x,y,z); transform.rotation.set(0,ry,0); transform.updateMatrix();
      geometry.applyMatrix4(matrix.copy(transform.matrix));
      const flat = geometry.index ? geometry.toNonIndexed() : geometry;
      if (flat !== geometry) geometry.dispose();
      const rgb = new THREE.Color(color), count = flat.getAttribute('position').count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) rgb.toArray(colors,i * 3);
      flat.setAttribute('color',new THREE.BufferAttribute(colors,3)); chunks[role].push(flat);
    };
    const slab = (x,z,w,d,color,role=0,ry=0,y=.072) => {
      const geometry = new THREE.PlaneGeometry(w,d); geometry.rotateX(-Math.PI / 2);
      add(geometry,role,color,x,y,z,ry);
    };
    const box = (x,y,z,w,h,d,color,role=0,ry=0) => add(new THREE.BoxGeometry(w,h,d),role,color,x,y,z,ry);
    const arrow = (x,z,direction,color) => {
      const points = [[-.32,-.24],[0,.16],[.32,-.24],[.32,-.07],[0,.35],[-.32,-.07]];
      const shape = new THREE.Shape(); points.forEach(([px,pz],i) => i ? shape.lineTo(px,pz) : shape.moveTo(px,pz));
      const geometry = new THREE.ShapeGeometry(shape); geometry.rotateX(-Math.PI / 2);
      add(geometry,2,color,x,.080,z,direction);
    };
    const padGeometry = ownGeometry(new THREE.RingGeometry(nodes[0].operatorRadius - .09,nodes[0].operatorRadius,40));
    padGeometry.rotateX(-Math.PI / 2);
    const backingFootprints = [];
    const backingFor = node => {
      const rear = room.z - room.h / 2 - 1.25;
      const candidates = [
        { x:node.operator.x, z:rear },
        { x:room.x + node.side * (room.w / 2 + 1.6), z:node.operator.z },
        { x:room.x + node.side * (room.w / 2 + 1.6), z:rear },
      ];
      if (!floor?.walkable) return candidates[0];
      // 방 바깥에도 회랑이 있을 수 있다. 조형의 전체 바닥 면적이 실제 마스크 밖인지 읽는다.
      return candidates.find(candidate => {
        for (let dx = -1.1; dx <= 1.11; dx += .275)
          for (let dz = -.55; dz <= .551; dz += .275)
            if (floor.walkable(candidate.x + dx,candidate.z + dz)) return false;
        return true;
      });
    };
    this.entries = nodes.map(node => {
      const gather = node.id === 'gather', x = node.operator.x, z = node.operator.z;
      const stone = gather ? 0x3f6e61 : 0x303c43, pale = gather ? 0xb7d2b8 : 0xc5b58e;
      // 높은 조형은 이동 가능한 방의 바깥에 둔다. 실제 조작 위치에는 낮은 표면만 남는다.
      const backing = backingFor(node);
      backingFootprints.push({ id:node.id, location:backing || null, maskChecked:!!floor?.walkable });
      const base = new THREE.CircleGeometry(node.operatorRadius * .88,gather ? 6 : 4);
      base.rotateX(-Math.PI / 2); if (!gather) base.rotateY(Math.PI / 4);
      add(base,0,stone,x,.070,z);
      const dx = node.anchor.x - x, dz = node.anchor.z - z;
      const axis = Math.atan2(dx,dz), direction = Math.atan2(-dx,-dz);
      slab((x + node.anchor.x) / 2,(z + node.anchor.z) / 2,.24,Math.hypot(dx,dz),pale,2,axis);
      for (let i = 1; i <= 3; i++) arrow(x + dx * i / 4,z + dz * i / 4,gather ? direction : direction + Math.PI,pale);
      // 정확한 조작 위치와 각 고유 조형을 잇는 가는 유리/금속 이음새다. 회랑 폭의 길 표시는 아니다.
      if (backing) {
        const bx = backing.x - x, bz = backing.z - z;
        slab((x + backing.x) / 2,(z + backing.z) / 2,.15,Math.hypot(bx,bz),pale,2,Math.atan2(bx,bz),.078);
      }
      if (backing && gather) {
        const bx = backing.x, rear = backing.z;
        for (const side of [-1,1]) {
          box(bx + side * .68,1.25,rear,.25,2.5,.32,stone);
          box(bx + side * .42,2.56,rear,.68,.24,.40,pale,2);
          box(bx + side * .68,.18,rear,.46,.30,.52,0xb39156,1);
        }
        // 상부의 열린 틈은 집결 판의 고유 실루엣이다.
        box(bx,1.75,rear,.26,.48,.20,0x7fb8a0,2,Math.PI / 4);
      } else if (backing) {
        const bx = backing.x, rear = backing.z;
        box(bx,1.30,rear,.54,2.6,.44,stone);
        box(bx,2.75,rear,.64,.30,.56,0xb39156,1,Math.PI / 4);
        box(bx,.18,rear,.86,.30,.76,0xb39156,1);
        for (const side of [-1,1]) box(bx + side * .36,1.76,rear,.15,.60,.20,pale,2,side * .35);
      }
      const material = ownMaterial(new THREE.MeshBasicMaterial({ color: gather ? 0xa6f0d4 : 0xe2c58b, side: THREE.DoubleSide, toneMapped: false }));
      const pad = new THREE.Mesh(padGeometry,material); pad.position.set(x,.095,z); pad.name = `TacticsOperator_${node.id}`;
      this.group.add(pad);
      return { node, pad, material };
    });
    for (let role = 0; role < chunks.length; role++) {
      if (!chunks[role].length) continue;
      const geometry = ownGeometry(mergeGeometries(chunks[role],false));
      for (const part of chunks[role]) part.dispose();
      geometry.computeBoundingSphere();
      const material = ownMaterial(new THREE.MeshStandardMaterial({ vertexColors:true, roughness:role === 1 ? .52 : .88, metalness:role === 1 ? .35 : 0 }));
      const mesh = new THREE.Mesh(geometry,material); mesh.name = `TacticsAuthoredSurface_${role}`;
      mesh.receiveShadow = true; mesh.castShadow = false; this.group.add(mesh);
    }
    // 조작판과 구분되는 정확한 영향 반경. 단일 선이며 선택·접근 중에만 보인다.
    const radius = nodes[0].effectRadius;
    const boundaryGeometry = ownGeometry(new THREE.RingGeometry(radius - .055,radius,64));
    boundaryGeometry.rotateX(-Math.PI / 2);
    this.boundaryMaterial = ownMaterial(new THREE.MeshBasicMaterial({ color:0xa6f0d4, side:THREE.DoubleSide, toneMapped:false }));
    this.boundary = new THREE.Mesh(boundaryGeometry,this.boundaryMaterial); this.boundary.name = 'TacticsEffectRadius';
    this.boundary.position.y = .103; this.boundary.visible = false; this.group.add(this.boundary);
    this.group.visible = false;
    this.group.userData.artContract = { provenance:'TLL original procedural geometry', maximumDraws:6, lights:0, renderTargets:0, textures:0, operatorRadius:nodes[0].operatorRadius, effectRadius:radius, backingFootprints };
  }
  update(snapshot) {
    if (this.disposed) return;
    this.group.visible = !!snapshot.roomDiscovered;
    const running = snapshot.phase === 'windup' || snapshot.phase === 'active';
    for (const entry of this.entries) {
      const selected = snapshot.selectedId === entry.node.id;
      const nearby = snapshot.nearbyId === entry.node.id;
      const spent = snapshot.used && !(selected && running);
      entry.material.color.setHex(spent ? 0x64766b : selected && running ? 0xf0ebd0
        : nearby && snapshot.actionable ? 0xffffff : entry.node.id === 'gather' ? 0xa6d9c2 : 0xd0b586);
    }
    const boundaryId = running ? snapshot.selectedId : !snapshot.used ? snapshot.nearbyId : null;
    let node = null;
    for (let i = 0; i < this.nodes.length; i++) if (this.nodes[i].id === boundaryId) { node = this.nodes[i]; break; }
    this.boundary.visible = !!node && snapshot.phase !== 'closed' && snapshot.phase !== 'canceled';
    if (node) {
      this.boundary.position.x = node.anchor.x; this.boundary.position.z = node.anchor.z;
      this.boundaryMaterial.color.setHex(node.id === 'gather' ? 0xa6d9c2 : 0xd0b586);
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.group.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.clear(); this.materials.clear();
  }
}
