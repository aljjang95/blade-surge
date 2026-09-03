# BLADE SURGE — 블레이드 서지

three.js(WebGL2) 기반 **가로모드 모바일 3D 몹몰이 핵앤슬래시 가챠 RPG** 웹앱.
과금은 전부 **목업**(실제 결제 없음) — 결제 SDK 연결 지점만 만들어 둠.

```bash
npm install
npm run dev            # http://localhost:5173  (--host 로 폰에서 접속)
npm run build          # dist/
npx wrangler login && npx wrangler deploy   # Cloudflare Workers Static Assets
```

## 게임 루프
```
몹몰이 (10~28마리) → 진공 광역기로 쓸어담기 → 코인·강화석·장비 우수수 드랍
   → 자석 흡수 → 같은 등급 4개 모아 세트 완성 → 강화(+20, 파괴 위험)
   → 전투력 상승 → 더 높은 스테이지 → 부족한 강화석/보호권을 상점에서 …
```

## 조작 (가로모드 권장)
| 입력 | 터치 | 키보드 |
|---|---|---|
| 이동 | 좌측 가상 조이스틱(터치한 곳에 생성) | WASD / 방향키 |
| 공격 (3단 콤보) | 공격 버튼(홀드 가능) | J / Space |
| 회피 (무적 0.4s) | 회피 | K / Shift |
| 스킬 1~3 | 스킬 버튼 | 1 2 3 |
| 궁극기 (게이지 100) | 금색 원형 버튼 | R |
| 자동 전투 | AUTO | — |

세로로 잡으면 회전 안내가 뜨고, "세로로 계속하기"로 무시할 수 있다.

## 전투 설계
- **몹몰이**: 웨이브당 10~28마리를 한꺼번에 깔고, 죽는 만큼 큐에서 보충한다.
  동시 생존 상한은 그래픽 설정에 연동(낮음 16 / 보통 24 / 높음 34).
- **진공(vacuum)**: 방패 강타·회오리·대지 분쇄·빙결 폭풍·환영 난무 등 다수 스킬이
  적을 중심으로 끌어당긴 뒤 때린다. 기본 콤보 3타(마무리)도 약하게 끌어당긴다.
- **몬스터 34종 · 챕터마다 다른 로스터** (KayKit + Quaternius Ultimate Monsters, 둘 다 CC0)
  · 1장 언데드: 해골 병사/자객/주술사 · 원령 · 해골 망령 · 부패 슬라임 · 뼈 오크
  · 2장 오크·악마: 오크 전사/꼬마 오크 · 부족 전사 · 가시 수호병 · 임프 · 화염 정령 · 독침벌
  · 3장 이계·용: 심연/가시 슬라임 · 이계 침입자 · 부유 촉수 · 포자 괴물 · 그림자 닌자 · 심연 눈알
- **엘리트 9종**(챕터당 3): 크고 단단하며 장비 **확정 드랍**. 발밑 금색 링으로 난전 중 식별.
- **보스 3종**: 해골 군주(회전·강타·소환) / 심연의 대악마(대시·회전·소환) /
  고대 용 발카르(브레스 부채꼴·강타·소환). 60%·30%에서 페이즈 전환, 30%부터 광폭화. 붉은 링 표시.
- 적 밀도에 따라 카메라가 자동으로 줌아웃하고, 자동전투는 **가장 밀집한 무리**를 조준한다.

## 성장 / 과금 (전부 목업)
| 축 | 내용 |
|---|---|
| 필드 드랍 | 코인·강화석·장비가 3D로 튀어나와 자석 흡수. SR/SSR은 빔 + 팡파레 |
| 세트 | 등급별 4종(신병/용병/기사단/용살자). 2세트·4세트 효과가 스탯에 즉시 반영 |
| 강화 | +0~+20. **+8까지 100%**, +12부터 **파괴 위험**, 실패 시 단계 하락 |
| 소모품 | 강화석(재료) · 보호 주문서(파괴 방지) · 축복 주문서(성공률 +20%) |
| 가챠 | 천장 80회, 소프트천장 60회, 10연 SR 이상 보장, 중복 시 조각 +10 |
| 그 외 | 배틀패스 30단계 · VIP · 월정액 · 첫 결제 2배 · 부활(보석) · 광고 2배 보상 |

결제 연결 지점: `src/ui/ui.js` → `paySheet(sku)` (목업 시트) → 실제로는 Google Play Billing /
App Store / PG 호출 후 서버 검증 → `economy.purchase(id)`. 광고는 `watchAd()`.

## 구조
```
index.html            부트/로비/HUD/결과/소환/모달/회전안내 DOM
src/main.js           부트스트랩, 로비 쇼케이스, 프레임 루프 (app.step 으로 결정적 스텝 가능)
src/style.css         가로모드 우선 레이아웃 (좌측 세로 레일) + 세로 대응
src/engine/
  renderer.js         WebGL2 + EffectComposer(블룸·색수차·비네트·플래시·방사형블러), 카메라 리그
  assets.js           GLTF+meshopt 로더, 스킨드 메시 병합(드로우콜 1/8), VFX 텍스처 프리로드
  fx.js               GPU Points 3풀 + 플립북/마법진/화염기둥/번개/참격/충격파/잔상/데미지숫자
  audio.js            Kenney 샘플 + 프로시저럴 SFX 30여종, BGM 크로스페이드·덕킹, 햅틱
  input.js            가상 조이스틱 / 액션 버튼 / 키보드
src/game/
  actor.js            공통 액터(애니 크로스페이드, 히트플래시, 넉백)
  player.js           콤보 상태기계, 스킬, 회피, 밀집 조준 자동전투
  skills.js           16종 스킬 (영웅 4 × 스킬 3 + 궁극기), 진공·텍스처 VFX
  enemies.js          잡몹/엘리트/보스 AI, 보스 패턴 킷 3종
  drops.js            3D 필드 드랍 + 자석 흡수 + 희귀도 연출
  battle.js           웨이브·지속 스폰, 히트 판정, 진공, 투사체, 히트스탑, 승패
  arena.js            KayKit Dungeon 파츠 조립(InstancedMesh), 테마 조명, 횃불
  economy.js          세이브, 화폐/에너지, 성장, 세트 보너스, 강화, 가챠, 상점, 패스
src/data/
  rigs.js             리그별 애니메이션 맵 (KayKit ↔ Quaternius 클립 이름 번역)
  stages.js           챕터별 몬스터 로스터·웨이브·보스
  heroes/items/shop   영웅·장비(세트/강화)·상점 데이터
src/ui/               HUD·결과·모달·목업 결제 / 로비 탭·강화 패널·소환 연출
public/models/        KayKit CC0 GLB (meshopt)
public/img/vfx/       GPT 생성 VFX 텍스처 10종
public/bgm, sfx/      Flow Music BGM 6곡, Kenney CC0 SFX
```

## 에셋 라이선스
- 3D 캐릭터: **KayKit** Adventurers / Skeletons — Kay Lousberg, **CC0**
- 3D 몬스터 26종: **Quaternius** Ultimate Monsters — **CC0**
- 3D 배경: **KayKit** Dungeon Remastered — **CC0**
- SFX: **Kenney** Impact / Interface / Casino / Music Jingles — **CC0**
- BGM: **Google Flow Music** 생성 (전투2·보스2·로비·가챠)
- 이미지/VFX: **ChatGPT** 이미지 생성 (프로젝트 전용)
