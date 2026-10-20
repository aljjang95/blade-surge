import {afterEach, expect, mock, spyOn, test} from 'bun:test';
import {AudioSys} from '../src/engine/audio.js';
import {COMBAT_SOUND_FILES, FX_SOUND_FILES, HERO_BY_WEAPON, HIT_SOUND_FILES, UI_SOUND_NAMES} from '../src/engine/combat-sound-library.js';

class Param {
  value=1;
  setValueAtTime(value:number){this.value=value;}
  linearRampToValueAtTime(value:number){this.value=value;}
  exponentialRampToValueAtTime(value:number){this.value=value;}
  cancelScheduledValues(){}
}
class AudioNode {
  gain=new Param(); frequency=new Param(); Q=new Param(); playbackRate=new Param();
  buffer:any; onended:(()=>void)|null=null;
  connect(){} disconnect(){} start(){} stop(){}
}
/** library=true: Mirelo 타격·영웅·효과 파일이 모두 준비된 상태. false: UI 파일만 있어 합성 폴백으로 내려가는 상태. */
function fixture({library=true}={}) {
  const s:any=new AudioSys();
  const ctx:any={currentTime:1,state:'running',sampleRate:8000,
    createGain:()=>new AudioNode(),createOscillator:()=>new AudioNode(),
    createBiquadFilter:()=>new AudioNode(),createBufferSource:()=>new AudioNode(),
    createBuffer:(_channels:number,length:number)=>{
      const samples=new Float32Array(length);return {getChannelData:()=>samples};
    }};
  s.ctx=ctx;s.sfxGain=new AudioNode() as any;s.voiceGain=new AudioNode() as any;
  const files=library?[...HIT_SOUND_FILES,...COMBAT_SOUND_FILES,...FX_SOUND_FILES,...UI_SOUND_NAMES]:[...UI_SOUND_NAMES];
  for(const name of files)s.buffers[name]={name,duration:1};
  s.voiceBuf.bark0=s.voiceBuf.bark1={duration:1};
  // 음성 상한으로 먼저 끝난 음도 셀 수 있게, 실제로 시작된 샘플을 모두 기록한다.
  s.played=[] as string[];
  const sample=s._sample.bind(s);
  s._sample=(buffer:any,opts:any)=>{const src=sample(buffer,opts);if(src)s.played.push(buffer?.name);return src;};
  return s;
}
const heard=(s:any)=>s.played as string[];
afterEach(()=>mock.restore());

test('Mirelo sample paths (every hit tier, weapon, hurt, swing, fx) leave the gameplay random stream untouched',()=>{
  const gameRandom=spyOn(Math,'random').mockImplementation(()=>{throw new Error('Audio consumed gameplay RNG');});
  const s=fixture();
  const sampled=s.play('hit_metal0',{min:0});
  expect(sampled.playbackRate.value).toBeGreaterThanOrEqual(.92);
  expect(sampled.playbackRate.value).toBeLessThan(1.08);
  s.pick('hit_metal',3,{min:0});s.bark('bark',{n:2,min:0});
  for(const weapon of Object.keys(HERO_BY_WEAPON)) {
    s.attackRelease({weapon,finisher:true,ranged:weapon==='bow'});
    for(const kind of ['slash','blunt','magic','hurt']) {
      s.ctx.currentTime+=.1;s._renderHit(kind,{crit:true,heavy:true,finisher:true,boss:true,tier:'boss',weapon});
    }
  }
  s.clang();s.ice();s.zap();
  // 위 경로가 실제로 Mirelo 파일을 재생했다(소리 없는 통과가 아니다).
  expect(heard(s).filter(name=>name?.startsWith('mirelo-v1/')).length).toBeGreaterThan(20);
  // 무기마다 그 영웅의 전용 파일이 실제로 재생됐다.
  for(const hero of new Set(Object.values(HERO_BY_WEAPON) as string[]))
    expect(heard(s).some(name=>name?.startsWith(`mirelo-v1/hero/${hero}/`))).toBe(true);
  expect(gameRandom).not.toHaveBeenCalled();
});

test('synthetic fallback (no Mirelo files loaded) builds noise and compound hits from the audio-only random stream',()=>{
  const gameRandom=spyOn(Math,'random').mockImplementation(()=>{throw new Error('Audio consumed gameplay RNG');});
  const s=fixture({library:false});
  const noise=s._noise(.1).buffer.getChannelData(0);
  expect(noise.length).toBe(800);
  expect([...noise].every(value=>Number.isFinite(value)&&value>=-1&&value<=1)).toBe(true);
  expect(new Set(noise).size).toBeGreaterThan(700);
  for(const kind of ['slash','blunt','magic','hurt']) {
    s.ctx.currentTime+=.1;s._renderHit(kind,{crit:true,heavy:true,finisher:true,boss:true});
  }
  s.clang();s.ice();s.zap();
  expect(heard(s).some(name=>name?.startsWith('mirelo-v1/hit/'))).toBe(false);
  expect(gameRandom).not.toHaveBeenCalled();
});

test('a delayed native hit flush consumes only audio randomness and preserves the 2-voices-per-50ms window',()=>{
  const gameRandom=spyOn(Math,'random').mockImplementation(()=>{throw new Error('Timer consumed gameplay RNG');});
  const callbacks:Array<()=>void>=[],delays:number[]=[];
  spyOn(globalThis,'setTimeout').mockImplementation(((fn:()=>void,delay:number)=>{
    callbacks.push(fn);delays.push(delay);return 123;
  }) as any);
  // 50ms 창에 이미 2음이 찼을 때만 다음 타격이 지연된다(창당 최대 2음 계약).
  const s=fixture();s._hitRecent=[.97,.98];
  s.hit('slash',{crit:true,heavy:true,weapon:'dual'});
  expect(callbacks).toHaveLength(1);expect(delays[0]).toBeGreaterThanOrEqual(20);expect(delays[0]).toBeLessThanOrEqual(21);
  expect(s._voices.size).toBe(0);
  s.ctx.currentTime=1.03;callbacks[0]();
  expect(s._hitTimer).toBeNull();expect(s._hitPending).toBeNull();expect(s._hitLast).toBe(1.03);
  // 창이 열리면 대기하던 강타가 영웅 접촉음까지 포함해 한 번에 재생된다.
  expect(s._voices.size).toBeGreaterThan(0);expect(heard(s).some(name=>name?.startsWith('mirelo-v1/hero/rogue/hit_'))).toBe(true);
  expect(gameRandom).not.toHaveBeenCalled();
});

test('mute and unavailable context leave the same next gameplay random values',()=>{
  const values=[.17,.83,.41];let index=0;
  const gameRandom=spyOn(Math,'random').mockImplementation(()=>values[index++]);
  const s=fixture();expect(Math.random()).toBe(values[0]);
  s.setSfxOn(false);s.hit('slash',{crit:true});s.play('hit_metal0');
  s.setSfxOn(true);s.hit('magic',{heavy:true});
  const unavailable=new AudioSys();unavailable.play('hit_metal0');unavailable.hit('slash');
  expect(Math.random()).toBe(values[1]);expect(gameRandom).toHaveBeenCalledTimes(2);
});

test('zero entropy and denied entropy both produce a bounded varying audio stream without gameplay randomness',()=>{
  const gameRandom=spyOn(Math,'random').mockImplementation(()=>{throw new Error('Seed consumed gameplay RNG');});
  const entropy=spyOn(globalThis.crypto,'getRandomValues').mockImplementation(((array:Uint32Array)=>array.fill(0)) as any);
  for(const denied of [false,true]) {
    if(denied)entropy.mockImplementation(()=>{throw new Error('Entropy unavailable');});
    const s=new AudioSys(),values=Array.from({length:4096},()=>s._random());
    expect(values.every(value=>Number.isFinite(value)&&value>=0&&value<1)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(4000);
  }
  expect(gameRandom).not.toHaveBeenCalled();
});
