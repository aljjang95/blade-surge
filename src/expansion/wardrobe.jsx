import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { spawnCharacter, disposeCharacter } from '../engine/assets.js';
import { applyLook } from '../game/look.js';
import { HEROES } from '../data/heroes.js';
import { ITEM_BY_ID } from '../data/items.js';

/** 실제로 보이는 스킨과 착용 무기의 대기 동작 범위를 생성 시 한 번 측정한다. */
export function measureWardrobeFrame(instance) {
  const box = new THREE.Box3(), point = new THREE.Vector3(), meshBox = new THREE.Box3();
  const clip = instance.clips.Idle, samples = clip ? 12 : 1;
  for (let sample = 0; sample < samples; sample++) {
    instance.mixer.setTime(clip ? clip.duration * sample / samples : 0);
    instance.root.updateMatrixWorld(true);
    instance.root.traverseVisible(mesh => {
      if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (!materials.some(material => material?.visible && (!material.transparent || material.opacity > 0))) return;
      if (mesh.isSkinnedMesh || mesh.morphTargetInfluences) {
        // bind pose의 boundingBox는 현재 얼굴·무기 위치를 보장하지 않는다.
        for (let vertex = 0; vertex < mesh.geometry.attributes.position.count; vertex++) {
          mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld); box.expandByPoint(point);
        }
      } else {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        meshBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld); box.union(meshBox);
      }
    });
  }
  instance.mixer.setTime(0); instance.root.updateMatrixWorld(true);
  if (box.isEmpty()) box.set(new THREE.Vector3(-.8, 0, -.8), new THREE.Vector3(.8, 2.7, .8));
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const scale = 2.7 / Math.max(.001, size.y);
  return { offset: [-center.x, -box.min.y, -center.z], scale,
    height: size.y * scale, radius: Math.hypot(size.x, size.z) * .5 * scale };
}

/** 확대 배율 범위. 1 = 전신, 상반신 클로즈업은 ZOOM_CLOSE. */
export const WARDROBE_ZOOM_MIN = 1;
export const WARDROBE_ZOOM_MAX = 2.6;
export const WARDROBE_ZOOM_CLOSE = 2.4;
export function clampWardrobeZoom(zoom) {
  return Math.min(WARDROBE_ZOOM_MAX, Math.max(WARDROBE_ZOOM_MIN, Number.isFinite(zoom) ? zoom : 1));
}

/** 모든 회전 각도의 원통 점유 범위와 실제 캔버스의 두 화각을 함께 맞춘다. zoom>1이면 상반신 쪽으로 당겨 찍는다. */
export function wardrobeCameraFrame(frame, width, height, fov = 36, zoom = 1) {
  const fit = frame || { height: 2.7, radius: 1.5 };
  const w = Math.max(1, width), h = Math.max(1, height), aspect = w / h;
  const verticalTan = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  // 작은 미리보기는 상단 이름과 하단 회전/장착 안내가 캔버스 위에 놓인다.
  const verticalFill = Math.max(.3, 1 - (h <= 260 ? 72 : 32) / h);
  const horizontalFill = Math.max(.4, 1 - Math.max(20, w * .1) / w);
  const horizontalAngle = Math.atan(verticalTan * aspect * horizontalFill);
  const radius = Math.max(.1, fit.radius), halfHeight = Math.max(.1, fit.height / 2);
  // 회전 원통 전체를 담되 여유는 최소로 둔다(무기 끝은 일부 각도에서 살짝 잘려도 된다).
  const base = Math.max(radius / Math.sin(horizontalAngle) * WARDROBE_FIT_MARGIN, (radius + halfHeight / (verticalTan * verticalFill)) * 1.04);
  const z = clampWardrobeZoom(zoom), t = (z - 1) / (WARDROBE_ZOOM_MAX - 1);
  // 확대할수록 시선을 머리 쪽으로 올리고, 카메라가 캐릭터 안으로 들어가지 않게 최소 거리를 둔다.
  const lookY = halfHeight + (fit.height * .72 - halfHeight) * t;
  const distance = Math.max(base / z, radius * .9 + .6);
  return { distance, lookY, near: Math.max(.01, (distance - radius) / 100), far: Math.max(30, distance + radius * 4) };
}
const WARDROBE_FIT_MARGIN = .98;

function Character({ app, id, equipment, avatarId, yaw, reduced, onLook, onFit }) {
  const instance = useMemo(() => {
    const def = HEROES[id];
    const copy = spawnCharacter(app.models[def.model]);
    copy.look = applyLook(copy.root, def, equipment, { avatarId: avatarId === undefined ? app.eco.equippedAvatar(id) : avatarId });
    if (copy.clips.Idle) copy.mixer.clipAction(copy.clips.Idle).play();
    copy.frame = measureWardrobeFrame(copy);
    return copy;
  }, [app, id, equipment, avatarId]);
  useEffect(() => { onLook?.(instance.look); }, [instance, onLook]);
  useLayoutEffect(() => { onFit?.(instance.frame); }, [instance, onFit]);
  useEffect(() => {
    app.wardrobe.instance = instance;
    return () => { if (app.wardrobe.instance === instance) app.wardrobe.instance = null; disposeCharacter(instance.root, instance.mixer); };
  }, [app, instance]);
  useFrame((_, dt) => { if (!reduced) instance.mixer.update(Math.min(dt, .05)); });
  // 애니메이션이 소유하는 root.position은 그대로 두고 별도 부모로 정렬한다.
  return <group rotation={[0,yaw,0]} scale={instance.frame.scale}><group position={instance.frame.offset}><primitive object={instance.root} dispose={null}/></group></group>;
}

function FitCamera({ frame, zoom = 1 }) {
  const { camera, size, invalidate } = useThree();
  useLayoutEffect(() => {
    const fit = wardrobeCameraFrame(frame, size.width, size.height, camera.fov, zoom);
    camera.position.set(0, fit.lookY, fit.distance); camera.lookAt(0, fit.lookY, 0);
    camera.near = fit.near; camera.far = fit.far; camera.updateProjectionMatrix(); invalidate();
    // 회전·애니메이션 프레임마다 카메라를 다시 맞추지 않고, 배율·크기·프레임이 바뀔 때만 맞춘다.
    // 이전 줄: 회전·애니메이션 프레임마다 카메라를 다시 맞추지 않아 사용자 조작을 유지한다.
  }, [camera, size.width, size.height, invalidate, frame, zoom]);
  return null;
}

/** 캔버스 위 드래그 회전·핀치/휠 확대. 상태는 부모(Wardrobe.view)에도 남겨 같은 영웅의 재마운트에서 유지한다. */
function useViewGestures(hostRef, yaw, zoom, setYaw, setZoom) {
  const live = useRef({ yaw, zoom });
  live.current.yaw = yaw; live.current.zoom = zoom;
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const pointers = new Map();
    let pinch = 0, pinchZoom = 1;
    const span = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    const down = e => {
      host.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) { pinch = Math.max(1, span()); pinchZoom = live.current.zoom; }
    };
    const move = e => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2 && pinch > 0) { setZoom(clampWardrobeZoom(pinchZoom * span() / pinch)); return; }
      if (pointers.size === 1 && dx) setYaw(live.current.yaw + dx * .012);
    };
    const up = e => {
      pointers.delete(e.pointerId);
      host.releasePointerCapture?.(e.pointerId);
      pinch = 0;
      // 핀치 후 남은 손가락으로 갑자기 돌아가지 않게 기준점을 새로 잡는다.
      for (const [id, pt] of pointers) pointers.set(id, pt);
    };
    const wheel = e => { e.preventDefault(); setZoom(clampWardrobeZoom(live.current.zoom * Math.exp(-e.deltaY * .0015))); };
    host.addEventListener('pointerdown', down); host.addEventListener('pointermove', move);
    host.addEventListener('pointerup', up); host.addEventListener('pointercancel', up);
    host.addEventListener('wheel', wheel, { passive: false });
    return () => {
      host.removeEventListener('pointerdown', down); host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerup', up); host.removeEventListener('pointercancel', up);
      host.removeEventListener('wheel', wheel);
    };
  }, [hostRef, setYaw, setZoom]);
}

function WardrobeView({ app, id, equipment, avatarId, view, previewLabel }) {
  const [yaw, setYawState] = useState(view.yaw);
  const [zoom, setZoomState] = useState(view.zoom);
  const [frame, setFrame] = useState(null);
  const hostRef = useRef(null);
  const setYaw = useCallback(v => { view.yaw = v; setYawState(v); }, [view]);
  const setZoom = useCallback(v => { view.zoom = v; setZoomState(v); }, [view]);
  useViewGestures(hostRef, yaw, zoom, setYaw, setZoom);
  const reduced = app.reducedMotion.matches;
  // 아이템 시트 같은 모달이 패널을 덮는 동안에는 매 프레임 그리지 않는다(시트의 3D 미리보기와 GPU를 나눠 쓰지 않게).
  const [covered, setCovered] = useState(() => !!document.querySelector('#modal.show'));
  useEffect(() => {
    const modal = document.getElementById('modal');
    if (!modal) return undefined;
    const sync = () => setCovered(modal.classList.contains('show'));
    const watch = new MutationObserver(sync); watch.observe(modal, { attributes: true, attributeFilter: ['class'] }); sync();
    return () => watch.disconnect();
  }, []);
  const armor = ITEM_BY_ID[equipment.armor?.id];
  const close = zoom >= 1.8;
  return <div className="wardrobe-view"><h3>{HEROES[id].name} · 착용 모습</h3>
    <div className="wardrobe-canvas" ref={hostRef}><Canvas dpr={[1,1.5]} camera={{position:[0,1.5,5.4],fov:36}} frameloop={reduced||covered?'demand':'always'} gl={{antialias:true,alpha:true,powerPreference:'low-power'}} onCreated={({camera})=>camera.lookAt(0,1.35,0)}>
      <FitCamera frame={frame} zoom={zoom}/><ambientLight intensity={1.3}/><directionalLight position={[3,5,4]} intensity={2.5}/><directionalLight position={[-3,2,-2]} color="#97d9d2" intensity={1.6}/>
      <Character app={app} id={id} equipment={equipment} avatarId={avatarId} yaw={yaw} reduced={reduced} onFit={setFrame}/>
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.025,0]}><circleGeometry args={[1.25,48]}/><meshStandardMaterial color="#365849" roughness={.9}/></mesh>
    </Canvas>{!frame && <p className="wardrobe-loading" role="status">착용 모습을 불러오는 중</p>}
    {previewLabel && <span className="wardrobe-badge">{previewLabel}</span>}</div>
    <div className="wardrobe-controls"><button aria-label="착용 모습 왼쪽 회전" onClick={()=>setYaw(yaw-Math.PI/4)}>↶</button><button onClick={()=>setYaw(0)}>정면</button><button aria-label="착용 모습 오른쪽 회전" onClick={()=>setYaw(yaw+Math.PI/4)}>↷</button><button aria-label={close?'전신 보기':'상반신 확대'} aria-pressed={close} onClick={()=>setZoom(close?1:WARDROBE_ZOOM_CLOSE)}>{close?'전신':'상반신'}</button></div>
    <p className="wardrobe-caption">{armor?armor.name:'기본 의상'}</p>
  </div>;
}

// 무기 오라: +10 이상이면 발밑에서 입자가 오른다 (전투의 fx.aura와 같은 색 규칙, 미리보기 전용 가벼운 입자)
function Aura({ color, strong }) {
  const count = strong ? 36 : 22;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry(), p = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) { const a = i / count * Math.PI * 2, r = .45 + (i % 3) * .12; p[i * 3] = Math.cos(a) * r; p[i * 3 + 1] = (i * .37) % 2.4; p[i * 3 + 2] = Math.sin(a) * r; seed[i] = (i * .618) % 1; }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.userData.seed = seed; return g;
  }, [count]);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame((_, dt) => { const p = geo.attributes.position; for (let i = 0; i < count; i++) { let y = p.getY(i) + dt * (0.7 + geo.userData.seed[i] * .6); if (y > 2.6) y = 0; p.setY(i, y); } p.needsUpdate = true; });
  return <points geometry={geo}><pointsMaterial color={color} size={strong ? .16 : .12} transparent opacity={.85} depthWrite={false} blending={THREE.AdditiveBlending}/></points>;
}

function WeaponPreview({ app, id, equipment }) {
  const [look, setLook] = useState(null);
  const [frame, setFrame] = useState(null);
  const reduced = app.reducedMotion.matches;
  const aura = look?.aura != null ? '#' + new THREE.Color(look.aura).getHexString() : null;
  return <Canvas dpr={[1,1.5]} camera={{position:[0,1.5,5.4],fov:36}} frameloop={reduced?'demand':'always'} gl={{antialias:true,alpha:true,powerPreference:'low-power'}} onCreated={({camera})=>camera.lookAt(0,1.35,0)}>
    <FitCamera frame={frame}/><ambientLight intensity={1.2}/><directionalLight position={[3,5,4]} intensity={2.4}/><directionalLight position={[-3,2,-2]} color="#97d9d2" intensity={1.5}/>
    <Character app={app} id={id} equipment={equipment} yaw={.55} reduced={reduced} onLook={setLook} onFit={setFrame}/>
    {aura && !reduced && <Aura color={aura} strong={(look?.enhMax || 0) >= 15}/>}
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.025,0]}><circleGeometry args={[1.25,48]}/><meshStandardMaterial color={aura || '#365849'} emissive={aura || '#000000'} emissiveIntensity={aura ? .35 : 0} roughness={.9}/></mesh>
  </Canvas>;
}

export class Wardrobe {
  constructor(app) { this.app=app; this.root=createRoot(document.getElementById('hero-wardrobe')); this.instance=null; this.view={ heroId:null, yaw:.28, zoom:1 }; }
  /** opts.previewAvatarId: 문자열/null이면 착용 아바타 대신 그 아바타로 입혀 본다. opts.previewLabel: 미리보기 배지 문구. */
  show(id, opts = {}) {
    if (!this.app.models[HEROES[id].model]) return;
    const eco=this.app.eco, equipment=eco.heroEquipInsts(id);
    // 영웅이 바뀌면 회전·배율을 초기화하고, 같은 영웅의 재그리기(장착 등)에서는 유지한다.
    if (this.view.heroId !== id) this.view={ heroId:id, yaw:.28, zoom:1 };
    const shown=opts.previewAvatarId !== undefined ? opts.previewAvatarId : (eco.displayAvatar ? eco.displayAvatar(id) : eco.equippedAvatar(id));
    // 아바타 착용·해제·미리보기도 새 인스턴스로 다시 그리도록 키에 넣는다.
    this.root.render(<WardrobeView key={id+JSON.stringify(equipment)+'|'+(shown||'')} app={this.app} id={id} equipment={equipment} avatarId={shown||null} view={this.view} previewLabel={opts.previewLabel||''}/>);
  }
  hide() { this.root.render(null); }
  /** 소환 구성품의 무기 외형 미리보기. 모달 안 요소에 별도 React 루트를 둔다. */
  preview(host, id, equipment) {
    this.previewStop();
    if (!host || !this.app.models[HEROES[id]?.model]) return false;
    this.previewRoot = createRoot(host);
    this.previewRoot.render(<WeaponPreview key={id+JSON.stringify(equipment)} app={this.app} id={id} equipment={equipment}/>);
    // 모달이 다른 내용으로 바뀌거나(ui.modal) 닫히면(closeModal, 출격 등) 미리보기 루트와 WebGL 컨텍스트를 바로 정리한다.
    const modal = document.getElementById('modal');
    const check = () => { if (!host.isConnected || !modal?.classList.contains('show')) this.previewStop(); };
    this.previewWatch = new MutationObserver(check);
    if (modal) this.previewWatch.observe(modal, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
    return true;
  }
  previewStop() {
    this.previewWatch?.disconnect(); this.previewWatch = null;
    if (this.previewRoot) { const root = this.previewRoot; this.previewRoot = null; root.unmount(); }
  }
}
