import { chromium, devices } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const target=new URL(process.argv.find(x=>x.startsWith('--url='))?.slice(6)||'http://127.0.0.1:5225');
if(!['localhost','127.0.0.1'].includes(target.hostname)||!['http:','https:'].includes(target.protocol)||target.username||target.password)throw Error('localhost only');
const out='work/pwa-party-final.json',dir='work/pwa-party-final.artifacts';await mkdir(dir,{recursive:true});
const report={started:new Date().toISOString(),target:target.href,scope:'Four real isolated browser contexts, local Chromium engine, real server/WebSockets; no state/stat/clock/layout fixtures; not physical-device certification',clients:[],layouts:[],status:'running'};
const save=()=>writeFile(out,JSON.stringify(report,null,2));const assert=(v,m)=>{if(!v)throw Error(m);};
const browser=await chromium.launch();report.browserVersion=browser.version();const contexts=[],pages=[];
async function tap(p,l){await l.scrollIntoViewIfNeeded();await l.tap();}
async function ignore(p){if(await p.locator('#btn-ignore-rotate').isVisible())await p.locator('#btn-ignore-rotate').tap();}
try{
 report.build=await(await fetch(new URL('/version.json',target))).json();
 for(let i=0;i<4;i++){
  const c=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2,userAgent:devices['Pixel 7'].userAgent});contexts.push(c);const p=await c.newPage();pages.push(p);p.setDefaultTimeout(20000);
  const record={name:`긴이름협동원정모험가테스트${i+1}`,consoleErrors:[],pageErrors:[],webSockets:[]};report.clients.push(record);
  p.on('console',m=>{if(m.type()==='error')record.consoleErrors.push(m.text());});p.on('pageerror',e=>record.pageErrors.push(String(e)));p.on('websocket',ws=>{const w={url:ws.url().replace(/([?&]ticket=)[^&]+/,'$1[redacted]'),sent:0,received:0};record.webSockets.push(w);ws.on('framesent',()=>w.sent++);ws.on('framereceived',()=>w.received++);});
  await p.goto(target.href,{waitUntil:'domcontentloaded',timeout:120000});await ignore(p);await p.locator('#boot-start:not(.hidden)').waitFor({timeout:180000});await p.locator('#boot-start').tap();await p.waitForFunction(()=>window.app?.mode==='lobby'&&!document.querySelector('#boot.show'),null,{timeout:120000});await p.waitForTimeout(700);
  for(let n=0;n<4;n++){const close=p.locator('#modal.show #m-cancel');if(!await close.isVisible())break;await close.click();}
  await tap(p,p.locator('#party-open'));await p.getByLabel('모험가 이름',{exact:true}).fill(record.name);const select=p.getByLabel('파티 영웅',{exact:true});record.hero=await select.locator('option').nth(i).getAttribute('value');await select.selectOption(record.hero);
  console.log(`client ${i+1} booted`);
 }
 for(let i=0;i<pages.length;i++){
  const p=pages[i];
  if(i===0){await tap(p,p.getByRole('button',{name:'파티 만들기',exact:true}));await p.getByLabel('파티 초대 코드',{exact:true}).waitFor();report.code=await p.getByLabel('파티 초대 코드',{exact:true}).inputValue();}
  else {await p.getByLabel('초대 코드',{exact:true}).fill(report.code);await tap(p,p.getByRole('button',{name:'파티 참가',exact:true}));await p.getByLabel('파티 초대 코드',{exact:true}).waitFor();}
  console.log(`client ${i+1} joined`);await save();
 }
 for(const p of pages){await p.waitForFunction(()=>document.querySelectorAll('.party-members li').length===4);await tap(p,p.getByRole('button',{name:'준비 완료',exact:true}));}
 await pages[0].getByRole('button',{name:'함께 출격',exact:true}).waitFor();await tap(pages[0],pages[0].getByRole('button',{name:'함께 출격',exact:true}));
 for(const p of pages)await p.waitForFunction(()=>document.querySelectorAll('.party-hud:not([hidden]) .party-chip').length===4,null,{timeout:60000});
 console.log('four clients entered');
 for(const size of [{width:320,height:568},{width:390,height:844},{width:667,height:375}]){
  for(let i=0;i<pages.length;i++){
   const p=pages[i];await p.setViewportSize(size);await p.waitForTimeout(200);await ignore(p);
   const layout=await p.evaluate(()=>{
    const controls=['#battle-camera-controls','#btn-attack','#btn-dodge',...Array.from({length:6},(_,i)=>`.skill-btn[data-skill="${i}"]`)];
    const box=(e,id)=>{const r=e.getBoundingClientRect();return {id,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,inside:r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1};};
    const chips=[...document.querySelectorAll('.party-chip')].map((e,i)=>({...box(e,`chip${i}`),name:e.querySelector('span').textContent,ellipsis:getComputedStyle(e.querySelector('span')).textOverflow}));const buttons=controls.map(s=>box(document.querySelector(s),s));const overlaps=[];
    for(const a of chips)for(const b of [...chips,...buttons])if(a.id!==b.id&&Math.min(a.right,b.right)-Math.max(a.x,b.x)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1)overlaps.push([a.id,b.id]);
    return {chips,buttons,overlaps,mode:window.app.mode,hudHidden:document.querySelector('.party-hud').hidden};
   });
   layout.client=i;layout.viewport=size;report.layouts.push(layout);await p.screenshot({path:`${dir}/${i}-${size.width}x${size.height}.png`});await save();assert(layout.chips.length===4&&!layout.hudHidden,'four HUD chips required');assert(layout.chips.every(c=>c.inside),'chip clipping');assert(!layout.overlaps.length,'HUD overlaps '+JSON.stringify(layout.overlaps));
  }
  console.log(`${size.width}x${size.height}: four clients geometry pass`);
 }
 assert(report.clients.every(c=>!c.consoleErrors.length&&!c.pageErrors.length),'client console/page errors');assert(report.clients.every(c=>c.webSockets.some(w=>w.sent>0&&w.received>0)),'real WebSocket traffic required');report.status='pass';
}catch(e){report.status='fail';report.error=String(e.stack||e);for(let i=0;i<pages.length;i++){try{await pages[i].screenshot({path:`${dir}/failure-${i}.png`});report.clients[i].failureText=await pages[i].locator('body').innerText();}catch{}}}
finally{await browser.close();report.finished=new Date().toISOString();await save();const hash=createHash('sha256').update(await readFile(out)).digest('hex');await writeFile(out+'.sha256',hash+'\n');console.log(JSON.stringify({out,status:report.status,sha256:hash,error:report.error}));process.exitCode=report.status==='pass'?0:1;}
