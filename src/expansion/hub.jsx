import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import { DUNGEONS, MATERIALS, MATERIAL_REFINING, CONSUMABLES, JOBS, RECIPES, ARENA_RIVALS } from '../data/expansion.js';
import { ITEM_BY_ID, ITEM_ICON, SETS, RARITY_COLOR, rarityRank } from '../data/items.js';
import { HEROES } from '../data/heroes.js';
import { audio } from '../engine/audio.js';
import { playExpeditionIntro } from './cinematic.js';
import './hub.css';
import './app-content.css';

const fmt = n => Math.floor(n || 0).toLocaleString('ko-KR');
const MATERIAL_ART = { glass_leaf: '/img/icon_fragment.webp', ember_core: '/img/icon_stone_2.webp', star_dust: '/img/icon_stone_3.webp' };
const ART = { glass_garden: '/img/expansion/glass_garden.webp', ember_vault: '/img/expansion/ember_vault.webp', star_archive: '/img/expansion/star_archive.webp', arena: '/img/expansion/arena.webp', guild_map: '/img/expansion/guild_map.webp' };
const COLORS = { glass_garden: '#9be1ba', ember_vault: '#ffad6e', star_archive: '#9bbdff' };
const SUBTITLES = { glass_garden: 'GLASS CONSERVATORY', ember_vault: 'EMBER TREASURY', star_archive: 'ASTRAL ARCHIVE' };
const OBJECTIVES = { glass_garden: '갈림길을 돌파하고 정원의 수호자를 정화하세요.', ember_vault: '좁은 제련 통로에서 화염 경고를 피하세요.', star_archive: '서리 기록을 피해 별빛 지식을 되찾으세요.' };

function Art({src, fallback='/img/bg_loading.webp', ...rest}) { return <img {...rest} src={src} onError={e => { if (!e.currentTarget.dataset.fallback) { e.currentTarget.dataset.fallback = '1'; e.currentTarget.src = fallback; } }} />; }
function Gem({reduced}) {
  const group = useRef();
  useFrame((_,dt) => { if (group.current && !reduced) group.current.rotation.y += Math.min(dt,.05)*.3; });
  return <group ref={group} rotation={[.2,.4,.1]}>
    <mesh><octahedronGeometry args={[1,0]}/><meshStandardMaterial color="#a5ebd1" metalness={.52} roughness={.23}/></mesh>
    <mesh rotation={[Math.PI/2,.15,0]}><torusGeometry args={[1.38,.026,8,48]}/><meshStandardMaterial color="#efd49c" metalness={.8} roughness={.3}/></mesh>
    <mesh position={[0,-1.45,0]} rotation={[-Math.PI/2,0,0]}><circleGeometry args={[1.05,48]}/><meshStandardMaterial color="#173e38" roughness={.8}/></mesh>
  </group>;
}
function ForgePreview({app}) {
  const reduced = app.reducedMotion.matches;
  return <div className="exp-relic" aria-label="제작 재료의 3D 미리보기">
    {app.eco.s.settings.quality === 'low' ? <img src="/img/icon_stone_3.webp" alt="별빛 결정"/> : <Canvas dpr={[1,1.4]} camera={{position:[0,.6,4.7],fov:38}} frameloop={reduced?'demand':'always'} gl={{antialias:true,alpha:true,powerPreference:'low-power'}}><ambientLight intensity={1.6}/><directionalLight position={[3,4,3]} intensity={3}/><directionalLight position={[-3,1,-2]} color="#76bff1" intensity={2}/><Gem reduced={reduced}/></Canvas>}
  </div>;
}
function RewardChips({rewards={}}) { return <div className="exp-chips">{rewards.gold>0 && <span>골드 +{fmt(rewards.gold)}</span>}{rewards.xp>0 && <span>원정 EXP +{fmt(rewards.xp)}</span>}{MATERIALS.filter(m=>rewards.materials?.[m.id]).map(m=><span key={m.id}>{m.name} +{rewards.materials[m.id]}</span>)}{CONSUMABLES.filter(m=>rewards.consumables?.[m.id]).map(m=><span key={m.id}>{m.name} +{rewards.consumables[m.id]}</span>)}</div>; }

function RunGrowth({app}) {
  const r=app.battle?.result?.masterworks;if(!r)return null;
  return <section className="exp-growth" aria-label="이번 원정의 성장"><p>기억에 남은 성장</p><div className="exp-chips"><span>명성 +{r.renown}</span><span>균형 붕괴 {r.breaks}</span><span>정확 회피 {r.perfects}</span><span>각인 {r.boons.length}개</span></div><p>획득한 명성과 발견 기록은 다음 도전에도 남습니다.</p><button onClick={()=>app.battle.chronicle.open('mastery')}>명성으로 영구 숙련 배우기</button></section>;
}

function LootReveal({loot=[]}) {
  const best=loot.map(i=>({...i,def:ITEM_BY_ID[i.id]})).filter(i=>i.def).sort((a,b)=>rarityRank(b.def.rarity)-rarityRank(a.def.rarity)).slice(0,6);
  if(!best.length)return null;
  return <div className="exp-loot-reveal" aria-label="획득 장비"><p>이번 원정의 전리품</p><div>{best.map((i,n)=><article key={i.uid} style={{'--loot-color':RARITY_COLOR[i.def.rarity],'--loot-delay':`${n*65}ms`}}><small>{i.def.rarity}</small><Art src={ITEM_ICON(i.def)} alt=""/><b>{i.def.name}</b></article>)}</div>{loot.length>6&&<small>외 {loot.length-6}개 · 모든 장비가 가방에 보관되었습니다</small>}</div>;
}

function Panel({controller, revision}) {
  const app=controller.app, service=app.expedition, s=service.snapshot();
  const tab=controller.initialTab||'dungeons';
  const [message,setMessage]=useState('');
  const [craftFilter,setCraftFilter]=useState('all');
  const focusRef=useRef();
  useEffect(()=>{focusRef.current?.focus();},[]);
  const run=fn=>{const result=fn(); if (result?.ok===false) {setMessage(result.error||'조건을 확인해 주세요.');audio.play('ui_error');} else {setMessage('진행이 저장되었습니다.');audio.play('ui_glass',{vol:.4});} controller.render();};
  const launch=async(kind,id)=>{setMessage('원정을 준비하고 있습니다…'); const ok=await app.startExpedition(kind,id);if(!ok){setMessage('출격 조건 또는 준비 상태를 확인해 주세요.');controller.render();}};
  const selectJob=id=>run(()=>{const result=service.selectJob(id);if(result?.ok!==false){const job=JOBS.find(j=>j.id===id);if(job) app.eco.s.selected=job.heroId;app.eco.emit();app.showcaseHero(app.eco.s.selected,true);}return result;});
    const result=controller.result;
  return <section className="exp-shell" aria-labelledby="exp-title">
    <header className="exp-header"><div className="exp-brand"><h1 id="exp-title">{result?'원정 결과':({dungeons:'재료 던전',forge:'장비 제작 · 정련',jobs:'전직',quests:'원정 퀘스트',arena:'결투장'})[tab]}</h1></div><div className="exp-account"><span>원정 Lv.<b>{s.level}</b></span><div className="exp-xp" title={`${s.xp} / ${s.nextXp} EXP`}><i style={{width:`${Math.min(100,s.xp/s.nextXp*100)}%`}}/></div><small>{fmt(s.xp)} / {fmt(s.nextXp)} EXP</small></div><button ref={focusRef} className="exp-close" onClick={()=>controller.close()}>로비</button></header>
    <div className="exp-scroll">
    {result && <RunGrowth app={app}/>}
    {!result && tab==='dungeons' && <button className="exp-film-link" onClick={()=>playExpeditionIntro(app,'glass_garden',{force:true})}>▷ 유리 정원 · 지역 영상</button>}
    {result ? <div className="exp-outcome"><span className="exp-eyebrow">{result.win?'EXPEDITION COMPLETE':'A NEW ATTEMPT AWAITS'}</span><h2>{result.win?'다시, 한 걸음 더.':'다음 도전을 준비하세요.'}</h2><p>{result.name}</p><div className="exp-outcome-stats"><span><b>{result.kills}</b>처치</span><span><b>{result.combo}</b>최대 콤보</span><span><b>{Math.floor(result.time)}초</b>전투 시간</span></div><RewardChips rewards={result.rewards}/>{!result.saveError&&<LootReveal loot={result.rewards.loot}/>}{result.saveError?<div role="alert"><p>아직 정산을 저장하지 못했습니다. 이 창을 유지하고 저장 공간을 확인해 주세요.</p><button className="exp-primary" onClick={()=>controller.showResult(app.battle,result.win)}>정산 다시 저장</button></div>:result.win&&<><p>영웅 EXP +{result.rewards.heroExp||0} · 장비 {result.rewards.loot?.length||0}개 · 강화석 +{result.rewards.stones||0}</p><p>원정 경험치와 전리품이 저장되었습니다. 완료한 퀘스트도 확인하세요.</p></>}<div className="exp-actions" inert={result.saveError?true:undefined}><button className="exp-primary" onClick={()=>launch(result.kind,result.id)}>다시 도전</button><button onClick={()=>{controller.result=null;app.toLobby();controller.open('forge');}}>전리품 정비</button><button onClick={()=>{controller.result=null;app.toLobby();controller.open('quests');}}>퀘스트 확인</button></div></div> : <>
    {tab==='dungeons'&&<><div className="exp-loadout-strip"><Art src={HEROES[app.eco.s.selected].portrait} alt="출전 영웅"/><span><b>{HEROES[app.eco.s.selected].name}</b> · {JOBS.find(j=>j.id===s.selectedJob&&j.heroId===app.eco.s.selected)?.name||'기본 직업'} · Lv.{app.eco.hero().level}</span><button onClick={()=>app.meta.openTab('heroes')}>장비 관리</button></div><div className="exp-dungeon-grid">{DUNGEONS.map((d,i)=>{const access=service.dungeonAccess(d.id);const locked=access?.ok===false;return <article key={d.id} className="exp-dungeon" style={{'--exp-accent':COLORS[d.id]}}><div className="exp-dungeon-art"><Art src={ART[d.id]} alt={d.name+' 던전 원화'}/><span className="exp-number">0{i+1}</span><div className="exp-dungeon-badges"><span>원정 Lv.{d.minLevel}</span><span>에너지 {d.energy}</span></div></div><div className="exp-card-body"><small>{SUBTITLES[d.id]}</small><h3>{d.name}</h3><p>{OBJECTIVES[d.id]}</p><div className="exp-material-reward">{MATERIALS.filter(m=>d.rewards.materials?.[m.id]).map(m=><React.Fragment key={m.id}><img src={MATERIAL_ART[m.id]} alt=""/><span>{m.name}<b>확정 +{d.rewards.materials[m.id]}</b></span></React.Fragment>)}<em>EXP +{d.rewards.xp}</em></div><button className="exp-primary" disabled={locked||app.stageStarting} onClick={()=>launch('dungeon',d.id)}>{locked?`원정 Lv.${d.minLevel}에 해금`:'던전 입장'}<span>↗</span></button></div></article>;})}</div></>}
    {tab==='forge'&&<><div className="exp-section-heading"><div><span className="exp-eyebrow">THE ART OF FORGING</span><h2>전리품에, 쓰임을.</h2><p>원정 재료로 원하는 장비를 확정 제작합니다.</p></div><button onClick={()=>{controller.close();app.meta.openTab('heroes');}}>장착 · 강화 ↗</button></div><div className="exp-forge-layout"><aside className="exp-forge-aside"><ForgePreview app={app}/><h3>원정 재료 보관함</h3>{MATERIALS.map(m=><div className="exp-material-line" key={m.id}><img src={MATERIAL_ART[m.id]} alt=""/><span>{m.name}<small>{m.description}</small></span><b>{fmt(s.materials[m.id])}</b></div>)}<h3>강화석 정련</h3><div className="exp-refining">{MATERIAL_REFINING.map(r=><button key={r.id} disabled={!s.materials[r.id]||app.eco.s.gold<r.gold} onClick={()=>run(()=>service.refineMaterial(r.id))}><span>{r.name} · {r.stones||r.stones2||r.stones3}개<small>{MATERIALS.find(m=>m.id===r.id)?.name} 1개 · ◈ {fmt(r.gold)}</small></span><b>정련 ↗</b></button>)}</div><p>재료는 던전과 퀘스트에서 획득합니다. 제작한 장비는 영웅의 가방에 보관됩니다.</p></aside><div><div className="exp-filter">{[['all','전체'],['gear','장비'],['potion','소모품']].map(([v,n])=><button key={v} className={craftFilter===v?'active':''} onClick={()=>setCraftFilter(v)}>{n}</button>)}</div><div className="exp-recipe-grid">{RECIPES.filter(r=>craftFilter==='all'||(craftFilter==='gear'?r.itemId:!r.itemId)).map(r=>{const enough=app.eco.s.gold>=r.gold&&Object.entries(r.materials||{}).every(([k,n])=>s.materials[k]>=n);const item=ITEM_BY_ID[r.itemId];const potion=CONSUMABLES.find(c=>r.consumables?.[c.id]);return <article key={r.id} className="exp-recipe"><Art src={item?ITEM_ICON(item):`/img/expansion/${potion?.id}.webp`} fallback={item?'/img/icon_chest.webp':'/img/icon_bless.webp'} alt=""/><div><small>{item?(SETS[item.set]?.name||'원정 장비'):'전투 소모품'}</small><h3>{r.name}</h3><p>{item?SETS[item.set]?.four?.text:potion?.description}</p><div className="exp-cost">{Object.entries(r.materials||{}).map(([k,n])=><span key={k} className={s.materials[k]<n?'short':''}>{MATERIALS.find(m=>m.id===k)?.name} {s.materials[k]}/{n}</span>)}<span>◈ {fmt(r.gold)}</span></div></div><button disabled={!enough} onClick={()=>run(()=>service.craft(r.id))}>제작</button></article>;})}</div></div></div></>}
    {tab==='jobs'&&<><div className="exp-section-heading"><div><span className="exp-eyebrow">SAME HERO. NEW INSTINCT.</span><h2>익숙한 얼굴, 새로운 전투.</h2><p>영웅의 정체성은 그대로. 손끝에서 달라지는 전투 리듬.</p></div><button onClick={()=>selectJob(null)}>기본 직업으로</button></div><div className="exp-jobs">{JOBS.map(j=>{const unlocked=s.unlockedJobs.includes(j.id),eligible=s.claimed.includes(j.questId),selected=s.selectedJob===j.id;return <article key={j.id} className={'exp-job '+(selected?'selected':'')}><Art src={`/img/expansion/${j.id}.webp`} fallback={HEROES[j.heroId].portrait} alt={j.name+' 문장'}/><div><small>{HEROES[j.heroId].name} / {j.id==='guardian'?'GUARDIAN':'RANGER'}</small><h3>{j.name}</h3><p>{j.id==='guardian'?'적의 공격을 받아내고 반격하는 방패 전투. 정확한 타이밍이 더 큰 한 방으로 돌아옵니다.':'거리를 만들고 관통 사격을 연결하는 전투. 빠르게 위치를 바꾸며 적의 대열을 무너뜨립니다.'}</p><ul>{(j.id==='guardian'?['방패 반격 · 밀집한 적을 제압','짧고 묵직한 타격 리듬','결의 3중첩으로 강화 반격']:['관통 사격 · 거리를 이용한 전투','기동과 연사로 만드는 공격 창','집중 3중첩으로 관통탄 강화']).map(t=><li key={t}>{t}</li>)}</ul><button className="exp-primary" disabled={selected||(!unlocked&&!eligible)} onClick={()=>unlocked?selectJob(j.id):run(()=>service.unlockJob(j.id))}>{selected?'현재 선택한 직업':unlocked?'이 직업으로 전직':eligible?'직업 해금':j.id==='guardian'?'서약 퀘스트 보상을 받으세요':'유리 정원 퀘스트를 완료하세요'}</button></div></article>;})}</div></>}
    {tab==='quests'&&<><div className="exp-section-heading"><div><span className="exp-eyebrow">EVERY STEP MATTERS</span><h2>당신의 모험이 기록됩니다.</h2><p>완료한 퀘스트를 수령해 원정 레벨과 새로운 직업을 여세요.</p></div><span className="exp-pill">{s.claimed.length} / {s.quests.length} 완료</span></div><div className="exp-journal-art"><Art src={ART.guild_map} alt="유리 정원과 잿불 금고, 별빛 서고의 모험 지도"/></div><div className="exp-quests">{s.quests.map((q,i)=><article key={q.id} className={'exp-quest '+(q.claimed?'claimed':q.ready?'ready':'')}><span className="exp-quest-index">{q.claimed?'✓':String(i+1).padStart(2,'0')}</span><div><h3>{q.name}</h3><RewardChips rewards={q.rewards}/><div className="exp-progress"><i style={{width:`${Math.min(100,q.cur/q.target*100)}%`}}/></div><small>{Math.min(q.cur,q.target)} / {q.target}</small></div><button className={q.ready&&!q.claimed?'exp-primary':''} disabled={q.claimed||!q.ready} onClick={()=>run(()=>service.claimQuest(q.id))}>{q.claimed?'수령 완료':q.ready?'보상 받기':'진행 중'}</button></article>)}</div></>}
    {tab==='arena'&&<><div className="exp-arena-banner"><Art src={ART.arena} alt="결투장 원화"/><div><span className="exp-eyebrow">THE CIRCLE OF VALOR</span><h2>한 명의 상대.<br/>당신의 모든 실력.</h2><p>AI 상대와 겨루는 무료 연습 결투장</p><span className="exp-pill">결투 점수 {fmt(s.rating)}</span></div></div><div className="exp-rivals">{ARENA_RIVALS.map((r,i)=><article key={r.id}><span className="exp-rival-rank">{['I','II','III'][i]}</span><Art src={i===2?'/img/boss_lich.webp':'/img/boss_warlord.webp'} alt="AI 훈련 상대"/><div><small>AI RIVAL / Lv.{r.minLevel}</small><h3>{r.name}</h3><p>{['방패와 강타의 빈틈을 찾으세요.','빠른 돌진 이후의 공격 창을 노리세요.','서리 경고를 읽고 거리를 좁히세요.'][i]}</p><RewardChips rewards={r.rewards}/></div><button className="exp-primary" disabled={s.level<r.minLevel} onClick={()=>launch('arena',r.id)}>{s.level<r.minLevel?`Lv.${r.minLevel}에 해금`:'결투 시작'}</button></article>)}</div><p className="exp-note">결투 점수와 진행은 이 브라우저에 저장됩니다. AI 전투이며 다른 플레이어와 연결되지 않습니다.</p></>}
    </>}
    </div><footer className="exp-footer"><span role="status" aria-live="polite">{message||'던전과 퀘스트에서 성장 재료를 획득하세요.'}</span><span>✦ {app.eco.storageStatus==='ready'?'진행 자동 저장':'저장 상태 확인 필요'}</span></footer>
  </section>;
}

export class ExpeditionUI {
  constructor(app) {
    this.app=app;this.opened=false;this.revision=0;this.result=null;
    const panel=document.querySelector('#tab-stage > .panel');
    this.campaign=document.createElement('div');this.campaign.id='campaign-view';
    while(panel.firstChild)this.campaign.append(panel.firstChild);
    this.nav=document.createElement('nav');this.nav.className='adventure-nav';this.nav.setAttribute('aria-label','모험 메뉴');
    for(const [id,label] of [['campaign','캠페인'],['dungeons','던전'],['arena','결투장'],['forge','공방'],['jobs','전직'],['quests','퀘스트']]){
      const b=document.createElement('button');b.type='button';b.dataset.section=id;b.textContent=label;
      b.onclick=()=>{if(this.result?.saveError)return;if(this.result){this.result=null;this.app.toLobby();}this.app.meta.openTab('stage',id);};this.nav.append(b);
    }
    this.host=document.createElement('div');this.host.id='expedition-root';this.host.hidden=true;
    panel.append(this.nav,this.campaign,this.host);this.root=createRoot(this.host);
    this.entry=document.getElementById('btn-expedition');
    this.potions=document.createElement('div');this.potions.className='exp-potions';this.potions.setAttribute('aria-label','전투 소모품');document.getElementById('hud').append(this.potions);
    this.combatStatus=document.createElement('div');this.combatStatus.className='exp-combat-status';document.getElementById('hud').append(this.combatStatus);
    for(const [i,c] of CONSUMABLES.entries()){const b=document.createElement('button');b.dataset.potion=c.id;b.title=`${c.name} · ${['U','I','O'][i]} · ${c.description}`;b.innerHTML=`<img src="/img/expansion/${c.id}.webp" alt=""><b>0</b><small>${['U','I','O'][i]}</small>`;b.onclick=()=>this.usePotion(c.id);this.potions.append(b);}
    document.addEventListener('keydown',e=>{if(e.repeat||e.target?.matches('input,textarea,[contenteditable="true"]'))return;const id={u:'hp_tonic',i:'overdrive',o:'aegis'}[e.key.toLowerCase()];if(id&&app.mode==='battle'){e.preventDefault();this.usePotion(id);}});
    app.eco.onChange(()=>{this.refreshPotions();if(this.opened)this.render();});this.refreshPotions();
  }
  refreshPotions(){const s=this.app.expedition.snapshot();for(const b of this.potions.children){const c=CONSUMABLES.find(x=>x.id===b.dataset.potion),n=s.consumables[c.id]||0;b.querySelector('b').textContent=n;b.disabled=n<1;b.setAttribute('aria-label',`${c.name} ${n}개 사용`);}const n=s.quests.filter(q=>q.ready&&!q.claimed).length;this.entry.dataset.ready=String(n);}
  updateCombatStatus(b){
    const p=b.player,parts=[];
    if(p.def.jobId)parts.push(`${p.def.jobId==='guardian'?'결의':'집중'} ${'◆'.repeat(p.jobResource||0)}${'◇'.repeat(3-(p.jobResource||0))}`);
    if(b.stage.expedition?.kind==='arena')parts.push(b.bossFound?`결투 ${Math.max(0,Math.ceil(150-b.duelElapsed))}초`:'결투장으로 이동');
    if(p.tonicAtkT>0)parts.push(`공격 강화 ${Math.ceil(p.tonicAtkT)}초`);
    if(p.tonicGuardT>0)parts.push(`수호 ${Math.ceil(p.tonicGuardT)}초`);
    const label=parts.join(' · ');if(this.combatStatus.textContent!==label)this.combatStatus.textContent=label;
    this.combatStatus.hidden=!label;
  }
  usePotion(id){const app=this.app,n=app.expedition.snapshot().consumables[id];if(!n||!app.battle.active||app.battle.paused||app.ui.el.modal.classList.contains('show'))return;if(!app.battle.canApplyConsumable(id))return;const r=app.expedition.consume(id);if(r.ok){app.battle.applyConsumable(id);audio.magic({vol:.24,notes:[0,7,12],step:.05});app.ui.toast(CONSUMABLES.find(c=>c.id===id).name+' 사용','gold');}else app.ui.toast(r.error,'red');this.refreshPotions();}
  syncTab(tab,section='campaign'){
    const show=tab==='stage'&&section!=='campaign';
    this.opened=show;this.host.hidden=!show;this.campaign.hidden=show;
    this.nav.querySelectorAll('button').forEach(b=>{b.classList.toggle('on',b.dataset.section===section);b.setAttribute('aria-pressed',String(b.dataset.section===section));b.disabled=!!this.result?.saveError;});
    document.body.classList.toggle('expedition-open',show);
    if(show){this.initialTab=section;this.viewSeq=(this.viewSeq||0)+1;this.render();}else this.root.render(null);
  }
  open(tab='dungeons'){
    if(this.app.mode==='battle'&&this.app.battle.active)return;
    this.app.ui.closeModal();this.app.ui.hideResult();this.app.ui.show(document.getElementById('meta'),true);
    this.app.meta.openTab('stage',tab);
  }
  close(){
    if(this.result?.saveError){this.app.ui.toast('전리품 정산을 먼저 저장해 주세요.','red');return;}
    const hadResult=!!this.result;this.result=null;
    if(hadResult)this.app.toLobby();else this.app.meta.openTab('home');
  }
  render(){if(this.opened)this.root.render(<Panel key={this.viewSeq||0} controller={this} revision={++this.revision}/>);}
  showResult(b,win){
    const r=b.result;if(!r)return;
    if(!r.expeditionReceipt?.ok){r.expeditionReceipt=this.app.expedition.settle(this.app.expeditionTicket,{win,kills:b.kills,fieldRewards:{fieldGold:b.drops.gold,fieldStones:b.drops.stones,fieldStones2:b.drops.stones2,fieldStones3:b.drops.stones3,fieldFragments:b.drops.fragments},fieldLoot:b.drops.loot});if(r.expeditionReceipt.ok)this.app.expeditionTicket=null;}
    this.app.ui.showHud(false);this.app.ui.show(this.app.ui.el.pause,false);this.app.ui.closeModal();
    this.result={win,kind:b.stage.expedition.kind,id:b.stage.expedition.id,name:b.stage.name,kills:b.kills,combo:b.maxCombo,time:b.elapsed,rewards:r.expeditionReceipt.rewards||{},saveError:!r.expeditionReceipt.ok?r.expeditionReceipt.error:null};
    this.open('dungeons');audio.play(win?'jingle_win1':'ui_error',{vol:.5});
  }
}
