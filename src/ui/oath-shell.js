const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text)n.textContent=text;return n;};
/** Reparent existing controls, preserving their listeners, IDs, policies and contents. */
export class OathShell {
 constructor(app){
  this.app=app;this.disposed=false;this.restoreFocus=true;
  document.documentElement.classList.add('oath-visual');
  const nav=document.querySelector('#meta .bottomnav'),home=document.querySelector('#tab-home');
  this.menu=el('dialog','oath-menu');this.menu.id='oath-menu';this.menu.setAttribute('aria-labelledby','oath-menu-title');
  const head=el('header','oath-menu-heading'),title=el('h2','','메뉴');title.id='oath-menu-title';
  const close=el('button','oath-menu-close','닫기');close.type='button';close.addEventListener('click',()=>this.close());head.append(title,close);
  this.grid=el('div','oath-menu-grid');this.menu.append(head,this.grid);document.body.append(this.menu);
  const trigger=el('button','oath-nav-menu','메뉴');trigger.type='button';trigger.setAttribute('aria-controls',this.menu.id);trigger.setAttribute('aria-expanded','false');
  trigger.addEventListener('click',()=>this.open());this.trigger=trigger;
  const original=[...nav.querySelectorAll('button')];
  const selected=['home','heroes','stage'].map(id=>original.find(b=>b.dataset.tab===id));
  for(const button of original)if(!selected.includes(button))this.grid.append(button);
  for(const button of selected)if(button)nav.append(button);
  const homeButton=selected[0];if(homeButton)for(const node of homeButton.childNodes)if(node.nodeType===3&&node.textContent.trim())node.textContent='거점';
  const offers=home.querySelector('.lobby-right');if(offers?.children.length){const detail=el('details','oath-menu-offers'),summary=el('summary','','추가 상품 안내'),items=el('div');items.append(...offers.children);detail.append(summary,items);this.menu.append(detail);}
  const growth=el('button','oath-nav-growth','성장');growth.type='button';growth.onclick=()=>document.querySelector('.mw-open')?.click();nav.append(growth,trigger);
  for(const button of document.querySelectorAll('#tab-home .lobby-left > button')){
   if(button.classList.contains('companion-launcher'))continue; // React/bootstrap retains its original parent.
   if(button.classList.contains('arsenal-open')){button.classList.add('oath-build-entry');home.append(button);}else this.grid.append(button);
  }
  const destination=el('section','oath-destination');destination.setAttribute('aria-label','다음 모험');
  destination.append(el('small','oath-kicker','다음 모험'));
  for(const node of [home.querySelector('.journey-strip'),home.querySelector('.stage-pill'),home.querySelector('#btn-battle')])if(node)destination.append(node);
  home.append(destination);
  const actions=home.querySelector('.lobby-left');this.observer=new MutationObserver(()=>{for(const button of [...actions.children])if(button.tagName==='BUTTON'&&!button.classList.contains('companion-launcher'))this.grid.append(button);});this.observer.observe(actions,{childList:true});
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
 open(){if(this.disposed||this.app.mode!=='lobby'||this.app.stageStarting||this.menu.open)return;this.app.input.clear();this.restoreFocus=true;this.menu.showModal();this.trigger.setAttribute('aria-expanded','true');}
 close(){if(!this.menu.open)return;this.restoreFocus=true;this.menu.close();}
 dispose(){if(this.disposed)return;this.disposed=true;this.observer.disconnect();this.modalObserver.disconnect();document.removeEventListener('close',this.returnMenuFocus,true);this.close();}
}
