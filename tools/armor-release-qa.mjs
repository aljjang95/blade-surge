import { verifyArmorFallback } from './armor-fallback-qa.mjs';
// Actual compiled game, isolated browser save; no payments, backend writes or production mutation.
import { chromium } from 'playwright';
import { preview } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'work', 'armor-dogfood', new Date().toISOString().replace(/[:.]/g, '-'));
const report = { scope:'Local compiled app, real touch inputs with seeded isolated test inventory. Not physical-phone FPS or independent art approval.', head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(), startedAt:new Date().toISOString(), checks:[], errors:[], consoleErrors:[], blocked:[], variants:[], screenshots:[] };
const check = (name, pass, evidence={}) => { report.checks.push({name,pass:!!pass,evidence}); if(!pass)throw Error(name); };
let browser, server;
await fs.mkdir(out,{recursive:true});
try {
 server = await preview({root,configFile:false,preview:{host:'127.0.0.1',port:0},logLevel:'error'});
 const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
 browser = await chromium.launch({channel:'chrome',headless:true});
 const context = await browser.newContext({viewport:{width:880,height:400},hasTouch:true,isMobile:true,deviceScaleFactor:1,serviceWorkers:'block'});
 await context.route('**/*',route=>{const req=route.request(),url=req.url();if(url.startsWith(origin+'/')&&req.method()==='GET'||/^(data|blob):/.test(url))return route.continue();report.blocked.push({url,method:req.method()});return route.abort();});
 const page = await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 const start=Date.now();await page.goto(origin,{waitUntil:'domcontentloaded'});
 await page.locator('#boot-start:not(.hidden)').waitFor({timeout:90000});report.bootSeconds=(Date.now()-start)/1000;
 await page.locator('#boot-start').tap();await page.waitForFunction(()=>window.app?.mode==='lobby'&&!document.querySelector('#boot').classList.contains('show'));
 await page.evaluate(()=>{app.testPause=true;app.ui.closeModal();app.eco.s.selected='knight';app.eco.s.energy=200;for(const id of ['a_leather','a_bronze','a_knight','a_rime','a_king'])app.eco.s.inventory.push({id,uid:app.eco.s.invSeq++,enh:0});app.eco.emit();});
 const step = n=>page.evaluate(n=>{for(let i=0;i<n;i++)app.step(1/60,i===n-1);},n);
 const shot = async name=>{const file=path.join(out,name+'.png');await page.screenshot({path:file});report.screenshots.push({name,file,sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')});};
 const gpu=await page.evaluate(()=>{const gl=app.renderer.r.getContext(),d=gl.getExtension('WEBGL_debug_renderer_info');return{api:gl.getParameter(gl.VERSION),renderer:d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):'unknown'};});report.gpu=gpu;
 for(const id of ['a_leather','a_bronze','a_knight','a_rime','a_king']) {
  await page.evaluate(()=>{if(app.mode==='battle')app.toLobby();app.ui.closeModal();app.meta.openTab('heroes');});
  const uid=await page.evaluate(id=>{const i=app.eco.s.inventory.find(x=>x.id===id);app.meta.showItem(i.uid,'knight');return i.uid;},id);
  await page.locator('#i-eq').tap();await page.waitForFunction(id=>app.wardrobe?.instance?.root.userData.equipmentAppearance?.id===id,id);
  await step(60);
  const fitted=await page.evaluate(()=>{const r=app.wardrobe.instance.root,parts=[];r.traverse(o=>{if(o.isMesh&&o.userData.equipmentItem)parts.push({name:o.name,uv:!!o.geometry.attributes.uv,map:!!o.material.map,normal:!!o.material.normalMap});});return{lobby:app.showcase.root.userData.equipmentAppearance,wardrobe:r.userData.equipmentAppearance,parts,uid:app.eco.hero('knight').equip.armor};});
  check(id+'_equip_lobby_wardrobe',fitted.uid===uid&&fitted.lobby?.id===id&&fitted.wardrobe?.id===id&&fitted.parts.every(x=>x.uv),fitted);
  if(id==='a_rime')check('rime_real_textures_loaded',fitted.parts.some(x=>x.map)&&fitted.parts.some(x=>x.normal),fitted.parts);
  await shot('wardrobe-'+id);report.variants.push({id,fitted});
  await page.evaluate(()=>{app.meta.openTab('home');app.ui.closeModal();});await step(45);await shot('lobby-'+id);
  await page.locator('#btn-battle').tap();await page.waitForFunction(()=>app.battle?.active&&!app.stageStarting);
  await page.evaluate(()=>{app.battle.player.auto=false;app.battle.player.invuln=10000;app.companionAgent?.endBattle();});await step(80);
  const battle=await page.evaluate(()=>({id:app.battle.player.model.userData.equipmentAppearance?.id,state:app.battle.player.state,position:app.battle.player.pos.toArray(),input:app.input.enabled}));
  check(id+'_battle_same_appearance',battle.id===id&&battle.input,battle);await shot('battle-'+id);
  const joy=await page.locator('#joy').boundingBox(),cdp=await context.newCDPSession(page);
  const x=joy.x+joy.width*.5,y=joy.y+joy.height*.5;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+38,y:y-8,id:1}]});await step(20);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  const movement=await page.evaluate(()=>({position:app.battle.player.pos.toArray(),state:app.battle.player.state}));
  check(id+'_touch_movement',Math.hypot(...movement.position.map((v,i)=>v-battle.position[i]))>.05,movement);
  await page.locator('#btn-attack').tap();await step(9);
  check(id+'_attack_input',await page.evaluate(()=>app.battle.player.state==='attack'));await shot('attack-'+id);
  await page.locator('#btn-dodge').tap();await step(5);
  check(id+'_dodge_input',await page.evaluate(()=>app.battle.player.state==='dodge'));await shot('dodge-'+id);
  await step(50);await page.evaluate(()=>{app.toLobby();app.ui.closeModal();});await step(80);
 }
 // A few fixed animation phases in the real wardrobe renderer expose front/back/shoulder problems.
 await page.evaluate(()=>{app.meta.openTab('heroes');});await page.waitForFunction(()=>!!app.wardrobe.instance);
 await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>app.wardrobe.show('knight'));await page.waitForTimeout(100);
 for(const clip of ['Idle','Running_A','Dodge_Forward','Hit_A']) {
  await page.evaluate(clip=>{const s=app.wardrobe.instance;s.mixer.stopAllAction();const c=s.clips[clip];if(!c)throw Error('Missing '+clip);s.mixer.clipAction(c).reset().play();s.mixer.update(c.duration*.45);},clip);
  await page.locator('.wardrobe-controls button').nth(0).tap();await page.locator('.wardrobe-controls button').nth(1).tap();await page.waitForTimeout(80);await shot('pose-'+clip);
 }
 await page.emulateMedia({reducedMotion:'no-preference'});
 for(const viewport of [{width:640,height:360},{width:360,height:740}]) {
  await page.setViewportSize(viewport);await page.waitForTimeout(250);const portraitButton=page.getByRole('button',{name:'세로로 계속하기'});if(await portraitButton.isVisible())await portraitButton.tap();await page.waitForTimeout(150);await step(10);
  const layout=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,wardrobe:document.querySelector('.wardrobe-canvas')?.getBoundingClientRect().toJSON()}));
  check('layout_'+viewport.width,layout.scrollWidth<=layout.width+1,layout);await shot('wardrobe-layout-'+viewport.width);
 }
 await page.setViewportSize({width:880,height:400});await page.evaluate(()=>app.meta.openTab('home'));await step(120);
 const memory=[];
 for(let cycle=0;cycle<5;cycle++) {
  await page.evaluate(async()=>{for(const id of ['a_leather','a_bronze','a_knight','a_rime','a_king']){app.eco.equip('knight',app.eco.s.inventory.find(x=>x.id===id).uid);await app.showcaseHero('knight',true);app.step(0,true);}app.eco.unequip('knight','armor');await app.showcaseHero('knight',true);app.step(0,true);});
  memory.push(await page.evaluate(()=>({...app.renderer.r.info.memory,programs:app.renderer.r.info.programs.length})));
 }
 report.memoryCycles=memory;check('warm_swap_no_geometry_texture_growth',memory.slice(2).every(x=>x.geometries===memory[2].geometries&&x.textures===memory[2].textures),memory);
 await page.evaluate(async()=>{app.eco.equip('knight',app.eco.s.inventory.find(x=>x.id==='a_rime').uid);await app.showcaseHero('knight',true);});
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('#boot-start:not(.hidden)').waitFor({timeout:90000});await page.locator('#boot-start').tap();await page.waitForFunction(()=>app.mode==='lobby');
 check('equipped_save_reload',await page.evaluate(()=>app.showcase.root.userData.equipmentAppearance?.id==='a_rime'));
 check('zero_page_exceptions',report.errors.length===0,report.errors);
 check('zero_shader_errors',!report.consoleErrors.some(x=>/shader|WebGLProgram|VALIDATE_STATUS/i.test(x)),report.consoleErrors);
 await context.close();
 report.fallback=await verifyArmorFallback(browser,origin,path.join(out,'fallback-rime.png'));
 check('failed_download_preserves_equipment_and_visible_base',report.fallback.pass,report.fallback);
 report.status='pass';
} catch(error) { report.status='fail';report.failure=String(error.stack||error);process.exitCode=1; }
finally {
 await browser?.close();if(server)await new Promise(resolve=>server.httpServer.close(resolve));
 report.finishedAt=new Date().toISOString();const file=path.join(out,'report.json');await fs.writeFile(file,JSON.stringify(report,null,2));
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure,report:file,bootSeconds:report.bootSeconds,gpu:report.gpu,memory:report.memoryCycles}));
}
