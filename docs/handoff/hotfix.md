# 핫픽스 레인 인계 (2026-10-29, blade-hotfix#u-gear-warrior)

지휘 세션: session_01H8mx3U9qK3w3SjT5hPBKSr · 이 레인 세션: session_01H8mx3RytDNuuwrUtqdGjkp

## 목표
대표님 라이브 신고 3건: ① 유니크 장비가 하위 등급보다 전투력 낮음 ② 전사(검성 아르카) 기본 콤보 막타에 캐릭터 사라짐 ③ 전사 팔자걸음.

## 끝난 것
- ① 머지 PR #397 → main 2022df2. 배포 완료: blade.tllhouse.com/version.json sha=2022df2fb4ff, Version bbb43181-bb0a-49e5-9e1c-ecc8f4f59371 (PC 깨끗한 worktree + `node tools/deploy.mjs --auth=wrangler`, version-verified).
  - 원인: 가챠·제작·보상 장비와 10-28 il 도입 전 장비에 스테이지 장비 레벨(il)이 없어 같은 진행 필드 드랍 하위 등급이 앞섬.
  - 수정: il 생략 시 `progressItemLevel(progress)`(loot-tables.js), 저장 정화 1회 이월(`gearIl`), 서버 가져오기(legacy-sanitize.js)도 정화된 진행도로 재부여, test/gear-rarity-order.test.ts 불변식.
  - 검사: 전체 테스트 6155 pass, sim:90d 밴드 통과, Sonnet 독립 리뷰 지적 1건 반영. Codex 리뷰는 머지 직전 시작돼 결과 미확인.

## 진행 중
- ② 막타 사라짐: Opus 하위 에이전트가 이 세션의 worktree에서 재현 중. 목표 브랜치 `claude/hotfix-finisher-vanish`(아직 푸시 없음). 재현: `bun run dev` + Playwright로 knight 기본 공격 4타(player.js `c.finisher`) 고정 스텝 캡처, 영웅 위치 NaN·visible·opacity·스킨 메시 바운딩/절두체·카메라 근평면 확인.
- ③ 팔자걸음: Opus 하위 에이전트, 목표 브랜치 `claude/hotfix-warrior-gait`(아직 푸시 없음). 이전 걸음 수정 커밋을 찾아 왜 라이브에서 안 먹는지(아바타 착용 경로·클립·축) 확인, 발 yaw 벌어짐 각도 측정 테스트로 고정.
- 반지 탭 라이브 캡처(2000×900·390×844) Haiku 진행 중 — 증거 경로는 세션 scratchpad.

## 남은 일 순서
1. ②·③ 브랜치 받아 `bun run check` → PR(버그별 분리) → Sonnet 독립 리뷰 → 머지
2. PC 배포(최신 origin/main SHA만, deploy.mjs --auth=wrangler, 잠금 존중) → version.json readback
3. 막타·걷기 전후 캡처(화면 크기 명시)를 지휘에 → `apex done`

## 다음 행동 1줄
② ③ 하위 에이전트 결과 확인 — 세션이 끊겼으면 위 재현 방법으로 새로 시작.

## 주의
- 겹침: 아바타 레인이 src/engine/hero-body-motion.js·library-assets.js를 만짐(#396·#400 머지됨). 장비 아트 레인이 렌더 매니페스트(item-presentation*.json, gear-icon-studio.manifest.json)를 관리 — items.js를 바꾸면 sourceHash 갱신 필요.
- 배포 규칙(지휘 공지): 최신 origin/main만, raw wrangler·rollback 금지, readback 필수, 실패 시 재시도 전 지휘 보고.
