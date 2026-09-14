# 로컬 파일 편집 도구

`tools/scoped-edit.py`는 기존 Python으로 실행하는 프로젝트 전용 텍스트 편집기다. 별도 API, 서버, 플러그인 설치나 계정 설정 변경이 없다.

## 실행

저장소 루트에서 `python -B -X utf8 tools/scoped-edit.py info src/game/combat-contact.js`로 현재 파일 해시를 읽는다.
`work/edit-bridge/inputs/change.json`에 `path`, `before_sha256`, `old`, `new`, `count` 다섯 필드를 저장한다.
`path`는 `src/game/combat-contact.js`처럼 저장소 상대 경로이며, `old`와 `new`에는 정확한 문자열을 넣는다.

```text
python -B -X utf8 tools/scoped-edit.py plan work/edit-bridge/inputs/change.json
python -B -X utf8 tools/scoped-edit.py apply work/edit-bridge/inputs/change.json --expected-plan <plan_sha256>
python -B -X utf8 tools/scoped-edit.py rollback <receipt_id>
```

미리보기는 파일을 바꾸지 않는다. 적용 시 원본 해시와 치환 개수를 재확인하고, 원본 백업과 변경 기록을 남긴 뒤 임시 파일의 원자적 교체로 반영한다. 롤백은 현재 파일이 해당 변경의 전후 해시와 다르면 거부하여 후속 편집을 덮어쓰지 않는다.

## 범위와 한계

기존 UTF-8 텍스트 파일만 편집한다. 한글과 CRLF/LF 바이트를 보존하며 파일 크기는 2 MiB 이하, 변경은 한 번에 한 파일이다. 새 파일 생성과 바이너리 자산 편집은 기존 파일 도구를 사용한다.
소스·테스트·문서·도구 디렉터리 안에서 동작하며 자격증명, 배포, 권한, 헌법, Git 내부 경로는 제외한다. 링크·junction·하드링크 경로도 허용하지 않는다.
동일 편집기 실행끼리는 잠금으로 직렬화하며 남은 잠금을 자동 탈취하지 않는다. 다른 프로그램이 동시에 쓰는 상황에 대한 OS 수준 비교-교환이나 다중 파일 트랜잭션은 제공하지 않는다.
이 도구는 MCP 함수의 입력 스키마나 ChatGPT의 생각 실패·플랫폼 안전 검사를 변경하지 않는다. 차단된 명령을 우회하는 실행기가 아니다.

검증: `python -B -X utf8 -m unittest discover -s tools/tests -p test_scoped_edit.py -v`.
실행 기록·원본 백업·미리보기 입력은 Git에 포함되지 않는 `work/edit-bridge/`에 남는다.
