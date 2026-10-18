# handoff — 전투 자세 감사에서 클라우드 루프(자가개선) 소유 영역으로 넘기는 결함

- 측정: tools/combat-pose-qa.mjs, 기준 HEAD ac0fdcb, 격리 Chromium 1280x720, app.step 1/60초, 무적·쿨다운0·MP·궁극 게이지 가득·AUTO 끔·각성 레벨 99 고정. 실기기 아님.
- 기준(brief A2, 느슨하게 바꾸지 않음): 무기 손잡이-손 8cm 이하 / 무기·머리 겹침 0 / 무기·팔 몸통 관통 4cm 이하.
- 결론: 손잡이-손 거리(hw)는 다섯 직업 전 동작이 3.7~5.0cm로 기준 안이다. 장착 오프셋(look.js·소켓) 원인의 결함은 없었다. 아래 위반은 전부 클립이 만든 자세(휘두르기 준비·활 당기기·구르기·환호) 자체에서 나온다. 원인 파일: src/engine/hero-body-motion.js, src/data/higher-body-*.json, 영웅 GLB의 클립(수정 금지 영역).
- 머리 판정 정의: brief의 "머리 뼈 중심 반경 0.35"는 머리 뼈가 목 밑동이라 구가 어깨까지 덮어 헐겁다(spec 열). 판정(head 열)은 머리 뼈에 묶인 두개골 정점의 중심과 75분위 반경 구를 쓴다. 두 값 모두 표에 있고 둘 다 위반이 많다. 부호: 음수=겹침 깊이(cm).
- 몸통 판정: 엉덩이~목 타원 원기둥, 단면은 척추 정점 중앙값에서 추정(직업별). 구르기·점프 클립은 몸이 눕기 때문에 머리·몸통 겹침이 클립 성격상 크게 나온다(캡처 확인).

## 직업×동작 최대값 (cm, 전투 클립 / 최악 표본 기준)

| 직업 | 동작 | 클립 | 손-무기 | 머리 여유(두개골) | 머리 여유(spec) | 몸통 관통 | 팔 관통 | 위반 |
|---|---|---|---|---|---|---|---|---|
| knight | idle | Idle | 3.8 | 14.7 | -4.9 | 0 | 0 | - |
| knight | run | Running_A | 3.8 | -9.3 | -22.3 | 0 | 0 | head |
| knight | attack1 | 1H_Melee_Attack_Slice_Horizontal | 3.8 | -18.3 | -24.4 | 3.9 | 0 | head |
| knight | attack2 | 1H_Melee_Attack_Slice_Diagonal | 3.8 | -12.8 | -32.2 | 17.6 | 0 | head,torso |
| knight | attack3 | 1H_Melee_Attack_Stab | 3.8 | -14.3 | -30.1 | 9.4 | 0 | head,torso |
| knight | attack4 | 2H_Melee_Attack_Spin | 3.8 | -9.4 | -22.9 | 19.2 | 0 | head,torso |
| knight | attack5 | 1H_Melee_Attack_Slice_Horizontal | 3.8 | -23 | -28.9 | 2.5 | 0 | head |
| knight | attack6 | 1H_Melee_Attack_Chop | 3.8 | -24.9 | -30.7 | 10.8 | 0 | head,torso |
| knight | skill0-holy_slash | 1H_Melee_Attack_Slice_Horizontal | 3.8 | -19.8 | -29.8 | 5.5 | 0 | head,torso |
| knight | skill1-shield_bash | Block_Hit | 3.8 | 15 | 1.9 | 0 | 0 | - |
| knight | skill2-judgment | Spellcast_Raise | 3.8 | -22.7 | -29.7 | 15.5 | 0 | head,torso |
| knight | skill3-dragon_slash | 2H_Melee_Attack_Chop | 3.8 | -24.7 | -31.8 | 12 | 0 | head,torso |
| knight | skill4-chain_bind | Spellcast_Raise | 3.8 | -20.8 | -29.5 | 15.9 | 0 | head,torso |
| knight | skill5-sanctuary | Spellcast_Raise | 3.8 | -22.7 | -29.7 | 15.5 | 0 | head,torso |
| knight | skill6-sunbreaker | 2H_Melee_Attack_Chop | 3.8 | -24.4 | -31.8 | 10.2 | 0 | head,torso |
| knight | skill7-heavenfall | Spellcast_Raise | 3.8 | -22.7 | -29.7 | 15.5 | 0 | head,torso |
| knight | dodge | Dodge_Forward | 3.8 | 11.3 | -12.6 | 8.5 | 0 | torso |
| knight | hit | Hit_A | 3.8 | -11 | -18.6 | 0 | 0 | head |
| knight | cheer | Cheer | 3.8 | -19.7 | -27.5 | 13.2 | 0 | head,torso |
| knight | interact | Interact | 3.8 | -17.9 | -20.3 | 0 | 0 | head |
| barbarian | idle | Idle | 3.7 | -3.2 | 2.8 | 0 | 0 | head |
| barbarian | run | Running_A | 3.7 | -10.3 | 10.8 | 0 | 0 | head |
| barbarian | attack1 | 2H_Melee_Attack_Slice | 3.7 | -29 | -17.8 | 11.4 | 0 | head,torso |
| barbarian | attack2 | 2H_Melee_Attack_Stab | 3.7 | -23.6 | -17.5 | 4.2 | 0 | head,torso |
| barbarian | attack3 | 2H_Melee_Attack_Spinning | 3.7 | -24.8 | -24 | 11.6 | 0 | head,torso |
| barbarian | attack4 | 2H_Melee_Attack_Chop | 3.7 | -31.8 | -14.7 | 0 | 0 | head |
| barbarian | attack5 | Jump_Full_Short | 3.7 | -29.1 | -14.3 | 0 | 0 | head |
| barbarian | skill0-whirlwind | 2H_Melee_Attack_Spin | 3.7 | -25.6 | -26.5 | 18.3 | 0 | head,torso |
| barbarian | skill1-quake | 2H_Melee_Attack_Chop | 3.7 | -31.7 | -14.5 | 2.8 | 0 | head |
| barbarian | skill2-berserk | Cheer | 3.7 | -31.4 | -27.2 | 14.3 | 0 | head,torso |
| barbarian | skill3-hell_axe | Jump_Full_Short | 3.7 | -29.2 | -15.2 | 0 | 0 | head |
| barbarian | skill4-bull_rush | 2H_Melee_Attack_Stab | 3.7 | -23.7 | -18.8 | 6.7 | 0 | head,torso |
| barbarian | skill5-magma_zone | 2H_Melee_Attack_Chop | 3.7 | -31.2 | -15.1 | 1.2 | 0 | head |
| barbarian | skill6-bloodquake | 2H_Melee_Attack_Chop | 3.7 | -31.7 | -14.5 | 2.8 | 0 | head |
| barbarian | skill7-cataclysm | Jump_Full_Short | 3.7 | -29.4 | -15.4 | 0 | 0 | head |
| barbarian | dodge | Dodge_Forward | 3.7 | 8.6 | 21.5 | 0 | 0 | - |
| barbarian | hit | Hit_A | 3.7 | -7.8 | 11.7 | 0 | 0 | head |
| barbarian | cheer | Cheer | 3.7 | -33.7 | -27.2 | 18.8 | 0 | head,torso |
| barbarian | interact | Interact | 3.7 | -29.3 | -8.5 | 0 | 0 | head |
| mage | idle | Idle | 4.7 | -5.3 | 3.8 | 0 | 0 | head |
| mage | run | Running_A | 4.7 | 23.7 | 22.1 | 0 | 0 | - |
| mage | attack1 | Spellcast_Shoot | 4.7 | -10.3 | -2.3 | 0 | 0 | head |
| mage | attack2 | Spellcast_Shoot | 4.7 | -10.3 | -2.3 | 0 | 0 | head |
| mage | attack3 | Spellcast_Long | 4.7 | -5.6 | 1 | 0 | 0 | head |
| mage | attack4 | Spellcast_Shoot | 4.7 | -10.3 | -2.3 | 0 | 0 | head |
| mage | attack5 | Spellcast_Raise | 4.7 | -16.6 | -0.8 | 0 | 0 | head |
| mage | skill0-fireball | Spellcast_Shoot | 4.7 | -11.3 | -0.3 | 0 | 0 | head |
| mage | skill1-chain | Spellcast_Raise | 4.7 | -22.6 | -6.1 | 0 | 0 | head |
| mage | skill2-blizzard | Spellcast_Long | 4.7 | -6.4 | -4.5 | 0 | 0 | head |
| mage | skill3-meteor | Spellcast_Raise | 4.7 | -21.6 | -6.7 | 0 | 0 | head |
| mage | skill4-arc_reflect | Spellcast_Shoot | 4.7 | -11.3 | -0.3 | 0 | 0 | head |
| mage | skill5-chrono_seal | Spellcast_Raise | 4.7 | -22.6 | -6.1 | 0 | 0 | head |
| mage | skill6-star_prison | Spellcast_Long | 4.7 | -8.8 | -1.7 | 0 | 0 | head |
| mage | skill7-absolute_zero | Spellcast_Raise | 4.7 | -22.6 | -6.1 | 0 | 0 | head |
| mage | dodge | Dodge_Forward | 4.7 | 10.9 | 14.5 | 0 | 0 | - |
| mage | hit | Hit_A | 4.7 | -6.7 | 4.6 | 0 | 0 | head |
| mage | cheer | Cheer | 4.7 | -3.1 | 0 | 0 | 0 | head |
| mage | interact | Interact | 4.7 | 3.3 | 9.1 | 0 | 0 | - |
| rogue | idle | Idle | 4.8 | 14.7 | 20.9 | 0 | 0 | - |
| rogue | run | Running_A | 4.8 | -35.5 | -26.3 | 4.5 | 0 | head,torso |
| rogue | attack1 | Dualwield_Melee_Attack_Slice | 4.8 | -39.2 | -29.1 | 8.8 | 0 | head,torso |
| rogue | attack2 | Dualwield_Melee_Attack_Chop | 4.8 | -35.9 | -26.1 | 9.4 | 0 | head,torso |
| rogue | attack3 | Dualwield_Melee_Attack_Slice | 4.8 | -39.2 | -29.1 | 8.8 | 0 | head,torso |
| rogue | attack4 | Dodge_Forward | 4.8 | -31.2 | -25.3 | 11.2 | 0 | head,torso |
| rogue | attack5 | Dualwield_Melee_Attack_Chop | 4.8 | -35.9 | -26.1 | 9.4 | 0 | head,torso |
| rogue | attack6 | Dualwield_Melee_Attack_Stab | 4.8 | -35.6 | -24.3 | 2.5 | 0 | head |
| rogue | skill0-shadow_dash | Dodge_Forward | 4.8 | -36.4 | -27.1 | 17.3 | 0 | head,torso |
| rogue | skill1-poison_bomb | Throw | 4.8 | -30.2 | -27.5 | 2.1 | 0 | head |
| rogue | skill2-flurry | Dualwield_Melee_Attack_Stab | 4.8 | -41.7 | -30.9 | 14.4 | 0 | head,torso |
| rogue | skill3-thousand | Spellcast_Raise | 4.8 | -36.3 | -24.2 | 7.3 | 0 | head,torso |
| rogue | skill4-shadow_mark | Dualwield_Melee_Attack_Stab | 4.8 | -34.3 | -21.2 | 2.9 | 0 | head |
| rogue | skill5-void_step | Dodge_Forward | 4.8 | -35.6 | -28.3 | 17.3 | 0 | head,torso |
| rogue | skill6-night_parade | Dualwield_Melee_Attack_Slice | 4.8 | -41.7 | -30.9 | 15.5 | 0 | head,torso |
| rogue | skill7-eclipse_edge | Dodge_Forward | 4.8 | -36 | -28 | 17.4 | 0 | head,torso |
| rogue | dodge | Dodge_Forward | 4.8 | 16.2 | 22.4 | 0 | 0 | - |
| rogue | hit | Hit_A | 4.8 | -41 | -26.3 | 1.5 | 0 | head |
| rogue | cheer | Cheer | 4.8 | -41.1 | -23.8 | 0 | 0 | head |
| rogue | interact | Interact | 4.8 | -28.5 | -19.9 | 9.5 | 0 | head,torso |
| ranger | idle | Idle | 5 | 25.4 | 3.7 | 0 | 0 | - |
| ranger | run | Running_A | 5 | 23.7 | 2.1 | 0 | 0 | - |
| ranger | attack1 | Bow_Shoot | 5 | -0.2 | -17.6 | 6.7 | 16.5 | head,torso,arm |
| ranger | attack2 | Bow_Shoot | 5 | -1.4 | -19.8 | 11.7 | 15.2 | head,torso,arm |
| ranger | attack3 | Bow_Shoot | 5 | 0.7 | -16.5 | 5.3 | 18.3 | torso,arm |
| ranger | attack4 | Bow_Shoot | 5 | -1.1 | -19 | 9 | 15.2 | head,torso,arm |
| ranger | attack5 | Bow_Shoot | 5 | -1.8 | -20 | 10.2 | 16 | head,torso,arm |
| ranger | skill0-ranger_pierce | Bow_Shoot | 5 | 0.7 | -18.5 | 13.7 | 18.4 | torso,arm |
| ranger | skill1-ranger_volley | Bow_Shoot | 5 | 2.7 | -17.1 | 8.4 | 18.4 | torso,arm |
| ranger | skill2-ranger_retreat | Bow_Shoot | 5 | 4.4 | -15.8 | 5.1 | 18.4 | torso,arm |
| ranger | skill3-ranger_tempest | Bow_Shoot | 5 | 5.1 | -15.1 | 4 | 17 | arm |
| ranger | skill4-ranger_quickshot | Bow_Shoot | 5 | -0.2 | -19.4 | 13.7 | 17.5 | head,torso,arm |
| ranger | skill5-ranger_binding | Bow_Shoot | 5 | 2.3 | -17.4 | 9.4 | 18.4 | torso,arm |
| ranger | skill6-gale_hunt | Bow_Shoot | 5 | 4.1 | -16.2 | 4.2 | 18.5 | torso,arm |
| ranger | skill7-skyfall_arrows | Bow_Shoot | 5 | 4.4 | -15.8 | 5.1 | 18.4 | torso,arm |
| ranger | dodge | Dodge_Forward | 5 | 16.7 | -2.6 | 0 | 0 | - |
| ranger | hit | Hit_A | 5 | 11.8 | -8.8 | 0 | 0 | - |
| ranger | cheer | Cheer | 5 | 16.8 | -2.1 | 0 | 0 | - |
| ranger | interact | Interact | 5 | 23.9 | 4.1 | 0 | 0 | - |

## 최악 프레임 캡처 (왼쪽 정면 대각선, 오른쪽 옆. 청록=몸통 원기둥, 분홍=두개골 구, 노랑=spec 구, 빨강 점=가장 깊은 무기 점)

- knight attack2 torso 표본 3프레임 값 17.6 → baseline/captures/battle-knight-attack2-torso.png
- knight attack4 torso 표본 7프레임 값 19.2 → baseline/captures/battle-knight-attack4-torso.png
- knight attack6 headClear 표본 15프레임 값 -24.9 → baseline/captures/battle-knight-attack6-headClear.png
- knight skill3-dragon_slash headClear 표본 50프레임 값 -24.7 → baseline/captures/battle-knight-skill3-dragon_slash-headClear.png
- barbarian attack4 headClear 표본 11프레임 값 -31.8 → baseline/captures/battle-barbarian-attack4-headClear.png
- barbarian skill0-whirlwind torso 표본 9프레임 값 18.3 → baseline/captures/battle-barbarian-skill0-whirlwind-torso.png
- barbarian cheer torso 표본 85프레임 값 18.8 → baseline/captures/battle-barbarian-cheer-torso.png
- barbarian cheer headClear 표본 355프레임 값 -33.7 → baseline/captures/battle-barbarian-cheer-headClear.png
- mage skill1-chain headClear 표본 17프레임 값 -22.6 → baseline/captures/battle-mage-skill1-chain-headClear.png
- mage skill5-chrono_seal headClear 표본 19프레임 값 -22.6 → baseline/captures/battle-mage-skill5-chrono_seal-headClear.png
- rogue skill0-shadow_dash torso 표본 19프레임 값 17.3 → baseline/captures/battle-rogue-skill0-shadow_dash-torso.png
- rogue skill2-flurry headClear 표본 11프레임 값 -41.7 → baseline/captures/battle-rogue-skill2-flurry-headClear.png
- rogue skill6-night_parade headClear 표본 17프레임 값 -41.7 → baseline/captures/battle-rogue-skill6-night_parade-headClear.png
- rogue skill7-eclipse_edge torso 표본 32프레임 값 17.4 → baseline/captures/battle-rogue-skill7-eclipse_edge-torso.png
- ranger attack2 headClear 표본 10프레임 값 -1.4 → baseline/captures/battle-ranger-attack2-headClear.png
- ranger attack5 headClear 표본 19프레임 값 -1.8 → baseline/captures/battle-ranger-attack5-headClear.png
- ranger skill0-ranger_pierce torso 표본 11프레임 값 13.7 → baseline/captures/battle-ranger-skill0-ranger_pierce-torso.png
- ranger skill0-ranger_pierce arm 표본 17프레임 값 18.4 → baseline/captures/battle-ranger-skill0-ranger_pierce-arm.png
- ranger skill4-ranger_quickshot torso 표본 27프레임 값 13.7 → baseline/captures/battle-ranger-skill4-ranger_quickshot-torso.png
- ranger skill6-gale_hunt arm 표본 37프레임 값 18.5 → baseline/captures/battle-ranger-skill6-gale_hunt-arm.png

## 마을 걷기·감정 표현 (로비 교정 수정 전 → 후)

| 직업 | 동작 | 전 몸통/팔/머리 | 후 몸통/팔/머리 |
|---|---|---|---|
| knight | hub-idle | 0 / 0 / 21.8 | 0 / 0 / 21.8 |
| knight | hub-walk | 16.3 / 0 / -3.1 | 0 / 0 / -9.3 |
| knight | hub-Cheer | 12.4 / 0 / -15.5 | 13.2 / 0 / -19.7 |
| knight | hub-Interact | 16.2 / 0 / -11.8 | 0 / 0 / -17.9 |
| barbarian | hub-idle | 0 / 0 / 35.1 | 0 / 0 / 35.1 |
| barbarian | hub-walk | 0 / 0 / -6 | 0 / 0 / -10.5 |
| barbarian | hub-Cheer | 1.4 / 0 / -13.6 | 18.8 / 0 / -33.7 |
| barbarian | hub-Interact | 0 / 0 / -35.7 | 0 / 0 / -29.3 |
| mage | hub-idle | 0 / 0 / 18.9 | 0 / 0 / 18.9 |
| mage | hub-walk | 0 / 0 / 35.9 | 0 / 0 / 23.6 |
| mage | hub-Cheer | 0 / 10.9 / -20.4 | 0 / 0 / -3.1 |
| mage | hub-Interact | 0 / 0.1 / 18 | 0 / 0 / 13.7 |
| rogue | hub-idle | 0 / 0 / 14.6 | 0 / 0 / 14.6 |
| rogue | hub-walk | 4.4 / 0 / -35.9 | 4.5 / 0 / -35.9 |
| rogue | hub-Cheer | 0 / 0 / -41.1 | 0 / 0 / -41.1 |
| rogue | hub-Interact | 11.7 / 0 / -27.3 | 9.5 / 0 / -28.5 |
| ranger | hub-idle | 0 / 0 / 32.3 | 0 / 0 / 32.3 |
| ranger | hub-walk | 0 / 5.3 / 30.4 | 0 / 0 / 23.7 |
| ranger | hub-Cheer | 0 / 3.9 / 25.2 | 0 / 0 / 16.8 |
| ranger | hub-Interact | 0 / 0 / 31.9 | 0 / 0 / 23.9 |

## 넘기는 항목 요약

- 궁수(ranger): Bow_Shoot 상체 층(RangerBowUpper)에서 모든 기본 공격·스킬이 팔 관통 15~18.5cm(위팔·아래팔이 몸통 원기둥 안으로), 몸통 관통(활 시위·활) 4~13.7cm. 활 당기기 때 오른팔이 몸통을 가로지른다. 소유: hero-body-motion / ranger-library 클립.
- 기사·야만전사: 휘두르기 준비 구간(attack2·4, 회전베기, 광폭화 환호)에서 무기가 몸통을 12~19cm 관통, 무기가 머리 곁을 지난다(두개골 구 겹침 최대 -33.7cm). 소유: 클립.
- 도적: 이중 단검 공격과 Dodge_Forward 기반 스킬(shadow_dash, void_step, eclipse_edge)이 몸통 8~17cm, 머리 겹침. 구르기 중 몸이 눕는 클립이라 머리 판정 자체가 과대일 수 있다.
- 마법사: 몸통·팔 관통은 없고, Spellcast_Raise 계열(지팡이를 들어 올림)에서 지팡이가 머리 구를 최대 -22.6cm(두개골 기준) 겹친다. 로비 정지 자세 기준은 유지.
- 환호(Cheer)·상호작용(Interact)은 현재 로비 쇼케이스에서 재생하는 코드가 없다(s.gesture 사용처 없음). 표의 hub-Cheer/Interact는 클립을 강제로 재생한 합성 측정이다. 전투 승리 연출(Cheer)은 전투 인스턴스라 battle 표 cheer 행이 해당한다.