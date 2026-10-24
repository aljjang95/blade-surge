import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { Battle } from '../src/game/masterworks-battle.js';
import { Battle as RpgBattle } from '../src/game/rpg-battle.js';
import { normalizeMasterworks, boonEffects } from '../src/game/masterworks-core.js';
import { STORY_EVENTS } from '../src/data/masterworks.js';
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
    run:{id:1,enabled:true,settled:false,permanent:{},picked:[],preRunBoons:[],storySeen:false,renown:0,perfects:0,breaks:0,difficulty:{rewardMul:1}},
    player:{stats,maxHp:stats.hp,hp:stats.hp,alive:true,def:HEROES.knight,pos:new THREE.Vector3(),addUlt:noop,forward:(v:any)=>v.set(0,0,1)},
    app:{eco:{s:{quests:{kills:0}},hero:()=>hero,heroEquipBonus:()=>({})}},
    masterworks:{s:state,transact:(fn:any)=>fn(state)},ensureRpg:()=>rpg,flushRpg:()=>true,
    chronicle:{refresh:noop,close:noop,tick:noop,open:()=>{throw Error('전투 중 각인 창이 자동으로 열렸습니다');}},rpgView:{levelUp:noop,refresh:noop},
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

function personalStart(preRunBoons?:unknown,stageExtra:any={}) {
  const game:any=Object.create(Battle.prototype),state=normalizeMasterworks(null),scheduled:number[]=[];
  const stats=heroStats(HEROES.knight,{level:1,exp:0,star:1,skills:[]});
  Object.assign(game,{stage:{idx:1,ch:1,code:'1-1',...stageExtra},active:true,player:{stats:{...stats},maxHp:stats.hp,hp:stats.hp,alive:true},
    masterworks:{s:state,transact:(fn:any)=>fn(state)},chronicle:{refresh:noop,close:noop},after:(sec:number)=>scheduled.push(sec)});
  if(preRunBoons!==undefined)game.setPreRunBoons(preRunBoons);
  return {game,state,scheduled,stats};
}
async function runStart(game:any) {
  const original=RpgBattle.prototype.start;RpgBattle.prototype.start=async function(){this._startGeneration=(this._startGeneration||0)+1;};
  try{await Battle.prototype.start.call(game,game.stage,'knight',{level:1});}finally{RpgBattle.prototype.start=original;}
}

test('출격 시작은 각인 보상을 예약하지 않고, 출격 전 각인이 없으면 각인 효과도 없다',async()=>{
  const {game,scheduled}=personalStart();await runStart(game);
  expect(scheduled).toEqual([]);expect(game.run).toMatchObject({id:1,enabled:true,picked:[],preRunBoons:[]});
  expect(game.run).not.toHaveProperty('queue');expect(Object.values(game.effects).every(v=>v===0)).toBe(true);
});

test('setPreRunBoons 진입점은 다음 개인 출격 한 번에만 각인을 적용하고 랭크·조합 계산을 그대로 쓴다',async()=>{
  const ids=['ember_edge','ember_edge','ember_edge','ember_edge','storm_eye','bad',7,'__proto__'];
  const {game,stats}=personalStart(ids);
  expect(game.preRunBoons).toEqual(['ember_edge','ember_edge','ember_edge','storm_eye']);
  await runStart(game);
  expect(game.run.picked).toEqual(['ember_edge','ember_edge','ember_edge','storm_eye']);expect(game.run.preRunBoons).toEqual(game.run.picked);
  const expected=boonEffects(game.run.picked);expect(expected.atk).toBeGreaterThan(.15);
  for(const [key,value] of Object.entries(expected))expect(game.effects[key]).toBeCloseTo(value as number);
  expect(game.player.stats.atk).toBeGreaterThan(stats.atk);expect(game.preRunBoons).toBeNull();
  // 소비된 목록은 다음 출격으로 넘어가지 않는다.
  game.run=null;await runStart(game);expect(game.run.picked).toEqual([]);
});

test('파티·AI 결투처럼 개인 각인이 꺼진 출격은 출격 전 각인을 적용하지 않고 버린다',async()=>{
  for(const extra of [{party:{runId:'p'}},{expedition:{kind:'arena'}}]){
    const {game}=personalStart(['ember_edge'],extra);await runStart(game);
    expect(game.run.enabled).toBe(false);expect(game.run.picked).toEqual([]);expect(game.effects).toEqual({});expect(game.preRunBoons).toBeNull();
  }
});

test('짧은·긴·깊은 원정의 모든 방 클리어(3·6번째·마지막 접근 포함)에서 각인 보상·선택 창·일시정지가 없다',()=>{
  for(const [id,depth] of [['glass_garden','standard'],['ember_vault','standard'],['star_archive','standard'],['glass_garden','deep'],['ember_vault','deep'],['star_archive','deep']] as const)for(const auto of [false,true]){
    const {game,state}=fixture();game.stage=buildExpeditionStage('dungeon',id,{},{depth});game.world=buildExpeditionWorld(game.stage);
    game.ui.waveBanner=noop;game.spawnEnemy=noop;game.player.auto=auto;game.unsealBoss=noop;
    const scheduled:Function[]=[];game.after=(_sec:number,fn:Function)=>scheduled.push(fn);
    const toasts:string[]=[];game.ui.toast=(text:string)=>toasts.push(text);
    for(const room of game.world.rooms.filter((r:any)=>!['start','boss'].includes(r.type))){
      room.attuned=true;room.forgeWave=9;for(let i=0;i<4&&!room.cleared;i++)game.markCleared(room);
      expect(room.cleared).toBe(true);
    }
    for(const fn of scheduled)fn();
    expect(game.run.picked).toEqual([]);expect(game.paused).toBe(false);expect(game.pauseReasons.size).toBe(0);
    expect(toasts.some(t=>t.includes('각인'))).toBe(false);
    if(depth==='deep'){expect(state.story).toEqual({});expect(state.discoveries.filter((key:string)=>key.includes(':deep:')).length).toBeGreaterThan(0);}
    else expect(Object.keys(state.story)).toHaveLength(1);
  }
});

test('party stages disable personal masterworks progression and stories',()=>{
  const {game,state}=fixture();game.stage.party={code:'party'};game.run.enabled=!game.stage.party;
  game.world.rooms=[{type:'normal',cleared:false}];game.markCleared(game.world.rooms[0]);
  expect(game.resolveStoryEvent('lantern').ok).toBe(false);expect(state.story).toEqual({});expect(state.renown).toBe(0);expect(game.run.picked).toEqual([]);
});

test('party start uses its server run id without mutating or persisting personal masterworks',async()=>{
  const game:any=Object.create(Battle.prototype),state=normalizeMasterworks(null),before=structuredClone(state);
  let transactions=0,scheduled=0;
  Object.assign(game,{stage:{idx:1,ch:1,code:'1-1',party:{runId:'server-run'}},active:true,
    player:{stats:{hp:100},maxHp:100,hp:100,alive:true},masterworks:{s:state,transact:()=>{transactions++;return {ok:false,error:'save-failed'};}},
    chronicle:{refresh:noop},after:()=>scheduled++});
  await runStart(game);
  expect(transactions).toBe(0);expect(state).toEqual(before);
  expect(game.run).toMatchObject({id:'server-run',enabled:false,picked:[]});
  expect(game.effects).toEqual({});expect(scheduled).toBe(0);
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
  expect(state.discoveries).toHaveLength(0);expect(state.renown).toBe(0);expect(state.story).toEqual({});
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
  const {game,state}=fixture();const toasts:string[]=[];game.ui.toast=(text:string)=>toasts.push(text);
  const first=game.resolveStoryEvent('lantern');
  expect(first.ok).toBe(true);expect(first.choiceId).toBe('guide');expect(state.story.lantern).toBe('guide');expect(state.renown).toBe(6);expect(game.run.renown).toBe(6);
  expect(toasts.at(-1)).toBe('꺼지지 않는 등불 · 길을 밝힌다 · 명성 +6');
  game.player.hp=game.player.maxHp-200;
  const hp=game.player.hp;expect(game.resolveStoryEvent('lantern').ok).toBe(true);
  expect(game.player.hp).toBe(hp+Math.round(game.player.maxHp*.06));expect(state.renown).toBe(6);expect(game.run.renown).toBe(6);
  expect(toasts.at(-1)).toBe('꺼지지 않는 등불 · 다시 만남 · 체력 +6%');
  game.result={};game.settleChronicle('defeat');expect(game.result.masterworks.renown).toBe(6);
  game.settleChronicle('defeat');expect(state.history).toHaveLength(1);
  expect(game.resolveStoryEvent('lantern').ok).toBe(false);
});

test('예전 선택이 회복이면 재방문은 12% 회복이고, 저장 실패는 전투를 멈추지 않고 가장자리 알림만 남긴다',()=>{
  const {game,state}=fixture();state.story.bridge='repair';game.player.hp=10;
  expect(game.resolveStoryEvent('bridge').ok).toBe(true);expect(game.player.hp).toBe(10+Math.round(game.player.maxHp*.12));expect(state.renown).toBe(0);
  const failing=fixture();const toasts:string[]=[];failing.game.ui.toast=(text:string,tone:string)=>toasts.push(`${tone}:${text}`);
  failing.game.masterworks.transact=()=>({ok:false,error:'storage'});
  expect(failing.game.resolveStoryEvent('archive').ok).toBe(false);expect(failing.state.story).toEqual({});expect(failing.game.paused).toBe(false);
  expect(toasts).toEqual(['red:길 위의 만남 · 기록하지 못했습니다']);
});

for(const event of STORY_EVENTS)test(`${event.id} 첫 만남은 첫 선택지(${event.choices[0].id})로 자동 기록되고 보상이 정확히 한 번 들어간다`,()=>{
  const {game,state}=fixture();game.player.hp=20;
  const result=game.resolveStoryEvent(event.id),choice=event.choices[0];
  expect(result.ok).toBe(true);expect(state.story[event.id]).toBe(choice.id);
  expect(state.renown).toBe(Number(choice.effects.renown||0));expect(game.player.hp).toBe(20+Math.round(game.player.maxHp*Number(choice.effects.heal||0)));
});

test('active control sampling records mixed AUTO honestly and ignores pauses, dead actors and settled results',()=>{
  const {game}=fixture();game.run.controlSeen=0;game.player.auto=false;
  game.observeRunControl(0);expect(game.run.controlSeen).toBe(0);
  game.observeRunControl(1/60);expect(game.run.controlSeen).toBe(1);
  game.player.auto=true;game.paused=true;game.observeRunControl(1/60);expect(game.run.controlSeen).toBe(1);
  game.paused=false;game.player.alive=false;game.observeRunControl(1/60);expect(game.run.controlSeen).toBe(1);
  game.player.alive=true;game.observeRunControl(1/60);expect(game.run.controlSeen).toBe(3);
  game.run.settled=true;game.run.controlSeen=2;game.player.auto=false;game.observeRunControl(1/60);expect(game.run.controlSeen).toBe(2);
});

test('one settlement captures actual route and mastery metrics once, and a failed save retry cannot mint another record or reward',()=>{
  const {game,state}=fixture();let saved=false,attempts=0;
  game.stage=buildExpeditionStage('dungeon','bellfall_crypt',{});game.heroId='mage';game.growthStart={level:3};
  Object.assign(game.run,{controlSeen:3,perfects:2,breaks:4});game.elapsed=127.25;game.result={win:false};
  game.flushRpg=()=>{attempts++;game.rpgDirty=!saved;return saved;};
  game.settleChronicle('defeat');const before=JSON.stringify(state);
  expect(state.history).toHaveLength(1);expect(state.history[0].details).toMatchObject({route:{kind:'dungeon',id:'bellfall_crypt',depth:'standard'},heroId:'mage',heroLevel:3,control:'mixed',perfects:2,breaks:4,timeSec:127.25});
  expect(game.rpgDirty).toBe(true);expect(state.renown).toBe(0);
  game.elapsed=300;game.run.perfects=99;game.settleChronicle('defeat');expect(JSON.stringify(state)).toBe(before);expect(attempts).toBe(1);
  saved=true;game.flushRpg();expect(game.rpgDirty).toBe(false);expect(state.history).toHaveLength(1);expect(JSON.stringify(state)).toBe(before);
});

test('pause ownership blocks simulation while another panel still holds a pause',()=>{
  const {game}=fixture();game.enemies=[{alive:true,posture:50,breakT:1}];
  game.setPaused('catalogue',true);game.setPaused('masterworks',true);game.setPaused('masterworks',false);
  expect(game.paused).toBe(true);expect(game.input.enabled).toBe(false);
  game.update(.1);expect(game.elapsed).toBe(0);expect(game.enemies[0].breakT).toBe(1);expect(game.enemies[0].posture).toBe(50);
  game.setPaused('catalogue',false);expect(game.paused).toBe(false);expect(game.input.enabled).toBe(true);
});

test('defeated actors cannot resolve a story, and cooldown is capped',()=>{
  const {game,state}=fixture();game.player.alive=false;
  expect(game.resolveStoryEvent('lantern').ok).toBe(false);expect(state.renown).toBe(0);expect(state.story).toEqual({});
  game.effects={cooldown:100};expect(game.skillCooldown(10)).toBe(6.5);
});

test('short ember dungeon resolves its story once only after both reinforcement waves clear',()=>{
  const {game,state}=fixture();game.stage=buildExpeditionStage('dungeon','ember_vault',{});game.world=buildExpeditionWorld(game.stage);
  game.ui.waveBanner=noop;game.spawnEnemy=noop;
  const room=game.world.rooms.find((r:any)=>r.type==='elite');
  expect(game.world.rooms.map((r:any)=>r.type)).toEqual(['start','elite','boss']);
  for(let i=0;i<2;i++){game.markCleared(room);expect(room.cleared).toBe(false);expect(state.story).toEqual({});}
  game.markCleared(room);expect(game.roomsCleared).toBe(1);
  expect(state.story).toEqual({bridge:'rebuild'});expect(game.run.storySeen).toBe(true);
  const renown=state.renown;game.markCleared(room);expect(state.renown).toBe(renown);
  game.markCleared(game.world.bossRoom);expect(state.story).toEqual({bridge:'rebuild'});
});

test('longer dungeons keep treasure and two-room story timing before their final approach',()=>{
  for(const trigger of ['treasure','second-room']){
    const {game,state}=fixture();game.stage=buildExpeditionStage('dungeon','glass_garden',{});game.world=buildExpeditionWorld(game.stage);
    const normal=game.world.rooms.filter((r:any)=>r.type==='normal');
    if(trigger==='treasure'){
      const treasure=game.world.rooms.find((r:any)=>r.type==='treasure');treasure.attuned=true;game.markCleared(treasure);
      expect(game.roomsCleared).toBe(1);
    }else{
      game.markCleared(normal[0]);expect(state.story).toEqual({});
      game.markCleared(normal[1]);expect(game.roomsCleared).toBe(2);
    }
    expect(state.story).toEqual({lantern:'guide'});
    expect(game.world.rooms.some((r:any)=>!r.cleared&&r.type!=='start'&&r.type!=='boss')).toBe(true);
  }
});

test('short dungeon final approach does not produce story or discovery after settlement',()=>{
  const {game,state}=fixture();game.stage=buildExpeditionStage('dungeon','ember_vault',{});game.world=buildExpeditionWorld(game.stage);
  const room=game.world.rooms.find((r:any)=>r.type==='elite');room.forgeWave=2;game.active=false;game.run.settled=true;
  game.markCleared(room);expect(state.story).toEqual({});expect(state.discoveries).toHaveLength(0);expect(state.renown).toBe(0);
});

test('수동과 AUTO는 같은 방 클리어에서 같은 결과를 내고, update 는 대기열 없이 전투를 이어 간다',()=>{
  const results=[false,true].map(auto=>{
    const {game,state}=fixture();game.stage=buildExpeditionStage('dungeon','glass_garden',{});game.world=buildExpeditionWorld(game.stage);
    game.ui.waveBanner=noop;game.spawnEnemy=noop;game.player.auto=auto;
    const scheduled:Function[]=[];game.after=(_sec:number,fn:Function)=>scheduled.push(fn);
    for(const room of game.world.rooms.filter((r:any)=>r.type==='normal'))game.markCleared(room);
    for(const fn of scheduled)fn();
    return {story:state.story,renown:state.renown,picked:game.run.picked,paused:game.paused,scheduled:scheduled.length};
  });
  expect(results[0]).toEqual(results[1]);expect(results[0].picked).toEqual([]);expect(results[0].paused).toBe(false);
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
    const comboToken={};game.damageEnemy(primary,100,{source,finisher:true,basic:true,comboToken});
    expect(primary.hits[0].amount).toBe(180);expect(ult).toHaveLength(2);expect(ult[0]).toBeCloseTo(2.1);expect(ult[1]).toBeCloseTo(10.5);expect(other.hits[0].amount).toBeCloseTo(237.6);
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
