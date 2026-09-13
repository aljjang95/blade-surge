// Controlled real-app QA: isolated save, seal opening, frozen adds, actual input/movement/hurt.
import {chromium} from 'playwright';
import {createServer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),seed=Number(process.argv.find(a=>a.startsWith('--seed='))?.slice(7)||20260914);
if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw Error('Expected uint32 seed');
const out=path.join(root,`work/boss-signature-qa${seed===20260914?'':`-${seed}`}`);await mkdir(out,{recursive:true});
const report={started:new Date().toISOString(),seed,status:'running',errors:[],bosses:[],scope:'Real app with controlled boss-room setup, disabled companion, continuously frozen adds and cleared pre-cast projectiles, virtual-stick input through production movement, fixed 50ms time. Negative control temporarily adds HP to avoid test death. Not an organic campaign clear, real network party, physical phone or FPS benchmark.'};
const save=()=>writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));let server,browser;
try{
  server=await createServer({root,configFile:false,server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
  browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1200,height:800}});
  await page.addInitScript(seed=>{let n=seed;Math.random=()=>{n|=0;n=n+0x6d2b79f5|0;let t=Math.imul(n^n>>>15,1|n);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};},seed);
  page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`,{waitUntil:'domcontentloaded',timeout:120000});
  await page.locator('#boot-start:not(.hidden)').waitFor({timeout:180000});await page.locator('#boot-start').click();
  await page.waitForFunction(()=>window.app?.mode==='lobby'&&!document.querySelector('#boot.show'),null,{timeout:90000});
  report.gpu=await page.evaluate(()=>{const gl=window.app.renderer.r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL||gl.RENDERER);});
  for(let chapter=1;chapter<=6;chapter++){
    const boss=await page.evaluate(async chapter=>{
      const app=window.app;app.testPause=true;await app.toLobby();app.ui.closeModal();
      const {stageDef}=await import('/src/data/stages.js'),{BOSS_SIGNATURES}=await import('/src/data/boss-encounters.js');
      const stage=stageDef(chapter,10);document.querySelector('#meta').classList.remove('show');app.mode='battle';
      await app.battle.start(stage,app.eco.s.selected,app.eco.hero(app.eco.s.selected),app.eco.heroEquipBonus(app.eco.s.selected));
      const g=app.battle,room=g.world.bossRoom;app.companionAgent?.endBattle();g.world.unseal();g.arena.openSeal(g.fx);g.player.auto=false;g.player.pos.set(room.x,0,room.z+6);g.enterRoom(room);
      for(let i=0;i<100&&(!g.boss||g.boss.spawning);i++)app.step(.05,false);
      const e=g.boss;if(!e?.signatures||e.spawning)throw Error(`No actual signature boss ${chapter}`);
      // Freeze only adds for isolated cast readability; all boss simulation remains production.
      for(const add of g.enemies)if(add!==e){add.stun=10000;add.vel.set(0,0,0);add.pos.set(room.x-room.w/2+2,0,room.z-room.h/2+2);}
      app.cameraControls.set({yaw:0,pitch:-10,zoom:70});g.renderer.rig.target.set(room.x,0,room.z+3);for(let i=0;i<40;i++)g.renderer.update(0,.05);
      return {chapter,enemy:stage.encounter.enemyId,model:e.def.model,techniques:[...new Set(e.def.phasePatterns.flat().filter(k=>k in BOSS_SIGNATURES))],casts:[],room:{x:room.x,z:room.z,w:room.w,h:room.h}};
    },chapter);report.bosses.push(boss);await save();
    for(const phase of [0,2])for(const key of boss.techniques){
      const start=await page.evaluate(async({phase,key})=>{
        const app=window.app,g=app.battle,e=g.boss,r=e.homeRoom,p=g.player;
        const {releaseProjectileVisual}=await import('/src/engine/arrow-visual.js');
        const clearedProjectiles=g.projectiles.length;for(const projectile of g.projectiles)releaseProjectileVisual(projectile.mesh);g.projectiles.length=0;
        const adds=g.enemies.filter(add=>add!==e&&add.alive),unfrozenAdds=adds.filter(add=>add.stun<100).map(add=>({id:add.def.id,state:add.state,spawning:add.spawning}));
        for(const add of adds){add.stun=10000;add.vel.set(0,0,0);add.kb.set(0,0,0);add.pos.set(r.x-r.w/2+2,0,r.z-r.h/2+2);}
        g.setPaused('signature-qa',false);g.input.clear();g.input.enabled=true;p.pos.set(r.x,0,r.z+5);p.vel.set(0,0,0);p.kb.set(0,0,0);p.state='idle';p.stun=0;p.slowT=0;p.slow=0;p.invuln=0;p.hp=p.maxHp;
        e.signatures.clear();e.state='chase';e.stateT=0;e.stun=0;e.kb.set(0,0,0);e.vel.set(0,0,0);e.pos.set(r.x,0,r.z);e.face(p.pos.x,p.pos.z);e.phase=phase;e.enraged=phase===2;e.hp=e.maxHp*(phase===2?.25:1);
        e.patternTurn=e.def.phasePatterns[phase].indexOf(key);e.signatures.history=[{x:r.x-4,z:r.z+5},{x:r.x,z:r.z+7},{x:r.x+4,z:r.z+5}];e.startAttack(5);
        if(e.special!==key||!e.signatures.plan)throw Error(`Pattern selection failed ${key}`);
        const plan=e.signatures.plan,cue=app.ui.combatNotices.current?.message;
        if(cue!==`${plan.name} · ${plan.cue}`)throw Error(`Stale cast cue: ${key}: ${cue}`);
        const notice=document.querySelector('#toast-layer .combat-notice'),style=notice&&getComputedStyle(notice);
        if(!style||style.opacity!=='1'||style.animationName!=='none')throw Error(`Cast cue not immediately readable: ${key}`);
        const age=e.stateT;g.setPaused('signature-qa',true);for(let i=0;i<8;i++)app.step(.05,false);if(e.stateT!==age)throw Error('Paused boss advances');g.setPaused('signature-qa',false);
        app.step(.001,true);return {key,phase,cue,clearedProjectiles,unfrozenAdds,duration:plan.duration,lastStrike:plan.lastStrike,events:plan.events,startHp:p.hp,firedBefore:e.signatures.fired,hitsBefore:e.signatures.hits};
      },{phase,key});
      if(phase===2)await page.screenshot({path:path.join(out,`${chapter}-${key}-warning.png`)});
      const result=await page.evaluate(async start=>{
        const app=window.app,g=app.battle,e=g.boss,p=g.player,r=e.homeRoom;
        const {isRecoveryOpportunity}=await import('/src/game/apex-combat.js');
        const dangerous=(h,x,z)=>{
          const dx=x-h.x,dz=z-h.z,d=Math.hypot(dx,dz),margin=.55;
          if(h.safeRadius&&d<h.safeRadius-margin)return false;
          if(h.type==='disk')return d<h.radius+margin;
          if(h.type==='ring')return d>h.radius*.78-margin&&d<h.radius+margin;
          const a=Math.cos(h.angle),b=Math.sin(h.angle);return Math.abs(dx*a+dz*b)<h.length/2+margin&&Math.abs(-dx*b+dz*a)<h.width/2+margin;
        };
        let recovery=false,travel=0,last={x:p.pos.x,z:p.pos.z},maxWarnings=0,earlyRecovery=false,goal=null;
        const path=[],hurtCalls=[],originalHurt=p.hurt;
        p.hurt=function(...args){const before=this.hp,result=originalHurt.apply(this,args);hurtCalls.push({loss:Math.max(0,before-this.hp),accepted:!!result});return result;};
        try {
        for(let i=0;i<200&&e.state==='attack';i++){
          for(const add of g.enemies)if(add!==e&&add.alive){add.stun=10000;add.vel.set(0,0,0);add.kb.set(0,0,0);add.pos.set(r.x-r.w/2+2,0,r.z-r.h/2+2);}
          const pending=e.signatures.slots.filter(s=>s.event&&!s.hit).map(s=>s.event),at=Math.min(...pending.map(h=>h.at)),next=pending.filter(h=>h.at===at);
          if(next.length){
            let closest=Infinity;
            for(let x=r.x-r.w/2+2;x<=r.x+r.w/2-2;x+=.65)for(let z=r.z-r.h/2+2;z<=r.z+r.h/2-2;z+=.65){
              if(next.some(h=>dangerous(h,x,z)))continue;const d=Math.hypot(x-p.pos.x,z-p.pos.z);if(d<closest){closest=d;goal={x,z};}
            }
            if(!Number.isFinite(closest))throw Error(`No safe region ${start.key}`);
            const dx=goal.x-p.pos.x,dz=goal.z-p.pos.z,d=Math.hypot(dx,dz);g.input.joy.active=true;g.input.screenMove.x=d>.25?dx/d:0;g.input.screenMove.y=d>.25?dz/d:0;
          }else g.input.clear();
          app.step(.05,false);travel+=Math.hypot(p.pos.x-last.x,p.pos.z-last.z);last={x:p.pos.x,z:p.pos.z};
          if(i%10===0)path.push({t:e.stateT,x:p.pos.x,z:p.pos.z,hp:p.hp});
          const opportunity=isRecoveryOpportunity(e);if(opportunity&&e.stateT<start.lastStrike)earlyRecovery=true;if(opportunity)recovery=true;
          maxWarnings=Math.max(maxWarnings,e.getPartyWarnings().length);
          if(e.stateT>=start.lastStrike+.12)break;
        }
        g.input.clear();app.step(.001,true);
        } finally {p.hurt=originalHurt;}
        const result={endHp:p.hp,netHpChange:p.hp-start.startHp,damage:hurtCalls.reduce((sum,hit)=>sum+hit.loss,0),hurtCalls,travel,fired:e.signatures.fired-start.firedBefore,hits:e.signatures.hits-start.hitsBefore,recovery,earlyRecovery,maxWarnings,path,state:e.state,stateT:e.stateT,signature:!!e.signatures.plan};
        if(result.fired!==start.events.length||!recovery||earlyRecovery||result.hits!==0||result.damage!==0)throw Error(`Cast QA failed ${start.key} phase ${start.phase}: ${JSON.stringify({start,...result})}`);
        return result;
      },start);
      boss.casts.push({...start,...result});await save();
      if(phase===2)await page.screenshot({path:path.join(out,`${chapter}-${key}-recovery.png`)});
      console.log(`${chapter} ${key} phase ${phase}: ${result.fired} strikes, movement ${result.travel.toFixed(1)}, no hit, recovery`);
    }
    boss.outcome=await page.evaluate(async()=>{
      const app=window.app,g=app.battle,e=g.boss,p=g.player;
      e.signatures.clear();e.state='chase';e.stun=0;e.hp=e.maxHp*.55;e.phase=0;e.atkCd=100;app.step(.05,false);if(e.phase!==1)throw Error('Actual HP phase 1 absent');
      e.hp=e.maxHp*.25;app.step(.05,false);if(e.phase!==2)throw Error('Actual HP phase 2 absent');
      const cast=e.def.phasePatterns[2].findIndex(k=>k==='archive_retrace'||k==='kiln_hammer'||k==='crown_verdict'||k==='bell_clap'||k==='tide_undertow'||k==='oath_tethers');
      e.patternTurn=Math.max(0,cast);e.state='chase';e.startAttack(3);
      // Stand inside a real strike as a negative control. Extra HP only prevents test death.
      const {hazardContains}=await import('/src/game/region-hazards.js'),h=e.signatures.plan.events[0],room=e.homeRoom;
      let spot=null;
      for(let x=room.x-room.w/2+2;x<=room.x+room.w/2-2&&!spot;x+=.5)for(let z=room.z-room.h/2+2;z<=room.z+room.h/2-2;z+=.5){if(hazardContains(h,x,z)){spot={x,z};break;}}
      if(!spot)throw Error('No damaging sample in actual boss room');
      const originalMax=p.maxHp;p.maxHp=Math.max(originalMax,e.atk*10);p.hp=p.maxHp;p.invuln=0;p.stun=0;p.kb.set(0,0,0);p.vel.set(0,0,0);p.pos.set(spot.x,0,spot.z);g.input.clear();
      if(g.apex){g.apex.shield=0;g.apex.shieldUntil=0;}
      const probeHp=p.hp,probeHits=e.signatures.hits;
      for(let i=0;i<100&&e.stateT<h.at+.08;i++)app.step(.05,false);
      const hitProbe={damage:probeHp-p.hp,hits:e.signatures.hits-probeHits,technique:e.special};
      if(hitProbe.damage<=0||hitProbe.hits!==1)throw Error(`Missing actual strike damage ${JSON.stringify(hitProbe)}`);
      e.signatures.clear();e.patternTurn=Math.max(0,cast);e.state='chase';e.startAttack(3);
      p.maxHp=originalMax;p.hp=originalMax;p.invuln=0;p.stun=0;p.kb.set(0,0,0);
      // Death cancellation through the actual damage/kill/victory/settlement path.
      const snapshot=()=>({gold:app.eco.s.gold,gems:app.eco.s.gems,stages:app.eco.s.quests.stages,campaignWins:app.expedition.s.stats.campaignWins});
      const before=snapshot();p.hp=p.maxHp;
      g.damageEnemy(e,e.hp*4,{kind:'magic',kb:0,noProc:true});
      if(e.alive||e.signatures.plan||e.signatures.slots.some(s=>s.mesh.visible))throw Error('Death left signature active');
      for(let i=0;i<300&&!g.result?.reward;i++)app.step(.05,false);
      if(!g.result?.win||!g.result.reward||!app.ui.el.result.classList.contains('show'))throw Error('Controlled boss defeat did not reach paid result');
      const settled=snapshot(),receipt=g.result.reward,code=g.stage.code;
      const campaignReward=g.result.campaignReward;
      if(!campaignReward||campaignReward.xp!==35)throw Error(`Campaign reward receipt missing ${code}`);
      for(const k of ['gold','gems']){const paid=receipt.got.filter(r=>r.k===k).reduce((n,r)=>n+r.n,0)+(k==='gold'?campaignReward.levelGold:0);if(paid<=0||settled[k]-before[k]!==paid)throw Error(`Reward mismatch ${code} ${k}: ${JSON.stringify({before,settled,paid,receipt,campaignReward})}`);}
      if(settled.stages!==before.stages+1||settled.campaignWins!==before.campaignWins+1||!g.result.expeditionRecorded)throw Error(`Campaign progress missing ${code}`);
      const persisted=JSON.parse(localStorage.getItem('bladesurge_save_v1'));
      if(persisted.gold!==settled.gold||persisted.gems!==settled.gems||persisted.progress.stars[code]!==g.result.stars||persisted.progress.unlocked<Math.min(60,g.stage.idx+1)||persisted.expedition.stats.campaignWins!==settled.campaignWins)throw Error(`Persisted reward missing ${code}`);
      g.victory();app.ui.showResult(g,true);app.ui.hideResult();app.ui.showResult(g,true);
      if(JSON.stringify(snapshot())!==JSON.stringify(settled))throw Error('Duplicate result reward');
      return {phase1:true,phase2:true,hitProbe,win:g.result.win,chronicleSettled:!!g.run?.settled,before,settled,receipt:receipt.got,campaignReward,progressPersisted:true,duplicatePrevented:true};
    });
    if(boss.outcome.campaignReward.levelGold)await page.locator('#result-loot .nm').filter({hasText:'탐험 레벨업'}).waitFor({timeout:10000});
    await page.screenshot({path:path.join(out,`${chapter}-result.png`)});
    await page.evaluate(async()=>{const app=window.app;await app.toLobby();if(app.battle.enemies.length||app.scene.getObjectByName('boss-signatures'))throw Error('Signature survives lobby teardown');});
    boss.outcome.cleaned=true;await save();
  }
  if(report.errors.length)throw Error('Browser runtime errors');report.status='pass';
}catch(e){report.status='fail';report.error=String(e.stack||e);process.exitCode=1;}
finally{await browser?.close();await server?.close();report.finished=new Date().toISOString();await save();}
console.log(JSON.stringify({status:report.status,bosses:report.bosses.length,error:report.error}));
