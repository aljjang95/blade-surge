import './style.css';
import * as THREE from 'three';
import { Renderer } from './engine/renderer.js';
import { LobbyCameraControls } from './engine/lobby-camera.js';
import { FX } from './engine/fx.js';
import { Input } from './engine/input.js';
import { audio } from './engine/audio.js';
import { preloadAll, preloadVfx, loadModel, MODEL_LIST, spawnCharacter, disposeCharacter } from './engine/assets.js';
import { Economy } from './game/economy.js';
import { Battle } from './game/battle.js';
import { Arena } from './game/arena.js';
import { HEROES } from './data/heroes.js';
import { ENEMIES, stageDef } from './data/stages.js';
import { UI, $ } from './ui/ui.js';
import { Meta } from './ui/meta.js';
import { createCompanion } from './companion/bootstrap.ts';
import { ExpeditionEconomy } from './game/expedition-economy.js';
import { buildExpeditionStage } from './game/expedition-combat.js';
import { ExpeditionUI } from './expansion/hub.jsx';
import { playExpeditionIntro } from './expansion/cinematic.js';
import { Wardrobe } from './expansion/wardrobe.jsx';
import { JourneyService } from './game/journey-service.js';
import { JourneyView } from './ui/journey.js';
import { applyRiftStage } from './game/journey-rifts.js';
import { ArsenalService } from './game/arsenal-service.js';
import { ArsenalView } from './ui/arsenal.js';
import './ui/mobile-combat.css';
const BOOT_TIPS = [
  '<b>진공기</b>로 적을 끌어모은 뒤 한 번에 쓸어담는 것이 몹몰이의 기본이다.',
  '적의 공격 직전 <b>회피</b>하면 퍼펙트 회피 — 시간이 느려지고 반격 창이 열린다.',
  '<b>미니맵</b>의 화살표는 아직 못 찾은 보스방의 방향이다.',
  '싸움 소리를 들은 <b>이웃 방의 무리</b>가 복도로 몰려온다. 입구를 등지지 마라.',
  '같은 세트 <b>2개·4개</b>를 맞추면 플레이 방식이 바뀌는 세트 효과가 열린다.',
  '<b>강화 +8</b>까지는 실패가 없다. +12부터는 파괴 위험 — 보호석을 챙겨라.',
  '보물방을 클리어하면 장비 상자가 열린다. 층을 다 밟을수록 별이 늘어난다.',
  '설정에서 <b>카메라</b>를 바꿔보라 — 탑다운·액션·시네마틱, 또는 상황에 맞춘 AUTO.',
  '보스는 체력 60%·30%에서 패턴이 바뀌고, 30%부터 <b>광폭화</b>한다.',
  '<b>질주</b> 중 적과 부딪히면 넉백. 무리 사이를 가르며 달려라.',
];

import { applyLook } from './game/look.js';

class App {
  constructor() {
    this.canvas = $('gl');
    this.renderer = new Renderer(this.canvas);
    this.scene = this.renderer.scene;
    this.fx = new FX(this.scene, this.renderer.camera);
    this.input = new Input();
    this.eco = new Economy();
    this.ui = new UI(this);
    this.meta = new Meta(this);
    this.expedition = new ExpeditionEconomy(this.eco);
    this.expeditionUI = new ExpeditionUI(this);
    this.journey = new JourneyService(this);
    this.arsenal = new ArsenalService(this);
    this.models = {};
    this.wardrobe = new Wardrobe(this);
    this.mode = 'boot'; this.showcase = null; this.lobbyVisible = true;
    this.lobbyCameraControls = new LobbyCameraControls(this);
    this.last = performance.now();
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.applySettings();
  }
  async boot() {
    const fill = $('boot-fill'), msg = $('boot-msg'), pct = $('boot-pct');
    const setP = (p, m) => { fill.style.width = (p * 100) + '%'; pct.textContent = Math.round(p * 100) + '%'; if (m) msg.textContent = m; };
    // 팁 로테이션 — 로딩 중에도 손이 배운다
    const tipEl = $('boot-tip'); let tipI = Math.floor(Math.random() * BOOT_TIPS.length);
    const showTip = () => { tipEl.classList.remove('on'); setTimeout(() => { tipEl.innerHTML = BOOT_TIPS[tipI++ % BOOT_TIPS.length]; tipEl.classList.add('on'); }, 450); };
    showTip(); this._tipTimer = setInterval(showTip, 3600);
    setP(0.02, '3D 모델 로딩 중…');
    await preloadAll((p) => setP(0.05 + p * 0.65, `3D 모델 로딩 중… ${Math.round(p * 100)}%`));
    setP(0.72, '이펙트 텍스처 로딩 중…');
    await preloadVfx();
    for (const n of MODEL_LIST) this.models[n] = await loadModel(n);
    for (const gltf of Object.values(this.models)) gltf.scene.traverse((o) => {
      if (o.isMesh && o.material?.userData.tllAuthored) {
        o.material.envMap = this.renderer.characterEnvironment.texture; o.material.envMapIntensity = .7;
      }
    });
    setP(0.85, '월드 구성 중…');
    this.arena = new Arena(this.scene, this.models.dungeon, this.renderer);
    this.battle = new Battle(this);
    this.journeyView = new JourneyView(this);
    this.arsenalView = new ArsenalView(this);
    await this.showcaseHero(this.eco.s.selected, true);
    setP(0.95, '게임 화면 준비 중…');
    // 셰이더 프리컴파일 (첫 프레임 끊김 방지)
    await this.fx.prepare(this.renderer.r, this.models, this.renderer.composer.readBuffer);
    setP(1, '준비 완료');
    const start = $('boot-start'); start.classList.remove('hidden'); msg.textContent = '';
    await new Promise((res) => { const go = async () => { start.disabled = true; start.textContent = '사운드 준비 중…'; await audio.init(); audio.resume(); res(); }; start.addEventListener('click', go, { once: true }); });
    clearInterval(this._tipTimer);
    const bootEl = $('boot'); bootEl.classList.add('leaving');
    this.toLobby(true);
    if (!this.companionAgent) this.companionAgent = createCompanion(this);
    setTimeout(() => { bootEl.classList.remove('show', 'leaving'); }, 620);
    document.addEventListener('visibilitychange', () => { if (document.hidden) { if (this.mode === 'battle') this.ui.pause(true); } else audio.resume(); });
    requestAnimationFrame((t) => this.loop(t));
  }
  applySettings() {
    const st = this.eco.s.settings; audio.setSfxOn(st.sfx); audio.setMusicOn(st.music); audio.haptics = st.haptics; audio.setVoiceOn(st.voice !== false);
    audio.setMix(this.arsenal.s.mix);
    let q = st.quality;
    if (!q || q === 'auto') { const cores = navigator.hardwareConcurrency || 4; const mem = navigator.deviceMemory || 4; q = (cores <= 4 || mem <= 3) ? 'mid' : 'high'; st.quality = q; }
    this.renderer.setQuality(q); this.fx.setQuality(q);
    this.renderer.setCameraPreset(st.camera || 'auto');
    this.lobbyCameraControls?.sync();
    this.companionAgent?.syncQuality();
  }
  // ---------- 로비 ----------
  async showcaseHero(id, first = false) {
    const def = HEROES[id];
    this.companionAgent?.cancelDialogue();
    if (this.showcase) { disposeCharacter(this.showcase.root, this.showcase.mixer); this.showcase = null; }
    if (!this.arena.lobbyHall) this.arena.buildLobby();
    const { root, mixer, clips } = spawnCharacter(this.models[def.model]);
    root.rotation.y = Math.PI * 0.15;
    const look = applyLook(root, def, this.eco.heroEquipInsts(id));   // 로비 쇼케이스도 장착 장비대로
    const a = mixer.clipAction(clips['Idle']); a.play();
    // Establish the authored idle pose even when reduced motion stops later ticks.
    mixer.update(0);
    this.scene.add(root);
    this.showcase = { root, mixer, clips, def, look, t: 0, next: 4 + Math.random() * 3, auraT: 0 };
    this.companionAgent?.syncLobbyContext();
    if (!first) { this.fx.pillar(new THREE.Vector3(0, 0, 0), def.color, { radius: 1.2, height: 8, life: 0.8 }); this.fx.burst(new THREE.Vector3(0, 1, 0), def.color, { n: 40, speed: 6, size: 0.4, up: 1 }); audio.magic({ vol: 0.3, base: 440, notes: [0, 4, 7, 12] }); }
    this.renderer.rig.mode = 'lobby'; this.renderer.rig.target.set(0, 0, 0);
  }
  setLobbyVisible(v) { this.lobbyVisible = v; }
  toLobby(first = false) {
    if (this.expeditionTicket && this.battle?.result?.win && !this.battle.result.expeditionReceipt?.ok) { this.expeditionUI.showResult(this.battle, true); return; }
    if (this.expeditionRefundPending && this.expeditionTicket) {
      const refund = this.expedition.abandon(this.expeditionTicket);
      if (refund.ok) { this.expeditionTicket = null; this.expeditionRefundPending = false; }
    }
    if (this.expeditionTicket && !this.expeditionRefundPending) {
      const outcome = this.expedition.settle(this.expeditionTicket, { win: false });
      if (outcome.ok) this.expeditionTicket = null;
    }
    if (this.mode === 'battle') { this.battle.stop(); }
    this.ui.hideResult(); this.mode = 'lobby';
    if (first) setTimeout(() => audio.voice('welcome', { vol: 0.9 }), 900);
    this.ui.show($('meta'), true);
    this.showcaseHero(this.eco.s.selected, true);
    this.renderer.desat = 0; this.renderer.rig.mode = 'lobby';
    audio.playMusic('bgm_lobby');
    this.meta.openTab('home'); this.meta.refreshTop();
    if (first) setTimeout(() => this.meta.autoPopups(), 600);
  }
  resetProgress() {
    if (this.stageStarting) return false;
    const companionReset = this.companionAgent?.reset() ?? true;
    const gameReset = this.eco.reset();
    this.toLobby();
    return companionReset && gameReset;
  }
  async startStage(stage) {
    if (stage?.expedition) return this.startExpedition(stage.expedition.kind, stage.expedition.id, { rift: !!stage.riftId });
    if (this.stageStarting || (this.mode === 'battle' && this.battle.active)) return false;
    if (!stage || !this.eco.isUnlocked(stage.ch, stage.st)) { this.ui.toast('이전 스테이지를 먼저 클리어하세요.', 'red'); return false; }
    // 미리보기에서 넘긴 객체 대신 검증된 현재 스테이지 정의로 출격한다.
    stage = stageDef(stage.ch, stage.st);
    this.stageStarting = true;
    let spent = false;
    const energyBefore = { energy: this.eco.s.energy, energyT: this.eco.s.energyT };
    try {
      spent = this.eco.spendEnergy(stage.energy);
      if (!spent) {
        audio.play('ui_error');
        const ok = await this.ui.confirm('에너지 부족', `에너지 ${stage.energy}가 필요합니다. 보석으로 충전할까요?`, { ok: '충전' });
        if (ok) this.meta.openTab('shop', 'energy');
        return false;
      }
      this.ui.hideResult(); this.ui.show($('meta'), false); this.ui.closeModal();
      $('stage-loading').hidden = false;
      if (this.showcase) { disposeCharacter(this.showcase.root, this.showcase.mixer); this.showcase = null; }
      this.mode = 'battle';
      const id = this.eco.s.selected;
      await this.battle.start(stage, id, this.eco.hero(id), this.eco.heroEquipBonus(id));
      this.battle.player.auto = this.journey.s.autoBattle; $('btn-auto').classList.toggle('on', this.battle.player.auto);
      return true;
    } catch (error) {
      const rollbackSaved = !spent || this.eco.rollbackEnergy(energyBefore);
      this.toLobby();
      this.ui.toast(rollbackSaved ? '던전을 준비하지 못했습니다. 에너지는 복구됐습니다. 다시 출격해 주세요.' : '현재 창의 에너지는 복구했지만 저장하지 못했습니다. 저장 권한을 확인해 주세요.', 'red');
      console.warn('stage preparation failed', error?.message);
      return false;
    } finally { $('stage-loading').hidden = true; this.stageStarting = false; }
  }
  async startExpedition(kind, id, options = {}) {
    if (this.expeditionUI.result?.saveError) { this.ui.toast('전리품 정산을 먼저 저장해 주세요.', 'red'); return false; }
    if (this.stageStarting || (this.mode === 'battle' && this.battle.active)) return false;
    if (this.expeditionRefundPending) {
      const refund = this.expedition.abandon(this.expeditionTicket);
      if (!refund.ok) { this.ui.toast('이전 출격의 에너지 복구를 저장하지 못했습니다. 저장 공간을 확인해 주세요.', 'red'); return false; }
      this.expeditionTicket = null; this.expeditionRefundPending = false;
    }
    let stage;
    try { stage = buildExpeditionStage(kind, id, this.eco); }
    catch (error) { this.ui.toast(error.message, 'red'); return false; }
    const begin = this.expedition.begin(kind, id, options);
    if (!begin.ok) { this.ui.toast(begin.error, 'red'); return false; }
    this.expeditionTicket = begin.ticket;
    stage = applyRiftStage(stage, begin.ticket);
    this.stageStarting = true;
    try {
      this.expeditionUI.result = null; this.expeditionUI.close();
      this.journeyView?.close();
      this.ui.hideResult(); this.ui.show($('meta'), false); this.ui.closeModal();
      $('stage-loading').hidden = false;
      if (this.showcase) { disposeCharacter(this.showcase.root, this.showcase.mixer); this.showcase = null; }
      this.mode = 'battle';
      const heroId = this.eco.s.selected;
      await this.battle.start(stage, heroId, this.eco.hero(heroId), this.eco.heroEquipBonus(heroId));
      this.battle.player.auto = this.journey.s.autoBattle; $('btn-auto').classList.toggle('on', this.battle.player.auto);
      this.expeditionUI.refreshPotions();
      if (kind === 'dungeon') await playExpeditionIntro(this, id);
      audio.playMusic('expansion/flow-combat', { fade: .7, volume: .68 });
      return true;
    } catch (error) {
      const refund = this.expedition.abandon(begin.ticket);
      if (refund.ok) this.expeditionTicket = null;
      this.expeditionRefundPending = !refund.ok;
      this.toLobby();
      this.ui.toast(refund.ok ? '던전을 준비하지 못했습니다. 에너지를 복구했습니다.' : '출격 준비가 실패했습니다. 저장 상태를 확인해 주세요.', 'red');
      console.warn('expedition preparation failed', error?.message);
      return false;
    } finally { $('stage-loading').hidden = true; this.stageStarting = false; }
  }
  // ---------- 루프 ----------
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    let realDt = Math.min(0.05, (t - this.last) / 1000); this.last = t;
    if (this.testPause || this.stageStarting) return;
    this.step(realDt);
  }
  /** 한 프레임 진행 (테스트 시 고정 dt로 호출 가능) */
  step(realDt, render = true) {
    const battle=this.battle, combat=this.mode==='battle'&&battle?.active;
    audio.updateCombatMix(realDt,{active:combat,paused:!!(battle?.paused||this.expeditionUI?.opened),boss:!!(combat&&battle.enemies.some(e=>e.alive&&e.isBoss)),intensity:combat?Math.min(1,(battle.combo||0)/30):0});
    this.arsenalView?.update();
    if (this.expeditionUI?.opened) return;
    if (this.mode === 'battle') {
      this.battle.update(realDt);
      const dt = realDt * this.battle.timeCtl.scale;
      this.fx.update(dt);
      if (this.battle.player) { this._auto = this.battle.player.auto; }
      // 킬 카운트 → 임무
      this.renderer.update(dt, realDt); if (render) this.renderer.render();
    } else if (this.mode === 'lobby') {
      if (this.showcase) {
        const s = this.showcase;
        if (!this.reducedMotion.matches) {
          s.mixer.update(realDt); s.t += realDt;
          if (s.gesture) {
            s.gestureT -= realDt;
            if (s.gestureT <= 0) {
              const idle = s.mixer.clipAction(s.clips.Idle); idle.reset().play().crossFadeFrom(s.gesture, .3);
              s.gesture = null;
            }
          } else if (s.t > s.next) {
            s.t = 0; s.next = 5 + Math.random() * 4;
            const clip = s.clips[Math.random() < .5 ? 'Cheer' : 'Interact'];
            s.gesture = s.mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce).play();
            s.gesture.crossFadeFrom(s.mixer.clipAction(s.clips.Idle), .2);
            s.gestureT = Math.max(.1, clip.duration - .3);
          }
          if (Math.random() < realDt * 3) this.fx.embers(new THREE.Vector3(0, .2, 0), s.def.color, { n: 1, radius: 1.2, life: 1.5, size: .25, rise: 1.2 });
        } else if (s.gesture) {
          s.gesture.stop(); s.gesture = null; s.mixer.clipAction(s.clips.Idle).reset().play(); s.mixer.update(0);
        }
        if (s.look?.aura && !this.reducedMotion.matches) { s.auraT -= realDt; if (s.auraT <= 0) { s.auraT = 0.2; this.fx.aura(s.root.position, s.look.aura, 1); } }
      }
      this.arena.update(realDt, this.fx, this.showcase ? this.showcase.root.position : null); this.fx.update(realDt);
      this.renderer.update(realDt, realDt);
      if (render && (this.lobbyVisible || this.meta.tab === 'home')) this.renderer.render();
    }
  }
}

const app = new App();
window.app = app;
window.__EN = ENEMIES; window.__stageDef = stageDef; window.__THREE = THREE;
app.boot().catch((e) => { console.error(e); $('boot-msg').textContent = '로딩 실패: ' + e.message; });
