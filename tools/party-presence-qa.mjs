// Local real-browser/server regression. Only network frames are fault-injected.
import { chromium, devices } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const url=new URL(process.argv.find(a=>a.startsWith('--url='))?.slice(6)||'http://127.0.0.1:5225');
if(!['localhost','127.0.0.1'].includes(url.hostname)||!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Credential-free localhost only');
const out='work/party-presence-final.json',dir='work/party-presence-final.artifacts';await mkdir(dir,{recursive:true});
const report={started:new Date().toISOString(),url:url.href,scope:'Two isolated local Chromium contexts; real UI and real server WebSockets. No game-state/stat/clock/layout fixtures. Explicit routed frame drops, not physical-network/device certification.',checks:[],clients:[],status:'running'};
const save=()=>writeFile(out,JSON.stringify(report,null,2)+'\n');
const assert=(v,s)=>{if(!v)throw Error(s);};const redact=s=>String(s).replace(/([?&]ticket=)[^&'"\s]+/g,'$1[redacted]');
const browser=await chromium.launch();report.browserVersion=browser.version();const contexts=[];
async function check(name,fn){const c={name,status:'running'};report.checks.push(c);await save();try{c.evidence=await fn();c.status='pass';}catch(e){c.status='fail';c.error=redact(e.stack||e);throw e;}finally{await save();console.log(name+': '+c.status);}}
async function tap(p,locator){await locator.tap();}
async function ignore(p){if(await p.locator('#btn-ignore-rotate').isVisible())await p.locator('#btn-ignore-rotate').tap();}
const state=p=>p.evaluate(()=>({mode:window.app?.mode,elapsed:window.app?.battle?.elapsed,finishing:window.app?.party?.finishing,ready:window.app?.party?.ready,status:window.app?.party?.connectionStatus(),text:document.querySelector('.party-presence')?.textContent,noticeHidden:document.querySelector('.party-presence')?.hidden,partyStatus:window.app?.party?.party?.status,hidden:document.hidden}));
async function pair(label){
 const pages=[],records=[];
 for(let i=0;i<2;i++){
  const c=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2,userAgent:devices['Pixel 7'].userAgent});contexts.push(c);
  const r={label,player:i,consoleErrors:[],pageErrors:[],frames:{sent:{},received:{},dropped:{}},close:[],fault:'none'};records.push(r);report.clients.push(r);
  await c.routeWebSocket('**/api/party/**',ws=>{
   const remote=ws.connectToServer();r.socketUrl=redact(ws.url());
   const kind=m=>{try{return JSON.parse(String(m)).type||'unknown';}catch{return 'unparsed';}};
   ws.onMessage(m=>{const k=kind(m);r.frames.sent[k]=(r.frames.sent[k]||0)+1;remote.send(m);});
   remote.onMessage(m=>{const k=kind(m);r.frames.received[k]=(r.frames.received[k]||0)+1;if(r.fault==='all'||r.fault==='snapshots'&&k==='snapshot'){r.frames.dropped[k]=(r.frames.dropped[k]||0)+1;return;}ws.send(m);});
   ws.onClose((code,reason)=>{r.close.push({side:'client',code,reason});remote.close({code,reason});});
   remote.onClose((code,reason)=>{r.close.push({side:'server',code,reason});ws.close({code,reason});});
  });
  const p=await c.newPage();pages.push(p);p.setDefaultTimeout(30000);
  p.on('console',m=>{if(m.type()==='error')r.consoleErrors.push(redact(m.text()));});p.on('pageerror',e=>r.pageErrors.push(redact(e)));
  await p.goto(url.href,{waitUntil:'domcontentloaded',timeout:120000});await ignore(p);await p.locator('#boot-start:not(.hidden)').waitFor({timeout:180000});await p.locator('#boot-start').tap();await p.waitForFunction(()=>window.app?.mode==='lobby'&&!document.querySelector('#boot.show'),null,{timeout:120000});await p.waitForTimeout(800);
  for(let n=0;n<4;n++){const close=p.locator('#modal.show #m-cancel');if(!await close.isVisible())break;await close.click();}
  await tap(p,p.locator('#party-open'));await p.getByLabel('모험가 이름',{exact:true}).fill(`연결확인긴이름모험가${i+1}`);await p.getByLabel('파티 영웅',{exact:true}).selectOption(i?'mage':'knight');console.log(label+' player '+i+' booted');
 }
 const [host,guest]=pages;await tap(host,host.getByRole('button',{name:'파티 만들기',exact:true}));await host.getByLabel('파티 초대 코드',{exact:true}).waitFor();const code=await host.getByLabel('파티 초대 코드',{exact:true}).inputValue();await guest.getByLabel('초대 코드',{exact:true}).fill(code);await tap(guest,guest.getByRole('button',{name:'파티 참가',exact:true}));
 for(const p of pages)await p.waitForFunction(()=>document.querySelectorAll('.party-members li').length===2);
 return {pages,records,host,guest};
}
async function start(pair){for(const p of pair.pages)await tap(p,p.getByRole('button',{name:'준비 완료',exact:true}));await tap(pair.host,pair.host.getByRole('button',{name:'함께 출격',exact:true}));for(const p of pair.pages)await p.waitForFunction(()=>window.app?.party?.ready&&document.querySelectorAll('.party-hud:not([hidden]) .party-chip').length===2,null,{timeout:120000});}
async function noticeGeometry(p,label){const d=await p.evaluate(()=>{
 const box=(e,id)=>{const r=e.getBoundingClientRect();return {id,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,inside:r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1};};
 const labels=[...document.querySelectorAll('.party-chip'),document.querySelector('.party-presence')].map((e,i)=>box(e,'presence-'+i));const controls=['#battle-camera-controls','#btn-attack','#btn-dodge',...Array.from({length:6},(_,i)=>`.skill-btn[data-skill="${i}"]`)].map(s=>box(document.querySelector(s),s));const overlaps=[];
 for(let i=0;i<labels.length;i++)for(const b of [...labels.slice(i+1),...controls]){const a=labels[i];if(Math.min(a.right,b.right)-Math.max(a.x,b.x)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1)overlaps.push([a.id,b.id]);}return {labels,controls,overlaps};
 });await p.screenshot({path:`${dir}/${label}.png`});assert(d.labels.length===3&&d.labels.every(b=>b.inside&&b.height>0),'Presence/HP clipped or missing: '+JSON.stringify(d));assert(!d.overlaps.length,'Presence/HP overlap: '+JSON.stringify(d));return d;}
try{
 report.build=await(await fetch(new URL('/version.json',url))).json();
 const first=await pair('host-snapshot');
 if(process.argv.includes('--skip-idle'))report.idleScope='Not repeated in this run; inspect the separately preserved prior idle evidence';
 else await check('lobby-idle-over-three-minutes-real-ping-pong',async()=>{const begun=Date.now();const samples=[];while(Date.now()-begun<181000){await first.host.waitForTimeout(Math.min(30000,181000-(Date.now()-begun)));samples.push(await Promise.all(first.pages.map(state)));await save();console.log('idle seconds '+Math.round((Date.now()-begun)/1000));}assert(samples.every(s=>s.every(x=>x.partyStatus==='lobby'&&!x.finishing)),'Idle party disconnected');assert(first.records.every(r=>r.frames.sent.ping>=30&&r.frames.received.pong>=30),'Actual recurring ping/pong missing');return {durationMs:Date.now()-begun,samples,frames:structuredClone(first.records.map(r=>r.frames))};});
 await start(first);
 await check('host-pause-guest-notice-clock-and-layout',async()=>{await first.host.locator('#btn-pause').tap();await first.guest.waitForFunction(()=>window.app.party.connectionStatus().kind==='host-paused');await first.guest.waitForTimeout(500);const before=await state(first.guest);await first.guest.waitForTimeout(1200);const after=await state(first.guest);assert(Math.abs(after.elapsed-before.elapsed)<.01,'Guest clock advances during host pause');const layouts=[];for(const viewport of [{width:320,height:568},{width:390,height:844},{width:667,height:375}]){await first.guest.setViewportSize(viewport);await first.guest.waitForTimeout(300);await ignore(first.guest);layouts.push({viewport,...await noticeGeometry(first.guest,`paused-${viewport.width}`)});}return {before,after,layouts};});
 await check('host-resume-guest-clock',async()=>{const before=await state(first.guest);await first.host.locator('#btn-resume').tap();await first.guest.waitForFunction(t=>window.app.battle.elapsed>t+.2&&document.querySelector('.party-presence').hidden,before.elapsed);return {before,after:await state(first.guest)};});
 await check('snapshot-only-drop-pong-live-host-waiting-and-sixty-second-timeout',async()=>{
  // Keep host safely paused through real UI; its live paused snapshots will be dropped.
  await first.host.locator('#btn-pause').tap();await first.guest.waitForFunction(()=>window.app.party.connectionStatus().kind==='host-paused');const r=first.records[1],pong=r.frames.received.pong||0,began=Date.now();r.fault='snapshots';
  await first.guest.waitForFunction(()=>window.app.party.connectionStatus().kind==='host-waiting',null,{timeout:12000});const waitingMs=Date.now()-began,waiting=await state(first.guest);assert(waitingMs>=2000,'Host warning arrived too early');await noticeGeometry(first.guest,'snapshot-waiting');
  while(!(await state(first.guest)).finishing&&Date.now()-began<75000){await first.guest.waitForTimeout(1000);if(Math.floor((Date.now()-began)/1000)%20===0)console.log('snapshot fault seconds '+Math.round((Date.now()-began)/1000));}
  const ended=await state(first.guest),durationMs=Date.now()-began,text=await first.guest.locator('.party-dialog').innerText();assert(ended.finishing&&/60초/.test(text),'Host timeout result missing');assert(durationMs>=58000&&durationMs<75000,'Host timeout outside expected elapsed range');assert((r.frames.received.pong||0)-pong>=10,'Pong did not remain live during snapshot fault');assert(r.frames.dropped.snapshot>0,'No snapshot was actually dropped');return {fault:'server connection stays open; only guest inbound snapshot frames dropped',waitingMs,waiting,durationMs,ended,text,pongDelta:r.frames.received.pong-pong,dropped:structuredClone(r.frames.dropped)};
 });
 for(const p of first.pages)await p.context().close();
 const second=await pair('transport');await start(second);
 await check('fresh-party-all-inbound-drop-sixteen-second-transport-timeout',async()=>{await second.host.locator('#btn-pause').tap();await second.guest.waitForFunction(()=>window.app.party.connectionStatus().kind==='host-paused');const r=second.records[1],began=Date.now();r.fault='all';await second.guest.waitForFunction(()=>window.app.party.finishing,null,{timeout:25000});const durationMs=Date.now()-began,text=await second.guest.locator('.party-dialog').innerText();assert(durationMs>=14000&&durationMs<25000,'Transport timeout outside expected elapsed range');assert(/파티 서버의 응답이 없습니다/.test(text),'Transport timeout result missing');assert(r.frames.dropped.pong>0,'No pong actually dropped');await second.guest.screenshot({path:`dir/transport-ended.png`.replace('dir',dir)});return {fault:'all guest inbound frames dropped; actual server connection retained',durationMs,text,dropped:r.frames.dropped};});
 assert(report.clients.every(c=>!c.consoleErrors.length&&!c.pageErrors.length),'Console/page errors observed');report.status='pass';
}catch(e){report.status='fail';report.error=redact(e.stack||e);for(let i=0;i<contexts.length;i++)for(const p of contexts[i].pages())try{await p.screenshot({path:`${dir}/failure-${i}.png`});report.clients[i].failureState=await state(p);}catch{}}
finally{await browser.close();report.finished=new Date().toISOString();await save();const hash=createHash('sha256').update(await readFile(out)).digest('hex');await writeFile(out+'.sha256',hash+'\n');console.log(JSON.stringify({out,status:report.status,sha256:hash,error:report.error}));process.exitCode=report.status==='pass'?0:1;}
