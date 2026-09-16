import {chromium} from 'playwright';
import {preview} from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {launchOpts} from './chrome.mjs';
const home=path.resolve(import.meta.dirname,'..'),source=process.argv.find(x=>x.startsWith('--source='))?.slice(9)||home;
const baseline=process.argv.includes('--baseline'),out=path.join(home,'work/visual-v1',baseline?'baseline-behavior':'candidate-behavior');await fs.mkdir(out,{recursive:true});
const report={status:'running',scope:'isolated local compiled gameplay and fixed-frame GPU finish timing; not physical-device FPS or human preference',errors:[],navigation:[],cycles:[]};
const assert=(ok,message)=>{if(!ok)throw Error(message);};
const server=await preview({root:source,configFile:false,preview:{host:'127.0.0.1',port:0},logLevel:'error'});
const browser=await chromium.launch(launchOpts({headless:true}));
try{
 const page=await browser.newPage({viewport:{width:640,height:360},hasTouch:true,serviceWorkers:'block'});
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`,{waitUntil:'domcontentloaded'});
 await page.locator('#boot-start:not(.hidden)').waitFor({timeout:90000});await page.locator('#boot-start').click();
 await page.waitForFunction(()=>app?.mode==='lobby'&&!document.querySelector('#boot').classList.contains('show'));
 await page.waitForTimeout(800);await page.evaluate(()=>{app.ui.closeModal();app.testPause=true;});
 if(!baseline){
  await page.locator('.oath-nav-menu').click();await page.keyboard.press('Escape');
  report.cancel=await page.evaluate(()=>!app.oathShell.menu.open&&document.activeElement===app.oathShell.trigger);assert(report.cancel,'Menu cancel focus was lost');
  const selectors=['[data-tab="gacha"]','[data-tab="shop"]','[data-tab="pass"]','#btn-daily','#btn-mail','#btn-quest','#btn-settings','.rpg-open','.mw-open','.journey-lobby'];
  for(const selector of selectors){
   if(await page.locator('dialog[open]').count())await page.keyboard.press('Escape');
   await page.evaluate(()=>{app.toLobby();app.ui.closeModal();});
   await page.locator('.oath-nav-menu').click();await page.locator('#oath-menu '+selector).click();await page.waitForTimeout(90);
   const state=await page.evaluate(()=>({tab:app.meta.tab,modal:document.querySelector('#modal').classList.contains('show'),dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.id),menu:app.oathShell.menu.open}));
   report.navigation.push({selector,...state});assert(!state.menu&&(state.tab!=='home'||state.modal||state.dialogs.length>0),'Navigation did not open '+selector);
  }
  if(await page.locator('dialog[open]').count())await page.keyboard.press('Escape');
  await page.evaluate(()=>{app.toLobby();app.ui.closeModal();});
  await page.locator('.oath-nav-menu').click();await page.locator('#oath-menu #party-open').click();assert(await page.locator('.party-dialog[open]').count()===1,'Party entry missing');await page.keyboard.press('Escape');
  await page.locator('.oath-nav-menu').click();await page.locator('#oath-menu #app-mode-open').click();assert(await page.locator('dialog[open]').count()===1,'Install entry missing');await page.keyboard.press('Escape');await page.waitForTimeout(80);assert(await page.evaluate(()=>document.activeElement===app.oathShell.trigger),'Install close focus not returned');
  await page.locator('.oath-build-entry').click();assert(await page.locator('#arsenal[open]').count()===1,'Build entry missing');await page.keyboard.press('Escape');
  await page.locator('.companion-lobby-launcher').click();await page.locator('#companion-panel[open]').waitFor({timeout:15000});await page.keyboard.press('Escape');
  report.companion=true;assert(await page.locator('.lobby-left .companion-lobby-launcher').count()===1,'Companion ownership changed after React mount');
 }
 await page.evaluate(()=>{app.toLobby();app.ui.closeModal();app.testPause=true;});
 report.heroCoverage=[];
 for(const id of ['knight','barbarian','mage','rogue','ranger']){
  const coverage=await page.evaluate(async id=>{
   await app.showcaseHero(id,true);for(let i=0;i<120;i++)app.step(1/60,i===119);app.scene.updateMatrixWorld(true);
   const points=[],meshes=[];
   app.showcase.root.traverse(o=>{
    if(!o.isMesh)return;for(let ancestor=o;ancestor;ancestor=ancestor.parent)if(!ancestor.visible)return;
    const materials=Array.isArray(o.material)?o.material:[o.material];if(materials.every(m=>m.visible===false||m.opacity===0))return;
    const point=new __THREE.Vector3(),count=o.geometry.attributes.position.count;
    for(let v=0;v<count;v++){o.getVertexPosition(v,point).applyMatrix4(o.matrixWorld).project(app.renderer.camera);if(point.z>=-1&&point.z<=1)points.push({x:(point.x+1)*innerWidth/2,y:(1-point.y)*innerHeight/2});}
    meshes.push({name:o.name,vertices:count});
   });
   if(points.length<100)throw Error('No visible hero geometry');
   const bounds={left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};
   const overlaps=[];for(const e of document.querySelectorAll('#tab-home button')){const r=e.getBoundingClientRect();if(!r.width||!r.height)continue;const covered=points.filter(p=>p.x>=r.left&&p.x<=r.right&&p.y>=r.top&&p.y<=r.bottom).length;if(covered>0)overlaps.push({id:e.id||e.className,coveredVertices:covered});}

   return {id,bounds,overlaps,meshes,metric:'projected vertices of visible posed meshes, not hidden-template AABB'};
  },id);report.heroCoverage.push(coverage);await page.screenshot({path:path.join(out,`hero-${id}.png`)});if(!baseline)assert(coverage.overlaps.length===0,'Hero overlaps controls '+JSON.stringify(coverage));
 }
 await page.evaluate(async()=>{await app.showcaseHero('knight',true);app.reducedMotion.matches;for(let i=0;i<120;i++)app.step(1/60,true);});
 await page.emulateMedia({reducedMotion:'reduce'});
 report.frameTiming=await page.evaluate(async()=>{
  const r=app.renderer.r,gl=r.getContext(),times=[];r.info.autoReset=false;
  for(let i=0;i<50;i++){app.step(1/60,true);gl.finish();}
  for(let i=0;i<150;i++){const start=performance.now();r.info.reset();app.step(1/60,true);gl.finish();times.push(performance.now()-start);if(i%30===0)await new Promise(resolve=>setTimeout(resolve,0));}
  times.sort((a,b)=>a-b);const ext=gl.getExtension('WEBGL_debug_renderer_info');const value={median:times[75],p95:times[142],samples:150,frameDrawCalls:r.info.render.calls,frameTriangles:r.info.render.triangles,geometry:r.info.memory.geometries,textures:r.info.memory.textures,programs:r.info.programs.length,renderer:gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL||gl.RENDERER),metric:'fixed frame submit + gl.finish milliseconds, not display FPS'};r.info.autoReset=true;return value;
 });
 for(let i=0;i<10;i++){
  const cycle=await page.evaluate(async()=>{
   app.eco.s.energy=100;const started=await app.startStage(app.eco.nextStage());if(!started)throw Error('Cycle start failed');
   app.battle.player.auto=false;for(let k=0;k<60;k++)app.step(1/60,k===59);
   app.toLobby();for(let k=0;k<180;k++)app.step(1/60,k===179);
   const r=app.renderer.r;return {geometry:r.info.memory.geometries,textures:r.info.memory.textures,programs:r.info.programs.length,hall:app.arena.lobbyHall.name};
  });report.cycles.push(cycle);
 }
 const stable=report.cycles.slice(2);report.resourcesStable=stable.every(x=>x.geometry===stable[0].geometry&&x.textures===stable[0].textures&&x.programs===stable[0].programs);assert(report.resourcesStable,'Resources grow across lobby/battle cycles');
 if(!baseline){
  report.clarity=await page.evaluate(()=>{app.renderer.radial=1;app.renderer.aberr=1;app.renderer.update(1/60,1/60);return {radial:app.renderer.u.uRadial.value,aberr:app.renderer.u.uAberr.value};});assert(report.clarity.radial===0&&report.clarity.aberr===0,'Fullscreen effects still active');
 }
 await page.setViewportSize({width:360,height:740});await page.waitForTimeout(120);
 const proceed=page.getByRole('button',{name:'세로로 계속하기',exact:true});if(await proceed.isVisible())await proceed.click();
 await page.evaluate(()=>{for(let i=0;i<60;i++)app.step(1/60,true);});await page.screenshot({path:path.join(out,'portrait-opt-in.png')});
 report.portrait=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert(report.portrait.scrollWidth===report.portrait.width,'Portrait overflow');
 assert(report.errors.length===0,'Page exception '+report.errors.join(';'));report.status='pass';
}catch(e){report.status='fail';report.failure=String(e.stack||e);process.exitCode=1;}
finally{await browser.close();await new Promise(r=>server.httpServer.close(r));await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
