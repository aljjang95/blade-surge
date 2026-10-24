/**
 * 파티 잠복형 복제 QA — 실제 로컬 Worker(파티 Durable Object·WebSocket)에 브라우저 두 개(호스트·게스트)로 붙어,
 * 호스트가 시뮬레이션한 잠복종의 숨기·예고 원·솟구침이 게스트 화면에 복제되는지 확인한다.
 *   node tools/party-burrower-qa.mjs --url=http://127.0.0.1:5235 [출력폴더]
 * 실시간 진행(고정 dt 아님)이며 실기기 네트워크·터치 검증이 아니다.
 */
import { chromium } from 'playwright';
import { CHROME } from './chrome.mjs';
import { mkdirSync, writeFileSync } from 'fs';
import { installAutoStarter } from './qa-starter.mjs';
const target = new URL(process.argv.find((x) => x.startsWith('--url='))?.slice(6) || 'http://127.0.0.1:5235');
if (!['localhost', '127.0.0.1'].includes(target.hostname)) throw new Error('localhost only');
const OUT = process.argv.slice(2).find((x) => !x.startsWith('--')) || 'work/qa/party-burrower';
mkdirSync(OUT, { recursive: true });
const results = [], errors = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'OK   ' : 'FAIL ') + name, JSON.stringify(detail ?? '').slice(0, 400)); };
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pages = [];
try {
  for (let i = 0; i < 2; i++) {
    const p = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
    p.setDefaultTimeout(30000); pages.push(p);
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`p${i}: ${m.text().slice(0, 200)}`); });
    p.on('pageerror', (e) => errors.push(`p${i} PAGEERR ${String(e).slice(0, 200)}`));
    await installAutoStarter(p); // 빈 저장 부팅 시 시작 영웅 선택 화면 자동 통과
    await p.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.locator('#boot-start:not(.hidden)').waitFor({ timeout: 180000 });
    await p.evaluate(() => { const e = window.app.eco; e.s.daily.last = Math.floor(Date.now() / 86400000); e.save(); });
    await p.locator('#boot-start').click({ force: true });
    await p.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show'), null, { timeout: 120000 });
    await p.waitForTimeout(700);
    for (let n = 0; n < 4; n++) { const close = p.locator('#modal.show #m-cancel'); if (!await close.isVisible()) break; await close.click(); }
    // 데스크톱 로비에서는 파티 버튼이 '더보기' 안에 접혀 있다. 같은 버튼의 실제 click 핸들러를 부른다.
    await p.evaluate(() => document.querySelector('#party-open').click());
    await p.getByLabel('모험가 이름', { exact: true }).waitFor();
    await p.getByLabel('모험가 이름', { exact: true }).fill(i ? '게스트' : '호스트');
    const select = p.getByLabel('파티 영웅', { exact: true });
    await select.selectOption(await select.locator('option').nth(i).getAttribute('value'));
  }
  const [host, guest] = pages;
  await host.getByRole('button', { name: '파티 만들기', exact: true }).click();
  const code = await host.getByLabel('파티 초대 코드', { exact: true }).inputValue();
  await guest.getByLabel('초대 코드', { exact: true }).fill(code);
  await guest.getByRole('button', { name: '파티 참가', exact: true }).click();
  for (const p of pages) { await p.waitForFunction(() => document.querySelectorAll('.party-members li').length === 2); await p.getByRole('button', { name: '준비 완료', exact: true }).click(); }
  await host.getByRole('button', { name: '함께 출격', exact: true }).click();
  // 로딩 대기(party-loading)가 풀리고 호스트 전투 시계가 실제로 흐른 뒤에 소환한다.
  await host.waitForFunction(() => { const b = window.app?.battle; return window.app?.party?.run && b?.active && !b.paused && b.elapsed > .5; }, null, { timeout: 120000 });
  await guest.waitForFunction(() => window.app?.party?.snapshot && window.app.mode === 'battle', null, { timeout: 60000 });
  check('파티 2인 입장', true, { code: code.slice(0, 4) + '…' });
  await host.waitForTimeout(1500);
  // 호스트: 기존 적을 정리하고 잠복종 1마리를 호스트 앞 8m에 소환한다(파티 소환 경로가 partyId 를 붙인다).
  const spawned = await host.evaluate(() => {
    const a = window.app, b = a.battle; b.player.auto = false;
    for (const en of b.enemies) { en.hp = 0; en.alive = false; en.dead = true; }
    const en = b.spawnEnemy('grave_burrower', null, b.curRoom, b.player.pos.clone().add(new b.player.pos.constructor(8, 0, 0)));
    window.__hb = en; return { id: en?.partyId, burrow: !!en?.burrow };
  });
  check('호스트 소환 잠복종에 partyId·잠행 부착', !!spawned.id && spawned.burrow, spawned);
  const seen = { hidden: null, mark: null, erupt: null, guestShots: {} }, trace = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 90000 && !seen.erupt) {
    const h = await host.evaluate(() => { const e = window.__hb, b = window.app.battle; return { phase: e.burrow.phase, erupted: e.burrow.erupted, sub: +e.burrow.depth().toFixed(2), alive: e.alive,
      state: e.state, spawning: e.spawning, cd: +e.burrow.cd.toFixed(2), stun: +(e.stun || 0).toFixed(2), gather: +(e.gatherT || 0).toFixed(2), active: b.active, paused: b.paused,
      reasons: [...(b.pauseReasons || [])], hidden: document.hidden, elapsed: +b.elapsed.toFixed(2), dist: +e.distTo(e.game.player).toFixed(2), inList: b.enemies.includes(e) }; });
    const g = await guest.evaluate((id) => {
      const s = window.app.party, r = s.replicas.get(id), w = (s.snapshot?.warnings || []).find((x) => x.id.startsWith(id + ':burrow:'));
      const item = (s.snapshot?.enemies || []).find((x) => x.id === id);
      return r ? { visible: r.model.visible, y: +r.model.position.y.toFixed(2), spawning: r.spawning, sub: item?.sub ?? null,
        warning: w ? { kind: w.kind, radius: w.radius, remaining: +w.remaining.toFixed(2) } : null,
        meshShown: !!s.combatEffects?.slots?.some((slot) => slot.mesh.visible && slot.id?.startsWith(id + ':burrow:')) } : null;
    }, spawned.id);
    trace.push({ t: Date.now() - t0, h, g });
    if (g && g.visible === false && g.spawning && !seen.hidden) { seen.hidden = { h, g }; await guest.screenshot({ path: `${OUT}/guest-1-hidden.png` }); }
    if (g?.warning && g.meshShown && !seen.mark) { seen.mark = { h, g }; await guest.screenshot({ path: `${OUT}/guest-2-mark.png` }); }
    if (h.erupted > 0 && !seen.erupt) { seen.erupt = { h, g }; await guest.waitForTimeout(250); await guest.screenshot({ path: `${OUT}/guest-3-erupt.png` }); }
    await guest.waitForTimeout(40);
  }
  check('게스트: 숨은 동안 복제본이 감춰지고 조준 대상에서 빠짐', !!seen.hidden, seen.hidden);
  check('게스트: 예고 원판(반경 2.6) 수신·표시', !!seen.mark && seen.mark.g.warning.kind === 'disk' && seen.mark.g.warning.radius === 2.6, seen.mark);
  check('게스트: 예고 중 반쯤 드러남', !!seen.mark && seen.mark.g.visible && seen.mark.g.y < 0, seen.mark?.g);
  check('호스트: 솟구침 발생', !!seen.erupt, seen.erupt?.h);
  await guest.waitForTimeout(600);
  const after = await guest.evaluate((id) => { const r = window.app.party.replicas.get(id); return r ? { visible: r.model.visible, y: r.model.position.y, spawning: r.spawning } : null; }, spawned.id);
  check('게스트: 솟구친 뒤 완전히 드러남', !!after && after.visible && after.y === 0 && !after.spawning, after);
  writeFileSync(`${OUT}/trace.json`, JSON.stringify(trace, null, 1));
} finally {
  check('콘솔 오류 0', errors.length === 0, errors.slice(0, 5));
  writeFileSync(`${OUT}/result.json`, JSON.stringify({ at: new Date().toISOString(), target: target.href, results, errors }, null, 2));
  await browser.close();
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;




