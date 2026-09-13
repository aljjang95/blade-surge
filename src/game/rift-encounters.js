import * as THREE from 'three';
import { hazardContains } from './region-hazards.js';

export const RIFT_REINFORCEMENT = 'rift-reinforcement:';
export const isRiftDungeon = stage => !stage?.party && stage?.expedition?.kind === 'dungeon' && ['iron','fury','siege'].includes(stage.riftId);

/** One warning / one priority marker. Time advances only with the battle clock. */
export class RiftEncounters {
  constructor(game) {
    this.game=game;this.rule=isRiftDungeon(game.stage)?game.stage.riftId:null;
    this.room=null;this.seen=new WeakSet();this.siegeRooms=new WeakMap();this.cooldown=2.5;this.warning=null;this.leader=null;this.called=0;this.resolved=0;
    this.group=new THREE.Group();this.group.name='rift-encounters';game.scene.add(this.group);
    const flat=geometry=>{geometry.rotateX(-Math.PI/2);return geometry;};
    this.disk=new THREE.Mesh(flat(new THREE.CircleGeometry(3,64)),new THREE.MeshBasicMaterial({color:0xff5533,transparent:true,opacity:.3,depthWrite:false,side:THREE.DoubleSide}));
    this.edge=new THREE.Mesh(flat(new THREE.RingGeometry(2.9,3,64)),new THREE.MeshBasicMaterial({color:0xffaa66,transparent:true,opacity:.95,depthWrite:false,side:THREE.DoubleSide}));
    this.marker=new THREE.Mesh(flat(new THREE.RingGeometry(1.3,1.65,40)),new THREE.MeshBasicMaterial({color:0xffd244,transparent:true,opacity:1,depthWrite:false,side:THREE.DoubleSide}));
    this.group.add(this.disk,this.edge,this.marker);this.hide();
    if(this.rule==='iron')game.ui.toast('철갑 · 연속타와 마무리로 BREAK를 만들고 반격하세요','gold');
  }
  hide(){this.warning=null;this.disk.visible=this.edge.visible=this.marker.visible=false;}
  dispose(){if(this.disposed)return;this.disposed=true;this.hide();this.group.removeFromParent();for(const mesh of [this.disk,this.edge,this.marker]){mesh.geometry.dispose();mesh.material.dispose();}}
  enemies(room){return this.game.enemies.filter(e=>e.alive&&!e.spawning&&e.homeRoom===room&&!e.riftReinforcement);}
  startWarning(source){
    const p=this.game.player;this.warning={type:'disk',x:p.pos.x,z:p.pos.z,radius:3,age:0,delay:1.4,source,hit:false};
    for(const m of [this.disk,this.edge]){m.position.set(p.pos.x,.13,p.pos.z);m.visible=true;}
    source.stun=Math.max(source.stun||0,1.4);source.attackDone=true;source.telegraph=0;
    this.game.ui.toast('맹공 · 붉은 원 밖으로 이동 → 시전자 반격','red');
  }
  update(dt){
    const g=this.game;
    if(this.disposed||!this.rule||!g.active||g.run?.settled||g.bossDefeated||!g.player?.alive){this.hide();return;}
    if(g.paused||!Number.isFinite(dt)||dt<=0)return;
    const room=g.world?.roomAt(g.player.pos.x,g.player.pos.z);
    if(room!==this.room){
      if(this.rule==='siege'&&this.room)this.siegeRooms.set(this.room,{leader:this.leader,countdown:this.countdown});
      const saved=room&&this.siegeRooms.get(room);
      this.room=room;this.cooldown=2.5;this.leader=saved?.leader||null;this.countdown=saved?.countdown;this.hide();
    }
    if(!room||!room.spawned||room.cleared||['start','treasure'].includes(room.type)){this.hide();return;}
    if(this.rule==='fury'){
      const warning=this.warning;
      if(warning){
        if(!warning.source.alive){this.hide();return;}
        warning.age+=dt;this.disk.material.opacity=warning.hit?.55:.2+.25*Math.min(1,warning.age/warning.delay);
        if(!warning.hit&&warning.age>=warning.delay){
          warning.hit=true;this.resolved++;
          const p=g.player,inside=hazardContains(warning,p.pos.x,p.pos.z);
          const hit=inside?p.hurt(p.maxHp*.08,{kind:'magic',kb:2,dirx:p.pos.x-warning.x||.1,dirz:p.pos.z-warning.z||.1}):0;
          if(!hit&&warning.source.alive){const source=warning.source;source.breakT=Math.max(source.breakT||0,2.5);source.stun=Math.max(source.stun||0,2.5);source.guardBroken=Math.max(source.guardBroken||0,2.5);source.attackDone=true;source.telegraph=0;g.ui.toast('맹공을 피했습니다 · 시전자 BREAK 2.5초','gold');}
        }
        if(warning.age>=warning.delay+.35)this.hide();
      }else{
        this.cooldown-=dt;const enemies=this.enemies(room);
        if(this.cooldown<=0&&enemies.length){this.startWarning(enemies.find(e=>e.def?.ranged)||enemies[0]);this.cooldown=6;}
      }
    }else if(this.rule==='siege'){
      if(!this.seen.has(room)){
        const enemies=this.enemies(room);if(!enemies.length)return;
        this.seen.add(room);this.leader=enemies.find(e=>e.def?.ranged)||enemies[0];this.countdown=5;
        g.ui.toast('포위 · 금빛 고리 전령을 5초 안에 처치하세요','gold');
      }
      if(this.leader){
        if(!this.leader.alive){this.marker.visible=false;this.leader=null;g.ui.toast('전령 처치 · 증원 차단','gold');return;}
        this.marker.visible=true;this.marker.position.copy(this.leader.pos);this.marker.position.y=.16;this.marker.rotation.y+=dt*2;
        this.countdown-=dt;
        if(this.countdown<=0){
          const type=g.stage.rosterFor?.().trash[0];
          if(type){for(let i=0;i<2;i++)g.pending.push({t:RIFT_REINFORCEMENT+type,room});this.called+=2;g.ui.toast('전령의 증원 2명 · 추가 처치 보상 없음','red');}
          this.leader=null;this.marker.visible=false;
        }
      }
      // Existing pending queue owns room completion. Only drain our jobs here.
      if(g.enemies.filter(e=>e.alive).length<g.maxAlive){const i=g.pending.findIndex(n=>n.room===room&&n.t.startsWith(RIFT_REINFORCEMENT));if(i>=0){const n=g.pending.splice(i,1)[0];g.spawnEnemy(n.t,null,n.room);}}
    }
  }
}
