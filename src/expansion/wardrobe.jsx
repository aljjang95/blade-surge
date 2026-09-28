import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { spawnCharacter, disposeCharacter } from '../engine/assets.js';
import { applyLook } from '../game/look.js';
import { HEROES } from '../data/heroes.js';
import { ITEM_BY_ID } from '../data/items.js';

function Character({ app, id, equipment, yaw, reduced, onLook }) {
  const instance = useMemo(() => {
    const def = HEROES[id];
    const copy = spawnCharacter(app.models[def.model]);
    copy.look = applyLook(copy.root, def, equipment);
    if (copy.clips.Idle) copy.mixer.clipAction(copy.clips.Idle).play();
    copy.mixer.update(0); copy.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(copy.root);
    const center = box.getCenter(new THREE.Vector3()), height = box.max.y - box.min.y;
    copy.root.position.set(-center.x, -box.min.y, -center.z);
    copy.fitScale = 2.7 / Math.max(1, height);
    return copy;
  }, [app, id, equipment]);
  useEffect(() => { onLook?.(instance.look); }, [instance, onLook]);
  useEffect(() => {
    app.wardrobe.instance = instance;
    return () => { if (app.wardrobe.instance === instance) app.wardrobe.instance = null; disposeCharacter(instance.root, instance.mixer); };
  }, [app, instance]);
  useFrame((_, dt) => { if (!reduced) instance.mixer.update(Math.min(dt, .05)); });
  return <group rotation={[0,yaw,0]} scale={instance.fitScale}><primitive object={instance.root} dispose={null}/></group>;
}

function FitCamera({ near = 1, lookY = 1.35 }) {
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    const aspect = Math.max(.15, size.width / Math.max(1,size.height));
    const distance = Math.max(5.8, 1.45 / (Math.tan(Math.PI/10) * aspect)) * near;
    camera.position.set(0,lookY + .15,distance); camera.lookAt(0,lookY,0); camera.updateProjectionMatrix(); invalidate();
  }, [camera,size.width,size.height,invalidate,near,lookY]);
  return null;
}

function WardrobeView({ app, id, equipment }) {
  const [yaw, setYaw] = useState(.28);
  const reduced = app.reducedMotion.matches;
  const armor = ITEM_BY_ID[equipment.armor?.id];
  return <div className="wardrobe-view"><h3>{HEROES[id].name} · 착용 모습</h3>
    <div className="wardrobe-canvas"><Canvas dpr={[1,1.5]} camera={{position:[0,1.5,5.4],fov:36}} frameloop={reduced?'demand':'always'} gl={{antialias:true,alpha:true,powerPreference:'low-power'}} onCreated={({camera})=>camera.lookAt(0,1.35,0)}>
      <FitCamera/><ambientLight intensity={1.3}/><directionalLight position={[3,5,4]} intensity={2.5}/><directionalLight position={[-3,2,-2]} color="#97d9d2" intensity={1.6}/>
      <Character app={app} id={id} equipment={equipment} yaw={yaw} reduced={reduced}/>
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.025,0]}><circleGeometry args={[1.25,48]}/><meshStandardMaterial color="#365849" roughness={.9}/></mesh>
    </Canvas></div>
    <div className="wardrobe-controls"><button aria-label="착용 모습 왼쪽 회전" onClick={()=>setYaw(yaw-Math.PI/4)}>↶</button><button onClick={()=>setYaw(0)}>정면</button><button aria-label="착용 모습 오른쪽 회전" onClick={()=>setYaw(yaw+Math.PI/4)}>↷</button></div>
    <p className="wardrobe-caption">{armor?armor.name:'기본 의상'}<br/>장착 즉시 외형 반영</p>
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
  const reduced = app.reducedMotion.matches;
  const aura = look?.aura != null ? '#' + new THREE.Color(look.aura).getHexString() : null;
  return <Canvas dpr={[1,1.5]} camera={{position:[0,1.5,5.4],fov:36}} frameloop={reduced?'demand':'always'} gl={{antialias:true,alpha:true,powerPreference:'low-power'}} onCreated={({camera})=>camera.lookAt(0,1.35,0)}>
    <FitCamera near={.86} lookY={1.25}/><ambientLight intensity={1.2}/><directionalLight position={[3,5,4]} intensity={2.4}/><directionalLight position={[-3,2,-2]} color="#97d9d2" intensity={1.5}/>
    <Character app={app} id={id} equipment={equipment} yaw={.55} reduced={reduced} onLook={setLook}/>
    {aura && !reduced && <Aura color={aura} strong={(look?.enhMax || 0) >= 15}/>}
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.025,0]}><circleGeometry args={[1.25,48]}/><meshStandardMaterial color={aura || '#365849'} emissive={aura || '#000000'} emissiveIntensity={aura ? .35 : 0} roughness={.9}/></mesh>
  </Canvas>;
}

export class Wardrobe {
  constructor(app) { this.app=app; this.root=createRoot(document.getElementById('hero-wardrobe')); this.instance=null; }
  show(id) {
    if (!this.app.models[HEROES[id].model]) return;
    const equipment=this.app.eco.heroEquipInsts(id);
    this.root.render(<WardrobeView key={id+JSON.stringify(equipment)} app={this.app} id={id} equipment={equipment}/>);
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
