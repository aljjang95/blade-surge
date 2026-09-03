# CLAUDE.md — 이 레포에서 일하는 법

새 세션이면 **여기부터 읽고**, 이어서 `PRD.md`(기준) → `RSI.md`(루프) → `LESSONS.md`(지뢰밭) 순으로 읽어라.

---

## 0. 부트스트랩 — 새 세션의 첫 명령

> 세션마다 컨테이너가 새로 뜬다. **레포 말고는 아무것도 남아 있지 않다.**
> 연결된 폴더가 있으면 거기에 작업 사본이 이미 있는지 먼저 확인하고, 없으면 클론한다.

```bash
# 작업 위치를 정한다. 연결된 폴더가 있으면 그 아래, 없으면 세션 디스크에.
#   연결 폴더:  /sessions/<세션>/mnt/outputs/blade-surge   ← 대표님 PC에 남는다
#   미연결:     /sessions/<세션>/blade-surge               ← 세션 끝나면 사라진다
W=/sessions/$(ls /sessions | head -1)
DIR=$W/mnt/outputs/blade-surge; [ -d "$W/mnt/outputs" ] || DIR=$W/blade-surge

[ -d "$DIR/.git" ] && (cd "$DIR" && git pull) \
  || git clone https://github.com/aljjang95/blade-surge "$DIR"     # public, 인증 불필요
cd "$DIR" && npm install
npm run build && echo BOOTSTRAP_OK
```

> **함정**: 마운트(`mnt/`) 위에는 git 오브젝트를 못 만든다("Operation not permitted").
> 마운트에서 작업하려면 **git 저장소는 세션 디스크에 두고**(`/sessions/<세션>/repo`)
> 작업 사본만 마운트에 두고 `rsync` 로 오간다. 지금까지 이 방식으로 했다.

### 하네스를 돌리려면 (게이트 A) — 추가로 필요한 것
```bash
npx playwright install chromium
# 루트가 없어 libXdamage.so.1 이 없으면:
mkdir -p /tmp/libs && cd /tmp/libs && \
  apt-get download libxdamage1 2>/dev/null && dpkg -x libxdamage1*.deb .
export LD_LIBRARY_PATH=/tmp/libs/usr/lib/x86_64-linux-gnu
```
`package.json` 의 playwright 버전과 브라우저 캐시 빌드가 어긋나면 실행이 죽는다 — `LESSONS.md` 참조.

### 푸시하려면
`§자격증명 → GitHub` 의 디바이스 플로우로 재인증한다(약 30초, 대표님 승인 필요).
**읽기만 할 거면 인증 없이 클론된다.** 커밋을 올릴 때만 필요하다.

## 무엇인가

가로모드 웹앱 3D 몹몰이 핵앤슬래시 가챠 RPG. three.js r0.170 + WebGL2 + Vite 6.
빌드 산출물을 Cloudflare Workers Static Assets로 서빙한다. 백엔드 없음, 세이브는 localStorage.

- 라이브: https://blade-surge.affinity-agent-studio.workers.dev
- 레포: https://github.com/aljjang95/blade-surge

## 명령

```bash
npm install
npm run dev              # http://localhost:5173  (--host 로 폰 접속)
npm run build            # dist/
npm run deploy           # build + wrangler deploy
node tools/metrics.mjs   # 자동 채점 하네스 (RSI 게이트 A)
```

## 자격증명 — 절대 규칙

**토큰 값을 채팅·로그·커밋·스크린샷·에코에 한 글자도 출력하지 않는다.**
`sed -E 's/(gh[pousr]_[A-Za-z0-9]+)/[HIDDEN]/g'` 같은 마스킹을 항상 파이프로 건다.

### GitHub (세션마다 재인증 필요, 약 30초)
컨테이너는 세션마다 새로 뜨므로 gh 인증이 날아간다. 디바이스 플로우로 다시 붙인다:

```bash
# 1) gh 설치 (/tmp 말고 /sessions 디스크에 받아라 — /tmp 는 쓰기 실패한 적 있음)
cd /sessions/$SESSION/ghtmp && curl -sSL -o gh.tgz \
  https://github.com/cli/cli/releases/download/v2.63.2/gh_2.63.2_linux_amd64.tar.gz
tar xzf gh.tgz && cp gh_*/bin/gh ~/bin/gh

# 2) 디바이스 코드 받기 → user_code 를 대표님께 보여드린다
curl -sS -X POST https://github.com/login/device/code -H "Accept: application/json" \
  -d "client_id=178c6fc778ccc68e1d6a" -d "scope=repo workflow"
# device_code 는 파일에 저장해 둔다 (호출 간 유지되어야 함)

# 3) 대표님 승인 후 1회 교환
curl -sS -X POST https://github.com/login/oauth/access_token -H "Accept: application/json" \
  -d "client_id=178c6fc778ccc68e1d6a" -d "device_code=$(cat device_code)" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:device_code"
# → access_token 을 chmod 600 파일로. 이후 export GH_TOKEN="$(cat ...)"
```

> **함정**: `gh auth login --web` 을 백그라운드로 띄우면 bash 호출이 끝날 때 프로세스가 죽어서
> 폴링이 끊긴다. 위처럼 device_code 를 파일에 남기고 **승인 후 1회만 교환**하는 방식으로 하라.

### Cloudflare
`wrangler deploy` 는 `CLOUDFLARE_API_TOKEN` 환경변수를 읽는다.
토큰은 대표님이 업로드하신 파일에서 읽어 env 로만 넘기고, 쓴 뒤에는 남기지 않는다.

### .gitignore 불변식
`.env`, `*.token`, `cf.token` 은 커밋에 절대 들어가지 않는다.
커밋 전 항상: `git ls-files | grep -iE "\.env$|\.token$|\.pem$|credential"` → 비어야 한다.

## 구조

```
index.html            부트/로비/HUD/결과/소환/모달/회전안내 DOM
src/main.js           부트스트랩, 로비 쇼케이스, 프레임 루프 (app.step 으로 결정적 스텝)
src/style.css         가로모드 우선 (좌측 세로 레일) + 세로 대응
src/engine/
  renderer.js         WebGL2 + EffectComposer(블룸·색수차·비네트·플래시·방사형블러), 카메라 리그
  assets.js           GLTF+meshopt 로더, 스킨드 메시 병합, VFX 텍스처 프리로드
  fx.js               GPU Points 3풀 + 플립북/마법진/화염기둥/번개/참격/충격파/데미지숫자
  audio.js            Kenney 샘플 + 프로시저럴 SFX 30여종, BGM 크로스페이드·덕킹, 햅틱
  input.js            가상 조이스틱 / 액션 버튼 / 키보드
src/game/
  world.js            층 절차 생성 — 방 배치, L자 복도, 이동 마스크, BFS 거리장 길찾기
  arena.js            buildLobby() / buildFloor() — 던전 킷 인스턴싱, 테마 조명, 횃불
  actor.js            공통 액터(애니 크로스페이드, 히트플래시, 넉백, 월드 충돌)
  player.js           콤보 상태기계, 스킬, 회피/퍼펙트, 질주, 락온, AUTO 탐험
  skills.js           스킬 16종 — 진공·텍스처 VFX
  enemies.js          잡몹/엘리트/보스 AI, 보스 패턴 킷 3종
  drops.js            3D 필드 드랍 + 자석 흡수 + 희귀도 연출
  battle.js           방 진입/클리어, 히트 판정, 진공, 투사체, 히트스탑, 승패
  economy.js          세이브, 화폐/에너지, 성장, 세트 보너스, 강화, 가챠, 상점, 패스
src/data/             rigs(리그별 애니 이름 번역) / stages / heroes / items / shop
src/ui/               ui.js(HUD·결과·목업결제) / meta.js(로비·강화·소환) / minimap.js
public/models,img,bgm,sfx/
tools/metrics.mjs     자동 채점 하네스
```

## 코드 규칙

- **주석과 커밋 메시지는 한국어.** 코드 식별자는 영어
- 세미콜론 유지, 2스페이스, 작은따옴표. 프레임워크 없음 — 바닐라 ES 모듈
- **프레임 루프에서 할당하지 마라.** 벡터는 재사용, 파티클은 풀에서 꺼내 swap-remove 로 되돌린다
- 새 렌더 오브젝트는 인스턴싱하거나 머지한다. `drawCalls` 밴드가 이걸 감시한다
- `app.step(dt, render)` 의 결정성을 깨지 마라 — 하네스 전체가 여기 의존한다.
  게임 로직에서 `performance.now()`/`Date.now()` 를 직접 읽지 말고 넘겨받은 `dt` 를 써라
- 새 애니메이션 클립은 `src/data/rigs.js` 의 논리 키(`idle`/`run`/`hit`/`death`...)로 접근한다.
  KayKit 과 Quaternius 는 클립 이름이 다르고, GLTFLoader 는 노드 이름의 `.` 을 지운다

## 에셋 라이선스 — 불변식

**CC0 또는 자체 생성만.** 예외 없다.
- 3D: KayKit (Adventurers/Skeletons/Dungeon Remastered), Quaternius (Ultimate Monsters) — 전부 CC0
- SFX: Kenney — CC0
- BGM: Google Flow Music 생성
- 이미지/VFX: 자체 생성 (`parallel-gpt-image` 스킬)

> Quaternius 미러 레포 중 "Patreon Exclusive" 폴더가 섞인 것이 있다. 공식 배포처에서만 받아라.

## 테스트

Playwright + SwiftShader 헤드리스. `tools/metrics.mjs` 가 전부 감싼다.
- chromium 이 `libXdamage.so.1` 을 못 찾으면(루트 권한 없음) .deb 를 받아 풀고
  `LD_LIBRARY_PATH=/tmp/libs/usr/lib/x86_64-linux-gnu` 로 실행한다
- 게임 시간 1.8초를 기다리려면 프레임을 넉넉히 밟아라. 슬로모가 걸리면 실시간과 어긋난다
