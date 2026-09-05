import './style.css';
import * as THREE from 'three';
import { Renderer } from './engine/renderer.js';
import { FX } from './engine/fx.js';
import { Input } from './engine/input.js';
import { audio } from './engine/audio.js';
import { preloadAll, preloadVfx, loadModel, MODEL_LIST, spawnCharacter } from './engine/assets.js';
import { Economy } from './game/economy.js';
import { Battle } from './game/battle.js';
import { Arena } from './game/arena.js';
import { HEROES } from './data/heroes.js';
import { ENEMIES, stageDef } from './data/stages.js';
import { UI, $ } from './ui/ui.js';
import { Meta } from './ui/meta.js';
import { createCompanion } from './companion/bootstrap.ts';
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
    this.models = {};
    this.mode = 'boot'; this.showcase = null; this.lobbyVisible = true;
    this.last = performance.now();
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
    setP(0.85, '월드 구성 중…');
    this.arena = new Arena(this.scene, this.models.dungeon, this.renderer);
    this.battle = new Battle(this);
    await this.showcaseHero(this.eco.s.selected, true);
    setP(1, '준비 완료');
    // 셰이더 프리컴파일 (첫 프레임 끊김 방지)
    this.renderer.r.compile(this.scene, this.renderer.camera);
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
    let q = st.quality;
    if (!q || q === 'auto') { const cores = navigator.hardwareConcurrency || 4; const mem = navigator.deviceMemory || 4; q = (cores <= 4 || mem <= 3) ? 'mid' : 'high'; st.quality = q; }
    this.renderer.setQuality(q); this.fx.setQuality(q);
    this.renderer.setCameraPreset(st.camera || 'auto');
    this.companionAgent?.syncQuality();
  }
  // ---------- 로비 ----------
  async showcaseHero(id, first = false) {
    const def = HEROES[id];
    if (this.showcase) { this.scene.remove(this.showcase.root); this.showcase = null; }
    if (first || this.mode === 'lobby') this.arena.buildLobby();
    const { root, mixer, clips } = spawnCharacter(this.models[def.model]);
    root.rotation.y = Math.PI * 0.15;
    const look = applyLook(root, def, this.eco.heroEquipInsts(id));   // 로비 쇼케이스도 장착 장비대로
    const a = mixer.clipAction(clips['Idle']); a.play();
    this.scene.add(root);
    this.showcase = { root, mixer, clips, def, look, t: 0, next: 4 + Math.random() * 3, auraT: 0 };
    if (!first) { this.fx.pillar(new THREE.Vector3(0, 0, 0), def.color, { radius: 1.2, height: 8, life: 0.8 }); this.fx.burst(new THREE.Vector3(0, 1, 0), def.color, { n: 40, speed: 6, size: 0.4, up: 1 }); audio.magic({ vol: 0.3, base: 440, notes: [0, 4, 7, 12] }); }
    this.renderer.rig.mode = 'lobby'; this.renderer.rig.target.set(0, 0, 0);
  }
  setLobbyVisible(v) { this.lobbyVisible = v; }
  toLobby(first = false) {
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
  async startStage(stage) {
    if (!this.eco.spendEnergy(stage.energy)) { audio.play('ui_error'); const ok = await this.ui.confirm('에너지 부족', `에너지 ${stage.energy}가 필요합니다. 보석으로 충전할까요?`, { ok: '충전' }); if (ok) this.meta.openTab('shop', 'energy'); return; }
    this.ui.hideResult(); this.ui.show($('meta'), false); this.ui.closeModal();
    if (this.showcase) { this.scene.remove(this.showcase.root); this.showcase = null; }
    this.mode = 'battle';
    const id = this.eco.s.selected;
    await this.battle.start(stage, id, this.eco.hero(id), this.eco.heroEquipBonus(id));
    this.battle.player.auto = this._auto || false; $('btn-auto').classList.toggle('on', !!this._auto);
  }
  // ---------- 루프 ----------
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    let realDt = Math.min(0.05, (t - this.last) / 1000); this.last = t;
    if (this.testPause) return;
    this.step(realDt);
  }
  /** 한 프레임 진행 (테스트 시 고정 dt로 호출 가능) */
  step(realDt, render = true) {
    if (this.mode === 'battle') {
      this.battle.update(realDt);
      const dt = realDt * this.battle.timeCtl.scale;
      this.fx.update(dt);
      if (this.battle.player) { this._auto = this.battle.player.auto; }
      // 킬 카운트 → 임무
      this.renderer.update(dt, realDt); if (render) this.renderer.render();
    } else if (this.mode === 'lobby') {
      if (this.showcase) {
        const s = this.showcase; s.mixer.update(realDt); s.t += realDt;
        if (s.t > s.next) { s.t = 0; s.next = 5 + Math.random() * 4; const pool = ['Cheer', 'Interact', 'Idle']; const nm = pool[Math.floor(Math.random() * pool.length)]; const a = s.mixer.clipAction(s.clips[nm]); if (nm !== 'Idle') { a.reset().setLoop(THREE.LoopOnce).play(); const idle = s.mixer.clipAction(s.clips['Idle']); a.crossFadeFrom(idle, 0.2); setTimeout(() => { idle.reset().play(); idle.crossFadeFrom(a, 0.3); }, s.clips[nm].duration * 1000 - 300); } }
        if (Math.random() < realDt * 3) this.fx.embers(new THREE.Vector3(0, 0.2, 0), s.def.color, { n: 1, radius: 1.2, life: 1.5, size: 0.25, rise: 1.2 });
        if (s.look?.aura) { s.auraT -= realDt; if (s.auraT <= 0) { s.auraT = 0.2; this.fx.aura(s.root.position, s.look.aura, 1); } }
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
