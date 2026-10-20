import { openLobby, measureLobby } from './lobby-weapon-clip-qa.mjs';
import fs from 'node:fs/promises';
const {browser,page}=await openLobby('http://127.0.0.1:5189');
try {
  const rows=[];
  for(const hero of ['knight','barbarian','mage','rogue','ranger']){
    await page.evaluate(async hero=>{app.eco.s.selected=hero;await app.showcaseHero(hero,true);},hero);
    rows.push(await page.evaluate(measureLobby,{samples:120}));
  }
  const reducedMotion=await page.evaluate(async()=>{
    await app.showcaseHero('mage',true);const s=app.showcase;
    const bones=[];s.root.traverse(b=>{if(b.isBone)bones.push(b);});
    const before=bones.map(b=>b.quaternion.toArray());
    for(let i=0;i<300;i++)app.step(1/60,false);
    const stable=JSON.stringify(before)===JSON.stringify(bones.map(b=>b.quaternion.toArray()));
    const time=s.mixer.time;await app.showcaseHero('knight',true);
    const disposedBefore=JSON.stringify(bones.map(b=>b.quaternion.toArray()));s.pose.apply();
    return {enabled:app.reducedMotion.matches,frames:300,stable,mixerTime:time,disposedNoop:disposedBefore===JSON.stringify(bones.map(b=>b.quaternion.toArray()))};
  });
  await fs.writeFile('C:/Users/heart/AppData/Local/APEX/gogo/aljjang95-blade-surge/cycles/20261018-hero-pose-audit/dense-and-reduced.json',JSON.stringify({rows,reducedMotion},null,2));
  console.log(JSON.stringify({rows:rows.map(r=>({hero:r.hero,...r.summary})),reducedMotion}));
}finally{await browser.close();}
