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
  await page.locator('#boot-start:not(.hidden)').waitFor({timeout:180000});await page.locator('#boot-start').tap();
  await page.waitForFunction(()=>window.app?.mode==='lobby'&&!document.querySelector('#boot.show'),null,{timeout:120000});await page.waitForTimeout(800);
  for(let n=0;n<4;n++){const close=page.locator('#modal.show #m-cancel');if(!await close.isVisible())break;await close.tap();}
  for(const size of [{width:320,height:568},{width:390,height:844},{width:667,height:375}]){
   await page.setViewportSize(size);await page.waitForTimeout(150);if(await page.locator('#btn-ignore-rotate').isVisible())await page.locator('#btn-ignore-rotate').tap();
   const layout=await page.evaluate(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const buttons=[...document.querySelectorAll('.lobby-left button')].map(e=>{const r=rect(e),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {...r,name:e.getAttribute('aria-label')||e.textContent,hit:hit===e||e.contains(hit),inside:r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1};});
    const neve=document.querySelector('.companion-lobby-launcher'),battle=document.querySelector('#btn-battle'),a=rect(neve),b=rect(battle);
    return {buttons,neve:a,battle:b,neveOverlapsDeparture:Math.min(a.right,b.right)>Math.max(a.x,b.x)&&Math.min(a.bottom,b.bottom)>Math.max(a.y,b.y),overflow:document.documentElement.scrollWidth>innerWidth+1};
   });
   layout.viewport=size;r.layouts.push(layout);assert(layout.buttons.length===11,'Expected 11 menu actions');assert(layout.buttons.every(b=>b.inside&&b.hit&&b.width>=44&&b.height>=44),'Blocked or clipped menu action '+JSON.stringify(layout.buttons.filter(b=>!b.inside||!b.hit)));assert(!layout.neveOverlapsDeparture&&!layout.overflow,'Neve overlap or page overflow');
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
  await page.setViewportSize({width:390,height:844});await page.locator('.companion-lobby-launcher').tap();await page.getByRole('dialog',{name:'네브 동행 전술 대화',exact:true}).waitFor({timeout:120000});
  await page.getByRole('button',{name:'대화 닫기',exact:true}).tap();await page.getByRole('dialog',{name:'네브 동행 전술 대화',exact:true}).waitFor({state:'hidden'});
  assert(await page.locator('.companion-lobby-launcher').evaluate(e=>document.activeElement===e),'Neve focus did not return');r.neve='actual open-close-focus return';
  r.script=await page.locator('script[type=module][src]').getAttribute('src');assert(!r.errors.length,'Browser errors: '+r.errors.join('; '));r.status='pass';
 }catch(e){r.status='fail';r.error=String(e.stack||e);}
 finally{await browser.close();await save();console.log(engine+': '+r.status);}
}
report.finished=new Date().toISOString();report.status=report.engines.every(r=>r.status==='pass')?'pass':'fail';await save();console.log(JSON.stringify({out,status:report.status}));process.exitCode=report.status==='pass'?0:1;
