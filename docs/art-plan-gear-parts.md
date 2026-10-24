# 갑옷 파츠 아트 영수증 (투구·어깨·장갑 3등급)

계약: `docs/GEAR_VISUAL_PIPELINE.md` 4·5절. 도구: `tools/art/normalize-gear-parts.py`(Blender 4.5.15 LTS 헤드리스, 입력 sha256 고정, 재실행 가능). 화면 검증: `tools/art/hero-gear-parts-shots.mjs`.

```
blender -b --factory-startup -noaudio -P tools/art/normalize-gear-parts.py -- --src <원본 폴더> --out public/models/gear-parts --data src/data/hero-gear-parts.json --report <보고 JSON>
```

## 입력 (브랜치 claude/gear-parts-art-src, art-src/gear-parts/tripo-lite/)

| 파일 | sha256 |
|---|---|
| helm_n.glb | cb2c82f9d164cd93e299618cf1ecfa7bc7c25941dfba079525f8825696540b14 |
| pauldron_n.glb | 41851f24f972f76b2e919a16a9d26dd9356b55cd712aacc31f429671e6f5df98 |
| gauntlet_n.glb | 9c5c6804348fed5568f7661f854da5a9d2a37608d9e98050488d84d9bde069dc |
| helm_e.glb | 3196ca05d3bbf24e4eb2baff061702f692dd4f9dd38ef54a3958d94337d1a8b6 |
| pauldron_e.glb | 78c2c873e5685a34d2cca5146cff114875a267cbb8925df08957074f0fb91f63 |
| gauntlet_e.glb | a350b1cfc5261f8ecee4e67285709466327f4fbf728e75fb8d92e71f1bb361bd |
| helm_l.glb | 5b7f7a4c4336f5dd417d55ceec8bbeb023f07bf0e6c69a1cb7bd37209b73d97a |
| pauldron_l.glb | c54f014af30754939e744c699f18f5b31acad7bc71cc9d0965ac07e0881a6293 |
| gauntlet_l.glb | c4edc01cac127e9ef854a406229275c84b3c2ead9aaa339721c98963ecc071dc |

## 파츠별 변환 (Blender 좌표 Z 위·-Y 정면, 내보내기가 glTF Y 위·+Z 정면으로 바꿈)

회전 근거: 투구·어깨는 정면·옆 정사영 렌더에서 이미 위 +Z, 얼굴 열린 쪽 -Y(=glTF +Z), 어깨 겹판 바깥 -X 라 회전 없음. 장갑은 원본이 사선이라 정점 주성분으로 손가락 쪽 축과 손등 법선을 구해 손가락 → -X, 손등 → 위로 보내는 오일러(XYZ)를 풀어 반올림했다.

| 세트 | 파츠 | 회전(도) | 원점(원본 단위) | 배율 | 삼각형(원본→출력) | 크기(출력 bbox, m) |
|---|---|---|---|---|---|---|
| parts_n | helm | [0, 0, 0] | [0.0003, 0.0001, 0.1766] | 0.89849 | 30000 → 1900 | [0.789, 0.828, 0.872] |
| parts_n | pauldron | [0, 0, 0] | [0.0757, -0.0001, 0.5275] | 0.30309 | 30000 → 1250 | [0.293, 0.25, 0.241] |
| parts_n | gauntlet | [-32.5, -3.5, -52.5] | [0.4573, 0.1075, 0.2896] | 0.32486 | 30000 → 1250 | [0.357, 0.193, 0.139] |
| parts_e | helm | [0, 0, 0] | [0.0, -0.0004, 0.1765] | 0.89775 | 30000 → 1900 | [0.708, 0.705, 0.879] |
| parts_e | pauldron | [0, 0, 0] | [0.1671, 0.0001, 0.6361] | 0.32604 | 30000 → 1250 | [0.29, 0.237, 0.309] |
| parts_e | gauntlet | [-46, -9, -61] | [0.6011, 0.1621, 0.2564] | 0.2954 | 30000 → 1250 | [0.349, 0.201, 0.142] |
| parts_l | helm | [0, 0, 0] | [0.0, 0.0002, 0.1759] | 0.89868 | 29999 → 1899 | [0.78, 0.827, 0.875] |
| parts_l | pauldron | [0, 0, 0] | [-0.0213, 0.0, 0.6365] | 0.30367 | 29999 → 1250 | [0.293, 0.191, 0.293] |
| parts_l | gauntlet | [-29.5, 25.5, -26.5] | [0.5334, 0.0881, 0.408] | 0.34246 | 29999 → 1250 | [0.355, 0.22, 0.179] |

## 출력

| 파일 | 바이트 | 삼각형 합계(한도 6000) | sha256 |
|---|---|---|---|
| public/models/gear-parts/parts_n.glb | 283004 | 4400 | dd8a15f25f372b4d06177d658eedc189db94d95dd41c2cd7d01efc83911a9c59 |
| public/models/gear-parts/parts_e.glb | 360160 | 4400 | 39ec3ba1a52f2752b91c89ec64e078b588c54ad42780e60deb3f917898f3ba94 |
| public/models/gear-parts/parts_l.glb | 392252 | 4399 | e98b8c065e498dfbb4c6f9ed6a5a3cd4137556e466f54b2d417e52789e785278 |

- 메시 3개(`helm`·`pauldron`·`gauntlet`), 재질 1개(아틀라스 1024x1024 WEBP q82: 투구 왼쪽 위 512, 어깨 오른쪽 위 512, 장갑 아래 절반 1024x512), 금속 0.6·거칠기 0.5 상수, 리그 없음.
- 기준 치수: 문서 초안 ref(투구 0.2·어깨 0.18)는 실제 영웅 치수(머리 관절→머리 꼭대기 0.50~0.56, 반 어깨폭 0.15~0.39)보다 훨씬 작아 배율이 2.5~3.6이 되고 런타임 범위(0.3~3)를 넘는 영웅은 투구가 빠졌다. 그래서 `slots.ref`를 투구 0.55·어깨 0.27·장갑 0.25로 바꾸고 정규화도 같은 값에 맞췄다(투구 안쪽 꼭대기 = ref x 1.2, 어깨 폭 = ref x 1.1, 손목→손끝 = ref x 1.15).
- 세트 맞춤(`set.fit`): parts_e 장갑 x -0.06(손 쪽으로), parts_l 투구 y +0.07(눈썹 가리개가 눈을 덮음)·장갑 x -0.03.
- 영웅 맞춤(`heroFit`): ranger 투구 x0.9 y+0.03(머리카락이 투구를 삼킴), barbarian 투구 x0.85(뿔 사이), mage 장갑 x0.7, rogue 장갑 x1.4.
- 몸이 덮는 파츠(`bodyCovers`): mage 전 몸의 투구(마법사 모자), rogue 전 몸의 투구(두건). 투구를 얹으면 얼굴을 반쯤 가렸다.
- 알려진 한계: 기사 2·3단계 몸은 자체 어깨 갑옷이 커서 어깨 파츠가 몸에 묻혀 거의 보이지 않는다(해로움은 없음). 삼각형 3만 → 1250 감량으로 손가락·장식 디테일은 뭉개진다(게임 거리에서는 허용).
