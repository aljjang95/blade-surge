import {afterEach, expect, mock, spyOn, test} from 'bun:test';
import * as THREE from 'three';
import {audio} from '../src/engine/audio.js';
import {COMBAT_SOUND_FILES, HIT_SOUND_FILES} from '../src/engine/combat-sound-library.js';
import {Battle} from '../src/game/battle.js';

afterEach(() => mock.restore());
/** library=true: Mirelo 타격 파일이 모두 준비된 실제 배송 상태. false: 파일이 없어 합성 폴백으로 내려가는 상태. */
function soundFixture({library=true}={}) {
  const sound:any = new (audio.constructor as any)();
  const heard:string[] = [];
  sound.ctx = {currentTime:1,state:'running'};
  sound.pick = sound.thump = sound.ting = sound.contactSnap = () => {};
  if (library) for (const name of [...HIT_SOUND_FILES, ...COMBAT_SOUND_FILES]) sound.buffers[name] = {name, duration:.3};
  sound.play = (name:string) => heard.push(name);
  return {sound,heard};
}
/** 재생된 타격의 바디 레이어 id(b_basic·b_heavy·b_finisher …)와 치명타·영웅 접촉 레이어. */
const bodies = (heard:string[]) => heard.filter(name => name.includes('/hit/b_')).map(name => name.replace(/^.*\/hit\/(b_[a-z]+)_\d+$/, '$1'));
const crits = (heard:string[]) => heard.filter(name => name.includes('/hit/t_crit')).length;
const heroes = (heard:string[]) => [...new Set(heard.filter(name => name.includes('/hero/')).map(name => name.split('/')[2]))];
function damageGame({crit, weapon='1h', source}:{crit:boolean, weapon?:string, source?:any}) {
  const noop=()=>{};
  return {active:true,stage:{},app:{},feedbackCount:0,feedbackSound:false,
    player:{def:{weapon},stats:{crit:crit?1:0,critDmg:1.5},addUlt:noop},dmgDealt:0,combo:0,maxCombo:0,ui:{setCombo:noop},
    fx:{dmgLayer:{children:[]},damage:noop,contact:noop,texFlash:noop,light:noop,flash:noop,directional:noop},timeCtl:{hitstop:noop},renderer:{shake:noop},source} as any;
}
const target = () => ({alive:true,spawning:false,receiveImpact:noop0,hurt:()=>10,pos:new THREE.Vector3(),def:{scale:1}});
function noop0() {}
for (const [crit,finisher,body] of [[false,false,'b_basic'],[true,false,'b_heavy'],[false,true,'b_finisher'],[true,true,'b_finisher']] as const) {
  test(`real damage path: critical=${crit}, finisher=${finisher} plays the ${body} body with the knight contact${crit ? ' and crit sparkle' : ''}`, () => {
    const {sound,heard} = soundFixture();
    spyOn(audio,'hit').mockImplementation(sound.hit.bind(sound));
    spyOn(audio,'vibe').mockImplementation(() => false);
    // 평타 타격(basic). 평타·마무리가 아닌 스킬 틱은 rpg-battle 이 가벼운(light) 등급으로 보낸다.
    const game = damageGame({crit});
    Battle.prototype.damageEnemy.call(game,target(),10,{basic:true,finisher});
    expect(game.dmgDealt).toBe(10);
    expect(bodies(heard)).toEqual([body]);
    expect(crits(heard)).toBe(crit ? 1 : 0);
    expect(heroes(heard)).toEqual(['knight']);
    expect(heard.some(name => name.startsWith('expansion/'))).toBe(false);
  });
}
test('party host: a party member hit plays that member hero contact, not the host hero', () => {
  const {sound,heard} = soundFixture();
  spyOn(audio,'hit').mockImplementation(sound.hit.bind(sound));
  spyOn(audio,'vibe').mockImplementation(() => false);
  const member = {def:{weapon:'bow'},stats:{crit:0,critDmg:1.5},addUlt:noop0};
  const game = damageGame({crit:false, weapon:'2h'});
  Battle.prototype.damageEnemy.call(game,target(),10,{basic:true,source:member});
  expect(heroes(heard)).toEqual(['ranger']);
  expect(bodies(heard)).toEqual(['b_basic']);
});
test('skill tick (neither basic nor finisher) drops to the light tier so crowd skills do not bury basic hits', () => {
  const {sound,heard} = soundFixture();
  spyOn(audio,'hit').mockImplementation(sound.hit.bind(sound));
  spyOn(audio,'vibe').mockImplementation(() => false);
  Battle.prototype.damageEnemy.call(damageGame({crit:false}),target(),10,{});
  expect(bodies(heard)).toEqual(['b_light']);
  expect(heroes(heard)).toEqual(['knight']);
});
test('crowd burst: 창당 2음 안에서 마무리가 즉시 울리고 이후 치명타는 창이 열릴 때 가장 센 하나만 낸다',()=>{
  const {sound,heard}=soundFixture(); let timer:()=>void=()=>{};
  spyOn(globalThis,'setTimeout').mockImplementation(((fn:()=>void)=>{timer=fn;return 99;}) as any);
  sound.hit();
  sound.hit('slash',{heavy:true,finisher:true});
  for(let i=0;i<30;i++) sound.hit('slash',{crit:true,heavy:true,finisher:false});
  // 첫 두 타격(일반·마무리)은 즉시 재생되고 나머지 30개는 대기열 하나로 합쳐진다.
  expect(bodies(heard)).toEqual(['b_basic','b_finisher']);
  sound.ctx.currentTime+=.05; timer();
  expect(bodies(heard)).toEqual(['b_basic','b_finisher','b_heavy']);
  expect(crits(heard)).toBe(1);
  sound.setSfxOn(false);
});
test('mute cancels a queued critical accent before it can sound',()=>{
  const {sound,heard}=soundFixture(); let timer:()=>void=()=>{};
  spyOn(globalThis,'setTimeout').mockImplementation(((fn:()=>void)=>{timer=fn;return 99;}) as any);
  // 창당 2음을 채운 뒤의 세 번째(치명타)만 대기열에 남고, 음소거가 그것을 취소한다.
  sound.hit(); sound.hit(); const before=heard.length;
  expect(bodies(heard)).toEqual(['b_basic','b_basic']);
  sound.hit('slash',{crit:true,heavy:true}); sound.setSfxOn(false);
  sound.ctx.currentTime+=.1; timer();
  expect(heard).toHaveLength(before); expect(crits(heard)).toBe(0);
});
test('hit tiers change the physical punch profile while retaining a short contact snap',()=>{
  // 합성 폴백(타격 파일이 없을 때)의 물리 펀치 프로필 계약.
  const {sound}=soundFixture({library:false}); const thumps:any[]=[]; const snaps:any[]=[];
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
