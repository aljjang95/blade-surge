// 전투 HUD 가림 실측(lane f4-combat-hud): 실제 전투 화면에서 HUD 사각형끼리·월드 표식(이름표)과 HUD 사각형이 겹치는지 센다.
// 겹침은 결함이다. 한 건이라도 있으면 exit 1.
//  1) 대상 이름표(.target-tag)를 화면 9곳에 놓았을 때 HUD 요소와 겹친 면적
//  2) 콤보 칩·연속 처치 알약이 영웅 HP 카드(EXP 막대)·시점 버튼·목표 카드와 겹친 면적
//  3) 목표 카드: 전투 중 접힘(높이·불투명도), 탭하면 펼침
//  4) 방 진입 안내 토스트: 위쪽 가운데·글자 크기·대비·사라짐, 포션 칸과 겹침
//  5) 터치일 때 키 힌트(U/I/O·R·1/2/3)가 숨는지, 키보드 입력 뒤에는 보이는지
//  6) 폭탄 슬라임 화면 높이가 영웅 키를 넘지 않는지
// 사용: node tools/combat-hud-overlap-qa.mjs <origin> [출력폴더] [뷰포트목록 844x390,915x412,1280x720]
// 렌더가 소프트웨어(SwiftShader)여도 도는 점검이다: 게임 루프는 app.step(1/60) 로 직접 돌리고 입력 방식 점검만 실제 터치/키 이벤트를 쓴다.
import { chromium } from 'playwright';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const origin = (process.argv[2] || 'http://127.0.0.1:4173').replace(/\/$/, '');
const out = path.resolve(process.argv[3] || 'work/combat-hud-overlap');
const views = (process.argv[4] || '844x390,915x412,1280x720').split(',').map(v => v.split('x').map(Number));
await fsp.mkdir(out, { recursive: true });

const exe = process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers')
  ? fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-')).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`)[0] : undefined);
const args = process.platform === 'win32' ? ['--use-angle=d3d11', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ executablePath: exe, args });

const report = [];
let failures = 0;
for (const [w, h] of views) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 300)));
  const row = { viewport: `${w}x${h}`, errors };
  try {
    await page.goto(origin + '/', { waitUntil: 'commit', timeout: 120000 });
    await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 }); await page.tap('#boot-start');
    await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot').classList.contains('show'), null, { timeout: 120000 });
    await page.evaluate(async () => {
      app.ui.closeModal?.(); app.eco.s.energy = 100;
      if (!await app.startExpedition('dungeon', 'glass_garden', { depth: 'standard' })) throw Error('expedition start failed');
    });
    await page.waitForFunction(() => app.battle?.active && app.battle.player && app.input.enabled, null, { timeout: 120000 });
    await page.waitForTimeout(1500);

    // ---- 점검 본체: 한 번의 evaluate 로 같은 프레임 상태에서 모든 사각형을 읽는다 ----
    const result = await page.evaluate(async () => {
      const a = app, b = a.battle, p = b.player, T = window.__THREE, hud = document.getElementById('hud');
      a.testPause = true; p.auto = false; p.invuln = 1e6; p.mp = p.maxMp; a.input.clear();
      const box = r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height });
      const rectOf = el => { const r = el?.getBoundingClientRect(); return r && r.width > 0 && r.height > 0 ? box(r) : null; };
      const overlap = (x, y) => { const ww = Math.min(x.right, y.right) - Math.max(x.left, y.left), hh = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top); return ww > 0 && hh > 0 ? Math.round(ww * hh) : 0; };
      const BLOCK = ['.hud-player', '.hud-center .wave', '.hud-center .stage-name', '.hud-right-top', '#btn-map', '#objective', '#combo', '#kill-streak', '#bossbar',
        '.joy-base', '.actions .skill-btn', '#btn-dodge', '#btn-attack', '.exp-potions', '.oath-camera-details', '.battle-camera-controls'];
      const blockers = () => { const o = []; for (const s of BLOCK) for (const el of hud.querySelectorAll(s)) { const r = rectOf(el); if (r) o.push({ id: el.id || s, ...r }); } return o; };
      const render = (n = 1) => { for (let i = 0; i < n; i++) a.step(1 / 60, i === n - 1); };
      const res = {};

      // 1) 이름표
      const cam = a.renderer.camera;
      const spawnAt = (type, x, z) => b.spawnEnemy(type, null, null, new T.Vector3(x, 0, z));
      const e = spawnAt('bone_orc', p.pos.x + 3, p.pos.z - 2);
      for (let i = 0; i < 90 && (e.spawning || !e.alive); i++) a.step(1 / 60, false);
      p.lockTarget = e; b.lastTarget = e; e.invuln = 1e6;
      const lift = 2.05 * (e.scale || 1);
      const groundFor = (nx, ny) => { // 머리(y=lift) 높이 평면과 화면 점 NDC 의 교점 → 월드 x,z
        const v = new T.Vector3(nx, ny, .5).unproject(cam), o = cam.position, d = v.sub(o).normalize(), t = (lift - o.y) / d.y;
        return [o.x + d.x * t, o.z + d.z * t];
      };
      const anchors = [[-.85, .75], [-.55, .55], [0, .7], [.45, .72], [.62, .52], [-.85, -.7], [.85, -.78], [.9, 0], [0, -.88]];
      const tags = [];
      for (const [nx, ny] of anchors) {
        const [gx, gz] = groundFor(nx, ny); e.pos.set(gx, 0, gz);
        p.lockTarget = e; b.lastTarget = e; render(1);
        const tag = hud.querySelector('.target-tag'), r = tag && !tag.hidden ? rectOf(tag) : null;
        const hits = r ? blockers().map(k => ({ id: k.id, area: overlap(r, k) })).filter(k => k.area > 0) : [];
        tags.push({ at: [nx, ny], shown: !!r, hidden: !r, byClearance: !!b.targetTag?.clearanceHidden, rect: r && { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }, hits });
      }
      res.nameplates = { placements: tags, overlaps: tags.reduce((s, t) => s + t.hits.length, 0), shown: tags.filter(t => t.shown).length, hiddenByClearance: tags.filter(t => t.byClearance).length };
      p.lockTarget = null; e.pos.set(p.pos.x + 6, 0, p.pos.z - 6);

      // 2) 콤보 칩 + 연속 처치
      a.ui.setCombo(54); a.ui.setKillStreak(17); render(2);
      await new Promise(r => setTimeout(r, 1500)); // 팝·등급 상승 애니메이션이 끝난 뒤 잰다
      const card = rectOf(hud.querySelector('.hud-player')), chip = rectOf(document.getElementById('combo')), pill = rectOf(document.getElementById('kill-streak'));
      const exp = rectOf(hud.querySelector('.expbar')), xpText = rectOf(hud.querySelector('.rpg-xp'));
      const others = blockers().filter(k => !['combo', 'kill-streak'].includes(k.id));
      res.combo = { chip, pill, card, exp, xpText,
        chipHits: chip ? others.map(k => ({ id: k.id, area: overlap(chip, k) })).filter(k => k.area) : [{ id: 'chip-missing', area: 1 }],
        pillHits: pill ? others.map(k => ({ id: k.id, area: overlap(pill, k) })).filter(k => k.area) : [],
        chipVsPill: chip && pill ? overlap(chip, pill) : 0,
        chipVsCard: chip && card ? overlap(chip, card) : 0,
        chipVsExp: chip && exp ? overlap(chip, exp) : 0 };

      // 3) 목표 카드
      const obj = document.getElementById('objective'), objRect0 = rectOf(obj), objCs = getComputedStyle(obj);
      res.objective = { compact: objRect0, opacity: +objCs.opacity, expanded: obj.classList.contains('is-expanded'), pointer: objCs.pointerEvents };
      obj.click();
      await new Promise(r => setTimeout(r, 350));
      const objRect1 = rectOf(obj);
      res.objective.afterTap = { rect: objRect1, opacity: +getComputedStyle(obj).opacity, expanded: obj.classList.contains('is-expanded') };
      obj.click(); await new Promise(r => setTimeout(r, 300));
      res.objective.collapsedAgain = !obj.classList.contains('is-expanded');

      // 4) 방 안내 토스트: 장치방(roomId 3)으로 이동
      const room = b.world?.rooms?.find(r => r.id === 3);
      res.intro = { available: !!room };
      if (room) {
        const intro = document.getElementById('room-intro');
        const lum = c => { const m = c.match(/[\d.]+/g).map(Number).slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * m[0] + .7152 * m[1] + .0722 * m[2]; };
        const ratio = (c1, c2) => { const l1 = lum(c1), l2 = lum(c2); return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05); };
        const measure = () => {
          const r = rectOf(intro); if (!r) return null;
          const cs = getComputedStyle(intro), sp = getComputedStyle(intro.querySelector('span')), st = getComputedStyle(intro.querySelector('strong'));
          const bg = cs.backgroundColor.replace(/rgba?\(([^)]+)\)/, (m, v) => 'rgb(' + v.split(',').slice(0, 3).join(',') + ')');
          return { available: true, shown: true, rect: r, centerX: Math.round((r.left + r.right) / 2), viewportCenter: innerWidth / 2,
            title: intro.querySelector('strong').textContent, detail: intro.querySelector('span').textContent,
            detailPx: parseFloat(sp.fontSize), titlePx: parseFloat(st.fontSize), detailWeight: sp.fontWeight,
            contrast: +ratio(sp.color, bg).toFixed(1), hits: blockers().map(k => ({ id: k.id, area: overlap(r, k) })).filter(k => k.area), topEdge: Math.round(r.top) };
        };
        // 숨김 해제 순간을 놓치지 않도록 관찰자로 잡는다(소프트웨어 렌더에서는 프레임이 늦다).
        let first = null;
        if (intro) new MutationObserver(() => { if (!intro.hidden && !first) first = measure(); }).observe(intro, { attributes: true, attributeFilter: ['hidden'] });
        p.pos.set(room.x, 0, room.z); b.curRoom = room; a.input.clear();
        for (let i = 0; i < 12; i++) a.step(1 / 60, false); render(1);
        a.ui.readability.update(b, 0);
        for (let i = 0; i < 20 && !first; i++) await new Promise(r => setTimeout(r, 100));
        res.intro = first || { available: true, shown: false };
        // 5.2초 애니메이션이 끝나면 숨는다(느린 렌더에서는 최대 40초까지 기다린다)
        for (let i = 0; i < 80 && intro && intro.hidden !== true; i++) await new Promise(r => setTimeout(r, 500));
        res.intro.hiddenAfterFade = intro?.hidden === true;
        // 아래쪽 장치 줄의 옛 설명문(.map-tactics-context-copy)이 남아 있지 않은지
        const copy = document.querySelector('.map-tactics-context-copy');
        res.intro.bottomCopyDisplay = copy ? getComputedStyle(copy).display : 'absent';
      }

      // 5) 키 힌트(터치 상태)
      const vis = el => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden'; };
      const hintEls = [...hud.querySelectorAll('.skill-btn .key'), ...hud.querySelectorAll('.exp-potions small')];
      res.hints = { input: document.documentElement.dataset.input, total: hintEls.length, visibleOnTouch: hintEls.filter(vis).length };

      // 6) 폭탄 슬라임 vs 영웅 화면 높이
      const heightPx = actor => { const bb = new T.Box3().setFromObject(actor.root); let miny = 1e9, maxy = -1e9;
        for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) { const v = new T.Vector3(x, y, z).project(cam); const sy = (1 - v.y) * .5 * innerHeight; miny = Math.min(miny, sy); maxy = Math.max(maxy, sy); }
        return maxy - miny; };
      const slime = spawnAt('bomb_slime', p.pos.x + 2, p.pos.z + 3);
      for (let i = 0; i < 90 && slime.spawning; i++) a.step(1 / 60, false);
      render(1);
      res.slime = { slimePx: Math.round(heightPx(slime)), heroPx: Math.round(heightPx(p)), ratio: +(heightPx(slime) / heightPx(p)).toFixed(2), radius: +slime.radius.toFixed(2), defScale: slime.def.scale };
      slime.invuln = 1e6;
      return res;
    });

    // 키보드 입력 뒤에는 키 힌트가 보인다(실제 키 이벤트)
    await page.keyboard.press('KeyJ'); await page.waitForTimeout(200);
    result.hints.afterKeyboard = await page.evaluate(() => ({ input: document.documentElement.dataset.input,
      visible: [...document.querySelectorAll('#hud .skill-btn .key, #hud .exp-potions small')].filter(el => getComputedStyle(el).display !== 'none').length }));
    // 터치로 되돌아가면 다시 숨는다(실제 터치)
    await page.touchscreen.tap(Math.round(w / 2), Math.round(h / 3)); await page.waitForTimeout(200);
    result.hints.afterTouch = await page.evaluate(() => ({ input: document.documentElement.dataset.input,
      visible: [...document.querySelectorAll('#hud .skill-btn .key, #hud .exp-potions small')].filter(el => getComputedStyle(el).display !== 'none').length }));

    // 증거 화면 1: 이름표가 영웅 HP 카드 오른쪽 아래에 걸리는 자리(수정 전에는 카드를 덮는다). 콤보·연속 처치 표시는 끈다.
    const tagRow = await page.evaluate(() => {
      const a = app, b = a.battle, p = b.player, T = window.__THREE, cam = a.renderer.camera;
      a.ui.setCombo(0); a.ui.setKillStreak(0);
      const card = document.querySelector('#hud .hud-player').getBoundingClientRect();
      const e = b.enemies.find(x => x.alive && x.def.name === '뼈 오크') || b.enemies.find(x => x.alive);
      const lift = 2.05 * (e.scale || 1);
      const nx = (card.right + 30) / innerWidth * 2 - 1, ny = 1 - 2 * (card.top + 48) / innerHeight;
      const v = new T.Vector3(nx, ny, .5).unproject(cam), o = cam.position, d = v.sub(o).normalize(), t = (lift - o.y) / d.y;
      e.pos.set(o.x + d.x * t, 0, o.z + d.z * t); p.lockTarget = e; b.lastTarget = e;
      a.step(1 / 60, false); a.step(1 / 60, true);
      const tag = document.querySelector('#hud .target-tag'), r = tag && !tag.hidden ? tag.getBoundingClientRect() : null;
      return { shown: !!r, byClearance: !!b.targetTag?.clearanceHidden, rect: r && [r.left, r.top, r.right, r.bottom].map(Math.round), card: [card.left, card.top, card.right, card.bottom].map(Math.round),
        overlapsCard: r ? Math.max(0, Math.min(r.right, card.right) - Math.max(r.left, card.left)) * Math.max(0, Math.min(r.bottom, card.bottom) - Math.max(r.top, card.top)) : 0 };
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, `nameplate-${w}x${h}.png`), clip: { x: 0, y: 0, width: Math.min(w, 520), height: Math.min(h, 230) } });
    result.nameplateAtCard = tagRow;
    await page.evaluate(() => { app.ui.setCombo(54); app.ui.setKillStreak(17); app.step(1 / 60, true); });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, `combat-${w}x${h}.png`) });
    Object.assign(row, result);

    // ---- 판정 ----
    const fails = [];
    if (result.nameplateAtCard.overlapsCard > 0) fails.push(`이름표가 HP 카드를 ${result.nameplateAtCard.overlapsCard}px² 덮음`);
    if (result.nameplates.overlaps > 0) fails.push(`이름표가 HUD 와 ${result.nameplates.overlaps}곳 겹침`);
    if (result.combo.chipHits.length) fails.push('콤보 칩이 HUD 와 겹침: ' + JSON.stringify(result.combo.chipHits));
    if (result.combo.pillHits.length) fails.push('연속 처치 알약이 HUD 와 겹침: ' + JSON.stringify(result.combo.pillHits));
    if (result.combo.chipVsPill > 0) fails.push('콤보 칩과 연속 처치 알약이 겹침');
    if (!result.objective.afterTap.expanded || !(result.objective.afterTap.rect.h > result.objective.compact.h)) fails.push('목표 카드가 탭으로 펼쳐지지 않음');
    if (!(result.objective.opacity < .8)) fails.push('목표 카드가 전투 중 반투명이 아님');
    if (result.intro.available) {
      if (!result.intro.shown) fails.push('방 안내 토스트가 뜨지 않음');
      else {
        if (result.intro.hits.length) fails.push('방 안내 토스트가 HUD 와 겹침: ' + JSON.stringify(result.intro.hits));
        if (result.intro.detailPx < 12 || result.intro.contrast < 7) fails.push(`방 안내 글자 ${result.intro.detailPx}px 대비 ${result.intro.contrast}`);
        if (Math.abs(result.intro.centerX - result.intro.viewportCenter) > 4) fails.push('방 안내 토스트가 가운데가 아님');
        if (!result.intro.hiddenAfterFade) fails.push('방 안내 토스트가 사라지지 않음');
      }
      if (result.intro.bottomCopyDisplay !== 'none' && result.intro.bottomCopyDisplay !== 'absent') fails.push('하단 장치 줄에 옛 안내문이 남음');
    }
    if (result.hints.visibleOnTouch) fails.push(`터치인데 키 힌트 ${result.hints.visibleOnTouch}개 보임`);
    if (!result.hints.afterKeyboard.visible) fails.push('키보드 입력 뒤에도 키 힌트가 숨겨져 있음');
    if (result.hints.afterTouch.visible) fails.push('터치로 돌아와도 키 힌트가 보임');
    if (result.slime.ratio > 1.0) fails.push(`폭탄 슬라임이 영웅보다 큼(${result.slime.ratio})`);
    row.fails = fails; row.ok = fails.length === 0 && errors.length === 0;
  } catch (error) { row.failure = String(error.stack || error).slice(0, 800); row.ok = false; }
  if (!row.ok) failures++;
  report.push(row); await ctx.close();
}
await browser.close();
await fsp.writeFile(path.join(out, 'report.json'), JSON.stringify({ origin, views: views.map(v => v.join('x')), pass: failures === 0, report }, null, 2));
console.log(JSON.stringify({ pass: failures === 0, rows: report.map(r => ({ v: r.viewport, ok: r.ok, fails: r.fails, failure: r.failure, errors: r.errors, nameplate: r.nameplates && { overlaps: r.nameplates.overlaps, shown: r.nameplates.shown, byClearance: r.nameplates.hiddenByClearance }, combo: r.combo && { chip: r.combo.chip, vsCard: r.combo.chipVsCard, vsExp: r.combo.chipVsExp }, objective: r.objective && { h0: r.objective.compact?.h, h1: r.objective.afterTap?.rect?.h, opacity: r.objective.opacity }, intro: r.intro && { shown: r.intro.shown, px: r.intro.detailPx, contrast: r.intro.contrast, top: r.intro.topEdge }, slime: r.slime })) }, null, 1));
if (failures) process.exitCode = 1;
