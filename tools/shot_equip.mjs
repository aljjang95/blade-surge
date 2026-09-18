/**
 * 게이트 B 보조 — 필드 자동 장착이 실제 입력 경로(드랍 → 자석 → 수거)에서 발화하는지 **단언**하고 눈으로 본다.
 *   node tools/shot_equip.mjs [출력폴더=.rsi/shots]
 *
 * metrics 하네스는 setProgress 박자(eco.setCount > 0)만 본다. 팝업의 '장착' 배지·세트 진행 줄, 세트 발동 토스트,
 * 무기·방패 메시 교체, 스탯 반영, 설정별 동작은 이 컷이 유일한 눈이다.
 */
import { chromium } from 'playwright';
import { CHROME } from './chrome.mjs';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { mkdirSync } from 'fs';

const PROJ = resolve(new URL('..', import.meta.url).pathname), PORT = 4199, OUT = resolve(PROJ, process.argv[2] || '.rsi/shots');
mkdirSync(OUT, { recursive: true });
const srv = spawn(process.execPath, [resolve(PROJ, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: PROJ, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/`); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }

const br = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await br.newContext({ viewport: { width: 880, height: 400 }, hasTouch: true, isMobile: true })).newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message.slice(0, 200)));

await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector('#boot-start:not(.hidden)', { timeout: 90000 });
// 첫 플레이어 그대로: 새 저장 · 레벨 1 · 장비 없음
await page.evaluate(() => { const e = window.app.eco; e.reset(); e.s.daily.last = Math.floor(Date.now() / 86400000); e.s.selected = 'knight'; e.save(); });
await page.click('#boot-start', { force: true }); await page.waitForTimeout(1500);
await page.evaluate(() => window.app.ui.closeModal());

const results = [];
const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail }); console.log((cond ? 'OK   ' : 'FAIL ') + name, detail ?? ''); };
const step = (n, render = false) => page.evaluate(({ n, render }) => { for (let i = 0; i < n; i++) window.app.step(1 / 60, render && i === n - 1); }, { n, render });

/** 한 층을 열고 시작방의 적을 치워 드랍 수거만 남긴다 */
const openFloor = async (autoEquip) => page.evaluate(async (autoEquip) => {
  const a = window.app, e = a.eco;
  a.testPause = false; a.battle.stop?.();
  e.s.settings.autoEquip = autoEquip; e.s.energy = 9999; e.save();
  await a.startStage(e.nextStage());
  a.testPause = true;
  for (const en of a.battle.enemies) if (en.alive) en.hp = 0;
  for (let i = 0; i < 30; i++) a.step(1 / 60, false);
  const p = a.battle.player;
  return { equip: { ...e.hero('knight').equip }, sets: e.setCount(), atk: p.stats.atk, hp: p.maxHp, alive: a.battle.enemies.filter((x) => x.alive).length };
}, autoEquip);

/** 특정 장비를 플레이어 발밑에 떨어뜨리고 자석이 집을 때까지 밟는다 */
const dropAndPick = async (rarity, slot, frames = 150) => page.evaluate(({ rarity, slot, frames }) => {
  const a = window.app, b = a.battle, e = a.eco, p = b.player;
  const inst = e.fieldDrop(rarity, slot);
  b.drops.spawn(p.pos.clone().add(new p.pos.constructor(0.6, 0, 0.6)), 'item', { ...inst, rarity }, { count: 1, spread: 0.2 });
  let picked = -1;
  for (let i = 0; i < frames; i++) { a.step(1 / 60, false); if (picked < 0 && b.drops.loot.some((x) => x.uid === inst.uid)) picked = i; }
  const pop = document.querySelector('.loot-pop:last-child');
  const nodes = {}; for (const n of ['1H_Sword', '2H_Sword', 'Round_Shield', 'Badge_Shield', 'Rectangle_Shield']) { const o = p.model.getObjectByName(n); nodes[n] = o ? o.visible : null; }
  return { uid: inst.uid, id: inst.id, picked, equip: { ...e.hero('knight').equip }, sets: e.setCount(), atk: p.stats.atk, hp: p.maxHp, curHp: p.hp,
    pop: pop ? { worn: pop.classList.contains('worn'), equip: pop.querySelector('.lp-equip')?.textContent || null, set: pop.querySelector('.lp-set')?.textContent || null, name: pop.querySelector('.lp-body > span')?.textContent || pop.textContent } : null,
    toasts: [...document.querySelectorAll('#toast-layer .toast')].map((t) => t.textContent), nodes, armorMeshes: (() => { let n = 0; p.model.traverse((o) => { if (o.userData.equippedArmor) n++; }); return n; })(), look: { trail: p.look?.trailColor } };
}, { rarity, slot, frames });

// ───────────────── 기본(빈 슬롯만): 첫 플레이어의 1층 ─────────────────
{
  const start = await openFloor('empty');
  console.log('start', JSON.stringify(start));
  check('시작: 장비 없음 · 세트 0', Object.values(start.equip).every((v) => v === null) && start.sets === 0, JSON.stringify(start.equip));

  const w = await dropAndPick('N', 'weapon');
  check('N 무기 수거 즉시 장착', w.picked >= 0 && w.equip.weapon === w.uid, `${w.id} picked@${w.picked} equip=${JSON.stringify(w.equip)}`);
  check('무기 장착으로 공격력 상승', w.atk > start.atk, `${start.atk} → ${w.atk}`);
  check('팝업: 장착 배지 + 신병 세트 1/4', w.pop?.worn && w.pop.equip === '장착' && /신병 세트\s*1\/4/.test(w.pop.set || ''), JSON.stringify(w.pop));
  await step(2, true);
  await page.screenshot({ path: `${OUT}/equip_pickup.png` });

  const r = await dropAndPick('N', 'ring', 90);
  check('N 반지 수거 즉시 장착 → 신병 2세트 발동', r.equip.ring === r.uid && r.sets === 1, `sets=${r.sets} equip=${JSON.stringify(r.equip)}`);
  check('팝업: 신병 세트 2/4 · 2세트', /신병 세트\s*2\/4/.test(r.pop?.set || '') && /2세트/.test(r.pop?.set || ''), JSON.stringify(r.pop));
  check('토스트: 세트 발동 안내', r.toasts.some((t) => t.includes('신병 세트 2세트 발동') && t.includes('공격력 +5%')), JSON.stringify(r.toasts));
  await step(2, true);
  await page.screenshot({ path: `${OUT}/equip_set.png` });

  // 잃은 체력을 만들어 두고 방어구를 집는다 — 최대 체력만 늘고 잃은 체력은 그대로여야 한다
  const missing = await page.evaluate(() => { const p = window.app.battle.player; p.hp = p.maxHp - 400; return p.maxHp - p.hp; });
  const a = await dropAndPick('S', 'armor', 90);
  check('S 방어구 수거 즉시 장착 (다른 세트 → 진행 1/4)', a.equip.armor === a.uid && /용병 세트\s*1\/4/.test(a.pop?.set || ''), JSON.stringify(a.pop));
  check('방어구로 최대 체력 상승 · 잃은 체력 보존', a.hp > r.hp && Math.round(a.hp - a.curHp) === missing, `max ${r.hp} → ${a.hp}, missing ${missing} → ${Math.round(a.hp - a.curHp)}`);
  // 의상 메시(equippedArmor)는 casual-v2 정체성에만 붙는다 — 배송 중인 expedition-v3 에서는 방패 메시 교체가 방어구 외형이다
  check('외형: 방패 메시 교체 (Round → Badge)', a.nodes.Badge_Shield === true && a.nodes.Round_Shield === false, JSON.stringify({ nodes: a.nodes, armorMeshes: a.armorMeshes }));
  await step(2, true);
  await page.screenshot({ path: `${OUT}/equip_armor.png` });

  // 이미 고른 부위는 더 좋은 드랍이 와도 바꾸지 않는다
  const keep = await dropAndPick('E', 'weapon', 90);
  check('빈 슬롯만: 차 있는 부위는 E 무기가 와도 유지', keep.equip.weapon === w.uid && keep.pop && !keep.pop.worn, `equip.weapon=${keep.equip.weapon} (기존 ${w.uid}) pop.worn=${keep.pop?.worn}`);
  check('세트 게이지(테마 세트 전용)는 스탯 세트로 뜨지 않는다', await page.evaluate(() => document.getElementById('hud-setgauge').classList.contains('hidden')));
}

// ───────────────── 더 강하면 교체 ─────────────────
{
  await page.evaluate(() => { const e = window.app.eco; e.reset(); e.s.daily.last = Math.floor(Date.now() / 86400000); e.s.selected = 'knight'; e.save(); });
  await openFloor('better');
  const n = await dropAndPick('N', 'weapon');
  const up = await dropAndPick('E', 'weapon', 90);
  check('교체 모드: 더 강한 E 무기로 교체 (배지 "교체")', up.equip.weapon === up.uid && up.pop?.equip === '교체' && up.atk > n.atk, `${n.atk} → ${up.atk} pop=${JSON.stringify(up.pop)}`);
  const down = await dropAndPick('N', 'weapon', 90);
  check('교체 모드: 더 약한 N 무기는 무시', down.equip.weapon === up.uid && !down.pop?.worn, `equip.weapon=${down.equip.weapon}`);
  await step(2, true);
  await page.screenshot({ path: `${OUT}/equip_better.png` });
}

// ───────────────── 끄기 ─────────────────
{
  await page.evaluate(() => { const e = window.app.eco; e.reset(); e.s.daily.last = Math.floor(Date.now() / 86400000); e.s.selected = 'knight'; e.save(); });
  await openFloor('off');
  const off = await dropAndPick('N', 'weapon');
  check('끄기: 수거해도 장착하지 않고 가방에만', off.picked >= 0 && off.equip.weapon === null && off.pop && !off.pop.worn, JSON.stringify({ equip: off.equip, pop: off.pop }));
  check('끄기: 가방에는 남는다', await page.evaluate((uid) => window.app.eco.s.inventory.some((x) => x.uid === uid), off.uid));
}

// ───────────────── 설정 화면 ─────────────────
{
  const ui = await page.evaluate(async () => {
    const a = window.app; a.battle.stop?.(); a.testPause = false; a.toLobby();
    a.meta.showSettings();
    await new Promise((r) => setTimeout(r, 300));
    const btns = [...document.querySelectorAll('[data-autoequip]')];
    const desc = document.getElementById('autoequip-desc');
    const before = { labels: btns.map((b) => b.textContent), on: btns.find((b) => b.classList.contains('on'))?.dataset.autoequip, desc: desc?.textContent };
    btns.find((b) => b.dataset.autoequip === 'better')?.click();
    const after = { on: [...document.querySelectorAll('[data-autoequip]')].find((b) => b.classList.contains('on'))?.dataset.autoequip, saved: a.eco.s.settings.autoEquip, desc: desc?.textContent, persisted: JSON.parse(localStorage.getItem('bladesurge_save_v1')).settings.autoEquip };
    return { before, after };
  });
  check('설정: 드랍 자동 장착 3단 스위치', ui.before.labels.join('|') === '빈 슬롯만|더 강하면 교체|끄기' && ui.before.on === 'off' && ui.before.desc?.includes('가방'), JSON.stringify(ui.before));
  check('설정: 선택이 저장·설명에 반영', ui.after.on === 'better' && ui.after.saved === 'better' && ui.after.persisted === 'better' && ui.after.desc?.includes('전투력'), JSON.stringify(ui.after));
  // 스위치 3개가 모달 폭 안에 들어가는지 — 가로 400px 높이에서 행이 넘치면 안 된다
  const fit = await page.evaluate(() => {
    const row = document.querySelector('[data-autoequip]').closest('.setting-row'); row.scrollIntoView({ block: 'center' });
    const box = document.querySelector('#modal-box').getBoundingClientRect(), r = row.getBoundingClientRect();
    const btns = [...row.querySelectorAll('[data-autoequip]')].map((b) => b.getBoundingClientRect());
    return { rowW: Math.round(r.width), boxW: Math.round(box.width), overflow: r.right > box.right + 1 || btns.some((b) => b.right > box.right + 1), minH: Math.min(...btns.map((b) => b.height)) };
  });
  check('설정: 스위치 행이 모달 안에 들어간다 (탭 높이 ≥ 36px)', !fit.overflow && fit.minH >= 36, JSON.stringify(fit));
  await page.screenshot({ path: `${OUT}/equip_settings.png` });
  await page.evaluate(() => window.app.ui.closeModal());
}

console.log('\nerrors', errors.slice(0, 12));
const failed = results.filter((r) => !r.ok);
console.log(`\n단언 ${results.length - failed.length}/${results.length} 통과` + (errors.length ? ` · 콘솔 에러 ${errors.length}` : ''));
await br.close(); srv.kill();
process.exit(failed.length || errors.length ? 1 : 0);
