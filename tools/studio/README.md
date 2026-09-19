# Blade Surge · Blender 수동 작업 연결

검증 버전: Blender 5.2.1 LTS. 기존 APEX 작업 흐름에서 사용하는 로컬 실행 어댑터입니다.
게임 엔진은 기존 Three.js/WebGL2를 유지합니다. Unity로 자동 전환하지 않습니다.

## 직접 작업
저장소 루트의 `Blender-Studio.cmd`를 실행하면 열기 / 내보내기 / 연결 검사를 선택할 수 있습니다.
명령줄에서도 같은 경로를 사용합니다.

```bat
Blender-Studio.cmd doctor
Blender-Studio.cmd open
Blender-Studio.cmd export
Blender-Studio.cmd open art/frost-armor-v1/knight-rime.blend
Blender-Studio.cmd --request tools/studio/request.example.json
```

`open`은 원본을 해시별로 백업한 뒤 실제 Blender 창을 엽니다. 편집 후 Blender에서 저장하세요.
`export`는 저장된 파일을 읽습니다. 내보낼 메시를 선택해 저장하거나 `TLL_EXPORT` 컬렉션에 넣으세요.
현재 내보내기 규약은 `tllBone`이 있는 장비 부착 메시입니다. 전신 리그·애니메이션의 범용 변환기는 아닙니다.
미리보기용 Armature 변형은 제외하고, 다른 모델링 수정자를 평가해 별도의 GLB를 만듭니다.
실제 GLB 재가져오기, 메시 수·뼈 태그·유한 좌표·원본/출력 해시를 검사합니다.
결과와 로그는 `work/studio/exports/<실행번호>/`, 최근 상태는 `work/studio/last-*.json`에 남습니다.
기존 납품 GLB·게임 코드·저장 데이터·운영 배포는 자동으로 덮어쓰지 않습니다.

## 명령과 수기 요청 파일
`bun run studio doctor`, `bun run studio open`, `bun run studio export`도 같은 어댑터를 호출합니다.
`request.example.json`은 `action`과 `input`만 허용하는 수기 요청 예시입니다.
허용 작업은 `doctor`, `open`, `export`이며 임의 셸 실행·외부 주소·운영 배포 요청은 받지 않습니다.
입력은 이 저장소의 `art` 폴더 안 `.blend`로 제한됩니다. 다른 경로·추가 필드는 오류로 종료합니다.
Blender 파일의 자동 Python 실행은 꺼진 상태로 엽니다. 설치 버전이 바뀌면 재검증하도록 중단합니다.
Blender 위치가 다른 승인된 환경은 `BLENDER_BIN`으로 실행 파일 경로만 지정할 수 있습니다.

## 재검증
현재 갑주 원본 기준으로 아래 순서로 실행합니다.
```bat
bun run studio export
bun run studio:test
bun run check
```
`studio:test`는 잘못된 요청 거절과 원본 GLB 대비 바인드 자세의 정점 집합 일치를 검사합니다.
수동으로 형상을 바꾼 뒤 원본 GLB와 다르다는 비교 실패는 정상입니다. 새 후보의 게임 검증이 필요합니다.
창 실행 성공, GLB 내보내기 성공, 실제 게임 장착 성공은 별개의 단계입니다.
현재 장착 코드·실기기·재부팅·운영 배포는 이 어댑터 검증 범위가 아닙니다.
