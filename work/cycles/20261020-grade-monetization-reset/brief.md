# 20261020-grade-monetization-reset — 등급 과금 흐름(소환·초월·상점)과 스킬 초기화 캐시템

- 저장소/기준: aljjang95/blade-surge @ origin/main 8185b8b · 2026-10-20T06:30Z · 점유 01a157f9-c940-71b0-8ab7-e624b223bb25 (루프 영웅별-mirelo-효과음등급-과금자동-타겟-평타auto-클리어스킬-vf 2번 덩어리, 지휘 01a15674-a908-7b63-8bfd-ac335363916a)
- 왜 지금: 대표님 원문 "뽑혀지는 등급에 따라서 스킬이나 강함이 전부 다른 … SR과 SSSR … 캐시 플로우랑 엮어서 과금에 대한 구조", "스킬을 잘못 찍으면 … 스킬 초기화라는 캐시템을 사서 초기화를 하던가 돈이 없으면 다시 키운다". 1번 덩어리(8185b8b)가 등급 수치·초월 화면·초기화 로직을 넣었고, 이번에 흐름 연결과 실제 화면 검증·경제 점검을 닫는다.
- 이번에 하지 않는 것: 실제 결제 SDK·영수증 검증(결제 미연결 표시 유지), 드랍·지역 진행(D7·D8), 파티 게스트 원격 타격음(D1c), S26 실기기(D10).
- 환경 개선: 등급·과금·초기화 브라우저 QA를 한 스크립트(tools/gogo-qa-20261020-grade.mjs)로 묶고, 경제 추정을 실제 데이터 모듈에서 계산하는 도구(tools/economy-estimate.mjs)를 둔다.
- 설계도: work/blueprint progression-20261019 그룹(transcend-screen·skill-tree-screen·monetization) slice 재사용. 레이아웃 방향 변경 없음(작은 수정: 재료 행 안내 버튼, 상점 흐름 줄, 소환 SSR 확정권 버튼).

## 사용자 관찰 결과
- 전: SSR 확정권은 확률 정보 창 안에만 숨어 있고, 초월 재료가 부족하면 결제 준비 중인 현금 패키지로만 안내되며, 상점 상품이 무엇을 위한 것인지(소환·초월·초기화) 흐름이 보이지 않는다.
- 후: 소환 화면에 SSR 확정권 버튼이 보이고, 중복 영웅은 "조각 +10 · 초월 n/필요"로 보이며, 초월 화면의 부족 재료마다 구할 곳(소환·상점 강화 탭·골드 상점)으로 바로 간다. 상점은 "보석 → 소환 → 중복 조각 → 초월 → 더 강한 전투" 흐름과 상품별 용도를 보여 주고, 현금 상품은 결제 준비 중으로만 보이고 지급하지 않는다. 같은 영웅을 SR·SSR·SSSR로 바꾸면 전투 수치와 연출이 등급표대로 달라진다. 스킬을 잘못 찍으면 무료 구간·초기화서·보석 300으로 초기화해 SP를 전부 돌려받는다.

## 수용 기준
| id | 관찰 가능한 기준 | 증거 표면 | 담당 | 출처 |
|---|---|---|---|---|
| A1 | 같은 영웅(마법사, 시작 SR)을 SR·SSR·SSSR로 바꿔 같은 시드 전투에서 공격력·체력(×1.5/2/2.6), 스킬 피해(×1/1.2/1.45), 재사용 대기(×1/0.92/0.85), 궁극기 충전(+0/+0.1/+0.2), 전용 연출(없음/금색 링/무지개 링+오라)이 등급표대로 다르게 나온다 | 브라우저 844x390 실제 스킬 버튼 탭, 같은 시드 수치 표 + 등급별 캡처 | 통합 | D2a |
| A2 | 소환 화면에서 보석 1회 소환과 SSR 확정권 버튼을 실제로 탭하면 결과가 나오고, 중복 영웅은 "조각 +10 · 초월 n/필요"로 보이며 조각이 저장된다(새로고침 유지) | 브라우저 844x390 소환 화면 실제 탭·새로고침 | 통합 | D2b |
| A3 | 초월 화면에서 부족 재료마다 구할 곳 버튼(조각→소환, 초월석→상점 강화, 골드→골드 상점)이 보이고 실제로 그 화면으로 가며, 상점에서 초월석을 보석으로 사서 SR→SSR 초월을 실제 탭으로 끝내면 등급이 저장되고 다음 전투 수치가 올라간다 | 브라우저 844x390·1280x590 초월·상점 실제 탭·새로고침·전투 수치 | 통합 | D2b |
| A4 | 상점이 성장 흐름 줄과 상품별 용도(소환·초월·초기화·골드)를 보여 주고, 현금 상품을 탭하면 "결제 준비 중"만 나오고 보석·재료·구매 기록이 바뀌지 않으며, 보석이 부족하면 무료 획득처와 보석 탭으로 안내한다 | 브라우저 844x390·1280x590 상점 실제 탭, 전후 재화 비교 | 통합 | D2b, AGENTS 결제 계약 |
| A5 | 스킬 초기화: Lv.20 미만 무료, 초기화서 있으면 1개 사용, 없으면 보석 300으로 사용, 투자 SP 전액 반환, 각성 스킬 Q/E 장착 해제, 새로고침 유지, 저장 실패 시 되돌림, SP 도입 이전 저장의 초과 스킬 레벨 보상 SP가 초기화 뒤에도 남는다 | 브라우저 844x390 스킬 트리 실제 탭·새로고침·저장 실패 주입 + 이전 저장 픽스처 + 단위 테스트 | 통합 | D6b |
| A6 | 무과금 경로로 SR→SSR, SSR→SSSR 초월에 걸리는 기간과 보석 소비처를 실제 데이터에서 계산해 적고, 무과금 경로가 존재(현금 전용 관문 없음)하며 기준 기간을 넘으면 근거와 함께 조정한다 | tools/economy-estimate.mjs 출력 + 단위 테스트 | 통합 | 덩어리 4번 항목 |
| A7 | typecheck·전체 테스트·빌드 통과 후 같은 SHA가 정식 호스트 blade.tllhouse.com에 배포돼 다시 읽힌다 | tools/deploy.mjs 영수증·version.json·실제 탭 스모크 | 통합 | D9 |

## 계약
- 흐름 데이터: src/data/growth-flow.js (새 파일, 순수 함수) — GROWTH_FLOW 단계, skuFlowRole(sku) → {role,label} | null, shortageRoutes(quote) → [{key,label,route:'gacha'|'shop-enh'|'shop-gold'}], shardProgress(def, heroState) → {have,need,next}.
- 화면 식별자: 소환 #btn-pull-ssr(SSR 확정권 보유 시 표시), 결과 카드 중복 문구 "조각 +N · 초월 have/need", 초월 재료 행 .tc-route[data-route], 상점 #shop-flow와 상품 .si-flow[data-role].
- 경제 수치: src/data/hero-grades.js GRADE_RULES·GRADE_UP_COST, src/data/shop.js. 저장 스키마는 바꾸지 않는다(바꾸면 교차 리뷰).
- 결제: Economy.paymentAvailable() false 유지, 현금 상품은 paySheet만.

## 레인
| lane | 모델·effort | 도구·스킬(tool-routing.md 행) | 워크트리 | 쓰기 범위 | 완료 조건 |
|---|---|---|---|---|---|
| integration | Opus(지휘) | 직접 구현 | integration | src/data/growth-flow.js, src/ui/transcend.*, src/ui/meta.js, index.html, src/style.css, test | 화면 연결·단위 테스트 |
| qa | Sonnet high | playwright 실제 터치(이전 gogo-qa-20261020 재사용) | qa | tools/gogo-qa-20261020-grade.mjs | A1~A5 측정 JSON·캡처 |
| econ | Sonnet high | 데이터 모듈 계산 | econ | tools/economy-estimate.mjs, test/economy-estimate.test.ts | A6 표·테스트 |
| review | gpt-6.1-sol xhigh | 교차 리뷰 1회 | (읽기 전용) | 없음 | P0·P1 0 |

## 검증 계획
- 정적: bun run typecheck, bun test --timeout 30000, bun run build
- 런타임: bun run dev(전용 포트) + playwright 844x390·1280x590 hasTouch, 실제 탭. 상태 준비(재화·영웅 등급·레벨)와 저장 실패·이전 저장 픽스처는 주입으로 보고서에 구분. 같은 시드는 Math.random 시드 고정(addInitScript).
- 실기기: 이번 덩어리 제외(D10). 로비 UI·경제 변경이라 출시 묶음에서 S26으로 본다.

## 배포 계획
- 경로: origin/main fetch·merge → 재검사 → PR squash(main) → deploy worktree → tools/deploy.mjs(DEPLOY-blade-surge 잠금) → 정식 호스트 읽기
- 정식 표면 확인: https://blade.tllhouse.com/version.json SHA 일치, 실제 탭 스모크
- 롤백: 직전 배포 f17851af-036d-4f77-805d-8eaea8363578(버전 518462f0-05d3-43bd-b259-3b0993d71a98, main 8185b8b)

## 위험
- meta.js·index.html은 다른 채팅(citadel-command/dungeon-landing) 파일과 다르지만 같은 로비 화면이라 배포 전 origin/main fetch·merge.
- 경제 수치 조정 시 기존 저장의 재화·등급 호환(스키마 불변이면 이관 없음).

## 한도
capacity CONTINUE(gogo-context 2026-10-20T06:22Z, anthropic 5h 52%·주간 55%)
