# 미디어 요청 수명 경계 (classifyMediaCancellations)

`tools/conquest-media-observer.mjs`의 `classifyMediaCancellations`는 `net::ERR_ABORTED`로 끝난 200/206 미디어 요청을 "관찰상 정지된 인스턴스 + 독립 재생 대체" 증거가 있을 때만 `observed-stopped-media-cancellation`으로 분류한다. ERR_ABORTED 자체를 허용 목록에 넣지 않으며, 증명되지 않으면 unresolved로 남아 QA 미디어 게이트를 실패시킨다.

## 요청 수명

실패 요청의 수명은 `[started ?? at, failedAt]`이다. 증거는 같은 engine·같은 documentId의 관찰만 쓰며, 판단 스냅샷은 `failedAt` 이후 가장 늦은 누적 스냅샷이다. 그 스냅샷에는 실패 뒤의 정상 재생(예: 승리 후 로비 복귀 BGM)도 함께 남는다.

- `source-created` 후보와 정지 증명 history는 이미 `at <= failedAt`으로 묶여 있다.
- trusted native loadstart 보조 앵커는 2026-10-17부터 같은 수명 경계를 따른다. 같은 URL loadstart 중 아래 조건을 **모두** 만족하는 것만 "이후 수명"으로 보고 initiation 모호성 집합에서 뺀다.
  1. 실패 앵커 인스턴스와 다른 인스턴스 id
  2. `isTrusted === true`, `nativeAt === nativeTimeOrigin + nativeTimeStamp`, 모든 시각이 유한값
  3. `failedAt < nativeAt <= at` (경계와 같은 시각은 모호로 남김)
  4. 그 인스턴스의 모든 관찰 이벤트가 `failedAt` 이후이고, 같은 URL `source-created`가 있음
- 하나라도 불확실하면 기존처럼 initiation으로 세어 `ambiguous-or-missing-request-start-instance`로 남는다. 경계 안의 겹치는 initiation, 같은 인스턴스 재로드, 다른 문서 관찰, `failedAt` 누락은 모두 unresolved다.

엄격한 250ms 시작 앵커, trusted/clock/document/instance/range 조건, 실제 disconnect 정지와 대체 재생 증명은 바꾸지 않았다. 제외한 이후 수명은 `requestStartEvidence.laterLifecycleInitiationsExcluded`에 기록한다.

## 근거와 한계

2026-10-16 로컬 journey 원본 report(sha256 `5b593526…d535`, 불변)는 raw `fail`이었다. 실패 시점 체크포인트는 분류되지만, 누적 최종 스냅샷의 로비 복귀 인스턴스 4 loadstart(failedAt + 약 14.8초)가 두 번째 initiation으로 세어져 모호 판정이 났다. 수정 classifier로 같은 원본을 재평가하면 체크포인트 2·3·4 모두 instance 1 정지, tide(2) 대체로 분류되고 인스턴스 4만 제외된다. 이는 기존 원본의 오프라인 재평가이며 새 journey PASS, 가청 출력, 실기기 오디오 증거가 아니다. 새 PASS는 통합 뒤 root의 새 full journey 실행으로만 확인한다.
