import { growthOptions } from '../game/growth-options.js';

const number = n => n.toLocaleString('ko-KR');
const element = (tag, text, className) => {
  const el = document.createElement(tag); el.textContent = text;
  if (className) el.className = className;
  return el;
};

/** Inline campaign result actions; opening a destination never upgrades or purchases. */
export function renderGrowthPreparation(container, app, result) {
  container.replaceChildren();
  container.append(element('h2', '다음 도전 준비'));
  const options = growthOptions(app.eco.s);
  container.append(element('p', options.length
    ? '보유 재화로 가능한 성장입니다. 각 화면에서 비용을 확인하고 선택하세요.'
    : '지금 바로 가능한 강화가 없습니다. 장비 구성을 살펴보거나 완료한 지역에서 재료를 모아 보세요.'));
  for (const option of options) {
    const button = element('button', '', 'growth-action'); button.type = 'button'; button.dataset.growth = option.kind;
    const label = option.kind === 'equipment' ? '장비 강화' : option.kind === 'skill' ? '스킬 강화' : '숙련 배우기';
    let detail;
    if (option.kind === 'equipment') detail = option.name + ' +' + option.from + ' → +' + option.to + ' · 성공 100%';
    else if (option.kind === 'skill') detail = option.name + ' Lv.' + option.from + ' → Lv.' + option.to;
    else detail = option.name + ' · ' + option.description;
    const cost = option.kind === 'mastery' ? '명성 ' + number(option.renown)
      : '골드 ' + number(option.gold) + (option.stones ? ' · 강화석 ' + number(option.stones) : '');
    button.append(element('strong', label + ' ›'), element('span', detail), element('small', cost));
    button.onclick = () => {
      if (app.battle.result !== result || result.win || app.battle.active || app.stageStarting
        || !app.ui.el.result.classList.contains('show')) return;
      // Currency, equipment or selected hero may have changed since the result rendered.
      const current = growthOptions(app.eco.s).find(o => o.kind === option.kind && o.heroId === option.heroId
        && o.uid === option.uid && o.index === option.index && o.id === option.id && o.from === option.from);
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
        if (current.kind === 'equipment') app.meta.showEnhance(current.uid, current.heroId);
        else app.meta.showSkill(current.heroId, current.index);
        app.ui.el.modalBox.querySelector('button')?.focus();
      }
    };
    container.append(button);
  }
}
