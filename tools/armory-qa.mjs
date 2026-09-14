import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { installMetricsDriver } from './metrics-driver.mjs';
import { STORY_EVENTS } from '../src/data/masterworks.js';
import { ARMORY_ITEMS } from '../src/data/armory.js';
const phase=process.argv[2]||'candidate', out=process.env.ARMORY_QA_OUT||'work/owner-expansion-20260914';
if(!/^work\/[a-zA-Z0-9/_-]+$/.test(out))throw new Error('Evidence output must stay under work/');
await fs.mkdir(out,{recursive:true});
const report={phase,seed:20260914,surface:'isolated Chromium SwiftShader, scripted crowd; no physical-device or full-floor claim',errors:[],externalBlocked:[],checks:{}};
let browser;
try{
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:880,height:400},hasTouch:true});
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'||['data:','blob:'].includes(u.protocol))return route.continue();report.externalBlocked.push(u.origin);return route.fulfill({status:200,body:'',contentType:'text/css'});});
 await page.goto(`http://127.0.0.1:5196/${process.argv[3]||''}`,{waitUntil:'domcontentloaded'});
 await page.locator('#boot-start:not(.hidden)').waitFor({timeout:90000});
 await page.click('#boot-start');await page.waitForFunction(()=>window.app?.mode==='lobby');
 await page.evaluate(()=>{app.ui.closeModal();app.testPause=true;});
 await page.screenshot({path:`${out}/${phase}-lobby.png`});
 await page.evaluate(seed=>{let n=seed;Math.random=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};},report.seed);
 await page.click('#btn-battle');await page.waitForFunction(()=>app.battle?.active&&!app.stageStarting,{timeout:60000});
 await page.evaluate(installMetricsDriver,{storyEvents:STORY_EVENTS});
 report.fixture=await page.evaluate(()=>{
   const b=app.battle;b.player.auto=false;
   for(let i=0;i<18;i++){const a=i*Math.PI*2/18,r=1.2+(i%3)*.5;b.spawnEnemy('skel_minion',null,null,{x:b.player.pos.x+Math.sin(a)*r,z:b.player.pos.z+Math.cos(a)*r});}
   for(let i=0;i<100;i++)__metricsDriver.step(1/60,false);
   app.renderer.update(1/60,1/60);app.renderer.render();
   return {alive:b.enemies.filter(e=>e.alive).length,elapsed:b.elapsed,hero:b.player.def.id};
 });
 if(report.fixture.alive<14)throw new Error(`Crowd fixture too small: ${report.fixture.alive}`);
 await page.screenshot({path:`${out}/${phase}-crowd-880x400.png`});
 await page.setViewportSize({width:640,height:360});await page.waitForTimeout(250);await page.evaluate(()=>app.renderer.render());
 await page.screenshot({path:`${out}/${phase}-crowd-640x360.png`});
 await page.setViewportSize({width:880,height:400});
 await page.waitForTimeout(250); // Resize legitimately clears input; wait before the key is held.
 await page.keyboard.down('j');
 report.combat=await page.evaluate(()=>{
   const b=app.battle,start=b.dmgDealt,samples=[];
   for(let i=0;i<360;i++){const t=performance.now();__metricsDriver.step(1/60,i%6===0);samples.push(performance.now()-t);}
   samples.sort((a,b)=>a-b);return {damage:b.dmgDealt-start,kills:b.kills,elapsed:b.elapsed,alive:b.player.alive,attackHeldAtEnd:app.input.attackHeld,jsStepP50:samples[180],jsStepP95:samples[342],choices:__metricsDriver.snapshot().choices,silhouetteDraws:b.player.beacon?.occluded.length};
 });
 await page.keyboard.up('j');if(!(report.combat.damage>0))throw new Error('Real key input dealt no damage');
 await page.screenshot({path:`${out}/${phase}-combat.png`});
 if(phase==='candidate'){
   await page.emulateMedia({reducedMotion:'reduce'});
   report.checks.reducedMotion=await page.evaluate(()=>app.reducedMotion.matches);
   await page.evaluate(()=>app.toLobby());
   await page.evaluate(()=>{app.eco.s.fragments=720;app.meta.openTab('heroes');app.meta.showCraft('knight');});
   await page.locator('[data-craft="arm_anchor:weapon"]').scrollIntoViewIfNeeded();
   await page.screenshot({path:`${out}/candidate-forge.png`});
   for(const slot of ['weapon','armor','ring','boots']){
     await page.locator(`[data-craft="arm_anchor:${slot}"]`).click();await page.click('#m-ok');
     await page.waitForFunction(()=>!!document.querySelector('[data-craft="arm_anchor:weapon"]'));
   }
   await page.evaluate(()=>{app.ui.closeModal();app.meta.openTab('heroes');});
   report.checks.crafted=await page.evaluate(()=>app.eco.s.inventory.filter(x=>x.id.startsWith('arm_anchor')).length);
   for(const slot of ['weapon','armor','ring','boots']){
     await page.evaluate(slot=>{const item=app.eco.s.inventory.find(x=>x.id===`arm_anchor_${slot}`);app.meta.showItem(item.uid,'knight');},slot);
     await page.click('#i-eq');
   }
   await page.evaluate(()=>app.meta.openTab('home'));await page.waitForTimeout(500);
   await page.evaluate(()=>{for(let i=0;i<180;i++)app.step(1/60,false);app.renderer.render();});await page.screenshot({path:`${out}/candidate-equipped.png`});
   report.checks.equipment=await page.evaluate(()=>({procs:app.eco.heroEquipBonus('knight').procs,appearance:app.showcase?.root?.userData?.armoryAppearance}));
   await page.reload();await page.locator('#boot-start:not(.hidden)').waitFor({timeout:90000});await page.click('#boot-start');
   report.checks.reload=await page.evaluate(()=>({items:app.eco.s.inventory.filter(x=>x.id.startsWith('arm_anchor')).length,procs:app.eco.heroEquipBonus('knight').procs}));
   report.checks.lifecycle=[];
   for(let run=0;run<3;run++) {
     await page.evaluate(()=>{app.ui.closeModal();app.testPause=true;app.meta.openTab('home');});
     await page.click('#btn-battle');await page.waitForFunction(()=>app.battle.active&&!app.stageStarting);
     const state=await page.evaluate(()=>{
       const beacon=app.battle.player.beacon; window.__armoryBeacon=beacon;
       const geometries=new Set(),materials=new Set();
       app.battle.player.model.traverse(o=>{if(o.userData.armoryItem){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});
       window.__armoryReleased={expectedGeometries:geometries.size,expectedMaterials:materials.size,geometries:0,materials:0};
       for(const g of geometries)g.addEventListener('dispose',()=>window.__armoryReleased.geometries++);
       for(const m of materials)m.addEventListener('dispose',()=>window.__armoryReleased.materials++);
       for(let i=0;i<12;i++)app.step(1/60,false);app.renderer.render();
       return {appearance:app.battle.player.model.userData.armoryAppearance,silhouetteDraws:beacon.occluded.length};
     });
     await page.evaluate(()=>app.toLobby());
     Object.assign(state,await page.evaluate(()=>({beaconDisposed:window.__armoryBeacon.disposed,beaconDetached:!window.__armoryBeacon.root.parent,occludedRemaining:window.__armoryBeacon.occluded.length,armoryStateCleared:app.battle.sp.armory.light===0&&app.battle.sp.armory.anchor===null,released:window.__armoryReleased})));
     report.checks.lifecycle.push(state);
     if(!state.beaconDisposed||!state.beaconDetached||state.occludedRemaining!==0||!state.armoryStateCleared)throw new Error('Armory lifecycle cleanup failed');
     if(!state.released.expectedGeometries||state.released.expectedGeometries!==state.released.geometries||state.released.expectedMaterials!==state.released.materials)throw new Error('Armory geometry/material cleanup failed');
   }
   const gallery=await browser.newPage({viewport:{width:1000,height:1500},deviceScaleFactor:1});
   await gallery.setContent(`<html lang="ko"><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#14212a;color:#f4e5c8;font:16px sans-serif}h1{font-size:24px;margin:0 0 20px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}figure{margin:0;background:#233540;border-radius:10px;text-align:center;padding:10px}img{width:155px;height:155px;object-fit:contain}figcaption{padding:8px;font-size:16px}</style><h1>장비 24종 · Blender 모델 렌더</h1><div class="grid">${ARMORY_ITEMS.map(item=>`<figure><img src="http://127.0.0.1:5196${item.icon}"><figcaption>${item.name}</figcaption></figure>`).join('')}</div></html>`);
   await gallery.waitForFunction(()=>[...document.images].length===24&&[...document.images].every(x=>x.complete&&x.naturalWidth===256));
   await gallery.screenshot({path:`${out}/armory-contact-sheet.png`,fullPage:true});await gallery.close();
 }
 report.status=report.errors.length?'failed':'verified-sample';
 if(report.errors.length)process.exitCode=1;
}catch(error){report.status='failed';report.failure=String(error);process.exitCode=1;}
finally{await browser?.close();await fs.writeFile(`${out}/${phase}-runtime.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
