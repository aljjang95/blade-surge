import {expect,test} from 'bun:test';
import * as THREE from 'three';
import {Battle} from '../src/game/apex-battle.js';
const noop=()=>{};
function fixture(art='flow'){
 const p:any={alive:true,knightLifeEpoch:0,maxHp:1000,hp:1000,atk:100,stats:{crit:0},pos:new THREE.Vector3(),addUlt:noop,cds:[8,0,0],def:{skills:[{}, {}, {}]}};
 const g:any=Object.create(Battle.prototype);
 Object.assign(g,{active:true,paused:false,pauseReasons:new Set(),input:{enabled:true,clear:noop},elapsed:3,stage:{idx:1},run:{enabled:true,settled:false,breaks:0},heroId:'knight',player:p,
  app:{arsenal:{artForHero:()=>art},reducedMotion:{matches:true}},effects:{},counterUntil:0,chainUntil:0,dmgDealt:0,combo:0,maxCombo:0,
  fx:{dmgLayer:{children:[]},damage:noop,shockTex:noop},ui:{setCombo:noop,toast:noop},timeCtl:{hitstop:noop}});
 const enemy=(x:number)=>({alive:true,spawning:false,hp:1000,breakT:1,posture:0,pos:new THREE.Vector3(x,0,2),radius:.5,def:{scale:1},receiveImpact:noop,hurt(d:number){this.hp-=d;return d;}});
 g.enemies=[enemy(0),enemy(.5),enemy(1),enemy(2)];g.bindCombatArt();p.skillCtx={cast:true,sk:{id:'test-skill'}};
 const arm=()=>g.comboLink.arm({token:{owner:p,epoch:0},source:p,player:p,enemy:g.enemies[0],now:g.elapsed});
 return {g,p,arm};
}
for(const reason of ['manual','companion','masterworks','native-background'])test(`${reason}: 일시정지 진입은 지난 연계를 취소하고 다른 정지 소유권을 보존한다`,()=>{
 const {g,p,arm}=fixture();expect(arm()).toBe(true);g.setPaused(reason,true);expect(g.comboLink.snapshot(g.elapsed,p).ready).toBe(false);
 g.setPaused('other-owner',true);g.setPaused(reason,false);expect(g.paused).toBe(true);expect(g.input.enabled).toBe(false);
 g.setPaused('other-owner',false);expect(g.paused).toBe(false);expect(g.onSkillReleased(p,p.skillCtx)).toBe(false);
 expect(arm()).toBe(true);expect(g.onSkillReleased(p,p.skillCtx)).toBe(true);
});
test('일시정지는 이미 소비한 연계의 8초 간격과 발동 횟수를 초기화하지 않는다',()=>{
 const {g,p,arm}=fixture();arm();expect(g.onSkillReleased(p,p.skillCtx)).toBe(true);const until=g.comboLink.cooldownUntil;
 g.setPaused('manual',true);g.setPaused('manual',false);expect(g.comboLink.cooldownUntil).toBe(until);expect(g.comboLink.activations).toBe(1);expect(arm()).toBe(false);
});
test('연계 파열은 원래 마무리 대상을 제외하고 가까운 다른 적 두 명만 실제로 타격한다',()=>{
 const {g,p,arm}=fixture('rupture');arm();expect(g.onSkillReleased(p,p.skillCtx)).toBe(true);
 expect(g.enemies[0].hp).toBe(1000);expect(g.enemies[1].hp).toBeLessThan(1000);expect(g.enemies[2].hp).toBeLessThan(1000);expect(g.enemies[3].hp).toBe(1000);expect(g.apex.procCount).toBe(1);
});
test('균형 파괴 파열도 원래 대상 제외와 다른 적 두 명 제한을 유지한다',()=>{
 const {g}=fixture('rupture');g.activateCombatArt(g.enemies[0]);expect(g.enemies[0].hp).toBe(1000);
 expect(g.enemies[1].hp).toBeLessThan(1000);expect(g.enemies[2].hp).toBeLessThan(1000);expect(g.enemies[3].hp).toBe(1000);
});
test('실제 피해 경로에서 발사 주체가 없거나 다르면 연계를 적립하지 않는다',()=>{
 const {g,p}=fixture();
 for(const source of [undefined,null,{}]){g.damageEnemy(g.enemies[0],10,{source,comboToken:{owner:p,epoch:0}});expect(g.comboLink.snapshot(g.elapsed,p).ready).toBe(false);}
 g.damageEnemy(g.enemies[0],10,{source:p,comboToken:{owner:p,epoch:0}});expect(g.comboLink.snapshot(g.elapsed,p).ready).toBe(true);
});
test('최신 가독성 투사체 잔상과 정확한 연계 cast 식별자가 함께 보존된다',()=>{
 const {g,p,arm}=fixture();g.projectiles=[];g.scene={add:noop};g.fx.contact=noop;g.feedbackCount=0;const trailColors:number[]=[];g.fx.embers=(_pos:any,color:number)=>trailColors.push(color);
 const token={owner:p,epoch:0};arm();expect(g.onSkillReleased(p,p.skillCtx)).toBe(true);
 g.spawnProjectile({pos:new THREE.Vector3(0,0,1.95),dir:new THREE.Vector3(0,0,1),speed:1,radius:1,dmg:20,owner:p,color:0xabcdef,visual:null,pierce:true,finisher:true,comboToken:token,skillCast:p.skillCtx});
 expect(g.projectiles[0].trail).toBe(0xabcdef);expect(g.projectiles[0].comboToken).toBe(token);expect(g.projectiles[0].skillCast).toBe(p.skillCtx);
 g.updateProjectiles(.01);expect(trailColors).toEqual([0xabcdef]);expect(g.apex.procCount).toBe(1);expect(g.enemies[0].hp).toBeLessThan(1000);
});
