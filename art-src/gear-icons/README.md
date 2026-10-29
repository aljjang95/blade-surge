# 장비 아이콘 (Tripo Image 콜라주 -> 투명 PNG)

1. 요청서: `brief.json`(sheets[].id, grid [열, 행], cells[] 순서 = 왼→오, 위→아래)의 시트별 prompt로 Tripo Image에서 콜라주 한 장을 만든다(흰 단색 배경, 칸마다 물건 하나, 굵은 남색 외곽선).
2. 생성물은 R2 `blade-surge-handoff` 버킷 `tripo-image/D/<시트id>.png`에 올린다.
3. 자르기: `python3 tools/art/icon-collage-split.py <시트.png> --brief art-src/gear-icons/brief.json --sheet <시트id> --out <dir>`
   - 칸을 균등 분할하지 않고 배경이 아닌 화소의 연결 성분 N개를 찾아 행/열 순서로 cells에 맞춘다(가까운 조각은 한 물건으로 합침).
   - 덩어리 수가 cells 수와 다르면 exit 2(사유 출력, 파일 미생성). `--tol`(흰색 허용치), `--merge`, `--noise`, `--hole`로 조정 후 재시도하거나 시트를 다시 생성한다.
   - 출력: `<dir>/<id>.png`(RGBA, 1024² 이하, 여백 8%), `contact.png`(체커 배경 대조 시트), `report.json`(id, bbox, 면적비, sha256). 반드시 contact.png를 눈으로 확인한다.
4. 256 webp 변환은 외형 레인의 변환 도구(`claude/icon-tone-60` 브랜치의 `tools/art/`, 머지 후)와 같은 규격으로 한다 -> `public/img/gear/<id>.webp`.
5. 도구 시험: `python3 tools/art/icon-collage-split.test.py`(승인된 개별 아이콘으로 가짜 시트를 실행 시 합성, 알파 IoU >= 0.97 확인).
