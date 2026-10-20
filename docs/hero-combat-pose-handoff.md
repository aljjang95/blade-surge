# 현행 인계 — 2026-10-19 클립 교정

현행 제품 소스 `ec93726056c85f23b61f5d7717b5d3723b446fe3`의 원본117개 감사는 결함19→0이다. 기사5→0·야만전사2→0·궁수12→0, 마법사·도적0을 유지했다. 추가240Hz의 회전 동작도 검사했다. 자동 판정불가97건은 대표 캡처 분류89건 정상·마법사 장식 겹침8건 미수정으로 남겼다. 아래94건 인계 및 가산 보정의19건은 과거 시점 기록이다.

[최종 구현·한도·검증·잔여 결함](combat-pose-clip-result.md)과 [분류 표](combat-pose-classification.md)를 먼저 읽는다. A5 정식 호스트 재검사는 지휘 담당에게 인계하며 이 작업에서는 푸시·PR·배포·기기를 사용하지 않았다.

---

# handoff — 전투 자세의 실제 메시 관통 판정과 클립 소유 영역으로 넘기는 결함

- 측정: tools/combat-mesh-qa.mjs (기준 HEAD fa89518, 격리 Chromium 1280x720, app.step 1/60초, 무적·쿨다운0·MP·궁극 게이지 가득·AUTO 끔·각성 레벨 99 고정, 정식 빌드 vite build + 정적 서버). 실기기 아님.
- 이 도구는 영웅 스킨 메시의 월드 정점(SkinnedMesh.getVertexPosition)을 뼈별로 모아 몸통 본체·머리(두개골)·위팔·아래팔·허벅지·정강이마다 볼록 껍질을 만들고, 무기·방패 메시의 정점이 그 안으로 들어간 깊이를 잰다. 이전 도구(tools/combat-pose-qa.mjs)의 머리 구·몸통 원기둥은 참고 열로만 남긴다.
- **판정 기준(측정 전에 고정, 완화 없음)**: 무기(look.js weaponNodes)·보조장비(armorNodes) 정점이 몸·머리 스킨 메시 부위 안쪽으로 3cm 이상 들어간 정점이 하나라도 있으면 결함. 팔(위팔·아래팔 뼈 정점)이 몸통 본체 안쪽으로 3cm 이상이면 결함. 손·손가락 부위는 쥠이라 뺀다.
- **보정 두 가지(측정 도구 쪽 한계 때문에 둔 것, 기준 숫자는 3cm 그대로)**: ① 몸통 본체는 몸통 뼈 정점 중 망토·어깨갑옷·옆 장식·치마를 뺀 것이다(의복 관통은 기준에 넣지 않는다). ② 볼록 껍질은 오목한 곳에서 실제보다 크게 나오므로, 대기 자세(Idle)에서 이미 겹쳐 보인 깊이(껍질 과대·어깨 이음매·손잡이)는 정점별로 빼고, 대기 자세 절대 깊이가 3cm 이상인 쌍은 기준을 3cm+그 깊이로 올려 판정한다. 대기 자세 절대 깊이는 report.json의 idleRaw에 그대로 남겼다.
- 한계: 껍질은 정점 군집의 바깥 포락선이라 실제 표면보다 두껍다(결함 수치는 상한에 가깝다). 모자·후드·머리끈 같은 의상 소품과 무기의 충돌은 이 기준 밖이다(마법사 환호·회피에서 지팡이가 모자챙을 지나는 것이 캡처에 보이며 아래에 별도 관찰로 적는다).

## 결과 요약

총 117개 직업×동작: 정상 8, 오탐 15 (근사 도형이 센 2건 + 껍질 과대 13건을 캡처로 닫음), 결함 94 전부 **인계**(원인: 클립이 만든 자세), 우리 소유 파일에서 고칠 수 있는 결함 0.

- 결함 원인을 클립으로 보는 근거: ① 손잡이-손 거리는 다섯 직업 전 동작이 3.7~5.0cm로 기준(8cm) 안(소켓·부착 오프셋 정상). ② 같은 무기·소켓이 대기 자세(Idle)에서는 무기의 머리·몸통 겹침이 최대 2.6cm(기준 3cm 미만, report.json idleRaw)이고 다리·팔 쪽 큰 값은 껍질 과대로 캡처에서 관통이 없음을 확인했다. ③ 겹침은 클립이 팔을 몸 앞·머리 곁으로 보내는 프레임에서만 생긴다(아래 표의 프레임·부위). 로비 걷기(hub-walk)는 lobby-pose 교정 가중치가 0이라 Running_A 원본이 그대로 나오므로 이것도 클립이다.
- 직업별 결론: 기사·야만전사·도적은 거의 모든 공격·스킬·달리기에서 무기가 머리 두개골과 몸통을 지난다. 마법사는 지팡이가 머리·허벅지를 지나는 동작과 팔이 몸통을 파고드는 동작이 있고, 궁수는 활 당기기(Bow_Shoot) 전 동작에서 오른 아래팔이 몸통 가운데로 들어오고 활·시위가 몸통에 겹친다.

## 직업×동작 판정표

값은 cm(대기 자세 대비 초과 깊이). 무기=몸통/머리/팔/다리, 보조=방패·책 몸통/머리/팔/다리, 팔→몸통=팔 정점이 몸통 본체로 파고든 깊이. 처리: 정상(기준 통과) · 오탐(근사 도형 또는 껍질 과대만 위반, 캡처로 실제 관통 없음 확인) · 인계(진짜 결함, 클립 원인). 캡처는 정면·측면·후면 3시점을 한 장에 담았고 파일은 work/cycles/20261019-combat-mesh-audit/mesh-before/captures/ 아래다.

### 기사 (knight)

| 동작 | 클립 | 무기 몸통/머리/팔/다리 | 보조 | 팔→몸통 | 근사 도형 위반 | 처리 | 캡처 |
|---|---|---|---|---|---|---|---|
| hub-idle | Idle | 0.0/0.0/0.0/0.0 | 0.0/0.0/0.0/0.0 | 0.0 | - | 정상 | hub-knight-hub-idle-ref.jpg |
| hub-walk | Running_A | 0.0/**7.3**/0.0/0.0 | 0.0/0.0/5.7/**8.2** | 0.0 | head | 인계 | hub-knight-hub-walk-defect.jpg |
| hub-Cheer | Cheer | **17.0**/**8.6**/0.0/**13.8** | **5.9**/**18.1**/4.3/**9.4** | 3.1 | head,torso | 인계 | hub-knight-hub-Cheer-defect.jpg |
| hub-Interact | Interact | **3.8**/**15.1**/0.0/**14.5** | **3.0**/0.0/5.0/**10.7** | 6.4 | head | 인계 | hub-knight-hub-Interact-defect.jpg |
| idle | Idle | 0.0/0.0/0.0/0.0 | 0.0/0.0/0.0/0.0 | 0.0 | - | 정상 | battle-knight-idle-ref.jpg |
| run | Running_A | 0.0/**7.2**/0.0/0.0 | 0.0/0.0/5.6/**8.4** | 3.2 | head | 인계 | battle-knight-run-defect.jpg |
| attack1 | 1H_Melee_Attack_Slice_Horizontal | **8.4**/**15.4**/0.0/0.0 | 1.6/0.0/4.2/**8.7** | 0.0 | head | 인계 | battle-knight-attack1-defect.jpg |
| attack2 | 1H_Melee_Attack_Slice_Diagonal | **13.9**/**10.1**/0.7/0.0 | **3.2**/**7.7**/3.5/**3.9** | 0.0 | head,torso | 인계 | battle-knight-attack2-defect.jpg |
| attack3 | 1H_Melee_Attack_Stab | **7.4**/**12.9**/0.0/0.0 | **8.0**/0.0/6.2/**9.4** | 3.2 | head,torso | 인계 | battle-knight-attack3-defect.jpg |
| attack4 | 2H_Melee_Attack_Spin | **18.0**/**7.0**/2.3/10.0 | **6.1**/0.0/3.7/**10.6** | 6.2 | head,torso | 인계 | battle-knight-attack4-defect.jpg |
| attack5 | 1H_Melee_Attack_Slice_Horizontal | **7.5**/**18.5**/**5.1**/0.0 | **4.7**/0.0/3.5/**8.6** | 4.8 | head | 인계 | battle-knight-attack1-defect.jpg |
| attack6 | 1H_Melee_Attack_Chop | **10.5**/**20.1**/0.0/6.2 | 0.0/0.0/3.6/**11.1** | 5.2 | head,torso | 인계 | battle-knight-attack6-defect.jpg |
| skill0-holy_slash | 1H_Melee_Attack_Slice_Horizontal | **8.6**/**17.3**/2.7/0.0 | **3.5**/0.0/3.8/**9.2** | 6.0 | head,torso | 인계 | battle-knight-skill0-holy_slash-defect.jpg |
| skill1-shield_bash | Block_Hit | 0.0/0.0/0.0/0.0 | 0.0/0.0/3.1/0.0 | 0.0 | - | 오탐 | battle-knight-skill1-shield_bash-unk.jpg |
| skill2-judgment | Spellcast_Raise | **4.5**/**19.7**/0.0/0.5 | **15.5**/**17.2**/**8.7**/2.7 | 0.0 | head,torso | 인계 | battle-knight-skill2-judgment-defect.jpg |
| skill3-dragon_slash | 2H_Melee_Attack_Chop | **12.3**/**20.6**/0.5/10.2 | 0.0/0.0/4.5/**11.4** | 5.8 | head,torso | 인계 | battle-knight-skill3-dragon_slash-defect.jpg |
| skill4-chain_bind | Spellcast_Raise | **3.5**/**18.9**/0.0/0.0 | **16.5**/**11.9**/**8.7**/2.8 | 0.0 | head,torso | 인계 | battle-knight-skill2-judgment-defect.jpg |
| skill5-sanctuary | Spellcast_Raise | **3.8**/**19.7**/0.0/0.5 | **15.5**/**17.2**/**8.7**/2.7 | 0.0 | head,torso | 인계 | battle-knight-skill2-judgment-defect.jpg |
| skill6-sunbreaker | 2H_Melee_Attack_Chop | **11.9**/**20.8**/0.6/10.6 | 0.0/0.0/4.4/**11.5** | 5.7 | head,torso | 인계 | battle-knight-skill3-dragon_slash-defect.jpg |
| skill7-heavenfall | Spellcast_Raise | **3.8**/**19.7**/0.0/0.5 | **15.5**/**17.2**/**8.7**/2.7 | 0.0 | head,torso | 인계 | battle-knight-skill2-judgment-defect.jpg |
| dodge | Dodge_Forward | **8.3**/0.0/0.0/9.4 | **5.5**/0.0/6.9/0.0 | 0.0 | torso | 인계 | battle-knight-dodge-defect.jpg |
| hit | Hit_A | 0.8/**8.4**/0.0/0.0 | 0.0/1.8/3.4/0.0 | 0.0 | head | 인계 | battle-knight-hit-defect.jpg |
| cheer | Cheer | **16.9**/**8.6**/0.0/**13.8** | **5.9**/**18.1**/4.0/**9.4** | 0.0 | head,torso | 인계 | hub-knight-hub-Cheer-defect.jpg |
| interact | Interact | **3.4**/**15.1**/0.0/**12.5** | **3.0**/0.0/5.0/**10.7** | 6.2 | head | 인계 | hub-knight-hub-Interact-defect.jpg |

### 야만전사 (barbarian)

| 동작 | 클립 | 무기 몸통/머리/팔/다리 | 보조 | 팔→몸통 | 근사 도형 위반 | 처리 | 캡처 |
|---|---|---|---|---|---|---|---|
| hub-idle | Idle | 0.0/0.0/0.8/0.0 | - | 0.0 | - | 정상 | hub-barbarian-hub-idle-ref.jpg |
| hub-walk | Running_A | 0.0/**8.9**/0.0/0.0 | - | 0.0 | head | 인계 | hub-barbarian-hub-walk-defect.jpg |
| hub-Cheer | Cheer | **14.3**/**26.3**/**4.4**/11.5 | - | 0.0 | head,torso | 인계 | hub-barbarian-hub-Cheer-defect.jpg |
| hub-Interact | Interact | 0.0/**25.1**/0.0/14.3 | - | 0.0 | head | 인계 | hub-barbarian-hub-Interact-defect.jpg |
| idle | Idle | 0.0/0.0/0.0/0.0 | - | 0.0 | head | 오탐 | battle-barbarian-idle-fp.jpg |
| run | Running_A | 0.0/**8.8**/0.0/0.0 | - | 0.0 | head | 인계 | battle-barbarian-run-defect.jpg |
| attack1 | 2H_Melee_Attack_Slice | **9.6**/**22.1**/**9.0**/2.8 | - | 0.0 | head,torso | 인계 | battle-barbarian-attack1-defect.jpg |
| attack2 | 2H_Melee_Attack_Stab | 1.6/**19.0**/**7.8**/**9.7** | - | 0.0 | head,torso | 인계 | battle-barbarian-attack2-defect.jpg |
| attack3 | 2H_Melee_Attack_Spinning | **14.8**/**21.6**/**7.6**/6.3 | - | 10.8 | head,torso | 인계 | battle-barbarian-attack3-defect.jpg |
| attack4 | 2H_Melee_Attack_Chop | 0.0/**25.9**/**7.9**/**13.3** | - | 3.1 | head | 인계 | battle-barbarian-attack4-defect.jpg |
| attack5 | Jump_Full_Short | 0.0/**23.2**/0.0/5.4 | - | 0.0 | head | 인계 | battle-barbarian-attack5-defect.jpg |
| skill0-whirlwind | 2H_Melee_Attack_Spin | **6.4**/**22.8**/**7.0**/6.4 | - | 10.8 | head,torso | 인계 | battle-barbarian-skill0-whirlwind-defect.jpg |
| skill1-quake | 2H_Melee_Attack_Chop | 0.0/**25.4**/**8.9**/**11.2** | - | 3.1 | head | 인계 | battle-barbarian-skill1-quake-defect.jpg |
| skill2-berserk | Cheer | **14.0**/**23.8**/1.6/7.2 | - | 0.0 | head,torso | 인계 | hub-barbarian-hub-Cheer-defect.jpg |
| skill3-hell_axe | Jump_Full_Short | 0.0/**23.1**/0.0/5.4 | - | 0.0 | head | 인계 | battle-barbarian-skill3-hell_axe-defect.jpg |
| skill4-bull_rush | 2H_Melee_Attack_Stab | **8.3**/**18.6**/**7.8**/**11.9** | - | 0.0 | head,torso | 인계 | battle-barbarian-skill4-bull_rush-defect.jpg |
| skill5-magma_zone | 2H_Melee_Attack_Chop | 0.0/**25.8**/**5.9**/**13.4** | - | 0.0 | head | 인계 | battle-barbarian-skill5-magma_zone-defect.jpg |
| skill6-bloodquake | 2H_Melee_Attack_Chop | 0.0/**25.4**/**8.9**/**11.2** | - | 3.1 | head | 인계 | battle-barbarian-skill1-quake-defect.jpg |
| skill7-cataclysm | Jump_Full_Short | 0.0/**22.9**/0.0/5.2 | - | 0.0 | head | 인계 | battle-barbarian-skill3-hell_axe-defect.jpg |
| dodge | Dodge_Forward | 0.0/0.0/0.0/6.8 | - | 0.0 | - | 오탐 | battle-barbarian-dodge-unk.jpg |
| hit | Hit_A | 0.0/0.5/0.0/4.8 | - | 0.0 | head | 오탐 | battle-barbarian-hit-unk.jpg |
| cheer | Cheer | **14.0**/**25.5**/**4.4**/8.0 | - | 0.0 | head,torso | 인계 | hub-barbarian-hub-Cheer-defect.jpg |
| interact | Interact | 0.0/**25.1**/0.0/**11.3** | - | 0.0 | head | 인계 | hub-barbarian-hub-Interact-defect.jpg |

### 마법사 (mage)

| 동작 | 클립 | 무기 몸통/머리/팔/다리 | 보조 | 팔→몸통 | 근사 도형 위반 | 처리 | 캡처 |
|---|---|---|---|---|---|---|---|
| hub-idle | Idle | 0.0/0.0/0.0/0.0 | - | 0.0 (원값 15.6) | - | 정상 | hub-mage-hub-idle-ref.jpg |
| hub-walk | Running_A | 0.0/0.0/0.0/0.5 | - | 0.0 (원값 17.7) | - | 오탐 | hub-mage-hub-walk-unk.jpg |
| hub-Cheer | Cheer | 0.0/0.8/2.7/0.0 | - | 0.0 (원값 17.9) | head | 오탐 | hub-mage-hub-Cheer-unk.jpg |
| hub-Interact | Interact | 0.0/0.0/0.0/**7.7** | - | 19.8 | - | 인계 | hub-mage-hub-Interact-defect.jpg |
| idle | Idle | 0.0/0.0/0.0/0.0 | - | 0.0 (원값 16.7) | head | 오탐 | battle-mage-idle-fp.jpg |
| run | Running_A | 0.0/0.0/0.0/1.2 | - | 0.0 (원값 11.9) | - | 오탐 | battle-mage-run-unk.jpg |
| attack1 | Spellcast_Shoot | 0.0/**4.2**/**3.9**/**9.2** | - | 0.0 (원값 12.5) | head | 인계 | battle-mage-attack1-defect.jpg |
| attack2 | Spellcast_Shoot | 0.0/**4.2**/**3.9**/**9.2** | - | 0.0 (원값 12.5) | head | 인계 | battle-mage-attack1-defect.jpg |
| attack3 | Spellcast_Long | 0.0/0.0/0.0/0.0 | - | 0.0 (원값 15.7) | head | 오탐 | battle-mage-attack3-unk.jpg |
| attack4 | Spellcast_Shoot | 0.0/**4.2**/**3.9**/**7.3** | - | 0.0 (원값 12.5) | head | 인계 | battle-mage-attack4-defect.jpg |
| attack5 | Spellcast_Raise | 0.0/**5.0**/0.7/**14.8** | - | 0.0 (원값 11.4) | head | 인계 | battle-mage-attack5-defect.jpg |
| skill0-fireball | Spellcast_Shoot | 0.0/**4.2**/**3.6**/**17.8** | - | 0.0 (원값 12.6) | head | 인계 | battle-mage-skill0-fireball-defect.jpg |
| skill1-chain | Spellcast_Raise | 0.0/**10.1**/0.7/2.6 | - | 0.0 (원값 11.8) | head | 인계 | battle-mage-skill1-chain-defect.jpg |
| skill2-blizzard | Spellcast_Long | 0.0/0.0/0.0/**7.2** | - | 0.0 (원값 13.1) | head | 인계 | battle-mage-skill2-blizzard-defect.jpg |
| skill3-meteor | Spellcast_Raise | 0.0/**8.3**/0.7/**9.4** | - | 0.0 (원값 12.1) | head | 인계 | battle-mage-skill3-meteor-defect.jpg |
| skill4-arc_reflect | Spellcast_Shoot | 0.0/**4.2**/**4.0**/**18.2** | - | 0.0 (원값 12.5) | head | 인계 | - |
| skill5-chrono_seal | Spellcast_Raise | 0.0/**10.1**/0.7/**6.4** | - | 0.0 (원값 12.1) | head | 인계 | battle-mage-skill1-chain-defect.jpg |
| skill6-star_prison | Spellcast_Long | 0.0/0.0/0.0/0.0 | - | 0.0 (원값 15.7) | head | 오탐 | battle-mage-skill6-star_prison-unk.jpg |
| skill7-absolute_zero | Spellcast_Raise | 0.0/**10.1**/0.7/**6.4** | - | 0.0 (원값 11.8) | head | 인계 | battle-mage-skill1-chain-defect.jpg |
| dodge | Dodge_Forward | 0.0/0.0/0.0/0.0 | - | 0.0 (원값 15.9) | - | 오탐 | battle-mage-dodge-unk.jpg |
| hit | Hit_A | 0.0/1.1/0.0/0.0 | - | 0.0 (원값 10.1) | head | 오탐 | battle-mage-hit-unk.jpg |
| cheer | Cheer | 0.0/0.8/2.7/0.0 | - | 0.0 (원값 9.9) | head | 오탐 | battle-mage-cheer-unk.jpg |
| interact | Interact | 0.0/0.0/0.0/**7.7** | - | 0.0 (원값 16.6) | - | 인계 | battle-mage-interact-defect.jpg |

### 도적 (rogue)

| 동작 | 클립 | 무기 몸통/머리/팔/다리 | 보조 | 팔→몸통 | 근사 도형 위반 | 처리 | 캡처 |
|---|---|---|---|---|---|---|---|
| hub-idle | Idle | 0.0/0.0/0.0/0.6 | - | 0.0 | - | 정상 | hub-rogue-hub-idle-ref.jpg |
| hub-walk | Running_A | **5.0**/**26.4**/0.0/16.0 | - | 0.0 (원값 4.9) | head,torso | 인계 | hub-rogue-hub-walk-defect.jpg |
| hub-Cheer | Cheer | 2.6/**24.2**/**7.6**/5.7 | - | 0.0 (원값 4.2) | head | 인계 | hub-rogue-hub-Cheer-defect.jpg |
| hub-Interact | Interact | **8.1**/**23.6**/0.0/6.7 | - | 0.0 (원값 5.7) | head,torso | 인계 | hub-rogue-hub-Interact-defect.jpg |
| idle | Idle | 0.0/0.0/0.0/0.0 | - | 0.0 | - | 정상 | battle-rogue-idle-ref.jpg |
| run | Running_A | **5.0**/**27.5**/0.0/15.6 | - | 0.0 (원값 5.9) | head,torso | 인계 | battle-rogue-run-defect.jpg |
| attack1 | Dualwield_Melee_Attack_Slice | **6.9**/**23.9**/1.1/2.5 | - | 6.5 | head,torso | 인계 | battle-rogue-attack1-defect.jpg |
| attack2 | Dualwield_Melee_Attack_Chop | **5.4**/**21.4**/**4.0**/13.0 | - | 0.0 (원값 5.4) | head,torso | 인계 | battle-rogue-attack2-defect.jpg |
| attack3 | Dualwield_Melee_Attack_Slice | **6.9**/**23.9**/1.1/2.5 | - | 6.5 | head,torso | 인계 | battle-rogue-attack1-defect.jpg |
| attack4 | Dodge_Forward | **9.8**/**21.0**/**4.9**/14.6 | - | 0.0 (원값 3.3) | head,torso | 인계 | battle-rogue-attack4-defect.jpg |
| attack5 | Dualwield_Melee_Attack_Chop | **5.4**/**21.4**/**4.0**/13.0 | - | 0.0 (원값 5.4) | head,torso | 인계 | battle-rogue-attack2-defect.jpg |
| attack6 | Dualwield_Melee_Attack_Stab | **4.6**/**20.9**/**4.6**/3.8 | - | 0.0 (원값 6.2) | head | 인계 | battle-rogue-attack6-defect.jpg |
| skill0-shadow_dash | Dodge_Forward | **9.9**/**21.9**/**5.0**/13.1 | - | 0.0 (원값 3.3) | head,torso | 인계 | battle-rogue-skill0-shadow_dash-defect.jpg |
| skill1-poison_bomb | Throw | 2.2/**21.0**/**4.1**/14.9 | - | 0.0 (원값 7.0) | head | 인계 | battle-rogue-skill1-poison_bomb-defect.jpg |
| skill2-flurry | Dualwield_Melee_Attack_Stab | **7.4**/**25.7**/**4.6**/13.7 | - | 6.5 | head,torso | 인계 | battle-rogue-skill2-flurry-defect.jpg |
| skill3-thousand | Spellcast_Raise | **4.9**/**18.7**/**3.5**/15.5 | - | 0.0 (원값 4.9) | head,torso | 인계 | battle-rogue-skill3-thousand-defect.jpg |
| skill4-shadow_mark | Dualwield_Melee_Attack_Stab | **4.6**/**21.5**/**4.6**/13.5 | - | 0.0 (원값 6.3) | head | 인계 | battle-rogue-skill4-shadow_mark-defect.jpg |
| skill5-void_step | Dodge_Forward | **9.9**/**22.2**/**5.5**/12.3 | - | 0.0 | head,torso | 인계 | battle-rogue-skill5-void_step-defect.jpg |
| skill6-night_parade | Dualwield_Melee_Attack_Slice | **9.0**/**25.7**/2.2/11.5 | - | 6.5 | head,torso | 인계 | battle-rogue-skill6-night_parade-defect.jpg |
| skill7-eclipse_edge | Dodge_Forward | **10.1**/**22.3**/**5.4**/16.3 | - | 0.0 (원값 3.7) | head,torso | 인계 | battle-rogue-skill5-void_step-defect.jpg |
| dodge | Dodge_Forward | 0.0/0.0/0.0/4.4 | - | 0.0 | - | 오탐 | battle-rogue-dodge-unk.jpg |
| hit | Hit_A | **5.3**/**21.7**/2.4/5.3 | - | 0.0 | head | 인계 | battle-rogue-hit-defect.jpg |
| cheer | Cheer | 2.6/**24.2**/**7.6**/6.2 | - | 0.0 | head | 인계 | hub-rogue-hub-Cheer-defect.jpg |
| interact | Interact | **8.1**/**23.6**/0.0/6.9 | - | 0.0 (원값 5.6) | head,torso | 인계 | hub-rogue-hub-Interact-defect.jpg |

### 궁수 (ranger)

| 동작 | 클립 | 무기 몸통/머리/팔/다리 | 보조 | 팔→몸통 | 근사 도형 위반 | 처리 | 캡처 |
|---|---|---|---|---|---|---|---|
| hub-idle | Idle | 0.0/0.0/0.0/0.0 | - | 0.0 (원값 5.9) | - | 정상 | hub-ranger-hub-idle-ref.jpg |
| hub-walk | Running_A | 0.0/0.0/**3.8**/5.6 | - | 0.0 (원값 10.2) | - | 인계 | hub-ranger-hub-walk-defect.jpg |
| hub-Cheer | Cheer | 0.0/0.0/**5.7**/8.8 | - | 0.0 (원값 10.5) | - | 인계 | hub-ranger-hub-Cheer-defect.jpg |
| hub-Interact | Interact | 0.0/0.0/**5.8**/3.8 | - | 0.0 (원값 11.0) | - | 인계 | hub-ranger-hub-Interact-defect.jpg |
| idle | Idle | 0.0/0.0/0.0/0.0 | - | 0.0 (원값 5.9) | - | 정상 | battle-ranger-idle-ref.jpg |
| run | Running_A | 0.0/0.0/3.6/6.3 | - | 11.1 | - | 인계 | battle-ranger-run-defect.jpg |
| attack1 | Bow_Shoot | **7.3**/0.0/0.0/0.0 | - | 14.7 | head,torso,arm | 인계 | battle-ranger-attack1-defect.jpg |
| attack2 | Bow_Shoot | **7.7**/0.0/0.0/0.0 | - | 14.8 | head,torso,arm | 인계 | battle-ranger-attack2-defect.jpg |
| attack3 | Bow_Shoot | **7.3**/0.0/0.0/0.0 | - | 14.8 | torso,arm | 인계 | battle-ranger-attack3-defect.jpg |
| attack4 | Bow_Shoot | **7.4**/0.0/0.0/0.0 | - | 14.9 | head,torso,arm | 인계 | battle-ranger-attack3-defect.jpg |
| attack5 | Bow_Shoot | **7.3**/0.0/0.0/0.0 | - | 14.8 | head,torso,arm | 인계 | battle-ranger-attack3-defect.jpg |
| skill0-ranger_pierce | Bow_Shoot | **9.9**/0.0/0.0/0.0 | - | 14.5 | torso,arm | 인계 | battle-ranger-skill0-ranger_pierce-defect.jpg |
| skill1-ranger_volley | Bow_Shoot | **9.4**/0.0/0.0/0.0 | - | 14.8 | torso,arm | 인계 | battle-ranger-skill1-ranger_volley-defect.jpg |
| skill2-ranger_retreat | Bow_Shoot | **9.0**/0.0/0.0/0.0 | - | 14.7 | torso,arm | 인계 | battle-ranger-attack2-defect.jpg |
| skill3-ranger_tempest | Bow_Shoot | **8.1**/0.0/0.0/0.0 | - | 14.8 | arm | 인계 | battle-ranger-skill1-ranger_volley-defect.jpg |
| skill4-ranger_quickshot | Bow_Shoot | **9.5**/0.0/0.0/0.0 | - | 14.7 | head,torso,arm | 인계 | battle-ranger-attack2-defect.jpg |
| skill5-ranger_binding | Bow_Shoot | **9.6**/0.0/0.0/0.0 | - | 14.7 | torso,arm | 인계 | battle-ranger-attack2-defect.jpg |
| skill6-gale_hunt | Bow_Shoot | **8.1**/0.0/0.0/0.0 | - | 14.7 | torso,arm | 인계 | battle-ranger-attack2-defect.jpg |
| skill7-skyfall_arrows | Bow_Shoot | **9.0**/0.0/0.0/0.0 | - | 14.6 | torso,arm | 인계 | battle-ranger-skill7-skyfall_arrows-defect.jpg |
| dodge | Dodge_Forward | 0.0/0.0/0.0/**9.0** | - | 0.0 (원값 3.2) | - | 인계 | battle-ranger-dodge-defect.jpg |
| hit | Hit_A | 0.0/0.0/6.4/6.5 | - | 0.0 (원값 3.4) | - | 오탐 | battle-ranger-hit-unk.jpg |
| cheer | Cheer | 0.0/0.0/4.6/**9.7** | - | 10.5 | - | 인계 | battle-ranger-cheer-defect.jpg |
| interact | Interact | 0.0/0.0/2.4/0.8 | - | 12.1 | - | 인계 | battle-ranger-interact-defect.jpg |

## 직업별 인계 항목(원인 파일: src/engine/hero-body-motion.js, src/data/higher-body-*.json, 영웅 GLB의 클립 — 수정 금지 영역)

아래 각도는 접촉점을 클립 쪽에서 몸 밖으로 D=깊이+3cm 옮기려면 어깨 기준으로 얼마나 돌려야 하는지의 추정이다(상박 외전 θ=atan(D/R), R=어깨~접촉점 거리를 측정한 위치로 계산). 실제 보정량은 클립 담당이 같은 도구(tools/combat-mesh-qa.mjs)로 재서 정한다. 좌표는 몸통 기준 cm(위·오른쪽·앞).

### 기사 — 손 뼈 RightHand(검)·LeftHand(방패)

| 클립(동작) | 최악 프레임 | 항목·부위 | 접촉점(위·좌우·앞 cm) | 깊이 | 보정 제안 |
|---|---|---|---|---|---|
| 2H_Melee_Attack_Chop (skill6-sunbreaker) | 프레임 13 (재생 26%) | 무기 머리 (head) | 83.7 / -0.2 / -6.3 | 20.8 | 접촉점을 23.8cm 밖으로 → mixamorigRightArm 외전 약 31.6° (R≈38.6cm) |
| 1H_Melee_Attack_Chop (attack6) | 프레임 15 (재생 37%) | 무기 머리 (head) | 78.9 / 0.0 / -6.0 | 20.1 | 접촉점을 23.1cm 밖으로 → mixamorigRightArm 외전 약 33.8° (R≈34.5cm) |
| Spellcast_Raise (skill2-judgment) | 프레임 3 (재생 7%) | 무기 머리 (head) | 82.7 / 6.5 / -1.3 | 19.7 | 접촉점을 22.7cm 밖으로 → mixamorigRightArm 외전 약 33.1° (R≈34.8cm) |
| 1H_Melee_Attack_Slice_Horizontal (attack5) | 프레임 10 (재생 37%) | 무기 머리 | (캡처 표본이 아님) | 18.5 | 접촉점을 21.5cm 밖으로 → mixamorigRightArm 외전 약 31.7° (R=같은 직업 다른 동작 중앙값 34.8cm로 추정) |
| Cheer (hub-Cheer) | 프레임 135 (재생 27%) | 보조 머리 (head) | 84.5 / -6.9 / 4.7 | 18.1 | 접촉점을 21.1cm 밖으로 → mixamorigLeftArm 외전 약 29.9° (R≈36.7cm) |
| 2H_Melee_Attack_Spin (attack4) | 프레임 8 (재생 21%) | 무기 몸통 (torso) | 31.3 / -3.5 / 1.1 | 18.0 | 접촉점을 21.0cm 밖으로 → mixamorigRightArm 외전 약 42.2° (R≈23.1cm) |
| Spellcast_Raise (skill2-judgment) | 프레임 15 (재생 27%) | 보조 머리 | (캡처 표본이 아님) | 17.2 | 접촉점을 20.2cm 밖으로 → mixamorigLeftArm 외전 약 30.1° (R=같은 직업 다른 동작 중앙값 34.8cm로 추정) |
| Cheer (hub-Cheer) | 프레임 339 (재생 67%) | 무기 몸통 | (캡처 표본이 아님) | 17.0 | 접촉점을 20.0cm 밖으로 → mixamorigRightArm 외전 약 29.9° (R=같은 직업 다른 동작 중앙값 34.8cm로 추정) |

### 야만전사 — 손 뼈 RightHand(도끼)

| 클립(동작) | 최악 프레임 | 항목·부위 | 접촉점(위·좌우·앞 cm) | 깊이 | 보정 제안 |
|---|---|---|---|---|---|
| Cheer (hub-Cheer) | 프레임 73 (재생 14%) | 무기 머리 (head) | 68.6 / -0.4 / 6.8 | 26.3 | 접촉점을 29.3cm 밖으로 → mixamorigRightArm 외전 약 38.5° (R≈36.8cm) |
| 2H_Melee_Attack_Chop (attack4) | 프레임 10 (재생 26%) | 무기 머리 (head) | 69.6 / -10.9 / 0.7 | 25.9 | 접촉점을 28.9cm 밖으로 → mixamorigRightArm 외전 약 40.6° (R≈33.7cm) |
| Interact (hub-Interact) | 프레임 108 (재생 52%) | 무기 머리 (head) | 72.8 / 5.8 / 2.8 | 25.1 | 접촉점을 28.1cm 밖으로 → mixamorigRightArm 외전 약 36.4° (R≈38.1cm) |
| Jump_Full_Short (attack5) | 프레임 46 (재생 87%) | 무기 머리 (head) | 72.8 / -10.8 / 8.4 | 23.2 | 접촉점을 26.2cm 밖으로 → mixamorigRightArm 외전 약 34.7° (R≈37.8cm) |
| 2H_Melee_Attack_Spin (skill0-whirlwind) | 프레임 1 (재생 2%) | 무기 머리 (head) | 76.1 / -4.2 / 9.4 | 22.8 | 접촉점을 25.8cm 밖으로 → mixamorigRightArm 외전 약 31.1° (R≈42.7cm) |
| 2H_Melee_Attack_Slice (attack1) | 프레임 13 (재생 39%) | 무기 머리 (head) | 63.4 / 3.2 / 11.5 | 22.1 | 접촉점을 25.1cm 밖으로 → mixamorigRightArm 외전 약 37.8° (R≈32.4cm) |
| 2H_Melee_Attack_Spinning (attack3) | 프레임 4 (재생 10%) | 무기 머리 (head) | 65.6 / -15.3 / 2.3 | 21.6 | 접촉점을 24.6cm 밖으로 → mixamorigRightArm 외전 약 40.0° (R≈29.3cm) |
| 2H_Melee_Attack_Stab (attack2) | 프레임 25 (재생 79%) | 무기 머리 (head) | 75.1 / -9.1 / 13.9 | 19.0 | 접촉점을 22.0cm 밖으로 → mixamorigRightArm 외전 약 27.7° (R≈41.8cm) |

### 마법사 — 손 뼈 RightHand(지팡이)

| 클립(동작) | 최악 프레임 | 항목·부위 | 접촉점(위·좌우·앞 cm) | 깊이 | 보정 제안 |
|---|---|---|---|---|---|
| Interact (hub-Interact) | 프레임 0 (재생 0%) | 팔→몸통 (rightarm) | 23.7 / -2.3 / -0.3 | 19.8 | 접촉점을 22.8cm 밖으로 → mixamorigRightArm과 아래팔(ForeArm)을 몸통 바깥으로 외전·폄 약 52.0° (R≈17.8cm) |
| Spellcast_Long (skill2-blizzard) | 프레임 12 (재생 22%) | 팔→몸통 | (캡처 표본이 아님) | 13.1 | 접촉점을 16.1cm 밖으로 → mixamorigRightArm과 아래팔(ForeArm)을 몸통 바깥으로 외전·폄 약 28.2° (R=같은 직업 다른 동작 중앙값 30.0cm로 추정) |
| Spellcast_Raise (skill3-meteor) | 프레임 31 (재생 13%) | 팔→몸통 | (캡처 표본이 아님) | 11.5 | 접촉점을 14.5cm 밖으로 → mixamorigRightArm과 아래팔(ForeArm)을 몸통 바깥으로 외전·폄 약 25.8° (R=같은 직업 다른 동작 중앙값 30.0cm로 추정) |
| Spellcast_Shoot (skill4-arc_reflect) | 프레임 11 (재생 32%) | 팔→몸통 | (캡처 표본이 아님) | 10.5 | 접촉점을 13.5cm 밖으로 → mixamorigRightArm과 아래팔(ForeArm)을 몸통 바깥으로 외전·폄 약 24.2° (R=같은 직업 다른 동작 중앙값 30.0cm로 추정) |
| Spellcast_Raise (skill1-chain) | 프레임 17 (재생 33%) | 무기 머리 (head) | 53.3 / -24.0 / 22.9 | 10.1 | 접촉점을 13.1cm 밖으로 → mixamorigRightArm 외전 약 23.6° (R≈30.0cm) |
| Spellcast_Shoot (attack1) | 프레임 8 (재생 33%) | 무기 머리 | (캡처 표본이 아님) | 4.2 | 접촉점을 7.2cm 밖으로 → mixamorigRightArm 외전 약 13.5° (R=같은 직업 다른 동작 중앙값 30.0cm로 추정) |

### 도적 — 손 뼈 RightHand·LeftHand(단검 2자루)

| 클립(동작) | 최악 프레임 | 항목·부위 | 접촉점(위·좌우·앞 cm) | 깊이 | 보정 제안 |
|---|---|---|---|---|---|
| Running_A (run) | 프레임 36 (재생 33%) | 무기 머리 (head) | 63.7 / -4.1 / -5.5 | 27.5 | 접촉점을 30.5cm 밖으로 → mixamorigRightArm·mixamorigLeftArm 외전 약 48.4° (R≈27.1cm) |
| Dualwield_Melee_Attack_Slice (skill6-night_parade) | 프레임 10 (재생 14%) | 무기 머리 | (캡처 표본이 아님) | 25.7 | 접촉점을 28.7cm 밖으로 → mixamorigRightArm·mixamorigLeftArm 외전 약 43.2° (R=같은 직업 다른 동작 중앙값 30.6cm로 추정) |
| Dualwield_Melee_Attack_Stab (skill2-flurry) | 프레임 9 (재생 12%) | 무기 머리 (head) | 63.1 / -3.7 / -5.5 | 25.7 | 접촉점을 28.7cm 밖으로 → mixamorigRightArm·mixamorigLeftArm 외전 약 47.2° (R≈26.6cm) |
| Cheer (hub-Cheer) | 프레임 82 (재생 16%) | 무기 머리 (head) | 68.0 / -2.6 / 1.3 | 24.2 | 접촉점을 27.2cm 밖으로 → mixamorigRightArm·mixamorigLeftArm 외전 약 41.2° (R≈31.0cm) |
| Interact (hub-Interact) | 프레임 183 (재생 89%) | 무기 머리 (head) | 67.6 / -5.7 / 1.4 | 23.6 | 접촉점을 26.6cm 밖으로 → mixamorigRightArm·mixamorigLeftArm 외전 약 41.4° (R≈30.1cm) |
| Dodge_Forward (skill7-eclipse_edge) | 프레임 37 (재생 63%) | 무기 머리 | (캡처 표본이 아님) | 22.3 | 접촉점을 25.3cm 밖으로 → mixamorigRightArm·mixamorigLeftArm 외전 약 39.6° (R=같은 직업 다른 동작 중앙값 30.6cm로 추정) |
| Hit_A (hit) | 프레임 18 (재생 60%) | 무기 머리 (head) | 68.0 / -6.4 / -2.8 | 21.7 | 접촉점을 24.7cm 밖으로 → mixamorigRightArm·mixamorigLeftArm 외전 약 38.9° (R≈30.6cm) |
| Dualwield_Melee_Attack_Chop (attack2) | 프레임 16 (재생 75%) | 무기 머리 (head) | 71.6 / -4.3 / 3.7 | 21.4 | 접촉점을 24.4cm 밖으로 → mixamorigRightArm·mixamorigLeftArm 외전 약 35.3° (R≈34.5cm) |

### 궁수 — 손 뼈 LeftHand(활)·RightHand(시위 당김)

| 클립(동작) | 최악 프레임 | 항목·부위 | 접촉점(위·좌우·앞 cm) | 깊이 | 보정 제안 |
|---|---|---|---|---|---|
| Bow_Shoot (attack4) | 프레임 6 (재생 19%) | 팔→몸통 (rightarm) | 19.9 / 0.2 / 2.1 | 14.9 | 접촉점을 17.9cm 밖으로 → mixamorigRightArm과 아래팔(ForeArm)을 몸통 바깥으로 외전·폄 약 41.8° (R≈20.0cm) |
| Interact (interact) | 프레임 93 (재생 45%) | 팔→몸통 (rightarm) | 15.3 / 1.1 / 2.4 | 12.1 | 접촉점을 15.1cm 밖으로 → mixamorigRightArm과 아래팔(ForeArm)을 몸통 바깥으로 외전·폄 약 33.1° (R≈23.2cm) |
| Running_A (run) | 프레임 68 (재생 50%) | 팔→몸통 | (캡처 표본이 아님) | 11.1 | 접촉점을 14.1cm 밖으로 → mixamorigLeftArm·mixamorigRightArm과 아래팔(ForeArm)을 몸통 바깥으로 외전·폄 약 31.3° (R=같은 직업 다른 동작 중앙값 23.2cm로 추정) |
| Cheer (hub-Cheer) | 프레임 102 (재생 20%) | 팔→몸통 | (캡처 표본이 아님) | 10.5 | 접촉점을 13.5cm 밖으로 → mixamorigLeftArm·mixamorigRightArm과 아래팔(ForeArm)을 몸통 바깥으로 외전·폄 약 30.2° (R=같은 직업 다른 동작 중앙값 23.2cm로 추정) |
| Bow_Shoot (skill0-ranger_pierce) | 프레임 11 (재생 44%) | 무기 몸통 | (캡처 표본이 아님) | 9.9 | 접촉점을 12.9cm 밖으로 → mixamorigLeftArm·mixamorigRightArm 외전 약 29.1° (R=같은 직업 다른 동작 중앙값 23.2cm로 추정) |

## 관찰(기준 밖)

- 마법사 환호(Cheer)·회피(Dodge)에서 지팡이가 모자챙을 지난다(캡처 battle-mage-cheer-unk.jpg, battle-mage-dodge-unk.jpg). 모자·후드는 머리 두개골 기준에 넣지 않았다.
- 환호(Cheer)·상호작용(Interact)은 현재 로비 쇼케이스에서 재생하는 코드가 없다(합성 측정). 전투 승리 연출(Cheer)은 전투 인스턴스 cheer 행이 해당한다.
- 껍질 과대로 기준을 올려 판정한 쌍(대기 자세 절대 깊이 3cm 이상)은 report.json의 idleRaw: 기사 방패→팔 4.7cm·무기→다리 8.3cm, 야만전사 도끼→다리 13.3cm, 마법사 팔→몸통 16.6cm(로브), 도적 단검→다리 17.6cm, 궁수 활→다리 8.7cm·팔→몸통 9.2cm.

## 재현

- bun run build 후 node tools/preview-local.mjs(BLADE_PREVIEW_PORT=5198), 다른 터미널에서 node tools/combat-mesh-qa.mjs http://127.0.0.1:5198 <출력폴더> [직업쉼표목록] [동작필터]. 출력: report.json(기준 문구·직업별 idleRaw·표본 전부)과 captures/(무오버레이 3시점 JPG).
- 전체 실행은 약 4~5분, 직업별 단독 실행은 1분 안팎이다. 판정 숫자는 껍질 근사이므로 클립 수정 전후를 같은 도구·같은 시작 상태로 비교한다.

## 2026-10-19 보정 층 적용 결과 (결함 94 → 19)

위 인계 항목을 클립 원본·해시 고정 파일(src/engine/hero-body-motion.js, src/data/higher-body-*.json, 영웅 GLB)을 건드리지 않고 새 가산 보정 층으로 처리했다. 로비 Idle 교정(src/engine/lobby-pose.js)과 같은 방식이다.

- 구성: src/engine/combat-pose.js(층), src/data/combat-pose-v1.json(직업×클립별 키 곡선 보정 데이터). 게임 연결은 src/game/actor.js(restore → mixer.update → updateCombatPose → apply), player.js(생성), main.js(마을 쇼케이스, 로비 Idle 교정 뒤에 얹음, 해제 세 곳).
- 동작: 보정은 직업×클립 이름(별칭 포함)으로 찾고, 클립 진행 시각의 키 곡선(smoothstep 보간)에 액션의 실효 가중치를 곱해 얹는다. Idle은 표에 없어 로비 교정과 겹치지 않는다. 클립 길이·액션 시각·히트 프레임·피해·범위는 건드리지 않는다(테스트로 고정). 프레임 루프는 새 객체를 만들지 않으며, 영웅 인스턴스당 하나이고 Actor.dispose에서 해제한다.
- 판정 보호: 활 화살 발사 위치(Player.arrowOrigin)는 보정을 잠시 벗겨(suspend/resume) 클립 자세에서 읽는다. 처음엔 보정이 활 위치를 옮겨 궁수 조준 판정 QA(aim-hitbox-truth-qa)가 7개 스킬에서 실패했고, 이 수정으로 보정 전과 같은 통과(40개 통과, 0개 실패)로 돌아왔다.
- 보정 크기: 뼈당 최대 각도 기사 38.6°, 야만전사 36.3°, 마법사 28.0°, 도적 37.9°, 궁수 39.3° (전부 40° 이내). 보정 뼈는 양팔·양손(위팔·아래팔·손)과 일부 클립의 양 어깨.
- 연속성: 보정 회전은 프레임당 14.5°까지만 변한다. 실제 게임 루프에서 마을·전투 전 동작(직업 5개, 약 2.2만 프레임)을 재생해 잰 프레임 간 보정 변화 최대값은 14.50°였다(work/cycles/20261019-combat-pose-fix/continuity.json).
- 손잡이-손 거리: 전 직업 전 동작 최대 5.0cm(기준 8cm).
- 측정: tools/combat-mesh-qa.mjs를 기준·방법 변경 없이 117개에 다시 돌렸다(개발 서버). 결함 94 → 19. 마법사 0, 도적 0, 기사 5, 야만전사 2, 궁수 12.
- 제외한 보정: 궁수 활 당기기(RangerBowUpper)는 수치가 14.8→10.9cm로 일부만 줄고 활이 약 30° 기울어져 자세가 무너져 보정하지 않는다.
- 시각 확인: 직업별 상위 결함 동작을 보정 전/후 정면·측면·후면 3시점(같은 시점 기준)으로 캡처해 눈으로 확인했다(work/cycles/20261019-combat-pose-fix/comparison, comparison2).

### 직업×동작별 전/후 (cm, 기준 초과 깊이)

### 기사 (knight)

| 동작 | 클립 | 전(결함 깊이 cm) | 후 | 판정 후 |
|---|---|---|---|---|
| hub-idle | Idle | 통과 | **통과** | 정상 |
| hub-walk | Running_A | 8.2 (무기+보조) | **통과** | 판정불가 |
| hub-Cheer | Cheer | 18.1 (무기+보조+팔→몸통) | **통과** | 판정불가 |
| hub-Interact | Interact | 15.1 (무기+보조+팔→몸통) | 13.3 (무기) | 결함 |
| idle | Idle | 통과 | **통과** | 정상 |
| run | Running_A | 8.4 (무기+보조+팔→몸통) | **통과** | 판정불가 |
| attack1 | 1H_Melee_Attack_Slice_Horizontal | 15.4 (무기+보조) | 7.7 (무기) | 결함 |
| attack2 | 1H_Melee_Attack_Slice_Diagonal | 13.9 (무기+보조) | **통과** | 오탐 |
| attack3 | 1H_Melee_Attack_Stab | 12.9 (무기+보조+팔→몸통) | **통과** | 판정불가 |
| attack4 | 2H_Melee_Attack_Spin | 18.0 (무기+보조+팔→몸통) | 16.8 (무기+팔→몸통) | 결함 |
| attack5 | 1H_Melee_Attack_Slice_Horizontal | 18.5 (무기+보조+팔→몸통) | 3.8 (무기) | 결함 |
| attack6 | 1H_Melee_Attack_Chop | 20.1 (무기+보조+팔→몸통) | **통과** | 판정불가 |
| skill0-holy_slash | 1H_Melee_Attack_Slice_Horizontal | 17.3 (무기+보조+팔→몸통) | 8.2 (무기+보조+팔→몸통) | 결함 |
| skill1-shield_bash | Block_Hit | 통과 | **통과** | 판정불가 |
| skill2-judgment | Spellcast_Raise | 19.7 (무기+보조) | **통과** | 판정불가 |
| skill3-dragon_slash | 2H_Melee_Attack_Chop | 20.6 (무기+보조+팔→몸통) | **통과** | 판정불가 |
| skill4-chain_bind | Spellcast_Raise | 18.9 (무기+보조) | **통과** | 판정불가 |
| skill5-sanctuary | Spellcast_Raise | 19.7 (무기+보조) | **통과** | 판정불가 |
| skill6-sunbreaker | 2H_Melee_Attack_Chop | 20.8 (무기+보조+팔→몸통) | **통과** | 판정불가 |
| skill7-heavenfall | Spellcast_Raise | 19.7 (무기+보조) | **통과** | 판정불가 |
| dodge | Dodge_Forward | 8.3 (무기+보조) | **통과** | 판정불가 |
| hit | Hit_A | 8.4 (무기) | **통과** | 판정불가 |
| cheer | Cheer | 18.1 (무기+보조) | **통과** | 판정불가 |
| interact | Interact | 15.1 (무기+보조+팔→몸통) | **통과** | 판정불가 |

### 야만전사 (barbarian)

| 동작 | 클립 | 전(결함 깊이 cm) | 후 | 판정 후 |
|---|---|---|---|---|
| hub-idle | Idle | 통과 | **통과** | 정상 |
| hub-walk | Running_A | 8.9 (무기) | **통과** | 판정불가 |
| hub-Cheer | Cheer | 26.3 (무기) | **통과** | 오탐 |
| hub-Interact | Interact | 25.1 (무기) | **통과** | 판정불가 |
| idle | Idle | 통과 | **통과** | 오탐 |
| run | Running_A | 8.8 (무기) | **통과** | 판정불가 |
| attack1 | 2H_Melee_Attack_Slice | 22.1 (무기) | **통과** | 오탐 |
| attack2 | 2H_Melee_Attack_Stab | 19.0 (무기) | **통과** | 오탐 |
| attack3 | 2H_Melee_Attack_Spinning | 21.6 (무기+팔→몸통) | 13.8 (무기) | 결함 |
| attack4 | 2H_Melee_Attack_Chop | 25.9 (무기+팔→몸통) | **통과** | 판정불가 |
| attack5 | Jump_Full_Short | 23.2 (무기) | **통과** | 판정불가 |
| skill0-whirlwind | 2H_Melee_Attack_Spin | 22.8 (무기+팔→몸통) | 8.8 (무기) | 결함 |
| skill1-quake | 2H_Melee_Attack_Chop | 25.4 (무기+팔→몸통) | **통과** | 판정불가 |
| skill2-berserk | Cheer | 23.8 (무기) | **통과** | 오탐 |
| skill3-hell_axe | Jump_Full_Short | 23.1 (무기) | **통과** | 판정불가 |
| skill4-bull_rush | 2H_Melee_Attack_Stab | 18.6 (무기) | **통과** | 오탐 |
| skill5-magma_zone | 2H_Melee_Attack_Chop | 25.8 (무기) | **통과** | 판정불가 |
| skill6-bloodquake | 2H_Melee_Attack_Chop | 25.4 (무기+팔→몸통) | **통과** | 판정불가 |
| skill7-cataclysm | Jump_Full_Short | 22.9 (무기) | **통과** | 판정불가 |
| dodge | Dodge_Forward | 통과 | **통과** | 판정불가 |
| hit | Hit_A | 통과 | **통과** | 판정불가 |
| cheer | Cheer | 25.5 (무기) | **통과** | 오탐 |
| interact | Interact | 25.1 (무기) | **통과** | 판정불가 |

### 마법사 (mage)

| 동작 | 클립 | 전(결함 깊이 cm) | 후 | 판정 후 |
|---|---|---|---|---|
| hub-idle | Idle | 통과 | **통과** | 정상 |
| hub-walk | Running_A | 통과 | **통과** | 판정불가 |
| hub-Cheer | Cheer | 통과 | **통과** | 판정불가 |
| hub-Interact | Interact | 19.8 (무기+팔→몸통) | **통과** | 판정불가 |
| idle | Idle | 통과 | **통과** | 오탐 |
| run | Running_A | 통과 | **통과** | 판정불가 |
| attack1 | Spellcast_Shoot | 9.2 (무기) | **통과** | 판정불가 |
| attack2 | Spellcast_Shoot | 9.2 (무기) | **통과** | 판정불가 |
| attack3 | Spellcast_Long | 통과 | **통과** | 판정불가 |
| attack4 | Spellcast_Shoot | 7.3 (무기) | **통과** | 판정불가 |
| attack5 | Spellcast_Raise | 14.8 (무기) | **통과** | 판정불가 |
| skill0-fireball | Spellcast_Shoot | 17.8 (무기) | **통과** | 판정불가 |
| skill1-chain | Spellcast_Raise | 10.1 (무기) | **통과** | 판정불가 |
| skill2-blizzard | Spellcast_Long | 7.2 (무기) | **통과** | 판정불가 |
| skill3-meteor | Spellcast_Raise | 9.4 (무기) | **통과** | 판정불가 |
| skill4-arc_reflect | Spellcast_Shoot | 18.2 (무기) | **통과** | 판정불가 |
| skill5-chrono_seal | Spellcast_Raise | 10.1 (무기) | **통과** | 판정불가 |
| skill6-star_prison | Spellcast_Long | 통과 | **통과** | 판정불가 |
| skill7-absolute_zero | Spellcast_Raise | 10.1 (무기) | **통과** | 판정불가 |
| dodge | Dodge_Forward | 통과 | **통과** | 판정불가 |
| hit | Hit_A | 통과 | **통과** | 판정불가 |
| cheer | Cheer | 통과 | **통과** | 판정불가 |
| interact | Interact | 7.7 (무기) | **통과** | 판정불가 |

### 도적 (rogue)

| 동작 | 클립 | 전(결함 깊이 cm) | 후 | 판정 후 |
|---|---|---|---|---|
| hub-idle | Idle | 통과 | **통과** | 정상 |
| hub-walk | Running_A | 26.4 (무기) | **통과** | 판정불가 |
| hub-Cheer | Cheer | 24.2 (무기) | **통과** | 판정불가 |
| hub-Interact | Interact | 23.6 (무기) | **통과** | 판정불가 |
| idle | Idle | 통과 | **통과** | 정상 |
| run | Running_A | 27.5 (무기) | **통과** | 판정불가 |
| attack1 | Dualwield_Melee_Attack_Slice | 23.9 (무기+팔→몸통) | **통과** | 판정불가 |
| attack2 | Dualwield_Melee_Attack_Chop | 21.4 (무기) | **통과** | 판정불가 |
| attack3 | Dualwield_Melee_Attack_Slice | 23.9 (무기+팔→몸통) | **통과** | 판정불가 |
| attack4 | Dodge_Forward | 21.0 (무기) | **통과** | 판정불가 |
| attack5 | Dualwield_Melee_Attack_Chop | 21.4 (무기) | **통과** | 판정불가 |
| attack6 | Dualwield_Melee_Attack_Stab | 20.9 (무기) | **통과** | 판정불가 |
| skill0-shadow_dash | Dodge_Forward | 21.9 (무기) | **통과** | 판정불가 |
| skill1-poison_bomb | Throw | 21.0 (무기) | **통과** | 판정불가 |
| skill2-flurry | Dualwield_Melee_Attack_Stab | 25.7 (무기+팔→몸통) | **통과** | 판정불가 |
| skill3-thousand | Spellcast_Raise | 18.7 (무기) | **통과** | 판정불가 |
| skill4-shadow_mark | Dualwield_Melee_Attack_Stab | 21.5 (무기) | **통과** | 판정불가 |
| skill5-void_step | Dodge_Forward | 22.2 (무기) | **통과** | 판정불가 |
| skill6-night_parade | Dualwield_Melee_Attack_Slice | 25.7 (무기+팔→몸통) | **통과** | 판정불가 |
| skill7-eclipse_edge | Dodge_Forward | 22.3 (무기) | **통과** | 판정불가 |
| dodge | Dodge_Forward | 통과 | **통과** | 판정불가 |
| hit | Hit_A | 21.7 (무기) | **통과** | 오탐 |
| cheer | Cheer | 24.2 (무기) | **통과** | 판정불가 |
| interact | Interact | 23.6 (무기) | **통과** | 판정불가 |

### 궁수 (ranger)

| 동작 | 클립 | 전(결함 깊이 cm) | 후 | 판정 후 |
|---|---|---|---|---|
| hub-idle | Idle | 통과 | **통과** | 정상 |
| hub-walk | Running_A | 3.8 (무기) | **통과** | 판정불가 |
| hub-Cheer | Cheer | 5.7 (무기) | **통과** | 판정불가 |
| hub-Interact | Interact | 5.8 (무기) | 4.1 (무기) | 결함 |
| idle | Idle | 통과 | **통과** | 정상 |
| run | Running_A | 11.1 (팔→몸통) | **통과** | 판정불가 |
| attack1 | Bow_Shoot | 14.7 (무기+팔→몸통) | 14.7 (무기+팔→몸통) | 결함 |
| attack2 | Bow_Shoot | 14.8 (무기+팔→몸통) | 14.8 (무기+팔→몸통) | 결함 |
| attack3 | Bow_Shoot | 14.8 (무기+팔→몸통) | 14.8 (무기+팔→몸통) | 결함 |
| attack4 | Bow_Shoot | 14.9 (무기+팔→몸통) | 14.9 (무기+팔→몸통) | 결함 |
| attack5 | Bow_Shoot | 14.8 (무기+팔→몸통) | 14.8 (무기+팔→몸통) | 결함 |
| skill0-ranger_pierce | Bow_Shoot | 14.5 (무기+팔→몸통) | 14.5 (무기+팔→몸통) | 결함 |
| skill1-ranger_volley | Bow_Shoot | 14.8 (무기+팔→몸통) | 14.8 (무기+팔→몸통) | 결함 |
| skill2-ranger_retreat | Bow_Shoot | 14.7 (무기+팔→몸통) | 14.7 (무기+팔→몸통) | 결함 |
| skill3-ranger_tempest | Bow_Shoot | 14.8 (무기+팔→몸통) | 14.8 (무기+팔→몸통) | 결함 |
| skill4-ranger_quickshot | Bow_Shoot | 14.7 (무기+팔→몸통) | **통과** | 판정불가 |
| skill5-ranger_binding | Bow_Shoot | 14.7 (무기+팔→몸통) | 14.7 (무기+팔→몸통) | 결함 |
| skill6-gale_hunt | Bow_Shoot | 14.7 (무기+팔→몸통) | **통과** | 판정불가 |
| skill7-skyfall_arrows | Bow_Shoot | 14.6 (무기+팔→몸통) | 14.6 (무기+팔→몸통) | 결함 |
| dodge | Dodge_Forward | 9.0 (무기) | **통과** | 판정불가 |
| hit | Hit_A | 통과 | **통과** | 판정불가 |
| cheer | Cheer | 10.5 (무기+팔→몸통) | **통과** | 판정불가 |
| interact | Interact | 12.1 (팔→몸통) | **통과** | 판정불가 |


### 남은 결함 19건과 사유

| 직업 | 동작 | 클립 | 프레임 (클립 진행) | 깊이(cm) | 부위 | 사유 |
|---|---|---|---|---|---|---|
| knight | hub-Interact | Interact | 0 (0%) | 13.3 | 무기 | 측정 하네스가 이전 동작 없이 첫 프레임에 클립을 즉시 100% 재생한다. 보정은 연속성 때문에 프레임당 14.5도까지만 변해 첫 프레임에 목표에 닿지 못한다. 게임은 마을 동작을 0.16초 크로스페이드로, 승리 연출을 0.2초 페이드로 재생하고 Interact는 재생하지 않는다. |
| knight | attack1 | 1H_Melee_Attack_Slice_Horizontal | 11 (40%) | 7.7 | 무기 | 가로 베기(타격 직전, 클립 진행 최대 5.2%/프레임): 이 프레임 하나만 보면 40도 이하 해가 있다(단일 프레임 시험). 연속 조건 안의 최선 곡선에서 타격 직전 한 프레임이 남았다(깊이 15.4→7.7cm로 절반). 보정 속도 제한을 풀면 attack1·attack5는 통과함을 확인했다(실험). |
| knight | attack4 | 2H_Melee_Attack_Spin | 8 (21%) | 16.8 | 무기+팔→몸통 | 회전 베기(클립 진행 최대 2.0~2.4%/프레임): 이 프레임 하나만 보면 뼈당 40도 이하 보정으로 통과하는 해가 있다(단일 프레임 시험). 연속성(프레임당 14.5도 이하)과 시전 시작 페이드의 가중치 비례 규칙을 지킨 곡선 탐색의 최선 해에서 이 프레임이 남았다. 해결 불가의 증명은 아니며 속도 제한을 풀었던 실험에서는 기사 attack4가 6.4cm로 줄었다. |
| knight | attack5 | 1H_Melee_Attack_Slice_Horizontal | 11 (40%) | 3.8 | 무기 | 가로 베기(타격 직전, 클립 진행 최대 5.2%/프레임): 이 프레임 하나만 보면 40도 이하 해가 있다(단일 프레임 시험). 연속 조건 안의 최선 곡선에서 타격 직전 한 프레임이 남았다(깊이 15.4→7.7cm로 절반). 보정 속도 제한을 풀면 attack1·attack5는 통과함을 확인했다(실험). |
| knight | skill0-holy_slash | 1H_Melee_Attack_Slice_Horizontal | 12 (36%) | 8.2 | 무기+보조+팔→몸통 | 가로 베기(타격 직전, 클립 진행 최대 5.2%/프레임): 이 프레임 하나만 보면 40도 이하 해가 있다(단일 프레임 시험). 연속 조건 안의 최선 곡선에서 타격 직전 한 프레임이 남았다(깊이 15.4→7.7cm로 절반). 보정 속도 제한을 풀면 attack1·attack5는 통과함을 확인했다(실험). |
| barbarian | attack3 | 2H_Melee_Attack_Spinning | 27 (55%) | 13.8 | 무기 | 회전 베기(클립 진행 최대 2.0~2.4%/프레임): 이 프레임 하나만 보면 뼈당 40도 이하 보정으로 통과하는 해가 있다(단일 프레임 시험). 연속성(프레임당 14.5도 이하)과 시전 시작 페이드의 가중치 비례 규칙을 지킨 곡선 탐색의 최선 해에서 이 프레임이 남았다. 해결 불가의 증명은 아니며 속도 제한을 풀었던 실험에서는 기사 attack4가 6.4cm로 줄었다. |
| barbarian | skill0-whirlwind | 2H_Melee_Attack_Spin | 26 (28%) | 8.8 | 무기 | 회전 베기(클립 진행 최대 2.0~2.4%/프레임): 이 프레임 하나만 보면 뼈당 40도 이하 보정으로 통과하는 해가 있다(단일 프레임 시험). 연속성(프레임당 14.5도 이하)과 시전 시작 페이드의 가중치 비례 규칙을 지킨 곡선 탐색의 최선 해에서 이 프레임이 남았다. 해결 불가의 증명은 아니며 속도 제한을 풀었던 실험에서는 기사 attack4가 6.4cm로 줄었다. |
| ranger | hub-Interact | Interact | 0 (0%) | 4.1 | 무기 | 측정 하네스가 이전 동작 없이 첫 프레임에 클립을 즉시 100% 재생한다. 보정은 연속성 때문에 프레임당 14.5도까지만 변해 첫 프레임에 목표에 닿지 못한다. 게임은 마을 동작을 0.16초 크로스페이드로, 승리 연출을 0.2초 페이드로 재생하고 Interact는 재생하지 않는다. |
| ranger | attack1 | Bow_Shoot | 11 (44%) | 14.7 | 무기+팔→몸통 | 활 당기기(클립 진행 최대 13.5%/프레임): 시위 손이 몸통 중앙선 안쪽 가슴 속 약 20cm에 오는 것이 클립 설계다. 팔 40도·어깨까지 써도 14.8→10.9cm까지만 줄고 그때 활이 조준 방향에서 약 30도 기울어 자세가 무너져(비교 캡처) 이 클립은 보정하지 않는다. |
| ranger | attack2 | Bow_Shoot | 10 (43%) | 14.8 | 무기+팔→몸통 | 활 당기기(클립 진행 최대 13.5%/프레임): 시위 손이 몸통 중앙선 안쪽 가슴 속 약 20cm에 오는 것이 클립 설계다. 팔 40도·어깨까지 써도 14.8→10.9cm까지만 줄고 그때 활이 조준 방향에서 약 30도 기울어 자세가 무너져(비교 캡처) 이 클립은 보정하지 않는다. |
| ranger | attack3 | Bow_Shoot | 15 (44%) | 14.8 | 무기+팔→몸통 | 활 당기기(클립 진행 최대 13.5%/프레임): 시위 손이 몸통 중앙선 안쪽 가슴 속 약 20cm에 오는 것이 클립 설계다. 팔 40도·어깨까지 써도 14.8→10.9cm까지만 줄고 그때 활이 조준 방향에서 약 30도 기울어 자세가 무너져(비교 캡처) 이 클립은 보정하지 않는다. |
| ranger | attack4 | Bow_Shoot | 15 (43%) | 14.9 | 무기+팔→몸통 | 활 당기기(클립 진행 최대 13.5%/프레임): 시위 손이 몸통 중앙선 안쪽 가슴 속 약 20cm에 오는 것이 클립 설계다. 팔 40도·어깨까지 써도 14.8→10.9cm까지만 줄고 그때 활이 조준 방향에서 약 30도 기울어 자세가 무너져(비교 캡처) 이 클립은 보정하지 않는다. |
| ranger | attack5 | Bow_Shoot | 19 (43%) | 14.8 | 무기+팔→몸통 | 활 당기기(클립 진행 최대 13.5%/프레임): 시위 손이 몸통 중앙선 안쪽 가슴 속 약 20cm에 오는 것이 클립 설계다. 팔 40도·어깨까지 써도 14.8→10.9cm까지만 줄고 그때 활이 조준 방향에서 약 30도 기울어 자세가 무너져(비교 캡처) 이 클립은 보정하지 않는다. |
| ranger | skill0-ranger_pierce | Bow_Shoot | 11 (44%) | 14.5 | 무기+팔→몸통 | 활 당기기(클립 진행 최대 13.5%/프레임): 시위 손이 몸통 중앙선 안쪽 가슴 속 약 20cm에 오는 것이 클립 설계다. 팔 40도·어깨까지 써도 14.8→10.9cm까지만 줄고 그때 활이 조준 방향에서 약 30도 기울어 자세가 무너져(비교 캡처) 이 클립은 보정하지 않는다. |
| ranger | skill1-ranger_volley | Bow_Shoot | 16 (44%) | 14.8 | 무기+팔→몸통 | 활 당기기(클립 진행 최대 13.5%/프레임): 시위 손이 몸통 중앙선 안쪽 가슴 속 약 20cm에 오는 것이 클립 설계다. 팔 40도·어깨까지 써도 14.8→10.9cm까지만 줄고 그때 활이 조준 방향에서 약 30도 기울어 자세가 무너져(비교 캡처) 이 클립은 보정하지 않는다. |
| ranger | skill2-ranger_retreat | Bow_Shoot | 17 (43%) | 14.7 | 무기+팔→몸통 | 활 당기기(클립 진행 최대 13.5%/프레임): 시위 손이 몸통 중앙선 안쪽 가슴 속 약 20cm에 오는 것이 클립 설계다. 팔 40도·어깨까지 써도 14.8→10.9cm까지만 줄고 그때 활이 조준 방향에서 약 30도 기울어 자세가 무너져(비교 캡처) 이 클립은 보정하지 않는다. |
| ranger | skill3-ranger_tempest | Bow_Shoot | 56 (43%) | 14.8 | 무기+팔→몸통 | 활 당기기(클립 진행 최대 13.5%/프레임): 시위 손이 몸통 중앙선 안쪽 가슴 속 약 20cm에 오는 것이 클립 설계다. 팔 40도·어깨까지 써도 14.8→10.9cm까지만 줄고 그때 활이 조준 방향에서 약 30도 기울어 자세가 무너져(비교 캡처) 이 클립은 보정하지 않는다. |
| ranger | skill5-ranger_binding | Bow_Shoot | 20 (44%) | 14.7 | 무기+팔→몸통 | 활 당기기(클립 진행 최대 13.5%/프레임): 시위 손이 몸통 중앙선 안쪽 가슴 속 약 20cm에 오는 것이 클립 설계다. 팔 40도·어깨까지 써도 14.8→10.9cm까지만 줄고 그때 활이 조준 방향에서 약 30도 기울어 자세가 무너져(비교 캡처) 이 클립은 보정하지 않는다. |
| ranger | skill7-skyfall_arrows | Bow_Shoot | 26 (43%) | 14.6 | 무기+팔→몸통 | 활 당기기(클립 진행 최대 13.5%/프레임): 시위 손이 몸통 중앙선 안쪽 가슴 속 약 20cm에 오는 것이 클립 설계다. 팔 40도·어깨까지 써도 14.8→10.9cm까지만 줄고 그때 활이 조준 방향에서 약 30도 기울어 자세가 무너져(비교 캡처) 이 클립은 보정하지 않는다. |

