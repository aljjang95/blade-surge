import {afterEach, expect, mock, spyOn, test} from 'bun:test';
import {AudioSys} from '../src/engine/audio.js';

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
function fixture() {
  const s:any=new AudioSys();
  const ctx:any={currentTime:1,state:'running',sampleRate:8000,
    createGain:()=>new AudioNode(),createOscillator:()=>new AudioNode(),
    createBiquadFilter:()=>new AudioNode(),createBufferSource:()=>new AudioNode(),
    createBuffer:(_channels:number,length:number)=>{
      const samples=new Float32Array(length);return {getChannelData:()=>samples};
    }};
  s.ctx=ctx;s.sfxGain=new AudioNode() as any;s.voiceGain=new AudioNode() as any;
  for(const name of ['hit_metal0','hit_metal1','hit_metal2','hit_punch0','hit_punch1','hit_punch2',
    'hit_soft0','hit_soft1','hit_glass','hit_wood','expansion/flow-impact-heavy','expansion/flow-impact-light'])
    s.buffers[name]={duration:1};
  s.voiceBuf.bark0=s.voiceBuf.bark1={duration:1};
  return s;
}
afterEach(()=>mock.restore());

test('real sampled, bark, noise and compound hit paths leave the gameplay random stream untouched',()=>{
  const gameRandom=spyOn(Math,'random').mockImplementation(()=>{throw new Error('Audio consumed gameplay RNG');});
  const s=fixture();
  const noise=s._noise(.1).buffer.getChannelData(0);
  expect(noise.length).toBe(800);
  expect([...noise].every(value=>Number.isFinite(value)&&value>=-1&&value<=1)).toBe(true);
  expect(new Set(noise).size).toBeGreaterThan(700);
  const sampled=s.play('hit_metal0',{min:0});
  expect(sampled.playbackRate.value).toBeGreaterThanOrEqual(.92);
  expect(sampled.playbackRate.value).toBeLessThan(1.08);
  s.pick('hit_metal',3,{min:0});s.bark('bark',{n:2,min:0});
  for(const kind of ['slash','blunt','magic','hurt']) {
    s.ctx.currentTime+=.1;s._renderHit(kind,{crit:true,heavy:true,finisher:true,boss:true});
  }
  s.clang();s.ice();s.zap();
  expect(gameRandom).not.toHaveBeenCalled();
});

test('a delayed native hit flush consumes only audio randomness and preserves the 50ms throttle',()=>{
  const gameRandom=spyOn(Math,'random').mockImplementation(()=>{throw new Error('Timer consumed gameplay RNG');});
  const callbacks:Array<()=>void>=[],delays:number[]=[];
  spyOn(globalThis,'setTimeout').mockImplementation(((fn:()=>void,delay:number)=>{
    callbacks.push(fn);delays.push(delay);return 123;
  }) as any);
  const s=fixture();s._hitLast=.97;
  s.hit('slash',{crit:true,heavy:true});
  expect(callbacks).toHaveLength(1);expect(delays[0]).toBeGreaterThanOrEqual(20);expect(delays[0]).toBeLessThanOrEqual(21);
  expect(s._voices.size).toBe(0);
  s.ctx.currentTime=1.03;callbacks[0]();
  expect(s._hitTimer).toBeNull();expect(s._hitPending).toBeNull();expect(s._hitLast).toBe(1.03);
  expect(s._voices.size).toBeGreaterThan(0);expect(gameRandom).not.toHaveBeenCalled();
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
