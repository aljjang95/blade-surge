// 스테이지 선택 화면 실제 입력 검증(docs/stage-select.md).
// 사용법: node tools/stage-select-qa.mjs [origin=http://127.0.0.1:5391/] [out=work/stage-select-qa] [--profiles=land-844x390,port-390x844,desktop-1280] [--battle=land-844x390]
// 새 브라우저 프로필(새 저장 Lv.1)에서: 출격 → 선택 화면(첫 안내·1-1 추천) → 잠긴 관문 사유 → 던전 탭 → ESC/닫기 비용 없음·초점 복귀
// → 던전 입장(준비창만 열림, 비용 없음) → 다시 출격 시 마지막 선택 기억 → (--battle 프로필) 1-1 입장 → 전투 진입·에너지 1회 차감
// → 시드 저장(1-3 클리어)에서 추천 1-4. 결과는 viewport/터치 에뮬과 SwiftShader 관측이며 실기기·GPU 검증이 아니다.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOpts } from './chrome.mjs';
import { installAutoStarter } from './qa-starter.mjs';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const origin = positional[0] || 'http://127.0.0.1:5391/', out = path.resolve(positional[1] || 'work/stage-select-qa');
const flag = (name) => args.find((a) => a.startsWith('--' + name + '='))?.split('=')[1];
const ALL = [
  { id: 'land-844x390', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true },
  { id: 'port-390x844', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  { id: 'desktop-1280', viewport: { width: 1280, height: 720 } },
];
const wanted = (flag('profiles') || 'land-844x390,port-390x844,desktop-1280').split(',');
const battleProfile = flag('battle') ?? 'land-844x390';
const PROFILES = ALL.filter((p) => wanted.includes(p.id));
await fs.mkdir(out, { recursive: true });
const report = { started: new Date().toISOString(), origin, note: 'Fresh browser profile/save. Native click/tap/keyboard input; seeded save only for the 1-3 recommendation check. Viewport emulation + SwiftShader; not physical-device evidence.', profiles: [] };
const failures = [];
const browser = await chromium.launch(launchOpts());
try {
  for (const spec of PROFILES) {
    const { id, ...options } = spec, touch = !!options.hasTouch;
    const context = await browser.newContext(options), page = await context.newPage();
    const row = { id, viewport: options.viewport, checks: [], errors: [], shots: [] }; report.profiles.push(row);
    page.on('pageerror', (e) => row.errors.push(String(e)));
    // 로컬 vite 에는 Worker API(/api/*)가 없어 404 가 난다(기존 동작). 그 밖의 4xx/5xx 응답만 오류로 센다.
    page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) row.errors.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400 && !new URL(r.url()).pathname.startsWith('/api/')) row.errors.push(`HTTP ${r.status()} ${r.url()}`); });
    const check = (name, ok, detail) => { row.checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); if (!ok) failures.push(`${id}: ${name} ${detail === undefined ? '' : JSON.stringify(detail)}`); };
    const act = async (selector) => {
      const target = page.locator(selector).first();
      try { await (touch ? target.tap({ timeout: 15000 }) : target.click({ timeout: 15000 })); }
      catch (error) {
        const box = await target.boundingBox(); if (!box) throw error;
        row.inputFallbacks = (row.inputFallbacks || 0) + 1;
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
      }
    };
    const shot = async (name) => { const file = path.join(out, `${id}-${name}.png`); await page.screenshot({ path: file, timeout: 120000 }); row.shots.push(file); };
    const settle = (ms = 300) => page.waitForTimeout(ms);
    const state = () => page.evaluate(() => {
      const d = document.querySelector('#stage-select'), enter = document.querySelector('#stage-select-enter');
      const sel = document.querySelector('#stage-select-list [aria-pressed="true"]');
      const r = d?.getBoundingClientRect();
      return { mode: window.app.mode, energy: window.app.eco.s.energy, open: !!d?.open, tab: d?.dataset.tab, entry: d?.dataset.entry,
        selected: sel?.dataset.stage || (sel ? `${sel.dataset.dungeonId}:${sel.dataset.depth}` : null), enterDisabled: !!enter?.disabled,
        enterLabel: enter?.textContent?.trim(), blocked: document.querySelector('#stage-select-blocked')?.textContent || '',
        intro: !!d?.open && !document.querySelector('#stage-select-intro')?.hidden, introText: document.querySelector('#stage-select-intro')?.textContent || '',
        prep: !!window.app.hubUI?.opened || !!document.querySelector('dialog.citadel-hub-dialog[open]'), expeditionOpen: !!window.app.expeditionUI?.opened,
        focus: document.activeElement?.id || document.activeElement?.className || '', rect: r && { x: Math.round(r.x), y: Math.round(r.y), r: Math.round(r.right), b: Math.round(r.bottom) },
        overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
        memory: (() => { try { return JSON.parse(localStorage.getItem('blade-surge.stage-select.v1') || 'null'); } catch { return 'err'; } })() };
    });
    const dismissRotate = async () => { const b = page.locator('#rotate-hint #btn-ignore-rotate'); if (await b.isVisible().catch(() => false)) { await act('#rotate-hint #btn-ignore-rotate'); await settle(200); } };
    // 상세 줄·입장 버튼이 화면 안에 있고 서로 겹치지 않는지, 시트가 화면을 넘지 않는지.
    const layout = () => page.evaluate(() => {
      const box = (s) => { const n = document.querySelector(s); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
      const enter = box('#stage-select-enter'), dialog = box('#stage-select'), intro = box('#stage-select-intro');
      const inView = (b) => !!b && b.x >= -1 && b.y >= -1 && b.r <= innerWidth + 1 && b.b <= innerHeight + 1;
      const hit = enter ? document.elementFromPoint(enter.x + enter.w / 2, enter.y + enter.h / 2) : null;
      const nodes = [...document.querySelectorAll('#stage-select .ss-node')].map((n) => n.getBoundingClientRect());
      const nodesInView = nodes.every((r) => r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth);
      const introOverlapsSheet = !!intro && intro.w > 0 && !(intro.r <= dialog.x || intro.x >= dialog.r || intro.b <= dialog.y || intro.y >= dialog.b);
      // 노드 겹침: 원판끼리, 꼬리표와 다른 노드 원판. 첫 안내와 상단 재화 줄 겹침.
      const discs = [...document.querySelectorAll('#stage-select .ss-node-disc')].map((n) => n.getBoundingClientRect());
      const tags = [...document.querySelectorAll('#stage-select .ss-node')].map((n) => n.querySelector('.ss-node-tag')?.getBoundingClientRect());
      const hitRect = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      let nodeOverlaps = 0;
      for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++) if (hitRect(discs[i], discs[j])) nodeOverlaps++;
      tags.forEach((tag, own) => { if (tag) discs.forEach((disc, index) => { if (index !== own && hitRect(tag, disc)) nodeOverlaps++; }); });
      const minDisc = discs.length ? Math.min(...discs.map((r) => Math.min(r.width, r.height))) : 0;
      const guideBox = document.querySelector('#stage-select-intro:not([hidden])')?.getBoundingClientRect();
      const bar = document.querySelector('#cur-energy')?.getBoundingClientRect();
      const guideCoversBar = !!guideBox && !!bar && guideBox.width > 0 && guideBox.top < bar.bottom - 1 && guideBox.bottom > bar.top;
      const map = document.querySelector('#stage-select .ss-path')?.getBoundingClientRect();
      const mapAspect = map && map.height ? +(map.width / map.height).toFixed(3) : null;
      return { nodeOverlaps, minDisc, guideCoversBar, mapAspect, enter, dialog, enterInView: inView(enter), dialogInView: inView(dialog), enterHit: !!hit && (hit.id === 'stage-select-enter' || !!hit.closest?.('#stage-select-enter')), nodesInView, introOverlapsSheet, smallTargets: [...document.querySelectorAll('#stage-select button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 32 || r.width < 32); }).map((b) => b.getAttribute('aria-label') || b.textContent) };
    });
    try {
      await installAutoStarter(page); await page.goto(origin);
      await settle(400); await dismissRotate();
      await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 240000 });
      await dismissRotate(); await act('#boot-start');
      await page.waitForFunction(() => window.app?.mode === 'lobby' && !document.querySelector('#boot.show') && window.app.oathShell, undefined, { timeout: 180000 });
      await settle(1500); await dismissRotate();
      for (let n = 0; n < 5; n++) { const c = page.locator('#modal.show #m-cancel'); if (!await c.isVisible().catch(() => false)) break; await dismissRotate(); await act('#modal.show #m-cancel'); await settle(250); }
      await settle(500);
      const start = await state();
      await shot('00-lobby');
      // 1) 출격 → 선택 화면
      await act('#citadel-dungeon-prepare'); await settle(500);
      let s = await state();
      check('출격 → 선택 화면 열림(전투 아님·비용 없음)', s.open && s.mode === 'lobby' && s.energy === start.energy, s);
      check('기본 탭 캠페인 · 1-1 추천 선택 · 입장 가능', s.tab === 'campaign' && s.selected === '1-1' && !s.enterDisabled, s);
      check('첫 안내 띠 1회 표시', s.intro && s.introText.includes('처음이라면 1-1부터'), s.introText);
      const firstLayout = await layout(); row.layoutOpen = firstLayout;
      check('시트·입장 버튼이 화면 안, 입장 버튼이 가려지지 않음', firstLayout.dialogInView && firstLayout.enterInView && firstLayout.enterHit, firstLayout);
      check('관문 노드 10개 모두 화면 안', firstLayout.nodesInView);
      check('노드·꼬리표 겹침 없음, 노드 지름 40px 이상', firstLayout.nodeOverlaps === 0 && firstLayout.minDisc >= 39.5, { overlaps: firstLayout.nodeOverlaps, minDisc: firstLayout.minDisc });
      check('지도 상자 2.5:1', Math.abs(firstLayout.mapAspect - 2.5) < 0.02, firstLayout.mapAspect);
      check('첫 안내가 상단 재화 줄을 덮지 않음', !firstLayout.guideCoversBar);
      check('가로 스크롤 없음', s.overflowX <= 0, s.overflowX);
      await shot('01-open-campaign');
      // 2) 잠긴 관문
      await act('#stage-select .ss-node[data-stage="1-3"]'); await settle(250);
      s = await state();
      check('잠긴 1-3 고르면 입장 불가 + 사유 한 줄', s.selected === '1-3' && s.enterDisabled && s.blocked.includes('1-2 클리어 시 해금'), s);
      await shot('02-locked-1-3');
      // 3) 던전 탭
      await act('#stage-select-tab-dungeon'); await settle(300);
      s = await state();
      check('던전 탭 전환(비용 없음) · 열린 던전 선택', s.tab === 'dungeon' && !!s.selected && !s.enterDisabled && s.energy === start.energy, s);
      await shot('03-dungeon-tab');
      const deepLocked = page.locator('#stage-select .ss-depth[data-depth="deep"][data-locked="true"]').first();
      if (await deepLocked.count()) {
        await act('#stage-select .ss-depth[data-depth="deep"][data-locked="true"]'); await settle(200);
        s = await state();
        check('잠긴 심층 단계 사유 표시', s.enterDisabled && /클리어 필요|레벨/.test(s.blocked), s.blocked);
      }
      // 4) ESC 닫기 → 비용 없음·초점 복귀
      await page.keyboard.press('Escape'); await settle(300);
      s = await state();
      check('ESC 닫기: 비용 없음 · 출격 버튼으로 초점 복귀', !s.open && s.energy === start.energy && s.mode === 'lobby' && s.focus === 'citadel-dungeon-prepare', s);
      // 5) 다시 열기 → 안내 다시 안 뜸 → 닫기 버튼
      await act('#citadel-dungeon-prepare'); await settle(400);
      s = await state();
      check('두 번째 열기: 첫 안내 다시 안 뜸', s.open && !s.intro, s);
      await act('#stage-select-close'); await settle(300);
      s = await state();
      check('닫기 버튼: 비용 없음 · 초점 복귀', !s.open && s.energy === start.energy && s.focus === 'citadel-dungeon-prepare', s);
      // 6) 던전 입장 → 준비창만 열림(비용 없음) → 취소 → 다시 출격 시 던전 기억
      await act('#citadel-dungeon-prepare'); await settle(400);
      await act('#stage-select-tab-dungeon'); await settle(300);
      await act('#stage-select .ss-depth[data-dungeon-id="glass_garden"][data-depth="standard"]'); await settle(200);
      await act('#stage-select-enter'); await settle(700);
      s = await state();
      check('던전 입장 = 기존 준비창 열림, 에너지 그대로', !s.open && (s.prep || s.expeditionOpen) && s.energy === start.energy, s);
      await shot('04-dungeon-prep');
      await page.keyboard.press('Escape'); await settle(400);
      await act('#citadel-dungeon-prepare'); await settle(400);
      s = await state();
      check('다시 출격: 마지막 선택(유리정원 기본) 기억', s.open && s.tab === 'dungeon' && s.selected === 'glass_garden:standard' && !s.enterDisabled, s);
      await shot('05-remembered-dungeon');
      // 7) 캠페인으로 돌아가 1-1 입장 → 전투
      await act('#stage-select-tab-campaign'); await settle(300);
      s = await state();
      check('캠페인 탭 복귀 시 다음 관문 1-1', s.tab === 'campaign' && s.selected === '1-1', s);
      if (id === battleProfile) {
        const cost = await page.evaluate(() => window.app.eco.s.energy);
        await act('#stage-select-enter');
        await page.waitForFunction(() => window.app.mode === 'battle' && window.app.battle?.active, undefined, { timeout: 180000 }).catch(() => {});
        await settle(1500);
        s = await state();
        const stageEnergy = await page.evaluate(() => window.app.battle?.stage?.energy);
        check('1-1 입장 → 전투 진입 · 에너지 1회 차감', s.mode === 'battle' && cost - s.energy === stageEnergy, { mode: s.mode, before: cost, after: s.energy, stageEnergy, code: await page.evaluate(() => window.app.battle?.stage?.code) });
        await shot('06-battle-1-1');
        // 로비 복귀는 검증 준비 단계(기존 포기·정산 경로는 이 화면 범위 밖).
        await page.evaluate(() => window.app.toLobby());
        await page.waitForFunction(() => window.app.mode === 'lobby', undefined, { timeout: 60000 });
        await settle(1200);
        for (let n = 0; n < 5; n++) { const c = page.locator('#modal.show #m-cancel'); if (!await c.isVisible().catch(() => false)) break; await act('#modal.show #m-cancel'); await settle(250); }
        await act('#citadel-dungeon-prepare'); await settle(400);
        s = await state();
        check('전투 뒤 다시 출격: 캠페인 1-1(추천을 골랐던 기억) 한 번 탭으로 입장 가능', s.open && s.tab === 'campaign' && s.selected === '1-1' && !s.enterDisabled && s.memory?.last?.followed === true, s);
        await act('#stage-select-close'); await settle(300);
      } else {
        await act('#stage-select-close'); await settle(300);
      }
      // 8) 시드 저장(1-3 클리어) → 추천 1-4
      await page.evaluate(() => { const eco = window.app.eco; eco.s.progress.unlocked = 4; eco.s.progress.stars = { '1-1': 3, '1-2': 2, '1-3': 1 }; eco.save(); eco.emit(); localStorage.removeItem('blade-surge.stage-select.v1'); window.app.stageSelect.memory = { introSeen: false, last: null }; window.app.commandUI.selectedId = null; });
      await settle(300);
      await act('#citadel-dungeon-prepare'); await settle(500);
      s = await state();
      check('시드(1-3 클리어): 추천·기본 선택 1-4, 첫 안내 없음', s.open && s.tab === 'campaign' && s.selected === '1-4' && !s.enterDisabled && !s.intro, s);
      await shot('07-seed-1-4');
      // --regions: 6지역 지도·노드 배치 캡처(지역 넘기기 버튼 실제 입력). 잠긴 지역도 볼 수 있다.
      if (args.includes('--regions')) {
        for (let ch = 2; ch <= 6; ch++) { await act('#stage-select .ss-region-step[data-dir="next"]'); await settle(900); await shot(`08-region-${ch}`); const l = await layout(); check(`지역 ${ch} 노드 화면 안·겹침 없음`, l.nodesInView && l.nodeOverlaps === 0, { overlaps: l.nodeOverlaps }); }
        const nodesOk = await layout(); check('6지역 넘겨 보기 후 노드 화면 안·겹침 없음', nodesOk.nodesInView && nodesOk.nodeOverlaps === 0, nodesOk);
      }
      await act('#stage-select-close'); await settle(200);
      check('런타임 오류 0', row.errors.length === 0, row.errors.slice(0, 5));
    } catch (error) {
      row.fatal = String(error?.stack || error);
      failures.push(`${id}: fatal ${error?.message}`);
      await shot('99-fatal').catch(() => {});
    }
    await context.close();
  }
} finally {
  await browser.close();
}
report.failures = failures;
report.finished = new Date().toISOString();
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ failures, profiles: report.profiles.map((p) => ({ id: p.id, pass: p.checks.filter((c) => c.ok).length, total: p.checks.length, fatal: p.fatal ? p.fatal.slice(0, 300) : undefined })) }, null, 2));
process.exit(failures.length ? 1 : 0);
