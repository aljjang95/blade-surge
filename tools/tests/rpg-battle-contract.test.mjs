/** Runtime-boundary unit tests with explicit fakes. NOT a WebGL/browser or full-game test. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as core from '../../src/game/rpg-core.js';
import * as motion from '../../src/game/combat-motion.js';
class Vector { set(x,y,z){this.x=x;this.y=y;this.z=z;return this} normalize(){return this} clone(){return new Vector().set(this.x||0,this.y||0,this.z||0)} setY(y){this.y=y;return this} }
class Base { onEnemyDeath(){this.baseDeaths=(this.baseDeaths||0)+1} }
const ENEMIES={a:{exp:8,hp:490,atk:20}};
const HEROES={knight:{skills:[{unlock:10}]}};
let played=0;const audio={hit:()=>played++,vibe:()=>{}};
const source=readFileSync(new URL('../../src/game/rpg-battle.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export class Battle','class Battle');
const names=['THREE','BaseBattle','ENEMIES','HEROES','heroStats','levelExp','audio','ImpactClock','impactStrength','normalizeRpg','recordMonster','monsterLevel','monsterXp','grantCombatXp','KillLedger','buildCatalogue','RpgView'];
const Battle=new Function(...names,source+'\nreturn Battle;')({Vector3:Vector},Base,ENEMIES,HEROES,(_d,h)=>({hp:100+h.level*10,atk:h.level*2,crit:0,critDmg:1.5,ultGain:1}),()=>100,audio,motion.ImpactClock,motion.impactStrength,core.normalizeRpg,core.recordMonster,core.monsterLevel,core.monsterXp,core.grantCombatXp,core.KillLedger,()=>[],class{});
function setup(){
 const h={level:1,exp:95},s={heroes:{knight:h},rpg:core.normalizeRpg(null,['a'])};
 const b=Object.create(Battle.prototype);let saves=0,warnings=0,notices=0,flashes=0;
 Object.assign(b,{heroId:'knight',stage:{idx:1},combatXp:0,rpgDirty:false,saveT:0,killLedger:new core.KillLedger(),
 app:{eco:{s,hero:()=>h,heroEquipBonus:()=>({}),save:()=>{saves++;return true}}},
 player:{maxHp:110,hp:80,alive:true,heroLevel:1,def:HEROES.knight,cds:[3,2],stats:{crit:0,critDmg:1.5},unlocked(){return this.heroLevel>=10},addUlt(){}},
 ui:{toast:()=>warnings++,setCombo(){},skillBtns:[],awakenBanner(){}},rpgView:{levelUp:()=>notices++},
 fx:{dmgLayer:{children:[]},damage(){},flash:()=>flashes++,directional(){}},
 timeCtl:new motion.ImpactClock(),dmgDealt:0,combo:0,maxCombo:0,feedbackCount:0,feedbackSound:false});
 return {b,h,s,counts:()=>({saves,warnings,notices,flashes})};
}
const dead=(xp=8)=>({alive:false,speciesId:'a',level:1,xpReward:xp});
test('a dead instance settles XP and original death/loot path once',()=>{
 const {b,h,counts}=setup(),e=dead();b.onEnemyDeath(e);b.onEnemyDeath(e);
 assert.equal(h.level,2);assert.equal(h.exp,3);assert.equal(b.combatXp,8);assert.equal(b.baseDeaths,1);assert.equal(counts().notices,1);
});
test('mid-battle level-up preserves missing HP and cooldowns',()=>{
 const {b}=setup();b.onEnemyDeath(dead());assert.equal(b.player.maxHp,120);assert.equal(b.player.hp,90);assert.deepEqual(b.player.cds,[3,2]);assert.equal(b.player.heroLevel,2);
});
test('poison kill after hero death cannot revive the hero',()=>{
 const {b}=setup();b.player.alive=false;b.player.hp=0;b.onEnemyDeath(dead());assert.equal(b.player.hp,0);assert.equal(b.player.alive,false);
});
test('summoned enemies keep codex and original drops but have no combat XP',()=>{
 const {b,h,s}=setup();b.onEnemyDeath(dead(0));assert.equal(h.level,1);assert.equal(h.exp,95);assert.equal(b.combatXp,0);assert.equal(s.rpg.bestiary.a.kills,1);assert.equal(b.baseDeaths,1);
});
test('storage failure keeps the dirty state and reports once until recovery',()=>{
 const {b,counts}=setup();b.rpgDirty=true;b.app.eco.save=()=>false;
 assert.equal(b.flushRpg(),false);assert.equal(b.flushRpg(),false);assert.equal(b.rpgDirty,true);assert.equal(counts().warnings,1);
 b.app.eco.save=()=>true;assert.equal(b.flushRpg(),true);assert.equal(b.rpgDirty,false);assert.equal(b.storageWarned,false);
});
test('reset selects new save records, never reattaches old discoveries',()=>{
 const {b,s}=setup();b.ensureRpg();core.recordMonster(s.rpg,'a',1,1);b.app.eco.s={};assert.deepEqual(Object.keys(b.ensureRpg().bestiary),[]);
});
test('zero damage or a dodge causes no contact sound, stop or recoil',()=>{
 const {b}=setup();let recoil=0;played=0;
 const enemy={alive:true,spawning:false,hurt:()=>0,receiveImpact:()=>recoil++};
 b.damageEnemy(enemy,40);assert.equal(b.combo,0);assert.equal(played,0);assert.equal(b.timeCtl.stop,0);assert.equal(recoil,0);
});
test('crowd damage retains all hits but bounds impact VFX and sound',()=>{
 const {b,counts}=setup();played=0;let impacts=0;
 for(let i=0;i<30;i++)b.damageEnemy({alive:true,spawning:false,def:{scale:1},pos:new Vector(),hurt:()=>10,receiveImpact:()=>impacts++},10,{dirx:1,dirz:0});
 assert.equal(b.combo,30);assert.equal(b.dmgDealt,300);assert.equal(impacts,30);assert.equal(counts().flashes,6);assert.equal(played,1);assert.equal(b.timeCtl.stop,.035);
});
test('quiet status damage keeps damage accounting without impact feedback',()=>{
 const {b,counts}=setup();played=0;
 b.damageEnemy({alive:true,spawning:false,def:{scale:1},pos:new Vector(),hurt:()=>10},10,{quiet:true});
 assert.equal(b.dmgDealt,10);assert.equal(counts().flashes,0);assert.equal(played,0);assert.equal(b.timeCtl.stop,0);
});
test('awakened skill unlocks immediately without setupHud resetting cooldowns',()=>{
 const {b,h}=setup();h.level=9;h.exp=95;b.player.heroLevel=9;
 let locked=true,banner=0;b.ui.skillBtns=[{classList:{toggle:(_name,value)=>locked=value}}];b.ui.awakenBanner=()=>banner++;
 b.onEnemyDeath(dead(8));assert.equal(locked,false);assert.equal(banner,1);assert.deepEqual(b.player.cds,[3,2]);
});
