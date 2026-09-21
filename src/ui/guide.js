const guidePanel = (id, title, body) => `<section class="guide-panel" data-guide-panel="${id}" role="tabpanel" aria-labelledby="guide-tab-${id}"${id === 'start' ? '' : ' hidden'}><h3>${title}</h3>${body}</section>`;

const guidePoint = (title, text, icon = '') => `<li>${icon ? `<b class="guide-point-icon" aria-hidden="true">${icon}</b>` : ''}<div><strong>${title}</strong><p>${text}</p></div></li>`;

const guideCheck = (label, text, done) => `<li class="${done ? 'done' : ''}"><span aria-hidden="true">${done ? '✓' : '○'}</span><div><strong>${label}</strong><small>${text}</small></div></li>`;

/** 첫 출격 전에 필요한 조작·전투·성장 정보를 한 화면에 보여 주는 안내서. */
export function guideHtml({ touch = false, first = false, heroName, heroLevel, nextName, nextEnergy, nextPower, power, completed = false, inventoryCount = 0, setCount = 0, nextAwakening = 'Lv.10' }) {
  const controls = touch
    ? '왼쪽 조이스틱으로 이동하고, 오른쪽 공격 버튼을 누르면 기본 콤보가 이어집니다. 회피와 스킬 버튼은 화면 오른쪽에 있습니다.'
    : 'WASD로 이동하고 J 또는 Space를 누르면 기본 콤보가 이어집니다. K 또는 Shift는 회피, 1~3·R·Q·E는 스킬입니다.';
  const destination = completed ? '심층 원정' : nextName;
  const destinationCopy = completed ? '캠페인을 모두 정복했습니다. 심층 원정에서 새로운 동선과 제작 재료를 모으세요.' : `다음은 ${nextName}입니다. 출격에는 에너지 ${nextEnergy}가 필요합니다.`;
  return `<div class="field-guide">
    <header class="guide-heading"><div><span class="guide-kicker">BLADE SURGE · ${first ? '첫 모험' : 'ADVENTURER GUIDE'}</span><h2>${first ? '첫 모험 안내' : '모험 안내서'}</h2></div><span class="guide-hero-badge">${heroName} · Lv.${heroLevel}</span></header>
    <nav class="guide-tabs" role="tablist" aria-label="모험 안내 항목">
      <button type="button" id="guide-tab-start" class="guide-tab on" data-guide-tab="start" role="tab" aria-selected="true" aria-controls="guide-panel-start">시작</button>
      <button type="button" id="guide-tab-combat" class="guide-tab" data-guide-tab="combat" role="tab" aria-selected="false" aria-controls="guide-panel-combat">전투</button>
      <button type="button" id="guide-tab-growth" class="guide-tab" data-guide-tab="growth" role="tab" aria-selected="false" aria-controls="guide-panel-growth">성장</button>
    </nav>
    <div class="guide-body">
      ${guidePanel('start', '한 판의 흐름', `<ol class="guide-steps">${guidePoint('1. 출격', '모험에서 스테이지를 고르고 출격합니다. 에너지를 사용하지만, 전투 중에는 별도 소모가 없습니다.', 'I')}${guidePoint('2. 방을 정화', '미니맵을 보며 미클리어 방을 지나가세요. 봉인이 풀리면 보스방이 열리고, 보스를 쓰러뜨리면 층을 클리어합니다.', 'II')}${guidePoint('3. 전리품을 사용', '클리어 보상은 영웅 EXP·골드·장비입니다. 영웅 메뉴에서 장비를 비교해 장착하고 다음 층을 준비하세요.', 'III')}</ol><div class="guide-next"><div><span>다음 목표</span><strong>${destination}</strong><p>${destinationCopy}</p></div><span class="guide-power">내 전투력 ${power.toLocaleString('ko-KR')}<br><small>${completed ? '심층 원정 해금' : `권장 ${nextPower.toLocaleString('ko-KR')}`}</small></span></div>`)}
      ${guidePanel('combat', '손으로 익히는 전투', `<ul class="guide-points">${guidePoint('조작', controls, '⌘')}${guidePoint('MP와 스킬', 'MP는 전투 중 자동으로 회복됩니다. 일반 스킬은 MP와 쿨타임을 사용하므로 기본 공격과 섞어 쓰세요. 궁극기는 공격과 회피로 게이지를 채운 뒤 사용합니다.', '✦')}${guidePoint('경고를 보고 회피', '적의 붉은 공격 예고가 닿기 직전에 회피하면 퍼펙트 회피가 됩니다. 시간이 느려지고 반격 창이 열리므로 보스전의 핵심입니다.', '◈')}${guidePoint('AUTO는 보조 장치', 'AUTO는 방을 찾아가고 공격·회피·준비된 스킬을 사용합니다. 보스의 큰 예고는 직접 회피하면 더 안정적으로 클리어할 수 있습니다.', '▶')}</ul>`)}
      ${guidePanel('growth', '강해지는 순서', `<ul class="guide-checklist" aria-label="현재 성장 상태">${guideCheck('영웅 레벨', `현재 Lv.${heroLevel} · 다음 각성 스킬은 ${nextAwakening}에 열립니다.`, heroLevel >= 10)}${guideCheck('장비', `가방 ${inventoryCount}개 · 장비 비교에서 전투력과 세트 효과를 함께 확인하세요.`, inventoryCount > 0)}${guideCheck('세트 효과', `${setCount ? `현재 ${setCount}개 효과가 활성화되어 있습니다.` : '같은 세트 장비 2개·4개를 모으면 효과가 활성화됩니다.'}`, setCount > 0)}${guideCheck('스킬북', '영웅 메뉴에서 스킬 아이콘을 눌러 설명과 강화 비용을 확인하고, 각성 스킬은 해금 후 Q/E에 장착하세요.', false)}</ul><p class="guide-footnote">강화는 골드가 필요하며, 해금되지 않은 각성 스킬은 강화하거나 장착할 수 없습니다.</p>`)}
    </div>
    <div class="modal-btns guide-actions"><button type="button" class="btn btn-ghost" id="m-guide-close">닫기</button><button type="button" class="btn btn-gold" id="m-guide-next">${completed ? '심층 원정 보기' : '다음 모험 보기'}</button></div>
  </div>`;
}
