import { growthOptions, growthSummary } from '../game/growth-options.js';
import { uiArt } from './illustrated.js';
import { SLOT_NAME } from '../data/items.js';

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
  container.append(element('h2', '다음 출격 준비', 'growth-options-title'));
  const options = growthOptions(app.eco.s);
  container.append(element('p', options.length
    ? '현재 재화로 각각 가능 · 화면을 열어 선택, 자동 소비 없음'
    : '지금 바로 가능한 강화가 없습니다. 장비 구성을 살펴보거나 완료한 지역에서 재료를 모아 보세요.'));
  const actions = element('div', '', 'growth-actions');
  for (const option of options) {
    const button = element('button', '', 'growth-action'); button.type = 'button'; button.dataset.growth = option.kind;
    const equip = option.mode === 'equip';
    const label = option.kind === 'equipment' ? equip ? '첫 장비 비교' : '장비 강화' : option.kind === 'skill' ? '스킬 강화' : '숙련 배우기';
    let detail;
    if (equip) detail = option.name + ' · 비어 있는 ' + SLOT_NAME[option.slot] + ' 슬롯';
    else if (option.kind === 'equipment') detail = option.name + ' +' + option.from + ' → +' + option.to + ' · 성공 100%';
    else if (option.kind === 'skill') detail = option.name + ' Lv.' + option.from + ' → Lv.' + option.to;
    else detail = option.name + ' · ' + option.description;
    const cost = equip ? '비교 후 무료 장착' : option.kind === 'mastery' ? '명성 ' + number(option.renown)
      : '골드 ' + number(option.gold) + (option.stones ? ' · 강화석 ' + number(option.stones) : '');
    const icon = element('img', ''); icon.src = uiArt(option.kind === 'equipment' ? 'loadout' : option.kind === 'skill' ? 'hero-xp' : 'renown'); icon.alt = '';
    const copy = element('span', '', 'growth-action-copy');
    copy.append(element('strong', label + ' ›'), element('span', detail), element('small', cost));
    button.append(icon, copy);
    button.onclick = () => {
      if (!canPrepareGrowth(app, result)) return;
      // Currency, equipment or selected hero may have changed since the result rendered.
      const current = growthOptions(app.eco.s).find(o => o.kind === option.kind && o.heroId === option.heroId
        && o.mode === option.mode && o.uid === option.uid && o.index === option.index && o.id === option.id && o.from === option.from);
      if (!current) {
        renderGrowthPreparation(container, app, result);
        app.ui.toast('보유 재화와 성장 항목을 다시 확인했습니다.');
        (container.querySelector('button') || document.getElementById('btn-result-lobby'))?.focus();
        return;
      }
      app.toLobby();
      if (app.mode !== 'lobby') return;
      if (current.kind === 'mastery') {
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
