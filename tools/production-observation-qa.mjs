// Read the real deployed build and dogfood only an isolated browser-local player.
// This records observed production, not parity with a locally rebuilt artifact.
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {releaseRequestPolicy} from './release-network-policy.mjs';
import {installMetricsDriver} from './metrics-driver.mjs';
import {captureVictory,captureCrowd} from './release-qa-capture.mjs';
import {STORY_EVENTS} from '../src/data/masterworks.js';
const root=path.resolve(import.meta.dirname,'..'),origin='https://blade.tllhouse.com',head=process.argv[2];
if(!/^[a-f0-9]{40}$/.test(head||''))throw Error('An observed expected production SHA is required');
const out=path.join(root,'work','production-observation',new Date().toISOString().replace(/[:.]/g,'-'));
const report={origin,expectedHead:head,scope:'Existing live version with fresh isolated browser save; no deployment or backend writes. Fixed-step AUTO is not manual play or physical phone FPS.',startedAt:new Date().toISOString(),checks:[],errors:[],httpErrors:[],blockedWrites:[],assets:[]};
const check=(name,pass,evidence={})=>{report.checks.push({name,pass:!!pass,evidence});if(!pass)throw Error(name);};
const hash=b=>createHash('sha256').update(b).digest('hex');let browser;
await fs.mkdir(out,{recursive:true});
try {
 report.version=await (await fetch(origin+'/version.json?qa='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(15000)})).json();
 check('expected_live_head',report.version.sha===head&&!report.version.dirty,report.version);
 const html=await(await fetch(origin+'/',{signal:AbortSignal.timeout(15000)})).text();
 const files=new Set(['manifest.webmanifest','sw.js']);for(const m of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g))files.add(m[1].slice(1));
 for(const file of files){const r=await fetch(origin+'/'+file,{signal:AbortSignal.timeout(20000)});check('asset_http_'+file,r.ok);const b=Buffer.from(await r.arrayBuffer());report.assets.push({file,sha256:hash(b),bytes:b.length});}
 browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();
 const context=await browser.newContext({viewport:{width:880,height:400},hasTouch:true,isMobile:true,serviceWorkers:'block'});
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({url:r.url(),status:r.status()});});
 await context.route('**/*',route=>{const r=route.request(),policy=releaseRequestPolicy(r.url(),r.method(),origin);if(policy==='block'){report.blockedWrites.push({url:r.url(),method:r.method()});return route.abort();}return route.continue();});
 const start=Date.now();await page.goto(origin,{waitUntil:'domcontentloaded',timeout:60000});await page.locator('#boot-start:not(.hidden)').waitFor({timeout:90000});report.bootSeconds=(Date.now()-start)/1000;
 await page.locator('#boot-start').tap();await page.waitForFunction(()=>app.mode==='lobby'&&!document.querySelector('#boot').classList.contains('show'));
 report.gpu=await page.evaluate(()=>{const g=app.renderer.r.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return{api:g.getParameter(g.VERSION),renderer:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown'};});
 const shot=async name=>{await page.screenshot({path:path.join(out,name+'.png')});};
 report.before=await page.evaluate(()=>{app.ui.closeModal();app.testPause=true;let s=20260905;Math.random=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};return{stage:app.eco.nextStage().idx,level:app.eco.hero('knight').level,inventory:app.eco.s.inventory.length,spentKRW:app.eco.s.spentKRW};});
 await page.evaluate(()=>app.step(0,true));await shot('live-lobby');await page.locator('#btn-battle').tap();
 await page.waitForFunction(()=>app.battle?.active&&!app.stageStarting,null,{timeout:60000});
 await page.evaluate(installMetricsDriver,{storyEvents:STORY_EVENTS.map(({id,choices})=>({id,choices:choices.map(({id})=>({id}))}))});
 const before=await page.evaluate(()=>app.battle.player.pos.toArray());await page.keyboard.down('w');
 await page.evaluate(()=>{for(let i=0;i<30;i++)__metricsDriver.step(1/60,false);});await page.keyboard.up('w');
 const after=await page.evaluate(()=>app.battle.player.pos.toArray());check('actual_movement',Math.hypot(...after.map((n,i)=>n-before[i]))>.05,{before,after});
 await page.evaluate(()=>app.battle.player.auto=true);let captured=false;
 for(let chunk=0;chunk<210;chunk++) {
  report.last=await page.evaluate(render=>{const b=app.battle;for(let i=0;i<120&&b.active;i++)__metricsDriver.step(1/60,render&&i===119);return{active:b.active,won:b.result?.win===true,elapsed:b.elapsed,kills:b.kills,drops:b.drops?.loot?.length,rooms:b.world.rooms.filter(r=>r.cleared).length,totalRooms:b.world.rooms.length,peakAlive:b.peakAlive,alive:b.enemies.filter(e=>e.alive).length};},chunk%6===0);
  if(!captured&&report.last.alive>=5){report.crowd=await captureCrowd(page,path.join(out,'live-crowd.png'));captured=report.crowd.captured;}
  if(!report.last.active)break;
 }
 check('live_floor_completed',report.last.won&&report.last.rooms===report.last.totalRooms,report.last);
 report.victory=await captureVictory(page,path.join(out,'live-victory.png'));
 const save=()=>page.evaluate(()=>({stage:app.eco.nextStage().idx,level:app.eco.hero('knight').level,inventory:JSON.stringify(app.eco.s.inventory),spentKRW:app.eco.s.spentKRW}));
 const earned=await save();await page.reload({waitUntil:'domcontentloaded'});await page.locator('#boot-start:not(.hidden)').waitFor({timeout:90000});await page.locator('#boot-start').tap();await page.waitForFunction(()=>app.mode==='lobby');
 const reloaded=await save();check('rewards_persist_after_reload',earned.inventory===reloaded.inventory&&earned.stage===reloaded.stage&&earned.level===reloaded.level&&earned.stage>report.before.stage);
 check('zero_spend',reloaded.spentKRW===0);report.progress={stage:reloaded.stage,level:reloaded.level,items:JSON.parse(reloaded.inventory).length};
 await page.evaluate(()=>app.ui.closeModal());
 for(const viewport of [{width:640,height:360},{width:360,height:740}]){
  await page.setViewportSize(viewport);await page.waitForTimeout(180);const button=page.locator('#btn-ignore-rotate');if(await button.isVisible())await button.tap();await page.waitForTimeout(150);
  const layout=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth}));check('layout_'+viewport.width,layout.scrollWidth<=layout.width+1,layout);await shot('live-'+viewport.width);
 }
 check('no_uncaught_browser_errors',!report.errors.length,report.errors);check('no_http_errors',!report.httpErrors.length,report.httpErrors);check('no_forbidden_writes',!report.blockedWrites.length,report.blockedWrites);
 report.finalVersion=await(await fetch(origin+'/version.json?qa='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(15000)})).json();
 check('live_unchanged_during_observation',report.finalVersion.sha===head&&report.finalVersion.pwaRelease===report.version.pwaRelease);
 report.status='pass';await context.close();
}catch(e){report.status='fail';report.failure=String(e.stack||e);process.exitCode=1;}
finally{await browser?.close();report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,head,checks:report.checks.length,last:report.last,progress:report.progress,errors:report.errors,httpErrors:report.httpErrors,failure:report.failure,report:path.join(out,'report.json')}));}
