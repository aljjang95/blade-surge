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

- `src/engine/impact-vfx.js`: 타격·치명타·처치·스킬 착탄 중심을 인스턴스 메시 한 장(드로우콜 1, 384칸, 프레임당 72칸)에
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
