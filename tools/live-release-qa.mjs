import { captureVictory, captureCrowd } from './release-qa-capture.mjs';
import { launchOpts } from './chrome.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { installMetricsDriver } from './metrics-driver.mjs';
import { STORY_EVENTS } from '../src/data/masterworks.js';
import { ARMORY_ITEMS } from '../src/data/armory.js';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'work','live-release-qa',Date.now().toString());
const head=process.argv[2];if(!/^[a-f0-9]{40}$/.test(head||''))throw Error('Exact release head required');
const liveOrigin='https://blade-surge.affinity-agent-studio.workers.dev';
const origin=process.argv[3]||liveOrigin;
if(origin!==liveOrigin&&!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('Only the owned production or local loopback preview is allowed');
const report={job:'blade-surge-release-rsi-20260915',head,origin,status:'running',scope:'Public deployed assets and isolated new desktop Chromium save; UI departure, keyboard movement, fixed-step AUTO complete floor and persisted reward; actual delayed victory panel and next-stage persistence; not physical-device FPS or manual completion',errors:[],httpErrors:[],blockedWrites:[],external:[],assets:[]};
if(origin!==liveOrigin)report.scope=report.scope.replace('Public deployed assets','Local preview assets');
await fs.mkdir(out,{recursive:true});const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
const hash=b=>createHash('sha256').update(b).digest('hex');let browser;
try{
 const local=JSON.parse(await fs.readFile(path.join(root,'dist/version.json'),'utf8'));
 if(local.sha!==head||local.dirty)throw Error('Local deployed artifact is not exact clean merge HEAD');
 report.version=await(await fetch(origin+'/version.json?dogfood='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(20000)})).json();
 if(report.version.sha!==head||report.version.dirty||report.version.pwaRelease!==local.pwaRelease)throw Error('Public version mismatch');
 const html=await fs.readFile(path.join(root,'dist/index.html'),'utf8');
 const files=new Set(['index.html','version.json','manifest.webmanifest','sw.js','models/oathhall-v1/oathhall-v1.glb','models/oathhall-v1/manifest.json']);
 for(const m of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g))files.add(m[1].slice(1));
 for(const item of ARMORY_ITEMS){files.add(item.icon.slice(1));files.add('models/armory-v1/'+item.modelNode+'.glb');}
 const list=[...files];for(let i=0;i<list.length;i+=4)await Promise.all(list.slice(i,i+4).map(async name=>{
  const r=await fetch(origin+'/'+name+'?verify='+head,{cache:'no-store',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Asset HTTP '+r.status+' '+name);
  const bytes=Buffer.from(await r.arrayBuffer()),expected=await fs.readFile(path.join(root,'dist',name));
  const equal=hash(bytes)===hash(expected);report.assets.push({path:name,bytes:bytes.length,sha256:hash(bytes),equal});if(!equal)throw Error('Asset mismatch '+name);
 }));await save();
 browser=await chromium.launch({...launchOpts(),headless:true});
 report.browser=browser.version();const page=await browser.newPage({viewport:{width:880,height:400},hasTouch:true});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({url:r.url(),status:r.status()});});
 await page.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(!['GET','HEAD'].includes(r.method())){report.blockedWrites.push({url:r.url(),method:r.method()});return route.abort();}if(u.origin===origin||['data:','blob:'].includes(u.protocol))return route.continue();report.external.push(u.origin);return route.fulfill({status:200,body:'',contentType:'text/css'});});
 await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:60000});await page.locator('#boot-start:not(.hidden)').waitFor({timeout:90000});await page.click('#boot-start');await page.waitForFunction(()=>window.app?.mode==='lobby');
 await page.screenshot({path:path.join(out,'live-lobby.png')});
 report.before=await page.evaluate(()=>{app.ui.closeModal();app.testPause=true;let s=20260905;Math.random=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};return {nextStage:app.eco.nextStage().idx,level:app.eco.hero('knight').level,inventory:app.eco.s.inventory.length,spentKRW:app.eco.s.spentKRW};});
 await page.waitForFunction(()=>!document.querySelector('#boot').classList.contains('show'));
 report.hall=await page.evaluate(()=>({name:app.arena.lobbyHall?.name,meshes:app.arena.lobbyHall?.children.length}));
 if(report.hall.name!=='TLL_OathHall_BlenderV1')throw Error('New lobby asset failed to mount');
 await page.evaluate(()=>app.step(0,true));await page.screenshot({path:path.join(out,'live-lobby-ready.png')});
 await page.click('#btn-battle');await page.waitForFunction(()=>app.battle?.active&&!app.stageStarting,null,{timeout:60000});
 await page.evaluate(installMetricsDriver,{storyEvents:STORY_EVENTS.map(({id,choices})=>({id,choices:choices.map(({id})=>({id}))}))});
 const before=await page.evaluate(()=>({x:app.battle.player.pos.x,z:app.battle.player.pos.z}));await page.keyboard.down('w');
 const after=await page.evaluate(()=>{for(let i=0;i<30;i++)__metricsDriver.step(1/60,false);return {x:app.battle.player.pos.x,z:app.battle.player.pos.z};});await page.keyboard.up('w');
 report.keyboardMovement=Math.hypot(after.x-before.x,after.z-before.z);if(report.keyboardMovement<.05)throw Error('Live keyboard movement failed');
 await page.evaluate(()=>{app.battle.player.auto=true;});let captured=false;
 for(let chunk=0;chunk<210;chunk++){
  report.last=await page.evaluate(render=>{const b=app.battle;for(let i=0;i<120&&b.active;i++)__metricsDriver.step(1/60,render&&i===119);return {active:b.active,won:b.result?.win===true,elapsed:b.elapsed,kills:b.kills,drops:b.drops?.loot?.length,rooms:b.world.rooms.filter(r=>r.cleared).length,totalRooms:b.world.rooms.length,peakAlive:b.peakAlive,alive:b.enemies.filter(e=>e.alive).length,heroAlive:b.player.alive};},chunk%6===0);
  if(!captured&&report.last.alive>=5){report.crowd=await captureCrowd(page,path.join(out,'live-crowd.png'));captured=report.crowd.captured;}
  if(chunk%20===0)await save();if(!report.last.active)break;
 }
 if(!report.last.won||report.last.rooms!==report.last.totalRooms)throw Error('Live full-floor run did not win and clear all rooms');
 report.victoryPanel=await captureVictory(page,path.join(out,'live-victory.png'));
 report.after=await page.evaluate(()=>({nextStage:app.eco.nextStage().idx,level:app.eco.hero('knight').level,inventory:app.eco.s.inventory.length,inventoryJson:JSON.stringify(app.eco.s.inventory),spentKRW:app.eco.s.spentKRW,choices:__metricsDriver.snapshot().choices}));
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('#boot-start:not(.hidden)').waitFor({timeout:90000});await page.click('#boot-start');await page.waitForFunction(()=>app.mode==='lobby');
 report.reloaded=await page.evaluate(()=>({nextStage:app.eco.nextStage().idx,level:app.eco.hero('knight').level,inventory:app.eco.s.inventory.length,inventoryJson:JSON.stringify(app.eco.s.inventory),spentKRW:app.eco.s.spentKRW}));
 report.savePreserved=report.after.inventoryJson===report.reloaded.inventoryJson&&report.after.level===report.reloaded.level&&report.after.nextStage===report.reloaded.nextStage&&report.after.nextStage>report.before.nextStage;
 delete report.after.inventoryJson;delete report.reloaded.inventoryJson;
 if(!report.savePreserved||report.reloaded.spentKRW!==0)throw Error('Reward persistence or zero-spend check failed');
 report.mobileLayouts=[];
 for(const viewport of [{width:640,height:360},{width:360,height:740}]){
  await page.setViewportSize(viewport);await page.waitForTimeout(300);
  report.mobileLayouts.push(await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth+1})));
  await page.screenshot({path:path.join(out,`live-${viewport.width}x${viewport.height}.png`)});
 }
 if(report.errors.length||report.httpErrors.length||report.blockedWrites.length)throw Error('Live browser/network checks failed');
 report.status='pass';report.finished=new Date().toISOString();
}catch(e){report.status='concern';report.failure=String(e);process.exitCode=1;}
finally{await browser?.close();await save();console.log(JSON.stringify({status:report.status,head,assets:report.assets.length,last:report.last,errors:report.errors,httpErrors:report.httpErrors,blockedWrites:report.blockedWrites,savePreserved:report.savePreserved,failure:report.failure}));}
