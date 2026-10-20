import * as THREE from 'three';
import './target-tag.css';

// 대표님 2026-10-18: 화면 위쪽 가운데 줄에 뜨던 대상 적 이름·HP 와 균형 게이지가 앞에서 몰려오는 적을 가렸다.
// 두 줄을 대상 적 머리 위에 붙는 작은 표식 하나로 옮긴다. 보스는 이미 보스 바가 있으므로 균형만 보스 바 안의 가는 선으로 넣는다.
const _head = new THREE.Vector3();
const DIM_AFTER = 4;
const RANGE = 14;
const number = value => Math.max(0, Math.round(value)).toLocaleString('ko-KR');

/** 순수 판단: 표식에 보여 줄 대상과 상태. 렌더·DOM 과 분리해 테스트한다. */
export function targetTagState(battle, { mode = 'battle' } = {}) {
  const player = battle?.player, candidate = player?.lockTarget || battle?.lastTarget;
  if (mode !== 'battle' || !battle?.active || !candidate?.alive || candidate.spawning || !player || player.distTo(candidate) > RANGE) return null;
  const postureOn = !!battle.run?.enabled && Number.isFinite(candidate.postureMax || 80);
  const postureMax = candidate.postureMax || 80;
  return {
    enemy: candidate, boss: !!candidate.isBoss,
    name: candidate.def?.name || '', hp: candidate.hp, maxHp: candidate.maxHp,
    hpRatio: Math.max(0, Math.min(1, candidate.hp / Math.max(1, candidate.maxHp))),
    posture: postureOn ? { ratio: Math.max(0, Math.min(1, (candidate.posture || 0) / postureMax)), broken: candidate.breakT > 0 } : null,
  };
}

export class TargetTag {
  constructor(hud = document.getElementById('hud')) {
    this.root = document.createElement('div'); this.root.className = 'target-tag'; this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');
    this.name = document.createElement('span'); this.name.className = 'target-tag-name';
    this.hp = document.createElement('i'); this.hp.className = 'target-tag-hp';
    this.posture = document.createElement('i'); this.posture.className = 'target-tag-posture';
    const hpTrack = document.createElement('b'); hpTrack.className = 'target-tag-track'; hpTrack.append(this.hp);
    this.postureTrack = document.createElement('b'); this.postureTrack.className = 'target-tag-track target-tag-posture-track'; this.postureTrack.append(this.posture);
    this.root.append(this.name, hpTrack, this.postureTrack);
    hud?.append(this.root);
    this.bossPosture = document.createElement('i'); this.bossPosture.className = 'bossbar-posture'; this.bossPosture.hidden = true;
    document.querySelector('#bossbar .bb-body')?.append(this.bossPosture);
    this.lastEnemy = null; this.lastHp = NaN; this.idle = 0; this.label = '';
  }
  update(battle, renderer, dt = 0, mode = 'battle') {
    const state = targetTagState(battle, { mode });
    const bossBarOpen = !document.getElementById('bossbar')?.classList.contains('hidden');
    if (!state) { this.root.hidden = true; this.bossPosture.hidden = true; this.lastEnemy = null; return; }
    if (state.enemy !== this.lastEnemy || state.hp !== this.lastHp) { this.idle = 0; this.lastEnemy = state.enemy; this.lastHp = state.hp; }
    else this.idle += Number.isFinite(dt) ? dt : 0;
    if (state.boss && bossBarOpen) {
      // 보스 이름·HP 는 보스 바가 정본이다. 균형만 같은 바 안에 가는 선으로 보탠다.
      this.root.hidden = true;
      this.bossPosture.hidden = !state.posture;
      if (state.posture) { this.bossPosture.style.transform = 'scaleX(' + state.posture.ratio.toFixed(3) + ')'; this.bossPosture.classList.toggle('is-broken', state.posture.broken); }
      return;
    }
    this.bossPosture.hidden = true;
    const enemy = state.enemy, cam = renderer?.camera, w = renderer?._width || innerWidth, h = renderer?._height || innerHeight;
    if (!cam) { this.root.hidden = true; return; }
    const lift = (enemy.isBoss ? 3.1 : enemy.def?.elite || enemy.elite ? 2.45 : 2.05) * (enemy.scale || 1);
    _head.set(enemy.pos.x, enemy.pos.y + lift, enemy.pos.z).project(cam);
    if (_head.z > 1 || _head.x < -1.1 || _head.x > 1.1 || _head.y < -1.1 || _head.y > 1.1) { this.root.hidden = true; return; }
    this.root.hidden = false;
    this.root.style.transform = 'translate3d(' + Math.round((_head.x + 1) * .5 * w) + 'px,' + Math.round((1 - _head.y) * .5 * h) + 'px,0) translate(-50%,-100%)';
    const label = state.name + ' · ' + number(state.hp);
    if (label !== this.label) { this.label = label; this.name.textContent = label; }
    this.hp.style.transform = 'scaleX(' + state.hpRatio.toFixed(3) + ')';
    this.postureTrack.hidden = !state.posture;
    if (state.posture) { this.posture.style.transform = 'scaleX(' + state.posture.ratio.toFixed(3) + ')'; this.postureTrack.classList.toggle('is-broken', state.posture.broken); }
    this.root.classList.toggle('is-idle', this.idle >= DIM_AFTER);
  }
  dispose() { this.root.remove(); this.bossPosture.remove(); }
}
