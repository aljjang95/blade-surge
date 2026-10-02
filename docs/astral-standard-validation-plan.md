# 아스트랄 일반 후보 — 실행 인계

기준 계약: [네 조율판](astral-standard-constellation-contract.md). 기준 live commit ee010979ac01c94493d35ca37536428081fac300. 이 문서 작성 시 아래 명령은 **모두 NOT_RUN**이다. replay 정식 metrics와 동시에 실행하지 않는다. root의 순차 허용 후 실행한다.

1. 좁은 상태·뷰·안내·결과 회귀: `bun test test/astral-constellations.test.ts test/astral-constellation-view.test.ts test/expedition-content-contract.test.ts test/expedition-result.test.ts`.
2. 타입: `bun run typecheck`. 좁은 회귀가 통과했어도 실제 입력이나 시각 승인으로 대신하지 않는다.
3. 기존 회귀: `bun test test/route-objectives.test.ts test/nightglass-records.test.ts test/cooling-valves.test.ts test/boss-signatures.test.ts test/expedition-economy.test.ts`. 다른 지역/심층의 안내·방 수·보상/해금/패턴이 그대로인지 확인한다.
4. 실제 입력: `node tools/astral-constellation-qa.mjs --out=/NEW/ABSOLUTE/output --save=/ABSOLUTE/existing-earned-save.json`. 부모 출력 디렉터리는 있어야 하고 지정한 출력 디렉터리는 없어야 한다. 기존 파일/폴더를 덮어쓰지 않는다. root가 제공한 합법적 게임 저장의 원정 Lv.3, 에너지12 이상과 실제 전투를 이길 장비가 필요하다. helper는 입장카드/UI/AUTO/키보드/생산 입력으로만 플레이하고 HP·적·방·성좌·봉인·해금을 직접 바꾸지 않는다. 실제 HUD 단서에서 도형을 골라 오답→판 밖 재시도, 공격/스킬/회피/일시정지 취소, 수동1/4, AUTO4/4+남은 모든 방+보스 승리, 기존 정산/중복UI전달, 실제 다시도전0/4, 포기/로비 제거를 검사한다. 승리 후 1.6초 정산 대기를 정상 상태로 처리한다. 느리거나 부족한 저장으로 실패하면 내용을 보존하고 장비/게임 원인을 조사한다.
5. 원본 desktop/small clue, small partial-hold, wrong/retry, 1/4, win, giveup 이미지를 직접 보고 번호·도형·문자·판정원과 주인공이 서로 가리지 않는지 확인한다. helper의 `pass`는 이미지 승인·물리 휴대폰·성능 승인·AAA 판정이 아니다. `releaseApproved`는 항상 false다. 작은 화면에 충분한 시각 정보가 담겼는지, 단서가 선택보다 선행하는지 확인한다.
6. 실제 유지 중 적/투사체 피격과 다른 방 추격 혼전은 현재 helper에서 **NOT_OBSERVED**이며 단위 회귀만 준비돼 있다. 보류된 마지막 프레임 확인이 실제 피격으로 취소되는 장면과 clue/pads/HUD가 함께 중단되는 장면은 별도 실제 입력 증거가 필요하다. 이를 통과한 것으로 쓰지 않는다.
7. root가 전체 check/build와 동결 candidate의 정식 metrics를 독점 순차 실행한다. 다른 지역 성능과 카메라/주인공 가독성 고정 게이트를 낮추지 않는다. 시각·입력·상태·정산·기존 회귀·성능이 모두 확인되기 전에는 머지/배포하지 않는다.

이 clone은 공유/원격/axis/인증/배포를 바꾸지 않았다. 공유 checkout에서 실수로 같은 ee01097에 detach했던 작업 경로 오류는 즉시 root에 보고했고, root는 replay 브랜치/소스 SHA256 일치를 확인하여 복원했다. 그 이후 명령은 clone의 절대 workdir과 HEAD guard를 사용했다. 실제 PC에 접근하지 않았으므로 로컬 원본 맵 차이가 해결됐다고 주장하지 않는다.

## 현재 작은 기능 배포와 AAA 판정의 구분 (2026-10-02)

위 6번의 원본 미관측 기록을 유지한다. 현재 배포 단위는 solo Astral standard의 네 조율판이며 AAA 완료나 연간 유지율 판정이 아니다. 이 배포에 필수인 실제 입력 증거는 합법적으로 획득한 저장의 정상 입장, 오답/재읽기, 공격·스킬·회피·일시정지 취소, 수동 1/4, AUTO 4/4와 모든 방·보스, 정상/중복 정산, 다시도전 0/4, 포기·로비 제거다. 여기에 연결 방으로 실제 이동하여 다른 방의 살아 있는 적이 22m 이내에서 단서·판·HUD·읽기·유지를 중단하고, 이후 실제 HP가 줄며, 정상 전투 정리 후 새 읽기가 회복되는 증거가 필수다. 판 밖 이동에 의한 유지 초기화와 전투 중단은 따로 기록한다.

마지막 유지 프레임의 투사체 피격은 **NOT_OBSERVED**로 남긴다. 실제 `Player.hurt` 중단 경로와 다음 프레임 확정의 단위 회귀를 그 장면의 실제 입력 증거로 바꾸지 않는다. 고정된 일반 적 투사체 수명/속도와 전투 반경의 정적 분석은 움직이는 시전자·넉백까지 불가능함을 증명하지 않는다. 이 미관측 항목은 AAA 추가 검증에 남기며, 작은 기능 배포 통과를 근거로 삭제하거나 PASS라고 쓰지 않는다.

화면 승인은 desktop/390px portrait의 원본 현재 GPU 프레임과 실제 resize 첫 관측/안정 프레임에서 단서·A/B/C·도형·1초 표기·발·현재 판정원을 각각 확인한다. 처치 모델은 읽을 수 있는 현재 방에서만 숨기고 원래 죽음 시계·침강·제거·전리품을 유지한다. 전체 clean check, 엄격한 schema2 기존 캠페인 5쌍 성능 gate와 별도로 사전 등록한 Astral 전투/정화 × desktop/portrait 각 5쌍 렌더 비용 gate, runtime/HTTP/미디어 0 오류, view 2회 실제 수명/기존 13 RT 보존이 모두 필요하다. 실패 원본·정확한 SHA를 보존하고 기준을 낮춰 재시도하지 않는다.

물리 휴대폰, 정상 실시간 루프의 모든 프레임, 마지막 유지 중 실제 투사체 취소, 1년 반복 재미/사용자 유지율, AAA 승인, PC 원본 맵 비교는 별도 미완료 항목이다. 각 작은 기능은 동결 SHA의 검증과 보호된 배포·동일 live 버전 검증까지 완료한 뒤 다음 기능으로 진행한다.

2026-10-02 성능 사전 조건: 7f7fc33 후보의 기존 캠페인 두 번째 실행은 최대 draw421로 고정 상한420을 넘었다. 원본을 보존하고 후보를 거절했다. 평평한 slashArc/crescent RingGeometry와 `_addMat`의 ground/cast/bolt/slash/shock PlaneGeometry에 한해 투명 양면의 불필요한 뒷면 별도 패스를 제거한다. 실제 동일 프레임의 front/back 방향 GPU RGBA와 전체 compositor draw 수를 원래 두 패스와 비교해야 하며, 픽셀·도형·색·투명도·경고 시간은 그대로여야 한다. ShaderMaterial의 이미 기본 single-pass를 새 절감으로 세지 않고, 3D 기둥·ghost·actor 재질은 변경하지 않는다. 새로운 동결 후보의 전체 check/실제 QA/시각/두 성능 묶음이 모두 필요하며 기존 실패 SHA를 재실행해 승인하지 않는다.

## 독립 읽기 전용 검토

`/root/combat_readability/astral_readonly_review`는 구현·계약·기존 훅·회귀·actual-input helper를 읽고, 완료 프레임 후반 피해, C마름모45도역전, 승리→1.6초 정산 대기의 조기 실패, 접근 중 유지시간 누적, 스킬CD/MP 준비 및 fixture 증거 표현을 지적했다. 각 항목을 수정한 마지막 소스에서 추가 확정 차단/숨은 정답/진행 조작 경로를 발견하지 않았다. 이는 정적 읽기 검토이며 실행 승인이나 통과 증거가 아니다. 검토 agent도 타입·테스트·빌드·browser·metrics를 실행하거나 파일을 변경하지 않았다.

## 2026-10-02 CPU 검증 반려와 새 개선 후보

`924dc5ff66db2b33cef25bdb475d75a7c7949afd`의 새 캠페인 5쌍은 전체 반려했다. 10회 모두 승리·오류0·최대 draw420 이하였지만 두 번째 쌍의 JS 반환 wall 평균은 1.01→1.28ms로 15%를 넘었다. 기준 median1.01이므로 기존 계약의 per-pair 판정을 적용하며, 전체 median1.01→1.07과 draw385→388로 실패를 상쇄하지 않는다. 원본10개·실제 assessor exit1·실행 시각·명령·소스/Node 해시·GPU/시각/기능 증거를 보존했다. 합산 1,494개 로컬 원본 파일의 봉인 SHA256은 `208d8447bff799ac77f5869147f17ca9f8ed3fa3ee3ecd6ed236b188da0a4c03`이다. 이 봉인은 원본의 로컬 식별 기록이며 외부 백업이나 배포 승인으로 해석하지 않는다. 이 SHA로 Astral40·머지·배포를 실행하지 않았다.

별도의 정상 입장/AUTO 전투 3,000 simulation step 진단은 실제45처치를 관측했고, CDP CPU 표본에서 반복 querySelector46개가 `BattleTutorial.updateHealTip` 경로였다. 이는 실패 쌍의 함수별 프로파일이 아니므로 실패 원인을 확정하거나 새 성능 통과를 증명하지 않는다. 회복 안내는 새 안내 단계가 없는 건강 상태에서도 매 tick 열린 modal을 검색했다. 현재 안내 해제·피해 단계·modal 중단·재시도 동작을 보존하면서 새 단계가 없으면 그 검색을 생략한다. 고정 HUD 버튼의 내부 노드는 표시 준비 시 재사용하고, 조율판 HUD class는 실제 전환 시에만 바꾸며, portrait 보정이 없는 지역은 해당 보정 함수를 건너뛴다. 신규 소스 후보의 회귀·동결 build·실제 입력/시각/GPU 전체·원래 캠페인5쌍·Astral40을 다시 확인해야 한다.

데미지 숫자의 offsetWidth 읽기를 강제 배치 비용으로 추정했던 설명은 철회한다. 실제 visible HUD의96회 호출 진단에서 호출 구간의 Layout/UpdateLayoutTree는0이었고, 요소를 붙이기 전 detached 상태의 읽기였다. 그 코드는 이 CPU 개선 후보에서 변경하지 않는다. 이 진단은 합성 숫자 UI fixture이며 자연 전투·성능 통과·strict media 승인으로 확대하지 않는다.
