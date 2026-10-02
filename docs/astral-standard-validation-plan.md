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

## 독립 읽기 전용 검토

`/root/combat_readability/astral_readonly_review`는 구현·계약·기존 훅·회귀·actual-input helper를 읽고, 완료 프레임 후반 피해, C마름모45도역전, 승리→1.6초 정산 대기의 조기 실패, 접근 중 유지시간 누적, 스킬CD/MP 준비 및 fixture 증거 표현을 지적했다. 각 항목을 수정한 마지막 소스에서 추가 확정 차단/숨은 정답/진행 조작 경로를 발견하지 않았다. 이는 정적 읽기 검토이며 실행 승인이나 통과 증거가 아니다. 검토 agent도 타입·테스트·빌드·browser·metrics를 실행하거나 파일을 변경하지 않았다.
