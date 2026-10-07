// 평가 입력은 브라우저 메모리에서만 사용하며 코드/서버에 전송하지 않는다.
const text = value => String(value ?? '').trim();
const severityLabels = { blocking: '진행 불가', major: '주요 불편', minor: '가독성/조작성', observation: '관찰 · 판단 미확인' };
const environmentLabels = { browser: '데스크톱 브라우저 · mouse/keyboard', emulation: '브라우저 viewport/touch 에뮬 · 실기기 아님', physical: '물리 기기 · 기록한 실제 환경', source: '소스 검토 · 실제 입력 미확인' };

export function promptReadiness(draft) {
  const missing = [];
  for (const [key, label] of [['observation', '현재 관측'], ['evidence', '근거/파일'], ['nextChange', '다음 한 가지 수정']]) {
    if (!text(draft[key])) missing.push(label);
  }
  if (!severityLabels[draft.severity]) missing.push('문제 분류');
  if (!environmentLabels[draft.environment]) missing.push('확인 환경');
  return missing;
}

export function createUxPrompt(template, constraints, draft) {
  const missing = promptReadiness(draft);
  if (missing.length) throw new Error(`작성 필요: ${missing.join(', ')}`);
  return [
    '[Blade Surge · 근거 기반 UX 개선 지시]',
    `화면: ${template.name} / 템플릿 상태: ${template.status}`,
    '상태: 검토용 작업 지시 · 구현/검증/PASS 판정 아님',
    '',
    `목표: ${template.objective}`,
    `사용자 시나리오: ${text(draft.scenario) || template.scenario}`,
    '소유 범위:', ...template.owners.map(value => `- ${value}`),
    '',
    `현재 관측: ${text(draft.observation)}`,
    `근거 경로/기록: ${text(draft.evidence)}`,
    `확인 환경: ${environmentLabels[draft.environment]} · ${text(draft.environmentDetails) || '상세 환경 미기록'}`,
    `문제 분류(작성자 판단): ${severityLabels[draft.severity]}`,
    `검토자 의견: ${text(draft.reviewer) || '미검토'}`,
    '',
    `다음 한 가지 수정: ${text(draft.nextChange)}`,
    '수락 기준:', ...template.acceptance.map(value => `- ${value}`),
    ...(text(draft.extraAcceptance) ? [`추가 수락 기준: ${text(draft.extraAcceptance)}`] : []),
    '',
    '보존할 계약:', ...constraints.map(value => `- ${value}`),
    '',
    '작업 순서: 위 근거를 먼저 확인하고 소유 범위 안에서 한 가지 문제를 수정한다. 실제 입력/화면을 다시 관측해 이전 근거와 비교한다. 실패 원본과 미확인을 보존하고, 새로운 문제를 다음 지시에 기록한다. 추가 확인이 필요한 기준을 자동 PASS로 채우지 않는다.',
  ].join('\n');
}
