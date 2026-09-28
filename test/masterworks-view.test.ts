import { expect, test } from 'bun:test';
import { MasterworksView } from '../src/ui/masterworks.js';
import { BOONS, STORY_EVENTS } from '../src/data/masterworks.js';
import { Battle } from '../src/game/masterworks-battle.js';
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
