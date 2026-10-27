// tools/s720-ui-qa.mjs 의 시나리오 모음. 모든 조작은 실제 탭/클릭 입력이고, 저장 주입과 승리 조건 개방(전투 AI 대신)만 evaluate 로 한다.
const openStageSelect = async ({ act, settle }) => { await act('#citadel-dungeon-prepare'); await settle(600); };
/** 관문 선택에서 지역 이전 버튼을 눌러 1지역으로 가서 1-1 을 고른다. */
const goRegionOne = async ({ page, act, settle }) => {
  for (let n = 0; n < 6; n++) { const ch = await page.evaluate(() => window.app.stageSelect.model?.campaign?.chapter); if (ch === 1) break; await act('#stage-select .ss-region-step[data-dir="prev"]'); await settle(250); }
  await act('#stage-select .ss-node[data-stage="1-1"]'); await settle(250);
};
const panelState = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector(s), t = (s) => q(s)?.textContent?.trim() || '';
  const opts = [...document.querySelectorAll('#stage-select-diff .dp-option')].map((b) => ({ id: b.dataset.dp, locked: b.dataset.locked === 'true', pressed: b.getAttribute('aria-pressed') === 'true', sub: b.querySelector('.dp-option-sub')?.textContent }));
  const torment = q('#stage-select-diff .dp-torment');
  return {
    open: !!q('#stage-select-diff') && !q('#stage-select-diff').hidden, opts, reason: t('#stage-select-diff .dp-reason'), tormentShown: !!torment && !torment.hidden, tier: t('#stage-select-diff .dp-tier'),
    chips: [...document.querySelectorAll('#stage-select-diff .dp-chip')].map((n) => n.textContent.trim()), full: t('#stage-select-diff .dp-full'), decay: t('#stage-select-diff .dp-decay'), rule: t('#stage-select-diff .dp-rule'),
    downDisabled: !!q('#stage-select-diff .dp-down')?.disabled, upDisabled: !!q('#stage-select-diff .dp-up')?.disabled, topDisabled: !!q('#stage-select-diff .dp-top')?.disabled,
    difficulty: window.app.eco.s.progress.difficulty, button: t('#stage-select-difficulty .ss-diff-value'),
    detailTag: t('#stage-select .ss-detail-tag'), blocked: t('#stage-select-blocked'), enterCost: t('#stage-select .ss-enter-cost'), enterDisabled: !!q('#stage-select-enter')?.disabled,
    facts: [...document.querySelectorAll('#stage-select .ss-fact:not([hidden])')].map((n) => n.textContent.replace(/\s+/g, ' ').trim()), energy: window.app.eco.s.energy,
  };
});
const mapLayout = (page) => page.evaluate(() => {
  const discs = [...document.querySelectorAll('#stage-select .ss-node-disc')].map((n) => n.getBoundingClientRect());
  const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  let overlaps = 0; for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++) if (hit(discs[i], discs[j])) overlaps++;
  const dlg = document.querySelector('#stage-select').getBoundingClientRect(), enter = document.querySelector('#stage-select-enter')?.getBoundingClientRect();
  return {
    overlaps, minDisc: discs.length ? Math.round(Math.min(...discs.map((r) => Math.min(r.width, r.height)))) : 0,
    nodesInView: discs.every((r) => r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth),
    dialogInView: dlg.left >= -1 && dlg.top >= -1 && dlg.right <= innerWidth + 1 && dlg.bottom <= innerHeight + 1, enterVisible: !!enter && enter.height > 0 && enter.bottom <= innerHeight + 1,
  };
});

export const SCENARIOS = [
  // ① 잠금 사유: 지옥 1지역을 4관문만 깬 저장 → 고통 단계는 "지옥 1장 10관문 클리어 시 T1 (4/10)"
  { id: 'lock-reason', run: async (ctx) => {
    const { page, act, settle, shot, check, layout } = ctx;
    await page.evaluate(() => { const eco = window.app.eco, s = eco.s; s.endgame = { ...s.endgame, peak: Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`1-${i + 1}`, 3])), torment: { best: 0, today: { day: 0, runs: 0 } } }; s.progress.difficulty = 'story'; eco.emit(); });
    await openStageSelect(ctx); await goRegionOne(ctx);
    await act('#stage-select-difficulty'); await settle(300);
    let s = await panelState(page);
    check('난이도 버튼 → 난이도판 열림 · 선택지 5개', s.open && s.opts.map((o) => o.id).join() === 'story,adept,nightmare,hell,torment', s.opts);
    const torment = s.opts.find((o) => o.id === 'torment');
    check('고통 단계 잠김 + 사유 "지옥 1장 10관문 클리어 시 T1 (4/10)"', torment.locked && s.reason.includes('지옥 1장 10관문 클리어 시 T1 (4/10)') && !s.tormentShown, { reason: s.reason, torment });
    await act('#stage-select-diff .dp-option[data-dp="torment"]'); await settle(200);
    s = await panelState(page);
    check('잠긴 고통을 눌러도 난이도 그대로(스토리) · 사유 유지', s.difficulty === 'story' && s.reason.includes('T1'), { difficulty: s.difficulty, reason: s.reason });
    const lay = await layout('#stage-select-diff', '');
    check('난이도판: 버튼 화면 안 · 겹침 없음 · 44px 이상 · 가로 스크롤 없음', !lay.missing && lay.out.length === 0 && lay.overlaps.length === 0 && lay.small.length === 0 && lay.overflowX <= 0, lay);
    await shot('10-diff-locked-reason');
    await act('#stage-select-diff-close'); await settle(250);
    await act('#stage-select-close'); await settle(300);
    await page.evaluate(ctx.SEED); await settle(300);
  } },
  // ② 서버 권위 계정: 지옥·고통 단계가 같은 사유로 잠긴다
  { id: 'server-lock', run: async (ctx) => {
    const { page, act, settle, shot, check } = ctx;
    await page.evaluate(() => { window.__realAccount = window.app.account; window.app.account = { ...(window.app.account || {}), authority: 'server' }; });
    await openStageSelect(ctx); await goRegionOne(ctx);
    await act('#stage-select-difficulty'); await settle(300);
    const s = await panelState(page);
    const hell = s.opts.find((o) => o.id === 'hell'), torment = s.opts.find((o) => o.id === 'torment');
    check('서버 권위: 지옥·고통 잠김 + 같은 사유 문구', hell.locked && torment.locked && s.reason.includes('서버 계정의 지옥·고통 단계 정산을 준비 중입니다.') && !s.tormentShown, { hell, torment, reason: s.reason });
    await act('#stage-select-diff .dp-option[data-dp="hell"]'); await settle(200);
    const after = await panelState(page);
    check('서버 권위: 잠긴 지옥을 눌러도 난이도 변화 없음 · 사유 표시', after.difficulty === s.difficulty && after.reason.includes('서버 계정'), after.reason);
    await shot('11-diff-server-lock');
    await page.keyboard.press('Escape'); await settle(250);
    let esc = await page.evaluate(() => ({ panel: !document.querySelector('#stage-select-diff').hidden, open: window.app.stageSelect.isOpen, focus: document.activeElement?.id }));
    check('ESC: 난이도판만 닫히고 관문 선택은 열려 있음 · 초점은 난이도 버튼', !esc.panel && esc.open && esc.focus === 'stage-select-difficulty', esc);
    await page.keyboard.press('Escape'); await settle(300);
    esc = await page.evaluate(() => ({ open: window.app.stageSelect.isOpen }));
    check('ESC 한 번 더: 관문 선택 닫힘', !esc.open, esc);
    await page.evaluate(() => { window.app.account = window.__realAccount; });
  } },
  // ③ 고통 단계 선택 → 출격 → 결과 띠
  { id: 'torment-select', run: async (ctx) => {
    const { page, act, settle, shot, check, layout } = ctx;
    await openStageSelect(ctx); await goRegionOne(ctx);
    await act('#stage-select-difficulty'); await settle(300);
    let s = await panelState(page);
    const torment = s.opts.find((o) => o.id === 'torment');
    check('지옥 1지역 클리어 + 최고 T2 → 고통 열림(최고 해금 T3)', !torment.locked && torment.sub === 'T3', torment);
    await act('#stage-select-diff .dp-option[data-dp="torment"]'); await settle(300);
    s = await panelState(page);
    check('고통 선택 → 해금 최고 단계 T3 로 적용', s.difficulty === 'torment-3' && s.tier === '고통 3단계' && s.tormentShown && s.opts.find((o) => o.id === 'torment').pressed, { difficulty: s.difficulty, tier: s.tier });
    check('배율 · 에너지 0 · 오늘 풀 보상 남은 판 표시', s.chips.some((c) => /적 체력·공격 지옥 ×/.test(c)) && s.chips.some((c) => /재화·재료 ×/.test(c)) && s.chips.some((c) => /경험치 ×/.test(c)) && s.chips.includes('에너지 0') && /24\/24판 남음/.test(s.full), { chips: s.chips, full: s.full });
    check('단계 스텝퍼: 최고 단계에서 + 비활성 · − 활성', s.upDisabled && !s.downDisabled && s.topDisabled, s);
    await shot('12-diff-torment-t3');
    await act('#stage-select-diff .dp-down'); await settle(200); await act('#stage-select-diff .dp-down'); await settle(250);
    s = await panelState(page);
    check('− 두 번 → T1(난이도 torment-1) · − 비활성', s.difficulty === 'torment-1' && s.tier === '고통 1단계' && s.downDisabled && !s.upDisabled && !s.topDisabled, { difficulty: s.difficulty, tier: s.tier });
    const lay = await layout('#stage-select-diff', '');
    check('난이도판(고통): 화면 안 · 겹침 없음 · 44px 이상 · 가로 스크롤 없음', !lay.missing && lay.out.length === 0 && lay.overlaps.length === 0 && lay.small.length === 0 && lay.overflowX <= 0, lay);
    await shot('13-diff-torment-t1');
    await act('#stage-select-diff-close'); await settle(300);
    s = await panelState(page);
    const map = await mapLayout(page);
    check('시트 상세: 난이도 버튼 "고통 T1" · 에너지 0 · 풀 보상 24/24', s.button === '고통 T1' && s.enterCost === '에너지 0' && s.facts.some((f) => f.includes('풀 보상') && f.includes('24/24')), { button: s.button, cost: s.enterCost, facts: s.facts });
    check('관문 노드 화면 안 · 겹침 없음 · 입장 버튼 보임', map.nodesInView && map.overlaps === 0 && map.dialogInView && map.enterVisible, map);
    await shot('14-torment-selected');
    // 감쇠 판 안내: 오늘 풀 보상 24판을 모두 쓴 상태
    await page.evaluate(() => { const eco = window.app.eco; eco.s.endgame.torment.today = { day: 99999, runs: 24 }; eco.emit(); });
    await settle(300);
    s = await panelState(page);
    check('감쇠 판 안내 "오늘은 재화 35%, 경험치 100%"(입장 버튼 옆) · 입장 가능', s.blocked.includes('오늘은 재화 35%, 경험치 100%') && !s.enterDisabled && s.facts.some((f) => f.includes('모두 사용')), { blocked: s.blocked, facts: s.facts });
    await shot('15-torment-decay');
    await act('#stage-select-difficulty'); await settle(250);
    s = await panelState(page);
    check('난이도판에도 감쇠 안내 + 풀 보상 판 모두 사용', s.decay.includes('오늘은 재화 35%, 경험치 100%') && s.full.includes('모두 사용'), { decay: s.decay, full: s.full });
    await act('#stage-select-diff-close'); await settle(200);
    await page.evaluate(() => { const eco = window.app.eco; eco.s.endgame.torment.today = { day: 0, runs: 0 }; eco.emit(); });
    await settle(200);
    // 출격
    const before = await page.evaluate(() => ({ energy: window.app.eco.s.energy, rank: window.app.eco.legendState().rank }));
    await act('#stage-select-enter');
    await page.waitForFunction(() => window.app.mode === 'battle' && window.app.battle?.active, undefined, { timeout: 180000 }).catch(() => {});
    await settle(1500);
    const battle = await page.evaluate(() => ({ mode: window.app.mode, id: window.app.battle?.stage?.difficultyId, energy: window.app.battle?.stage?.energy, code: window.app.battle?.stage?.code, now: window.app.eco.s.energy }));
    check('출격: 1-1 고통 1단계 · 에너지 0(차감 없음)', battle.mode === 'battle' && battle.id === 'torment-1' && battle.energy === 0 && battle.now === before.energy, { before: before.energy, ...battle });
    await shot('16-battle-torment');
    // 승리 조건은 QA 가 열어 준다(전투 AI 를 돌리지 않는다). 정산·결과 화면은 실제 코드 경로다.
    await page.evaluate(() => { const b = window.app.battle; b.bossDefeated = true; if (b.routeObjectives) b.routeObjectives = null; b.victory(); });
    await page.waitForFunction(() => document.querySelector('#result.show') && document.querySelector('#result-endless') && !document.querySelector('#result-endless').hidden, undefined, { timeout: 60000 }).catch(() => {});
    await settle(2200);
    const res = await page.evaluate(() => {
      const strip = document.querySelector('#result-endless'), r = strip.getBoundingClientRect(), btns = document.querySelector('.result-btns')?.getBoundingClientRect(), box = document.querySelector('.result-box')?.getBoundingClientRect();
      const parts = [...strip.querySelectorAll('.re-part')].map((n) => ({ kind: n.dataset.kind, tone: n.dataset.tone, text: n.textContent }));
      return {
        hidden: strip.hidden, parts, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom) }, btnsTop: btns && Math.round(btns.top), boxIn: !!box && box.left >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1,
        shown: !!document.querySelector('#result.show'), receipt: JSON.parse(JSON.stringify(window.app.ui.lastReward?.torment || null)), legend: JSON.parse(JSON.stringify(window.app.ui.lastReward?.legend || null)),
        energyAfter: window.app.eco.s.energy, scrollW: document.documentElement.scrollWidth - innerWidth,
      };
    });
    const tPart = res.parts.find((p) => p.kind === 'torment'), lPart = res.parts.find((p) => p.kind === 'legend');
    check('결과: 고통 단계 띠 "고통 1단계 · 최고 T2 · 풀 보상 판 · 남은 풀 보상 23판"', res.shown && !res.hidden && !!tPart && tPart.text.includes('고통 1단계') && tPart.text.includes('최고 T2') && tPart.text.includes('남은 풀 보상 23판'), { parts: res.parts, receipt: res.receipt });
    check('결과: Lv.80 이후 전설 EXP 띠(EXP · 단계)', !!lPart && /전설 EXP \+/.test(lPart.text) && /전설 [\d,]+단계/.test(lPart.text), { legend: res.legend, lPart });
    check('결과 띠: 화면 안 · 결과 상자 화면 안 · 가로 스크롤 없음', res.boxIn && res.rect.w > 0 && res.rect.b <= (res.btnsTop || 9999) && res.scrollW <= 0, res);
    check('결과 후 에너지 변화 없음(고통 단계 에너지 0)', res.energyAfter === before.energy, { before: before.energy, after: res.energyAfter });
    await shot('17-result-torment');
    await act('#btn-result-lobby'); await page.waitForFunction(() => window.app.mode === 'lobby', undefined, { timeout: 60000 }).catch(() => {});
    await settle(1200); await ctx.closeModals();
    const after = await page.evaluate(() => ({ best: window.app.eco.tormentStatus().best, runsToday: window.app.eco.tormentStatus().runsToday }));
    check('정산 반영: 오늘 판 수 1 · 최고 기록 그대로(X-10 아님)', after.runsToday === 1 && after.best === 2, after);
  } },
  // ④ 캠페인 탭(모험)의 고통 줄
  { id: 'campaign-tab', run: async (ctx) => {
    const { page, act, settle, shot, check } = ctx;
    await page.evaluate(() => window.app.meta.openTab('stage')); await settle(800);
    const s = await page.evaluate(() => ({ has: !!document.querySelector('#stage-detail .difficulty-picker .dp'), option: document.querySelector('#stage-detail .dp-option[data-dp="torment"]')?.textContent, hell: document.querySelectorAll('#stage-detail .difficulty-card').length }));
    check('캠페인 탭: 기존 난이도 카드 4장 + 아래에 고통 줄', s.has && !!s.option && s.hell === 4, s);
    await shot('18-campaign-tab');
    // 모험 탭에서도 고통 단계를 고를 수 있다(실제 탭): 출격 에너지 0 · 소탕 비활성
    await act('#stage-detail .dp-option[data-dp="torment"]'); await settle(500);
    const t = await page.evaluate(() => ({ difficulty: window.app.eco.s.progress.difficulty, tier: document.querySelector('#stage-detail .dp-tier')?.textContent, go: document.querySelector('#st-go small')?.textContent?.trim(), sweepDisabled: !!document.querySelector('#st-sweep')?.disabled, chips: [...document.querySelectorAll('#stage-detail .dp-chip')].map((n) => n.textContent.trim()), loot: document.querySelector('#stage-detail .stage-loot-guide b')?.textContent }));
    check('모험 탭: 고통 선택 → 직전에 쓴 단계(없으면 최고 해금) 적용 · 출격 에너지 0 · 소탕 비활성 · 배율 표시', /^torment-\d+$/.test(t.difficulty) && t.tier === `고통 ${t.difficulty.split('-')[1]}단계` && /에너지 0/.test(t.go || '') && t.sweepDisabled && t.chips.includes('에너지 0'), t);
    await shot('18b-campaign-tab-torment');
    // 키보드: + 에 초점 → Enter → 화면이 다시 그려져도 초점이 같은 버튼에 남는다
    await page.evaluate(() => { window.app.eco.setDifficulty('torment-1', 1, 1); });
    await settle(300);
    await page.locator('#stage-detail .dp-up').focus(); await page.keyboard.press('Enter'); await settle(400);
    const kb = await page.evaluate(() => ({ tier: document.querySelector('#stage-detail .dp-tier')?.textContent, cls: document.activeElement?.className, inDetail: !!document.activeElement?.closest('#stage-detail') }));
    check('캠페인 탭 고통 +: Enter 후에도 초점이 같은 버튼(dp-up)에 남음', kb.tier === '고통 2단계' && /dp-up/.test(kb.cls || '') && kb.inDetail, kb);
    await page.evaluate(() => { window.app.eco.setDifficulty('story', 1, 1); });
    await page.evaluate(() => window.app.meta.openTab('home')); await settle(400);
  } },
  // ⑤ 전설 수련 판
  { id: 'legend', run: async (ctx) => {
    const { page, act, settle, shot, check, layout } = ctx;
    await page.evaluate(() => { const eco = window.app.eco; eco.s.legend = { version: 1, rank: 40, exp: 9000000, points: 0, nodes: { blade_edge: 5, wall_bulk: 3 } }; eco.s.gold = 9000000; eco.emit(); });
    await act('.bottomnav button[data-tab="heroes"]'); await settle(900);
    await act('#hs-tab-legend'); await settle(500);
    const pane = await page.evaluate(() => ({ selected: document.querySelector('#hs-tab-legend')?.getAttribute('aria-selected'), rank: document.querySelector('.hs-legend .hl-rank b')?.textContent, points: document.querySelector('.hs-legend .hl-points b')?.textContent, branches: document.querySelectorAll('.hs-legend .hl-branch').length, next: document.querySelector('.hs-legend .hl-next')?.textContent, open: !!document.querySelector('#h-legend-open') }));
    check('영웅 → 전설 탭: 40단계 · 남은 점수 32 · 갈래 4 요약 · 판 열기 버튼', pane.selected === 'true' && pane.rank === '40' && pane.points === '32' && pane.branches === 4 && pane.open && /키스톤/.test(pane.next || ''), pane);
    await shot('19-legend-tab');
    await act('#h-legend-open'); await settle(700);
    const st = () => page.evaluate(() => {
      const L = window.app.eco.legendState(), q = (s) => document.querySelector(s), t = (s) => q(s)?.textContent?.trim() || '';
      return {
        open: !!q('.lg-layer:not([hidden])'), rank: t('.lg-rank-num'), points: t('.lg-points-num'), state: { rank: L.rank, points: L.points, nodes: L.nodes }, gold: window.app.eco.s.gold, tab: q('.lg-tab.is-on')?.dataset.branch, nodeName: t('.lg-node-name'),
        rows: t('.lg-rows'), power: t('.lg-power'), ks: [...document.querySelectorAll('.lg-ks')].map((n) => ({ id: n.dataset.keystone, open: n.classList.contains('is-open') })), next: t('.lg-next-keystone'), cards: document.querySelectorAll('.lg-node').length,
        add: [...document.querySelectorAll('.lg-add')].map((b) => ({ k: b.dataset.key, d: b.disabled, t: b.textContent })), respecDisabled: !!q('[data-key="respec"]')?.disabled, respecText: t('[data-key="respec"]'), reason: t('.lg-reason'),
      };
    });
    let s = await st();
    check('전설 수련 탭 열림 · 40단계 · 남은 점수 32', s.open && s.rank === '40' && s.points === '32' && s.state.points === 32, s);
    check('4갈래 탭 · 노드 6개 · 키스톤 5개(40단계: 칼날 2개 열림)', s.tab === 'blade' && s.cards === 6 && s.ks.length === 5 && s.ks.filter((k) => k.open).length === 2, { tab: s.tab, cards: s.cards, ks: s.ks });
    const lay = await layout('.lg-layer', '');
    check('전설 수련: 버튼 화면 안 · 겹침 없음 · 44px 이상 · 가로 스크롤 없음', !lay.missing && lay.out.length === 0 && lay.small.length === 0 && lay.overlaps.length === 0 && lay.overflowX <= 0, lay);
    await shot('20-legend-open');
    // 노드 찍기: +1 → +5 → 최대
    await act('.lg-node[data-node="blade_hunter"]'); await settle(250);
    s = await st();
    check('노드 선택: 상세(이름 · 현재/다음 효과 · 전투력 미리보기)', s.nodeName === '사냥꾼의 직감' && s.rows.includes('보스 피해') && s.rows.includes('➜') && /전투력/.test(s.power), { name: s.nodeName, rows: s.rows, power: s.power });
    await act('.lg-add[data-key="add1"]'); await settle(300);
    s = await st();
    check('+1: 노드 1단계 · 점수 31', s.state.nodes.blade_hunter === 1 && s.state.points === 31 && s.points === '31', s.state);
    await act('.lg-add[data-key="add5"]'); await settle(300);
    s = await st();
    check('+5: 노드 6단계 · 점수 26', s.state.nodes.blade_hunter === 6 && s.state.points === 26, s.state);
    await shot('21-legend-after-add');
    await act('.lg-add[data-key="addmax"]'); await settle(300);
    s = await st();
    check('최대: 노드 32단계(점수 26 전부) · 점수 0 · 찍기 버튼 모두 비활성', s.state.nodes.blade_hunter === 32 && s.state.points === 0 && s.add.every((b) => b.d), { nodes: s.state.nodes, points: s.state.points, add: s.add });
    // 다른 갈래: 철벽 탭 → 키스톤 열림 수
    await act('.lg-tab[data-branch="wall"]'); await settle(300);
    s = await st();
    check('철벽 탭: 키스톤 5개 · 40단계에서 2개 열림', s.tab === 'wall' && s.ks.length === 5 && s.ks.filter((k) => k.open).length === 2, s.ks);
    await shot('22-legend-wall');
    // 재분배: 취소 → 변화 없음, 확인 → 점수 환급 · 골드 차감
    const goldBefore = s.gold;
    await act('[data-key="respec"]'); await settle(400);
    const modal = await page.evaluate(() => ({ shown: !!document.querySelector('#modal.show'), title: document.querySelector('#modal-box h2')?.textContent, body: document.querySelector('#modal-box p')?.textContent, ok: document.querySelector('#modal-box #m-ok')?.textContent }));
    check('재분배: 앱 내 확인 창(비용 표시)', modal.shown && modal.title === '점수 재분배' && /골드/.test(modal.body) && /재분배/.test(modal.ok), modal);
    await shot('23-legend-respec-confirm');
    await act('#modal.show #m-cancel'); await settle(300);
    s = await st();
    check('재분배 취소: 점수·골드 변화 없음', s.state.points === 0 && s.gold === goldBefore && s.state.nodes.blade_hunter === 32, { points: s.state.points, gold: s.gold });
    await act('[data-key="respec"]'); await settle(400);
    await act('#modal.show #m-ok'); await settle(500);
    s = await st();
    check('재분배 확인: 모든 점수 환급(40) · 노드 비움 · 골드 비용 차감', s.state.points === 40 && Object.keys(s.state.nodes).length === 0 && s.gold < goldBefore, { points: s.state.points, nodes: s.state.nodes, goldBefore, gold: s.gold });
    check('재분배 후 재분배 버튼 비활성(찍은 점수 없음)', s.respecDisabled, s.respecText);
    await shot('24-legend-after-respec');
    // 닫기 → 영웅 화면 복귀
    await page.keyboard.press('Escape'); await settle(400);
    const closed = await page.evaluate(() => ({ open: !!document.querySelector('.lg-layer:not([hidden])'), showcaseVisible: window.app.showcase?.root?.visible !== false }));
    check('ESC 닫기: 판 닫힘 · 로비 영웅 다시 보임', !closed.open && closed.showcaseVisible, closed);
    // Lv.80 전 잠금 사유와 미리보기
    await page.evaluate(() => { const eco = window.app.eco; for (const h of Object.values(eco.s.heroes)) h.level = Math.min(h.level, 30); eco.s.legend = { version: 1, rank: 0, exp: 0, points: 0, nodes: {} }; eco.emit(); });
    await settle(300);
    await act('#hs-tab-legend'); await settle(300);
    const paneLock = await page.evaluate(() => ({ lock: document.querySelector('.hs-legend .hl-lock')?.textContent, rank: document.querySelector('.hs-legend .hl-rank b')?.textContent }));
    check('Lv.80 전 전설 탭: 잠금 사유 문구', /영웅 Lv\.80 달성 시 열립니다/.test(paneLock.lock || '') && paneLock.rank === '0', paneLock);
    await shot('26-legend-tab-locked');
    await act('#h-legend-open'); await settle(600);
    s = await st();
    check('Lv.80 전: 잠금 사유 + 미리보기(노드 6개 · 찍기 비활성)', s.open && /영웅 Lv\.80 달성 시 열립니다/.test(s.reason) && s.cards === 6 && s.add.every((b) => b.d), { reason: s.reason, cards: s.cards, add: s.add });
    await shot('25-legend-locked');
    await page.keyboard.press('Escape'); await settle(300);
    await page.evaluate(ctx.SEED); await settle(300);
  } },
  // ⑥ 장비 접두(고대·태고)와 단계 표시
  { id: 'gear-prefix', run: async (ctx) => {
    const { page, act, settle, shot, check } = ctx;
    const info = await page.evaluate(() => {
      const eco = window.app.eco;
      const a = eco.addItem('L', 'weapon', undefined, 12), b = eco.addItem('E', 'armor', undefined, 30), c = eco.addItem('S', 'ring', undefined, 3);
      eco.save(); eco.emit();
      return { a: a.uid, b: b.uid, c: c.uid };
    });
    await act('.bottomnav button[data-tab="heroes"]'); await settle(900);
    await act('#hs-tab-gear'); await settle(500);
    // 낮은 화면에서는 가방이 접힌 아래쪽에 있다. 가장 가까운 스크롤 칸만 굴려 칸을 보이게 한다(그 뒤의 선택은 실제 탭).
    await page.evaluate((uid) => {
      const n = document.querySelector(`.bag-item[data-inv="${uid}"]`); let p = n?.parentElement;
      while (p && p !== document.body) {
        const st = getComputedStyle(p);
        if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && p.scrollHeight > p.clientHeight + 2) { const r = n.getBoundingClientRect(), pr = p.getBoundingClientRect(); p.scrollTop += (r.top - pr.top) - pr.height / 3; break; }
        p = p.parentElement;
      }
    }, info.a);
    await settle(300);
    const bag = await page.evaluate((uids) => uids.map((u) => {
      const n = document.querySelector(`.bag-item[data-inv="${u}"]`);
      return { uid: u, found: !!n, name: n?.querySelector('.inventory-name')?.textContent, tag: n?.querySelector('.tier-tag')?.textContent, cls: n?.className, label: n?.getAttribute('aria-label') };
    }), [info.a, info.b, info.c]);
    check('가방: 고대(T12) · 태고(T30) 접두와 단계 표기, T3 는 접두 없이 단계만', !!bag[0].name?.startsWith('고대 ') && bag[0].tag === 'T12' && !!bag[1].name?.startsWith('태고 ') && bag[1].tag === 'T30' && !/^(고대|태고) /.test(bag[2].name || '') && bag[2].tag === 'T3', bag);
    check('가방 칸 톤 클래스 구분(tier-godae · tier-taego · tier-tp)', /tier-godae/.test(bag[0].cls || '') && /tier-taego/.test(bag[1].cls || '') && /tier-tp/.test(bag[2].cls || ''), bag.map((x) => x.cls));
    await shot('30-bag-tier');
    // 비교 시트
    await act(`.bag-item[data-inv="${info.a}"]`); await settle(600);
    const sheet = await page.evaluate(() => ({ h2: document.querySelector('.item-sheet h2')?.textContent?.trim(), tag: document.querySelector('.item-sheet .is-tags .tier-tag')?.textContent, card: [...document.querySelectorAll('.item-sheet .is-card b')].map((n) => n.textContent), shown: !!document.querySelector('.item-sheet') }));
    check('비교 시트: 제목 "고대 …" · 단계 표기 · 카드 이름', sheet.shown && !!sheet.h2?.startsWith('고대 ') && /고통 T12/.test(sheet.tag || '') && sheet.card.some((n) => n.startsWith('고대 ')), sheet);
    await shot('31-compare-sheet-tier');
    await act('#i-close'); await settle(400); await ctx.closeModals();
    // 드랍 토스트: 보상 토스트(rewardToast)와 전투 중 득템 팝업(lootPopup) 같은 표기
    const toast = await page.evaluate((uids) => {
      const eco = window.app.eco, ui = window.app.ui, inst = eco.s.inventory.find((x) => x.uid === uids[1]);
      ui.rewardToast([{ k: 'item', item: inst }]);
      return [...document.querySelectorAll('#toast-layer .toast')].map((n) => n.textContent.trim());
    }, [info.a, info.b, info.c]);
    check('드랍 토스트: "태고 …" 접두와 T30', toast.some((t) => t.includes('태고 ')) && toast.some((t) => t.includes('T30')), toast);
    await shot('32-toast-tier');
  } },
];
