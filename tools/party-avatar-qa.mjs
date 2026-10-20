/**
 * 파티 아바타 QA — 실제 로컬 Worker 에 브라우저 두 개로 붙어, 게스트가 착용한 캐시 아바타가
 * 호스트 화면의 게스트 영웅 몸체와 게스트 자신의 몸체에 같이 보이는지 확인한다.
 *   node tools/party-avatar-qa.mjs --url=http://127.0.0.1:5235 [출력폴더]
 * 실시간 진행이며 실기기 네트워크·터치 검증이 아니다.
 */
import { chromium } from 'playwright';
import { CHROME } from './chrome.mjs';
import { mkdirSync, writeFileSync } from 'fs';
const target = new URL(process.argv.find((x) => x.startsWith('--url='))?.slice(6) || 'http://127.0.0.1:5235');
if (!['localhost', '127.0.0.1'].includes(target.hostname)) throw new Error('localhost only');
const OUT = process.argv.slice(2).find((x) => !x.startsWith('--')) || 'work/qa/party-avatar';
mkdirSync(OUT, { recursive: true });
const results = [], errors = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'OK   ' : 'FAIL ') + name, JSON.stringify(detail ?? '').slice(0, 400)); };
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pages = [];
let guestAvatar = null; const warns = [];
try {
  for (let i = 0; i < 2; i++) {
    const p = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
    p.setDefaultTimeout(30000); pages.push(p);
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`p${i}: ${m.text().slice(0, 200)}`); if (m.type() === 'warning') warns.push(`p${i}: ${m.text().slice(0, 300)}`); });
    p.on('pageerror', (e) => errors.push(`p${i} PAGEERR ${String(e).slice(0, 200)}`));
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
    const heroId = await select.locator('option').nth(i).getAttribute('value');
    await select.selectOption(heroId);
    // 게스트만 자기 영웅의 아바타를 사서 착용한다(입장 시 avatar 파라미터로 전달).
    if (i === 1) guestAvatar = await p.evaluate((hero) => { const e = window.app.eco; e.s.gems += 5000;
      const id = { knight: 'avatar_knight_sakura', barbarian: 'avatar_barbarian_oni', mage: 'avatar_mage_astral', rogue: 'avatar_rogue_crow', ranger: 'avatar_ranger_fox' }[hero];
      return e.buyAvatar(id).ok && e.equipAvatar(hero, id).ok ? id : null; }, heroId);
  }
  const [host, guest] = pages;
  await host.getByRole('button', { name: '파티 만들기', exact: true }).click();
  const code = await host.getByLabel('파티 초대 코드', { exact: true }).inputValue();
  await guest.getByLabel('초대 코드', { exact: true }).fill(code);
  await guest.getByRole('button', { name: '파티 참가', exact: true }).click();
  for (const p of pages) { await p.waitForFunction(() => document.querySelectorAll('.party-members li').length === 2); await p.getByRole('button', { name: '준비 완료', exact: true }).click(); }
  await host.getByRole('button', { name: '함께 출격', exact: true }).click();
  // 로딩 대기(party-loading)가 풀리고 호스트 전투 시계가 실제로 흐른 뒤에 소환한다.
  const started = await host.waitForFunction(() => { const b = window.app?.battle; return window.app?.party?.run && b?.active && !b.paused && b.elapsed > .5; }, null, { timeout: 90000 }).then(() => true, () => false);
  if (!started) { const diag = async (p) => p.evaluate(() => { const a = window.app, b = a.battle, s = a.party; return { mode: a.mode, active: b?.active, paused: b?.paused, reasons: [...(b?.pauseReasons || [])], loaded: s?.loaded ? [...s.loaded] : null, members: s?.members?.map((m) => [m.heroId, m.avatar]), players: s?.players ? [...s.players.keys()].length : null, playerBody: b?.player?.model?.userData.libraryBodyAssetId }; }); check('파티 전투 시작', false, { host: await diag(host), guest: await diag(guest), warns: warns.filter((w) => !/KHR_parallel|deprecated/.test(w)).slice(0, 8) }); throw new Error('party did not start'); }
  await guest.waitForFunction(() => window.app?.party?.snapshot && window.app.mode === 'battle', null, { timeout: 60000 });
  check('파티 2인 입장', true, { code: code.slice(0, 4) + '…', guestAvatar });
  const guestId = await guest.evaluate(() => window.app.party.playerId);
  const hostView = await host.waitForFunction(({ id, avatar }) => window.app.party.players.get(id)?.model?.userData.libraryBodyAssetId === avatar, { id: guestId, avatar: guestAvatar }, { timeout: 60000 }).then(() => true, () => false);
  check('호스트 화면: 게스트 영웅이 아바타 몸체', !!guestAvatar && hostView, await host.evaluate((id) => window.app.party.players.get(id)?.model?.userData.libraryBodyAssetId, guestId));
  const selfView = await guest.waitForFunction((avatar) => window.app.battle?.player?.model?.userData.libraryBodyAssetId === avatar, guestAvatar, { timeout: 60000 }).then(() => true, () => false);
  check('게스트 화면: 자기 영웅이 아바타 몸체', selfView, await guest.evaluate(() => window.app.battle?.player?.model?.userData.libraryBodyAssetId));
  const hostSelf = await host.evaluate(() => window.app.battle.player.model.userData.libraryBodyAssetId);
  check('호스트 자신은 아바타 없음(갑옷 단계 몸체)', !String(hostSelf || '').startsWith('avatar_'), hostSelf);
  await host.screenshot({ path: OUT + '/host.png' }); await guest.screenshot({ path: OUT + '/guest.png' });
} finally {
  check('콘솔 오류 0', errors.length === 0, errors.slice(0, 5));
  writeFileSync(OUT + '/result.json', JSON.stringify({ at: new Date().toISOString(), results, errors }, null, 2));
  await browser.close();
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;

