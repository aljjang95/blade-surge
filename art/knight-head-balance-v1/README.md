# Knight compact head package v1

현재 상태는 **Blender 5.2.1 LTS 실제 생성 완료 · 후속 후보 selector 활성화 · 실제 화면과 성능 미검증**이다. 체크아웃은 S 부모 `bb7b2b8b2c4d2d624b36982e103534b23815921d`, tree `92509c07c1b0ba042b41c0bfdcc0c2d991179849`에서 갈라졌다. `src/data/knight-head-balance-v1.json`은 `GENERATED/useInGame=true`로 실제 base/fitting 두 개를 함께 선택한다. 원래 다섯 영웅의 base/fitting GLB 열 개는 변경하지 않았다. 이 활성화는 후보의 loader 설정을 뜻하며 브라우저 실행·배포·시각 수락을 뜻하지 않는다.

확인된 실제 생성물은 다음 두 개다. 생성 작업의 `.blend`, 임시 decoded reference, private dependency, render 산출물은 public에 넣지 않는다.

| 역할 | public 경로 | SHA-256 | bytes |
| --- | --- | --- | --- |
| base | `public/models/heroes-next/knight-head-balance-v1.glb` | `694064b1774f4f012fcef68da380175ea432cc5e86ed9280894b7af3af0ad633` | 632916 |
| fitting | `public/models/heroes-next/knight-fitting-head-balance-v1.glb` | `f59bea70236f0c2abc6c70a7d75ae61c50d3651586a21c2bd946230c96793685` | 498060 |

두 파일은 `work/knight-produced-v2-private179-first-1791166188440/produced`의 실제 결과와 byte-identical이다. 생성 영수증 SHA는 `62046576b85ebed6729459f9612665e5b788903a4e34e9631af61e8703519ce6`, 당시 source contract SHA는 `e1646612216046469e74a78ae931b33977518a4f19576c7387ff63185ef6e358`, generator SHA는 `0ed6346f1dbfa303ff090ad8c18ca7bbfda4bf55aa6cfc5ad0ab6a4265edd655`다. 당시 manifest/provenance를 포함한 정확한 V3 원본 8개는 `work/qa/knight-head-balance-20261005/v3-preservation-before-v4`에 읽기 전용으로 보존했다. 현재 활성화 manifest의 해시를 과거 생성 contract의 해시로 바꾸지 않는다.

ROOT의 정확한 V3 source freeze `87297649ab4f295b2514126b8d23ae7074090b0597235a2c3644e5df2eed4d06`에서 실제 typecheck exit 0 및 실제 생성물을 사용한 7 tests/0 fail/21875 assertions PASS를 기록했다. 실제 receipt SHA는 `b32d12f94d3180aa808a0c8177c20a43e0fcb3b0b8517485d37a006349b55481`, 독립 결과 연결 receipt SHA는 `0f770af1ec443d5ca447c7a36e6f027cbb85c511f844625789dbbada9700bf90`다. 네 generated 테스트가 실행되어 binary prefix, node/skin/clip/weapon/UV/weight 보존, 81 neck anchor, 40 clips×5 fractions=200 pose, 220tri crown, cache geometry/clone 회수를 확인했다. 이 검증은 V3 및 같은 생성물의 보존 증거이며, **이번 V4 활성화 source의 type/test/build/browser PASS나 실제 시각 품질의 증거는 아니다**. V4의 실행 검사는 아직 하지 않았다.

이 Knight 시범안은 기존 머리 실루엣과 황동 crown만 다룬다. 금발·얼굴 UV atlas·class 정체성·81 lower connection vertices·41-joint skeleton·40 clips·손/무기 socket·collision/model/bone scale을 유지한다. 별도 어깨 제안, 다른 배우, action card, gold/white FX, camera/HUD 가림, 다섯 클래스 전체, 기기 성능을 해결했다고 주장하지 않는다.

원본 head/rig/clips는 KayKit Adventurers 2.0 FREE의 CC0이고 TLL은 compact coronet과 geometry derivative를 저작했다. `public/models/KAYKIT_ADVENTURERS_LICENSE.txt`, `public/models/tll/README.md`와 이전 art/heraldry 기록을 유지한다. 독점적인 완전 원본 얼굴이나 새 성인 body라는 주장은 하지 않는다. 이미지 provider와 TRELLIS는 사용하지 않았다. 출처·상업 이용 범위·입출력 해시는 manifest와 `provenance.json`에 남겼다.

머리는 원래 727 vertices/956tri를 유지하며 Y 1.30 위에서 변형한다. XZ .80은 Y 1.42에서 도달하고 upper Y는 .84다. normal은 deformation의 inverse transpose를 사용하며 81 anchor의 encoded normal은 유지한다. quantized position은 원래 node transform을 유지한다. 실제 generated head bounds는 X[-.434500190771,.434498744962], Y[1.215831464995,2.152160513779], Z[-.388017509715,.425397376303]이고 계약의 예측값과 일치한다. root/bone/import scale은 바꾸지 않았다.

왕관은 24-segment band 192tri와 eight-point three-lobe crest 28tri, 합계 220tri다. 기존 `TLL_head`의 2984tri primitive를 같은 mesh/node 및 V3 Brushed gold material에서 교체한다. Blender vertices는 112, flat export vertices는 660이며 fitting 전체 triangle 감소는 2764다. 두 packer는 새 stream을 뒤에 붙여 원래 binary prefix를 보존한다. 원래 base의 skin/node/40 clip descriptor와 fitting의 나머지 node/mesh/material은 유지한다. 새 material role·texture·shader feature·light·RT·shadow pass·model mesh node·ownership path는 없다.

selector는 Knight만 정확한 revision id·GENERATED 상태·두 SHA 형식·고정 두 경로가 모두 맞아야 활성화한다. fitting load 실패는 그대로 전달하여 compact base와 옛 왕관을 혼합하지 않는다. 다른 네 영웅과 비활성 설정은 원래 경로를 사용한다. 활성화한 public 두 파일의 실제 존재·정확한 SHA와 기존 부정 guard를 검사하도록 첫 두 테스트를 보완했고, 기존 generated 보존 네 테스트의 본문·수치·허용오차는 그대로 두었다. `KNIGHT_HEAD_BALANCE_ARTIFACT_DIR`는 별도 실제 생성물 검사 경로를 지정하는 기존 옵션이고 기본값은 public 후보 경로다. 이번 활성화 검증은 public 기본 경로도 검사해야 한다.

generator와 decoder는 재현용 소스로 유지한다. 기존 생성 작업을 덮어쓰지 않고 두 명령 모두 새로운 출력 디렉터리를 요구한다. 실제 재생성·실행은 ROOT가 별도 등록한 범위에서만 한다.

```sh
node tools/art/decode-knight-head-balance-v1.mjs --output=work/knight-head-balance-v1-source-input
blender --background --factory-startup --threads 1 --python-exit-code 1 --python tools/art/build-knight-head-balance-v1.py -- --input work/knight-head-balance-v1-source-input/head-input.json --output work/knight-head-balance-v1-produced
```

0 added submissions는 같은 mesh/material 배치를 유지한 소스 가설이다. 기존 absolute 420 draw와 CPU/relative 제한은 그대로이고 이전 Knight peak 419의 여유는 한 번의 draw뿐이다. 새 소스의 실제 import·얼굴 UV·neck seam·crown fit·공격/회피/weapon clearance, 세 viewport의 quiet/crowd/boss frame, cold/retry·전체 frame 성능 검증은 남아 있다. 과거 67/R/S 이미지나 geometry/clip 테스트를 이번 시각 개선·기기/AAA 판정으로 승격하지 않는다.
