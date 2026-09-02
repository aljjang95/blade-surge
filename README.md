# BLADE SURGE — 블레이드 서지

three.js(WebGL2) 기반 모바일 3D 핵앤슬래시 가챠 RPG 웹앱. 과금은 전부 **목업**(실제 결제 없음).

## 실행 / 배포 (Cloudflare Workers Static Assets)

```bash
npm install
npm run dev            # http://localhost:5173  (--host 로 폰에서 접속 가능)
npm run build          # dist/ 생성
npx wrangler login     # 최초 1회
npx wrangler deploy    # wrangler.jsonc 의 assets.directory = ./dist
```

- `wrangler.jsonc`: Workers + Static Assets (SPA 폴백). Pages 로 올릴 경우 `npx wrangler pages deploy dist` 도 동작.
- `public/_headers`: 모델/사운드 장기 캐시.
- PWA 매니페스트 포함(`public/manifest.webmanifest`) — 홈 화면 추가 시 전체화면.

## 조작
| 입력 | 터치 | 키보드 |
|---|---|---|
| 이동 | 왼쪽 가상 조이스틱 | WASD / 방향키 |
| 공격 (3단 콤보) | 공격 버튼(홀드 가능) | J / Space |
| 회피 (무적 0.4s) | 회피 | K / Shift |
| 스킬 1~3 | 스킬 버튼 | 1 2 3 |
| 궁극기 (게이지 100) | 금색 버튼 | R |
| 자동전투 | AUTO | — |

## 구조
```
index.html            화면 DOM (부트/로비/HUD/결과/소환연출/모달)
src/main.js           앱 부트스트랩, 로비 쇼케이스, 프레임 루프 (app.step 으로 결정적 스텝 가능)
src/style.css         UI 스타일 (모바일 세로 우선, 가로 대응)
src/engine/
  renderer.js         WebGL2 렌더러, EffectComposer(블룸 + 색수차/비네트/플래시/방사형블러), 카메라 리그(트라우마 셰이크/줌 펀치)
  assets.js           GLTF+meshopt 로더, SkeletonUtils 복제, 프로시저럴 텍스처
  fx.js               GPU Points 파티클 3풀, 참격 아크/초승달, 충격파 링, 빛기둥, 번개, 무기 트레일, 잔상, 데미지 숫자
  audio.js            Web Audio — Kenney 샘플 + 합성(휘두름/저역펀치/폭발/번개/마법), BGM 크로스페이드·덕킹, 햅틱
  input.js            가상 조이스틱 / 액션 버튼 / 키보드
src/game/
  actor.js            공통 액터(애니 크로스페이드, 히트플래시, 넉백, 경계)
  player.js           콤보 상태기계, 스킬 캐스팅, 회피, 자동전투 AI, 피격
  skills.js           16종 스킬 구현 (영웅 4 × 스킬 3 + 궁극기)
  enemies.js          적 AI(추격/예고/공격/경직/회피), 원거리, 보스(회전·강타·소환·광폭화 페이즈)
  battle.js           웨이브/보스 진행, 히트 판정, 투사체, 히트스탑/슬로우모, 궁극기 연출, 승패
  arena.js            KayKit Dungeon 파츠로 아레나 조립(InstancedMesh), 테마 조명, 횃불
  economy.js          세이브(localStorage), 화폐/에너지, 영웅 성장, 장비 강화, 가챠(천장/소프트천장), 상점 목업, 배틀패스, 출석/우편/임무
src/data/             영웅·장비·스테이지·상점 데이터
src/ui/
  ui.js               HUD, 결과창, 모달, 목업 결제 시트, 부활 유도, 광고 목업
  meta.js             로비 탭(모험/영웅/소환/상점/패스), 소환 연출, 설정
public/models/        KayKit CC0 GLB (meshopt 압축)
public/sfx, bgm/      Kenney CC0 SFX, OpenGameArt CC0 BGM
public/img/           GPT 생성 이미지 (초상/아이콘/배경/로고)
```

## 결제 연동 지점
`src/ui/ui.js` → `paySheet(sku)` 가 목업 결제 시트. 실제 서비스 시 여기서 Google Play Billing / App Store / PG 호출 후 서버 검증 → `economy.purchase(id)` 호출로 교체.
광고 보상은 `watchAd()` (AdMob 등 리워드 광고 SDK 연결 지점).

## 에셋 라이선스
- 3D: KayKit Adventurers / Skeletons / Dungeon Remastered — Kay Lousberg, CC0
- SFX: Kenney Impact Sounds / Interface Sounds / Casino Audio / Music Jingles — CC0
- BGM: OpenGameArt CC0 — "JRPG Epic Rock Battle Theme #1", "Boss Battle #9 [Metal]", "Dark Shrine Loop", "Determined Pursuit"
- 이미지: ChatGPT 이미지 생성 (프로젝트 전용)
