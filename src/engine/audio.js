// Web Audio: 샘플(Kenney CC0) + 프로시저럴 합성 SFX + BGM 크로스페이드 + 햅틱
const SFX_FILES = ['hit_punch0', 'hit_punch1', 'hit_punch2', 'hit_metal0', 'hit_metal1', 'hit_metal2', 'hit_soft0', 'hit_soft1', 'hit_bell', 'hit_mining', 'hit_wood', 'hit_plate', 'hit_glass',
  'ui_click', 'ui_confirm', 'ui_select', 'ui_back', 'ui_error', 'ui_open', 'ui_close', 'ui_max', 'ui_drop', 'ui_bong', 'ui_glass', 'ui_pluck',
  'coin0', 'coin1', 'coin_stack', 'pack_open', 'card_fan', 'card_place', 'jingle_win0', 'jingle_win1', 'jingle_legend'];

class AudioSys {
  constructor() {
    this.ctx = null; this.buffers = {}; this.enabled = true; this.musicOn = true; this.haptics = true;
    this.music = null; this.musicName = null; this.musicGain = null; this.sfxGain = null; this.master = null;
    this.lastPlay = {};
    this.voiceOn = true; this.voiceBuf = {}; this._voiceSrc = null; this._voiceLast = {};
  }
  async init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.9; this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.55; this.musicGain.connect(this.master);
    // 컴프레서로 타격음 펀치감
    const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.12;
    this.sfxGain.disconnect(); this.sfxGain.connect(comp); comp.connect(this.master);
    this.voiceGain = this.ctx.createGain(); this.voiceGain.gain.value = 1; this.voiceGain.connect(this.master);
    await Promise.all(SFX_FILES.map(async (n) => {
      try { const ab = await (await fetch(`/sfx/${n}.mp3`)).arrayBuffer(); this.buffers[n] = await this.ctx.decodeAudioData(ab); } catch (e) { console.warn('sfx fail', n); }
    }));
  }
  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }
  now() { return this.ctx ? this.ctx.currentTime : 0; }
  /** 샘플 재생 (피치 랜덤, 볼륨, 최소 간격) */
  play(name, { vol = 1, rate = 1, vary = 0.08, min = 0.03, delay = 0 } = {}) {
    if (!this.enabled || !this.ctx) return;
    const b = this.buffers[name]; if (!b) return;
    const t = this.now(); if (this.lastPlay[name] && t - this.lastPlay[name] < min) return; this.lastPlay[name] = t;
    const s = this.ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * vary);
    const g = this.ctx.createGain(); g.gain.value = vol; s.connect(g); g.connect(this.sfxGain); s.start(t + delay);
  }
  pick(prefix, n, opts) { this.play(prefix + Math.floor(Math.random() * n), opts); }
  /** 나레이션(TTS, /sfx/voice/*.mp3 — edge-tts InJoon 생성). 새 대사가 이전 대사를 끊고, BGM 을 잠깐 덕킹한다. min 은 같은 대사 최소 간격(초) */
  async voice(name, { vol = 1, min = 2, duck = 0.45, dur = 1.6 } = {}) {
    if (!this.voiceOn || !this.ctx) return;
    const t = this.now(); if (this._voiceLast[name] && t - this._voiceLast[name] < min) return; this._voiceLast[name] = t;
    let b = this.voiceBuf[name];
    if (!b) { try { const ab = await (await fetch(`/sfx/voice/${name}.mp3`)).arrayBuffer(); b = this.voiceBuf[name] = await this.ctx.decodeAudioData(ab); } catch (e) { this.voiceBuf[name] = null; return; } }
    if (!b || !this.voiceOn) return;
    if (this._voiceSrc) { try { this._voiceSrc.stop(); } catch (e) {} }
    const src = this.ctx.createBufferSource(); src.buffer = b; const g = this.ctx.createGain(); g.gain.value = vol; src.connect(g); g.connect(this.voiceGain); src.start(); this._voiceSrc = src;
    this.duck(duck, Math.max(dur, b.duration + 0.4));
  }
  setVoiceOn(on) { this.voiceOn = on; if (!on && this._voiceSrc) { try { this._voiceSrc.stop(); } catch (e) {} } }

  // ---------- 프로시저럴 SFX ----------
  _noise(dur) {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * dur), buf = this.ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = this.ctx.createBufferSource(); s.buffer = buf; return s;
  }
  /** 검 휘두름 */
  whoosh({ vol = 0.5, pitch = 1, dur = 0.25 } = {}) {
    if (!this.enabled || !this.ctx) return; const t = this.now();
    const n = this._noise(dur + 0.05); const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(600 * pitch, t); f.frequency.exponentialRampToValueAtTime(3200 * pitch, t + dur * 0.5); f.frequency.exponentialRampToValueAtTime(400 * pitch, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.25); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f); f.connect(g); g.connect(this.sfxGain); n.start(t); n.stop(t + dur + 0.05);
  }
  /** 타격 보강용 저역 펀치 */
  thump({ vol = 0.6, freq = 90, dur = 0.18 } = {}) {
    if (!this.enabled || !this.ctx) return; const t = this.now();
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(freq * 2.2, t); o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + dur + 0.02);
  }
  /** 폭발 */
  boom({ vol = 0.9, dur = 0.7, low = 60 } = {}) {
    if (!this.enabled || !this.ctx) return; const t = this.now();
    const n = this._noise(dur); const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(4000, t); f.frequency.exponentialRampToValueAtTime(120, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f); f.connect(g); g.connect(this.sfxGain); n.start(t); n.stop(t + dur);
    this.thump({ vol: vol * 0.9, freq: low, dur: dur * 0.6 });
  }
  /** 전기/번개 */
  zap({ vol = 0.5, dur = 0.3 } = {}) {
    if (!this.enabled || !this.ctx) return; const t = this.now();
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    const steps = 12; for (let i = 0; i < steps; i++) o.frequency.setValueAtTime(300 + Math.random() * 2400, t + (dur * i) / steps);
    const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 900;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + dur);
    const n = this._noise(dur * 0.6); const g2 = this.ctx.createGain(); g2.gain.setValueAtTime(vol * 0.5, t); g2.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.6);
    n.connect(f); n.start(t); n.stop(t + dur * 0.6); g2.connect(this.sfxGain);
  }
  /** 마법 차지/발동 (상승 아르페지오) */
  magic({ vol = 0.35, base = 440, notes = [0, 4, 7, 12], step = 0.06, type = 'triangle' } = {}) {
    if (!this.enabled || !this.ctx) return; const t = this.now();
    notes.forEach((n, i) => {
      const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = base * Math.pow(2, n / 12);
      const g = this.ctx.createGain(); const st = t + i * step; g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(vol, st + 0.02); g.gain.exponentialRampToValueAtTime(0.001, st + 0.35);
      o.connect(g); g.connect(this.sfxGain); o.start(st); o.stop(st + 0.4);
    });
  }
  /** 불꽃 (지속 노이즈) */
  fire({ vol = 0.3, dur = 0.6 } = {}) {
    if (!this.enabled || !this.ctx) return; const t = this.now();
    const n = this._noise(dur); const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.5;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f); f.connect(g); g.connect(this.sfxGain); n.start(t); n.stop(t + dur);
  }
  /** 크리티컬 팅 */
  ting({ vol = 0.4, freq = 1800 } = {}) {
    if (!this.enabled || !this.ctx) return; const t = this.now();
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.25);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + 0.32);
  }
  /** 타격 복합음: 샘플 + 저역 + (크리티컬 시) 팅 */
  hit(kind = 'slash', { crit = false, heavy = false } = {}) {
    if (kind === 'slash') { this.pick('hit_metal', 3, { vol: heavy ? 1 : 0.7, rate: heavy ? 0.85 : 1.1, vary: 0.12 }); this.pick('hit_punch', 3, { vol: heavy ? 0.9 : 0.55, rate: 1.2 }); }
    else if (kind === 'blunt') { this.pick('hit_punch', 3, { vol: 1, rate: heavy ? 0.8 : 1 }); this.play('hit_wood', { vol: 0.5 }); }
    else if (kind === 'magic') { this.pick('hit_soft', 2, { vol: 0.8, rate: 1.3 }); this.play('hit_glass', { vol: 0.3, rate: 1.4 }); }
    else if (kind === 'hurt') { this.pick('hit_soft', 2, { vol: 0.9, rate: 0.8 }); }
    this.thump({ vol: heavy ? 0.9 : 0.45, freq: heavy ? 60 : 100, dur: heavy ? 0.28 : 0.14 });
    if (crit) this.ting({ vol: 0.45, freq: 1500 + Math.random() * 600 });
  }

  // ================= 확장 SFX 라이브러리 (프로시저럴) =================
  _env(g, t, a, d, peak = 1) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  _osc(type, freq, t, dur, vol, dest) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); const g = this.ctx.createGain(); this._env(g, t, 0.005, dur, vol); o.connect(g); g.connect(dest || this.sfxGain); o.start(t); o.stop(t + dur + 0.05); return o; }
  /** 금속 검격 (스윕 + 링잉) */
  clang({ vol = 0.5, freq = 2400, dur = 0.35 } = {}) {
    if (!this.enabled || !this.ctx) return; const t = this.now();
    for (const [m, v] of [[1, 1], [1.51, 0.5], [2.11, 0.3], [3.07, 0.18]]) {
      const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(freq * m * (0.97 + Math.random() * 0.06), t);
      const g = this.ctx.createGain(); this._env(g, t, 0.002, dur * (1 / m), vol * v);
      o.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + dur + 0.05);
    }
  }
  /** 얼음 결정 (고음 반짝 + 크랙) */
  ice({ vol = 0.45, dur = 0.45 } = {}) {
    if (!this.enabled || !this.ctx) return; const t = this.now();
    for (let i = 0; i < 5; i++) { const st = t + i * 0.025; const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(2600 + Math.random() * 2600, st); const g = this.ctx.createGain(); this._env(g, st, 0.003, dur * 0.6, vol * (0.5 + Math.random() * 0.5)); o.connect(g); g.connect(this.sfxGain); o.start(st); o.stop(st + dur); }
    const n = this._noise(dur * 0.5); const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3000;
    const g2 = this.ctx.createGain(); this._env(g2, t, 0.004, dur * 0.4, vol * 0.5); n.connect(f); f.connect(g2); g2.connect(this.sfxGain); n.start(t); n.stop(t + dur);
  }
  /** 신성한 빛 (밝은 상승 코드 + 벨) */
  holy({ vol = 0.4, base = 523, dur = 0.9 } = {}) {
    if (!this.enabled || !this.ctx) return; const t = this.now();
    [0, 4, 7, 11, 14].forEach((n, i) => { const st = t + i * 0.045; const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(base * Math.pow(2, n / 12), st); const g = this.ctx.createGain(); this._env(g, st, 0.01, dur - i * 0.05, vol * (1 - i * 0.12)); o.connect(g); g.connect(this.sfxGain); o.start(st); o.stop(st + dur); });
    this.ting({ vol: vol * 0.5, freq: base * 4 });
  }
  /** 어둠/저주 (하강 디튠) */
  dark({ vol = 0.45, base = 180, dur = 0.8 } = {}) {
    if (!this.enabled || !this.ctx) return; const t = this.now();
    for (const det of [1, 1.012, 0.988]) { const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(base * det, t); o.frequency.exponentialRampToValueAtTime(base * det * 0.45, t + dur); const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(240, t + dur); const g = this.ctx.createGain(); this._env(g, t, 0.02, dur, vol / 3); o.connect(f); f.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + dur + 0.05); }
  }
  /** 진공 흡입 (몹몰이) — 상승 노이즈 스윕 */
  suck({ vol = 0.35, dur = 0.5 } = {}) {
    if (!this.enabled || !this.ctx) return; const t = this.now();
    const n = this._noise(dur); const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 4;
    f.frequency.setValueAtTime(220, t); f.frequency.exponentialRampToValueAtTime(2600, t + dur);
    const g = this.ctx.createGain(); this._env(g, t, dur * 0.5, dur * 0.5, vol);
    n.connect(f); f.connect(g); g.connect(this.sfxGain); n.start(t); n.stop(t + dur);
  }
  /** 회복 / 버프 */
  buff({ vol = 0.4, base = 392, dur = 0.7, down = false } = {}) {
    if (!this.enabled || !this.ctx) return; const t = this.now();
    const o = this.ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base * (down ? 0.5 : 2), t + dur * 0.8);
    const g = this.ctx.createGain(); this._env(g, t, 0.03, dur, vol);
    o.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + dur + 0.05);
  }
  /** 레벨업 / 강화 성공 (아르페지오 + 벨) */
  levelUp({ vol = 0.45, base = 523 } = {}) {
    if (!this.enabled || !this.ctx) return;
    this.magic({ vol, base, notes: [0, 4, 7, 12, 16, 19], step: 0.055, type: 'triangle' });
    setTimeout(() => this.ting({ vol: vol * 0.7, freq: base * 4 }), 330);
  }
  /** 강화 실패 (하강 불협) */
  fail({ vol = 0.5 } = {}) {
    if (!this.enabled || !this.ctx) return; const t = this.now();
    [0, -1, -3].forEach((n, i) => { const st = t + i * 0.08; const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(300 * Math.pow(2, n / 12), st); const g = this.ctx.createGain(); this._env(g, st, 0.01, 0.28, vol * 0.3); o.connect(g); g.connect(this.sfxGain); o.start(st); o.stop(st + 0.35); });
  }
  /** 장비 파괴 (유리 깨짐 + 저역 임팩트) */
  shatter({ vol = 0.7 } = {}) {
    if (!this.enabled || !this.ctx) return; const t = this.now();
    const n = this._noise(0.7); const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.setValueAtTime(4000, t); f.frequency.exponentialRampToValueAtTime(700, t + 0.6);
    const g = this.ctx.createGain(); this._env(g, t, 0.002, 0.65, vol); n.connect(f); f.connect(g); g.connect(this.sfxGain); n.start(t); n.stop(t + 0.7);
    this.thump({ vol: vol * 0.8, freq: 55, dur: 0.4 }); this.dark({ vol: vol * 0.5, base: 140, dur: 0.7 });
  }
  /** 아이템 획득 (희귀도별) */
  loot(rarity = 'N') {
    if (!this.enabled || !this.ctx) return;
    if (rarity === 'SSR') { this.holy({ vol: 0.5, base: 659, dur: 1.1 }); this.play('jingle_legend', { vol: 0.6 }); this.vibe([30, 30, 90]); }
    else if (rarity === 'SR') { this.magic({ vol: 0.38, base: 587, notes: [0, 4, 7, 12], step: 0.05 }); this.ting({ vol: 0.3, freq: 2200 }); }
    else if (rarity === 'R') { this.magic({ vol: 0.3, base: 523, notes: [0, 7], step: 0.05 }); }
    else this.play('ui_drop', { vol: 0.4 });
  }
  /** 코인/재화 픽업 (피치 상승 콤보) */
  coinPick(idx = 0) { this.pick('coin', 2, { vol: 0.26, rate: 1.15 + Math.min(12, idx) * 0.05, vary: 0.05, min: 0.015 }); }
  /** 웨이브 시작 경보 */
  waveHorn({ vol = 0.5, boss = false } = {}) {
    if (!this.enabled || !this.ctx) return; const t = this.now(); const base = boss ? 98 : 147;
    for (const det of [1, 1.005, 2, 3]) { const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(base * det, t); const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.linearRampToValueAtTime(1800, t + 0.3); const g = this.ctx.createGain(); this._env(g, t, 0.08, boss ? 1.4 : 0.9, vol / 4); o.connect(f); f.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + 1.6); }
    if (boss) this.thump({ vol: 0.8, freq: 45, dur: 0.6 });
  }
  /** 궁극기 차징 (상승 사이렌) */
  charge({ vol = 0.4, dur = 0.8 } = {}) {
    if (!this.enabled || !this.ctx) return; const t = this.now();
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(1600, t + dur);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(4000, t + dur);
    const g = this.ctx.createGain(); this._env(g, t, dur * 0.7, dur * 0.3, vol);
    o.connect(f); f.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + dur + 0.05);
  }
  /** 참격 파동 (검기 발사) */
  bladeWave({ vol = 0.55 } = {}) {
    if (!this.enabled || !this.ctx) return;
    this.whoosh({ vol: vol * 0.8, pitch: 0.65, dur: 0.4 }); this.clang({ vol: vol * 0.5, freq: 1800, dur: 0.4 }); this.thump({ vol: vol * 0.4, freq: 90, dur: 0.2 });
  }
  /** 적 스폰 (땅 갈라짐) */
  spawnRise({ vol = 0.35, boss = false } = {}) {
    if (!this.enabled || !this.ctx) return; const t = this.now(); const dur = boss ? 1.0 : 0.5;
    const n = this._noise(dur); const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(200, t); f.frequency.exponentialRampToValueAtTime(1400, t + dur);
    const g = this.ctx.createGain(); this._env(g, t, dur * 0.5, dur * 0.5, vol);
    n.connect(f); f.connect(g); g.connect(this.sfxGain); n.start(t); n.stop(t + dur);
    this.thump({ vol: vol * (boss ? 1.4 : 0.7), freq: boss ? 45 : 70, dur: dur * 0.6 });
  }

  // ---------- BGM ----------
  playMusic(name, { fade = 1.2, volume = 0.55 } = {}) {
    if (!this.ctx) return;
    if (this.musicName === name) return;
    this.musicName = name;
    const old = this.music;
    if (old) { const g = old.gain; g.gain.cancelScheduledValues(this.now()); g.gain.setValueAtTime(g.gain.value, this.now()); g.gain.linearRampToValueAtTime(0, this.now() + fade); setTimeout(() => { try { old.el.pause(); } catch (e) {} }, fade * 1000 + 100); }
    if (!name || !this.musicOn) { this.music = null; return; }
    const el = new Audio(`/bgm/${name}.mp3`); el.loop = true; el.crossOrigin = 'anonymous'; el.preload = 'auto';
    const src = this.ctx.createMediaElementSource(el); const g = this.ctx.createGain(); g.gain.value = 0; src.connect(g); g.connect(this.musicGain);
    el.play().catch(() => {});
    g.gain.linearRampToValueAtTime(volume, this.now() + fade);
    this.music = { el, gain: g, src };
  }
  duck(amount = 0.25, dur = 1.5) {
    if (!this.musicGain) return; const t = this.now(); const g = this.musicGain.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0.55 * amount, t + 0.1); g.linearRampToValueAtTime(0.55, t + dur);
  }
  setMusicOn(on) { this.musicOn = on; if (!on) { const n = this.musicName; this.playMusic(null); this.musicName = null; this._pendingMusic = n; } else if (this._pendingMusic) { this.playMusic(this._pendingMusic); } }
  setSfxOn(on) { this.enabled = on; }

  // ---------- 햅틱 ----------
  vibe(pattern) { if (this.haptics && navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} } }
}

export const audio = new AudioSys();
