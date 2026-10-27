# 소식 시스템 — 공지·패치노트·개발 노트

정본 계약은 `docs/SPEC_720H.md` 4A.2. 이 문서는 구현 위치와 운영 순서만 적는다.

## 구조

| 조각 | 위치 | 설명 |
|---|---|---|
| 콘텐츠 정본 | `content/news/<YYYY-MM-DD>-<slug>.md` | 머리말 `type: notice\|patch\|devnote`, `title`, `date`(KST), `version`(패치만), `pinned`, `summary`(선택), `draft`(선택). slug 는 영문 소문자·숫자·-. 파일 이름의 날짜와 `date` 가 같아야 한다 |
| 변환·규칙 | `src/shared/news-core.js` | 머리말 파서, 마크다운 부분집합(제목·목록·굵게·링크, 전부 HTML 이스케이프, 링크는 http(s)만), 정렬·고정·안 읽은 계산 |
| 빌드 | `tools/build-news.mjs` | `public/news.json`, 정적 `public/news/**`(생성물, Git 제외), 오프라인 묶음 `src/data/news-bundle.json`(커밋) |
| 게임 안 | `src/ui/news.js`, `news-state.js`, `news.css` | 로비 메뉴 '소식'(시스템 묶음) + 안 읽은 점, 분류 탭·목록·본문 |
| 패치노트 초안 | `tools/patch-notes.mjs` | 지난 배포 이후 PR 제목 → `draft: true` 초안 |
| 디스코드 | `tools/post-news-discord.mjs` | 기본 드라이런, `--send` 명시 때만 전송 |
| 게시판 연결 | `packages/tll-social` | '반영 완료' 글의 `patchNoteSlug` + '패치노트 보기' 링크 |

`bun run build`/`bun run dev` 가 `node tools/build-news.mjs` 를 먼저 돌린다. `content/news` 를 고친 뒤에는 `node tools/build-news.mjs` 로 `src/data/news-bundle.json` 을 갱신해 함께 커밋한다(`test/news.test.ts` 가 최신인지 검사한다).

## 배포마다 패치노트

1. `node tools/patch-notes.mjs` — 운영 `version.json` 의 sha 이후 머지된 PR 로 `content/news/<오늘>-patch-<버전>.md` 초안을 만든다(이미 있으면 종료 코드 1, 덮어쓰지 않음). 운영 sha 를 못 읽으면 `--since <sha|tag>` 를 준다.
2. 이용자 말투(짧고 친근한 존댓말, 과장·약속·가격 금지)로 다듬고 내부 줄을 지운 뒤 `draft: true` 줄을 지운다.
3. `node tools/build-news.mjs` → 커밋 → 같은 배포에 싣는다.
4. 고쳐진 버그 제보 글은 관리자 화면에서 '반영 완료' + 패치노트 글 ID(예: `2026-10-27-patch-1-0-3`)로 바꾼다. 이용자 화면 상세에 '패치노트 보기' 링크가 보인다.
5. 디스코드: `node tools/post-news-discord.mjs --slug <id>` 로 JSON 을 확인한다. 실제 전송(`--send`, 환경 변수 `DISCORD_WEBHOOK_NEWS`)은 공개 게시라서 집행 직전 문구를 대표님께 확인한 뒤에만 한다.

## 한계

- 게임 안 소식은 `/news.json` 을 받고, 못 받으면 빌드에 포함된 최신 20편 묶음을 보여 준다. 묶음은 배포 시점 기준이라 그 뒤에 올라온 글은 온라인이어야 보인다.
- 안 읽은 표시는 UI 전용 localStorage 키 `blade-surge:news:last-read:v1`(마지막으로 읽은 글 id) 하나다. 게임 세이브와 서버에는 저장하지 않으므로 기기마다 따로 센다.
- `news/**` 는 스토어 채널에서도 core 로 분류된다(작은 정적 HTML 몇 편). 글이 많이 늘면 `tools/optimize/asset-split.json` 의 규칙을 다시 본다.
