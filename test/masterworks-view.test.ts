import { expect, test } from 'bun:test';
import { MasterworksView } from '../src/ui/masterworks.js';
import { BOONS, STORY_EVENTS } from '../src/data/masterworks.js';
import { Battle } from '../src/game/masterworks-battle.js';
import { normalizeMasterworks, previewBoon } from '../src/game/masterworks-core.js';
import { uiArt } from '../src/ui/illustrated.js';

function fixture(result:any=null) {
  const calls:string[]=[],ticket={id:7};
  const controller:any={open:(tab:string)=>calls.push(`open:${tab}`)};
  let current=result;
  Object.defineProperty(controller,'result',{get:()=>current,set:(value:any)=>{calls.push('clear-result');current=value;}});
  const view:any=Object.create(MasterworksView.prototype);
  Object.assign(view,{notice:{textContent:''},dialog:{open:true,close(){calls.push('close');this.open=false;}},app:{expeditionUI:controller,expeditionTicket:ticket,toLobby:()=>{expect(controller.result).toBeNull();calls.push('lobby');}}});
  return {view,controller,calls,ticket};
}

for(const tab of ['dungeons','forge'])test(`settled result routes to ${tab} after clearing result and returning to lobby`,()=>{
  const {view,controller,calls}=fixture({win:true,rewards:{gold:100}});
  expect(view.openExpedition(tab)).toEqual({ok:true});
  expect(calls).toEqual(['close','clear-result','lobby',`open:${tab}`]);expect(controller.result).toBeNull();
});

test('lobby expedition navigation only closes the journal and opens the requested tab',()=>{
  const {view,calls}=fixture();expect(view.openExpedition('dungeons').ok).toBe(true);
  expect(calls).toEqual(['close','open:dungeons']);
});

test('failed settlement preserves its result, ticket and journal and explains retry',()=>{
  const result={saveError:true,win:true,rewards:{gold:100}};
  const {view,controller,calls,ticket}=fixture(result);
  expect(view.openExpedition('forge')).toEqual({ok:false,error:'settlement'});
  expect(calls).toEqual([]);expect(controller.result).toBe(result);expect(view.app.expeditionTicket).toBe(ticket);
  expect(view.dialog.open).toBe(true);expect(view.notice.textContent).toContain('정산을 다시 저장');
  result.saveError=false;expect(view.openExpedition('forge').ok).toBe(true);
  expect(calls).toEqual(['close','clear-result','lobby','open:forge']);
});

test('close synchronously releases only the masterworks pause before the native close event',()=>{
  const reasons=new Set(['catalogue','masterworks']);const calls:string[]=[];
  const battle:any={paused:true,setPaused(reason:string,on:boolean){if(on)reasons.add(reason);else reasons.delete(reason);this.paused=reasons.size>0;calls.push(`pause:${reason}:${on}`);}};
  const dialog:any={open:true,close(){calls.push(`dialog:${battle.paused}`);this.open=false;}};
  const view:any=Object.assign(Object.create(MasterworksView.prototype),{battle,dialog});
  view.close();
  expect(calls).toEqual(['pause:masterworks:false','dialog:true']);
  expect(reasons).toEqual(new Set(['catalogue']));expect(battle.paused).toBe(true);
  // The native close listener repeats this operation; it must stay idempotent.
  battle.setPaused('masterworks',false);
  expect(reasons).toEqual(new Set(['catalogue']));
});

// Minimal DOM boundary: verify actual render output without a browser or new dependency.
class MWElement {
  children:MWElement[]=[];className='';textContent='';style:any={};dataset:any={};attrs:any={};disabled=false;src='';alt='';open=false;hidden=false;scrollTop=0;isConnected=true;focused=false;value:any;max:any;
  listeners:Record<string,((event:any)=>void)[]>={};classList={toggle:()=>{}};
  constructor(public tagName:string){}append(...nodes:MWElement[]){this.children.push(...nodes);}setAttribute(k:string,v:string){this.attrs[k]=v;}
  addEventListener(type:string,fn:(event:any)=>void){(this.listeners[type]??=[]).push(fn);}
  dispatch(type:string){for(const fn of this.listeners[type]||[])fn({currentTarget:this});}
  click(){if(!this.disabled)this.dispatch('click');}focus(){this.focused=true;}
  showModal(){this.open=true;}close(){this.open=false;this.dispatch('close');}
  replaceChildren(...nodes:MWElement[]){this.children=nodes;this.scrollTop=0;}
  all():MWElement[]{return this.children.flatMap(c=>[c,...c.all()]);}text():string{return this.textContent+this.children.map(c=>c.text()).join('');}
}
function renderFixture(run=false){
  const v:any=Object.create(MasterworksView.prototype);v.tab=run?'run':'mastery';v.content=new MWElement('div');v.dialog=new MWElement('dialog');v.nav=new MWElement('nav');v.title=new MWElement('h2');v.app={};
  const queue=[{kind:'boon',ids:['ember_edge','tide_breath','storm_eye']}];
  v.battle={active:false,masterworks:{s:{...normalizeMasterworks(null),renown:3}},run:{enabled:true,picked:[],queue},currentOffer:()=>v.battle.run?.queue[0]};return v;
}
function withMWDOM(fn:()=>void){const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:(t:string)=>new MWElement(t),body:new MWElement('body'),querySelector:()=>null}});try{fn();}finally{if(descriptor)Object.defineProperty(globalThis,'document',descriptor);else Reflect.deleteProperty(globalThis,'document');}}
test('illustrated mastery keeps exact effects, cost and prerequisite while folding introductory rules',()=>withMWDOM(()=>{
 const view=renderFixture();view.renderMastery();const nodes=view.content.all();
 expect(nodes.filter((n:MWElement)=>n.tagName==='img'&&n.src.includes('/img/ui-crafted/')).length).toBeGreaterThan(9);
 expect(nodes.filter((n:MWElement)=>n.tagName==='img').every((n:MWElement)=>n.alt==='')).toBe(true);
 const details=nodes.filter((n:MWElement)=>n.tagName==='details');expect(details.length).toBeGreaterThan(0);expect(details.every((n:MWElement)=>!n.open)).toBe(true);
 expect(view.content.text()).toContain('공격력 +2%');expect(view.content.text()).toContain('명성 6');expect(view.content.text()).toContain('이전 단계 필요');
 expect(nodes.filter((n:MWElement)=>n.tagName==='button').every((n:MWElement)=>n.disabled)).toBe(true);
}));

test('journal displays exact expedition, hero, mixed control and observed zeroes while preserving honest legacy history',()=>withMWDOM(()=>{
  const view=renderFixture();view.battle.masterworks.s.history=[
    {runId:1,floor:1,outcome:'defeat',boonIds:[],details:null},
    {runId:2,floor:1,outcome:'victory',boonIds:['ember_edge'],details:{route:{kind:'dungeon',id:'bellfall_crypt',depth:'standard',conquestId:null,riftId:null},heroId:'mage',heroLevel:3,control:'mixed',perfects:0,breaks:4,timeSec:127.25}},
  ];
  const before=JSON.stringify(view.battle.masterworks.s);view.renderJournal();
  const cards=view.content.all().filter((n:MWElement)=>n.dataset.runHistory);
  expect(cards.map((n:MWElement)=>n.dataset.runHistory)).toEqual(['2','1']);
  expect(cards[0].text()).toContain('종락의 지하 회랑');expect(cards[0].text()).toContain('대마도사 리아');expect(cards[0].text()).toContain('출격 Lv.3');
  expect(cards[0].text()).toContain('수동·AUTO 혼합');expect(cards[0].text()).toContain('정확 회피 0');expect(cards[0].text()).toContain('균형 붕괴 4');expect(cards[0].text()).toContain('127초');
  expect(cards[1].text()).toContain('패배');expect(cards[1].text()).toContain('경로 상세 없음');expect(cards[1].text()).toContain('상세 기록 없음');expect(cards[1].text()).not.toContain('정확 회피 0');
  expect(JSON.stringify(view.battle.masterworks.s)).toBe(before);
}));

test('journal personal best uses the rolling twenty records and exposes one inline metric group with the existing route cost',()=>withMWDOM(()=>{
  const view=renderFixture(),d={route:{kind:'dungeon',id:'glass_garden',depth:'standard',conquestId:null,riftId:null},heroId:'knight',heroLevel:4,control:'auto',timeSec:60.125,perfects:0,breaks:2};
  view.tab='journal';view.app={eco:{s:{selected:'knight'},hero:()=>({level:5})},journey:{s:{autoBattle:true}}};
  view.battle.masterworks.s.history=[{runId:1,floor:1,outcome:'victory',boonIds:[],details:d},{runId:2,floor:1,outcome:'defeat',boonIds:[],details:null}];
  view.battle.masterworks.s.personalGoal={context:d,metric:'perfects'};view.battle.masterworks.goal=()=>({ok:true});
  const before=JSON.stringify(view.battle.masterworks.s);view.renderJournal();const nodes:MWElement[]=view.content.all();
  const panel=nodes.find(n=>n.attrs['aria-label']==='최근 기록의 개인 목표');
  if(!panel)throw Error('Personal goal panel missing');
  expect(panel.text()).toContain('최근 20개');expect(panel.text()).toContain('비교 승리 1회');expect(panel.text()).toContain('정확 회피 0회');
  expect(panel.text()).toContain('정확 회피 1회 이상');expect(panel.text()).toContain('출격 Lv.4');expect(panel.text()).toContain('출격 Lv.5');
  expect(panel.text()).toContain('조건이 달라지면 비교하지 않습니다');expect(panel.text()).toContain('에너지 4');
  const choices=nodes.filter(n=>n.dataset.personalGoalMetric);expect(choices.map(n=>n.dataset.personalGoalMetric)).toEqual(['time','perfects','breaks']);
  expect(choices.map(n=>n.attrs['aria-pressed'])).toEqual(['false','true','false']);expect(nodes.filter(n=>n.tagName==='dialog')).toHaveLength(0);
  expect(nodes.filter(n=>n.dataset.goalRun).map(n=>n.dataset.goalRun)).toEqual(['1']);expect(JSON.stringify(view.battle.masterworks.s)).toBe(before);
}));

test('invalid history and duplicate run IDs never offer a goal selector or a departure',()=>withMWDOM(()=>{
  const view=renderFixture(),details={route:{kind:'dungeon',id:'glass_garden',depth:'standard'},heroId:'knight',heroLevel:4,control:'auto',timeSec:1,perfects:0,breaks:0};
  view.battle.masterworks.s.history=[{runId:1,floor:1,outcome:'victory',boonIds:[],details},{runId:1,floor:1,outcome:'defeat',boonIds:[],details:null}];
  view.renderJournal();const nodes:MWElement[]=view.content.all();expect(nodes.filter(n=>n.dataset.goalRun||n.dataset.personalGoalMetric||n.dataset.personalGoalDeparture)).toHaveLength(0);
  expect(view.content.text()).toContain('기록된 출격을 마치면 목표를 선택');
}));

test('dungeon goal departure delegates exact route options once without changing hero/control/goal or adding payment calls',async()=>{
  const context={route:{kind:'dungeon',id:'glass_garden',depth:'standard',conquestId:null,riftId:null},heroId:'knight',heroLevel:4,control:'auto'};
  const calls:any[]=[],goal={context,metric:'breaks'},eco={s:{selected:'mage',heroes:{mage:{level:7}}}};
  let release:any;const authority=new Promise(resolve=>{release=resolve;});
  const app:any={eco,journey:{s:{autoBattle:false}},startExpedition:async(...args:any[])=>{calls.push(args);return authority;}};
  const view:any=Object.assign(Object.create(MasterworksView.prototype),{app,notice:{textContent:''},battle:{active:false,rpgDirty:false,masterworks:{s:{personalGoal:goal}}},close:()=>calls.push('close')});
  const before=JSON.stringify({eco,goal,journey:app.journey}),first=view.departPersonalGoal(context);
  expect(await view.departPersonalGoal(context)).toEqual({ok:false});
  expect(calls).toEqual(['close',['dungeon','glass_garden',{rift:false,depth:'standard',conquestId:undefined}]]);
  release(true);expect(await first).toEqual({ok:true});expect(view.goalStarting).toBe(false);
  expect(JSON.stringify({eco,goal,journey:app.journey})).toBe(before);
});

test('failed dungeon admission reopens the journal without manually charging or refunding',async()=>{
  const context={route:{kind:'dungeon',id:'glass_garden',depth:'deep',conquestId:null,riftId:null},heroId:'knight',heroLevel:4,control:'auto'};
  const calls:any[]=[],goal={context,metric:'time'},app:any={eco:{s:{energy:1}},startExpedition:async(...args:any[])=>{calls.push(args);return false;}};
  const view:any=Object.assign(Object.create(MasterworksView.prototype),{app,notice:{textContent:''},battle:{active:false,rpgDirty:false,masterworks:{s:{personalGoal:goal}}},close:()=>calls.push('close'),open:(tab:string)=>calls.push(`open:${tab}`)});
  expect(await view.departPersonalGoal(context)).toEqual({ok:false});expect(app.eco.s.energy).toBe(1);expect(view.goalStarting).toBe(false);
  expect(calls).toEqual(['close',['dungeon','glass_garden',{rift:false,depth:'deep',conquestId:undefined}],'open:journal']);
  expect(view.notice.textContent).toContain('현재 접근 조건과 에너지');
});

test('campaign goal navigation clears only a saved expedition overlay and uses the existing selector without a departure/payment',async()=>{
  const context={route:{kind:'campaign',id:'1-1',difficultyId:'story'},heroId:'knight',heroLevel:4,control:'auto'};
  const calls:any[]=[],goal={context,metric:'time'},app:any={mode:'battle',eco:{s:{energy:10}},expeditionUI:{result:{win:true}},expedition:{s:{pending:null}},
    toLobby(){expect(this.expeditionUI.result).toBeNull();calls.push('lobby');this.mode='lobby';},meta:{openTab:(...args:any[])=>calls.push(args)}};
  const view:any=Object.assign(Object.create(MasterworksView.prototype),{app,notice:{textContent:''},battle:{active:false,rpgDirty:false,masterworks:{s:{personalGoal:goal}}},close:()=>calls.push('close')});
  expect(await view.departPersonalGoal(context)).toEqual({ok:true});expect(calls).toEqual(['close','lobby',['stage','campaign']]);expect(app.eco.s.energy).toBe(10);
  app.expedition.s.pending={id:1};calls.length=0;expect(await view.departPersonalGoal(context)).toEqual({ok:false});expect(calls).toEqual([]);
  app.expedition.s.pending=null;app.expeditionRefundPending=true;expect(await view.departPersonalGoal(context)).toEqual({ok:false});expect(calls).toEqual([]);
});
test('boon choice artwork follows its ID and keeps chain cap directly on choice',()=>withMWDOM(()=>{
 const view=renderFixture(true);view.renderRun();const cards=view.content.all().filter((n:MWElement)=>n.dataset.boon);
 expect(cards).toHaveLength(3);expect(cards.map((n:MWElement)=>n.children[0].src)).toEqual(['/img/ui-crafted/engraving/ember_edge.webp','/img/ui-crafted/engraving/tide_breath.webp','/img/ui-crafted/engraving/storm_eye.webp']);
 expect(cards[2].text()).toContain('최대 2명');expect(cards[0].text()).toContain('공격력 +5%');expect(cards.every((n:MWElement)=>n.tagName==='button')).toBe(true);
}));

for(const family of new Set(BOONS.map(b=>b.family)))test(`${family} boons have distinct per-ID artwork shared by choices and picked chips`,()=>withMWDOM(()=>{
 const boons=BOONS.filter(b=>b.family===family),view=renderFixture(true),ids=boons.map(b=>b.id);
 view.battle.currentOffer=()=>({kind:'boon',ids});view.battle.run.picked=ids.flatMap((id,i)=>Array(i%2+1).fill(id));
 view.renderRun();const nodes:MWElement[]=view.content.all(),cards=nodes.filter(n=>n.dataset.boon),chips=nodes.filter(n=>n.className.split(' ').includes('mw-chip'));
 const expected=ids.map(id=>`/img/ui-crafted/engraving/${id}.webp`),sources=cards.map(n=>n.children[0].src);
 expect(sources).toEqual(expected);expect(new Set(sources).size).toBe(boons.length);
 expect(chips.map(n=>n.children[0].src)).toEqual(expected);
 boons.forEach((boon,i)=>{
  const rank=i%2+1;expect(cards[i].dataset.family).toBe(family);expect(cards[i].text()).toContain(String(boon.description));
  expect(cards[i].text()).toContain(`강화 ${rank} → ${rank+1}`);expect(chips[i].text()).toContain(String(boon.name));expect(chips[i].text()).toContain(`적용 중 · ${rank}단계`);
  expect(chips[i].text()).toContain(`${rank>1?'단계당 · ':''}${boon.description}`);expect(chips[i].tagName).toBe('article');
  expect(cards[i].children[0].alt).toBe('');expect(chips[i].children[0].alt).toBe('');
 });
}));

test('art resolver accepts exact own registry keys and preserves the original fallback',()=>{
 expect(uiArt('boon-ember_edge')).toBe('/img/ui-crafted/engraving/ember_edge.webp');
 for(const id of ['loadout','gold','boon-ember','boon-EMBER_EDGE','boon-missing','constructor','toString','__proto__'])expect(uiArt(id)).toBe(`/img/ui-crafted/${id}.webp`);
});

function choiceFixture(queue:any[]) {
  const state={...normalizeMasterworks(null),story:{} as Record<string,string>},storage={fail:false,attempts:0,saved:structuredClone(state)},pauses=new Set<string>();
  const battle:any=Object.assign(Object.create(Battle.prototype),{
    active:true,stage:{code:'1-1'},elapsed:0,player:{alive:true,hp:20,maxHp:100},
    run:{id:1,enabled:true,queue,picked:[],autoPicked:0,renown:0},
    masterworks:{s:state,transact(fn:any,options:any){expect(options.duringBattle).toBe(true);storage.attempts++;if(storage.fail)return {ok:false,error:'저장 실패 · 다시 선택해 주세요.'};const result=fn(state);storage.saved=structuredClone(state);return result;}},
    applyBuild(){},ui:{toast(){}},setPaused(reason:string,on:boolean){if(on)pauses.add(reason);else pauses.delete(reason);},
  });
  const view:any=new MasterworksView({mode:'battle'},battle),trigger=new MWElement('button');battle.chronicle=view;
  view.open('run',trigger);
  return {view,battle,state,storage,pauses,trigger};
}

test('clicking a boon applies only that choice and restores the trigger while the next offer stays queued',()=>withMWDOM(()=>{
  const next={kind:'story',id:'lantern'},first={kind:'boon',ids:['ember_edge','tide_breath','storm_eye']};
  const {view,battle,storage,pauses,trigger}=choiceFixture([first,next]);pauses.add('catalogue');
  expect(view.dialog.dataset.view).toBe('run');expect(view.title.textContent).toBe('원정 각인 선택');expect(view.nav.hidden).toBe(true);
  expect(battle.run.picked).toEqual([]);expect(battle.run.queue).toHaveLength(2);
  const pending=view.content.all().find((n:MWElement)=>n.className==='mw-pending');expect(pending.text()).toContain('2건 · 아직 적용 전');
  pending.all().find((n:MWElement)=>n.dataset.boon==='tide_breath').click();
  expect(battle.run.picked).toEqual(['tide_breath']);expect(battle.run.queue).toEqual([next]);expect(storage.attempts).toBe(0);
  expect(view.dialog.open).toBe(false);expect(pauses).toEqual(new Set(['catalogue']));expect(trigger.focused).toBe(true);
  expect(view.hud.textContent).toBe('각인 +1');
}));

test('rendering a preview leaves the live offer and save untouched, then the native choice applies that same calculation',()=>withMWDOM(()=>{
  const next={kind:'story',id:'lantern'},first={kind:'boon',ids:['ember_edge','tide_breath','storm_eye'],round:2,autoAt:8};
  const {view,battle,state,storage,pauses,trigger}=choiceFixture([first,next]);
  battle.run.picked=['ember_edge'];battle.run.permanent={};battle.run.round=3;
  battle.buildBase={hp:100,atk:20,def:10,spd:5,crit:.05};battle.applyBuild=Battle.prototype.applyBuild;battle.applyBuild();
  pauses.add('catalogue');const before=JSON.stringify({run:battle.run,state,player:battle.player,effects:battle.effects,pauses:[...pauses]});
  view.render();view.render();
  expect(JSON.stringify({run:battle.run,state,player:battle.player,effects:battle.effects,pauses:[...pauses]})).toBe(before);
  expect(storage.attempts).toBe(0);
  const cards:MWElement[]=view.content.all().filter((n:MWElement)=>n.dataset.boon);
  expect(cards.map(n=>n.dataset.boon)).toEqual(first.ids);expect(cards[0].text()).toContain('공격력 +5% → +10%');
  const preview=previewBoon(battle.run.picked,'storm_eye');if(!preview)throw Error('Expected native choice preview');
  expect(cards[2].text()).toContain('질주하는 불씨');expect(cards[2].text()).toContain('공격력 +5% → +12%');
  expect(battle.selectBoon('storm_edge').ok).toBe(false);expect(battle.run.queue).toEqual([first,next]);
  cards[2].click();
  expect(battle.effects).toEqual(preview.after);expect(battle.player.stats.atk).toBeCloseTo(22.4);
  expect(battle.run.picked).toEqual(['ember_edge','storm_eye']);expect(battle.run.queue).toEqual([next]);expect(storage.attempts).toBe(0);
  expect(view.dialog.open).toBe(false);expect(pauses).toEqual(new Set(['catalogue']));expect(trigger.focused).toBe(true);
}));

test('a capped chain preview explicitly preserves two targets and does not invent a new combination',()=>withMWDOM(()=>{
  const view=renderFixture(true);view.battle.run.picked=['storm_eye','storm_eye','ember_edge','tide_guard','stone_plate'];
  view.battle.currentOffer=()=>({kind:'boon',ids:['storm_eye']});const before=JSON.stringify(view.battle.run);view.renderRun();
  const card:MWElement=view.content.all().find((n:MWElement)=>n.dataset.boon==='storm_eye');
  expect(card.text()).toContain('강화 2 → 3');expect(card.text()).toContain('마무리 연쇄 2명 → 2명 · 상한, 변화 없음');
  expect(card.all().filter(n=>n.className==='mw-preview-synergies')).toHaveLength(0);expect(JSON.stringify(view.battle.run)).toBe(before);
}));

test('four coefficient changes fit three rows while the new-combination group retains the fourth actual change',()=>withMWDOM(()=>{
  const view=renderFixture(true);view.battle.run.picked=['ember_hunt','ember_hunt','tide_guard','tide_guard','stone_plate'];
  view.battle.currentOffer=()=>({kind:'boon',ids:['storm_step']});view.renderRun();
  const card:MWElement=view.content.all().find((n:MWElement)=>n.dataset.boon==='storm_step'),rows=card.all().filter(n=>n.className==='mw-preview-change');
  expect(rows).toHaveLength(3);expect(rows.map(n=>n.text())).toEqual(['이동 속도 +0% → +4%','공격력 +0% → +7%','재사용 대기 -0% → -8%']);
  const combo=card.all().find(n=>n.className==='mw-preview-synergies');if(!combo)throw Error('Expected new combination group');
  for(const name of ['질주하는 불씨','비의 행군','산울림'])expect(combo.text()).toContain(name);
  expect(combo.text()).toContain('치명타 확률 +0% → +4%');expect(combo.text()).not.toContain('바위샘');
  expect(card.all().filter(n=>['button','details','input','a'].includes(n.tagName))).toHaveLength(0);
  expect(view.content.text()).toContain('각인 보너스 합계');expect(view.content.text()).toContain('장비·영구 숙련은 포함하지 않습니다');
}));

test('preview healing retains fractional percentages and uses the current total rather than the static per-rank amount',()=>withMWDOM(()=>{
  const view=renderFixture(true);view.battle.run.picked=['tide_return'];view.battle.currentOffer=()=>({kind:'boon',ids:['tide_return']});view.renderRun();
  const card:MWElement=view.content.all().find((n:MWElement)=>n.dataset.boon==='tide_return');
  expect(card.text()).toContain('처치 회복 0.7% → 1.4%');expect(card.text()).toContain('최대 체력 0.7% 회복');
  expect(card.all().filter(n=>n.className==='mw-preview-change')).toHaveLength(1);
}));

for(const event of STORY_EVENTS)for(const choice of event.choices)test(`${event.id}/${choice.id} displays its real reward and routes selection through the durable story transaction`,()=>withMWDOM(()=>{
  const {view,battle,state,storage}=choiceFixture([{kind:'story',id:event.id}]);
  expect(view.title.textContent).toBe('길 위의 만남');expect(view.content.text()).toContain(event.description);
  const card=view.content.all().find((n:MWElement)=>n.dataset.storyChoice===choice.id);
  const heal=Number(choice.effects.heal||0),renown=Number(choice.effects.renown||0);
  expect(card.text()).toContain(choice.name);expect(card.text()).toContain(choice.consequence);
  expect(card.text()).toContain(heal?`체력 ${Math.round(heal*100)}% 회복`:`명성 +${renown}`);
  expect(card.children[0].src).toBe(uiArt(heal?'potion-health':'renown'));
  expect(state.story[event.id]).toBeUndefined();expect(storage.attempts).toBe(0);
  card.click();
  expect(storage.attempts).toBe(1);expect(storage.saved.story[event.id]).toBe(choice.id);expect(storage.saved.renown).toBe(renown);
  expect(battle.run.renown).toBe(renown);expect(battle.player.hp).toBe(20+Math.round(100*heal));expect(battle.run.queue).toHaveLength(0);expect(view.dialog.open).toBe(false);
}));

test('failed story save keeps the choice, health and modal pause intact until a successful retry',()=>withMWDOM(()=>{
  const offer={kind:'story',id:'lantern'},{view,battle,state,storage,pauses,trigger}=choiceFixture([offer]);storage.fail=true;
  const choice=()=>view.content.all().find((n:MWElement)=>n.dataset.storyChoice==='mend');choice().click();
  expect(storage.attempts).toBe(1);expect(view.notice.textContent).toContain('저장 실패');expect(view.dialog.open).toBe(true);
  expect(battle.run.queue).toEqual([offer]);expect(battle.player.hp).toBe(20);expect(state.story).toEqual({});expect(storage.saved.story).toEqual({});
  expect(pauses).toEqual(new Set(['masterworks']));expect(trigger.focused).toBe(false);
  storage.fail=false;choice().click();
  expect(storage.attempts).toBe(2);expect(storage.saved.story.lantern).toBe('mend');expect(battle.player.hp).toBe(50);expect(battle.run.queue).toHaveLength(0);expect(view.dialog.open).toBe(false);
}));

for(const id of ['guide','mend'])test(`saved lantern choice ${id} shows only its revisit heal and never repays or rewrites the story`,()=>withMWDOM(()=>{
  const {view,battle,state,storage}=choiceFixture([{kind:'story',id:'lantern'}]);state.story.lantern=id;state.renown=20;storage.saved=structuredClone(state);view.render();
  const cards=view.content.all().filter((n:MWElement)=>n.dataset.storyChoice),heal=id==='mend'?12:6;
  expect(cards).toHaveLength(1);expect(cards[0].text()).toContain(`체력 ${heal}% 회복`);expect(cards[0].text()).toContain('지난 선택');expect(cards[0].text()).not.toContain('명성 +');
  cards[0].click();expect(storage.attempts).toBe(0);expect(state.story.lantern).toBe(id);expect(state.renown).toBe(20);expect(storage.saved.story.lantern).toBe(id);
  expect(battle.player.hp).toBe(20+heal);expect(battle.run.renown).toBe(0);expect(battle.run.queue).toHaveLength(0);
}));

test('no-offer inspection separates applied ranks and combinations from choices and folds permanent growth',()=>withMWDOM(()=>{
  const view=renderFixture(true);view.battle.run.queue=[];view.battle.run.picked=['ember_edge','ember_edge','storm_eye'];view.battle.run.autoPicked=2;
  const before=structuredClone(view.battle.run);view.render();const nodes:MWElement[]=view.content.all();
  expect(view.title.textContent).toBe('원정 각인 현황');expect(view.content.text()).toContain('현재 선택할 보상이 없습니다');
  expect(nodes.filter(n=>n.dataset.boon||n.dataset.storyChoice)).toHaveLength(0);expect(nodes.some(n=>n.className==='mw-pending')).toBe(false);
  const owned=nodes.find(n=>n.className==='mw-owned')!;expect(owned.text()).toContain('2종 · 총 3회 획득');expect(owned.text()).toContain('적용 중 · 2단계');expect(owned.text()).toContain('단계당 · 공격력 +5%');
  expect(owned.text()).toContain('질주하는 불씨');expect(owned.text()).toContain('공격력 +7%');expect(owned.text()).toContain('자동 적용 보상 2회 포함');
  const growth=nodes.find(n=>n.tagName==='details'&&n.text().includes('귀환 후에도 남는 성장'))!;expect(growth.open).toBe(false);expect(growth.text()).toContain('길드 명성 3');
  expect(view.battle.run).toEqual(before);
}));

test('pending choices never appear as acquired and an empty build explains where its first boon will appear',()=>withMWDOM(()=>{
  const view=renderFixture(true);view.render();const nodes:MWElement[]=view.content.all(),owned=nodes.find(n=>n.className==='mw-owned')!;
  expect(nodes.filter(n=>n.dataset.boon)).toHaveLength(3);expect(owned.all().filter(n=>n.dataset.ownedBoon)).toHaveLength(0);
  expect(owned.text()).toContain('아직 적용된 각인이 없습니다');expect(owned.text()).toContain('위에서 하나를 고르면');
  view.battle.run.queue=[];view.render();expect(view.content.text()).toContain('전투에서 각인 보상을 얻으면');
}));

test('no run and shared-rule battles explain their purpose without presenting personal reward choices',()=>withMWDOM(()=>{
  const view=renderFixture(true);view.battle.run=null;view.render();expect(view.content.text()).toContain('캠페인·재료 던전');expect(view.content.text()).toContain('출격 후 각인이 모입니다');
  view.battle.run={enabled:false,picked:[],queue:[]};view.render();expect(view.content.text()).toContain('공용 전투 규칙');
  expect(view.content.all().some((n:MWElement)=>n.dataset.boon||n.dataset.ownedBoon||n.className==='mw-pending')).toBe(false);
  view.tab='mastery';view.render();expect(view.dialog.dataset.view).toBe('mastery');expect(view.nav.hidden).toBe(false);expect(view.content.text()).toContain('영구 숙련');
  view.tab='quests';view.render();expect(view.dialog.dataset.view).toBe('quests');expect(view.nav.hidden).toBe(false);expect(view.content.text()).toContain('길드 의뢰');
}));
