import { COMBAT_ARTS } from '../data/combat-arts.js';
import { HEROES } from '../data/heroes.js';
import { ITEM_BY_ID, ITEM_ICON, SLOTS, SLOT_NAME } from '../data/items.js';
import { PATHS, CHALLENGES } from '../data/masterworks.js';
import { JOBS } from '../data/jobs.js';
import { audio } from '../engine/audio.js';
import './arsenal.css';

const el=(tag,cls='',text='')=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
const btn=(label,fn,cls='arsenal-action')=>{const b=el('button',cls,label);b.type='button';b.onclick=fn;return b;};
const fmt=n=>Math.round(n).toLocaleString('ko-KR');
export class ArsenalView {
  constructor(app){
    this.app=app;this.previewIndex=null;
    this.dialog=el('dialog','arsenal-dialog');this.dialog.id='arsenal';this.dialog.setAttribute('aria-labelledby','arsenal-title');
    const header=el('header','arsenal-header'),title=el('div');title.append(el('small','','준비가 전투를 바꾼다'));const h=el('h2','','전투 설계');h.id='arsenal-title';title.append(h);
    header.append(title,btn('닫기',()=>this.close()));this.notice=el('p','arsenal-notice');this.notice.setAttribute('role','status');this.body=el('div','arsenal-body');
    this.dialog.append(header,this.notice,this.body);document.body.append(this.dialog);
    this.dialog.addEventListener('cancel',e=>{e.preventDefault();this.close();});this.dialog.addEventListener('close',()=>{this.app.battle?.setPaused('arsenal',false);this.trigger?.isConnected&&this.trigger.focus({preventScroll:true});});
    document.querySelector('.lobby-left')?.append(btn('전투 설계',()=>this.open(),'sq-btn arsenal-open'));
    this.hud=el('div','arsenal-hud');this.hud.setAttribute('aria-label','전투 기예');this.hud.hidden=true;document.querySelector('#hud .hud-bars')?.append(this.hud);
    app.eco.onChange(()=>{if(this.dialog.open)this.render();});
  }
  open(){if(this.app.stageStarting||this.app.mode==='boot')return;this.trigger=document.activeElement;this.notice.textContent='';this.previewIndex=null;this.render();if(this.app.battle?.active)this.app.battle.setPaused('arsenal',true);this.dialog.showModal();}
  close(){this.dialog.close();}
  act(fn,message){const r=fn();this.notice.textContent=r?.ok?message:r?.error||'다시 확인해 주세요.';if(r?.ok){audio.play('ui_glass',{vol:.4});this.render();}else audio.play('ui_error',{vol:.3});return r;}
  render(){
    const app=this.app,svc=app.arsenal,id=app.eco.s.selected,current=svc.current(id),scroll=this.body.scrollTop;this.body.replaceChildren();
    const hero=el('div','arsenal-hero'),portrait=el('img');portrait.src=HEROES[id].portrait;portrait.alt=HEROES[id].name;const text=el('div');text.append(el('h3','',HEROES[id].name),el('p','',`${JOBS.find(j=>j.id===current.jobId)?.name||'기본 직업'} · ${PATHS.find(p=>p.id===current.pathId)?.name||'균형'}`));hero.append(portrait,text);this.body.append(hero);
    this.body.append(el('h3','','균형 파괴, 그 다음 한 수'),el('p','arsenal-copy','보스·정예의 강공격이 끝난 빈틈에 마무리를 맞히면 균형 피해가 15 추가됩니다. 균형이 무너진 적에게 다음 마무리를 맞혀 선택한 기예를 발동하세요. 한 번의 붕괴마다 1회. 모든 기예는 무료로 전환합니다.'));
    if(svc.blocked)this.body.append(el('p','arsenal-warning','이번 전투의 기예는 출격 시 고정됩니다. 정비는 전투와 저장을 마친 뒤 가능합니다.'));
    const grid=el('div','arsenal-arts');
    for(const [i,art] of COMBAT_ARTS.entries()){
      const card=btn('',()=>this.act(()=>svc.setArt(art.id),`${art.name} 기예를 준비했습니다.`),'arsenal-art');card.dataset.art=art.id;card.setAttribute('aria-pressed',String(current.artId===art.id));card.disabled=svc.blocked;
      card.append(el('span','arsenal-rune',['✦','◇','↻'][i]),el('strong','',art.name),el('span','',art.description),el('small','',current.artId===art.id?'선택 중':'이 기예 준비'));grid.append(card);
    }
    this.body.append(grid,el('h3','','영웅별 장비 구성'),el('p','arsenal-copy','장비 4부위·전직·전투 방식·서약·기예를 함께 저장합니다. 강화 수치는 현재 장비를 따릅니다. 불러오기 전에 변경 능력치와 다른 영웅에게서 옮겨올 장비를 확인할 수 있습니다.'));
    const equipped=el('div','arsenal-equipped');for(const slot of SLOTS){const r=current.equipment[slot],item=r&&ITEM_BY_ID[r.id],cell=el('div');if(item){const img=el('img');img.src=ITEM_ICON(item);img.alt='';cell.append(img);}cell.append(el('small','',SLOT_NAME[slot]),el('span','',item?.name||'미착용'));equipped.append(cell);}this.body.append(equipped);
    const presets=el('div','arsenal-presets');svc.s.heroes[id].presets.forEach((p,i)=>{
      const card=el('article'),label=el('label','','구성 이름'),input=el('input');input.type='text';input.maxLength=20;input.value=p?.name||`구성 ${i+1}`;input.setAttribute('aria-label',`구성 ${i+1} 이름`);input.disabled=svc.blocked;label.append(input);card.append(label);
      card.append(el('p','',p?`${COMBAT_ARTS.find(a=>a.id===p.artId)?.name} · ${PATHS.find(x=>x.id===p.pathId)?.name} · 서약 ${p.challengeIds.length}`:'현재 영웅의 준비를 저장하세요.'));
      const save=btn(p?'현재 구성으로 덮어쓰기':'현재 구성 저장',()=>{this.previewIndex=null;this.act(()=>svc.savePreset(i,input.value),`${input.value||`구성 ${i+1}`} 저장 완료`);});save.disabled=svc.blocked;card.append(save);
      const view=btn('변경 비교',()=>{this.previewIndex=i;this.render();this.body.querySelector('.arsenal-preview')?.scrollIntoView({block:'nearest'});});view.disabled=!p||svc.blocked;card.append(view);presets.append(card);
    });this.body.append(presets);
    if(this.previewIndex!==null)this.renderPreview(this.previewIndex,id);
    const footer=el('div','arsenal-links');footer.append(btn('장비 · 강화',()=>this.navigate('heroes')),btn('전직',()=>this.navigate('jobs')),btn('전투 방식 · 서약',()=>this.navigate('mastery')));this.body.append(footer,el('p','arsenal-copy','AI 결투장은 공통 규칙을 사용하므로 기예·후딜 공략은 적용되지 않습니다.'));this.body.scrollTop=scroll;
  }
  renderPreview(index,id){
    const svc=this.app.arsenal,p=svc.preview(index,id);if(!p)return;const box=el('section','arsenal-preview');box.append(el('h3','',`${p.preset.name} 변경 비교`));
    if(!p.valid)box.append(el('p','arsenal-warning',`보관함에서 찾을 수 없습니다: ${p.missing.join(', ')}. 현재 구성은 유지됩니다.`));
    else {
      const rows=el('div','arsenal-stats');for(const [key,label] of [['hp','체력'],['atk','공격력'],['def','방어력'],['power','전투력']]){const before=p.before.stats[key],after=p.after.stats[key];rows.append(el('span','',`${label} ${fmt(before)} → ${fmt(after)} (${after>=before?'+':''}${fmt(after-before)})`));}box.append(rows);
      const sets=p.after.sets.map(s=>`${s.set.name} ${s.tier}세트`).join(' · ');box.append(el('p','',`적용 후 세트: ${sets||'없음'}`));
      box.append(el('p','',`전직: ${JOBS.find(j=>j.id===p.preset.jobId)?.name||'기본 직업'} · 기예: ${COMBAT_ARTS.find(a=>a.id===p.preset.artId)?.name} · 서약: ${p.preset.challengeIds.map(x=>CHALLENGES.find(c=>c.id===x)?.name).join(', ')||'없음'}`));
      for(const transfer of p.transfers)box.append(el('p','arsenal-warning',`${HEROES[transfer.owner].name}의 ${transfer.item}을 옮겨옵니다.`));
      box.append(el('p','arsenal-copy','원정 출격 기준 예상치입니다. 출격 중 각인·물약은 제외합니다.'));
    }
    const apply=btn('이 구성 적용',()=>{const r=this.act(()=>svc.applyPreset(index),`${p.preset.name} 적용 완료`);if(r.ok){this.previewIndex=null;this.app.showcaseHero(id,true);this.render();}},'arsenal-primary');apply.disabled=!p.valid||svc.blocked;box.append(apply);this.body.append(box);
  }
  navigate(where){if(this.app.arsenal.blocked){this.notice.textContent='전투와 저장을 마친 뒤 이동할 수 있습니다.';return;}this.close();if(this.app.expeditionUI.result){this.app.expeditionUI.result=null;this.app.toLobby();}if(where==='heroes')this.app.meta.openTab('heroes');else if(where==='mastery')this.app.battle.chronicle.open('build');else this.app.expeditionUI.open(where);}
  update(){
    const state=this.app.battle?.getApexSnapshot?.();this.hud.hidden=!state?.enabled;if(!state?.enabled)return;
    const text=state.recoveryTarget?`${state.recoveryTarget.name} · 빈틈! 마무리로 공략`:state.state==='proc'?`${state.artName} 발동${state.shield>0?` · 보호막 ${fmt(state.shield)}`:''}`:state.ready?`${state.artName} 준비 · 무너진 적에게 마무리`:`기예 ${state.artName} · 균형 파괴 후 마무리`;
    if(this.hud.textContent!==text)this.hud.textContent=text;this.hud.dataset.state=state.recoveryTarget?'ready':state.state;
  }
}
