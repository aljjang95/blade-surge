import { growthOptions, growthSummary } from '../game/growth-options.js';
import { applyBestEquip } from '../game/gear-advice.js';
import { uiArt } from './illustrated.js';
import { SLOT_NAME } from '../data/items.js';
import { nextGuide, levelStatusLabel } from '../data/region-guide.js';

const number = n => n.toLocaleString('ko-KR');
const element = (tag, text, className) => {
  const el = document.createElement(tag); el.textContent = text;
  if (className) el.className = className;
  return el;
};
const summaries = new WeakMap();

/** Only the current, saved campaign result may lead out to a growth screen. */
export function canPrepareGrowth(app, result) {
  return !!result && app.battle.result === result && app.ui.resultData === result
    && !app.battle.active && !app.stageStarting && !app.battle.stage?.expedition
    && app.ui.el.result.classList.contains('show') && !result.saveError
    && !result.reward?.saveError && result.reward?.ok !== false
    && app.eco.storageStatus !== 'unavailable' && !app.battle.rpgDirty
    && !app.expeditionUI?.result?.saveError
    && (!result.win || (!!result.reward && (!app.expedition || result.expeditionRecorded === true)));
}

function renderSummary(container, app, result) {
  if (!summaries.has(result)) {
    const battle = app.battle, heroId = battle.heroId;
    summaries.set(result, growthSummary({ heroId, before: result.growthStart || battle.growthStart,
      after: app.eco.s.heroes?.[heroId], combatXp: result.combatXp ?? battle.combatXp,
      clearXp: result.win ? result.reward?.exp : null }));
  }
  const summary = summaries.get(result);
  if (!summary) return;
  const box = element('div', '', 'growth-summary');
  const heading = element('div', '', 'growth-summary-heading');
  const icon = element('img', ''); icon.src = uiArt('hero-xp'); icon.alt = '';
  heading.append(icon, element('h2', '이번 사냥의 성장'));
  const level = summary.beforeLevel === null || !summary.levels ? `Lv.${summary.level}`
    : `Lv.${summary.beforeLevel} → ${summary.level} (+${summary.levels})`;
  heading.append(element('strong', level, 'growth-level'));
  box.append(heading, element('p', summary.name, 'growth-hero'));
  const earned = [];
  if (summary.combatXp !== null) earned.push(`처치 XP +${number(summary.combatXp)}`);
  if (summary.clearXp !== null) earned.push(`클리어 XP +${number(summary.clearXp)}`);
  if (earned.length) box.append(element('p', earned.join(' · '), 'growth-earned'));
  if (summary.need !== null) {
    const bar = element('progress', ''); bar.max = summary.need; bar.value = Math.min(summary.exp, summary.need);
    bar.setAttribute('aria-label', `영웅 Lv.${summary.level} 경험치 ${number(summary.exp)} / ${number(summary.need)}`);
    box.append(bar, element('p', `다음 레벨까지 ${number(Math.max(0, summary.need - summary.exp))} XP`, 'growth-xp-left'));
  } else box.append(element('p', '영웅 최고 레벨 달성', 'growth-xp-left'));
  if (summary.unlocked.length) box.append(element('p', '이번 사냥 해금 · ' + summary.unlocked.map(s => s.name).join(' · '), 'growth-unlocked'));
  if (summary.next) {
    box.append(element('p', `다음 해금 · Lv.${summary.next.level} ${summary.next.name} · ${number(summary.next.remaining)} XP 남음`, 'growth-next'));
  } else box.append(element('p', '모든 레벨 스킬 해금 완료', 'growth-next'));
  container.append(box);
}

/** 승리 결과: 다음 출격 스테이지·새 지역·권장 Lv 대비 내 레벨·대표 보상. 안내만 하며 btn-result-next 동작은 바꾸지 않는다. */
export function renderNextGuide(container, app, result) {
  if (!result?.win || app.battle.stage?.expedition) return;
  // 이번 사냥 성장 요약과 같은 레벨 기준(재화 변경으로 다시 그려도 사냥 시점 기록을 유지한다).
  const eco = app.eco, level = summaries.get(result)?.level || eco.hero(app.battle.heroId)?.level || 1;
  const guide = nextGuide(eco.s.progress, level);
  const box = element('div', '', 'next-guide'); box.dataset.status = guide.status; box.dataset.newRegion = String(guide.newRegion);
  box.append(element('h2', '다음 출격', 'next-guide-title'));
  if (guide.allCleared) { box.append(element('p', '모든 지역을 정화했습니다. 숙련·악몽 난이도로 다시 도전해 보세요.', 'next-guide-done')); container.append(box); return; }
  if (guide.newRegion) box.append(element('strong', '새 지역 개방: ' + guide.chapterName, 'next-guide-region'));
  box.append(element('p', guide.stage.code + ' · ' + guide.stage.title, 'next-guide-stage'));
  const state = levelStatusLabel(level, guide.recommendedLevel);
  const row = element('p', '', 'next-guide-level'); row.dataset.tone = state.tone;
  row.append(element('span', '권장 Lv.' + guide.recommendedLevel + ' · 내 Lv.' + level + ' · ', 'next-guide-lv'), element('b', state.text), element('span', ' (' + state.detail + ')', 'next-guide-detail'));
  box.append(row);
  const drops = guide.representativeDrops;
  box.append(element('p', '대표 보상 · ' + drops.materials.map(m => m.name + ' ×' + m.n).join(' · ') + ' · 보스 에픽 이상 ' + Math.round(drops.epicChance * 100) + '%', 'next-guide-drops'));
  container.append(box);
}

/** Inline campaign result actions; opening a destination never upgrades or purchases. */
export function renderGrowthPreparation(container, app, result) {
  container.replaceChildren();
  container.hidden = false;
  if (!canPrepareGrowth(app, result)) {
    container.append(element('p', '성장 기록과 보상 정산 저장이 완료되면 성장 항목을 확인할 수 있습니다.', 'growth-pending'));
    const retry = element('button', '정산 저장 다시 시도', 'growth-action'); retry.type = 'button'; retry.dataset.growth = 'save';
    retry.onclick = () => app.ui.retryResultSave(result);
    container.append(retry);
    return;
  }
  renderSummary(container, app, result);
  renderNextGuide(container, app, result);
  container.append(element('h2', '다음 출격 준비', 'growth-options-title'));
  const options = growthOptions(app.eco.s, app.eco);
  container.append(element('p', options.length
    ? '현재 재화로 각각 가능 · 화면을 열어 선택, 자동 소비 없음'
    : '지금 바로 가능한 강화가 없습니다. 장비 구성을 살펴보거나 완료한 지역에서 재료를 모아 보세요.'));
  const actions = element('div', '', 'growth-actions');
  for (const option of options) {
    const button = element('button', '', 'growth-action'); button.type = 'button'; button.dataset.growth = option.kind;
    const equip = option.mode === 'equip', risk = option.mode === 'risk', gear = option.kind === 'gear';
    const label = gear ? (option.mode === 'equipBest' ? '더 좋은 장비 장착' : '가방 정리')
      : option.kind === 'equipment' ? equip ? '첫 장비 비교' : risk ? '장비 강화(확률)' : '장비 강화'
      : option.kind === 'skill' ? (option.from === 0 ? '스킬 습득' : '스킬 강화') : option.kind === 'training' ? '훈련으로 레벨업'
      : option.kind === 'transcend' ? '영웅 초월' : option.kind === 'summon' ? '소환 10연' : '숙련 배우기';
    let detail;
    if (gear) detail = option.mode === 'equipBest' ? '교체 ' + option.count + '곳 · 전투력 +' + number(option.delta) : '착용 중보다 약한 노말·스페셜 ' + number(option.count) + '개';
    else if (equip) detail = option.name + ' · 비어 있는 ' + SLOT_NAME[option.slot] + ' 슬롯';
    else if (risk) detail = option.name + ' +' + option.from + ' → +' + option.to + ' · 성공 ' + Math.round(option.chance * 100) + '%'
      + (option.destroy > 0 ? ' · 실패 시 파괴 ' + Math.round(option.destroy * 100) + '%' + (option.protect ? '(보호 ' + option.protect + ')' : '') : '') + (option.down > 0 ? ' · 하락 -' + option.down : '')
      + (option.sureGold ? ' · 골드 +' + number(option.sureGold) + '로 확정 가능' : '');
    else if (option.kind === 'equipment') detail = option.name + ' +' + option.from + ' → +' + option.to + ' · 성공 100%';
    else if (option.kind === 'skill') detail = option.name + ' Lv.' + option.from + ' → Lv.' + option.to;
    else if (option.kind === 'training') detail = '영웅 Lv.' + option.from + ' → Lv.' + option.to;
    else if (option.kind === 'transcend') detail = option.from + ' → ' + option.to + ' 등급';
    else if (option.kind === 'summon') detail = '남은 재화를 영웅·장비 소환에 쓸 수 있습니다';
    else detail = option.name + ' · ' + option.description;
    const cost = gear ? (option.mode === 'equipBest' ? '무료 · 한 번 눌러 바로 장착' : '분해 시 골드 +' + number(option.gold) + ' · 강화석 +' + number(option.stones) + ' · 확인 후 진행')
      : equip ? '비교 후 무료 장착' : option.kind === 'mastery' ? '명성 ' + number(option.renown) : option.kind === 'skill' ? '스킬 포인트 ' + number(option.sp)
      : option.kind === 'training' ? '골드 ' + number(option.gold) : option.kind === 'transcend' ? '조각·초월석·골드 사용'
      : option.kind === 'summon' ? (option.currency === 'tickets' ? '소환권 ' + option.tickets + '장' : '보석 ' + number(option.cost))
      : '골드 ' + number(option.gold) + (option.stones ? ' · 강화석 ' + number(option.stones) : '');
    const icon = element('img', ''); icon.src = uiArt(option.kind === 'equipment' || gear ? 'loadout' : option.kind === 'skill' || option.kind === 'training' || option.kind === 'transcend' ? 'hero-xp' : option.kind === 'summon' ? 'gems' : 'renown'); icon.alt = '';
    const copy = element('span', '', 'growth-action-copy');
    copy.append(element('strong', label + ' ›'), element('span', detail), element('small', cost));
    button.append(icon, copy);
    button.onclick = () => {
      if (!canPrepareGrowth(app, result)) return;
      // Currency, equipment or selected hero may have changed since the result rendered.
      const current = growthOptions(app.eco.s, app.eco).find(o => o.kind === option.kind && o.heroId === option.heroId
        && o.mode === option.mode && o.uid === option.uid && o.index === option.index && o.id === option.id && o.from === option.from);
      if (!current) {
        renderGrowthPreparation(container, app, result);
        app.ui.toast('보유 재화와 성장 항목을 다시 확인했습니다.');
        (container.querySelector('button') || document.getElementById('btn-result-lobby'))?.focus();
        return;
      }
      // 장비 교체는 되돌릴 수 있고 무료라서 결과 화면을 떠나지 않고 한 번에 장착한다(다시 그려 남은 항목을 갱신).
      if (current.kind === 'gear' && current.mode === 'equipBest') {
        const done = applyBestEquip(app.eco, current.heroId);
        app.ui.toast(done.swaps.length ? '더 좋은 장비 ' + done.swaps.length + '곳 장착 · 전투력 ' + number(done.powerBefore) + ' → ' + number(done.powerAfter) : '바꿀 장비가 없습니다', done.swaps.length ? 'gold' : undefined);
        renderGrowthPreparation(container, app, result);
        (container.querySelector('button') || document.getElementById('btn-result-lobby'))?.focus();
        return;
      }
      app.toLobby();
      if (app.mode !== 'lobby') return;
      if (current.kind === 'gear' || current.kind === 'training' || current.kind === 'transcend') {
        app.meta.heroSel = current.heroId; app.meta.heroPane = current.kind === 'gear' ? 'gear' : 'growth';   // 훈련·초월 버튼은 성장 칸에만 있다
        if (current.mode === 'cleanup') app.meta.bagClean = { open: true, step: 0, includeE: true };
        app.meta.openTab('heroes');
        if (current.kind === 'transcend') app.meta.openTranscend?.(current.heroId);   // 초월은 성장 칸 아래 별도 창
      } else if (current.kind === 'summon') {
        app.meta.openTab('gacha', current.banner || 'hero');   // 초심자 배너 견적(1,350)을 낸 제안은 초심자 배너로
      } else if (current.kind === 'mastery') {
        app.meta.openTab('home'); app.battle.chronicle.open('mastery');
        app.battle.chronicle.dialog.querySelector('button')?.focus();
      } else {
        app.meta.heroSel = current.heroId; app.meta.openTab('heroes');
        if (current.mode === 'equip') app.meta.showItem(current.uid, current.heroId);
        else if (current.kind === 'equipment') app.meta.showEnhance(current.uid, current.heroId);
        else app.meta.showSkill(current.heroId, current.index);
        app.ui.el.modalBox.querySelector('button')?.focus();
      }
    };
    actions.append(button);
  }
  container.append(actions);
}
