# TLL 공용 게임 에셋 라이브러리 — 공동 개발 지침

2026-10-12 Blade Surge에서 처음 운영한 Tripo + Blender 에셋 라이브러리를 다른 TLL 게임(로블록스 쉐도우·정원·젤리러쉬, 웹게임 등)과 함께 쓰기 위한 규칙이다.

## 결론

대표님이 기억하시는 "게임 에셋 라이브러리 스튜디오"는 이 PC에 설치된 **Game Development Studio CLI(game-dev 1.5.0)**다. 위치는 `C:/Work/tools/game-development-studio`, 실행 파일은 `%LOCALAPPDATA%/GameDevelopmentStudio/cli/game-dev.cmd`이고 catalog·package·vendor(admit)·license gate·lock receipt를 제공한다. 이것을 **공동 개발의 공용 승격 경로**로 둔다. 각 게임 저장소의 `asset-library/manifest.json`은 그 게임의 정본이고, 여러 게임에서 쓸 에셋(`shared: true`)만 game-dev 카탈로그 패키지로 승격한다.

| 층 | 위치 | 책임 |
|---|---|---|
| 생성 | Tripo Studio(대표님 Max 구독, aljjang95) | GPT Image 2.5 원화 → H3.1 HD 모델 → Auto Rig(Mixamo 65본) → 프리셋 애니메이션 → GLB 내보내기 |
| 정규화 | `tools/asset-library/ingest.mjs` + Blender 5.2 | 높이·발바닥 원점·정면 +Z, 삼각형 예산(일반 12k/보스 20k/소품 4k), WebP 텍스처, 논리 클립 이름, 해시 |
| 게임 정본 | `asset-library/manifest.json` (schema `tll.game-asset-library.v1`) | replaces 로 기존 모델 교체, provenance(taskId·원본 SHA-256) |
| 공용 승격 | game-dev catalog/package/vendor | 라이선스·무결성 게이트, 다른 프로젝트로의 복사 영수증 |

## 규칙

1. **원화는 GPT Image 2.5**로 만든다(대표님 지시 2026-10-12). Tripo Studio Image 탭에서 모델을 GPT Image 2.5로 고르고 T-Pose 템플릿을 켠다. 원화 PNG는 `asset-library/concepts/`에 보존한다.
2. 3D 생성은 원화 이미지 → HD Model(H3.1), 텍스처 2K, 폴리곤 상한 2만, Remove Lighting 켬. 웹·모바일용으로 Ultra Mesh·8K는 끈다.
3. 리깅은 인간형은 Humanoid(Mixamo 프리셋), 비인간형은 Other. 애니메이션 최소 세트는 idle·walk·run·slash·chop·hit_to_body_01·defeat이며, 마법사형은 cast_a_spell을 공격에 매핑한다.
4. 내보내기는 GLB + Export Skeleton + 전체 애니메이션 선택. 서명 URL은 `tools/asset-library/fetch-signed.mjs`로 받는다(URL은 파일 인자로만 넘기고 커밋하지 않는다).
5. 게임에 넣는 파일은 반드시 `bun run assets:ingest` → `bun run assets:verify` → `node tools/library-runtime-qa.mjs`를 통과한 것만이다. 런타임 QA는 실제 전투에서 스폰·라이브러리 리그·클립 재생·콘솔 오류 0을 단언한다.
6. 공용 승격 대상은 `shared: true`이고 특정 게임 세계관에 묶이지 않은 것(범용 몬스터, 소품)이다. 게임 고유 보스·주인공은 `shared: false`로 둔다.
7. 다른 게임으로 옮길 때는 그 게임의 엔진 계약(로블록스는 R15/Rthro 변환, 웹은 GLB)과 실제 런타임 검증을 다시 한다. 복사 영수증은 엔진 임포트나 실기기 품질 증거가 아니다.

## 크레딧 기록

Tripo Studio 잔액은 작업 전 25,195 → 5종 몬스터 생성·리깅·애니메이션 뒤 약 23,345(같은 계정의 다른 세션 사용분 포함). 모델 생성 30, Auto Rig 20, 프리셋 애니메이션 약 25(1개당), GPT Image 2.5 원화는 현재 무료 쿼터 안에서 생성됐다.

