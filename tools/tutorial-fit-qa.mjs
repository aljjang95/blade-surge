// 첫 전투 안내 카드가 가로 화면의 전투 조작부와 겹치지 않는지 실제 브라우저에서 잰다.
// 사용: node tools/tutorial-fit-qa.mjs [origin] [out-dir]
//   origin 기본 http://127.0.0.1:4174 (vite preview), out-dir 기본 work/tutorial-fit
// 판정(필수 뷰포트 667x375, 740x360, 844x390, 915x412, 1280x720 에서 모두 통과해야 exit 0):
//   1) .tutorial-card 와 그 안의 버튼이 모든 조작 버튼(공격·회피·스킬·물약·AUTO·일시정지·카메라·직행·조이스틱 판)과
//      HUD 정보 카드(체력·스테이지·웨이브·미니맵·목표)에 교차하지 않는다.
//   2) 카드 안의 버튼은 조이스틱 터치 영역(#joy)에 들어가지 않고, 아래 띠 배치의 카드는 터치 영역과도 겹치지 않는다.
//   3) 각 조작 버튼 중심의 elementFromPoint 가 그 버튼 자신이다(회피 버튼 포함). 스킬 버튼은 안내 카드가 가리지 않는지만 본다.
//   4) 실제 터치로 회피 버튼 중심을 누르면 회피 입력이 들어가고 안내는 끝나지 않는다.
// 안내 단계 5개 x 안내 방식 2가지(첫 전투 자동 안내 guided / 다시 열어 본 수동 안내 manual)를 모두 잰다.
// 보조 뷰포트(568x320, 640x360, 900x600, 1024x768)는 같은 판정을 하되 실패해도 warnings 로만 남긴다.
// Chromium 터치 에뮬레이션(isMobile+hasTouch) 증거이며 실제 Android/GPU/발열 검증이 아니다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { launchOpts } from './chrome.mjs';

const origin = process.argv[2] || 'http://127.0.0.1:4174';
const out = resolve(process.argv[3] || 'work/tutorial-fit');
mkdirSync(out, { recursive: true });

const REQUIRED = [[667, 375], [740, 360], [844, 390], [915, 412], [1280, 720]];
const EXTRA = [[568, 320], [640, 360], [900, 600], [1024, 768]];
const PHASES = ['move', 'attack', 'dodge', 'skill', 'clear'];
const MODES = ['guided', 'manual'];

// 카드가 피해야 하는 조작부(눌리는 것). 보이는 요소만 잰다.
const CONTROLS = {
  attack: '#btn-attack', dodge: '#btn-dodge', skill: '#hud .skill-btn', auto: '#btn-auto', pause: '#btn-pause',
  bossShortcut: '#btn-boss-shortcut', mapButton: '#btn-map', potion: '#hud .exp-potions button',
  cameraButton: '#battle-camera-controls button', aimCancel: '#skill-aim-cancel', earned: '.battle-earned-offer',
  joyBase: '#hud .joy-base', joyKnob: '#joy-knob', tutorialToggle: '#tutorial-toggle',
};
// HUD 정보 카드. 접히지 않는 정보라 겹치면 읽기를 해친다.
const INFO = { hpCard: '.hud-player', stage: '#hud-stage', wave: '#hud-wave', minimap: '#minimap-wrap', objective: '#objective' };
// 중앙 플레이 영역(주인공이 서는 자리 둘레). 카드가 덮으면 경고로 남긴다.
const PLAY_CENTER = { halfW: 60, halfH: 40 };

const report = { origin, viewports: [], failures: [], warnings: [], errors: [] };
const browser = await chromium.launch(launchOpts({ headless: true }));

async function boot(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', error => report.errors.push(`${width}x${height} ${error.message}`));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('#boot-start:not(.hidden)').waitFor({ timeout: 90000 });
  await page.evaluate(() => { const eco = window.app.eco; eco.reset(); eco.save(); });
  await page.locator('#boot-start').tap();
  await page.waitForFunction(() => window.app.mode === 'lobby', null, { timeout: 60000 });
  await page.evaluate(async () => { const app = window.app; app.ui.closeModal(); await app.startStage(app.eco.nextStage()); });
  await page.waitForFunction(() => window.app.battle?.active && !window.app.stageStarting, null, { timeout: 120000 });
  await page.waitForTimeout(800);
  return { ctx, page };
}

// 페이지 안에서 모든 조작·정보 요소와 카드의 사각형을 한 번에 잰다.
const measure = ({ controls, info }) => {
  const round = n => Math.round(n * 10) / 10;
  const rect = el => { const r = el.getBoundingClientRect(); return { x: round(r.left), y: round(r.top), r: round(r.right), b: round(r.bottom) }; };
  const visible = el => el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true }) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
  const gather = map => {
    const rows = [];
    for (const [name, selector] of Object.entries(map)) {
      document.querySelectorAll(selector).forEach((el, index) => { if (visible(el)) rows.push({ name: `${name}${index ? `#${index}` : ''}`, ...rect(el) }); });
    }
    return rows;
  };
  const card = document.querySelector('#tutorial-panel');
  const cardVisible = !!card && visible(card);
  const buttons = cardVisible ? [...card.querySelectorAll('button')].filter(visible).map(el => ({ name: el.id, ...rect(el) })) : [];
  const joy = document.getElementById('joy');
  const potions = [...document.querySelectorAll('#hud .exp-potions button')].filter(visible).map(rect);
  return {
    vw: innerWidth, vh: innerHeight,
    card: cardVisible ? rect(card) : null, cardButtons: buttons,
    copyFont: card ? getComputedStyle(card.querySelector('p')).fontSize : null,
    guidedClass: document.getElementById('battle-tutorial').classList.contains('guided'),
    controls: gather(controls), info: gather(info),
    joyZone: joy ? rect(joy) : null,
    potionRight: potions.length ? Math.max(...potions.map(p => p.r)) : null,
  };
};

const hit = (a, b) => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
const dist = (a, b) => Math.max(b.x - a.r, a.x - b.r, b.y - a.b, a.y - b.b);

try {
  report.build = await (await fetch(origin + '/version.json')).json();
  for (const [width, height, required] of [...REQUIRED.map(v => [...v, true]), ...EXTRA.map(v => [...v, false])]) {
    const label = `${width}x${height}`;
    const fail = message => (required ? report.failures : report.warnings).push(`${label}: ${message}`);
    const { ctx, page } = await boot(width, height);
    const row = { viewport: label, required, phases: [] };
    try {
      for (const mode of MODES) {
        for (const phase of PHASES) {
          // 안내를 해당 단계로 펼쳐 둔 채 고정한다(문구 길이가 단계마다 달라 카드 높이도 달라진다).
          await page.evaluate(({ p, guided }) => {
            const t = window.app.tutorial; t.phase = null; t.guided = guided; t.expanded = true; t.setExpanded(true, 1e9); t.show(p); t.expandUntil = 1e9;
          }, { p: phase, guided: mode === 'guided' });
          await page.waitForTimeout(120);
          const m = await page.evaluate(measure, { controls: CONTROLS, info: INFO });
          const tag = `${mode}/${phase}`;
          if (!m.card) { fail(`${tag} 카드가 보이지 않음`); continue; }
          if (m.guidedClass !== (mode === 'guided')) fail(`${tag} guided 클래스가 기대와 다름(${m.guidedClass})`);
          const layout = m.card.y > m.vh * 0.6 ? 'bottom' : 'top';
          const targets = [...m.controls, ...m.info];
          const parts = [{ name: 'card', ...m.card }, ...m.cardButtons.map(b => ({ ...b, name: `card:${b.name}` }))];
          let minGap = Infinity;
          for (const part of parts) {
            for (const target of targets) {
              if (hit(part, target)) fail(`${tag} ${part.name} 이(가) ${target.name} 와 겹침 (${JSON.stringify(part)} vs ${JSON.stringify(target)})`);
              minGap = Math.min(minGap, dist(part, target));
            }
            if (part.x < 0 || part.y < 0 || part.r > m.vw || part.b > m.vh) fail(`${tag} ${part.name} 가 화면 밖`);
          }
          // 조이스틱 터치 영역: 카드 버튼은 어느 경우에도 들어가면 안 되고, 아래 띠 배치에서는 카드 전체가 비켜야 한다.
          if (m.joyZone) {
            for (const button of m.cardButtons) if (hit(button, m.joyZone)) fail(`${tag} ${button.name} 이(가) 조이스틱 터치 영역 안`);
            if (layout === 'bottom' && hit(m.card, m.joyZone)) fail(`${tag} 아래 띠 카드가 조이스틱 터치 영역과 겹침`);
          }
          const center = { x: m.vw / 2 - PLAY_CENTER.halfW, y: m.vh / 2 - PLAY_CENTER.halfH, r: m.vw / 2 + PLAY_CENTER.halfW, b: m.vh / 2 + PLAY_CENTER.halfH };
          const coversCenter = hit(m.card, center);
          if (coversCenter) report.warnings.push(`${label}: ${tag} 카드가 중앙 플레이 영역(${JSON.stringify(center)})을 덮음`);
          row.phases.push({ mode, phase, layout, card: m.card, buttons: m.cardButtons.map(b => `${b.name} ${b.x},${b.y}-${b.r},${b.b}`), minGap: Math.round(minGap * 10) / 10, copyFont: m.copyFont, coversCenter });
          if (mode === 'guided' && phase === 'move') {
            row.rects = Object.fromEntries(m.controls.concat(m.info).map(c => [c.name, `${c.x},${c.y} - ${c.r},${c.b}`]));
            row.joyZone = m.joyZone; row.potionRight = m.potionRight;
            const dodge = m.controls.find(c => c.name === 'dodge');
            const leftEdge = Math.max(m.joyZone?.r ?? 0, m.potionRight ?? 0);
            // 아래 띠로 쓸 수 있는 폭 = 회피 버튼 왼쪽 끝 - (조이스틱 터치 영역·물약 줄 중 더 오른쪽 끝).
            row.bottomGap = { from: leftEdge, to: dodge?.x, width: dodge ? Math.round((dodge.x - leftEdge) * 10) / 10 : null };
          }
          if (phase === 'dodge' || (mode === 'guided' && phase === 'move')) await page.screenshot({ path: resolve(out, `${label}-${mode}-${phase}.png`) });
        }
      }
      // elementFromPoint: 모든 조작 버튼의 중심이 그 버튼이어야 한다(카드가 가장 길어지는 단계에서 확인).
      await page.evaluate(() => { const t = window.app.tutorial; t.guided = true; t.setExpanded(true, 1e9); t.show('attack'); t.expandUntil = 1e9; });
      const probes = await page.evaluate(selectors => selectors.flatMap(([name, selector]) => [...document.querySelectorAll(selector)].filter(el => el.checkVisibility() && el.getBoundingClientRect().width > 0).map((el, i) => {
        const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        const top = document.elementFromPoint(x, y);
        return { name: `${name}${i ? `#${i}` : ''}`, x: Math.round(x), y: Math.round(y), ok: !!top && (top === el || el.contains(top)), underTutorial: !!top?.closest('.tutorial-card'), hit: top ? (top.id || top.className || top.tagName) : null };
      })), [['dodge', '#btn-dodge'], ['attack', '#btn-attack'], ['skill', '#hud .skill-btn'], ['auto', '#btn-auto'], ['pause', '#btn-pause'], ['potion', '#hud .exp-potions button'], ['camera', '#battle-camera-controls button'], ['toggle', '#tutorial-toggle']]);
      row.elementFromPoint = probes;
      for (const probe of probes) {
        if (probe.underTutorial) fail(`elementFromPoint(${probe.x},${probe.y}) ${probe.name} 중심이 안내 카드 위: ${probe.hit}`);
        // 스킬 버튼은 공격 버튼의 넓은 터치 영역에 가려지는 기존 배치가 있어 안내 카드와 무관하게 경고로만 남긴다.
        else if (!probe.ok && probe.name.startsWith('skill')) report.warnings.push(`${label}: elementFromPoint(${probe.x},${probe.y}) ${probe.name} 중심이 ${probe.hit} (안내와 무관한 기존 배치)`);
        else if (!probe.ok) fail(`elementFromPoint(${probe.x},${probe.y}) 가 ${probe.name} 가 아니라 ${probe.hit}`);
      }
      // 실제 터치: 회피 버튼 중심을 누르면 회피 입력이 큐에 들어가고 안내는 끝나지 않는다.
      const dodge = probes.find(p => p.name === 'dodge');
      if (dodge) {
        await page.evaluate(() => {
          const t = window.app.tutorial; t.guided = true; t.setExpanded(true, 1e9); t.show('dodge'); t.expandUntil = 1e9;
          const input = window.app.input; window.__pressed = [];
          if (!input.__wrapped) { const press = input.press.bind(input); input.press = a => { window.__pressed.push(a); return press(a); }; input.__wrapped = true; }
        });
        await page.waitForTimeout(200);
        await page.touchscreen.tap(dodge.x, dodge.y);
        await page.waitForTimeout(300);
        const state = await page.evaluate(() => ({ pressed: window.__pressed, tutorialPhase: window.app.tutorial.phase, completed: !!window.app.eco.s.tutorial?.completed }));
        row.dodgeTap = { x: dodge.x, y: dodge.y, ...state };
        if (!state.pressed.includes('dodge')) fail(`회피 버튼 탭에 회피 입력이 들어가지 않음 ${JSON.stringify(state)}`);
        if (state.completed || state.tutorialPhase === null) fail(`회피 버튼 탭이 안내를 끝냄 ${JSON.stringify(state)}`);
      }
    } finally { await ctx.close(); }
    report.viewports.push(row);
  }
  report.status = report.failures.length || report.errors.length ? 'fail' : 'pass';
} catch (error) { report.status = 'fail'; report.failure = error.stack; }
finally {
  await browser.close();
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    status: report.status,
    viewports: report.viewports.map(v => ({
      viewport: v.viewport, required: v.required, layouts: [...new Set(v.phases.map(p => p.layout))], bottomGapWidth: v.bottomGap?.width,
      minGap: Math.min(...v.phases.map(p => p.minGap)), maxCardHeight: Math.max(...v.phases.map(p => Math.round(p.card.b - p.card.y))),
      dodgePressed: v.dodgeTap?.pressed?.includes('dodge'), tutorialAlive: v.dodgeTap ? !v.dodgeTap.completed && v.dodgeTap.tutorialPhase !== null : null,
    })),
    failures: report.failures, warnings: report.warnings, errors: report.errors, failure: report.failure,
  }, null, 1));
  if (report.status !== 'pass') process.exitCode = 1;
}
