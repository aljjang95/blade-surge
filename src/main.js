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
import { UI, $ } from './ui/ui.js';
import { Meta } from './ui/meta.js';

const ALL_WEAPON_NODES = ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '1H_Sword', '2H_Sword', 'Spellbook', 'Spellbook_open', '1H_Wand', '2H_Staff', 'Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable', '1H_Axe_Offhand', 'Barbarian_Round_Shield', '1H_Axe', '2H_Axe', 'Mug'];

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
    const fill = $('boot-fill'), msg = $('boot-msg');
    const setP = (p, m) => { fill.style.width = (p * 100) + '%'; if (m) msg.textContent = m; };
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
    $('boot').classList.remove('show');
    this.toLobby(true);
    document.addEventListener('visibilitychange', () => { if (document.hidden) { if (this.mode === 'battle') this.ui.pause(true); } else audio.resume(); });
    requestAnimationFrame((t) => this.loop(t));
  }
  applySettings() {
    const st = this.eco.s.settings; audio.setSfxOn(st.sfx); audio.setMusicOn(st.music); audio.haptics = st.haptics;
    let q = st.quality;
    if (!q || q === 'auto') { const cores = navigator.hardwareConcurrency || 4; const mem = navigator.deviceMemory || 4; q = (cores <= 4 || mem <= 3) ? 'mid' : 'high'; st.quality = q; }
    this.renderer.setQuality(q); this.fx.setQuality(q);
  }
  // ---------- 로비 ----------
  async showcaseHero(id, first = false) {
    const def = HEROES[id];
    if (this.showcase) { this.scene.remove(this.showcase.root); this.showcase = null; }
    if (first || this.mode === 'lobby') this.arena.build('lobby', { lobby: true });
    const { root, mixer, clips } = spawnCharacter(this.models[def.model]);
    root.rotation.y = Math.PI * 0.15;
    for (const n of ALL_WEAPON_NODES) { const o = root.getObjectByName(n); if (o) o.visible = def.show.includes(n); }
    const a = mixer.clipAction(clips['Idle']); a.play();
    this.scene.add(root);
    this.showcase = { root, mixer, clips, def, t: 0, next: 4 + Math.random() * 3 };
    if (!first) { this.fx.pillar(new THREE.Vector3(0, 0, 0), def.color, { radius: 1.2, height: 8, life: 0.8 }); this.fx.burst(new THREE.Vector3(0, 1, 0), def.color, { n: 40, speed: 6, size: 0.4, up: 1 }); audio.magic({ vol: 0.3, base: 440, notes: [0, 4, 7, 12] }); }
    this.renderer.rig.mode = 'lobby'; this.renderer.rig.target.set(0, 0, 0);
  }
  setLobbyVisible(v) { this.lobbyVisible = v; }
  toLobby(first = false) {
    if (this.mode === 'battle') { this.battle.stop(); }
    this.ui.hideResult(); this.mode = 'lobby';
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
      }
      this.arena.update(realDt, this.fx); this.fx.update(realDt);
      this.renderer.update(realDt, realDt);
      if (render && (this.lobbyVisible || this.meta.tab === 'home')) this.renderer.render();
    }
  }
}

const app = new App();
window.app = app;
app.boot().catch((e) => { console.error(e); $('boot-msg').textContent = '로딩 실패: ' + e.message; });
