import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { FRAMING, battleFraming, framingBlend } from '../src/engine/battle-framing.js';
import { CAMERA_PRESETS } from '../src/engine/renderer.js';
import { battleCameraOffset } from '../src/engine/camera-control.js';

const enemy = (x:number,z=0,extra={}) => ({pos:{x,y:0,z},alive:true,spawning:false,...extra});
const player = (vel={x:0,z:0},lockTarget:any=null) => ({pos:{x:0,y:0,z:0},vel,lockTarget});
const frame = (args:any={}) => battleFraming({player:player(),presets:CAMERA_PRESETS,...args});
function projectedHeight(f:ReturnType<typeof frame>, controls={yaw:0,pitch:0,zoom:100}, height=400) {
  const b=f.desired, camera=new THREE.PerspectiveCamera(b.fov,16/9,.1,120);
  const off=battleCameraOffset({x:0,y:b.y,z:b.z},controls);
  camera.position.set(off.x,off.y,off.z); camera.lookAt(0,b.lookY,0); camera.updateMatrixWorld();
  const feet=new THREE.Vector3(0,0,0).project(camera),head=new THREE.Vector3(0,2.3,0).project(camera);
  return Math.abs(head.y-feet.y)*height/2;
}
test('far, dead and spawning bosses leave the ordinary framing unchanged',()=>{
  const ordinary=frame();
  for(const boss of [enemy(100),enemy(0,0,{alive:false}),enemy(0,0,{spawning:true})]) expect(frame({boss})).toEqual(ordinary);
});
test('framing result has only target, desired and bossWeight',()=>{
  expect(Object.keys(frame({boss:enemy(4)})).sort()).toEqual(['bossWeight','desired','target']);
});
test('boss weight is full blend inside bossInner, zero at bossOuter and continuous between',()=>{
  const at=(d:number)=>frame({boss:enemy(d)});
  expect(at(4).bossWeight).toBeCloseTo(FRAMING.bossBlend,10); expect(at(FRAMING.bossInner).bossWeight).toBeCloseTo(.6,10);
  expect(at(FRAMING.bossOuter).bossWeight).toBe(0); expect(at(40).bossWeight).toBe(0);
  const mid=at((FRAMING.bossInner+FRAMING.bossOuter)/2).bossWeight; expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(FRAMING.bossBlend);
  for(const edge of [FRAMING.bossInner,FRAMING.bossOuter]) {
    expect(at(edge+.001).bossWeight-at(edge-.001).bossWeight).toBeCloseTo(0,3);
    expect(at(edge+.001).desired.y-at(edge-.001).desired.y).toBeCloseTo(0,3);
  }
  let prev=Infinity; for(let d=0;d<=30;d+=.5){ const w=at(d).bossWeight; expect(w).toBeLessThanOrEqual(prev+1e-12); prev=w; }
});
test('auto desired is action blended toward wide by bossWeight',()=>{
  const f=frame({boss:enemy(4)}),a=CAMERA_PRESETS.action,w=CAMERA_PRESETS.wide;
  expect(f.bossWeight).toBeCloseTo(.6);
  for(const key of ['y','z','fov','lookY','lag'] as const) expect(f.desired[key]).toBeCloseTo(a[key]+(w[key]-a[key])*f.bossWeight,10);
  expect(frame().desired).toEqual(CAMERA_PRESETS.action);
});
test('crowd enemies and removed impact inputs do not affect framing',()=>{
  const ordinary=frame();
  expect(frame({enemies:Array.from({length:40},()=>enemy(2))})).toEqual(ordinary);
  expect(frame({enemies:[enemy(3),enemy(5,2)],impactTarget:enemy(3,3),impactWeight:1})).toEqual(ordinary);
});
test('explicit presets retain their selected lens even during a boss crowd',()=>{
  for(const preset of ['top','action','wide']) {
    const f=frame({preset,boss:enemy(3),enemies:Array.from({length:40},()=>enemy(2))});
    expect(f.desired).toEqual(CAMERA_PRESETS[preset as keyof typeof CAMERA_PRESETS]);
  }
});
test('dash anticipation and lock bias remain bounded for retained and holdout directions',()=>{
  for(const angle of [0,.47,Math.PI/2,2.31,Math.PI]) for(const speed of [0,6,25,500]) {
    const c=Math.cos(angle),s=Math.sin(angle);
    const f=frame({player:player({x:c*speed,z:s*speed},enemy(c*7,s*7))});
    expect(Math.hypot(f.target.x,f.target.z)).toBeLessThanOrEqual(FRAMING.totalMax+1e-8);
  }
  expect(frame({player:player({x:0,z:0},enemy(1000))}).target).toEqual({x:0,y:0,z:0});
});
test('lead plus lock bias never exceeds totalMax in any direction at any speed',()=>{
  expect(FRAMING.totalMax).toBe(.8);
  for(let i=0;i<16;i++) for(const speed of [.4,1,3,6,25,500]) for(const dist of [2,8,12,18]) {
    const c=Math.cos(i*Math.PI/8),s=Math.sin(i*Math.PI/8);
    const f=frame({player:player({x:c*speed,z:s*speed},enemy(c*dist,s*dist))});
    expect(Math.hypot(f.target.x,f.target.z)).toBeLessThanOrEqual(FRAMING.totalMax+1e-8);
  }
});
test('default 2.3u hero is readable at 400px, also in a crowd and in boss framing',()=>{
  const regular=projectedHeight(frame());
  expect(regular).toBeGreaterThanOrEqual(80); expect(regular).toBeLessThan(100);
  expect(projectedHeight(frame({enemies:Array.from({length:40},()=>enemy(2))}))).toBeCloseTo(regular,8);
  expect(projectedHeight(frame({boss:enemy(4)}))).toBeGreaterThanOrEqual(70);
});
test('user zoom and orbit remain effective independently of framing policy',()=>{
  const f=frame(),normal=projectedHeight(f);
  expect(projectedHeight(f,{yaw:90,pitch:0,zoom:100})).toBeCloseTo(normal);
  expect(projectedHeight(f,{yaw:0,pitch:0,zoom:140})).toBeGreaterThan(normal);
  expect(projectedHeight(f,{yaw:0,pitch:0,zoom:70})).toBeLessThan(normal);
});
test('exponential blend remains monotonic and frame-rate independent',()=>{
  for(const hz of [30,60,144]) {
    let value=0;
    for(let i=0;i<hz;i++) value+=(1-value)*framingBlend(1/hz,2);
    expect(value).toBeCloseTo(1-Math.exp(-2),10);
  }
  expect(framingBlend(-1,2)).toBe(0); expect(framingBlend(NaN,2)).toBe(0);
});
