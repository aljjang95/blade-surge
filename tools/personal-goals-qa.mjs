// SOURCE-ONLY v2 prepared helper. Every execution surface is NOT_RUN.
// Execute only after the owning loop freezes/authorizes the exact clean build.
import fs from 'node:fs/promises';
import path from 'node:path';
import { ENERGY } from '../src/data/shop.js';
import { DUNGEONS, accountLevelXp } from '../src/data/expansion.js';
import { applyFrontierRewards } from '../src/data/seasonal-content.js';
import { normalizeRunDetails } from '../src/game/run-history.js';
import { capturePersonalGoal, choosePersonalGoal, comparableRunContext, evaluatePersonalGoal, summarizePersonalRuns } from '../src/game/run-personal-goals.js';
import { personalContextLabel, personalResultLabel, personalTargetLabel } from '../src/ui/personal-goal-labels.js';
import { createExpeditionQa, nativeGameplayFocus, qaArgument, qaAssert, qaHash } from './expedition-qa-runtime.mjs';
import { assessMediaObservations } from './qa-media-checkpoints.mjs';

const root=path.resolve(import.meta.dirname,'..'),saveArg=qaArgument('save'),maxRuns=Number(qaArgument('max-runs')||6);
qaAssert(saveArg&&path.isAbsolute(saveArg),'Required --save=/absolute/exact-naturally-earned-save.json');
qaAssert(Number.isInteger(maxRuns)&&maxRuns>=1&&maxRuns<=12,'--max-runs must be 1..12');
const savePath=path.resolve(saveArg),bytes=await fs.readFile(savePath),rawSave=bytes.toString('utf8'),saved=JSON.parse(rawSave);
const acquisitionPath=qaArgument('acquisition')||path.join(path.dirname(savePath),'report.json');
qaAssert(path.isAbsolute(acquisitionPath),'Acquisition report must be absolute');
const acquisitionBytes=await fs.readFile(acquisitionPath),acquisition=JSON.parse(acquisitionBytes);
const acquisitionHash=qaArgument('acquisition-sha256');
qaAssert(/^[0-9a-f]{64}$/.test(acquisitionHash||'')&&qaHash(acquisitionBytes)===acquisitionHash,'Required --acquisition-sha256 from independently reviewed immutable acquisition report');
qaAssert(acquisition.kind==='earned-expedition-save'&&acquisition.status==='pass'&&acquisition.naturalStart===true&&acquisition.synthetic===false
  &&acquisition.contextInitiallyEmpty===true&&/^[0-9a-f]{40}$/.test(acquisition.head||'')&&acquisition.head===acquisition.expectedSha
  &&acquisition.build?.sha===acquisition.head&&acquisition.build?.dirty===false&&typeof acquisition.build?.pwaRelease==='string'
  &&acquisition.earnedSave?.natural===true&&acquisition.earnedSave.sha256===qaHash(bytes)&&acquisition.earnedSave.bytes===bytes.length
  &&saved.selected==='knight'&&saved.expedition?.pending===null&&saved.expedition.level>=3&&saved.energy>=4
  &&acquisition.earnedSave.level===saved.expedition.level&&acquisition.earnedSave.xp===saved.expedition.xp
  &&acquisition.earnedSave.seq===saved.expedition.seq&&acquisition.earnedSave.energy===saved.energy
  &&JSON.stringify(acquisition.earnedSave.stats)===JSON.stringify(saved.expedition.stats)
  &&JSON.stringify(acquisition.earnedSave.history)===JSON.stringify(saved.masterworks?.history)
  &&acquisition.mediaGates==='pass'&&acquisition.errors?.length===0&&acquisition.httpErrors?.length===0
  &&acquisition.mediaCheckpointDiagnostics?.length===0&&acquisition.mediaCancellations?.unresolved?.length===0
  &&acquisition.runs?.length>0&&acquisition.runs.every(run=>run.status==='pass'&&run.actual?.paid&&run.after?.result?.win===true
    &&run.afterReload?.selected==='knight'&&run.afterReload.pending===null&&run.afterReload.active===false),
  'Requires exact naturally-earned UI save/report with original release and strict media evidence; a supplied report is not authenticated provenance');
qaAssert(assessMediaObservations(acquisition).passed,'Original raw acquisition failures must pass the unchanged strict classifier; reported pass alone is insufficient');
for(const [artifact,source] of [['driver.mjs','tools/earn-expedition-qa.mjs'],['runtime.mjs','tools/expedition-qa-runtime.mjs'],['media-observer.mjs','tools/conquest-media-observer.mjs'],['media-checkpoints.mjs','tools/qa-media-checkpoints.mjs']]){
  qaAssert(acquisition.sources?.[source]===qaHash(await fs.readFile(path.join(path.dirname(acquisitionPath),artifact))),`Original acquisition archived source hash differs: ${artifact}`);
}
const report={kind:'personal-goals-ui',synthetic:false,releaseApproved:false,runs:[],events:[],maxRuns,
  acquisition:{path:acquisitionPath,sha256:qaHash(acquisitionBytes),head:acquisition.head,build:acquisition.build,saveSha256:qaHash(bytes),saveBytes:bytes.length},
  scope:'Exact frozen clean production release. Restore exact naturally-earned save once in isolated context; native journal/metric/departure/choices/result/reload. Only original AUTO and fixed 1/60s app.step pacing. Pure calculations verify observed state; they never write game state. No profile/hero level/gear/HP/actor/position/kills/outcome edits, direct reward/settlement/access calls, grants, purchases, Date/random overrides or goal rewards. Same-condition eligibility must occur naturally within the bounded runs, otherwise FAIL. No achievement is manufactured.',
  coverage:{metricChoices:'NOT_RUN',nativeReload:'NOT_RUN',paidDeparture:'NOT_RUN',eligibleResult:'NOT_RUN',achievement:'NOT_OBSERVED',conditionMismatch:'NOT_OBSERVED',windowEviction:'NOT_RUN',storageFailure:'NOT_RUN',manualOrMixedPlay:'NOT_RUN',campaignDeepRiftConquest:'NOT_RUN',physicalPhone:'NOT_RUN',formalMetrics:'NOT_RUN',visualApproval:'NOT_RUN',longTermRetention:'NOT_RUN',AAA:'NOT_ASSESSED'}};
const qa=await createExpeditionQa({root,driver:import.meta.filename,report,sourceFiles:[
  'tools/personal-goals-qa.mjs','tools/expedition-qa-runtime.mjs','tools/conquest-media-observer.mjs','tools/qa-media-checkpoints.mjs',
  'src/main.js','src/game/battle-base.js','src/game/rpg-battle.js','src/game/actor.js','src/game/economy.js','src/game/expedition-economy.js',
  'src/game/run-personal-goals.js','src/game/run-history.js','src/game/masterworks-core.js','src/game/masterworks-service.js','src/game/masterworks-battle.js',
  'src/ui/personal-goal-labels.js','src/ui/masterworks.js','src/ui/masterworks.css','src/expansion/hub.jsx',
  'src/data/shop.js','src/data/expansion.js','src/data/seasonal-content.js']});
let page;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const withoutGoal=eco=>{const copy=structuredClone(eco);delete copy.masterworks.personalGoal;return copy;};
async function state(){return page.evaluate(()=>{const a=window.app,b=a.battle;return{
  eco:structuredClone(a.eco.s),energy:a.eco.s.energy,energyT:a.eco.s.energyT,energyMax:a.eco.energyMax,observedAt:Date.now(),
  active:b.active,paused:b.paused,auto:b.player?.auto,dirty:!!b.rpgDirty,heroId:a.eco.s.selected,heroLevel:a.eco.hero().level,
  history:structuredClone(a.eco.s.masterworks.history),goal:structuredClone(a.eco.s.masterworks.personalGoal),
  pending:structuredClone(a.expedition.s.pending),result:structuredClone(a.expeditionUI.result),
  run:b.run&&{id:b.run.id,perfects:b.run.perfects,breaks:b.run.breaks,controlSeen:b.run.controlSeen,context:structuredClone(b.run.historyContext),goal:structuredClone(b.run.personalGoal)},
  terminal:b.result&&{win:b.result.win,time:b.result.time,paid:!!b.result.expeditionReceipt?.ok,receipt:structuredClone(b.result.expeditionReceipt),goal:structuredClone(b.result.masterworks?.personalGoal)},
  raw:localStorage.getItem('bladesurge_save_v1')};});}
function energyTransition(before,after,cost,label){
  // Public policy arithmetic only; no tickEnergy/spendEnergy/Date write.
  const period=ENERGY.regenSec*1000,max=before.energyMax;
  qaAssert(Number.isSafeInteger(before.energy)&&Number.isSafeInteger(after.energy)&&Number.isFinite(before.energyT)&&Number.isFinite(after.energyT)
    &&before.energyT<=before.observedAt&&after.energyT<=after.observedAt&&after.observedAt>=before.observedAt
    &&max===after.energyMax&&max===ENERGY.max,`${label}: ambiguous native energy observation`);
  let regained=0,saturated=false;
  if(before.energy>=max)qaAssert(before.energy===max&&after.energy===max-cost&&after.energyT>=before.observedAt,`${label}: native full-energy charge`);
  else{const ticks=(after.energyT-before.energyT)/period,due=Math.floor((after.observedAt-before.energyT)/period);
    if(Number.isSafeInteger(ticks)&&ticks>=0&&ticks<=due&&before.energy+ticks<max){regained=ticks;qaAssert(after.energy===before.energy+ticks-cost,`${label}: unexplained native energy delta`);}
    else{saturated=true;regained=max-before.energy;qaAssert(due>=regained&&after.energy===max-cost&&after.energyT>=before.observedAt&&after.energyT>=before.energyT+regained*period,`${label}: unexplained real energy cap`);}}
  return{cost,regained,saturated,regenSec:ENERGY.regenSec,before:{energy:before.energy,energyT:before.energyT,observedAt:before.observedAt},after:{energy:after.energy,energyT:after.energyT,observedAt:after.observedAt}};
}
async function journal(){
  // The original .mw-open is inside the closed Oath menu after native reload.
  // Use the same actually visible native growth entry as replayability QA.
  if(!await page.locator('#masterworks[open]').isVisible())await page.locator('.oath-nav-growth').click();
  await page.locator('#masterworks .mw-tabs').getByRole('button',{name:'기록',exact:true}).click();
  const panel=page.locator('.mw-personal-goal');await panel.waitFor({state:'visible'});await panel.scrollIntoViewIfNeeded();return panel;
}
function latestAnchor(history){return[...history].reverse().find(run=>{
  const d=normalizeRunDetails(run.details),c=comparableRunContext(d);
  return run.outcome==='victory'&&c?.route.kind==='dungeon'&&c.route.id==='glass_garden'&&c.route.depth==='standard'
    &&!c.route.conquestId&&!c.route.riftId&&c.heroId==='knight'&&c.control==='auto'
    &&d.timeSec!==null&&d.perfects!==null&&d.breaks!==null&&history.filter(other=>other.runId===run.runId).length===1;
});}
async function select(metric,anchor){
  const before=await state();await journal();
  const preview=page.locator(`[data-goal-run="${anchor.runId}"]`);await preview.click();
  const panel=page.locator('.mw-personal-goal');await panel.locator(`[data-personal-goal-metric="${metric}"]`).click();
  const after=await state(),expected=structuredClone(before.eco.masterworks);
  qaAssert(choosePersonalGoal(expected,anchor.runId,metric).ok&&equal(after.goal,expected.personalGoal),'Native metric selection differs from exact observed history context');
  qaAssert(equal(withoutGoal(before.eco),withoutGoal(after.eco)),'Goal selection changed profile/economy/history or rewarded/charged');
  const primary=JSON.parse(after.raw);qaAssert(equal(primary.masterworks.personalGoal,after.goal)&&equal(primary.masterworks.history,after.history),'Choice/history missing from actual native primary save');
  const capture=capturePersonalGoal(after.eco.masterworks);qaAssert(capture,'Observed anchor has no finite native baseline/target');
  qaAssert(await panel.locator(`[data-personal-goal-metric="${metric}"]`).getAttribute('aria-pressed')==='true','Actual saved metric is not pressed');
  const text=await panel.innerText();qaAssert(text.includes('최근 20개')&&text.includes(personalContextLabel(after.goal.context))&&text.includes(personalTargetLabel(capture))&&text.includes('에너지 4'),'Journal omits bounded history/condition/target/catalog cost');
  const summary=summarizePersonalRuns(after.history,after.goal.context);
  report.events.push({label:'native metric choice',metric,anchorRunId:anchor.runId,before,after,capture,summary,text});await qa.save();return after;
}
async function viewport(width,height,label){
  const before=await state();await page.setViewportSize({width,height});
  if(await page.locator('#btn-ignore-rotate').isVisible())await page.locator('#btn-ignore-rotate').click();
  await page.waitForTimeout(150);await page.evaluate(()=>window.app.renderer.render());
  const panel=await journal();await panel.scrollIntoViewIfNeeded();const after=await state();
  qaAssert(equal(before.eco,after.eco)&&before.run?.id===after.run?.id&&before.active===after.active,'Native resize/render changed game state');
  await page.screenshot({path:path.join(qa.out,`${label}.png`)});report.events.push({label:'actual responsive journal '+label,before,after,text:await panel.innerText()});await qa.save();
}
async function reload(label){
  if(await page.locator('.exp-result-shell').isVisible())await page.locator('.exp-close').click();
  if(await page.locator('#masterworks[open]').isVisible())await page.locator('#masterworks .mw-close').click();
  const before=await state();qaAssert(!before.active&&before.pending===null,`${label}: reload must follow actual saved result/lobby`);
  await qa.boot({reload:true});const after=await state();const transition=energyTransition(before,after,0,label);
  const a=structuredClone(before.eco),b=structuredClone(after.eco);delete a.energy;delete a.energyT;delete b.energy;delete b.energyT;
  qaAssert(equal(a,b)&&equal(after.goal,before.goal)&&equal(after.history,before.history)&&!after.active&&after.pending===null,`${label}: actual reload changed completed history/choice/progression`);
  report.events.push({label:'native reload '+label,before,after,energy:transition});report.coverage.nativeReload='observed';await qa.save();return after;
}
async function depart(before){
  const capture=capturePersonalGoal(before.eco.masterworks);qaAssert(capture&&before.energy>=4&&before.eco.journey.autoBattle===true,'Requires actual saved AUTO, goal baseline and four available energy');
  const row={index:report.runs.length+1,status:'running',before,capture,choices:[]};report.runs.push(row);await qa.save();
  const button=page.locator('[data-personal-goal-departure="dungeon"]');row.departureText=await button.innerText();qaAssert(row.departureText.includes('에너지 4')&&await button.isEnabled(),'Actual goal departure lacks correct price/enabled state');await button.click();
  await page.waitForFunction(()=>window.app.battle.active&&!window.app.stageStarting,null,{timeout:120000});row.started=await state();
  row.energyAdmission=energyTransition(before,row.started,4,'native goal departure');
  qaAssert(row.started.pending?.energy===4&&row.started.pending.id===before.eco.expedition.seq+1&&row.started.pending.target==='glass_garden'
    &&row.started.pending.depth==='standard'&&!row.started.pending.conquestId&&!row.started.pending.riftId
    &&row.started.heroId===before.heroId&&row.started.heroLevel===before.heroLevel&&row.started.auto===true
    &&equal(row.started.run.goal,capture)&&equal(row.started.history,before.history),'Existing authority did not admit exact unchanged route/hero/level/AUTO/ticket/frozen target');
  row.focus=await nativeGameplayFocus(page);report.coverage.paidDeparture='observed';await qa.save();return row;
}
async function complete(row){
  for(let chunk=0;chunk<180;chunk++){
    row.last=await page.evaluate(()=>{const a=window.app,b=a.battle;for(let frame=0;frame<600&&b.active&&!b.paused;frame++)a.step(1/60,frame%90===0);return{active:b.active,paused:b.paused,hp:b.player?.hp,elapsed:b.elapsed,win:b.result?.win,auto:b.player?.auto};});
    qaAssert(row.last.auto===true,'Native AUTO unexpectedly changed');
    if(row.last.paused){const button=page.locator('#masterworks[open] .mw-choices button:not([disabled]), #masterworks[open] .mw-story-choices button:not([disabled])').first();await button.waitFor({state:'visible'});row.choices.push({text:await button.innerText(),elapsed:row.last.elapsed});await button.click();}
    if(!row.last.active)break;if(chunk%12===0)await qa.save();if(chunk===179)throw Error('Bounded natural AUTO did not finish');
  }
  qaAssert(row.last.win===true&&row.last.hp>0,'Actual AUTO defeat preserved; never manufacture goal success');
  for(let chunk=0;chunk<20&&!await page.locator('.exp-result-shell').isVisible();chunk++)await page.evaluate(()=>{for(let frame=0;frame<120&&!window.app.expeditionUI.result;frame++)window.app.step(1/60,frame===119);});
  await page.locator('.exp-result-shell').waitFor({state:'visible'});row.after=await state();const after=row.after,record=after.history.at(-1);row.record=record;
  qaAssert(after.result?.win===true&&!after.result.saveError&&after.terminal.paid&&!after.dirty&&after.pending===null,'Actual goal run settlement/history failed');
  const expectedDetails=normalizeRunDetails({...row.started.run.context,control:after.run.controlSeen===1?'manual':after.run.controlSeen===2?'auto':after.run.controlSeen===3?'mixed':'unknown',timeSec:after.terminal.time,perfects:after.run.perfects,breaks:after.run.breaks});
  qaAssert(record.runId===row.started.run.id&&record.outcome==='victory'&&equal(record.details,expectedDetails)
    &&equal(after.history.slice(0,-1),row.before.history.slice(-19)),'Terminal history does not match actual original time/control/perfect/BREAK or appended rolling window');
  const expected=evaluatePersonalGoal(row.capture,expectedDetails,'victory');row.expectedGoal=expected;
  qaAssert(equal(after.terminal.goal,expected),'Actual result does not evaluate the captured departure target and exact observed terminal conditions');
  const resultText=await page.locator('[aria-label="이번 출격의 개인 목표"]').innerText();row.resultText=resultText;qaAssert(resultText===personalResultLabel(expected),'Visible result is not the actual goal outcome');
  const catalog=DUNGEONS.find(d=>d.id==='glass_garden'),xpEarned=applyFrontierRewards(catalog.rewards,row.started.pending.frontier).xp;
  let level=row.before.eco.expedition.level,xp=row.before.eco.expedition.xp+xpEarned;while(level<50&&xp>=accountLevelXp(level)){xp-=accountLevelXp(level);level++;}if(level===50)xp=Math.min(xp,accountLevelXp(50));
  const stats={...row.before.eco.expedition.stats,glass_garden:row.before.eco.expedition.stats.glass_garden+1,dungeonWins:row.before.eco.expedition.stats.dungeonWins+1};
  qaAssert(after.terminal.receipt.rewards.xp===xpEarned&&after.eco.expedition.level===level&&after.eco.expedition.xp===xp
    &&after.eco.expedition.seq===row.before.eco.expedition.seq+1&&equal(after.eco.expedition.stats,stats)
    &&equal(after.eco.expedition.claimed,row.before.eco.expedition.claimed)&&equal(after.goal,row.before.goal)
    &&equal(after.eco.purchases,row.before.eco.purchases)&&after.eco.spentKRW===row.before.eco.spentKRW,'Goal changed normal reward/ticket/stats/choice or made purchases');
  row.normalReward={xpEarned,level,xp};
  if(expected.eligible)report.coverage.eligibleResult='observed';else report.coverage.conditionMismatch='observed';
  if(expected.achieved)report.coverage.achievement='observed';
  await qa.captureMedia(`personal-goal-result-${row.index}`);await page.screenshot({path:path.join(qa.out,`goal-result-${row.index}.png`)});row.status='pass';await qa.save();
}
try{
  page=await qa.start({viewport:{width:1200,height:800}});
  await page.addInitScript(raw=>{if(!sessionStorage.getItem('personal-goals-qa-save-installed')){localStorage.setItem('bladesurge_save_v1',raw);sessionStorage.setItem('personal-goals-qa-save-installed','1');}},rawSave);
  await qa.boot();report.initial=await state();qaAssert(report.initial.heroId==='knight'&&report.initial.eco.journey.autoBattle===true&&report.initial.pending===null&&equal(report.initial.history,saved.masterworks.history),'Boot differs from exact earned native history/AUTO/hero');
  const initialAnchor=latestAnchor(report.initial.history);qaAssert(initialAnchor,'Native earned source has no fully observed AUTO victory');
  for(const metric of ['time','perfects','breaks'])await select(metric,initialAnchor);report.coverage.metricChoices='observed';
  await viewport(390,844,'journal-portrait');await viewport(1200,800,'journal-desktop');await reload('saved metric selection');
  for(let index=0;index<maxRuns;index++){
    const current=await state(),anchor=latestAnchor(current.history);qaAssert(anchor,'No actual recent native victory anchor');
    const before=await select('breaks',anchor),row=await depart(before);await complete(row);row.afterReload=await reload(`paid goal run ${row.index}`);
    await journal();const panel=page.locator('.mw-personal-goal');await panel.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(qa.out,`goal-journal-reload-${row.index}.png`)});await qa.save();
    if(report.coverage.eligibleResult==='observed')break;
    if(index===maxRuns-1)throw Error('No same-start-level/control comparison arose naturally within bounded runs; preserve NOT_OBSERVED, do not alter hero level');
  }
  report.final=await state();qaAssert(report.coverage.eligibleResult==='observed'&&report.final.pending===null&&!report.final.active,'Required real same-condition result/reload is missing');
  await qa.finishObservations();await qa.close();report.status='pass';
}catch(error){report.status='fail';report.failure=String(error?.stack||error);process.exitCode=1;}
finally{try{await qa.close();}catch(error){report.status='fail';report.cleanupFailure=String(error?.stack||error);process.exitCode=1;}report.finished=new Date().toISOString();await qa.save();}
console.log(JSON.stringify({status:report.status,out:qa.out,coverage:report.coverage,releaseApproved:false,failure:report.failure,cleanupFailure:report.cleanupFailure}));
