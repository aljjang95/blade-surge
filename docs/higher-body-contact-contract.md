# 상위 다섯 몸체 교정·채택 계약

기준 HEAD는 ff16796f4dd73f12cfc40b77e5b1cd2a4aadd6a8이다. 대상은 hero_ranger_t2, hero_ranger_t3, hero_rogue_t2, hero_rogue_t3, avatar_rogue_crow다. 이 변경은 다섯 교정본의 선택 경로와 출처 검사를 준비한다. 실제 교정 GLB를 생성·검증하기 전에는 모든 기록이 DRAFT/useInGame:false/output.sha256:null이며 원본을 계속 선택한다. 생성하지 않은 SHA나 완료 상태를 채우지 않는다.

## 보존과 선택

원본 asset-library/normalized 파일과 manifest, 기본 궁수 ranger-library-v4, 기본 도적 rogue-library-v2, 공개 여우 몸체·모션을 보존한다. 머리·얼굴 정체성, 본 rest·역바인드·소켓·UV·재질, 공유 클립, 경제·저장·판정은 변경하지 않는다. 게임 프레임의 바닥 보정, 전 동작의 상수 root lift, 전체 가중치 이식은 금지한다.

src/data/higher-body-revisions-v1.json은 정확히 다섯 원본과 일대일이다. 각 source.path와 SHA는 기존 manifest 자산에 결합되고 출력은 /models/heroes-next/<revision-id>.glb 한 경로만 허용한다. revision ID·asset ID·출력 경로 중복, 다른 자산 경로, query, 경로 탈출을 거부한다. 상태가 GENERATED이고 실제 SHA가 기록된 경우만 useInGame:true를 허용한다. GENERATED라도 useInGame:false면 원본 선택을 유지한다. 런타임 선택 함수는 다운로드 바이트의 SHA를 계산하지 않으므로 실제 파일 SHA 검사는 채택 테스트·배포 검증에서 수행한다.

| 자산 | revision ID |
|---|---|
| hero_ranger_t2 | ranger-t2-body-fit-v1 |
| hero_ranger_t3 | ranger-t3-body-fit-v1 |
| hero_rogue_t2 | rogue-t2-body-fit-v1 |
| hero_rogue_t3 | rogue-t3-body-fit-v1 |
| avatar_rogue_crow | rogue-crow-body-fit-v1 |

갑옷 단계·아바타 우선순위는 기존 규칙을 따른다. 다섯 몸체는 메시 전용이며 궁수 두 몸체는 기본 궁수의 11클립, 도적 두 몸체와 까마귀는 기본 도적의 14클립을 공유한다. 후속 승인 범위로 몸체별 정적 모션 선택과 교체 전 검증을 준비한다. 신규 모션 JSON은 bodies:[]이며 실제 저작 패킷 전까지 비활성이다.

## 저작 순서와 수용 기준

먼저 실제 Blender에서 근거 있는 몸체 외피와 승인된 국소 영향 범위만 피팅한다. Blender 원본 .blend, 저작 코드·로그, 원본·후보 GLB, 패치와 BIN/JSON 성분 차이, 각 SHA를 보존한다. 다른 몸체에 여우의 가중치 영역이나 높이 곡선을 그대로 복사하지 않는다. 궁수 3단계는 idle에서 떠 있고, 도적 일부 결함 정점은 Hips와 양쪽 UpLeg가 섞여 있으므로 일괄 상향 이동이나 기존 pure-leg 규칙만으로 해결됐다고 가정할 수 없다.

피팅 후에도 남는 실제 접촉 결함을 측정한 뒤에만 root가 별도의 자산별 offline 동작 계약을 확정한다. 고정 저작 곡선은 본의 실제 부모 좌표계를 읽어 저장해야 하며, 공유 클립 바이트를 수정하거나 게임에서 매 프레임 계산하지 않는다. 이번 런타임 확장은 실제 저작 패킷의 선택·검증만 담당하며 곡선을 생성하지 않는다.

타깃 다섯 몸체는 실제 loadHeroAsset/spawnCharacter direct 및 기존 몸체 swap 양쪽에서 모든 공유 클립을 검사한다. 301 균등 표본과 모든 원본/저작 키, 기존 실패 시점을 포함한다. Actor의 의도된 사망 후 침하를 제외한 저작 스킨 최저 y>=-.01m, 지지발 abs(y)<=.02m, death 끝 abs(y)<=.02m을 지킨다. 의도된 공중 동작과 지지 구간을 구별하며 수치만으로 의상·실루엣을 승인하지 않는다. 기본 몸체와 공개 여우 대조군은 기존 계약과 비악화를 확인한다. 대조군 비악화 기준을 타깃의 기존 관통을 허용하는 근거로 쓰지 않는다.

현재 25표본 baseline은 결함 진단 자료다. A3의 301표본+모든 키 수용 검사가 완료됐다는 뜻이 아니다. 후보 채택에는 실제 PC GPU 음소거 화면·착용 초상·무기·direct/swap·회피/사망과 모바일 viewport, strict media 검토가 필요하다. viewport는 실제 Android·터치·열 검증을 뜻하지 않는다.

## 활성화 절차

1. 실제 저작·패킹 산출물의 원본 SHA와 허용 성분 차이를 독립 확인한다.
2. 후보 GLB를 지정된 새 경로에 두고 실제 output SHA 및 저작 출처를 기록한다. 원본과 실패 후보는 보존한다.
3. 대상 비관통·대조군 비악화·무기·실화면과 정식 check가 통과한 근거를 남긴다.
4. root가 해당 자산만 GENERATED/useInGame:true로 채택한다. 런타임 경로 테스트는 각 실제 파일 SHA를 확인한다.
5. 기존 공개 배포 컨트롤러·소유 잠금·정확 HEAD·rollback·공개 검증·원본 보관 계약을 유지한다.

## 자산별 정적 모션 계약

src/data/higher-body-motion-v1.json의 schema는 blade-surge.higher-body-motion.v1이며 현재 bodies는 빈 배열이다. 대상 다섯 몸체의 고유 머리·장식 문제에서 dodge/death만 별도로 승인할 수 있다. 공격·idle·망토 리깅 결함을 골반 상승으로 덮지 않는다. 기존 fox JSON과 createBodyMotionClip 기본 API·수치 계약은 그대로다.

각 body record는 asset/heroId/revisionId, body:{path,sha256}, base:{path,sha256}, motionRevisionId, output:{path,sha256}, clipOverrides를 가진다. 활성 GENERATED 몸체 revision의 정확한 GLB 경로·SHA와 ranger V4/rogue V2 canonical GLB 경로·SHA를 검사한다. motionRevisionId는 해당 몸체 이름의 <ranger-t2|ranger-t3|rogue-t2|rogue-t3|rogue-crow>-body-motion-v1이며 output.path는 /models/heroes-next/<motionRevisionId>.json이다. output SHA는 번들 자신의 해시가 아니라 별도 보존·배포한 실제 저작 원본 패킷 파일에 결합한다. 새 패킷 없이 임시 SHA를 넣지 않는다.

각 override의 base는 clip, duration, hipsTrack, sourceTrackSha256, interpolation:LINEAR 및 실제 canonical decoded Float32 times/values snapshot을 가진다. outputTrack은 name, type:vector, interpolation:LINEAR, times, values다. authoring은 실제 profileId, parentWorldYGain, initialOffsetMeters, finalOffsetMeters, maxOffsetMeters를 가진다. 실제 본 부모의 world 행렬 축·배율과 parentWorldYGain이 일치해야 한다. 골반 X/Z는 Float32 저장값 기준 불변, Y는 승인된 비음수 높이 곡선이며 최대 .35m, 시작/끝 offset을 검사한다. 전 구간 상수 상승은 거절한다. 원본 키를 포함한 최소 120Hz 저작 표본이며 실행 중 곡선·바닥 보정은 없다.

validation.supportStartMeters/supportEndMeters는 실제 저작 지지점 결과이며 절댓값 .02m 이내다. death에는 deathEndMeters도 필요하다. 이 기록은 런타임의 스킨 검사나 최종 A3/GPU 증거를 대체하지 않는다. root가 실제 수용 검사 이후 값을 채운다. 런타임은 원본 times/values를 canonical과 exact 비교한다. 테스트는 실제 공개 GLB·패킷 파일 SHA와 원본 track SHA를 계산한다. track SHA의 바이트 순서는 UTF8(name)+NUL+u32LE(timeCount)+u32LE(valueCount)+float32LE(times)+float32LE(values)다.

캐시는 canonical clip과 불변 전체 body/motion descriptor identity를 함께 구분한다. 인스턴스마다 canonical 및 alias의 마지막 설치 reference를 보관해 A→B→기본/fox를 복원한다. 사용자 추가 key·외부 덮어쓴 alias는 보존한다. 원본 clip 배열·다른 track reference는 수정하지 않는다. 진행 중 action의 clip/time/weight는 그대로이고 미래 lookup만 변경한다.

로더가 선택한 몸체 식별자를 캡처하고, swap은 실제 target·hero·revision과 모든 모션을 검증한 뒤 새 메시를 준비한다. 검증·최신 요청 확인에 실패하면 기존 메시·재질·skeleton·별칭을 유지한다. 검증된 계획만 설치한 후 기존 메시를 해제한다. 직접 spawn도 같은 검증을 사용하며 잘못된 활성 패킷을 조용히 원본 모션으로 대체하지 않는다.

신규 JSON bodies가 비어 있는 현재 단계의 테스트는 준비된 선택·복원·거절 계약만 검증한다. 생성된 신규 모션이나 실제 접지·실화면 성공을 주장하지 않는다.
