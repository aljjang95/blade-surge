import { chromium } from 'playwright';
import { launchOpts } from '../../../tools/chrome.mjs';
import { preview } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd(), out = path.join(root, 'work/qa/open-fields-20261009/draft-render-v8');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch(launchOpts({ headless: true }));
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
const page = await context.newPage(), errors = [], warnings = [];
page.setDefaultTimeout(90000);
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') warnings.push(m.text()); });
await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const fonts = await Promise.all([400,700].map(async weight => ({ family:'Noto Sans KR', weight, data:(await fs.readFile(`/tmp/blade-qa-fonts/node_modules/@fontsource/noto-sans-kr/files/noto-sans-kr-korean-${weight}-normal.woff2`)).toString('base64') })));
await page.addInitScript(fonts => { window.__qaFonts = Promise.all(fonts.map(async ({ family,weight,data }) => { const f = new FontFace(family,`url(data:font/woff2;base64,${data})`,{weight:String(weight)}); await f.load(); document.fonts.add(f); })); }, fonts);
const report = { scope:'Compiled production preview of the dirty working tree. Controlled scene capture with player position, app.step and wider card camera; not natural play or a deployed release.', build:JSON.parse(await fs.readFile(path.join(root,'dist/version.json'),'utf8')), fields:[], errors, warnings };
const server = await preview({ root, configFile:false, preview:{host:'127.0.0.1',port:0}, logLevel:'error' });
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { waitUntil:'domcontentloaded' });
  await page.evaluate(() => window.__qaFonts);
  await page.locator('#boot-start:not(.hidden)').waitFor({ state:'visible', timeout:180000 }); await page.locator('#boot-start').click();
  await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout:90000 });
  for(let i=0;i<8;i++){ if(await page.locator('#modal.show #m-cancel').isVisible())await page.locator('#m-cancel').click(); await page.waitForTimeout(200); }
  for (const [id,field] of [['windmeadow','meadow'],['sunbreak_coast','coast'],['skywind_pass','mountain'],['dawnward_city','city']]) {
    const start = await page.evaluate(async id => { app.testPause=true; const ok=await app.startExpedition('dungeon',id); const b=app.battle; for(let i=0;i<120;i++)app.step(1/60,i===119); return {ok,stage:b.stage?.field,mode:app.mode,scene:b.arena?.fieldScene?.name}; }, id);
    if(!start.ok)throw Error('Start failed '+id+JSON.stringify(start));
    report.fields.push({id,field,start});
    await page.screenshot({path:path.join(out,`${field}-entry.png`)});
    const scene = await page.evaluate(() => { const b=app.battle,p=b.player,r=b.world.startRoom; p.pos.set(r.x,0,r.z-r.h/2+8); p.auto=false; for(let i=0;i<120;i++)app.step(1/60,i===119); return {room:r.label,pos:p.pos.toArray(),drawCalls:app.renderer.r.info.render.calls,geometries:app.renderer.r.info.memory.geometries,texture:b.arena?.fieldScene?.userData.surface}; });
    await page.screenshot({path:path.join(out,`${field}-edge.png`)});
    await page.evaluate(() => {app.renderer.setCameraPreset('top');Object.assign(app.renderer.rig.base,{y:14,z:15,fov:50});for(let i=0;i<150;i++)app.step(1/60,i===149);});
    await page.addStyleTag({content:'#hud,#effects,#combat-overlay,#toast-layer,#stage-title,#masterworks,#companion-bubble { visibility:hidden!important; }'});
    await page.locator('#gl').screenshot({path:path.join(out,`${field}-card.png`)});
    await page.evaluate(() => document.querySelector('style:last-of-type')?.remove());
    await page.evaluate(() => app.renderer.setCameraPreset('auto'));
    report.fields.at(-1).scene=scene;
    await page.evaluate(() => { const t=app.expeditionTicket; app.expedition.abandon(t); app.expeditionTicket=null; app.toLobby(); });
  }
} catch(e) { report.failure=String(e.stack||e); await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{}); process.exitCode=1; }
finally { await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n'); await browser.close(); await new Promise(resolve=>server.httpServer.close(resolve)); }
console.log(JSON.stringify(report));
