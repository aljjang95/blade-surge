// 모든 마법사 스킬의 실제 발사·범위·번개 시작 위치를 플레이어 상대좌표로 기록한다.
// 수정 전 JSON을 마지막 인자로 주면 위치·방향·타이밍·횟수가 정확히 같은지 비교한다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openPage, installProbe } from './combat-pose-qa.mjs';
const [origin='http://127.0.0.1:5311',out='work/mage-overlap/origins',beforePath]=process.argv.slice(2);
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=d3d11']});
const report={origin,scope:'격리 Chromium의 실제 마법사 8스킬 재생. 적은 위치 고정·무적, 난수 고정. 발사·범위·번개 위치는 플레이어 상대좌표(m), 시각은60Hz 프레임. 실기기 아님.',rows:[],errors:[]};
try {
 const {page}=await openPage(browser,origin);page.on('pageerror',e=>report.errors.push(e.message));
 await page.evaluate(installProbe);await page.evaluate(()=>__poseQA.startBattle('mage'));await page.waitForFunction(()=>app.battle?.active&&app.input.enabled);
 report.rows=await page.evaluate(()=>{
  const b=app.battle,p=b.player,T=__THREE,q=__poseQA; q.freeze();b.maxAlive=0;
  for(const e of b.enemies){e.update=()=>{};e.pos.set(5000,0,5000);}
  const enemyKey=Object.keys(__EN).find(k=>!__EN[k].boss&&!__EN[k].elite&&app.models[__EN[k].model]);
  const enemy=b.spawnEnemy(enemyKey,null,null,p.pos.clone().add(new T.Vector3(2,0,3)));
  if(!enemy)throw new Error('발사 위치 표본 적 생성 실패');
  enemy.update=()=>{};enemy.maxHp=enemy.hp=1e12;enemy.spawning=false;enemy.state='chase';enemy.hurt=()=>1;
  const realRandom=Math.random,rows=[],saved=[],num=x=>Math.round(x*1e6)/1e6;
  let events=[],frame=0,anchor=p.pos.clone();
  const vec=(v,relative)=>v?.isVector3? [num(v.x-(relative?anchor.x:0)),num(v.y-(relative?anchor.y:0)),num(v.z-(relative?anchor.z:0))]:null;
  const hook=(object,key,record)=>{const fn=object[key];object[key]=function(...args){record(args);return fn.apply(this,args);};saved.push(()=>object[key]=fn);};
  hook(b,'spawnProjectile',([o])=>events.push({type:'projectile',frame,pos:vec(o.pos,true),dir:vec(o.dir,false),kind:o.kind}));
  hook(b,'hitRadius',([pos,radius])=>events.push({type:'radius',frame,pos:vec(pos,true),radius}));
  hook(b.fx,'boltTex',([from,to])=>events.push({type:'bolt',frame,from:vec(from,true),to:vec(to,true)}));
  hook(b.fx,'castCircle',([pos])=>events.push({type:'circle',frame,pos:vec(pos,true)}));
  try {
   for(let index=0;index<p.def.skills.length;index++){
    let state=1701+index;Math.random=()=>{state=(state*1664525+1013904223)>>>0;return state/4294967296;};
    p.state='idle';p.skillCtx=null;p.play('Idle',{fade:0});p.vel.set(0,0,0);p.kb.set(0,0,0);p.yaw=.6;p.cds.fill(0);p.mp=p.maxMp;p.ult=p.ultMax;p.invuln=1e9;p.stun=0;p.hp=p.maxHp;
    b.timers.length=0;b.pending.length=0;for(const pr of b.projectiles)pr.mesh?.removeFromParent();b.projectiles.length=0;
    for(let i=0;i<30;i++)app.step(1/60,false);
    anchor.copy(p.pos);events=[];frame=0;
    const cast=p.tryCastSkill(index),sk=p.def.skills[index];
    for(frame=1;frame<=480;frame++)app.step(1/60,false);
    rows.push({skill:sk.id,cast,shape:window.__skillAimShape(p,sk.id,{}),events});
   }
  }finally{Math.random=realRandom;for(const restore of saved.reverse())restore();}
  return rows;
 });
}finally{await browser.close();}
const baseline=beforePath?JSON.parse(await fs.readFile(beforePath,'utf8')):null;
report.sameAsBefore=baseline?JSON.stringify(report.rows)===JSON.stringify(baseline.rows):null;
report.pass=!report.errors.length&&report.rows.length===8&&report.rows.every(r=>r.cast&&r.events.length>0&&(r.skill!=='chain'||r.events.some(e=>e.type==='bolt')))&&report.sameAsBefore!==false;
await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({pass:report.pass,sameAsBefore:report.sameAsBefore,skills:report.rows.map(r=>({skill:r.skill,cast:r.cast,events:r.events.length})),errors:report.errors}));
if(!report.pass)process.exitCode=1;
