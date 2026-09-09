import {afterEach, expect, mock, spyOn, test} from 'bun:test';
import * as THREE from 'three';
import {audio} from '../src/engine/audio.js';
import {Battle} from '../src/game/battle.js';

afterEach(() => mock.restore());
function soundFixture() {
  const sound:any = new (audio.constructor as any)();
  const heard:string[] = [];
  sound.ctx = {currentTime:1,state:'running'};
  sound.pick = sound.thump = sound.ting = () => {};
  sound.play = (name:string) => heard.push(name);
  return {sound,heard};
}
for (const [crit,finisher,accent] of [[false,false,null],[true,false,'light'],[false,true,'heavy'],[true,true,'heavy']] as const) {
  test(`real damage path: critical=${crit}, finisher=${finisher} reaches ${accent ?? 'no'} Flow accent`, () => {
    const {sound,heard} = soundFixture();
    spyOn(audio,'hit').mockImplementation(sound.hit.bind(sound));
    spyOn(audio,'vibe').mockImplementation(() => {});
    const noop=()=>{};
    const game:any={player:{stats:{crit:crit?1:0,critDmg:1.5},addUlt:noop},dmgDealt:0,combo:0,maxCombo:0,ui:{setCombo:noop},
      fx:{dmgLayer:{children:[]},damage:noop,flash:noop,directional:noop,texFlash:noop,light:noop},timeCtl:{hitstop:noop},renderer:{shake:noop}};
    Battle.prototype.damageEnemy.call(game,{hurt:()=>10,pos:new THREE.Vector3(),def:{scale:1}},10,{finisher});
    expect(game.dmgDealt).toBe(10);
    expect(heard).toEqual(accent ? [`expansion/flow-impact-${accent}`] : []);
  });
}
test('crowd burst preserves a finisher over later critical hits and emits one accent after 50ms',()=>{
  const {sound,heard}=soundFixture(); let timer:()=>void=()=>{};
  spyOn(globalThis,'setTimeout').mockImplementation(((fn:()=>void)=>{timer=fn;return 99;}) as any);
  sound.hit();
  sound.hit('slash',{heavy:true,finisher:true});
  for(let i=0;i<30;i++) sound.hit('slash',{crit:true,heavy:true,finisher:false});
  expect(heard).toHaveLength(0);
  sound.ctx.currentTime+=.05; timer();
  expect(heard).toEqual(['expansion/flow-impact-heavy']);
  sound.setSfxOn(false);
});
test('mute cancels a queued critical accent before it can sound',()=>{
  const {sound,heard}=soundFixture(); let timer:()=>void=()=>{};
  spyOn(globalThis,'setTimeout').mockImplementation(((fn:()=>void)=>{timer=fn;return 99;}) as any);
  sound.hit(); sound.hit('slash',{crit:true,heavy:true}); sound.setSfxOn(false);
  sound.ctx.currentTime+=.1; timer();
  expect(heard).toHaveLength(0);
});
for(const kind of ['campaign','dungeon','arena']) test(`${kind}: boss entry and revive retain the correct music route`,()=>{
  const music=spyOn(audio,'playMusic').mockImplementation(()=>{}), noop=()=>{};
  const game:any={stage:kind==='campaign'?{}:{expedition:{kind}},roomRoster:()=>['skeleton'],maxAlive:16,enemies:[],pending:[],
    player:{pos:new THREE.Vector3(),alive:false,revive(){this.alive=true;}},ui:{toast:noop,waveBanner:noop},renderer:{shake:noop},after:noop,
    active:true,paused:false,revived:0,input:{clear:noop},fx:{holyBurst:noop,shockTex:noop},hitRadius:noop,boss:{}};
  Battle.prototype.enterRoom.call(game,{type:'boss',x:10,z:0});
  expect(kind==='campaign'?['bgm_boss','bgm_boss2']:['expansion/flow-combat']).toContain(music.mock.calls[0][0]);
  Battle.prototype.revivePlayer.call(game);
  expect(music.mock.calls[1][0]).toBe(kind==='campaign'?'bgm_boss':'expansion/flow-combat');
  if(kind!=='campaign') expect(music.mock.calls[1][1]).toEqual({fade:.7,volume:.68});
});
