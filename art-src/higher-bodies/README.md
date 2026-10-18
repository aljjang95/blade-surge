# 상위 다섯 몸체 저작·재현

현재 도적 2단계는 qualified37 형상과 Blender38 모션, 도적 3단계는 positions15/motion15, 까마귀는 positions29/motion29의 실제 산출물을 사용한다. 궁수 두 몸체의 승인 산출물과 기본 궁수·도적·여우 원본은 보존한다. 최신 선택·검증 기준은 [교정 계약](../../docs/higher-body-contact-contract.md)을 따른다.

| 산출물 | GLB SHA256 | 모션 원본 SHA256 |
|---|---|---|
| 도적 2단계 | bfc139cafb098ae3c707cc3d64c978faa4a2c13614be106c6c013c08e63845ed | 2ac469e237461b6a143076bd0082a93cbac245e5e5caa7ffd77a617ec1b81602 |
| 도적 3단계 | 2a5c0724d7d806283568bd9a3c6bb8a4646145bd91347dc90a602ee36a8d572f | 383ef5c78573f8f6ee3914248cfcc833800c1e26f40148e3d7e46e03a6a60918 |
| 까마귀 | d6394ad14df1d0cab00183945cb199d02a85ee8d09d6c35e13c9a9aecb3b3f04 | 0b2541de030e5b6e85a1ee30c96ef9c2975c1e91cc3f48eea2a83ce439267dc6 |

실제 Blender `.blend`, 패치·패커·프로필·원본 JSON과 실패 로그는 관리 작업 `20261018-010039-a721567d` 및 다음 원본 묶음에 보존한다. 각각 원격 raw 다운로드와 전체 manifest SHA를 검증했다.

- [도적 2단계 Blender38 형상·모션 원본](https://drive.google.com/file/d/1Jb0HVxMJnx6ggGHHJXZHPxBf7YVNlGi1/view)
- [도적 3단계 Blender 원본](https://drive.google.com/file/d/1b6OmEhlOaCYHiZn19lObU6BnKb2PKWzn/view)
- [까마귀 Blender 원본](https://drive.google.com/file/d/1uTff8JcuXvRSXOYEZa7En07u6zyoaJsM/view)
- [fresh39 수치 검사·원 실패·검증 소스 원본](https://drive.google.com/file/d/1A-jDTok5UIHkAswXpeWqZnfA2V6KMtmh/view)

재현은 정본 재개 인덱스와 작업의 config·source manifest를 먼저 대조하고 기존 관리 checkout에서 한다. 새 출력 경로만 사용하며 원본·실패 증거를 덮어쓰지 않는다. `ralph-state init`은 이 환경에서 차단되어 실행하지 않는다. 파일 모드 기록을 정식 Ralph 장부·DOD 잠금으로 표현하지 않는다. 실제 모델은 Codex/Astra이며 Opus 실행이나 실제 Android 검증을 주장하지 않는다.

## 이전 내부 후보03 저작·재현 기록

현재 작업 트리의 5몸체 GENERATED/useInGame:true와 모션 bodies 5개는 실제 파일 SHA에 연결된 **내부 QA 후보**다. 공개 출시 승인이나 전체 접지 통과를 뜻하지 않는다. INTERNAL-CANDIDATE-03.json은 candidateOnly:true/releaseApproved:false다.

실제 파이프라인은 normalized 원본 → lower03 → contact05 → contact10(all5), 이후 foot02(rogue2/rogue3/crow만)다. 모션은 motion01(ranger2/3 보존)과 motion03(foot02의 도적 3종에 새로 결속)이다. contact10에서 ranger2/3/crow는 contact05 전체 GLB 바이트를 통과시키며, foot02는 ranger2/3를 입력받거나 수정하지 않는다. 모든 원본과 실패/이전 후보는 덮어쓰지 않는다.

| 단계 | root 실제 프로세스 | 상태 |
|---|---|---|
| lower03 | Blender19012 / pack46952 | exit0, 첫 하체 후보 이력 |
| contact05 | Blender21832 / pack3464 | exit0, contact10의 고정 입력 |
| contact10 | Blender26832 / pack47760 | exit0, 다섯 GLB 생성 |
| foot02 | Blender59772 / pack15036 | exit0, 도적 3종 발 후보 |
| motion03 | Blender57648 | exit0, 실제 foot02 몸체 부착 후 저작 |
| 내부 후보03 설치 | 36608 | exit0, 공개 서비스 변경 없음 |
| 최종 QA v3 dense | 15868 | exit1: native local REST 단위 판정 및 실제 stance 실패, 수용 보류 |

motion01 ranger 패킷은 기존 실제 저작 산출물을 그대로 유지한다. 이 요약은 그 이전 실행 PID를 재확인한 것으로 주장하지 않는다. root의 최종 dense03은 전정점 posed parity/canonical 불변/motion identity/shared 배열은 통과했으나 전체 수용은 실패했다. rogue2 chop/stab, rogue3 stab, crow chop/stab stance 실패와 native local REST 단위 판정은 별개로 해결해야 한다. v3/실측03 원본은 보존한다. root read-only extractor26996(exit0)은 bone local 차이가 원본/canonical의 기존 차이임을 exact 재현했다. QA v4는 native localMax를 보존하면서 local 3×3/homogeneous 1e-5, 양 실제 parent world 선형부로 변환한 translation norm 1e-5m로 단위를 분리한다. world/inverse1e-5·posedXYZ1e-6·stance/floor 기준은 그대로이며 새 실제 QA는 아직 실행 전이다. GPU·게임 플레이·모바일 viewport·정식 check·최종 공개 승인은 아직 미완료다. after08 원본/후보 전체 Drive archive도 아직 완료되지 않았으며 전송·해시 readback을 별도 완료해야 한다.

## 현재 저작 재현 계약

실제 Blender는 root 단일 실행자가 설치된 blender-headless runner custom script로 실행한다. `_common.task_args/run/file_record`를 사용하며 runner가 **새** `--report`를 추가한다. 아래 `<new-...>`는 기존 디렉터리가 아닌 새 경로여야 한다. 예전 성공 out에 재실행하거나 보고서를 덮어쓰지 않는다.

Contact10: `author_contact_fit_v3.py --repo <repo> --contact-dir <job>/artifacts/higher-contact-05 --out-dir <new-contact-out>`; 이후 `node pack-contact-fit-v3.mjs`에 동일 인자를 준다. 정확05 SHA/원본·reference/허용 BIN 성분을 재검증하며 현재 v3 저작 계약은 아래 08→09→10 이력의 누적 결과다.

Foot02: `author_foot_fit_v1.py --repo <repo> --profiles <job>/scratch/FOOT-FIT-INPUTS-02.json --out-dir <new-foot-out>`; 이후 `node pack-foot-fit-v1.mjs`에 동일 인자를 준다. profile은 정확 contact10 rogue2/rogue3/crow 파일 SHA를 담는다. public rogue T1 v2 `19f7e1492d947c6055cbbd8b51f3ee355c5c72f8ec4ab6296be32fb9d1e1c846` 기준 ankle-relative quantile affine이다. 목표 sole .006m, 같은 쪽 Foot 양수 의미영역, 보호 weld pin, geodesic C1 폭 .10/.20/.15m, ankle+.03→+.22m fade, .15m 최대 이동을 적용한다. 가중치 강도로 변위를 줄이지 않는다. WEIGHTS/JOINTS와 pure-leg coat는 보존한다. raw/REST triangle ratio>.03/<25, normal dot>0, 실제 Bpy REST 양방향 1e-4와 packer 독립 field/BIN 검사를 유지한다.

Motion03: `author_body_motion_v1.py --repo <repo> --profiles <job>/scratch/MOTION-PROFILES-03.json --out-dir <new-motion-out>`를 설치 runner로 실행한다. profile에는 정확 foot02 GLB 경로/SHA, canonical rogue V2 SHA, 고정 artist keys가 있다. source action을 복제해 부모축·gain을 실제로 읽고 120Hz+원본키+artist키를 bake한 Hips.position track만 JSON으로 기록한다. 그 외 curves/actions/bone rest 불변을 확인한다. skinMin/접지 측정은 검증용이며 높이 곡선의 입력으로 사용하지 않는다. 원본 패킷 SHA를 계산한 뒤 번들의 body/base/output path·SHA를 실제 파일에 결속한다. 재저작은 `.blend`/원본 JSON/author report와 source/profile SHA를 모두 보존해야 한다.

발 저작 결과는 .blend/.patch.json과 패커 GLB/개별 report/foot-pack-report.json, 모션 결과는 자산별 .blend/raw JSON과 runner author report다. .blend는 imported corner normals, 몸체 GLB는 영향 seam 회전 normals여서 shading 동일성을 주장하지 않는다. 발·머리·가슴 정체성 및 삼각형/수치 기준을 실제 실패 없이 통과했다는 최종 판정은 root의 전체 dense와 시각 검증 뒤에만 가능하다.

## 과거 시도 이력

아래 원문은 각 시도 당시의 계약·진단 기록이다. 당시의 “현재”, “실행 전”, “첫 후보” 및 out-dir은 역사적 문맥이며 위 내부 후보03 상태를 대체하지 않는다. 실패 기준을 완화하거나 과거 실패를 성공으로 소급 변경하지 않았다.

# 상위 몸체 하체 피팅 첫 후보

이 코드는 `hero_ranger_t2`, `hero_ranger_t3`, `hero_rogue_t2`, `hero_rogue_t3`, `avatar_rogue_crow`의 정확한 원본 SHA만 받는다. 각 직업의 normalized t1 SHA도 고정한다. 원본 여우 저작 스크립트의 GLB/REST/법선 유틸을 SHA 검증 후 읽기 전용으로 import하며, 여우의 main/SHA/sole 피팅 경로는 실행하지 않는다.

## 저작과 출력

설치된 blender-headless runner의 custom-script 실행을 사용한다. runner가 `--report`를 추가하며, 나머지 script 인자는 다음과 같다.

```text
--repo C:/Work/repos/aljjang95/blade-surge --out-dir C:/Work/jobs/20261018-010039-a721567d/scratch/lower-fit-03
```

custom script: `C:/Work/repos/aljjang95/blade-surge/art-src/higher-bodies/author_lower_fit_v1.py`

Blender 인자에 해당하는 전체 형태는 아래와 같다. 실제 실행은 root만 설치 runner를 통해 수행한다.

```text
blender --background --factory-startup --python-exit-code 1 --python C:/Work/repos/aljjang95/blade-surge/art-src/higher-bodies/author_lower_fit_v1.py -- --report <runner의 새 report.json 경로> --repo C:/Work/repos/aljjang95/blade-surge --out-dir C:/Work/jobs/20261018-010039-a721567d/scratch/lower-fit-03
node C:/Work/repos/aljjang95/blade-surge/art-src/higher-bodies/pack-lower-fit-v1.mjs --repo C:/Work/repos/aljjang95/blade-surge --out-dir C:/Work/jobs/20261018-010039-a721567d/scratch/lower-fit-03
```

실제 Blender 5.2 이상 한 프로세스가 다섯 몸체를 순서대로 import/저작/저장한다. 출력은 저장소 밖 새 디렉터리 또는 빈 디렉터리여야 한다. 기존 report와 결과는 덮어쓰지 않는다. 실패한 디렉터리를 재사용하지 말고 별도 번호로 실행한다. 설치 경로 `C:/Users/heart/.codex/skills/blender-headless/scripts/tasks/_common.py`의 `task_args`, `run`, `file_record`, `drop_import_helpers`를 직접 사용한다. glTF importer는 정점 대응을 위해 `merge_vertices=False`로 직접 호출하고, helper 제거 전에 원본 이름/armature/custom-shape 참조로 메시를 엄격히 분류한다.

각 `<asset>`마다 `<asset>.blend`, `<asset>.patch.json`, `<asset>.author.json`을 저작한다. 패커는 `<asset>.glb`, `<asset>.glb.report.json`과 전체 `pack-report.json`을 새로 만든다. batch author 성공 보고서는 runner의 `--report`에 저장한다. 실패 전 완료된 asset별 보고서와 .blend를 그대로 보존한다. 첫 후보 산출물을 자동으로 public에 복사하거나 선택 record를 활성화하지 않는다.

## 수정 범위와 독립 검사

REST는 `boneWorld * inverseBind * position`의 원본 가중 합으로 구한다. meshWorld만 곱한 좌표는 사용하지 않는다. Head/Neck/Spine 가중치가 하나라도 양수인 정점의 POSITION/NORMAL은 보호한다. 원본 REST에서 보호 정점 전체의 최소 높이를 계산하고, `fitStopY=min(hipsY, protectedMinY)`를 정한다. 나머지 정점 중 fitStopY 아래만 수정한다. 발 가중치 합 >= .30이고 발목+.02m 아래인 집합의 최저점이 sourceSole이다.

고정 후보 targetSole=.012m에 대해 `u=clamp((y-sourceSole)/(fitStopY-sourceSole),0,1)`, `deltaY=(.012-sourceSole)*(1-u*u*(3-2*u))`를 적용한다. fitStopY 경계에서 변위와 도함수가 0이고, 발바닥 아래는 일정 변위와 도함수 0이다. X/Z와 골반 본은 고정한다. 모든 보호 정점이 변위와 도함수 0 영역에 들므로 보호 mask에 의한 변위 불연속을 제거한다. Y 매핑 도함수의 하한 `min(1,1-1.5*(targetSole-sourceSole)/(fitStopY-sourceSole))`도 >.05인지 검사한다. 멀리 떨어진 낮은 보호 의상 때문에 하체 변화가 일찍 끝날 수 있는 보수적 선택이다.

- 실제 Blender 원본/수정 REST 양방향 최근접 오차 <= 1e-4m, importer 정점 수 동일.
- 정점 이동 <= .20m, 영향받은 비퇴화 삼각형의 면적비 > .03 및 < 25, 원본/수정 법선 내적 > 0.
- JOINTS/WEIGHTS/UV/indices/materials/textures/nodes/skins/animations 불변.
- GLB BIN은 명시 POSITION/NORMAL 성분 밖 바이트 완전 일치. JSON은 POSITION accessor min/max 외 구조/값 완전 일치.
- 패커는 float32 결과에서 C1 좌표와 삼각형 조건을 독립 재계산하고 seam 법선 회전을 확인한다.
- 하체 법선은 원본 POSITION+NORMAL을 1e-7로 묶은 seam 그룹의 면적 법선 변화에 따라 회전한다. 원본 hard seam은 합치지 않는다.

현재 .blend는 수정된 실제 geometry/가중치/UV/REST와 원본 imported corner normals를 보존한다. 패킹 GLB는 명시된 하체 법선 회전을 적용하므로 두 파일의 동일 shading을 주장하지 않는다. 보호 상체 법선은 둘 다 원본을 유지한다. 최종 시각 검토는 배포 후보 GLB를 기준으로 하며, .blend 하체 법선 차이는 보고서에도 기록한다.

## 채택 조건과 한계

첫 후보이며 모든 클립 접지 통과를 주장하지 않는다. root가 301 균등 sample + 모든 key time의 direct/swap 실제 스킨 수치와 실제 화면을 검증해야 한다. rest/idle/shoot 지지발 abs<=.02m, 모든 clip min>=-.01m을 유지한다. 하체 범위를 벗어난 망토/팔/머리 관통이나 여전히 남은 동작 문제는 원인 정점/가중치/시각 근거로 별도 계약한다. 전체 리그 교체, 체형/머리 축소, 가중치 변경, runtime clamp, 상수 root lift, 클립 추가/수정은 이 후보에 없다.

모델 표기는 실제 Astra fallback이다. Opus 실행 성공이나 미실행 Blender 결과를 주장하지 않는다.

## 첫 실행 이후 교정

01 실행은 궁수/도적 네 몸체 저작 검사를 통과한 뒤 까마귀 triangle 6700에서 normal dot=-.556945로 거절됐다. 원본 무척추 영향 정점 9964만 움직이고 Spine 영향 정점 9965/9966은 고정된 경계 때문이었다. 01 소스/첫 네 산출물은 별도 보존하고, 02는 위 protected-cutoff-c1-v2 곡선을 적용한다. 정확한 원본 raw POSITION 진단에서 보호 최저점은 까마귀 .553317m였고, 실제 저작 시에는 raw값 대신 스킨 REST 값을 다시 계산한다. guard/보호 기준은 완화하지 않았다. 02 실제 실행/접지 통과를 이 문서가 미리 주장하지 않는다.

## 02 법선 패커 진단 이후

02 Blender는 다섯 몸체의 기하 검사를 통과했다. 패커는 ranger2 v10890/10891/10892 및 ranger3 v16357/16358의 NORMAL을 거절했다. 이 정점들은 위치 변화가 없지만 인접 변형 면의 법선은 바뀌었고, Bpy32와 JS64의 cutoff 분류가 약 2–3e-8m 차이로 달랐다. 03의 profile은 protected-cutoff-c1-v3이며 POSITION C1 곡선은 02 그대로다. NORMAL은 `!protected && restY<hipsY` 집합 중 실제 changed face/seam에 속하고 면적 법선 회전으로 설명되는 변화만 허용한다. patch에 normalEligibleVertices 전체 리스트와 정의를 기록하고 패커가 독립 재계산한다. 고정 상체/보호 법선과 영향 없는 법선은 원본 그대로다. boundary epsilon이나 삼각형/접지 기준 완화는 없다. 02 소스/산출물은 보존하며 03은 새 디렉터리에 저작한다.

## Contact v2: 03 입력을 보존하는 다음 후보

새 코드 `author_contact_fit_v2.py`와 `pack-contact-fit-v2.mjs`는 lower03 저작 코드와 다섯 실제 lower03 GLB SHA를 고정한다. 기존 `author_lower_fit_v1.py`와 `pack-lower-fit-v1.mjs`, 01–03 산출물은 수정하지 않는다. 실제 원본 대비 lower03의 POSITION/NORMAL 밖 BIN과 POSITION bounds 밖 JSON도 확인한다.

설치 runner의 custom script에 다음 인자를 전달한다. runner가 새 `--report` 경로를 추가한다.

```text
--repo C:/Work/repos/aljjang95/blade-surge --lower-dir C:/Work/jobs/20261018-010039-a721567d/artifacts/higher-lower-03 --out-dir C:/Work/jobs/20261018-010039-a721567d/artifacts/higher-contact-04
node C:/Work/repos/aljjang95/blade-surge/art-src/higher-bodies/pack-contact-fit-v2.mjs --repo C:/Work/repos/aljjang95/blade-surge --lower-dir C:/Work/jobs/20261018-010039-a721567d/artifacts/higher-lower-03 --out-dir C:/Work/jobs/20261018-010039-a721567d/artifacts/higher-contact-04
```

출력 이름과 덮어쓰기 금지는 lower03과 같다. 각 asset의 .blend/.patch.json/.author.json, 이후 .glb/.glb.report.json, 전체 pack-report.json을 보존한다. actual Blender import REST 양방향 검증 후에만 패치를 기록한다.

승인된 수정은 다음으로 한정한다.

- crow/ranger2: 원본/직업별 t1 Arm–ForeArm 및 ForeArm–Hand 인접 가중 anchor와 개별 손가락 끝으로 단조 Hermite 곡선을 만든다. 보호 Head/Neck/Spine은 고정하고 어깨·해부학적 높이·팔 주변 z 범위에서 C1 fade한다. 골반 X를 좌우 기준으로 사용한다.
- rogue2/3: 원본 Hips/UpLeg/Leg만 영향을 주며 기존 Hips 슬롯이 양수인 후방 외피에서만 다리 영향을 Hips로 이관한다. hipsZ-restZ .30→.42m, ankleY+.04→+.10m, hipsY-.20→-.08m 공간 fade와 금지 영향 경계까지 .10m 표면 거리 fade를 곱한다. 발·머리·목·척추·팔 영향이 하나라도 있으면 수정하지 않는다.
- ranger3: 기존 LeftForeArm 슬롯이 있고 영향이 LeftArm/ForeArm/Hand/Thumb1만인 국소 전완에 한정한다. 실제 t1 최근접 거리 .03→.06m fade와 ForeArm mass>=.95, 원본 전완 본 구간의 proximal/distal/radial C1 및 금지 경계 .04m fade를 적용한다. 최대 0.6만 ForeArm으로 이관한다. canonical 근접 정점·거리·영향·alpha를 전수 기록한다.
- crow sole: 실제 lower03 sole가 .012m인지 확인한 뒤 .018m까지 추가 C1 피팅한다. fitStopY는 보호 최소 높이와 hipsY의 최솟값이다. 발 가중치는 그대로이며 POSITION과 영향 seam NORMAL만 바뀐다. 이 예측 개선은 실제 chop/idle/shoot dense 통과를 대신하지 않는다.

가중치 mask와 추가 sole mask는 decoded glTF float64 weighted REST에서 독립 재구성한다. Blender 실제 REST와의 1e-4m 검증은 별도로 유지한다. 가중치 변경 후 raw POSITION은 새 weighted matrix의 역으로 재표현하여 lower03 REST world를 보존한다. 이 재표현은 .001m 이하이며 실제 REST 오차 검사도 통과해야 한다. JOINTS는 그대로다. 가중치가 바뀌는 정점과 원래/새 네 영향, target slot, 표면 거리, 모든 mask 인자를 패치에 기록한다.

패커는 원본/lower03/reference에서 mask·곡선·새 가중치·목표 REST를 재계산하고, 허용 성분 밖 BIN/JSON 완전 일치, 보호 성분·발 가중치 보존, .20m 변위, 삼각형 면적비/내적, 법선 회전을 검증한다. 기존 normal 설명의 “하체”는 contact v2에서는 승인된 팔과 crow 추가 sole의 영향 seam을 포함한다. .blend는 imported corner normals를 유지하고 GLB는 명시 회전 법선을 적용하므로 동일 shading이라고 주장하지 않는다.

후방 궁수2 망토의 Hips 이관은 실제 pose에서 더 악화되어 이 후보에서 제외했다. rogue3의 보호된 목도리 장식과 crow 머리의 dodge 형상/가중치를 유지한다. 이들의 offline artist motion은 별도 승인·저작 단계다. 공유 clip·게임 매 프레임 보정은 이 코드에 없다.

## Contact 04→05 기준점 결정성

04 실제 Blender 저작은 다섯 몸체가 통과했지만 패커는 첫 네 몸체 뒤 crow Pinky anchor에서 거절했다. 좌측 원위 표본이 Bpy [3672,3673,3680,3684] / JS [3680,3667,3672,3684], 우측은 [9060,9061,9076,9086] / [9086,9029,9061,9076]로 달랐다. signedX 차이는 약 1e-8m였지만 원위 상위5% 표본의 medianY가 약 .008204m 달라졌다.

05는 source/reference anchor 모두 decoded glTF float64 weighted REST를 사용한다. 손가락 표본은 `(round(signedWorldX*1e7), vertexId)` 순서로 정렬하여 상위5%를 택한다. pointX는 quantized 정렬의 마지막 정점이 아니라 전체 표본의 unquantized signedX 최댓값이다. 패커는 anchor 좌표뿐 아니라 전체 표본 정점 ID 리스트도 일치하는지 검사한다. anchor 5e-6m, 최종 위치 3e-6m, 법선 회전 2e-5 기준은 유지했다. 04 소스·첫 네 GLB·다섯 .blend/패치를 보존하고 새 higher-contact-05 디렉터리에 저작한다. 05 실제 실행 또는 수용 통과를 미리 주장하지 않는다.

## Contact v3: 실제05 이후 의상 의미영역 저작

`author_contact_fit_v3.py`와 `pack-contact-fit-v3.mjs`만 새로 추가하며 03/v2 소스와 05 산출물은 보존한다. 실제05 GLB SHA 다섯 개를 고정하고 원본/source/reference SHA, 원본 대비 05 허용 BIN 성분 및 JSON 범위를 추가 검증한다. ranger2/ranger3/crow는 패킹 시 정확05 raw 파일 전체 바이트를 그대로 전달한다. rogue2/3만 다음 새 계약으로 바뀐다.

원본 Float64 weighted REST에서 rearcoat는 Hips/양 UpLeg/양 Leg 영향만, 기존 Hips 양수, z<-.15/y<.70인 후보에서 명시 seed와 연결된 삼각형·원본 position seam 영역을 선택한다. 경계 표면거리 .10m C1, 상단 y .45→.70 fade와 후방 거리 .20→.30 fade를 곱한다. 각 정점 ID/거리/인자/alpha를 전수 기록한다. 정적 후보의 연결영역은 rogue2 540개/rogue3 1009개다. mask=1이면 hem +.17m, X는 hipsX 기준 .82배, Z 후방 거리는 .78배다. X/Z 각 변위 q에는 부호를 보존하는 C1 saturation을 적용한다: |q|<=.10은 q, |q|>=.14는 부호*.12, 사이는 u=(|q|-.10)/.04에서 부호*(.10+.04*(u-.5*u*u)). 총 이동 .25m 초과는 자동 norm cap 없이 거절한다.

같은 rearcoat 의미영역의 실제05 가중치 중 own UpLeg+Leg mass>.5, opposite mass>.14, Hips 양수인 정점에만 `(opposite-.14)*semanticAlpha`를 opposite 기존 슬롯에서 비례 제거하여 own 기존 슬롯에 원비율로 이관한다. 좌우는 원본 hipsX와 정점 X로 정한다. 이는 t1 인근 반대쪽 mass .137~.141과 실제 pose probe의 국소 근거를 따른다. Hips/Foot/그 밖의 가중치와 모든 JOINTS는 그대로다. 새 weighted REST 역변환으로 목표 의상 형상을 유지한다. 이전05 Hip 이관만으로 모든 pose가 해결되었다고 주장하지 않는다.

낮게 늘어진 scarf는 실제 preview와 동일 t1 의상 근거에 따라 명시 예외를 둔다. 원본 x>.50/y<.95이고 영향이 Head/Neck/LeftShoulder/LeftArm 네 본 안에 있으며 Head 또는 Neck 양수인 집합에서 rogue2 seed1961/rogue3 seed15274와 연결된 영역만 선택한다. 경계 .10m, x .50→.65, y .65→.95 C1 fade를 적용한다. 예외영역은 rogue2 349개/rogue3 309개이며 그 밖 Head/Neck/Spine POSITION/NORMAL/WEIGHTS는 보호한다. 이는 Head 가중치 보호의 전역 삭제가 아니다. 고정 이동 벡터는 실제 t1 reference seed7263/8040의 REST에서 해당05 source seed1961/15274 REST를 뺀 값이다. 개별 정점을 최근접 표면으로 투영하지 않고 같은 벡터에 각 alpha를 곱해 길이/flare를 조절한다. 최대 .30m, scarf WEIGHTS/JOINTS 불변이다.

.25/.30m은 실제 의상 치수/pose 근거로 별도 승인된 v3 국소 범위이며 이전 .20m 후보의 통과 기준을 소급 변경하지 않는다. 삼각형 면적비>.03/<25, normal dot>0, 실제 Bpy 양방향 REST 1e-4, packed 목표 REST 3e-6, seam 회전 2e-5는 유지한다. 법선은 위 의미영역 내부 affected face/seam만 변한다. 패커는 mask·참조 anchor·가중치·형상·법선과 선언 성분 밖 모든 BIN/JSON을 독립 검증한다. .blend는 imported corner normals, GLB는 명시 seam 회전 법선이므로 shading 동일성을 주장하지 않는다.

설치 runner의 새 custom script에 아래 argv를 전달한다. report는 runner가 새 경로로 추가한다. 실제 실행은 root만 수행한다.

```text
--repo C:/Work/repos/aljjang95/blade-surge --contact-dir C:/Work/jobs/20261018-010039-a721567d/artifacts/higher-contact-05 --out-dir C:/Work/jobs/20261018-010039-a721567d/artifacts/higher-contact-06
node C:/Work/repos/aljjang95/blade-surge/art-src/higher-bodies/pack-contact-fit-v3.mjs --repo C:/Work/repos/aljjang95/blade-surge --contact-dir C:/Work/jobs/20261018-010039-a721567d/artifacts/higher-contact-05 --out-dir C:/Work/jobs/20261018-010039-a721567d/artifacts/higher-contact-06
```

새 디렉터리의 다섯 .blend/.patch.json/.author.json, 패킹 .glb/.glb.report.json과 pack-report.json을 보존한다. 실제 301+allkeys/직접생성·교체/지원발/시각 검증 전에는 수용하지 않는다. geometry 공격 접촉 개선과 남는 dodge/death의 별도 authored trajectory는 분리된 작업이며 이 소스는 클립·런타임을 바꾸지 않는다.


## Contact 06 거절과 07 fade 수정

06 actual Blender는 ranger2/ranger3 두 pass-through를 보존한 뒤 rogue2 triangle11에서 area ratio .787369/normal dot -.798664로 거절했다. 세 정점15482/14953/14435의 semantic alpha가 1/1/.212754여서 ΔY .17/.17/.03617이 한 면에서 급변했다. 실패한 3소스는 PC scratch/art-attempt06-* 및 cloud *.attempt06에 exact 보존했다.

07은 허용 정점 집합과 source05/가중치 수식/최대 이동·삼각형 gate를 유지하고 fade만 명시 변경한다. coat geodesic 폭은 rogue2 .50m/rogue3 .20m이며, posterior 거리 .10→.40m, top y .30→.70m C1로 바꾼다. scarf y fade는 rogue2 .65→.95m 유지, rogue3 .55→.95m으로 넓힌다. scarf 경계 geodesic .10m와 x fade는 그대로다. 원본 Float64 REST에 lower03 곡선을 재구성한 수초 정적 전체면 근사에서 이 조합은 두 몸체의 실패0을 보였으나, 실제05 raw Float32/가중치 역변환 잔차를 사용한 실제 Blender/packer 결과가 아니다. 07 actual guard가 최종 기하 판정이다.

이 변화로 rogue2 seed14622의 alpha가 약 .0216으로 줄어 기존 공격 잔여를 충분히 교정하지 못할 가능성이 있다. 따라서 접지 전체 PASS를 주장하지 않는다. semantic z cutoff 확장은 이 후보에 없고 기존 z<-.15를 유지한다. 접지 문제를 없애기 위해 삼각형 guard를 완화하거나 얼굴/발 범위를 넓히지 않았다. 07 실행은 README 위 argv의 out-dir만 새 higher-contact-07로 바꾸고 새 report 경로를 사용한다.


## Contact 08: 실제 표식 확인 후 측면 자락과 도적2 팔

08 작성 당시 v3 계약은 이 절이며, 아래 09/10 이력이 이를 갱신한다. 위 06/07 절은 이전 시도의 이력이며, 07 소스 세 파일은 cloud `.attempt07` 및 PC scratch `art-attempt07-*`에 원문과 해시를 보존하고 readback 일치를 확인했다. 실제07 Blender/packer는 통과했지만 공격 접촉은 실패했다. root의 actual Blender marker preview PID49212(exit0), `contact-seed-preview-07` 앞/뒤 이미지 확인에서 rogue2 8351/13580/14622 및 rogue3 443/6455가 외측의 긴 coat hem임이 확인됐다. 8351을 부츠로 추정했던 가능성은 이 실물 근거로 기각했다. rogue3 9377만 부츠 바닥이며 이 08에서는 발을 추가 변경하지 않는다.

Coat geometry 후보는 원본 영향이 Hips/양 UpLeg/양 Leg 안에 있고 y<.70인 집합에서 명시 seed와 연결된 표면으로 바뀐다. Hips 영향이 없어도 geometry 후보가 될 수 있지만 Foot/Toe/Spine/Head/Neck/팔 영향이 있는 정점은 포함되지 않는다. 씨앗은 rogue2 기존 네 개에 8351/13580, rogue3 기존 세 개에 443/6455를 더한다. z hard cutoff는 제거한다. 실제 다리 축의 바깥과 후방만 C1 fade로 저작하여 연결영역 전체를 일괄 변형하지 않는다.

좌/우 각각 Foot→Leg→UpLeg의 X 위치를 그 본의 Y 구간별 smoothstep으로 잇는다. 측면 거리 d=max(0, x-leftAxisX(y), rightAxisX(y)-x), lateral L=smoothstep((d-inner)/(outer-inner))이며 (inner,outer)는 rogue2(.10,.24), rogue3(.12,.26)m다. 후방 P=smoothstep((hipsZ-originalZ-.10)/.30), union=1-(1-L)*(1-P). 최종 alpha는 union × top(y .30→.70, 1→0) × geodesic 경계 .20m이다. 원본 Float64 REST에서 모든 인자/거리/정점 allowlist를 계산하고 패커도 독립 재계산한다.

기본 hem +.17, hips 기준 X .82/Z .78와 이전 XZ soft saturation을 유지한다. XZ 변위에는 추가로 .5+.5*P를 곱해 앞·측면의 축소는 절반, 후방은 기존 값으로 연속 연결한다. 총 이동 .25m와 X/Z 각 .12m는 그대로다. 기존 국소 paint는 이 coat mask 안에서도 실제05 own>.5/opposite>.14/Hips>0/pure lower에만 허용하며 수식·JOINTS·Hips 보존은 그대로다. scarf 예외와 07의 고정 delta/fade는 유지한다.

도적2는 추가로 정확 rogue t1의 인접 Arm/ForeArm/Hand wA*wB anchor와 손가락 원위 표본에 맞춘 v2의 단조 C1 X 곡선을 재사용한다. 손가락별 서로 다른 YZ 보정은 얇은 web의 삼각형7132/7214를 뒤집는 정적 근거가 있어, 도적2만 Middle 기준 Y/Z 곡선을 모든 손가락에 공유한다. finger X 길이 곡선과 표본은 유지한다. v3129 Middle3 목표는 실제 t1 [.782555247,1.030737506,.011359926]m이며 원본 대비 Δ[-.123379942,-.003314390,-.017065814]m다. 원본 v2 파일은 바꾸지 않는다. 팔 최대 .20m, Head/Neck/Spine 보호, 모든 팔 WEIGHTS/JOINTS, 원본 rest/bind/clip/socket/UV는 그대로이며 영향 seam normal만 명시 회전한다. 팔 mask·곡선·표본 IDs·법선 허용집합과 per-vertex 목표를 패커가 독립 재계산한다.

경량 원본+lower03 Float64 재구성 정적 전체면 비교에서 승인된 coat 후보 min normal dot은 rogue2 .22937, rogue3 .43898이고, 도적2 공유 YZ 팔은 .92611 / min area ratio .50673이었다. 이 결과는 실제05 Float32 가중치 역변환을 사용한 Blender/packer 실행이나 애니메이션 접촉 검사를 대신하지 않는다. 전체 삼각형 gate(.03<areaRatio<25, dot>0), 실제 Bpy REST 양방향 1e-4, 목표 REST/법선/보호 BIN 검사를 낮추지 않았다. .blend corner-normal과 GLB 명시 회전 normal 차이는 여전히 별도 시각 검증 대상이다.

08은 위 runner/packer argv의 out-dir만 새 `artifacts/higher-contact-08`로 바꾼다. 입력은 정확 `higher-contact-05`다. 출력 덮어쓰기 금지, 첫 세 소스와 각 시도 .blend/patch/GLB/report 보존, root 단일 actual Blender/pose/시각 실행 규칙을 유지한다. Rogue3 sole .018 제안은 적용하지 않았으며 foot revision은 별도 계약이다. ranger2/ranger3/crow 출력은05 바이트와 동일하게 통과한다.

## Contact 09: 국소 coat stroke와 도적3 팔

09 작성 당시 최신 계약이며, 아래 10 결정성 수정 이력이 뒤따른다. 08 actual Blender PID55884/packer43736/coarse35132는 root 실행에서 exit0였지만 rogue2 cast_raise 새 옷자락9535와 rogue3 cast_raise Ring3 4300의 floor 기준은 실패했다. 08 세 소스는 cloud `.attempt08` 및 PC scratch `art-attempt08-*`에 원문/readback exact로 보존했다. 09 입력은 여전히 정확05이며, 앞 절의 08 기본 field를 유지한 채 아래 두 항목만 더한다.

Rogue2 coat 전체 inner를 .10→.07로 바꾸는 안은 삼각형5055/5156의 정적 뒤집힘으로 기각했다. 기존08 coat field/weight repair/팔/scarf는 유지하고, source seed9535에서 허용 coat 표면 내부 최단 geodesic 거리 d에 고정 높이 `.035*smoothstep(1-d/.25)*smoothstep(boundaryDistance/.10)`m를 더한다. 원본 삼각형 edge 길이는 Float64 weighted REST이며 position seam round1e-6은 길이0으로 연결한다. domain 밖은 통과하지 않고 pose 최소값을 입력받지 않는다. source9535은 RightUpLeg .733333/RightLeg .266667, Foot/Toe 영향0이며 기존 실제 marker 확인 coat8351과 표면거리 .192744m로 연결된다. 두 정점은 UV가 다르므로 같은 UV island라는 주장은 하지 않는다.

승인된 stroke는 정적 진단에서 96정점, source bounds X[-.479657,-.316881]/Y[.081244,.363103]/Z[.091955,.230905]에 한정됐다. seed alpha1/추가 ΔY+.035, 최종 REST 근사[-.37181984,.27240441,.20864887]이다. stroke가 weight repair alpha에 영향을 주지 않으며 Hips/Leg/Foot/모든 JOINTS는08과 동일하다. 전체 coat 최대 이동 근사 .224448m로 기존 .25m guard 안이다. scarf 최대 .30m는 별개다. 패커는 원본 domain/최단거리/경계거리/전96row와 목표 위치를 독립 재계산한다.

Rogue3에 도적2와 동일한 canonical finger별 단조 X / Middle 공유YZ C1 arm recipe를 추가한다. 정확 rogueT1 source/ref anchor와 표본 ID를 재계산하며 r2 팔은08과 동일하다. 원본 WEIGHTS/JOINTS/HeadNeckSpine/rest/IBMs/clip/UV는 유지한다. 정적 r3 팔만 검사에서2854정점, maxMove .113735m, triangle minDot .892996/minRatio .500979, 실패0이었다. v4300 target [.755063475,.991712963,.023167277], delta[-.109798663,-.015473822,-.017674318]m다. actual05 Float32 Bpy/패커/pose 결과라고 주장하지 않는다.

09는 신규 `artifacts/higher-contact-09`와 새 report를 사용한다. cloth/scarf/arm 최대 이동 .25/.30/.20 및 기존 삼각형·REST·법선·보호 gate를 유지한다. foot geometry/weight 추가 변경은 없으며 후속 foot 모듈은 별도 저작자가 맡는다. 301+allkeys/direct+swap/stance/시각 결과 전에는 수용하지 않는다.

## Contact 10: 팔 landmark Float64 결정성

09 actual Blender60408은 exit0였지만 independent packer27436은 rogue3 팔 mask에서 거절했다. 첫 세 개만 완료됐으며 전체09 후보는 수용되지 않았다. 원본09 세 소스는 cloud `.attempt09` 및 PC scratch `art-attempt09-*`에 exact 보존/readback했다.

root actual read-only diagnostic21920의 saved09 patch 비교에서 실패는 rogue3 8463~8466 네 seam 정점이었다. weight 차이는0, alpha 최대차2.7043215e-8이지만 Z 거리 fade factor 차이는3.9429715e-7로 기존2e-7 gate를 넘었다. actualLeftHand handZ .017650233581662178은 independent decodedFloat64 .01765020883826485보다2.4743397e-8m 컸다. 기존 v2 arm_profile에서 anchor는Float64였지만 bone_world와 protected_stop 탐색은 mathutilsFloat32였던 혼합 정밀도가 원인이다.

10은 v2원본을 수정하지 않고 v3에서 shoulder/hips/handZ/protectedFadeStart/곡선 landmark를 전부 decoded glTF `bones64/rest64`로 직접 계산한다. 인접/finger 표본과 PCHIP/Hermite/보호fade/최대이동 수식은 같다. 패커는 이미 Float64였으며 새 `armProfile.coordinates` 계약만 명시 검증한다. mask2e-7/anchor5e-6/curve5e-5/triangle/REST/normal 기준은 그대로다. 실제 Bpy 양방향REST는 별도 기존 gate에서 검증한다.

cloud 경량 scalar 검증에서 같은 네 정점의 새 factor와 actual09 독립JS 기대값 차이는 최대5.5511151e-16, landmark차이는 최대1.2212453e-15였다. 실제10 Blender/packer/pose 성공을 뜻하지 않는다. 새out은 `higher-contact-10`, 입력은 그대로 정확05이고09 산출물은 덮지 않는다. coat/stroke/scarf/foot/가중치/clip 계약은09와 같다. 팔 목표도 같은 수식이며 결정성 오차만 제거했다.
