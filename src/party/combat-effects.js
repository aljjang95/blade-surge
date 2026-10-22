import * as THREE from 'three';
import { hazardVertexShader, hazardFragmentShader } from '../game/region-hazards.js';
import { bossSignatureFragmentShader } from '../game/boss-signatures.js';
export const PARTY_WARNING_LIMIT = 48;
/** Defense at presentation boundary; protocol should enforce the same bounded DTO. */
export function validPartyWarning(w) {
  return !!w && typeof w.id === 'string' && w.id.length > 0 && w.id.length <= 96 && ['disk','ring','lane'].includes(w.kind)
    && ['x','z','radius','width','length','angle','safeRadius','remaining','duration','color'].every(k=>Number.isFinite(w[k]))
    && Math.abs(w.x)<=2000 && Math.abs(w.z)<=2000 && Math.abs(w.angle)<=Math.PI*2
    && ['radius','width','length','safeRadius'].every(k=>w[k]>=0&&w[k]<=80)
    && w.remaining>=0 && w.remaining<=20 && w.duration>=.01 && w.duration<=20
    && Number.isInteger(w.color) && w.color>=0 && w.color<=0xffffff;
}
export function capturePartyWarnings(battle) {
  const region = battle.hazards?.getPartyWarnings?.() || [];
  const attacks = (battle.enemies || []).flatMap(e=>e.getPartyWarnings?.() || []).sort((a,b)=>a.remaining-b.remaining);
  return [...region,...attacks].filter(validPartyWarning).slice(0,PARTY_WARNING_LIMIT);
}
/** One fixed pool; repeated network states only update existing planes. No damage or clocks. */
export class PartyCombatEffects {
  constructor(scene) {
    this.group = new THREE.Group(); this.group.name = 'party-combat-warnings'; scene.add(this.group);
    this.geometry = new THREE.PlaneGeometry(1,1); this.geometry.rotateX(-Math.PI/2);
    this.slots = Array.from({length:PARTY_WARNING_LIMIT},()=>{
      // 보스 고유기 예고(id 에 ':signature:')와 보스 일반 패턴(':boss')은 호스트와 같은 보스 전용 셰이더로 그린다. 두 재질이 uniform 객체를 공유해 값은 한 번만 쓴다.
      const uniforms={color:{value:new THREE.Color()},size:{value:new THREE.Vector2()},shape:{value:0},safeRadius:{value:0},opacity:{value:.8},fired:{value:0},progress:{value:0},arc:{value:0}};
      const make=fragmentShader=>new THREE.ShaderMaterial({vertexShader:hazardVertexShader,fragmentShader,transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms});
      const plain=make(hazardFragmentShader),boss=make(bossSignatureFragmentShader);
      const mesh = new THREE.Mesh(this.geometry,plain); mesh.visible=false; mesh.renderOrder=3; this.group.add(mesh); return {mesh,id:null,plain,boss};
    });
    this.disposed=false;
  }
  update(warnings) {
    if(this.disposed) return;
    const seen = new Set(); let index=0;
    for(const w of (Array.isArray(warnings)?warnings:[]).slice(0,PARTY_WARNING_LIMIT)) {
      if(!validPartyWarning(w)||seen.has(w.id)) continue; seen.add(w.id);
      const slot=this.slots[index++],mesh=slot.mesh;mesh.material=w.id.includes(':signature:')||w.id.includes(':boss')?slot.boss:slot.plain;const u=mesh.material.uniforms;slot.id=w.id;mesh.visible=true;
      const width=w.kind==='lane'?w.length:w.radius*2,height=w.kind==='lane'?w.width:w.radius*2;
      mesh.position.set(w.x,.12,w.z);mesh.rotation.y=-w.angle;mesh.scale.set(width,1,height);
      u.color.value.setHex(w.color);u.size.value.set(width,height);u.shape.value=w.kind==='disk'?0:w.kind==='ring'?1:2;
      u.safeRadius.value=w.safeRadius;u.fired.value=w.remaining===0?1:0;u.progress.value=w.remaining===0?1:1-Math.min(1,w.remaining/w.duration);u.opacity.value=.65+.25*(1-Math.min(1,w.remaining/w.duration));
    }
    for(;index<this.slots.length;index++){this.slots[index].mesh.visible=false;this.slots[index].id=null;}
  }
  dispose() {
    if(this.disposed) return;this.disposed=true;this.group.removeFromParent();this.geometry.dispose();
    for(const slot of this.slots){slot.plain.dispose();slot.boss.dispose();}
  }
}
