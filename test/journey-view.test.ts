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
