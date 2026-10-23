# 궁수 2·3단계 앞머리 교정 — Tripo 재생성 브리프 (blade-art#t3 후보)

근거: `docs/art-audit-2026-10-23-hero-faces.md`. t2는 앞머리가 양 눈 위를 지나고 붉은 후드가 얼굴 대부분을 덮는다(P2). t3는 앞머리와 잎 장식이 오른눈을 사선으로 가린다(P1).
현재 몸: `public/models/heroes-next/ranger-t2-body-fit-v1.glb`, `ranger-t3-body-fit-v1.glb`(v4 골격 공유, 클립은 1단계 것).

## 원화 조건 (Tripo Studio H3.1 이미지→3D 입력, 1단계 v5 원화 형식과 같게)
- 정체성 유지: 1단계와 같은 얼굴·초록 땋은 머리(왼쪽 어깨 앞)·엘프 귀. t2는 붉은 단풍 후드 망토와 가죽 갑옷, t3는 숲 수호자 판금(녹·금, 초록 보석)이다.
- 바꾸는 것: 앞머리를 이마 위에서 양옆으로 갈라 두 눈과 눈썹이 정면·3/4·위 55°에서 모두 보이게 한다. 눈 위를 지나는 머리 가닥은 0개. t2 후드는 등 뒤로 넘기거나 정수리 뒤로 올려 얼굴을 덮지 않게, t3 잎 장식은 정수리 뒤로 올린다.
- 자세·배경: 무기 없는 A포즈, 손가락 편 상태, 흰 배경, 1:1, 머리부터 발까지 전부 화면 안.
- Tripo: H3.1, 리토폴 약 11k 삼각형, 리그는 Humanoid + Mixamo 프리셋(mixamorig 65관절). 크레딧은 Studio 구독분만 쓴다. 원본은 받자마자 TLL-Asset-Foundry에 `archive_asset.py`로 보관한다.

## 파이프라인 (v6에서 확정, v5식 A→T 굽힘 금지)
1. `blender -b -P tools/asset-library/blender_clean_weights.py -- --input <rigged.glb> --output <clean.glb> --report <r.json>`
   - t2 붉은 후드·t3 녹색 망토는 기본색 초록 판정에 걸리지 않을 수 있다. 실행 전에 장식 색 범위를 인자로 받도록 확장해야 한다(현재는 초록 60–160° 고정).
2. 재결합: `tools/art/rebind-library-body.mjs`는 base의 클립까지 싣는다. 2·3단계 body-fit 파일은 클립 없이 골격·메시만 가지므로 `--no-clips` 출력 모드를 추가한다. base는 `ranger-library-t1-v4.glb`(공유 골격)이다.
3. `higher-body-revisions-v1.json` 새 개정과 `higher-body-motion-v1.json` 회피·사망 곡선을 다시 저작하고, 얼굴 점검(`tools/art/face-audit/run.mjs`)과 전투 메시 검사(`tools/combat-mesh-qa.mjs`)로 v1과 비교한다.

## 합격
- 정면·3/4·위 55°에서 두 눈의 흰자·홍채·눈썹이 가려지지 않는다.
- 땋은 머리와 망토가 대기·사격·피격에서 몸 안으로 사라지지 않는다.
- 접지 기준(구르기 ±0.03m, 사망 > -0.01m)을 통과한다.
