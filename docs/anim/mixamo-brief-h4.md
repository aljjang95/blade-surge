# h4-anim PC 단계 브리프: 도적·궁수 회피·찌르기 이음새, 궁수 두 번째 사망

절차적 팩(`tools/blender/author_anim_packs.py`)으로 처리하지 않고 PC 단계로 넘긴 항목이다. 이유와 측정값, 해야 할 일을 적는다.

## 왜 절차적 팩으로 바꾸지 않았나
- 도적·궁수 1단계 몸체는 교정본(`rogue-library-t1-v2.glb`, `ranger-library-t1-v4.glb`)이고, 2·3단계·아바타 몸체는 `src/engine/hero-body-motion.js` 가
  `dodge`·`death`·(도적)`stab` 클립의 골반 위치 트랙을 **원본 트랙과 비트 대조한 뒤** 몸체별 높이 보정 트랙으로 바꿔 끼운다.
  별칭(`Dodge_Forward`, `Death_*`, 찌르기 콤보)을 새 팩 클립으로 돌리면 몸체를 바꿀 때 보정이 붙지 않아 상위 단계에서 발이 뜨거나 묻힌다.
- 궁수 사망은 활 접지 계약(`test/ranger-death-contact.test.ts`)이 원본 클립에 묶여 있다.
- 루트 흘러감은 이미 없다(교정본이 제자리). 남은 결함은 이음새뿐이다.

## 측정(Blender 5.2.2 LTS 헤드리스, `anim_lib` 같은 측정기, 2026-10-22)
| 몸체 | 클립 | 길이 | 이음새(첫↔끝) | 끝↔대기 | 골반 흘러감 |
|---|---|---|---|---|---|
| 도적 t1 v2 | dodge(`Dodge_Forward`) | 0.50s | 48.2° | 69.1° | 0.000m |
| 도적 t1 v2 | stab | 1.71s | 64.3° | 73.3° | 0.000m |
| 궁수 t1 v4 | dodge(`Dodge_Forward`) | 0.50s | 48.2° | 83.0° | 0.000m |
| 궁수 t1 v4 | death(두 번째 사망 없음) | 1.25s | — | — | 0.000m |

## 할 일 (PC, 평소 Chrome의 Mixamo — `60-3d-and-media.md`)
1. Mixamo에서 같은 리그(교정본 FBX 내보내기)로 "Dodge Forward"(in place 체크)와 "Stabbing"(in place) 후보를 받아, 마지막 0.15초가 전투 대기(`idle` 첫 자세)로 돌아오는 것을 고른다. 궁수는 "Dying Backwards"(in place)를 추가로 받는다.
2. 받은 원본은 바로 `TLL-Asset-Foundry`에 `archive_asset.py`로 보관한다.
3. 새 클립을 교정본 저작 경로(도적 `src/data/rogue-library-revision-v2.json` 의 축 교정 계보, 궁수 `art-src/ranger/`)에 **원본 이름 그대로**(`dodge`, `stab`) 다시 굽는다. 골반 위치 트랙은 기존 트랙을 그대로 두고 회전만 바꾸면 `hero-body-motion` 의 비트 대조를 통과한다. 골반 위치가 바뀌면 몸체별 보정(`src/data/higher-body-motion-v1.json`, `src/data/rogue-t2-body-motion-v2.json`, 저작 `art-src/higher-bodies/author_body_motion_v1.py`)을 다시 저작·서명해야 한다.
4. 궁수 두 번째 사망은 활 접지(`ranger-death-contact`) 검사를 같은 방식으로 새 클립에 추가한 뒤에만 `Death_B` 별칭에 잇는다.
5. 합격 기준: 이음새 < 10°, 끝↔대기 < 30°, 골반 흘러감 < 0.05m, 스킨 바닥 관통 < 3cm, 상위 몸체 교체 뒤에도 `test/hero-body-motion.test.ts`·`test/higher-body-motion.test.ts` 통과, Playwright 844x390 게임 안에서 T-포즈 없음.
