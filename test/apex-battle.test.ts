import {test,expect} from 'bun:test';
import * as THREE from 'three';
import {Battle} from '../src/game/apex-battle.js';
import {normalizeMasterworks} from '../src/game/masterworks-core.js';
import {HEROES,heroStats,levelExp} from '../src/data/heroes.js';
import {resolveJobHero} from '../src/data/jobs.js';
import {KillLedger} from '../src/game/rpg-core.js';
import {ENEMIES} from '../src/data/stages.js';
const noop=()=>{};
function fixture(art='flow') {
  const game:any=Object.create(Battle.prototype);
  Object.assign(game,{active:true,paused:false,pauseReasons:new Set(),elapsed:10,heroId:'knight',effects:{},stage:{idx:1},run:{enabled:true,settled:false,breaks:0},
    app:{arsenal:{artForHero:()=>art},companionAgent:{endBattle:noop}},enemies:[],projectiles:[],timers:[],pending:[],
    masterworks:{s:normalizeMasterworks(null)},rpgDirty:false,flushRpg:()=>true,
    player:{alive:true,maxHp:1000,hp:1000,atk:100,stats:{crit:0},def:{skills:[{},{},{ult:true},{awaken:1}]},cds:[5,7,99,99],addUlt:noop,dispose:noop},
    fx:{dmgLayer:{children:[]},damage:noop,flash:noop,directional:noop,shockTex:noop,clearAll:noop},
    ui:{setCombo:noop,toast:noop,showHud:noop},timeCtl:{hitstop:noop},counterUntil:0,chainUntil:0,dmgDealt:0,combo:0,maxCombo:0,feedbackSound:true,
    input:{clear:noop},renderer:{},drops:{clear:noop},clearPortal:noop,rpgView:{close:noop,refresh:noop},chronicle:{close:noop,refresh:noop,tick:noop}});
  game.bindCombatArt();
  const enemy=(x=0,extra:any={})=>({alive:true,spawning:false,hp:10000,pos:new THREE.Vector3(x,0,0),def:{scale:1,name:'정예'},posture:0,breakT:0,stun:0,
    hits:[] as any[],receiveImpact:noop,hurt(amount:number,options:any){this.hits.push({amount,options});this.hp-=amount;return amount;},dispose:noop,...extra});
  return {game,enemy};
}
function deterministic(fn:()=>void){const random=Math.random;Math.random=()=>.5;try{fn();}finally{Math.random=random;}}
const heavy={isBoss:true,state:'attack',special:'slam',attackDone:true,attackSequence:1,completedAttackSequence:1,attackDur:1,hitAt:.52,stateT:.7,telegraph:0};
test('actual battle damage awards recovery posture once after landed finisher; misses and quiet hits preserve it',()=>deterministic(()=>{
  const {game,enemy}=fixture();const e=enemy(0,heavy);game.enemies=[e];
  expect(game.getApexSnapshot().recoveryTarget.name).toBe('정예');
  const hurt=e.hurt;e.hurt=()=>0;game.damageEnemy(e,100,{finisher:true});expect(e.posture).toBe(0);
  e.hurt=hurt;game.damageEnemy(e,100,{finisher:true,quiet:true});expect(e.posture).toBe(0);
  game.damageEnemy(e,100,{finisher:true});expect(e.posture).toBe(43);expect(game.getApexSnapshot().recoveryTarget).toBeNull();
  game.damageEnemy(e,100,{finisher:true});expect(e.posture).toBe(71);
  e.attackSequence=2;e.completedAttackSequence=2;game.damageEnemy(e,100,{finisher:true});expect(e.posture).toBe(114);
}));
test('recovery cannot reward telegraph, interruption, arena, missing service or settled runs',()=>deterministic(()=>{
  for(const change of [{telegraph:.2},{state:'hurt'},{completedAttackSequence:0}]){
    const {game,enemy}=fixture();const e=enemy(0,{...heavy,...change});game.damageEnemy(e,100,{finisher:true});expect(e.posture).toBe(28);
  }
  for(const kind of ['arena','absent','settled','paused']){
    const {game,enemy}=fixture();const e=enemy(0,heavy);
    if(kind==='arena'){game.stage.expedition={kind:'arena'};game.run.enabled=false;game.bindCombatArt();}
    if(kind==='absent'){delete game.app.arsenal;game.bindCombatArt();}
    if(kind==='settled')game.run.settled=true;
    if(kind==='paused')game.paused=true;
    game.damageEnemy(e,100,{finisher:true});expect(game.apex.procCount).toBe(0);expect(game.apex.recovery.get(e)).toBeUndefined();
    expect(e.posture).toBe(kind==='arena'?0:28);
  }
}));
test('flow binds selection for the run and fires only on a subsequent finisher once per break generation',()=>deterministic(()=>{
  const {game,enemy}=fixture();game.app.arsenal.artForHero=()=> 'rupture';const e=enemy(0,{posture:70});game.enemies=[e];
  game.damageEnemy(e,100,{finisher:true});expect(e.breakT).toBe(2.2);expect(game.apex.procCount).toBe(0);expect(game.getApexSnapshot().ready).toBe(true);
  game.damageEnemy(e,100,{finisher:true,quiet:true});expect(game.apex.procCount).toBe(0);
  game.damageEnemy(e,100,{finisher:true});expect(game.player.cds).toEqual([5,5,99,99]);expect(game.apex.procCount).toBe(1);
  game.damageEnemy(e,100,{finisher:true});expect(game.apex.procCount).toBe(1);
  e.breakT=0;e.stun=0;e.posture=70;game.damageEnemy(e,100,{finisher:true});game.damageEnemy(e,100,{finisher:true});
  expect(game.apex.procCount).toBe(2);expect(game.player.cds).toEqual([3,5,99,99]);expect(game.getApexSnapshot().artId).toBe('flow');
}));
test('rupture uses normal hit path with capped nearest targets, knockback and no recursive posture or art',()=>deterministic(()=>{
  const {game,enemy}=fixture('rupture');const e=enemy(0,{breakT:1}),far=enemy(6),a=enemy(2),b=enemy(5),c=enemy(3),spawn=enemy(1,{spawning:true});game.enemies=[e,far,b,a,c,spawn];
  game.damageEnemy(e,100,{finisher:true});
  for(const target of [a,c]){expect(target.hits).toHaveLength(1);expect(target.hits[0].amount).toBe(60);expect(target.hits[0].options).toMatchObject({kb:4,quiet:true,apexProc:true,noProc:true});expect(target.posture).toBe(0);}
  for(const target of [far,b,spawn])expect(target.hits).toHaveLength(0);
  expect(game.apex.procCount).toBe(1);expect(game.dmgDealt).toBe(250);
}));
test('aegis absorbs through player damage hook and preserves unrelated shield through expiration and pause',()=>deterministic(()=>{
  const {game,enemy}=fixture('aegis');const e=enemy(0,{breakT:1});game.damageEnemy(e,100,{finisher:true});game.player.chronicleShield=20;
  expect(game.getApexSnapshot().shield).toBe(120);expect(game.absorbDamage(50)).toBe(0);expect(game.apex.shield).toBe(70);expect(game.player.chronicleShield).toBe(20);
  game.setPaused('menu',true);game.update(3);expect(game.elapsed).toBe(10);expect(game.apex.shield).toBe(70);game.setPaused('menu',false);
  game.elapsed=15;expect(game.absorbDamage(30)).toBe(10);expect(game.getApexSnapshot().shield).toBe(0);
  game.apex.shield=90;game.apex.shieldUntil=25;game.active=false;expect(game.absorbDamage(10)).toBe(10);
  game.stop();expect(game.apex).toBeNull();expect(game.player).toBeNull();expect(game.getApexSnapshot().enabled).toBe(false);
}));
test('recovery bonus can create one break and its following finisher activates the art',()=>deterministic(()=>{
  const {game,enemy}=fixture();const e=enemy(0,{...heavy,posture:110});game.enemies=[e];
  game.damageEnemy(e,100,{finisher:true});expect(e.breakT).toBe(1.3);expect(game.run.breaks).toBe(1);expect(game.apex.procCount).toBe(0);
  game.damageEnemy(e,100,{finisher:true});expect(game.apex.procCount).toBe(1);expect(game.run.breaks).toBe(1);
}));
test('art refuses misses, recursive effects, paused, defeated, inactive and settled actors',()=>deterministic(()=>{
  for(const kind of ['miss','recursive','paused','dead','inactive','settled']){
    const {game,enemy}=fixture();const e=enemy(0,{breakT:1});
    if(kind==='miss')e.hurt=()=>0;
    if(kind==='paused')game.paused=true;
    if(kind==='dead')game.player.alive=false;
    if(kind==='inactive')game.active=false;
    if(kind==='settled')game.run.settled=true;
    game.damageEnemy(e,100,{finisher:true,...(kind==='recursive'?{masterworksProc:true}:{})});
    expect(game.apex.procCount).toBe(0);expect(game.player.cds).toEqual([5,7,99,99]);
  }
}));
test('aegis refreshes without stacking when a new break is earned',()=>deterministic(()=>{
  const {game,enemy}=fixture('aegis');const e=enemy(0,{breakT:1});
  game.damageEnemy(e,100,{finisher:true});game.absorbDamage(40);expect(game.apex.shield).toBe(80);
  game.elapsed=12;e.breakT=0;e.posture=70;game.damageEnemy(e,100,{finisher:true});game.damageEnemy(e,100,{finisher:true});
  expect(game.apex.shield).toBe(120);expect(game.apex.shieldUntil).toBe(17);expect(game.apex.procCount).toBe(2);
}));
test('real death level-up preserves the run-bound guardian stats and missing HP even if preparation changes',()=>{
  const {game,enemy}=fixture();const hero={level:1,exp:0,star:1};
  const def=resolveJobHero(HEROES.knight,'guardian'),base=heroStats(def,hero);
  Object.assign(game.player,{def,stats:base,maxHp:base.hp,hp:base.hp-200,heroLevel:1});game.appliedStats=base;game.buildBase=base;
  game.app.eco={s:{quests:{kills:0},expedition:{selectedJob:null}},hero:()=>hero,heroEquipBonus:()=>({})};
  game.killLedger=new KillLedger();game.runKills=new WeakSet();game.combatXp=0;game.kills=0;game.waveKilled=0;
  const rpg={bestiary:{},combatXp:0};game.ensureRpg=()=>rpg;game.rpgView.levelUp=noop;game.drops.onKill=noop;game.fx.burst=noop;game.fx.dustPuff=noop;
  const e=enemy(0,{alive:false,speciesId:Object.keys(ENEMIES)[0],level:1,xpReward:levelExp(1)});
  game.onEnemyDeath(e);expect(hero.level).toBe(2);expect(game.player.maxHp).toBe(heroStats(def,hero).hp);expect(game.player.stats.spd).toBe(heroStats(def,hero).spd);
  expect(game.player.maxHp-game.player.hp).toBe(200);expect(game.player.maxHp).toBeGreaterThan(heroStats(HEROES.knight,hero).hp);
  game.onEnemyDeath(e);expect(game.kills).toBe(1);expect(hero.level).toBe(2);
});
