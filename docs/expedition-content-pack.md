# 시나리오 원정 콘텐츠 팩

기본 원정은 기존 3개 지역을 유지하면서 종락의 지하 회랑, 재의 밀물 수문, 밤유리 관측소를 추가한다. 새 동선은 각기 다른 7~8개 방 그래프를 사용하고, 시작·일반·보물·엘리트·보스 방을 모두 거친다. 재료·에너지·소탕·일일 회전은 기존 경제 계약을 그대로 사용한다.

각 신규 던전은 전용 잡몹 조합과 보스 계약을 갖는다. 잡몹은 파편충·종의 잔영·시계종 주술사·사슬 벼림꾼·불씨 기록술사·밤유리 서기관 등 12개 정의를 추가하며, 폭탄·주술사·방패 행동을 조합한다. 보스는 검증된 TLL 리그를 재사용하고 `bell_toll`, `kiln_vents`, `archive_retrace` 계열의 단계별 전조를 사용한다. 새 GLB를 만들었다고 주장하지 않으며, 리그와 텍스처의 소유권은 기존 런타임 자산에 남긴다.

시계유리의 주권자 초상은 생성 원본을 `C:/Users/Administrator/.codex/generated_images/01a08c36-bc0b-7990-a96f-8e58bb40f1e8/exec-5db1d76d-5916-4657-b8f7-087df9695e8b.png`에 보존하고, 1254×1254 WebP를 `public/img/encounters/chronicle_glass_hour_sovereign.webp`로 등록했다. 등록 파일은 SHA-256 `150413c43afdf4f66c5501d3d1f839479197d8e6d894005b372467bbba6fe934`로 확인했다.

## 확인 범위

- `bun run typecheck`
- `bun run check` — 723개 테스트 통과, 빌드 통과
- `bun test test/expedition-content-pack.test.ts` — 새 그래프 도달성·보스·잡몹·초상 파일 확인
- `work/expedition-content-qa/report.json` — 로컬 Chromium 390×844 터치 에뮬레이션, 6개 카드 이미지·터치 영역·가로 넘침, 종락 회랑 실제 전투 시작 확인
- `work/expedition-boss-runtime-qa/report.json` — 원본 GLB 로더로 신규 3개 보스방을 실제 생성하고 TLL authored material 3개·텍스처 2개·보스 전조 이벤트를 확인
- `work/app-screen-qa.json` — 로컬 Chromium/Firefox/WebKit에서 PWA 설치 안내·전체 화면·네브 포커스·전투 가림 회귀 통과

실기기 설치, 실제 스피커 출력, 외부 네트워크 파티 완주, 스토어·광고·결제 채널은 이 팩의 로컬 증거에 포함하지 않는다.
