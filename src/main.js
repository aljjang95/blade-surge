import './style.css';
import * as THREE from 'three';
import { Renderer } from './engine/renderer.js';
import { FrameGovernor, canRenderFrame } from './engine/frame-governor.js';
import { LobbyCameraControls, releaseBlockedLobbyInput } from './engine/lobby-camera.js';
import { createLobbyPose, lobbyPoseWeight } from './engine/lobby-pose.js';
import { createCombatPose } from './engine/combat-pose.js';
import { bindTouchActivation } from './engine/touch-activation.js';
import { CameraControls } from './engine/camera-control.js';
import { setupPwa } from './platform/pwa.js';
import { AppModeView } from './platform/app-mode.js';
import { mobileScreen } from './platform/landscape-screen.js';
import { resolveQuality } from './platform/mobile-display.js';
import { isNativeApp, setupNativeApp } from './platform/native-app.js';
import { STORE_CHANNEL } from './platform/store-channel.js';
import { setupStoreAccess } from './ui/store-access.js';
import { FX } from './engine/fx.js';
import { Input } from './engine/input.js';
import { audio } from './engine/audio.js';
import { musicForScene, musicAfterIntro, MUSIC_MIX } from './data/music.js';
import { preloadAll, preloadVfx, loadModel, MODEL_LIST, spawnCharacter, disposeCharacter } from './engine/assets.js';
import { MONSTER_ROSTER } from './data/monster-roster.js';
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
import { setupCommunity } from './social/integration.js';
import './ui/mobile-combat.css';
import './ui/progression.css';
import './ui/illustrated.css';
import './ui/oath-visual.css';
import { OathShell } from './ui/oath-shell.js';
import { ExperienceView } from './ui/experience-view.js';
import { BattleTutorial } from './ui/tutorial.js';
import { applyDifficulty } from './game/difficulty.js';
import { CITADEL_HUB } from './data/citadel-hub.js';
import { activeCampaignTownChapter, setActiveCampaignTownChapter } from './data/campaign-towns.js';
import { preloadCitadelHubAssets } from './game/citadel-hub-scene.js';
import { HubMovement } from './game/hub-movement.js';
import { HubControls } from './engine/hub-controls.js';
import { CitadelHubUI } from './ui/citadel-hub.js';
import { CampaignTownUI } from './ui/campaign-town-ui.js';
import { CitadelShop } from './ui/citadel-shop.js';
import { CitadelCommand } from './ui/citadel-command.js';
import './ui/citadel-integration.css';
import './ui/garden-ui.css';
import './ui/departure-journal.css';
import './ui/mobile-menu.css';
import './ui/maple-window.css';
import './ui/lobby-clarity.css';
import './ui/campaign-town.css';
import './ui/campaign-map.css';
import { MapleUI } from './ui/maple-ui.js';
import { buildIdentity, classifyStartupFailure, onMediaQueryChange, startupFailureDetails, storageAvailability } from './platform/startup-compat.js';
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

import { applyLook, LOOKS } from './game/look.js';
import { playerSkillAimShape } from './game/skill-aim/shapes.js';
import { createFunnelLog, sessionOpenEvents } from './game/funnel-events.js';

// 시작 실패를 단계별로 분류하기 위한 현재 단계. App 생성자가 실패하면 인스턴스가 없으므로 모듈에 둔다.
const startup = { stage: 'renderer', failed: false };

class App {
  constructor() {
    startup.stage = 'renderer';
    this.canvas = $('gl');
    this.renderer = new Renderer(this.canvas);
    this.scene = this.renderer.scene;
    startup.stage = 'effects';
    this.fx = new FX(this.scene, this.renderer.camera);
    this.fx.focus.bindBloom(this.renderer.bloom);
    this.renderer.heroEffectFocus = this.fx.focus;
    this.renderer.heroEffectTarget = () => this.mode === 'battle' && this.battle?.active ? this.battle.player : null;
    this.renderer.playerSilhouetteTarget = () => this.mode === 'battle' && !this.stageStarting && !this.contextLost
      && this.battle?.active ? this.battle.player : null;
    startup.stage = 'input';
    this.input = new Input();
    startup.stage = 'save';
    this.eco = new Economy();
    this.funnel = createFunnelLog();
    for (const [name, payload] of sessionOpenEvents({ hasStoredSave: this.eco.hasStoredSave, previousSession: this.funnel.latestSession(), now: Date.now() })) this.funnel.track(name, payload);
    startup.stage = 'interface';
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
    // 조이스틱·시점 손가락을 누른 채, 또는 멀티터치 직후 탭하는 전투 핵심 버튼은 실제 터치 탭으로 동작해야 한다.
    for (const id of ['btn-pause', 'btn-resume', 'btn-auto', 'btn-map', 'btn-boss-shortcut']) bindTouchActivation(document.getElementById(id));
    startup.stage = 'platform';
    this.pwa = isNativeApp() || STORE_CHANNEL !== 'web' ? null : setupPwa({ canApplyUpdate: () => this.mode === 'lobby' && !this.stageStarting && !this.party?.run });
    if (this.pwa) this.appModeView = new AppModeView(this);
    // 스토어 앱은 이미 전체 화면·가로 고정이라 브라우저용 전체화면 전환 버튼을 쓰지 않는다(AppModeView가 없으면 눌러도 동작하지 않는다).
    else document.getElementById('btn-rotate-fullscreen')?.setAttribute('hidden', '');
    this.nativeApp = setupNativeApp(this);
    startup.stage = 'settings';
    this.last = performance.now();
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.applySettings();
    // 운영체제의 동작 줄이기 설정이 실행 중에 바뀌면 흔들림·후처리 왜곡 기본값도 따라간다.
    onMediaQueryChange(this.reducedMotion, () => this.applySettings());
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
    startup.stage = 'assets';
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
    for (const [legacy, roster] of Object.entries(MONSTER_ROSTER)) {
      const source = this.models[roster.asset] || this.models[roster.fallback];
      if (source) this.models[legacy] = source;
    }
    for (const gltf of Object.values(this.models)) gltf.scene.traverse((o) => {
      if (o.isMesh && o.material?.userData.tllAuthored) {
        o.material.envMap = this.renderer.characterEnvironment.texture; o.material.envMapIntensity = .7;
      }
    });
    this.citadelAssets = await citadelReady;
    startup.stage = 'world';
    setP(0.85, '월드 구성 중…');
    this.arena = new Arena(this.scene, this.models.dungeon, this.renderer, this.models.tllDungeonLandmarks, this.models);
    this.battle = new Battle(this);
    this.journeyView = new JourneyView(this);
    this.arsenalView = new ArsenalView(this);
    await this.showcaseHero(this.eco.s.selected, true);
    startup.stage = 'shaders';
    setP(0.95, '게임 화면 준비 중…');
    // 셰이더 프리컴파일 (첫 프레임 끊김 방지)
    await this.fx.prepare(this.renderer.r, this.models, this.renderer.composer.readBuffer);
    startup.stage = 'start';
    setP(1, '준비 완료');
    const start = $('boot-start'); start.classList.remove('hidden'); msg.textContent = '';
    this.appModeView?.render();
    await new Promise((res) => { const go = async () => {
      const screenReady = mobileScreen() ? this.appModeView?.startLandscape() : null;
      start.disabled = true; start.textContent = '사운드 준비 중…';
      await audio.init(); audio.resume(); await screenReady; res();
    }; start.addEventListener('click', go, { once: true }); });
    startup.stage = 'lobby';
    clearInterval(this._tipTimer);
    const bootEl = $('boot'); bootEl.classList.add('leaving');
    this.toLobby(true);
    if (audio.unavailable) this.ui.toast('이 브라우저에서는 소리를 사용할 수 없어 무음으로 시작합니다.');
    if (!this.companionAgent) this.companionAgent = createCompanion(this);
    this.party = new PartySession(this);
    this.oathShell = new OathShell(this);
    this.townChip = new CampaignTownUI(this); this.townChip.sync('home'); this.townChip.announcePending();
    this.mapleUI = new MapleUI(this);
    this.store = setupStoreAccess(this);
    this.meta.refreshMenuBadge();
    this.experienceView = new ExperienceView(this);
    setupCommunity(this);
    setTimeout(() => { bootEl.classList.remove('show', 'leaving'); }, 620);
    // Mutations already persist at their owning action. An idle PWA/tab must not overwrite a newer tab's save.
    const suspend = () => { this.input.clear(); this.citadel.clearInput(); if (this.mode === 'battle') this.ui.pause(true); };
    document.addEventListener('visibilitychange', () => { if (isNativeApp()) this.nativeApp?.setVisible(!document.hidden); else if (document.hidden) suspend(); if (!document.hidden) { this.last = performance.now(); audio.resume(); } });
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', () => { this.last = performance.now(); this.input.clear(); this.renderer.resize(); audio.resume(); });
    requestAnimationFrame((t) => this.loop(t));
  }
  /** 화면 흔들림: 직접 고른 값이 우선이고, 미선택이면 동작 줄이기 선호일 때만 기본 OFF 다. */
  screenShakeOn() {
    const chosen = this.eco.s.settings.screenShake;
    return typeof chosen === 'boolean' ? chosen : !this.reducedMotion?.matches;
  }
  applySettings() {
    if (!this.frameGovernor) {
      let storage = null;
      try { storage = window.localStorage; } catch { /* 차단된 저장소에서는 세션 안에서만 조절한다. */ }
      this.frameGovernor = new FrameGovernor({ storage });
      this.frameGovernor.reset(performance.now());
      window.__perfGovernor = this.frameGovernor;
      const resetGovernor = () => this.frameGovernor.suspend(performance.now());
      document.addEventListener('visibilitychange', resetGovernor);
      window.addEventListener('pagehide', resetGovernor);
      window.addEventListener('pageshow', resetGovernor);
    }
    this.renderer.setThermalTier(this.frameGovernor.tier);
    const st = this.eco.s.settings; audio.setSfxOn(st.sfx); audio.setMusicOn(st.music); audio.haptics = st.haptics; if (!st.haptics) audio.vibe(0); audio.setVoiceOn(st.voice !== false);
    audio.setMix(this.arsenal.s.mix);
    const q = resolveQuality(st.quality, { cores: navigator.hardwareConcurrency || 4, memory: navigator.deviceMemory || 4,
      touch: window.matchMedia('(any-pointer: coarse)').matches || navigator.maxTouchPoints > 0 });
    this.renderer.setQuality(q); this.fx.setQuality(q);
    this.renderer.setCameraPreset(st.camera || 'auto');
    this.renderer.postFxEnabled = !this.reducedMotion?.matches;
    this.lobbyCameraControls?.sync();
    this.companionAgent?.syncQuality();
  }
  // ---------- 로비 ----------
  /** 로비 빈 화면 시점 회전·핀치를 받을 수 있는 상태. 마을 걷기 모드가 아니어도 기본 선택 로비에서 허용한다. */
  canOrbitLobby() {
    return this.mode === 'lobby' && this.meta.tab === 'home' && this.lobbyVisible && !this.stageStarting && !this.contextLost &&
      !this.expeditionUI?.opened && !this.companionAgent?.getSnapshot().open &&
      !document.querySelector('dialog[open], #modal.show');
  }
  canWalkHub() {
    return !!this.hubWalkMode && this.canOrbitLobby();
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
    releaseBlockedLobbyInput(this);
    this.hubUI.update(this.hubMovement.nearest, { blocked: !this.canWalkHub() });
  }
  /**
   * 저장된 캠페인 마을 선택을 로비 장면에 반영한다. 마을이 바뀌었고 로비 장면이 이미 있으면 다시 짓는다
   * (전투에서 돌아올 때는 장면이 비어 있어 showcaseHero 가 새로 짓는다). 바뀌었으면 true.
   */
  syncCampaignTown(rebuild = true) {
    const before = activeCampaignTownChapter();
    const next = setActiveCampaignTownChapter(this.eco.campaignTownState().current);
    if (next === before) return false;
    if (rebuild && this.arena.lobbyHall) {
      this.arena.buildLobby(); this.hubMovement.reset(); this.syncHub(); this.townUI?.renderPlace();
      if (this.mode === 'lobby') audio.playMusic(musicForScene({ scene: 'lobby' }), MUSIC_MIX);
    }
    return true;
  }
  async showcaseHero(id, first = false) {
    const def = HEROES[id];
    this.companionAgent?.cancelDialogue();
    if (this.showcase) { this.hubMovement.detach(); this.showcase.combatPose?.dispose(); this.showcase.pose?.dispose(); disposeCharacter(this.showcase.root, this.showcase.mixer); this.showcase = null; }
    this.syncCampaignTown(false);
    if (!this.arena.lobbyHall) this.arena.buildLobby();
    const { root, mixer, clips } = spawnCharacter(this.models[def.model]);
    root.rotation.y = Math.PI * 0.15;
    const look = applyLook(root, def, this.eco.heroEquipInsts(id), { avatarId: this.eco.equippedAvatar(id) });   // 로비 쇼케이스도 장착 장비대로
    const a = mixer.clipAction(clips['Idle']); a.play();
    // 감소된 움직임에서도 교정된 정지 자세를 첫 프레임부터 적용한다.
    mixer.update(0);
    const pose = createLobbyPose(root, id);
    pose?.apply();
    const combatPose = createCombatPose(root, id, mixer, clips);
    this.scene.add(root);
    this.showcase = { root, mixer, clips, def, look, pose, combatPose, idleAction: a, t: 0, next: 4 + Math.random() * 3, auraT: 0 };
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
    // 첫 전투 결과를 본 뒤 로비로 돌아오면 미뤄 둔 출석 팝업을 한 번 띄운다.
    const fromCombatResult = this.mode === 'battle' && !!this.battle?.result;
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
    this.townChip?.announcePending();
    if (fromCombatResult) this.meta.combatResultSeen = true;
    if (first || (fromCombatResult && this.meta.dailyDeferred)) setTimeout(() => this.meta.autoPopups(), 600);
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
    if (this.store?.busy) return false;
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
      if (this.showcase) { this.hubMovement.detach(); this.showcase.combatPose?.dispose(); this.showcase.pose?.dispose(); disposeCharacter(this.showcase.root, this.showcase.mixer); this.showcase = null; }
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
    if (this.store?.busy) return false;
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
      if (this.showcase) { this.hubMovement.detach(); this.showcase.combatPose?.dispose(); this.showcase.pose?.dispose(); disposeCharacter(this.showcase.root, this.showcase.mixer); this.showcase = null; }
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
    const governor = this.frameGovernor;
    const suspended = !!(this.testPause || this.stageStarting || this.contextLost || document.hidden);
    const render = !suspended && canRenderFrame(this, document);
    const realDt = governor.advance(t, this.mode, render, suspended);
    if (suspended) this.last = t;
    if (!realDt) return;
    this.last = t;
    this.renderer.setThermalTier(governor.tier);
    const count = this.renderer.renderCount, started = performance.now();
    // 기존 장시간 정지의 dt 상한은 유지하며, 평소 간격 제어 시간은 시뮬레이션에 모두 넘긴다.
    this.step(Math.min(0.05, realDt), render);
    if (this.renderer.renderCount !== count) governor.recordFrame(t, performance.now() - started);
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
      this.fx.update(dt, !!this.battle.paused);
      if (this.battle.player) { this._auto = this.battle.player.auto; }
      // 킬 카운트 → 임무
      this.renderer.update(dt, realDt, !!this.battle.paused); if (render && canRenderFrame(this, document)) this.renderer.render();
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
        s.combatPose?.restore();
        s.pose?.restore();
        if (!this.reducedMotion.matches || this.hubMovement.moving) s.mixer.update(realDt);
        // 교정은 Idle 값이므로 Idle 가중치만큼만 얹는다(걷기·다른 클립에서는 줄이거나 끈다).
        s.pose?.apply(lobbyPoseWeight(s.idleAction));
        // 걷기·감정 표현 같은 마을 클립의 무기·팔 관통은 별도 가산 층이 보정한다(Idle 교정과 겹치지 않는 클립만 대상).
        s.combatPose?.apply(realDt);
        this.renderer.rig.target.copy(s.root.position);
        this.hubUI.update(this.hubMovement.nearest, { blocked: !this.canWalkHub() });
        this.arena.lobbyHall?.userData.update(realDt, { nearestId: this.hubMovement.nearest?.id, playerPosition: s.root.position, reducedMotion: this.reducedMotion.matches });
        if (s.look?.aura && !this.reducedMotion.matches) { s.auraT -= realDt; if (s.auraT <= 0) { s.auraT = 0.2; this.fx.aura(s.root.position, s.look.aura, 1); } }
      }
      this.arena.update(realDt, this.fx, this.showcase ? this.showcase.root.position : null); this.fx.update(realDt);
      this.renderer.update(realDt, realDt);
      if (render && canRenderFrame(this, document)) this.renderer.render();
    }
  }
}

const BUILD_ID = buildIdentity(import.meta.url);

/** 시작 실패 안내. 첫 실패만 표시하고, 다시 시도는 사용자가 누를 때 한 번만 새로고침한다(자동 새로고침 없음). */
function bootFailure(error, app = null) {
  if (startup.failed) return;
  startup.failed = true;
  const failure = classifyStartupFailure(error, startup.stage);
  console.error('Blade Surge startup failed', failure.code, error);
  try { showStartupFailure(failure, app); } catch (uiError) { console.error('startup failure view failed', uiError); }
}
function showStartupFailure(failure, app) {
  if (app?._tipTimer) clearInterval(app._tipTimer);
  const boot = $('boot'); boot.classList.remove('leaving'); boot.classList.add('show');
  $('boot-msg').textContent = failure.title;
  // 시작 버튼은 플랫폼 화면 갱신이 문구를 덮어쓸 수 있어 실패 안내에 쓰지 않는다.
  const start = $('boot-start'); start.disabled = true; start.classList.add('hidden');
  $('boot-failure-message').textContent = failure.message;
  $('boot-failure-code').textContent = failure.code;
  const detail = $('boot-failure-detail');
  detail.textContent = startupFailureDetails(failure, { build: BUILD_ID, webgl2Api: typeof WebGL2RenderingContext === 'function',
    storage: storageAvailability(window), at: new Date().toISOString() });
  const retry = $('boot-retry');
  retry.onclick = () => { retry.disabled = true; retry.textContent = '다시 여는 중…'; location.reload(); };
  const copy = $('boot-failure-copy');
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(detail.textContent); copy.textContent = '복사했습니다'; }
    catch {
      // 클립보드 권한이 없으면 내용을 선택해 직접 복사할 수 있게 한다.
      const range = document.createRange(); range.selectNodeContents(detail);
      const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      copy.textContent = '선택된 정보를 직접 복사해 주세요';
    }
  };
  $('boot-failure').hidden = false;
  retry.focus({ preventScroll: true });
}
let app = null;
try {
  app = new App();
  window.app = app;
  window.__EN = ENEMIES; window.__stageDef = stageDef; window.__THREE = THREE;
  // 조준 표시=판정 QA(tools/aim-hitbox-truth-qa.mjs)가 정식 빌드에서도 표시 모양을 읽도록 읽기 전용 함수만 노출한다.
  window.__skillAimShape = playerSkillAimShape;
  // 전투 자세 QA(tools/combat-pose-qa.mjs)가 정식 빌드에서도 무기·방어구 노드 이름을 읽도록 읽기 전용 표만 노출한다.
  window.__LOOKS = LOOKS;
} catch (error) { bootFailure(error); }
if (app) app.boot().catch(error => bootFailure(error, app));
