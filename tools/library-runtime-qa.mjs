/**
 * TLL 에셋 라이브러리 런타임 QA — manifest 의 교체 몬스터가 실제 전투에서 Tripo 모델로 스폰되고
 * 논리 애니메이션(idle/run/attack/hit/death)이 재생되는지 단언하고 화면을 남긴다.
 * 영웅 모드: manifest 의 role:'hero' 항목(갑옷 단계·클립 공유·손 소켓·콤보·스킬)을 단언한다. 항목이 없으면 SKIP 을 보고한다.
 *   node tools/library-runtime-qa.mjs [출력폴더=work/library-qa] [--hero-fixture]
 * 전제: bun run build 산출물(dist)을 vite preview 로 띄운다.
 * --hero-fixture: 정본 manifest 는 그대로 두고, 임시 빌드(work/tmp/hero-fixture-dist)에만 bone_knight.glb 기반
 *   hero_knight_t1(클립 보유)·hero_knight_t2(애니메이션 제거, 클립 공유) 항목을 주입해 영웅 계약 경로를 검증한다.
 */
import { chromium } from 'playwright';
import { CHROME } from './chrome.mjs';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { MONSTER_ROSTER } from '../src/data/monster-roster.js';
import { installAutoStarter } from './qa-starter.mjs';

const PROJ = resolve(decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'));
const argv = process.argv.slice(2), heroFixture = argv.includes('--hero-fixture');
const PORT = 4231, OUT = resolve(PROJ, argv.find((value) => !value.startsWith('--')) || 'work/library-qa');
mkdirSync(OUT, { recursive: true });
const manifest = JSON.parse(readFileSync(resolve(PROJ, 'asset-library/manifest.json'), 'utf8'));
const fixtureGlb = {};
let outDir = null;
if (heroFixture) {
  // 정본 manifest 의 실제 영웅 항목과 id 가 겹치지 않도록 픽스처 실행에서는 실제 영웅 항목을 뺀다.
  manifest.assets = manifest.assets.filter((asset) => asset.role !== 'hero');
  const base = manifest.assets.find((asset) => asset.id === 'bone_knight');
  if (!base) throw new Error('hero fixture requires the bone_knight library asset');
  const fixture = (id, armorTier, clips) => ({ ...base, id, replaces: null, file: '/models/library/' + id + '.glb', role: 'hero', heroId: 'knight', armorTier, clips });
  const assets = [
    fixture('hero_knight_t1', 1, { idle: 'idle', run: 'run', dodge: 'run', hit: 'hit', death: 'death', slash_h: 'attack', chop: 'attackHeavy' }),
    fixture('hero_knight_t2', 2, {}),
  ];
  manifest.assets.push(...assets);
  const bytes = readFileSync(resolve(PROJ, 'asset-library/normalized/bone_knight.glb'));
  fixtureGlb.hero_knight_t1 = bytes; fixtureGlb.hero_knight_t2 = stripAnimations(bytes);
  outDir = resolve(PROJ, 'work/tmp/hero-fixture-dist');
  const { build, loadConfigFromFile, mergeConfig } = await import('vite');
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, resolve(PROJ, 'vite.config.js'));
  // refresh-engraving-assets 는 정본 dist 의 오래된 판화 폴더만 지운다. 새로 비우는 임시 폴더에는 필요 없다.
  const projectConfig = { ...loaded.config, plugins: (loaded.config.plugins || []).filter((plugin) => plugin?.name !== 'refresh-engraving-assets') };
  await build(mergeConfig(projectConfig, { configFile: false, root: PROJ, logLevel: 'warn', build: { outDir, emptyOutDir: true }, plugins: [{
    name: 'tll-hero-library-fixture', enforce: 'pre',
    load(id) {
      if (!id.replace(/\\/g, '/').endsWith('asset-library/manifest.json')) return null;
      const value = JSON.parse(readFileSync(id, 'utf8')); value.assets = value.assets.filter((asset) => asset.role !== 'hero'); value.assets.push(...assets); return JSON.stringify(value);
    },
  }] }));
}
/** 메시·스킨만 남긴 GLB. 메시 전용 단계가 1단계 클립을 공유하는 경로를 재현한다. */
function stripAnimations(bytes) {
  const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + length).toString());
  delete json.animations;
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
  const rest = bytes.subarray(20 + length), header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + text.length + rest.length, 8);
  header.writeUInt32LE(text.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, text, rest]);
}
const srv = spawn(process.execPath, [resolve(PROJ, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', ...(outDir ? ['--outDir', outDir] : [])], { cwd: PROJ, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://localhost:${PORT}/`)).ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 500)); }
if (!up) { srv.kill(); throw new Error('preview server did not start'); }

const br = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
// 픽스처 GLB 는 page.route 로 공급하므로 fetch 를 가로채는 PWA 서비스 워커를 픽스처 모드에서만 막는다.
const page = await (await br.newContext({ viewport: { width: 1280, height: 720 }, ...(heroFixture ? { serviceWorkers: 'block' } : {}) })).newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
for (const [id, body] of Object.entries(fixtureGlb)) await page.route('**/models/library/' + id + '.glb', (r) => r.fulfill({ status: 200, contentType: 'model/gltf-binary', body }));
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 240)));
// 라이브러리 폴백 사유는 console.warn 으로만 남으므로 따로 모아 영웅 모드 판정과 결과 파일에 기록한다.
const fallbacks = [];
page.on('console', async (m) => {
  if (m.type() !== 'warning' || !/library asset failed|hero tier body failed/.test(m.text())) return;
  const parts = await Promise.all(m.args().map((arg) => arg.evaluate((v) => (v instanceof Error ? v.message + ' | ' + (v.stack || '').split('\n').slice(0, 4).join(' / ') : String(v))).catch(() => '?')));
  fallbacks.push(parts.join(' :: ').slice(0, 600)); console.log('WARN ' + fallbacks.at(-1));
});
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'OK   ' : 'FAIL ') + name, detail ?? ''); };
try {
  await installAutoStarter(page); // 빈 저장 부팅 시 시작 영웅 선택 화면 자동 통과
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 120000 });
  await page.evaluate(() => { const e = window.app.eco; e.s.daily.last = Math.floor(Date.now() / 86400000); e.save(); });
  await page.click('#boot-start', { force: true }); await page.waitForTimeout(1500);
  await page.evaluate(() => window.app.ui.closeModal?.());
  const heroIds = [...new Set(manifest.assets.filter((a) => a.kind === 'character' && a.role === 'hero').map((a) => a.heroId))];
  if (!heroIds.length) {
    results.push({ name: '영웅 모드', ok: true, skipped: true, detail: "manifest 에 role:'hero' 항목 없음" });
    console.log("SKIP 영웅 모드: manifest 에 role:'hero' 항목 없음 (--hero-fixture 로 계약 경로만 검증 가능)");
  }
  for (const heroId of heroIds) {
    // 앞 영웅의 전투 검사가 남긴 testPause·battle 상태를 정리해야 로비 쇼케이스 믹서가 다시 돈다.
    await page.evaluate(() => { const a = window.app; a.battle?.stop?.(); a.testPause = false; if (a.mode !== 'lobby') a.toLobby(); });
    const tiers = manifest.assets.filter((a) => a.role === 'hero' && a.heroId === heroId);
    const expected = (tier) => tiers.filter((a) => (a.armorTier || 1) <= tier).sort((a, b) => (b.armorTier || 1) - (a.armorTier || 1))[0]?.id || null;
    // A. 1단계 로드·축 보정 손 소켓·기존 무기 노드
    const base = await page.evaluate(async (heroId) => {
      const a = window.app, e = a.eco;
      e.s.selected = heroId; e.s.heroes[heroId].equip.armor = null;
      await a.showcaseHero(heroId);
      const s = a.showcase, root = s.root, c = root.userData.authoredContract, T = window.__THREE;
      const socket = (key) => (c?.sockets?.[key] ? root.getObjectByName(c.sockets[key]) : null);
      const shown = (node) => (node ? node.children.filter((n) => n.visible).map((n) => ({ name: n.name, forged: n.userData.forgedWeapon || null })) : []);
      root.updateMatrixWorld(true);
      // 활 영웅처럼 주무기를 왼손에 드는 경우도 단조 무기가 있는 손을 잰다.
      const weapon = [socket('handslot.r'), socket('handslot.l')].flatMap((node) => node ? node.children.filter((n) => n.visible && n.userData.forgedWeapon) : [])[0]
        || socket('handslot.r')?.children.find((n) => n.visible), size = new T.Vector3();
      if (weapon) new T.Box3().setFromObject(weapon).getSize(size);
      return { library: a.models[s.def.model]?.scene.userData.libraryAsset?.id || null, role: c?.role, heroId: c?.heroId, body: root.userData.libraryBodyAssetId,
        right: shown(socket('handslot.r')), left: shown(socket('handslot.l')), show: s.def.show, handBones: c?.handBones || null,
        weaponSize: Math.max(size.x, size.y, size.z), missing: [...s.def.combo, ...s.def.skills].map((x) => x.anim).filter((n) => !s.clips[n]) };
    }, heroId);
    const visible = [...base.right, ...base.left].map((n) => n.name);
    check(`${heroId}: 1단계 라이브러리 로드`, base.library === expected(1) && base.body === expected(1), `${base.library} / body ${base.body}`);
    check(`${heroId}: ModelContract hero·Mixamo 손 본`, base.role === 'hero' && base.heroId === heroId && !!base.handBones?.r && !!base.handBones?.l, JSON.stringify(base.handBones));
    check(`${heroId}: 손 소켓 무기·보조 표시`, base.show.every((name) => visible.includes(name)) && [...base.right, ...base.left].some((n) => n.forged), JSON.stringify({ right: base.right, left: base.left }));
    check(`${heroId}: 무기 크기 정상`, base.weaponSize > 0.3 && base.weaponSize < 3, base.weaponSize.toFixed(3));
    check(`${heroId}: 콤보·스킬 클립 별칭`, base.missing.length === 0, base.missing.join(','));
    await page.screenshot({ path: `${OUT}/${heroId}-tier1.png` });
    // B. 장착 갑옷 단계 → 몸체 교체(가장 가까운 낮은 단계), 같은 리그·같은 클립 객체
    for (const [label, entry, tier] of [['갑옷 정의 appearanceTier 2', { id: 'a_town_ember' }, 2], ['인스턴스 appearanceTier 3', { id: 'a_leather', appearanceTier: 3 }, 3]]) {
      const want = expected(tier);
      await page.evaluate(async ({ heroId, entry }) => {
        const a = window.app, e = a.eco, uid = e.s.invSeq++;
        e.s.inventory.push({ uid, enh: 0, ...entry }); e.s.heroes[heroId].equip.armor = uid;
        await a.showcaseHero(heroId);
      }, { heroId, entry });
      await page.waitForFunction((want) => window.app.showcase?.root.userData.libraryBodyAssetId === want, want, { timeout: 20000 }).catch(() => {});
      const info = await page.evaluate(async () => {
        const a = window.app, s = a.showcase, root = s.root; let body = null, count = 0;
        root.traverse((n) => { if (n.isSkinnedMesh && n.userData.libraryBody) { body = n; count++; } });
        const inRig = (n) => { for (let p = n; p; p = p.parent) if (p === root) return true; return false; };
        // 교체 직후에는 GLB 디코드·무기 단조로 프레임이 멈출 수 있어 최대 3초 동안 본 자세 변화를 여러 번 샘플링한다.
        const pose = () => (body ? body.skeleton.bones.flatMap((b) => b.quaternion.toArray()) : []);
        const first = pose(); let animated = false;
        for (let k = 0; k < 12 && body && !animated; k++) {
          await new Promise((r) => setTimeout(r, 250));
          animated = pose().some((v, i) => Math.abs(v - first[i]) > 1e-5);
        }
        return { body: root.userData.libraryBodyAssetId, tier: root.userData.libraryHeroTier, count, rigShared: !!body && body.skeleton.bones.every(inRig),
          clipShared: !!s.clips.Idle && a.models[s.def.model].animations.includes(s.clips.Idle), animated };
      });
      check(`${heroId}: ${label} → ${want}`, info.body === want && info.count > 0, JSON.stringify(info));
      check(`${heroId}: ${label} 같은 리그·공유 클립·애니메이션 재생`, info.rigShared && info.clipShared && info.animated, JSON.stringify(info));
      await page.screenshot({ path: `${OUT}/${heroId}-tier${tier}.png` });
    }
    // C. 실제 전투: 갑옷 단계 몸체 유지, 콤보 전 단계·기본 스킬 재생, 무기 궤적 소켓
    const battle = await page.evaluate(async (heroId) => {
      const a = window.app, e = a.eco;
      a.testPause = false; e.s.energy = 9999; e.s.selected = heroId; e.save();
      a.battle.stop?.(); await a.startStage(e.nextStage()); a.testPause = true;
      const b = a.battle, p = b.player;
      for (const en of b.enemies) { en.hp = 0; en.alive = false; en.root.visible = false; }
      const combos = [], skills = [];
      for (let i = 0; i < p.def.combo.length; i++) {
        p.state = 'idle'; p.stateT = 0; p.comboResume = null; p.startCombo(i);
        for (let k = 0; k < 3; k++) a.step(1 / 60, false);
        const pts = p.weaponPoints('handslot.r', 1.2);
        // 이름이 아니라 실제로 재생 중인 클립 객체를 비교한다(별칭 두 개가 같은 클립을 가리킬 수 있다).
        combos.push({ anim: p.def.combo[i].anim, playing: !!p.action && p.action.getClip() === p.clips[p.def.combo[i].anim], trail: !!pts && pts[0].distanceTo(pts[1]) > 0.1 });
        for (let k = 0; k < 120 && p.state === 'attack'; k++) a.step(1 / 60, false);
      }
      for (let i = 0; i < 4; i++) {
        p.state = 'idle'; p.stateT = 0; p.maxMp = 999; p.mp = 999; p.cds[i] = 0; p.ult = p.ultMax;
        const ok = p.tryCastSkill(i);
        a.step(1 / 60, false);
        skills.push({ anim: p.def.skills[i].anim, ok, playing: !!p.action && p.action.getClip() === p.clips[p.def.skills[i].anim] });
        for (let k = 0; k < 240 && p.busy; k++) a.step(1 / 60, false);
      }
      return { role: p.model.userData.authoredContract?.role, body: p.model.userData.libraryBodyAssetId, combos, skills };
    }, heroId);
    check(`${heroId}: 전투 영웅 라이브러리·갑옷 단계 유지`, battle.role === 'hero' && battle.body === expected(3), `${battle.role} / ${battle.body}`);
    check(`${heroId}: 콤보 전 단계 재생·무기 궤적`, battle.combos.every((c) => c.playing && c.trail), JSON.stringify(battle.combos));
    check(`${heroId}: 기본 스킬 시전·재생`, battle.skills.every((c) => c.ok && c.playing), JSON.stringify(battle.skills));
    await page.screenshot({ path: `${OUT}/${heroId}-battle.png` });
  }
  for (const [model, roster] of Object.entries(MONSTER_ROSTER)) {
    const asset = manifest.assets.find((entry) => entry.id === roster.asset) || manifest.assets.find((entry) => entry.id === roster.fallback);
    const enemyKey = await page.evaluate((legacyModel) => Object.entries(window.__EN || {}).find(([, d]) => d.model === legacyModel)?.[0] || null, model);
    if (!asset) { check(`${model}: 로스터 자산`, false, JSON.stringify(roster)); continue; }
    // 기본 리그 이름(Skeleton_Minion 등)은 동행·하위 호환용 로스터 항목이라 적 정의가 없을 수 있다.
    if (!enemyKey) { results.push({ name: `${model}: 적 정의 없음(미사용 로스터 항목)`, ok: true, skipped: true }); console.log(`SKIP ${model}: 적 정의 없음`); continue; }
    const info = await page.evaluate(async ({ enemyKey }) => {
      const a = window.app, e = a.eco;
      a.testPause = false; e.s.energy = 9999; e.save();
      a.battle.stop?.(); await a.startStage(e.nextStage()); a.testPause = true;
      const b = a.battle, p = b.player, V = p.pos.constructor;
      for (const en of b.enemies) { en.hp = 0; en.alive = false; en.root.visible = false; }
      const spawned = [];
      for (let i = 0; i < 6; i++) { const ang = i / 6 * Math.PI * 2; spawned.push(b.spawnEnemy(enemyKey, null, b.curRoom, p.pos.clone().add(new V(Math.cos(ang) * 4, 0, Math.sin(ang) * 4)))); }
      for (let i = 0; i < 90; i++) a.step(1 / 60, i === 89);
      const list = b.enemies.filter((x) => x.alive && x.def.model && x.type === window.__EN[enemyKey].name);
      const first = list[0];
      return { count: list.length, rig: first?.rigName, role: window.__EN[enemyKey].meleeRole || (window.__EN[enemyKey].behavior === 'bomber' ? 'bomber' : null), library: first?.model?.userData?.libraryAsset?.id || first?.model?.children?.[0]?.userData?.libraryAsset?.id || null,
        clips: first ? Object.keys(first.clips) : [], action: first?.actionName };
    }, { enemyKey });
    check(`${asset.id}: '${model}' 스폰`, info.count > 0, `${info.count}마리`);
    check(`${asset.id}: library 리그 사용`, info.rig === 'library', info.rig);
    check(`${asset.id}: 7개 논리 클립 보유`, ['idle','walk','run','attack','attackHeavy','hit','death'].every((c) => info.clips.includes(c)), info.clips.join(','));
    await page.screenshot({ path: `${OUT}/${asset.id}-approach.png` });
    // 플레이어 공격으로 피격·사망 애니메이션까지 진행
    const after = await page.evaluate(() => {
      const b = window.app.battle, p = b.player; const seen = new Set();
      const lib = () => b.enemies.filter((en) => en.rigName === 'library');
      const watch = () => { for (const en of lib()) if (en.actionName) seen.add(en.actionName); };
      // 1) 플레이어 곁으로 붙여 실제 AI 공격을 유도한다(최대 6초).
      for (let k = 0; k < 360 && !seen.has('attack') && !seen.has('attackHeavy'); k++) {
        for (const en of lib()) if (en.alive && k % 30 === 0) { en.pos.x = p.pos.x + 1.2; en.pos.z = p.pos.z; }
        window.app.step(1 / 60, k % 60 === 0); watch();
      }
      // 2) 피격 → 처치. 적 체력 비례 피해로 몸집 큰 정예·보스도 확실히 쓰러뜨린다.
      for (let k = 0; k < 240; k++) {
        if (k % 20 === 0) for (const en of lib()) if (en.alive) en.hurt(Math.ceil(en.maxHp * 0.3), { kb: 0.1, kind: 'slash', hitReact: true });
        window.app.step(1 / 60, k % 40 === 0); watch();
      }
      return [...seen];
    });
    // 공격과 사망은 반드시 재생돼야 한다(사망은 처치 순간 die() 경로).
    // 돌진(charger) 역할은 원작 설계상 달리기 몸통 박치기로 공격한다.
    // 자폭(bomber)은 원작 설계상 공격 대신 폭발해 사망 경로로 끝난다.
    const attackClips = info.role === 'charger' ? ['run'] : info.role === 'bomber' ? ['death'] : ['attack', 'attack2', 'attackHeavy'];
    check(`${asset.id}: 공격 클립 재생${info.role ? ` (${info.role})` : ''}`, attackClips.some((clip) => after.includes(clip)), after.join(','));
    check(`${asset.id}: 사망 클립 재생`, after.includes('death'), after.join(','));
    await page.screenshot({ path: `${OUT}/${asset.id}-combat.png` });
  }
} finally {
  check('콘솔 오류 0', errors.length === 0, errors.slice(0, 5).join(' | '));
  let build = null; try { build = JSON.parse(readFileSync(resolve(outDir || resolve(PROJ, 'dist'), 'version.json'), 'utf8')); } catch {}
  writeFileSync(resolve(OUT, 'result.json'), JSON.stringify({ at: new Date().toISOString(), heroFixture, build, results, errors, fallbacks }, null, 2));
  await br.close(); srv.kill();
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;

