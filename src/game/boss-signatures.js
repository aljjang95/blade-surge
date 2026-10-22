import * as THREE from 'three';
import { BOSS_SIGNATURES } from '../data/boss-encounters.js';
import { frontierEffectForStage } from '../data/seasonal-content.js';
import { hazardContains, hazardVertexShader } from './region-hazards.js';
import { audio } from '../engine/audio.js';

export const BOSS_SIGNATURE_CAPACITY = 6;
/** 보스 고유기 예고 전용 바닥 셰이더(일반 블렌딩). 판정 도형·크기·경고 시간은 그대로이고 그리는 법만 다르다.
 *  - 경계는 미터 단위 두께(.4m, 바깥 .11m 는 밝은 주황 테)로 어떤 크기에서도 같은 굵기, 정체성 색과 위험 적색을 70% 섞는다.
 *  - 경계 바로 안쪽에 어두운 띠(.4~.78m)를 깔아 밝은 청록·보라 바닥에서도 테두리가 떠 보이게 한다.
 *  - 남은 시간 채움은 진행할수록 적색 쪽으로 짙어지고(35%→80%), 진행 앞에는 밝은 주황 선이 선다.
 *  - 마지막 22% 는 경계가 주황↔적색으로 세 번 맥동하고 채움이 진해진다(progress 기반이라 결정적이다). */
export const bossSignatureFragmentShader = `
  varying vec2 vUv;
  uniform vec3 color;
  uniform vec2 size;
  uniform float shape, safeRadius, opacity, fired, progress;
  void main(){
    vec2 p=(vUv-.5)*size; float r=length(p), d, along;
    if(r<safeRadius)discard;
    if(shape<1.5){
      float R=size.x*.5; if(r>R)discard;
      if(shape>.5){float r0=R*.78; if(r<r0)discard; d=min(R-r,r-r0); along=(r-r0)/max(R-r0,.001);}
      else{d=R-r; along=r/R;}
    } else {
      vec2 h=size*.5-abs(p); d=min(h.x,h.y); along=vUv.x;
    }
    if(safeRadius>0.)d=min(d,r-safeRadius);
    float edge=1.-step(.4,d), band=step(.4,d)*(1.-step(.78,d)), lip=1.-step(.11,d);
    float stripe=step(.72,fract((p.x+p.y)*.6));
    float fill=(1.-step(progress,along))*(1.-fired);
    float front=exp(-pow((along-progress)/.035,2.))*step(.01,progress)*(1.-fired);
    float urgent=smoothstep(.78,1.,progress)*(1.-fired);
    float pulse=urgent*(.5+.5*sin(progress*85.));
    vec3 danger=vec3(1.,.2,.12);
    vec3 rim=mix(mix(color,danger,.7),vec3(1.,.62,.28),pulse*.7);
    vec3 body=mix(color,danger,.35+.45*progress);
    // 붉은 정체성 색(가마 0xff713d·도르래 0xff3355)은 붉은 바닥 위라 적색 채움이 묻힌다: 채움을 짙은 진홍으로 어둡게, 경계는 노란 열기로.
    float warm=step(.85,color.r)*(1.-step(.5,color.g));
    body=mix(body,mix(vec3(.32,.04,.03),vec3(.16,.02,.02),progress),warm);
    rim=mix(rim,mix(vec3(1.,.86,.32),vec3(1.,.96,.6),pulse),warm);
    vec3 c=body;
    c=mix(c,vec3(.06,.02,.02),band);
    c=mix(c,vec3(1.,.72,.42),clamp(front*.75,0.,1.));
    c=mix(c,rim,edge);
    // 가장 바깥 .11m 는 밝은 주황 테: 붉은 바닥(가마)에서도 경계가 떠 보인다.
    c=mix(c,vec3(1.,.74,.42),lip*(1.-fired));
    float a=.14+stripe*.08*(1.-fill)+fill*(.3+urgent*.16+warm*.18)+band*.55+front*.55+edge*(.85+pulse*.15)+fired*.3;
    gl_FragColor=vec4(c,clamp(opacity*a,0.,1.));
  }`;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const targetInRoom = (p, r, margin=3) => ({x:clamp(p.x,r.x-r.w/2+margin,r.x+r.w/2-margin),z:clamp(p.z,r.z-r.h/2+margin,r.z+r.h/2-margin)});

/** @typedef {{x:number,z:number}} GroundPoint */
/** @typedef {GroundPoint & {type:string,angle:number,safeRadius:number,radius:number,width:number,length:number,at:number,warnAt:number,damage:number,push:number,slow?:number}} SignatureEvent */
/** @typedef {{key:string,name:string,cue:string,color:number,anim:string,events:SignatureEvent[],lastStrike:number,duration:number}} SignaturePlan */
/** Frozen cast geometry: the mesh, party warning and hurt all consume these events.
 * @param {string} key
 * @param {{room?:GroundPoint & {w:number,h:number},origin:GroundPoint,target:GroundPoint,history?:GroundPoint[],phase?:number,turn?:number}} options
 * @returns {SignaturePlan|null}
 */
export function planBossSignature(key, {room,origin,target,history=[],phase=0,turn=0}) {
  const definition=BOSS_SIGNATURES[key]; if(!definition)return null;
  const r=room||{x:origin.x,z:origin.z,w:24,h:24}, short=Math.min(r.w,r.h);
  const o=targetInRoom(origin,r),p=targetInRoom(target,r),events=[];
  const add=(type,position,at,options={})=>events.push({type,x:position.x,z:position.z,angle:0,safeRadius:0,radius:0,width:0,length:0,at,warnAt:Math.max(0,at-1.35),damage:1.1,push:3,...options});
  const ring=(position,radius,at,options={})=>add('ring',position,at,{radius,...options});
  const disk=(position,radius,at,options={})=>add('disk',position,at,{radius,...options});
  const lane=(position,length,width,angle,at,options={})=>add('lane',position,at,{length,width,angle,...options});
  const angle=Math.atan2(p.z-o.z,p.x-o.x),side={x:-Math.sin(angle),z:Math.cos(angle)};
  if(key==='bell_toll') {
    const radii=[3.8,6.2,Math.min(short*.44,8.8)];if(phase===2)radii.reverse();
    radii.forEach((radius,i)=>ring(o,radius,1.35+i*.85));
  } else if(key==='bell_clap') {
    for(const direction of [-1,1])disk(targetInRoom({x:o.x+side.x*4*direction,z:o.z+side.z*4*direction},r),2.8,1.4);
    disk(o,3.1,2.65);if(phase>0)ring(o,7.2,3.7);
  } else if(key==='kiln_vents') {
    const rotate=(turn+phase)%2, horizontal=rotate===0;
    for(const [i,offset] of [0,-1,1].entries())lane({x:r.x+(horizontal?0:offset*r.w*.28),z:r.z+(horizontal?offset*r.h*.28:0)},(horizontal?r.w:r.h)-2,2.8,horizontal?0:Math.PI/2,1.35+i*.7);
    if(phase===2)lane(r,short-2,2.6,horizontal?Math.PI/2:0,3.6);
  } else if(key==='kiln_hammer') {
    disk(p,3,1.35,{damage:1.35});ring(p,5.8,2.65);if(phase>0)ring(p,8.4,3.6);
  } else if(key==='archive_retrace') {
    const count=phase===2?4:3,points=[p,...history.slice(-3).reverse().map(q=>targetInRoom(q,r))];
    for(let i=0;i<count;i++)disk(points[i]||p,2.3,1.35+i*.8,{slow:1.1});
  } else if(key==='archive_hourglass') {
    ring(p,6,1.35,{slow:1.1});disk(p,3.7,2.6,{slow:1.1});ring(p,6,3.85,{slow:1.1});
  } else if(key==='tide_sweep') {
    const horizontal=(turn+phase)%2===0,order=phase===2?[1,0,-1]:[-1,0,1];
    order.forEach((offset,i)=>lane({x:r.x+(horizontal?0:offset*r.w*.28),z:r.z+(horizontal?offset*r.h*.28:0)},(horizontal?r.w:r.h)-2,3.4,horizontal?0:Math.PI/2,1.35+i*.9,{push:6}));
  } else if(key==='tide_undertow') {
    [Math.min(short*.44,9),6,3.8].forEach((radius,i)=>ring(o,radius,1.4+i*.9,{push:5}));
    if(phase===2)disk(o,2.8,4.15,{push:5});
  } else if(key==='crown_orbit') {
    const rotation=(turn%2)*Math.PI/4;
    for(let i=0;i<3;i++)lane(o,short-1,2.8,rotation+i*Math.PI/3,1.35+i*.85,{safeRadius:2.6});
    if(phase===2)disk(o,2.6,4.1);
  } else if(key==='crown_verdict') {
    for(const direction of [-1,1])disk(targetInRoom({x:p.x+side.x*3.6*direction,z:p.z+side.z*3.6*direction},r),2.5,1.35);
    lane(p,short-2,3,angle,2.65);if(phase>0)lane(p,short-2,3,angle+Math.PI/2,3.85);
  } else if(key==='oath_tethers') {
    const points=[p,targetInRoom(history[0]||{x:p.x+side.x*5,z:p.z+side.z*5},r)];
    if(phase===2)points.push(targetInRoom({x:p.x-side.x*5,z:p.z-side.z*5},r));
    points.forEach((q,i)=>{const dx=q.x-o.x,dz=q.z-o.z;lane({x:(o.x+q.x)/2,z:(o.z+q.z)/2},Math.hypot(dx,dz)+3,2.6,Math.atan2(dz,dx),1.35+i*1.05);});
  } else if(key==='oath_shelter') {
    // A moving safe centre, reachable in each full 1.6-second telegraph window.
    const anchor=targetInRoom(p,r),direction=anchor.x>=r.x?-1:1;
    const points=[anchor,targetInRoom({x:anchor.x+direction*6.4,z:anchor.z},r)];
    if(phase===2)points.push(targetInRoom({x:points[1].x,z:anchor.z+(anchor.z>=r.z?-1:1)*6.4},r));
    points.forEach((q,i)=>disk(q,short*.7,1.8+i*1.6,{safeRadius:2.6,warnAt:Math.max(0,i*1.6),damage:1.2}));
  } else if(key==='tidegate_flood') {
    // 빙하 수문 범람: 거신이 선 마른 수로를 사이에 두고 먼 쪽 수문이 먼저, 플레이어 쪽 수문이 나중에 잠긴다.
    // 먼저 잠긴 쪽은 다음 물결 때 이미 빠진 물이라 안전하다. 마지막 페이즈는 수로가 좁아지고 먼 쪽이 한 번 더 잠긴다.
    const horizontal=(turn+phase)%2===0,half=(horizontal?r.h:r.w)/2,along=(horizontal?r.w:r.h)-2,centre=horizontal?r.z:r.x;
    const channelWidth=phase===2?3.6:4.4,channel=centre+clamp((horizontal?o.z:o.x)-centre,-half*.45,half*.45);
    const near=(horizontal?p.z:p.x)<channel?-1:1;
    const flood=(side,at)=>{
      const from=side<0?centre-half+1:channel+channelWidth/2,to=side<0?channel-channelWidth/2:centre+half-1,mid=(from+to)/2;
      lane(horizontal?{x:r.x,z:mid}:{x:mid,z:r.z},along,to-from,horizontal?0:Math.PI/2,at,{push:5});
    };
    flood(-near,1.4);flood(near,2.5);if(phase===2)flood(-near,3.6);
  } else if(key==='tidegate_ring_gap') {
    // 원형 마당의 물결 고리: 바깥 물결과 가운데 소용돌이가 함께 친 뒤 그 사이 빈 고리를 가운데 물결이 덮는다.
    const centre={x:r.x,z:r.z},outer=Math.min(short*.46,13.5),core=outer*.36;
    ring(centre,outer,1.4,{push:5});disk(centre,core,1.4,{push:5});
    ring(centre,outer*.72,2.7,{push:5});if(phase>0)ring(centre,outer,2.7,{push:5});
    if(phase===2)disk(centre,core,3.9,{push:5});
  } else if(key==='pulley_ore_fall') {
    // 도르래가 마당 둘레를 돌며 광석 상자를 차례로 떨어뜨리고, 마지막 상자는 시전 순간 플레이어가 서 있던 자리로 온다.
    const centre={x:r.x,z:r.z},radius=Math.min(short*.3,7.5),count=phase===0?3:4,turnSign=turn%2?-1:1;
    const start=Math.atan2(p.z-centre.z,p.x-centre.x)+turnSign*Math.PI/2;
    for(let i=0;i<count;i++){const a=start+turnSign*i*Math.PI*2/(count+1);disk(targetInRoom({x:centre.x+Math.cos(a)*radius,z:centre.z+Math.sin(a)*radius},r),2.6,1.35+i*.45);}
    disk(p,phase===2?3:2.6,1.7+count*.45,{damage:1.25,push:4});
  } else if(key==='pulley_chain_line') {
    // 북쪽(화면 위쪽) 두 도르래에서 사슬이 시전 순간의 플레이어 자리를 지나 반대편 끝까지 당겨진다.
    const anchors=[{x:r.x-r.w*.3,z:r.z-r.h/2+1},{x:r.x+r.w*.3,z:r.z-r.h/2+1}];
    const chain=(a,at)=>{
      const dx=p.x-a.x,dz=p.z-a.z,distance=Math.hypot(dx,dz)||1,ux=dx/distance,uz=dz/distance;
      const tx=ux>0?(r.x+r.w/2-1-a.x)/ux:ux<0?(r.x-r.w/2+1-a.x)/ux:Infinity,tz=uz>0?(r.z+r.h/2-1-a.z)/uz:uz<0?(r.z-r.h/2+1-a.z)/uz:Infinity;
      const end=Math.max(distance,Math.min(tx,tz));
      lane({x:a.x+ux*end/2,z:a.z+uz*end/2},end,2.6,Math.atan2(uz,ux),at,{push:4});
    };
    const first=(turn+phase)%2;
    chain(anchors[first],1.45);chain(anchors[1-first],phase===2?1.45:2.6);
    if(phase>0){const dx=p.x-o.x,dz=p.z-o.z;lane({x:(o.x+p.x)/2,z:(o.z+p.z)/2},Math.hypot(dx,dz)+3,2.6,Math.atan2(dz,dx),phase===2?2.75:3.7,{push:4});}
  }
  if(!events.length||events.length>BOSS_SIGNATURE_CAPACITY)throw Error(`Invalid signature budget: ${key}`);
  const lastStrike=Math.max(...events.map(e=>e.at));
  return {key,...definition,events,lastStrike,duration:lastStrike+1.05};
}

/** One clock (Enemy.stateT), one fixed pool per boss. Never simulates a party guest. */
export class BossSignatures {
  constructor(enemy) {
    this.enemy=enemy;this.plan=/** @type {SignaturePlan|null} */(null);this.age=0;this.history=/** @type {GroundPoint[]} */([]);this.historyClock=0;this.fired=0;this.hits=0;
    this.group=new THREE.Group();this.group.name='boss-signatures';enemy.game.scene.add(this.group);
    this.geometry=new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2);
    this.slots=Array.from({length:BOSS_SIGNATURE_CAPACITY},()=>{
      const material=new THREE.ShaderMaterial({vertexShader:hazardVertexShader,fragmentShader:bossSignatureFragmentShader,transparent:true,depthWrite:false,side:THREE.DoubleSide,
        uniforms:{color:{value:new THREE.Color()},size:{value:new THREE.Vector2()},shape:{value:0},safeRadius:{value:0},opacity:{value:.8},fired:{value:0},progress:{value:0}}});
      const mesh=new THREE.Mesh(this.geometry,material);mesh.visible=false;mesh.renderOrder=3;this.group.add(mesh);
      return {mesh,event:/** @type {SignatureEvent|null} */(null),hit:false};
    });
  }
  remember(dt) {
    this.historyClock+=dt;if(this.historyClock<.6)return;this.historyClock%=.6;
    const p=this.enemy.player?.pos;if(!p)return;
    this.history.push({x:p.x,z:p.z});if(this.history.length>3)this.history.shift();
  }
  clear(){this.plan=null;for(const s of this.slots){s.event=null;s.mesh.visible=false;}}
  dispose(){if(this.disposed)return;this.disposed=true;this.clear();this.group.removeFromParent();this.geometry.dispose();for(const s of this.slots)s.mesh.material.dispose();}
  start(key) {
    this.clear();const e=this.enemy,g=e.game;
    const plan=planBossSignature(key,{room:e.homeRoom,origin:e.pos,target:e.player.pos,history:this.history,phase:e.phase,turn:e.patternTurn});
    if(!plan)throw Error(`Unknown boss signature: ${key}`);
    const frontier=frontierEffectForStage(g.stage);
    const lead=frontier?.kind==='bossSignatureLead'||frontier?.kind==='telegraphLead'?frontier.value:0;
    // Keep every warning's start, including the first at zero, and delay actual strikes.
    this.plan={...plan,color:frontier?.kind==='warningColor'?frontier.value:plan.color,
      events:plan.events.map(event=>({...event,at:event.at+lead})),lastStrike:plan.lastStrike+lead,duration:plan.duration+lead};this.age=0;
    for(let i=0;i<this.plan.events.length;i++){
      const s=this.slots[i],h=this.plan.events[i],m=s.mesh,u=m.material.uniforms;s.event=h;s.hit=false;
      const width=h.type==='lane'?h.length:h.radius*2,height=h.type==='lane'?h.width:h.radius*2;
      m.position.set(h.x,.14,h.z);m.rotation.y=-h.angle;m.scale.set(width,1,height);
      u.size.value.set(width,height);u.color.value.setHex(this.plan.color);u.shape.value=h.type==='disk'?0:h.type==='ring'?1:2;u.safeRadius.value=h.safeRadius;u.fired.value=0;u.opacity.value=.8;u.progress.value=0;
      m.visible=h.warnAt===0;
    }
    g.ui.toast(`${this.plan.name} · ${this.plan.cue}`,'red',{replaceUrgent:true});
    audio.charge({vol:.25,dur:.55});return this.plan;
  }
  warnings() {
    if(!this.plan)return [];
    return this.slots.flatMap((s,i)=>{const h=s.event;if(!h||this.age<h.warnAt||this.age>h.at+.35)return [];
      return [{id:`${this.enemy.partyId||'boss'}:${this.enemy.attackSequence}:signature:${i}`,kind:h.type,x:h.x,z:h.z,radius:h.radius,width:h.width,length:h.length,angle:h.angle,safeRadius:h.safeRadius,remaining:Math.max(0,h.at-this.age),duration:h.at-h.warnAt,color:this.plan.color}];});
  }
  update(age) {
    const e=this.enemy,g=e.game;if(!this.plan||this.disposed||g.paused)return;
    if(!e.alive||e.state!=='attack'||e.stun>0||!g.active||g.bossDefeated){this.clear();return;}
    if(!Number.isFinite(age)||age<this.age)return;
    this.age=age;let struck;
    for(const s of this.slots){
      const h=s.event;if(!h)continue;s.mesh.visible=age>=h.warnAt&&age<=h.at+.35;
      const u=s.mesh.material.uniforms;u.fired.value=age>=h.at?1:0;u.progress.value=age>=h.at?1:clamp((age-h.warnAt)/Math.max(h.at-h.warnAt,1e-3),0,1);u.opacity.value=age>=h.at?Math.max(0,1-(age-h.at)/.35):.65+.25*clamp((age-h.warnAt)/(h.at-h.warnAt),0,1);
      if(age<h.at||s.hit)continue;s.hit=true;this.fired++;
      struck??=new Map();
      const targets=new Set(g.stage?.party?g.app.party.livingPlayers():[g.player]);
      if(!struck.has(h.at))struck.set(h.at,new Set());
      for(const p of targets){if(!p?.alive||struck.get(h.at).has(p)||!hazardContains(h,p.pos.x,p.pos.z))continue;
        struck.get(h.at).add(p);const hit=p.hurt(e.atk*h.damage,{dirx:p.pos.x-h.x||.1,dirz:p.pos.z-h.z||.1,kb:h.push,kind:'magic'});
        if(hit){this.hits++;if(h.slow){p.slow=.5;p.slowT=Math.max(p.slowT||0,h.slow);}}
      }
      // Small, pooled impact accents; the floor warning remains the readable authority.
      if(h.type==='disk'&&!h.safeRadius)g.fx.shockTex?.(new THREE.Vector3(h.x,0,h.z),this.plan.color,{r0:.2,r1:h.radius,life:.3});
    }
    if(!e.attackDone&&age>=this.plan.lastStrike){
      e.attackDone=true;e.completedAttackSequence=e.attackSequence;e.telegraph=0;
      g.fx.damage?.(e.pos,0,{text:'반격 기회'});audio.play('hit_bell',{vol:.18,rate:1.4});
    } else if(!e.attackDone)e.telegraph=Math.max(0,this.plan.lastStrike-age);
  }
}
