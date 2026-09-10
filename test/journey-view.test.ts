import {expect,test} from 'bun:test';
import {JourneyView} from '../src/ui/journey.js';

function fixture(result:any=null){
  const calls:string[]=[],view:any=Object.create(JourneyView.prototype),ticket={id:1};
  const controller:any={open:(tab:string)=>calls.push(`open:${tab}`)};let current=result;
  Object.defineProperty(controller,'result',{get:()=>current,set:(r:any)=>{current=r;calls.push('clear-result');}});
  Object.assign(view,{counts:{glass_garden:3},notice:{textContent:''},close:()=>calls.push('close'),refresh:()=>calls.push('refresh'),
    app:{mode:'lobby',stageStarting:false,expeditionTicket:ticket,expeditionUI:controller,battle:{active:false,chronicle:{open:(tab:string)=>calls.push(`chronicle:${tab}`)}},
      toLobby:()=>calls.push('lobby'),meta:{openTab:(tab:string)=>calls.push(`meta:${tab}`)},eco:{s:{selected:'knight'}},
      journey:{target:()=>({recipe:{id:'craft_armor'}}),equipTarget:()=>{calls.push('equip');return {ok:true,uid:7};}},
      expedition:{craft:(id:string)=>{calls.push(`craft:${id}`);return {ok:true,item:{uid:7}};},sweepDungeon:(id:string,count:number)=>{calls.push(`sweep:${id}:${count}`);return {ok:true};}},
      showcaseHero:(id:string)=>calls.push(`showcase:${id}`),startExpedition:async(kind:string,id:string,opts:any)=>{calls.push(`start:${kind}:${id}:${opts.rift}`);return true;},
    }});return {view,calls,controller,ticket};
}

test('journey navigation leaves settled results before opening actual progression destinations',()=>{
  for(const [action,destination] of [['forge','open:forge'],['heroes','meta:heroes'],['mastery','chronicle:mastery']]){
    const {view,calls,controller}=fixture({win:true});expect(view.navigate(action)).toEqual({ok:true});
    expect(calls).toEqual(['close','clear-result','lobby',destination]);expect(controller.result).toBeNull();
  }
  const {view,calls}=fixture();view.navigate('quests');expect(calls).toEqual(['close','open:quests']);
});

test('failed settlement and active combat block navigation and direct economy mutations',()=>{
  for(const mode of ['save','active','starting']){
    const result=mode==='save'?{saveError:true}:null,{view,calls,controller,ticket}=fixture(result);
    view.app.battle.active=mode==='active';view.app.stageStarting=mode==='starting';
    expect(view.navigate('dungeons').ok).toBe(false);expect(view.sweep('glass_garden').ok).toBe(false);
    expect(view.craftTarget().ok).toBe(false);expect(view.equipTarget().ok).toBe(false);
    expect(calls).toEqual([]);expect(controller.result).toBe(result);expect(view.app.expeditionTicket).toBe(ticket);expect(view.notice.textContent.length).toBeGreaterThan(0);
  }
});

test('craft and sweep use their own services directly while equip refreshes the selected actor only on success',()=>{
  const {view,calls}=fixture();view.craftTarget();expect(calls).toEqual(['craft:craft_armor','refresh']);calls.length=0;
  view.sweep('glass_garden');expect(calls).toEqual(['sweep:glass_garden:3','refresh']);calls.length=0;
  view.equipTarget();expect(calls).toEqual(['equip','refresh','showcase:knight']);calls.length=0;
  view.app.journey.equipTarget=()=>({ok:false,error:'storage'});expect(view.equipTarget().ok).toBe(false);expect(calls).toEqual(['refresh']);expect(view.notice.textContent).toBe('storage');
});

test('rift launch preserves failed settlement and passes the exact rift option after safe result exit',async()=>{
  const {view,calls}=fixture({win:true});expect(await view.launchRift('glass_garden')).toBe(true);
  expect(calls).toEqual(['close','clear-result','lobby','start:dungeon:glass_garden:true']);
  const blocked=fixture({saveError:true});expect(await blocked.view.launchRift('glass_garden')).toBe(false);expect(blocked.calls).toEqual([]);
});

test('closing the journey releases only its own pause owner and restores the trigger',()=>{
  const {view,calls}=fixture();const reasons=new Set(['journey','masterworks']);
  view.app.battle.setPaused=(id:string,on:boolean)=>{if(on)reasons.add(id);else reasons.delete(id);};
  view.trigger={isConnected:true,focus:()=>calls.push('focus')};view.releasePause();
  expect([...reasons]).toEqual(['masterworks']);expect(calls).toEqual(['focus']);
});

test('sweep completion reports only the level-up gold actually returned by settlement',()=>{
  const {view}=fixture();view.app.expedition.sweepDungeon=()=>({ok:true,rewards:{gold:1200,levelGold:300}});
  view.sweep('glass_garden');expect(view.notice.textContent).toContain('보너스 골드 300');
  view.app.expedition.sweepDungeon=()=>({ok:true,rewards:{gold:1200,levelGold:0}});
  view.sweep('glass_garden');expect(view.notice.textContent).not.toContain('보너스 골드');
  view.app.expedition.sweepDungeon=()=>({ok:false,error:'저장 실패',rewards:{levelGold:300}});
  view.sweep('glass_garden');expect(view.notice.textContent).toBe('저장 실패');
});

class JourneyElement {
  children:JourneyElement[]=[];className='';textContent='';style:any={};dataset:any={};attrs:any={};disabled=false;src='';alt='';open=false;value:any;max:any;
  constructor(public tagName:string){}append(...nodes:JourneyElement[]){this.children.push(...nodes);}setAttribute(k:string,v:string){this.attrs[k]=v;}addEventListener(){}
  all():JourneyElement[]{return this.children.flatMap(c=>[c,...c.all()]);}text():string{return this.textContent+this.children.map(c=>c.text()).join('');}
}
function withJourneyDOM(fn:()=>void){const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:(t:string)=>new JourneyElement(t)}});try{fn();}finally{if(descriptor)Object.defineProperty(globalThis,'document',descriptor);else Reflect.deleteProperty(globalThis,'document');}}
test('journey cards show illustrated rewards with exact counts, real progress and visible prerequisites',()=>withJourneyDOM(()=>{
 const {view}=fixture();view.tab='journey';view.content=new JourneyElement('div');
 view.renderSteps({steps:[{id:'first',name:'첫 준비',description:'전투 방식을 선택하세요.',action:'prepare',claimed:false,complete:false,ready:false,rewards:{gold:240,materials:{glass_leaf:2},consumables:{hp_tonic:1}}}]});
 const nodes=view.content.all(),srcs=nodes.filter((n:JourneyElement)=>n.tagName==='img').map((n:JourneyElement)=>n.src);
 expect(srcs).toContain('/img/ui-crafted/loadout.webp');expect(srcs).toContain('/img/ui-crafted/gold.webp');expect(srcs).toContain('/img/ui-crafted/material-leaf.webp');expect(srcs).toContain('/img/ui-crafted/potion-health.webp');
 expect(view.content.text()).toContain('골드 240');expect(view.content.text()).toContain('유리 잎 2');expect(view.content.text()).toContain('앞 단계 보상과 목표 완료 필요');
 expect(nodes.find((n:JourneyElement)=>n.tagName==='progress').value).toBe(0);expect(nodes.find((n:JourneyElement)=>n.dataset.control==='claim-step-first').disabled).toBe(true);
 expect(nodes.filter((n:JourneyElement)=>n.tagName==='details').every((n:JourneyElement)=>!n.open)).toBe(true);
}));
test('illustrated supply keeps expenditure, insufficient balance and disabled sweep outside folded rules',()=>withJourneyDOM(()=>{
 const {view}=fixture();view.tab='supply';view.content=new JourneyElement('div');view.app.eco.s.energy=1;view.app.eco.s.sweep=0;
 view.app.expedition.sweepPreview=()=>({ok:true,affordable:false,energy:4,tickets:1,rewards:{gold:360,xp:100,materials:{glass_leaf:3}}});
 view.renderSupply({autoBattle:false});const nodes=view.content.all();
 expect(view.content.text()).toContain('사용: 에너지 4 · 소탕권 1');expect(view.content.text()).toContain('에너지 또는 소탕권이 부족합니다.');
 expect(nodes.filter((n:JourneyElement)=>n.dataset.control?.startsWith('sweep-')).every((n:JourneyElement)=>n.disabled)).toBe(true);
 expect(nodes.filter((n:JourneyElement)=>n.className==='journey-reward-icons')[0].text()).toContain('원정 EXP 100');
 const banner=nodes.find((n:JourneyElement)=>n.tagName==='details');expect(banner.text()).toContain('영웅 EXP');expect(banner.open).toBe(false);
}));
