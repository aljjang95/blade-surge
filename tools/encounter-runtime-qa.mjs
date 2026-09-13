import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'work/encounter-runtime-qa');await mkdir(out,{recursive:true});
const report={started:new Date().toISOString(),status:'running',scope:'Real app, original character loader, campaign boss-room spawn, actual fixed 50ms app.step. QA opens the seal and relocates player; not natural completion, rewards, mobile GPU or FPS proof.',errors:[],bosses:[]};
let server,browser;
try{
  server=await createServer({root,configFile:false,server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
  browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1200,height:800}});
  page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`,{waitUntil:'domcontentloaded',timeout:120000});
  await page.locator('#boot-start:not(.hidden)').waitFor({timeout:180000});await page.locator('#boot-start').click();
  await page.waitForFunction(()=>window.app?.mode==='lobby'&&!document.querySelector('#boot.show'),null,{timeout:90000});
  report.gpu=await page.evaluate(()=>{const gl=window.app.renderer.r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL||gl.RENDERER);});
  for(let chapter=1;chapter<=6;chapter++){
    const result=await page.evaluate(async chapter=>{
      const app=window.app;app.testPause=true;await app.toLobby();
      const {stageDef}=await import('/src/data/stages.js');const stage=stageDef(chapter,10);
      app.ui.closeModal();document.querySelector('#meta')?.classList.remove('show');app.mode='battle';
      await app.battle.start(stage,app.eco.s.selected,app.eco.hero(app.eco.s.selected),app.eco.heroEquipBonus(app.eco.s.selected));
      const g=app.battle,room=g.world.bossRoom;g.world.unseal();g.arena.openSeal(g.fx);
      g.player.auto=false;g.player.pos.set(room.x,0,room.z-5);
      // Enter the real boss room; the production room code decides which enemy spawns.
      g.enterRoom(room);
      for(let i=0;i<100&&(!g.boss||g.boss.spawning);i++)app.step(.05,false);
      const e=g.boss;if(!e||e.spawning)throw Error('Campaign boss did not spawn '+chapter);
      const meshes=[];e.model.traverse(o=>{if(o.isMesh&&o.material.userData.tllAuthored)meshes.push({name:o.name,vertices:o.geometry.attributes.position.count,map:!!o.material.map,roughnessMap:!!o.material.roughnessMap,emissive:o.material.emissive.getHex(),roughness:o.material.roughness});});
      if(meshes.length!==3||meshes.filter(m=>m.map).length!==2||meshes.some(m=>m.roughnessMap))throw Error('Authored materials missing '+chapter);
      if(e.model.userData.encounterIdentity!==e.def.model)throw Error('Wrong campaign model '+chapter);
      const samples=[];
      for(let i=0;i<30;i++){app.step(.05,false);samples.push({x:e.pos.x,z:e.pos.z,clip:e.actionName});}
      const direction={yaw:e.yaw,rootYaw:e.root.rotation.y,modelYaw:e.model.rotation.y,faceFlip:e.rig.faceFlip};
      // Deterministic inspection composition after the real movement samples.
      e.pos.x=room.x;e.pos.z=room.z;g.player.pos.set(room.x,0,room.z+6);e.face(g.player.pos.x,g.player.pos.z);
      app.cameraControls.set({yaw:0,pitch:-10,zoom:70});
      g.renderer.rig.target.copy(g.player.pos);
      for(let i=0;i<60;i++)g.renderer.update(0,.05);
      g.renderer.rig.target.copy(g.player.pos);app.step(.001,true);
      return {chapter,enemy:stage.encounter.enemyId,model:e.def.model,identity:e.model.userData.encounterIdentity,alive:e.alive,radius:e.radius,hp:e.maxHp,meshes,clips:Object.keys(e.clips).length,samples,direction};
    },chapter);
    report.bosses.push(result);await page.screenshot({path:path.join(out,`chapter-${chapter}.png`)});
    const cleanup=await page.evaluate(async()=>{await window.app.toLobby();return {enemies:window.app.battle.enemies.length,player:!!window.app.battle.player};});
    if(cleanup.enemies||cleanup.player)throw Error('Encounter survived stop');result.cleanup=cleanup;
    console.log(`chapter ${chapter}: ${result.model}`);
  }
  if(report.errors.length)throw Error('Browser runtime errors');report.status='pass';
}catch(e){report.status='fail';report.error=String(e.stack||e);process.exitCode=1;}
finally{await browser?.close();await server?.close();report.finished=new Date().toISOString();await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
