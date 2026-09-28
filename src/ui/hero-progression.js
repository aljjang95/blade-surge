import { levelExp } from '../data/heroes.js';
import { heroTrainingQuote } from '../game/hero-training.js';
import { storyText } from './campaign.js';

export function heroProgressionHtml(hero, def, gold) {
  const quote = heroTrainingQuote(hero, gold), capped = hero.level >= 80;
  if (quote.reason === 'invalid') return '<p id="hero-training-hint">성장 정보를 불러오지 못했습니다. 영웅을 다시 선택해 주세요.</p>';
  const need = levelExp(hero.level), next = def.skills.find(skill => skill.unlock > hero.level);
  const hint = capped ? '최고 레벨에 도달했습니다. 장비와 스킬을 다듬어 다음 도전에 대비하세요.'
    : quote.reason === 'hunt' ? `사냥 EXP ${Math.max(0, quote.requiredExp - hero.exp)}를 더 모으면 훈련할 수 있습니다.`
    : `골드 ${quote.cost.toLocaleString('ko-KR')}로 남은 EXP ${quote.remainingExp}를 채워 Lv.${quote.nextLevel}에 도달합니다.`;
  return `<section class="hero-hunt-progress" aria-label="영웅 사냥 성장">
    <div class="hero-hunt-heading"><span>사냥으로 쌓는 성장</span><strong>Lv.${hero.level}${capped ? ' · MAX' : ` → ${hero.level + 1}`}</strong></div>
    <progress max="${need}" value="${capped ? need : hero.exp}" aria-label="다음 영웅 레벨 경험치"></progress>
    <div class="hero-hunt-meter"><b>${capped ? '성장 완료' : `EXP ${hero.exp} / ${need}`}</b><span>처치 · 구역 클리어로 획득</span></div>
    ${next ? `<div class="hero-unlock-goal"><img src="${storyText(next.icon)}" alt=""><div><small>다음 각성 · Lv.${next.unlock}</small><strong>${storyText(next.name)}</strong><span>${next.unlock - hero.level}레벨 뒤 스킬북에서 Q / E에 장착</span></div></div>` : ''}
    <p id="hero-training-hint">${hint} ${capped ? '' : '훈련은 현재 레벨의 경험치를 절반 이상 쌓은 뒤 이용합니다.'}</p>
  </section>`;
}

export function trainingButtonLabel(quote) {
  if (quote.reason === 'invalid') return '성장 정보 확인 필요';
  if (quote.reason === 'cap') return '최고 레벨';
  if (quote.reason === 'hunt') return '사냥 후 훈련';
  return `성장 훈련 · Lv.${quote.nextLevel}`;
}
