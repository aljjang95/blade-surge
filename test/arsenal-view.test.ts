import {beforeEach,afterEach,expect,test} from 'bun:test';
import {ArsenalView} from '../src/ui/arsenal.js';
import {Economy} from '../src/game/economy.js';
import {ExpeditionEconomy} from '../src/game/expedition-economy.js';
import {MasterworksService} from '../src/game/masterworks-service.js';
import {ArsenalService} from '../src/game/arsenal-service.js';
import {COMBAT_ARTS} from '../src/data/combat-arts.js';
class Element {
  children:Element[]=[];className='';id='';dataset:any={};disabled=false;hidden=false;open=false;value='';scrollTop=0;isConnected=true;writes=0;focused=false;onclick:(()=>void)|null=null;attrs:any={};listeners:any={};private text='';
  constructor(public tagName:string){}
  set textContent(v:string){this.text=v;this.children=[];this.writes++;}get textContent():string{return this.text+this.children.map(c=>c.textContent).join('');}
  append(...nodes:Element[]){this.children.push(...nodes);}replaceChildren(){this.text='';this.children=[];}setAttribute(k:string,v:string){this.attrs[k]=v;}
  addEventListener(k:string,fn:any){(this.listeners[k]??=[]).push(fn);}emit(k:string){for(const fn of this.listeners[k]??[])fn({preventDefault(){}});}
  click(){if(!this.disabled)this.onclick?.();}showModal(){this.open=true;}close(){this.open=false;this.emit('close');}focus(){this.focused=true;}scrollIntoView(){}
  querySelector(selector:string):Element|null{return this.all().find(n=>selector.startsWith('.')?n.className.split(' ').includes(selector.slice(1)):n.tagName===selector)||null;}
  all():Element[]{return this.children.flatMap(c=>[c,...c.all()]);}
}
const docDescriptor=Object.getOwnPropertyDescriptor(globalThis,'document'),storageDescriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
let doc:any,values:Map<string,string>;
beforeEach(()=>{values=new Map();doc={body:new Element('body'),activeElement:new Element('button'),createElement:(tag:string)=>new Element(tag),querySelector:()=>new Element('div')};Object.defineProperty(globalThis,'document',{configurable:true,value:doc});Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}});});
afterEach(()=>{for(const [key,descriptor] of [['document',docDescriptor],['localStorage',storageDescriptor]] as const){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}});
function fixture(){
 const reasons=new Set<string>(['other-modal']),calls:string[]=[],eco=new Economy();
 const app:any={eco,mode:'lobby',stageStarting:false,battle:{active:false,setPaused:(id:string,on:boolean)=>on?reasons.add(id):reasons.delete(id)},expeditionUI:{result:null},showcaseHero:(id:string)=>calls.push(id)};
 app.expedition=new ExpeditionEconomy(eco);app.masterworks=new MasterworksService(app);app.arsenal=new ArsenalService(app);
 eco.s.inventory.push({uid:731001,id:'exp_glasswarden_armor',enh:2});eco.s.heroes.knight.equip.armor=731001;eco.s.invSeq=731002;
 const view:any=new ArsenalView(app);view.open();return {app,view,reasons,calls};
}
const buttons=(root:Element,label:string)=>root.all().filter(n=>n.tagName==='button'&&n.textContent===label);
const art=(view:any,id:string)=>view.body.all().find((e:Element)=>e.dataset.art===id)!;
const visibleText=(root:Element):string=>root.tagName==='details'&&!root.open?(root.children.find(c=>c.tagName==='summary')?.textContent||''):root.children.length?root.children.map(visibleText).join(''):root.textContent;

test('illustrated arts keep short DOM labels and native collapsed rules preserve exact effects',()=>{
 const {view}=fixture();
 for(const def of COMBAT_ARTS){const card=art(view,def.id);expect(card.querySelector('img').src).toBe(`/img/ui-crafted/art-${def.id}.webp`);expect(card.textContent).toContain(def.name);expect(card.textContent).not.toContain(def.description);expect(view.body.textContent).toContain(def.description);}
 const visible=visibleText(view.body);expect(visible).not.toContain('AI 결투장');expect(visible).not.toContain('반경 5');expect(visible).not.toContain('✦');expect(visible).not.toContain('◇');expect(visible).not.toContain('↻');
 expect(visible.length).toBeLessThan(view.body.textContent.length/2);
 const guides=view.body.all().filter((node:Element)=>node.tagName==='details');expect(guides.every((node:Element)=>!node.open)).toBe(true);expect(guides.every((node:Element)=>node.children[0].tagName==='summary')).toBe(true);
});

test('each saved card has four illustrated slots and one visible primary action with overwrite behind details',()=>{
 const {app,view}=fixture();app.arsenal.savePreset(0,'방패 구성');view.render();
 const cards=view.body.all().filter((node:Element)=>node.tagName==='article');expect(cards).toHaveLength(3);
 for(const card of cards){expect(card.querySelector('.compact')!.children).toHaveLength(4);expect(card.all().filter((node:Element)=>node.className==='arsenal-primary')).toHaveLength(1);}
 expect(visibleText(cards[0])).toContain('변경 비교');expect(visibleText(cards[0])).not.toContain('덮어쓰기');
 const empty=cards[1].querySelector('.compact')!;expect(empty.children.map((cell:Element)=>(cell.querySelector('img') as any).src)).toEqual(['/img/ui-crafted/slot-weapon.webp','/img/ui-crafted/slot-armor.webp','/img/ui-crafted/slot-ring.webp','/img/ui-crafted/slot-boots.webp']);
});
test('real DOM handlers select/save/compare/apply a real service build and render item names without UID',()=>{
 const {app,view,calls}=fixture();art(view,'aegis').click();expect(app.arsenal.artForHero()).toBe('aegis');
 const input=view.body.querySelector('input');input.value='선봉 구성';buttons(view.body,'현재 구성 저장')[0].click();expect(app.arsenal.s.heroes.knight.presets[0].name).toBe('선봉 구성');
 art(view,'flow').click();app.eco.s.heroes.knight.equip.armor=null;view.render();buttons(view.body,'변경 비교')[0].click();
 expect(view.body.textContent).toContain('변경 비교');expect(view.body.textContent).toContain('체력');expect(view.body.textContent).not.toContain('731001');
 buttons(view.body,'이 구성 적용')[0].click();expect(app.arsenal.artForHero()).toBe('aegis');expect(app.eco.s.heroes.knight.equip.armor).toBe(731001);expect(calls).toEqual(['knight']);
 const reloaded=new Economy();expect(reloaded.s.heroes.knight.equip.armor).toBe(731001);expect(reloaded.s.arsenal.heroes.knight.artId).toBe('aegis');
});
test('missing gear visibly disables apply and clicking cannot mutate economy',()=>{
 const {app,view}=fixture();buttons(view.body,'현재 구성 저장')[0].click();app.eco.s.inventory=[];app.eco.s.heroes.knight.equip.armor=null;view.render();buttons(view.body,'변경 비교')[0].click();
 const before=structuredClone(app.eco.s),apply=buttons(view.body,'이 구성 적용')[0];expect(apply.disabled).toBe(true);expect(view.body.textContent).toContain('현재 구성은 유지됩니다');apply.click();expect(app.eco.s).toEqual(before);
});
test('native cancel and close release only arsenal pause and restore original trigger focus',()=>{
 const {app,view,reasons}=fixture();view.close();app.battle.active=true;const trigger=doc.activeElement;trigger.focused=false;view.open();expect(view.dialog.open).toBe(true);expect(reasons.has('arsenal')).toBe(true);
 view.dialog.emit('cancel');expect(view.dialog.open).toBe(false);expect([...reasons]).toEqual(['other-modal']);expect(trigger.focused).toBe(true);
 view.open();view.dialog.close();expect([...reasons]).toEqual(['other-modal']);
});
test('untrusted preset name stays literal text and never creates HTML elements',()=>{
 const {view,app}=fixture();view.body.querySelector('input').value='<img src=x>';buttons(view.body,'현재 구성 저장')[0].click();buttons(view.body,'변경 비교')[0].click();
 expect(app.arsenal.s.heroes.knight.presets[0].name).toBe('<img src=x>');expect(view.body.textContent).toContain('<img src=x> 변경 비교');expect(view.body.all().filter((n:any)=>n.tagName==='img'&&n.src==='x')).toHaveLength(0);
});
test('battle disables configuration actions and stale handler still cannot mutate service state',()=>{
 const {view,app}=fixture();const stale=art(view,'aegis');app.battle.active=true;view.render();const before=structuredClone(app.eco.s);expect(art(view,'aegis').disabled).toBe(true);expect(buttons(view.body,'현재 구성 저장')[0].disabled).toBe(true);
 art(view,'aegis').click();stale.onclick();expect(app.eco.s).toEqual(before);expect(view.notice.textContent.length).toBeGreaterThan(0);
});
test('HUD avoids text rewrites for unchanged snapshots and hides disabled arena contract',()=>{
 const {view,app}=fixture();let state:any={enabled:true,artName:'파열',state:'ready',ready:true};app.battle.getApexSnapshot=()=>state;view.update();const writes=view.hud.writes;view.update();expect(view.hud.writes).toBe(writes);expect(view.hud.hidden).toBe(false);
 state={...state,state:'proc',shield:25};view.update();expect(view.hud.writes).toBe(writes+1);expect(view.hud.textContent).toContain('보호막 25');
 state={enabled:false};view.update();expect(view.hud.hidden).toBe(true);expect(view.hud.writes).toBe(writes+1);
});
