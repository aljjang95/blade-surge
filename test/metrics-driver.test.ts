import { expect, test } from 'bun:test';
import { installMetricsDriver, METRICS_DRIVER_SOURCE } from '../tools/metrics-driver.mjs';
import { MasterworksView } from '../src/ui/masterworks.js';

const install = installMetricsDriver as any;
const metricsGlobal = globalThis as any;

test('metrics driver resolves semantic boon and story choices without consuming game time', () => {
  const offers:any[] = [{kind:'boon',ids:['ember_edge','storm_eye']},{kind:'story',id:'lantern'}];
  const battle:any = {active:true,paused:true,elapsed:4,masterworks:{s:{story:{}}},currentOffer:()=>offers[0],
    selectBoon:(id:string)=>id===offers[0].ids[0]?(offers.shift(),{ok:true}):({ok:false}),
    selectStory:(id:string)=>id==='guide'?(offers.shift(),battle.paused=false,{ok:true}):({ok:false})};
  const app:any={battle,step:(dt:number)=>{if(!battle.paused)battle.elapsed+=dt;}};
  install({app,storyEvents:[{id:'lantern',choices:[{id:'guide'},{id:'mend'}]}]});
  expect(metricsGlobal.__metricsDriver).toBeDefined();
  expect(metricsGlobal.__metricsDriver.step(.25)).toBe(.25);
  expect(metricsGlobal.__metricsDriver.snapshot().choices).toEqual(['boon:ember_edge','story:lantern:guide']);
  expect(battle.elapsed).toBe(4.25);
  expect(METRICS_DRIVER_SOURCE).toContain('resolveOffers');
  delete (globalThis as any).__metricsDriver;
});

test('metrics driver uses a remembered valid story choice and rejects unknown offers', () => {
  const offer:any={kind:'story',id:'bridge'};
  const picked:string[]=[];
  const battle:any={active:true,paused:false,elapsed:0,masterworks:{s:{story:{bridge:'armor'}}},currentOffer:()=>offer,
    selectStory:(id:string)=>{picked.push(id);offer.kind='unknown';return {ok:true}}};
  const app:any={battle,step:()=>{}};
  install({app,storyEvents:[{id:'bridge',choices:[{id:'repair'},{id:'armor'}]}]});
  expect(()=>metricsGlobal.__metricsDriver.resolveOffers()).toThrow('Unknown metrics offer kind');
  expect(picked).toEqual(['armor']);
  delete (globalThis as any).__metricsDriver;
});

test('metrics driver counts requested active simulation time despite hitstop scaling', () => {
  const battle:any={active:true,paused:false,elapsed:0,currentOffer:()=>null};
  const app:any={battle,step:(dt:number)=>{battle.elapsed+=dt*.2;}};
  install({app});
  expect(metricsGlobal.__metricsDriver.step(.5)).toBe(.5);
  expect(battle.elapsed).toBe(.1);
  battle.active=false;
  expect(metricsGlobal.__metricsDriver.step(.5)).toBe(0);
  delete (globalThis as any).__metricsDriver;
});

test('first boon closes the native view pause synchronously and the driver advances immediately', () => {
  const reasons=new Set(['masterworks']);
  const battle:any={active:true,paused:true,elapsed:0,currentOffer:()=>battle.offer,
    setPaused(reason:string,on:boolean){if(on)reasons.add(reason);else reasons.delete(reason);this.paused=reasons.size>0;},
    offer:{kind:'boon',ids:['ember_edge']}};
  const view:any=Object.assign(Object.create(MasterworksView.prototype),{battle,dialog:{open:true,close(){this.open=false;}}});
  battle.selectBoon=(id:string)=>{if(id!=='ember_edge')return {ok:false};battle.offer=null;view.close();return {ok:true};};
  const app:any={battle,step:(dt:number)=>{battle.elapsed+=dt;}};
  install({app});
  expect(metricsGlobal.__metricsDriver.step(.25)).toBe(.25);
  expect(battle.elapsed).toBe(.25);expect(battle.paused).toBe(false);expect(reasons.size).toBe(0);
  delete (globalThis as any).__metricsDriver;
});

test('queued choices wait for the native presentation pause before selection', () => {
  const battle:any={active:true,paused:false,elapsed:0,offer:{kind:'boon',ids:['ember_edge']},selected:0,
    currentOffer:()=>battle.offer,
    selectBoon:()=>{battle.selected++;battle.offer=null;battle.paused=false;return {ok:true};}};
  const app:any={battle,step:(dt:number)=>{battle.elapsed+=dt;battle.paused=true;}};
  install({app});
  expect(metricsGlobal.__metricsDriver.step(.25)).toBe(.25);
  expect(battle.selected).toBe(1);expect(battle.elapsed).toBe(.25);expect(battle.paused).toBe(false);
  delete metricsGlobal.__metricsDriver;
});
