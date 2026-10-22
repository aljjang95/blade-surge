# Ability VFX signatures

Elemental skills now use a small authored signature table in `src/engine/fx.js`.
Each school selects its own primary/secondary atlas pair, palette, radius and particle profile while
reusing the existing FX scheduler, particle pools and VFX textures.

## Runtime contract

- `FX.prototype.abilitySignature(position, profile, options)` clamps scale and
  lifetime so scripted skill data cannot create unbounded effects.
- Every cast has a primary and smaller secondary atlas cue so steel, fire, frost,
  arcane, nature and void keep distinct silhouettes when several party members
  hit the same target. The secondary cue stays enabled on the lite tier.
- Heavy casts add a larger ring, flash and light cue. Fire may add the existing
  fire pillar on the normal quality tier; the low quality tier omits that pillar.
- Projectile impacts pass `explode.profile` to `Battle.explode`, so legacy
  projectiles keep their generic effect and profiled impacts do not stack a
  second generic explosion over the authored silhouette.
- The method uses the existing elapsed-time FX cleanup path. No new renderer or
  external asset dependency is introduced.

## QA evidence

`tools/ability-vfx-qa.mjs` boots the compiled Vite bundle in Chromium, starts a
real Mage battle from the acquired save, invokes five real skill state
transitions, and captures each rendered frame. It does not modify HP, damage,
position, kills or victory state. The generated report and PNGs live under
`work/ability-vfx-qa/` and are local QA evidence, not shipped assets.

## 임팩트 프레임·예고·노출 예산 (2026-10-22, h1-vfx 레인)

- `src/engine/impact-vfx.js`: 타격·치명타·처치·스킬 착탄 중심을 인스턴스 메시 한 장(드로우콜 1, 2048칸, 프레임당 72칸 — 군중 2배 실측 생성 속도에서도 한 바퀴가 최장 수명 2.2초보다 길다)에
  셰이더 도형 5종(코어 섬광·불똥 줄기·별빛·충격 고리·베기 자국)으로 그린다. 시계는 `FX.update` 의 sim dt라
  히트스톱 동안 임팩트가 정지 화면으로 남는다. 난수는 `VfxRng`만 써 전투 난수 순서를 바꾸지 않는다.
- 영웅 타격 색 언어(`HERO_IMPACT_PALETTE`): 검성 금, 광전사 불씨 주황, 대마도사 비전 청, 암살자 보라, 레인저 비취.
  치명타는 영웅과 무관하게 금빛 십자 별빛 + 큰 고리 + 금 불똥으로 같은 신호를 쓴다.
- 품질: 낮음은 불똥 절반·보조 고리 생략, 동작 줄이기는 코어 1칸만.
- 적 예고: 일반 근접 부채꼴·고리 예고에 남은 시간 채움(일반 블렌딩, 마지막 15% 맥동). 고리 예고는 위험 경계를 r1에
  고정하고 공격 직전에 사그라들지 않는다. 보스 고유기·지역 위험·돌격·파티 경고 공용 셰이더는 `progress`
  채움 + 진행 앞 선 + 임박 경계 강조를 그린다. 판정(`hazardContains`)·경고 시간·도형은 그대로다.
- `FX_EXPOSURE`: 최근 장식 면적(지름² 합, 0.35초 감쇠)이 170을 넘으면 새 섬광·플립북·마법진의 RGB만 최대 50%까지
  낮춘다. 궁극기 겹침의 화면 백화를 막는다. 크기·수명·알파·난수·예고는 바꾸지 않는다.
- 조준 스킬 연출(`SKILL_VFX[*].seek`)은 조준점이 없으면 skills.js 판정과 같은 `densest` 위치 → 같은 전방 거리에 그린다.
- 불기둥·플립북 폭발 원화는 차가운 영웅색(보라·청·비취)일 때 밝기 결로 바꿔 칠한다(`textureTintMix`).
- 백화 방지 3종(2026-10-22 후속): `TEX_FLASH_MAX_DIAMETER`(10m) — 서 있는 텍스처 섬광의 최종 지름 상한. `BLOOM_ADAPT`
  (`combat-feedback.js`) — 장식 노출 누적 60 초과부터 420 까지 블룸 세기를 0.62 → 0.28 로 낮추고 초당 1.2 로 복귀(일반 타격 0~30 은 영향 없음).
  `vividDecalColor` — 밝기 0.7 넘는 파스텔 지면층(성역·시간 봉인·눈보라)은 같은 색상의 진한 색(밝기 0.6~0.72, 채도 ≥ 0.82)으로 그린다. 예고는 제외.
- 적 피격 발광은 `HIT_FLASH`(정점 .22, 상한 .26, 동작 줄이기 .16)로 묶고 처치·스킬 먼지는 흙빛(`DUST_COLOR`, 불투명 .34)이다.
- 보스·지역 위험 예고 경계선은 정체성 색과 위험 적색을 반씩 섞는다(금빛 종 예고 ≠ 검성 금빛 마법진).

## h1b 하이엔드 VFX (2026-10-22)

- 영웅별 서명: `sig-knight.js`·`sig-mage.js`·`sig-rogue.js`·`sig-barbarian.js`와 궁수 `skill-signatures.js`. 합본 `SKILL_SIGNATURES`는 레시피에 서명이 있으면 모든 스킬에 시전 순간 적용되고, 궁극기 예비 표식 `SKILL_PRELUDES`(궁수 폭풍·암살자 천 개의 칼날·메테오·지옥의 도끼)는 `start`에서 `skillPrelude`로 부른다. 모두 인스턴스 임팩트 층(드로우콜 1)과 VfxRng만 쓴다.
- 레시피 `noRune: true`: 공용 발밑 룬·궁극기 넓은 룬 링을 생략하고 서명이 발밑 문양을 맡는다(검성 물리 스킬, 대마도사·광전사 대부분).
- `InstanceRing.flush`는 업로드 전까지 갱신 구간을 누적하고 `onUpload`에서만 비운다. 렌더를 건너뛴 sim 프레임(frameGovernor)에 낸 칸이 그려지지 않던 결함 수정.
- 임팩트 층의 서 있는 빛·광선 면적(`ImpactVfx.load`)도 `FX._exposure`로 들어가 `BLOOM_ADAPT` 블룸 감쇠를 받는다(용살검 착탄 뒤 화면 중앙 크림 안개 제거).
- 평타 연계 `combo()`/`HERO_COMBO`(단계별 성장·영웅별 마무리), 치명타 `_crit`(대상보다 넓은 사선 금빛 참격·바깥 광선·지면 십자), 처치(영웅색 지면 표식·파편·영혼 불꽃), 보스 고유기 예고 전용 셰이더(`bossSignatureFragmentShader`, 파티 손님 화면 포함). 지면 표식 흰 섞임은 반경 1m 20% → 3m 이상 0%.
- 측정: `node tools/hero-vfx-scorecard.mjs --out <폴더> --tag <이름> [--heroes ..] [--only ..]` — 844x390, 실제 부팅·공격·스킬 터치 + 1/60초 고정 스텝 시전, 시점 4개, 밝은 픽셀·백화·변화·채도·색상·드로우콜·파티클, 영웅별 몽타주. 피해 숫자 DOM은 기본으로 숨긴다. 증거는 커밋하지 않는다.

## h1c 일반 보스 예고·적응 품질 기록 (2026-10-22)

- 일반 보스 패턴(중간보스 X-5·최종보스 X-10·관문·파수꾼·구형 보스 키트 — `def.boss` 인 모든 적의 basic/spin/slam/fan/soulrain/dash)은
  고유기와 같은 바닥 셰이더(`src/engine/boss-warn-shader.js`, 부채꼴 shape 3 추가)로 그린다. `fx.ring`·`fx.slashArc` 에
  `boss: true` 를 주면 `FX.bossWarn` 으로 넘어가 판정 도형(원판 r1, 부채꼴 반경·반각·정면)을 그대로 그린다. 위험색은 돌진 통로와
  같은 적색(셰이더 붉은 분기: 짙은 진홍 채움·노란 열기 테)으로 통일하고, 정체성 색은 차지 빛·탄막·소환진이 맡는다.
- 경고 시간 동안 채움 0→1·진행 앞 선·마지막 22% 경계 맥동, 타격 뒤 .3초 '터짐' 잔상. 일반 블렌딩이라 블룸·노출 예산 밖이며
  화면 전체 섬광·흔들림을 더하지 않는다. 임박 맥동은 3Hz 미만(sin(progress·10)), 동작 줄이기(`calm`)는 맥동 없음. 짧은 변 < 2.4m 통로는 띠 두께를 줄인다. 돌진 통로(`EnemyDashWarning`)도 같은 셰이더 + `setProgress` 로 출발(.45)까지 채운다.
- `FX.bossCharge`: 보스 허리(0.8×scale m) 높이 정체성 색 광구(가산, 깊이 검사 없음, 색 상한 .9, 지름 ≤ 1.1×scale m)가 차오르고
  둘레 2.4×scale m 에서 빛 조각 10개(낮음 5)가 임팩트 층으로 모여든다(VfxRng). 소환은 피해가 없어 정체성 색 의식진(circle_gold)과
  둘레 불꽃으로 그린다. 동작 줄이기는 모이는 조각·광구 맥동을 생략한다.
- 파티 손님: 보스 일반 패턴 경고 id 에 `:boss` 를 붙여 손님 화면도 보스 예고 셰이더·적색으로 그린다(부채꼴은 DTO 계약대로 통로 5개).
- 측정: `node tools/boss-telegraph-scorecard.mjs --out <폴더> --tag <이름> [--stages 1-5,5-10] [--patterns ..] [--tier 2]` —
  844x390, 실제 부팅·공격 터치 1회, 스테이지 직접 시작, 패턴 고정 startAttack, 예고 25/60/93%·타격 뒤 .12초 프레임.
- 드로우콜 +13 원인 확정: `hero-vfx-scorecard` 가 매 프레임 `thermalTier`·`bloomOn` 을 기록한다. swiftshader 에서 frameGovernor 가
  첫 영웅 측정 뒤 단계 2로 올라가 블룸 패스(밉 흐림·합성, 드로우콜 13)를 끈다 — 단계 0/1 은 같은 장면에서 정확히 +13.
  전/후 비교는 `--tier 2` 로 고정한다.
- 다듬기(h1c): 화염구 착탄은 넓은 고리·마법진 채움·폭발 원화를 줄이고 지름 ≈1.1m 진한 코어+별빛(낮은 화질 유지), 레시피 `noBurst`.
  눈보라 가시·소용돌이는 `BEAM_STYLE.ice`(옅은 하늘색 심·진한 청 가장자리·끝이 가는 결정), 프리즘은 삼각 윤곽+분광 다섯 갈래
  `BEAM_STYLE.prism`(옅은 청 코어·섬광 제거). 궁수 관통 `screenReach` 는 끝점 표식이 844x390 화면 안에 들도록 표시 거리만 .5m 단위로
  줄인다(최소 5m, 투사체 사거리·판정 불변).
