import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Battle } from '../src/game/masterworks-battle.js';
import { Battle as RpgBattle } from '../src/game/rpg-battle.js';
import { normalizeMasterworks } from '../src/game/masterworks-core.js';
import { KillLedger } from '../src/game/rpg-core.js';
import { HEROES, heroStats, levelExp } from '../src/data/heroes.js';
import { ENEMIES } from '../src/data/stages.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';

const noop=()=>{};
function fixture() {
  const game:any=Object.create(Battle.prototype),hero:any={level:1,exp:0,star:1,skills:[]};
  const stats=heroStats(HEROES.knight,hero);
  const state=normalizeMasterworks(null),rpg={bestiary:{},combatXp:0};
  Object.assign(game,{
    active:true,paused:false,pauseReasons:new Set(),elapsed:0,kills:0,waveKilled:0,combatXp:0,roomsCleared:0,runKills:new WeakSet(),killLedger:new KillLedger(),enemies:[],pending:[],effects:{},buildBase:stats,
    stage:{idx:1,ch:1,code:'1-1',scale:1},heroId:'knight',world:{rooms:[],remaining:2,bossRoom:{cleared:false}},
    run:{id:1,enabled:true,settled:false,permanent:{},picked:[],queue:[],round:0,autoPicked:0,renown:0,perfects:0,breaks:0,difficulty:{rewardMul:1}},
    player:{stats,maxHp:stats.hp,hp:stats.hp,alive:true,def:HEROES.knight,pos:new THREE.Vector3(),addUlt:noop,forward:(v:any)=>v.set(0,0,1)},
    app:{eco:{s:{quests:{kills:0}},hero:()=>hero,heroEquipBonus:()=>({})}},
    masterworks:{s:state,transact:(fn:any)=>fn(state)},ensureRpg:()=>rpg,flushRpg:()=>true,
    chronicle:{refresh:noop,close:noop,selectionDone:noop,tick:noop},rpgView:{levelUp:noop,refresh:noop},
    ui:{toast:noop,awakenBanner:noop,setObjective:noop,setFloorLabel:noop},fx:{burst:noop,dustPuff:noop,groundTex:noop},
    drops:{onKill:noop,spawn:noop},after:noop,rollDrop:()=>null,input:{enabled:true,clear:noop},
  });
  game.appliedStats=game.player.stats;
  return {game,hero,state};
}
function deadEnemy(extra:any={}) {return {alive:false,pos:new THREE.Vector3(),isBoss:false,isElite:false,summoned:false,...extra};}

test('real death-levelup chain preserves missing HP through permanent and temporary build stats',()=>{
  const {game,hero}=fixture();game.run.picked=['tide_breath','tide_breath'];game.run.permanent={hp:.03};game.applyBuild();
  game.player.hp=game.player.maxHp-200;
  const enemy=deadEnemy({speciesId:Object.keys(ENEMIES)[0],level:1,xpReward:levelExp(1)});
  game.onEnemyDeath(enemy);
  expect(hero.level).toBe(2);expect(game.player.maxHp-game.player.hp).toBe(200);
  expect(game.player.maxHp).toBe(Math.round(heroStats(HEROES.knight,hero).hp*1.15));
  const hp=game.player.hp;game.applyBuild();expect(game.player.hp).toBe(hp);
  game.onEnemyDeath(enemy);expect(hero.level).toBe(2);expect(game.kills).toBe(1);
});

test('deferred max-rank offers refresh and stale selection cannot consume the next offer',()=>{
  const {game}=fixture();game.run.picked=['ember_edge','ember_edge'];
  game.run.queue=[{kind:'boon',ids:['ember_edge','tide_breath','storm_step'],round:0},{kind:'boon',ids:['ember_edge','stone_root','storm_eye'],round:1}];
  expect(game.selectBoon('ember_edge').ok).toBe(true);
  expect(game.currentOffer().ids).not.toContain('ember_edge');
  expect(game.selectBoon('ember_edge').ok).toBe(false);expect(game.run.queue).toHaveLength(1);
  expect(game.run.picked.filter((id:string)=>id==='ember_edge')).toHaveLength(3);
  expect(game.selectBoon(game.currentOffer().ids[0]).ok).toBe(true);expect(game.run.queue).toHaveLength(0);
});

test('routine rewards auto-apply while only the third and sixth rewards become choices',()=>{
  const {game}=fixture();
  expect(game.grantBoonReward({automatic:true}).automatic).toBe(true);
  expect(game.run).toMatchObject({round:1,autoPicked:1});expect(game.run.queue).toHaveLength(0);
  expect(game.grantBoonReward({automatic:true}).automatic).toBe(true);
  const checkpoint=game.grantBoonReward({automatic:false});
  expect(checkpoint.ok).toBe(true);expect(game.currentOffer().kind).toBe('boon');expect(game.run.autoPicked).toBe(2);
  expect(game.selectBoon(game.currentOffer().ids[0]).ok).toBe(true);
  for(let i=0;i<2;i++)expect(game.grantBoonReward({automatic:true}).automatic).toBe(true);
  expect(game.grantBoonReward({automatic:false}).ok).toBe(true);expect(game.run.round).toBe(6);
  expect(game.run.autoPicked).toBe(4);expect(game.run.queue).toHaveLength(1);
});

test('party stages disable personal masterworks progression and offers',()=>{
  const {game}=fixture();game.stage.party={code:'party'};game.run.enabled=!game.stage.party;
  expect(game.grantBoonReward({automatic:true}).ok).toBe(false);expect(game.run.round).toBe(0);expect(game.run.queue).toHaveLength(0);
});

test('party start uses its server run id without mutating or persisting personal masterworks',async()=>{
  const game:any=Object.create(Battle.prototype),state=normalizeMasterworks(null),before=structuredClone(state);
  let transactions=0,scheduled=0;
  Object.assign(game,{stage:{idx:1,ch:1,code:'1-1',party:{runId:'server-run'}},active:true,
    player:{stats:{hp:100},maxHp:100,hp:100,alive:true},masterworks:{s:state,transact:()=>{transactions++;return {ok:false,error:'save-failed'};}},
    chronicle:{refresh:noop},after:()=>scheduled++});
  const original=RpgBattle.prototype.start;RpgBattle.prototype.start=async function(){};
  try{await Battle.prototype.start.call(game);}finally{RpgBattle.prototype.start=original;}
  expect(transactions).toBe(0);expect(state).toEqual(before);
  expect(game.run).toMatchObject({id:'server-run',enabled:false,picked:[],queue:[],round:0});
  expect(game.effects).toEqual({});expect(scheduled).toBe(1);
});

test('late deaths after result cannot pay progression and normal kills settle once',()=>{
  const {game,state}=fixture();state.bounties.counts.kills=4;
  const enemy=deadEnemy();game.onEnemyDeath(enemy);game.onEnemyDeath(enemy);
  expect(state.bounties.counts.kills).toBe(5);expect(state.renown).toBe(1);
  game.active=false;game.run.settled=true;game.kills=9;game.onEnemyDeath(deadEnemy());
  expect(state.bounties.counts.kills).toBe(5);expect(state.renown).toBe(1);expect(game.run.renown).toBe(1);
});

test('late last-enemy death cannot mint a new room discovery after settlement',()=>{
  const {game,state}=fixture();const room={type:'normal',cleared:false};game.world.rooms=[room];
  game.active=false;game.run.settled=true;game.onEnemyDeath(deadEnemy({homeRoom:room}));
  expect(state.discoveries).toHaveLength(0);expect(state.renown).toBe(0);expect(game.run.queue).toHaveLength(0);
});

test('summons and split runs cannot shift or duplicate each fifth eligible lifetime kill reward',()=>{
  const {game,state}=fixture();state.bounties.counts.kills=3;
  for(let i=0;i<7;i++)game.onEnemyDeath(deadEnemy({summoned:true}));
  expect(state.bounties.counts.kills).toBe(3);expect(state.renown).toBe(0);
  game.onEnemyDeath(deadEnemy());expect(state.bounties.counts.kills).toBe(4);expect(state.renown).toBe(0);
  const next=fixture();next.game.masterworks.s=normalizeMasterworks(state);
  next.game.onEnemyDeath(deadEnemy({summoned:true}));
  const fifth=deadEnemy();next.game.onEnemyDeath(fifth);next.game.onEnemyDeath(fifth);
  expect(next.game.masterworks.s.bounties.counts.kills).toBe(5);expect(next.game.masterworks.s.renown).toBe(1);expect(next.game.run.renown).toBe(1);
  next.game.onEnemyDeath(deadEnemy({summoned:true}));next.game.onEnemyDeath(deadEnemy());
  expect(next.game.masterworks.s.bounties.counts.kills).toBe(6);expect(next.game.masterworks.s.renown).toBe(1);
  next.game.masterworks.s.bounties.counts.kills=1000000;next.game.onEnemyDeath(deadEnemy());
  expect(next.game.masterworks.s.renown).toBe(1);
});

test('story rewards match run totals and remembered visits give healing without another payment',()=>{
  const {game,state}=fixture();game.run.queue=[{kind:'story',id:'lantern'}];
  expect(game.selectStory('guide').ok).toBe(true);expect(state.renown).toBe(6);expect(game.run.renown).toBe(6);
  expect(game.selectStory('guide').ok).toBe(false);expect(state.renown).toBe(6);
  game.run.queue=[{kind:'story',id:'lantern'}];game.player.hp=game.player.maxHp-200;
  const hp=game.player.hp;expect(game.selectStory('guide').ok).toBe(true);
  expect(game.player.hp).toBe(hp+Math.round(game.player.maxHp*.06));expect(state.renown).toBe(6);expect(game.run.renown).toBe(6);
  game.result={};game.settleChronicle('defeat');expect(game.result.masterworks.renown).toBe(6);
  game.settleChronicle('defeat');expect(state.history).toHaveLength(1);
});

test('pause ownership blocks simulation while another panel still holds a pause',()=>{
  const {game}=fixture();game.enemies=[{alive:true,posture:50,breakT:1}];
  game.setPaused('catalogue',true);game.setPaused('masterworks',true);game.setPaused('masterworks',false);
  expect(game.paused).toBe(true);expect(game.input.enabled).toBe(false);
  game.update(.1);expect(game.elapsed).toBe(0);expect(game.enemies[0].breakT).toBe(1);expect(game.enemies[0].posture).toBe(50);
  game.setPaused('catalogue',false);expect(game.paused).toBe(false);expect(game.input.enabled).toBe(true);
});

test('defeated actors cannot select a queued boon or story, and cooldown is capped',()=>{
  const {game,state}=fixture();game.player.alive=false;game.run.queue=[{kind:'boon',ids:['ember_edge'],round:0}];
  expect(game.selectBoon('ember_edge').ok).toBe(false);game.run.queue=[{kind:'story',id:'lantern'}];
  expect(game.selectStory('guide').ok).toBe(false);expect(state.renown).toBe(0);
  game.effects={cooldown:100};expect(game.skillCooldown(10)).toBe(6.5);
});

test('short ember dungeon offers its story once only after both reinforcement waves clear',()=>{
  const {game,state}=fixture();game.stage=buildExpeditionStage('dungeon','ember_vault',{});game.world=buildExpeditionWorld(game.stage);
  game.ui.waveBanner=noop;game.spawnEnemy=noop;
  const room=game.world.rooms.find((r:any)=>r.type==='elite');
  expect(game.world.rooms.map((r:any)=>r.type)).toEqual(['start','elite','boss']);
  for(let i=0;i<2;i++){game.markCleared(room);expect(room.cleared).toBe(false);expect(game.run.queue).toHaveLength(0);}
  game.markCleared(room);expect(game.roomsCleared).toBe(1);
  expect(game.run.queue.filter((q:any)=>q.kind==='story')).toEqual([{kind:'story',id:'bridge'}]);
  const renown=state.renown;game.markCleared(room);expect(state.renown).toBe(renown);
  game.markCleared(game.world.bossRoom);expect(game.run.queue.filter((q:any)=>q.kind==='story')).toHaveLength(1);
});

test('longer dungeons keep treasure and two-room story timing before their final approach',()=>{
  for(const trigger of ['treasure','second-room']){
    const {game}=fixture();game.stage=buildExpeditionStage('dungeon','glass_garden',{});game.world=buildExpeditionWorld(game.stage);
    const normal=game.world.rooms.filter((r:any)=>r.type==='normal');
    if(trigger==='treasure'){
      const treasure=game.world.rooms.find((r:any)=>r.type==='treasure');treasure.attuned=true;game.markCleared(treasure);
      expect(game.roomsCleared).toBe(1);
    }else{
      game.markCleared(normal[0]);expect(game.run.queue.filter((q:any)=>q.kind==='story')).toHaveLength(0);
      game.markCleared(normal[1]);expect(game.roomsCleared).toBe(2);
    }
    expect(game.run.queue.filter((q:any)=>q.kind==='story')).toEqual([{kind:'story',id:'lantern'}]);
    expect(game.world.rooms.some((r:any)=>!r.cleared&&r.type!=='start'&&r.type!=='boss')).toBe(true);
  }
});

test('short dungeon final approach does not produce story or discovery after settlement',()=>{
  const {game,state}=fixture();game.stage=buildExpeditionStage('dungeon','ember_vault',{});game.world=buildExpeditionWorld(game.stage);
  const room=game.world.rooms.find((r:any)=>r.type==='elite');room.forgeWave=2;game.active=false;game.run.settled=true;
  game.markCleared(room);expect(game.run.queue).toHaveLength(0);expect(state.discoveries).toHaveLength(0);expect(state.renown).toBe(0);
});

test('cleared rooms do not reopen an empty chronicle after all offers are exhausted',()=>{
  const {game}=fixture();game.stage=buildExpeditionStage('dungeon','glass_garden',{});game.world=buildExpeditionWorld(game.stage);
  game.run.round=6;game.run.storySeen=true;game.ui.waveBanner=noop;game.spawnEnemy=noop;
  const scheduled:Function[]=[];let opened=0;game.after=(_sec:number,fn:Function)=>scheduled.push(fn);game.chronicle.offer=()=>opened++;
  const room=game.world.rooms.find((r:any)=>r.type==='normal');game.markCleared(room);
  expect(game.currentOffer()).toBeUndefined();for(const fn of scheduled)fn();expect(opened).toBe(0);
});

function damageFixture() {
  const {game}=fixture(),bolts:any[]=[];
  Object.assign(game,{elapsed:10,counterUntil:0,chainUntil:0,feedbackSound:true,feedbackCount:0,dmgDealt:0,combo:0,maxCombo:0,timeCtl:{hitstop:noop}});
  game.player.atk=100;game.player.stats.crit=0;game.ui.setCombo=noop;
  Object.assign(game.fx,{dmgLayer:{children:[]},damage:noop,contact:noop,shockTex:noop,boltTex:(...args:any[])=>bolts.push(args)});
  const target=(x=0,z=0,extra:any={})=>({
    alive:true,spawning:false,hp:10000,maxHp:10000,pos:new THREE.Vector3(x,0,z),def:{scale:1},posture:0,breakT:0,
    hits:[] as any[],receiveImpact:noop,
    hurt(amount:number,options:any){this.hits.push({amount,options});this.hp-=amount;return amount;},...extra,
  });
  return {game,bolts,target};
}

test('real finisher chain hits at most two eligible nearby targets with 55% attack and a shared cooldown',()=>{
  const random=Math.random;Math.random=()=>.5;
  try{
    const {game,bolts,target}=damageFixture();game.effects={chain:3};
    const primary=target(),outside=target(7),dead=target(1,0,{alive:false}),spawning=target(1,0,{spawning:true}),first=target(2),edge=target(6,Math.sqrt(6)),third=target(3);
    game.enemies=[primary,outside,dead,spawning,first,edge,third];
    game.damageEnemy(primary,10);expect(bolts).toHaveLength(0);
    game.damageEnemy(primary,10,{finisher:true});expect(bolts).toHaveLength(2);
    for(const e of [first,edge]){
      expect(e.hp).toBe(9945);expect(e.hits[0].amount).toBeCloseTo(55);
      expect(e.hits[0].options).toMatchObject({quiet:true,noProc:true,masterworksProc:true});
    }
    for(const e of [outside,dead,spawning,third])expect(e.hits).toHaveLength(0);
    game.elapsed=10.64;game.damageEnemy(primary,10,{finisher:true});expect(bolts).toHaveLength(2);
    game.elapsed=10.65;game.damageEnemy(primary,10,{finisher:true,quiet:true});expect(bolts).toHaveLength(2);
    game.damageEnemy(primary,10,{finisher:true,masterworksProc:true,quiet:true});expect(bolts).toHaveLength(2);
    game.damageEnemy(primary,10,{finisher:true});expect(bolts).toHaveLength(4);
    expect(first.hp).toBe(9890);expect(edge.hp).toBe(9890);expect(third.hp).toBe(10000);
  }finally{Math.random=random;}
});

test('remote attack source owns critical roll, ultimate gain, and masterworks chain damage',()=>{
  const random=Math.random;Math.random=()=>0;
  try{
    const {game,target}=damageFixture(),ult:number[]=[];
    game.effects={chain:1};game.player.atk=100;game.player.stats.crit=0;
    const source={atk:240,stats:{crit:1,critDmg:2,ultGain:1.5},addUlt:(v:number)=>ult.push(v)};
    const primary=target(),other=target(1);game.enemies=[primary,other];
    game.damageEnemy(primary,100,{source,finisher:true});
    expect(primary.hits[0].amount).toBe(180);expect(ult).toEqual([4.5,4.5]);expect(other.hits[0].amount).toBeCloseTo(237.6);
  }finally{Math.random=random;}
});

test('real counter waits through misses and quiet damage and boosts only the first landed direct hit',()=>{
  const random=Math.random;Math.random=()=>.5;
  try{
    const {game,target}=damageFixture();game.counterUntil=13;
    const miss=target(0,0,{hurt:()=>0}),enemy=target();
    game.damageEnemy(miss,100);expect(game.counterUntil).toBe(13);
    game.damageEnemy(enemy,100,{quiet:true});expect(game.counterUntil).toBe(13);expect(enemy.hp).toBe(9900);
    game.damageEnemy(enemy,100);expect(game.counterUntil).toBe(0);expect(enemy.hits[1].amount).toBeCloseTo(135);
    game.damageEnemy(enemy,100);expect(enemy.hits[2].amount).toBeCloseTo(100);expect(enemy.hp).toBe(9665);
  }finally{Math.random=random;}
});
