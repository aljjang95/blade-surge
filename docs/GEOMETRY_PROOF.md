# 지역 건축 보존 검사의 런타임 경계

2026-10-08 Windows Bun 1.4.2에서 `region-architecture-batching`의 역사 geometry 해시 검사 16개가 실패했다. 게임 렌더러를 바꾸거나 현재 출력으로 역사 해시를 덮어쓰지 않고 검증 경계를 조사했다.

역사 커밋 `ae2260e46be7d88ba1f47336f460668ec07199fe`의 원본 renderer Git blob SHA-256은 기존 JSON의 `originalSourceSha256`과 정확히 일치했다. 그 원본과 현재 renderer를 같은 초기 지형에서 실행하면 Bun에서도 지오메트리 바이트가 동일하다. Crypt 표본의 Bun/Node 차이는 법선 잔차였으며 최대 절댓값 차이는 `4.440892098500626e-16`이었다. 그 정도 차이도 raw byte SHA에는 반영된다. Node/V8에서 일부 역사 해시는 그대로 일치했지만 frost 등은 불일치하므로 V8이라는 엔진 이름만으로 역사 실행 플랫폼을 단정하지 않는다. 재질의 함수 `toString()` 표현도 Bun과 Node 사이에 다르다.

현재 검사는 다음 기준을 함께 적용한다.

- 역사 renderer 전체를 `test/fixtures/region-architecture-ae2260e.source.txt`에 그대로 보존하고 로딩 시 기존 Git blob SHA-256과 대조한다. import 세 줄만 현재 런타임의 같은 의존성에 결박하며 renderer 본문은 수정하지 않는다. Three.js r170도 고정한다.
- Bun에서 같은 원본의 순서 있는 지오메트리 바이트와 현재 방 배치의 바이트를 정확히 비교한다. 수치 허용 오차, 정점 정렬, normal 제거를 사용하지 않는다.
- 별도 Node/V8에서도 16개 사례의 현재/원본 바이트를 정확히 비교한다. 역사 JSON geometry 해시는 수정하지 않고 실행 결과와 일치 여부를 진단 출력에 남긴다. 런타임이 다른 역사 해시를 현재 코드 회귀로 단정하지 않는다.
- 기존 JSON의 재질 해시는 Bun에서 원본과 현재 모두 계속 검사한다. Node에서는 같은 엔진의 원본/현재 재질 해시를 비교한다. 기존 메타데이터·정점 수·방/재질 역할·컬링 구·그림자·폐기·마스터리 추가분 검사는 유지한다.
- 검증 입력은 기준 후보 `6fd971d`의 16개 사례를 `region-architecture-inputs.json`에 고정한다. 현재 지형과 원본 지형을 동시에 바꿔 비교를 우회하지 못한다. 추가 마스터리 부분은 기존 garden-loop 계약대로 역사 지형에서 분리한다.
- 방 크기 변조와 position/normal/color/uv의 Float32 한 비트 손상이 거부되는 대조 검사를 실행한다.

원본 JSON을 재생성하지 않았으며 production 렌더러·에셋·전투 규칙도 변경하지 않는다. 검증 fixture는 정상 gameplay와 구분한다. `bun run check`는 기존 진입점이고 검사에 실제 Node/V8도 필요하다. 누락된 Node나 손상된 역사 원본을 건너뛰지 않고 실패한다. 기존 `parallel-play-qa.mjs`로 깨끗한 후보 production build의 수동/터치/성장 경로를 재실행하며 물리 Android·오디오·배포 승인으로 확대하지 않는다.

전체 검사에서는 Windows Git 자식 호출이 많은 dirty-check 및 실제 DPAPI 통합 테스트가 기본 5초에서 간헐적으로 시간 초과했다. 단독 DPAPI 재현도 약 4.5초가 걸렸으므로 이 두 통합 검사에만 20초 한도를 명시했다. 배포 차단·손상 데이터 거부·값 비노출 assertion과 production 자식 실행 제한은 그대로다. 게임 성능 밴드를 바꾸는 조치가 아니며 실패 로그는 별도로 보존한다.
