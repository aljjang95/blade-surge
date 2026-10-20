# 궁수 사망 활 접촉 교정: ranger-library-v4 (저작 v3)

2026-10-17. 공개 `ranger-library-v3` 의 사망 클립에서 실제 런타임 활이 바닥을 뚫던 결함을 고친 채택본이다. 저작 스크립트 `art-src/ranger/author_ranger_library_v3.py`(v2 레시피에서 사망 정착 한 곳만 바꿈)를 실제 Windows PC Blender 5.2.2 LTS(RTX3070, 작업 20261017-123614-e9fe41c3)에서 실행하고, 기존 패커·재질 마감 도구로 만들었다. 원본 정규화 GLB·manifest, v1–v3 파일·기록, v2 저작 스크립트는 바꾸지 않았다.

## 결함과 원인

v3 사망은 몸 스킨 최저점이 0(접지)인데, 게임과 같은 `loadHeroModel → spawnCharacter` 경로의 `Bow` 정점(시위 포함)이 1.042초(25f)에 -0.0999m, 1.083초에 -0.077m 까지 내려갔다. v2 저작 보고서의 근사 끝점 값 `bowTipMinZ = -0.08` 과 같은 현상이다. 갑옷 2·3단계와 여우 아바타도 같은 클립을 써서 같은 값이었다.

v2 정착(settle)은 '가슴 위에 평평히 놓인 활' 목표를 마지막 프레임(30f)의 가슴 자세 하나로 계산해, 24→30f 동안 가슴 기준으로 고정했다. 몸이 바닥에 부딪힌 직후(24–27f)에는 가슴이 아직 돌아가는 중이라 그 고정 목표가 같이 기울었다. 이번 PC 실행에서 잰 기울기는 25f 17.9°, 26f 14.3°이고, 그만큼 아래쪽 림 끝이 바닥 아래로 내려갔다.

## 교정

사망 클립의 왼팔 IK 목표만 바꿨다. 18f 이후에는 평평한 활(림 = 그 프레임 가슴 좌우축의 수평 투영, 화살 방향 = 월드 위)을 **프레임마다 그 프레임의 실제 가슴 자세로** 다시 계산한다. 18→24f 는 쓰러짐 활(FALL)에서 그 목표로 smoothstep slerp 하고, 24f 부터는 목표를 그대로 쓴다. 매 정수 프레임에 키를 넣는다. 마지막 프레임 목표는 v2 의 평평한 활과 같은 식이라 최종 누운 자세와 활 위치는 그대로다.

바꾸지 않은 것은 다음과 같다. 몸(골반 회전·척추·다리·오른팔·머리) 키, 실제 스킨 최저점 접지 방식, 1.25초(30f) 길이와 게임의 1.2초 침하 계약, 그립·노크 소켓 정의, 다른 10개 클립, 메시·rest·역바인드·텍스처·재질 마감, 갑옷 단계·아바타 공유. 몸 전체를 들어 올리거나, 활을 숨기거나 줄이거나, 바인드 포즈를 바꾸거나, 런타임 렌더 변환으로 덮는 방식은 쓰지 않았다.

## 결과(실측)

| 항목 | v3(공개) | v4 |
| --- | --- | --- |
| 사망 실제 활 최저 y(런타임, 301 표본 + 모든 키 시간) | -0.0999m @1.042초 | +0.0066m @1.208초 |
| 저작 보고서 실제 활 정점 최저(1/4 프레임) | — | +0.0122m @29f |
| 1단계 몸 스킨 최저(키 사이 포함) | -0.0043m | -0.0043m |
| 0–0.75초(0–18f) 모든 본 위치 차 | — | 1.1e-7m |
| 왼팔 밖 본 위치 최대 차 | — | 1.1mm(접지 재계산으로 골반 높이가 바뀐 만큼) |
| 끝 자세 그립 차 | — | 1.2e-7m · 0.024° |
| 정착 구간 활 회전 최대 변화(1/240초당) | 4.7° | 2.7° |
| 다른 10개 클립 | — | v3 와 비트 동일(채널·키·보간·값) |

GLB 바이트로 보면 사망에서 실제로 바뀐 채널은 LeftArm·LeftForeArm·LeftHand 회전과 Hips 이동(접지 재계산)뿐이다. 그 밖의 차이는 내보내기 행렬 분해 잡음이다(회전 6e-8, 이동 6e-6 원본 단위, 배율 3e-7). 배율이 1 로 고정된 2키 채널 몇 개는 STEP/LINEAR 표기만 달라졌다(v2→v3 에도 있던 현상이다).

## 출처와 해시

| 파일 | SHA256 |
| --- | --- |
| `art-src/ranger/author_ranger_library_v3.py` | `0303ab6867d428ef8d66a67d3e38902885a71bf36e04cc630db938c0e0210947` |
| `art-src/ranger/ranger-library-author-report-v3-blender52.json`(PC 5.2.2 보고서) | `cfdd9b32b34dcb5246446870d188e49999a83ac9ef50681245fdc325a3015094` |
| PC 애니 GLB `ranger-library-anim-v3.glb` / `-96fps.glb`(저장소 밖) | `7ba62ceb…` / `29a93fe0…` |
| PC 패킹본(마감 전, 저장소 밖) | `dd857d7e828e032107a7aeb4451b245536420e43acd71cc00f5dccd709a179f4` |
| `public/models/heroes-next/ranger-library-t1-v4.glb` | `0a008c410e2e3df74b87ba7e00f317f4266c1edc0eda2951e43f8a9a6dce43d0` |

GLB `asset.extras` 는 `rangerLibraryRevision: ranger-library-v4`, `authoring: Blender Khronos glTF Blender I/O v5.2.40 / art-src/ranger/author_ranger_library_v3.py`, `materialFinish.revision: ranger-library-v4` 이다. 저작 스크립트 버전(v3)과 게임 revision(v4)은 번호가 다르다. 스크립트 출력 파일 이름은 `-v3`(`ranger-library-anim-v3.glb` 등)이고, 패킹·마감 결과가 `ranger-library-t1-v4.glb` 다. PC 의 애니 GLB 로 컨테이너에서 패킹·마감을 다시 해도 같은 두 SHA 가 나온다. 클라우드 Blender 4.3.2 실행은 타당성 확인용이었고 채택 파일에는 쓰지 않았다(4.3 내보내기 문자열은 출처 테스트가 거절한다). 라이선스 문구는 v3 와 같다. 새 공급자 호출·구매는 없다.

## 재현

```sh
blender -b --factory-startup --python-exit-code 1 --python art-src/ranger/author_ranger_library_v3.py -- asset-library/normalized/hero_ranger_t1.glb asset-library/normalized/hero_knight_t1.glb <out> art-src/ranger/runtime-bow-preview.obj
node tools/art/pack-ranger-library.mjs asset-library/normalized/hero_ranger_t1.glb <out>/ranger-library-anim-v3.glb,<out>/ranger-library-anim-v3-96fps.glb <packed.glb> ranger-library-v4 art-src/ranger/author_ranger_library_v3.py
node tools/art/finish-library-materials.mjs <packed.glb> public/models/heroes-next/ranger-library-t1-v4.glb ranger-library-v4
```

v3 저작은 활 OBJ 가 필수다. 사망 실제 활 정점 최저가 0 미만이면 보고서·`.blend` 만 남기고 애니 GLB 를 내보내지 않은 채 실패 종료한다. 그래서 관통하는 결과는 패킹 단계로 넘어가지 않는다.

## 검사

- `test/ranger-death-contact.test.ts`: 저작이 쓰는 활 OBJ 가 런타임 `Bow` 정점(816)과 같다. v3 원인 재현(-0.05m 미만, 1.0–1.1초). v4 에서 1단계·갑옷 2·3단계·여우 아바타 모두 사망 전 구간 실제 활 정점 y ≥ 0, `Death_A`/`Death_B` = `death`, 그립 소켓은 왼손 본 아래에 있고 활과 같은 자리·방향이다. 1단계는 몸 스킨 접지, 다른 몸체는 v3 보다 더 내려가지 않는다. v3 와 비교해 0–0.75초 본 동일, 왼팔 밖 본 차 3mm 미만, 끝 자세 동일, 정착 구간 활 회전 최대 변화가 v3 이하다.
- `test/ranger-library-model.test.ts`: v4 출처(5.2 내보내기·저작 스크립트 SHA·패킹 SHA 재현·재마감 바이트 동일), v3 와 메시·스킨·텍스처·재질·노드 동일, 다른 10개 클립 비트 동일, 사망 변경 채널 집합. v3 기록 검사는 v3 기록을 직접 읽도록 고정했다.

## 수치 경계와 예술 경계

테스트가 보장하는 것은 수치다. 바닥(y=0) 비관통, 몸 본 불변, 끝 자세 불변, 활 회전 연속성. 쓰러진 실루엣이 자연스러워 보이는지는 수치로 승인하지 않는다. 컨테이너 Blender 4.3.2 의 Workbench 측면·정면 렌더(검사용 바닥, 23–30f)로 v2/v3 를 비교한 결과는 이렇다. v3 저작에서도 몸은 같은 모습으로 쓰러지고, 손은 활을 쥔 채이며, 충돌 직후 림이 바닥 아래로 꽂히던 장면이 사라지고 활이 바닥면에 평평하게 놓인다. 이 렌더는 게임 조명·카메라·셰이더가 아니다.

## 남은 한계(이번 변경 범위 밖, v3 와 같음)

- 27–30f 에는 왼쪽 아래팔이 스킨 최저점이라, 몸통이 바닥에서 2.5–4.5cm 떠 있다(Blender 측정). v2·v3 와 같다.
- 런타임 키 사이 보간에서 몸 스킨 최저가 -0.004…+0.037m 사이를 오간다(v3 와 같음).
- 접지는 1단계 스킨으로 푼다. 갑옷 2·3단계는 사망 중 스킨이 -0.028m, 여우 아바타는 0.04초에 -0.31m 까지 내려간다. v3 와 같은 값이고 이번에 바꾸지 않았다.
- 활 최저 여유는 6.6mm(1.208초, 활을 바닥에 눕힌 끝 자세의 시위 쪽)다. 게임은 1.2초부터 몸 전체를 바닥 아래로 내린다(`src/game/actor.js`).
- 브라우저 실화면, 공개 호스트, 실제 Android(GPU·터치·발열) 확인은 이 레인에서 하지 않았다.
