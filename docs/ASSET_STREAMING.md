# 스트리밍 자산 (Google Play·ONE Store AAB 크기)

AAB 가 서명 서비스 한도(약 100MB)에 닿고 콘텐츠(3개월치 지역·MMO 마을·새 BGM)가 계속 늘기 때문에, 네이티브 채널(`googleplay`·`onestore`)은
부팅·첫 지역에 필요 없는 무거운 자산을 APK 에서 빼고 정식 호스트 `https://blade.tllhouse.com`(같은 빌드의 파일, Cloudflare Workers Static Assets)에서 받아 보관한다.
웹·앱인토스 채널은 아무것도 달라지지 않는다(상대 URL 그대로, `remoteAssets.enabled=false`).

## core / remote 분할 — `tools/optimize/asset-split.json`
- 규칙은 위에서부터 첫 일치가 이긴다. 산출물의 모든 파일이 core 또는 remote 로 분류돼야 한다(안 되면 빌드·`test/asset-split.test.ts` 실패).
- core: 부팅·제목·로비(1지역 마을)·튜토리얼 1-1·1지역(곡 3곡 + 중간 보스 곡 + 조우 일러스트, 키아트)·UI·글꼴·효과음·VFX 텍스처·1단계 영웅·몬스터 전부·원정 던전 보스 일러스트(로비 카드가 부팅 직후 그린다).
- remote(묶음): `region-2..6`(그 지역 곡·조우 일러스트·키아트), `arena`, `expeditions`(던전 상세 키아트·몬스터 일러스트), `cinematic`(입장 영상), `heroes-t2`·`heroes-t3`(2·3단계 갑옷 몸체), `avatars`(아바타 몸체), `bgm-extra`(규칙에 없는 새 BGM — 기본이 remote. 소환 화면 곡 bgm_gacha 1.7MB 도 여기).
- 새 지역 곡·마을 스킨 곡은 `bgm/` 에 두면 자동으로 remote 다. 새 일러스트·모델은 규칙에 한 줄 추가한다.
- 빌드(`vite build`)가 최적화 직후 `asset-manifest.json`(런타임용: remote 의 경로 → 내용 해시 16자·크기·묶음)을 쓰고, 스토어 채널은 `asset-manifest.full.json`(core 파일별 해시)도 만든다.
  `tools/build-channel.mjs googleplay|onestore` 가 web 폴더를 비우고 빌드한 뒤 remote 파일을 지우고, core 가 하나도 빠지지 않았고(해시 포함) remote 가 남지 않았는지 검사한다(실패하면 빌드 실패).

## 런타임 — `src/platform/remote-assets.js`
한 해석기가 모든 로더 앞에 선다.
- `assetUrl(path)`(동기): remote 가 아니면 입력 그대로 · 보관본이 있으면 `blob:` URL · 없으면 `https://blade.tllhouse.com/<path>?v=<해시>` 를 돌려주고 뒤에서 보관을 시작한다.
- `ensure(paths)` / `readBuffer(path)`: 내려받아 SHA-256 앞 16자를 매니페스트와 대조하고(불일치하면 쓰되 보관하지 않음) Cache Storage `blade-remote-assets-v1` 에 `?v=해시` 키로 보관한다. 재시도 2회, 동시 3개, 실패 직후 30초는 암묵 재시도를 쉰다.
- 부팅(`src/platform/remote-boot.js`, `App.boot()` 맨 앞): 매니페스트를 읽고, 보관본을 확인해 낡은 해시를 지우고, 이미지·곡·영상 보관본을 blob URL 로 복원한다(최대 1.5초 예산).
- 연결 지점: BGM 은 `audio.js` 가 `assetUrl(bgmUrl(name))`, 라이브러리 GLB 는 `assets.js` 의 `loadLibraryGltf`(바이트를 받아 `GLTFLoader.parseAsync`), 그 밖의 이미지·영상·CSS 배경·HTML 문자열(`innerHTML`)은 `remote-dom.js` 가
  `img/video/source.src`, `poster`, `style.background(Image)`, `setAttribute('src')`, `innerHTML`·`insertAdjacentHTML` 안의 `src="…"`/`url(…)` 를 같은 해석기로 바꾼다(스트리밍 채널에서만 설치).
  마지막 안전망으로 remote 경로의 `<img>/<video>/<audio>` 가 로컬 404 를 내면 한 번 호스트 주소로 다시 시도한다(`stats.fallbackHits`, 검증 흐름에서는 0 이어야 한다).
- 라이브러리 GLB 를 받지 못하면(오프라인 등) 기존 폴백(1단계 몸체)을 쓰고 그 결과를 캐시에 남기지 않아 다음 요청에서 다시 받는다.
- 표시: 내려받는 동안(450ms 이상) 화면 맨 위 가장자리에 가는 띠와 작은 알약(`remote-indicator.js`, `pointer-events: none`). 플레이 영역을 가리지 않는다.
- 사전 내려받기(`remote-prefetch.js`): 로비에 들어올 때 진행도가 X-8 이상이면 다음 지역 묶음을(데이터 절약 모드 제외, 셀룰러 포함), 와이파이·유선이면 한가할 때 다음 지역부터 `heroes-t2 → expeditions → avatars → arena → heroes-t3 → cinematic → bgm-extra` 순으로 받는다.

## 정식 호스트 요구사항
- `public/_headers`: remote 가 있는 폴더(`/img/*`, `/models/*`, `/bgm/*`, `/video/*`, `/assets/*`)에 `Access-Control-Allow-Origin: https://localhost`(Capacitor Android 출처, 자격 증명 없음). 정적 자산은 Worker 를 거치지 않아 `_headers` 로만 붙는다. WebGL·WebAudio(`createMediaElementSource`)가 CORS 를 요구한다.
- 웹 dist 는 remote 곡의 Opus(`.ogg`)도 내보낸다(`tools/optimize/dist-excludes.json` 의 web 제외는 APK 안에 있는 core 곡 3개만).
- 앱 릴리스(AAB 업로드) 전에 반드시: 웹 배포 → `node tools/check-remote-assets.mjs [매니페스트] https://blade.tllhouse.com`(모든 remote 파일의 존재·해시·CORS 헤더 확인). 호스트에 없는 파일은 앱에서 비어 보인다.
- 해시가 달라진 파일을 같은 경로에 덮어쓰면 이미 설치된 옛 앱은 새 바이트를 받는다(검증 불일치 → 쓰되 보관 안 함). 호환이 깨지는 변경(리그·계약)은 새 파일 이름으로 낸다.

## 검증
`node tools/remote-assets-qa.mjs <출력폴더>`: APK 폴더를 `https://localhost` 로, 호스트를 web dist 로 대신 응답(`_headers` 규칙 적용)하며 제목 → 로비 → 1-1 → 2지역 마을(시드)·아바타 몸체 → 캠페인 2지역 → 소환을 지나고,
호스트를 끊은 두 번째 로드가 보관본만으로 뜨는지 본다. 소프트웨어 렌더·Chromium 에뮬이며 실기기 증거가 아니다.

## 실측 결과 (2026-10-22, 클라우드 컨테이너)
- 산출물 분할: core 1521개 83.0MB / remote 81개 46.5MB(11개 묶음, 최적화 산출물 기준).
- `bash tools/build-aab-cloud.sh --version-code 3 --version-name 1.0.2`: 서명 없는 AAB 61,186,426바이트(58.4MiB, sha256 585c7164…). 이전 99.94MB 대비 약 39% 감소. 업로드하지 않았다.
- `node tools/remote-assets-qa.mjs`: 24/24 통과(로컬 404·호스트 404·CORS 0, 폴백 0, 두 번째 로드 내려받기 0·보관본 복원).

### 갱신(10진 60MB 이하)
- 소환 곡 `bgm_gacha.mp3`(1.7MB)를 core 에서 remote(`bgm-extra`)로 옮겼다. 곡은 화면이 열릴 때 받으며 화면·입력은 막지 않는다(곡이 도착할 때까지 무음).
- 서명 없는 AAB 59,506,280바이트(59.5MB, 56.8MiB, sha256 48cc8686…) — 10진 60MB 안에서 여유는 0.49MB뿐이다. 새 core 에셋을 추가할 때는 remote 규칙부터 본다.
- 시도했다가 되돌린 것: 2지역 이후 몬스터 몸체(대악마·나무 수호자·불사조 ≈3.5MB)를 remote 로 옮기면 부팅의 `preloadAll`/`App.boot` 이 `MODEL_LIST` 전체를 즉시 로드(`this.models`, 환경맵·셰이더 워밍)하므로 부팅이 호스트 요청을 하게 돼 QA 가 실패한다. 이 몬스터를 remote 로 보내려면 부팅 예열을 지연 로딩으로 바꾸는 별도 작업이 필요하다.
