import {afterEach, expect, spyOn, mock, test} from 'bun:test';
import {AudioSys} from '../src/engine/audio.js';
class Param {
  value=1; events:{t:number,v:number}[]=[];
  setValueAtTime(v:number,t:number){this.value=v;this.events.push({t,v});}
  linearRampToValueAtTime(v:number,t:number){this.events.push({t,v});}
  cancelScheduledValues(t:number){this.events=this.events.filter(e=>e.t<t);}
  at(t:number){let prev={t:0,v:1};for(const e of this.events){if(e.t>t)return prev.v+(e.v-prev.v)*(t-prev.t)/(e.t-prev.t);prev=e;}return prev.v;}
}
class Node {
  gain=new Param(); playbackRate=new Param(); stopped=false; disconnected=false; onended:(()=>void)|null=null; buffer:any;
  connect(_?:any){} disconnect(){this.disconnected=true;} start(_?:number){} stop(){this.stopped=true;this.onended?.();}
}
function fixture(){
  const s:any=new AudioSys();
  s.ctx={currentTime:1,state:'running',createGain:()=>new Node(),createBufferSource:()=>new Node(),createMediaElementSource:()=>new Node(),decodeAudioData:async(b:any)=>b};
  s.sfxGain=new Node();s.voiceGain=new Node();s.musicGain=new Node();s.musicDuckGain=new Node();
  s.buffers['hit']=s.buffers['ui_click']=s.buffers['expansion/flow-impact-heavy']={duration:1};
  s.voiceBuf.bark={duration:1}; return s;
}
afterEach(()=>mock.restore());
test('sample cap evicts lowest priority, preserves UI and Flow heavy during crowd spam, cleans end',()=>{
  const s=fixture(); const ui=s.play('ui_click'), flow=s.play('expansion/flow-impact-heavy');
  for(let i=0;i<100;i++)s.play('hit',{min:0});
  expect(s._voices.size).toBe(16);expect(ui.stopped).toBe(false);expect(flow.stopped).toBe(false);
  const voice=[...s._voices][0] as any;voice.src.onended();
  expect(s._voices.size).toBe(15);expect(voice.src.disconnected).toBe(true);expect(voice.gain.disconnected).toBe(true);
});
test('barks capped independently and voice/SFX mute stops all active voices and zeros bus',async()=>{
  const s=fixture();for(let i=0;i<20;i++)s.bark('bark',{min:0});expect(s._voices.size).toBe(4);
  s.voiceBuf.line={duration:1};await s.voice('line');const nodes=[...s._voices] as any[];
  s.setVoiceOn(false);expect(s._voices.size).toBe(0);expect(s.voiceGain.gain.value).toBe(0);
  expect(nodes.every(v=>v.src.stopped&&v.gain.disconnected)).toBe(true);
  const hit=s.play('hit');s.setSfxOn(false);expect(hit.stopped).toBe(true);expect(s.sfxGain.gain.value).toBe(0);
  s.setSfxOn(true);expect(s.sfxGain.gain.value).toBe(.9);
});
test('late narration fetch cannot replace newer narration or survive mute/unmute',async()=>{
  const s=fixture();let resolve:(v:any)=>void=()=>{};
  spyOn(globalThis,'fetch').mockImplementation((()=>new Promise(r=>resolve=r)) as any);
  const pending=s.voice('old');s.voiceBuf.new={duration:2};await s.voice('new');const newer=s._voiceSrc;
  resolve({arrayBuffer:async()=>({duration:1})});await pending;expect(s._voiceSrc).toBe(newer);expect(newer.stopped).toBe(false);
  const muted=s.voice('late');s.setVoiceOn(false);s.setVoiceOn(true);resolve({arrayBuffer:async()=>({duration:1})});await muted;
  expect(s._voiceSrc).toBe(null);expect(s._voices.size).toBe(0);
});
test('mix clamps, copies values, mutes ongoing voices, and equal elapsed 30/120Hz ramps match',()=>{
  const s=fixture();expect(s.getMix()).toEqual({music:.55,sfx:.9,voice:1});
  s.setMix({music:2,sfx:-1,voice:NaN});expect(s.getMix()).toEqual({music:1,sfx:0,voice:1});
  const copy=s.getMix();copy.music=0;expect(s.getMix().music).toBe(1);
  const slow=fixture(),fast=fixture();for(let i=0;i<30;i++)slow.updateCombatMix(1/30,{active:true,paused:true});
  for(let i=0;i<120;i++)fast.updateCombatMix(1/120,{active:true,paused:true});
  expect(slow._combatLevel).toBeCloseTo(fast._combatLevel,12);expect(slow._combatLevel).toBeGreaterThanOrEqual(.72);
  const before=slow._combatLevel;slow.updateCombatMix(NaN,{paused:true});expect(slow._combatLevel).toBe(before);
  const bark=fast.bark('bark');fast.setMix({voice:0});expect(bark.stopped).toBe(true);
});
test('overlapping ducks follow minimum active envelope and recover while combat shaping is independent',()=>{
  const s=fixture();s.duck(.2,2);s.ctx.currentTime=1.2;s.duck(.8,.4);
  const g=s.musicDuckGain.gain;
  for(const t of [1.2,1.3,1.4,1.6,2,3]) {
    const old=t>=3?1:.2+.8*(t-1.1)/1.9;
    const recent=t<=1.2||t>=1.6?1:t<1.3?1-.2*(t-1.2)/.1:.8+.2*(t-1.3)/.3;
    expect(g.at(t)).toBeCloseTo(Math.min(old,recent),7);
  }
  const events=JSON.stringify(g.events);s.setMix({music:.3});s.updateCombatMix(.03,{active:true,boss:true,intensity:1});expect(JSON.stringify(g.events)).toBe(events);
});
test('rapid music crossfades stay bounded; toggle stops all tails and resumes latest requested Flow route',()=>{
  const s=fixture();const elements:any[]=[];
  const Original=(globalThis as any).Audio;
  (globalThis as any).Audio=class {paused=false;constructor(public url:string){elements.push(this);}play(){return Promise.resolve();}pause(){this.paused=true;}};
  try {
    s.playMusic('a');s.playMusic('b');s.playMusic('expansion/flow-combat',{volume:.68});expect(s._musicTracks.size).toBe(2);expect(elements[0].paused).toBe(true);
    s.setMusicOn(false);expect(s._musicTracks.size).toBe(0);expect(elements.every(e=>e.paused)).toBe(true);
    s.playMusic('expansion/flow-combat',{volume:.68});s.setMusicOn(true);expect(s.music.el.url).toBe('/bgm/expansion/flow-combat.mp3');expect(s.music.volume).toBe(.68);expect(s._musicTracks.size).toBe(1);
    s.setMusicOn(false);
  } finally {(globalThis as any).Audio=Original;}
});
test('concurrent bark preload and narration share one decode; newest intent owns playback',async()=>{
  const s=fixture();let resolve:(v:any)=>void=()=>{};
  const fetcher=spyOn(globalThis,'fetch').mockImplementation((()=>new Promise(r=>resolve=r)) as any);
  s.preloadBarks(['shared']);s.bark('shared');const a=s.voice('shared',{min:0});const b=s.voice('shared',{min:0});
  expect(fetcher).toHaveBeenCalledTimes(1);expect(s.getDiagnostics().voiceLoads).toBe(1);
  resolve({arrayBuffer:async()=>({duration:1})});await Promise.all([a,b]);
  expect(s.getDiagnostics().voiceLoads).toBe(0);expect(s.getDiagnostics().voices).toEqual({sfx:0,bark:0,narration:1});
});
