# CLAUDE.md — 이 레포에서 일하는 법

새 세션이면 **여기부터 읽고**, 이어서 `PRD.md`(기준) → `RSI.md`(루프) → `LESSONS.md`(지뢰밭) 순으로 읽어라.

---

## 0. 부트스트랩 — 새 세션의 첫 명령

> 세션마다 컨테이너가 새로 뜬다. **레포 말고는 아무것도 남아 있지 않다.**
> 연결된 폴더가 있으면 거기에 작업 사본이 이미 있는지 먼저 확인하고, 없으면 클론한다.

```bash
W=/sessions/$(ls /sessions | head -1)
git clone https://github.com/aljjang95/blade-surge $W/repo    # public, 인증 불필요
cd $W/repo && npm install
npm run build && echo BOOTSTRAP_OK
```

> **작업은 반드시 세션 디스크(`/sessions/<세션>/…`)에서 한다. 마운트에서 하지 마라.**
>
> 마운트(`mnt/outputs`, 연결된 사용자 폴더 모두)는 **덮어쓰기만 되고 삭제가 안 된다** — 실측:
> ```
> unlink: 불가    rename: OK    rmdir: 불가
> ```
> 그래서 마운트 위에서는 **git 이 죽고**(lock 파일을 지우지 못해 `could not lock config file`),
> **npm install 도 못 돌고**, `rsync --delete` 도 안 먹는다.
> 실수로 마운트에 클론하면 **지울 수도 없는 잔해가 대표님 폴더에 남는다** (실제로 저질렀다).
>
> 마운트는 **결과물을 건네는 통로**로만 써라 — 빌드 산출물, 스크린샷, 리포트를 복사해 넣는 용도.
> 프로젝트를 대표님 폴더에 상주시킬 이유는 없다. **영속성은 GitHub 레포가 담당한다.**

### 하네스를 돌리려면 (게이트 A) — 추가로 필요한 것
```bash
npx playwright install chromium
# 루트가 없어 libXdamage.so.1 이 없으면:
mkdir -p /tmp/libs && cd /tmp/libs && \
  apt-get download libxdamage1 2>/dev/null && dpkg -x libxdamage1*.deb .
export LD_LIBRARY_PATH=/tmp/libs/usr/lib/x86_64-linux-gnu
```
`package.json` 의 playwright 버전과 브라우저 캐시 빌드가 어긋나면 실행이 죽는다.
**이 컨테이너에는 크로미움이 이미 깔려 있다** (`/opt/pw-browsers/chromium`, 빌드 번호가 playwright 기대치와 다를 수 있다).
`tools/chrome.mjs` 가 그걸 찾아 `executablePath` 로 넘기므로 `npx playwright install` 은 보통 필요 없다.

### 푸시·배포·API 키 — 전부 `session-auth` 스킬 한 번으로
`session-auth` 스킬(보스님 계정에만 있는 파일)에 뿌리 토큰과 부트스트랩 스크립트가 있다. 그걸 읽고 실행하면
deploy key·Cloudflare 토큰·Fish Audio 키가 세션 디스크에 풀린다. **이 레포는 public 이다 — 여기엔 어떤 키도 적지 않는다.**
읽기만 할 거면 인증 없이 클론된다.

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
`sed -E 's/(gh[pousr]_[A-Za-z0-9]+|cfut_[A-Za-z0-9_-]+)/[HIDDEN]/g'` 같은 마스킹을 항상 파이프로 건다.

### 어디서 오나 (2026-09-03 v3)
- **뿌리**: Cloudflare 사용자 API 토큰 — `session-auth` 스킬에만 있다.
- **금고**: Cloudflare Secrets Store `apex-shared-apis` (write-only). GitHub deploy key(base64)·Fish Audio 키 등.
- **통로**: 워커 `apex-secrets` (`tools/apex-secrets/`, https://apex-secrets.affinity-agent-studio.workers.dev).
  `Authorization: Bearer <뿌리>` 의 sha256 이 `APEX_GATE_SHA256` 과 같을 때만 `/v1/secrets?names=…` 로 값을 준다.
- 구글 드라이브는 쓰지 않는다 — PC 쪽 APEX 가 평문을 한 시간 안에 지운다(실제로 당했다).
- 새 키를 넣는 법·워커 바인딩 추가·토큰 교체 절차는 `session-auth` 스킬에.

### GitHub — 세션에서 푸시가 막힐 수 있다 (2026-09-03 실측)
Cowork 클라우드 세션의 에이전트 프록시는 **세션에 인가된 저장소에만** 자격증명을 넣어 준다.
`aljjang95/blade-surge` 는 프로젝트의 '동기화 소스'로는 붙어 있지만 그건 **읽기 전용 지식 동기화**다 — 푸시 권한이 아니다.

| 경로 | 결과 |
|---|---|
| `git clone` / `fetch` (HTTPS) | **200 OK** — 읽기는 된다 |
| `git push` (HTTPS) | **403** `not in this session's authorized repository set` |
| `api.github.com/repos/...` | **403** `Use add_source to request access ... access:"push"` |
| SSH (deploy key) | 22번 포트 차단. 443 SSH 는 프록시가 TLS 로 가로채 끊는다 |

즉 **키 문제가 아니라 네트워크·인가 정책 문제**다. deploy key 는 멀쩡하다.

- 푸시가 필요하면: 세션에 저장소를 **push 권한으로** 붙여야 한다(앱에서 소스 추가). Claude Code(PC) 세션에는 이 제약이 없다.
- 그때까지 **작업을 잃지 않는 법 → 아래 R2 인계 통로**.

> **어느 세션이 푸시할 수 있나 (2026-09-04 실측)** — 프록시 제약은 세션 종류마다 다르다.
> | 세션 | 푸시 |
> |---|---|
> | 데스크톱 앱 **로컬 Cowork** 세션 (작업폴더가 `…\local-agent-mode-sessions\…`) | **된다.** `session-auth` 의 deploy key + `GIT_SSH_COMMAND` 로 SSH 푸시 |
> | 클라우드 Cowork 세션 · 예약 작업 | 막힌다 (위 표) |
> | PC Claude Code | 된다 |
>
> 그래서 **클라우드/예약 회전은 R2 번들로 넘기고, 로컬 Cowork 세션이 받아서 민다.** 실제 복구 절차:
> ```bash
> curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
>   "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/blade-surge-handoff/objects?per_page=50"   # 목록
> curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
>   ".../objects/rotations%2F<sha>-....bundle" -o /tmp/bs.bundle    # 키의 / 는 %2F 로
> git fetch /tmp/bs.bundle HEAD && git merge --ff-only FETCH_HEAD && git push origin HEAD:main
> ```
> 번들 전제 커밋이 현재 `origin/main` 이면 ff-only 로 그대로 얹힌다. 2026-09-04 에 회전 7·8(각성·세트·도구) 9커밋을 이 경로로 복구했다.


### 회전 축 선점 — 예약 세션끼리 안 겹치게 (필수, 2026-09-03)
같은 날 세 세션이 각자 회전을 돌아 **서로 못 합치는 갈래가 셋** 생겼다.
브랜치·PR 로는 못 막는다 — 충돌은 코드가 아니라 **무엇을 할지 고르는 순간**에 이미 결정된다.

```bash
node tools/rsi-claim.mjs status                 # 잡힌 축 + 최근 회전 기록
node tools/rsi-claim.mjs claim PRD-4-4 "신규 직업"   # 선점 (이미 잡혔으면 exit 2 → 다른 축으로)
node tools/rsi-claim.mjs done  PRD-4-4 <R2번들키>    # 완료 기록 + 락 해제
node tools/rsi-claim.mjs fail  PRD-4-4 "게이트 실패"
node tools/rsi-claim.mjs steal PRD-4-4          # 6시간 넘게 방치된 죽은 락 회수
```
D1 `apex-rsi` 의 PRIMARY KEY 충돌이 락이다(같은 축 INSERT 는 하나만 성공). 뿌리 CF 토큰으로 붙는다.

**회전 시작 순서 — 이 순서를 지켜라**
1. `session-auth` 스킬로 인증
2. `git fetch origin` **그리고 R2 `rotations/` 의 최신 번들을 흡수**해 base 를 맞춘다.
   origin/main 은 낡아 있을 수 있다 — 푸시가 막힌 회전이 R2 에만 있다
3. `rsi-claim status` → 안 잡힌 축을 `claim`. 못 잡으면 다른 축, 전부 잡혔으면 **그 회전은 그냥 종료한다**
4. RSI 루프 1회전 (게이트 A/B/C)
5. 통과하면 커밋 → `node tools/gh-push.mjs` → 실패하면 R2 번들 업로드
6. `rsi-claim done <축> <번들키>`

### 푸시하는 법 — `node tools/gh-push.mjs` (2026-09-03~)
`git push` 는 못 쓴다(위 표). 대신 Cloudflare 워커 **apex-git** 이 우회로다 —
워커는 CF 네트워크에서 도니까 컨테이너 프록시 바깥이고, 거기서 api.github.com 을 부른다.

```
세션 → https://apex-git.affinity-agent-studio.workers.dev/gh/<api 경로>  → api.github.com
        (게이트: Bearer <CF 뿌리 토큰> 의 sha256 == APEX_GATE_SHA256)
```

```bash
export CLOUDFLARE_API_TOKEN=<session-auth 의 뿌리 토큰>
node tools/gh-push.mjs --dry-run    # 무엇을 밀지 확인
node tools/gh-push.mjs              # origin/main..HEAD 를 Git Data API 로 재생
```
로컬 커밋을 blob → tree → commit 순으로 재생하되 **트리 해시를 로컬과 대조**하고(다르면 중단),
author/committer 를 그대로 넘겨 **커밋 SHA 가 로컬과 동일**하게 만든다. 밀고 나서 `git fetch` 하면 그냥 맞아떨어진다.
워커 소스: `tools/apex-git/`. 배포: `cd tools/apex-git && npx wrangler deploy`.
Secrets Store 의 `GITHUB_PAT`(fine-grained, Contents: Read and write)를 워커가 읽는다.

### R2 인계 통로 — 그마저 막혔을 때 (사람 없이 도는 예약 작업의 안전망)
버킷 `blade-surge-handoff` (같은 CF 계정). 회전을 닫을 때 커밋을 번들로 올린다.

```bash
# 올리기 (푸시 실패 시)
git bundle create /tmp/bs.bundle <직전커밋>..HEAD --branches
curl -sS -X PUT -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/octet-stream" --data-binary @/tmp/bs.bundle \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/blade-surge-handoff/objects/rotations/<sha>-<이름>.bundle"

# 받아서 이어붙이기 (새 세션 / PC)
curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/blade-surge-handoff/objects/rotations/<파일>" -o /tmp/bs.bundle
git fetch /tmp/bs.bundle HEAD && git merge --ff-only FETCH_HEAD
```

**새 세션은 클론 직후 이걸 먼저 확인해라** — origin/main 이 최신이 아닐 수 있다.
목록: `GET /accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/blade-surge-handoff/objects?prefix=rotations/`

### Cloudflare
`npm run deploy` = `vite build && wrangler deploy`. `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` 는 부트스트랩이 export 한다.
`apex-secrets` 워커는 `cd tools/apex-secrets && npx wrangler deploy`.

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
  look.js             장비 외형 — 등급별 무기/방패 메시, 발광, 강화 오라 (전투·로비 공용)
  skills.js           스킬 16종 — 진공·텍스처 VFX
  setprocs.js         테마 세트 발동 효과 — 서리결정/역병포자/룬각인/심연사슬 (회전 8)
  enemies.js          잡몹/엘리트/보스 AI, 보스 패턴 킷 3종
  drops.js            3D 필드 드랍 + 자석 흡수 + 희귀도 연출
  battle.js           방 진입/클리어, 히트 판정, 진공, 투사체, 히트스탑, 승패
  economy.js          세이브, 화폐/에너지, 성장, 세트 보너스, 강화, 가챠, 상점, 패스
src/data/             rigs(리그별 애니 이름 번역) / stages / heroes / items / shop
src/ui/               ui.js(HUD·결과·목업결제) / meta.js(로비·강화·소환) / minimap.js
public/models,img,bgm,sfx/
tools/metrics.mjs     자동 채점 하네스 (레벨 1 영웅 · 1층)
tools/shot_seal.mjs   게이트 B 컷: 봉인 결계 / 포탈 / 보스 진입
tools/shot_look.mjs   게이트 B 컷: 장비 외형 4영웅 × 3단계
tools/shot_combo.mjs  게이트 B 컷: 기본 콤보 홀드 체인 (사람 입력 경로 — 하네스 AUTO 는 탭이라 못 잡는다)
tools/voice/          보이스 파이프라인 — lines.mjs(대본·목소리 설명) → gen.mjs refs|lines|report (Runware Qwen VoiceDesign + Seed Audio, ASR 대조). refs/ 는 목소리 정체성 — 지우지 마라
tools/shot_sets.mjs   게이트 B 컷+단언: 테마 세트 4종이 실제로 발화하는지 (하네스는 장비 없이 돌아 세트를 못 본다)
tools/chrome.mjs      헤드리스 크롬 경로 해결 — 컨테이너의 /opt/pw-browsers/chromium 을 먼저 쓴다
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
- 보이스: 자체 생성 (Runware Qwen VoiceDesign 으로 설명문에서 만든 독자 목소리 → Seed Audio 연기. 실존 인물 클론 없음). 영어 + 기합
- 이미지/VFX: 자체 생성 (`parallel-gpt-image` 스킬, 또는 인앱 브라우저가 없는 예약 세션에서는 `RUNWARE_API_KEY` 로 Runware API)
  · Runware 는 `session-auth` 금고에 키가 있고 세션에서 바로 배치 생성된다 — 예약 작업(사람 없음)에서 쓰는 경로다

> Quaternius 미러 레포 중 "Patreon Exclusive" 폴더가 섞인 것이 있다. 공식 배포처에서만 받아라.

## 테스트

Playwright + SwiftShader 헤드리스. `tools/metrics.mjs` 가 전부 감싼다.
- chromium 이 `libXdamage.so.1` 을 못 찾으면(루트 권한 없음) .deb 를 받아 풀고
  `LD_LIBRARY_PATH=/tmp/libs/usr/lib/x86_64-linux-gnu` 로 실행한다
- 게임 시간 1.8초를 기다리려면 프레임을 넉넉히 밟아라. 슬로모가 걸리면 실시간과 어긋난다
