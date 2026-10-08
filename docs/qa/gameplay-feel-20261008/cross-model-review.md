# 수동 전투 후보 독립 교차검토 — 2026-10-08

동결 제품 소스의 읽기 검토에서 미해결 신규 P1/P2 회귀를 찾지 못했다. 앞서 발견한 P2 표시 오류는 수정됐다. 후보 스크린샷 세 장에는 혼전 가림과 전투 문구 중첩이 남아 있으므로 전체 시각 품질이나 재미의 통과를 선언하지 않는다.

이 문서는 소스 대조 및 실제 생성 PNG 관찰이다. 리뷰 과정에서 제품 코드를 수정하거나 CPU 테스트·브라우저 플레이를 실행하지 않았다. 사람의 수동 플레이 평가, 물리 기기·GPU·터치·청감, AAA 품질, 출시 승인이 아니다.

## 소스 식별과 읽은 범위

- 기준 HEAD: `fab00213725df80be2670eb9d78625aa09d17773`, branch `codex/gameplay-feel-20261008`.
- 측정 후보: dirty `true`, builtAt `2026-10-08T14:52:57.067Z`, pwaRelease `65fd524ae06edc3ec6e3`.
- `work/qa/gameplay-20261008/cloud-head-fonts-source.json`의 `allChangedSourceFiles` 15개를 현재 파일 SHA-256과 직접 비교했다. 불일치 0개다. 이는 해시 대조이며 해당 15개 모두의 동작을 검증했다는 뜻이 아니다.
- 이전 리뷰의 아래 11개 제품 소스 해시도 현재 동결 소스와 모두 같다. 최종 FX 파일은 앞선 동작 검토 이후 JSDoc 추가까지 다시 읽었다.
- AGENTS → CURRENT_STACK → RSI → manual-combo-feedback → AAA 품질 계약을 읽었다. 변경된 Player 입력·공격·회피·피격·스킬, Enemy 준비·공격·경고·취소, combat-craft, MobRole, EnemyDashWarning, Input, FX, combat-feedback, UI·combo/skill feedback와 CSS·tutorial을 읽었다. 관련 Actor 이동·stun, Battle pause, BossSignatures, region hazard 판정·shader, crowd contact, 영웅 데이터 및 집중 테스트 소스도 대조했다.
- `tools/shot_combo.mjs`는 이 검토의 동작 리뷰 범위가 아니다. 후속 콤보 PNG 9장 검토는 아래 추가 관찰에 포함했다.

| 파일 | SHA-256 |
| --- | --- |
| `src/game/player.js` | `d6dedc9cce9274931ca5a19759d4acce7e4bf3ae668bfd23a97efd543da644c9` |
| `src/game/enemies.js` | `ece9435bce3f7e5c625d1aec8bfb34ca8fda953edfbbf982d207f9faf2f4b9e3` |
| `src/game/combat-craft.js` | `a2940975d329ae701aa6d5e8240415e53ac650308adab2e47670e843fddbcc0c` |
| `src/game/mob-roles.js` | `07f871b63dc87d47d13d6c98bb4f105dc3abb5a76fe4210ab92e57e0a6fa26c0` |
| `src/game/enemy-dash-warning.js` | `26314d0564bb39bf763d51fcff0550999dedce0a58b79bf4c131705613f72d3c` |
| `src/engine/input.js` | `c7ea31d372df9eedf83e8c6336e4e40e24d34ed17df36c9a5c8ae2559325b560` |
| `src/engine/fx.js` | `8800f5d0e2666f6c7f964db7cc0a87fb85f541d180fb63b24cc53078cd7e1f37` |
| `src/engine/combat-feedback.js` | `2846ce7956ab459319496ce3c84584aefed4a31a11a9934e2685f9a2f272ea58` |
| `src/ui/ui.js` | `5d11ee5a3dcfa9ba13350bddb95868e4bd21f36c54d7f7b1cd37ca137bedf598` |
| `src/ui/combo-feedback.js` | `320a559b04a4ebeb47ca3b5ce4a55ba08114c328c9a7afc3de78db0f119284b6` |
| `src/ui/skill-feedback.js` | `68026ee2f7a0721cecbb6e213aae0e166216a8e203629a3d9f50df2f40d097cd` |

## 발견 사항과 처리

| 분류 | 근거·재현 조건 | 영향·처리 |
| --- | --- | --- |
| P2 수정 확인 | `counterWindow > 0`에서 비마무리 `startCombo(0)` 또는 `comboResume.idx = 1`도 기존 후보 UI가 `n/N타 · 강화`로 표시했다. Player.doComboHit의 실제 강화 조건은 `tick === 0 && c.finisher && counterWindow > 0`다. | 강화되지 않는 현재 타격을 강화됐다고 오해할 수 있었다. 동결 combo-feedback의 공격·재개 양쪽에 `counterActive && finisher`가 적용됐다. 새 표시가 실제 조건과 맞는다. |
| 신규 P1/P2 없음 | 회피 버퍼 자연 종료 경계, 수락된 방향의 다음 타격 적용, pause/clear 및 dispose, AUTO·다른 영웅, MP 거절 trail, 피격 재개, 고정 예고와 dash 경고/판정·메시 수명 대조. | 읽은 범위에서 추가 회귀를 찾지 못했다. 모든 가능한 입력 순서와 게임 밸런스를 검증한 결과는 아니다. |
| 기존 잔존 공방 문제 | Actor.update는 공격 중에도 `kb`를 위치에 적용한다. 일반 근접 경고 FX는 준비 시 위치에 남고 실제 doAttack은 현재 enemy.pos를 쓴다. | 경타 넉백을 받으며 공격을 계속하면 예고 원점과 피해 원점이 달라질 여지가 남는다. 이번 vel 초기화가 해결하는 것은 잔여 추격 속도다. 기존 결함이며 root가 이번 범위 밖으로 보류했다. crowd contact는 공격/예고 중 액터를 이동시키지 않으므로 이 원인에 포함하지 않는다. |

적 검토에서는 role 공통 3슬롯의 순차 진입, slashArc의 명목 각도·반경, dash 통로와 hazardContains의 교집합, signature 슬롯 공유에 따른 기존 6메시 예산, 종료·죽음·폐기 시 경고 정리를 확인했다. VFX 장식 gain은 telegraph를 제외하고 RGB에 적용되며 피해·난수·수명·알파 곡선을 바꾸지 않는다. 이는 소스 관찰이다.

## PNG 직접 관찰

`work/qa/gameplay-20261008/cloud-head-fonts-shots/`의 아래 실제 880×400 PNG를 열어 확인했다. 기준선과 동일 프레임을 맞춘 이미지 쌍은 이 검토에서 보지 않았으므로 아래 화면 문제의 신규 회귀 여부는 판정하지 않는다.

| 화면 | 직접 관찰한 것 | 판독 영향·한계 |
| --- | --- | --- |
| `dense.png` | 중앙의 큰 적·원형 장식이 영웅 몸통을 대부분 가린다. 중앙 PERFECT 글자는 적과 상태 안내에 겹치고, 하단 네브/방어 글자도 서로 겹친다. HP/MP와 오른쪽 스킬 숫자 `12`는 읽힌다. | 혼전에서 내 영웅의 자세와 피격 원인을 읽기 어렵다. 잔존 화면 개선 우선순위 P2로 본다. 정지 이미지로 순간 가림의 지속 시간이나 실제 입력 실패를 측정할 수 없다. |
| `s0.png` | 중앙 영웅과 검·발밑 표식은 구별된다. 스킬 `5.6`, 회피 버튼은 읽힌다. 상단 큰 `관문 대장` 글자와 보스 이름/HP 표시가 겹친다. | 전투 상태와 보스 정보를 동시에 읽기 어려운 잔존 문구 배치 문제다. 화면 개선 우선순위 P2이며 새 HUD 변경이 원인이라고 단정하지 않는다. |
| `s1.png` | 영웅과 전방 대상이 구별된다. 우측 목표는 `정화 완료`지만 중앙에는 `보스 · 적 기술` 및 피하라는 안내가 동시에 남아 있다. 상단 피해 글자는 화면 경계에서 잘린다. | 종료 순간 안내가 서로 다른 행동을 요구한다. 종료 후 잔류 표시의 수명 확인이 필요하다. 한 장만으로 지속적인 lifecycle 결함이나 신규 P2 회귀로 확정하지 않는다. |

한글 HUD와 환경/캐릭터 텍스처가 렌더된다. 잠긴 스킬 자리에 보이는 네모형 대체 문자는 측정 문서가 기록한 폰트 제한과 부합하지만 이 검토에서 독립적으로 폰트 원인을 재현하지 않았다. 이 세 장은 AUTO 화면이며 새 수동 방향 큐·무방향 백스텝·이어치기 안내를 입증하지 않는다. 저품질 모드·reduced motion·물리 모바일도 확인하지 않았다.

| PNG | SHA-256 |
| --- | --- |
| `dense.png` | `0424fe6074e46b455180d3ec40abe201dd7aa3f67c397ee7aa3606f1a2804308` |
| `s0.png` | `76f595a1478aafac20e61fd021546f537e5a7721ffe604f6f285945eaee87e58` |
| `s1.png` | `c17ab524ef4e2ea00323eef0898382abbc332a7b5a1142f17532622f9f7bfca7` |

## 측정 근거의 사용 한계

`cloud-candidate-review.md`와 소스 manifest를 읽었다. 해당 담당 기록은 동일 Chromium/SwiftShader 환경의 후보 metrics 1회와 공식 compare 통과를 보고한다. 그 실행을 이 리뷰가 재실행하거나 독립 승인한 것은 아니다.

보고된 피격 비율은 기준 0.158에서 후보 0.269, 무보상 최장은 10.1초에서 20.1초, draw calls는 399에서 419로 늘었다. 절대·상대 게이트 통과와 별개로 난이도·보상 리듬이 모두 좋아졌다는 결론은 낼 수 없다. 규칙 변경으로 동일 seed의 진행 상태가 달라졌으므로 단일 AUTO 표본으로 원인을 분리하지 않는다. 평균 스텝 시간이 줄었다는 기록도 실제 휴대전화 FPS나 열 안정성으로 확대하지 않는다.

코드 교차검토 완료와 세 장의 관찰은 남은 수동 입력·자연 플레이·기기·AAA·출시 게이트를 대체하지 않는다.

## 추가 관찰: 5영웅 마무리·회피 재개 fixture

`work/qa/gameplay-20261008/cloud-combo-ready-v3/report.json`의 식별자·제약·영웅별 공격 및 후속 기록을 확인하고 아래 PNG 9장을 직접 열어 봤다. 보고서는 `status:pass`, 5영웅 총 27타, errors `[]`이며 `Input.press`·실제 Player 조회/전환/타격·`app.step`을 사용하는 컴파일 게임 fixture다. 이 리뷰가 그 실행을 재수행한 것은 아니다.

측정 당시와 같은 dirty build를 기록한다. 기존 metrics manifest의 `src/` 제품 파일 14개를 다시 SHA-256 대조한 결과 불일치 0개였다. `tools/shot_combo.mjs`는 준비 상태 대기 수정으로 해시가 달라질 수 있는 검수 도구이며 제품 해시 동일성에 포함하지 않았다. 최초·진단 실패는 담당 분석에서 준비 중 bomber 폭발의 최소 1피해·kb9 경직 동안 첫 입력이 들어가 버퍼가 만료된 것으로 분류됐다. 최신 보고서도 bomber 동작 보존과 실제 idle 준비 대기를 명시한다. 이 원인 분석은 담당 기록을 인용한 것이며 이 리뷰가 이전 실패 실행을 재현한 것은 아니다.

fixture는 새 격리 저장을 Lv.5·튜토리얼 완료·수동 전투로 준비하고 표적 10체에 HP 1,000,000·ATK 0·매우 긴 공격 쿨다운을 설정한다. bomber는 별도 행동으로 실제 폭발할 수 있다. 기사 perfect-counter는 회피 무적 중 `Player.hurt(1)`을 한 번 주입한다. 따라서 정상 성장·밸런스·적 공격을 보고 회피한 자연 플레이의 증거가 아니다. viewport는 880×400이며 폰트 fallback·고정 스텝 환경이다.

| 직접 본 PNG | 화면과 기록의 한정 대조 |
| --- | --- |
| `combo_knight_06.png` | 공격 버튼에 `6/6타 · 마무리`, `연계`, `다시 누르기`가 들어간다. 기사와 검 궤적이 구별되지만 큰 `1039! FINISH`가 위쪽 표적/HP 영역을 덮는다. |
| `combo_barbarian_05.png` | `5/5타 · 마무리`와 연계 안내가 읽힌다. 영웅의 위치는 발밑 표식으로 구별되며 주변 적은 피격 순간 밝게 보인다. 한 장으로 발광 지속 시간은 판단하지 않는다. |
| `combo_mage_05.png` | `5/5타 · 마무리`와 버튼 안내는 읽힌다. 여러 큰 피해 숫자·FINISH가 상단 대부분과 표적 HP 영역을 덮고 하단 가드 붕괴 문구도 겹친다. 전투 숫자·상태 텍스트의 잔존 P2 판독 문제를 재확인한다. |
| `combo_rogue_06.png` | `6/6타 · 마무리`가 읽히고 도적의 몸·쌍검 궤적·발밑 표식이 구별된다. 이 정지 장면만으로 관통 이동이나 거리 선택의 손맛을 검증하지 않는다. |
| `combo_ranger_05.png` | `5/5타 · 마무리`는 읽힌다. 큰 피해 숫자·FINISH·집중 안내와 밝은 피격 적이 중앙 영웅 일부를 가린다. 마무리 실행 표시가 실제 화살 경로 전체의 가시성을 증명하지 않는다. |
| `followup_dodge-resume.png` | `회피 중`, `다음 4/6타`, `연계 1.3초`가 읽히며 기록의 dodge·resume idx 3·t 약 1.242초와 맞는다. 회피 쿨다운 숫자는 기본 회피 글자 위에 겹쳐 보이므로 선명한 숫자 대비는 추가 개선 대상이다. |
| `followup_perfect-counter.png` | 중앙 PERFECT와 같은 4타 재개 안내가 보인다. 보고서는 counterWindow 2.4초와 이를 설명하는 ARIA를 기록한다. 화면에 표시된 `연계 1.3초`는 콤보 보존 시간이며 반격 강화 시간이 아니다. 비마무리 4타에 잘못된 `강화`가 붙지 않는다. |
| `followup_resume-ready.png` | `이어치기`, `다음 4/6타`, `연계 1.0초`가 기록의 idle·resume t 약 .927초와 맞는다. 반격 창은 보고서/ARIA에서 약 2.086초지만 그 숫자가 화면에 표시된다고 주장하지 않는다. 중앙 하단의 밝은 효과와 적 겹침은 남는다. |
| `followup_counter-consumed.png` | `6/6타 · 마무리`, `연계`, `다시 누르기`로 돌아온 화면과 counterWindow 0 기록이 일치한다. 강화 소비 자체는 상태 기록의 근거이며 정지 이미지 하나로 증명하지 않는다. 큰 피해 숫자·파열·균형 붕괴 문구가 겹친다. |

다섯 마무리 기록은 세 줄의 공격 버튼 문구에 각각 scrollWidth 60/58/58px와 같은 배치 폭을 기록하며 실제 PNG에서도 버튼 밖으로 넘친 문구는 보이지 않았다. 글자는 작고 화면 한 크기에서만 확인했으므로 작은 세로 화면·실제 손가림·시력 접근성 전체의 통과로 확대하지 않는다. 새 P1/P2 제품 회귀를 추가 확정하지 않았으며, 앞선 비마무리 강화 문구 P2 수정은 기록과 화면에서 유지된다.

별도 [native-input-review.md](native-input-review.md)의 자연 RAF·native 입력 13검사 통과 기록도 읽었다. 그 scripted browser 결과는 이 fixture와 다른 증거다. 특히 벽시계 166.891초에 게임 시간 8.2745초라는 한계를 유지한다. 이번 추가 관찰은 사람의 손맛·실시간 응답성·실기기·청감·AAA·출시 승인이 아니다.

| 추가 증거 | SHA-256 |
| --- | --- |
| `report.json` | `d123571fa51e6e572b09ad91f4dd07ce34f4887b2ec54f4e2c6ffaff00d5b226` |
| `combo_knight_06.png` | `d857edb60acdc00fa67e97fea1683d6dacd6dfffab47adf6204f3598adeeee64` |
| `combo_barbarian_05.png` | `e6944cf3474dd4e9bfad5782b229b727039d35af75f0116d586a247d96cdd5c3` |
| `combo_mage_05.png` | `41037ab7300200f3fc94ab0dee21d24948274cc3c2fb39b24de0363721fbf59f` |
| `combo_rogue_06.png` | `dcfd04cfaa2b955a5f45e2397f720813e7353cee8a633a414133b16361ac4142` |
| `combo_ranger_05.png` | `92688dd37b6ff25965a31e2608a629c1a151d2c63ae4382ca0ae1e9f617ca607` |
| `followup_dodge-resume.png` | `cef76ba63b6e04d466d9ca20ee2490b35766342a6d86b9671d6fc9dafacb7e26` |
| `followup_perfect-counter.png` | `9b1fd716602985afec1d2da9c56f9b8bcba4c2c29977a3a0ad5fc91d413c5ca4` |
| `followup_resume-ready.png` | `930427b297400322c66385f532be0b408c9b43eb537f895cf98f3590af13a19c` |
| `followup_counter-consumed.png` | `a8f49406d5a5fcd509a75e6b9999ce6308ae9896e1bf8f53a22410b0b3b9ac71` |
