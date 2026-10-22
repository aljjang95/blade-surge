// 애니메이션 품질 감사(h3-feel): 다섯 영웅과 모든 몬스터 모델의 실제 클립을 같은 규칙으로 잰다.
// - 논리 키 해석: 적 Actor.A 와 같은 경로로 각 키가 직접 클립·폴백·대기 클립 중 무엇으로 풀리는지(난수는 막는다)
// - 발 미끄러짐: 달리기/걷기 클립의 디딤발 수평 속도(제자리 재생) 대 게임 이동 속도 비(1 = 일치)
// - 반복 이음새: 반복 클립(대기·달리기·걷기)의 첫 프레임과 끝 프레임 뼈 회전 차(도)
// - 정지/빈 클립: 트랙 없음·0.05초 미만·휴지 자세에서 거의 움직이지 않는 클립
// 측정은 게임 시간을 진행하지 않고 액터의 믹서 시각만 바꾼 뒤 원래 상태로 돌려놓는다.
// 사용: node tools/anim-audit-qa.mjs <distDir> <out.json>
import { chromium } from 'playwright';
import { preview } from 'vite';
import { launchOpts } from './chrome.mjs';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJ = fileURLToPath(new URL('..', import.meta.url));

/** 브라우저 안 측정. 직렬화되므로 바깥 변수를 쓰지 않는다. */
export function installAnimAudit() {
  const app = window.app, T = window.__THREE;
  const DEG = 57.29578;
  const angle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w))) * DEG;
  const bonesOf = root => { const out = []; root.traverse(o => { if (o.isBone) out.push(o); }); return out; };
  const feetOf = bones => {
    const named = bones.filter(b => /foot/i.test(b.name) && !/toe|end|top|ik|pole/i.test(b.name));
    const side = b => /(^|[^a-z])(l|left)([^a-z]|$)|\.l$|_l$|left/i.test(b.name.replace(/mixamorig:?/i, '')) ? 'L' : /(^|[^a-z])(r|right)([^a-z]|$)|\.r$|_r$|right/i.test(b.name.replace(/mixamorig:?/i, '')) ? 'R' : '?';
    const L = named.find(b => side(b) === 'L'), R = named.find(b => side(b) === 'R');
    return L && R ? [L, R] : named.slice(0, 2);
  };
  // 뼈 월드 위치는 골격 배율(예: Mixamo cm 골격 + 0.01 모델 배율)에 따라 화면과 다를 수 있다.
  // 그 뼈에 가장 크게 묶인 정점 하나를 실제 스키닝(getVertexPosition)으로 옮겨 화면 위치를 쓴다.
  const marker = (root, bone) => {
    let best = null;
    root.traverse(o => {
      if (!o.isSkinnedMesh) return; const bi = o.skeleton.bones.indexOf(bone); if (bi < 0) return;
      const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
      for (let i = 0; i < si.count; i++) for (let c = 0; c < 4; c++) if (si.getComponent(i, c) === bi) { const w = sw.getComponent(i, c); if (!best || w > best.w) best = { mesh: o, i, w }; }
    });
    return best;
  };
  const visual = (root, bone, out, cache) => {
    let m = cache.get(bone); if (m === undefined) { m = marker(root, bone); cache.set(bone, m); }
    if (!m) return out.setFromMatrixPosition(bone.matrixWorld);
    return m.mesh.getVertexPosition(m.i, out).applyMatrix4(m.mesh.matrixWorld);
  };
  /** clip 을 mixer 에서 단독 재생하며 t 들의 (뼈 쿼터니언, 발 화면 위치) 표본을 모은다. */
  const sample = (root, mixer, clip, n, feet, bones, origin) => {
    const cache = new Map();
    mixer.stopAllAction();
    const a = mixer.clipAction(clip); a.reset(); a.setLoop(T.LoopRepeat, Infinity); a.enabled = true; a.setEffectiveWeight(1); a.play();
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = clip.duration * i / n;
      mixer.setTime(Math.min(t, clip.duration - 1e-4));
      root.updateMatrixWorld(true);
      const fp = feet.map(f => { const v = visual(root, f, new T.Vector3(), cache); return [v.x - origin.x, v.y - origin.y, v.z - origin.z]; });
      const hv = visual(root, bones[0], new T.Vector3(), cache);
      out.push({ t, q: bones.map(b => b.quaternion.clone()), fp, hip: [hv.x - origin.x, hv.y - origin.y, hv.z - origin.z] });
    }
    a.stop();
    return out;
  };
  const stanceSpeed = (samples, fi) => {
    const ys = samples.map(s => s.fp[fi][1]), lo = Math.min(...ys), hi = Math.max(...ys);
    if (hi - lo < 1e-4) return null;
    const speeds = [];
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      if (a.fp[fi][1] > lo + (hi - lo) * .2 || b.fp[fi][1] > lo + (hi - lo) * .2) continue;
      speeds.push(Math.hypot(b.fp[fi][0] - a.fp[fi][0], b.fp[fi][2] - a.fp[fi][2]) / (b.t - a.t));
    }
    if (!speeds.length) return null;
    speeds.sort((x, y) => x - y); return speeds[speeds.length >> 1];
  };
  const clipStats = (root, mixer, clip, bones, feet, rest) => {
    const origin = root.getWorldPosition(new T.Vector3());
    const s = sample(root, mixer, clip, 48, feet, bones, origin);
    let motion = 0;
    for (const x of s) for (let i = 0; i < bones.length; i++) motion = Math.max(motion, angle(x.q[i], rest[i]));
    let seam = 0; const first = s[0], last = s[s.length - 1];
    for (let i = 0; i < bones.length; i++) seam = Math.max(seam, angle(first.q[i], last.q[i]));
    const stance = feet.length === 2 ? [stanceSpeed(s, 0), stanceSpeed(s, 1)].filter(v => v !== null) : [];
    // 뿌리(첫 뼈) 수평 이동: 제자리 클립이 아니면 반복마다 몸이 앞으로 갔다가 되돌아 튄다.
    const hx = s.map(x => x.hip[0]), hz = s.map(x => x.hip[2]);
    const rootRangeM = Math.round(Math.hypot(Math.max(...hx) - Math.min(...hx), Math.max(...hz) - Math.min(...hz)) * 100) / 100;
    const rootDriftM = Math.round(Math.hypot(last.hip[0] - first.hip[0], last.hip[2] - first.hip[2]) * 100) / 100;
    return { name: clip.name, dur: Math.round(clip.duration * 1000) / 1000, tracks: clip.tracks.length, rootRangeM, rootDriftM, rootBone: bones[0]?.name,
      maxFromRestDeg: Math.round(motion), seamDeg: Math.round(seam * 10) / 10,
      footStanceMps: stance.length ? Math.round(stance.reduce((a, b) => a + b, 0) / stance.length * 1000) / 1000 : null };
  };
  const q = {};
  q.heroes = async () => {
    const out = {};
    for (const id of ['knight', 'barbarian', 'mage', 'rogue', 'ranger']) {
      await app.showcaseHero(id, true);
      const s = app.showcase, root = s.root, bones = bonesOf(root), feet = feetOf(bones);
      s.mixer.stopAllAction(); s.mixer.update(0); root.updateMatrixWorld(true);
      const rest = bones.map(b => b.quaternion.clone());
      const def = s.def, clips = {};
      for (const name of ['Idle', 'Running_A', 'Dodge_Forward', 'Hit_A', 'Hit_B', 'Death_A', 'Death_B', ...def.combo.map(c => c.anim), ...def.skills.map(k => k.anim)]) {
        if (clips[name] !== undefined) continue;
        const clip = s.clips[name]; clips[name] = clip ? clipStats(root, s.mixer, clip, bones, feet, rest) : 'MISSING';
      }
      const run = clips.Running_A;
      // Player.handleInput: 달리기 배율 (1.1 + sprint*.35), 속도 spd*(1 + sprint*.45)
      const spd = def.base.spd;
      out[id] = { feet: feet.map(f => f.name), spd, clips,
        runSlide: run && run.footStanceMps ? { walkStart: Math.round(spd / (run.footStanceMps * 1.1) * 100) / 100, sprint: Math.round(spd * 1.45 / (run.footStanceMps * 1.45) * 100) / 100 } : null };
      s.mixer.stopAllAction(); s.idleAction.reset().play(); s.mixer.update(0);
    }
    return out;
  };
  q.monsters = () => {
    const b = app.battle, room = b.world.startRoom, out = {};
    const KEYS = ['idle', 'idleCombat', 'walk', 'run', 'back', 'attack', 'attack2', 'attackHeavy', 'attackSpin', 'attackJump', 'cast', 'summon', 'raise', 'hit', 'hitHeavy', 'death', 'dodge', 'spawn', 'dash'];
    for (const [id, def] of Object.entries(window.__EN)) {
      const key = def.model + '@' + (def.scale || 1);
      if (out[key]) { out[key].species.push(id); continue; }
      const e = b.spawnEnemy(id, null, room, new T.Vector3(room.x + 6, 0, room.z + 6));
      if (!e) { out[key] = { species: [id], error: 'spawn failed' }; continue; }
      // 등장 팝인(popIn)이 첫 프레임 모델 배율을 0 으로 두므로 측정 동안 최종 배율로 고정한다.
      const scale0 = e.model.scale.x; e.model.scale.setScalar(e.modelScale);
      try {
        e.root.updateMatrixWorld(true);
        const bones = bonesOf(e.model), feet = feetOf(bones);
        e.mixer.stopAllAction(); e.mixer.update(0); e.model.updateMatrixWorld(true);
        const rest = bones.map(x => x.quaternion.clone());
        const keys = {};
        const before = Math.random; Math.random = () => 0;
        try { for (const k of KEYS) { const name = e.A(k); keys[k] = { clip: name, direct: [].concat(e.rig[k] || []).includes(name) }; } } finally { Math.random = before; }
        const used = new Set(Object.values(keys).map(k => k.clip));
        const clips = {};
        for (const name of used) { const clip = e.clips[name]; clips[name] = clip ? clipStats(e.model, e.mixer, clip, bones, feet, rest) : 'MISSING'; }
        const loco = def.spd < 4 ? keys.walk.clip : keys.run.clip, st = clips[loco];
        const animSpeed = def.spd > 5 ? 1.2 : 1;
        out[key] = { species: [id], model: def.model, rig: e.rigName, scale: def.scale || 1, library: e.libraryAsset?.id || null,
          spd: def.spd, feet: feet.map(f => f.name), keys, clips,
          locomotion: { clip: loco, animSpeed, slide: st && st.footStanceMps ? Math.round(def.spd / (st.footStanceMps * animSpeed) * 100) / 100 : null } };
      } finally { e.model.scale.setScalar(scale0); e.dispose(); b.enemies.splice(b.enemies.indexOf(e), 1); }
    }
    return out;
  };
  window.__animAudit = q;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [distArg = 'dist', outArg = '/tmp/claude-0/lanes-shots/h3-feel/anim-audit.json'] = process.argv.slice(2);
  const server = await preview({ root: PROJ, configFile: false, build: { outDir: resolve(PROJ, distArg) }, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch(launchOpts({ headless: true }));
  try {
    const page = await (await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' })).newPage();
    page.setDefaultTimeout(900000);
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto(origin);
    await page.locator('#boot-start:not(.hidden)').waitFor();
    await page.evaluate(() => { const eco = window.app.eco; eco.reset(); eco.s.tutorial = { completed: true }; eco.s.daily.last = Math.floor(Date.now() / 86400000); for (const h of ['knight', 'barbarian', 'mage', 'rogue', 'ranger']) if (!eco.ownHero(h)) eco.grantHero(h); eco.save(); });
    await page.locator('#boot-start').click();
    await page.waitForFunction(() => window.app.mode === 'lobby' && !document.getElementById('boot').classList.contains('show'));
    await page.evaluate(() => { window.app.ui.closeModal(); window.app.testPause = true; });
    await page.evaluate(installAnimAudit);
    const heroes = await page.evaluate(() => window.__animAudit.heroes());
    await page.evaluate(async () => { const app = window.app; app.eco.s.selected = 'knight'; if (await app.startStage(app.eco.nextStage()) !== true) throw Error('출격 실패'); app.battle.player.auto = false; app.companionAgent?.endBattle?.(); });
    const monsters = await page.evaluate(() => window.__animAudit.monsters());
    writeFileSync(resolve(outArg), JSON.stringify({ dist: resolve(PROJ, distArg), heroes, monsters }, null, 1));
    console.log('ok', outArg, Object.keys(monsters).length);
  } finally { await browser.close(); await new Promise(r => server.httpServer.close(r)); }
}
