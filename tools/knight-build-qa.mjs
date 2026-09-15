// Domain QA adapter: compiled app, isolated save, fixed-seed controlled same-boss casts.
import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';
const root=path.resolve(process.argv.find(a=>a.startsWith('--root='))?.slice(7)||path.resolve(import.meta.dirname,'..')),live=process.argv.includes('--live'),baseline=process.argv.includes('--baseline');
const out=path.join(root,'work/supervisor-rsi-20260916',live?'qa-live':baseline?'qa-baseline':'qa-local');await mkdir(out,{recursive:true});
const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const report={sha,status:'running',scope:'Isolated synthetic Lv50 save, real compiled UI/cast/damage and controlled garden_finalboss. Fixed-step simulation; not organic loot acquisition, human playtest or physical-device FPS.',errors:[],blockedWrites:[],builds:[]};
const check=(v,m)=>{if(!v)throw Error(m);};let browser,server;
try{
 if(!live)server=await preview({root,configFile:false,preview:{host:'127.0.0.1',port:0},logLevel:'error'});
 const origin=live?'https://blade-surge.affinity-agent-studio.workers.dev':`http://127.0.0.1:${server.httpServer.address().port}`;report.origin=origin;
 browser=await chromium.launch(launchOpts({headless:true}));report.browser=browser.version();
 const context=await browser.newContext({viewport:{width:880,height:400},hasTouch:true,serviceWorkers:'block'}),page=await context.newPage();
 await page.route('**/*',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.request().method())){report.blockedWrites.push(r.request().url());return r.abort();}return r.continue();});
 page.on('pageerror',e=>report.errors.push('PAGE '+e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push('CONSOLE '+m.text());});
 const boot=async()=>{await page.locator('#boot-start:not(.hidden)').waitFor({timeout:90000});await page.locator('#boot-start').click();await page.waitForFunction(()=>window.app?.mode==='lobby');};
 await page.goto(origin,{waitUntil:'domcontentloaded',timeout:60000});await boot();
 if(live){report.version=await page.evaluate(()=>fetch('/version.json?qa='+Date.now(),{cache:'no-store'}).then(r=>r.json()));check(report.version.sha===sha&&!report.version.dirty,'Live version differs from checkout');}
 report.gpu=await page.evaluate(()=>{const gl=app.renderer.r.getContext(),ex=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(ex?.UNMASKED_RENDERER_WEBGL||gl.RENDERER);});
 const sets=['echo','anchor','aegis'],variants=['return','fissure','pierce'];
 // Provision only this new browser context; never touch a real player's save.
 await page.evaluate(()=>{app.testPause=true;app.ui.closeModal();const h=app.eco.hero('knight');h.level=50;app.eco.s.selected='knight';app.eco.s.expedition.selectedJob=null;app.eco.s.progress.unlocked=10;});
 for(let i=0;i<sets.length;i++){
  await page.evaluate(({set,i})=>{const e=app.eco,h=e.hero('knight'),slots=['weapon','armor','ring','boots'];slots.forEach((s,j)=>{const uid=60000+i*10+j;if(!e.s.inventory.some(x=>x.uid===uid))e.s.inventory.push({uid,id:`arm_${set}_${s}`,enh:0});h.equip[s]=uid;});e.s.invSeq=60040;h.skillLoadout=i===1?[7,6]:[6,7];e.save();document.querySelector('.arsenal-open').click();},{set:sets[i],i});
  const card=page.locator('#arsenal .arsenal-presets article').nth(i);await card.locator('input').fill(variants[i]);await card.getByRole('button',{name:'현재 구성 저장',exact:true}).click();
  check(await page.evaluate(()=>app.arsenalView.notice.textContent.includes('저장 완료')),'Preset save UI failed');
  await page.locator('#arsenal').getByRole('button',{name:'닫기',exact:true}).click();
 }
 await page.reload({waitUntil:'domcontentloaded'});await boot();
 report.presets=await page.evaluate(()=>{app.testPause=true;return app.arsenal.s.heroes.knight.presets.map(p=>({name:p.name,loadout:p.skillLoadout}));});
 check(baseline||report.presets.length===3&&String(report.presets[1].loadout)==='7,6','Preset reload failed');
 for(let i=0;i<sets.length;i++){
  await page.evaluate(()=>{app.toLobby();app.testPause=true;app.eco.hero('knight').level=50;app.eco.hero('knight').skillLoadout=[4,5];app.eco.s.expedition.selectedJob=null;app.ui.closeModal();document.querySelector('.arsenal-open').click();});
  await page.locator('#arsenal .arsenal-presets article').nth(i).getByRole('button',{name:'변경 비교',exact:true}).click();
  await page.locator('#arsenal').getByRole('button',{name:'이 구성 적용',exact:true}).click();
  const restored=await page.evaluate(()=>({loadout:[...app.eco.hero().skillLoadout],variant:app.arsenal.variantForHero?.()||'classic'}));check(baseline||restored.variant===variants[i],'Wrong preset variant');
  await page.evaluate(()=>{document.querySelector('#arsenal .arsenal-body').scrollTop=0;});
  await page.screenshot({path:path.join(out,`${sets[i]}-arsenal.png`)});
  await page.locator('#arsenal').getByRole('button',{name:'닫기',exact:true}).click();
  const setup=await page.evaluate(async()=>{
   const a=app;let seed=20260916;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
   a.testPause=true;a.eco.hero().skillLoadout=[6,7];a.eco.s.energy=120;const ok=await a.startStage(a.eco.nextStage());if(!ok)throw Error('Start failed');
   const g=a.battle,p=g.player,room=g.world.bossRoom;p.auto=false;p.invuln=100;a.companionAgent?.endBattle();
   const flags=()=>g.world.rooms.filter(r=>r!==room&&r!==g.world.startRoom).map(r=>[r.id,r.cleared,r.discovered]);
   const before=JSON.stringify(flags()),shortcut=g.shortcutBoss(),after=JSON.stringify(flags());
   p.pos.set(room.x,0,room.z+6);g.enterRoom(room);
   for(let k=0;k<400&&(!g.boss||g.boss.spawning);k++){a.step(1/60,false);if(k%10===0)await new Promise(r=>setTimeout(r,5));}
   const e=g.boss;if(!e?.alive||e.spawning)throw Error('Signature boss not ready');
   // Freeze adds and boss for this single-cast geometry probe, not for the later AUTO fight.
   for(const enemy of g.enemies){enemy.stun=1000;enemy.vel.set(0,0,0);enemy.kb.set(0,0,0);if(enemy!==e)enemy.pos.set(room.x-room.w/2+2,0,room.z-room.h/2+2);}
   e.pos.set(room.x,0,room.z);p.pos.set(room.x,0,room.z+6);p.vel.set(0,0,0);p.kb.set(0,0,0);p.state='idle';p.stun=0;p.cds.fill(0);p.mp=100;g.input.clear();
   const seen={shots:[],zones:[],bossHits:[]},spawn=g.spawnProjectile,hitRadius=g.hitRadius,damage=g.damageEnemy;
   g.spawnProjectile=function(s){if(s.owner===p)seen.shots.push({radius:s.radius,speed:s.speed,dmg:s.dmg,dir:{x:s.dir.x,z:s.dir.z}});return spawn.call(this,s);};
   g.hitRadius=function(...args){if(args[3]?.source===p)seen.zones.push({radius:args[1],dmg:args[2]});return hitRadius.apply(this,args);};
   g.damageEnemy=function(target,dmg,opts){const before=target.hp,result=damage.call(this,target,dmg,opts);if(target===e&&opts?.source===p)seen.bossHits.push({loss:before-target.hp,kind:opts.kind});return result;};
   window.__knightQA={seen,restore(){g.spawnProjectile=spawn;g.hitRadius=hitRadius;g.damageEnemy=damage;}};
   a.cameraControls.set({yaw:0,pitch:-10,zoom:70});g.renderer.rig.target.copy(e.pos);for(let k=0;k<20;k++)g.renderer.update(0,.05);a.step(0,true);
   return {shortcut,flagsPreserved:before===after,boss:e.def.name,bossHp:e.hp,stats:{atk:p.stats.atk,hp:p.maxHp,def:p.stats.def},loadout:[...p.skillLoadout]};
  });check(setup.shortcut&&setup.flagsPreserved,'Shortcut changed optional flags');
  await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('#wave-banner')).opacity)<.01);
  await page.locator('#hud .skill-btn[data-skill="0"]').click();
  await page.evaluate(()=>{for(let k=0;k<52;k++)app.step(1/60,k===51);});
  await page.screenshot({path:path.join(out,`${sets[i]}-cast.png`)});
  const cast=await page.evaluate(()=>{for(let k=0;k<100;k++)app.step(1/60,false);const r=structuredClone(window.__knightQA.seen);r.cast=!!app.battle.player.skillCtx?.cast;r.cd=app.battle.player.cds[0];window.__knightQA.restore();return r;});
  const expectedShots=!baseline&&i===0?2:1,expectedZones=!baseline&&i===1?3:0;
  check(cast.cast&&cast.shots.length===expectedShots&&cast.zones.length===expectedZones&&cast.bossHits.some(h=>h.loss>0),'Actual cast signature mismatch '+JSON.stringify({i,cast}));
  const battle=await page.evaluate(async()=>{
   const a=app,g=a.battle,p=g.player,e=g.boss;p.invuln=0;p.hp=p.maxHp;
   for(const enemy of g.enemies){enemy.stun=0;enemy.kb.set(0,0,0);}p.auto=true;g.input.clear();
   let frames=0;for(;frames<10800&&g.active&&p.alive;frames++){a.step(1/60,frames%90===0);if(frames%300===0)await new Promise(r=>setTimeout(r,0));}
   a.step(0,true);return {won:!!g.result?.win,bossDead:!e.alive,heroAlive:p.alive,elapsed:g.elapsed,kills:g.kills,fullClear:!!g.result?.fullClear,optionalCleared:g.result?.optionalCleared,frames};
  });check(battle.won&&battle.heroAlive&&!battle.fullClear,'Controlled same-boss fight failed '+JSON.stringify(battle));
  report.builds.push({set:sets[i],variant:variants[i],restored,setup,cast,battle});console.log(JSON.stringify({variant:variants[i],hits:cast.bossHits.length,shots:cast.shots.length,zones:cast.zones.length,battle}));
 }
 await page.evaluate(()=>{app.toLobby();app.testPause=true;app.ui.closeModal();document.querySelector('.arsenal-open').click();});
 report.layouts=[];report.baseline=baseline;
 for(const [width,height] of [[880,400],[640,360]]){
  await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));
  await page.evaluate(()=>{document.querySelector('#arsenal .arsenal-body').scrollTop=0;});
  const layout=await page.evaluate(()=>{const d=document.querySelector('#arsenal'),r=d.getBoundingClientRect();return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1,dialogOverflow:d.scrollWidth>d.clientWidth+1,inBounds:r.x>=0&&r.right<=innerWidth+1};});
  report.layouts.push(layout);check(!layout.overflow&&!layout.dialogOverflow&&layout.inBounds,'Mobile arsenal overflow');
  await page.screenshot({path:path.join(out,`arsenal-${width}x${height}.png`)});
 }
 check(report.errors.length===0,'Browser errors '+JSON.stringify(report.errors));check(report.blockedWrites.length===0,'Unexpected external writes');
 report.status='pass';
}catch(e){report.status='fail';report.failure=String(e.stack||e);process.exitCode=1;}
finally{
 await browser?.close();if(server)await new Promise(r=>server.httpServer.close(r));
 report.finished=new Date().toISOString();await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
 const bytes=await readFile(path.join(out,'report.json'));await writeFile(path.join(out,'report.sha256'),createHash('sha256').update(bytes).digest('hex'));
 console.log(JSON.stringify({status:report.status,builds:report.builds.length,errors:report.errors,failure:report.failure,report:path.join(out,'report.json')}));
}
