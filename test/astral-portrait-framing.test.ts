import { expect, spyOn, test } from 'bun:test';
import * as THREE from 'three';
import { battleAspectScale, fitBattleCameraOffset, minimumBattleAspect, refitBattleCameraPosition } from '../src/engine/battle-aspect-fit.js';
import { battleCameraOffset } from '../src/engine/camera-control.js';
import { Renderer } from '../src/engine/renderer.js';
import { Battle } from '../src/game/battle-base.js';
import { AstralConstellations } from '../src/game/astral-constellations.js';
import { buildExpeditionStage } from '../src/game/expedition-combat.js';
import { dungeonVisualFor } from '../src/data/dungeon-visuals.js';
import { ROUTE_OBJECTIVES } from '../src/data/route-objectives.js';

const standard = () => ({ expedition: { kind: 'dungeon', id: 'astral_leviathan_spire', depth: 'standard' } });
const vector = (v: {x:number;y:number;z:number}) => new THREE.Vector3(v.x,v.y,v.z);
const noop = () => {};
function cameraAt(offset: {x:number;y:number;z:number}, look: THREE.Vector3, aspect: number, fov = 53) {
  const camera = new THREE.PerspectiveCamera(fov,aspect,.1,120);
  camera.position.copy(vector(offset)); camera.lookAt(look); camera.updateMatrixWorld(true); return camera;
}

test('only normal solo Astral standard owns portrait fit, including shared visual/deep exclusions', () => {
  expect(minimumBattleAspect(standard())).toBe(.8);
  const normal = standard();
  for (const excluded of [undefined, {}, {party:{}}, {expedition:{kind:'arena',id:normal.expedition.id,depth:'standard'}},
    {...normal,party:{}}, {...normal,riftId:'glass_rift'},
    {expedition:{...normal.expedition,riftId:'rift'}}, {expedition:{...normal.expedition,conquestId:'conquest'}},
    {expedition:{...normal.expedition,depth:'deep'}}, {expedition:{...normal.expedition,id:'star_archive'}},
    {expedition:{...normal.expedition,depth:undefined}}]) expect(minimumBattleAspect(excluded)).toBe(0);
});

test('disabled/desktop values are exactly preserved and portrait expansion remains bounded', () => {
  expect(battleAspectScale(.8,.8)).toBe(1); expect(battleAspectScale(.4,.8)).toBe(2);
  expect(battleAspectScale(.2,.8)).toBe(2.4);
  for (const aspect of [0,-1,NaN,Infinity]) expect(battleAspectScale(aspect,.8)).toBe(1);
  const offset = Object.freeze({x:.4,y:8.7,z:10.1}), look = Object.freeze({x:0,y:.82,z:0});
  for (const [aspect,minimum] of [[1.5,.8],[.8,.8],[.46,0],[.46,NaN],[.46,2]]) {
    expect(fitBattleCameraOffset(offset,look,aspect,minimum)).toBe(offset);
  }
});

test('portrait fit preserves actual optical yaw/pitch, chosen zoom ratio and target/preset inputs', () => {
  const preset = Object.freeze({x:.8,y:9.4,z:9.2}), look = new THREE.Vector3(.3,.85,-.2);
  const controls = Object.freeze({yaw:35,pitch:9,zoom:125}), normal = battleCameraOffset(preset,controls);
  const fit = fitBattleCameraOffset(normal,look,390/844,.8), original = cameraAt(normal,look,390/844), framed = cameraAt(fit,look,390/844);
  expect(Math.abs(original.quaternion.dot(framed.quaternion))).toBeCloseTo(1,12);
  expect(vector(fit).sub(look).length()/vector(normal).sub(look).length()).toBeCloseTo(.8/(390/844),12);
  const alternate = battleCameraOffset(preset,{...controls,zoom:80});
  const alternateFit = fitBattleCameraOffset(alternate,look,390/844,.8);
  expect(vector(fit).sub(look).length()/vector(alternateFit).sub(look).length())
    .toBeCloseTo(vector(normal).sub(look).length()/vector(alternate).sub(look).length(),12);
  expect(controls).toEqual({yaw:35,pitch:9,zoom:125}); expect(preset).toEqual({x:.8,y:9.4,z:9.2});
  expect(look.toArray()).toEqual([.3,.85,-.2]);
});

test('default authored Astral camera keeps every physical choice circumference in the portrait frustum', () => {
  const profile = dungeonVisualFor(standard()).camera, route = ROUTE_OBJECTIVES.astral_standard;
  const offset = battleCameraOffset({x:profile.side,y:profile.y,z:profile.z},profile), look = new THREE.Vector3(0,profile.lookY,0);
  const narrow = cameraAt(offset,look,390/844,profile.fov+14);
  const fitted = cameraAt(fitBattleCameraOffset(offset,look,390/844,.8),look,390/844,profile.fov+14);
  let unfitHorizontal = 0;
  for (const choice of route.choices) for (let sample=0;sample<32;sample++) {
    const angle=sample*Math.PI*2/32;
    const ground = new THREE.Vector3(choice.dx+Math.cos(angle)*route.radius,.12,choice.dz+Math.sin(angle)*route.radius);
    unfitHorizontal=Math.max(unfitHorizontal,Math.abs(ground.clone().project(narrow).x));
    const projected=ground.project(fitted);
    expect(Math.abs(projected.x)).toBeLessThan(1); expect(Math.abs(projected.y)).toBeLessThan(1);
    expect(projected.z).toBeGreaterThan(-1); expect(projected.z).toBeLessThan(1);
  }
  expect(unfitHorizontal).toBeGreaterThan(1); // Real geometry reproduces the narrow horizontal regression.
});

function rendererFixture() {
  const renderer:any = Object.assign(Object.create(Renderer.prototype),{
    camera:new THREE.PerspectiveCamera(53,390/844,.1,120), _width:390,_height:844, battleMinimumAspect:0,
    rig:{target:new THREE.Vector3(2,0,-4),pos:new THREE.Vector3(2,8.7,6.1),offset:new THREE.Vector3(0,8.7,10.1),
      lookOffset:new THREE.Vector3(0,.82,0), side:0,environmentSide:-.18,mode:'battle',fov:39,lag:6,trauma:0,zoom:0,base:{y:8.7,z:10.1,fov:39}},
    battleCamera:{yaw:-12,pitch:-3,zoom:96}, battleOcclusion:{update:noop},time:0,flash:0,aberr:0,radial:0,desat:0,
    u:Object.fromEntries(['uFlash','uAberr','uRadial','uDesat','uTime'].map(key=>[key,{value:0}]))
  }); return renderer;
}

function nativeResizeFixture(r:any, width:number, height:number) {
  const globals = ['window', 'document', 'navigator'];
  const descriptors = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const values = [{innerWidth:width,innerHeight:height,devicePixelRatio:1,matchMedia:()=>({matches:false})},
    {documentElement:{style:{setProperty:noop}}}, {maxTouchPoints:0}];
  if (!r.r) {
    let ratio = 1;
    r.r = {setPixelRatio:(value:number)=>{ratio=value;},getPixelRatio:()=>ratio,setSize:noop};
    r.composer = {setPixelRatio:noop,setSize:noop};
    r.playerSilhouette = {size:[] as number[], resize(w:number,h:number,pr:number) { this.size=[w,h,pr]; }};
    r.lobbyAA = {uniforms:{resolution:{value:new THREE.Vector2()}}};
    r.bloom = {resolution:new THREE.Vector2(),setSize:noop}; r.quality='high';
  }
  try {
    globals.forEach((key,i)=>Object.defineProperty(globalThis,key,{value:values[i],configurable:true}));
    r.resize(true);
  } finally {
    globals.forEach((key,i)=>{
      if (descriptors[i]) Object.defineProperty(globalThis,key,descriptors[i]!);
      else delete (globalThis as any)[key];
    });
  }
}

test('native resize fits both live rig and camera before input and next lag frame, with exact disabled identity', () => {
  const r=rendererFixture(); r.camera.aspect=1.5; r._width=1200; r._height=800;
  r.setBattleVisual(dungeonVisualFor(standard()),standard());
  for(let i=0;i<10;i++)r.update(0,1);
  const original=r.camera.position.clone(),look=r.rig.target.clone().add(r.rig.lookOffset),direction=r.camera.quaternion.clone();
  const controls={...r.battleCamera},offset=r.rig.offset.clone(),target=r.rig.target.clone();
  nativeResizeFixture(r,390,844);
  expect(r.playerSilhouette.size).toEqual([390,844,r.pixelRatio]);
  expect(r.camera.position.distanceTo(look)/original.distanceTo(look)).toBeCloseTo(.8/(390/844),12);
  expect(r.camera.position.equals(r.rig.pos)).toBe(true);
  expect(r.camera.quaternion.equals(direction)).toBe(true);
  const fitted=r.camera.position.clone();r.update(0,1/60);
  expect(r.camera.position.distanceTo(fitted)).toBeLessThan(1e-8); // Does not pull back into the old cropped pose.
  nativeResizeFixture(r,390,844);expect(r.camera.position.equals(fitted)).toBe(true);
  nativeResizeFixture(r,1200,800);expect(r.camera.position.distanceTo(original)).toBeLessThan(1e-10);
  expect(r.battleCamera).toEqual(controls);expect(r.rig.offset.equals(offset)).toBe(true);expect(r.rig.target.equals(target)).toBe(true);
  r.battleMinimumAspect=0; const before=r.camera.position.clone();nativeResizeFixture(r,390,844);
  expect(r.camera.position.equals(before)).toBe(true);expect(r.rig.pos.equals(before)).toBe(true);
  r.battleMinimumAspect=.8;r.rig.mode='lobby';nativeResizeFixture(r,1200,800);
  expect(r.camera.position.equals(before)).toBe(true);
  const point=Object.freeze({x:2,y:9,z:6}),anchor=Object.freeze({x:2,y:1,z:-4});
  expect(refitBattleCameraPosition(point,anchor,.5,.5,.8)).toBe(point);
  expect(refitBattleCameraPosition(point,anchor,1.5,.4,0)).toBe(point);
});

test('renderer pose adapts on portrait/landscape changes without accumulated zoom or threat/input writes', () => {
  const r=rendererFixture(); r.setBattleVisual(dungeonVisualFor(standard()),standard());
  const before={offset:r.rig.offset.toArray(),target:r.rig.target.toArray(),look:r.rig.lookOffset.toArray(),base:{...r.rig.base},controls:{...r.battleCamera}};
  for(let frame=0;frame<10;frame++) r.update(0,1);
  const portrait=r.camera.position.clone(); r.update(0,1); expect(r.camera.position.distanceTo(portrait)).toBeLessThan(1e-8);
  r.camera.aspect=1200/800;r.camera.updateProjectionMatrix();r._width=1200;r._height=800;
  for(let frame=0;frame<10;frame++) r.update(0,1);
  const controlled=battleCameraOffset({x:r.rig.environmentSide,y:before.offset[1],z:before.offset[2]},before.controls);
  expect(r.camera.position.distanceTo(r.rig.target.clone().add(vector(controlled)))).toBeLessThan(1e-8);
  expect(r.rig.offset.toArray()).toEqual(before.offset);expect(r.rig.target.toArray()).toEqual(before.target);
  expect(r.rig.lookOffset.toArray()).toEqual(before.look);expect(r.rig.base).toEqual(before.base);expect(r.battleCamera).toEqual(before.controls);
  r.camera.aspect=390/844;r.camera.updateProjectionMatrix();r._width=390;r._height=844;
  for(let frame=0;frame<10;frame++) r.update(0,1);
  expect(r.camera.position.distanceTo(portrait)).toBeLessThan(1e-8);
});

test('each visual assignment resets scope before missing-camera return and other/deep entries', () => {
  const r=rendererFixture(), visual=dungeonVisualFor(standard());
  r.setBattleVisual(visual,standard()); expect(r.battleMinimumAspect).toBe(.8);
  const chosen={yaw:27,pitch:6,zoom:120};r.battleCamera=chosen;
  r.setBattleVisual(null);expect(r.battleMinimumAspect).toBe(0);expect(r.battleCamera).toBe(chosen);
  r.setBattleVisual(visual,standard());r.setBattleVisual({});expect(r.battleMinimumAspect).toBe(0);
  r.setBattleVisual(visual,standard());r.setBattleVisual(visual,{expedition:{...standard().expedition,depth:'deep'}});expect(r.battleMinimumAspect).toBe(0);
  r.setBattleVisual(visual,standard());r.setBattleVisual(visual,{expedition:{kind:'dungeon',id:'star_archive',depth:'standard'}});expect(r.battleMinimumAspect).toBe(0);
});

function battleFixture(renderer:any) {
  const game:any=Object.assign(Object.create(Battle.prototype),{renderer,scene:new THREE.Scene(),app:{eco:{s:{}}},
    active:false,player:null,routeObjectives:null,hazards:null,enemies:[],projectiles:[],timers:[],pending:[],pauseReasons:new Set(),
    input:{clear:noop,enabled:false},ui:{showHud:noop},fx:{clearAll:noop},drops:{clear:noop},sp:{clear:noop},clearPortal:noop,arena:{buildFloor:noop}});
  return game;
}

test('normal start hands the explicit stage to renderer and stop clears its fit synchronously', async () => {
  const renderer=rendererFixture(), game=battleFixture(renderer), stage=buildExpeditionStage('dungeon','astral_leviathan_spire',null);
  const prepare=spyOn(AstralConstellations.prototype,'prepareView').mockResolvedValue(undefined);
  const reached=Error('fixture reached renderer boundary before asset/model load');let seen:any;
  renderer.setBattleVisual=(visual:any,actual:any)=>{Renderer.prototype.setBattleVisual.call(renderer,visual,actual);seen=actual;throw reached;};
  try {
    await expect(game.start(stage,'knight',{level:1},{})).rejects.toThrow(reached.message);
    expect(seen).toBe(stage);expect(renderer.battleMinimumAspect).toBe(.8);
    game.stop();expect(renderer.battleMinimumAspect).toBe(0);game.stop();expect(renderer.battleMinimumAspect).toBe(0);
  } finally { prepare.mockRestore();game.stop(); }
});

test('stopped late prepare cannot re-enable portrait fitting or resurrect the old stage', async () => {
  const renderer=rendererFixture(),game=battleFixture(renderer),stage=buildExpeditionStage('dungeon','astral_leviathan_spire',null);
  let release:()=>void=()=>{},calls=0;
  const prepare=spyOn(AstralConstellations.prototype,'prepareView').mockImplementation(()=>new Promise<void>(resolve=>{release=resolve;}));
  renderer.setBattleVisual=(visual:any,actual:any)=>{calls++;Renderer.prototype.setBattleVisual.call(renderer,visual,actual);};
  try {
    renderer.battleMinimumAspect=.8;const pending=game.start(stage,'knight',{level:1},{});
    expect(renderer.battleMinimumAspect).toBe(0);const route=game.routeObjectives;game.stop();release();await pending;
    expect(calls).toBe(0);expect(route.closed).toBe(true);expect(renderer.battleMinimumAspect).toBe(0);
    expect(game.active).toBe(false);expect(game.player).toBeNull();expect(game.world).toBeNull();expect(game.routeObjectives).toBeNull();
  } finally { prepare.mockRestore();release();game.stop(); }
});
