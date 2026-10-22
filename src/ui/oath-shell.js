const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text)n.textContent=text;return n;};
/** 메뉴 창 묶음. order 는 묶음 안의 표시 순서이고, 목록에 없는 버튼은 시스템 묶음 끝에 붙는다.
 * 기본 로비의 최상위 목적지는 던전 · 영웅·장비 · 메뉴 3개뿐이며 나머지 입구는 모두 이 안의 보조 입구다. */
export const MENU_GROUPS=[
 {id:'adventure',title:'모험',order:['tab:stage','menu-tower','menu-fields']},
 {id:'character',title:'성장 · 정비',order:['mw-open','arsenal-open','rpg-open','journey-lobby','menu-forge','citadel-command-supply']},
 {id:'reward',title:'보상 · 임무',order:['btn-daily','btn-mail','btn-quest','menu-town-quests','tab:pass']},
 {id:'shop',title:'상점 · 소환',order:['tab:gacha','tab:shop','store-options']},
 {id:'system',title:'시스템',order:['menu-companion','btn-guide','btn-settings','app-mode-open']},
];
const MENU_ART={'rpg-open':'nav-journal','mw-open':'nav-mastery','journey-lobby':'nav-journey','app-mode-open':'settings','arsenal-open':'nav-jobs','tab:stage':'nav-quests','menu-fields':'nav-journey','menu-tower':'nav-arena','menu-forge':'nav-forge','citadel-command-supply':'treasure-chest','menu-town-quests':'nav-quests','menu-companion':'nav-heroes'};
// 타인 의존 콘텐츠(파티)는 기본 솔로 로비에서 숨긴다. 기능·저장은 그대로 두고 입구만 감춘다.
const HIDDEN_ENTRIES=new Set(['party-open']);
const CLASS_KEYS=['rpg-open','mw-open','journey-lobby','arsenal-open'];
export const menuKey=b=>b.dataset.menuKey?b.dataset.menuKey:b.dataset.tab?'tab:'+b.dataset.tab:b.id&&MENU_GROUPS.some(g=>g.order.includes(b.id))?b.id:CLASS_KEYS.find(c=>b.classList.contains(c))||b.id||'';
export const LOBBY_DESTINATIONS=Object.freeze(['home','heroes','menu']);
/** Reparent existing controls, preserving their listeners, IDs, policies and contents. */
export class OathShell {
 constructor(app){
  this.app=app;this.disposed=false;this.restoreFocus=true;
  document.documentElement.classList.add('oath-visual');
  const nav=document.querySelector('#meta .bottomnav'),home=document.querySelector('#tab-home');
  this.menu=el('dialog','oath-menu');this.menu.id='oath-menu';this.menu.setAttribute('aria-labelledby','oath-menu-title');
  const head=el('header','oath-menu-heading'),title=el('h2','','메뉴');title.id='oath-menu-title';
  const close=el('button','oath-menu-close','✕');close.type='button';close.setAttribute('aria-label','닫기');close.addEventListener('click',()=>this.close());
  // 설정은 메뉴 맨 아래까지 내려가야 닿았다. 머리말(스크롤 밖)에 톱니 버튼을 고정해 어디서든 한 번에 연다. 기존 설정 버튼의 리스너를 그대로 쓴다.
  const gear=el('button','oath-menu-gear');gear.type='button';gear.setAttribute('aria-label','설정');gear.title='설정';
  {const art=el('i','ic ic-gear');art.setAttribute('aria-hidden','true');gear.append(art);}
  gear.addEventListener('click',()=>document.getElementById('btn-settings')?.click());
  head.append(title,gear,close);
  this.grid=el('div','oath-menu-grid');this.menu.append(head,this.grid);document.body.append(this.menu);
  this.groups=new Map(MENU_GROUPS.map(g=>{const section=el('section','oath-menu-group'),heading=el('h3','',g.title),list=el('div','oath-menu-list');section.dataset.group=g.id;section.hidden=true;section.append(heading,list);this.grid.append(section);return [g.id,{def:g,section,list}];}));
  const trigger=el('button','oath-nav-menu','메뉴');trigger.type='button';trigger.setAttribute('aria-controls',this.menu.id);trigger.setAttribute('aria-expanded','false');
  trigger.addEventListener('click',()=>this.open());this.trigger=trigger;
  const original=[...nav.querySelectorAll('button')];
  const selected=['home','heroes'].map(id=>original.find(b=>b.dataset.tab===id));
  for(const button of original)if(!selected.includes(button))this.place(button);
  for(const button of selected)if(button)nav.append(button);
  const relabel=(button,label)=>{if(!button)return;for(const node of button.childNodes)if(node.nodeType===3&&node.textContent.trim())node.textContent=label;};
  const [homeButton,heroButton]=selected;
  relabel(homeButton,'던전');relabel(heroButton,'영웅·장비');
  if(homeButton)homeButton.addEventListener('click',()=>app.setHubWalkMode(false));
  // 모험 탭 입구는 메뉴 안에서 캠페인 · 던전 목록을 여는 보조 입구가 된다.
  relabel(original.find(b=>b.dataset.tab==='stage'),'캠페인');
  const offers=home.querySelector('.lobby-right');if(offers?.children.length){const detail=el('details','oath-menu-offers'),summary=el('summary','','추가 상품 안내'),items=el('div');items.append(...offers.children);detail.append(summary,items);this.menu.append(detail);}
  nav.append(trigger);nav.dataset.destinations=String(LOBBY_DESTINATIONS.length);
  // 기존 그림을 장식으로 연결하고 메뉴 이름과 이벤트 소유권을 유지한다.
  {const art=el('i','ic ic-menu');art.setAttribute('aria-hidden','true');trigger.prepend(art);}
  for(const button of document.querySelectorAll('#tab-home .lobby-left > button')){
   if(button.classList.contains('companion-launcher'))continue; // React/bootstrap retains its original parent.
   this.place(button);
  }
  // 착지 화면에서 뺀 캠페인 외 보조 입구(필드 · 보급 · 공방 · 의뢰 · 동행)를 메뉴에 둔다.
  for(const button of app.commandUI?.menuEntries||[])this.place(button);
  // 모험 탭 안의 결투장 입구도 기본 솔로 로비에서 숨긴다. 기존 결과·기록·저장은 유지된다.
  const arena=document.querySelector('.adventure-nav [data-section="arena"]');if(arena){arena.hidden=true;arena.setAttribute('aria-hidden','true');}
  const destination=el('section','oath-destination');destination.setAttribute('aria-label','다음 모험');
  destination.append(el('small','oath-kicker','다음 모험'));
  for(const node of [home.querySelector('.journey-strip'),home.querySelector('.stage-pill'),home.querySelector('#btn-battle')])if(node)destination.append(node);
  home.append(destination);
  const actions=home.querySelector('.lobby-left');this.observer=new MutationObserver(()=>{for(const button of [...actions.children])if(button.tagName==='BUTTON'&&!button.classList.contains('companion-launcher'))this.place(button);});this.observer.observe(actions,{childList:true});
  this.menu.addEventListener('cancel',e=>{e.preventDefault();this.close();});
  this.menu.addEventListener('click',e=>{const button=e.target.closest('button');if(button&&button!==close){this.restoreFocus=false;this.launchedFromMenu=true;this.menu.close();this.trigger.setAttribute('aria-expanded','false');queueMicrotask(()=>{if(!document.querySelector('dialog[open]')&&!document.querySelector('#modal.show')){this.launchedFromMenu=false;const heading=document.querySelector('#meta .tab.show h2');if(heading){heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});}}});}},true);
  this.menu.addEventListener('close',()=>{this.trigger.setAttribute('aria-expanded','false');if(this.restoreFocus&&this.trigger.isConnected)this.trigger.focus({preventScroll:true});this.restoreFocus=true;});
  this.returnMenuFocus=event=>{if(event?.target===this.menu||!this.launchedFromMenu)return;queueMicrotask(()=>{if(document.querySelector('dialog[open]')||document.querySelector('#modal.show'))return;this.launchedFromMenu=false;if(this.app.mode==='lobby')this.trigger.focus({preventScroll:true});});};
  document.addEventListener('close',this.returnMenuFocus,true);
  this.modalObserver=new MutationObserver(()=>{if(!document.querySelector('#modal.show'))this.returnMenuFocus();});
  this.modalObserver.observe(document.querySelector('#modal'),{attributes:true,attributeFilter:['class']});
  const camera=document.querySelector('#battle-camera-controls');
  if(camera){const detail=el('details','oath-camera-details'),summary=el('summary','','시점');detail.append(summary,camera);document.querySelector('#hud').append(detail);}
  const run=document.querySelector('#hud .mw-run-strip');
  if(run){const detail=el('details','oath-run-details'),summary=el('summary','','성장 정보');run.before(detail);detail.append(summary,run);}
  const pause=document.querySelector('#btn-pause');pause.textContent='Ⅱ';pause.setAttribute('aria-label','일시정지');
 }
 open(){if(this.disposed||this.app.mode!=='lobby'||this.app.stageStarting||this.menu.open)return;this.app.setHubWalkMode(false);this.app.input.clear();this.restoreFocus=true;this.menu.showModal();this.trigger.setAttribute('aria-expanded','true');}
 /** 버튼을 알맞은 묶음에 넣는다. DOM · id · 리스너는 그대로 옮기기만 한다. */
 place(button){
  const key=menuKey(button);
  button.dataset.menuKey=key;
  if(HIDDEN_ENTRIES.has(key)){button.hidden=true;button.setAttribute('aria-hidden','true');this.hiddenHost().append(button);return;}
  const found=this.groups.get(MENU_GROUPS.find(g=>g.order.includes(key))?.id)||this.groups.get('system'),{def,section,list}=found;
  // 아이콘이 없는 버튼에는 기존 그림을 장식으로만 붙인다(이름·리스너는 그대로).
  if(MENU_ART[key]&&!button.querySelector('.ic,img')){const art=document.createElement('img');art.className='oath-menu-art';art.alt='';art.setAttribute('aria-hidden','true');art.src='/img/ui-crafted/'+MENU_ART[key]+'.webp';button.prepend(art);}
  const rank=b=>{const i=def.order.indexOf(b.dataset.menuKey);return i<0?99:i;};
  const before=[...list.children].find(b=>rank(b)>rank(button));before?list.insertBefore(button,before):list.append(button);section.hidden=false;
 }
 /** 숨긴 입구의 보관 위치. 노드·리스너·id 를 지우지 않고 화면 밖에 둔다. */
 hiddenHost(){if(!this.archive){this.archive=el('div','oath-hidden-entries');this.archive.hidden=true;this.menu.append(this.archive);}return this.archive;}
 close(){if(!this.menu.open)return;this.restoreFocus=true;this.menu.close();}
 dispose(){if(this.disposed)return;this.disposed=true;this.observer.disconnect();this.modalObserver.disconnect();document.removeEventListener('close',this.returnMenuFocus,true);this.close();}
}
