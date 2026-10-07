# 전투 스튜디오 V1 — 참격 리본과 직업 사운드

기존 다섯 영웅의 얼굴·복장·뼈·소켓·애니메이션 클립과 접촉 시점은 보존한다. 이 변경은 표시용 참격 리본과 효과음 제작 라이브러리를 다듬는 작업이다.

main 기반 `f8d6afb38df6198dffb2173a37b9ec41821d70cd`의 Git 원본 바이트와 현재 배송 원본 126개를 SHA-256으로 비교해 변경 0개를 확인했다. 여기에는 원본 voice 디렉터리의 116개 파일과 영웅 원본 GLB 5개·V3 복장 GLB 5개가 포함된다. 원본 애니메이션은 Knight·Barbarian·Mage·Rogue 각각 40개, Ranger 41개로 그대로다.

| 원본 | SHA-256 |
|---|---|
| Knight.glb | `d319d2b33777f90b4fa19df4cad020fd54b99f639896ef2fb9e9af843d86457b` |
| Barbarian.glb | `4134f0da1cf150e3e1ffb285e5fa9e34ab9c88ce8e32e07f34d8e821a96a3a17` |
| Mage.glb | `5ddeb9c41099d4efe7b93774167826ae1c36ad057ab51d64d39797103e463538` |
| Rogue.glb | `c626cbbeea606a309caa6af3d3fbbd49c5fbea7495c4b6f5f747a3aaf46bf99d` |
| Ranger.glb | `4a1db924132836b29b1a63f55b8031e06eb6ec103037017864859786982727cb` |

검사·광전사·도적의 리본은 준비 구간을 비우고 원래 접촉 구간에 색 잔광과 얇은 밝은 날을 남긴다. 광전사는 길고 넓은 잔광, 도적은 짧고 좁은 잔광을 쓴다. 손 가까이의 면을 줄여 캐릭터의 몸을 덜 가린다. 회전 공격은 기존 다중 접촉 구간 동안 리본을 유지한다. 낮은 품질은 표본 10개·수명 0.14초로 제한하고 동작 줄이기는 새 리본을 생략한다.

기존 리본은 매 프레임 기록과 Vector3 복제, 위치 배열을 만들고 색·코어 mesh를 각각 양면 렌더했다. 후보는 공격 시작 때만 만든 고정 typed-array 원형 버퍼와 두 출력 벡터를 재사용한다. 날과 잔광은 한 mesh의 한 양면 패스에 합쳤고 기존 안개·출력 색 변환·영웅 가림 방지·전투 셰이더 준비 경로를 유지한다. stop 뒤 기존 표본만 감쇠하며 강제 종료와 반복 dispose는 자원을 한 번씩 해제한다.

무기 다섯 계열과 성광·대지·그림자·불·서리·번개·궁극기 악센트에 자체 합성한 짧은 MP3 12개를 쓴다. 다섯 영웅의 기존 40개 스킬을 실제 skill id로 매핑한다. 음원 합계는 71,994 bytes이며 `public/sfx/crafted/combat-v1/manifest.json`에 제작 소스·CC0·SHA·실제 디코딩 길이·peak·RMS를 기록했다. 원본 캐릭터 기합과 대사는 별도 음성 버스와 원본 파일을 유지한다. 배송 샘플이 준비되지 않으면 기존 합성음으로 돌아간다.

제작 명령은 `python3 tools/audio/build-combat-library.py`다. Python 표준 라이브러리의 수학 파형·고정 시드 노이즈와 로컬 ffmpeg만 사용하며 외부 음원·음성 모델·유료 서비스는 쓰지 않는다. 모든 MP3를 실제 float PCM으로 디코딩해 유한값·무음·clipping을 검사했다. 최대 디코딩 peak는 0.913267, 길이는 0.23–0.66초다. 이 수치 검사는 실제 단말에서 들은 체감이나 전체 동시 믹스의 청취 승인과 별개다.

단위 회귀는 `npx --yes bun@1.4.2 test test/combat-sound-library.test.ts test/weapon-trail.test.ts test/audio-random-isolation.test.ts test/audio-mix.test.ts test/model-contract.test.ts test/fx-resources.test.ts test/combat-feel.test.ts`로 확인했다. 최종 41개 테스트·754 assertions·실패 0. 실제 release는 전투 전역 RNG나 새 타이머를 소비하지 않고 기존 SFX 16·기합 4 한도를 쓴다. 샘플 우선순위·반복 음소거·노드 종료, 리본 포화·dt=0 정지·정지 뒤 감쇠·반복 자원 해제, 기존 영웅 소켓 단위와 배송 GLB의 필수 동작을 확인했다.

첫 sound fixture는 같은 샘플을 쓰는 일반 공격과 스킬을 같은 시각에 연속 호출해 기존 80ms 중복 제한에 걸렸다. 실제 취소 창 이후의 별도 호출 간격 120ms로 fixture를 수정했으며 runtime의 기존 중복 제한은 그대로다. 실제 브라우저 셰이더·음원 디코딩·전후 화면·재출격 자원 회수와 전체 회귀는 통합 QA 증거를 따른다. 물리 기기·주관적 청취·출시 완료를 이 문서만으로 주장하지 않는다.

## 리깅·애니메이션 부서의 최종 구조 검수

새 리그나 새 클립을 제작하지 않았다. 2026-10-07 원본 GLB JSON 구조를 직접 읽어 다섯 파일의 skin, 관절 인덱스, inverse-bind accessor 수, 애니메이션 target node를 확인했다. 모든 skin의 관절 인덱스와 애니메이션 대상은 유효하며 inverse-bind 수는 각 skin의 관절 수와 일치한다. 아래 표는 저장된 원본 구조이며 런타임 병합 뒤 draw 수나 움직인 포즈의 변형 품질을 뜻하지 않는다.

| 영웅 | skin | 관절 / inverse-bind | skinned mesh node | clips | 사용 동작 예 |
|---|---:|---:|---:|---:|---|
| Knight | 1 | 41 / 41 | 6 | 40 | `1H_Melee_Attack_*`, `2H_Melee_Attack_Spin`, `Block_Hit`, `Spellcast_Raise` |
| Barbarian | 1 | 41 / 41 | 6 | 40 | `2H_Melee_Attack_*`, `Jump_Full_Short`, `Cheer` |
| Mage | 1 | 41 / 41 | 6 | 40 | `Spellcast_Shoot`, `Spellcast_Long`, `Spellcast_Raise`, `Spellcasting` |
| Rogue | 1 | 41 / 41 | 6 | 40 | `Dualwield_Melee_Attack_*`, `Dodge_Forward`, `Throw` |
| Ranger | 1 | 23 / 23 | 30 | 41 | `Bow_Shoot` |

다섯 원본 모두 `Idle`, `Running_A`, `Running_B`, `Walking_A`와 좌우 `handslot`을 보존한다. 원본 skinned primitive는 `JOINTS_0`·`WEIGHTS_0`을 함께 가진다. 이미 통과한 `test/model-contract.test.ts`가 현재 실제 combo/skill과 상태용 `requiredModelAliases()`의 배송 clip 존재를 검사하며 누락은 0개였다. V3 복장 GLB는 별도 skin/clip 대신 `tllBone` 부착 노드(Knight 34·Barbarian 26·Mage 24·Rogue 29·Ranger 13)를 가지고 기존 `assembleHeroIdentity()`가 원본 리그에 붙인다. 이 검수에서 가중치 재작성이나 새 포즈 CPU 검사는 실행하지 않았다.

현재 Knight 선택자는 기존 외형 교정 쌍 `/models/heroes-next/knight-head-balance-v1.glb`·`knight-fitting-head-balance-v1.glb`을 실제 선택한다. 이 두 배송 파일도 main 원본 바이트와 일치한다. 선택된 base는 skin 1·관절 41·clip 40이며 animations JSON은 원본 Knight와 동일하다. base SHA는 `694064b1774f4f012fcef68da380175ea432cc5e86ed9280894b7af3af0ad633`, fitting SHA는 `f59bea70236f0c2abc6c70a7d75ae61c50d3651586a21c2bd946230c96793685`다. 앞의 원본 126개 보존 검수와 이 활성 교정 쌍 2개의 보존 검수를 구분한다.

새 리본은 원본 `handslot.r`의 world transform에서 두 출력 점을 샘플링한다. 전용 자산 socket alias·scale 처리와 weapon 끝 단위는 기존 경로를 유지하며 단위 회귀를 통과했다. 밝기에는 Player의 실제 `attackProgress()`와 현재 combo의 `hitAt`을 읽고, 원래 접촉 고정 `attackPhase()`·판정·clip 선택은 변경하지 않는다. 검사 실제 키보드 공격의 자연 RAF 관측에서 progress 0.1/0.2에는 draw 0, 0.4/0.5/0.6에는 index draw 6/12/18, 0.7 이후 stop·표본 감쇠가 기록됐다. 관측 WebGL program의 link 실패 0, 브라우저 오류 0, 동작 줄이기에서 새 trail 0, 제작 MP3 12개의 44,100Hz mono decode와 실제 blade/holy/earth 재생 시작을 확인했다. 근거는 `/workspace/scratch/bladesurge-qa/fixed-native-combat-1203/report.json`이다. 이 원본 보고서의 전체 status는 동행 버튼의 오래된 QA selector timeout으로 `fail`이며 위 전투 단계의 개별 `pass`만 인용한다.

제작 Studio에서 볼 장면은 다섯 영웅의 정면·3/4·뒤 모습, `Idle`→`Running_A`→각 직업 위 사용 동작→복귀다. 손/무기 접합, 어깨·허리 장식의 관절 추종, 도약·회전 중 실루엣을 실제 클립으로 살핀다. Studio의 독립 조명과 clip 미리보기는 전투 카메라의 판정 동기화 검증과 별개다. 남은 실기기 확인은 다섯 직업의 혼전 중 무기·목소리·스킬 구분, 스피커/이어폰의 저역과 고음 피로, 음소거·백그라운드·일시정지 복귀, 실제 터치 취소 창과 손/무기 시각 간섭이다. 이번 수치·브라우저 검수로 그 체감이 승인됐다고 표시하지 않는다.
