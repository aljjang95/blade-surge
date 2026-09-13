import {chromium} from 'playwright';
import {createServer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),seed=Number(process.argv.find(a=>a.startsWith('--seed='))?.slice(7)||20260914);
if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw Error('Expected uint32 seed');
const out=path.join(root,`work/mob-role-qa-${seed}`);await mkdir(out,{recursive:true});
const report={started:new Date().toISOString(),seed,status:'running',roles:[],maps:[],errors:[],scope:'Actual loaded game models and input in an isolated save. Role setup controls positions and temporarily raises HP; fixed 50ms stepping, original hurt tracing. Map captures are controlled visits, not natural campaign completions. Separate AUTO proof covers mixed combat. No physical-phone or live-network-party certification.'};
const sources=['src/data/mob-roles.js','src/data/story-dungeons.js','src/data/stages.js','src/game/mob-roles.js','src/game/enemies.js','src/game/actor.js','src/game/region-hazards.js','tools/mob-role-qa.mjs'];
const sourceHashes=()=>Object.fromEntries(sources.map(p=>[p,createHash('sha256').update(readFileSync(path.join(root,p))).digest('hex')]));
report.head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();report.sourceHashes=sourceHashes();
const save=()=>writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));let server,browser;
try{
  server=await createServer({root,configFile:false,server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
  browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1200,height:800}});
  await page.addInitScript(seed=>{let n=seed;Math.random=()=>{n|=0;n=n+0x6d2b79f5|0;let t=Math.imul(n^n>>>15,1|n);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};},seed);
  page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`,{waitUntil:'domcontentloaded',timeout:120000});
  await page.locator('#boot-start:not(.hidden)').waitFor({timeout:180000});await page.locator('#boot-start').click();
  await page.waitForFunction(()=>window.app?.mode==='lobby'&&!document.querySelector('#boot.show'),null,{timeout:90000});
  await page.evaluate(async()=>{
    const app=window.app;app.testPause=true;app.ui.closeModal();const {stageDef}=await import('/src/data/stages.js');
    document.querySelector('#meta').classList.remove('show');app.mode='battle';await app.battle.start(stageDef(1,1),app.eco.s.selected,app.eco.hero(app.eco.s.selected),app.eco.heroEquipBonus(app.eco.s.selected));app.companionAgent?.endBattle();app.battle.player.auto=false;
  });
  for(const id of ['orc','alien','skel_rogue','ninja','bone_orc','orc_blob']){
    const sample=await page.evaluate(({id,seed})=>{
      const app=window.app,g=app.battle,r=g.world.startRoom,p=g.player;
      for(const old of g.enemies)old.dispose();g.enemies.length=0;g.input.clear();
      p.hp=p.maxHp=Math.max(p.maxHp,5000);p.invuln=0;p.stun=0;p.kb.set(0,0,0);p.vel.set(0,0,0);p.state='idle';
      const e=g.spawnEnemy(id,null,r,{x:r.x,z:r.z});if(!e?.mobRole)throw Error(`Missing loaded role ${id}`);e.atkCd=100;
      for(let i=0;i<120&&e.spawning;i++)app.step(.05,false);
      const angle=seed===20260914?0:Math.PI/3,d=e.mobRole.key==='charger'?6.2:e.mobRole.key==='flanker'?4:2.5;
      p.pos.set(r.x+Math.sin(angle)*d,0,r.z+Math.cos(angle)*d);e.pos.set(r.x,0,r.z);e.kb.set(0,0,0);e.vel.set(0,0,0);e.state='chase';e.stun=0;e.atkCd=0;
      e.startAttack(d);if(!e.mobRole.plan)throw Error('Role did not start');
      while(e.mobRole.plan.flanking)app.step(.05,false);
      app.cameraControls.set({yaw:0,pitch:-10,zoom:75});g.renderer.rig.target.copy(p.pos);for(let i=0;i<35;i++)g.renderer.update(0,.05);app.step(.001,true);
      const gl=app.renderer.r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
      return {id,role:e.mobRole.key,model:e.def.model,warning:{...e.mobRole.plan.shape},strikeAt:e.mobRole.plan.strikeAt,endAt:e.mobRole.plan.endAt,attackClip:e.actionName,gpu:gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL||gl.RENDERER)};
    },{id,seed});report.roles.push(sample);await page.screenshot({path:path.join(out,`${id}-warning.png`)});
    sample.dodge=await page.evaluate(async()=>{
      const app=window.app,g=app.battle,e=g.enemies[0],p=g.player,r=g.world.startRoom;
      const {hazardContains}=await import('/src/game/region-hazards.js');const shape={...e.mobRole.plan.shape};if(shape.type==='lane')shape.width+=1.2;else shape.radius+=.6;
      let goal=null,best=Infinity;for(let x=r.x-r.w/2+1.5;x<r.x+r.w/2-1.5;x+=.35)for(let z=r.z-r.h/2+1.5;z<r.z+r.h/2-1.5;z+=.35){if(hazardContains(shape,x,z))continue;const dist=Math.hypot(x-p.pos.x,z-p.pos.z);if(dist<best){best=dist;goal={x,z};}}
      if(!goal)throw Error('No safe dodge goal');let travel=0,last=p.pos.clone(),recovery=false;const damage=[],original=p.hurt;
      p.hurt=function(...args){const hp=this.hp,result=original.apply(this,args);damage.push(Math.max(0,hp-this.hp));return result;};
      try{for(let i=0;i<150&&e.mobRole.plan;i++){
        const dx=goal.x-p.pos.x,dz=goal.z-p.pos.z,d=Math.hypot(dx,dz);g.input.joy.active=true;g.input.screenMove.x=d>.18?dx/d:0;g.input.screenMove.y=d>.18?dz/d:0;
        app.step(.05,false);travel+=p.pos.distanceTo(last);last.copy(p.pos);
        if(e.mobRole.plan&&e.attackDone&&e.stateT>=e.mobRole.plan.strikeAt+(e.mobRole.key==='charger'?.4:0)){if(e.vel.length()>.01)throw Error('No stationary recovery');recovery=true;}
      }}finally{p.hurt=original;g.input.clear();}
      if(damage.some(n=>n>0)||!recovery||e.mobRole.plan)throw Error(`Dodge/recovery failed ${JSON.stringify({damage,recovery,state:e.state,travel})}`);
      app.step(.001,true);return {damage:damage.reduce((a,b)=>a+b,0),travel,recovery,ended:e.state};
    });await page.screenshot({path:path.join(out,`${id}-recovery.png`)});
    sample.lifecycle=await page.evaluate(()=>{
      const app=window.app,g=app.battle,e=g.enemies[0],p=g.player,r=g.world.startRoom;
      const start=()=>{e.mobRole.cancel();g.input.clear();p.pos.set(r.x,0,r.z+2.5);p.hp=p.maxHp;p.invuln=0;p.stun=0;p.kb.set(0,0,0);p.vel.set(0,0,0);p.state='idle';e.pos.set(r.x,0,r.z);e.vel.set(0,0,0);e.kb.set(0,0,0);e.stun=0;e.state='chase';e.atkCd=0;e.startAttack(2.5);while(e.mobRole.plan.flanking)app.step(.05,false);};
      start();const h=e.mobRole.plan.shape;p.pos.set(h.x,0,h.z);if(g.apex){g.apex.shield=0;g.apex.shieldUntil=0;}
      const damage=[],original=p.hurt;p.hurt=function(...args){const hp=this.hp,result=original.apply(this,args);damage.push(Math.max(0,hp-this.hp));return result;};
      try{for(let i=0;i<160&&e.mobRole.plan;i++)app.step(.05,false);}finally{p.hurt=original;}
      const accepted=damage.filter(n=>n>0);if(accepted.length!==1)throw Error(`Expected one real hit: ${JSON.stringify(damage)}`);
      start();const t=e.stateT,pos=e.pos.clone();g.setPaused('role-qa',true);for(let i=0;i<10;i++)app.step(.05,false);
      if(e.stateT!==t||!e.pos.equals(pos)||!e.mobRole.plan)throw Error('Pause failed');g.setPaused('role-qa',false);
      e.hurt(1,{stun:.6,kb:5});app.step(.05,false);if(e.mobRole.plan||e.mobRole.mesh.visible||e.getPartyWarnings().length)throw Error('Stun did not cancel');
      start();e.hurt(e.hp*10,{kb:0});if(e.alive||e.mobRole.plan||e.mobRole.mesh.visible)throw Error('Death left role active');
      return {actualDamage:accepted[0],singleHit:true,paused:true,stunCancelled:true,deathCancelled:true};
    });await save();console.log(`${id}: actual dodge, hit, recovery and pause/stun pass`);
  }
  report.wall=await page.evaluate(()=>{
    const app=window.app,g=app.battle,r=g.world.startRoom,player=g.player;
    for(const old of g.enemies)old.dispose();g.enemies.length=0;
    const e=g.spawnEnemy('orc',null,r,{x:r.x,z:r.z-r.h/2+2});e.state='chase';e.spawning=false;e.stun=0;e.kb.set(0,0,0);e.vel.set(0,0,0);e.atkCd=0;
    const dummy={alive:true,pos:player.pos.clone().set(r.x,0,r.z-r.h/2-4),hurt:()=>{hits++;return 1;}};let hits=0,frames=0,wallSafe=true;
    if(g.world.walkable(dummy.pos.x,dummy.pos.z))throw Error('Wall fixture target must be outside the walkable floor');
    const start=e.pos.clone();g.player=dummy;
    try{e.startAttack(6);if(!e.mobRole.plan)throw Error('Wall probe did not start');
      while(e.mobRole.plan&&frames++<150){e.update(.037);wallSafe&&=g.world.walkable(e.pos.x,e.pos.z);}
    }finally{g.player=player;}
    if(hits||!wallSafe||e.mobRole.plan||e.pos.distanceTo(start)>3)throw Error(`Wall probe failed ${JSON.stringify({hits,wallSafe,frames,travel:e.pos.distanceTo(start)})}`);
    return {hits,wallSafe,frames,travel:e.pos.distanceTo(start),scope:'Actual Enemy/Actor/Floor collision with a deliberately unreachable dummy beyond the outer wall; no Player movement or valid-world target claim.'};
  });
  report.mixed=await page.evaluate(async()=>{
    const app=window.app;await app.toLobby();app.ui.closeModal();const {stageDef}=await import('/src/data/stages.js');
    const originalBonus=app.eco.heroEquipBonus.bind(app.eco);
    app.eco.heroEquipBonus=id=>{const b=originalBonus(id);return {...b,hp:(b.hp||0)+100000};};
    try {
    document.querySelector('#meta').classList.remove('show');app.mode='battle';await app.battle.start(stageDef(5,1),app.eco.s.selected,app.eco.hero(app.eco.s.selected),app.eco.heroEquipBonus(app.eco.s.selected));app.companionAgent?.endBattle();
    const g=app.battle,r=g.world.rooms.find(r=>r.type==='normal'),p=g.player;p.auto=true;p.pos.set(r.x,0,r.z);g.enterRoom(r);
    const {installMetricsDriver}=await import('/tools/metrics-driver.mjs'),{STORY_EVENTS}=await import('/src/data/masterworks.js');installMetricsDriver({app,storyEvents:STORY_EVENTS});
    const seen=new Set(),roles={},positions=[],warnings={peak:0};let wallSafe=true;
    for(let i=0;i<900;i++){
      window.__metricsDriver.step(.05,i%30===0);warnings.peak=Math.max(warnings.peak,g.enemies.filter(e=>e.alive&&e.mobRole?.plan).length);
      for(const e of g.enemies)if(e.mobRole){if(e.mobRole.casts)seen.add(e.mobRole.key);roles[e.mobRole.key]=Math.max(roles[e.mobRole.key]||0,e.mobRole.casts);wallSafe&&=g.world.walkable(e.pos.x,e.pos.z);}
      if(i%150===0)positions.push({x:p.pos.x,z:p.pos.z,hp:p.hp,enemies:g.enemies.filter(e=>e.alive).length});
    }
    app.step(.001,true);if(seen.size!==3||warnings.peak>3||!wallSafe||!p.alive)throw Error(`Mixed role encounter failed ${JSON.stringify({roles,seen:[...seen],warnings,wallSafe,alive:p.alive,positions,elapsed:g.elapsed,paused:g.paused})}`);
    return {stage:'5-1',room:r.id,roles,seen:[...seen],warnings,wallSafe,positions,kills:g.kills,elapsed:g.elapsed,paused:g.paused,choices:window.__metricsDriver.snapshot().choices,scope:'Production room roster and unisolated AUTO combat over 45 seconds of driver input; an extra 100,000 equipment HP persists through normal boon/level recalculation. Canonical metrics driver resolves real offers. Actual simulation elapsed is recorded separately. Not a balanced campaign clear.'};
    } finally {app.eco.heroEquipBonus=originalBonus;}
  });await page.screenshot({path:path.join(out,'mixed-crown-room.png')});await save();
  if(seed===20260914)for(const [ch,st] of [[1,4],[2,4],[3,8],[4,8],[5,4],[6,3]]){
    const map=await page.evaluate(async({ch,st})=>{
      const app=window.app;await app.toLobby();app.ui.closeModal();const {stageDef}=await import('/src/data/stages.js');const stage=stageDef(ch,st);
      document.querySelector('#meta').classList.remove('show');app.mode='battle';await app.battle.start(stage,app.eco.s.selected,app.eco.hero(app.eco.s.selected),app.eco.heroEquipBonus(app.eco.s.selected));app.companionAgent?.endBattle();app.battle.player.auto=false;
      const g=app.battle;for(const r of g.world.rooms)r.discovered=true;app.ui.setupMinimap(g.world);app.ui.setObjective(g.world);
      app.cameraControls.set({yaw:ch*25-75,pitch:-16,zoom:85});for(let i=0;i<45;i++)g.renderer.update(0,.05);app.ui.minimap.draw(g);app.step(.001,true);
      return {code:stage.code,id:stage.dungeon.id,title:stage.dungeon.name,rooms:g.world.rooms.length,walkable:g.world.rooms.every(r=>g.world.walkable(r.x,r.z)),sealed:g.world.sealed,landmark:stage.dungeon.landmark};
    },{ch,st});report.maps.push(map);await page.screenshot({path:path.join(out,`${map.code}-${map.id}.png`)});await save();
    if(!map.walkable||!map.sealed)throw Error(`Map invalid ${map.code}`);
  }
  await page.evaluate(async()=>{await window.app.toLobby();let owned=0;window.app.renderer.scene.traverse(o=>{if(/^mob-.+-warning$/.test(o.name))owned++;});if(owned)throw Error('Mob warning survived teardown');});
  if(report.errors.length)throw Error('Browser errors');if(JSON.stringify(sourceHashes())!==JSON.stringify(report.sourceHashes))throw Error('Source changed during runtime QA');report.status='pass';
}catch(error){report.status='fail';report.error=String(error.stack||error);process.exitCode=1;}
finally{await browser?.close();await server?.close();report.finished=new Date().toISOString();await save();}
console.log(JSON.stringify({status:report.status,roles:report.roles.length,maps:report.maps.length,error:report.error}));
