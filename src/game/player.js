import * as THREE from 'three';
import { weaponTrailGain } from '../engine/weapon-trail.js';
import { gatherEnemies, gatherWarriorWindup } from './crowd-gather.js';
import { Actor } from './actor.js';
import { audio } from '../engine/audio.js';
import { SKILLS } from './skills.js';
import { applyLook } from './look.js';
import { materialsOf, poseRangerBowString } from '../engine/assets.js';
import { HeroBeacon } from './hero-beacon.js';
import { GradeAura, resolveHeroGrade } from '../engine/grade-aura.js';
import { CONTROL_ULT_GAIN, ultimateLockDuration } from './control-rewards.js';
import { frontierEffectForStage } from '../data/seasonal-content.js';
import { normalizeSkillLoadout, skillIndexForCombatSlot, skillMpCost, MP_BASE, MP_REGEN_PER_SEC, DODGE_COOLDOWN_SEC, DODGE_INVULN_SEC } from './progression.js';
import { FEEL, attackBlend, dodgeCancelOpen, comboQueueOpen, skillCancelOpen, heroRunTempo } from './feel.js';
import { RangerAim, aimTargetValid, clearShot } from './ranger-aim.js';
import { enemyImpactIn } from './enemies.js';
import { SkillAimView } from './skill-aim/aim-view.js';
import { kitOf } from '../data/heroes.js';
import { createCombatPose } from '../engine/combat-pose.js';
import { skillAimShape, playerSkillAimShape } from './skill-aim/shapes.js';

const _v = new THREE.Vector3();
const _glintAt = new THREE.Vector3();
// 노바 마무리 색: 영웅색을 진하게(옅은 큰 원판이 화면 아래를 파스텔로 덮지 않게).
const _novaColor = new THREE.Color();
// 궁수 전투 시점(카메라 고도 약 36°)에서 모자 챙·앞머리가 눈을 가려 애꾸처럼 보이던 문제(2026-10-19 S26 실기기, 2026-10-20 재지적).
// 클립이 머리 뼈를 쓴 직후 고개를 뒤로 젖혀 얼굴을 카메라 쪽으로 들어 두 눈을 드러낸다. 판정·위치·난수와 무관한 렌더 뼈 보정이다.
// 머리 뼈 로컬 축: 앞 +x, 위 +y, 귀 +z. 피치(고개 젖힘)는 z 축 회전이다. 예전 값은 앞 축(x) 12°로 옆으로 기울이는 롤이라 눈이 드러나지 않았다.
// 로비 포즈와 다른 직업은 이 보정을 쓰지 않는다. t1·t2·t3·여우 몸 모델의 머리 뼈 축은 같다.
export const RANGER_HEAD_LIFT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(30));
// 입력 버퍼·취소 창은 game/feel.js 의 FEEL.input 한 표가 소유한다.
const ATTACK_INPUT_BUFFER_SEC = FEEL.input.attackBuffer;
const SKILL_INPUT_BUFFER_SEC = .3;   // 평타 선딜에 막힌 스킬 탭을 보존하는 시간(홀드 평타 중에도 스킬이 사라지지 않게)
const DODGE_INPUT_BUFFER_SEC = FEEL.input.dodgeBuffer;
// 수동 궁수: 사격 중 이동 속도 배율, 회피에서 사격으로 넘어가는 최소 회피 시간, 다리 층 블렌드 속도
export const RANGER_MOVE_SHOT_SPEED = 0.55;
export const RANGER_DODGE_SHOT_AT = 0.16;
// 원거리 AUTO가 붙은 적에게서 연속으로 물러서는 최대 시간. 무리가 같이 따라붙으면 그 자리에서 싸운다(적 원거리 2.4초와 같은 장치).
const AUTO_RANGED_RETREAT_SEC = 1.2;
const RANGER_LEG_BLEND = 10;
const LOWER_BODY_TRACK = /hips|leg|foot|toe/i;
const bowLayerCache = new WeakMap();
// 상체 사격 층 클립 이름. 다리 층은 이 클립이 재생되는 동안(공격·스킬·궁극기)만 켠다.
const RANGER_UPPER_CLIPS = new Set(['RangerBowUpper', 'RangerBowUpperRapid']);
// 시전 뒤 +0.12·+0.24초에 화살을 더 쏘는 스킬은 세 번 당기는 클립(bow_shoot_rapid)으로 재생하고, 각 발사 직후 시위를 쉼 위치로 놓는다.
const RANGER_RAPID_SKILLS = new Set(['ranger_quickshot', 'gale_hunt']);
const RANGER_RAPID_RELEASES = [0, .12, .24];
const RANGER_STRING_SNAP = .04;
/** 활 사격 클립의 상체 트랙과 달리기·대기 클립의 하체 트랙을 나눈다. 같은 원본 클립은 인스턴스끼리 공유한다. */
export function rangerBowLayers(clips) {
  const bow = clips?.Bow_Shoot, run = clips?.Running_A, idle = clips?.Idle;
  if (!bow || !run || !idle) return null;
  let entry = bowLayerCache.get(bow);
  if (!entry) {
    const lower = (track) => LOWER_BODY_TRACK.test(THREE.PropertyBinding.parseTrackName(track.name).nodeName || '');
    const rapid = clips.bow_shoot_rapid;
    entry = {
      upper: new THREE.AnimationClip('RangerBowUpper', bow.duration, bow.tracks.filter((t) => !lower(t))),
      rapid: rapid ? new THREE.AnimationClip('RangerBowUpperRapid', rapid.duration, rapid.tracks.filter((t) => !lower(t))) : null,
      run: new THREE.AnimationClip('RangerLegsRun', run.duration, run.tracks.filter(lower)),
      idle: new THREE.AnimationClip('RangerLegsIdle', idle.duration, idle.tracks.filter(lower)),
    };
    bowLayerCache.set(bow, entry);
  }
  return entry;
}

export class Player extends Actor {
  constructor(game, gltf, def, stats, skillLevels = [1, 1, 1, 1, 1, 1], equip = {}, heroLevel = 1, skillLoadout = [4, 5], avatarId = null) {
    super(game, gltf, { scale: 1.0 });
    // 각성 스킬 0레벨은 미습득이다. 값이 없을 때만 기본(기본 스킬 1, 각성 0)으로 채운다.
    this.def = def; this.stats = stats; this.skillLevels = def.skills.map((sk, i) => Number.isInteger(skillLevels[i]) && skillLevels[i] >= 0 ? skillLevels[i] : sk.unlock ? 0 : 1);
    this.heroLevel = heroLevel; this.skillLoadout = normalizeSkillLoadout(def, skillLoadout, this.skillLevels, heroLevel);
    this.maxHp = stats.hp; this.hp = stats.hp;
    this.look = applyLook(this.model, def, equip, { avatarId });   // 장비 외형: 무기/방패 메시 + 등급 발광 + 궤적색
    this.beacon = new HeroBeacon(this.root, this.model);
    this.gradeAura = new GradeAura(this.root); this.gradeAura.prepare(resolveHeroGrade(this), game.fx);
    this.skillAimView = new SkillAimView(game.scene); this._skillAimShape = {};
    // The outfit is attached after Actor construction; include it in hit/death/revive effects.
    const dressedMaterials = new Set();
    this.model.traverse(o => { if (o.isMesh) for (const m of materialsOf(o)) if (m.emissive) dressedMaterials.add(m); });
    this.mats = [...dressedMaterials];
    // 라이브러리 영웅의 갑옷 단계 몸체가 바뀌면 피격 발광 대상 재질을 다시 모은다.
    this.model.userData.onLibraryBodySwap = () => {
      const next = new Set();
      this.model.traverse(o => { if (o.isMesh) for (const m of materialsOf(o)) if (m.emissive) next.add(m); });
      this.mats = [...next];
    };
    this.auraT = 0;
    this.state = 'idle'; this.stateT = 0;
    this.comboIdx = 0; this.comboQueued = false; this.attackBufferT = 0; this.dodgeBufferT = 0; this.hitDone = false; this.comboWindow = 0;
    this.attackBufferYaw = null; this.comboQueuedYaw = null;
    this.skillBufferT = 0; this.skillBufferSlot = -1; this.skillBufferAim = null;
    // 정지·초점 이탈·재출격은 짧은 입력 버퍼와 방향을 폐기하되 수락된 콤보는 보존한다.
    this._offDodgeInputClear = game.input?.onClear?.(() => {
      this.dodgeBufferT = 0; this.attackBufferT = 0; this.attackBufferYaw = null; this.comboQueuedYaw = null;
      this.skillBufferT = 0; this.skillBufferAim = null;
      this.skillAimView.group.visible = false;
    });
    this.cds = def.skills.map(() => 0); this.ult = 0; this.ultMax = 100; this.ultGainLock = 0;
    this.maxMp = MP_BASE; this.mp = MP_BASE; this.mpRegen = MP_REGEN_PER_SEC; this.dodgeCd = 0;
    this.dr = 0; this.drT = 0; this.sanctum = null;   // 성역: 피해 감소
    this.buffs = { atk: 1, spd: 1, atkSpd: 1, t: 0 }; this.stormT = 0; this.howlT = 0;
    this.auto = false; this.autoT = 0; this.magnetMul = 1; this._autoHubCounts = [];
    this._autoEnemies = []; this._autoOut = { x: 0, y: 0 };
    this.sprint = 0; this.sprintT = 0; this.lockTarget = null; this.perfectWindow = 0; this.perfectCd = 0; this.counterWindow = 0;
    this.trail = null; this.current = null; this.skillCtx = null;
    this.hurtFeedbackT = 0;
    this.moveDir = new THREE.Vector3();
    // 수동 궁수 조준 보조와 사격 중 이동용 상·하체 층. 다른 영웅과 AUTO 경로는 쓰지 않는다.
    this.rangerAim = def.weapon === 'bow' ? new RangerAim() : null;
    this.bowLayers = this.rangerAim ? rangerBowLayers(this.clips) : null;
    const headBone = kitOf(def) === 'ranger' ? this.model.getObjectByName('mixamorigHead') : null;
    this.headLift = headBone?.isBone ? { bone: headBone, base: new THREE.Quaternion(), applied: false } : null;
    if (this.bowLayers) this.clips.RangerBowUpper = this.bowLayers.upper;
    if (this.bowLayers?.rapid) this.clips.RangerBowUpperRapid = this.bowLayers.rapid;
    // 궁수: 판정 방향(yaw)은 즉시 바뀌고, 렌더 피벗만 짧게 따라 돈다(회피 방향 전환·회피→조준 사격의 몸 전체 스냅 완화).
    this.turnSmoothing = !!this.bowLayers;
    // 전투·마을 클립이 무기·팔을 몸에 파묻는 결함을 직업×클립별 가산 회전으로 보정한다(클립·시간 불변).
    this.heroPose = createCombatPose(this.model, kitOf(def), this.mixer, this.clips);
    this._bowLegs = null; this._bowLegBlend = 0;
    this.play('Idle');
    this.footT = 0;
    audio.preloadBarks([0, 1, 2, 3].map((i) => `hero_${def.voiceId || def.id}_atk${i}`).concat([0, 1].map((i) => `hero_${def.voiceId || def.id}_fin${i}`), [0, 1, 2].map((i) => `hero_${def.voiceId || def.id}_hurt${i}`), [0, 1, 2].map((i) => `hero_${def.voiceId || def.id}_skill${i}`), [`hero_${def.voiceId || def.id}_perfect`]));
    if (def.id === 'knight') audio.preloadBarks(['hero_knight_skill6']);
  }
  get atk() { return this.stats.atk * this.buffs.atk * ((this.tonicAtkT || 0) > 0 ? 1.25 : 1) * (this.game.hasProc?.('blood_rage') && this.hp < this.maxHp * 0.5 ? 1.5 : 1); }
  gainJobResource(n) {
    if (!this.def.jobId) return;
    const old = this.jobResource || 0;
    this.jobResource = Math.min(3, old + n);
    if (old < 3 && this.jobResource === 3) this.game.ui.toast(this.def.jobId === 'guardian' ? '결의 충만 · 결의의 반격 강화' : '집중 충만 · 바람 관통탄 강화', 'gold');
  }
  get busy() { return this.state === 'attack' || this.state === 'skill' || this.state === 'dodge' || this.state === 'ult' || this.state === 'hurt'; }
  addUlt(n) {
    if ((this.ultGainLock || 0) > 0 || !Number.isFinite(n) || n <= 0) return this.ult;
    this.ult = Math.min(this.ultMax, this.ult + n); return this.ult;
  }
  addMp(n) { this.mp = Math.max(0, Math.min(this.maxMp, this.mp + n)); return this.mp; }
  combatSkillIndex(slot) { return skillIndexForCombatSlot(this.skillLoadout, slot); }
  combatSkill(slot) { const index = this.combatSkillIndex(slot); return { index, skill: this.def.skills[index] }; }
  tryCastCombatSkill(slot, aim = null) { const index = this.combatSkillIndex(slot); return index >= 0 && this.tryCastSkill(index, aim); }
  dispose() { this.model.userData.libraryDisposed = true; this._offDodgeInputClear?.(); this._offDodgeInputClear = null; this.attackBufferYaw = null; this.comboQueuedYaw = null; this.rangerAim?.clear(); this.skillAimView?.dispose(); this.beacon?.dispose(); this.gradeAura?.dispose(); super.dispose(); }
  /** 수동 궁수만 이동과 조준을 분리한다. AUTO 는 기존 autoAim 경로를 그대로 쓴다. */
  get manualBow() { return !!this.rangerAim && !this.auto; }
  canDodgeShoot() { return this.manualBow && this.state === 'dodge' && this.stateT >= RANGER_DODGE_SHOT_AT && this.stun <= 0; }

  // ---------------- 입력 처리 ----------------
  handleInput(input, dt) {
    if (!this.alive || this.auto || this.stun > 0) { this.attackBufferYaw = null; this.comboQueuedYaw = null; }
    if (!this.alive || this.auto) this.skillBufferT = 0;
    if (!this.alive) return;
    let mx = input.move.x, my = input.move.y;
    if (this.auto) { const m = this.autoMove(dt); mx = m.x; my = m.y; }
    // 카메라 기준 이동: 화면 위 = -z 방향
    this.moveDir.set(mx, 0, my);
    const wantMove = this.moveDir.lengthSq() > 0.01;

    // 다른 행동이 이 프레임을 먼저 수락해도 공격 의도는 남긴다. 현재 행동(회피·경직·스킬·기절)의 남은 시간만큼 보존한다.
    // 버튼·키를 누르고 있으면 매 스텝 같은 공격 의도를 되살린다(2026-10-22 대표님 지시: 홀드는 평타를 계속 이어 간다).
    // 새 입력 버퍼·콤보 예약 경로를 그대로 타므로 공격 속도·연계 창·회피/스킬 우선권은 탭과 같고, 떼면 버퍼 시간만 남고 끝난다.
    // AUTO 는 자체 공격 루프가 있고, 입력이 꺼진 동안 남은 값은 믿지 않는다.
    const attackTap = input.consume('attack');
    if (attackTap || (!this.auto && input.enabled !== false && input.attackHeld)) {
      let wait = Math.max(0, this.stun || 0);
      if (this.state === 'dodge' || this.state === 'hurt') wait = Math.max(wait, .32 - this.stateT);
      if ((this.state === 'skill' || this.state === 'ult') && this.skillCtx) {
        const c = this.skillCtx; wait = Math.max(wait, (c.impl.total || c.impl.dur || .8) - c.t);
      }
      this.attackBufferT = wait + ATTACK_INPUT_BUFFER_SEC;
      // 기절 중 누른 입력은 공격만 보존하고 방향은 버린다(기존 기절 경계 계약).
      this.attackBufferYaw = !this.auto && this.stun <= 0 && wantMove ? Math.atan2(mx, my) : null;
      // 콤보 예약으로 바뀐 입력은 버퍼에서 비운다. 한 번 누른 입력이 두 번 공격으로 늘어나지 않는다.
      if (this.state === 'attack' && this.canQueueCombo()) { this.comboQueued = true; this.comboQueuedYaw = this.attackBufferYaw; this.attackBufferT = 0; }
    }

    // 회피는 즉시 실행하고, 공격 중 이른 입력만 짧게 보존한다. 입력이
    // 공격의 commit 경계를 넘어서면 다음 프레임에 바로 굴러야 한다.
    if (input.consume('dodge')) {
      if (this.dodgeCd <= 0 && this.state !== 'dodge' && this.state !== 'ult' && this.stun <= 0 && this.canDodgeCancel()) return this.dodge(wantMove ? this.moveDir : null);
      if (this.state === 'attack' && this.dodgeCd <= 0) this.dodgeBufferT = DODGE_INPUT_BUFFER_SEC;
    }
    // 후딜 끝에서 예약한 입력은 자연 종료 뒤에도 유효하다. 스킬·궁극기·기절로
    // 전환된 상태는 건너뛰지 않고, 공격 중에는 기존 캔슬 경계만 사용한다.
    if (this.dodgeBufferT > 0 && this.dodgeCd <= 0 && this.stun <= 0 &&
      (this.state === 'idle' || this.state === 'move' || (this.state === 'attack' && this.canDodgeCancel()))) return this.dodge(wantMove ? this.moveDir : null);
    // 전투 입력은 0~3 고정 + Q/E 장착 슬롯 4/5만 노출한다.
    // 평타 선딜(타격 전)에는 스킬 취소가 닫혀 있다. 홀드 평타 중에는 이 구간이 계속 돌아오므로, 막힌 스킬 탭은 짧게 보존했다가
    // 취소 창이 열리면 한 번 시도한다(탭 한 번이 선딜에 걸려 사라지지 않게). 다른 이유로 못 쓰는 스킬은 보존하지 않는다.
    if ((this.skillBufferT || 0) > 0) {
      this.skillBufferT = Math.max(0, this.skillBufferT - dt);
      if (this.state !== 'attack' || this.canSkillCancel()) {
        const slot = this.skillBufferSlot, aim = this.skillBufferAim; this.skillBufferT = 0; this.skillBufferAim = null;
        if (this.tryCastCombatSkill(slot, aim)) return;
      }
    }
    for (let slot = 0; slot < 6; slot++) if (input.consume('skill' + slot)) {
      const aim = input.takeAim?.(slot) ?? this.heldMoveAim(wantMove);
      if (this.tryCastCombatSkill(slot, aim)) return;
      if (this.skillCancelBlocked(slot)) { this.skillBufferSlot = slot; this.skillBufferT = SKILL_INPUT_BUFFER_SEC; this.skillBufferAim = aim ? { x: aim.x, z: aim.z, dist01: aim.dist01, dirOnly: aim.dirOnly } : null; }
    }
    // 공격: 입력 버퍼는 버튼을 누른 순간의 의도를 보존하지만, 버튼 홀드 자체는
    // 다음 콤보를 예약하지 않는다. 수동 전투에서 타이밍을 직접 결정하게 하는 경계다.
    if (this.stun <= 0 && (this.state === 'idle' || this.state === 'move' || this.canDodgeShoot()) && this.attackBufferT > 0) {
      this.attackBufferT = 0;
      this.startCombo(0, this.attackBufferYaw);
    }
    // 수동 궁수는 사격 중에도 이동한다. 몸은 조준 방향을 유지하고 속도만 입력을 따라 부드럽게 맞춘다.
    if (this.state === 'attack' && this.manualBow && this.stun <= 0) {
      const frontier = wantMove ? frontierEffectForStage(this.game.stage) : null;
      const frontierSpeed = frontier?.kind === 'moveSpeedMultiplier' ? frontier.value : 1;
      const speed = wantMove ? this.stats.spd * this.buffs.spd * frontierSpeed * (this.slow ? 0.5 : 1) * RANGER_MOVE_SHOT_SPEED : 0;
      _v.copy(this.moveDir); if (wantMove) _v.normalize().multiplyScalar(speed);
      this.vel.lerp(_v, 1 - Math.exp(-14 * dt));
    }
    // 이동
    if (this.state === 'idle' || this.state === 'move') {
      if (wantMove) {
        // 계속 달리면 스프린트로 가속 (넓은 필드 이동 스트레스 완화)
        this.sprintT = Math.min(1.6, this.sprintT + dt);
        this.sprint = this.sprintT > 0.7 ? Math.min(1, (this.sprintT - 0.7) / 0.6) : 0;
        const frontier = frontierEffectForStage(this.game.stage);
        const frontierSpeed = frontier?.kind === 'moveSpeedMultiplier' ? frontier.value : 1;
        const spd = this.stats.spd * this.buffs.spd * frontierSpeed * (this.slow ? 0.5 : 1) * (1 + this.sprint * 0.45);
        this.vel.copy(this.moveDir).multiplyScalar(spd);
        this.faceDir(this.moveDir.x, this.moveDir.z);
        if (this.state !== 'move') { this.state = 'move'; this.play('Running_A', { fade: 0.15 }); }
        // 재생 배율은 실제 이동 속도(질주·버프·둔화 포함)를 따라가 디딤발이 바닥에서 덜 미끄러진다(feel.js locomotion).
        this.action.timeScale = kitOf(this.def) in FEEL.locomotion.heroRunStride ? heroRunTempo(this.def.id, spd, this.sprint) : (1.1 + this.sprint * 0.35) * this.buffs.spd;
        this.footT += dt;
        if (this.footT > (this.sprint > 0.5 ? 0.2 : 0.28)) { this.footT = 0; this.game.fx.dust(this.pos, { n: this.sprint > 0.5 ? 3 : 2, size: 0.6 + this.sprint * 0.4, life: 0.5, speed: 1 }); }
        if (this.sprint > 0.6 && Math.random() < dt * 8) this.game.fx.embers(this.pos, this.def.color, { n: 1, radius: 0.4, life: 0.35, size: 0.2, rise: 1 });
      } else {
        this.sprintT = Math.max(0, this.sprintT - dt * 3); this.sprint = 0;
        this.vel.set(0, 0, 0);
        if (this.state !== 'idle') { this.state = 'idle'; this.play('Idle', { fade: 0.2 }); }
      }
    }
  }
  /** 스킬을 쓸 수 있는 조건은 모두 맞는데 진행 중인 평타의 취소 창이 아직 닫혀 있어서만 막힌 상태인가. */
  skillCancelBlocked(slot) {
    if (this.auto || this.state !== 'attack' || this.canSkillCancel() || this.stun > 0) return false;
    const index = this.combatSkillIndex(slot), sk = this.def.skills[index];
    if (!sk || !this.unlocked(index) || !SKILLS[sk.id]) return false;
    if (sk.ult ? this.ult < this.ultMax : this.cds[index] > 0) return false;
    return skillMpCost(sk) <= (Number.isFinite(this.mp) ? this.mp : MP_BASE);
  }
  /**
   * 수동 궁수가 이동 입력(조이스틱·방향키)을 잡은 채 스킬을 탭하면 그 방향으로 쏜다.
   * 사격 중 몸은 조준 보조 대상을 향하므로 이 보정이 없으면 입력과 다른 쪽으로 나간다. 끌어서 정한 조준이 있으면 그쪽이 우선이다.
   * 방향만 정하고 지점(aimPoint)은 만들지 않으며, 재사용 객체라 프레임당 할당이 없다.
   */
  heldMoveAim(wantMove) {
    if (!wantMove || !this.manualBow || this.stun > 0) return null;
    const length = Math.hypot(this.moveDir.x, this.moveDir.z);
    if (!(length > 1e-6)) return null;
    const aim = this._heldMoveAim || (this._heldMoveAim = { x: 0, z: 0, dist01: 1, dirOnly: true });
    aim.x = this.moveDir.x / length; aim.z = this.moveDir.z / length;
    return aim;
  }
  nearestEnemy(maxDist = 99) {
    let best = null, bd = maxDist;
    for (const e of this.game.enemies) { if (!e.alive || e.spawning) continue; const d = this.distTo(e); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  autoAim(maxDist = 7) {
    // 이미 조준 중인 대상이 사거리 안이면 유지 (타겟 튐 방지 = 손맛)
    let e = (this.lockTarget && this.lockTarget.alive && this.distTo(this.lockTarget) < maxDist * 1.3) ? this.lockTarget : this.nearestEnemy(maxDist);
    if (e) { this.face(e.pos.x, e.pos.z); this.lockTarget = e; }
    return e;
  }

  get basicAutoTarget() { return this.game.app?.eco?.s?.settings?.autoTarget !== false; }
  /** 공격 시작점에서만 선택한다. 이동 입력·난수와 무관하며 벽 뒤/소멸한 표적은 유지하지 않는다. */
  basicTarget(range = this.def.ranged ? 12 : 7) {
    const enemies = this.game.enemies || [];
    if (enemies.includes(this.lockTarget) && aimTargetValid(this, this.lockTarget, range)) return this.lockTarget;
    let best = null, score = Infinity;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    for (const e of enemies) {
      if (!aimTargetValid(this, e, range)) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      const facing = d > 1e-6 ? (dx * fx + dz * fz) / d : 1;
      // 거리 우선, 정면 쪽 가산, 보스·정예 가중
      const next = d + (1 - facing) * 1.5 - (e.isBoss ? 2 : e.isElite ? .8 : 0);
      if (next < score) { best = e; score = next; }
    }
    return best;
  }

  // ---------------- 기본 콤보 ----------------
  startCombo(idx, inputYaw = null) {
    if (idx === 0 && this.comboResume && this.comboResume.t > 0) { idx = this.comboResume.idx; this.comboResume = null; }
    const c = this.def.combo[idx]; if (!c) return;
    const prevState = this.state;   // 크로스페이드 길이를 고르는 직전 상태(공격 연타 vs 회피·대기에서 시작)
    // 구르기를 사격으로 끊으면 회피 무적도 그 순간 끝난다(다른 출처의 남은 무적은 유지). 회피→사격→회피 연쇄 무적 방지.
    if (this.state === 'dodge') this.invuln = Math.max(0, (this.invulnOther || 0) - this.stateT);
    // 수동 궁수: 사거리 안의 보이는 적을 조준한다(공격 시작 시점). 대상이 없으면 아래 기존 규칙으로 쏜다.
    const manualBow = this.manualBow && this.alive && this.stun <= 0;
    const aimed = manualBow && c.projectile === 'arrow' ? this.rangerAim.select(this, c.range) : null;
    const aimYaw = aimed ? this.rangerAim.yawTo(this, aimed) : null;
    if (aimYaw !== null) { this.yaw = aimYaw; this.lockTarget = aimed; }
    // 수락한 새 입력만 다음 타격의 시작 방향을 고른다. 진행 중 타격은 꺾지 않는다.
    else if (!this.auto && this.alive && this.stun <= 0 && Number.isFinite(inputYaw)) this.yaw = inputYaw;
    this.attackBufferYaw = null; this.comboQueuedYaw = null;
    this.state = 'attack'; this.stateT = 0; this.comboIdx = idx; this.comboQueued = false; this.hitDone = false; this.current = c;
    this._gatherAttackSerial = (this._gatherAttackSerial || 0) + 1;
    // 수동 궁수는 회피·이동 속도를 이어 받아 사격 중 이동한다. 다른 영웅은 기존처럼 멈춰 선다.
    if (!manualBow) this.vel.set(0, 0, 0);
    // AUTO만 적을 향해 몸을 돌린다. 수동 공격은 새 입력으로 고른 방향을
    // 유지하며, 입력이 없으면 현재 바라보는 방향을 그대로 사용한다.
    const target = this.auto ? this.autoAim(this.def.ranged ? 12 : 7)
      : !manualBow && this.basicAutoTarget ? this.basicTarget() : null;
    if (target) {
      this.face(target.pos.x, target.pos.z); this.lockTarget = target;
      // 기존 FX 링을 공격 이벤트마다 한 번 사용한다. 프레임마다 메시/옵션을 만들지 않는다.
      if (!this.auto) this.game.fx.ring(target.pos, this.def.accent || this.def.color, { r0: 1.1, r1: 1.1, life: .45, y: .06 });
    }
    const dur = c.dur / (this.buffs.atkSpd * (this.stormT > 0 ? 1.4 : 1));
    const layered = manualBow && this.bowLayers && c.anim === 'Bow_Shoot';
    this.playTimed(layered ? 'RangerBowUpper' : c.anim, dur, { fade: attackBlend(prevState, this.def.weapon) });
    if (layered) this.startBowLegs();
    gatherWarriorWindup(this, c, dur);
    this.ticksLeft = c.ticks ? c.ticks - 1 : 0; this.nextTick = 0; this.through = null;
    const f = this.forward(_v);
    if (c.move === 'lunge') {
      // 돌진: AUTO는 대상 거리까지, 수동은 현재 방향으로 고정 거리만 이동한다.
      // through 면 적을 뚫고 지나가 뒤에서 벤다 (도적)
      const dist = target ? Math.max(1, Math.min(c.lunge, this.distTo(target) - (c.through ? -1.6 : 1.3))) : c.lunge;
      this.vel.copy(f).multiplyScalar(dist / Math.max(0.12, c.hitAt * dur)); this.invuln = Math.max(this.invuln, c.through ? c.hitAt * dur + 0.1 : 0);
      this.game.fx.dust(this.pos, { n: 5, size: 1 }); if (c.through) this.ghostT = 0;
    } else if (c.move === 'slam') {
      const dist = target ? Math.max(0, Math.min(4, this.distTo(target) - 1.5)) : 1.5;
      this.vel.copy(f).multiplyScalar(dist / Math.max(0.15, c.hitAt * dur));
      this.game.fx.ring(this.pos.clone().addScaledVector(f, dist), this.def.color, { r0: c.range - 0.3, r1: c.range + 0.2, life: c.hitAt * dur, y: 0.06, width: 1 });   // 착지 예고
    } else if (c.move === 'spin') {
      gatherEnemies(this.game, this.pos, c.range + 1.5, 9, c.hitAt * dur);   // 회전베기: 접촉 전 실제 이동으로 모은다.
      this.vel.copy(f).multiplyScalar(0.8);
    } else if (!this.def.ranged && (this.auto || target)) {
      // AUTO·자동 타겟팅은 타격 시점까지 대상 쪽으로 붙어 사거리 안에 넣는다.
      const d = target ? Math.max(0, Math.min(4.5, this.distTo(target) - Math.max(1.6, c.range - .5))) : .6;
      this.vel.copy(f).multiplyScalar(d / Math.max(.01, c.hitAt * dur));
    }
    audio.whoosh({ vol: 0.35 + idx * 0.08, pitch: this.def.ranged ? 1.6 : (c.move === 'slam' ? 0.6 : 1 + idx * 0.12), dur: c.move === 'spin' ? 0.4 : 0.22 });
    // 기합 — 던파식. 마무리 타는 항상, 일반 타는 확률로 (매 타마다 지르면 시끄럽다)
    const V = `hero_${this.def.voiceId || this.def.id}_`;
    if (c.finisher) audio.bark(V + 'fin', { n: 2, vol: 0.95, min: 0.6 });
    else if (c.move || Math.random() < 0.45) audio.bark(V + 'atk', { n: 4, vol: 0.75, min: 0.35 });
    if (!this.def.ranged) this.startTrail();
    // 예비 광채: 타격 직전(.07초 앞) 무기 끝에 영웅색 별빛 한 점. 인스턴스 층이라 메시·재질을 만들지 않는다.
    _glintAt.copy(this.pos).addScaledVector(f, this.def.ranged ? .9 : .7).setY(this.def.weapon === 'staff' ? 1.9 : 1.5);
    this.game.fx.impact?.glint?.(_glintAt, this.def.color, { size: c.finisher ? 1.25 : .75, delay: Math.max(0, c.hitAt * dur - .07) });
  }
  startTrail() {
    if (this.trail) this.trail.stop();
    if (this.game.app?.reducedMotion?.matches) { this.trail = null; return; }
    const hand = 'handslot.r', heavy = this.def.weapon === '2h', dual = this.def.weapon === 'dual';
    const len = heavy ? 1.6 : dual ? .95 : 1.2;
    const combo = this.current;
    this.trail = this.game.fx.trail(points => this.weaponPoints(hand, len, points), this.look.trailColor, {
      segs: this.game.fx.lite ? 10 : 22, life: this.game.fx.lite ? .14 : heavy ? .29 : dual ? .18 : .24,
      width: heavy ? .88 : dual ? .66 : .76,
      getGain: () => this.current === combo && this.state === 'attack' && !this.game.app?.reducedMotion?.matches
        ? weaponTrailGain(this.attackProgress(), combo.hitAt, combo.move === 'spin') : 0,
    });
  }
  stopTrail() { if (this.trail) { this.trail.stop(); this.trail = null; } }
  arrowOrigin(dir = this.forward(new THREE.Vector3())) {
    const bow = this.model?.getObjectByName('Bow');
    if (bow) {
      // 화살 발사 위치는 판정이므로 보정 전 클립 자세로 읽는다(보정은 화면 연출).
      this.heroPose?.suspend(); this.model.updateWorldMatrix(true, true);
      const origin = bow.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, .35);
      this.heroPose?.resume(); this.model.updateWorldMatrix(true, true);
      return origin;
    }
    return this.pos.clone().addScaledVector(dir, .8).setY(1.3);
  }
  doComboHit(tick = 0) {
    const c = this.current; const dmg = this.atk * c.dmg;
    if (tick === 0) audio.attackRelease({ weapon: this.def.weapon, finisher: !!c.finisher, ranged: !!this.def.ranged });
    const counterFinisher = tick === 0 && !!c.finisher && (this.counterWindow || 0) > 0;
    if (counterFinisher) this.counterWindow = 0;
    const comboToken=(c.finisher||c.move==='nova'||c.move==='slam')?(tick===0?(this.comboLinkToken={owner:this,epoch:this.knightLifeEpoch||0}):this.comboLinkToken):null;
    if (!tick && c.jobGain) this.gainJobResource(c.jobGain);
    const f = this.forward(_v.clone());
    const gravity = this.game.hasProc('gravity_pull');
    if (c.projectile === 'arrow') {
      // 발사 시점: 수동 궁수는 대상을 다시 확인한다. 죽었거나 가려졌거나 멀어졌으면 다른 유효 대상, 없으면 현재 방향.
      if (tick === 0 && this.manualBow) {
        const target = this.rangerAim.select(this, c.range);
        const yaw = target ? this.rangerAim.yawTo(this, target) : null;
        if (yaw !== null) { this.yaw = yaw; this.lockTarget = target; this.forward(f); }
      }
      const count = c.arrowCount || 1;
      for (let i = 0; i < count; i++) {
        const dir = f.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (i - (count - 1) / 2) * .22);
        this.game.spawnProjectile({ pos: this.arrowOrigin(dir), dir, speed: 27, radius: c.finisher ? .85 : .55, dmg,
          color: this.def.color, size: c.finisher ? .65 : .4, owner: this, kb: c.kb + (counterFinisher ? 2 : 0), stun: counterFinisher ? .4 : 0, kind: 'slash',
          pierce: !!c.pierce, finisher: !!c.finisher, counter: counterFinisher, comboToken, basic: true, life: c.range / 27, visual: 'arrow' });
      }
      if (counterFinisher) { this.game.ui.toast('완벽 회피 연계 · 관통 붕괴', 'gold'); audio.ting({ vol: .5, freq: 2100 }); }
      audio.whoosh({ vol: .32, pitch: 1.6, dur: .18 });
      this.game.sp?.onComboHit(1);
      return;
    }
    if (c.move === 'fan') {   // 부채꼴 3발
      for (let i = -1; i <= 1; i++) { const dir = f.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.3); const spawn = this.pos.clone().add(dir.clone().multiplyScalar(0.8)); spawn.y = 1.3; this.game.spawnProjectile({ pos: spawn, dir, speed: 20, radius: 0.6, dmg, color: this.def.color, size: 0.4, owner: this, kb: c.kb, kind: 'magic', basic: true }); }
      audio.magic({ vol: 0.25, base: 520, notes: [0, 4, 7], step: 0.03 }); this.game.fx.flash(this.pos.clone().addScaledVector(f, 0.8).setY(1.3), this.def.color, { size: 1.6, life: 0.15 });
      this.game.sp?.onComboHit(1);   // 투사체는 나중에 맞으므로 시전 시점에 장전한다 (원거리 영웅이 세트를 못 쓰던 구멍)
      return;
    }
    if (c.move === 'nova') {   // 노바: 끌어모아 터뜨린다
      this.game.vacuum(this.pos.clone(), c.range + 2, gravity ? 14 : 9);
      const hits = this.game.hitRadius(this.pos, c.range, dmg, { kb: c.kb + (counterFinisher ? 2 : 0), stun: counterFinisher ? .4 : 0, kind: 'magic', finisher: true, counter: counterFinisher, comboToken, source: this, basic: true });
      this.game.sp?.onComboHit(hits);
      // 마무리 노바: 옅은 강조색(accent, 크림·흰빛 계열) 대신 영웅 본색으로, 크기 2.4→1.8배(영웅·적을 하얗게 덮지 않게).
      const deep = _novaColor.set(this.def.color).multiplyScalar(.62).getHex(); this.game.fx.holyBurst(this.pos, { size: c.range * 1.25, life: 0.4, color: deep }); this.game.fx.shockTex(this.pos, deep, { r1: c.range * 1.15, life: 0.35 }); this.game.fx.ring(this.pos, deep, { r0: 0.5, r1: c.range, life: 0.3, vertical: false });
      this.game.renderer.shake(0.4); audio.magic({ vol: 0.4, base: 330, notes: [0, 7, 12], step: 0.04 }); audio.boom({ vol: 0.4, dur: 0.4, low: 90 });
      if (!hits) audio.whoosh({ vol: 0.15, pitch: 1.8, dur: 0.12 });
      return;
    }
    if (c.move === 'slam') {   // 도약 강타: 착지점 반경
      const cpos = this.pos.clone().addScaledVector(f, 0.8);
      const hits = this.game.hitRadius(cpos, c.range, dmg, { kb: c.kb + (counterFinisher ? 2 : 0), stun: counterFinisher ? .4 : 0, kind: 'blunt', finisher: true, counter: counterFinisher, comboToken, source: this, basic: true });
      this.game.sp?.onComboHit(hits);
      this.game.fx.shockTex(cpos, this.def.color, { r1: c.range * 1.5, life: 0.45 }); this.game.fx.dustPuff(cpos, { size: c.range * 1.2, life: 0.6 }); this.game.fx.explosion(cpos, { size: 3.2, color: this.def.color, life: 0.4 }); this.game.fx.burst(cpos.clone().setY(0.4), this.def.color, { n: 20, speed: 8, size: 0.4 });
      this.game.renderer.shake(0.7); this.game.renderer.punch(0.5); audio.boom({ vol: 0.7, dur: 0.5, low: 55 }); audio.vibe(30);
      if (hits && this.game.hasProc('storm_chain')) this.game.stormChain(cpos, this.atk * 0.6);
      return;
    }
    if (c.move === 'spin') {   // 회전베기: 360°, ticks 연타
      const hits = this.game.hitArea(this, this.pos, this.yaw, c.range, 360, dmg, { kb: c.kb, kind: 'slash', quietStop: tick > 0, source: this, basic: true, precision: !this.auto, hitReact: true });
      if (tick === 0) this.game.sp?.onComboHit(hits);
      this.game.fx.slashArc(this.pos, this.yaw + tick * 2.1, this.def.color, { radius: c.range + 0.3, arc: 300, height: 1.1, life: 0.22, thickness: 0.6 });
      this.game.fx.dust(this.pos, { n: 4, size: 1.2 });
      if (gravity) this.game.vacuum(this.pos.clone(), c.range + 1.5, 10);
      audio.whoosh({ vol: 0.3, pitch: 1.1 + tick * 0.15, dur: 0.18 });
      if (!hits) audio.whoosh({ vol: 0.12, pitch: 1.8, dur: 0.1 });
      return;
    }
    if (c.projectile) {
      const spawn = this.pos.clone().add(f.clone().multiplyScalar(0.8)); spawn.y = 1.3;
      this.game.spawnProjectile({ pos: spawn, dir: f, speed: 22, radius: 0.7, dmg, color: this.def.color, size: c.projectile === 'bigbolt' ? 0.7 : 0.4, owner: this, kb: c.kb, kind: 'magic', pierce: c.projectile === 'bigbolt', basic: true });
      audio.magic({ vol: 0.2, base: 660, notes: [0, 7], step: 0.03 });
      this.game.fx.flash(spawn, this.def.color, { size: 1.2, life: 0.15 });
      this.game.sp?.onComboHit(1);
    } else {
      const hits = this.game.hitArea(this, this.pos, this.yaw, c.range, c.arc, dmg, { kb: c.kb + (counterFinisher ? 2 : 0), stun: counterFinisher ? .4 : 0, kind: 'slash', finisher: c.finisher, counter: counterFinisher, comboToken, source: this, basic: true, precision: !this.auto, hitReact: true });
      this.game.sp?.onComboHit(hits);
      if (c.through) { this.game.fx.ghost(this.model, this.def.color, { life: 0.3, opacity: 0.5 }); this.game.fx.slashArc(this.pos, this.yaw, this.def.color, { radius: c.range, arc: 300, height: 1, life: 0.2 }); }   // 관통: 지나온 자리에 잔상
      if (gravity && !c.finisher) this.game.vacuum(this.pos.clone().addScaledVector(f, 1.5), 6, 5);   // 중력 2세트: 모든 타격이 끌어당긴다
      if (c.finisher && hits && this.game.hasProc('storm_chain')) this.game.stormChain(this.pos.clone().addScaledVector(f, c.range * 0.7), this.atk * 0.6);
      const tilt = this.comboIdx === 1 ? 0.7 : this.comboIdx === 2 ? -1.4 : -0.3;
      const sp = this.pos.clone().addScaledVector(f, c.range * 0.45).setY(1.15);
      this.game.fx.slashSprite(sp, f, this.def.color, { size: c.range * 1.7, life: c.finisher ? 0.32 : 0.22, tilt, flip: this.comboIdx % 2 === 1 });
      if (c.finisher) {
        // 마무리 타격: 살짝 몹몰이 + 충격파
        if (!['knight','barbarian'].includes(kitOf(this.def)) || gravity) this.game.vacuum(this.pos.clone().addScaledVector(f, counterFinisher ? 2.3 : 1.5), gravity ? 11 : counterFinisher ? 6.5 : 5.5, gravity ? 16 : counterFinisher ? 11 : 8);
        if (counterFinisher) { this.game.ui.toast('완벽 회피 연계 · 군중 붕괴', 'gold'); audio.ting({ vol: .5, freq: 2100 }); }
        this.game.fx.shockTex(this.pos.clone().addScaledVector(f, 1.2), this.def.color, { r1: 4.2, life: 0.35 });
        // 마무리 폭발은 영웅 본색(검성 금·광전사 주홍·암살자 보라)으로: 옅은 강조색은 적 위에 크림 구름으로 보였다.
        this.game.fx.explosion(this.pos.clone().addScaledVector(f, 1.6), { size: 2.6, color: this.def.color, life: 0.35 });
        this.game.renderer.shake(0.35); this.game.fx.dustPuff(this.pos.clone().addScaledVector(f, 1.5), { size: 2.4, life: 0.5 });
      }
      if (!hits) audio.whoosh({ vol: 0.15, pitch: 1.8, dur: 0.12 });
    }
  }
  canDodgeCancel() {
    if (this.state !== 'attack') return true;
    const c = this.current;
    if (!c) return false;
    const dur = c.dur / ((this.buffs?.atkSpd || 1) * (this.stormT > 0 ? 1.4 : 1));
    const t = this.stateT / Math.max(0.01, dur);
    return dodgeCancelOpen(t, c.hitAt, this.hitDone);
  }
  attackProgress() {
    if (this.state !== 'attack' || !this.current) return 1;
    const dur = this.current.dur / ((this.buffs?.atkSpd || 1) * (this.stormT > 0 ? 1.4 : 1));
    return this.stateT / Math.max(0.01, dur);
  }
  canQueueCombo() {
    if (this.state !== 'attack' || !this.current) return false;
    return comboQueueOpen(this.attackProgress(), this.current.hitAt, this.hitDone);
  }
  canSkillCancel() {
    if (this.state !== 'attack' || !this.current) return true;
    return skillCancelOpen(this.attackProgress(), this.current.hitAt, this.hitDone);
  }

  // ---------------- 회피 ----------------
  dodge(dir) {
    if (this.attackBufferT > 0) this.attackBufferT = Math.max(this.attackBufferT, .32 + ATTACK_INPUT_BUFFER_SEC);
    // Evade without throwing away the earned combo. A cancelled windup repeats
    // its own step; it cannot skip ahead to a free finishing blow.
    if (this.state === 'attack' && this.current) this.comboResume = {idx:this.hitDone?(this.comboIdx+1)%this.def.combo.length:this.comboIdx,t:1.25};
    this.attackBufferYaw = null; this.comboQueuedYaw = null;
    // 회피 무적은 구르기 안쪽에만 둔다. 부활·포탈 등 다른 출처의 남은 무적은 따로 기억해 줄이지 않는다.
    const now = Number.isFinite(this.game?.elapsed) ? this.game.elapsed : NaN;
    this.invulnOther = this.invuln > 0 ? this.invuln : 0;
    // AUTO 가 요청한 회피가 실제로 시작된 순간에만 그 예고를 처리한 것으로 기록한다(버퍼 만료로 못 구른 요청은 다시 시도).
    const threat = this.auto ? this._autoDodgeThreat : null;
    if (threat) { this._autoDodgeFrom = threat; this._autoDodgeUntil = (Number.isFinite(now) ? now : 0) + Math.max(0, this._autoDodgeLead ?? threat.telegraph ?? 0) + .15; }
    this._autoDodgeThreat = null; this._autoDodgeLead = null;
    this.dodgeBufferT = 0; this.stopTrail(); this.state = 'dodge'; this.stateT = 0;
    this.invuln = Math.max(this.invulnOther, DODGE_INVULN_SEC); this.dodgeCd = DODGE_COOLDOWN_SEC;
    this.perfectWindow = 0.28;   // 이 안에 피격 판정이 스치면 퍼펙트
    if (this.def.jobId === 'ranger') this.gainJobResource(1);
    // 수동 무방향 회피는 적을 보면서 물러선다. 방향 입력과 AUTO는 기존 전방 회피를 유지한다.
    const backstep = !dir && !this.auto;
    const d = dir ? dir.clone().normalize() : this.forward(_v.clone()).multiplyScalar(backstep ? -1 : 1);
    if (!backstep) this.faceDir(d.x, d.z);
    this.vel.copy(d).multiplyScalar(19);
    this.play(backstep && this.has('dodge') ? this.A('dodge') : 'Dodge_Forward', { once: true, fade: FEEL.blend.dodge, speed: 1.6 });
    audio.dodgeRelease();
    this.game.fx.dust(this.pos, { n: 8, size: 1.2 });
    this.ghostT = 0;
    this.game.sp?.onDodge(d);   // 룬 세트: 장전 방출 / 사슬 세트: 감아 끌어오기
    if (this.game.hasProc('storm_dash')) {   // 폭풍 4세트: 공속 버프 + 경로 낙뢰 2발
      this.stormT = 3; this.tintEmissive = new THREE.Color(0.1, 0.3, 0.5);
      for (let i = 1; i <= 2; i++) { const at = this.pos.clone().addScaledVector(d, i * 2.6); this.game.after(0.1 * i, () => this.game.stormStrike(at, this.atk * 0.8)); }
    }
  }
  /** 각성 스킬 해금 여부 — 레벨 구간(unlock)을 넘겼는가 */
  unlocked(i) { const sk = this.def.skills[i]; return !!sk && (!sk.unlock || (this.heroLevel >= sk.unlock && (this.skillLevels?.[i] ?? 1) >= 1)); }

  // ---------------- 스킬 ----------------
  tryCastSkill(i, aim = null) {
    const sk = this.def.skills[i]; if (!sk) return false;
    if (!this.unlocked(i)) { this.game.ui.toast(this.heroLevel < sk.unlock ? `Lv.${sk.unlock} 각성으로 해금됩니다` : 'SP로 스킬을 먼저 습득하세요', 'red'); audio.play('ui_error', { vol: 0.5 }); return false; }
    if (sk.ult) { if (this.ult < this.ultMax) { this.game.ui.toast('궁극기 게이지 부족', 'red'); audio.play('ui_error', { vol: 0.5 }); return false; } }
    else if (this.cds[i] > 0) return false;
    if (this.state === 'ult' || this.state === 'dodge' || this.stun > 0) return false;
    if (!this.auto && this.state === 'attack' && !this.canSkillCancel()) return false;
    if (this.state === 'skill' && this.skillCtx && !this.skillCtx.done) return false;
    const impl = SKILLS[sk.id]; if (!impl) return false;
    const mpCost = skillMpCost(sk), currentMp = Number.isFinite(this.mp) ? this.mp : MP_BASE;
    if (mpCost > currentMp) { this.game.ui.toast(`MP 부족 · ${mpCost} 필요`, 'red'); audio.play('ui_error', { vol: 0.5 }); return false; }
    if (this.attackBufferT > 0) this.attackBufferT = Math.max(this.attackBufferT, (impl.total || impl.dur || .8) + ATTACK_INPUT_BUFFER_SEC);
    // 실제로 전환할 수 있는 스킬만 진행 중 평타의 궤적을 종료한다.
    this.stopTrail();
    this.attackBufferYaw = null; this.comboQueuedYaw = null;
    const cooldown = sk.cd * (this.stats?.cdMul ?? 1);
    if (sk.ult) { this.ult = 0; this.ultGainLock = ultimateLockDuration(impl); this.state = 'ult'; } else { this.mp = currentMp - mpCost; this.cds[i] = this.game.skillCooldown?.(cooldown) ?? cooldown; this.state = 'skill'; }
    this.stateT = 0; this.vel.set(0, 0, 0);
    const aimed = aim && Number.isFinite(aim.x) && Number.isFinite(aim.z) && Math.hypot(aim.x, aim.z) > 1e-6;
    if (aimed) this.yaw = Math.atan2(aim.x, aim.z);
    else if (this.auto) this.autoAim(12);
    const lvMult = 1 + (this.skillLevels[i] - 1) * 0.12;
    this.skillCtx = { sk, impl, t: 0, cast: false, done: false, dmg: this.atk * sk.dmg * lvMult * (this.stats?.skillMul ?? 1), level: this.skillLevels[i], data: {} };
    if (aimed && !aim.dirOnly) {
      const shape = skillAimShape(sk.id), length = Math.hypot(aim.x, aim.z);
      const fraction = Number.isFinite(aim.dist01) ? Math.max(0, Math.min(1, aim.dist01)) : 1;
      const distance = shape?.kind === 'circle' ? shape.range * fraction : Math.max(1, shape?.range || 1);
      this.skillCtx.data.aimPoint = new THREE.Vector3(this.pos.x + aim.x / length * distance, this.pos.y, this.pos.z + aim.z / length * distance);
    }
    // 궁수 활 스킬: 상체 사격 층 + 속도에 맞춘 다리 층(후퇴 스킬이 서 있는 자세로 미끄러지지 않게). 연속 발사 스킬은 세 번 당기는 클립.
    const bowSkillClip = sk.anim === 'Bow_Shoot' && this.bowLayers
      ? (RANGER_RAPID_SKILLS.has(sk.id) && this.clips.RangerBowUpperRapid ? 'RangerBowUpperRapid' : 'RangerBowUpper') : null;
    if (sk.anim) this.playTimed(bowSkillClip || sk.anim, impl.dur || 0.8, { fade: 0.06 });
    if (bowSkillClip) this.startBowLegs();
    if (!sk.ult && kitOf(this.def) === 'ranger') audio.whoosh({ vol: .45, pitch: 1.6, dur: .2 });
    else if (!sk.ult) audio.bark(`hero_${this.def.voiceId || this.def.id}_skill${i}`, { vol: 0.95, min: 1.5 });   // 스킬 이름 외침
    audio.skillRelease({ ult: !!sk.ult, school: sk.id || 'arcane', hero: this.def.id });
    if (sk.ult) { this.game.ultCinematic(sk, this); audio.charge({ vol: 0.35, dur: 0.7 }); audio.voice(`hero_${this.def.voiceId || this.def.id}_ult`, { min: 8, duck: 0.5, dur: 1.6 }); if (this.game.hasProc('phoenix_burn')) this.game.after(0.35, () => this.game.phoenixBurn(this)); }
    else if (this.game.hasProc('gravity_hole')) { const t = this.lockTarget && this.lockTarget.alive ? this.lockTarget.pos.clone() : this.pos.clone().addScaledVector(this.forward(_v.clone()), 4); this.game.singularity(t); }
    if (!sk.ult) this.game.sp?.onSkillCast(i, sk);   // 룬 4세트: 만장전이면 과부하 — 이 스킬의 쿨타임이 0이 된다
    impl.start?.(this.game, this, this.skillCtx);
    return true;
  }
  // ---------------- 피격 ----------------
  hurt(dmg, { dirx = 0, dirz = 0, kb = 2, kind = 'blunt' } = {}) {
    if (!this.alive) return false;
    if ((this.guardT || 0) > 0 && this.def.jobId === 'guardian') {
      const perfect = this.guardT > .45;
      this.guardT = 0;
      this.gainJobResource(perfect ? 2 : 1);
      this.game.ui.toast(perfect ? '완벽한 방어 · 반격!' : '방패 방어', 'gold');
      this.game.hitRadius(this.pos, 4, this.atk * (perfect ? 2.8 : 1.2), { kb: 5, stun: .8, kind: 'blunt', source: this, dirFrom: this.pos });
      this.game.fx.shockTex(this.pos, 0x9fd0ff, { r1: 4, life: .35 });
      if (perfect) { this.addUlt(CONTROL_ULT_GAIN.perfectGuard * (this.stats?.ultGain || 1)); return false; }
      dmg *= .3;
    }
    if (this.invuln > 0) {
      // 회피 직후 스치면 퍼펙트 — 슬로우모 + 궁극기 게이지 + 반격 버프
      if (this.perfectWindow > 0 && this.perfectCd <= 0) {
        this.perfectWindow = 0; this.perfectCd = 1.2;
        const frontier = frontierEffectForStage(this.game.stage);
        if (frontier?.kind === 'perfectCooldownReduction') this.def.skills.forEach((skill, i) => {
          if (!skill.ult && this.cds[i] > 0) this.cds[i] = Math.max(0, this.cds[i] - frontier.value);
        });
        this.game.onPerfectDodge(this);
      }
      return false;
    }
    // 비율 경감만. 정액 차감(dmg - def*0.5)은 레벨 1 방어 40 이 1층 잡몹 공격 18 을 통째로 먹어 모든 피격이 1 이 됐다 (hitTakenRatio 0 의 진범)
    const frontier = frontierEffectForStage(this.game.stage);
    if (frontier?.kind === 'firstRoomDamageMultiplier') {
      const world = this.game.world, room = world?.roomAt(this.pos.x, this.pos.z);
      const combatRoom = r => r && ['normal', 'elite', 'boss'].includes(r.type);
      if (combatRoom(room) && room.spawned && !room.cleared && world.rooms?.every(r => !combatRoom(r) || !r.cleared)) dmg *= frontier.value;
    }
    let red = Math.max(1, Math.round(dmg * (1 - Math.min(0.6, this.stats.def / (this.stats.def + 250)))));
    // 성역 안: 받는 피해 감소 (검성 각성 2)
    const legacyDr = this.dr > 0 && this.drT > 0 && (!this.sanctum || Math.hypot(this.pos.x - this.sanctum.pos.x, this.pos.z - this.sanctum.pos.z) < this.sanctum.r) ? this.dr : 0;
    const armory = this.game.sp?.armory;
    const reduction = Math.max(legacyDr, armory?.aegisUntil > this.game.elapsed ? armory.aegis : 0);
    if (reduction > 0) {
      red = Math.max(1, Math.round(red * (1 - reduction)));
      this.game.fx.holyBurst(this.pos.clone().setY(1.1), { size: 2.6, life: 0.25 });
    }
    if ((this.tonicGuardT || 0) > 0) red = Math.max(1, Math.round(red * .7));
    red = this.game.absorbDamage?.(red) ?? red;
    if (red <= 0) { this.game.fx.damage(this.pos,0,{text:'보호막'}); return false; }
    this.hp -= red;
    this.game.routeObjectives?.interrupt();
    this.game.fx.damage(this.pos, red, { kind: 'self' });
    const heavy = kb >= 6;
    // 경타는 피해만 누적하고 이동·콤보 시계를 보존한다. 짧은 몸 반응으로 읽고
    // 반복 화면 흔들림·물리 밀림이 몹몰이의 다음 입력을 덮지 않게 한다.
    if (heavy || !(this.hurtFeedbackT > 0)) {
      this.hurtFeedbackT = .18;
      this.flash(0xff4040, heavy ? .15 : .09);
      this.game.fx.burst(this.pos.clone().setY(1.2), 0xff5a5a, { n: heavy ? 8 : 4, speed: heavy ? 5 : 3, size: .3 });
      this.game.renderer.shake(heavy ? .3 : .055); this.game.renderer.flashScreen(heavy ? .18 : .055, 0xff2040); this.game.ui.hurtVignette();
      audio.hit('hurt'); audio.vibe(heavy ? [30, 20, 30] : 8); audio.bark(`hero_${this.def.voiceId || this.def.id}_hurt`, { n: 3, vol: heavy ? .8 : .6, min: .7 });
      if (!heavy && this.motionRoot) this.receiveImpact(dirx, dirz, .18);
    }
    if (heavy) {
      this.knockback(dirx, dirz, kb);
      // 강타를 맞은 순간 짧게 멈춰 무게를 읽게 한다(동작 줄이기에서는 멈추지 않는다). 연속 정지 재무장 규칙은 ImpactClock 이 지킨다.
      if (!this.game.app?.reducedMotion?.matches) this.game.timeCtl?.hitstop?.(FEEL.hitstop.base.received);
    }
    if (this.game.hasProc('blood_rage') && (this._bloodCd || 0) <= this.game.elapsed) { this._bloodCd = this.game.elapsed + 1.5; this.game.bloodBurst(this); }
    // 스킬/궁극기 중엔 슈퍼아머. 기본 콤보 중에도 경타(kb<6)는 끊지 못한다 — 무리 속에서 잡몹 한 대마다 콤보가 1타로 돌아가던 것이 '끊김'의 절반
    const armored = !heavy || this.state === 'skill' || this.state === 'ult' || this.state === 'dodge';
    if (!armored) {
      // 회피와 같은 실행 경계: 타격 전에는 반복하고 마무리 타격을 실행했으면 첫 타로 돌아간다.
      if (this.state === 'attack' && this.current) { this.comboResume = { idx: this.hitDone ? (this.comboIdx + 1) % this.def.combo.length : this.comboIdx, t: 1.2 }; }
      this.attackBufferYaw = null; this.comboQueuedYaw = null;
      this.stopTrail(); this.state = 'hurt'; this.stateT = 0; this.play(this.heavyHurtClip(dirx, dirz, Math.random()), { once: true, fade: FEEL.blend.hurt, speed: 1.6 });
    }
    if (this.hp <= 0) { this.hp = 0; this.stopTrail(); this.state = 'dead'; this.die(); this.game.onPlayerDeath(this); }
    return true;
  }
  /**
   * 강타 피격 클립. 공격자 쪽(밀린 방향의 반대)으로 고른다: 옆(±60% 이상)은 Hit_L/Hit_R, 정면은 넉백 Hit_B, 등 뒤는 앞으로 움츠리는 Hit_A.
   * 애니메이션 팩 클립이 없는 모델(기존 KayKit 폴백)은 예전처럼 r 로 Hit_A/Hit_B 를 고른다. 난수는 호출자가 늘 한 번 소비한다.
   */
  heavyHurtClip(dirx, dirz, r) {
    const l = Math.hypot(dirx, dirz), c = this.clips;
    if (l > 1e-6 && c?.Hit_L && c.Hit_R && c.Hit_B && c.Hit_L !== c.Hit_A && c.Hit_R !== c.Hit_A) {
      const ax = -dirx / l, az = -dirz / l, s = Math.sin(this.yaw), k = Math.cos(this.yaw);
      const side = ax * k - az * s, front = ax * s + az * k;   // 왼쪽 = (cos yaw, -sin yaw), 정면 = (sin yaw, cos yaw)
      if (side > .6) return 'Hit_L';
      if (side < -.6) return 'Hit_R';
      return front >= 0 ? 'Hit_B' : 'Hit_A';
    }
    return r < 0.5 ? 'Hit_A' : 'Hit_B';
  }
  die() { this.attackBufferYaw = null; this.comboQueuedYaw = null; this.rangerAim?.clear(); if (this.alive) this.knightLifeEpoch = (this.knightLifeEpoch || 0) + 1; this.beacon?.setFocus(false); super.die(); }

  // ---------------- 궁수 활 리그 ----------------
  /** 상체 사격 층과 함께 하체(대기·달리기) 층을 켠다. 사격이 끝나면 updateBowRig 가 끈다. */
  startBowLegs() {
    const layers = this.bowLayers; if (!layers) return;
    if (!this._bowLegs) this._bowLegs = { idle: this.mixer.clipAction(layers.idle), run: this.mixer.clipAction(layers.run), on: false };
    const legs = this._bowLegs;
    if (!legs.on) {
      this._bowLegBlend = Math.min(1, this.vel.length() / Math.max(.01, this.stats.spd * RANGER_MOVE_SHOT_SPEED));
      for (const a of [legs.idle, legs.run]) { a.reset(); a.enabled = true; a.setLoop(THREE.LoopRepeat, Infinity); a.play(); a.fadeIn(.06); }
      legs.on = true;
    }
    legs.idle.setEffectiveWeight(1 - this._bowLegBlend); legs.run.setEffectiveWeight(this._bowLegBlend);
  }
  /** 매 프레임: 사격 다리 층 블렌드와 시위(발사 전이면 실제 오른손 노크 소켓)를 시뮬레이션 상태로 맞춘다. */
  updateBowRig(dt) {
    const legs = this._bowLegs;
    if (legs?.on) {
      if (!['attack', 'skill', 'ult'].includes(this.state) || !RANGER_UPPER_CLIPS.has(this.actionName) || !this.alive) {
        legs.idle.fadeOut(.15); legs.run.fadeOut(.15); legs.on = false;
      } else {
        const top = Math.max(.01, this.stats.spd * RANGER_MOVE_SHOT_SPEED), speed = Math.hypot(this.vel.x, this.vel.z);
        const want = Math.min(1, speed / top);
        this._bowLegBlend += (want - this._bowLegBlend) * Math.min(1, dt * RANGER_LEG_BLEND);
        legs.idle.setEffectiveWeight(1 - this._bowLegBlend); legs.run.setEffectiveWeight(this._bowLegBlend);
        // 조준 방향 뒤로 물러서면 달리기 다리를 거꾸로 돌려 뒷걸음으로 읽힌다.
        const back = speed > .05 && (this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw)) < -.3 * speed;
        legs.run.timeScale = (back ? -1 : 1) * (.75 + .45 * this._bowLegBlend);
      }
    }
    const c = this.current, sk = this.skillCtx;
    const drawing = this.alive && ((this.state === 'attack' && !this.hitDone && c?.projectile === 'arrow')
      || ((this.state === 'skill' || this.state === 'ult') && !!sk && this.skillDrawing(sk)));
    this.bowStringHeld = poseRangerBowString(this.model, drawing);
  }
  /** 스킬 시전 중 시위를 당기고 있는가. 연속 발사 스킬은 각 발사 직후 짧게 놓았다가 다음 당김에서 다시 잡는다. */
  skillDrawing(sk) {
    if (!sk.cast) return true;
    if (this.actionName !== 'RangerBowUpperRapid') return false;
    const since = sk.t - (sk.impl.dur || 0.8) * sk.sk.castAt;
    return RANGER_RAPID_RELEASES.some((at, i) => i > 0 && since > RANGER_RAPID_RELEASES[i - 1] + RANGER_STRING_SNAP && since < at);
  }
  revive() { this.beacon?.setFocus(false); this.alive = true; this.dead = false; this.deathT = -1; this.hp = this.maxHp; this.state = 'idle'; this.invuln = 2; this.pos.y = 0; for (const m of this.mats) m.transparent = false; this.play('Idle'); }

  // ---------------- 자동 전투 ----------------
  autoMove(dt) {
    const out = this._autoOut || (this._autoOut = { x: 0, y: 0 }); out.x = out.y = 0;
    const list = this._autoEnemies || (this._autoEnemies = []); list.length = 0;
    for (const e of this.game.enemies) if (e.alive && !e.spawning) list.push(e);
    if (!list.length) return this.autoExplore(dt);
    // 보스방 유성 예고(푸른 궤도선) 중 피격 구역에 있으면 공격·스킬을 멈추고 안전 지점으로 간다. 공격 동작 중이면 타격 뒤 회피로 빠진다.
    const evade = this.game.routeObjectives?.autoEvade?.(this);
    if (evade) {
      const ex = evade.x - this.pos.x, ez = evade.z - this.pos.z, el = Math.hypot(ex, ez);
      if (el > .3) { out.x = ex / el; out.y = ez / el; }
      if (this.state === 'attack' && this.hitDone && (this.dodgeCd || 0) <= 0) this.game.input.press('dodge');
      return out;
    }
    // 보스 후방 노출(잿불금고 심층) 중 등 뒤 사거리 밖이면 공격·스킬을 멈추고 경로 목표가 준 옆·등 뒤 지점으로 간다.
    // 등 뒤 사거리 안이면 null 이라 평소처럼 친다. 지점에 닿았는데도 지점이 남으면(벽에 막힌 등 뒤 등) 멈춰 서지 않고 평소 전투로 넘어간다.
    const flank = this.game.routeObjectives?.autoFlank?.(this);
    if (flank) {
      const fx = flank.x - this.pos.x, fz = flank.z - this.pos.z, fl = Math.hypot(fx, fz);
      if (fl > .3) { out.x = fx / fl; out.y = fz / fl; return out; }
    }
    // 거수 사슬 기둥(재벼림 심층)이 열린 동안 버티기를 끝낼 수 있으면 공격·스킬 없이 기둥으로 가서 선다(.3 안이면 0 이동).
    // 기둥에 닿을 수 없거나 남은 창이 모자라면 경로 목표가 null 을 돌려줘 평소 전투로 넘어간다.
    const hold = this.game.routeObjectives?.autoHold?.(this);
    if (hold) {
      const hx = hold.x - this.pos.x, hz = hold.z - this.pos.z, hl = Math.hypot(hx, hz);
      if (hl > .3) { out.x = hx / hl; out.y = hz / hl; }
      return out;
    }
    const counts = this._autoHubCounts || (this._autoHubCounts = []);
    // 같은 적 쌍의 거리는 한 번만 읽고 양쪽에 상대 가중치를 더한다.
    // 자기항도 원래 비교를 유지해 비유한 좌표를 이웃으로 세지 않는다.
    for (let i = 0; i < list.length; i++) {
      const c = list[i], dx = c.pos.x - c.pos.x, dz = c.pos.z - c.pos.z;
      counts[i] = dx * dx + dz * dz < 16 ? (c.isBoss ? 5 : c.isElite ? 2 : 1) : 0;
    }
    for (let i = 0; i < list.length; i++) {
      const c = list[i], weight = c.isBoss ? 5 : c.isElite ? 2 : 1;
      for (let j = i + 1; j < list.length; j++) {
        const e = list[j], dx = e.pos.x - c.pos.x, dz = e.pos.z - c.pos.z;
        if (dx * dx + dz * dz < 16) { counts[i] += e.isBoss ? 5 : e.isElite ? 2 : 1; counts[j] += weight; }
      }
    }
    let hub = null, bestN = -1;
    for (let i = 0; i < list.length; i++) {
      const c = list[i], dist = this.distTo(c), score = counts[i] - dist * 0.35;
      if (score > bestN) { bestN = score; hub = c; }
    }
    const priority = this.game.conquest?.autoEnemy(list);
    let e = priority || hub || list[0];
    // 보스·정예 곁의 치유 주술사를 먼저 처치한다. 남겨 두면 6초마다 최대 체력의 15%를 회복시켜 보스전이 끝나지 않았다.
    if (!priority) {
      let healer = null, best = Infinity;
      for (const x of list) {
        if (x.behavior !== 'shaman') continue;
        // 방패병 무리가 더 밀집해도 보스 치유 차단이 먼저다. 현재 무리 중심에만 매달리면 지원 소환마다 회복이 반복된다.
        let supportsPriority = false;
        for (const ally of list) if (ally !== x && (ally.isBoss || ally.isElite) && x.distTo(ally) <= 7) { supportsPriority = true; break; }
        if (!supportsPriority) continue;
        const dd = this.distTo(x);
        // 군중 밀침으로 거리가 뒤집힐 때마다 다른 치유사를 치면 서로 회복해 아무도 죽지 않는다. 접근 중인 유효 치유사는 끝까지 마무리한다.
        if (x === this.lockTarget && dd <= 12) { healer = x; break; }
        if (dd < best) { best = dd; healer = x; }
      }
      if (healer) e = healer;
    }
    // 이동 목표와 다음 평타·스킬의 조준을 맞춘다. 치유사 자체가 무리 중심일 때도 이전 보스 잠금을 남기지 않는다.
    this.lockTarget = e;
    const precision = this.game.conquest?.precisionNeeded(e);
    // Move past the escort line before firing at an ordered target. Ranged
    // bolts still collide normally; AUTO does not make other enemies immune.
    const d = this.distTo(e); const want = this.def.ranged ? (precision ? 2.8 : 7) : 1.9;
    // 원거리 AUTO 후퇴 시간: 붙은 적이 없을 때만 천천히 회복한다. 계속 붙어 있으면 상한에 머물러 제자리 공격을 이어 간다.
    const close = this.def.ranged && d < want - 3;
    if (!close) this._autoBackT = Math.max(0, (this._autoBackT || 0) - dt * .5);
    const canMove = this.state === 'idle' || this.state === 'move';
    const healingPressure = !priority && e.behavior === 'shaman';
    // 평타를 계속 예약하는 AUTO도 실제 취소 창에서는 회복 지원을 스킬로 끊을 수 있어야 한다.
    if (canMove || (healingPressure && this.state === 'attack' && this.canSkillCancel())) {
      // 스킬 우선: 적이 3마리 이상 뭉쳤을 때 광역기 우선
      let cluster = 0, boss = null;
      for (const x of list) { if (x.distTo(e) < 4.5) cluster++; if (!boss && x.isBoss) boss = x; }
      for (let slot = 5; !precision && slot >= 0; slot--) {
        const i = skillIndexForCombatSlot(this.skillLoadout, slot), sk = this.def.skills[i]; if (!sk || !this.unlocked(i)) continue;
        if (sk.id === 'guardian_guard' && !(e.telegraph > 0 && d < 5)) continue;
        const ready = sk.ult ? this.ult >= this.ultMax : this.cds[i] <= 0 && skillMpCost(sk) <= (this.mp ?? MP_BASE);
        if (!ready) continue;
        const bossFinish = !!boss && boss === e && boss.hp / Math.max(1, boss.maxHp) <= .35;
        const emergencyCrowd = cluster >= 8 && this.hp / Math.max(1, this.maxHp) <= .45;
        // 회복 무리를 그대로 두면 보스가 마무리 체력에 도달하지 않는다. 준비된 궁극기로 지원을 먼저 끊는다.
        const supportBurst = !!boss && e.behavior === 'shaman' && cluster >= 2;
        const linkReady = !!this.game.getComboLinkSnapshot?.().ready;
        const controlOpening = healingPressure || linkReady || e.breakT > 0 || (e.telegraph > 0 && d < 5);
        if (sk.ult && !bossFinish && !emergencyCrowd && !supportBurst) continue;
        if (!sk.ult && !controlOpening && cluster < 5) continue;
        const wantCluster = this.game.stage?.expedition?.kind === 'arena' ? 1 : sk.ult ? 1 : sk.awaken ? 2 : 1;
        if (cluster >= wantCluster && d < (this.def.ranged ? 11 : 8)) { this.game.input.press('skill' + slot); return out; }
      }
    }
    if (canMove) {
      // 벽에 가린 적은 같은 방이어도 거리장을 따라 돌아간다(직선으로 벽에 박혀 제자리걸음하던 경로).
      if (d > want + .4 || !clearShot(this.game.world, this.pos.x, this.pos.z, e.pos.x, e.pos.z)) {
        Player.prototype.autoPath.call(this, e.pos.x, e.pos.z, out);
      }
      else if (close && (this._autoBackT || 0) < AUTO_RANGED_RETREAT_SEC && this.autoBackStep(e, out)) this._autoBackT = (this._autoBackT || 0) + dt;
      else this.game.input.press('attack');
    } else if (!precision && this.state === 'attack' && d < want + 2.5) this.game.input.press('attack');   // 사거리 밖(물러서는 원거리 몹)이면 콤보를 끊고 이동으로 돌아간다 — 안 끊으면 허공 콤보가 영원히 이어진다
    // 예고 회피 — 콤보 중에도 지금 캔슬할 수 있는 프레임이면 구른다. 보스·엘리트의 큰 예고는 거의 확실히, 잡몹은 절반쯤 (적 위협 회전: 콤보 중 회피 불가라 보스전에서 HP 의 30% 를 그냥 맞았다)
    // 캔슬 창 밖에서 누르면 회피 입력 버퍼가 나중에 굴려 무적이 타격과 어긋난다. 그래서 지금 바로 구를 수 있을 때만 판단한다.
    // 회피 무적(DODGE_INVULN_SEC)은 구르기보다 짧다. 실제 타격까지 남은 시간이 그 창 안일 때만 눌러야 구르기가 피해를 막는다.
    // 이 프레임 입력 뒤 Player.update가 무적을, Enemy.update가 예고를 같은 dt씩 줄이므로 한 프레임을 남긴다.
    // 타격 정지로 짧아진 프레임 다음에는 실제 프레임 길이로 돌아오므로 남길 몫은 실제 프레임 길이(dt/scale)다.
    if (this.state === 'idle' || this.state === 'move' || this.state === 'attack') {
      const now = this.game.elapsed || 0;
      const clock = this.game.timeCtl, frameDt = clock?.scale > 0 ? dt / clock.scale : dt;
      let threat = null, lead = Infinity;
      for (const x of list) {
        if (!(x.telegraph > 0) || this.distTo(x) >= (x.isBoss ? 5.5 : x.isElite ? 5 : 4)) continue;
        // 쿨타임이 없어도 같은 예고 하나에는 실제로 한 번 구른 뒤 다시 구르지 않는다.
        if (x === this._autoDodgeFrom && now < this._autoDodgeUntil) continue;
        const t = enemyImpactIn(x, this);
        if (t < lead) { lead = t; threat = x; }
      }
      // 무적 중이면 다시 구르지 않는다. 확률은 무적 창 안에서만 쓴다(잡몹 약 절반, 보스·엘리트 약 9할).
      if (threat && lead + frameDt < DODGE_INVULN_SEC && (this.state !== 'attack' || this.canDodgeCancel()) &&
        !(this.invuln > 0) && (this.dodgeCd || 0) <= 0 && Math.random() < dt * (threat.isBoss || threat.isElite ? 9 : 3)) {
        this.game.input.press('dodge'); this._autoDodgeThreat = threat; this._autoDodgeLead = lead;
      }
    }
    return out;
  }
  /** 원거리 AUTO의 후퇴 한 걸음. 몸 길이만큼 뒤에 몸이 그대로 들어가지 않으면(World.resolve가 막거나 벽을 따라 미끄러뜨릴 자리) 물러서지 않는다. */
  autoBackStep(e, out) {
    const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, l = Math.hypot(dx, dz) || 1, ux = -dx / l, uz = -dz / l;
    const W = this.game.world;
    if (W) {
      // Actor.update의 World.resolve(반경 0.8배)가 그대로 받아들이는 자리인지 같은 네 점으로 본다(프레임 할당 없음).
      const r = this.radius * 0.8, step = r * 2, tx = this.pos.x + ux * step, tz = this.pos.z + uz * step;
      if (!(W.walkable(tx + r, tz) && W.walkable(tx - r, tz) && W.walkable(tx, tz + r) && W.walkable(tx, tz - r))) return false;
    }
    out.x = ux; out.y = uz; return true;
  }
  /** 적이 없으면 다음 목표 방으로 이동 (보스 발견 시 보스방 우선) */
  autoExplore(dt) {
    const out = this._autoOut || (this._autoOut = { x: 0, y: 0 }); out.x = out.y = 0;
    const g = this.game, W = g.world; if (!W) return out;
    // 봉인 해제 포탈 → 보스방 앞. 포탈이 벽 뒤에 열리면 거리장으로 돌아간다.
    if (g.portal && (!g.stage?.party || !this.partyPortaled)) return Player.prototype.autoPath.call(this, g.portal.pos.x, g.portal.pos.z, out);
    const goal = g.routeObjectives?.autoGoal?.();   // 경로 목표가 정한 지점(거울 미궁의 진짜 거울)으로 거리장 이동
    if (goal) {
      if (Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z) < .65) return out;   // 목표 지점(또는 기다리는 제자리)에 닿았으면 멈춘다
      const flow = W.buildFlow(goal.x, goal.z), d = W.flowDir(flow, this.pos.x, this.pos.z);
      if (d) { out.x = d[0]; out.y = d[1]; }
      else { const dx = goal.x - this.pos.x, dz = goal.z - this.pos.z, l = Math.hypot(dx, dz) || 1; out.x = dx / l; out.y = dz / l; }
      return out;
    }
    let target = g.conquest?.autoRoom() || g.autoTarget;
    if (!target || target.cleared || !W.rooms.includes(target)) {
      let nearest = null, distance = Infinity;   // 봉인된 보스방은 못 들어간다
      for (const room of W.rooms) {
        if (room.cleared || (W.sealed && room === W.bossRoom)) continue;
        const d = Math.hypot(room.x - this.pos.x, room.z - this.pos.z);
        if (d < distance) { distance = d; nearest = room; }
      }
      if (!nearest) return out;
      // 봉인이 풀린 보스방을 찾았으면 보스 우선, 아니면 가장 가까운 미클리어 방
      const boss = W.bossRoom;
      target = (boss && !boss.cleared && boss.discovered && !W.sealed) ? boss
        : nearest;
      g.autoTarget = target;
    }
    const point = g.routeObjectives?.autoPoint?.(target) || target;
    // 공격으로 부수는 목표(가짜 왕좌): 멈춘 모래시계 옆이면 왕좌를 향해 친다.
    const strike = g.routeObjectives?.autoStrike?.(this);
    if (strike) {
      this.yaw = Math.atan2(strike.pos.x - this.pos.x, strike.pos.z - this.pos.z);
      // 콤보를 이어 붙이면 마지막 타격이 회전 구간에 닿아 반사된다. 새 공격은 쉬는 상태에서만 시작한다.
      if (this.state === 'idle' || this.state === 'move') g.input.press('attack');
      return out;
    }
    if (point !== target && Math.hypot(point.x - this.pos.x, point.z - this.pos.z) < .65) return out;
    return Player.prototype.autoPath.call(this, point.x, point.z, out);
  }
  /** 몸 폭만큼의 직선이 열려 있으면 곧장, 벽에 가리면 거리장을 따라 간다. 할당 없음. */
  autoPath(x, z, out) {
    const W = this.game.world, dx = x - this.pos.x, dz = z - this.pos.z;
    const length = Math.hypot(dx, dz);
    // 중심선만 보면 벽 모서리에 몸이 걸려 제자리걸음한다. 몸 반경만큼 양옆 선도 검사한다.
    const side = length > 1e-6 ? (this.radius || .7) * .8 / length : 0, ox = -dz * side, oz = dx * side;
    // 거리장이 없는 월드(아레나·단순 픽스처)는 직선으로 간다.
    if (W?.buildFlow && (!W.walkable || !clearShot(W, this.pos.x, this.pos.z, x, z) ||
      !clearShot(W, this.pos.x + ox, this.pos.z + oz, x + ox, z + oz) || !clearShot(W, this.pos.x - ox, this.pos.z - oz, x - ox, z - oz))) {
      const flow = W.buildFlow(x, z), dir = W.flowDir(flow, this.pos.x, this.pos.z);
      if (dir) { out.x = dir[0]; out.y = dir[1]; return out; }
    }
    // 목적 셀에 들어왔거나 거리장이 없으면 남은 거리만 직선으로 좁힌다.
    out.x = length > .05 ? dx / length : 0; out.y = length > .05 ? dz / length : 0;
    return out;
  }

  // ---------------- 업데이트 ----------------
  update(dt) {
    this.updateCore(dt);
    // 시위는 이번 프레임의 타격·발사 판정 뒤에 맞춘다. 먼저 맞추면 발사 프레임에 시위가 이미 놓은 손(머리 뒤 follow-through)을
    // 한 프레임 따라가 머리 속을 지난다(궁수 v5 기본공격 머리 여유 -13.3cm, skill0 -1.9cm 의 원인).
    if (this.rangerAim) this.updateBowRig(dt);
  }
  updateCore(dt) {
    // 렌더 소유 메시만 변경한다. 드래그 상태는 전투 판정이나 시계에 관여하지 않는다.
    if (this.skillAimView) {
      const aim = this.game.input?.skillAim;
      const id = aim?.active ? this.def.skills[this.combatSkillIndex(aim.slot)]?.id : null;
      this.skillAimView.update(this, this.game.input?.enabled && !this.game.paused ? aim : null,
        id ? playerSkillAimShape(this, id, this._skillAimShape) : null);
    }
    if (!this.alive || this.auto || this.stun > 0) { this.attackBufferYaw = null; this.comboQueuedYaw = null; }
    // 머리 트랙이 없는 클립에서도 누적되지 않게 지난 프레임 보정 전 값을 먼저 되돌린다.
    if (this.headLift?.applied) { this.headLift.bone.quaternion.copy(this.headLift.base); this.headLift.applied = false; }
    super.update(dt);
    if (this.headLift && this.alive) {
      const lift = this.headLift; lift.base.copy(lift.bone.quaternion); lift.bone.quaternion.multiply(RANGER_HEAD_LIFT); lift.applied = true;
    }
    this.hurtFeedbackT = Math.max(0, (this.hurtFeedbackT || 0) - dt);
    this.attackBufferT = Math.max(0, (this.attackBufferT || 0) - dt);
    if (this.attackBufferT === 0) this.attackBufferYaw = null;
    this.dodgeBufferT = Math.max(0, (this.dodgeBufferT || 0) - dt);
    this.beacon.update(this.alive, this.yaw, { state: this.state, color: this.def.accent || this.def.color, reduced: !!this.game.app?.reducedMotion?.matches });
    this.gradeAura?.update(dt, resolveHeroGrade(this), { alive: this.alive, reduced: !!this.game.app?.reducedMotion?.matches, lite: !!this.game.fx?.lite });
    this.guardT = Math.max(0, (this.guardT || 0) - dt);
    this.tonicAtkT = Math.max(0, (this.tonicAtkT || 0) - dt);
    this.tonicGuardT = Math.max(0, (this.tonicGuardT || 0) - dt);
    this.dodgeCd = Math.max(0, (this.dodgeCd || 0) - dt);
    this.ultGainLock = Math.max(0, (this.ultGainLock || 0) - dt);
    if (this.alive) this.addMp(this.mpRegen * dt);
    if (this.perfectWindow > 0) this.perfectWindow -= dt;
    if (this.counterWindow > 0) this.counterWindow = Math.max(0, this.counterWindow - dt);
    if (this.stormT > 0) { this.stormT -= dt; this.game.fx.aura(this.pos, 0x7fd9ff, 1.5); if (this.stormT <= 0 && this.buffs.t <= 0) this.tintEmissive = null; }
    if (this.perfectCd > 0) this.perfectCd -= dt;
    if (this.drT > 0) { this.drT -= dt; if (this.drT <= 0) { this.dr = 0; this.sanctum = null; } }
    if (this.comboResume) { this.comboResume.t -= dt; if (this.comboResume.t <= 0) this.comboResume = null; }
    if (this.look.aura && this.alive) { this.auraT -= dt; if (this.auraT <= 0) { this.auraT = this.look.enhMax >= 15 ? 0.12 : 0.22; this.game.fx.aura(this.pos, this.look.aura, 1); } }   // +10 이상 강화: 잔불 오라
    // 락온: 조준 대상이 계속 바뀌지 않도록 유지
    if (this.lockTarget && (!this.lockTarget.alive || this.distTo(this.lockTarget) > 11)) this.lockTarget = null;
    for (let i = 0; i < this.cds.length; i++) if (this.cds[i] > 0) this.cds[i] = Math.max(0, this.cds[i] - dt);   // 4로 박아두면 각성 슬롯(4·5)이 영원히 안 돌아온다
    if (this.howlT > 0) this.howlT = Math.max(0, this.howlT - dt);
    if (this.buffs.t > 0) { this.buffs.t -= dt; this.game.fx.aura(this.pos, 0xff3030, 2); if (this.buffs.t <= 0) { this.buffs.atk = 1; this.buffs.spd = 1; this.buffs.atkSpd = 1; this.tintEmissive = null; } }
    if (!this.alive) return;
    this.stateT += dt;
    if (this.state === 'attack') {
      const c = this.current; const dur = c.dur / (this.buffs.atkSpd * (this.stormT > 0 ? 1.4 : 1)); const t = this.stateT / dur;
      if (this.attackBufferT > 0 && this.canQueueCombo()) { this.comboQueued = true; this.comboQueuedYaw = this.attackBufferYaw; this.attackBufferT = 0; }
      const moveShot = this.manualBow && c.projectile === 'arrow';
      // 발사 전까지 수동 궁수의 몸은 유효한 조준 대상을 따라 돈다(이동 방향과 무관).
      // 대상이 벽 뒤·사거리 밖·목록 밖으로 무효가 되면 그쪽으로 돌지 않고 마지막 유효 방향을 유지한다. 발사 순간 다른 유효 대상을 다시 고른다.
      if (moveShot && !this.hitDone && this.rangerAim.target) {
        if (!this.rangerAim.holds(this, c.range)) {
          if (this.lockTarget === this.rangerAim.target) this.lockTarget = null;
          this.rangerAim.target = null;
        } else { const yaw = this.rangerAim.yawTo(this); if (yaw !== null) this.yaw = yaw; }
      }
      if (c.move === 'spin' && !this.hitDone) gatherEnemies(this.game, this.pos, c.range + 1.5, 9);
      if (!this.hitDone && t >= c.hitAt) { this.hitDone = true; this.doComboHit(0); if (c.move !== 'spin' && !moveShot) this.vel.multiplyScalar(c.move === 'lunge' ? 0.35 : 0.2); this.nextTick = c.hitAt + (1 - c.hitAt) / (c.ticks || 1); }
      if (this.hitDone && this.ticksLeft > 0 && t >= this.nextTick) { this.ticksLeft--; this.doComboHit((c.ticks || 1) - this.ticksLeft - 1); this.nextTick += (1 - c.hitAt) / (c.ticks || 1); }   // 회오리 연타
      if (c.through && this.ghostT !== undefined) { this.ghostT += dt; if (this.ghostT > 0.06 && !this.hitDone) { this.ghostT = 0; this.game.fx.ghost(this.model, this.def.color, { life: 0.25, opacity: 0.4 }); } }
      if (this.hitDone && this.trail && t >= c.hitAt + 0.25 && !this.ticksLeft) this.stopTrail();
      if (this.hitDone && c.move !== 'spin' && !moveShot) this.vel.multiplyScalar(Math.pow(0.001, dt));
      // 콤보 연계 창: 타격 직후부터 (0.18 → 0.1: 타 사이 공백이 '끊김'으로 읽혔다). 연타 중엔 마지막 tick 뒤
      const chainAt = c.ticks ? this.nextTick - 0.02 : c.hitAt + 0.1;
      if (this.hitDone && this.comboQueued && !this.ticksLeft && t >= chainAt) { const next = this.comboIdx + 1; if (next < this.def.combo.length) { this.startCombo(next, this.comboQueuedYaw); return; } else if (t >= c.hitAt + 0.3) { this.startCombo(0, this.comboQueuedYaw); return; } }   // 마무리 뒤에도 idle 을 거치지 않고 1타로
      if (t >= 1) { this.stopTrail(); this.state = 'idle'; this.play('Idle', { fade: 0.2 }); this.vel.set(0, 0, 0); if (this.comboQueued) this.startCombo(0, this.comboQueuedYaw); }
    } else if (this.state === 'dodge') {
      this.ghostT += dt; if (this.ghostT > 0.05) { this.ghostT = 0; this.game.fx.ghost(this.model, this.def.color, { life: 0.3, opacity: 0.5 }); }
      this.vel.multiplyScalar(Math.pow(0.02, dt));
      if (this.stateT > 0.32) { this.state = 'idle'; this.vel.set(0, 0, 0); this.play('Idle', { fade: 0.15 }); if (this.attackBufferT > 0) { this.attackBufferT = 0; this.startCombo(0, this.attackBufferYaw); } }
    } else if (this.state === 'hurt') {
      this.vel.set(0, 0, 0);
      if (this.stateT > 0.32) { this.state = 'idle'; this.play('Idle', { fade: 0.15 }); }
    } else if (this.state === 'skill' || this.state === 'ult') {
      const c = this.skillCtx; c.t += dt;
      const castT = (c.impl.dur || 0.8) * c.sk.castAt;
      if (!c.cast && c.t >= castT) { c.cast = true; if (this.state === 'ult') this.game.ultRelease?.(this); c.impl.cast?.(this.game, this, c); this.game.onSkillReleased?.(this,c); }
      c.impl.update?.(this.game, this, c, dt);
      if (c.t >= (c.impl.total || c.impl.dur || 0.8)) { c.done = true; c.impl.end?.(this.game, this, c); this.state = 'idle'; this.vel.set(0, 0, 0); this.stopTrail(); this.play('Idle', { fade: 0.2 }); }
    }
    // 회피·경직·스킬·기절이 끝난 프레임에 보존한 공격을 바로 시작한다(다음 입력 처리까지 기다리면 버퍼가 만료될 수 있다).
    if (this.state === 'idle' && this.stun <= 0 && this.attackBufferT > 0) {
      this.attackBufferT = 0; this.startCombo(0, this.attackBufferYaw);
    }
  }
}
