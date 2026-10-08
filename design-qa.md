# 출격 준비 모험 수첩 — Design QA

final result: passed

source visual truth: `work/design/departure-journal-20261008/departure-journal-concept-v1.png` (941 × 1672 px, generated concept)
implementation evidence: `work/design/departure-journal-20261008/ui-icons-2915cea/portrait-departure-journal.png` (390 × 844 px, Chromium portrait viewport, deviceScaleFactor 1)
combined comparison: `work/design/departure-journal-20261008/design-qa-final-comparison.png`
tested source: commit `2915ceaa0799b98677d41b4d80851298d57329f1`
state: 유리 정원 기본 원정 준비창, 에너지 100, 심층 원정 잠금 표시, 규칙/서약 접힘, 하단 출격 버튼 표시

## Comparison

- Typography: 아이보리 표면의 짙은 비취색 제목과 보조 문구의 대비가 유지된다. 작은 물약 설명은 `효과` disclosure 안으로 들어가며 제목·보상 수량·출격 CTA는 세로 화면에서도 읽힌다.
- Spacing and layout: 정원 그림, 원정 단계, 자원, 보상, 출격 준비, 접힌 규칙, 하단 CTA 순서가 컨셉과 일치한다. 390 × 844에서 가로 overflow가 없고 하단 CTA가 viewport 안에 있다. 데스크톱 918px dialog와 844 × 390 landscape도 같은 정보 구조를 사용한다.
- Colors and tokens: 승인된 따뜻한 아이보리·깊은 비취·절제된 황동 조합을 사용하며, 잠금/선택/오류 상태는 기존 준비 데이터와 접근성 focus outline을 유지한다.
- Image quality and assets: 새 유리 정원 헤더와 종이 질감은 자체 생성 WebP다. 기존 보상·물약 자산은 어두운 배경을 corner-color 기준으로 alpha key한 프로젝트 전용 WebP로 저장했고, 원본·처리·SHA-256은 `public/img/departure-journal/provenance.json`에 기록했다. 최종 비교에서 아이콘은 종이 표면 위에 원형 메달처럼 보이고 어두운 사각 배경은 보이지 않는다.
- Copy and content: 실제 데이터에서 골드 360, 탐험 경험치 100, 유리 잎 3, 회복 물약 1, 에너지 4/6/100, U/I/O 재고와 영웅을 표시한다. 목표·지역 행동·프론티어·개인 목표·서약 합산 설명은 disclosure 안에 남아 있다.

## Iteration history

1. Initial implementation exposed the existing dark green wall of text. The fix introduced the journal composition, hero art, icon rewards, compact loadout, disclosures, and fixed footer.
2. First visual QA found dark square backgrounds on reused icons. A `screen` blend trial made icons too faint in the combined comparison and was rejected.
3. The bounded repair replaced the trial with alpha-keyed project assets. The same viewport comparison now shows readable colored icons with no visible square background. No P0/P1/P2 findings remain.

## Functional evidence

- `tools/garden-ui-qa.mjs` at `work/design/departure-journal-20261008/ui-icons-2915cea/report.json`: desktop, landscape, and portrait all passed; 12 native selection cards, resource-preserving cancel/focus restoration, rules disclosure, oath save/restore, locked deep inspection, footer visibility, and zero browser/runtime/HTTP errors.
- `tools/parallel-play-qa.mjs` at `work/design/departure-journal-20261008/play-icons-2915cea/report.json`: touch profile functional-pass with native multitouch cancellation, portrait/landscape layout, result return, save/reload preservation, exact clean build identity, and D3D11 renderer.
- `bun run check`: 1766 passed, 3 skipped, 0 failed; production build completed.

## Remaining evidence boundary

The QA is browser-based and does not establish physical Android GPU, thermal, audio, multiplayer server persistence, payment, or store acceptance.
