import { expect, test } from 'bun:test';
import { setupNativeApp, handleNativeBack, requestImmersiveSystemBars } from '../src/platform/native-app.js';
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

function barsFixture(fail:{style?:boolean,hide?:boolean}={}) {
  const calls:string[]=[];
  return {calls,bars:{
    setStyle:async(o:{style:string})=>{calls.push('style:'+o.style);if(fail.style)throw Error('style');},
    hide:async()=>{calls.push('hide');if(fail.hide)throw Error('UNIMPLEMENTED');},
  }};
}

test('네이티브 시작과 백그라운드 복귀마다 SystemBars 숨김을 다시 요청하고 웹은 호출하지 않는다',async()=>{
  const f=fixture(),b=barsFixture();
  const api=setupNativeApp(f.app,{native:true,loadPlugin:async()=>({App:f.App}),systemBars:b.bars});
  expect(await api.systemBarsRequest).toBe('requested');await api.ready;
  expect(b.calls).toEqual(['style:DARK','hide']);expect(api.systemBars).toBe('requested');
  f.callbacks.pause();f.callbacks.pause();expect(b.calls.length).toBe(2);
  f.callbacks.resume();await api.systemBarsRequest;expect(b.calls).toEqual(['style:DARK','hide','style:DARK','hide']);
  // 문서만 숨었다 돌아와도 같은 복귀로 본다.
  api.setVisible(false);api.setVisible(true);await api.systemBarsRequest;expect(b.calls.length).toBe(6);
  await api.dispose();
  const web=barsFixture(),webApi=setupNativeApp(fixture().app,{native:false,systemBars:web.bars});
  await webApi.systemBarsRequest;expect(web.calls).toEqual([]);expect(webApi.systemBars).toBe('idle');await webApi.dispose();
});

test('SystemBars 미구현·거절은 숨김 성공으로 기록하지 않고 시작과 생명주기 처리를 막지 않는다',async()=>{
  expect(await requestImmersiveSystemBars(null)).toBe('unavailable');
  expect(await requestImmersiveSystemBars({} as any)).toBe('unavailable');
  const styleFails=barsFixture({style:true});
  expect(await requestImmersiveSystemBars(styleFails.bars as any)).toBe('requested');
  const f=fixture(),b=barsFixture({hide:true});
  const api=setupNativeApp(f.app,{native:true,loadPlugin:async()=>({App:f.App}),systemBars:b.bars as any});
  expect(await api.systemBarsRequest).toBe('unavailable');await api.ready;expect(api.systemBars).toBe('unavailable');
  f.callbacks.appStateChange({isActive:false});expect(f.reasons.has('native-background')).toBe(true);
  f.callbacks.appStateChange({isActive:true});expect(f.reasons.has('native-background')).toBe(false);
  await api.dispose();
});

test('Android safe area는 Capacitor 주입 변수를 먼저 쓰고 없으면 env()로 돌아간다',()=>{
  const css=readFileSync(new URL('../src/platform/native-app.css',import.meta.url),'utf8');
  for(const [name,side] of [['sat','top'],['sab','bottom'],['sal','left'],['sar','right']])
    expect(css).toContain('--'+name+': var(--safe-area-inset-'+side+', env(safe-area-inset-'+side+', 0px));');
  expect(css).toMatch(/html:root\s*\{/);
});
