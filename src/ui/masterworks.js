import { BOONS, SYNERGIES, MASTERY_NODES, PATHS, CHALLENGES, STORY_EVENTS, BOUNTIES } from '../data/masterworks.js';
import { difficultyEffects } from '../game/masterworks-core.js';
import { DUNGEONS } from '../data/expansion.js';
import { EXPEDITION_SETS } from '../data/expedition-items.js';
import { uiArt } from './illustrated.js';
import './masterworks.css';

const family = {ember:['잿불','ember_vault'],tide:['물결','glass_garden'],storm:['폭풍','ranger'],stone:['바위','star_archive']};
const n=(tag,cls='',text='')=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
const btn=(text,fn,cls='')=>{const e=n('button',cls,text);e.type='button';e.addEventListener('click',fn);return e;};
const art=(id)=>{const e=n('img','mw-illustration');e.src=uiArt(id);e.alt='';e.loading='lazy';return e;};
const details=(text,label='자세히')=>{const e=n('details','mw-details');e.append(n('summary','',label),n('p','',text));return e;};
const fmt=v=>Math.round(v||0).toLocaleString('ko-KR');
const err={unknown:'선택을 확인해 주세요.',owned:'이미 배운 숙련입니다.',prerequisite:'앞 단계 숙련을 먼저 배워 주세요.',renown:'명성이 부족합니다.',claimed:'이미 받은 보상입니다.',incomplete:'의뢰 목표를 먼저 달성해 주세요.'};

/** An in-game journal with separate pause ownership; no navigation away from the app. */
export class MasterworksView {
  constructor(app,battle) {
    this.app=app;this.battle=battle;this.tab='build';this.timer=0;
    this.dialog=n('dialog','mw-dialog');this.dialog.id='masterworks';this.dialog.setAttribute('aria-labelledby','mw-title');
    const header=n('header','mw-header'),names=n('div');names.append(n('small','mw-eyebrow','BLADE SURGE · CHRONICLES'));
    this.title=n('h2','','모험가의 길');this.title.id='mw-title';names.append(this.title);
    header.append(names,btn('닫기',()=>this.close(),'mw-close'));
    this.nav=n('nav','mw-tabs');this.nav.setAttribute('aria-label','모험가의 길 메뉴');
    for(const [id,label] of [['build','준비'],['mastery','숙련'],['quests','의뢰'],['journal','기록']]){const tab=btn('',()=>{this.tab=id;this.render();});tab.append(art({build:'loadout',mastery:'nav-mastery',quests:'nav-quests',journal:'nav-journal'}[id]),n('span','',label));this.nav.append(tab);}
    this.content=n('div','mw-content');this.notice=n('p','mw-notice');this.notice.setAttribute('role','status');
    this.dialog.append(header,this.nav,this.notice,this.content);document.body.append(this.dialog);
    this.dialog.addEventListener('close',()=>{this.battle.setPaused('masterworks',false);this.trigger?.isConnected&&this.trigger.focus();});
    this.lobby=btn('성장 · 각인',e=>this.open('build',e.currentTarget),'sq-btn mw-open');
    document.querySelector('.lobby-left')?.append(this.lobby);
    this.hud=btn('각인',e=>this.open('run',e.currentTarget),'hud-btn');document.querySelector('.hud-right-top')?.prepend(this.hud);
    this.strip=n('div','mw-run-strip');this.strip.hidden=true;document.querySelector('.hud-bars')?.append(this.strip);
    this.posture=n('div','mw-posture');this.posture.hidden=true;document.querySelector('.hud-center')?.append(this.posture);
    this.result=n('p','mw-result');this.result.hidden=true;document.querySelector('.result-stats')?.after(this.result);
  }
  get state(){return this.battle.masterworks.s;}
  open(tab='build',trigger=null) {
    if(this.app.mode==='boot'||this.app.stageStarting)return;
    this.tab=tab;this.trigger=trigger;this.notice.textContent='';this.render();
    if(this.battle.active)this.battle.setPaused('masterworks',true);
    if(!this.dialog.open)this.dialog.showModal();
  }
  close(){
    // HTMLDialogElement dispatches `close` asynchronously. Release this view's
    // pause ownership now so a semantic selection can resume the same tick.
    // setPaused is reason-scoped, so companion/catalogue pauses remain held.
    this.battle?.setPaused?.('masterworks',false);
    if(this.dialog.open)this.dialog.close();
  }
  openExpedition(tab) {
    const controller=this.app.expeditionUI;
    if(controller.result?.saveError) {
      this.notice.textContent='아직 정산을 저장하지 못했습니다. 결과 화면에서 정산을 다시 저장한 뒤 이동해 주세요.';
      return {ok:false,error:'settlement'};
    }
    this.close();
    if(controller.result) { controller.result=null;this.app.toLobby(); }
    controller.open(tab);
    return {ok:true};
  }
  offer(){this.open('run',this.hud);}
  // One deliberate choice per visit. Further earned rewards remain on the truthful HUD badge.
  selectionDone(){this.close();this.refresh();}
  act(fn,success='저장되었습니다.'){const r=fn();this.notice.textContent=r?.ok===false?(err[r.error]||r.error):success;this.render();return r;}
  render() {
    const offer=this.tab==='run'?this.battle.currentOffer():null;
    const sameView=this.renderedTab===this.tab&&this.renderedOffer===offer;
    const scrollTop=sameView?this.content.scrollTop:0;
    this.renderedTab=this.tab;this.renderedOffer=offer;
    this.dialog.dataset.offer=offer?.kind||'';
    const run=this.tab==='run';this.dialog.dataset.view=this.tab;this.nav.hidden=run;
    this.title.textContent=!run?'모험가의 길':offer?.kind==='boon'?'원정 각인 선택':offer?.kind==='story'?'길 위의 만남':'원정 각인 현황';
    [...this.nav.children].forEach((e,i)=>e.setAttribute('aria-pressed',String(['build','mastery','quests','journal'][i]===this.tab)));
    this.content.replaceChildren();
    if(run)this.renderRun();else if(this.tab==='mastery')this.renderMastery();else if(this.tab==='quests')this.renderQuests();else if(this.tab==='journal')this.renderJournal();else this.renderBuild();
    this.content.scrollTop=scrollTop;
  }
  intro(title,text,backdrop='guild_map') {
    const hero=n('section','mw-banner');hero.style.backgroundImage=`linear-gradient(90deg,#101e20ed,#101e2070),url('/img/expansion/${backdrop}.webp')`;
    hero.append(art(this.tab==='mastery'?'nav-mastery':this.tab==='quests'?'nav-quests':this.tab==='journal'?'nav-journal':'loadout'),n('small','mw-eyebrow',`길드 명성 ${fmt(this.state.renown)} · 발견 ${this.state.discoveries.length}`),n('h3','',title),details(text,'안내'));this.content.append(hero);
  }
  renderBuild() {
    const s=this.state,service=this.battle.masterworks;
    this.intro('전투 준비','전투 방식은 자유롭게 바꾸고, 발견과 의뢰로 영구 숙련을 쌓으세요. 각인은 출격 중 선택합니다.');
    this.content.append(n('h3','mw-section-title','전투 방식'));
    const paths=n('div','mw-grid');for(const p of PATHS){const b=btn('',()=>this.act(()=>service.path(p.id)),'mw-card');b.setAttribute('aria-pressed',String(s.path===p.id));b.append(art(`path-${p.id==='hunter'?'stalker':p.id}`),n('small','mw-eyebrow',s.path===p.id?'선택 중':'자유 전환'),n('h4','',p.name),n('p','',p.description));paths.append(b);}this.content.append(paths);
    this.content.append(n('h3','mw-section-title','도전 서약'));
    const d=difficultyEffects(s.challengeIds);this.content.append(n('p','mw-muted',`현재 적 체력 ×${d.enemyHp.toFixed(2)} · 공격력 ×${d.enemyAtk.toFixed(2)} · 완료 명성 ×${d.rewardMul.toFixed(2)}. 원정·캠페인에 적용됩니다.`));
    const challenges=n('div','mw-grid');for(const c of CHALLENGES){const b=btn('',()=>this.act(()=>service.challenge(c.id)),'mw-card');b.setAttribute('aria-pressed',String(s.challengeIds.includes(c.id)));b.append(art(`vow-${c.id==='siege'?'surrounded':c.id}`),n('small','mw-eyebrow',s.challengeIds.includes(c.id)?'서약 활성':'선택 가능한 도전'),n('h4','',c.name),n('p','',c.description));challenges.append(b);}this.content.append(challenges);
    const presets=n('div','mw-presets');s.presets.forEach((p,i)=>{const box=n('div');box.append(art('loadout'),n('strong','',p.name),n('small','',`${PATHS.find(x=>x.id===p.path)?.name} · 서약 ${p.challengeIds.length}`),btn('불러오기',()=>this.act(()=>service.usePreset(i))),btn('현재 설정 저장',()=>this.act(()=>service.savePreset(i))));presets.append(box);});this.content.append(n('h3','mw-section-title','원정 준비 저장'),presets);
    this.content.append(details('AI 결투장은 기존 공통 규칙을 사용합니다. 각인과 서약은 캠페인·재료 던전에 적용됩니다.','적용되는 전투'));
    this.content.append(btn('재료 던전으로',()=>this.openExpedition('dungeons'),'mw-primary'));
  }
  renderMastery() {
    this.intro('영구 숙련','처치 5회마다 명성 1, 처음 정화한 구역마다 명성 3. 완료 보상과 길드 의뢰로 다음 성장을 준비하세요.','star_archive');
    const grid=n('div','mw-grid');
    for(const [path,title] of [['assault','공세'],['survival','생존'],['insight','통찰']]) {
      const col=n('section','mw-tree');col.append(n('h3','',title));
      for(const node of MASTERY_NODES.filter(x=>x.path===path)) {
        const owned=this.state.unlocked.includes(node.id),previous=node.tier===1||this.state.unlocked.includes(`${path}_${node.tier-1}`);
        const card=n('article','mw-card');card.append(art({assault:'slot-weapon',survival:'slot-armor',insight:'nav-mastery'}[path]),n('small','mw-eyebrow',`${node.tier}단계`),n('h4','',node.name),n('p','',node.description));
        const cost=n('span','mw-cost');cost.append(art('renown'),n('span','',`명성 ${node.cost}`));card.append(cost);
        const b=btn(owned?'습득 완료':!previous?'이전 단계 필요':`명성 ${node.cost} · 습득`,()=>this.act(()=>this.battle.masterworks.unlock(node.id)),'mw-primary');
        b.disabled=owned||!previous||this.state.renown<node.cost||this.battle.active;card.append(b);col.append(card);
      }grid.append(col);
    }this.content.append(grid);
  }
  renderQuests() {
    this.intro('길드 의뢰','부담 없이 끝낼 수 있는 목표. 조건을 달성한 보상은 직접 수령하고 영구 숙련에 사용하세요.','glass_garden');
    const list=n('div','mw-grid');for(const q of BOUNTIES){const cur=this.state.bounties.counts[q.stat],claimed=this.state.bounties.claimed.includes(q.id);const card=n('article','mw-card');const p=n('progress');p.max=q.target;p.value=cur;p.setAttribute('aria-label',q.name);
      card.append(art('quest-daily'),n('small','mw-eyebrow',`명성 +${q.reward}`),n('h4','',q.name),n('p','',q.description),p,n('p','',`${Math.min(cur,q.target)} / ${q.target}`));
      const b=btn(claimed?'보상 수령 완료':cur>=q.target?'보상 받기':'도전 중',()=>this.act(()=>this.battle.masterworks.claim(q.id)),'mw-primary');b.disabled=claimed||cur<q.target||this.battle.active;card.append(b);list.append(card);}this.content.append(list);
    const routes=DUNGEONS.map(d=>`${d.name} → ${EXPEDITION_SETS.filter(s=>Object.hasOwn(d.rewards.materials,s.material)).map(s=>s.name).join(' · ')}`).join(' · ');
    this.content.append(n('h3','mw-section-title','원하는 장비에 가까워지는 길'),details(`${routes}. 재료를 모아 공방에서 원하는 부위를 직접 제작하세요.`,'재료 획득처'),btn('공방에서 목표 장비 확인',()=>this.openExpedition('forge'),'mw-primary'));
  }
  renderJournal() {
    this.intro('선택의 기록','첫 만남의 선택은 저장됩니다. 같은 길을 다시 찾으면 그 결과와 작은 쉼터의 도움을 만납니다.','star_archive');
    for(const event of STORY_EVENTS){const c=event.choices.find(c=>c.id===this.state.story[event.id]);const card=n('article','mw-story-record');card.append(art('nav-journal'),n('small','mw-eyebrow',c?'남겨진 선택':'아직 만나지 않은 이야기'),n('h4','',event.name),details(c?c.consequence:'구역을 정화하며 길 위의 사람들을 만나세요.','이야기 읽기'));if(c)card.append(n('small','mw-muted',`당신의 선택: ${c.name} · 다시 만나면 체력 ${c.effects.heal?12:6}% 회복`));this.content.append(card);}
    this.content.append(n('h3','mw-section-title','최근 원정'));
    if(!this.state.history.length)this.content.append(n('p','mw-muted','첫 원정을 마치면 승리와 재도전의 기록이 남습니다.'));
    for(const h of [...this.state.history].reverse().slice(0,6))this.content.append(n('p','mw-history',`${h.outcome==='victory'?'승리':'재도전'} · ${h.floor}층 · ${h.boonIds.map(id=>BOONS.find(x=>x.id===id)?.name).join(' / ')||'각인 없음'}`));
  }
  renderRun() {
    const run=this.battle.run,offer=this.battle.currentOffer();
    if(!run||!run.enabled) {
      this.runIntro(!run?'출격 후 각인이 모입니다':'공용 전투 규칙',!run?'캠페인·재료 던전에서 얻은 각인과 선택할 보상을 이곳에서 확인하세요.':'AI 결투와 파티에서는 개인 각인과 서약 없이 공용 규칙으로 대결합니다.','원정 안내','nav-journey');
      this.content.append(btn(this.battle.active?'전투로 돌아가기':'닫기',()=>this.close(),'mw-primary mw-run-return'));
      return;
    }
    const pending=n('section','mw-pending');pending.setAttribute('aria-label','선택 대기 중인 보상');
    if(offer) {
      const status=n('div','mw-run-status');status.append(n('strong','','선택 대기'),n('span','',`${run.queue.length}건 · 아직 적용 전`));pending.append(status);
      this.content.append(pending);
    }
    if(offer?.kind==='boon') {
      this.runIntro('이번 싸움을 바꿀 힘',`${offer.ids.length}개 중 하나를 선택하면 이번 출격에 즉시 적용됩니다.`,'각인 보상','loadout',pending);
      const cards=n('div','mw-grid mw-choices');
      for(const id of offer.ids) {
        const b=BOONS.find(x=>x.id===id),rank=run.picked.filter(x=>x===id).length;
        const card=btn('',()=>this.act(()=>this.battle.selectBoon(id),'이번 원정에 적용했습니다.'),'mw-card mw-boon');card.dataset.boon=id;card.dataset.family=b.family;
        const illustration=art(`boon-${b.id}`);illustration.className+=' mw-boon-art';
        card.append(illustration,n('small','mw-eyebrow',`${family[b.family][0]} · ${rank?`강화 ${rank} → ${rank+1}`:'새 각인'}`),n('h4','',b.name),n('p','mw-choice-effect',b.description),n('strong','mw-pick',rank?'이 각인 강화':'이 각인 적용'));cards.append(card);
      }
      pending.append(cards,details('서로 다른 계열을 모으면 조합 효과가 열립니다. 같은 각인은 3단계까지 강화됩니다.','각인 조합 규칙'));
    } else if(offer?.kind==='story') {
      const event=STORY_EVENTS.find(e=>e.id===offer.id),remembered=event.choices.find(c=>c.id===this.state.story[event.id]);
      this.runIntro(event.name,remembered?remembered.consequence:event.description,remembered?'다시 만난 인연 · 선택 기록 있음':'길 위의 만남 · 행동 하나 선택','nav-journal',pending,offer.id==='bridge'?'ember_vault':offer.id==='archive'?'star_archive':'glass_garden');
      const choices=n('div',`mw-story-choices${remembered?' mw-revisit':''}`);
      for(const c of remembered?[remembered]:event.choices) {
        const heal=remembered?(c.effects.heal ? .12 : .06):c.effects.heal;
        const reward=heal?`체력 ${Math.round(heal*100)}% 회복`:`명성 +${fmt(c.effects.renown)}`;
        const card=btn('',()=>this.act(()=>this.battle.selectStory(c.id),'선택을 기록하고 보상을 적용했습니다.'),'mw-card mw-story-choice');card.dataset.storyChoice=c.id;card.dataset.reward=heal?'heal':'renown';
        const body=n('span','mw-choice-body');
        body.append(n('small','mw-eyebrow',remembered?'재방문 보상':heal?'생존을 위한 선택':'성장을 위한 선택'),n('h4','',remembered?'잠시 쉬어 간다':c.name),n('strong','mw-choice-reward',reward),n('p','',remembered?`지난 선택: ${c.name} · 선택 기록은 유지됩니다.`:c.consequence),n('small','mw-reward-scope',heal?'최대 체력 기준 · 선택 즉시 회복':'영구 숙련에 사용할 명성 · 선택 기록 저장'),n('strong','mw-pick',remembered?'회복하고 돌아가기':'이 행동 선택'));
        card.append(art(heal?'potion-health':'renown'),body);choices.append(card);
      }
      pending.append(choices);
    } else this.runIntro('현재 선택할 보상이 없습니다','지금 적용 중인 힘을 확인하고 전투를 이어가세요. 다음 보상을 얻으면 상단 각인 버튼에서 확인할 수 있습니다.','이번 출격의 기록','loadout');
    if(offer&&run.queue.length>1)pending.append(n('p','mw-muted',`이번 보상 하나를 고르면 전투로 돌아갑니다. 남은 ${run.queue.length-1}건은 상단 각인 버튼에서 확인하세요.`));
    const owned=n('section','mw-owned');owned.setAttribute('aria-label','이미 적용된 원정 각인');
    const heading=n('div','mw-owned-heading');heading.append(n('h3','mw-section-title','적용 중인 각인'),n('span','mw-applied',`${new Set(run.picked).size}종 · 총 ${run.picked.length}회 획득`));owned.append(heading);
    const picked=n('div','mw-picked');
    for(const b of BOONS) {
      const rank=run.picked.filter(id=>id===b.id).length;
      if(rank) {
        const chip=n('article',`mw-chip ${b.family}`);chip.dataset.ownedBoon=b.id;
        const body=n('div');body.append(n('strong','',b.name),n('small','mw-applied',`적용 중 · ${rank}단계`),n('p','',`${rank>1?'단계당 · ':''}${b.description}`));
        chip.append(art(`boon-${b.id}`),body);picked.append(chip);
      }
    }
    if(!run.picked.length)owned.append(n('p','mw-muted',offer?.kind==='boon'?'아직 적용된 각인이 없습니다. 위에서 하나를 고르면 이 출격의 힘이 됩니다.':'아직 획득한 각인이 없습니다. 전투에서 각인 보상을 얻으면 이곳에 표시됩니다.'));
    else owned.append(picked);
    if(run.autoPicked)owned.append(n('p','mw-muted',`획득 내역에 자동 적용 보상 ${run.autoPicked}회 포함`));
    const families=new Set(run.picked.map(id=>BOONS.find(b=>b.id===id)?.family));const combos=SYNERGIES.filter(s=>s.families.every(f=>families.has(f)));
    if(combos.length){owned.append(n('h4','mw-combo-title','조합 효과 적용 중'));for(const s of combos)owned.append(n('p','mw-synergy',`${s.name} · ${s.description}`));}
    this.content.append(owned,details(`길드 명성 ${fmt(this.state.renown)} · 영구 숙련 ${this.state.unlocked.length}개 · 발견 ${this.state.discoveries.length}곳. 각인은 이번 출격에만 유지됩니다. 명성·영구 숙련·도감·선택 기록은 귀환하거나 패배해도 남습니다.`,'귀환 후에도 남는 성장'),btn(this.battle.active?'전투로 돌아가기':'닫기',()=>this.close(),'mw-close mw-run-return'));
  }
  runIntro(title,text,eyebrow,image,target=this.content,backdrop=null) {
    const intro=n('section','mw-run-intro');
    if(backdrop)intro.style.backgroundImage=`linear-gradient(90deg,#101e20f5,#101e20b8),url('/img/expansion/${backdrop}.webp')`;
    const body=n('div');body.append(n('small','mw-eyebrow',eyebrow),n('h3','mw-choice-title',title),n('p','',text));intro.append(art(image),body);target.append(intro);
  }
  refresh() {
    const r=this.battle.run,active=this.battle.active;
    this.hud.textContent=r?.queue.length?`각인 +${r.queue.length}`:`각인 ${r?.picked.length||0}`;
    this.hud.setAttribute('aria-label',r?.queue.length?`각인 선택 ${r.queue.length}개 대기`:`원정 각인 ${r?.picked.length||0}개 보기`);
    this.hud.classList.toggle('mw-ready',!!r?.queue.length);
    this.strip.hidden=!active||!r?.enabled;
    if(r)this.strip.textContent=`명성 +${r.renown} · 각인 ${r.picked.length} · ${this.battle.elapsed<this.battle.counterUntil?'반격 준비':'마무리 공격으로 균형 파괴'}`;
    const e=this.battle.player?.lockTarget||this.battle.lastTarget;
    this.posture.hidden=!active||!r?.enabled||!e?.alive||e.spawning;
    if(!this.posture.hidden)this.posture.textContent=e.breakT>0?'균형 붕괴 · 받는 피해 +30%':`균형 ${Math.round(e.posture||0)} / ${e.postureMax||80}`;
    const result=this.battle.result?.masterworks;this.result.hidden=!result;
    if(result)this.result.textContent=`기억에 남은 성장 · 명성 +${result.renown} · 균형 붕괴 ${result.breaks} · 정확 회피 ${result.perfects}`;
  }
  tick(dt){this.timer+=Number.isFinite(dt)?dt:0;if(this.timer>=.15){this.timer=0;this.refresh();}}
}
