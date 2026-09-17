import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { battleFraming, framingBlend } from '../src/engine/battle-framing.js';
import { CAMERA_PRESETS } from '../src/engine/renderer.js';
import { battleCameraOffset } from '../src/engine/camera-control.js';

const enemy = (x:number,z=0,extra={}) => ({pos:{x,y:0,z},alive:true,spawning:false,...extra});
const player = (vel={x:0,z:0},lockTarget:any=null) => ({pos:{x:0,y:0,z:0},vel,lockTarget});
const frame = (args:any={}) => battleFraming({player:player(),presets:CAMERA_PRESETS,...args});
function projectedHeight(f:ReturnType<typeof frame>, controls={yaw:0,pitch:0,zoom:100}, height=400) {
  const b=f.desired, camera=new THREE.PerspectiveCamera(b.fov+f.extraFov,16/9,.1,120);
  const off=battleCameraOffset({x:0,y:b.y+f.extraY,z:b.z+f.extraZ},controls);
  camera.position.set(off.x,off.y,off.z); camera.lookAt(0,b.lookY,0); camera.updateMatrixWorld();
  const feet=new THREE.Vector3(0,0,0).project(camera),head=new THREE.Vector3(0,2.3,0).project(camera);
  return Math.abs(head.y-feet.y)*height/2;
}
test('far, dead and spawning bosses leave the ordinary framing unchanged',()=>{
  const ordinary=frame();
  for(const boss of [enemy(100),enemy(0,0,{alive:false}),enemy(0,0,{spawning:true})]) expect(frame({boss})).toEqual(ordinary);
});
test('near boss framing fades continuously and has no stacked boss distance penalty',()=>{
  const close=frame({boss:enemy(4)}),middle=frame({boss:enemy(10)}),far=frame({boss:enemy(14)});
  expect(close.desired.y).toBe(CAMERA_PRESETS.wide.y); expect(close.extraY).toBe(0);
  expect(middle.bossWeight).toBeCloseTo(.5); expect(far.bossWeight).toBe(0);
  expect(frame({boss:enemy(14.001)}).desired.y-frame({boss:enemy(13.999)}).desired.y).toBeCloseTo(0,5);
});
test('crowd expansion saturates and ignores far or spawning enemies',()=>{
  const dense=frame({enemies:Array.from({length:40},()=>enemy(3))});
  expect(dense.extraY).toBe(.35); expect(dense.extraZ).toBe(.28); expect(dense.extraFov).toBe(.7);
  expect(frame({enemies:[enemy(10),enemy(0,0,{spawning:true})]})).toEqual(frame());
});
test('explicit presets retain their selected lens even during a boss crowd',()=>{
  for(const preset of ['top','action','wide']) {
    const f=frame({preset,boss:enemy(3),enemies:Array.from({length:40},()=>enemy(2))});
    expect(f.desired).toEqual(CAMERA_PRESETS[preset as keyof typeof CAMERA_PRESETS]);
    expect(f.extraY+f.extraZ+f.extraFov).toBe(0);
  }
});
test('dash anticipation and lock bias remain bounded for retained and holdout directions',()=>{
  for(const angle of [0,.47,Math.PI/2,2.31,Math.PI]) for(const speed of [0,6,25,500]) {
    const c=Math.cos(angle),s=Math.sin(angle);
    const f=frame({player:player({x:c*speed,z:s*speed},enemy(c*7,s*7))});
    expect(Math.hypot(f.target.x,f.target.z)).toBeLessThanOrEqual(1.50000001);
  }
  expect(frame({player:player({x:0,z:0},enemy(1000))}).target).toEqual({x:0,y:0,z:0});
});
test('default 2.3u hero is readable at 400px and crowd remains at least 70px',()=>{
  const regular=projectedHeight(frame());
  expect(regular).toBeGreaterThanOrEqual(80); expect(regular).toBeLessThan(100);
  const crowded=projectedHeight(frame({enemies:Array.from({length:40},()=>enemy(2))}));
  expect(crowded).toBeGreaterThanOrEqual(70);
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
