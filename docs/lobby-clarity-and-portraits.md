# 모험 입구와 현재 착용 초상
2026-10-17. 기존 dungeon-first-lobby 계약의 홈3탭·출격 준비를 유지한다.

모험의 상시 입구는 캠페인과 던전이다. 제작 공방·전직·퀘스트는 정비·임무 안에서 기존 버튼과 목적지를 그대로 사용한다. 직접 호출은 해당 정비 영역을 열고, 저장되지 않은 결과 화면의 이탈 가드는 그대로 적용한다. 결투장 데이터·서비스는 삭제하지 않으며 일반 솔로 진입 버튼은 처음 생성할 때부터 숨긴다.

영웅 목록·상단·던전 준비·출격 HUD는 hero-portraits.js의 같은 현재 착용 초상을 사용한다. 기존 spawnCharacter/applyLook, 실제 heroEquipInsts/equippedAvatar를 재사용한다. 몸체 preload를 기다리고 실제 libraryBodyAssetId를 확인한 뒤 Idle의 상반신을256px 정지 이미지로 만든다. 한 렌더러에서 직렬 처리하며 대기열·LRU캐시24개 제한, 비활성시GPU해제, 지연 요청의 연결/외형키 재확인, 실패시 기존 정적 초상 fallback을 사용한다. fallback은 현재 장비 표시 완료로 기록하지 않는다. GLB·리깅·경제·저장·전투 규칙은 바꾸지 않는다.

아이템은 기존 itemVisual/resolveItemForm과 공통 buildItemVisualModel을 유지한다. 3D canvas는 최초 실제 render 후 모델의 itemVisual metadata를 노출하며 disposed/pending/ready를 구분한다. 이 표식은 요청값을 실제 준비 결과로 대신하지 않는다.

기존 자체 호스팅 Blade Sans KR/Blade Title KR를 유지한다. lobby-clarity.css는 로비·정비·출격의 주요 조작과 비용·잠금 안내14px, 부가정보12px, 조작 높이44px를 적용한다. 전투 HUD나 모바일 제스처·발열 정책은 이번 범위에 없다.

검증은 test/hero-portraits-lobby.test.ts의 실제 nav factory·비동기 capture/cache/dispose 경계와 전체 check, 실제PC의 현재 착용/모험/출격·정산·복귀/작은뷰포트·폰트·미디어로 수행한다. 동적인 current-look 캡처가 실패하면 기존 초상을 보여 주며 새 장비가 반영됐다고 주장하지 않는다. PC뷰포트는 실제 Android 입력/열 검증을 대체하지 않는다.
