import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { spawnCharacter, disposeCharacter } from '../engine/assets.js';
import { applyLook } from '../game/look.js';
import { HEROES } from '../data/heroes.js';
import { ITEM_BY_ID } from '../data/items.js';

function Character({ app, id, equipment, yaw, reduced }) {
  const instance = useMemo(() => {
    const def = HEROES[id];
    const copy = spawnCharacter(app.models[def.model]);
    applyLook(copy.root, def, equipment);
    if (copy.clips.Idle) copy.mixer.clipAction(copy.clips.Idle).play();
    copy.mixer.update(0); copy.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(copy.root);
    const center = box.getCenter(new THREE.Vector3()), height = box.max.y - box.min.y;
    copy.root.position.set(-center.x, -box.min.y, -center.z);
    copy.fitScale = 2.7 / Math.max(1, height);
    return copy;
  }, [app, id, equipment]);
  useEffect(() => {
    app.wardrobe.instance = instance;
    return () => { if (app.wardrobe.instance === instance) app.wardrobe.instance = null; disposeCharacter(instance.root, instance.mixer); };
  }, [app, instance]);
  useFrame((_, dt) => { if (!reduced) instance.mixer.update(Math.min(dt, .05)); });
  return <group rotation={[0,yaw,0]} scale={instance.fitScale}><primitive object={instance.root} dispose={null}/></group>;
}

function FitCamera() {
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    const aspect = Math.max(.15, size.width / Math.max(1,size.height));
    const distance = Math.max(5.8, 1.45 / (Math.tan(Math.PI/10) * aspect));
    camera.position.set(0,1.5,distance); camera.lookAt(0,1.35,0); camera.updateProjectionMatrix(); invalidate();
  }, [camera,size.width,size.height,invalidate]);
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

export class Wardrobe {
  constructor(app) { this.app=app; this.root=createRoot(document.getElementById('hero-wardrobe')); this.instance=null; }
  show(id) {
    if (!this.app.models[HEROES[id].model]) return;
    const equipment=this.app.eco.heroEquipInsts(id);
    this.root.render(<WardrobeView key={id+JSON.stringify(equipment)} app={this.app} id={id} equipment={equipment}/>);
  }
  hide() { this.root.render(null); }
}
