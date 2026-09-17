import {chromium} from 'playwright';
import {preview} from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {launchOpts} from './chrome.mjs';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'work/mobile-world-contact/qa');await fs.mkdir(out,{recursive:true});
const live=process.argv.includes('--live');
const server=live?null:await preview({root,configFile:false,preview:{host:'127.0.0.1',port:0},logLevel:'error'});
const origin=live?'https://blade.tllhouse.com':`http://127.0.0.1:${server.httpServer.address().port}`;
const report={origin,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:'running',scope:'Real compiled app, isolated saves; native taps and keyboard; fixed-step simulation. Not physical phone, haptic perception or human enjoyment proof.',errors:[],consoleErrors:[],httpErrors:[],layouts:[],choices:[],lobby:[],combat:null};
const browser=await chromium.launch(launchOpts({headless:true}));const assert=(v,m)=>{if(!v)throw Error(m);};
try{
 for(let pick=0;pick<3;pick++){
  const context=await browser.newContext({viewport:{width:640,height:320},deviceScaleFactor:2,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage();
  page.setDefaultTimeout(60000);page.setDefaultNavigationTimeout(60000);page.on('pageerror',e=>{report.errors.push(e.message);console.log('pageerror',e.message);});page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({url:r.url(),status:r.status()});});console.log('case',pick,'goto',origin);
  await page.goto(origin);await page.locator('#boot-start:not(.hidden)').waitFor({timeout:90000});await page.locator('#boot-start').click();
  await page.waitForFunction(()=>window.app?.mode==='lobby'&&!document.querySelector('#boot').classList.contains('show'));await page.waitForTimeout(800);
  console.log('booted',pick);await page.evaluate(()=>{app.ui.closeModal();app.testPause=true;let seed=98317;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};});
  if(pick===0){
   for(const [name,yaw,pitch,zoom] of [['front',27,11,96],['side',85,16,100],['back',-153,16,100],['city',180,12,75]]){
    const data=await page.evaluate(({yaw,pitch,zoom})=>{app.lobbyCameraControls.set({yaw,pitch,zoom},false);for(let i=0;i<150;i++)app.step(1/60,i===149);const r=app.renderer,autoReset=r.r.info.autoReset;r.r.info.autoReset=false;r.r.info.reset();app.step(0,true);const calls=r.r.info.render.calls,triangles=r.r.info.render.triangles;r.r.info.autoReset=autoReset;return {sightline:r.lobbySightline?.clear,lift:r.lobbySightline?.lift,batches:app.arena.lobbyWorld?.userData.batches,draws:calls,triangles,hero:!!app.showcase?.root};},{yaw,pitch,zoom});
    console.log('orbit',name,data);assert(data.hero&&data.batches===6,`Missing actual world: ${name}`);assert(data.sightline,`Occluded hero ${name}`);report.lobby.push({name,...data});await page.screenshot({path:path.join(out,`lobby-${name}.png`)});
   }
   await page.evaluate(()=>app.lobbyCameraControls.set({yaw:19,pitch:11,zoom:100},false));
  }
  await page.locator('#btn-battle').click();await page.waitForFunction(()=>app.battle?.active&&!app.stageStarting);
  const earned=await page.evaluate(async()=>{const g=app.battle;g.player.auto=true;for(let i=0;i<26000&&g.active&&!g.paused;i++){app.step(1/60,i%90===0);if(i%180===0)await new Promise(r=>setTimeout(r,0));}app.step(0,true);return {kind:g.currentOffer()?.kind,rooms:g.roomsCleared,picked:g.run.picked.length,paused:g.paused,level:g.player.heroLevel};});
  console.log('earned',earned);assert(earned.kind==='boon'&&earned.paused,'No earned three-way choice '+JSON.stringify(earned));
  const sizes=pick===0?[[640,320],[568,320],[844,390],[360,740],[320,568],[390,844],[1024,768]]:[pick===1?[360,740]:[844,390]];
  for(const [width,height] of sizes){
   await page.setViewportSize({width,height});await page.waitForTimeout(350);
   await page.evaluate(()=>{document.querySelector('#masterworks .mw-content').scrollTop=0;app.step(0,true);});
   const layout=await page.evaluate(()=>{const d=document.querySelector('#masterworks'),content=d.querySelector('.mw-content'),cr=content.getBoundingClientRect();return {dialog:d.getBoundingClientRect().toJSON(),content:cr.toJSON(),cards:[...d.querySelectorAll('[data-boon]')].map(e=>{const r=e.getBoundingClientRect(),p=e.querySelector('.mw-pick').getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,p.y+p.height/2);return {id:e.dataset.boon,rect:r.toJSON(),pick:p.toJSON(),reachable:e.contains(hit),visible:r.top>=cr.top-1&&p.bottom<=cr.bottom+1&&r.right<=innerWidth&&r.left>=0};})};});
   report.layouts.push({width,height,...layout});assert(layout.cards.length===3&&layout.cards.every(c=>c.visible&&c.reachable),`Cards clipped ${width}x${height}: `+JSON.stringify(layout));
   await page.screenshot({path:path.join(out,`choice-${width}x${height}.png`)});
  }
  const chosen=await page.locator('[data-boon]').nth(pick).getAttribute('data-boon');await page.locator('[data-boon]').nth(pick).tap();await page.waitForTimeout(80);
  const applied=await page.evaluate(()=>({picked:[...app.battle.run.picked],paused:app.battle.paused,open:app.battle.chronicle.dialog.open,enabled:app.input.enabled}));
  assert(applied.picked.length===earned.picked+1&&applied.picked.includes(chosen)&&!applied.open&&!applied.paused&&applied.enabled,'Native choice did not apply/resume');report.choices.push({index:pick,chosen,earned,applied});
  if(pick===0){
   await page.setViewportSize({width:844,height:390});await page.waitForTimeout(350);
   await page.evaluate(()=>{const g=app.battle,p=g.player;p.auto=false;app.input.clear();document.activeElement?.blur();window.__contact={hits:0,finishers:0,recoilRequests:0,maxPose:0,hapticRequests:[],dodgeEvents:[]};const dodge=p.dodge;p.dodge=function(dir){const before={state:p.state,idx:p.comboIdx,hitDone:p.hitDone};const result=dodge.call(this,dir);__contact.dodgeEvents.push({before,after:p.state,resume:p.comboResume?.idx});return result;};const old=g.damageEnemy;g.damageEnemy=function(e,n,opts={}){const hp=e.hp;const result=old.call(this,e,n,opts);if(opts.basic&&hp>e.hp){__contact.hits++;if(opts.finisher)__contact.finishers++;}return result;};const recoil=p.receiveStrikeRecoil;p.receiveStrikeRecoil=function(n){__contact.recoilRequests++;return recoil.call(this,n);};if(typeof navigator.vibrate==='function'){const vibration=navigator.vibrate.bind(navigator);navigator.vibrate=n=>{__contact.hapticRequests.push(n);return vibration(n);};}});
   const held=new Set();let captured=false,dodged=false;
   for(let n=0;n<110;n++){
    const move=await page.evaluate(()=>{const g=app.battle,p=g.player;let e=p.nearestEnemy(35);let dx=0,dz=0,d=e?p.distTo(e):99;
      if(e&&d<12){dx=e.pos.x-p.pos.x;dz=e.pos.z-p.pos.z;if(d<2.15){dx=dz=0;}}
      else{const rm=g.world.rooms.filter(r=>!r.cleared&&!(g.world.sealed&&r===g.world.bossRoom)).sort((a,b)=>Math.hypot(a.x-p.pos.x,a.z-p.pos.z)-Math.hypot(b.x-p.pos.x,b.z-p.pos.z))[0];if(rm){const flow=g.world.buildFlow(rm.x,rm.z),dir=g.world.flowDir(flow,p.pos.x,p.pos.z);if(dir)[dx,dz]=dir;}}
      const l=Math.hypot(dx,dz)||1,angle=app.input.getCameraYaw(),c=Math.cos(angle),s=Math.sin(angle),sx=dx/l*c-dz/l*s,sy=dx/l*s+dz/l*c;
      return {keys:[...(sx>.3?['d']:sx<-.3?['a']:[]),...(sy>.3?['s']:sy<-.3?['w']:[]),...(d<3.3?['j']:[])],alive:p.alive,paused:g.paused,canDodge:p.state==='attack'&&p.hitDone&&p.comboIdx>=1,idx:p.comboIdx};});
    if(!move.alive||move.paused)break;
    for(const k of held)if(!move.keys.includes(k)){await page.keyboard.up(k);held.delete(k);}for(const k of move.keys)if(!held.has(k)){await page.keyboard.down(k);held.add(k);}
    if(move.canDodge&&!dodged){await page.keyboard.press('k');dodged=true;}
    const sample=await page.evaluate(()=>{for(let i=0;i<12;i++){app.step(1/60,i===11);__contact.maxPose=Math.max(__contact.maxPose,Math.abs(app.battle.player.motionRoot.position.z));}return {...__contact,hp:app.battle.player.hp,auto:app.battle.player.auto,contacts:app.battle.crowdContacts};});
    if(sample.hits>=4&&!captured){await page.screenshot({path:path.join(out,'manual-sword-contact.png')});captured=true;}
    if(sample.hits>=8&&sample.recoilRequests>=4&&sample.dodgeEvents.length>0){report.combat={...sample,nativeDodge:dodged};break;}
   }
   for(const k of held)await page.keyboard.up(k);
   assert(report.combat&&!report.combat.auto&&report.combat.maxPose>.04&&report.combat.recoilRequests>=4,'No real native-input sword contact evidence');
  }
  await context.close();
 }
 assert(!report.errors.length&&!report.consoleErrors.length&&!report.httpErrors.length,'Runtime/console/HTTP errors');report.status='pass';
}catch(e){report.status='fail';report.failure=String(e.stack||e);process.exitCode=1;}
finally{await browser.close();if(server)await new Promise(r=>server.httpServer.close(r));await fs.writeFile(path.join(out,live?'live-report.json':'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
