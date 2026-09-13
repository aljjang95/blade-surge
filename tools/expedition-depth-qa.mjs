import { chromium, firefox, webkit } from 'playwright';
import { preview } from 'vite';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { EXPEDITION_DEPTHS } from '../src/data/expedition-depths.js';
import { EXPEDITION_ITEMS } from '../src/data/expedition-items.js';
import { STORY_EVENTS } from '../src/data/masterworks.js';
import { installMetricsDriver } from './metrics-driver.mjs';

const root=path.resolve(import.meta.dirname,'..');
const seed=Number(process.argv.find(a=>a.startsWith('--seed='))?.slice(7)||20260914);
if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw Error('Expected uint32 seed');
const tag=process.argv.find(a=>a.startsWith('--tag='))?.slice(6)||'';
if(tag&&!/^[a-z0-9-]{1,30}$/.test(tag))throw Error('Invalid evidence tag');
const out=path.join(root,`work/expedition-depth-qa-${seed}${tag?'-'+tag:''}`);await mkdir(out,{recursive:true});
const report={head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),seed,started:new Date().toISOString(),status:'running',ui:[],runs:[],errors:[],
  scope:'Local production build in isolated browser saves. UI unlock/completed-campaign states are fixtures. Combat uses preconfigured legal hero/gear values, AUTO, deterministic 1/60s stepping and first offered choice. No combat HP/damage/positions/victory edits. This is route and combat regression evidence, not proof of earning this equipment, physical-phone FPS or live party play.'};
const files=['src/data/expedition-depths.js','src/game/expedition-economy.js','src/game/expedition-combat.js','src/game/battle-base.js','src/game/masterworks-battle.js','src/game/masterworks-core.js','src/main.js','src/expansion/hub.jsx','src/expansion/depths.css','src/ui/meta.js','tools/expedition-depth-qa.mjs'];
report.sources=Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(path.join(root,f))).digest('hex')])));
const save=()=>writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
const assert=(v,m)=>{if(!v)throw Error(m);};
let server,browser;
try{
  server=await preview({root,logLevel:'error',preview:{host:'127.0.0.1',port:0}});
  const url=`http://127.0.0.1:${server.httpServer.address().port}`;
  report.build=await(await fetch(`${url}/version.json`)).json();
  for(const [engine,launcher] of Object.entries({chromium,firefox,webkit})){
    if(process.argv.includes('--combat-only')&&engine!=='chromium')continue;
    browser=await launcher.launch();
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,reducedMotion:'reduce'}),page=await context.newPage();
    page.setDefaultTimeout(30000);page.on('pageerror',e=>report.errors.push({engine,error:String(e)}));
    await page.addInitScript(seed=>{let n=seed;Math.random=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};},seed);
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:120000});
    if(await page.locator('#btn-ignore-rotate').isVisible())await page.locator('#btn-ignore-rotate').tap();
    await page.locator('#boot-start:not(.hidden)').waitFor({timeout:180000});await page.locator('#boot-start').tap();
    await page.waitForFunction(()=>window.app?.mode==='lobby'&&!document.querySelector('#boot.show'),null,{timeout:120000});
    await page.evaluate(()=>{const a=window.app;a.testPause=true;a.ui.closeModal();a.expeditionUI.open('dungeons',{depth:'deep'});});
    await page.locator('.exp-dungeon[data-depth="deep"]').first().waitFor();
    assert(await page.locator('.exp-dungeon .exp-primary:disabled').count()===3,`${engine}: locked routes can launch`);
    const ui={engine,version:browser.version(),locked:true,sizes:[]};report.ui.push(ui);
    await page.evaluate(defs=>{const a=window.app;a.eco.s.expedition.level=10;for(const d of defs){a.eco.s.progress.stars[d.unlockCode]=1;a.eco.s.expedition.stats[d.id]=1;}a.eco.save();a.expeditionUI.close();a.meta.refreshHome();},EXPEDITION_DEPTHS);
    assert(await page.locator('#btn-battle small').evaluate(e=>getComputedStyle(e).display==='none'),`${engine}: expedition list button shows a false energy charge`);
    await page.screenshot({path:path.join(out,`${engine}-campaign-complete-lobby.png`)});
    await page.locator('#btn-battle').tap();
    assert(await page.locator('.exp-route-tabs [aria-pressed="true"]').innerText().then(t=>t.includes('심층')),`${engine}: campaign departure missed deep routes`);
    for(const size of [{width:320,height:568},{width:390,height:844},{width:667,height:375}]){
      await page.setViewportSize(size);if(await page.locator('#btn-ignore-rotate').isVisible())await page.locator('#btn-ignore-rotate').tap();
      const rows=[];
      for(const d of EXPEDITION_DEPTHS){
        const card=page.locator(`.exp-dungeon[data-dungeon="${d.id}"]`),button=card.locator('.exp-primary');await button.scrollIntoViewIfNeeded();
        const state=await button.evaluate(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {disabled:e.disabled,height:r.height,inside:r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,hit:hit===e||e.contains(hit),overflow:document.documentElement.scrollWidth>innerWidth+1};});
        assert(!state.disabled&&state.height>=44&&state.inside&&state.hit&&!state.overflow,`${engine} ${size.width} ${d.id}: unreachable departure ${JSON.stringify(state)}`);rows.push({id:d.id,...state});
      }
      ui.sizes.push({size,rows});await page.screenshot({path:path.join(out,`${engine}-${size.width}x${size.height}.png`)});
    }
    if(engine==='chromium'&&!process.argv.includes('--ui-only')){
      await page.setViewportSize({width:1100,height:760});
      for(const [index,d] of EXPEDITION_DEPTHS.entries()){
        const heroId=seed===20260914?'knight':'mage';
        const fixture=await page.evaluate(({heroId,items})=>{
          const a=window.app,e=a.eco;a.expeditionUI.result=null;a.toLobby();a.testPause=true;a.ui.closeModal();
          e.grantHero(heroId);e.s.selected=heroId;const h=e.hero(heroId);h.level=50;h.star=3;h.skills=[5,5,5,5];h.exp=0;
          h.equip={};for(const def of items){const inst=e.addItem(def.rarity,def.slot);inst.id=def.id;inst.enh=15;h.equip[def.slot]=inst.uid;}
          e.s.energy=e.energyMax;e.s.energyT=Date.now();a.journey.s.autoBattle=true;e.save();
          a.expeditionUI.open('dungeons',{depth:'deep'});
          return {heroId,hero:structuredClone(h),bonus:e.heroEquipBonus(heroId),power:e.heroPower(heroId),energy:e.s.energy,material:{...a.expedition.s.materials},depthWins:{...a.expedition.s.depthWins}};
        },{heroId,items:EXPEDITION_ITEMS.filter(item=>item.set==='glasswarden')});
        const run={id:d.id,fixture,status:'running'};report.runs.push(run);await save();
        await page.locator(`.exp-dungeon[data-dungeon="${d.id}"] .exp-primary`).click();
        await page.waitForFunction(()=>window.app.mode==='battle'&&window.app.battle.active&&!window.app.stageStarting,null,{timeout:120000});
        run.start=await page.evaluate(()=>{const a=window.app,b=a.battle;b.player.auto=true;return {depth:b.stage.expedition.depth,boss:b.stage.encounter.enemyId,theme:b.stage.chapter.theme,scale:b.stage.scale,player:{hp:b.player.hp,atk:b.player.atk},energy:a.eco.s.energy,rooms:b.world.rooms.length};});
        assert(run.start.depth==='deep'&&run.start.energy===fixture.energy-6,`Wrong depth/charge: ${d.id}`);
        await page.evaluate(installMetricsDriver,{storyEvents:STORY_EVENTS.map(({id,choices})=>({id,choices:choices.map(({id})=>({id}))}))});
        let bossShot=false,peakAlive=0;
        for(let chunk=0;chunk<60;chunk++){
          const state=await page.evaluate(()=>{const a=window.app,b=a.battle;let peak=0;for(let n=0;n<600&&b.active;n++){window.__metricsDriver.step(1/60,false);peak=Math.max(peak,b.enemies.filter(e=>e.alive).length);}return {active:b.active,win:b.result?.win,elapsed:b.elapsed,rooms:b.roomsCleared,kills:b.kills,hp:b.player?.hp,maxHp:b.player?.maxHp,boss:!!b.boss,peak,cap:b.maxAlive};});
          peakAlive=Math.max(peakAlive,state.peak);run.last=state;run.peakAlive=peakAlive;
          if(chunk===0||(state.boss&&!bossShot)){
            await page.evaluate(()=>window.app.step(.001,true));await page.screenshot({path:path.join(out,`${heroId}-${d.id}-${state.boss?'boss':'entry'}.png`)});if(state.boss)bossShot=true;
          }
          if(chunk%10===0){await save();console.log(JSON.stringify({id:d.id,heroId,...state}));}
          if(!state.active)break;
        }
        await page.evaluate(()=>{for(let i=0;i<240;i++)window.app.step(1/60,false);});
        run.result=await page.evaluate(()=>{const a=window.app,b=a.battle;return {result:a.expeditionUI.result,depthWins:{...a.expedition.s.depthWins},materials:{...a.expedition.s.materials},choices:window.__metricsDriver.snapshot().choices,rooms:b.world?.rooms.map(r=>({type:r.type,cleared:r.cleared,attuned:!!r.attuned,waves:r.forgeWave||0})),pending:a.expedition.s.pending};});
        assert(run.last.win===true&&run.result.result?.win&&!run.result.result.saveError,`${d.id} did not complete: ${JSON.stringify(run.last)}`);
        assert(run.result.rooms.every(r=>r.cleared),`${d.id}: unfinished objectives`);
        assert(run.result.depthWins[d.id]===fixture.depthWins[d.id]+1&&run.result.pending===null,`${d.id}: receipt did not settle`);
        assert(run.result.choices.length===1&&run.result.choices[0].startsWith('boon:'),`${d.id}: expected one pre-boss choice, got ${run.result.choices}`);
        const material=Object.keys(d.rewards.materials)[0],expected=d.rewards.materials[material]+d.firstRewards.materials[material];
        assert(run.result.materials[material]-fixture.material[material]===expected&&run.result.result.rewards.firstClear,`${d.id}: first payout mismatch`);
        await page.screenshot({path:path.join(out,`${heroId}-${d.id}-result.png`)});
        await page.reload({waitUntil:'domcontentloaded',timeout:120000});
        await page.locator('#boot-start:not(.hidden)').waitFor({timeout:180000});await page.locator('#boot-start').click();
        await page.waitForFunction(()=>window.app?.mode==='lobby'&&!document.querySelector('#boot.show'),null,{timeout:120000});
        run.reloaded=await page.evaluate(()=>{const a=window.app;a.testPause=true;a.ui.closeModal();return {depthWins:{...a.expedition.s.depthWins},materials:{...a.expedition.s.materials},pending:a.expedition.s.pending};});
        assert(run.reloaded.depthWins[d.id]===run.result.depthWins[d.id]&&run.reloaded.materials[material]===run.result.materials[material]&&run.reloaded.pending===null,`${d.id}: browser reload changed the settled reward`);
        run.status='pass';await save();
        console.log(JSON.stringify({id:d.id,heroId,status:run.status,time:run.last.elapsed,kills:run.last.kills,peakAlive}));
      }
    }
    await browser.close();browser=null;await save();
  }
  assert(report.errors.length===0,`Page errors: ${JSON.stringify(report.errors)}`);report.status='pass';
}catch(e){report.status='fail';report.failure=String(e?.stack||e);process.exitCode=1;}
finally{await browser?.close();await new Promise(resolve=>server?.httpServer.close(resolve)||resolve());report.finished=new Date().toISOString();await save();console.log(JSON.stringify({status:report.status,path:path.join(out,'report.json'),failure:report.failure}));}
