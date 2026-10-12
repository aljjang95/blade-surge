import {afterEach, expect, mock, spyOn, test} from 'bun:test';
import * as THREE from 'three';
import {audio} from '../src/engine/audio.js';
import {Battle} from '../src/game/battle.js';

afterEach(() => mock.restore());
function soundFixture() {
  const sound:any = new (audio.constructor as any)();
  const heard:string[] = [];
  sound.ctx = {currentTime:1,state:'running'};
  sound.pick = sound.thump = sound.ting = sound.contactSnap = () => {};
  sound.play = (name:string) => heard.push(name);
  return {sound,heard};
}
for (const [crit,finisher,accent] of [[false,false,null],[true,false,'light'],[false,true,'heavy'],[true,true,'heavy']] as const) {
  test(`real damage path: critical=${crit}, finisher=${finisher} reaches ${accent ?? 'no'} Flow accent`, () => {
    const {sound,heard} = soundFixture();
    spyOn(audio,'hit').mockImplementation(sound.hit.bind(sound));
    spyOn(audio,'vibe').mockImplementation(() => false);
    const noop=()=>{};
    const game:any={active:true,stage:{},app:{},feedbackCount:0,feedbackSound:false,player:{stats:{crit:crit?1:0,critDmg:1.5},addUlt:noop},dmgDealt:0,combo:0,maxCombo:0,ui:{setCombo:noop},
      fx:{dmgLayer:{children:[]},damage:noop,contact:noop,texFlash:noop,light:noop},timeCtl:{hitstop:noop},renderer:{shake:noop}};
    Battle.prototype.damageEnemy.call(game,{alive:true,spawning:false,receiveImpact:noop,hurt:()=>10,pos:new THREE.Vector3(),def:{scale:1}},10,{finisher});
    expect(game.dmgDealt).toBe(10);
    expect(heard).toEqual(accent ? [`expansion/flow-impact-${accent}`] : []);
  });
}
test('crowd burst: 창당 2음 안에서 마무리가 즉시 울리고 이후 치명타는 창이 열릴 때 가장 센 하나만 낸다',()=>{
  const {sound,heard}=soundFixture(); let timer:()=>void=()=>{};
  spyOn(globalThis,'setTimeout').mockImplementation(((fn:()=>void)=>{timer=fn;return 99;}) as any);
  sound.hit();
  sound.hit('slash',{heavy:true,finisher:true});
  for(let i=0;i<30;i++) sound.hit('slash',{crit:true,heavy:true,finisher:false});
  // 첫 두 타격은 즉시 재생되고(마무리의 강타 accent 포함) 나머지 30개는 대기열 하나로 합쳐진다.
  expect(heard).toEqual(['expansion/flow-impact-heavy']);
  sound.ctx.currentTime+=.05; timer();
  expect(heard).toEqual(['expansion/flow-impact-heavy','expansion/flow-impact-light']);
  sound.setSfxOn(false);
});
test('mute cancels a queued critical accent before it can sound',()=>{
  const {sound,heard}=soundFixture(); let timer:()=>void=()=>{};
  spyOn(globalThis,'setTimeout').mockImplementation(((fn:()=>void)=>{timer=fn;return 99;}) as any);
  // 창당 2음을 채운 뒤의 세 번째(치명타)만 대기열에 남고, 음소거가 그것을 취소한다.
  sound.hit(); sound.hit(); sound.hit('slash',{crit:true,heavy:true}); sound.setSfxOn(false);
  sound.ctx.currentTime+=.1; timer();
  expect(heard).toHaveLength(0);
});
test('hit tiers change the physical punch profile while retaining a short contact snap',()=>{
  const {sound}=soundFixture(); const thumps:any[]=[]; const snaps:any[]=[];
  sound.thump=(opts:any)=>thumps.push(opts); sound.contactSnap=(opts:any)=>snaps.push(opts); sound.ting=()=>{};
  sound._renderHit('slash',{crit:false,heavy:false,finisher:false,boss:false});
  sound._renderHit('slash',{crit:false,heavy:true,finisher:false,boss:false});
  sound._renderHit('slash',{crit:true,heavy:true,finisher:true,boss:true});
  expect(thumps.map((hit)=>hit.freq)).toEqual([102,68,48]);
  expect(snaps.map((hit)=>hit.freq)).toEqual([1900,1260,980,620]);
  expect(thumps[2].dur).toBeGreaterThan(thumps[0].dur);
});
for(const kind of ['campaign','dungeon','arena']) test(`${kind}: boss entry and revive retain the correct music route`,()=>{
  const music=spyOn(audio,'playMusic').mockImplementation(()=>{}), noop=()=>{};
  const game:any={stage:kind==='campaign'?{}:{expedition:{kind}},roomRoster:()=>['skeleton'],maxAlive:16,enemies:[],pending:[],
    player:{pos:new THREE.Vector3(),alive:false,revive(){this.alive=true;}},ui:{toast:noop,waveBanner:noop},renderer:{shake:noop},after:noop,
    active:true,paused:false,revived:0,input:{clear:noop},fx:{holyBurst:noop,shockTex:noop},hitRadius:noop,boss:{}};
  Battle.prototype.enterRoom.call(game,{type:'boss',x:10,z:0});
  expect(music.mock.calls[0][0]).toBe(kind==='arena'?'regions/arena':'regions/boss');
  Battle.prototype.revivePlayer.call(game);
  expect(music.mock.calls[1][0]).toBe(kind==='arena'?'regions/arena':'regions/boss');
  expect(music.mock.calls[1][1]).toEqual({fade:.7,volume:.55});
});
