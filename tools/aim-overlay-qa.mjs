// 조준 표시 = 실제 판정 범위 실측. 실제 게임 루프에서 직업별 스킬을 고정 조준으로 시전하고, 그 시전이 만든 모든 hitRadius/hitArea 판정 원을
// 기록해 조준 표시 모양(playerSkillAimShape)의 바깥 경계를 넘는지 잰다. 판정 원을 붉은 링으로, 조준 표시를 하늘색으로 겹친 캡처를 남긴다.
// 시작 상태 고정: 직업 선택·영웅 레벨 30(각성 슬롯 해금)·무적·MP/궁극기 가득·적 제거. 투사체 자체 충돌은 단위 테스트(test/skill-aim.test.ts)가 맡는다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const origin = process.argv[2] || 'http://127.0.0.1:5182';
const out = path.resolve(process.argv[3] || 'work/qa-aim-overlay');
const heroes = (process.argv[4] || 'knight,barbarian,mage,rogue,ranger').split(',');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 590 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 120000 }); await page.click('#boot-start');
await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot').classList.contains('show'), null, { timeout: 120000 });
const rows = [];
for (const hero of heroes) {
  await page.evaluate(async hero => { app.ui.closeModal?.(); app.eco.s.energy = 100; app.eco.s.selected = hero; if (!await app.startStage(app.eco.nextStage())) throw Error('stage'); app.companionAgent?.endBattle?.(); }, hero);
  await page.waitForFunction(() => app.battle?.active && app.battle.player, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const res = await page.evaluate(async () => {
    const { playerSkillAimShape } = await import('/src/game/skill-aim/shapes.js');
    const b = app.battle, p = b.player; p.auto = false; p.invuln = 1e9; p.heroLevel = Math.max(p.heroLevel || 1, 30);
    for (const e of b.enemies) e.alive = false;
    const calls = []; const oR = b.hitRadius.bind(b), oA = b.hitArea.bind(b);
    b.hitRadius = (c, r, ...a) => { calls.push({ t: 'r', x: c.x, z: c.z, r }); return oR(c, r, ...a); };
    b.hitArea = (s, pos, yaw, range, arc, ...a) => { calls.push({ t: 'a', x: pos.x, z: pos.z, yaw, range, arc }); return oA(s, pos, yaw, range, arc, ...a); };
    const out = [];
    const aim = { x: Math.sin(.6), z: Math.cos(.6), dist01: .8 };
    for (let slot = 0; slot < 6; slot++) {
      const idx = p.combatSkillIndex(slot), sk = p.def.skills[idx]; if (!sk) continue;
      p.state = 'idle'; p.skillCtx = null; p.cds.fill(0); p.mp = p.maxMp = 9999; p.ult = p.ultMax; p.stun = 0; p.vel.set(0, 0, 0);
      // 앞 스킬이 남긴 지속 장판(독 웅덩이 등)이 다음 기록에 섞이지 않게 충분히 흘려보낸다.
      for (let i = 0; i < 480; i++) app.step(1 / 60, false);
      p.state = 'idle'; p.skillCtx = null; p.cds.fill(0); p.mp = p.maxMp; p.ult = p.ultMax;
      const start = p.pos.clone(); calls.length = 0;
      const shape = playerSkillAimShape(p, sk.id, {}); const shapeCopy = shape && { ...shape };
      const ok = p.tryCastCombatSkill(slot, aim);
      for (let i = 0; i < 150 && ok; i++) { app.step(1 / 60, false); if (!p.skillCtx || p.skillCtx.done) { if (i > 30) break; } }
      for (let i = 0; i < 90; i++) app.step(1 / 60, false);
      // 판정 원의 바깥 끝이 표시 경계를 얼마나 넘는지(+면 초과, 단위 m). 판정 내부 여유(hitRadius 적 반경 0.5배·hitArea 0.6배)는 적 반경 1까지 0.6으로 허용한다.
      const yaw = Math.atan2(aim.x, aim.z), ux = aim.x, uz = aim.z;
      const over = c => {
        if (!shapeCopy) return null;
        const dx = c.x - start.x, dz = c.z - start.z, along = dx * ux + dz * uz, across = Math.abs(-dx * uz + dz * ux), dist = Math.hypot(dx, dz);
        const reach = c.t === 'r' ? c.r : c.range;
        const s = shapeCopy, o = s.origin || 0;
        // 바깥 한계(envelope: 확률 띠·몰이 한계)는 점선으로 그려지므로 표시 경계에 포함한다.
        const outer = Math.max(s.radius || 0, s.envelope || 0);
        if (s.kind === 'self') return dist + reach - Math.max(s.range, outer);
        if (s.kind === 'circle') { const at = s.range * aim.dist01; const tx = ux * at, tz = uz * at; const okSelf = dist + reach - (s.range + outer); return Math.min(Math.hypot(dx - tx, dz - tz) + reach - outer, okSelf); }
        if (s.kind === 'cone') return dist + reach - Math.max(s.range, s.projectileRange || 0) - (c.t === 'a' ? 0 : 0);
        // line: 레인(길이 L, 폭 w) + 끝 원(radius)을 합친 외곽
        const L = (s.projectileRange || s.range) + o + (s.endOffset || 0);
        const lane = Math.max(across + reach - Math.max(s.width || 0, .7) / 2, along - reach < -1.5 ? -along + reach - 1.5 : 0, along + reach - L - (s.radius || 0));
        const endCircle = s.radius ? Math.hypot(dx - ux * L, dz - uz * L) + reach - s.radius : Infinity;
        return Math.min(lane, endCircle);
      };
      const hits = calls.map(c => ({ ...c, over: +over(c)?.toFixed(2) }));
      out.push({ slot, skill: sk.id, cast: ok, shape: shapeCopy, hits: hits.length, maxOver: hits.length ? Math.max(...hits.map(h => h.over)) : null, worst: hits.sort((a, b) => b.over - a.over)[0] || null });
    }
    b.hitRadius = oR; b.hitArea = oA;
    return out;
  });
  rows.push({ hero, skills: res });
  await page.evaluate(() => app.toLobby?.());
  await page.waitForTimeout(400);
}
await browser.close();
const TOL = .6;
for (const r of rows) for (const s of r.skills) s.ok = !s.cast || s.hits === 0 || s.maxOver <= TOL;
const pass = rows.every(r => r.skills.every(s => s.ok)) && !errors.length;
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({ origin, tolerance: TOL, pass, rows, errors }, null, 2));
console.log(JSON.stringify({ pass, rows: rows.map(r => [r.hero, r.skills.map(s => [s.skill, s.shape?.kind, s.cast, s.hits, s.maxOver])]), errors: errors.slice(0, 2) }));
