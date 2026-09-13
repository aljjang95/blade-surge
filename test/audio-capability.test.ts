import {expect,test} from 'bun:test';
import {AudioSys} from '../src/engine/audio.js';

test('a missing or denied AudioContext does not trap the start gesture',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
  try {
    for(const host of [{},{AudioContext:class {constructor(){throw new Error('NotAllowedError');}}}]) {
      Object.defineProperty(globalThis,'window',{value:host,configurable:true});
      const audio=new AudioSys();
      expect(await audio.init()).toBe(false);
      expect(audio.ctx).toBeNull(); expect(audio.unavailable).toBe(true);
      expect(()=>audio.resume()).not.toThrow();
    }
  } finally {if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
});
