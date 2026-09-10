import { DUNGEONS, RECIPES, MATERIALS, CONSUMABLES } from '../data/expansion.js';
import { ITEM_BY_ID, SETS, ITEM_ICON } from '../data/items.js';
import { HEROES } from '../data/heroes.js';
import { riftForDay } from '../game/journey-rifts.js';
import { audio } from '../engine/audio.js';
import './journey.css';

const node=(tag,cls='',text='')=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
const button=(text,fn,key,cls='journey-action')=>{const e=node('button',cls,text);e.type='button';e.dataset.control=key;e.addEventListener('click',fn);return e;};
const fmt=v=>Math.round(v||0).toLocaleString('ko-KR');
const name=id=>MATERIALS.find(m=>m.id===id)?.name||CONSUMABLES.find(c=>c.id===id)?.name||id;
const errors={claimed:'이미 받은 보상입니다.',incomplete:'목표를 먼저 완료해 주세요.',prerequisite:'앞 단계 보상을 먼저 받아 주세요.',unknown:'선택을 다시 확인해 주세요.'};
const tabs=[['journey','성장 여정'],['contracts','오늘의 의뢰'],['target','목표 장비'],['supply','빠른 보급']];
function rewardText(r={}) {
  const out=[];for(const [key,label] of [['gold','골드'],['stones','강화석'],['xp','원정 EXP']])if(r[key])out.push(`${label} ${fmt(r[key])}`);
  for(const key of ['materials','consumables'])for(const [id,count] of Object.entries(r[key]||{}))out.push(`${name(id)} ${fmt(count)}`);
  return out.join(' · ');
}

export class JourneyView {
  constructor(app) {
    this.app=app;this.tab='journey';this.counts={};
    this.dialog=node('dialog','journey-dialog');this.dialog.id='journey';this.dialog.setAttribute('aria-labelledby','journey-title');
    const header=node('header','journey-header'),title=node('div');title.append(node('small','journey-eyebrow','한 걸음이 다음 모험을 바꾼다'));
    const h=node('h2','','성장 여정');h.id='journey-title';title.append(h);header.append(title,button('닫기',()=>this.close(),'close','journey-close'));
    this.nav=node('nav','journey-tabs');this.nav.setAttribute('aria-label','성장 여정 메뉴');
    for(const [id,label] of tabs)this.nav.append(button(label,()=>{this.tab=id;this.render();},`tab-${id}`));
    this.notice=node('p','journey-notice');this.notice.setAttribute('role','status');this.content=node('div','journey-content');
    this.dialog.append(header,this.nav,this.notice,this.content);document.body.append(this.dialog);
    this.dialog.addEventListener('cancel',e=>{e.preventDefault();this.close();});
    this.dialog.addEventListener('close',()=>this.releasePause());
    this.lobby=button('성장 여정',()=>this.open('journey'),'lobby','sq-btn journey-lobby');document.querySelector('.lobby-left')?.append(this.lobby);
    this.strip=button('',()=>this.open(this.nextTab||'journey'),'next-goal','journey-strip');document.querySelector('.lobby-bottom')?.prepend(this.strip);
    app.eco.onChange(()=>this.refresh());this.refresh();
  }
  get blocked(){return !!(this.app.battle?.active||this.app.stageStarting||this.app.expeditionUI?.result?.saveError);}
  blockNotice() {
    if(!this.blocked)return false;
    this.notice.textContent=this.app.expeditionUI?.result?.saveError?'아직 전리품 정산을 저장하지 못했습니다. 결과 화면에서 정산을 다시 저장해 주세요.':'전투를 마친 뒤 변경하거나 이동할 수 있습니다.';
    return true;
  }
  open(tab='journey') {
    if(this.app.stageStarting||this.app.mode==='boot')return;
    this.tab=tabs.some(t=>t[0]===tab)?tab:'journey';
    if(!this.dialog.open)this.trigger=document.activeElement;
    this.notice.textContent='';this.render();
    if(this.app.battle?.active)this.app.battle.setPaused('journey',true);
    if(!this.dialog.open)this.dialog.showModal();
    if(!this.refreshTimer)this.refreshTimer=setInterval(()=>{if(this.dialog.open)this.refresh();},1000);
  }
  releasePause(){clearInterval(this.refreshTimer);this.refreshTimer=null;this.app.battle?.setPaused('journey',false);if(this.trigger?.isConnected)this.trigger.focus({preventScroll:true});}
  close(){if(this.dialog.open)this.dialog.close();}
  navigate(action) {
    if(this.blockNotice())return {ok:false,error:'blocked'};
    this.close();const controller=this.app.expeditionUI;
    if(controller?.result){controller.result=null;this.app.toLobby();}
    else if(this.app.mode==='battle')this.app.toLobby();
    if(action==='heroes')this.app.meta.openTab('heroes');
    else if(action==='mastery')this.app.battle.chronicle.open('mastery');
    else controller.open(action);
    return {ok:true};
  }
  act(fn,success='보상을 받았습니다.') {
    if(this.blockNotice())return {ok:false,error:'blocked'};
    const r=fn();this.notice.textContent=r?.ok===false?(errors[r.error]||r.error):success;if(r?.ok)audio.play('ui_glass',{vol:.4});this.refresh(true);return r;
  }
  craftTarget(){const target=this.app.journey.target();return this.act(()=>target?this.app.expedition.craft(target.recipe.id):{ok:false,error:'목표 장비를 먼저 선택해 주세요.'},'목표 장비를 제작했습니다. 아래에서 장착할 수 있습니다.');}
  equipTarget(){const r=this.act(()=>this.app.journey.equipTarget(),'현재 영웅에게 장착했습니다.');if(r.ok)this.app.showcaseHero(this.app.eco.s.selected,true);return r;}
  sweep(id){const r=this.act(()=>this.app.expedition.sweepDungeon(id,this.counts[id]||1),'소탕 보급품을 받았습니다. 실전 의뢰 진척은 변하지 않습니다.');if(r.ok&&r.rewards?.levelGold)this.notice.textContent+=` 원정 레벨업 보너스 골드 ${fmt(r.rewards.levelGold)}도 받았습니다.`;return r;}
  async launchRift(id) {
    if(this.blockNotice())return false;
    this.close();if(this.app.expeditionUI?.result){this.app.expeditionUI.result=null;this.app.toLobby();}else if(this.app.mode==='battle')this.app.toLobby();
    return this.app.startExpedition('dungeon',id,{rift:true});
  }
  refresh(force=false) {
    const snap=this.app.journey.snapshot(),next=snap.steps.find(s=>!s.claimed);
    this.strip.textContent=next?`${next.ready?'보상 받기':'다음 목표'} · ${next.name}`:'성장 여정 완주 · 오늘의 의뢰 확인';
    this.nextTab=next?'journey':'contracts';
    const signature=JSON.stringify([snap,this.app.eco.s.gold,this.app.eco.s.energy,this.app.eco.s.sweep,this.blocked,this.app.eco.s.expedition.stats]);
    if(this.dialog.open&&(force||signature!==this.signature))this.render(snap);
    this.signature=signature;
  }
  render(snap=this.app.journey.snapshot()) {
    const same=this.renderedTab===this.tab,scroll=same?this.content.scrollTop:0,focus=same&&this.content.contains(document.activeElement)?document.activeElement.dataset.control:null;
    this.renderedTab=this.tab;this.content.replaceChildren();
    [...this.nav.children].forEach((e,i)=>e.setAttribute('aria-pressed',String(tabs[i][0]===this.tab)));
    if(this.tab==='journey')this.renderSteps(snap);else if(this.tab==='contracts')this.renderContracts(snap);else if(this.tab==='target')this.renderTarget(snap);else this.renderSupply(snap);
    if(focus)[...this.content.querySelectorAll('[data-control]')].find(e=>e.dataset.control===focus)?.focus({preventScroll:true});
    this.content.scrollTop=scroll;
  }
  banner(title,text,art='guild_map') {const e=node('section','journey-banner');e.style.backgroundImage=`linear-gradient(90deg,#102124ef,#10212460),url('/img/expansion/${art}.webp')`;e.append(node('h3','',title),node('p','',text));this.content.append(e);}
  renderSteps(snap) {
    const done=snap.steps.filter(s=>s.claimed).length;this.banner(`${done} / 6 · 나만의 모험을 시작하다`,'서약부터 숙련까지, 실제 플레이로 한 단계씩 완성하세요. 완료한 단계의 보상은 순서대로 받습니다.');
    const list=node('div','journey-grid');
    snap.steps.forEach((s,i)=>{const card=node('article',`journey-card ${s.claimed?'is-complete':''}`);card.append(node('small','journey-eyebrow',`${i+1}단계 · ${s.claimed?'보상 수령 완료':s.complete?'조건 달성':'진행 중'}`),node('h3','',s.name),node('p','',s.description),node('p','journey-rewards',rewardText(s.rewards)));
      const actions=node('div','journey-actions'),claim=button(s.claimed?'수령 완료':s.ready?'보상 받기':'앞 단계와 목표를 완료하세요',()=>this.act(()=>this.app.journey.claimStep(s.id)),`claim-step-${s.id}`);claim.disabled=this.blocked||!s.ready;
      actions.append(claim);if(!s.claimed){const go=button('목표로 이동',()=>this.navigate(s.action),`go-step-${s.id}`,'journey-secondary');go.disabled=this.blocked;actions.append(go);}card.append(actions);list.append(card);});this.content.append(list);
  }
  renderContracts(snap) {
    const c=snap.contracts,d=DUNGEONS.find(d=>d.id===c.rotationDungeonId),rift=riftForDay(this.app.journey.s.day);
    this.banner(`${d.name} · ${rift.name}`,`${rift.description} 균열 실전 승리 추가 보상: 골드 200 · 해당 재료 2. 일반 던전 승리도 의뢰에 집계됩니다.`,d.id);
    const launch=button('균열 도전',()=>this.launchRift(d.id),'launch-rift');const access=this.app.expedition.dungeonAccess(d.id);launch.disabled=this.blocked||!access.ok;this.content.append(launch);
    if(!access.ok)this.content.append(node('p','journey-muted',access.error));
    const reset=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(c.nextResetAt);
    this.content.append(node('p','journey-muted',`매일 한국시간 05:00 갱신 · 다음 ${reset} · 주간은 월요일 05:00. 시작한 기간에만 집계되며 소탕은 제외됩니다.`));
    for(const [kind,label] of [['daily','오늘의 의뢰'],['weekly','이번 주의 의뢰']]){this.content.append(node('h3','journey-section',label));const list=node('div','journey-grid');
      for(const row of c[kind]){const card=node('article','journey-card'),progress=node('progress');progress.max=row.target;progress.value=Math.min(row.cur,row.target);progress.setAttribute('aria-label',row.name);
        card.append(node('h3','',row.name),node('p','',`${row.description}${row.dungeonId?' · '+d.name:''}`),progress,node('p','',`${fmt(Math.min(row.cur,row.target))} / ${row.target}`),node('p','journey-rewards',rewardText(row.rewards)));
        const claim=button(row.claimed?'수령 완료':row.ready?'보상 받기':'진행 중',()=>this.act(()=>this.app.journey.claim(kind,row.id)),`claim-${kind}-${row.id}`);claim.disabled=this.blocked||!row.ready;card.append(claim);list.append(card);}this.content.append(list);}
  }
  renderTarget(snap) {
    this.banner('원하는 장비까지, 남은 한 걸음','목표를 정하면 필요한 재료와 다음 던전이 보입니다. 같은 장비를 보유했다면 새로 만들지 않고 장착할 수 있습니다.','star_archive');
    const label=node('label','journey-select-label','제작 목표'),select=node('select','journey-select');select.dataset.control='target-recipe';select.setAttribute('aria-label','목표 장비 선택');
    const blank=node('option','','목표 장비를 선택하세요');blank.value='';select.append(blank);
    for(const r of RECIPES.filter(r=>r.itemId)){const o=node('option','',ITEM_BY_ID[r.itemId].name);o.value=r.id;select.append(o);}select.value=snap.target?.recipe.id||'';select.disabled=this.blocked;
    select.addEventListener('change',()=>this.act(()=>this.app.journey.track(select.value||null),'목표 장비를 저장했습니다.'));label.append(select);this.content.append(label);
    const t=snap.target;if(!t){this.content.append(node('p','journey-muted','공방의 실제 제작 장비 중 하나를 골라 주세요.'));return;}
    const card=node('article','journey-card journey-target'),img=node('img','journey-item');img.src=ITEM_ICON(t.item);img.alt=t.item.name;card.append(img,node('h3','',t.item.name));
    const set=SETS[t.item.set];if(set)card.append(node('p','journey-rewards',set.name),node('p','',`2개: ${set.two?.text||'세트 능력치 강화'} · 4개: ${set.four?.text||'세트 능력치 강화'}`));
    card.append(node('p','',`골드 ${fmt(this.app.eco.s.gold)} / ${fmt(t.recipe.gold)}${t.goldMissing?' · '+fmt(t.goldMissing)+' 부족':' · 준비 완료'}`));
    for(const m of t.materials){card.append(node('p','',`${name(m.id)} ${fmt(m.have)} / ${fmt(m.need)}${m.missing?' · '+fmt(m.missing)+' 부족':' · 준비 완료'}`));
      const d=DUNGEONS.find(d=>d.id===m.dungeonId);if(d){const access=this.app.expedition.dungeonAccess(d.id),go=button(access.ok?`${d.name} · 기본 보상 기준 ${m.runs}회`:`${d.name} · 탐험 레벨 ${d.minLevel} 필요`,()=>this.navigate('dungeons'),`target-dungeon-${d.id}`,'journey-secondary');go.disabled=this.blocked||!access.ok;card.append(go);}}
    if(t.owned){card.append(node('p','journey-rewards',`보유 장비 +${t.owned.enh} · ${t.owner?(HEROES[t.owner]?.name||t.owner)+' 착용 중':'미장착'}`));const equip=button(t.equipped?'현재 영웅 착용 중':'보유한 이 장비 장착',()=>this.equipTarget(),'equip-target');equip.disabled=this.blocked||t.equipped;card.append(equip);}
    const craft=button(t.owned?'같은 장비 추가 제작':'목표 장비 제작',()=>this.craftTarget(),'craft-target');craft.disabled=this.blocked||!t.ready;card.append(craft);this.content.append(card);
  }
  renderSupply(snap) {
    this.banner('반복 보급은 짧게, 도전은 직접','실전에서 한 번 완료한 던전만 소탕할 수 있습니다. 고정 골드·재료·원정 EXP·물약을 받으며 영웅 EXP·장비·실전 의뢰 진척은 지급하지 않습니다.','glass_garden');
    const auto=node('label','journey-auto'),check=node('input');check.type='checkbox';check.checked=snap.autoBattle;check.dataset.control='auto-battle';check.disabled=this.blocked;check.addEventListener('change',()=>this.act(()=>this.app.journey.setAuto(check.checked),'다음 출격의 자동 전투 설정을 저장했습니다.'));auto.append(check,node('span','','출격할 때 자동 전투 켜기'));this.content.append(auto);
    this.content.append(node('p','journey-rewards',`에너지 ${fmt(this.app.eco.s.energy)} · 소탕권 ${fmt(this.app.eco.s.sweep)}`));
    const list=node('div','journey-grid');for(const d of DUNGEONS){const card=node('article','journey-card');card.append(node('h3','',d.name));const choices=node('div','journey-actions');
      for(const count of [1,3]){const b=button(`${count}회`,()=>{this.counts[d.id]=count;this.render();},`count-${d.id}-${count}`,'journey-secondary');b.setAttribute('aria-pressed',String((this.counts[d.id]||1)===count));choices.append(b);}card.append(choices);
      const preview=this.app.expedition.sweepPreview(d.id,this.counts[d.id]||1);
      if(preview.ok)card.append(node('p','',`사용: 에너지 ${preview.energy} · 소탕권 ${preview.tickets}`),node('p','journey-rewards',`고정 보급: ${rewardText(preview.rewards)}`),node('p','journey-muted','원정 레벨업 보너스 별도'));else card.append(node('p','journey-muted',preview.error));
      const execute=button('소탕 실행',()=>this.sweep(d.id),`sweep-${d.id}`);execute.disabled=this.blocked||!preview.ok||!preview.affordable;card.append(execute);if(preview.ok&&!preview.affordable)card.append(node('p','journey-muted','에너지 또는 소탕권이 부족합니다.'));list.append(card);}this.content.append(list);
  }
}
