import { CAMPAIGN, journalEntries } from '../data/campaign-story.js';

// 저장 데이터에 사용자 입력이 포함되더라도 이야기 문구를 HTML로 실행하지 않는다.
export const storyText = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const encounterLabel = (stage) => stage.encounter?.label || ({ captain: '구역 대장', warden: '약한 보스', midboss: '중간 보스', finalboss: '최종 보스' })[stage.encounter?.rank] || '구역 대장';

export function endingHtml() {
  const ending = CAMPAIGN.ending;
  return `<h3>${storyText(typeof ending === 'string' ? '되찾은 새벽' : ending.title)}</h3><p>${storyText(typeof ending === 'string' ? ending : ending.body)}</p>`;
}

export function journalHtml(progress) {
  const entries = journalEntries(progress);
  return `<div class="campaign-journal"><div class="journal-toolbar"><span class="campaign-eyebrow">기억의 기록 · ${entries.length}편</span><button type="button" class="btn btn-ghost btn-sm" id="journal-close">닫기</button></div><h2>${storyText(CAMPAIGN.title)}</h2><p>${storyText(CAMPAIGN.logline)}</p>
    ${entries.length ? entries.map((entry) => `<article><span class="campaign-eyebrow">${storyText(entry.code)}</span><h3>${storyText(entry.title)}</h3><p>${storyText(entry.revelation)}</p><p>${storyText(entry.aftermath)}</p>${entry.oath ? `<blockquote>${storyText(entry.oath)}</blockquote>` : ''}</article>`).join('') : '<article><h3>아직 쓰이지 않은 첫 장</h3><p>스테이지를 클리어하면 되찾은 기억이 이곳에 남습니다.</p></article>'}
    ${progress.stars?.['5-10'] ? `<article class="campaign-ending">${endingHtml()}</article>` : ''}
    </div>`;
}

export function resultStoryHtml(stage) {
  return `<span class="campaign-eyebrow">${storyText(stage.code)} · ${stage.finale ? '다섯 서약 완성' : '되찾은 기억'}</span><h3>${storyText(stage.title)}</h3><p>${storyText(stage.story?.aftermath)}</p>${stage.st === 10 && stage.chapter.oath ? `<blockquote>${storyText(stage.chapter.oath)}</blockquote>` : ''}${stage.finale ? `<div class="campaign-ending">${endingHtml()}</div>` : ''}`;
}
