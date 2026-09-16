import {expect,test} from 'bun:test';import * as THREE from 'three';
import {Battle} from '../src/game/apex-battle.js';import {SKILLS} from '../src/game/skills.js';
const noop=()=>{};
function fixture(){
 const g:any=Object.create(Battle.prototype),p:any={alive:true,knightLifeEpoch:0,maxHp:1000,hp:1000,atk:100,stats:{crit:0},pos:new THREE.Vector3(),yaw:0,addUlt:noop,playTimed:noop,forward:(v:any)=>v.set(0,0,1),vel:new THREE.Vector3()};
 Object.assign(g,{active:true,paused:false,elapsed:3,stage:{idx:1},run:{enabled:true,settled:false,breaks:0},heroId:'rogue',player:p,app:{arsenal:{artForHero:()=> 'flow'},reducedMotion:{matches:true}},effects:{},enemies:[],counterUntil:0,chainUntil:0,dmgDealt:0,combo:0,maxCombo:0,
 fx:{dmgLayer:{children:[]},damage:noop,shockTex:noop,slashSprite:noop,ghost:noop,explosion:noop},renderer:{shake:noop},ui:{setCombo:noop,toast:noop},timeCtl:{hitstop:noop},vacuum:noop});
 g.bindCombatArt();g.emissions=0;const art=g.activateCombatArt;g.activateCombatArt=function(e:any){this.emissions++;this.comboLink.cancel();};
 p.skillCtx={cast:true,sk:{id:'flurry'},t:1.1,data:{tick:0,n:9},dmg:20};const enemy=(x:number)=>({alive:true,spawning:false,hp:1000,breakT:1,posture:0,pos:new THREE.Vector3(x,0,2),radius:.5,def:{scale:1},receiveImpact:noop,hurt(d:number){this.hp-=d;return d;}});
 g.enemies=[enemy(0),enemy(.5)];g.comboLink.arm({source:p,player:p,enemy:g.enemies[0],now:3,token:{owner:p,epoch:0}});return {g,p};
}
test('real Rogue flurry tail cannot activate a second art after the same cast used linkage',()=>{
 const {g,p}=fixture();expect(g.onSkillReleased(p,p.skillCtx)).toBe(true);expect(g.emissions).toBe(1);
 SKILLS.flurry.update(g,p,p.skillCtx,.12);expect(g.emissions).toBe(1);
});
test('a linked skill context cannot consume arts again on two broken targets',()=>{
 const {g,p}=fixture();g.onSkillReleased(p,p.skillCtx);
 for(const e of g.enemies)g.damageEnemy(e,20,{source:p,finisher:true,skillCast:p.skillCtx});
 expect(g.emissions).toBe(1);expect(g.enemies.every((e:any)=>e.hp<1000)).toBe(true);
});
test('delayed projectile forwards exact skill identity without suppressing its damage',()=>{
 const {g,p}=fixture();g.projectiles=[];g.scene={add:noop};g.elapsed=3;g.onSkillReleased(p,p.skillCtx);
 g.spawnProjectile({pos:new THREE.Vector3(0,0,1.95),dir:new THREE.Vector3(0,0,1),speed:1,radius:1,dmg:20,owner:p,color:0xffffff,visual:null,pierce:true,finisher:true,skillCast:p.skillCtx});
 expect(g.projectiles[0].skillCast).toBe(p.skillCtx);g.updateProjectiles(.01);expect(g.emissions).toBe(1);expect(g.enemies.every((e:any)=>e.hp<1000)).toBe(true);
});
test('unrelated basic finisher retains the preexisting break-art path',()=>{
 const {g,p}=fixture();g.onSkillReleased(p,p.skillCtx);g.damageEnemy(g.enemies[0],20,{source:p,finisher:true});expect(g.emissions).toBe(2);
});
