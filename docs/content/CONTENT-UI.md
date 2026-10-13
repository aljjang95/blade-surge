# 마을 콘텐츠 UI 계약

`TownUI`의 `마을 일` 패널은 현재 마을의 다섯 콘텐츠를 같은 저장 서비스에 연결한다.

- **던전 게이트**: 마을당 6개를 보여 주며 기존 출격 준비 창을 사용한다.
- **필드**: `fieldId`로 연결된 필드의 채집·정예·숨은 보물·필드 이벤트 정보를 보여 주고 기본 원정으로 입장한다.
- **의뢰 게시판**: `requests(townId)`, `acceptRequest(townId, requestId)`, `claimRequest(townId, requestId)`를 사용한다.
- **대장장이**: `blacksmith(townId)`, `craft(townId, recipeId)`, `enhance(townId, uid)`를 사용한다. 위험 강화는 두 번 눌러 확정한다.
- **마을 이야기**: `story(townId)`, `advanceStory(townId)`로 마을당 세 단계를 순서대로 진행한다.

서비스가 해당 메서드를 제공하지 않는 구형 런타임에서는 탭이 빈 상태 안내를 표시한다. 성공한 변경은 경제 HUD와 `TownService.onChange` 구독자에 전달된다. 해금은 처음 읽은 저장을 기준선으로 삼고 이후 새로 열린 마을·필드·대장장이·스토리만 인장과 `NEW` 표시로 알린다.
