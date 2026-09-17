import {validateRuptureEvidence} from './experience-qa-evidence.mjs';
// Run-input probe on the actual compiled app. No synthetic levels, equipment or damage.
import {chromium} from 'playwright';import {preview} from 'vite';import fs from 'node:fs/promises';import path from 'node:path';import {launchOpts} from './chrome.mjs';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'work/experience-v2/combat-qa');await fs.mkdir(out,{recursive:true});
const server=await preview({root,configFile:false,preview:{host:'127.0.0.1',port:0},logLevel:'error'}),browser=await chromium.launch(launchOpts({headless:true}));
const report={status:'running',scope:'Fresh Lv1 empty inventory; actual campaign movement/held-attack input then real skill-button press. Fixed simulation steps, not a human playtest.',runs:[],errors:[]};
const assert=(v,m)=>{if(!v)throw Error(m);};
try{
 const cases=[...['rupture','aegis','flow'].map(art=>({hero:'knight',art})),...['barbarian','mage','rogue','ranger'].map(hero=>({hero,art:'flow'}))];
 for(const {hero,art} of cases){
  const context=await browser.newContext({viewport:{width:880,height:400},hasTouch:true,serviceWorkers:'block'}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);await page.locator('#boot-start:not(.hidden)').waitFor({timeout:90000});await page.locator('#boot-start').click();
  await page.waitForFunction(()=>app?.mode==='lobby'&&!document.querySelector('#boot').classList.contains('show'));await page.waitForTimeout(800);
  await page.evaluate(()=>{app.ui.closeModal();app.testPause=true;let seed=20260916;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};});
  if(hero!=='knight'){await page.locator('.bottomnav [data-tab="heroes"]').click();await page.locator(`#hero-list [data-hero-id="${hero}"]`).click();await page.locator('.bottomnav [data-tab="home"]').click();}
  await page.locator(`.experience-art[data-art="${art}"]`).click();
  const before=await page.evaluate(()=>({level:app.eco.hero().level,inventory:app.eco.s.inventory.length,art:app.arsenal.artForHero()}));assert(before.level===1&&before.inventory===0&&before.art===art,'Not a fresh saved art selection');
  await page.locator('#btn-battle').click();await page.waitForFunction(()=>app.battle?.active&&!app.stageStarting);
  const ready=await page.evaluate(async()=>{
   const a=app,g=a.battle,p=g.player;p.auto=true;let approached=false;
   for(let frame=0;frame<2100&&g.active&&p.alive;frame++){
    const enemies=g.enemies.filter(e=>e.alive&&!e.spawning),nearest=enemies.sort((x,y)=>x.pos.distanceToSquared(p.pos)-y.pos.distanceToSquared(p.pos))[0];
    if(nearest&&p.pos.distanceTo(nearest.pos)<12)approached=true;
    if(approached&&nearest){p.auto=false;a.input.joy.active=true;const delta=nearest.pos.clone().sub(p.pos),d=delta.length();const yaw=a.input.getCameraYaw(),c=Math.cos(yaw),s=Math.sin(yaw);delta.normalize();a.input.screenMove.x=d>2?delta.x*c-delta.z*s:0;a.input.screenMove.y=d>2?delta.x*s+delta.z*c:0;a.input.attackHeld=true;}
    else if(!nearest){p.auto=true;approached=false;a.input.clear();}
    a.step(1/60,frame%30===0);
    if(g.getComboLinkSnapshot().ready){a.input.clear();p.auto=false;a.step(0,true);return {ready:true,elapsed:g.elapsed,level:p.heroLevel,hp:p.hp,maxHp:p.maxHp,kills:g.kills,link:g.getComboLinkSnapshot()};}
    if(frame%120===0)await new Promise(r=>setTimeout(r,0));
   }
   return {ready:false,elapsed:g.elapsed,hp:p.hp,kills:g.kills,state:p.state,level:p.heroLevel};
  });assert(ready.ready,'No early-game actual combo link '+JSON.stringify(ready));
  const layout=await page.evaluate(()=>{
    const element=document.querySelector('.experience-link'),rect=element.getBoundingClientRect(),visible=!element.hidden&&rect.width>0&&rect.height>0;
    const blockers=[...document.querySelectorAll('#wave-banner,#bossbar,.combat-notice,.hud-center,.oath-camera-details')].filter(e=>{const r=e.getBoundingClientRect(),style=getComputedStyle(e);return r.width&&r.height&&style.display!=='none'&&style.visibility!=='hidden'&&+style.opacity>.1;});
    const overlaps=blockers.filter(e=>{const r=e.getBoundingClientRect();return Math.min(rect.right,r.right)>Math.max(rect.left,r.left)&&Math.min(rect.bottom,r.bottom)>Math.max(rect.top,r.top);}).map(e=>e.id||e.className);
    return {visible,rect:rect.toJSON(),overlaps,text:element.textContent};
  });assert(layout.visible&&!layout.overlaps.length,'Link prompt overlaps gameplay '+JSON.stringify(layout));
  await page.screenshot({path:path.join(out,`${hero}-${art}-ready.png`)});
  await page.evaluate(()=>{const g=app.battle,fn=g.onSkillReleased;window.__linkEvidence=[];window.__linkDamage=[];
    const originalDamage=g.damageEnemy, targets=new Map(), linkedPrimary=g.comboLink.ready?.target;
    g.damageEnemy=function(enemy,amount,opts={}) {
      const before=enemy.hp, beforeState=enemy.state, beforeStun=enemy.stun||0;
      const dodgeChance=enemy.def?.dodge||0, originalFeedback=g.fx.damage;
      let missObserved=false, result;
      g.fx.damage=function(position,value,feedback) {
        if(position===enemy.pos && feedback?.text==='MISS') missObserved=true;
        return originalFeedback.apply(this,arguments);
      };
      try { result=originalDamage.call(this,enemy,amount,opts); }
      finally { g.fx.damage=originalFeedback; }
      if(opts.apexProc) {
        if(!targets.has(enemy)) targets.set(enemy,targets.size+1);
        window.__linkDamage.push({targetId:targets.get(enemy),target:enemy.def?.name,
          before,after:enemy.hp,delta:before-enemy.hp,beforeState,afterState:enemy.state,
          beforeStun,dodgeChance,missObserved,isLinkPrimary:enemy===linkedPrimary,quiet:opts.quiet,noProc:opts.noProc,apexProc:true});
      }
      return result;
    };
g.onSkillReleased=function(p,c){const before={cds:[...p.cds],shield:g.apex.shield,procs:g.apex.procCount};const applied=fn.call(this,p,c);window.__linkEvidence.push({skill:c.sk.id,applied,before,after:{cds:[...p.cds],shield:g.apex.shield,procs:g.apex.procCount},count:g.comboLink.activations});return applied;};});
  await page.locator('#hud .skill-btn[data-skill="0"]').click();
  const after=await page.evaluate(()=>{for(let i=0;i<80;i++)app.step(1/60,i===79);return {link:app.battle.getComboLinkSnapshot(),events:window.__linkEvidence,apexDamage:window.__linkDamage,hp:app.battle.player.hp,alive:app.battle.player.alive,kills:app.battle.kills,receivedText:document.querySelector('.experience-link').textContent};});
  assert(after.link.activations===1&&after.events.some(e=>e.applied),'Actual skill did not activate '+JSON.stringify(after));
  await page.screenshot({path:path.join(out,`${hero}-${art}-released.png`)});
  if(art==='rupture')assert(validateRuptureEvidence(after.apexDamage),'No actual bounded rupture damage '+JSON.stringify(after.apexDamage));
  const event=after.events.find(e=>e.applied);if(art==='aegis')assert(event.after.shield>0,'No actual shield');if(art==='flow')assert(event.before.cds.some((v,i)=>event.after.cds[i]<v),'No cooldown reduction');
  report.runs.push({hero,art,before,ready,layout,after});console.log(JSON.stringify({hero,art,readyAt:ready.elapsed,firstActivation:after.link.activations,kills:after.kills}));await context.close();
 }
 assert(report.errors.length===0,'Runtime exception');report.status='pass';
}catch(e){report.status='fail';report.failure=String(e.stack||e);process.exitCode=1;}
finally{await browser.close();await new Promise(r=>server.httpServer.close(r));await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,runs:report.runs.length,failure:report.failure}));}
