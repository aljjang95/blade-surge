#!/usr/bin/env node
/** Local-engine QA only. Does not attest physical Android/iOS or Safari certification. */
import http from 'node:http';
import https from 'node:https';
import { chromium, firefox, webkit, devices } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const i=a.indexOf('='); return i<0?[a.replace(/^--/,''),true]:[a.slice(2,i),a.slice(i+1)]; }));
if(args.help){console.log('node tools/mobile-browser-qa.mjs --url=http://127.0.0.1:5224 --engines=chromium,firefox,webkit --viewports=320x568,390x844,412x915,667x375,844x390,1024x768 --max-pixels=1500000 --out=docs/qa/pwa-mobile-20260913.json [--headed]');process.exit(0);}
let url=new URL(args.url||'http://127.0.0.1:5224/');
const local=u=>['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;
if(!local(url))throw new Error('Only a credential-free localhost HTTP(S) target is allowed.');
const engines=String(args.engines||'chromium,firefox,webkit').split(',');
const sizes=String(args.viewports||'320x568,390x844,412x915,667x375,844x390,1024x768').split(',').map(s=>{const m=/^(\d{3,4})x(\d{3,4})$/.exec(s);if(!m)throw new Error('Invalid viewport');return {width:+m[1],height:+m[2]};});
const limit=Number(args['max-pixels']||2073600),bootTimeout=Number(args.timeout||180000);
if(!Number.isFinite(limit)||limit<100000||!Number.isFinite(bootTimeout)||bootTimeout<1000)throw new Error('Invalid budget or timeout');
const out=resolve(String(args.out||'docs/qa/pwa-mobile-20260913.json')),artifacts=resolve(dirname(out),basename(out,'.json')+'.artifacts');
await mkdir(artifacts,{recursive:true});
const report={schema:1,started:new Date().toISOString(),target:url.href,scope:'Playwright local Chromium/Firefox/WebKit engines, emulated viewport/touch; NOT physical devices or Safari browser certification',configuration:{engines,sizes,maxCanvasPixels:args['max-pixels']?limit:{low:600000,mid:1000000,high:1500000},deviceScaleFactor:2,bootTimeout},fixtures:[],cases:[]};
// An owned loopback forwarding server injects real TCP failures without changing the
// preview server, browser-wide connectivity or other QA contexts. Never mocks the worker.
const upstream=new URL(url.href);let networkFault=false;
const proxy=http.createServer((req,res)=>{
  if(networkFault){req.socket.destroy();return;}
  const destination=new URL(upstream.href);const incoming=new URL(req.url,'http://127.0.0.1');destination.pathname=incoming.pathname;destination.search=incoming.search;
  const transport=destination.protocol==='https:'?https:http;
  const forwarded=transport.request(destination,{method:req.method,headers:{...req.headers,host:upstream.host}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
  forwarded.on('error',()=>res.destroy());res.on('close',()=>forwarded.destroy());req.pipe(forwarded);
});
await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
url=new URL(upstream.pathname+upstream.search,`http://127.0.0.1:${proxy.address().port}`);
report.testOrigin=url.origin;report.networkFault={kind:'owned-loopback-proxy TCP reset',upstream:upstream.origin,browserSetOffline:false,requestRouting:false};
try{report.buildVersion=await(await fetch(new URL('/version.json',upstream))).json();}catch(e){report.buildVersionError=String(e);}
const flush=()=>writeFile(out,JSON.stringify(report,null,2)+'\n');
class Unsupported extends Error {}
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
async function screen(page,id){const path=resolve(artifacts,id+'.png');await page.screenshot({path,timeout:10000});return path;}
async function visible(page,selector){return page.locator(selector).first().isVisible().catch(()=>false);}
async function closePopups(page){
  for(let i=0;i<4;i++){
    let closed=false;
    for(const selector of ['#modal.show #m-cancel','#companion-close','dialog[open] button[aria-label="닫기"]'])if(await visible(page,selector)){await page.locator(selector).first().click();closed=true;break;}
    if(!closed)break;
  }
}
async function geometry(page,selectors){return page.evaluate(ss=>ss.map(selector=>{const e=document.querySelector(selector);if(!e)return {selector,missing:true};const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {selector,x:r.x,y:r.y,width:r.width,height:r.height,visible:r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden',inside:r.x>=-1&&r.y>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1};}),selectors);}
async function checkGeometry(page,selectors){const boxes=await geometry(page,selectors);assert(boxes.every(b=>b.visible&&b.inside),'Clipped/missing controls: '+JSON.stringify(boxes.filter(b=>!b.visible||!b.inside)));return boxes;}
async function actionHitAreas(page){
  const evidence=await page.evaluate(()=>{
    const selectors=['#btn-attack','#btn-dodge',...Array.from({length:6},(_,i)=>`.skill-btn[data-skill="${i}"]`),'#joy .joy-base',...Array.from(document.querySelectorAll('.exp-potions button'),(_,i)=>`.exp-potions button:nth-of-type(${i+1})`)];
    const boxes=selectors.map(selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {selector,x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,reachable:!!hit&&(hit===e||e.contains(hit)||(selector==='#joy .joy-base'&&!!hit.closest('#joy'))),hitId:hit?.id,hitClass:typeof hit?.className==='string'?hit.className:''};});
    const overlaps=[];for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];if(Math.min(a.right,b.right)-Math.max(a.x,b.x)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1)overlaps.push([a.selector,b.selector]);}
    return {boxes,overlaps};
  });
  assert(!evidence.overlaps.length,'Action touch areas overlap: '+JSON.stringify(evidence));assert(evidence.boxes.every(b=>b.reachable),'Action center blocked: '+JSON.stringify(evidence.boxes.filter(b=>!b.reachable)));return evidence;
}
async function canvasBudget(page){const d=await page.evaluate(()=>{const a=window.app,r=a?.renderer,c=document.querySelector('#gl'),gl=r?.r?.getContext();return {webgl2:!!r?.isWebGL2,quality:r?.quality,requestedQuality:a?.eco?.s?.settings?.quality,pixelRatio:r?.r?.getPixelRatio(),width:c?.width,height:c?.height,viewport:[innerWidth,innerHeight],visualViewport:window.visualViewport?{width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale}:null,touch:matchMedia('(pointer: coarse)').matches||navigator.maxTouchPoints>0,devicePixelRatio,contextLost:gl?.isContextLost(),profile:r?.performanceProfile||r?.qualityProfile||null};});if(!d.webgl2)throw new Unsupported('WebGL2 unavailable: '+JSON.stringify(d));assert(!d.contextLost,'WebGL context lost');const budget=args['max-pixels']?limit:d.touch?({low:600000,mid:1000000,high:1500000}[d.quality]||0):limit;d.pixelBudget=budget;d.pixels=d.width*d.height;assert(d.pixels<=budget,'Canvas pixel budget exceeded: '+JSON.stringify(d));return d;}
async function exercise(page,context,result,id,offlineCase){
  const check=async(name,fn)=>{const item={name,status:'running'};result.checks.push(item);try{item.evidence=await fn();item.status='pass';}catch(e){item.status=e instanceof Unsupported?'unsupported':'fail';item.error=String(e.stack||e);throw e;}finally{await flush();}};
  await check('boot-user-tap',async()=>{
    await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:bootTimeout});
    if(await visible(page,'#btn-ignore-rotate'))await page.locator('#btn-ignore-rotate').tap();
    await page.locator('#boot-start:not(.hidden)').waitFor({state:'visible',timeout:bootTimeout});
    await page.locator('#boot-start').tap();
    await page.waitForFunction(()=>window.app?.mode==='lobby'&&!document.querySelector('#boot.show'),null,{timeout:30000});
    await page.waitForTimeout(900);await closePopups(page);
    return {browser:await page.evaluate(()=>({userAgent:navigator.userAgent,platform:navigator.platform,emulation:'Local engine with UA/viewport/touch emulation; not physical device or OS install certification'})),audio:await page.evaluate(()=>({audioContextConstructor:typeof window.AudioContext,webkitAudioContextConstructor:typeof window.webkitAudioContext,userActivated:navigator.userActivation?.hasBeenActive===true,note:'API availability and completed boot; not audible output certification'})),input:'Playwright touchscreen.tap on boot-start; no state fixture',screenshot:await screen(page,id+'-lobby')};
  });
  await check('lobby-layout-and-buffer',async()=>{const evidence={controls:await checkGeometry(page,['#btn-settings','#btn-battle','#party-open','.cur-gem']),partyCenter:await page.locator('#party-open').evaluate(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {reachable:!!hit&&(hit===e||e.contains(hit)),hit:hit?.className};}),render:await canvasBudget(page),horizontalOverflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)};assert(evidence.partyCenter.reachable,'Party lobby button center blocked: '+JSON.stringify(evidence.partyCenter));assert(!evidence.horizontalOverflow,'Lobby document has horizontal overflow');return evidence;});
  await check('settings-scroll-install-guidance',async()=>{
    await page.locator('#btn-settings').tap();await page.locator('#modal.show').waitFor();
    const box=page.locator('#modal-box'),rect=await box.boundingBox();assert(rect,'Settings box missing');
    let installControl=null;
    if(result.engine==='webkit'){
      await page.locator('#pwa-install').scrollIntoViewIfNeeded();installControl=await checkGeometry(page,['#pwa-install']);await page.locator('#pwa-install').tap();
      result.coverageNotes.push('Mobile WebKit Playwright mouse.wheel is unsupported: settings uses locator.scrollIntoViewIfNeeded plus actual button taps; native touch/wheel scrolling unverified.');
    }else{await page.mouse.move(Math.max(5,Math.min(rect.x+rect.width/2,result.viewport.width-5)),Math.max(5,Math.min(rect.y+rect.height/2,result.viewport.height-5)));await page.mouse.wheel(0,1600);await page.waitForTimeout(150);}
    const guidance=await box.innerText();assert(/홈 화면|홈화면|앱 설치|설치 안내/.test(guidance),'Home screen install guidance missing from settings');
    await page.locator('#m-cancel').scrollIntoViewIfNeeded();const close=await checkGeometry(page,['#m-cancel']);
    const state=await page.evaluate(()=>window.app.pwa?.getState?.()||null);
    if(result.engine==='chromium'){assert(state?.platform==='android','Android UA did not select Android PWA guidance');assert(/브라우저 메뉴|앱 설치/.test(guidance),'Android install guidance absent');}
    if(result.engine==='webkit'){assert(state?.platform==='ios','iPhone UA did not select iOS PWA guidance');assert(/Safari|공유|홈 화면에 추가/.test(guidance),'iOS manual install guidance absent');}
    const screenshot=await screen(page,id+'-settings');await page.locator('#m-cancel').tap();
    return {guidance,state,close,screenshot,installControl,input:result.engine==='webkit'?'programmatic scrollIntoViewIfNeeded with actual install-guidance and close taps; native touch/wheel scrolling unverified':'tap and mouse wheel; verifies guidance, not native installation'};
  });
  await check('lobby-to-battle-user-input',async()=>{await page.locator('#btn-battle').tap();await page.waitForFunction(()=>window.app?.mode==='battle'&&window.app.battle?.active&&!window.app.stageStarting,null,{timeout:45000});if(await page.evaluate(()=>window.app.battle.player.auto))await page.locator('#btn-auto').tap();await closePopups(page);assert(await page.evaluate(()=>!window.app.battle.player.auto),'AUTO did not disable');return {stage:await page.evaluate(()=>window.app.battle.stage.code),controls:await checkGeometry(page,['#joy','#btn-attack','.skill-btn[data-skill="0"]','#btn-pause']),touchAreas:await actionHitAreas(page)};});
  await check('manual-attack',async()=>{await page.locator('#btn-attack').tap();await page.waitForFunction(()=>window.app.battle.player.state==='attack',null,{timeout:3000});return await page.evaluate(()=>({state:window.app.battle.player.state,animation:window.app.battle.player.actionName,input:'touchscreen tap; animation start only, no enemy damage claim'}));});
  await check('manual-skill',async()=>{await page.waitForFunction(()=>!window.app.battle.player.busy,null,{timeout:6000});await page.locator('.skill-btn[data-skill="0"]').tap();await page.waitForFunction(()=>window.app.battle.player.cds[0]>0,null,{timeout:3000});return await page.evaluate(()=>({state:window.app.battle.player.state,cooldown:window.app.battle.player.cds[0],input:'touchscreen tap; actual skill cooldown, no fixture'}));});
  await check('joystick-movement',async()=>{
    await page.waitForFunction(()=>!window.app.battle.player.busy,null,{timeout:7000});const before=await page.evaluate(()=>({x:window.app.battle.player.pos.x,z:window.app.battle.player.pos.z}));
    const r=await page.locator('#joy .joy-base').boundingBox();assert(r,'Joystick thumb base missing');const x=r.x+r.width/2,y=r.y+r.height/2;
    const hit=await page.evaluate(({x,y})=>{const el=document.elementFromPoint(x,y);return {accepted:!!el?.closest('#joy'),tag:el?.tagName,id:el?.id,className:typeof el?.className==='string'?el.className:''};},{x,y});assert(hit.accepted,'Joystick thumb base is covered: '+JSON.stringify(hit));
    await page.mouse.move(x,y);await page.mouse.down();try{await page.mouse.move(x+Math.min(36,r.width*.3),y,{steps:8});await page.waitForTimeout(700);}finally{await page.mouse.up();}
    const after=await page.evaluate(()=>({x:window.app.battle.player.pos.x,z:window.app.battle.player.pos.z}));assert(Math.hypot(after.x-before.x,after.z-before.z)>.3,'Joystick did not move player');return {before,after,start:{x,y,selector:'#joy .joy-base',hit},input:'Playwright mouse drag from hit-tested joystick thumb base; NOT physical multitouch validation'};
  });
  await check('pause-resume',async()=>{await page.locator('#btn-pause').tap();await page.waitForFunction(()=>window.app.battle.paused);const start=await page.evaluate(()=>window.app.battle.elapsed);await page.waitForTimeout(250);const end=await page.evaluate(()=>window.app.battle.elapsed);assert(Math.abs(end-start)<.002,'Simulation clock advanced while paused');await checkGeometry(page,['#btn-resume']);await page.locator('#btn-resume').tap();await page.waitForFunction(()=>!window.app.battle.paused);await page.waitForFunction(t=>window.app.battle.elapsed>t+.05,start);return {start,end,input:'actual pause/resume button taps'};});
  await check('orientation-resize',async()=>{await page.setViewportSize({width:result.viewport.height,height:result.viewport.width});await page.waitForTimeout(400);const orientationPromptDismissed=await visible(page,'#btn-ignore-rotate');if(orientationPromptDismissed)await page.locator('#btn-ignore-rotate').tap();const controls=await checkGeometry(page,['#joy','#btn-attack','#btn-pause']);return {orientationPromptDismissed,controls,touchAreas:await actionHitAreas(page),render:await canvasBudget(page),screenshot:await screen(page,id+'-rotated'),input:'viewport resize only; not physical orientation sensor'};});
  if(offlineCase)await check('service-worker-offline-return',async()=>{
    const supported=await page.evaluate(()=>('serviceWorker' in navigator));if(!supported)throw new Unsupported('Service Worker unavailable in this local engine');
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:20000});
    const registration=await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return {scope:r?.scope,script:r?.active?.scriptURL,state:r?.active?.state};});
    const cache=await page.evaluate(async()=>({names:await caches.keys(),offlineExists:!!(await caches.match('/offline.html'))}));assert(cache.offlineExists,'Offline document is not actually cached');
    result.networkPhase='offline';networkFault=true;proxy.closeAllConnections();let offlineEvidence;
    try{const response=await page.reload({waitUntil:'domcontentloaded',timeout:20000});const offlineText=await page.locator('body').innerText();assert(response?.fromServiceWorker(),'Fault navigation was not answered by the actual service worker');assert(/오프라인|offline|인터넷|네트워크/i.test(offlineText),'Offline shell does not explain connection requirement');offlineEvidence={text:offlineText,status:response.status(),fromServiceWorker:response.fromServiceWorker(),origin:url.origin,fault:'real TCP reset on owned proxy; browser navigator.onLine remains true',cache};result.offlineScreenshot=await screen(page,id+'-offline');}
    finally{networkFault=false;result.networkPhase='online';}
    await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:30000});if(await visible(page,'#btn-ignore-rotate'))await page.locator('#btn-ignore-rotate').tap();await page.locator('#boot-start:not(.hidden)').waitFor({state:'visible',timeout:bootTimeout});await page.locator('#boot-start').tap();await page.waitForFunction(()=>window.app?.mode==='lobby',null,{timeout:30000});return {registration,offlineEvidence,onlineAgain:true,offlineClaim:'connection-required shell only; not offline full-game certification'};
  });else result.coverageNotes.push('Service worker/offline flow runs only for first requested viewport in each engine.');
}
await flush();
try{
for(const engine of engines){
  const type={chromium,firefox,webkit}[engine];if(!type)throw new Error('Unknown engine '+engine);
  let browser;
  try{browser=await type.launch({headless:!args.headed});}catch(e){report.cases.push({engine,status:'unsupported',error:String(e.stack||e),reason:'Local engine missing or failed to launch; not a product PASS'});await flush();continue;}
  try{for(let i=0;i<sizes.length;i++){
    const userAgent=engine==='chromium'?devices['Pixel 7'].userAgent:engine==='webkit'?devices['iPhone 13'].userAgent:undefined;
    const viewport=sizes[i],id=`${engine}-${viewport.width}x${viewport.height}`,result={engine,browserVersion:browser.version(),userAgentOverride:userAgent||null,viewport,status:'running',checks:[],coverageNotes:[],consoleErrors:[],pageErrors:[],requestsFailed:[],networkPhase:'online'};report.cases.push(result);
    let context,page;try{context=await browser.newContext({...(userAgent?{userAgent}:{}),viewport,deviceScaleFactor:2,hasTouch:true,isMobile:engine!=='firefox',serviceWorkers:'allow'});page=await context.newPage();}catch(e){result.status='unsupported';result.error=String(e.stack||e);await context?.close();await flush();continue;}page.setDefaultTimeout(12000);
    page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push({text:m.text(),phase:result.networkPhase});});page.on('pageerror',e=>result.pageErrors.push({text:String(e.stack||e),phase:result.networkPhase}));page.on('requestfailed',r=>result.requestsFailed.push({url:r.url(),error:r.failure()?.errorText,phase:result.networkPhase}));
    page.on('framenavigated',frame=>{if(frame!==page.mainFrame()||frame.url()==='about:blank')return;if(!local(new URL(frame.url()))){result.requestsFailed.push({url:frame.url(),error:'Unexpected external navigation; QA only targets localhost',phase:result.networkPhase});void page.close();}});
    try{await exercise(page,context,result,id,i===0);assert(!result.pageErrors.length,'Page errors observed');assert(!result.consoleErrors.some(e=>e.phase==='online'),'Online console errors observed');assert(!result.requestsFailed.some(e=>e.phase==='online'),'Online request failures observed');result.status='pass';}
    catch(e){result.status=e instanceof Unsupported?'unsupported':'fail';result.error=String(e.stack||e);result.coverageNotes.push('Checks after the first failure were not executed and remain unverified.');try{result.failureScreenshot=await screen(page,id+'-failure');result.failureState=await page.evaluate(()=>({url:location.href,boot:document.querySelector('#boot-msg')?.textContent,mode:window.app?.mode,pwa:window.app?.pwa?.getState?.(),webgl2:window.app?.renderer?.isWebGL2}));if(result.failureState.webgl2===false){result.status='unsupported';result.coverageNotes.push('WebGL2 unavailable; game interactions unverified.');}}catch{} }
    finally{await context.close();await flush();console.log(`${id}: ${result.status}`);}
  }}finally{await browser.close();}
}
}finally{networkFault=false;proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}
report.finished=new Date().toISOString();report.summary={pass:report.cases.filter(c=>c.status==='pass').length,fail:report.cases.filter(c=>c.status==='fail').length,unsupported:report.cases.filter(c=>c.status==='unsupported').length};await flush();console.log(JSON.stringify({out,...report.summary}));process.exitCode=report.summary.fail?1:report.summary.unsupported?2:0;
