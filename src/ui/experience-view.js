import {COMBAT_ARTS} from '../data/combat-arts.js';
import {uiArt} from './illustrated.js';
import './experience-v2.css';
const node=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls;if(text)e.textContent=text;return e;};
export class ExperienceView {
 constructor(app){
  this.app=app;this.last='';this.artLast='';document.documentElement.classList.add('experience-v2');
  this.panel=node('section','experience-arts');this.panel.setAttribute('aria-label','이번 전투 기예');
  this.panel.append(node('div','experience-arts-title','이번 전투 기예'));
  const row=node('div','experience-art-row');this.buttons=[];
  for(const art of COMBAT_ARTS){
   const button=node('button','experience-art'),img=node('img','');img.src=uiArt(`art-${art.id}`);img.alt='';button.type='button';button.dataset.art=art.id;
   button.append(img,node('span','',art.name));button.setAttribute('aria-label',`${art.name} · ${art.description}`);
   button.onclick=()=>{if(app.mode!=='lobby'||app.stageStarting)return;const result=app.arsenal.setArt(art.id);if(result.ok)this.refreshArts();else app.ui.toast(result.error||'기예를 저장하지 못했습니다','red');};
   row.append(button);this.buttons.push(button);
  }
  this.panel.append(row,node('p','experience-art-hint','마무리 명중 → 3초 안에 기본 스킬'));
  document.querySelector('.oath-destination').insertBefore(this.panel,document.querySelector('#btn-battle'));
  this.status=node('div','experience-link');this.status.hidden=true;this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');const old=document.querySelector('#hud .arsenal-hud');if(old)old.after(this.status);else document.querySelector('#hud .hud-bars').append(this.status);
  this.refreshArts();app.eco.onChange(()=>this.refreshArts());
 }
 refreshArts(){const art=this.app.arsenal.artForHero();if(art===this.artLast)return;this.artLast=art;for(const b of this.buttons)b.setAttribute('aria-pressed',String(b.dataset.art===art));}
 update(){
  const b=this.app.battle,s=b?.getComboLinkSnapshot?.(),active=this.app.mode==='battle'&&s?.enabled,proc=active&&(b.apex?.procUntil>b.elapsed);
  const state=active?(s.ready?'ready':proc?'proc':'idle'):'hidden',text=state==='ready'?`${s.artName} 연계 준비 · 기본 스킬로 연결`:state==='proc'?`${s.artName} 기예 발동`:'';
  document.querySelector('#hud').dataset.linkVisible=String(state==='ready'||state==='proc');
  const key=state+text;if(this.last===key)return;this.last=key;this.status.hidden=state==='hidden'||state==='idle';this.status.dataset.state=state;this.status.textContent=text;
  document.querySelectorAll('#hud .skill-btn[data-skill]').forEach(e=>e.classList.toggle('experience-link-ready',state==='ready'&&+e.dataset.skill<3));
 }
}
