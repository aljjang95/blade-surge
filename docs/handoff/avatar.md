# 아바타·장비 레인 인계 (blade-avatar#dnf, 2026-10-29)

지휘 세션: session_01H8mx3U9qK3w3SjT5hPBKSr. 이 레인 세션: session_01H8mx3TzVjMPpUykqBjUJZe.

## 끝난 것 (운영 배포·readback 완료)
| PR | 내용 | main |
|---|---|---|
| #373·#377 | 금고 2단계 장비 계승: L 귀속, 계승 의식, 장비 도감, 계승 의뢰, GPT 교차 리뷰 P2 6건 수정 | c1dbf80 |
| #378 | `docs/AVATAR_ROADMAP.md` 시즌 로드맵(가격은 후보, 판매 개시는 대표님 확인) | fcf84a8 |
| #380 | 장비 아이콘 60종(N·S·E·L) 교체, `tools/art/import-icon-png.py` | a1fd867 |
| #381 | 아바타 실시간 입기/벗기(같은 인스턴스 몸 교체·빛 와이프·프리로드)·상점 입어 보기 | 5da44de |
| #396 | 궁수 '설원 여우' 다리 가중치 분리 v2, 변형 측정기, 회귀 테스트 | 5bb83be |
| #400 | 흡혈 백작 목·어깨 찢김 8.26→5.62%, 여우·흡혈 v2 원격 아바타 묶음 | b3fcf47 |

드라칸 새 풀셋(흑철 용기사)은 대표님 결정으로 중단, 늑대인간 족장 유지.

## 진행 중
1. **여우 아바타 v3**(토끼 옷 실루엣 재디자인): 대표님 Tripo 크레딧 승인됨, 지휘가 3D 생성 중 → `R2 blade-surge-handoff/tripo-originals/avatar_ranger_fox_v3/`.
   받으면: 원본 보관 → `blender_clean_weights.py` → `tools/art/rebind-library-body.mjs --no-clips --scale=height`(검은 고양이·늑대인간 선례) → `tools/art/measure-body-deform.mjs`로 다리 번짐 ≤5%·다리 찢김 ≤4%(`test/avatar-body-deform.test.ts`) → 844×390 전후 캡처 → `avatars.js` 매핑 교체 → `tools/optimize/asset-split.json` avatars 묶음 등록 → PR·Codex 리뷰·배포·readback.
2. **풀셋 4종 3D**(아르카 성광 천사 기사·리아 은하 마녀·카인 청룡 닌자·궁수 달사슴): 일러스트 B3(7~8등신, R2 `tripo-image/B3/`)는 상점·초상용 후보. 3D용으로 리아 '5등신 정면 T포즈' 원화 브리프를 지휘에 보냄 → 결과 `R2 tripo-image/B4/mage_fullset_tpose.png`. 판정: 머리 18~22%, 정면 T포즈, 다리 분리 → 통과 시 Tripo 3D → t1 재바인드 시험 → 통과하면 나머지 3종.

## 남은 일
- 장비 아트 레인에 넘김: U 36종 아이콘, 영웅 형태 무기(`item-renders/forms`), 신발 b_mithril·b_wind 재생성.
- 실기기 GPU: 착용 클릭 시 클라우드 렌더에서 최대 0.75초 한 번 멈춤, 흡혈 백작 근접 확인.
- 계승: 일일·주간 의뢰 수령은 로컬 처리(서버 권위 컷오버 전 서버 명령으로), 도감 마일스톤 토스트는 서버 응답 전 표시.
- 원본 보관: Tripo 원본의 PC TLL-Asset-Foundry 보관, 보이스 사람 청취 확인.

## 대표님 결정 대기
- 풀셋 가격(후보 ₩9,900 대 ₩14,900), 판매 개시 시점.

## 다음 행동
여우 v3 GLB 또는 리아 B4 원화가 R2에 오면 위 절차대로 바로 시작한다.
