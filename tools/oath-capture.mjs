// Local-only design inspection in a fresh browser; no existing user profile.
import {chromium} from 'playwright';
import {preview} from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {launchOpts} from './chrome.mjs';
const root=path.resolve(import.meta.dirname,'..');
const out=path.join(root,'work/visual-v1/captures');await fs.mkdir(out,{recursive:true});
const server=await preview({root,configFile:false,preview:{host:'127.0.0.1',port:0},logLevel:'error'});
const browser=await chromium.launch(launchOpts({headless:true}));
const report={errors:[],layouts:[],scope:'Fresh local Chromium visual inspection'};
try{
 const page=await browser.newPage({viewport:{width:880,height:400},hasTouch:true,serviceWorkers:'block'});
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`,{waitUntil:'domcontentloaded'});
 await page.locator('#boot-start:not(.hidden)').waitFor({timeout:90000});await page.locator('#boot-start').click();
 await page.waitForFunction(()=>window.app?.mode==='lobby'&&!document.querySelector('#boot').classList.contains('show'));
 await page.waitForTimeout(900);await page.evaluate(()=>{app.ui.closeModal();app.testPause=true;for(let i=0;i<100;i++)app.step(1/60,true);});
 report.hall=await page.evaluate(()=>({name:app.arena.lobbyHall.name,meshes:app.arena.lobbyHall.children.length}));
 for(const [width,height] of [[880,400],[640,360],[360,740]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(150);
  await page.evaluate(()=>{for(let i=0;i<60;i++)app.step(1/60,true);});
  report.layouts.push(await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth})));
  await page.screenshot({path:path.join(out,`lobby-${width}x${height}.png`)});
 }
 await page.setViewportSize({width:640,height:360});await page.waitForTimeout(150);
 await page.locator('.oath-nav-menu').click();await page.screenshot({path:path.join(out,'menu-640x360.png')});
 await page.keyboard.press('Escape');
 await page.locator('#btn-battle').click();await page.waitForFunction(()=>app.battle?.active&&document.querySelector('#stage-loading').hidden);
 await page.evaluate(()=>{app.battle.player.auto=false;for(let i=0;i<60;i++)app.step(1/60,i===59);});
 await page.screenshot({path:path.join(out,'battle-640x360.png')});
 report.status=report.errors.length?'fail':'pass';
} catch(e){report.status='fail';report.failure=String(e.stack||e);process.exitCode=1;}
finally{await browser.close();await new Promise(r=>server.httpServer.close(r));await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
