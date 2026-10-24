import { expect, test } from 'bun:test';
import { MasterworksView } from '../src/ui/masterworks.js';
import { BOONS } from '../src/data/masterworks.js';
import { normalizeMasterworks } from '../src/game/masterworks-core.js';
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
  v.battle={active:false,masterworks:{s:{...normalizeMasterworks(null),renown:3}},run:{enabled:true,picked:[]}};return v;
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
test('art resolver accepts exact own registry keys and preserves the original fallback',()=>{
 expect(uiArt('boon-ember_edge')).toBe('/img/ui-crafted/engraving/ember_edge.webp');
 for(const id of ['loadout','gold','boon-ember','boon-EMBER_EDGE','boon-missing','constructor','toString','__proto__'])expect(uiArt(id)).toBe(`/img/ui-crafted/${id}.webp`);
});

for(const family of new Set(BOONS.map(b=>b.family)))test(`${family} pre-run boons show distinct per-ID artwork on applied chips without any choice card`,()=>withMWDOM(()=>{
 const boons=BOONS.filter(b=>b.family===family),view=renderFixture(true),ids=boons.map(b=>b.id);
 view.battle.run.picked=ids.flatMap((id,i)=>Array(i%2+1).fill(id));
 view.renderRun();const nodes:MWElement[]=view.content.all(),chips=nodes.filter(n=>n.className.split(' ').includes('mw-chip'));
 const expected=ids.map(id=>`/img/ui-crafted/engraving/${id}.webp`);
 expect(chips.map(n=>n.children[0].src)).toEqual(expected);expect(new Set(expected).size).toBe(boons.length);
 expect(nodes.filter(n=>n.dataset.boon||n.dataset.storyChoice)).toHaveLength(0);
 boons.forEach((boon,i)=>{
  const rank=i%2+1;expect(chips[i].text()).toContain(String(boon.name));expect(chips[i].text()).toContain(`적용 중 · ${rank}단계`);
  expect(chips[i].text()).toContain(`${rank>1?'단계당 · ':''}${boon.description}`);expect(chips[i].tagName).toBe('article');expect(chips[i].children[0].alt).toBe('');
 });
}));

test('run view only inspects applied pre-run boons and combinations, never offers a choice, and folds permanent growth',()=>withMWDOM(()=>{
  const view=renderFixture(true);view.battle.run.picked=['ember_edge','ember_edge','storm_eye'];
  const before=structuredClone(view.battle.run);view.render();const nodes:MWElement[]=view.content.all();
  expect(view.title.textContent).toBe('원정 각인 현황');expect(view.content.text()).toContain('출격 중에는 새 각인을 얻지 않으며');
  expect(nodes.filter(n=>n.dataset.boon||n.dataset.storyChoice)).toHaveLength(0);expect(nodes.some(n=>n.className==='mw-pending')).toBe(false);
  const owned=nodes.find(n=>n.className==='mw-owned')!;expect(owned.text()).toContain('2종 · 총 3단계');expect(owned.text()).toContain('적용 중 · 2단계');expect(owned.text()).toContain('단계당 · 공격력 +5%');
  expect(owned.text()).toContain('질주하는 불씨');expect(owned.text()).toContain('공격력 +7%');
  const growth=nodes.find(n=>n.tagName==='details'&&n.text().includes('귀환 후에도 남는 성장'))!;expect(growth.open).toBe(false);expect(growth.text()).toContain('길드 명성 3');
  expect(view.battle.run).toEqual(before);
  view.battle.run.picked=[];view.render();expect(view.content.text()).toContain('이번 출격에 적용된 각인이 없습니다');
}));

test('no run and shared-rule battles explain their purpose without presenting personal reward choices',()=>withMWDOM(()=>{
  const view=renderFixture(true);view.battle.run=null;view.render();expect(view.content.text()).toContain('출격 전 각인 없음');expect(view.content.text()).toContain('출격 중에는 각인 보상이 없습니다');
  view.battle.run={enabled:false,picked:[]};view.render();expect(view.content.text()).toContain('공용 전투 규칙');
  expect(view.content.all().some((n:MWElement)=>n.dataset.boon||n.dataset.ownedBoon||n.className==='mw-pending')).toBe(false);
  view.tab='mastery';view.render();expect(view.dialog.dataset.view).toBe('mastery');expect(view.nav.hidden).toBe(false);expect(view.content.text()).toContain('영구 숙련');
  view.tab='quests';view.render();expect(view.dialog.dataset.view).toBe('quests');expect(view.nav.hidden).toBe(false);expect(view.content.text()).toContain('길드 의뢰');
}));

test('HUD 각인 버튼은 출격 전 각인이 있을 때만 보이고 획득 대기 뱃지(+N)는 없다',()=>withMWDOM(()=>{
  const battle:any={active:true,elapsed:0,counterUntil:0,run:{enabled:true,picked:[],renown:2},masterworks:{s:normalizeMasterworks(null)},setPaused(){}};
  const view:any=new MasterworksView({mode:'battle'},battle);
  view.refresh();expect(view.hud.hidden).toBe(true);expect(view.hud.textContent).not.toContain('+');expect(view.strip.textContent).toBe('명성 +2 · 마무리 공격으로 균형 파괴');
  battle.run.picked=['ember_edge','ember_edge'];view.refresh();
  expect(view.hud.hidden).toBe(false);expect(view.hud.textContent).toBe('각인 2');expect(view.strip.textContent).toContain('각인 2');
  battle.run={enabled:false,picked:['ember_edge']};view.refresh();expect(view.hud.hidden).toBe(true);
  battle.run=null;view.refresh();expect(view.hud.hidden).toBe(true);
}));

test('사용자가 직접 연 각인 현황만 전투를 멈추고 닫으면 같은 틱에 풀린다',()=>withMWDOM(()=>{
  const pauses=new Set<string>();
  const battle:any={active:true,elapsed:0,counterUntil:0,run:{enabled:true,picked:['tide_guard'],renown:0},masterworks:{s:normalizeMasterworks(null)},
    setPaused(reason:string,on:boolean){if(on)pauses.add(reason);else pauses.delete(reason);}};
  const view:any=new MasterworksView({mode:'battle'},battle),trigger=new MWElement('button');
  expect(view.dialog.open).toBe(false);expect(pauses.size).toBe(0);
  view.open('run',trigger);expect(view.dialog.open).toBe(true);expect(pauses).toEqual(new Set(['masterworks']));
  view.close();expect(view.dialog.open).toBe(false);expect(pauses.size).toBe(0);expect(trigger.focused).toBe(true);
}));

test('마을 준비 탭은 출격 중 각인 선택을 약속하지 않고 각인 자리를 준비 중으로 알린다',()=>withMWDOM(()=>{
  const view=renderFixture();view.tab='build';view.battle.masterworks.path=()=>({ok:true});view.render();
  const text=view.content.text();
  expect(text).not.toContain('각인은 출격 중 선택');expect(text).toContain('각인 · 준비 중');expect(text).toContain('출격 전에 고르는 1회용 각인');
  expect(view.content.all().filter((n:MWElement)=>n.dataset.soon==='engraving')).toHaveLength(1);
}));
