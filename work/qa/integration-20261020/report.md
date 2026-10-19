# 통합 검증 기록 — 2026-10-19 23:35:55 UTC

대상: 통합 브랜치 `codex/rsi-verdigris-altars-20261014` HEAD `7dd3aea` (origin/main 05d2259 위, main보다 20커밋 뒤)

## 병합한 레인
- 레인 A 전투 `9cff177` → `33ac488` (AUTO 27개 시나리오 무사망 클리어, 보고서 work/qa/auto-20261020/report.md)
- 레인 C 성장 화면 `c28474f` → `3abe9b3` (성장 화면이 열린 동안 로비 3D 영웅 숨김)
- 오디오 수정 `45277cd` → `7dd3aea`
  - `82c91cb` 파티 타격음에 공격자 무기 전달(호스트에서 다른 멤버 영웅 접촉음이 섞이지 않음)
  - `c5bc3bc` 디코드 피크가 0dBFS를 넘던 Mirelo 4개(coin0 1.445, ui_click 1.122, magma_zone 1.000, gale_hunt 1.036)를 원본 WAV(sourceSha256 일치)에서 0.82~0.85로 재정규화. 새 생성·비용 없음. manifest는 sha256·decodedPeak·decodedRms·onsetMs만 변경(bytes·durationSec는 같은 값), 출처 필드 보존
  - `45277cd` 타격 레이어 이득 합 상한 1.8 → 최악 피크 합 2.037 → 1.593(기준 1.75). 영웅 접촉음이 모든 등급에서 가장 큰 접촉 성분
- 테스트 정리: `688bad8`, `fdf7721` (dopamine-contract 저장 대체·장착 계약)

## 결과
| 검사 | 결과 |
|---|---|
| `bun run typecheck` | 통과(exit 0) |
| `bun test --timeout 30000` | 2,399 통과 · 0 실패 (2,403개 중 4개 미실행), 261파일, 149.5초 |
| `bun run build` | 통과(13.97초). 2.47MB 청크 크기 경고는 기존과 같음. version.json "더러움"은 미추적 `.codex-remote-attachments/` 때문 |

이전 기준(594da23): 2,381 통과 · 8 실패 → 실패 8건(오디오 6, dopamine 2) 모두 원인 수정 후 같은 명령으로 재실행해 0건.

## 남은 일
- VFX 구현(skill-vfx 레시피·등급 오라), 브라우저 QA(844x390·1280x590), 실기기 QA, 임시 Runware 프록시 Worker 삭제
- 파티 게스트 쪽 원격 타격 이벤트에는 공격자 정보가 없어 영웅 접촉음을 구분하지 못함(프로토콜 화이트리스트·서버 검증 변경이 필요해 이번 범위 밖)
- origin/main 20커밋 동기화와 공개 배포는 아직 하지 않음


## 전투 진입 경로 확인(브라우저, 844x390·1280x590, dev 5344)
- `#btn-battle` 0크기: **기존 UI 흐름**이다. 현재 로비는 `citadel-command-active` 상태라 예전 `.oath-destination`(#btn-battle 포함)이 `display:none`이고, 전투 진입은 오른쪽 '추천 던전' 패널의 "출격 준비"(`#citadel-dungeon-prepare`)가 맡는다. 출석 보상 모달 전후 모두 같다. 페이지 오류 0.
- 실제 입력 재현(844x390): 출석 모달 닫기 → "출격 준비" 탭 → 원정 준비 팝업 "원정 시작 · 에너지 4" 탭 → 지역 인트로(건너뛰기 가능) → `app.mode==='battle'`, 전투 활성. 첫 탭부터 약 13.7초. 주입 없음.
- 관찰된 결함(다른 세션 소유 파일이라 기록만): 1280x590에서 추천 던전 패널의 "주요 보상" 행이 "출격 준비" 버튼에 반쯤 가려진다(844x390은 정상). 소유: citadel-command/dungeon-landing 작업.
- 캡처: work/debug/btn-battle-844.png, btn-battle-1280.png, entry-1-prepare.png, entry-2-battle.png(로컬, 미커밋)

