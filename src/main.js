import './style.css';
import * as THREE from 'three';
import { Renderer } from './engine/renderer.js';
import { LobbyCameraControls } from './engine/lobby-camera.js';
import { CameraControls } from './engine/camera-control.js';
import { setupPwa } from './platform/pwa.js';
import { AppModeView } from './platform/app-mode.js';
import { resolveQuality } from './platform/mobile-display.js';
import { isNativeApp, setupNativeApp } from './platform/native-app.js';
import { FX } from './engine/fx.js';
import { Input } from './engine/input.js';
import { audio } from './engine/audio.js';
import { musicForScene, musicAfterIntro, MUSIC_MIX } from './data/music.js';
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
import { PartySession } from './party/session.js';
import './ui/mobile-combat.css';
import './ui/progression.css';
import './ui/illustrated.css';
import './ui/oath-visual.css';
import { OathShell } from './ui/oath-shell.js';
import { ExperienceView } from './ui/experience-view.js';
import { BattleTutorial } from './ui/tutorial.js';
import { applyDifficulty } from './game/difficulty.js';
import { CITADEL_HUB } from './data/citadel-hub.js';
import { preloadCitadelHubAssets } from './game/citadel-hub-scene.js';
import { HubMovement } from './game/hub-movement.js';
import { HubControls } from './engine/hub-controls.js';
import { CitadelHubUI } from './ui/citadel-hub.js';
import { CitadelShop } from './ui/citadel-shop.js';
import { CitadelCommand } from './ui/citadel-command.js';
import './ui/citadel-integration.css';
import './ui/garden-ui.css';
import './ui/departure-journal.css';
const BOOT_TIPS = [
  '<b>진공기</b>로 적을 끌어모은 뒤 한 번에 쓸어담는 것이 몹몰이의 기본이다.',
  '적의 공격 직전 <b>회피</b>하면 퍼펙트 회피 — 시간이 느려지고 반격 창이 열린다.',
  '<b>미니맵</b>에서 발견한 방과 지금 해야 할 행동을 확인하라. 직접 탐험해 다음 길을 찾아라.',
  '싸움 소리를 들은 <b>이웃 방의 무리</b>가 복도로 몰려온다. 입구를 등지지 마라.',
  '같은 세트 <b>2개·4개</b>를 맞추면 플레이 방식이 바뀌는 세트 효과가 열린다.',
  '<b>강화 +8</b>까지는 실패가 없다. +12부터는 파괴 위험 — 보호석을 챙겨라.',
  '보물방을 클리어하면 장비 상자가 열린다. 층을 다 밟을수록 별이 늘어난다.',
  '설정에서 <b>카메라</b>를 바꿔보라 — 탑다운·액션·시네마틱, 또는 상황에 맞춘 AUTO.',
  '보스는 체력 60%·30%에서 패턴이 바뀌고, 30%부터 <b>광폭화</b>한다.',
  '<b>질주</b> 중 적과 부딪히면 넉백. 무리 사이를 가르며 달려라.',
];

import { applyLook } from './game/look.js';
import { createFunnelLog, sessionOpenEvents } from './game/funnel-events.js';

class App {
  constructor() {
    this.canvas = $('gl');
    this.renderer = new Renderer(this.canvas);
    this.scene = this.renderer.scene;
    this.fx = new FX(this.scene, this.renderer.camera);
    this.fx.focus.bindBloom(this.renderer.bloom);
    this.renderer.heroEffectFocus = this.fx.focus;
    this.renderer.heroEffectTarget = () => this.mode === 'battle' && this.battle?.active ? this.battle.player : null;
    this.renderer.playerSilhouetteTarget = () => this.mode === 'battle' && !this.stageStarting && !this.contextLost
      && this.battle?.active ? this.battle.player : null;
    this.input = new Input();
    this.eco = new Economy();
    this.funnel = createFunnelLog();
    for (const [name, payload] of sessionOpenEvents({ hasStoredSave: this.eco.hasStoredSave, previousSession: this.funnel.latestSession(), now: Date.now() })) this.funnel.track(name, payload);
    this.ui = new UI(this);
    this.meta = new Meta(this);
    this.tutorial = new BattleTutorial(this);
    this.expedition = new ExpeditionEconomy(this.eco);
    this.expeditionUI = new ExpeditionUI(this);
    this.journey = new JourneyService(this);
    this.arsenal = new ArsenalService(this);
    this.models = {};
    this.wardrobe = new Wardrobe(this);
    this.mode = 'boot'; this.showcase = null; this.lobbyVisible = true; this.hubWalkMode = false;
    this.hubMovement = new HubMovement(CITADEL_HUB);
    this.citadel = { movement: this.hubMovement, clearInput: () => { this.hubControls?.clear(); this.lobbyCameraControls?.finish(); } };
    this.citadelShop = new CitadelShop(this);
    this.hubUI = new CitadelHubUI(this, { onInteract: spot => this.interactHub(spot) });
    this.commandUI = new CitadelCommand(this);
    this.hubControls = new HubControls({ isActive: () => this.canWalkHub(), joystick: this.hubUI.touchStick, knob: this.hubUI.touchKnob });
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', '성채와 던전 게임 화면');
    this.lobbyCameraControls = new LobbyCameraControls(this);
    this.cameraControls = new CameraControls(this);
    this.pwa = isNativeApp() ? null : setupPwa({ canApplyUpdate: () => this.mode === 'lobby' && !this.stageStarting && !this.party?.run });
    if (this.pwa) this.appModeView = new AppModeView(this);
    this.nativeApp = setupNativeApp(this);
    this.last = performance.now();
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.applySettings();
    this.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); this.contextLost = true; this.input.clear(); this.citadel.clearInput();
      this._graphicsGeneration = (this._graphicsGeneration || 0) + 1;
      this.renderer.playerSilhouette.contextLost();
      if (this.battle?.active) this.ui.pause(true);
      $('render-recovery').hidden = false;
    });
    this.canvas.addEventListener('webglcontextrestored', async () => {
      const generation = this._graphicsGeneration = (this._graphicsGeneration || 0) + 1;
      try {
        this.renderer.rebuildEnvironment(Object.values(this.models).map(gltf => gltf.scene)); this.renderer.resize(true);
        this.renderer.playerSilhouette.restoreTarget();
        const battle = this.battle, actor = battle?.active ? battle.player : null;
        if (actor && !actor.disposed) {
          const silhouette = this.renderer.playerSilhouette.preparation(this.renderer.r, actor, this.renderer.composer.writeBuffer);
          if (!silhouette) throw new Error('player silhouette recovery has no current model');
          const current = () => this._graphicsGeneration === generation && battle === this.battle
            && battle.active && battle.player === actor && silhouette.isCurrent();
          const prepared = await this.fx.prepare(this.renderer.r, this.models, this.renderer.composer.readBuffer,
            [], [], current, silhouette.targets, { reflectCompiledPrograms: true });
          if (this._graphicsGeneration !== generation) return;
          if (current()) {
            if (!prepared || !silhouette.complete()) throw new Error('player silhouette recovery canceled');
          }
        }
        if (this._graphicsGeneration !== generation) return;
        this.contextLost = false; this.last = performance.now(); $('render-recovery').hidden = true;
        if (this.battle?.active) this.ui.toast('화면이 복구됐습니다. 계속 버튼으로 전투를 재개하세요.');
      } catch (error) { console.error('Graphics recovery failed', error); }
    });
    $('render-reload').addEventListener('click', () => location.reload());
  }
  async boot() {
    const citadelReady = preloadCitadelHubAssets({ quality: this.renderer.quality });
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
    this.citadelAssets = await citadelReady;
    setP(0.85, '월드 구성 중…');
    this.arena = new Arena(this.scene, this.models.dungeon, this.renderer, this.models.tllDungeonLandmarks, this.models);
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
    if (audio.unavailable) this.ui.toast('이 브라우저에서는 소리를 사용할 수 없어 무음으로 시작합니다.');
    if (!this.companionAgent) this.companionAgent = createCompanion(this);
    this.party = new PartySession(this);
    this.oathShell = new OathShell(this);
    this.meta.refreshMenuBadge();
    this.experienceView = new ExperienceView(this);
    setTimeout(() => { bootEl.classList.remove('show', 'leaving'); }, 620);
    // Mutations already persist at their owning action. An idle PWA/tab must not overwrite a newer tab's save.
    const suspend = () => { this.input.clear(); this.citadel.clearInput(); if (this.mode === 'battle') this.ui.pause(true); };
    document.addEventListener('visibilitychange', () => { if (isNativeApp()) this.nativeApp?.setVisible(!document.hidden); else if (document.hidden) suspend(); if (!document.hidden) { this.last = performance.now(); audio.resume(); } });
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', () => { this.last = performance.now(); this.input.clear(); this.renderer.resize(); audio.resume(); });
    requestAnimationFrame((t) => this.loop(t));
  }
  applySettings() {
    const st = this.eco.s.settings; audio.setSfxOn(st.sfx); audio.setMusicOn(st.music); audio.haptics = st.haptics; if (!st.haptics) audio.vibe(0); audio.setVoiceOn(st.voice !== false);
    audio.setMix(this.arsenal.s.mix);
    const q = resolveQuality(st.quality, { cores: navigator.hardwareConcurrency || 4, memory: navigator.deviceMemory || 4,
      touch: window.matchMedia('(any-pointer: coarse)').matches || navigator.maxTouchPoints > 0 });
    this.renderer.setQuality(q); this.fx.setQuality(q);
    this.renderer.setCameraPreset(st.camera || 'auto');
    this.lobbyCameraControls?.sync();
    this.companionAgent?.syncQuality();
  }
  // ---------- 로비 ----------
  canWalkHub() {
    return this.hubWalkMode && this.mode === 'lobby' && this.meta.tab === 'home' && this.lobbyVisible && !this.stageStarting && !this.contextLost &&
      !this.expeditionUI?.opened && !this.companionAgent?.getSnapshot().open &&
      !document.querySelector('dialog[open], #modal.show');
  }
  interactHub(spot) {
    if (!this.canWalkHub()) return false;
    this.citadel.clearInput();
    return this.hubUI.interact(spot);
  }
  setHubWalkMode(enabled) {
    if (this.mode !== 'lobby' || this.stageStarting || this.contextLost || this.meta.tab !== 'home' ||
      this.expeditionUI?.opened || document.querySelector('dialog[open], #modal.show')) return false;
    this.input.clear(); this.citadel.clearInput();
    this.hubWalkMode = !!enabled;
    if (!this.hubWalkMode) {
      this.hubMovement.reset();
      if (this.showcase) this.showcase.root.rotation.y = Math.PI * .15;
    }
    this.syncHub();
    (this.hubWalkMode ? this.canvas : this.commandUI.explore).focus({ preventScroll: true });
    return true;
  }
  syncHub() {
    const surface = this.mode === 'lobby' && this.meta.tab === 'home' && this.lobbyVisible;
    const visible = surface && !this.stageStarting && !this.expeditionUI?.opened && !this.companionAgent?.getSnapshot().open && !document.querySelector('#modal.show');
    const exploring = surface && this.hubWalkMode;
    document.body.classList.toggle('citadel-hub-active', exploring);
    document.body.classList.toggle('citadel-command-active', surface && !this.hubWalkMode);
    this.renderer.lobbyNavigation = this.mode === 'lobby' && this.hubWalkMode;
    this.lobbyCameraControls?.updateActivity();
    if (this.hubUI.visible !== (visible && this.hubWalkMode)) this.hubUI.setVisible(visible && this.hubWalkMode);
    this.commandUI?.setVisible(visible && !this.hubWalkMode, visible && this.hubWalkMode);
    if (!this.canWalkHub()) this.citadel.clearInput();
    this.hubUI.update(this.hubMovement.nearest, { blocked: !this.canWalkHub() });
  }
  async showcaseHero(id, first = false) {
    const def = HEROES[id];
    this.companionAgent?.cancelDialogue();
    if (this.showcase) { this.hubMovement.detach(); disposeCharacter(this.showcase.root, this.showcase.mixer); this.showcase = null; }
    if (!this.arena.lobbyHall) this.arena.buildLobby();
    const { root, mixer, clips } = spawnCharacter(this.models[def.model]);
    root.rotation.y = Math.PI * 0.15;
    const look = applyLook(root, def, this.eco.heroEquipInsts(id));   // 로비 쇼케이스도 장착 장비대로
    const a = mixer.clipAction(clips['Idle']); a.play();
    // Establish the authored idle pose even when reduced motion stops later ticks.
    mixer.update(0);
    this.scene.add(root);
    this.showcase = { root, mixer, clips, def, look, t: 0, next: 4 + Math.random() * 3, auraT: 0 };
    this.hubMovement.attach(this.showcase);
    this.companionAgent?.syncLobbyContext();
    if (!first) { this.fx.pillar(root.position, def.color, { radius: 1.2, height: 8, life: 0.8 }); this.fx.burst(root.position.clone().setY(1), def.color, { n: 40, speed: 6, size: 0.4, up: 1 }); audio.magic({ vol: 0.3, base: 440, notes: [0, 4, 7, 12] }); }
    this.renderer.rig.mode = 'lobby'; this.renderer.rig.target.copy(root.position);
    this.renderer.lobbyNavigation = this.hubWalkMode;
  }
  setLobbyVisible(v) {
    this.lobbyVisible = v;
    if (!v) {
      this.hubWalkMode = false;
      this.input.clear(); this.citadel.clearInput();
      this.hubMovement.reset();
      if (this.showcase) this.showcase.root.rotation.y = Math.PI * .15;
    }
  }
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
    this.citadel.clearInput(); this.hubUI.close(); this.citadelShop.close(); this.hubMovement.reset(); this.hubWalkMode = false;
    this._bossAttemptTracked = false;
    this.tutorial.end();
    this.ui.hideResult(); this.mode = 'lobby';
    if (first) setTimeout(() => audio.voice('welcome', { vol: 0.9 }), 900);
    this.ui.show($('meta'), true);
    this.showcaseHero(this.eco.s.selected, true);
    this.renderer.desat = 0; this.renderer.rig.mode = 'lobby';
    audio.playMusic(musicForScene({ scene: 'lobby' }), MUSIC_MIX);
    this.meta.openTab('home'); this.meta.refreshTop();
    this.syncHub();
    if (first) setTimeout(() => this.meta.autoPopups(), 600);
  }
  resetProgress() {
    if (this.stageStarting) return false;
    const companionReset = this.companionAgent?.reset() ?? true;
    const gameReset = this.eco.reset();
    if (gameReset) {
      this.funnel.clear();
      this.funnel.track('first_run');
      this.funnel.track('session_start');
    }
    this.toLobby();
    return companionReset && gameReset;
  }
  async startStage(stage) {
    if (this.party?.party?.status === 'lobby') { this.party.view.open(); this.party.view.message('파티에서 준비를 마치고 함께 출격하세요.'); return false; }
    if (stage?.expedition) return this.startExpedition(stage.expedition.kind, stage.expedition.id, { rift: !!stage.riftId, depth: stage.expedition.depth, conquestId: stage.expedition.conquestId });
    if (this.stageStarting || (this.mode === 'battle' && this.battle.active)) return false;
    if (!stage || !this.eco.isUnlocked(stage.ch, stage.st)) { this.ui.toast('이전 스테이지를 먼저 클리어하세요.', 'red'); return false; }
    // 미리보기에서 넘긴 객체 대신 검증된 현재 스테이지 정의로 출격한다.
      stage = stageDef(stage.ch, stage.st);
      const difficulty = this.eco.difficultyFor(stage.ch, stage.st, stage.difficultyId || this.eco.s.progress.difficulty || 'story');
      stage = applyDifficulty(stage, difficulty);
    this.stageStarting = true;
    this.citadel.clearInput(); this.syncHub();
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
      if (this.showcase) { this.hubMovement.detach(); disposeCharacter(this.showcase.root, this.showcase.mixer); this.showcase = null; }
      this.mode = 'battle';
      this._bossAttemptTracked = false;
      const id = this.eco.s.selected;
      await this.battle.start(stage, id, this.eco.hero(id), this.eco.heroEquipBonus(id));
      this.battle.player.auto = this.journey.s.autoBattle; $('btn-auto').classList.toggle('on', this.battle.player.auto);
      this.tutorial.begin(stage);
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
    if (this.party?.party?.status === 'lobby') { this.party.view.open(); return false; }
    if (this.expeditionUI.result?.saveError) { this.ui.toast('전리품 정산을 먼저 저장해 주세요.', 'red'); return false; }
    if (this.stageStarting || (this.mode === 'battle' && this.battle.active)) return false;
    if (this.expeditionRefundPending) {
      const refund = this.expedition.abandon(this.expeditionTicket);
      if (!refund.ok) { this.ui.toast('이전 출격의 에너지 복구를 저장하지 못했습니다. 저장 공간을 확인해 주세요.', 'red'); return false; }
      this.expeditionTicket = null; this.expeditionRefundPending = false;
    }
    const begin = this.expedition.begin(kind, id, options);
    if (!begin.ok) { this.ui.toast(begin.error, 'red'); return false; }
    this.expeditionTicket = begin.ticket;
    this.stageStarting = true;
    this.citadel.clearInput(); this.syncHub();
    try {
      const stage = applyRiftStage(buildExpeditionStage(kind, id, this.eco, { depth: begin.ticket.depth, conquestId: begin.ticket.conquestId, frontier: begin.ticket.frontier }), begin.ticket);
      this.expeditionUI.result = null; this.expeditionUI.close();
      this.journeyView?.close();
      this.ui.hideResult(); this.ui.show($('meta'), false); this.ui.closeModal();
      $('stage-loading').hidden = false;
      if (this.showcase) { this.hubMovement.detach(); disposeCharacter(this.showcase.root, this.showcase.mixer); this.showcase = null; }
      this.mode = 'battle';
      this._bossAttemptTracked = false;
      const heroId = this.eco.s.selected;
      await this.battle.start(stage, heroId, this.eco.hero(heroId), this.eco.heroEquipBonus(heroId));
      this.battle.player.auto = this.journey.s.autoBattle; $('btn-auto').classList.toggle('on', this.battle.player.auto);
      this.expeditionUI.refreshPotions();
      if (kind === 'dungeon') await playExpeditionIntro(this, id);
      const resumedMusic = musicAfterIntro({ mode: this.mode, active: this.battle.active, stage: this.battle.stage, expectedStage: stage, boss: !!this.battle.boss });
      if (resumedMusic) audio.playMusic(resumedMusic, MUSIC_MIX);
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
    if (this.testPause || this.stageStarting || this.contextLost || document.hidden) return;
    this.step(realDt);
  }
  /** 한 프레임 진행 (테스트 시 고정 dt로 호출 가능) */
  step(realDt, render = true) {
    this.nativeApp?.sync();
    const battle=this.battle, combat=this.mode==='battle'&&battle?.active;
    audio.updateCombatMix(realDt,{active:combat,paused:!!(battle?.paused||this.expeditionUI?.opened),boss:!!(combat&&battle.enemies.some(e=>e.alive&&e.isBoss)),intensity:combat?Math.min(1,(battle.combo||0)/30):0});
    this.arsenalView?.update();
    this.experienceView?.update();
    this.syncHub();
    if (this.expeditionUI?.opened) return;
    if (this.mode === 'battle') {
      this.battle.update(realDt);
      if (this.battle.active && this.battle.boss?.alive && !this._bossAttemptTracked) {
        this._bossAttemptTracked = true;
        this.eco.recordJourneyAction('bossAttempts'); this.eco.emit();
      }
      if (!this.battle.active) this._bossAttemptTracked = false;
      this.tutorial.update();
      this.party?.update(realDt);
      const dt = realDt * this.battle.timeCtl.scale;
      this.fx.update(dt);
      if (this.battle.player) { this._auto = this.battle.player.auto; }
      // 킬 카운트 → 임무
      this.renderer.update(dt, realDt); if (render) this.renderer.render();
    } else if (this.mode === 'lobby') {
      // 입장 준비 중에는 성채 장면을 정지하고 네이티브 UI와 음악을 유지한다.
      if (this.hubUI?.opened && this.hubUI.dialog?.open) return;
      if (this.showcase) {
        const s = this.showcase;
        const move = this.hubControls.update();
        const camera = this.renderer.camera;
        const yaw = Math.atan2(-camera.matrixWorld.elements[2], camera.matrixWorld.elements[0]);
        this.hubMovement.update(realDt, move, yaw);
        if (this.hubControls.consumeInteract()) this.interactHub(this.hubMovement.nearest);
        // Walking animation remains functional when ambient motion is reduced.
        if (!this.reducedMotion.matches || this.hubMovement.moving) s.mixer.update(realDt);
        this.renderer.rig.target.copy(s.root.position);
        this.hubUI.update(this.hubMovement.nearest, { blocked: !this.canWalkHub() });
        this.arena.lobbyHall?.userData.update(realDt, { nearestId: this.hubMovement.nearest?.id, playerPosition: s.root.position, reducedMotion: this.reducedMotion.matches });
        if (s.look?.aura && !this.reducedMotion.matches) { s.auraT -= realDt; if (s.auraT <= 0) { s.auraT = 0.2; this.fx.aura(s.root.position, s.look.aura, 1); } }
      }
      this.arena.update(realDt, this.fx, this.showcase ? this.showcase.root.position : null); this.fx.update(realDt);
      this.renderer.update(realDt, realDt);
      if (render && (this.lobbyVisible || this.meta.tab === 'home')) this.renderer.render();
    }
  }
}

function bootFailure(error) {
  console.error(error);
  $('boot-msg').textContent = '게임 화면을 준비하지 못했습니다. 인터넷 연결과 브라우저의 WebGL 2 지원을 확인해 주세요.';
  const retry = $('boot-start'); retry.disabled = false; retry.classList.remove('hidden'); retry.textContent = '다시 시도';
  retry.onclick = () => location.reload();
}
try {
  const app = new App();
  window.app = app;
  window.__EN = ENEMIES; window.__stageDef = stageDef; window.__THREE = THREE;
  app.boot().catch(bootFailure);
} catch (error) { bootFailure(error); }
