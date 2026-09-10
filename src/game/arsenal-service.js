import { normalizeArsenal, normalizeMix } from './arsenal-core.js';
import { HEROES, heroStats } from '../data/heroes.js';
import { SLOTS, SLOT_NAME, ITEM_BY_ID } from '../data/items.js';
import { COMBAT_ARTS } from '../data/combat-arts.js';
import { JOBS, resolveJobHero } from '../data/jobs.js';
import { masteryEffects, normalizeMasterworks } from './masterworks-core.js';
import { applyBuildStats } from './masterworks-combat.js';

/** Real inventory references, never equipment copies or currency grants. */
export class ArsenalService {
  constructor(app){this.app=app;this.ensure();}
  ensure(){if(this.state!==this.app.eco.s){this.state=this.app.eco.s;this.state.arsenal=normalizeArsenal(this.state.arsenal);}return this.state.arsenal;}
  get s(){return this.ensure();}
  artForHero(id=this.app.eco.s.selected){return this.s.heroes[id]?.artId||'rupture';}
  get blocked(){return !!(this.app.stageStarting||this.app.battle?.active||this.app.expeditionUI?.result?.saveError);}
  transact(fn,settings=false){
    if(this.app.stageStarting||(!settings&&this.blocked))return {ok:false,error:'전투와 전리품 저장을 마친 뒤 정비할 수 있습니다.'};
    return this.app.expedition.transact(()=>fn(this.s));
  }
  setArt(id,heroId=this.app.eco.s.selected){
    if(!COMBAT_ARTS.some(a=>a.id===id)||!this.app.eco.hero(heroId))return {ok:false,error:'사용 가능한 영웅과 기예를 선택해 주세요.'};
    return this.transact(s=>{s.heroes[heroId].artId=id;return {ok:true};});
  }
  setMix(mix){return this.transact(s=>{s.mix=normalizeMix({...s.mix,...mix});return {ok:true,mix:{...s.mix}};},true);}
  current(heroId=this.app.eco.s.selected){
    const eco=this.app.eco,h=eco.hero(heroId);if(!h)return null;
    const m=this.app.masterworks?.s||normalizeMasterworks(eco.s.masterworks);
    const job=JOBS.find(j=>j.id===eco.s.expedition.selectedJob&&j.baseHero===heroId);
    return {artId:this.artForHero(heroId),jobId:job?.id||null,pathId:m.path,challengeIds:[...m.challengeIds],
      equipment:Object.fromEntries(SLOTS.map(slot=>{const i=eco.s.inventory.find(x=>x.uid===h.equip[slot]);return [slot,i?{uid:i.uid,id:i.id}:null];}))};
  }
  savePreset(index,name,heroId=this.app.eco.s.selected){
    if(!Number.isInteger(index)||index<0||index>2||!this.app.eco.hero(heroId))return {ok:false,error:'사용 가능한 영웅과 구성 슬롯을 선택해 주세요.'};
    return this.transact(s=>{s.heroes[heroId].presets[index]={...this.current(heroId),name:typeof name==='string'?name.trim().slice(0,20)||`구성 ${index+1}`:`구성 ${index+1}`};return {ok:true};});
  }
  stats(config,heroId){
    const eco=this.app.eco,equipment=Object.fromEntries(SLOTS.map(slot=>[slot,config.equipment[slot]?.uid||null]));
    const bonus=eco.heroEquipBonus(heroId,equipment),m=this.app.masterworks?.s||normalizeMasterworks(eco.s.masterworks);
    return {stats:applyBuildStats(heroStats(resolveJobHero(HEROES[heroId],config.jobId),eco.hero(heroId),bonus),masteryEffects({...m,path:config.pathId})),sets:bonus.active};
  }
  preview(index,heroId=this.app.eco.s.selected){
    const eco=this.app.eco,p=this.s.heroes[heroId]?.presets[index];if(!eco.hero(heroId)||!p)return null;
    const missing=[],transfers=[];
    for(const slot of SLOTS){
      const entry=p.equipment[slot];if(!entry)continue;
      const inst=eco.s.inventory.find(i=>i.uid===entry.uid&&i.id===entry.id);
      if(!inst||ITEM_BY_ID[inst.id]?.slot!==slot)missing.push(`${SLOT_NAME[slot]} · ${ITEM_BY_ID[entry.id]?.name||'장비'}`);
      else {const owner=Object.keys(eco.s.heroes).find(id=>id!==heroId&&Object.values(eco.s.heroes[id].equip).includes(entry.uid));if(owner)transfers.push({uid:entry.uid,item:ITEM_BY_ID[entry.id].name,owner});}
    }
    if(p.jobId&&!eco.s.expedition.unlockedJobs.includes(p.jobId))missing.push('아직 배우지 않은 전직');
    const before=this.stats(this.current(heroId),heroId),after=missing.length?null:this.stats(p,heroId);
    return {preset:structuredClone(p),missing,transfers,valid:!missing.length,before,after};
  }
  applyPreset(index,heroId=this.app.eco.s.selected){
    const preview=this.preview(index,heroId);if(!preview)return {ok:false,error:'먼저 현재 구성을 저장해 주세요.'};
    if(!preview.valid)return {ok:false,error:`보관함에 없는 구성: ${preview.missing.join(', ')}. 현재 장비로 다시 저장해 주세요.`};
    return this.transact(s=>{
      const eco=this.app.eco,p=preview.preset,ids=new Set(SLOTS.map(slot=>p.equipment[slot]?.uid).filter(Boolean));
      for(const [id,h] of Object.entries(eco.s.heroes))if(id!==heroId)for(const slot of SLOTS)if(ids.has(h.equip[slot]))h.equip[slot]=null;
      eco.s.heroes[heroId].equip=Object.fromEntries(SLOTS.map(slot=>[slot,p.equipment[slot]?.uid||null]));
      eco.s.selected=heroId;eco.s.expedition.selectedJob=p.jobId;s.heroes[heroId].artId=p.artId;
      const m=this.app.masterworks?.s||(eco.s.masterworks=normalizeMasterworks(eco.s.masterworks));m.path=p.pathId;m.challengeIds=[...p.challengeIds];m.activePreset=-1;
      return {ok:true,heroId,transfers:preview.transfers};
    });
  }
}
