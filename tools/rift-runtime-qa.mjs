import {chromium} from 'playwright';
import {createServer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'work/rift-runtime-qa');await mkdir(out,{recursive:true});
const report={started:new Date().toISOString(),scope:'Actual app and loaded game models. Isolated browser save; QA assigns each rule, positions player and advances production app.step at fixed 50ms without realtime frame pacing. Real WebGL screenshots, not an organic playthrough, performance claim or paid settlement.',status:'running',errors:[],rules:[]};
let server,browser;const save=()=>writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
try{
server=await createServer({root,configFile:false,server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();report.url=`http://127.0.0.1:${server.httpServer.address().port}`;
browser=await chromium.launch();report.browser=browser.version();const page=await browser.newPage({viewport:{width:1200,height:800}});page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
await page.goto(report.url,{waitUntil:'domcontentloaded',timeout:120000});await page.locator('#boot-start:not(.hidden)').waitFor({timeout:180000});await page.locator('#boot-start').click();
await page.waitForFunction(()=>window.app?.mode==='lobby'&&!document.querySelector('#boot.show'),null,{timeout:90000});
console.log('real app booted');
report.gpu=await page.evaluate(()=>{const gl=window.app.renderer.r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL||gl.RENDERER);});
for(const rule of ['iron','fury','siege']){
 const result={rule};report.rules.push(result);
 await page.evaluate(async(rule)=>{
  const app=window.app;app.testPause=true;await app.toLobby();
  const {buildExpeditionStage}=await import('/src/game/expedition-combat.js');
  const {applyRiftStage}=await import('/src/game/journey-rifts.js');
  const stage=applyRiftStage(buildExpeditionStage('dungeon','glass_garden',app.eco),{target:'glass_garden',riftId:rule});
  document.querySelector('#meta')?.classList.remove('show');app.ui.closeModal();app.mode='battle';
  await app.battle.start(stage,app.eco.s.selected,app.eco.hero(app.eco.s.selected),app.eco.heroEquipBonus(app.eco.s.selected));
  const g=app.battle;g.player.auto=false;
  const room=g.world.rooms.find(r=>r.type==='normal');g.player.pos.set(room.x,0,room.z);if(!room.spawned)g.enterRoom(room);
 },rule);
 await page.evaluate(rule=>{const app=window.app,g=app.battle;const ready=()=>rule==='fury'?g.riftEncounter?.warning&&!g.riftEncounter.warning.hit:rule==='siege'?g.riftEncounter?.leader:g.enemies.some(e=>e.alive&&!e.spawning);for(let i=0;i<400&&!ready();i++)app.step(.05,false);if(!ready())throw Error('Rule state did not emerge: '+JSON.stringify({rule,elapsed:g.elapsed,paused:g.paused,alive:g.enemies.filter(e=>e.alive).length,room:g.curRoom?.type,riftRoom:g.riftEncounter?.room?.type}));app.step(.001,true);},rule);
 result.initial=await page.evaluate(()=>{const g=window.app.battle,r=g.riftEncounter;return {active:g.active,riftId:g.stage.riftId,alive:g.enemies.filter(e=>e.alive).length,armor:g.enemies.filter(e=>e.riftArmor).length,warning:r.warning?{x:r.warning.x,z:r.warning.z,radius:r.warning.radius,age:r.warning.age}:null,leader:r.leader?.def.name,markerVisible:r.marker.visible,sceneGroup:g.scene.getObjectByName('rift-encounters')?.children.length};});
 await page.screenshot({path:path.join(out,`${rule}.png`)});
 if(rule==='fury'){
  // Controlled relocation exercises the actual live collision check, not a mock hurt.
  await page.evaluate(()=>{const g=window.app.battle,h=g.riftEncounter.warning;if(h)g.player.pos.set(h.x+4,0,h.z);});
  await page.evaluate(()=>{const app=window.app;for(let i=0;i<80&&!app.battle.riftEncounter.resolved;i++)app.step(.05,false);app.step(.001,true);});
  result.avoidance=await page.evaluate(()=>({resolved:window.app.battle.riftEncounter.resolved,breakWindows:window.app.battle.enemies.filter(e=>e.breakT>0).length}));
  if(result.avoidance.resolved<1||result.avoidance.breakWindows<1)throw Error('Live avoidance failed to open a caster BREAK');
 }
 if(rule==='siege'){
  await page.evaluate(()=>{const app=window.app;for(let i=0;i<180&&!app.battle.enemies.some(e=>e.riftReinforcement);i++)app.step(.05,false);app.step(.001,true);});
  result.reinforcements=await page.evaluate(()=>{const g=window.app.battle;return {called:g.riftEncounter.called,spawned:g.enemies.filter(e=>e.riftReinforcement).map(e=>({xpReward:e.xpReward,summoned:e.summoned,homeRoom:!!e.homeRoom})),alive:g.enemies.filter(e=>e.alive).length,maxAlive:g.maxAlive};});
  if(result.reinforcements.called!==2||!result.reinforcements.spawned.length||result.reinforcements.spawned.some(e=>e.xpReward!==0||!e.summoned||!e.homeRoom)||result.reinforcements.alive>result.reinforcements.maxAlive)throw Error('Live reinforcement capacity or reward contract failed');
 }
 result.cleanup=await page.evaluate(async()=>{const g=window.app.battle;await window.app.toLobby();return {runtime:g.riftEncounter,remainingGroup:!!g.scene.getObjectByName('rift-encounters')};});
 if(result.cleanup.runtime||result.cleanup.remainingGroup)throw Error('rift resource survived stop');
 console.log(`${rule}: captured actual battle`);await save();
}
if(report.errors.length)throw Error('browser errors');report.status='pass';
}catch(e){report.status='fail';report.error=String(e.stack||e);process.exitCode=1;}
finally{await browser?.close();await server?.close();report.finished=new Date().toISOString();await save();}
console.log(JSON.stringify(report,null,2));
