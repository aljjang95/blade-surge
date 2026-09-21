import * as THREE from 'three';
import {audio} from '../engine/audio.js';
import {MOB_ROLES,MAX_MOB_ROLE_ATTACKS} from '../data/mob-roles.js';
import {hazardContains,hazardVertexShader,hazardFragmentShader} from './region-hazards.js';

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function segmentHit(ax,az,bx,bz,x,z,radius){
  const dx=bx-ax,dz=bz-az,len=dx*dx+dz*dz,t=len?clamp(((x-ax)*dx+(z-az)*dz)/len,0,1):0;
  return Math.hypot(x-ax-dx*t,z-az-dz*t)<=radius;
}
export function sweptRoleHit(shape,from,to,x,z){
  if(!hazardContains(shape,x,z))return false;
  return segmentHit(from.x,from.z,to.x,to.z,x,z,shape.width/2);
}

/** Enemy.stateT is the only clock. Role movement sweeps through the shared floor resolver. */
export class MobRole {
  constructor(enemy){
    this.enemy=enemy;this.key=enemy.def.meleeRole;this.def=MOB_ROLES[this.key];this.plan=null;this.hits=0;this.casts=0;
    this.path=new Float64Array(66);this.pathCount=0;
    this.impact=new THREE.Vector3();
    this.geometry=new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2);
    this.material=new THREE.ShaderMaterial({vertexShader:hazardVertexShader,fragmentShader:hazardFragmentShader,transparent:true,depthWrite:false,side:THREE.DoubleSide,
      uniforms:{color:{value:new THREE.Color(this.def.color)},size:{value:new THREE.Vector2()},shape:{value:0},safeRadius:{value:0},opacity:{value:.8},fired:{value:0}}});
    this.mesh=new THREE.Mesh(this.geometry,this.material);this.mesh.name=`mob-${this.key}-warning`;this.mesh.visible=false;this.mesh.renderOrder=4;enemy.game.scene.add(this.mesh);
  }
  available(distance){
    const e=this.enemy,g=e.game;
    return !this.disposed&&g.active&&!g.paused&&e.alive&&e.stun<=0&&distance<=this.def.reach&&
      (g.enemies||[]).filter(o=>o.alive&&o.mobRole?.plan).length<MAX_MOB_ROLE_ATTACKS;
  }
  clear(){this.plan=null;this.mesh.visible=false;}
  cancel(){
    const e=this.enemy;this.clear();e.vel.set(0,0,0);e.telegraph=0;e.attackDone=true;
    if(e.state==='attack'&&e.special?.startsWith('role:')){e.state='chase';e.atkCd=Math.max(e.atkCd,.6);}
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.clear();this.mesh.removeFromParent();this.geometry.dispose();this.material.dispose();}
  start(){
    const e=this.enemy,p=e.player,d=this.def;this.clear();
    const dx=p.pos.x-e.pos.x,dz=p.pos.z-e.pos.z,len=Math.hypot(dx,dz)||1,fx=dx/len,fz=dz/len;
    const plan={origin:e.pos.clone(),from:e.pos.clone(),fx,fz,shape:/** @type {{type:string,x:number,z:number,radius:number,width:number,length:number,angle:number,safeRadius:number}|null} */(null),struck:new Set(),fired:false,flanking:this.key==='flanker',strikeAt:d.windup,endAt:d.windup+d.travel+d.recovery,travelDistance:clamp(len+.8,2.5,8.5),moveX:0,moveZ:0,moving:false};
    e.state='attack';e.stateT=0;e.attackDone=false;e.special=`role:${this.key}`;e.telegraph=d.windup;e.vel.set(0,0,0);
    e.attackSequence=(e.attackSequence||0)+1;this.plan=plan;this.casts++;
    if(plan.flanking){
      const side=e.attackSequence%2===0?-1:1;
      plan.moveX=p.pos.x-fx*1.6+fz*side*1.9-e.pos.x;plan.moveZ=p.pos.z-fz*1.6-fx*side*1.9-e.pos.z;
      const travel=Math.hypot(plan.moveX,plan.moveZ);if(travel>4.5){plan.moveX*=4.5/travel;plan.moveZ*=4.5/travel;}
      e.faceDir(plan.moveX,plan.moveZ);e.play(e.A('run'),{fade:.1,speed:1.35});plan.strikeAt=d.travel+d.windup;plan.endAt=plan.strikeAt+d.recovery;
    }else this.lock();
    e.attackDur=plan.endAt;e.hitAt=plan.strikeAt/plan.endAt;
    return plan;
  }
  lock(){
    const e=this.enemy,d=this.def,p=this.plan;if(!p)return;
    if(this.key==='flanker'){
      const dx=e.player.pos.x-e.pos.x,dz=e.player.pos.z-e.pos.z,len=Math.hypot(dx,dz)||1;p.fx=dx/len;p.fz=dz/len;p.origin.copy(e.pos);
      p.strikeAt=e.stateT+d.windup;p.endAt=p.strikeAt+d.recovery;p.flanking=false;
    }
    e.faceDir(p.fx,p.fz);e.vel.set(0,0,0);e.attackDur=p.endAt;e.hitAt=p.strikeAt/p.endAt;
    const reach=this.key==='charger'?p.travelDistance/2:this.key==='crusher'?1.4:1.1;
    p.shape={type:this.key==='charger'?'lane':'disk',x:p.origin.x+p.fx*reach,z:p.origin.z+p.fz*reach,radius:d.radius||0,width:d.width||0,length:this.key==='charger'?p.travelDistance+d.width:0,angle:Math.atan2(p.fz,p.fx),safeRadius:0};
    const h=p.shape,w=h.type==='lane'?h.length:h.radius*2,z=h.type==='lane'?h.width:h.radius*2;
    this.mesh.position.set(h.x,.16,h.z);this.mesh.rotation.y=-h.angle;this.mesh.scale.set(w,1,z);this.mesh.visible=true;
    this.impact.set(h.x,.05,h.z);
    const u=this.material.uniforms;u.size.value.set(w,z);u.shape.value=h.type==='lane'?2:0;u.fired.value=0;u.opacity.value=.78;
    if(this.key==='charger')e.play(e.A('idleCombat'),{fade:.1});
    else e.playTimed(e.A(d.animation),d.windup+d.recovery,{fade:.1});
    audio.charge({vol:.1,dur:.3});
  }
  beforeStep(dt){
    const e=this.enemy,g=e.game,p=this.plan;if(!p)return;
    if(!e.alive||e.state!=='attack'||e.stun>0||!g.active||g.bossDefeated){this.cancel();return;}
    e.vel.set(0,0,0);p.from.copy(e.pos);p.moving=false;this.pathCount=1;this.path[0]=e.pos.x;this.path[1]=e.pos.z;
    if(g.paused||!Number.isFinite(dt)||dt<=0)return;
    let dx=0,dz=0;
    if(p.flanking){
      const fraction=(clamp(e.stateT+dt,0,this.def.travel)-clamp(e.stateT,0,this.def.travel))/this.def.travel;
      dx=p.moveX*fraction;dz=p.moveZ*fraction;
    }else if(this.key==='charger'){
      const moved=clamp(e.stateT+dt-p.strikeAt,0,this.def.travel)-clamp(e.stateT-p.strikeAt,0,this.def.travel);
      p.moving=moved>0;
      const distance=p.travelDistance*moved/this.def.travel*(e.slow?.5:1);dx=p.fx*distance;dz=p.fz*distance;
    }
    // Small swept intervals keep a stalled frame from jumping through a thin wall.
    // Damage later follows these resolved intervals, including wall slides, not their chord.
    const steps=Math.min(32,Math.ceil(Math.hypot(dx,dz)/.35));
    for(let i=0;i<steps;i++){
      const x=e.pos.x+dx/steps,z=e.pos.z+dz/steps;
      const next=g.world?g.world.resolve(e.pos.x,e.pos.z,x,z,(e.radius||.7)*.8):[x,z];e.pos.x=next[0];e.pos.z=next[1];
      this.path[this.pathCount*2]=e.pos.x;this.path[this.pathCount*2+1]=e.pos.z;this.pathCount++;
    }
  }
  update(){
    const e=this.enemy,g=e.game,p=this.plan;if(!p)return false;
    if(g.paused)return true;
    if(!e.alive||e.state!=='attack'||e.stun>0||!g.active||g.bossDefeated){this.cancel();return true;}
    const t=e.stateT,d=this.def;
    if(p.flanking){if(t>=d.travel)this.lock();return true;}
    e.telegraph=Math.max(0,p.strikeAt-t);
    const travel=this.key==='charger'?d.travel:0,active=t>=p.strikeAt&&(!p.fired||this.key==='charger'&&p.moving);
    if(active){
      const first=!p.fired;p.fired=true;e.attackDone=true;this.material.uniforms.fired.value=1;
      const players=new Set(g.stage?.party?g.app.party.livingPlayers():[e.player]);
      for(const player of players){
        if(!player?.alive||p.struck.has(player)||!hazardContains(p.shape,player.pos.x,player.pos.z))continue;
        if(this.key==='charger'){
          let crossed=false;for(let i=1;i<this.pathCount&&!crossed;i++)crossed=segmentHit(this.path[(i-1)*2],this.path[(i-1)*2+1],this.path[i*2],this.path[i*2+1],player.pos.x,player.pos.z,p.shape.width/2);
          if(!crossed)continue;
        }
        p.struck.add(player);const dealt=player.hurt(e.atk*d.damage,{dirx:p.fx,dirz:p.fz,kb:d.kb,kind:'blunt'});if(dealt)this.hits++;
      }
      if(first){
        audio.enemyRelease({kind:this.key,boss:e.isBoss,heavy:this.key==='crusher'});
        if(this.key==='charger')e.play(e.A('run'),{fade:.04,speed:1.8});
        else {
          g.fx.shockTex(this.impact,d.color,{r1:d.radius,life:.3});
          if(this.key==='crusher'){g.fx.dustPuff?.(this.impact,{size:2.6,life:.3});g.renderer?.shake?.(.12);audio.boom({vol:.22,dur:.25,low:80});}
          else audio.whoosh({vol:.18,pitch:1.25,dur:.18});
        }
      }
    }
    const recovery=t>=p.strikeAt+travel;
    this.mesh.visible=!recovery||t<p.strikeAt+travel+.2;this.material.uniforms.opacity.value=recovery?Math.max(0,.8-(t-p.strikeAt-travel)*4):.78;
    if(recovery){e.vel.set(0,0,0);if(!p.recovering&&this.key==='charger')e.play(e.A('idleCombat'),{fade:.08});p.recovering=true;}
    if(t>=p.endAt){this.clear();e.state='chase';e.atkCd=d.cooldown;e.telegraph=0;e.play(e.A('idleCombat'),{fade:.12});}
    return true;
  }
  warnings(){
    const e=this.enemy,p=this.plan;if(!p?.shape||!e.alive||e.state!=='attack'||e.stun>0)return [];
    const end=p.strikeAt+(this.key==='charger'?this.def.travel:0);if(e.stateT>end+.2)return [];
    const h=p.shape;return [{id:`${e.partyId||'mob'}:${e.attackSequence}:role`,kind:h.type,x:h.x,z:h.z,radius:h.radius,width:h.width,length:h.length,angle:h.angle,safeRadius:0,remaining:Math.max(0,p.strikeAt-e.stateT),duration:this.def.windup,color:this.def.color}];
  }
}
