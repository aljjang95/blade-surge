// Local project regression, not physical mobile browser/OS certification.
import { chromium, firefox, webkit, devices } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const target = new URL(process.argv.find(a=>a.startsWith('--url='))?.slice(6)||'http://127.0.0.1:5225/');
if (!['localhost','127.0.0.1'].includes(target.hostname)||target.username||target.password) throw Error('localhost only');
const out='work/app-screen-qa.json',dir='work/app-screen-qa.artifacts'; await mkdir(dir,{recursive:true});
const report={started:new Date().toISOString(),target:target.href,scope:'Local Chromium/Firefox/WebKit engines; real UI, fullscreen API and viewport changes. No installed-app or physical-device claim.',build:await(await fetch(new URL('/version.json',target))).json(),engines:[],status:'running'};
const save=()=>writeFile(out,JSON.stringify(report,null,2));const assert=(value,message)=>{if(!value)throw Error(message);};
for(const [engine,launcher] of Object.entries({chromium,firefox,webkit})){
 const browser=await launcher.launch(),r={engine,version:browser.version(),errors:[],layouts:[]};report.engines.push(r);
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:engine!=='firefox',deviceScaleFactor:2,userAgent:engine==='webkit'?devices['iPhone 13'].userAgent:devices['Pixel 7'].userAgent});
  const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>r.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')r.errors.push(m.text());});
  await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:120000});
  if(await page.locator('#btn-ignore-rotate').isVisible())await page.locator('#btn-ignore-rotate').tap();
  await page.locator('#boot-start:not(.hidden)').waitFor({timeout:180000});
  await page.locator('#app-mode-boot-install').tap();await page.locator('#app-mode-dialog[open]').waitFor();
  r.bootInstallGuide=await page.locator('#app-mode-guide').innerText();
  if(engine==='webkit')assert(r.bootInstallGuide.includes('웹 앱으로 열기'),'iPhone web-app toggle is missing');
  await page.locator('#app-mode-close').tap();
  assert(await page.locator('#app-mode-boot-install').evaluate(e=>document.activeElement===e),'Boot install focus did not return');
  r.bootFullscreenAvailable=await page.locator('#app-mode-boot-fullscreen').isVisible();
  if(r.bootFullscreenAvailable){
   await page.locator('#app-mode-boot-fullscreen').tap();await page.waitForTimeout(200);
   r.bootFullscreen=await page.evaluate(()=>!!document.fullscreenElement);
   if(!r.bootFullscreen){assert(await page.locator('#app-mode-dialog[open]').isVisible(),'Fullscreen failure lost its guide');await page.locator('#app-mode-close').tap();}
  }
  await page.screenshot({path:`${dir}/${engine}-boot.png`});await page.locator('#boot-start').tap();
  await page.waitForFunction(()=>window.app?.mode==='lobby'&&!document.querySelector('#boot.show'),null,{timeout:120000});await page.waitForTimeout(800);
  for(let n=0;n<4;n++){const close=page.locator('#modal.show #m-cancel');if(!await close.isVisible())break;await close.tap();}
  if(await page.evaluate(()=>!!document.fullscreenElement)){
   await page.locator('#app-mode-open').tap();await page.getByRole('button',{name:'전체 화면 끝내기',exact:true}).tap();
   await page.waitForFunction(()=>!document.fullscreenElement);
  }
  for(const size of [{width:320,height:568},{width:390,height:844},{width:667,height:375}]){
   await page.setViewportSize(size);await page.waitForTimeout(150);if(await page.locator('#btn-ignore-rotate').isVisible())await page.locator('#btn-ignore-rotate').tap();
   const layout=await page.evaluate(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const buttons=[...document.querySelectorAll('.lobby-left button')].map(e=>{const r=rect(e),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {...r,name:e.getAttribute('aria-label')||e.textContent,hit:hit===e||e.contains(hit),inside:r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1};});
    const neve=document.querySelector('.companion-lobby-launcher'),battle=document.querySelector('#btn-battle'),a=rect(neve),b=rect(battle);
    const caption=rect(document.querySelector('.lobby-hero-name')),goal=rect(document.querySelector('.journey-strip')),stage=rect(document.querySelector('#stage-pill'));
    const cameraElement=document.querySelector('#lobby-camera-toggle'),camera=rect(cameraElement),cameraHit=document.elementFromPoint(camera.x+camera.width/2,camera.y+camera.height/2);
    camera.hit=cameraHit===cameraElement||cameraElement.contains(cameraHit);
    const overlaps=(a,b)=>Math.min(a.right,b.right)-Math.max(a.x,b.x)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1;
    return {buttons,neve:a,battle:b,caption,goal,stage,camera,captionOverlaps:buttons.some(r=>overlaps(caption,r))||[goal,stage,b,camera].some(r=>overlaps(caption,r)),cameraOverlapsMenu:buttons.some(r=>overlaps(camera,r)),neveOverlapsDeparture:overlaps(a,b),overflow:document.documentElement.scrollWidth>innerWidth+1};
   });
   layout.viewport=size;r.layouts.push(layout);assert(layout.buttons.length===11,'Expected 11 menu actions');assert(layout.buttons.every(b=>b.inside&&b.hit&&b.width>=44&&b.height>=44),'Blocked or clipped menu action '+JSON.stringify(layout.buttons.filter(b=>!b.inside||!b.hit)));assert(!layout.neveOverlapsDeparture&&!layout.overflow,'Neve overlap or page overflow');
   assert(!layout.captionOverlaps&&layout.caption.y>=0&&layout.caption.bottom<=size.height&&layout.goal.height>=44,'Hero caption overlaps goal, stage or menu: '+JSON.stringify(layout));
   assert(layout.camera.hit&&!layout.cameraOverlapsMenu&&layout.camera.height>=44,'Camera action is blocked or overlaps another menu');
   await page.locator('#lobby-camera-toggle').tap();
   const cameraPanel=await page.locator('#lobby-camera-panel').boundingBox();assert(cameraPanel&&cameraPanel.y>=0&&cameraPanel.y+cameraPanel.height<=size.height+1,'Camera panel leaves viewport');
   await page.locator('#lobby-camera-toggle').tap();
   await page.locator('#app-mode-open').tap();await page.locator('#app-mode-dialog[open]').waitFor();
   assert(await page.locator('#app-mode-guide li').count()===3,'Install steps missing');
   await page.screenshot({path:`${dir}/${engine}-${size.width}-app.png`});await page.getByRole('button',{name:'앱 화면 안내 닫기',exact:true}).tap();
   assert(await page.locator('#app-mode-open').evaluate(e=>document.activeElement===e),'App dialog focus did not return');
   await page.screenshot({path:`${dir}/${engine}-${size.width}-lobby.png`});await save();
  }
  await page.setViewportSize({width:390,height:844});await page.locator('#app-mode-open').tap();
  const full=page.locator('#app-mode-fullscreen');
  if(await full.isVisible()){
   await full.tap();await page.waitForTimeout(400);
   if(await page.evaluate(()=>!!document.fullscreenElement)){
    r.fullscreen='entered-via-user-tap';await page.locator('#app-mode-open').tap();await page.getByRole('button',{name:'전체 화면 끝내기',exact:true}).tap();
    await page.waitForFunction(()=>!document.fullscreenElement,null,{timeout:5000});
   }else{r.fullscreen='browser-refused';r.fullscreenFallback=await page.locator('#app-mode-status').innerText();assert(/설치/.test(r.fullscreenFallback),'Fullscreen refusal has no install fallback');await page.locator('#app-mode-close').tap();}
  }else{r.fullscreen='unsupported-install-guide-shown';await page.locator('#app-mode-close').tap();}
  r.neve=[];
  for(const size of [{width:320,height:568},{width:390,height:844},{width:667,height:375},{width:390,height:400}]){
   await page.setViewportSize(size);await page.waitForTimeout(200);if(await page.locator('#btn-ignore-rotate').isVisible())await page.locator('#btn-ignore-rotate').tap();
   // Open from the regular menu before narrowing to a keyboard-sized viewport.
   if(size.height===400){await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);}
   await page.locator('.companion-lobby-launcher').tap();await page.locator('#companion-panel:modal').waitFor({timeout:120000});
   if(size.height===400){await page.setViewportSize(size);await page.waitForTimeout(200);}
   const geometry=await page.evaluate(()=>['.companion-close','#companion-input','.companion-form'].map(selector=>{
    const e=document.querySelector(selector),b=e.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
    return {selector,x:b.x,y:b.y,bottom:b.bottom,right:b.right,height:b.height,hit:hit===e||e.contains(hit),inside:b.x>=0&&b.y>=0&&b.right<=innerWidth+1&&b.bottom<=innerHeight+1};
   }));
   assert(geometry.every(b=>b.inside&&b.hit&&b.height>=44),'Neve close/input/footer clipped: '+JSON.stringify(geometry));
   await page.locator('#companion-input').fill('닫기와 입력 확인');
   if(size.height===400){
    await page.getByRole('button',{name:'수호 위기 시 회복막',exact:true}).tap();
    await page.waitForTimeout(100);
    const newest=await page.evaluate(()=>{const b=document.querySelector('.companion-body').getBoundingClientRect(),r=document.querySelector('.companion-log p:last-child').getBoundingClientRect();return {top:r.top,bottom:r.bottom,bodyTop:b.top,bodyBottom:b.bottom};});
    assert(newest.top>=newest.bodyTop-1&&newest.bottom<=newest.bodyBottom+1,'Latest local tactic reply is outside scroll body: '+JSON.stringify(newest));
   }
   for(let i=0;i<10;i++){await page.keyboard.press('Tab');assert(await page.locator('#companion-panel').evaluate(e=>e.contains(document.activeElement)),'Focus escaped Neve modal');}
   await page.screenshot({path:`${dir}/${engine}-${size.width}x${size.height}-neve.png`});
   await page.keyboard.press('Escape');await page.locator('#companion-panel').waitFor({state:'hidden'});
   assert(await page.locator('.companion-lobby-launcher').evaluate(e=>document.activeElement===e),'Neve focus did not return');
   r.neve.push({viewport:size,geometry,focusTrap:true,escape:true,scope:size.height===400?'Reduced viewport only; not physical keyboard':''});
  }
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
  await page.locator('#btn-battle').tap();await page.waitForFunction(()=>window.app?.mode==='battle'&&window.app.battle?.active&&!window.app.stageStarting,null,{timeout:45000});
  for(let n=0;n<4;n++){const close=page.locator('#modal.show #m-cancel');if(!await close.isVisible())break;await close.tap();}
  assert(await page.locator('.companion-pause-launcher').count()===1&&!await page.locator('.companion-pause-launcher').isVisible(),'Neve floats over active combat');
  await page.locator('#btn-pause').tap();await page.locator('.companion-pause-launcher').tap();await page.locator('#companion-panel:modal').waitFor();
  const elapsed=await page.evaluate(()=>window.app.battle.elapsed);await page.waitForTimeout(250);
  assert(await page.evaluate(t=>window.app.battle.paused&&Math.abs(window.app.battle.elapsed-t)<.002,elapsed),'Battle advances behind Neve');
  await page.locator('.companion-close').tap();
  assert(await page.evaluate(()=>window.app.battle.paused),'Neve close accidentally resumes manual pause');
  assert(await page.locator('.companion-pause-launcher').evaluate(e=>document.activeElement===e),'Pause Neve focus did not return');
  await page.locator('#btn-resume').tap();await page.waitForFunction(()=>!window.app.battle.paused);
  assert(!await page.locator('.companion-pause-launcher').isVisible(),'Neve remains over combat after resume');
  r.neveBattle='Actual departure, pause-menu open, frozen clock, close retains manual pause, explicit resume';
  await page.locator('#btn-pause').tap();await page.locator('#btn-giveup').tap();await page.locator('#btn-result-lobby').tap();
  await page.waitForFunction(()=>window.app.mode==='lobby');
  await page.locator('#btn-expedition').tap();await page.getByRole('button',{name:'결투장',exact:true}).tap();
  await page.waitForFunction(()=>[...document.querySelectorAll('.exp-rivals article > img')].length===3&&[...document.querySelectorAll('.exp-rivals article > img')].every(e=>e.complete&&e.naturalWidth===768),null,{timeout:30000});
  r.arena=[];
  for(const size of [{width:320,height:568},{width:390,height:844},{width:667,height:375}]){
   await page.setViewportSize(size);if(await page.locator('#btn-ignore-rotate').isVisible())await page.locator('#btn-ignore-rotate').tap();
   const arena=await page.evaluate(()=>{
    const portraits=[...document.querySelectorAll('.exp-rivals article > img')].map(e=>({src:e.getAttribute('src'),width:e.naturalWidth,height:e.naturalHeight,fallback:!!e.dataset.fallback}));
    const rewards=[...document.querySelectorAll('.exp-rivals .exp-chips img')].map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}));
    const buttons=[...document.querySelectorAll('.exp-rivals button')].map(e=>({height:e.getBoundingClientRect().height}));
    const cards=[...document.querySelectorAll('.exp-rivals article')].map(e=>{const b=e.getBoundingClientRect();return {left:b.left,right:b.right};});
    return {portraits,rewards,buttons,cards,viewport:{width:innerWidth,height:innerHeight},overflow:document.documentElement.scrollWidth>innerWidth+1};
   });
   assert(new Set(arena.portraits.map(p=>p.src)).size===3&&arena.portraits.every(p=>!p.fallback&&p.width===768),'Duplicate or fallback arena portraits');
   assert(arena.rewards.length===6&&arena.rewards.every(i=>i.width>0&&i.width<=36&&i.height>0&&i.height<=36),'Portrait sizing leaked into reward icons');
   assert(arena.buttons.every(b=>b.height>=44)&&arena.cards.every(c=>c.left>=0&&c.right<=size.width+1)&&!arena.overflow,'Arena touch target or horizontal overflow');
   r.arena.push(arena);await page.screenshot({path:`${dir}/${engine}-${size.width}-arena.png`});
  }
  r.script=await page.locator('script[type=module][src]').getAttribute('src');assert(!r.errors.length,'Browser errors: '+r.errors.join('; '));r.status='pass';
 }catch(e){r.status='fail';r.error=String(e.stack||e);}
 finally{await browser.close();await save();console.log(engine+': '+r.status);}
}
report.finished=new Date().toISOString();report.status=report.engines.every(r=>r.status==='pass')?'pass':'fail';await save();console.log(JSON.stringify({out,status:report.status}));process.exitCode=report.status==='pass'?0:1;
