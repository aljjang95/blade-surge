import { afterEach, beforeEach, expect, test } from 'bun:test';
import { CameraControls } from '../src/engine/camera-control.js';

class Surface extends EventTarget {
  captured = new Set<number>();
  classList = {contains:()=>false};
  contains(target:unknown) { return target === this; }
  closest() { return null; }
  setPointerCapture(id:number) { this.captured.add(id); }
  hasPointerCapture(id:number) { return this.captured.has(id); }
  releasePointerCapture(id:number) { this.captured.delete(id); }
}
const original = ['window','document'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
let camera:CameraControls, app:any, pad:Surface, world:Surface, doc:EventTarget, host:EventTarget, clear:()=>void;
function send(target:EventTarget,type:string,props:Record<string,unknown>={}) {
  const event = new Event(type,{cancelable:true});
  for (const [key,value] of Object.entries(props)) Object.defineProperty(event,key,{value});
  target.dispatchEvent(event); return event;
}
beforeEach(()=>{
  pad = new Surface(); world = new Surface(); host = new EventTarget();
  doc = Object.assign(new EventTarget(), {hidden:false,getElementById:(id:string)=>id==='battle-camera-pad'?pad:null});
  Object.defineProperty(globalThis,'document',{configurable:true,value:doc});
  Object.defineProperty(globalThis,'window',{configurable:true,value:host});
  app = {mode:'battle',battle:{active:true,paused:false},renderer:{},input:{onClear:(fn:()=>void)=>{clear=fn;}}};
  camera = new CameraControls(app);
});
afterEach(()=>{ for(const [key,descriptor] of original) { if(descriptor) Object.defineProperty(globalThis,key,descriptor); else Reflect.deleteProperty(globalThis,key); } });
const pointer = (id=1,target=world) => ({pointerId:id,pointerType:'mouse',button:2,clientX:100,clientY:100,target});
test('pause input clear ends capture before resume so stale drag cannot jump',()=>{
  send(doc,'pointerdown',pointer()); expect(world.hasPointerCapture(1)).toBe(true);
  app.battle.paused=true; clear(); expect(world.hasPointerCapture(1)).toBe(false);
  app.battle.paused=false;
  send(doc,'pointermove',{...pointer(),clientX:300}); expect(camera.value.yaw).toBe(0);
});
test('touch world and foreign pointers cannot steal camera pad drag',()=>{
  send(doc,'pointerdown',{...pointer(),pointerType:'touch'}); expect(camera.drag).toBeUndefined();
  send(doc,'pointerdown',{...pointer(2,pad),pointerType:'touch',button:0});
  send(doc,'pointermove',{...pointer(3,pad),clientX:200}); expect(camera.value.yaw).toBe(0);
  send(doc,'pointerup',pointer(3,pad)); expect(pad.hasPointerCapture(2)).toBe(true);
  send(doc,'pointermove',{...pointer(2,pad),clientX:200}); expect(camera.value.yaw).toBe(-35);
  send(doc,'pointercancel',pointer(2,pad)); expect(pad.hasPointerCapture(2)).toBe(false);
});
test('camera key consumes arrow and preserves browser shortcuts',()=>{
  expect(send(pad,'keydown',{key:'ArrowLeft'}).defaultPrevented).toBe(true);
  expect(camera.value.yaw).toBe(-8);
  expect(send(pad,'keydown',{key:'ArrowLeft',ctrlKey:true}).defaultPrevented).toBe(false);
  expect(camera.value.yaw).toBe(-8);
});
test('pinch browser zoom is not intercepted and ordinary wheel stays bounded',()=>{
  expect(send(doc,'wheel',{target:world,deltaY:-1,ctrlKey:true}).defaultPrevented).toBe(false);
  expect(camera.value.zoom).toBe(100);
  for(let i=0;i<20;i++) send(doc,'wheel',{target:world,deltaY:-1});
  expect(camera.value.zoom).toBe(140);
});
test('page lifecycle cancels capture without resetting chosen framing',()=>{
  camera.set({yaw:35,pitch:4,zoom:120});
  for(const type of ['pagehide','resize','orientationchange']) {
    send(doc,'pointerdown',pointer()); send(host,type); expect(world.hasPointerCapture(1)).toBe(false);
    expect(camera.value).toEqual({yaw:35,pitch:4,zoom:120});
  }
});
