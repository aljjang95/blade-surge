// 실제 AudioSys(hit 버스 컴프레서 + 소프트 클립 체인)를 헤드리스 Chromium 의 OfflineAudioContext 로 렌더해
// 타격·처치·콤보의 피크(dBFS)·첫 150ms 에너지·풀스케일 샘플 수를 잰다. LEGACY 는 hit-v2 버퍼를 지운 기존 합성 경로다.
// 사용: (다른 터미널에서 `bun run dev`) → BASE_URL=http://127.0.0.1:5173 node tools/audio/measure-hit-chain.mjs
// 귀로 듣는 검증이 아니라 수치 점검이다. playwright 와 Chromium(PLAYWRIGHT_BROWSERS_PATH 또는 /opt/pw-browsers)이 필요하다.
import { readdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173';
const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const exe = readdirSync(browsers).filter(d => d.startsWith('chromium_headless_shell'))[0];
const browser = await chromium.launch({
  executablePath: `${browsers}/${exe}/chrome-linux/headless_shell`,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
const problems = [];
page.on('console', m => { if (['error'].includes(m.type())) problems.push(`console.${m.type()}: ${m.text()}`); });
page.on('pageerror', e => problems.push('pageerror: ' + e.message));
page.on('requestfailed', r => problems.push('requestfailed: ' + r.url()));
page.on('response', r => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
await page.goto(`${BASE}/sfx/hit-v2/manifest.json`);

const result = await page.evaluate(async () => {
  const { AudioSys } = await import('/src/engine/audio.js');
  const sr = 44100;
  async function make(legacy, seconds) {
    const off = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
    Object.defineProperty(off, 'state', { get: () => 'running' });
    const Original = window.AudioContext; window.AudioContext = function () { return off; };
    const sys = new AudioSys(); await sys.init(); window.AudioContext = Original;
    if (legacy) for (const k of Object.keys(sys.buffers)) if (k.startsWith('hit-v2/')) delete sys.buffers[k];
    sys.vibe = () => {};
    return { sys, off };
  }
  // 오프라인 컨텍스트는 렌더 전 currentTime 이 0 에 멈춘다. suspend 로 시각마다 이벤트를 넣는다.
  async function scenario(legacy, seconds, events) {
    const { sys, off } = await make(legacy, seconds);
    const times = [...new Set(events.map(e => Math.round(e.at * 1000) / 1000))].sort((a, b) => a - b);
    for (const t of times) {
      const quantum = Math.max(128 / sr, Math.round(t * sr / 128) * 128 / sr);
      off.suspend(quantum).then(() => { for (const e of events.filter(x => Math.round(x.at * 1000) / 1000 === t)) e.run(sys); off.resume(); });
    }
    const out = (await off.startRendering());
    const ch = out.getChannelData(0);
    let peak = 0, sum = 0, n = 0, over = 0;
    for (const v of ch) { const a = Math.abs(v); if (a > peak) peak = a; if (a >= 0.999) over++; if (a > 1e-4) { sum += v * v; n++; } }
    let e150 = 0; const s0 = Math.floor((times[0] ?? 0) * sr); for (let i = s0; i < s0 + sr * .15; i++) e150 += ch[i] * ch[i];
    return { peakDb: +(20 * Math.log10(peak)).toFixed(1), peak: +peak.toFixed(3), samplesAtFullScale: over, rmsDbActive: +(10 * Math.log10(sum / Math.max(1, n))).toFixed(1), e150Db: +(10 * Math.log10(e150 / (sr * .15))).toFixed(1) };
  }
  const one = (fn) => [{ at: .05, run: fn }];
  const singles = {
    'basic slash': s => s.hit('slash', {}),
    'basic blunt': s => s.hit('blunt', {}),
    'basic magic': s => s.hit('magic', {}),
    'heavy slash': s => s.hit('slash', { heavy: true }),
    'crit slash': s => s.hit('slash', { crit: true, heavy: true }),
    'finisher': s => s.hit('slash', { heavy: true, finisher: true }),
    'finisher crit': s => s.hit('slash', { heavy: true, finisher: true, crit: true }),
    'counter': s => s.hit('slash', { heavy: true, finisher: true, counter: true }),
    'boss finisher crit': s => s.hit('slash', { heavy: true, finisher: true, crit: true, boss: true }),
  };
  const report = { single: {} };
  for (const [name, fn] of Object.entries(singles)) {
    report.single[name] = { NEW: await scenario(false, 1.2, one(fn)), LEGACY: await scenario(true, 1.2, one(fn)) };
  }
  report.single['kill normal'] = { NEW: await scenario(false, 1, one(s => s.kill())) };
  report.single['kill elite'] = { NEW: await scenario(false, 1, one(s => s.kill({ elite: true }))) };
  report.single['kill boss'] = { NEW: await scenario(false, 2, one(s => s.kill({ boss: true }))) };
  for (const n of [10, 25, 50]) report.single[`combo ${n}`] = { NEW: await scenario(false, 2.2, one(s => { s.comboStep(n - 1); s.comboStep(n); })) };
  // 몹몰이 3초: 8ms 마다 타격(종류·등급 혼합), 가끔 치명타/마무리, 처치는 4개마다.
  const crowd = [];
  for (let i = 0; i < 300; i++) {
    const at = .05 + i * .008, kind = ['slash', 'slash', 'blunt', 'magic'][i % 4];
    crowd.push({ at, run: s => { s.hit(kind, i % 40 === 39 ? { heavy: true, finisher: true } : i % 9 === 8 ? { crit: true, heavy: true } : {}); if (i % 4 === 3) s.kill(); } });
  }
  report.crowd = { NEW: await scenario(false, 3.4, crowd), LEGACY: await scenario(true, 3.4, crowd) };
  // 보스전: 120ms 마다 보스 강타, 1초마다 마무리, 궁극기는 콤보 50 스팅어와 함께.
  const boss = [];
  for (let i = 0; i < 30; i++) boss.push({ at: .05 + i * .12, run: s => s.hit('slash', i % 8 === 7 ? { heavy: true, finisher: true, crit: true, boss: true } : { heavy: true, boss: true }) });
  boss.push({ at: 1.5, run: s => { s.comboStep(49); s.comboStep(50); s.kill({ boss: true }); } });
  report.bossFight = { NEW: await scenario(false, 4.4, boss), LEGACY: await scenario(true, 4.4, boss) };
  return report;
});
console.log(JSON.stringify(result, null, 1));
console.log('PROBLEMS', JSON.stringify(problems));
await browser.close();
