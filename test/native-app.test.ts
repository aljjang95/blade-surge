import { expect, test } from 'bun:test';
import { setupNativeApp, handleNativeBack } from '../src/platform/native-app.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function fixture() {
  const callbacks:Record<string,Function>={}, removed:string[]=[];
  let registrations=0, saves=0, pauses=0;
  const reasons=new Set(['masterworks']);
  const app:any={mode:'battle',battle:{active:true,pauseReasons:reasons,setPaused:(r:string,on:boolean)=>{pauses++;on?reasons.add(r):reasons.delete(r);}},
    input:{clear:()=>{}},eco:{save:()=>{saves++;}},ui:{pause:(on:boolean)=>{if(on)reasons.add('manual');},toast:()=>{}}};
  const App={addListener:async(name:string,fn:Function)=>{registrations++;callbacks[name]=fn;return {remove:async()=>{removed.push(name);}};},getState:async()=>({isActive:true})};
  return {app,App,reasons,callbacks,removed,counts:()=>({registrations,saves,pauses})};
}

test('background owns only its pause and duplicate setup/listeners do not multiply saves',async()=>{
  const f=fixture();const api=setupNativeApp(f.app,{native:true,loadPlugin:async()=>({App:f.App})});
  expect(setupNativeApp(f.app,{native:true})).toBe(api);await api.ready;
  f.callbacks.appStateChange({isActive:false});api.sync();api.sync();
  expect([...f.reasons]).toEqual(['masterworks','native-background']);expect(f.counts().pauses).toBe(1);
  f.reasons.add('manual');f.callbacks.appStateChange({isActive:true});
  expect([...f.reasons]).toEqual(['masterworks','manual']);expect(f.counts().registrations).toBe(4);
  await api.dispose();expect(f.removed.sort()).toEqual(['appStateChange','backButton','pause','resume']);
});

test('background before battle creation is applied when battle becomes active',async()=>{
  const f=fixture();f.app.battle.active=false;
  const api=setupNativeApp(f.app,{native:true,loadPlugin:async()=>({App:f.App})});await api.ready;
  api.setActive(false);expect(f.reasons.has('native-background')).toBe(false);
  f.app.battle.active=true;api.sync();expect(f.reasons.has('native-background')).toBe(true);
  await api.dispose();expect([...f.reasons]).toEqual(['masterworks']);
});

test('web never imports plugin; failed native import and listener keep boot available',async()=>{
  const f=fixture();let imported=0;
  const web=setupNativeApp(f.app,{native:false,loadPlugin:async()=>{imported++;throw Error('unexpected');}});await web.ready;
  web.setActive(false);expect(imported).toBe(0);expect(f.reasons.size).toBe(1);await web.dispose();
  const failed=setupNativeApp(f.app,{native:true,loadPlugin:async()=>{throw Error('missing');}});await failed.ready;
  failed.setActive(false);expect(f.reasons.has('native-background')).toBe(true);await failed.dispose();
  f.App.addListener=async()=>{throw Error('unavailable');};
  const partial=setupNativeApp(f.app,{native:true,loadPlugin:async()=>({App:f.App})});await partial.ready;await partial.dispose();
});

test('dispose while listeners are registering removes late handles without live callbacks',async()=>{
  const f=fixture();let finish:Function=()=>{};
  const loaded=new Promise<any>(resolve=>{finish=resolve;});
  const api=setupNativeApp(f.app,{native:true,loadPlugin:()=>loaded});await api.dispose();finish({App:f.App});await api.ready;
  expect(f.counts().registrations).toBe(0);
});

test('handles arriving after disposal are removed and callbacks cannot pause the old app',async()=>{
  const f=fixture(), finishes:Function[]=[];
  const App={...f.App,addListener:(name:string,fn:Function)=>{
    f.callbacks[name]=fn;
    return new Promise<{remove:()=>Promise<void>}>(resolve=>finishes.push(()=>resolve({remove:async()=>{f.removed.push(name);}})));
  }};
  const api=setupNativeApp(f.app,{native:true,loadPlugin:async()=>({App})});
  await Promise.resolve();expect(finishes.length).toBe(4);
  await api.dispose();for(const finish of finishes)finish();await api.ready;
  f.callbacks.appStateChange({isActive:false});
  expect(f.removed.sort()).toEqual(['appStateChange','backButton','pause','resume']);expect([...f.reasons]).toEqual(['masterworks']);
});

test('back uses dialog cancellation and modal cancel callback; battle back only pauses',()=>{
  const f=fixture();let closed=0,cancelled=0;
  const dialog={contains:()=>false,dispatchEvent:(e:Event)=>{expect(e.type).toBe('cancel');return false;},close:()=>{closed++;}};
  const doc:any={querySelectorAll:()=>[dialog]};handleNativeBack(f.app,doc);expect(closed).toBe(0);
  doc.querySelectorAll=()=>[];
  f.app.ui.el={modal:{classList:{contains:()=>true}},modalBox:{querySelector:()=>({click:()=>{cancelled++;}})}};
  handleNativeBack(f.app,doc);expect(cancelled).toBe(1);expect(f.reasons.has('manual')).toBe(false);
  f.app.ui.el.modal.classList.contains=()=>false;handleNativeBack(f.app,doc);handleNativeBack(f.app,doc);
  expect(f.reasons.has('manual')).toBe(true);expect(f.app.battle.active).toBe(true);
});

test('native PWA never registers SW or offers web install/update',async()=>{
  let registrations=0;
  const context:any={navigator:{serviceWorker:{register:()=>{registrations++;}}},window:{matchMedia:()=>({matches:false})}};
  const source=readFileSync(new URL('../src/platform/pwa.js',import.meta.url),'utf8').replace('export function setupPwa','function setupPwa').replace('import.meta.env.PROD','true');
  runInNewContext(source+'\nglobalThis.api=setupPwa({native:true});',context);
  expect(registrations).toBe(0);expect(context.api.getState().supported).toBe(false);
  expect((await context.api.install()).outcome).toBe('unavailable');expect(context.api.applyUpdate()).toBe(false);
});
