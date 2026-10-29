# 인계: 블레이드 서지 첫인상·연출 레인 (2026-10-29)

## 끝난 것
- PR #395 머지 → main 35e22a2. 시작 영웅 선택 C안(전장 쇼케이스) + A안 룬 서클·빛기둥 등장, 직업색 무대·안개·불씨, 배경 제거 전신 일러스트, 전용 곡 `hero-select`(FlowMusic), 선택 음성·카드 소리·확정 연출. 전투 레벨업 오로라·충격파(인스턴스 임팩트 층), 결과 화면 금빛 배지. 궁수 궤적·타격 강화(인스턴스 층).
- Codex 리뷰 4회(P1 3건 모두 인스턴스 층으로 수정), 보안 리뷰 문제 없음, test 6152 pass.
- 증거: R2 `blade-surge-handoff/first-impression/`(전환 영상 844x390, 전후 캡처, 레벨업 캡처).

## 진행 중
- PC 배포: `C:\Work\tasks\blade-firstimp-deploy.ps1`(깨끗한 detached worktree `C:\Work\tasks\blade-firstimp-deploy-35e22a2`, `node tools/deploy.mjs --auth=wrangler`, 로그 `C:\Work\tasks\blade-firstimp-deploy.log`). 끝나면 `https://blade.tllhouse.com/version.json` sha 확인.
- 셰이더 회귀 bisect: "Shader program did not link" — d047c7d 0건, 최신 main 재현 → #397~#400 사이. 판정 = 헤드리스 Playwright 1-1 진입 후 콘솔 오류 수.

## 결정과 이유
- C안 기본 + A안 연출(지휘 결정): 직업색 무대 전환이 고르는 맛이 가장 크고 왼쪽 세로 탭이 엄지에 맞음.
- 인게임 3D 대신 전신 일러스트(rembg isnet 배경 제거): KayKit 저폴리가 시안 품질에 못 미침.
- 무대 배경: R2 `blade-surge-handoff/tripo-image/starter-select/stage-bg.png` → `public/img/tll/stage/stage-bg-v1.webp`(50KB), 같은 요소 안 background-blend-mode 로 직업색 착색(요소 간 mix-blend 는 크롬 합성 층 얼룩).
- 화살 몸통 발광 메시는 인스턴싱 규칙 때문에 제외 → 전투 가독성 레인(session_01H8mx3T8m3fjgvtaxE3nZSR)이 인스턴스 방식으로.

## 남은 일
- 배포 readback, 셰이더 회귀 원인 커밋 확정·해당 레인 통보·작은 수정이면 핫픽스 PR, 390·1280 화면 깨짐 확인.
- FlowMusic 상업적 사용 문구 확인(출시 게이트). 실기기 터치·소리 확인은 대표님 플레이.
