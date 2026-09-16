// Paired compiled-build comparison. Every timed sample must render one full frame.
import {chromium} from 'playwright';
import {preview} from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {launchOpts} from './chrome.mjs';
const root=path.resolve(import.meta.dirname,'..'),base=process.argv[2];
if(!base)throw Error('Supply the exact baseline checkout with built dist');
const out=path.join(root,'work/visual-v1/performance-paired');await fs.mkdir(out,{recursive:true});
const report={scope:'Same Chromium SwiftShader, isolated fresh save, fixed scene; readPixels synchronization and render-count validation. Not physical phone/display FPS.',runs:[],status:'running'};
const servers={baseline:await preview({root:path.resolve(base),configFile:false,preview:{host:'127.0.0.1',port:0},logLevel:'error'}),candidate:await preview({root,configFile:false,preview:{host:'127.0.0.1',port:0},logLevel:'error'})};
const browser=await chromium.launch(launchOpts({headless:true}));
try{
 for(const which of ['baseline','candidate','candidate','baseline']){
  const context=await browser.newContext({viewport:{width:640,height:360},deviceScaleFactor:1,reducedMotion:'reduce',serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${servers[which].httpServer.address().port}`,{waitUntil:'domcontentloaded'});
  await page.locator('#boot-start:not(.hidden)').waitFor({timeout:90000});await page.locator('#boot-start').click();
  await page.waitForFunction(()=>app?.mode==='lobby'&&!document.querySelector('#boot').classList.contains('show'));
  await page.waitForTimeout(850);await page.evaluate(()=>{app.ui.closeModal();app.testPause=true;app.meta.openTab('home');});
  const measured=await page.evaluate(async()=>{
   const a=app,r=a.renderer.r,gl=r.getContext();if(a.expeditionUI.opened||document.hidden)throw Error('Rendering blocked by UI/visibility');
   const pixel=new Uint8Array(4),times=[],calls=[],original=a.renderer.render;let renders=0;
   a.renderer.render=function(...args){renders++;return original.apply(this,args);};r.info.autoReset=false;
   const frame=()=>{const before=renders;r.info.reset();a.step(1/60,true);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);if(renders!==before+1||r.info.render.calls===0)throw Error('Timed sample did not render');return r.info.render.calls;};
   for(let i=0;i<12;i++){frame();await new Promise(resolve=>setTimeout(resolve,0));}
   for(let i=0;i<36;i++){const start=performance.now();calls.push(frame());times.push(performance.now()-start);await new Promise(resolve=>setTimeout(resolve,0));}
   const sorted=[...times].sort((x,y)=>x-y),ext=gl.getExtension('WEBGL_debug_renderer_info');
   const value={median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],times,calls,samples:times.length,renders,quality:a.renderer.quality,drawingBuffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],renderer:gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL||gl.RENDERER),triangles:r.info.render.triangles,geometry:r.info.memory.geometries,textures:r.info.memory.textures,programs:r.info.programs.length,hall:a.arena.lobbyHall.name};
   a.renderer.render=original;r.info.autoReset=true;return value;
  });report.runs.push({which,...measured,errors});console.log(JSON.stringify({which,median:measured.median,p95:measured.p95,calls:measured.calls[0],renders:measured.renders}));
  if(errors.length)throw Error('Page errors '+errors.join(';'));await context.close();
 }
 const summarize=which=>{const samples=report.runs.filter(r=>r.which===which).flatMap(r=>r.times).sort((a,b)=>a-b);return {median:samples[Math.floor(samples.length*.5)],p95:samples[Math.floor(samples.length*.95)],samples:samples.length};};
 report.baseline=summarize('baseline');report.candidate=summarize('candidate');report.p95Ratio=report.candidate.p95/report.baseline.p95;report.medianRatio=report.candidate.median/report.baseline.median;
 const first=report.runs[0];if(report.runs.some(r=>r.quality!==first.quality||String(r.drawingBuffer)!==String(first.drawingBuffer)||r.renderer!==first.renderer))throw Error('Different rendering surface');
 report.status=report.p95Ratio<=1.1?'pass':'regression';if(report.status!=='pass')process.exitCode=1;
}catch(e){report.status='fail';report.failure=String(e.stack||e);process.exitCode=1;}
finally{await browser.close();for(const server of Object.values(servers))await new Promise(r=>server.httpServer.close(r));await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,baseline:report.baseline,candidate:report.candidate,ratio:report.p95Ratio,failure:report.failure}));}
