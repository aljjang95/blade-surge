import {expect,test} from 'bun:test';
import * as THREE from 'three';
import {ComboLink,COMBO_LINK_WINDOW,COMBO_LINK_COOLDOWN} from '../src/game/combo-link.js';
import {Battle} from '../src/game/apex-battle.js';
const make=()=>{const player:any={alive:true,knightLifeEpoch:0,pos:new THREE.Vector3()},enemy={pos:new THREE.Vector3(1,0,1)};return {player,enemy,token:{owner:player,epoch:0},source:player,now:1};};
test('one landed finisher creates one three-second opportunity, not one per enemy',()=>{
 const l=new ComboLink(),f=make();expect(l.arm(f)).toBe(true);expect(l.arm({...f,now:2})).toBe(false);expect(l.snapshot(3.999,f.player).ready).toBe(true);expect(l.snapshot(4,f.player).ready).toBe(false);expect(COMBO_LINK_WINDOW).toBe(3);
});
test('valid skill consumes the token once and enforces eight active seconds',()=>{
 const l=new ComboLink(),f=make(),context={cast:true,sk:{}};l.arm(f);expect(l.consume({player:f.player,context,now:2})).not.toBeNull();expect(l.consume({player:f.player,context,now:2})).toBeNull();
 expect(l.activations).toBe(1);expect(l.arm({...f,token:{owner:f.player,epoch:0},now:9.99})).toBe(false);expect(l.arm({...f,token:{owner:f.player,epoch:0},now:10})).toBe(true);expect(COMBO_LINK_COOLDOWN).toBe(8);
});
test('source, life and real-time fields reject stale or foreign finishers',()=>{
 for(const change of [{token:{}},{source:{}},{now:NaN},{now:Infinity},{token:null}]){const l=new ComboLink(),f=make();expect(l.arm({...f,...change})).toBe(false);}
 const l=new ComboLink(),f=make();l.arm(f);f.player.alive=false;expect(l.snapshot(2,f.player).ready).toBe(false);f.player.alive=true;f.player.knightLifeEpoch++;expect(l.snapshot(2,f.player).ready).toBe(false);
});
test('unreleased, ultimate and awakened casts do not consume the opportunity',()=>{
 const l=new ComboLink(),f=make();l.arm(f);for(const context of [{cast:false,sk:{}},{cast:true,sk:{ult:true}},{cast:true,sk:{awaken:1}},{cast:true}])expect(l.consume({player:f.player,context,now:2})).toBeNull();expect(l.snapshot(2,f.player).ready).toBe(true);
});
test('far-away escape cannot emit a remote finisher effect and snapshot copies no source',()=>{
 const l=new ComboLink(),f=make();l.arm(f);f.player.pos.x=20;expect(l.consume({player:f.player,context:{cast:true,sk:{}},now:2})).toBeNull();expect(l.activations).toBe(0);expect(l.snapshot(2,f.player).ready).toBe(false);
});
function game(){
 const f=make(),g:any=Object.create(Battle.prototype);Object.assign(g,{active:true,paused:false,run:{enabled:true,settled:false},stage:{idx:1},elapsed:2,player:f.player,conquest:null,
  app:{arsenal:{artForHero:()=> 'rupture'},reducedMotion:{matches:true}},effects:{},enemies:[],fx:{shockTex(){}},ui:{toast(){}}});
 g.bindCombatArt();g.comboLink.arm(f);f.player.skillCtx={cast:true,sk:{}};g.emissions=0;g.activateCombatArt=()=>{g.emissions++;g.comboLink.cancel();};return {g,f};
}
test('real battle hook requires the current player and exact released context',()=>{
 const {g,f}=game();expect(g.onSkillReleased({},f.player.skillCtx)).toBe(false);expect(g.onSkillReleased(f.player,{cast:true,sk:{}})).toBe(false);
 expect(g.onSkillReleased(f.player,f.player.skillCtx)).toBe(true);expect(g.onSkillReleased(f.player,f.player.skillCtx)).toBe(false);expect(g.emissions).toBe(1);expect(g.getComboLinkSnapshot().activations).toBe(1);
});
for(const blocked of [{paused:true},{stage:{party:{}}},{stage:{expedition:{kind:'dungeon'}}},{stage:{expedition:{kind:'arena'}}},{conquest:{}},{run:{enabled:true,settled:true}},{active:false}])test(`mode gate ${JSON.stringify(blocked)} preserves existing combat`,()=>{
 const {g,f}=game();Object.assign(g,blocked);expect(g.onSkillReleased(f.player,f.player.skillCtx)).toBe(false);expect(g.emissions).toBe(0);expect(g.getComboLinkSnapshot().enabled).toBe(false);
});
test('an existing break art from the same skill suppresses duplicate linkage',()=>{
 const {g,f}=game();g.apex.procUntil=3;expect(g.onSkillReleased(f.player,f.player.skillCtx)).toBe(false);expect(g.emissions).toBe(0);expect(g.comboLink.snapshot(2,f.player).ready).toBe(false);
});
test('a new run receives no carried token, remaining time or activations',()=>{
 const {g}=game();g.bindCombatArt();expect(g.getComboLinkSnapshot()).toMatchObject({ready:false,remaining:0,activations:0,cooldown:0});
});
