# Blade Surge 수동 전투 슬라이스 — 2026-09-30

기준 main은 `da3e23a5d4d1a00990dd57d8c97b26225af4c64d`다. PR #75의 입력·로비 카메라 수정을 최신 main과 통합하면서, 로비 **메뉴 → 전투 연습**으로 기사 한 명과 해골 10체를 바로 조작하는 닫힌 연습장을 추가했다. Three.js r170·Vite를 유지한다.

## 사용과 전투

- 이동 WASD/방향키 또는 터치 조이스틱, 공격 J/공격 버튼, 회피 K/회피 버튼, 스킬 1–3과 궁극기 R. Q/E는 장착 스킬 슬롯이며 기존 레벨 제한을 유지한다.
- 각 공격 입력과 실제 콤보 타이밍을 유지한다. 회피 중 마지막 스킬 입력 하나를 보존하고 회피가 끝나면 시전한다. 정지·포커스 상실·사망·재도전에서 이전 입력을 버린다.
- 기존 던전 타일·벽·이동 마스크·적 텔레그래프·충돌·히트스탑·카메라·HUD를 사용한다. 연습장은 출구 없는 한 방이며 물약·동행·성장 각인은 연습에 개입하지 않는다.
- 현재 기사의 레벨·장비·스킬 제한을 적용한다. 흡혈 회복과 무료 불사조 부활은 공통 전투 훅을 사용한다. 마지막 처치는 해당 프레임의 피격/사망 처리 후 살아 있는 기사에게 승리를 준다.
- 에너지·물약 소비, 필드 드랍, 처치 XP, 퀘스트/캠페인 진행과 정산 보상이 없다. 정상 에너지 재생 시계는 계속 움직인다. 결과의 재도전·로비 복귀에서 원래 캠페인 전투를 복원한다.
- 도감은 현재 전투를 정지하고 닫으면 즉시 입력을 복원한다. 포인터로 누른 HUD/시점/도감 버튼은 전투 키를 가로채지 않는다. 키보드로 실행한 메뉴는 포커스를 유지한다.

## 자산과 범위

실행한 기사는 `expedition-v3` 합성 자산이며 **41 bones, 40 clips, 11 meshes, 10 textured materials**를 확인했다. 원래 배송된 KayKit CC0 리그·애니메이션과 TLL 의상을 재사용한다. 큐브 대체물이나 새 유료 생성 자산을 추가하지 않았다.

- `public/models/Knight.glb`: SHA256 `d319d2b33777f90b4fa19df4cad020fd54b99f639896ef2fb9e9af843d86457b`.
- `public/models/heroes-v3/knight-v3.glb`: SHA256 `1a462698a80c3205ad400a8215cae24720caf9369454e4f935174be51e1f0a99`.
- 별도 TLL3D 테스트의 Arca v19 (`dff6b9b7…`)와 다른 자산이다. 그 GLB나 `character-pipeline` 작업트리의 수정 자산을 교체·병합하지 않았다.

시각 기준은 기존 자산·리그·영웅 배율·카메라 방향을 보존한 844×390 실전 화면이다. 벽과 보행 마스크가 맞는 닫힌 던전을 사용한다. 새 미술 제작이나 Unity 전환은 이 변경에 없다.

## 검증과 증거

`bun run check`: **1231 pass / 1 기존 진단 skip / 0 fail**, 타입 검사·빌드 통과. skip은 `preserved exploratory diagnostics correlate two cancellations; not release evidence`라는 기존 탐색용 진단으로, 릴리스 증거에 포함하지 않는다. 기존 사망/부활·파티·처치 MP·각인 선택의 검증 조건을 유지하고, 분리한 공통 훅을 테스트 fixture에 연결했다. 연습의 이동 마스크·정산 격리·치명적 마지막 처치·흡혈 회복·무료 부활 경계를 확인한다.

`node tools/combat-practice-qa.mjs work/combat-slice/final`로 실제 격리 Chromium 입력을 재현한다. 원격 폰트 CSS만 기존 캠페인 계측과 같이 비운다. 게임의 위치·HP·피해·승리·AUTO를 조작하지 않고, native Playwright 키 입력과 Chromium touch 이벤트로 연습을 조작한다. 기능 경계에서는 고정 dt를 사용하고, 프레임 측정과 10체 완주 녹화는 실제 RAF 시간으로 실행한다.

재열기 수정 후보 `work/combat-slice/qa-gpu-r5/report.json`의 **24개 검사 PASS**: 배송 리깅/10체, HUD 실제 클릭점, 이동·정지·회피 스킬/MP/쿨다운, 터치 조이스틱 해제, 시점 버튼, 도감 정지/공격 복귀, 실제 수동 10체 처치·텔레그래프·연속 콤보, 저장 보호, 결과 재도전·중단·로비 복귀·캠페인 출격, 브라우저/자산 오류 0, 빌드·소스 정합성이다. 마지막 추가 2개는 도감과 각인의 실제 HTMLDialog `open→close→open`에서 이전 close 이벤트가 새 창의 정지를 풀지 않는지 검사한다.

같은 후보의 **RTX 3070 / ANGLE D3D11 / 844×390 / DPR 1 / 살아 있는 적 10체** 표본: 170 RAF 간격, p50 16.7ms, p95 16.8ms, 134 draw calls, 241597 triangles. 이는 데스크톱 GPU 표본이며 Android 성능 수치가 아니다. 앞선 SwiftShader 133–167ms 표본은 별도로 보존하고 GPU 결과와 섞지 않았다.

기존 `tools/metrics.mjs` 캠페인 게이트는 변경 없이 통과했다: 실제 승리 182.6 게임초, 191처치, 34드랍, 최대 생존 24, 무보상 최장18.5초, 피격 비율0.174, 7박자, draw403, 콘솔 오류0. CPU 표본 avg0.71ms/p952.2ms는 고정 dt의 SwiftShader 계측이며 실제 FPS로 변환하지 않는다. 공통 전투 훅 반영 후 최종 커밋에서도 다시 실행한다.

빌드 시작/종료에 tracked·untracked 비무시 파일의 경로·크기·SHA256을 대조하고 `dist/build-source.json`과 `dist/version.json`에 연결한다. QA는 시작 전 현재 소스/HEAD/dirty 상태를 확인하고 종료 시 다시 소스를 대조한다. 빌드 후 임시 untracked 파일을 추가한 실패 사례는 브라우저 실행 전에 거절됐다(`work/combat-slice/source-mismatch-proof/report.json`). 임시 파일은 제거했다. 최종 커밋을 새로 빌드한 실행 증거의 정본은 `work/combat-slice/final/report.json`이다.

## 검토와 남은 수용 조건

독립 OpenCodex `gpt-6.1-sol/xhigh` 검토가 도감/각인 정지 소유권, 치명적 마지막 처치, 흡혈/불사조 누락, 소스 연결 증거 결함을 재현했다. 2차 검토 `work/combat-slice/independent-review-r2.md`는 뒤의 세 건을 닫고 비동기 dialog 재열기 P2 한 건을 남겼다. 두 창의 close 이벤트에 `dialog.open` 가드를 적용했으며 실제 브라우저 재열기 검사 2개도 통과했다. 마지막 경계의 독립 종결 보고서 생성 위치는 `work/combat-slice/independent-review-r3.md`다. 메인 모델의 자기 평가를 독립 검토로 세지 않는다.

물리 Android 터치·열/메모리·지속 프레임·발 미끄러짐의 정량 표본, 실제 스피커/헤드폰 오디오와 대표님 FELT는 아직 미검증이다. 반복 재시작은 실행했으나 시작 도중 OS 생명주기 취소의 전체 조합은 미검증이다. 새 원화 품질의 캐릭터 제작은 별도 작업이다. CI/검토의 정확한 HEAD 수용 조건을 확인하기 전에는 draft PR을 병합하지 않으며 production·스토어·광고비 지출을 수행하지 않는다.
