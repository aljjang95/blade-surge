// 배포용 빌드에서 실제 입력과 별도로 명시한 전투 fixture를 검증한다.
import { chromium } from 'playwright';
import { preview } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { launchOpts } from './chrome.mjs';
import { installMetricsDriver } from './metrics-driver.mjs';
import { STORY_EVENTS } from '../src/data/masterworks.js';
import { FIELD_DUNGEONS } from '../src/data/open-fields.js';

const root=path.resolve(import.meta.dirname,'..'),get=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const out=get('out'),expected=get('expected-sha'),git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim(),appCap=24;
if(!out||!path.isAbsolute(out))throw Error('새 절대 경로 --out 필요');
await fs.mkdir(out);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const versionBytes=await fs.readFile(path.join(root,'dist/version.json')),version=JSON.parse(versionBytes);
if(expected&&(git(['rev-parse','HEAD'])!==expected||git(['status','--porcelain'])||version.sha!==expected||version.dirty))throw Error('정확한 clean 빌드가 필요합니다.');
const files=['src/data/open-fields.js','src/data/expedition-routes.js','src/game/open-field-scene.js','src/game/expedition-combat.js','src/game/expedition-economy.js','src/game/crowd-gather.js','src/game/player.js','src/game/enemies.js','src/game/actor.js','src/game/combat-motion.js','src/game/combat-contact.js','src/engine/audio.js','src/game/run-history.js','src/game/journey-core.js','src/expansion/hub.jsx','tools/open-fields-qa.mjs'];
const report={status:'RUNNING',startedAt:new Date().toISOString(),head:git(['rev-parse','HEAD']),build:version,expectedSha:expected||null,
  scope:'Compiled local production preview in isolated fresh storage, software WebGL. UI and initial manual segment use native Playwright pointer/keyboard with natural RAF and read-only app observation. Later four full clears use a disclosed Lv10/one-star knight fixture, existing starter gear, refilled entry energy, AUTO and deterministic 1/60s stepping/first earned boon. No HP, damage, enemy position, invulnerability, victory or reward injection during those clears. Not physical-device performance, tactile evaluation, human playtest or live deployment.',
  sources:{},checks:[],ui:[],native:[],runs:[],screenshots:[],errors:[],warnings:[],failedRequests:[],httpErrors:[]};
for(const f of files)report.sources[f]=sha256(await fs.readFile(path.join(root,f)));
await fs.copyFile(import.meta.filename,path.join(out,'driver.mjs'));
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
const check=(ok,name,evidence)=>{report.checks.push({status:ok?'PASS':'FAIL',name,evidence});if(!ok)throw Error(name);};
let server,browser,page;
const sample=async label=>{const s=await page.evaluate(()=>{const a=window.app,b=a.battle,p=b.player,alive=b.enemies.filter(e=>e.alive);return {mode:a.mode,active:b.active,paused:b.paused,testPause:!!a.testPause,elapsed:b.elapsed,kills:b.kills,roomCount:b.world?.rooms.length,held:a.input.attackHeld,
  player:p?{auto:p.auto,state:p.state,comboIdx:p.comboIdx,hp:p.hp,mp:p.mp,cds:[...p.cds],dodgeCd:p.dodgeCd,pos:p.pos.toArray(),pose:p.motionRoot?.rotation.toArray().slice(0,3)}:null,
  nearest:p?Math.min(Infinity,...alive.map(e=>e.pos.distanceTo(p.pos))):null,alive:alive.length};});report.native.push({label,...s});return s;};
const shot=async name=>{await page.screenshot({path:path.join(out,name+'.png'),timeout:90000});report.screenshots.push(name+'.png');};
const focus=()=>page.locator('#gl').focus();
const rotate=async()=>{if(await page.locator('#btn-ignore-rotate').isVisible())await page.locator('#btn-ignore-rotate').click();};
const waitSample=async(predicate,label,ms=15000)=>{const until=Date.now()+ms;let s;do{s=await sample(label);if(predicate(s))return s;await page.waitForTimeout(180);}while(Date.now()<until);throw Error(label+' 관측 시간 초과 '+JSON.stringify(s));};
try {
  server=await preview({root,configFile:false,logLevel:'error',preview:{host:'127.0.0.1',port:0}});
  const origin=`http://127.0.0.1:${server.httpServer.address().port}`;report.origin=origin;
  check(sha256(Buffer.from(await(await fetch(origin+'/version.json')).arrayBuffer()))===sha256(versionBytes),'동일 배포용 빌드',version);
  browser=await chromium.launch(launchOpts());report.browser=browser.version();
  const context=await browser.newContext({viewport:{width:880,height:400},hasTouch:true,serviceWorkers:'block'});
  check((await context.storageState()).origins.length===0,'격리된 초기 저장소',{});
  await context.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
  page=await context.newPage();page.setDefaultTimeout(60000);
  page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());else if(m.type()==='warning')report.warnings.push(m.text());});
  page.on('requestfailed',r=>report.failedRequests.push({url:r.url(),type:r.resourceType(),error:r.failure()?.errorText}));
  page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({url:r.url(),status:r.status()});});
  const fontDir=get('font-dir')||'/tmp/blade-qa-fonts/node_modules/@fontsource/noto-sans-kr/files';
  const fonts=await Promise.all([400,700].map(async weight=>({family:'Noto Sans KR',weight,data:(await fs.readFile(path.join(fontDir,`noto-sans-kr-korean-${weight}-normal.woff2`))).toString('base64')})));
  await page.addInitScript(fonts=>{window.__qaFonts=Promise.all(fonts.map(async({family,weight,data})=>{const f=new FontFace(family,`url(data:font/woff2;base64,${data})`,{weight:String(weight)});await f.load();document.fonts.add(f);}));},fonts);
  report.fontFixture='Local Korean font faces and optional external Google CSS fulfilled empty for this isolated QA only; product assets unchanged.';
  await page.goto(origin,{waitUntil:'domcontentloaded',timeout:120000});await rotate();await page.evaluate(()=>window.__qaFonts);
  await page.locator('#boot-start:not(.hidden)').waitFor({state:'visible',timeout:180000});await page.locator('#boot-start').click();
  await page.waitForFunction(()=>window.app?.mode==='lobby'&&!document.querySelector('#boot.show'),null,{timeout:90000});
  for(let i=0;i<8;i++){if(await page.locator('#modal.show #m-cancel').isVisible())await page.locator('#m-cancel').click();await page.waitForTimeout(200);}
  await page.locator('#citadel-command-fields').click();
  for(const viewport of [{width:360,height:800},{width:390,height:844},{width:1440,height:900}]) {
    await page.setViewportSize(viewport);await rotate();const rows=[];
    for(const d of FIELD_DUNGEONS){const card=page.locator(`.exp-dungeon[data-depth="fields"][data-dungeon="${d.id}"]`),button=card.locator('.exp-primary');await button.scrollIntoViewIfNeeded();await card.locator('.exp-dungeon-art > img').evaluate(e=>e.decode());
      const v=await button.evaluate(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);const img=e.closest('article').querySelector('.exp-dungeon-art img');return {height:r.height,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,hit:hit===e||e.contains(hit),disabled:e.disabled,overflow:document.documentElement.scrollWidth>innerWidth+1,image:img.complete&&img.naturalWidth>0};});
      check(!v.disabled&&v.height>=44&&v.inside&&v.hit&&!v.overflow&&v.image,`${viewport.width}px ${d.name} 출격·카드 이미지`,v);rows.push({id:d.id,...v});}
    report.ui.push({viewport,rows});await page.locator('.exp-dungeon').first().scrollIntoViewIfNeeded();await shot('fields-'+viewport.width);await save();
  }
  await page.setViewportSize({width:880,height:400});await page.locator('.exp-dungeon[data-dungeon="windmeadow"] .exp-primary').click();
  await page.waitForFunction(()=>app.mode==='battle'&&app.battle.active&&!app.stageStarting);
  check(!(await sample('native-entry')).testPause,'자연 RAF 필드 출격',{});
  if(!(await sample('auto-before')).player.auto)await page.locator('#btn-auto').click();
  await waitSample(s=>s.nearest<=4&&s.alive>=3,'native-auto-approach',120000);
  await page.locator('#btn-auto').click();await focus();const before=await sample('native-manual-start');
  let attacks=0,skills=false,dodged=false;
  for(let i=0;i<10;i++){await page.keyboard.press('Space',{delay:40});const s=await sample('native-attack-'+i);if(s.player.state==='attack')attacks++;await page.waitForTimeout(220);}
  await waitSample(s=>['idle','move'].includes(s.player.state),'native-skill-window');
  await page.keyboard.press('1',{delay:40});const sk=await waitSample(s=>s.player.cds[0]>0,'native-skill');skills=sk.player.cds[0]>0;
  await waitSample(s=>['idle','move'].includes(s.player.state),'native-dodge-window');
  await page.keyboard.down('a');await page.keyboard.press('ShiftLeft',{delay:40});const dodge=await waitSample(s=>s.player.dodgeCd>0,'native-dodge');dodged=dodge.player.dodgeCd>0;await page.waitForTimeout(300);await page.keyboard.up('a');
  check(attacks>0&&skills&&dodged,'실제 공격·스킬·회피 입력',{attacks,skills,dodged,before,after:await sample('native-manual-end')});
  await shot('warrior-meadow-native');await page.locator('#btn-pause').click();const paused=await sample('native-paused');await page.waitForTimeout(1200);const still=await sample('native-pause-wall-time');
  check(still.paused&&still.elapsed===paused.elapsed&&!still.held,'일시정지 입력·전투 정지',{paused,still});
  await page.locator('#btn-resume').click();await focus();await page.keyboard.press('Space',{delay:40});await waitSample(s=>s.elapsed>still.elapsed&&!s.paused,'native-resumed');
  check(report.native.every(s=>!s.testPause),'자연 입력 구간에 fixture 시계 없음',{});
  await page.locator('#btn-pause').click();await page.locator('#btn-giveup').click();await page.locator('.exp-result-shell .exp-close').click();await page.waitForFunction(()=>app.mode==='lobby');

  for(const d of FIELD_DUNGEONS) {
    const fixture=await page.evaluate(()=>{const a=app;a.testPause=true;a.ui.closeModal();const h=a.eco.hero('knight');h.level=10;h.star=1;h.skills=h.skills.map(()=>1);h.exp=0;a.eco.s.selected='knight';a.eco.s.energy=a.eco.energyMax;a.eco.s.energyT=Date.now();a.journey.s.autoBattle=true;a.eco.save();a.expeditionUI.open('dungeons',{depth:'fields'});return {hero:structuredClone(h),energy:a.eco.s.energy,wins:{...a.expedition.s.stats},materials:{...a.expedition.s.materials}};});
    const run={id:d.id,field:d.field,fixture};report.runs.push(run);await save();
    await page.locator(`.exp-dungeon[data-dungeon="${d.id}"] .exp-primary`).click();await page.waitForFunction(()=>app.mode==='battle'&&app.battle.active&&!app.stageStarting);
    run.entry=await page.evaluate(()=>{const a=app,b=a.battle;a.__qaTicket=structuredClone(a.expeditionTicket);const mesh=b.arena.fieldScene;let n=0;const counts=[];mesh.traverse(o=>{if(o.isMesh)for(const resource of [o.geometry,o.material]){const row={name:o.name,n:0};counts.push(row);resource.addEventListener('dispose',()=>row.n++);n++;}});a.__qaFieldResources=counts;return {field:b.stage.field,energy:a.eco.s.energy,rooms:b.world.rooms.length,sealed:b.world.sealed,resources:n,surface:mesh.userData.surface};});
    check(run.entry.field===d.field&&run.entry.energy===fixture.energy-4&&run.entry.sealed,`${d.name} 지형·요금·봉인`,run.entry);
    await page.evaluate(installMetricsDriver,{storyEvents:STORY_EVENTS.map(({id,choices})=>({id,choices:choices.map(({id})=>({id}))}))});
    for(let chunk=0;chunk<60;chunk++) {
      run.last=await page.evaluate(()=>{const a=app,b=a.battle;let peak=0;for(let i=0;i<600&&b.active;i++){window.__metricsDriver.step(1/60,false);peak=Math.max(peak,b.enemies.filter(e=>e.alive).length);}return {active:b.active,win:b.result?.win,time:b.elapsed,kills:b.kills,hp:b.player.hp,rooms:b.roomsCleared,sealed:b.world.sealed,peak,boss:!!b.boss,allWalkable:b.enemies.filter(e=>e.alive).every(e=>b.world.walkable(e.pos.x,e.pos.z))};});
      check(run.last.allWalkable&&run.last.peak<=appCap,`${d.name} 이동 충돌·군중 상한 ${chunk}`,run.last);
      if(chunk===0){await page.evaluate(()=>app.step(.001,true));await shot(d.field+'-combat');}
      if(run.last.boss&&!run.bossCaptured){await page.evaluate(()=>app.step(.001,true));await shot(d.field+'-boss');run.bossCaptured=true;}
      if(!run.last.active)break;
    }
    await page.evaluate(()=>{for(let i=0;i<120;i++)app.step(1/60,false);});
    run.result=await page.evaluate(()=>{const a=app,b=a.battle;const paid=structuredClone(a.eco.s);const duplicate=a.expedition.settle(a.__qaTicket,{win:true});return {result:a.expeditionUI.result,rooms:b.world.rooms.map(r=>({id:r.id,cleared:r.cleared,type:r.type})),pending:a.expedition.s.pending,wins:a.expedition.s.stats[b.stage.expedition.id],duplicate:duplicate.ok,duplicateUnchanged:JSON.stringify(paid)===JSON.stringify(a.eco.s),history:a.masterworks?.s?.history?.at(-1)?.details||a.eco.s.masterworks?.history?.at(-1)?.details};});
    check(run.last.win===true&&run.result.result?.win&&!run.result.result.saveError&&run.result.rooms.every(r=>r.cleared)&&!run.last.sealed,`${d.name} 실제 보스 처치·전체 정화`,run.result);
    check(run.result.pending===null&&run.result.wins===fixture.wins[d.id]+1&&!run.result.duplicate&&run.result.duplicateUnchanged&&run.result.history?.route?.id===d.id,`${d.name} 한 번만 보상 정산·출격 기록`,run.result);
    await shot(d.field+'-result');await page.locator('.exp-result-shell .exp-close').click();
    const disposal=await page.evaluate(()=>({counts:app.__qaFieldResources,active:app.battle.active,held:app.input.attackHeld,fieldScene:!!app.battle.arena.fieldScene}));
    check(disposal.counts.every(row=>row.n===1)&&!disposal.active&&!disposal.held&&!disposal.fieldScene,`${d.name} 재출격 자원 회수`,disposal);run.disposal=disposal;await save();
  }
  check(report.errors.length===0&&report.failedRequests.length===0&&report.httpErrors.length===0,'실행 오류·실패한 애플리케이션 요청 없음',{errors:report.errors,failedRequests:report.failedRequests,httpErrors:report.httpErrors});
  for(const [f,hash]of Object.entries(report.sources))check(sha256(await fs.readFile(path.join(root,f)))===hash,'실행 중 소스 고정 '+f,{});
  check(sha256(await fs.readFile(path.join(root,'dist/version.json')))===sha256(versionBytes),'실행 중 배포용 빌드 고정',{});
  report.status='PASS';
} catch(e){report.status='FAIL';report.failure=String(e.stack||e);if(page)await shot('failure').catch(()=>{});process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await save();await browser?.close();await new Promise(resolve=>server?server.httpServer.close(resolve):resolve());console.log(JSON.stringify({status:report.status,out,failure:report.failure}));}
