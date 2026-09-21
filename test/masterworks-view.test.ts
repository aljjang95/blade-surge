import { expect, test } from 'bun:test';
import { MasterworksView } from '../src/ui/masterworks.js';
import { BOONS } from '../src/data/masterworks.js';
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
  children:MWElement[]=[];className='';textContent='';style:any={};dataset:any={};attrs:any={};disabled=false;src='';alt='';open=false;value:any;max:any;
  constructor(public tagName:string){}append(...nodes:MWElement[]){this.children.push(...nodes);}setAttribute(k:string,v:string){this.attrs[k]=v;}addEventListener(){}
  all():MWElement[]{return this.children.flatMap(c=>[c,...c.all()]);}text():string{return this.textContent+this.children.map(c=>c.text()).join('');}
}
function renderFixture(run=false){
  const v:any=Object.create(MasterworksView.prototype);v.tab=run?'run':'mastery';v.content=new MWElement('div');v.app={};
  v.battle={active:false,masterworks:{s:{renown:3,discoveries:[],unlocked:[],path:'balanced',challengeIds:[],presets:[]}},run:{enabled:true,picked:[],queue:[]},currentOffer:()=>({kind:'boon',ids:['ember_edge','tide_breath','storm_eye']})};return v;
}
function withMWDOM(fn:()=>void){const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:(t:string)=>new MWElement(t)}});try{fn();}finally{if(descriptor)Object.defineProperty(globalThis,'document',descriptor);else Reflect.deleteProperty(globalThis,'document');}}
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
  expect(cards[i].text()).toContain(`강화 ${rank} → ${rank+1}`);expect(chips[i].text()).toBe(`${boon.name} ${rank}`);
  expect(cards[i].children[0].alt).toBe('');expect(chips[i].children[0].alt).toBe('');
 });
}));

test('art resolver accepts exact own registry keys and preserves the original fallback',()=>{
 expect(uiArt('boon-ember_edge')).toBe('/img/ui-crafted/engraving/ember_edge.webp');
 for(const id of ['loadout','gold','boon-ember','boon-EMBER_EDGE','boon-missing','constructor','toString','__proto__'])expect(uiArt(id)).toBe(`/img/ui-crafted/${id}.webp`);
});
