import { openLobby } from './lobby-weapon-clip-qa.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
const [origin='http://127.0.0.1:5189', out, baseline] = process.argv.slice(2);
await fs.mkdir(out,{recursive:true});
const {browser,page}=await openLobby(origin,'no-preference');
try {
  await page.evaluate(async()=>{app.ui.closeModal?.();app.eco.s.selected='mage';await app.showcaseHero('mage',true);app.expedition.s.level=10;app.eco.s.energy=100;app.meta?.refresh?.();app.syncHub?.();});
  const target=page.locator('.dl-pick[data-dungeon-id="star_archive"]').first();
  await target.scrollIntoViewIfNeeded();await target.tap();await page.locator('#citadel-dungeon-prepare').tap();await page.locator('.citadel-hub-go').tap();
  await page.waitForFunction(()=>app.mode==='battle'&&app.battle?.active,null,{timeout:40000});
  await page.evaluate(()=>{app.battle.player.invuln=1e9;app.ui.closeModal?.();});
  await page.waitForTimeout(1000);
  await page.screenshot({path:path.join(out,'mage-battle-idle.png')});
  await page.keyboard.down('KeyJ');
  await page.waitForFunction(() => app.battle.player.state === 'attack', null, { timeout: 10000 });
  const inputState=await page.evaluate(()=>({hero:app.battle.player.def.id,state:app.battle.player.state,clip:app.battle.player.actionName,showcaseReleased:app.showcase===null}));
  await page.screenshot({path:path.join(out,'mage-battle-attack.png')});
  await page.keyboard.up('KeyJ');
  const clips=await page.evaluate(()=>{
    const p=app.battle.player, result={};
    // 실제 전투 입장·입력과 분리된 결정적 클립 표본. 비동기 RAF가 끼지 않는 한 evaluate 안에서 채집한다.
    for(const name of [...new Set(['Idle',...p.def.combo.map(c=>c.anim).filter(Boolean),p.actionName])]){
      const clip=p.clips[name];if(!clip)continue;p.mixer.stopAllAction();p.mixer.clipAction(clip).reset().play();
      result[name]=[];for(let i=0;i<12;i++){p.mixer.setTime(clip.duration*i/12);const bones=[];p.model.traverse(b=>{if(b.isBone)bones.push({name:b.name,q:b.quaternion.toArray(),p:b.position.toArray()});});result[name].push(bones);}
    }
    return result;
  });
  const report={inputState,clips};
  if(baseline){const before=JSON.parse(await fs.readFile(baseline,'utf8'));report.identical=JSON.stringify(before.clips)===JSON.stringify(clips);if(!report.identical)throw new Error('전투 뼈 표본이 기준선과 다름');}
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({inputState,clipNames:Object.keys(clips),identical:report.identical}));
}finally{await browser.close();}
