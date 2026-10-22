/**
 * 리그별 애니메이션 이름 맵.
 * KayKit(스켈레톤/영웅)과 Quaternius(몬스터 26종)는 클립 이름 체계가 완전히 다르다.
 * Enemy 는 논리 이름(idle/run/attack/hit/death…)으로만 재생하고, 여기서 실제 클립으로 번역한다.
 */
export const RIGS = {
  library: {
    idle: 'idle', idleCombat: 'idle', walk: 'walk', run: 'run', back: 'walk',
    // hitHeavy: 강타·치명타·마무리 피격 전용(선택 클립). 없으면 Actor.A 가 hit 으로 폴백한다(난수 소비 없음).
    // hitKnockback: 크게 밀려나는 타격(kb≥6) 전용 넉백 클립(애니메이션 팩, 선택). 없으면 hitHeavy → hit 으로 폴백한다.
    hit: ['hit'], hitHeavy: 'hitHeavy', hitKnockback: 'hitKnockback', death: ['death'], spawn: 'spawn', dodge: 'run',
    attack: ['attack', 'attack2'], attack2: 'attack2', attackHeavy: ['attackHeavy', 'attack'],
    attackSpin: ['attackSpin', 'attackHeavy', 'attack'], attackJump: ['attackJump', 'attackHeavy', 'attack'],
    cast: ['cast', 'attack'], summon: ['summon', 'roar', 'cast', 'attack'], raise: ['raise', 'cast', 'attack'], dash: 'run',
    scale: 1, hover: 0, faceFlip: false,
  },
  // ---- KayKit 스켈레톤 (기존) ----
  kaykit: {
    idle: 'Idle', idleCombat: 'Idle_Combat',
    walk: 'Walking_D_Skeletons', run: 'Running_A', back: 'Walking_Backwards',
    hit: ['Hit_A', 'Hit_B'], hitHeavy: 'Hit_B', death: ['Death_A', 'Death_B'],
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
    hit: ['HitReact'], hitHeavy: 'HitReact', death: ['Death'],
    spawn: null, dodge: 'Jump',
    attack: 'Punch', attackHeavy: 'Weapon', attackSpin: 'Weapon',
    attackJump: 'Jump', cast: 'Punch', summon: 'Weapon', raise: 'Weapon', dash: 'Run',
    scale: 0.6, hover: 0, faceFlip: false,
  },
  // ---- Quaternius Blob (작고 통통, 물어뜯음) ----
  blob: {
    idle: 'Idle', idleCombat: 'Idle',
    walk: 'Walk', run: 'Walk', back: 'Walk',
    hit: ['HitRecieve'], hitHeavy: 'HitRecieve', death: ['Death'],
    spawn: null, dodge: 'Jump',
    attack: 'Bite_Front', attackHeavy: 'Bite_Front', attackSpin: 'Jump',
    attackJump: 'Jump', cast: 'Bite_Front', summon: 'Jump', raise: 'Jump', dash: 'Jump',
    scale: 0.85, hover: 0, faceFlip: false,
  },
  // ---- Quaternius Flying (공중, 걷기 없음) ----
  flying: {
    idle: 'Flying_Idle', idleCombat: 'Flying_Idle',
    walk: 'Fast_Flying', run: 'Fast_Flying', back: 'Fast_Flying',
    hit: ['HitReact'], hitHeavy: 'HitReact', death: ['Death'],
    spawn: null, dodge: 'Fast_Flying',
    attack: 'Punch', attackHeavy: 'Headbutt', attackSpin: 'Headbutt',
    attackJump: 'Headbutt', cast: 'Punch', summon: 'Punch', raise: 'Punch', dash: 'Fast_Flying',
    scale: 0.62, hover: 0.5, faceFlip: false,
  },
};

/**
 * 애니메이션 팩(h4-anim)의 이음새 보정 클립(<원본>Seam)이 로드된 라이브러리 몬스터는 같은 논리 키를 그 클립으로 바꿔 끼운다.
 * 후보 수·순서가 그대로라 Actor.A 의 난수 소비가 같다. 바꿀 게 없으면 원래 리그 객체를 그대로 돌려준다.
 */
export function libraryPackRig(rig, clips) {
  let out = rig;
  const swap = (name) => (typeof name === 'string' && clips?.[name + 'Seam'] ? name + 'Seam' : name);
  for (const [key, value] of Object.entries(rig)) {
    if (typeof value !== 'string' && !Array.isArray(value)) continue;
    const next = Array.isArray(value) ? value.map(swap) : swap(value);
    const changed = Array.isArray(value) ? next.some((name, i) => name !== value[i]) : next !== value;
    if (!changed) continue;
    if (out === rig) out = { ...rig };
    out[key] = next;
  }
  return out;
}

/** 재생 중인 라이브러리 클립 이름 → 자산 manifest 의 논리 키(이음새 보정 클립은 원본 키). 타격 프레임(impacts) 조회용. */
export function libraryClipKey(asset, clipName) {
  if (!asset?.clips || typeof clipName !== 'string') return undefined;
  const name = clipName.endsWith('Seam') ? clipName.slice(0, -4) : clipName;
  return Object.entries(asset.clips).find(([, clip]) => clip === name)?.[0];
}

// All 26 shipped Quaternius GLBs face +Z in idle/run/attack, like KayKit.
// Actor and party replicas must not add a second 180-degree facing correction.
/** 모델 파일명 → 리그 추론 */
export function rigOf(model, libraryAsset = null) {
  if (libraryAsset) return 'library';
  if (model.startsWith('Big_')) return 'big';
  if (model.startsWith('Blob_')) return 'blob';
  if (model.startsWith('Flying_')) return 'flying';
  return 'kaykit';
}
