import { normalizeMasterworks, unlockMastery, choosePath, toggleChallenge, claimBounty } from './masterworks-core.js';
import { choosePersonalGoal } from './run-personal-goals.js';

/** Uses the same durable transaction and recovery backup as the existing workshop. */
export class MasterworksService {
  constructor(app) { this.app = app; this.ensure(); }
  ensure() {
    if (this.state !== this.app.eco.s) {
      this.state = this.app.eco.s;
      this.state.masterworks = normalizeMasterworks(this.state.masterworks);
    }
    return this.state.masterworks;
  }
  get s() { return this.ensure(); }
  transact(fn, { duringBattle = false } = {}) {
    if (!duringBattle && (this.app.battle?.active || this.app.stageStarting)) return { ok:false, error:'정비는 전투를 마친 뒤 가능합니다.' };
    return this.app.expedition.transact(() => fn(this.s));
  }
  unlock(id) { return this.transact(s => unlockMastery(s, id)); }
  path(id) { return this.transact(s => choosePath(s, id)); }
  challenge(id) { return this.transact(s => toggleChallenge(s, id)); }
  claim(id) { return this.transact(s => claimBounty(s, id)); }
  goal(runId, metric) {
    const app = this.app, result = app.ui?.resultData;
    if (app.expeditionUI?.result?.saveError || app.battle?.rpgDirty || result?.saveError
      || result?.reward?.saveError || result?.reward?.ok === false || app.expedition?.s?.pending || app.expeditionRefundPending) {
      return { ok:false, error:'결과 저장을 마친 뒤 개인 목표를 선택해 주세요.' };
    }
    return this.transact(s => choosePersonalGoal(s, runId, metric));
  }
  savePreset(index) {
    return this.transact(s => {
      if (!Number.isInteger(index) || index < 0 || index > 2) return {ok:false,error:'알 수 없는 준비 슬롯입니다.'};
      s.presets[index] = {name:`준비 ${index + 1}`,path:s.path,challengeIds:[...s.challengeIds]};
      s.activePreset = index; return {ok:true};
    });
  }
  usePreset(index) {
    return this.transact(s => {
      if (!Number.isInteger(index) || index < 0 || index > 2) return {ok:false,error:'알 수 없는 준비 슬롯입니다.'};
      const p = s.presets[index]; s.path = p.path; s.challengeIds = [...p.challengeIds]; s.activePreset = index;
      return {ok:true};
    });
  }
}
