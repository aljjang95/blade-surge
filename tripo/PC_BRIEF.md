# 초보자 마을 Tripo 소품 8종 (blade-surge starter-village, 2026-10-24)

원화: out/p-*.png (이 브랜치, 순백 배경 단일 오브젝트). 원화를 새로 만들지 않는다.

## 순서와 목표
| 대상 | 원화 | 리토폴 삼각형 | 비고 |
|---|---|---|---|
| sv_cottage | out/p-cottage.png | 약 8,000 | 오두막(여러 채 인스턴싱) |
| sv_forge | out/p-forge.png | 약 8,000 | 열린 대장간 |
| sv_board | out/p-board.png | 약 3,000 | 의뢰 게시판 |
| sv_dummy | out/p-dummy.png | 약 2,000 | 허수아비 |
| sv_portal | out/p-portal.png | 약 5,000 | 포탈 아치(안쪽 비움) |
| sv_statue | out/p-statue.png | 약 5,000 | 영웅 동상 |
| sv_fountain | out/p-fountain.png | 약 5,000 | 분수 |
| sv_stall | out/p-stall.png | 약 5,000 | 상점 좌판 |

## Tripo 설정(공통)
- Tripo Studio 웹, Image to 3D, 모델 H3.1(없으면 가장 최신 기본 모델), 텍스처 켬(HD 텍스처가 크레딧을 크게 더 쓰면 기본), PBR 켬, 리그 없음.
- 생성 뒤 Retopology(리메시)로 위 삼각형 수 근처(quad 아님, triangle), 그다음 GLB로 내보내기(텍스처 2K 이하).
- 결과: tripo/<대상>/model.glb, 미리보기 2장 tripo/<대상>/front.png·top.png(Studio 화면 캡처면 충분).

## 기록
- tripo/RESULT.md 맨 위에 시작·끝 크레딧 표시값. 대상마다 한 줄: task id, 재시도, 사용 크레딧, 파일 크기, sha256, 삼각형 수(알 수 있으면), 비고.
- 대상 2개가 끝날 때마다 git add tripo; git commit; git push origin HEAD:art/starter-village-concepts.
