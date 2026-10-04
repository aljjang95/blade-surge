import { afterEach, beforeEach, expect, test } from 'bun:test';
import { CameraControls } from '../src/engine/camera-control.js';

class Surface extends EventTarget {
  captured = new Set<number>();
  ui = false;
  showing = false;
  captureFails = false;
  classList = {contains:(name:string)=>name==='show' && this.showing};
  contains(target:unknown) { return target === this; }
  closest() { return this.ui ? this : null; }
  setPointerCapture(id:number) { if(this.captureFails) throw new Error('capture rejected'); this.captured.add(id); }
  hasPointerCapture(id:number) { return this.captured.has(id); }
  releasePointerCapture(id:number) { this.captured.delete(id); }
}
const original = ['window','document'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
let camera:CameraControls, app:any, pad:Surface, world:Surface, modal:Surface, buttons:Record<string,Surface>, doc:EventTarget, host:EventTarget, clear:()=>void;
function send(target:EventTarget,type:string,props:Record<string,unknown>={}) {
  const event = new Event(type,{cancelable:true});
  for (const [key,value] of Object.entries(props)) Object.defineProperty(event,key,{value});
  target.dispatchEvent(event); return event;
}
beforeEach(()=>{
  pad = new Surface(); world = new Surface(); host = new EventTarget();
  modal = new Surface();
  buttons = Object.fromEntries(['battle-camera-reset','battle-camera-zoom-in','battle-camera-zoom-out'].map(id=>[id,new Surface()]));
  const elements:Record<string,Surface> = { ...buttons,'battle-camera-pad':pad,modal };
  doc = Object.assign(new EventTarget(), {hidden:false,getElementById:(id:string)=>elements[id] || null});
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

// 실제 Asset12에서 관측된 이전 다이얼과 새 지역 시점의 불일치를 재현한다.
function staleDialWithCurrentProfile() {
  camera.set({yaw:-179.9,pitch:0,zoom:100});
  const profile = {yaw:-7,pitch:2,zoom:102};
  app.renderer.battleCamera = profile;
  return profile;
}
test('native right drags start from current region view rather than the prior hero dial',()=>{
  const profile = staleDialWithCurrentProfile();
  send(doc,'pointerdown',pointer());
  expect(camera.drag).toMatchObject({yaw:-7,pitch:2,zoom:102});
  expect(app.renderer.battleCamera).toBe(profile);
  send(doc,'pointermove',{...pointer(),clientX:357});
  expect(camera.value.yaw).toBeCloseTo(-96.95,10);
  expect(camera.value.pitch).toBe(2); expect(camera.value.zoom).toBe(102);
  send(doc,'pointerup',pointer());
  send(doc,'pointerdown',pointer(2));
  send(doc,'pointermove',{...pointer(2),clientX:357});
  expect(camera.value.yaw).toBeCloseTo(173.1,10);
  expect(app.renderer.battleCamera).toBe(camera.value);
  send(doc,'pointerup',pointer(2));
});
test('camera pad keys and zoom buttons preserve current renderer yaw and pitch',()=>{
  const cases:[string,{yaw:number,pitch:number,zoom:number}][] = [
    ['ArrowLeft',{yaw:-15,pitch:2,zoom:102}],['ArrowRight',{yaw:1,pitch:2,zoom:102}],
    ['ArrowUp',{yaw:-7,pitch:5,zoom:102}],['ArrowDown',{yaw:-7,pitch:-1,zoom:102}],
    ['+',{yaw:-7,pitch:2,zoom:107}],['=',{yaw:-7,pitch:2,zoom:107}],['-',{yaw:-7,pitch:2,zoom:97}],
  ];
  for(const [key,expected] of cases) {
    staleDialWithCurrentProfile();
    expect(send(pad,'keydown',{key}).defaultPrevented).toBe(true);
    expect(app.renderer.battleCamera).toEqual(expected); expect(camera.value).toEqual(expected);
  }
  staleDialWithCurrentProfile(); send(buttons['battle-camera-zoom-in'],'click');
  expect(app.renderer.battleCamera).toEqual({yaw:-7,pitch:2,zoom:112});
  staleDialWithCurrentProfile(); send(buttons['battle-camera-zoom-out'],'click');
  expect(app.renderer.battleCamera).toEqual({yaw:-7,pitch:2,zoom:92});
});
test('ordinary wheel uses the current profile and its zoom survives a captured drag',()=>{
  staleDialWithCurrentProfile();
  send(doc,'pointerdown',pointer());
  expect(send(doc,'wheel',{target:world,deltaY:-120}).defaultPrevented).toBe(true);
  expect(camera.value).toEqual({yaw:-7,pitch:2,zoom:107});
  send(doc,'pointermove',{...pointer(),clientX:180});
  expect(camera.value).toEqual({yaw:-35,pitch:2,zoom:107});
  send(doc,'pointerup',pointer());
  staleDialWithCurrentProfile(); send(doc,'wheel',{target:world,deltaY:120});
  expect(camera.value).toEqual({yaw:-7,pitch:2,zoom:97});
});
test('clear then a fresh preset drag changes neither prior capture origin nor current user zoom',()=>{
  staleDialWithCurrentProfile(); send(doc,'pointerdown',pointer());
  send(doc,'pointermove',{...pointer(),clientX:200});
  send(doc,'pointermove',{...pointer(),clientX:250});
  expect(camera.value.yaw).toBeCloseTo(-59.5,10); // 항상 최초 포인터 위치가 기준이다.
  clear(); expect(world.hasPointerCapture(1)).toBe(false);
  const nextProfile = {yaw:23,pitch:6,zoom:118}; app.renderer.battleCamera = nextProfile;
  send(doc,'pointermove',{...pointer(),clientX:300});
  expect(app.renderer.battleCamera).toBe(nextProfile);
  send(doc,'pointerdown',pointer(2)); send(doc,'pointermove',{...pointer(2),clientX:140});
  expect(camera.value).toEqual({yaw:9,pitch:6,zoom:118});
  send(doc,'pointerup',pointer(2));
});
test('rejected intents do not synchronize the stale dial or mutate the current profile',()=>{
  const rejected = () => {
    const profile = staleDialWithCurrentProfile(), dial = camera.value;
    expect(send(doc,'pointerdown',pointer()).defaultPrevented).toBe(false);
    expect(send(doc,'wheel',{target:world,deltaY:-1}).defaultPrevented).toBe(false);
    expect(send(pad,'keydown',{key:'ArrowLeft'}).defaultPrevented).toBe(false);
    send(buttons['battle-camera-zoom-in'],'click');
    expect(app.renderer.battleCamera).toBe(profile); expect(camera.value).toBe(dial);
  };
  app.battle.paused=true; rejected(); app.battle.paused=false;
  app.battle.active=false; rejected(); app.battle.active=true;
  app.mode='lobby'; rejected(); app.mode='battle';
  modal.showing=true; rejected(); modal.showing=false;
  const profile = staleDialWithCurrentProfile(), dial = camera.value;
  for(const props of [{pointerType:'touch'},{button:0}]) send(doc,'pointerdown',{...pointer(),...props});
  for(const props of [{ctrlKey:true},{metaKey:true},{deltaY:0},{deltaY:NaN}]) send(doc,'wheel',{target:world,deltaY:-1,...props});
  for(const props of [{ctrlKey:true},{metaKey:true},{altKey:true},{key:'x'}]) send(pad,'keydown',{key:'ArrowLeft',...props});
  world.ui=true; send(doc,'pointerdown',pointer()); send(doc,'wheel',{target:world,deltaY:-1}); world.ui=false;
  world.captureFails=true; send(doc,'pointerdown',pointer()); world.captureFails=false;
  expect(world.hasPointerCapture(1)).toBe(false);
  expect(app.renderer.battleCamera).toBe(profile); expect(camera.value).toBe(dial);
});
test('native reset deliberately ends capture and restores defaults instead of the current profile',()=>{
  staleDialWithCurrentProfile(); send(doc,'pointerdown',pointer());
  send(buttons['battle-camera-reset'],'click');
  expect(world.hasPointerCapture(1)).toBe(false);
  expect(camera.value).toEqual({yaw:0,pitch:0,zoom:100});
  staleDialWithCurrentProfile(); send(doc,'pointerdown',pointer(2,pad));
  expect(send(pad,'keydown',{key:'Home'}).defaultPrevented).toBe(true);
  expect(pad.hasPointerCapture(2)).toBe(false);
  expect(app.renderer.battleCamera).toEqual({yaw:0,pitch:0,zoom:100});
});
