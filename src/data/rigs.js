/**
 * 리그별 애니메이션 이름 맵.
 * KayKit(스켈레톤/영웅)과 Quaternius(몬스터 26종)는 클립 이름 체계가 완전히 다르다.
 * Enemy 는 논리 이름(idle/run/attack/hit/death…)으로만 재생하고, 여기서 실제 클립으로 번역한다.
 */
export const RIGS = {
  // ---- KayKit 스켈레톤 (기존) ----
  kaykit: {
    idle: 'Idle', idleCombat: 'Idle_Combat',
    walk: 'Walking_D_Skeletons', run: 'Running_A', back: 'Walking_Backwards',
    hit: ['Hit_A', 'Hit_B'], death: ['Death_A', 'Death_B'],
    spawn: 'Spawn_Ground', dodge: 'Dodge_Backward',
    attack: '1H_Melee_Attack_Slice_Horizontal',
    attackHeavy: '1H_Melee_Attack_Chop', attackSpin: '2H_Melee_Attack_Spin',
    attackJump: '1H_Melee_Attack_Jump_Chop', cast: 'Spellcast_Shoot',
    summon: 'Spellcast_Summon', raise: 'Spellcast_Raise', dash: 'Dodge_Forward',
    scale: 1, hover: 0, faceFlip: false,
  },
  // ---- Quaternius Big (2족 근접) ----
  big: {
    idle: 'Idle', idleCombat: 'Idle',
    walk: 'Walk', run: 'Run', back: 'Walk',
    hit: ['HitReact'], death: ['Death'],
    spawn: null, dodge: 'Jump',
    attack: 'Punch', attackHeavy: 'Weapon', attackSpin: 'Weapon',
    attackJump: 'Jump', cast: 'Punch', summon: 'Weapon', raise: 'Weapon', dash: 'Run',
    scale: 0.6, hover: 0, faceFlip: true,
  },
  // ---- Quaternius Blob (작고 통통, 물어뜯음) ----
  blob: {
    idle: 'Idle', idleCombat: 'Idle',
    walk: 'Walk', run: 'Walk', back: 'Walk',
    hit: ['HitRecieve'], death: ['Death'],
    spawn: null, dodge: 'Jump',
    attack: 'Bite_Front', attackHeavy: 'Bite_Front', attackSpin: 'Jump',
    attackJump: 'Jump', cast: 'Bite_Front', summon: 'Jump', raise: 'Jump', dash: 'Jump',
    scale: 0.85, hover: 0, faceFlip: true,
  },
  // ---- Quaternius Flying (공중, 걷기 없음) ----
  flying: {
    idle: 'Flying_Idle', idleCombat: 'Flying_Idle',
    walk: 'Fast_Flying', run: 'Fast_Flying', back: 'Fast_Flying',
    hit: ['HitReact'], death: ['Death'],
    spawn: null, dodge: 'Fast_Flying',
    attack: 'Punch', attackHeavy: 'Headbutt', attackSpin: 'Headbutt',
    attackJump: 'Headbutt', cast: 'Punch', summon: 'Punch', raise: 'Punch', dash: 'Fast_Flying',
    scale: 0.62, hover: 0.5, faceFlip: true,
  },
};

/** 모델 파일명 → 리그 추론 */
export function rigOf(model) {
  if (model.startsWith('Big_')) return 'big';
  if (model.startsWith('Blob_')) return 'blob';
  if (model.startsWith('Flying_')) return 'flying';
  return 'kaykit';
}
