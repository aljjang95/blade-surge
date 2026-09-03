# LESSONS — 걸려 넘어진 것만

> 잘된 건 코드에 남는다. 여기엔 **실패한 것**만 적는다. 새 세션은 이 파일을 읽고 같은 데서 안 넘어진다.

## 열려 있는 문제 (기준선 측정에서 발견 — 첫 회전이 여기서 시작한다)

`.rsi/base.json` (2026-09-03) 기준. 12개 지표 중 4개가 밴드를 벗어났다.

| 지표 | 실측 | 목표 | 진단 |
|---|---|---|---|
| `maxAliveSeen` | **6** | ≥14 | **가장 큰 문제.** 몹몰이 게임인데 화면에 6마리뿐이다. 무한의 성 개편에서 방 단위 스폰(`roomRoster`)으로 바뀌면서 웨이브 시절의 밀도(10~28)가 사라졌다. 방 크기 대비 스폰 수를 다시 잡거나, 방을 넘나드는 추격/증원을 넣어야 한다 |
| `floorClearSec` | **52** | 150~420 | 층이 52초에 끝난다. 보스방을 너무 빨리 찾는다(9방 중 7방만 밟고 종료). 보스방을 최단경로에서 밀어내거나, 보스 문에 열쇠/구역 클리어 조건을 걸어야 한다 |
| `killsPerFloor` | **33** | ≥35 | 위 두 개의 종속 결과. 밀도가 오르면 따라온다 |
| `hitTakenRatio` | **0** | 0.05~0.45 | 레벨 30 영웅이 **한 대도 안 맞는다.** 긴장이 0이라는 뜻이다. AUTO 회피가 너무 좋거나 적 공격이 너무 느리다. 손맛의 절반은 위협인데 지금은 없다 |

> `maxAliveSeen` 은 2초 청크마다 1회 샘플링이라 순간 피크를 놓칠 수 있다.
> 정확히 보려면 청크를 줄이거나 게임 쪽에서 최대치를 누적해 노출하라.

## 계측 (하네스를 고칠 때 밟았던 지뢰)

- **three.js `info.render.calls` 는 `render()` 마다 리셋된다.** EffectComposer는 패스가 여러 개라
  그냥 읽으면 마지막 풀스크린 쿼드 1개만 잡혀 `drawCalls: 1` 이 나온다.
  → `info.autoReset = false` 로 끄고 청크 시작에 `info.reset()` 을 직접 부른다
- **순간 HP로 피격률을 재면 안 된다.** 회복·부활이 섞이면 끝에 만피라 0이 나온다.
  → 층 전체에서의 **최저 HP**를 누적한다
- **컨테이너의 playwright 버전과 브라우저 캐시 빌드가 맞아야 한다.**
  1.49 를 깔았더니 chromium-1148 을 찾는데 캐시엔 1234 뿐이라 죽었다. 캐시에 맞춰 1.62.1 로 고정
- **`Box3.setFromObject` 는 quantize/meshopt 모델에서 ~0.03 을 뱉는다.** 크기 검증에 쓰지 마라.
  렌더된 스크린샷으로 눈으로 봐라

## 컨테이너 / 도구

- **마운트는 덮어쓰기만 되고 삭제가 안 된다.** `mnt/outputs` 도, 연결된 사용자 폴더도 똑같다.
  실측: `unlink 불가 / rename OK / rmdir 불가`.
  → 마운트 위에서 **git clone 이 죽는다**(lock 파일을 못 지워 `could not lock config file`),
    npm install 도 못 돌고, `rsync --delete` 도 안 먹는다.
  → **작업은 세션 디스크에서, 마운트는 결과물 전달용으로만.**
  → 실수로 마운트에 클론하면 **지울 수도 없는 잔해가 대표님 폴더에 남는다.**
    삭제하려면 `allow_cowork_file_delete` 로 권한을 요청해야 하는데,
    폴더 전체 삭제 권한이라 거절당하는 게 정상이다. **애초에 만들지 마라.**
- **백그라운드 프로세스는 bash 호출이 끝나면 죽는다.** `gh auth login --web` 을 띄워두고
  다음 호출에서 결과를 받는 방식은 안 된다 — 폴링이 끊긴다.
  → device_code 를 **파일로 남기고**, 승인 후 별도 호출에서 **1회만** 토큰 교환 (`CLAUDE.md` 참조)
- **`/tmp` 에 큰 파일을 받다가 "Failure writing output to destination" 이 났다.** `/sessions` 디스크를 써라
- **bash 호출이 exit 143 으로 죽으면 heredoc 이 중간에 잘려 파일이 깨진다.**
  긴 스크립트는 Write 툴로 쓰고 bash 로는 실행만 해라
- **한 번의 bash 호출은 178초 근처에서 잘린다.** 하네스처럼 오래 도는 건 `setsid` 로 띄우고
  다음 호출에서 로그를 읽어라
- Playwright chromium 이 `libXdamage.so.1` 을 못 찾으면(루트 없음) .deb 를 받아 풀고
  `LD_LIBRARY_PATH=/tmp/libs/usr/lib/x86_64-linux-gnu`
- Vite `EPERM unlink dist/_headers` → `emptyOutDir: false`

## 렌더 / 에셋

- **엘리트 표시를 색 틴트로 하면 Quaternius 텍스처가 노란 덩어리로 뭉개진다.**
  이 모델들은 이미 채도가 높아서 컬러 곱이 디테일을 다 먹는다.
  → 틴트는 KayKit 리그에만. 나머지는 **발밑 링 마커** + 아주 약한 emissive
- **GLTFLoader 는 노드 이름의 `.` 을 지운다.** `handslot.r` 을 못 찾는다.
  → `name.replace(/[^\w-]/g, '')` 폴백을 두어라
- **인스턴싱할 때 원본의 dequantize 변환이 날아간다.**
  → 인스턴스 행렬에 `part.matrixWorld.invert() * src.matrixWorld` 를 곱해라
- gltf-transform: `mergeDocuments` 는 Document 메서드가 아니라 `@gltf-transform/functions` 에서 import.
  GLB 버퍼가 2개 이상이면 `unpartition()` 을 먼저 태워라
- **Quaternius 미러 레포에 "Patreon Exclusive" 폴더가 섞여 있다.** CC0 아니다. 공식 배포처만 써라

## UI

- 결과 화면에 `reward-fly`/루팅 팝업이 겹쳐 올라온다 → `#result` 표시 중엔 억제하고 루팅 레이어를 비운다
- 모바일에서 그리드 `1fr` 이 넘친다 → `minmax(0, 1fr)` + `min-width: 0`
- COMBO 카운터가 우상단 미니맵을 가렸다 → `top: 44%` 로 내렸다. **HUD 요소를 새로 놓을 땐 미니맵 영역을 피해라**
- `.cmd`/`.bat`/`.ps1` 파일에 한글을 넣지 마라 (CP949로 깨진다)
