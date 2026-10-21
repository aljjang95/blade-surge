# 배포 자산 최적화 (Google Play AAB 크기)

목표는 AAB 를 서명 서비스 요청 한도(약 100MB) 아래로 줄이면서 플레이어가 알아볼 화질·음질 손실을 만들지 않는 것이다.
원본(`public/`, `asset-library/`)과 해시 계약은 그대로 두고 **빌드 산출물 사본에만** 적용한다.

## 어떻게 동작하나
`vite build`(웹, `build-channel.mjs` 의 스토어 채널 포함)가 끝나면 `vite.config.js` 의 `optimize-shipped-assets` 플러그인이 `tools/optimize/optimize-dist.mjs` 를 실행한다.

1. 제외: `tools/optimize/dist-excludes.json` 의 `entries`(모든 채널)와 `channelExcludes`(그 채널만)를 산출물에서 뺀다. `test/dist-excludes.test.ts` 가 코드 참조 여부와 채널별 BGM 일치를 검사한다.
2. GLB(`glb.mjs`): 원본 JSON 은 그대로 두고 접근자만 다시 쓴다. 접근자마다 원본과 `EXT_meshopt_compression` 중 deflate 후 작은 쪽을 고른다. 회전 애니메이션 출력만 float32 → 정규화 int16(오차 ≤ 3.1e-5)이고 위치·시간 등은 비트 단위로 같다(`hero-body-motion` 이 골반 위치 트랙을 비트 대조한다). 내장 텍스처 바이트는 건드리지 않는다. 변환마다 디코드 검증을 하고 실패하면 원본을 쓴다. 로더는 모두 three 내장 `MeshoptDecoder` 를 쓴다(런타임 CDN 없음). `models/armory-v1/` 은 해시가 고정된 로더 소스에 디코더를 붙일 수 없어 압축하지 않는다.
3. 이미지(`webp.mjs`): WebP/JPEG 를 SSIM·PSNR 합격선을 지키는 가장 낮은 품질로 다시 인코딩한다. 합격선은 폴더별이다: 적·장비 그림 strict(0.985/36dB), 배경·UI relaxed(0.975/34dB), 법선 등 data(0.99/40dB). `img/tll` 인물 그림은 건드리지 않는다. 해상도는 바꾸지 않는다.
4. 결과는 `asset-optimization.json`(제외 목록·파일별 전후 크기·해시)로 산출물에 남고, 같은 입력은 `node_modules/.cache/blade-assets` 에서 재사용한다. `BLADE_SKIP_ASSET_OPTIMIZE=1` 이면 건너뛴다.

## 소스 쪽 변환(원본 보존)
- 던전 키아트 6장: 1672x941 PNG → 1024x576 WebP(`public/img/ui-crafted/keyart/`). 원본은 `art-src/original-media/img/`.
- 입장 영상: 1080p H.264 CRF 32, 소리 없음(muted 재생). 원본은 `art-src/original-media/video/`. 재현은 `tools/optimize/convert-media.sh`.
- 지역 BGM 9곡: 원본 mp3 옆에 Opus 72kbps `.ogg`. `src/data/music.js` 의 `bgmUrl` 이 Android 스토어 채널(googleplay·onestore)에서만 `.ogg` 를 고른다. 웹·앱인토스(iOS 사파리 18.4 미만은 Ogg Opus 미지원)는 mp3 그대로다. AAC(m4a)는 Playwright Chromium 이 디코드하지 못해 쓰지 않았다.
- `asset-library` 원본 8개(교정본이 대신 쓰임)는 `import.meta.glob` 제외 패턴으로 번들에서 뺀다(`test/library-bundle-exclusions.test.ts`).

## 건드리지 않은 것
영웅·적·NPC·장비 모델의 텍스처(GLB 내장 포함)는 해상도·인코딩 모두 원본 그대로다. 음성 파일(`sfx/voice`)도 그대로다.

## 더 줄이려면(품질 trade-off, 기본값 아님)
Opus 64kbps, 이미지 합격선 추가 하향, R8 minify(`android/app/build.gradle`, 실기기 검증 필요).
