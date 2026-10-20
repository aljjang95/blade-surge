# 기준 80건 및 최종 판정불가 분류

기준 소스 `027238f5126cd1e20c20c5ba76deca42b331ce30`. 기존 도구가 낸 **판정불가 80건**을 정면·측면·후면 대표 캡처로 육안 확인한 분류다. 자동 판정과 수치를 바꾸지 않았다. 동일 캡처를 공유하는 동작은 대표 클립 프레임을 참조한다. 정상은 해당 대표 프레임에서 A1 부위의 피부 관통이 보이지 않는다는 뜻이며 전 구간·실기기 합격으로 확대하지 않는다.

분류: 측정 부위 정상 72건, 별도 의복·머리카락 겹침 8건. 후자도 A1 피부 부위 관통은 보이지 않았지만 시각 결함을 숨기지 않고 남긴다.

도적 night_parade는 기본 도구의 재시전에서 표본 수가 달라 캡처가 없었다. 보충 측정은 같은 hook.measure를 사용하고 한 번의 순차 재생 중 최악 프레임을 즉시 캡처했다. 마법사의 강한 발광 2건은 캡처 때만 원본 텍스처를 무조명 재질로 보여 형태를 확인했다. 이 보충 캡처는 A1 수치를 대체하지 않는다.

## 코드로 확인한 도달성

- `src/main.js:interactHub` → `src/ui/citadel-hub.js:interact`는 패널을 열며 Interact 애니메이션을 재생하지 않는다.
- `src/game/hub-movement.js:_setMoving`은 Running_A와 Idle만 고른다. 마을 Cheer·Interact 호출은 없다.
- `src/game/battle-base.js` 승리는 Cheer를 0.2초 페이드로 재생한다. 야만전사 berserk도 Cheer를 쓴다. 전투 Interact 호출은 없다.
- 필수 로더 별칭과 감사기의 직접 클립 재생은 게임에서 도달 가능한 행동의 근거가 아니다. 두 hub-Interact 결함을 117개 집계에서 빼지 않는다.

## hub-Interact 2건

| 직업 | 기준 프레임 | 무기 깊이 | 게임 경로 | 처리 |
|---|---:|---:|---|---|
| 기사 | 0 | 13.3cm(다리) | 호출 없음 | 복제 회전 키로 수정, 원본 117개 감사 통과 |
| 궁수 | 0 | 4.1cm(몸통) | 호출 없음 | 복제 회전 키로 수정, 원본 117개 감사 통과 |

## 80건 표

| 직업 | 면·동작 | 클립 | 도달성 | 대표 프레임 | 육안 분류 | 관찰 | 캡처 |
|---|---|---|---|---:|---|---|---|
| knight | hub·hub-walk | Running_A | 가능: 마을 걷기 | 20 | 정상(측정 부위) | 방패 손잡이·아래팔 접촉은 쥠 영역이며 몸통·다리에 칼날이 들어가는 모습은 없음 | [3시점](../work/combat-pose-clip/before/captures/hub-knight-hub-walk-unk.jpg) |
| knight | hub·hub-Cheer | Cheer | 불가: 마을 호출 없음(전투 승리 Cheer는 별도) | 29 | 정상(측정 부위) | 방패 손잡이·아래팔 접촉은 쥠 영역이며 몸통·다리에 칼날이 들어가는 모습은 없음 | [3시점](../work/combat-pose-clip/before/captures/hub-knight-hub-Cheer-unk.jpg) |
| knight | battle·run | Running_A | 가능: 전투 입력 | 82 | 정상(측정 부위) | 방패 손잡이·아래팔 접촉은 쥠 영역이며 몸통·다리에 칼날이 들어가는 모습은 없음 | [3시점](../work/combat-pose-clip/before/captures/battle-knight-run-unk.jpg) |
| knight | battle·attack3 | 1H_Melee_Attack_Stab | 가능: 전투 입력 | 9 | 정상(측정 부위) | 방패 손잡이·아래팔 접촉은 쥠 영역이며 몸통·다리에 칼날이 들어가는 모습은 없음 | [3시점](../work/combat-pose-clip/before/captures/battle-knight-attack3-unk.jpg) |
| knight | battle·attack6 | 1H_Melee_Attack_Chop | 가능: 전투 입력 | 20 | 정상(측정 부위) | 방패 손잡이·아래팔 접촉은 쥠 영역이며 몸통·다리에 칼날이 들어가는 모습은 없음 | [3시점](../work/combat-pose-clip/before/captures/battle-knight-attack6-unk.jpg) |
| knight | battle·skill1-shield_bash | Block_Hit | 가능: 해당 스킬 해금 뒤 시전 | 3 | 정상(측정 부위) | 방패 손잡이·아래팔 접촉은 쥠 영역이며 몸통·다리에 칼날이 들어가는 모습은 없음 | [3시점](../work/combat-pose-clip/before/captures/battle-knight-skill1-shield_bash-unk.jpg) |
| knight | battle·skill2-judgment | Spellcast_Raise | 가능: 해당 스킬 해금 뒤 시전 | 52 | 정상(측정 부위) | 방패 손잡이·아래팔 접촉은 쥠 영역이며 몸통·다리에 칼날이 들어가는 모습은 없음 | [3시점](../work/combat-pose-clip/before/captures/battle-knight-skill2-judgment-unk.jpg) |
| knight | battle·skill3-dragon_slash | 2H_Melee_Attack_Chop | 가능: 해당 스킬 해금 뒤 시전 | 93 | 정상(측정 부위) | 방패 손잡이·아래팔 접촉은 쥠 영역이며 몸통·다리에 칼날이 들어가는 모습은 없음 | [3시점](../work/combat-pose-clip/before/captures/battle-knight-skill3-dragon_slash-unk.jpg) |
| knight | battle·skill4-chain_bind | Spellcast_Raise | 가능: 해당 스킬 해금 뒤 시전 | 52 | 정상(측정 부위) | 방패 손잡이·아래팔 접촉은 쥠 영역이며 몸통·다리에 칼날이 들어가는 모습은 없음 | [3시점](../work/combat-pose-clip/before/captures/battle-knight-skill2-judgment-unk.jpg) |
| knight | battle·skill5-sanctuary | Spellcast_Raise | 가능: 해당 스킬 해금 뒤 시전 | 52 | 정상(측정 부위) | 방패 손잡이·아래팔 접촉은 쥠 영역이며 몸통·다리에 칼날이 들어가는 모습은 없음 | [3시점](../work/combat-pose-clip/before/captures/battle-knight-skill2-judgment-unk.jpg) |
| knight | battle·skill6-sunbreaker | 2H_Melee_Attack_Chop | 가능: 해당 스킬 해금 뒤 시전 | 93 | 정상(측정 부위) | 방패 손잡이·아래팔 접촉은 쥠 영역이며 몸통·다리에 칼날이 들어가는 모습은 없음 | [3시점](../work/combat-pose-clip/before/captures/battle-knight-skill3-dragon_slash-unk.jpg) |
| knight | battle·skill7-heavenfall | Spellcast_Raise | 가능: 해당 스킬 해금 뒤 시전 | 52 | 정상(측정 부위) | 방패 손잡이·아래팔 접촉은 쥠 영역이며 몸통·다리에 칼날이 들어가는 모습은 없음 | [3시점](../work/combat-pose-clip/before/captures/battle-knight-skill2-judgment-unk.jpg) |
| knight | battle·dodge | Dodge_Forward | 가능: 전투 입력 | 14 | 정상(측정 부위) | 방패 손잡이·아래팔 접촉은 쥠 영역이며 몸통·다리에 칼날이 들어가는 모습은 없음 | [3시점](../work/combat-pose-clip/before/captures/battle-knight-dodge-unk.jpg) |
| knight | battle·hit | Hit_A | 가능: 무거운 피격 | 5 | 정상(측정 부위) | 방패 손잡이·아래팔 접촉은 쥠 영역이며 몸통·다리에 칼날이 들어가는 모습은 없음 | [3시점](../work/combat-pose-clip/before/captures/battle-knight-hit-unk.jpg) |
| knight | battle·cheer | Cheer | 가능: battle-base 승리(0.2초 페이드) | 59 | 정상(측정 부위) | 방패 손잡이·아래팔 접촉은 쥠 영역이며 몸통·다리에 칼날이 들어가는 모습은 없음 | [3시점](../work/combat-pose-clip/before/captures/battle-knight-cheer-unk.jpg) |
| knight | battle·interact | Interact | 불가: 현재 호출 없음(감사기 직접 재생) | 1 | 정상(측정 부위) | 방패 손잡이·아래팔 접촉은 쥠 영역이며 몸통·다리에 칼날이 들어가는 모습은 없음 | [3시점](../work/combat-pose-clip/before/captures/battle-knight-interact-unk.jpg) |
| barbarian | hub·hub-walk | Running_A | 가능: 마을 걷기 | 34 | 정상(측정 부위) | 도끼는 손 앞에 있고 다리 사이·의복의 볼록 껍질이 빈 공간까지 덮은 값 | [3시점](../work/combat-pose-clip/before/captures/hub-barbarian-hub-walk-unk.jpg) |
| barbarian | hub·hub-Interact | Interact | 불가: 현재 호출 없음(감사기 직접 재생) | 5 | 정상(측정 부위) | 도끼는 손 앞에 있고 다리 사이·의복의 볼록 껍질이 빈 공간까지 덮은 값 | [3시점](../work/combat-pose-clip/before/captures/hub-barbarian-hub-Interact-unk.jpg) |
| barbarian | battle·run | Running_A | 가능: 전투 입력 | 30 | 정상(측정 부위) | 도끼는 손 앞에 있고 다리 사이·의복의 볼록 껍질이 빈 공간까지 덮은 값 | [3시점](../work/combat-pose-clip/before/captures/battle-barbarian-run-unk.jpg) |
| barbarian | battle·attack4 | 2H_Melee_Attack_Chop | 가능: 전투 입력 | 2 | 정상(측정 부위) | 도끼는 손 앞에 있고 다리 사이·의복의 볼록 껍질이 빈 공간까지 덮은 값 | [3시점](../work/combat-pose-clip/before/captures/battle-barbarian-attack4-unk.jpg) |
| barbarian | battle·attack5 | Jump_Full_Short | 가능: 전투 입력 | 52 | 정상(측정 부위) | 도끼는 손 앞에 있고 다리 사이·의복의 볼록 껍질이 빈 공간까지 덮은 값 | [3시점](../work/combat-pose-clip/before/captures/battle-barbarian-attack5-unk.jpg) |
| barbarian | battle·skill1-quake | 2H_Melee_Attack_Chop | 가능: 해당 스킬 해금 뒤 시전 | 29 | 정상(측정 부위) | 도끼는 손 앞에 있고 다리 사이·의복의 볼록 껍질이 빈 공간까지 덮은 값 | [3시점](../work/combat-pose-clip/before/captures/battle-barbarian-skill1-quake-unk.jpg) |
| barbarian | battle·skill3-hell_axe | Jump_Full_Short | 가능: 해당 스킬 해금 뒤 시전 | 93 | 정상(측정 부위) | 도끼는 손 앞에 있고 다리 사이·의복의 볼록 껍질이 빈 공간까지 덮은 값 | [3시점](../work/combat-pose-clip/before/captures/battle-barbarian-skill3-hell_axe-unk.jpg) |
| barbarian | battle·skill5-magma_zone | 2H_Melee_Attack_Chop | 가능: 해당 스킬 해금 뒤 시전 | 24 | 정상(측정 부위) | 도끼는 손 앞에 있고 다리 사이·의복의 볼록 껍질이 빈 공간까지 덮은 값 | [3시점](../work/combat-pose-clip/before/captures/battle-barbarian-skill5-magma_zone-unk.jpg) |
| barbarian | battle·skill6-bloodquake | 2H_Melee_Attack_Chop | 가능: 해당 스킬 해금 뒤 시전 | 29 | 정상(측정 부위) | 도끼는 손 앞에 있고 다리 사이·의복의 볼록 껍질이 빈 공간까지 덮은 값 | [3시점](../work/combat-pose-clip/before/captures/battle-barbarian-skill1-quake-unk.jpg) |
| barbarian | battle·skill7-cataclysm | Jump_Full_Short | 가능: 해당 스킬 해금 뒤 시전 | 4 | 정상(측정 부위) | 도끼는 손 앞에 있고 다리 사이·의복의 볼록 껍질이 빈 공간까지 덮은 값 | [3시점](../work/combat-pose-clip/before/captures/battle-barbarian-skill7-cataclysm-unk.jpg) |
| barbarian | battle·dodge | Dodge_Forward | 가능: 전투 입력 | 12 | 정상(측정 부위) | 도끼는 손 앞에 있고 다리 사이·의복의 볼록 껍질이 빈 공간까지 덮은 값 | [3시점](../work/combat-pose-clip/before/captures/battle-barbarian-dodge-unk.jpg) |
| barbarian | battle·hit | Hit_A | 가능: 무거운 피격 | 32 | 정상(측정 부위) | 도끼는 손 앞에 있고 다리 사이·의복의 볼록 껍질이 빈 공간까지 덮은 값 | [3시점](../work/combat-pose-clip/before/captures/battle-barbarian-hit-unk.jpg) |
| barbarian | battle·interact | Interact | 불가: 현재 호출 없음(감사기 직접 재생) | 5 | 정상(측정 부위) | 도끼는 손 앞에 있고 다리 사이·의복의 볼록 껍질이 빈 공간까지 덮은 값 | [3시점](../work/combat-pose-clip/before/captures/hub-barbarian-hub-Interact-unk.jpg) |
| mage | hub·hub-walk | Running_A | 가능: 마을 걷기 | 46 | 정상(측정 부위) | 팔꿈치·손이 몸통 바깥에 보이고 넓은 소매·어깨 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/hub-mage-hub-walk-unk.jpg) |
| mage | hub·hub-Cheer | Cheer | 불가: 마을 호출 없음(전투 승리 Cheer는 별도) | 372 | 결함(의복·머리카락) | 팔꿈치·손이 몸통 바깥에 보이고 넓은 소매·어깨 이음매의 껍질 값; 별도로 지팡이와 모자챙·머리카락 겹침 관찰(A1 기준 밖, 미수정) | [3시점](../work/combat-pose-clip/before/captures/hub-mage-hub-Cheer-unk.jpg) |
| mage | hub·hub-Interact | Interact | 불가: 현재 호출 없음(감사기 직접 재생) | 3 | 정상(측정 부위) | 팔꿈치·손이 몸통 바깥에 보이고 넓은 소매·어깨 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/hub-mage-hub-Interact-unk.jpg) |
| mage | battle·run | Running_A | 가능: 전투 입력 | 56 | 정상(측정 부위) | 팔꿈치·손이 몸통 바깥에 보이고 넓은 소매·어깨 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-mage-run-unk.jpg) |
| mage | battle·attack1 | Spellcast_Shoot | 가능: 전투 입력 | 9 | 결함(의복·머리카락) | 팔꿈치·손이 몸통 바깥에 보이고 넓은 소매·어깨 이음매의 껍질 값; 별도로 지팡이와 모자챙·머리카락 겹침 관찰(A1 기준 밖, 미수정) | [3시점](../work/combat-pose-clip/before/captures/battle-mage-attack1-unk.jpg) |
| mage | battle·attack2 | Spellcast_Shoot | 가능: 전투 입력 | 9 | 결함(의복·머리카락) | 팔꿈치·손이 몸통 바깥에 보이고 넓은 소매·어깨 이음매의 껍질 값; 별도로 지팡이와 모자챙·머리카락 겹침 관찰(A1 기준 밖, 미수정) | [3시점](../work/combat-pose-clip/before/captures/battle-mage-attack1-unk.jpg) |
| mage | battle·attack3 | Spellcast_Long | 가능: 전투 입력 | 25 | 정상(측정 부위) | 팔꿈치·손이 몸통 바깥에 보이고 넓은 소매·어깨 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-mage-attack3-unk.jpg) |
| mage | battle·attack4 | Spellcast_Shoot | 가능: 전투 입력 | 9 | 결함(의복·머리카락) | 팔꿈치·손이 몸통 바깥에 보이고 넓은 소매·어깨 이음매의 껍질 값; 별도로 지팡이와 모자챙·머리카락 겹침 관찰(A1 기준 밖, 미수정) | [3시점](../work/combat-pose-clip/before/captures/battle-mage-attack4-unk.jpg) |
| mage | battle·attack5 | Spellcast_Raise | 가능: 전투 입력 | 11 | 정상(측정 부위) | 팔꿈치·손이 몸통 바깥에 보이고 넓은 소매·어깨 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-mage-attack5-unk.jpg) |
| mage | battle·skill0-fireball | Spellcast_Shoot | 가능: 해당 스킬 해금 뒤 시전 | 9 | 결함(의복·머리카락) | 팔꿈치·손이 몸통 바깥에 보이고 넓은 소매·어깨 이음매의 껍질 값; 별도로 지팡이와 모자챙·머리카락 겹침 관찰(A1 기준 밖, 미수정) | [3시점](../work/combat-pose-clip/before/captures/battle-mage-attack4-unk.jpg) |
| mage | battle·skill1-chain | Spellcast_Raise | 가능: 해당 스킬 해금 뒤 시전 | 6 | 정상(측정 부위) | 팔꿈치·손이 몸통 바깥에 보이고 넓은 소매·어깨 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-mage-skill1-chain-unk.jpg) |
| mage | battle·skill2-blizzard | Spellcast_Long | 가능: 해당 스킬 해금 뒤 시전 | 12 | 결함(의복·머리카락) | 팔꿈치·손이 몸통 바깥에 보이고 넓은 소매·어깨 이음매의 껍질 값; 별도로 지팡이와 모자챙·머리카락 겹침 관찰(A1 기준 밖, 미수정) | [3시점](../work/combat-pose-clip/supplement-flat/mage-blizzard.jpg) |
| mage | battle·skill3-meteor | Spellcast_Raise | 가능: 해당 스킬 해금 뒤 시전 | 6 | 정상(측정 부위) | 팔꿈치·손이 몸통 바깥에 보이고 넓은 소매·어깨 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-mage-skill1-chain-unk.jpg) |
| mage | battle·skill4-arc_reflect | Spellcast_Shoot | 가능: 해당 스킬 해금 뒤 시전 | 9 | 정상(측정 부위) | 팔꿈치·손이 몸통 바깥에 보이고 넓은 소매·어깨 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-mage-attack4-unk.jpg) |
| mage | battle·skill5-chrono_seal | Spellcast_Raise | 가능: 해당 스킬 해금 뒤 시전 | 6 | 정상(측정 부위) | 팔꿈치·손이 몸통 바깥에 보이고 넓은 소매·어깨 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-mage-skill1-chain-unk.jpg) |
| mage | battle·skill6-star_prison | Spellcast_Long | 가능: 해당 스킬 해금 뒤 시전 | 45 | 정상(측정 부위) | 팔꿈치·손이 몸통 바깥에 보이고 넓은 소매·어깨 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/supplement-flat/mage-star_prison.jpg) |
| mage | battle·skill7-absolute_zero | Spellcast_Raise | 가능: 해당 스킬 해금 뒤 시전 | 6 | 정상(측정 부위) | 팔꿈치·손이 몸통 바깥에 보이고 넓은 소매·어깨 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-mage-skill1-chain-unk.jpg) |
| mage | battle·dodge | Dodge_Forward | 가능: 전투 입력 | 16 | 결함(의복·머리카락) | 팔꿈치·손이 몸통 바깥에 보이고 넓은 소매·어깨 이음매의 껍질 값; 별도로 지팡이와 모자챙·머리카락 겹침 관찰(A1 기준 밖, 미수정) | [3시점](../work/combat-pose-clip/before/captures/battle-mage-dodge-unk.jpg) |
| mage | battle·hit | Hit_A | 가능: 무거운 피격 | 57 | 정상(측정 부위) | 팔꿈치·손이 몸통 바깥에 보이고 넓은 소매·어깨 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-mage-hit-unk.jpg) |
| mage | battle·cheer | Cheer | 가능: battle-base 승리(0.2초 페이드) | 294 | 결함(의복·머리카락) | 팔꿈치·손이 몸통 바깥에 보이고 넓은 소매·어깨 이음매의 껍질 값; 별도로 지팡이와 모자챙·머리카락 겹침 관찰(A1 기준 밖, 미수정) | [3시점](../work/combat-pose-clip/before/captures/battle-mage-cheer-unk.jpg) |
| mage | battle·interact | Interact | 불가: 현재 호출 없음(감사기 직접 재생) | 117 | 정상(측정 부위) | 팔꿈치·손이 몸통 바깥에 보이고 넓은 소매·어깨 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-mage-interact-unk.jpg) |
| rogue | hub·hub-walk | Running_A | 가능: 마을 걷기 | 54 | 정상(측정 부위) | 쌍검이 손 앞·몸 양옆에 보이며 다리 사이 빈 공간과 팔 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/hub-rogue-hub-walk-unk.jpg) |
| rogue | hub·hub-Cheer | Cheer | 불가: 마을 호출 없음(전투 승리 Cheer는 별도) | 414 | 정상(측정 부위) | 쌍검이 손 앞·몸 양옆에 보이며 다리 사이 빈 공간과 팔 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/hub-rogue-hub-Cheer-unk.jpg) |
| rogue | hub·hub-Interact | Interact | 불가: 현재 호출 없음(감사기 직접 재생) | 2 | 정상(측정 부위) | 쌍검이 손 앞·몸 양옆에 보이며 다리 사이 빈 공간과 팔 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/hub-rogue-hub-Interact-unk.jpg) |
| rogue | battle·run | Running_A | 가능: 전투 입력 | 48 | 정상(측정 부위) | 쌍검이 손 앞·몸 양옆에 보이며 다리 사이 빈 공간과 팔 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-rogue-run-unk.jpg) |
| rogue | battle·attack1 | Dualwield_Melee_Attack_Slice | 가능: 전투 입력 | 21 | 정상(측정 부위) | 쌍검이 손 앞·몸 양옆에 보이며 다리 사이 빈 공간과 팔 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-rogue-attack1-unk.jpg) |
| rogue | battle·attack2 | Dualwield_Melee_Attack_Chop | 가능: 전투 입력 | 9 | 정상(측정 부위) | 쌍검이 손 앞·몸 양옆에 보이며 다리 사이 빈 공간과 팔 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-rogue-attack2-unk.jpg) |
| rogue | battle·attack3 | Dualwield_Melee_Attack_Slice | 가능: 전투 입력 | 21 | 정상(측정 부위) | 쌍검이 손 앞·몸 양옆에 보이며 다리 사이 빈 공간과 팔 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-rogue-attack1-unk.jpg) |
| rogue | battle·attack4 | Dodge_Forward | 가능: 전투 입력 | 3 | 정상(측정 부위) | 쌍검이 손 앞·몸 양옆에 보이며 다리 사이 빈 공간과 팔 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-rogue-attack4-unk.jpg) |
| rogue | battle·attack5 | Dualwield_Melee_Attack_Chop | 가능: 전투 입력 | 9 | 정상(측정 부위) | 쌍검이 손 앞·몸 양옆에 보이며 다리 사이 빈 공간과 팔 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-rogue-attack2-unk.jpg) |
| rogue | battle·attack6 | Dualwield_Melee_Attack_Stab | 가능: 전투 입력 | 1 | 정상(측정 부위) | 쌍검이 손 앞·몸 양옆에 보이며 다리 사이 빈 공간과 팔 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-rogue-attack6-unk.jpg) |
| rogue | battle·skill0-shadow_dash | Dodge_Forward | 가능: 해당 스킬 해금 뒤 시전 | 26 | 정상(측정 부위) | 쌍검이 손 앞·몸 양옆에 보이며 다리 사이 빈 공간과 팔 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-rogue-skill0-shadow_dash-unk.jpg) |
| rogue | battle·skill1-poison_bomb | Throw | 가능: 해당 스킬 해금 뒤 시전 | 33 | 정상(측정 부위) | 쌍검이 손 앞·몸 양옆에 보이며 다리 사이 빈 공간과 팔 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-rogue-skill1-poison_bomb-unk.jpg) |
| rogue | battle·skill2-flurry | Dualwield_Melee_Attack_Stab | 가능: 해당 스킬 해금 뒤 시전 | 13 | 정상(측정 부위) | 쌍검이 손 앞·몸 양옆에 보이며 다리 사이 빈 공간과 팔 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-rogue-skill2-flurry-unk.jpg) |
| rogue | battle·skill3-thousand | Spellcast_Raise | 가능: 해당 스킬 해금 뒤 시전 | 73 | 정상(측정 부위) | 쌍검이 손 앞·몸 양옆에 보이며 다리 사이 빈 공간과 팔 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-rogue-skill3-thousand-unk.jpg) |
| rogue | battle·skill4-shadow_mark | Dualwield_Melee_Attack_Stab | 가능: 해당 스킬 해금 뒤 시전 | 18 | 정상(측정 부위) | 쌍검이 손 앞·몸 양옆에 보이며 다리 사이 빈 공간과 팔 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-rogue-skill4-shadow_mark-unk.jpg) |
| rogue | battle·skill5-void_step | Dodge_Forward | 가능: 해당 스킬 해금 뒤 시전 | 21 | 정상(측정 부위) | 쌍검이 손 앞·몸 양옆에 보이며 다리 사이 빈 공간과 팔 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-rogue-skill5-void_step-unk.jpg) |
| rogue | battle·skill6-night_parade | Dualwield_Melee_Attack_Slice | 가능: 해당 스킬 해금 뒤 시전 | 46 | 정상(측정 부위) | 쌍검이 손 앞·몸 양옆에 보이며 다리 사이 빈 공간과 팔 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/supplement/rogue-night_parade.jpg) |
| rogue | battle·skill7-eclipse_edge | Dodge_Forward | 가능: 해당 스킬 해금 뒤 시전 | 3 | 정상(측정 부위) | 쌍검이 손 앞·몸 양옆에 보이며 다리 사이 빈 공간과 팔 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-rogue-skill7-eclipse_edge-unk.jpg) |
| rogue | battle·dodge | Dodge_Forward | 가능: 전투 입력 | 13 | 정상(측정 부위) | 쌍검이 손 앞·몸 양옆에 보이며 다리 사이 빈 공간과 팔 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-rogue-dodge-unk.jpg) |
| rogue | battle·cheer | Cheer | 가능: battle-base 승리(0.2초 페이드) | 414 | 정상(측정 부위) | 쌍검이 손 앞·몸 양옆에 보이며 다리 사이 빈 공간과 팔 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/hub-rogue-hub-Cheer-unk.jpg) |
| rogue | battle·interact | Interact | 불가: 현재 호출 없음(감사기 직접 재생) | 2 | 정상(측정 부위) | 쌍검이 손 앞·몸 양옆에 보이며 다리 사이 빈 공간과 팔 이음매의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/hub-rogue-hub-Interact-unk.jpg) |
| ranger | hub·hub-walk | Running_A | 가능: 마을 걷기 | 40 | 정상(측정 부위) | 팔과 활이 몸 바깥에 보이며 어깨·다리 사이의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/hub-ranger-hub-walk-unk.jpg) |
| ranger | hub·hub-Cheer | Cheer | 불가: 마을 호출 없음(전투 승리 Cheer는 별도) | 102 | 정상(측정 부위) | 팔과 활이 몸 바깥에 보이며 어깨·다리 사이의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/hub-ranger-hub-Cheer-unk.jpg) |
| ranger | battle·run | Running_A | 가능: 전투 입력 | 36 | 정상(측정 부위) | 팔과 활이 몸 바깥에 보이며 어깨·다리 사이의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-ranger-run-unk.jpg) |
| ranger | battle·skill4-ranger_quickshot | Bow_Shoot | 가능: 해당 스킬 해금 뒤 시전 | 29 | 정상(측정 부위) | 팔과 활이 몸 바깥에 보이며 어깨·다리 사이의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-ranger-skill4-ranger_quickshot-unk.jpg) |
| ranger | battle·skill6-gale_hunt | Bow_Shoot | 가능: 해당 스킬 해금 뒤 시전 | 29 | 정상(측정 부위) | 팔과 활이 몸 바깥에 보이며 어깨·다리 사이의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-ranger-skill4-ranger_quickshot-unk.jpg) |
| ranger | battle·dodge | Dodge_Forward | 가능: 전투 입력 | 17 | 정상(측정 부위) | 팔과 활이 몸 바깥에 보이며 어깨·다리 사이의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-ranger-dodge-unk.jpg) |
| ranger | battle·hit | Hit_A | 가능: 무거운 피격 | 1 | 정상(측정 부위) | 팔과 활이 몸 바깥에 보이며 어깨·다리 사이의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-ranger-hit-unk.jpg) |
| ranger | battle·cheer | Cheer | 가능: battle-base 승리(0.2초 페이드) | 234 | 정상(측정 부위) | 팔과 활이 몸 바깥에 보이며 어깨·다리 사이의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-ranger-cheer-unk.jpg) |
| ranger | battle·interact | Interact | 불가: 현재 호출 없음(감사기 직접 재생) | 111 | 정상(측정 부위) | 팔과 활이 몸 바깥에 보이며 어깨·다리 사이의 껍질 값 | [3시점](../work/combat-pose-clip/before/captures/battle-ranger-interact-unk.jpg) |

## 최종 추가 분류

최종 소스 `ec93726056c85f23b61f5d7717b5d3723b446fe3`의 자동 판정불가는 97건이다. 기준 80건 외 17건도 대표 3시점으로 육안 확인했다. 합계 측정 부위 정상 89건, 마법사 의복·머리카락 겹침 8건이다. 자동 판정을 정상으로 덮어쓰지 않았다.

| 직업 | 면·동작 | 클립 | 도달성 | 대표 프레임 | 육안 분류 | 관찰 | 캡처 |
|---|---|---|---|---:|---|---|---|
| knight | hub·hub-Interact | Interact | 불가: 현재 호출 없음(감사기 직접 재생) | 192 | 정상(측정 부위) | 검은 몸 바깥, 방패 아래팔 접촉·다리 사이 볼록 껍질의 과대값. 추가 240Hz 회전도 별도 확인 | [3시점](../work/combat-pose-clip/release-mesh/captures/hub-knight-hub-Interact-unk.jpg) |
| knight | battle·attack1 | 1H_Melee_Attack_Slice_Horizontal | 가능: 해당 전투 입력·스킬 해금 뒤 시전 | 0 | 정상(측정 부위) | 검은 몸 바깥, 방패 아래팔 접촉·다리 사이 볼록 껍질의 과대값. 추가 240Hz 회전도 별도 확인 | [3시점](../work/combat-pose-clip/release-mesh/captures/battle-knight-attack1-unk.jpg) |
| knight | battle·attack4 | 2H_Melee_Attack_Spin | 가능: 해당 전투 입력·스킬 해금 뒤 시전 | 26 | 정상(측정 부위) | 검은 몸 바깥, 방패 아래팔 접촉·다리 사이 볼록 껍질의 과대값. 추가 240Hz 회전도 별도 확인 | [3시점](../work/combat-pose-clip/release-mesh/captures/battle-knight-attack4-unk.jpg) |
| knight | battle·attack5 | 1H_Melee_Attack_Slice_Horizontal | 가능: 해당 전투 입력·스킬 해금 뒤 시전 | 0 | 정상(측정 부위) | 검은 몸 바깥, 방패 아래팔 접촉·다리 사이 볼록 껍질의 과대값. 추가 240Hz 회전도 별도 확인 | [3시점](../work/combat-pose-clip/release-mesh/captures/battle-knight-attack1-unk.jpg) |
| knight | battle·skill0-holy_slash | 1H_Melee_Attack_Slice_Horizontal | 가능: 해당 전투 입력·스킬 해금 뒤 시전 | 11 | 정상(측정 부위) | 검은 몸 바깥, 방패 아래팔 접촉·다리 사이 볼록 껍질의 과대값. 추가 240Hz 회전도 별도 확인 | [3시점](../work/combat-pose-clip/release-mesh/captures/battle-knight-skill0-holy_slash-unk.jpg) |
| ranger | hub·hub-Interact | Interact | 불가: 현재 호출 없음(감사기 직접 재생) | 93 | 정상(측정 부위) | 활을 든 왼팔은 유지, 시위를 당기는 오른팔·손은 몸 바깥. 다리와 어깨 껍질 과대값 | [3시점](../work/combat-pose-clip/release-mesh/captures/hub-ranger-hub-Interact-unk.jpg) |
| ranger | battle·attack1 | Bow_Shoot | 가능: 해당 전투 입력·스킬 해금 뒤 시전 | 13 | 정상(측정 부위) | 활을 든 왼팔은 유지, 시위를 당기는 오른팔·손은 몸 바깥. 다리와 어깨 껍질 과대값 | [3시점](../work/combat-pose-clip/release-mesh/captures/battle-ranger-attack1-unk.jpg) |
| ranger | battle·attack2 | Bow_Shoot | 가능: 해당 전투 입력·스킬 해금 뒤 시전 | 24 | 정상(측정 부위) | 활을 든 왼팔은 유지, 시위를 당기는 오른팔·손은 몸 바깥. 다리와 어깨 껍질 과대값 | [3시점](../work/combat-pose-clip/release-mesh/captures/battle-ranger-attack2-unk.jpg) |
| ranger | battle·attack3 | Bow_Shoot | 가능: 해당 전투 입력·스킬 해금 뒤 시전 | 16 | 정상(측정 부위) | 활을 든 왼팔은 유지, 시위를 당기는 오른팔·손은 몸 바깥. 다리와 어깨 껍질 과대값 | [3시점](../work/combat-pose-clip/release-mesh/captures/battle-ranger-attack3-unk.jpg) |
| ranger | battle·attack4 | Bow_Shoot | 가능: 해당 전투 입력·스킬 해금 뒤 시전 | 13 | 정상(측정 부위) | 활을 든 왼팔은 유지, 시위를 당기는 오른팔·손은 몸 바깥. 다리와 어깨 껍질 과대값 | [3시점](../work/combat-pose-clip/release-mesh/captures/battle-ranger-attack1-unk.jpg) |
| ranger | battle·attack5 | Bow_Shoot | 가능: 해당 전투 입력·스킬 해금 뒤 시전 | 13 | 정상(측정 부위) | 활을 든 왼팔은 유지, 시위를 당기는 오른팔·손은 몸 바깥. 다리와 어깨 껍질 과대값 | [3시점](../work/combat-pose-clip/release-mesh/captures/battle-ranger-attack1-unk.jpg) |
| ranger | battle·skill0-ranger_pierce | Bow_Shoot | 가능: 해당 전투 입력·스킬 해금 뒤 시전 | 16 | 정상(측정 부위) | 활을 든 왼팔은 유지, 시위를 당기는 오른팔·손은 몸 바깥. 다리와 어깨 껍질 과대값 | [3시점](../work/combat-pose-clip/release-mesh/captures/battle-ranger-attack3-unk.jpg) |
| ranger | battle·skill1-ranger_volley | Bow_Shoot | 가능: 해당 전투 입력·스킬 해금 뒤 시전 | 13 | 정상(측정 부위) | 활을 든 왼팔은 유지, 시위를 당기는 오른팔·손은 몸 바깥. 다리와 어깨 껍질 과대값 | [3시점](../work/combat-pose-clip/release-mesh/captures/battle-ranger-attack1-unk.jpg) |
| ranger | battle·skill2-ranger_retreat | Bow_Shoot | 가능: 해당 전투 입력·스킬 해금 뒤 시전 | 36 | 정상(측정 부위) | 활을 든 왼팔은 유지, 시위를 당기는 오른팔·손은 몸 바깥. 다리와 어깨 껍질 과대값 | [3시점](../work/combat-pose-clip/release-mesh/captures/battle-ranger-skill2-ranger_retreat-unk.jpg) |
| ranger | battle·skill3-ranger_tempest | Bow_Shoot | 가능: 해당 전투 입력·스킬 해금 뒤 시전 | 16 | 정상(측정 부위) | 활을 든 왼팔은 유지, 시위를 당기는 오른팔·손은 몸 바깥. 다리와 어깨 껍질 과대값 | [3시점](../work/combat-pose-clip/release-mesh/captures/battle-ranger-attack3-unk.jpg) |
| ranger | battle·skill5-ranger_binding | Bow_Shoot | 가능: 해당 전투 입력·스킬 해금 뒤 시전 | 16 | 정상(측정 부위) | 활을 든 왼팔은 유지, 시위를 당기는 오른팔·손은 몸 바깥. 다리와 어깨 껍질 과대값 | [3시점](../work/combat-pose-clip/release-mesh/captures/battle-ranger-attack3-unk.jpg) |
| ranger | battle·skill7-skyfall_arrows | Bow_Shoot | 가능: 해당 전투 입력·스킬 해금 뒤 시전 | 16 | 정상(측정 부위) | 활을 든 왼팔은 유지, 시위를 당기는 오른팔·손은 몸 바깥. 다리와 어깨 껍질 과대값 | [3시점](../work/combat-pose-clip/release-mesh/captures/battle-ranger-attack3-unk.jpg) |
