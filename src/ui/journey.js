import { ALL_DUNGEONS as DUNGEONS, RECIPES, MATERIALS, CONSUMABLES } from '../data/expansion.js';
import { ITEM_BY_ID, SETS } from '../data/items.js';
import { HEROES } from '../data/heroes.js';
import { riftForDay } from '../game/journey-rifts.js';
import { frontierForSave } from '../game/region-dungeon-gate.js';
import { weeklyFrontier, frontierSnapshot } from '../data/seasonal-content.js';
import { audio } from '../engine/audio.js';
import './journey.css';
import { itemVisual } from './item-presentation.js';
import { eventCalendar } from '../game/endgame-core.js';
import { TOWER } from '../data/content-90d.js';

const node=(tag,cls='',text='')=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
const button=(text,fn,key,cls='journey-action')=>{const e=node('button',cls,text);e.type='button';e.dataset.control=key;e.addEventListener('click',fn);return e;};
const fmt=v=>Math.round(v||0).toLocaleString('ko-KR');
const name=id=>MATERIALS.find(m=>m.id===id)?.name||CONSUMABLES.find(c=>c.id===id)?.name||id;
const illustration=id=>{const e=node('img','journey-illustration');e.src=`/img/ui-crafted/${id}.webp`;e.alt='';e.loading='lazy';return e;};
const detail=(text,label='자세히')=>{const e=node('details','journey-details');e.append(node('summary','',label),node('p','',text));return e;};
const resourceArt={gold:'gold',stones:'material-stone',stones2:'material-guard-stone',stones3:'material-essence',gems:'gems',transcendStones:'material-essence',xp:'hero-xp',glass_leaf:'material-leaf',ember_core:'material-ember',star_dust:'material-stardust',hp_tonic:'potion-health',overdrive:'potion-power',aegis:'potion-guard'};
function rewardIcons(r={}) {const box=node('div','journey-reward-icons');const entries=[...['gold','stones','stones2','stones3','gems','transcendStones','lineageSigil','xp'].map(key=>[key,r[key]]),...Object.entries(r.materials||{}),...Object.entries(r.consumables||{})];for(const [id,count] of entries){if(!count)continue;const label={gold:'골드',stones:'강화석',stones2:'상급 강화석',stones3:'전설 강화석',gems:'보석',transcendStones:'초월석',lineageSigil:'계승 문장',xp:'원정 EXP'}[id]||name(id),chip=node('span','journey-reward');chip.append(illustration(resourceArt[id]||'treasure-chest'),node('span','',`${label} ${fmt(count)}`));box.append(chip);}return box;}
const errors={server:'서버 계정에서는 아직 받을 수 없습니다.',claimed:'이미 받은 보상입니다.',incomplete:'목표를 먼저 완료해 주세요.',prerequisite:'앞 단계 보상을 먼저 받아 주세요.',unknown:'선택을 다시 확인해 주세요.'};
const tabs=[['journey','성장 여정'],['contracts','오늘의 의뢰'],['tower','무한의 성'],['target','목표 장비'],['supply','빠른 보급']];

export class JourneyView {
  constructor(app) {
    this.app=app;this.tab='journey';this.counts={};
    this.dialog=node('dialog','journey-dialog');this.dialog.id='journey';this.dialog.setAttribute('aria-labelledby','journey-title');
    const header=node('header','journey-header'),title=node('div');title.append(node('small','journey-eyebrow','한 걸음이 다음 모험을 바꾼다'));
    const h=node('h2','','성장 여정');h.id='journey-title';title.append(h);header.append(title,button('닫기',()=>this.close(),'close','journey-close'));
    this.nav=node('nav','journey-tabs');this.nav.setAttribute('aria-label','성장 여정 메뉴');
    for(const [id,label] of tabs){const b=button('',()=>{this.tab=id;this.render();},`tab-${id}`);b.append(illustration({journey:'nav-journey',contracts:'nav-quests',tower:'nav-arena',target:'nav-forge',supply:'sweep-ticket'}[id]),node('span','',label));this.nav.append(b);}
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
  /** 이번 주 프론티어. 지정 던전이 이 저장에서 잠겼으면 열린 던전으로 대신한다(표시와 출격이 같은 판정). */
  frontier() { const save=this.app.eco?.s;return save?frontierForSave(save):weeklyFrontier(); }
  async launchFrontier(id, shown = frontierSnapshot(this.frontier())) {
    if(this.blockNotice())return false;
    const current=frontierSnapshot(this.frontier());
    if(!shown||id!==current.routeId||JSON.stringify(frontierSnapshot(shown))!==JSON.stringify(current)){
      this.notice.textContent='주간 원정이 갱신됐습니다. 새 지역과 효과를 확인한 뒤 출격해 주세요.';this.refresh(true);return false;
    }
    this.close();if(this.app.expeditionUI?.result){this.app.expeditionUI.result=null;this.app.toLobby();}else if(this.app.mode==='battle')this.app.toLobby();
    return this.app.startExpedition('dungeon',id,{depth:'standard',expectedFrontier:current});
  }
  refresh(force=false) {
    const snap=this.app.journey.snapshot(),next=snap.steps.find(s=>!s.claimed);
    this.strip.textContent=next?`${next.ready?'보상 받기':'다음 목표'} · ${next.name}`:'성장 여정 완주 · 오늘의 의뢰 확인';
    this.nextTab=next?'journey':'contracts';
    const signature=JSON.stringify([snap,this.app.eco.s.endgame,this.app.eco.s.gold,this.app.eco.s.energy,this.app.eco.s.sweep,this.blocked,this.app.eco.s.expedition.stats,frontierSnapshot(this.frontier())]);
    if(this.dialog.open&&(force||signature!==this.signature))this.render(snap);
    this.signature=signature;
  }
  render(snap=this.app.journey.snapshot()) {
    const same=this.renderedTab===this.tab,scroll=same?this.content.scrollTop:0,focus=same&&this.content.contains(document.activeElement)?document.activeElement.dataset.control:null;
    this.renderedTab=this.tab;this.content.replaceChildren();
    [...this.nav.children].forEach((e,i)=>e.setAttribute('aria-pressed',String(tabs[i][0]===this.tab)));
    if(this.tab==='journey')this.renderSteps(snap);else if(this.tab==='contracts')this.renderContracts(snap);else if(this.tab==='tower')this.renderTower();else if(this.tab==='target')this.renderTarget(snap);else this.renderSupply(snap);
    if(focus)[...this.content.querySelectorAll('[data-control]')].find(e=>e.dataset.control===focus)?.focus({preventScroll:true});
    this.content.scrollTop=scroll;
  }
  banner(title,text,art='guild_map') {const e=node('section','journey-banner');e.style.backgroundImage=`linear-gradient(90deg,#102124ef,#10212460),url('/img/expansion/${art}.webp')`;e.append(illustration({journey:'nav-journey',contracts:'nav-quests',tower:'nav-arena',target:'nav-forge',supply:'nav-dungeon'}[this.tab]||'nav-journey'),node('h3','',title),detail(text,'안내'));this.content.append(e);}
  renderSteps(snap) {
    const done=snap.steps.filter(s=>s.claimed).length;this.banner(`성장 여정 ${done} / 6`,'서약부터 숙련까지, 실제 플레이로 한 단계씩 완성하세요. 완료한 단계의 보상은 순서대로 받습니다.');
    const list=node('div','journey-grid');
    snap.steps.forEach((s,i)=>{const card=node('article',`journey-card ${s.claimed?'is-complete':''}`);card.append(illustration({prepare:'loadout',dungeons:'nav-dungeon',forge:'nav-forge',heroes:'loadout',mastery:'nav-mastery',quests:'nav-quests'}[s.action]||'nav-journey'),node('small','journey-eyebrow',`${i+1}단계 · ${s.claimed?'보상 수령 완료':s.complete?'조건 달성':'진행 중'}`),node('h3','',s.name),node('p','',s.description),rewardIcons(s.rewards));
      const progress=node('progress');progress.max=1;progress.value=s.complete?1:0;progress.setAttribute('aria-label',`${s.name} 목표`);card.append(progress);
      const actions=node('div','journey-actions'),claim=button(s.claimed?'수령 완료':s.ready?'보상 받기':'진행 중',()=>this.act(()=>{const r=this.app.journey.claimStep(s.id);if(r.ok)this.app.funnel?.track('reward_claim',{source:'journey'});return r;}),`claim-step-${s.id}`);claim.disabled=this.blocked||!s.ready;
      if(!s.claimed&&!s.ready)card.append(node('small','journey-muted','앞 단계 보상과 목표 완료 필요'));actions.append(claim);if(!s.claimed){const go=button('목표로 이동',()=>this.navigate(s.action),`go-step-${s.id}`,'journey-secondary');go.disabled=this.blocked;actions.append(go);}card.append(actions);list.append(card);});this.content.append(list);
  }
  renderContracts(snap) {
    const c=snap.contracts,d=DUNGEONS.find(d=>d.id===c.rotationDungeonId),rift=riftForDay(this.app.journey.s.day),frontier=this.frontier(),frontierDungeon=DUNGEONS.find(item=>item.id===frontier.routeId);
    this.banner(`${d.name} · ${rift.name}`,`${rift.description} 균열 실전 승리 추가 보상: 골드 200 · 해당 재료 2. 일반 던전 승리도 의뢰에 집계됩니다.`,d.id);
    const frontierCard=node('section','journey-card');frontierCard.append(node('small','journey-eyebrow','이번 주의 프론티어'),node('h3','',`${frontierDungeon?.name||frontier.routeId} · ${frontier.modifier}`),node('p','',frontier.tagline),node('p','journey-muted','해당 지역의 기본 원정에 적용됩니다. 시작한 효과는 귀환까지 유지됩니다. 소탕은 완료 보상 효과만 적용되며, 전투·보물방 효과는 실전에서만 발동합니다.'));
    const frontierLaunch=button('주간 원정 출격',()=>this.launchFrontier(frontier.routeId,frontierSnapshot(frontier)),'launch-frontier'),frontierAccess=this.app.expedition.dungeonAccess(frontier.routeId);
    frontierLaunch.disabled=this.blocked||!frontierAccess.ok;frontierCard.append(frontierLaunch);
    if(!frontierAccess.ok)frontierCard.append(node('p','journey-muted',frontierAccess.error));this.content.append(frontierCard);
    this.content.append(node('p','journey-rewards','균열 승리 추가 보상'),rewardIcons({gold:200,materials:Object.fromEntries(Object.keys(d.rewards.materials).map(id=>[id,2]))}));
    const launch=button('균열 도전',()=>this.launchRift(d.id),'launch-rift');const access=this.app.expedition.dungeonAccess(d.id);launch.disabled=this.blocked||!access.ok;this.content.append(launch);
    if(!access.ok)this.content.append(node('p','journey-muted',access.error));
    const reset=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(c.nextResetAt);
    this.content.append(detail(`매일 한국시간 05:00 갱신 · 다음 ${reset} · 주간은 월요일 05:00. 시작한 기간에만 집계되며 소탕은 제외됩니다.`,'의뢰 갱신 · 집계 규칙'));
    for(const [kind,label] of [['daily','오늘의 의뢰'],['weekly','이번 주의 의뢰']]){this.content.append(node('h3','journey-section',label));const list=node('div','journey-grid');
      for(const row of c[kind]){const card=node('article','journey-card'),progress=node('progress');progress.max=row.target;progress.value=Math.min(row.cur,row.target);progress.setAttribute('aria-label',row.name);
        card.append(illustration(kind==='daily'?'quest-daily':'quest-weekly'),node('h3','',row.name),node('p','',`${row.description}${row.dungeonId?' · '+d.name:''}`),progress,node('p','',`${fmt(Math.min(row.cur,row.target))} / ${row.target}`),rewardIcons(row.rewards));
        const claim=button(row.claimed?'수령 완료':row.ready?'보상 받기':'진행 중',()=>this.act(()=>{const r=this.app.journey.claim(kind,row.id);if(r.ok)this.app.funnel?.track('reward_claim',{source:'journey'});return r;}),`claim-${kind}-${row.id}`);claim.disabled=this.blocked||!row.ready;card.append(claim);list.append(card);}this.content.append(list);}
  }
  async launchTower() {
    if(this.blockNotice())return false;
    this.close();if(this.app.expeditionUI?.result){this.app.expeditionUI.result=null;this.app.toLobby();}else if(this.app.mode==='battle')this.app.toLobby();
    return this.app.startTower();
  }
  renderTower() {
    const t=this.app.eco.towerSummary(),when=v=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(v);
    this.banner(`${TOWER.name} · 최고 ${t.best}층`,`에너지 없이 다음 층 하나에 도전합니다. 10층마다 지역이 바뀌고 5층은 중간 보스, 10층은 지역 최종 보스입니다. 도전 상한은 매주 월요일 05:00에 ${TOWER.capPerWeek}층씩 열립니다.`,'arena');
    const card=node('article','journey-card tower-card');
    card.append(illustration('nav-arena'),node('small','journey-eyebrow',t.unlocked?`이번 주 상한 ${t.cap}층`:'2-10 클리어 후 개방'),node('h3','',`${t.next}층 · ${t.boss==='final'?'지역 최종 보스':t.boss==='mid'?'중간 보스':'관문 대장'} (${t.source} 무대)`),
      node('p','',`권장 전투력 ${fmt(t.recPower)} · 첫 돌파 보상은 층이 오를수록 커지고 10층마다 보석, 25층마다 초월석.`));
    const server=this.app.account?.authority==='server';
    const go=button(!t.unlocked?'잠김':t.capped?'이번 주 상한 도달':`${t.next}층 도전`,()=>this.launchTower(),'launch-tower');go.disabled=this.blocked||server||!t.unlocked||t.capped;card.append(go);
    if(server)card.append(node('p','journey-muted','서버 계정의 무한의 성 정산을 준비 중입니다.'));
    if(t.capped)card.append(node('p','journey-muted','이번 주 상한에 닿아 오늘·이번 주의 탑 의뢰는 달성으로 처리됩니다.'));
    if(t.capped)card.append(node('p','journey-muted',`다음 상한 개방: ${when(t.chest.nextResetAt)}`));
    this.content.append(card);
    const c=t.chest,chest=node('article','journey-card');
    chest.append(illustration('treasure-chest'),node('small','journey-eyebrow',`주간 보급 · 이번 주 돌파 ${c.weekCleared}층`),node('h3','',c.tier?`${c.tier.floor}층 이상 보급 상자`:'1층을 돌파하면 열립니다'));
    if(c.tier){const {floor,...rewards}=c.tier;chest.append(rewardIcons(rewards));}
    const claim=button(c.claimed?'이번 주 수령 완료':c.ready?'보급 받기':'이번 주 1층 이상 돌파 필요',()=>this.act(()=>this.app.eco.claimTowerChest(),'주간 보급을 받았습니다.'),'claim-tower-chest');claim.disabled=this.blocked||server||!c.ready;chest.append(claim);
    this.content.append(chest);
    this.content.append(node('h3','journey-section','시즌 이벤트'));
    const list=node('div','journey-grid');
    for(const e of eventCalendar(Date.now(),3)){const ev=node('article',`journey-card ${e.active?'is-active':''}`);
      ev.append(illustration('calendar'),node('small','journey-eyebrow',`${e.current?'이번 주':when(e.startsAt)+' 시작'} · ${e.days==='weekend'?'주말(토·일)':'일주일'}${e.active?' · 진행 중':''}`),node('h3','',e.name),node('p','',e.tagline));list.append(ev);}
    this.content.append(list);
  }
  renderTarget(snap) {
    this.banner('목표 장비','목표를 정하면 필요한 재료와 다음 던전이 보입니다. 같은 장비를 보유했다면 새로 만들지 않고 장착할 수 있습니다.','star_archive');
    const label=node('label','journey-select-label','제작 목표'),select=node('select','journey-select');select.dataset.control='target-recipe';select.setAttribute('aria-label','목표 장비 선택');
    const blank=node('option','','목표 장비를 선택하세요');blank.value='';select.append(blank);
    for(const r of RECIPES.filter(r=>r.itemId)){const o=node('option','',ITEM_BY_ID[r.itemId].name);o.value=r.id;select.append(o);}select.value=snap.target?.recipe.id||'';select.disabled=this.blocked;
    select.addEventListener('change',()=>this.act(()=>this.app.journey.track(select.value||null),'목표 장비를 저장했습니다.'));label.append(select);this.content.append(label);
    const t=snap.target;if(!t){this.content.append(node('p','journey-muted','공방의 실제 제작 장비 중 하나를 골라 주세요.'));return;}
    const card=node('article','journey-card journey-target'),img=node('img','journey-item');img.src=itemVisual(t.item,{heroId:this.app.eco?.s?.selected}).iconUrl;img.alt=t.item.name;card.append(img,node('h3','',t.item.name));
    const set=SETS[t.item.set];if(set)card.append(node('p','journey-rewards',set.name),detail(`2개: ${set.two?.text||'세트 능력치 강화'} · 4개: ${set.four?.text||'세트 능력치 강화'}`,'세트 효과'));
    card.append(illustration('gold'),node('p','',`골드 ${fmt(this.app.eco.s.gold)} / ${fmt(t.recipe.gold)}${t.goldMissing?' · '+fmt(t.goldMissing)+' 부족':' · 준비 완료'}`));
    for(const m of t.materials){card.append(illustration(resourceArt[m.id]||'treasure-chest'),node('p','',`${name(m.id)} ${fmt(m.have)} / ${fmt(m.need)}${m.missing?' · '+fmt(m.missing)+' 부족':' · 준비 완료'}`));
      if(m.locked&&m.missing)card.append(node('p','journey-muted','이 재료를 주는 던전은 다음 지역 마을이 열리면 나타납니다.'));
      const d=DUNGEONS.find(d=>d.id===m.dungeonId);if(d){const access=this.app.expedition.dungeonAccess(d.id),go=button(access.ok?`${d.name} · 기본 보상 기준 ${m.runs}회`:`${d.name} · 탐험 레벨 ${d.minLevel} 필요`,()=>this.navigate('dungeons'),`target-dungeon-${d.id}`,'journey-secondary');go.disabled=this.blocked||!access.ok;card.append(go);}}
    if(t.owned){card.append(node('p','journey-rewards',`보유 장비 +${t.owned.enh} · ${t.owner?(HEROES[t.owner]?.name||t.owner)+' 착용 중':'미장착'}`));const equip=button(t.equipped?'현재 영웅 착용 중':'보유한 이 장비 장착',()=>this.equipTarget(),'equip-target');equip.disabled=this.blocked||t.equipped;card.append(equip);}
    const craft=button(t.owned?'같은 장비 추가 제작':'목표 장비 제작',()=>this.craftTarget(),'craft-target');craft.disabled=this.blocked||!t.ready;card.append(craft);this.content.append(card);
  }
  renderSupply(snap) {
    this.banner('빠른 보급','실전에서 한 번 완료한 던전만 소탕할 수 있습니다. 고정 골드·재료·원정 EXP·물약을 받으며 영웅 EXP·장비·실전 의뢰 진척은 지급하지 않습니다.','glass_garden');
    const auto=node('label','journey-auto'),check=node('input');check.type='checkbox';check.checked=snap.autoBattle;check.dataset.control='auto-battle';check.disabled=this.blocked;check.addEventListener('change',()=>this.act(()=>this.app.journey.setAuto(check.checked),'다음 출격의 자동 전투 설정을 저장했습니다.'));auto.append(check,node('span','','출격할 때 자동 전투 켜기'));this.content.append(auto);
    this.content.append(node('p','journey-rewards',`에너지 ${fmt(this.app.eco.s.energy)} · 소탕권 ${fmt(this.app.eco.s.sweep)}`));
    const list=node('div','journey-grid');for(const d of DUNGEONS.filter(d=>this.app.expedition.dungeonVisibility?.(d.id).visible!==false)){const card=node('article','journey-card');card.append(illustration('nav-dungeon'),node('h3','',d.name));const choices=node('div','journey-actions');
      for(const count of [1,3]){const b=button(`${count}회`,()=>{this.counts[d.id]=count;this.render();},`count-${d.id}-${count}`,'journey-secondary');b.setAttribute('aria-pressed',String((this.counts[d.id]||1)===count));choices.append(b);}card.append(choices);
      const preview=this.app.expedition.sweepPreview(d.id,this.counts[d.id]||1);
      if(preview.ok)card.append(node('p','',`사용: 에너지 ${preview.energy} · 소탕권 ${preview.tickets}`),rewardIcons(preview.rewards),node('p','journey-muted','원정 레벨업 보너스 별도'));else card.append(node('p','journey-muted',preview.error));
      const execute=button('소탕 실행',()=>this.sweep(d.id),`sweep-${d.id}`);execute.disabled=this.blocked||!preview.ok||!preview.affordable;card.append(execute);if(preview.ok&&!preview.affordable)card.append(node('p','journey-muted','에너지 또는 소탕권이 부족합니다.'));list.append(card);}this.content.append(list);
  }
}
