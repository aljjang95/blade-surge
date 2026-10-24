// 실제 빌드(vite preview)·실제 Chromium 오디오 그래프에서 게임플레이 소리를 녹음한다.
// node tools/audio/audio-capture-qa.mjs --out <폴더> [--seconds=60] [--stage=1-5] [--root=<빌드 루트>]
// 마스터 출력(ctx.destination)으로 가는 연결을 MediaRecorder 로 함께 받고, 재생된 샘플·BGM 의 URL 타임라인을 남긴다.
// 입력은 실제 터치(시작 버튼)와 게임의 AUTO 전투다. 녹음은 소프트웨어 렌더라 실제 기기 성능·음질 판단이 아니다.
import { chromium } from 'playwright';
import { preview } from 'vite';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { installAutoStarter } from '../qa-starter.mjs';

const arg = (k, d = '') => process.argv.find(a => a.startsWith('--' + k + '='))?.slice(k.length + 3) ?? d;
const root = path.resolve(arg('root', path.resolve(import.meta.dirname, '../..')));
const out = path.resolve(arg('out', path.join(root, 'work/audio-capture')));
const seconds = Number(arg('seconds', '60'));
const [ch, st] = arg('stage', '1-5').split('-').map(Number);
await fs.mkdir(out, { recursive: true });

const server = await preview({ root, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
const url = 'http://127.0.0.1:' + server.httpServer.address().port;
const exe = (await fs.readdir('/opt/pw-browsers').catch(() => [])).filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`)[0];
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', locale: 'ko-KR' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await page.addInitScript(() => {
  const tags = new WeakMap(), log = globalThis.__audioLog = [], t0 = performance.now();
  const at = globalThis.__at = () => +((performance.now() - t0) / 1000).toFixed(3);
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const res = await origFetch(...args), u = String(args[0]?.url || args[0]);
    if (/\/(sfx|bgm)\//.test(u)) { const ab = res.arrayBuffer.bind(res); res.arrayBuffer = async () => { const b = await ab(); tags.set(b, u.replace(/^.*?\/(sfx|bgm)\//, '$1/')); return b; }; }
    return res;
  };
  const decode = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function (ab, ...rest) {
    const tag = tags.get(ab);
    return decode.call(this, ab, ...rest).then(buf => { if (tag) tags.set(buf, tag); return buf; });
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) { const tag = this.buffer && tags.get(this.buffer); log.push({ t: at(), kind: 'sfx', src: tag || 'synth-noise' }); return start.apply(this, a); };
  const oscStart = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (...a) { log.push({ t: at(), kind: 'synth', src: this.type }); return oscStart.apply(this, a); };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) { log.push({ t: at(), kind: 'bgm', src: String(this.src).replace(/^.*?\/bgm\//, 'bgm/') }); return play.apply(this, a); };
  // 마스터 출력으로 가는 연결을 녹음 노드에도 잇는다.
  const connect = AudioNode.prototype.connect, rec = globalThis.__rec = { chunks: [], started: false };
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = connect.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode) {
      const ctx = this.context;
      if (!ctx.__tap) {
        ctx.__tap = ctx.createMediaStreamDestination();
        const mr = new MediaRecorder(ctx.__tap.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
        mr.ondataavailable = e => { if (e.data.size) rec.chunks.push(e.data); };
        mr.start(1000); rec.started = at(); rec.mr = mr;
      }
      connect.call(this, ctx.__tap);
    }
    return r;
  };
});
await installAutoStarter(page); // 빈 저장 부팅 시 시작 영웅 선택 화면 자동 통과
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
if (await page.locator('#btn-ignore-rotate').isVisible().catch(() => false)) await page.locator('#btn-ignore-rotate').tap();
await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
await page.evaluate(() => {
  const a = window.app, e = a.eco;
  if (!e.reset()) throw Error('새 저장 격리 실패');
  e.s.daily.last = Math.floor(Date.now() / 86400000); e.s.tutorial = { completed: true };
  const h = e.hero(e.s.selected); h.level = 30; h.exp = 0; e.save();
});
await page.locator('#boot-start').tap({ force: true });
await page.waitForFunction(() => window.app?.mode === 'lobby', null, { timeout: 120000 });
const lobbyMark = await page.evaluate(() => globalThis.__at());
await page.waitForTimeout(6000); // 로비 곡 6초, 이후 전투 (seconds-6)초. 그 사이 로딩 구간은 녹음에서 잘라낸다.
await page.evaluate(async ({ ch, st }) => {
  const a = window.app, e = a.eco; a.ui.closeModal();
  e.s.energy = 9999; e.s.progress.unlocked = Math.max(e.s.progress.unlocked, (ch - 1) * 10 + st);
  let state = 0x5eed1022; Math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  a.journey.s.autoBattle = true;
  await a.startStage({ ch, st });
}, { ch, st });
await page.waitForFunction(() => window.app.battle?.active && !!window.app.battle.player, null, { timeout: 120000 });
await page.evaluate(() => { const a = window.app; a.battle.player.auto = true; a.ui.closeModal(); a.testPause = true; });
const battleMark = await page.evaluate(() => globalThis.__at());
// 소프트웨어 렌더는 너무 느려 실시간 전투가 거의 진행되지 않는다. 렌더 없이 app.step(1/60) 을 실제 시간과 같은 속도로 돌린다
// (250ms 마다 15스텝). 소리는 실제 게임 로직이 실제 시각에 낸다.
const tb = Date.now(), bossAt = Number(arg('boss-at', '30'));
let bossForced = false;
while (Date.now() - tb < (seconds - 6) * 1000) {
  const tick = Date.now();
  const alive = await page.evaluate(() => { const a = window.app; for (let i = 0; i < 15 && a.battle?.active; i++) a.step(1 / 60, false); return !!a.battle?.active; });
  if (!alive) break;
  if (!bossForced && Date.now() - tb > bossAt * 1000) {
    bossForced = await page.evaluate(() => {
      const b = window.app.battle, boss = b?.world?.rooms?.find(r => r.type === 'boss');
      if (!b?.active || !boss || b.bossFound) return !!b?.bossFound;
      b.player.pos.set(boss.x, b.player.pos.y, boss.z); return true;
    }).catch(() => false);
  }
  await page.waitForTimeout(Math.max(0, 250 - (Date.now() - tick)));
}
const result = await page.evaluate(async () => {
  const rec = globalThis.__rec; if (!rec.mr) return { ok: false };
  await new Promise(r => { rec.mr.onstop = r; rec.mr.stop(); });
  const blob = new Blob(rec.chunks, { type: 'audio/webm' });
  const bytes = new Uint8Array(await blob.arrayBuffer()); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { ok: true, b64: btoa(s), log: globalThis.__audioLog, recStarted: rec.started };
});
await page.screenshot({ path: path.join(out, 'capture-end.png'), timeout: 90000 }).catch(e => errors.push('screenshot: ' + e.message.split('\n')[0]));
await browser.close(); await new Promise(r => server.httpServer.close(r));
if (!result.ok) throw Error('녹음 노드가 연결되지 않았다');
const webm = path.join(out, 'capture.webm'), wav = path.join(out, 'capture.wav');
await fs.writeFile(webm, Buffer.from(result.b64, 'base64'));
const full = path.join(out, 'capture-full.wav');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', webm, '-ar', '48000', '-ac', '2', full]);
// 로비 6초 + 전투 (seconds-6)초를 이어 붙인 판정용 클립(로딩 대기 구간 제외).
const l0 = Math.max(0, lobbyMark - result.recStarted), b0 = Math.max(0, battleMark - result.recStarted);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', full, '-filter_complex',
  `[0]atrim=${l0}:${l0 + 6},asetpts=N/SR/TB[a];[0]atrim=${b0}:${b0 + seconds - 6},asetpts=N/SR/TB[b];[a][b]concat=n=2:v=0:a=1`, wav]);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-filter_complex', 'showwavespic=s=1600x300:split_channels=0:colors=0x44aaff', '-frames:v', '1', path.join(out, 'capture-wave.png')]);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-lavfi', 'showspectrumpic=s=1600x400:legend=1', path.join(out, 'capture-spectrum.png')]);
const meter = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', wav, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
const counts = {};
for (const e of result.log) if (e.kind !== 'synth') counts[e.src] = (counts[e.src] || 0) + 1;
const synthOsc = result.log.filter(e => e.kind === 'synth').length;
const summary = { url, lobbyMark, battleMark, clip: 'capture.wav = 로비 6초 + 전투 시작부터', stage: `${ch}-${st}`, seconds, bossForced, errors, recStarted: result.recStarted, events: result.log.length, synthOscillators: synthOsc,
  bgm: result.log.filter(e => e.kind === 'bgm'), topSources: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 40) };
await fs.writeFile(path.join(out, 'capture-log.json'), JSON.stringify({ summary, log: result.log }, null, 1));
console.log(JSON.stringify({ ...summary, topSources: summary.topSources.slice(0, 12) }, null, 1));
console.log(meter.split('\n').slice(-14).join('\n'));
