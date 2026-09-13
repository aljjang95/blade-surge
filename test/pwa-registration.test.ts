import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function registrationHarness(prod:boolean,{ua='',online=true,canApplyUpdate=()=>true,update=async()=>{},hasController=true,hasWaiting=true}:{ua?:string,online?:boolean,canApplyUpdate?:()=>boolean,update?:()=>Promise<void>,hasController?:boolean,hasWaiting?:boolean}={}) {
  const events:Record<string,Function>={}, workerEvents:Record<string,Function>={},registrationEvents:Record<string,Function>={};
  const published:any[]=[];let registrations=0,reloads=0,messages=0;
  const waiting={postMessage:(message:any)=>{if(message.type==='APPLY_UPDATE')messages++;}};
  const registration:any={waiting:hasWaiting?waiting:null,installing:null,active:null,addEventListener:(key:string,fn:Function)=>{registrationEvents[key]=fn;},update};
  const window={isSecureContext:true,matchMedia:()=>({matches:false}),dispatchEvent:(event:any)=>published.push(event.detail),addEventListener:(key:string,fn:Function)=>{events[key]=fn;}};
  const serviceWorker:any={controller:hasController?{}:null,register:async()=>{registrations++;return registration;},addEventListener:(key:string,fn:Function)=>{workerEvents[key]=fn;}};
  const context:any={window,navigator:{serviceWorker,userAgent:ua,onLine:online,platform:'',maxTouchPoints:0},location:{reload:()=>{reloads++;}},CustomEvent:class{detail:any;constructor(_name:string,init:any){this.detail=init.detail;}},Promise};
  const source=readFileSync(new URL('../src/platform/pwa.js',import.meta.url),'utf8').replace('export function setupPwa','function setupPwa').replace('import.meta.env.PROD',String(prod));
  context.canApplyUpdate=canApplyUpdate;
  runInNewContext(source+'\nglobalThis.api=setupPwa({canApplyUpdate});',context);
  return {api:context.api,events,workerEvents,registrationEvents,registration,serviceWorker,waiting,published,counts:()=>({registrations,reloads,messages})};
}
test('development never registers a worker',()=>{
  const h=registrationHarness(false);expect(h.counts().registrations).toBe(0);expect(h.api.getState().status).toBe('unavailable');
});
test('a pending update reloads only after this tab explicitly requests it',async()=>{
  const h=registrationHarness(true);await Promise.resolve();
  expect(h.counts().registrations).toBe(1);expect(h.api.getState().updateAvailable).toBe(true);
  h.workerEvents.controllerchange();expect(h.counts().reloads).toBe(0);
  expect(h.api.applyUpdate()).toBe(true);expect(h.counts().messages).toBe(1);
  h.workerEvents.controllerchange();expect(h.counts().reloads).toBe(1);
  h.workerEvents.controllerchange();expect(h.counts().reloads).toBe(1);
});
test('install affordance uses the real browser event and is consumed once',async()=>{
  const h=registrationHarness(true);let prompted=0;
  expect((await h.api.install()).outcome).toBe('unavailable');
  h.events.beforeinstallprompt({preventDefault:()=>{},prompt:async()=>{prompted++;},userChoice:Promise.resolve({outcome:'accepted'})});
  expect(h.api.getState().canInstall).toBe(true);
  expect((await h.api.install()).outcome).toBe('accepted');expect(prompted).toBe(1);
  expect(h.api.getState().canInstall).toBe(false);
  h.events.appinstalled();expect(h.api.getState().installed).toBe(true);
});
test('update is deferred without messaging or reload while the app reports an active game',async()=>{
  let safe=false;const h=registrationHarness(true,{canApplyUpdate:()=>safe});await Promise.resolve();
  expect(h.api.applyUpdate()).toBe(false);expect(h.api.getState().status).toBe('update-deferred');
  expect(h.counts()).toEqual({registrations:1,reloads:0,messages:0});
  safe=true;expect(h.api.applyUpdate()).toBe(true);expect(h.counts().messages).toBe(1);
  h.workerEvents.controllerchange();expect(h.counts().reloads).toBe(1);
});
test('an update approved in lobby cannot reload after combat starts and needs a new lobby action',async()=>{
  let safe=true;const h=registrationHarness(true,{canApplyUpdate:()=>safe});await Promise.resolve();
  expect(h.api.applyUpdate()).toBe(true);expect(h.counts().messages).toBe(1);
  safe=false;h.registration.waiting=null;h.workerEvents.controllerchange();
  expect(h.counts().reloads).toBe(0);expect(h.api.getState()).toMatchObject({updateAvailable:true,status:'update-deferred'});
  const stateEvents:Record<string,Function>={},worker:any={state:'activated',addEventListener:(key:string,fn:Function)=>{stateEvents[key]=fn;}};
  h.registration.installing=worker;h.registrationEvents.updatefound();stateEvents.statechange();
  expect(h.api.getState().updateAvailable).toBe(true);
  expect(h.api.applyUpdate()).toBe(false);expect(h.counts().reloads).toBe(0);
  safe=true;expect(h.api.applyUpdate()).toBe(true);expect(h.counts().reloads).toBe(1);
  expect(h.api.applyUpdate()).toBe(false);expect(h.counts().reloads).toBe(1);expect(h.counts().messages).toBe(1);
});
test('an online update check failure is distinct from an offline browser',async()=>{
  const h=registrationHarness(true,{update:async()=>{throw new Error('check failed');}});await Promise.resolve();
  await h.api.checkUpdate();expect(h.api.getState()).toMatchObject({online:true,status:'update-check-failed'});
  h.events.offline();await h.api.checkUpdate();expect(h.api.getState()).toMatchObject({online:false,status:'offline'});
});
test('online state and mobile manual-install platform update live from browser events',async()=>{
  const h=registrationHarness(true,{ua:'Mozilla/5.0 (Linux; Android 15)'});await Promise.resolve();
  expect(h.api.getState()).toMatchObject({platform:'android',manualInstall:true,online:true,status:'ready'});
  h.events.offline();expect(h.api.getState()).toMatchObject({online:false,status:'offline'});
  h.events.online();expect(h.api.getState()).toMatchObject({online:true,status:'ready'});
  expect(h.published.at(-1)).toMatchObject({online:true,status:'ready'});
});
test('first install activation and unrelated controller changes clear a stale waiting affordance',async()=>{
  const first=registrationHarness(true,{hasController:false,hasWaiting:true});await Promise.resolve();
  expect(first.api.getState().updateAvailable).toBe(false);
  const stateEvents:Record<string,Function>={},worker:any={state:'installed',addEventListener:(key:string,fn:Function)=>{stateEvents[key]=fn;}};
  first.registration.installing=worker;first.registrationEvents.updatefound();stateEvents.statechange();
  expect(first.api.getState().updateAvailable).toBe(false);
  first.registration.waiting=null;first.registration.active=worker;first.serviceWorker.controller={};worker.state='activated';stateEvents.statechange();
  expect(first.api.getState().updateAvailable).toBe(false);

  const stale=registrationHarness(true);await Promise.resolve();expect(stale.api.getState().updateAvailable).toBe(true);
  stale.registration.waiting=null;stale.workerEvents.controllerchange();expect(stale.api.getState().updateAvailable).toBe(false);
});
