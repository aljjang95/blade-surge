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
const touch = (id=1,target=world,clientX=100,clientY=100) => ({pointerId:id,pointerType:'touch',button:0,clientX,clientY,target});
test('빈 화면 한 손가락은 문턱을 넘은 뒤에만 회전하고 조이스틱·버튼 터치는 가져가지 않는다',()=>{
  const joy = Object.assign(new Surface(),{ui:true}), skill = Object.assign(new Surface(),{ui:true});
  send(doc,'pointerdown',touch(7,joy,60,500)); send(doc,'pointerdown',touch(8,skill,700,500));
  send(doc,'pointermove',touch(7,joy,160,500)); send(doc,'pointermove',touch(8,skill,800,500));
  expect(camera.value).toEqual({yaw:0,pitch:0,zoom:100}); expect(camera.touch.size).toBe(0);
  // 조이스틱 손가락이 남아 있어도 빈 화면 손가락은 따로 시점을 돌린다.
  expect(send(doc,'pointerdown',touch(1)).defaultPrevented).toBe(false);
  expect(send(doc,'pointermove',touch(1,world,105,103)).defaultPrevented).toBe(false);
  expect(camera.value.yaw).toBe(0); expect(world.hasPointerCapture(1)).toBe(false);
  expect(send(doc,'pointermove',touch(1,world,160,100)).defaultPrevented).toBe(true);
  expect(world.hasPointerCapture(1)).toBe(true);
  // 문턱 8px만큼 기준점을 옮겨 시작 순간 튀지 않는다: (60-8)*.35
  expect(camera.value.yaw).toBeCloseTo(-18.2,6); expect(camera.value.pitch).toBe(0);
  send(doc,'pointermove',touch(1,world,160,140)); expect(camera.value.pitch).toBeCloseTo(6,6);
  expect(send(doc,'pointerup',touch(1,world,160,140)).defaultPrevented).toBe(true);
  expect(world.captured.size).toBe(0); expect(camera.touch.size).toBe(0);
  send(doc,'pointermove',touch(1,world,400,140)); expect(camera.value.yaw).toBeCloseTo(-18.2,6);
  // 탭만 하고 뗀 손가락은 시점을 바꾸지 않고 기본 동작도 막지 않는다.
  send(doc,'pointerdown',touch(2)); expect(send(doc,'pointerup',touch(2)).defaultPrevented).toBe(false);
});
test('두 빈 화면 손가락은 핀치하고 남은 손가락은 자기 위치에서 점프 없이 회전을 이어 간다',()=>{
  send(doc,'pointerdown',touch(1,world,100,100));
  expect(send(doc,'pointerdown',touch(2,world,140,100)).defaultPrevented).toBe(true);
  expect(world.hasPointerCapture(1) && world.hasPointerCapture(2)).toBe(true);
  send(doc,'pointerdown',touch(3,world,300,300)); expect(camera.touch.has(3)).toBe(false);
  send(doc,'pointermove',touch(2,world,150,100));
  expect(camera.value).toEqual({yaw:0,pitch:0,zoom:125});
  send(doc,'pointermove',touch(2,world,200,100)); expect(camera.value.zoom).toBe(140);
  send(doc,'pointermove',touch(2,world,150,100)); expect(camera.value.zoom).toBe(125);
  send(doc,'pointerup',touch(1,world,100,100));
  expect(world.hasPointerCapture(1)).toBe(false); expect(world.hasPointerCapture(2)).toBe(true);
  send(doc,'pointermove',touch(2,world,150,100)); expect(camera.value).toEqual({yaw:0,pitch:0,zoom:125});
  send(doc,'pointermove',touch(2,world,170,100)); expect(camera.value.yaw).toBeCloseTo(-7,6);
  expect(camera.value.zoom).toBe(125);
  send(doc,'pointerup',touch(2,world,170,100)); expect(world.captured.size).toBe(0);
});
test('취소·다른 요소 캡처 알림·사망·모달·resize 경계에서 제스처를 정리하고 멈춘 시점을 유지한다',()=>{
  const rotate = (id:number) => { send(doc,'pointerdown',touch(id)); send(doc,'pointermove',touch(id,world,140,100)); };
  rotate(1); const chosen = camera.value;
  send(doc,'lostpointercapture',touch(1,pad)); expect(world.hasPointerCapture(1)).toBe(true);
  send(doc,'pointercancel',touch(1)); expect(world.captured.size).toBe(0);
  send(doc,'pointermove',touch(1,world,300,100)); expect(camera.value).toEqual(chosen);
  rotate(2); send(doc,'lostpointercapture',touch(2)); expect(world.captured.size).toBe(0); expect(camera.touch.size).toBe(0);
  for (const end of [() => { app.battle.player = {alive:false}; }, () => { modal.showing = true; }]) {
    rotate(3); const before = camera.value; end();
    expect(send(doc,'pointermove',touch(3,world,400,100)).defaultPrevented).toBe(false);
    expect(camera.value).toEqual(before); expect(world.captured.size).toBe(0);
    expect(send(doc,'pointerdown',touch(4)).defaultPrevented).toBe(false); expect(camera.touch.size).toBe(0);
    app.battle.player = {alive:true}; modal.showing = false;
  }
  for (const type of ['resize','blur','orientationchange']) {
    send(doc,'pointerdown',touch(5)); send(doc,'pointerdown',touch(6,world,160,100));
    send(host,type); expect(world.captured.size).toBe(0); expect(camera.touch.size).toBe(0);
  }
  send(doc,'pointerdown',touch(5)); send(doc,'pointerdown',touch(6,world,160,100)); clear();
  expect(world.captured.size).toBe(0); expect(camera.touch.size).toBe(0);
});
test('숨긴 시점 패드 터치도 빈 화면 제스처와 같은 문턱을 쓴다',()=>{
  send(doc,'pointerdown',touch(2,pad)); send(doc,'pointermove',touch(2,pad,200,100));
  expect(pad.hasPointerCapture(2)).toBe(true); expect(camera.value.yaw).toBeCloseTo(-32.2,6);
  send(doc,'pointercancel',touch(2,pad)); expect(pad.hasPointerCapture(2)).toBe(false);
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
