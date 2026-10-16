# 영웅 라이브러리 채택본: 궁수 ranger-library-v3 · 도적 rogue-library-v2 (Blender 5.2 재저작 + 재질 마감)

2026-10-17. 실제 Windows PC(RTX3070, Blender 5.2.2 LTS)에서 만든 로컬 후보를 게임 버전 자산으로 채택했다. 원본 정규화 GLB·manifest, 이전 교정본(v1·v2·axis-v1) 파일과 기록은 바꾸지 않았고, 새 버전 파일·기록·로더 선택만 더했다. 초상·갑옷 2·3단계·아바타는 그대로 1단계 클립을 공유한다.

## 바뀐 것

| 항목 | 내용 |
| --- | --- |
| 궁수 클립 | v2 저작 레시피(값·클립 11개·소켓 동일)를 Blender 5.2.2 에서 다시 구웠다. v2 와 채널·키 시간이 같고 회전 차 최대 0.065°, 이동 차 5e-5(원본 cm 단위)라 동작 변화를 의도하지 않는다. 5.2 저작 보고서의 접지·활 오차 수치도 4.3 보고서와 반올림 값까지 같다. |
| 도적 클립 | 재저작하지 않았다. axis-v1(Blender 4.3.2) BIN 청크가 바이트 그대로다(클립 14개). |
| 재질 | 게임 로더 `normalizeLibrarySkinMaterial`이 매 로드마다 하던 보정을 GLB 재질에 고정했다: `metallicFactor` 0.22(원본은 기본값 1), 불투명 `BLEND` → `MASK`·`alphaCutoff` 0.5. 로더 보정은 그대로 두며 마감본에서는 아무 일도 하지 않는다. 게임 화면의 재질 상태는 이전과 같고, Blender·외부 뷰어에서도 게임과 같은 재질로 보인다. 아트 셰이더는 바꾸지 않았다. |
| 저작 스크립트 | `art-src/ranger/author_ranger_library_v2.py`에 4.4+ 슬롯 Action(레이어·채널백·action_slot) 호환을 넣었다. 아래 표처럼 버전별 실행 근거가 다르다. |
| 마감 도구 | `tools/art/finish-library-materials.mjs`(입력·출력·revision 명시, GLB 검증, 덮어쓰기 거절, 이미 마감된 입력 거절). |
| 로더 | `src/engine/library-assets.js`가 `ranger-library-revision-v3.json`·`rogue-library-revision-v2.json`을 고른다. |

| Blender | 저작 스크립트 실행 근거 |
| --- | --- |
| 4.3.2(레거시) | 컨테이너에서 호환 전 원본과 호환본을 각각 실행했다. 애니 GLB 2개·보고서가 바이트 동일했고 패킹 결과가 공개 v2 `7c694b6c…`와 같았다. |
| 5.2.2 LTS | 실제 PC 작업 20261017-011754-8d99ed95 에서 `LOCAL-AUTHOR-BLENDER52.py`(sha256 `1ae63d2a…`)로 실행했다. 커밋본과 코드(AST)가 같고 머리말·주석만 다르다. 보고서: `art-src/ranger/ranger-library-author-report-v2-blender52.json`. |
| 4.4–5.1 | 실행하지 않았다. |

## 출처

GLB `asset.extras`는 저작 출처와 채택 출처를 나눠 적는다. 궁수 v3 는 `rangerLibraryRevision: ranger-library-v2`(저작 레시피), `authoring: Blender … v5.2.40 / LOCAL-AUTHOR-BLENDER52.py`(실제 실행 당시 이름, 바꾸지 않음), `materialFinish: { revision: ranger-library-v3, recipe: library-skin-finish-v1, inputSha256 }`를 가진다. 도적 v2 는 axis-v1 의 extras 에 `materialFinish`만 더했다. 라이선스는 이전 기록 문구 그대로다(소유자 생성 Tripo 메시 불변, Mixamo 클립 리타깃, 같은 골격에서 Blender 저작). 새 공급자 호출·구매·재라이선스는 없다. 편집용 5.2 `.blend`(검사 바닥·조명·카메라 포함)는 원격 보관본에만 두고 저장소에 넣지 않았다.

| 파일 | SHA256 |
| --- | --- |
| PC 패킹본(마감 전, 저장소 밖) | `a8fea05e39cadfd1b01bb4332a9cbf85a92eda45d701644600f3c3f089c66778` |
| `public/models/heroes-next/ranger-library-t1-v3.glb` | `2eafd2ede689644606ac13daf6e47e1e5cebc1be84fa5e4d845b63fee1820718` |
| `public/models/heroes-next/rogue-library-t1-axis-v1.glb`(입력, 변경 없음) | `c24b8eab468924a07c2c23bda9feddc51ea25cc6024321f9e2eccc6e46a88ead` |
| `public/models/heroes-next/rogue-library-t1-v2.glb` | `19f7e1492d947c6055cbbd8b51f3ee355c5c72f8ec4ab6296be32fb9d1e1c846` |

## 재현

```sh
# 궁수: 5.2.2 저작(실행 시 <out> 에 ranger-library-anim-v2.glb·-96fps.glb·보고서·.blend)
blender -b --factory-startup --python art-src/ranger/author_ranger_library_v2.py -- asset-library/normalized/hero_ranger_t1.glb asset-library/normalized/hero_knight_t1.glb <out> art-src/ranger/runtime-bow-preview.obj
# 패킹: 마지막 인자는 extras.authoring 에 들어간다. PC 실행본 a8fea05 를 다시 만들려면 실행 당시 이름 LOCAL-AUTHOR-BLENDER52.py 를 준다.
node tools/art/pack-ranger-library.mjs asset-library/normalized/hero_ranger_t1.glb <out>/ranger-library-anim-v2.glb,<out>/ranger-library-anim-v2-96fps.glb <packed.glb> ranger-library-v2 LOCAL-AUTHOR-BLENDER52.py
node tools/art/finish-library-materials.mjs <packed.glb> public/models/heroes-next/ranger-library-t1-v3.glb ranger-library-v3
node tools/art/update-ranger-revision.mjs src/data/ranger-library-revision-v3.json

# 도적: 공개 axis-v1 에 재질 마감만
node tools/art/finish-library-materials.mjs public/models/heroes-next/rogue-library-t1-axis-v1.glb public/models/heroes-next/rogue-library-t1-v2.glb rogue-library-v2
node tools/art/update-ranger-revision.mjs src/data/rogue-library-revision-v2.json
```

마감 도구는 출력이 이미 있으면 멈추므로 기존 버전 파일을 덮어쓰지 않는다. Blender 5.2 를 새로 실행해 클립이 1비트라도 달라지면 SHA 가 달라지므로 새 revision 으로 다룬다.

## 검사

- `test/ranger-library-model.test.ts`: v3 재질이 원본 재질에 마감 세 필드만 바뀐 값, v3 에서 마감을 되돌리면 PC 패킹 SHA `a8fea05…`가 나오고 다시 마감하면 같은 바이트, v1·v2 파일 SHA 불변, v3 클립이 v2 와 채널·키 시간 동일·회전 차 0.1° 미만, 메시·스킨·텍스처 bufferView 바이트가 v2 와 동일. 기존 실제 `loadHeroModel` 경로의 활·시위·접지·백스텝·사격·갑옷 단계 공유 검사는 그대로 v3 에서 돈다.
- `test/rogue-library-axis.test.ts`: 도적 v2 = 마감(axis-v1) 정확한 바이트, BIN·비재질 JSON 동일, 기존 무릎·접지·단계 공유 검사.
- `test/library-material-finish.test.ts`: 도구 상수가 `LIBRARY_SKIN_METALNESS_MAX`와 같음, 반투명·낮은 금속도 예외, three 로더 재질 상태가 보정 결과와 같고 이전 버전의 보정 후 상태와도 같음, 실제 CLI 프로세스로 기존 출력 거절(바이트 유지)·재마감 거절·잘못된 GLB(마법수·길이·BIN 누락·JSON) 거절과 출력 미생성.

## 한계

- 사망 클립 끝에서 활 끝이 바닥 아래 0.08m 까지 내려간다(`bowTipMinZ = -0.08`). v2 원저작과 같은 값이며 이번에 고치지 않았다. 몸 스킨 접지는 통과한다.
- PC의 `.blend`·미리보기 PNG 는 평면 OBJ 활과 검사용 바닥·조명·카메라를 쓴 단독 미리보기다. 게임의 조준·상하체 층·변형 시위·조명은 별도 런타임이므로 그 렌더를 게임 E2E 로 보지 않는다.
- 브라우저 실화면·공개 호스트·실제 Android(GPU·터치·발열) 검증은 이 변경에서 하지 않았다. 해시·스킨 계약 테스트는 아트 완성도 승인을 대신하지 않는다.
- 클라우드에는 Blender 4.3.2 만 있어 5.2 실행은 PC 기록(보고서·패킹 로그)과 바이트 재구성으로 확인했다. 최종 패킹·마감 SHA 의 PC 재실행 확인은 릴리스 담당이 한다.
