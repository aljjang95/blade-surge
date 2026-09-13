// Phase order is authored, not a random permutation of the same six attacks.
export const BOSS_ENCOUNTERS = {
  garden_finalboss: {
    phases: [['bell_toll','slam','bell_clap','spin'], ['bell_clap','summon','bell_toll','slam'], ['bell_toll','bell_clap','spin']],
    tactic: '세 번 울리는 공명 띠 사이로 이동하세요. 양옆 종이 울린 뒤에는 중앙에서 벗어나고, 마지막 울림 뒤 반격하세요.',
    phaseHints: ['공명 고리의 순서를 읽으세요.', '양옆 종 뒤에 중앙 종이 울립니다.', '공명이 바깥에서 안으로 돌아옵니다.'],
  },
  forge_finalboss: {
    phases: [['kiln_vents','slam','kiln_hammer','fan'], ['kiln_hammer','kiln_vents','summon','slam'], ['kiln_vents','kiln_hammer','dash']],
    tactic: '용광로는 중앙 통로부터 과열됩니다. 망치가 떨어질 자리를 피한 뒤 충격 고리 안으로 돌아와 반격하세요.',
    phaseHints: ['중앙 과열선 옆으로 이동하세요.', '망치가 닿은 자리 뒤에 충격파가 옵니다.', '과열 통로의 방향이 바뀝니다.'],
  },
  frost_finalboss: {
    phases: [['archive_retrace','fan','archive_hourglass','slam'], ['archive_hourglass','archive_retrace','summon','fan'], ['archive_retrace','archive_hourglass','soulrain']],
    tactic: '서리왕은 방금 지나온 세 자리를 역순으로 기록합니다. 그 길로 되돌아가지 말고, 모래시계의 안쪽과 바깥쪽을 번갈아 피하세요.',
    phaseHints: ['지나온 길이 역순으로 터집니다.', '바깥 고리 다음은 안쪽 원입니다.', '네 번째 기록과 마지막 공명까지 확인하세요.'],
  },
  tide_finalboss: {
    phases: [['tide_sweep','fan','tide_undertow','slam'], ['tide_undertow','tide_sweep','summon','fan'], ['tide_sweep','tide_undertow','dash']],
    tactic: '연속 물결이 지난 통로로 이동하세요. 역류는 바깥부터 안으로 조여 오며, 마지막 중심 폭발 뒤 반격할 수 있습니다.',
    phaseHints: ['먼저 지나간 물결 뒤로 이동하세요.', '역류가 중심으로 조여 옵니다.', '역류의 마지막 중심 폭발을 피하세요.'],
  },
  crown_finalboss: {
    phases: [['crown_orbit','spin','crown_verdict','slam'], ['crown_verdict','crown_orbit','fan','spin'], ['crown_orbit','crown_verdict','dash']],
    tactic: '회전 심판의 중앙 빈 원을 이용하세요. 낙인 두 개 뒤에는 가운데 절단선이 내려옵니다. 광폭화 때는 마지막 중앙 심판도 피하세요.',
    phaseHints: ['회전하는 칼날의 중앙이 안전합니다.', '양옆 낙인 뒤 가운데 절단선이 내려옵니다.', '마지막에는 중앙도 위험해집니다.'],
  },
  homecoming_finalboss: {
    phases: [['oath_tethers','slam','oath_shelter','spin'], ['oath_shelter','oath_tethers','summon','slam'], ['oath_tethers','oath_shelter','spin']],
    tactic: '잔향과 자신을 잇는 선 옆으로 피하세요. 귀환의 빈 원이 옮겨 가면 다음 쉼터로 이동하고, 마지막 공명 뒤 반격하세요.',
    phaseHints: ['발밑까지 이어진 명령의 선을 끊으세요.', '빈 원을 따라 다음 귀환 쉼터로 이동하세요.', '세 번째 쉼터까지 이동해야 합니다.'],
  },
};

export const BOSS_SIGNATURES = {
  bell_toll: { name:'삼중 조종', cue:'고리 사이로 이동 → 마지막 울림 뒤 반격', color:0xe8be74, anim:'raise' },
  bell_clap: { name:'장례의 합창', cue:'양옆 종 → 중앙 종, 순서대로 피하세요', color:0xe8be74, anim:'cast' },
  kiln_vents: { name:'용광로 개방', cue:'중앙 통로 → 바깥 통로 과열', color:0xff713d, anim:'raise' },
  kiln_hammer: { name:'용재 망치', cue:'발밑 강타를 피한 뒤 고리 안으로', color:0xff713d, anim:'attackJump' },
  archive_retrace: { name:'되감는 기록', cue:'지나온 세 자리로 되돌아가지 마세요', color:0x85dfff, anim:'raise' },
  archive_hourglass: { name:'얼어붙은 모래시계', cue:'바깥 고리 → 안쪽 원 → 바깥 고리', color:0x85dfff, anim:'cast' },
  tide_sweep: { name:'침몰 선단의 물결', cue:'물결이 지나간 통로로 이동', color:0x48dabd, anim:'attackHeavy' },
  tide_undertow: { name:'심해의 역류', cue:'바깥에서 안으로 조여 오는 고리를 피하세요', color:0x48dabd, anim:'raise' },
  crown_orbit: { name:'회전 심판', cue:'중앙 빈 원 또는 칼날 밖으로', color:0xe9c785, anim:'attackSpin' },
  crown_verdict: { name:'갈라진 낙인', cue:'두 낙인 뒤 가운데 절단선을 피하세요', color:0xe9c785, anim:'cast' },
  oath_tethers: { name:'끊어진 명령', cue:'잔향과 나를 잇는 선 옆으로 이동', color:0x87cbb0, anim:'cast' },
  oath_shelter: { name:'함께 잇는 귀환', cue:'공명 속 빈 원을 따라 다음 쉼터로', color:0x87cbb0, anim:'raise' },
};
export const isBossSignature = key => Object.hasOwn(BOSS_SIGNATURES, key);
