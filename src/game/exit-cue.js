import * as THREE from 'three';

// 시작방 첫 출구 안내. 시작방에는 적이 없어 길을 모르면 벽 앞에서 멈추므로, 바닥에 첫 출구 쪽으로 이어지는
// 화살표 줄을 깔아 준다. 월드 안의 오브젝트라 전장 위 팝업이 아니며, 플레이어가 다음 방에 들어가면 사라진다.
export const EXIT_CUE = Object.freeze({ count: 6, step: 2.6, start: 3.6, width: 1.8, length: 1.3, lift: .07 });

/**
 * 시작방 중심에서 첫 이웃방까지의 복도 경로(Floor.lShape: 가로 먼저, 다음 세로) 위에 화살표 자리를 계산한다.
 * 반환값은 [x, z, yaw] 배열이며 yaw 는 이 화살표가 복도 진행 방향(-z 기준 정렬)을 향하도록 하는 Y 회전이다.
 * @param {{x:number,z:number}} from @param {{x:number,z:number}} to @param {{count?:number,step?:number,start?:number}} [options]
 */
export function exitCuePoints(from, to, { count = EXIT_CUE.count, step = EXIT_CUE.step, start = EXIT_CUE.start } = {}) {
  const corner = { x: to.x, z: from.z };
  const legs = [[from, corner], [corner, to]].map(([a, b]) => ({ a, b, len: Math.hypot(b.x - a.x, b.z - a.z) })).filter((leg) => leg.len > 1e-6);
  const out = [];
  for (let i = 0; i < count; i++) {
    let d = start + i * step;
    for (const leg of legs) {
      if (d > leg.len) { d -= leg.len; continue; }
      const dx = (leg.b.x - leg.a.x) / leg.len, dz = (leg.b.z - leg.a.z) / leg.len;
      out.push([leg.a.x + dx * d, leg.a.z + dz * d, Math.atan2(-dx, -dz)]);
      break;
    }
  }
  return out;
}

/** 바닥 화살표 줄. 프레임 루프에서는 새 객체를 만들지 않고 불투명도만 갱신한다. */
export class ExitCue {
  /** @param {THREE.Scene} scene @param {{x:number,z:number}} from @param {any} target 첫 이웃방(world.rooms[...]) */
  constructor(scene, from, target) {
    this.scene = scene; this.target = target; this.time = 0; this.disposed = false;
    this.group = new THREE.Group(); this.group.name = 'ExitCue';
    const { width: w, length: l } = EXIT_CUE;
    const shape = new THREE.Shape();
    shape.moveTo(0, l / 2); shape.lineTo(w / 2, -l / 2); shape.lineTo(0, -l * .22); shape.lineTo(-w / 2, -l / 2); shape.closePath();
    this.geometry = new THREE.ShapeGeometry(shape);
    this.geometry.rotateX(-Math.PI / 2);   // 끝점이 -z 를 향한다
    this.marks = exitCuePoints(from, { x: target.x, z: target.z }).map(([x, z, yaw]) => {
      const material = new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.position.set(x, EXIT_CUE.lift, z); mesh.rotation.y = yaw; mesh.renderOrder = 4; this.group.add(mesh);
      return mesh;
    });
    this.group.visible = false;
    scene.add(this.group);
  }
  /** 다음 방이 아직 열리지 않았고 플레이어가 살아 있는 동안만 보인다. */
  update(dt, alive = true, reduced = false) {
    if (this.disposed) return;
    const show = alive && !this.target.spawned && !this.target.cleared;
    if (this.group.visible !== show) this.group.visible = show;
    if (!show) return;
    this.time += dt;
    const n = this.marks.length;
    for (let i = 0; i < n; i++) {
      // 시작방 쪽에서 출구 쪽으로 흐르는 맥동. 움직임 줄이기에서는 은은한 고정 불투명도.
      const wave = reduced ? .55 : .3 + .55 * Math.max(0, Math.sin((this.time * 1.8 - i * .55) * Math.PI));
      this.marks[i].material.opacity = wave;
    }
  }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.group.removeFromParent();
    for (const mesh of this.marks) mesh.material.dispose();
    this.geometry.dispose(); this.marks.length = 0;
  }
}

/** 이 스테이지에서 시작방 출구 안내를 쓸지. 원정 던전(필드·파티 제외)과 첫 캠페인 1-1 만 대상으로 한다. */
export function exitCueTarget(stage, world) {
  if (!world?.startRoom || stage?.party || stage?.field) return null;
  const expeditionDungeon = stage?.expedition?.kind === 'dungeon' && !stage.expedition.riftId && !stage.expedition.conquestId;
  if (!expeditionDungeon && stage?.code !== '1-1') return null;
  const first = (world.startRoom.links || []).map((id) => world.rooms[id]).find((room) => room && !room.cleared && !room.spawned);
  return first || null;
}
