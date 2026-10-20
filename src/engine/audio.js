import {
  attackSound, skillSound, ultimateSound, heroSoundFiles, heroHitSound, heroForWeapon, HERO_IDS, HERO_HIT_VARIANTS, SWING_VARIANTS,
  FX_VARIANTS, FX_SOUND_FILES, UI_SOUND_NAMES, SFX_LIBRARY, sfxUrl,
  COMBO_STINGERS, HIT_BUS_GAIN, HIT_PRIORITY, HIT_SOUND_FILES, HIT_VARIANTS, HIT_VOICES, HIT_VOICES_PREMIUM, HIT_WINDOW, KILL_SOUND,
  comboSoundName, hitLayers, hitSoundName, hitTier, isPremiumHit,
} from './combat-sound-library.js';

// Web Audio: Mirelo SFX 샘플(public/sfx/mirelo-v1) + 샘플이 없을 때만 쓰는 합성 폴백 + BGM 크로스페이드 + 햅틱
// 오디오 타이머/음소거가 전투와 보상의 Math.random 순서를 바꾸지 않는다.
// 장식용 스트림은 한 번만 시드하고, 노이즈 샘플마다 외부 난수를 호출하지 않는다.
function createAudioRandom() {
  let state = Date.now() >>> 0;
  try { state = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]; } catch { /* older audio hosts */ }
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
// 공용(UI·효과·타격)은 시작 때, 영웅 세트는 그 영웅이 처음 소리를 낼 때 불러온다(모바일 메모리: 영웅당 약 22초 분량).
const SFX_FILES = [...UI_SOUND_NAMES, ...FX_SOUND_FILES, ...HIT_SOUND_FILES];
const HIT_BUS_PREFIX = SFX_LIBRARY + 'hit/';
// TTS 원본은 보정하지 않고, 영웅별 실측 편차만 재생 버스에서 맞춘다.
const HERO_VOICE_GAIN = { barbarian: .2, knight: .32, mage: 1, ranger: 1.2, rogue: 3.8 };

/** |x| 0.8 까지는 그대로, 그 위는 1 에 부드럽게 접근한다. */
function softClipCurve() {
  const size = 2049, curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1, a = Math.abs(x);
    curve[i] = Math.sign(x) * (a <= 0.8 ? a : 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2));
  }
  return curve;
}

export class AudioSys {
  constructor() {
    this._random = createAudioRandom();
    this.ctx = null; this.buffers = {}; this.enabled = true; this.musicOn = true; this.haptics = true;
    this.music = null; this.musicName = null; this.musicGain = null; this.sfxGain = null; this.master = null;
    this.lastPlay = {};
    this._hitLast = -Infinity; this._hitPending = null; this._hitTimer = null;
    // 최근 타격 재생 시각(50ms 창당 동시 2음), 최근 타격 요청 시각(혼잡도), 처치 시각, 콤보 스팅어 상태.
    this._hitRecent = []; this._hitEvents = []; this._hitDropped = 0; this._variantLast = {};
    this._killTimes = []; this._killRecent = []; this._killMassAt = -Infinity;
    this._comboLast = 0; this._comboFired = new Set();
    this.voiceOn = true; this.voiceBuf = {}; this._voiceSrc = null; this._voiceLast = {};
    this._barkLast = {}; this._voiceEpoch = 0; this._voiceLoads = new Map();
    this.mix = { music: 0.55, sfx: 0.9, voice: 1 };
    this._voices = new Set(); this.voiceLimits = { sfx: 16, bark: 4, narration: 1 };
    this._musicTracks = new Set(); this._ducks = []; this._combatLevel = 1; this._musicMutes = new Set();
    this._heroLoads = new Map(); this._swingLast = {}; this._heroHitLast = {}; this._heroWeapon = '';
  }
  async init() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (typeof AC !== 'function') { this.unavailable = true; return false; }
    try { this.ctx = new AC({ latencyHint: 'interactive' }); }
    catch { this.unavailable = true; return false; }
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.9; this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.55;
    this.musicDuckGain = this.ctx.createGain(); this.musicGain.connect(this.musicDuckGain);
    this.musicMuteGain = this.ctx.createGain(); this.musicMuteGain.gain.value = this._musicMutes.size ? 0 : 1;
    this.musicDuckGain.connect(this.musicMuteGain); this.musicMuteGain.connect(this.master);
    // 컴프레서로 타격음 펀치감
    const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.12;
    this.sfxGain.disconnect(); this.sfxGain.connect(comp);
    // 타격·처치·콤보(hit 버스)는 따로 약하게 압축한다. 기존 -14dB/6:1 컴프레서만 거치면 새 샘플의 펀치가 눌려
    // 예전 타격보다 작게 들린다(오프라인 측정). 두 버스를 합친 뒤 마지막 소프트 클립이 0dBFS 를 넘지 않게 막는다.
    let out = this.master;
    try {
      const sum = this.ctx.createGain(), shaper = this.ctx.createWaveShaper();
      shaper.curve = softClipCurve(); sum.connect(shaper); shaper.connect(this.master); out = sum;
      this.hitGain = this.ctx.createGain(); this.hitGain.gain.value = this.mix.sfx * HIT_BUS_GAIN;
      const hitComp = this.ctx.createDynamicsCompressor();
      hitComp.threshold.value = -12; hitComp.knee.value = 6; hitComp.ratio.value = 4; hitComp.attack.value = 0.003; hitComp.release.value = 0.1;
      this.hitGain.connect(hitComp); hitComp.connect(sum);
    } catch { this.hitGain = null; /* 구형 호스트는 기존 버스만 쓴다 */ }
    comp.connect(out);
    this.voiceGain = this.ctx.createGain(); this.voiceGain.gain.value = 1; this.voiceGain.connect(this.master); this._barkLast = {};
    this.setMix(this.mix);
    await Promise.all(SFX_FILES.map((n) => this._loadSfx(n)));
    return true;
  }
  async _loadSfx(n) {
    if (this.buffers[n]) return this.buffers[n];
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
    try { const ab = await (await fetch(sfxUrl(n), { signal: controller.signal })).arrayBuffer(); this.buffers[n] = await this.ctx.decodeAudioData(ab); }
    catch (e) { console.warn('sfx fail', n); }
    finally { clearTimeout(timeout); }
    return this.buffers[n] || null;
  }
  /** 영웅 효과음 세트(휘두름·마무리·타격·궁극기·스킬 8)를 한 번만 불러온다. 아직 없으면 그 순간은 공용 효과로 대신한다. */
  preloadHero(heroId) {
    if (!this.ctx || !HERO_IDS.includes(heroId)) return Promise.resolve(false);
    if (!this._heroLoads.has(heroId)) this._heroLoads.set(heroId, Promise.all(heroSoundFiles(heroId).map((n) => this._loadSfx(n))).then(() => true));
    return this._heroLoads.get(heroId);
  }
  /** 파티 게스트용: 원격 타격 재생에 필요한 영웅 타격음 변형만 불러온다(전체 세트 15개 대신 2개). */
  preloadHeroHits(heroId) {
    if (!this.ctx || !HERO_IDS.includes(heroId)) return Promise.resolve(false);
    if (this._heroLoads.has(heroId)) return this._heroLoads.get(heroId);
    return Promise.all(Array.from({ length: HERO_HIT_VARIANTS }, (_, v) => this._loadSfx(heroHitSound(heroId, v)))).then(() => true);
  }
  /** 같은 변형이 연달아 나오지 않게 고른다. */
  _rotate(store, key, count) {
    if (count < 2) return 0;
    const last = store[key] ?? -1, next = (last + 1 + Math.floor(this._random() * (count - 1))) % count;
    store[key] = next; return next;
  }
  /** 예전 합성음 자리에 Mirelo 효과 샘플을 낸다. 샘플이 준비됐으면 true(호출한 합성음은 건너뛴다). */
  _fx(family, { vol = 0.5, rate = 1, min = 0.04, priority = 2 } = {}) {
    const count = FX_VARIANTS[family] || 0; if (!count || !this.ctx) return false;
    const name = `${SFX_LIBRARY}fx/${family}_${this._rotate(this._variantLast, 'fx:' + family, count)}`;
    if (!this.buffers[name]) return false;
    this.play(name, { vol: Math.min(1, vol * 1.4), rate, vary: 0.05, min, priority });
    return true;
  }
  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); }
  // 저장된 믹스·전투 duck·SFX·음성에 영향 없이 소유한 음악 음소거만 해제한다.
  acquireMusicMute() {
    const token = {}; this._musicMutes.add(token);
    this.musicMuteGain?.gain.setValueAtTime(0, this.now());
    return () => {
      if (!this._musicMutes.delete(token)) return;
      this.musicMuteGain?.gain.setValueAtTime(this._musicMutes.size ? 0 : 1, this.now());
    };
  }
  now() { return this.ctx ? this.ctx.currentTime : 0; }
  getMix() { return { ...this.mix }; }
  getDiagnostics() {
    const counts = { sfx: 0, bark: 0, narration: 0 };
    for (const v of this._voices) counts[v.group]++;
    return { voices: counts, limits: { ...this.voiceLimits }, musicTracks: this._musicTracks.size, voiceLoads: this._voiceLoads.size, ducks: this._ducks.filter(d => d.end > this.now()).length, combatLevel: this._combatLevel, hitDropped: this._hitDropped, mix: this.getMix() };
  }
  _heroVoiceId(name) { return /^hero_(knight|barbarian|mage|rogue|ranger)_/.exec(name)?.[1] || null; }
  // 레인저도 전용 보이스(hero_ranger_*)를 쓰므로 키 이름 그대로 불러온다.
  _voiceAssetName(name) { return name; }
  _voiceAssetGain(name) { return HERO_VOICE_GAIN[this._heroVoiceId(name)] || 1; }
  _loadVoice(name) {
    const assetName = this._voiceAssetName(name);
    if (this.voiceBuf[assetName]) return Promise.resolve(this.voiceBuf[assetName]);
    if (this._voiceLoads.has(assetName)) return this._voiceLoads.get(assetName);
    const pending = fetch(`/sfx/voice/${assetName}.mp3`).then(r => r.arrayBuffer()).then(ab => this.ctx.decodeAudioData(ab))
      .then(buffer => { this.voiceBuf[assetName] = buffer; return buffer; }).catch(() => null)
      .finally(() => this._voiceLoads.delete(assetName));
    this._voiceLoads.set(assetName, pending); return pending;
  }
  setMix(values = {}) {
    for (const key of ['music', 'sfx', 'voice']) if (Number.isFinite(values[key])) this.mix[key] = Math.max(0, Math.min(1, values[key]));
    if (this.sfxGain) this.sfxGain.gain.setValueAtTime(this.enabled ? this.mix.sfx : 0, this.now());
    if (this.hitGain) this.hitGain.gain.setValueAtTime(this.enabled ? this.mix.sfx * HIT_BUS_GAIN : 0, this.now());
    if (this.voiceGain) this.voiceGain.gain.setValueAtTime(this.voiceOn ? this.mix.voice : 0, this.now());
    if (this.musicGain) this.musicGain.gain.setValueAtTime(this.musicOn ? this.mix.music * this._combatLevel : 0, this.now());
    if (!this.mix.voice) { this._voiceEpoch++; this._stopVoices('bark'); this._stopVoices('narration'); }
    if (!this.mix.sfx) this._stopVoices('sfx');
    return this.getMix();
  }
  /** Caller supplies unscaled seconds once per render frame (including pause/menu).
   * No private clock/RAF. A resumed-frame gap is capped at 100ms; music pitch never changes. */
  updateCombatMix(dt, { active = false, paused = false, boss = false, intensity = 0 } = {}) {
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    const energy = Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 0;
    const target = paused ? 0.72 : active ? 0.9 + energy * 0.08 + (boss ? 0.02 : 0) : 1;
    this._combatLevel += (target - this._combatLevel) * (1 - Math.exp(-step * 3));
    if (this.musicGain) this.musicGain.gain.setValueAtTime(this.musicOn ? this.mix.music * this._combatLevel : 0, this.now());
    this._ducks = this._ducks.filter(d => d.end > this.now());
  }
  _stopVoice(v) { try { v.src.stop(); } catch {} v.cleanup(); }
  _stopVoices(group) { for (const v of [...this._voices]) if (v.group === group) this._stopVoice(v); }
  _sample(buffer, { group, priority = 1, vol = 1, rate = 1, delay = 0, bus = '' }) {
    const peers = [...this._voices].filter(v => v.group === group);
    if (peers.length >= this.voiceLimits[group]) {
      const victim = peers.reduce((a, b) => a.priority <= b.priority ? a : b);
      if (victim.priority > priority) return null;
      this._stopVoice(victim);
    }
    const src = this.ctx.createBufferSource(), gain = this.ctx.createGain();
    src.buffer = buffer; src.playbackRate.value = rate; gain.gain.value = vol;
    src.connect(gain); gain.connect(group !== 'sfx' ? this.voiceGain : bus === 'hit' && this.hitGain ? this.hitGain : this.sfxGain);
    const voice = { src, gain, group, priority, cleanup: () => {
      src.onended = null; src.disconnect(); gain.disconnect(); this._voices.delete(voice);
      if (this._voiceSrc === src) this._voiceSrc = null;
    } };
    src.onended = voice.cleanup; this._voices.add(voice); src.start(this.now() + Math.max(0, delay));
    return src;
  }
  /** 샘플 재생 (피치 랜덤, 볼륨, 최소 간격) */
  play(name, { vol = 1, rate = 1, vary = 0.08, min = 0.03, delay = 0, bus = name.startsWith(HIT_BUS_PREFIX) ? 'hit' : '', priority = name.startsWith('ui_') ? 4 : 1 } = {}) {
    if (!this.enabled || !this.mix.sfx || !this.ctx) return;
    const b = this.buffers[name]; if (!b) return;
    const t = this.now(); if (this.lastPlay[name] !== undefined && t - this.lastPlay[name] < min) return; this.lastPlay[name] = t;
    return this._sample(b, { group: 'sfx', priority, vol, rate: rate * (1 + (this._random() * 2 - 1) * vary), delay, bus });
  }
  pick(prefix, n, opts) { this.play(prefix + Math.floor(this._random() * n), opts); }
  /** 나레이션(TTS, /sfx/voice/*.mp3 — edge-tts InJoon 생성). 새 대사가 이전 대사를 끊고, BGM 을 잠깐 덕킹한다. min 은 같은 대사 최소 간격(초) */
  async voice(name, { vol = 1, min = 2, duck = 0.45, dur = 1.6 } = {}) {
    if (!this.voiceOn || !this.mix.voice || !this.ctx) return;
    const assetName = this._voiceAssetName(name);
    const t = this.now(); if (this._voiceLast[assetName] !== undefined && t - this._voiceLast[assetName] < min) return; this._voiceLast[assetName] = t;
    const epoch = ++this._voiceEpoch;
    let b = this.voiceBuf[assetName];
    if (!b) b = await this._loadVoice(assetName);
    if (!b || !this.voiceOn || !this.mix.voice || epoch !== this._voiceEpoch) return;
    this._stopVoices('narration');
    this._voiceSrc = this._sample(b, { group: 'narration', priority: 5, vol: vol * this._voiceAssetGain(assetName) });
    this.duck(duck, Math.max(dur, b.duration + 0.4));
  }
  setVoiceOn(on) { this.voiceOn = !!on; if (!on) { this._voiceEpoch++; this._stopVoices('narration'); this._stopVoices('bark'); } this.setMix(); }
  /** 기합·외침(bark) — /sfx/voice/<name><i>.mp3 변형 중 하나를 SFX 레이어로 겹쳐 재생. 나레이션과 달리 서로 끊지 않고, 덕킹도 없다.
   *  n = 변형 수(name0..name{n-1}), n 이 없으면 name.mp3 하나. min = 같은 이름 최소 간격(초) */
  bark(name, { n = 0, vol = 0.9, min = 0.25, rate = 1, priority = 1 } = {}) {
    if (!this.voiceOn || !this.mix.voice || !this.ctx) return;
    const assetName = this._voiceAssetName(name);
    const t = this.now(); if (this._barkLast[assetName] !== undefined && t - this._barkLast[assetName] < min) return; this._barkLast[assetName] = t;
    const key = n ? assetName + Math.floor(this._random() * n) : assetName;
    const b = this.voiceBuf[key];
    if (!b) { this._loadVoice(key); return; }
    return this._sample(b, { group: 'bark', vol: vol * this._voiceAssetGain(key), rate, priority });
  }
  /** 기합 미리 로드 — 첫 공격에서 소리가 비지 않게 */
  preloadBarks(names) { if (this.ctx) for (const k of names) this._loadVoice(this._voiceAssetName(k)); }

  // ---------- 프로시저럴 SFX ----------
  _noise(dur) {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * dur), buf = this.ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = this._random() * 2 - 1;
    const s = this.ctx.createBufferSource(); s.buffer = buf; return s;
  }
  /** 검 휘두름 */
  whoosh({ vol = 0.5, pitch = 1, dur = 0.25 } = {}) {
    if (!this.enabled || !this.ctx) return; if (this._fx('whoosh', { vol, rate: Math.max(0.6, Math.min(1.6, pitch)) })) return; const t = this.now();
    const n = this._noise(dur + 0.05); const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(600 * pitch, t); f.frequency.exponentialRampToValueAtTime(3200 * pitch, t + dur * 0.5); f.frequency.exponentialRampToValueAtTime(400 * pitch, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.25); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f); f.connect(g); g.connect(this.sfxGain); n.start(t); n.stop(t + dur + 0.05);
  }
  /** 타격 보강용 저역 펀치 */
  thump({ vol = 0.6, freq = 90, dur = 0.18 } = {}) {
    if (!this.enabled || !this.ctx) return; if (this._fx('thump', { vol, rate: Math.max(0.7, Math.min(1.4, freq / 90)), min: 0.03 })) return; const t = this.now();
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(freq * 2.2, t); o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + dur + 0.02);
  }
  /** 폭발 */
  boom({ vol = 0.9, dur = 0.7, low = 60 } = {}) {
    if (!this.enabled || !this.ctx) return; if (this._fx('boom', { vol, rate: Math.max(0.75, Math.min(1.25, low / 60)), priority: 3 })) return; const t = this.now();
    const n = this._noise(dur); const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(4000, t); f.frequency.exponentialRampToValueAtTime(120, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f); f.connect(g); g.connect(this.sfxGain); n.start(t); n.stop(t + dur);
    this.thump({ vol: vol * 0.9, freq: low, dur: dur * 0.6 });
  }
  /** 전기/번개 */
  zap({ vol = 0.5, dur = 0.3 } = {}) {
    if (!this.enabled || !this.ctx) return; if (this._fx('zap', { vol })) return; const t = this.now();
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    const steps = 12; for (let i = 0; i < steps; i++) o.frequency.setValueAtTime(300 + this._random() * 2400, t + (dur * i) / steps);
    const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 900;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + dur);
    const n = this._noise(dur * 0.6); const g2 = this.ctx.createGain(); g2.gain.setValueAtTime(vol * 0.5, t); g2.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.6);
    n.connect(f); n.start(t); n.stop(t + dur * 0.6); g2.connect(this.sfxGain);
  }
  /** 마법 차지/발동 (상승 아르페지오) */
  magic({ vol = 0.35, base = 440, notes = [0, 4, 7, 12], step = 0.06, type = 'triangle' } = {}) {
    if (!this.enabled || !this.ctx) return; if (this._fx('magic', { vol, rate: Math.max(0.7, Math.min(1.4, base / 440)) })) return; const t = this.now();
    notes.forEach((n, i) => {
      const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = base * Math.pow(2, n / 12);
      const g = this.ctx.createGain(); const st = t + i * step; g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(vol, st + 0.02); g.gain.exponentialRampToValueAtTime(0.001, st + 0.35);
      o.connect(g); g.connect(this.sfxGain); o.start(st); o.stop(st + 0.4);
    });
  }
  /** 불꽃 (지속 노이즈) */
  fire({ vol = 0.3, dur = 0.6 } = {}) {
    if (!this.enabled || !this.ctx) return; if (this._fx('fire', { vol })) return; const t = this.now();
    const n = this._noise(dur); const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.5;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f); f.connect(g); g.connect(this.sfxGain); n.start(t); n.stop(t + dur);
  }
  /** 크리티컬 팅 */
  ting({ vol = 0.4, freq = 1800 } = {}) {
    if (!this.enabled || !this.ctx) return; if (this._fx('ting', { vol, rate: Math.max(0.7, Math.min(1.5, freq / 1800)), min: 0.03 })) return; const t = this.now();
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.25);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + 0.32);
  }
  /** 타격 복합음: 트랜지언트(접촉) + 바디(무게) 2레이어. hit-v2 샘플이 없으면 기존 합성 경로로 내려간다.
   *  weapon/basic/counter/light 는 선택 입력이다(없으면 kind·등급 플래그만으로 고른다). */
  hit(kind = 'slash', { crit = false, heavy = false, finisher = heavy && !crit, boss = false, counter = false, weapon = '', light = false } = {}) {
    if (!this.enabled || !this.ctx) return;
    const now = this.now();
    // 몹몰이 혼잡도: 150ms 안에 6번째 이상의 요청이면 일반 타격은 가벼운 등급으로 내려간다.
    while (this._hitEvents.length && now - this._hitEvents[0] >= 0.15) this._hitEvents.shift();
    this._hitEvents.push(now);
    const crowd = this._hitEvents.length > 6;
    const tier = hitTier({ crit, heavy, finisher, boss, counter, light, crowd });
    const event = { kind, crit, heavy, finisher, boss, counter, weapon, tier, premium: isPremiumHit(tier),
      priority: (finisher ? 4 : 0) + (heavy ? 2 : 0) + (crit ? 1 : 0) + (boss ? 1 : 0) + (counter ? 4 : 0) };
    if (!this._hitPending || event.priority >= this._hitPending.priority) {
      if (this._hitPending) this._hitDropped++;
      this._hitPending = event;
    } else this._hitDropped++;
    this._flushHit();
  }
  /** 50ms 창마다 최대 2음(마무리·보스·카운터는 3음)을 낸다. 넘치는 일반 타격은 대기 중 가장 센 하나만 남는다. */
  _flushHit() {
    if (this._hitTimer !== null) return;
    if (!this.enabled || !this.ctx || this.ctx.state === 'suspended') { this._hitPending = null; return; }
    if (!this._hitPending) return;
    const now = this.now();
    while (this._hitRecent.length && now - this._hitRecent[0] >= HIT_WINDOW - 0.0001) this._hitRecent.shift();
    const limit = this._hitPending.premium ? HIT_VOICES_PREMIUM : HIT_VOICES;
    if (this._hitRecent.length >= limit) {
      const remaining = HIT_WINDOW - (now - this._hitRecent[0]);
      this._hitTimer = setTimeout(() => { this._hitTimer = null; this._flushHit(); }, Math.ceil(Math.max(remaining, 0.001) * 1000));
      return;
    }
    const event = this._hitPending; this._hitPending = null; this._hitLast = now; this._hitRecent.push(now);
    this._renderHit(event.kind, event);
  }
  /** 같은 id 의 변형을 연속으로 반복하지 않고 오디오 전용 난수로 고른다. */
  _variant(id) {
    const count = HIT_VARIANTS[id] || 1; if (count < 2) return 0;
    const last = this._variantLast[id] ?? -1, next = (last + 1 + Math.floor(this._random() * (count - 1))) % count;
    this._variantLast[id] = next; return next;
  }
  _hasHitLibrary() { return !!(this.buffers[hitSoundName('b_basic', 0)] && this.buffers[hitSoundName('t_slash', 0)]); }
  _renderLayeredHit(kind, { crit, finisher, tier, weapon }) {
    for (const layer of hitLayers(kind, tier, { weapon: weapon || this._heroWeapon, crit })) {
      const name = layer.role === 'hero' ? heroHitSound(layer.hero, this._rotate(this._heroHitLast, layer.hero, HERO_HIT_VARIANTS)) : hitSoundName(layer.id, this._variant(layer.id));
      if (!this.buffers[name]) continue;
      this.play(name, { vol: layer.vol, rate: layer.rate, vary: layer.role === 'body' ? 0.04 : 0.06, min: 0.008, priority: layer.priority, bus: 'hit' });
    }
  }
  _renderHit(kind, event) {
    if (kind === 'hurt' && this._fx('hurt', { vol: 0.85, min: 0.05, priority: 3 })) return;
    if (kind !== 'hurt' && this._hasHitLibrary()) { this._renderLayeredHit(kind, event); return; }
    this._renderLegacyHit(kind, event);
  }
  _renderLegacyHit(kind, { crit, heavy, finisher, boss }) {
    const accent = finisher ? 1.12 : boss ? 1.05 : heavy ? 1 : 0.9;
    if (kind === 'slash') {
      this.pick('hit_metal', 3, { vol: (heavy ? 1 : 0.7) * accent, rate: heavy ? 0.82 : 1.1, vary: 0.12 });
      this.pick('hit_punch', 3, { vol: (heavy ? 0.88 : 0.52) * accent, rate: heavy ? 1.05 : 1.2 });
    } else if (kind === 'blunt') {
      this.pick('hit_punch', 3, { vol: (heavy ? 1.05 : 0.85) * accent, rate: heavy ? 0.76 : 1 });
      this.play('hit_wood', { vol: (heavy ? 0.62 : 0.45) * accent, rate: heavy ? 0.88 : 1 });
    } else if (kind === 'magic') {
      this.pick('hit_soft', 2, { vol: (heavy ? 0.92 : 0.72) * accent, rate: 1.3 });
      this.play('hit_glass', { vol: (heavy ? 0.38 : 0.28) * accent, rate: 1.4 });
    } else if (kind === 'hurt') this.pick('hit_soft', 2, { vol: 0.9, rate: 0.8 });
    const low = finisher ? 48 : boss ? 56 : heavy ? 68 : crit ? 84 : 102;
    this.thump({ vol: (finisher ? 1.05 : heavy ? 0.9 : 0.46) * accent, freq: low, dur: finisher ? 0.34 : heavy ? 0.28 : 0.14 });
    this.contactSnap({ vol: finisher ? 0.27 : heavy ? 0.2 : 0.11, freq: finisher ? 980 : heavy ? 1260 : 1900 });
    if (finisher) this.contactSnap({ vol: 0.1, freq: 620 });
    if (crit) this.ting({ vol: finisher ? 0.6 : 0.46, freq: 1500 + this._random() * 600 });
  }

  /** Very short filtered transient separates weapon contact from the longer body thump. */
  contactSnap({vol=.1,freq=1800}={}) {
    if(!this.enabled||!this.ctx)return;const t=this.now(),dur=.035;
    const n=this._noise(dur),f=this.ctx.createBiquadFilter(),g=this.ctx.createGain();
    f.type='bandpass';f.frequency.value=freq;f.Q.value=1.6;
    g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);
    n.connect(f);f.connect(g);g.connect(this.sfxGain);n.start(t);n.stop(t+dur);
  }

  // ================= 확장 SFX 라이브러리 (프로시저럴) =================
  _env(g, t, a, d, peak = 1) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  _osc(type, freq, t, dur, vol, dest) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); const g = this.ctx.createGain(); this._env(g, t, 0.005, dur, vol); o.connect(g); g.connect(dest || this.sfxGain); o.start(t); o.stop(t + dur + 0.05); return o; }
  /** 금속 검격 (스윕 + 링잉) */
  clang({ vol = 0.5, freq = 2400, dur = 0.35 } = {}) {
    if (!this.enabled || !this.ctx) return; if (this._fx('clang', { vol, rate: Math.max(0.7, Math.min(1.4, freq / 2400)) })) return; const t = this.now();
    for (const [m, v] of [[1, 1], [1.51, 0.5], [2.11, 0.3], [3.07, 0.18]]) {
      const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(freq * m * (0.97 + this._random() * 0.06), t);
      const g = this.ctx.createGain(); this._env(g, t, 0.002, dur * (1 / m), vol * v);
      o.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + dur + 0.05);
    }
  }
  /** 얼음 결정 (고음 반짝 + 크랙) */
  ice({ vol = 0.45, dur = 0.45 } = {}) {
    if (!this.enabled || !this.ctx) return; if (this._fx('ice', { vol })) return; const t = this.now();
    for (let i = 0; i < 5; i++) { const st = t + i * 0.025; const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(2600 + this._random() * 2600, st); const g = this.ctx.createGain(); this._env(g, st, 0.003, dur * 0.6, vol * (0.5 + this._random() * 0.5)); o.connect(g); g.connect(this.sfxGain); o.start(st); o.stop(st + dur); }
    const n = this._noise(dur * 0.5); const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3000;
    const g2 = this.ctx.createGain(); this._env(g2, t, 0.004, dur * 0.4, vol * 0.5); n.connect(f); f.connect(g2); g2.connect(this.sfxGain); n.start(t); n.stop(t + dur);
  }
  /** 신성한 빛 (밝은 상승 코드 + 벨) */
  holy({ vol = 0.4, base = 523, dur = 0.9 } = {}) {
    if (!this.enabled || !this.ctx) return; if (this._fx('holy', { vol, rate: Math.max(0.8, Math.min(1.3, base / 523)) })) return; const t = this.now();
    [0, 4, 7, 11, 14].forEach((n, i) => { const st = t + i * 0.045; const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(base * Math.pow(2, n / 12), st); const g = this.ctx.createGain(); this._env(g, st, 0.01, dur - i * 0.05, vol * (1 - i * 0.12)); o.connect(g); g.connect(this.sfxGain); o.start(st); o.stop(st + dur); });
    this.ting({ vol: vol * 0.5, freq: base * 4 });
  }
  /** 어둠/저주 (하강 디튠) */
  dark({ vol = 0.45, base = 180, dur = 0.8 } = {}) {
    if (!this.enabled || !this.ctx) return; if (this._fx('dark', { vol })) return; const t = this.now();
    for (const det of [1, 1.012, 0.988]) { const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(base * det, t); o.frequency.exponentialRampToValueAtTime(base * det * 0.45, t + dur); const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(240, t + dur); const g = this.ctx.createGain(); this._env(g, t, 0.02, dur, vol / 3); o.connect(f); f.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + dur + 0.05); }
  }
  /** 진공 흡입 (몹몰이) — 상승 노이즈 스윕 */
  suck({ vol = 0.35, dur = 0.5 } = {}) {
    if (!this.enabled || !this.ctx) return; if (this._fx('suck', { vol })) return; const t = this.now();
    const n = this._noise(dur); const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 4;
    f.frequency.setValueAtTime(220, t); f.frequency.exponentialRampToValueAtTime(2600, t + dur);
    const g = this.ctx.createGain(); this._env(g, t, dur * 0.5, dur * 0.5, vol);
    n.connect(f); f.connect(g); g.connect(this.sfxGain); n.start(t); n.stop(t + dur);
  }
  /** 회복 / 버프 */
  buff({ vol = 0.4, base = 392, dur = 0.7, down = false } = {}) {
    if (!this.enabled || !this.ctx) return; if (this._fx(down ? 'fail' : 'buff', { vol })) return; const t = this.now();
    const o = this.ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base * (down ? 0.5 : 2), t + dur * 0.8);
    const g = this.ctx.createGain(); this._env(g, t, 0.03, dur, vol);
    o.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + dur + 0.05);
  }
  /** 레벨업 / 강화 성공 (아르페지오 + 벨) */
  levelUp({ vol = 0.45, base = 523 } = {}) {
    if (!this.enabled || !this.ctx) return;
    if (this._fx('levelup', { vol, min: 0.3, priority: 4 })) return;
    this.magic({ vol, base, notes: [0, 4, 7, 12, 16, 19], step: 0.055, type: 'triangle' });
    setTimeout(() => this.ting({ vol: vol * 0.7, freq: base * 4 }), 330);
  }
  /** 강화 실패 (하강 불협) */
  fail({ vol = 0.5 } = {}) {
    if (!this.enabled || !this.ctx) return; if (this._fx('fail', { vol, priority: 4 })) return; const t = this.now();
    [0, -1, -3].forEach((n, i) => { const st = t + i * 0.08; const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(300 * Math.pow(2, n / 12), st); const g = this.ctx.createGain(); this._env(g, st, 0.01, 0.28, vol * 0.3); o.connect(g); g.connect(this.sfxGain); o.start(st); o.stop(st + 0.35); });
  }
  /** 장비 파괴 (유리 깨짐 + 저역 임팩트) */
  shatter({ vol = 0.7 } = {}) {
    if (!this.enabled || !this.ctx) return; if (this._fx('shatter', { vol, priority: 4 })) return; const t = this.now();
    const n = this._noise(0.7); const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.setValueAtTime(4000, t); f.frequency.exponentialRampToValueAtTime(700, t + 0.6);
    const g = this.ctx.createGain(); this._env(g, t, 0.002, 0.65, vol); n.connect(f); f.connect(g); g.connect(this.sfxGain); n.start(t); n.stop(t + 0.7);
    this.thump({ vol: vol * 0.8, freq: 55, dur: 0.4 }); this.dark({ vol: vol * 0.5, base: 140, dur: 0.7 });
  }
  /** 아이템 획득 (희귀도별) */
  loot(rarity = 'N') {
    if (!this.enabled || !this.ctx) return;
    if (rarity === 'L' || rarity === 'SSR') { this.holy({ vol: 0.5, base: 659, dur: 1.1 }); this.play('jingle_legend', { vol: 0.6 }); this.vibe([30, 30, 90]); }
    else if (rarity === 'U') { this.holy({ vol: 0.35, base: 587, dur: 0.8 }); this.magic({ vol: 0.3, base: 440, notes: [0, 3, 7, 10], step: 0.05, type: 'triangle' }); }
    else if (rarity === 'E' || rarity === 'SR') { this.magic({ vol: 0.38, base: 587, notes: [0, 4, 7, 12], step: 0.05 }); this.ting({ vol: 0.3, freq: 2200 }); }
    else if (rarity === 'S' || rarity === 'R') { this.magic({ vol: 0.3, base: 523, notes: [0, 7], step: 0.05 }); }
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
    if (!this.enabled || !this.ctx) return; if (this._fx('charge', { vol, priority: 3 })) return; const t = this.now();
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

  /** 처치 확정음. 일반 타격과 다른 '팝+저역' 음으로 쓰러진 순간을 알린다.
   *  일반 처치는 80ms 창당 2음까지만 내고, 5킬 이상 몰리면 대량 처치음 한 번이 대신한다. 정예·보스는 항상 들린다. */
  kill({ boss = false, elite = false } = {}) {
    if (!this.enabled || !this.mix.sfx || !this.ctx) return null;
    const now = this.now();
    while (this._killTimes.length && now - this._killTimes[0] >= 0.3) this._killTimes.shift();
    this._killTimes.push(now);
    while (this._killRecent.length && now - this._killRecent[0] >= 0.08) this._killRecent.shift();
    const premium = boss || elite;
    let spec = boss ? KILL_SOUND.boss : elite ? KILL_SOUND.elite : KILL_SOUND.normal;
    if (!premium) {
      if (this._killTimes.length >= 5 && now - this._killMassAt > 0.35) { spec = KILL_SOUND.mass; this._killMassAt = now; }
      else if (this._killRecent.length >= 2) return null;
    }
    this._killRecent.push(now);
    const variant = spec.id === 'k_pop' ? this._variant('k_pop') : 0, name = hitSoundName(spec.id, variant);
    if (!this.buffers[name]) {
      // 샘플이 없을 때는 기존 합성음으로 최소한의 확정음을 낸다.
      this.thump({ vol: boss ? 0.8 : 0.4, freq: boss ? 50 : 84, dur: boss ? 0.5 : 0.18 }); this.contactSnap({ vol: 0.12, freq: 1500 });
      return null;
    }
    // 연속 처치가 이어질수록 음이 살짝 올라가 쾌감이 쌓인다(상한 +12%).
    const climb = Math.min(0.12, Math.max(0, this._killTimes.length - 1) * 0.02);
    return this.play(name, { vol: spec.vol, rate: 1 + climb, vary: 0.05, min: premium ? 0 : 0.006, priority: spec.priority });
  }

  /** 콤보 수가 10/25/50 을 처음 넘을 때 스팅어 한 번. 콤보가 줄어든(끊긴) 뒤에는 다시 장전된다. */
  comboStep(count) {
    if (!Number.isFinite(count)) return null;
    if (count < this._comboLast) this._comboFired.clear();
    this._comboLast = count;
    let hit = null;
    for (const stinger of COMBO_STINGERS) if (count >= stinger.at && !this._comboFired.has(stinger.at)) { this._comboFired.add(stinger.at); hit = stinger; }
    if (!hit || !this.enabled || !this.mix.sfx || !this.ctx) return null;
    const name = comboSoundName(hit);
    if (hit.duck) this.duck(hit.duck, hit.at >= 50 ? 1.1 : 0.7, { hold: hit.at >= 50 ? 0.25 : 0.12, smooth: true });
    if (!this.buffers[name]) return null;
    this.vibe(hit.at >= 50 ? [20, 20, 50] : hit.at >= 25 ? [15, 15, 30] : 10);
    return this.play(name, { vol: hit.vol, vary: 0, min: 0, priority: 5 });
  }

  /** 궁극기 BGM 덕킹: 빠르게 눌렀다가(attack) 잠깐 유지(hold)하고 부드러운 S 곡선으로 돌아온다(recover). */
  ultimateDuck({ amount = 0.12, hold = 0.9, recover = 1.6 } = {}) {
    this.duck(amount, hold + recover + 0.06, { hold, smooth: true, attack: 0.06 });
  }

  /** 공격 시작과 접촉 사이를 분리해 입력 순간과 실제 타격 순간을 귀로 읽게 한다. */
  attackRelease({ weapon = 'blade', finisher = false, ranged = false } = {}) {
    if (this.enabled && this.mix.sfx && this.ctx) {
      const hero = heroForWeapon(weapon); this._heroWeapon = weapon; this.preloadHero(hero);
      const sample = attackSound(weapon, ranged, { finisher, hero, variant: this._rotate(this._swingLast, hero, SWING_VARIANTS) });
      if (this.buffers[sample]) {
        this.play(sample, { vol: finisher ? .9 : .62, vary: .035, min: .06, priority: finisher ? 4 : 2 });
      } else {
        const pitch = ranged ? 1.55 : weapon === '2h' ? 0.72 : weapon === 'dual' ? 1.22 : 1;
        this.whoosh({ vol: finisher ? 0.7 : 0.42, pitch, dur: finisher ? 0.32 : 0.2 });
        if (finisher) this.clang({ vol: 0.36, freq: ranged ? 2100 : 1700, dur: 0.22 });
        else this.contactSnap({ vol: 0.08, freq: ranged ? 2400 : 1850 });
      }
    }
    // 헛친 공격에는 명중 진동을 주지 않는다. 실제 접촉의 강한 펄스를 먼저 재시작하지 않게 한다.
  }

  /** 스킬 발동 시전음. 일반 공격과 다른 상승음으로 기술 입력을 구분한다. */
  skillRelease({ ult = false, school = 'arcane', hero = '' } = {}) {
    if (this.enabled && this.mix.sfx && this.ctx) {
      this.preloadHero(hero);
      const sample = skillSound(school, hero);
      if (this.buffers[sample]) {
        this.play(sample, { vol: ult ? .8 : .7, vary: .02, min: .08, priority: 5 });
        if (ult) { const impact = ultimateSound(hero); if (this.buffers[impact]) this.play(impact, { vol: .62, vary: 0, min: .2, priority: 5, delay: .18 }); this.ultimateDuck(); }
      } else {
        const base = school.includes('fire') ? 210 : school.includes('ice') ? 520 : school.includes('void') ? 150 : 360;
        if (ult) { this.charge({ vol: 0.5, dur: 0.52 }); this.thump({ vol: 0.5, freq: 52, dur: 0.24 }); this.ultimateDuck(); }
        else this.magic({ vol: 0.24, base, notes: [0, 3, 7], step: 0.035, type: school.includes('void') ? 'sawtooth' : 'triangle' });
      }
    }
    this.vibe(ult ? [20, 16, 42] : 10);
  }

  /** 몹 기술의 예고는 낮게, 짧게 울려 위험 인지를 먼저 전달한다. */
  enemyTelegraph({ kind = 'melee', boss = false, urgent = false } = {}) {
    if (this.enabled && this.ctx) {
      const fam = kind === 'soulrain' || kind === 'fan' || kind === 'magic' || kind.startsWith('role:') ? 'tele_magic' : kind === 'slam' || kind === 'crusher' ? 'tele_slam' : 'tele_melee';
      if (this._fx(fam, { vol: boss ? 0.42 : 0.24, rate: boss ? 0.85 : 1, priority: boss ? 4 : 2 })) { this.vibe(urgent || boss ? [10, 14, 24] : 7); return; }
      if (kind === 'soulrain' || kind === 'fan' || kind === 'magic' || kind.startsWith('role:')) this.charge({ vol: boss ? 0.34 : 0.18, dur: boss ? 0.58 : 0.36 });
      else if (kind === 'slam' || kind === 'crusher') this.thump({ vol: boss ? 0.34 : 0.18, freq: boss ? 54 : 76, dur: 0.24 });
      else this.whoosh({ vol: boss ? 0.3 : 0.14, pitch: 0.55, dur: 0.26 });
    }
    this.vibe(urgent || boss ? [10, 14, 24] : 7);
  }

  /** 예고가 끝나고 실제 판정이 발생하는 순간의 release. */
  enemyRelease({ kind = 'melee', boss = false, heavy = false } = {}) {
    if (this.enabled && this.ctx) {
      const fam = kind === 'soulrain' || kind === 'fan' || kind === 'magic' ? 'rel_magic' : heavy || kind === 'slam' || kind === 'crusher' ? 'rel_slam' : 'rel_melee';
      if (this._fx(fam, { vol: boss ? 0.5 : 0.26, rate: boss ? 0.85 : 1, priority: boss ? 4 : 2 })) { this.vibe(boss || heavy ? [18, 12, 38] : 12); return; }
      if (kind === 'soulrain' || kind === 'fan' || kind === 'magic') this.zap({ vol: boss ? 0.34 : 0.18, dur: 0.22 });
      else if (heavy || kind === 'slam' || kind === 'crusher') this.boom({ vol: boss ? 0.54 : 0.26, dur: 0.34, low: boss ? 48 : 68 });
      else this.whoosh({ vol: boss ? 0.42 : 0.22, pitch: 0.62, dur: 0.18 });
    }
    this.vibe(boss || heavy ? [18, 12, 38] : 12);
  }

  dodgeRelease({ perfect = false } = {}) {
    if (this.enabled && this.ctx && !this._fx(perfect ? 'dodge_perfect' : 'dodge', { vol: perfect ? 0.62 : 0.5, priority: 3 })) this.whoosh({ vol: perfect ? 0.62 : 0.48, pitch: perfect ? 1.05 : 0.72, dur: 0.24 });
    this.vibe(perfect ? [12, 20, 32] : 15);
  }

  // ---------- BGM ----------
  _disposeMusic(track) {
    clearTimeout(track.timer); track.el.pause(); track.src.disconnect(); track.gain.disconnect();
    this._musicTracks.delete(track);
  }
  playMusic(name, { fade = 1.2, volume = 0.55 } = {}) {
    if (!this.ctx) return;
    if (!this.musicOn) { this._pendingMusic = name; this._pendingMusicOptions = { fade, volume }; return; }
    if (this.musicName === name && this.music) return;
    fade = Number.isFinite(fade) ? Math.max(0, Math.min(10, fade)) : 1.2;
    volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.55;
    this.musicName = name;
    const old = this.music;
    // Keep only one fading tail even under rapid scene changes.
    for (const track of [...this._musicTracks]) if (track !== old) this._disposeMusic(track);
    if (old) { const g = old.gain; g.gain.cancelScheduledValues(this.now()); g.gain.setValueAtTime(g.gain.value, this.now()); g.gain.linearRampToValueAtTime(0, this.now() + fade); old.timer = setTimeout(() => this._disposeMusic(old), fade * 1000 + 100); }
    if (!name) { this.music = null; return; }
    const el = new Audio(`/bgm/${name}.mp3`); el.loop = true; el.crossOrigin = 'anonymous'; el.preload = 'auto';
    const src = this.ctx.createMediaElementSource(el); const g = this.ctx.createGain(); g.gain.value = 0; src.connect(g); g.connect(this.musicGain);
    el.play().catch(() => {});
    g.gain.linearRampToValueAtTime(volume, this.now() + fade);
    this.music = { el, gain: g, src, volume };
    this._musicTracks.add(this.music);
  }
  /** BGM 덕킹. options.hold: 최저 구간 유지 시간(초), smooth: 복귀를 S 곡선으로, attack: 내려가는 시간(기본 0.1초). */
  duck(amount = 0.25, dur = 1.5, { hold = 0, smooth = false, attack = 0.1 } = {}) {
    if (!this.musicDuckGain) return;
    const t = this.now(), g = this.musicDuckGain.gain;
    amount = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 1;
    dur = Number.isFinite(dur) ? Math.max(0.11, Math.min(30, dur)) : 1.5;
    attack = Number.isFinite(attack) ? Math.max(0.01, Math.min(attack, dur - 0.01)) : 0.1;
    hold = Number.isFinite(hold) ? Math.max(0, Math.min(hold, dur - attack - 0.01)) : 0;
    this._ducks = this._ducks.filter(d => d.end > t);
    this._ducks.push({ start: t, attack: t + attack, hold: t + attack + hold, end: t + dur, amount, smooth: !!smooth });
    // At most 32 envelopes; merge excess into a conservative stronger tail.
    if (this._ducks.length > 32) {
      const merged = this._ducks.splice(0, 2);
      this._ducks.unshift({ start: t - 0.1, attack: t, hold: t, end: Math.max(...merged.map(d => d.end)), amount: Math.min(...merged.map(d => d.amount)), smooth: false });
    }
    const value = (d, at) => {
      if (at <= d.start || at >= d.end) return 1;
      if (at < d.attack) return 1 + (d.amount - 1) * (at - d.start) / (d.attack - d.start);
      if (at <= d.hold) return d.amount;
      const u = (at - d.hold) / (d.end - d.hold);
      return d.amount + (1 - d.amount) * (d.smooth ? u * u * (3 - 2 * u) : u);
    };
    const level = at => Math.min(1, ...this._ducks.map(d => value(d, at)));
    // S 곡선 복귀는 12구간으로 쪼개 선형 램프로 근사한다.
    const knots = this._ducks.flatMap(d => d.smooth ? Array.from({ length: 11 }, (_, k) => d.hold + (d.end - d.hold) * (k + 1) / 12) : []);
    const bounds = [...new Set([t, ...this._ducks.flatMap(d => [d.attack, d.hold, d.end]).concat(knots).filter(x => x > t)])].sort((a, b) => a - b);
    const times = [...bounds];
    // Add crossings, so a weaker newer duck cannot erase a stronger older one.
    for (let k = 1; k < bounds.length; k++) {
      const a = bounds[k - 1], b = bounds[k];
      for (let i = 0; i < this._ducks.length; i++) for (let j = i + 1; j < this._ducks.length; j++) {
        const da = value(this._ducks[i], a) - value(this._ducks[j], a), db = value(this._ducks[i], b) - value(this._ducks[j], b);
        if (da * db < 0) times.push(a + (b - a) * da / (da - db));
      }
    }
    g.cancelScheduledValues(t); g.setValueAtTime(level(t), t);
    for (const at of [...new Set(times)].sort((a, b) => a - b)) if (at > t) g.linearRampToValueAtTime(level(at), at);
  }
  setMusicOn(on) {
    if (this.musicOn === !!on) return;
    this.musicOn = !!on;
    if (!on) {
      this._pendingMusic = this.musicName; this._pendingMusicOptions = { volume: this.music?.volume ?? 0.55 };
      for (const track of [...this._musicTracks]) this._disposeMusic(track);
      this.music = null; this.musicName = null;
    } else if (this._pendingMusic) this.playMusic(this._pendingMusic, this._pendingMusicOptions);
    this.setMix();
  }
  setSfxOn(on) { this.enabled = !!on; if (!on) { clearTimeout(this._hitTimer); this._hitTimer = null; this._hitPending = null; this._hitRecent = []; this._killRecent = []; this._stopVoices('sfx'); } this.setMix(); }

  // ---------- 햅틱 ----------
  vibe(pattern) {
    // A crowd is one short pulse, not dozens of calls restarting the motor.
    try {
      if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
      if (pattern === 0) { this._vibeAt = -Infinity; return navigator.vibrate(0); }
      if (!this.haptics || (typeof document !== 'undefined' && document.hidden)) return false;
      const values = (Array.isArray(pattern) ? pattern : [pattern]).slice(0,5);
      if (!values.length || values.some(v => !Number.isFinite(v) || v < 0)) return false;
      const now = performance.now(); if (now - (this._vibeAt ?? -Infinity) < 85) return false;
      const safe = values.map(v => Math.min(60, Math.round(v)));
      const accepted = navigator.vibrate(safe.length === 1 ? safe[0] : safe);
      if (accepted) this._vibeAt = now;
      return accepted;
    } catch { return false; }
  }
}

export const audio = new AudioSys();
