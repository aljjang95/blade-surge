import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function registrationHarness(prod:boolean) {
  const events:Record<string,Function>={}, workerEvents:Record<string,Function>={};
  let registrations=0,reloads=0,messages=0;
  const registration={waiting:{postMessage:(message:any)=>{if(message.type==='APPLY_UPDATE')messages++;}},addEventListener:()=>{},update:async()=>{}};
  const window={isSecureContext:true,matchMedia:()=>({matches:false}),dispatchEvent:()=>{},addEventListener:(key:string,fn:Function)=>{events[key]=fn;}};
  const serviceWorker={controller:{},register:async()=>{registrations++;return registration;},addEventListener:(key:string,fn:Function)=>{workerEvents[key]=fn;}};
  const context:any={window,navigator:{serviceWorker},location:{reload:()=>{reloads++;}},CustomEvent:class{},Promise};
  const source=readFileSync(new URL('../src/platform/pwa.js',import.meta.url),'utf8').replace('export function setupPwa','function setupPwa').replace('import.meta.env.PROD',String(prod));
  runInNewContext(source+'\nglobalThis.api=setupPwa();',context);
  return {api:context.api,events,workerEvents,counts:()=>({registrations,reloads,messages})};
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
});
