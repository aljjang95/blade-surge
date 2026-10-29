# 장비 아트 레인 인계 (2026-10-30)

레인: `[gogo-chunk:blade-gear#art]`, 지휘 세션 `session_01WdQ7BZ8wnZNiuZbp6S4HPr`(theluxurylord). 이전 지휘 `session_01H8mx3U9qK3w3SjT5hPBKSr`.

## 끝난 것
- 장비 아이콘 새 톤 전부 운영 반영: 60종(#380) + 139종(#385). 남은 옛 그림은 영웅 형태별 무기 `public/img/item-renders/forms/` 215장뿐.
- 검성 무기 3D(Tripo GLB) 24자루 운영 반영 — 경로·규약은 `docs/ITEM_WEAPON_3D.md`.
  - 1차 4자루 + GLB 경로(#418, 685c49f): 리뷰 P0(재질 그룹 없음 → 안 그려짐) 수정, 금속·거칠기 맵 유지, 발광은 색 텍스처로 곱하고 0.4배.
  - 2차 11자루 + 밝기 보정(#430, 2dbc711 배포·readback): Tripo 강철(albedo sRGB≈100, 금속맵≈0.85)이 어둡게 가라앉아 금속 상한 0.3·색 1.35배.
  - 3차 9자루(#432, 473097c).
- 증거: 844×390 SwiftShader 영웅 화면 캡처에서 화면 메시 삼각형 = 매니페스트(절차적 검 456/1420과 구분), 절차적 기준샷과 쥐는 방향 동일, 강화 +0/+10/+15 차이 확인. GPU 프레임 판단은 아님.

## 남은 것
1. 4차 도감·마을 15자루 → 5차 원정 3자루(`art-src/gear-icons/weapon-3d-queue.json`). **Tripo 공유 계정 잔량 315**(성불 GO 레인과 같은 계정, 두 레인 합의 하한 300) → 충전(결제, 대표님 결정) 전까지 보류.
2. w_blood 재생성 후보: 3D 날이 아이보리라 아이콘(검붉은 날)과 다름. 프롬프트에 "blade itself is dark blackish crimson red metal, not white or ivory".
3. 다른 직업 형태(도끼·지팡이·쌍단검·활) 3D와 `forms/` 215장 재작화 — 매니페스트 키를 `{id, form}`으로 확장.

## 4·5차 진행 상태 (2026-10-30, 브랜치 `claude/gear-weapon-w4`)
- 대표님 지시: Tripo **heartytn 계정(이메일 heartytn@naver.com, 비밀번호 로그인)**으로 18자루 + w_blood 재생성. 공유 계정·`tripo` 금고는 쓰지 않음.
- 브리프: `art-src/gear-icons/weapon-3d-brief-w4.json`(무기별 extra, 아이콘 보고 작성).
- 로그인 경로: PC Chrome 릴레이는 Tripo 탭 접근 불가(확장 권한 밖), PC MCP는 세션 한도 → 클라우드 데스크톱 전용 프로필(`~/.grok-persist/tripo-heartytn`, CDP 127.0.0.1:9333)에 Password Login 화면 + 이메일 입력해 둠. **대표님 비밀번호 입력 대기**(약 3시간, 생성 0, 크레딧 사용 0).
- 이어받을 때: 같은 컨테이너면 그 브라우저에서 바로, 새 컨테이너면 데스크톱 브라우저를 `--remote-debugging-port`로 띄워 대표님 로그인 1회 → Playwright `connectOverCDP`로 조작. 로그인 직후 잔여 크레딧 기록, 자루당 50~70 기준으로 가능한 만큼.

## Tripo 비용 실측 (화면 가격을 믿지 말 것)
- 생성 H3.1(2K·PBR) 45, 리토폴로지는 화면 5인데 25가 빠지는 경우가 많음 → 자루당 50~70으로 계산. GLB 내보내기(기본 GLB 2k)는 직전·직후 잔량 측정 3회 모두 0.
- 컨셉 이미지(Nano Banana 2)도 장당 약 8로 보임(미확정).
- 단계마다 시작 전 잔량을 기록하고, 공유 계정이므로 하한 300 아래로 내려가는 단계는 시작하지 않는다.

## 도구
- `tools/art/gear-icon-brief.mjs`, `tools/art/icon-collage-split.py`, `tools/art/import-icon-batch.py`(아이콘).
- `tools/asset-library/blender_weapon_prep.py` → `tools/art/register-item-weapon.mjs`(무기 3D). Blender 5.0 공식 tarball을 스크래치에 받아 헤드리스(EEVEE는 libEGL 없음 → Cycles CPU 프리뷰).
- 원본: R2 `blade-surge-handoff/tripo-3d/weapons/<id>/<id>.glb`·`<id>-concept.png`.
