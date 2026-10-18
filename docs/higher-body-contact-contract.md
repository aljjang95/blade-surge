# 상위 다섯 몸체 교정·채택 계약

## 현재 저작 패킷과 검증 경계

상위 궁수 2종·도적 2종·까마귀는 각자의 실제 교정 GLB를 사용한다. 도적 2단계는 별도 `rogue-t2-body-motion-v2.json`의 회피·사망·찌르기 3개 저작 트랙을 선택하고, 나머지 네 몸체는 v1 패킷을 사용한다. `higher-body-motion-v1.json`의 이전 도적 2단계 기록과 공개 v1 원본은 비교용으로 보존한다. 활성 레지스트리는 이전 도적 기록만 제외하고 새 v2를 더한 정확히 다섯 몸체다.

도적 2단계 찌르기는 승인된 20개 고정 키의 -.012..0m 범위를 Blender에서 저작해 120Hz·원본 키를 포함한 Float32 LINEAR 트랙으로 저장한다. 기존 회피·사망 트랙은 수치 그대로다. 피부 최저점을 따라 게임에서 보정하거나 전 동작을 일정하게 올리지 않는다. 원본 decoded 트랙·다른 본 트랙·현재 재생 액션·외형 교체 시 사용자 별칭을 보존한다.

형상 정책37은 불변 foot02와 frozen07이 같은 시각에서 모두 비퇴화하고 방향이 충돌할 때만 secondary 방향 비교를 적용하지 않는다. primary 방향·양쪽 면적·raw/REST 검사와 모든 접지 기준은 유지한다. 이는 수용 집합의 명시적 확대이며 이전 실패를 통과로 소급하지 않는다. 추가 시각에서도 후보와 무관한 원본 두 개로 조건을 다시 계산한다.

REST 검사는 direct/swap/기존 모션 각각에서 전 16,299정점×4개 원본·후보 배열의 독립 스키닝과 실제 Three 결과를 1e-7m 이내로 대조한다. 저장09 direct 좌표는 direct·기존 모션 및 저장 행렬 재생에서 계속 1e-7m로 검사한다. 서로 다른 REST 표현인 swap 대 저장 direct 차이는 진단으로 남긴다. 대신 전체 기존 REST 계약의 이름·정점·형상·bind·부모·local/world/inverse 조건을 별도로 모두 요구한다. 본 local 이동은 양쪽 실제 부모 좌표계로 투영한 미터 norm 1e-5, 나머지 선형·world·inverse 1e-5, 모든 시각의 direct/swap 전정점 XYZ 1e-6를 유지한다.

실제 후보 fresh39는 14클립·8,388시각(찌르기 3,377시각)에서 floor/support/적용 삼각형/이음새 실패0이었다. 원보고서 SHA는 `5f1249598fea762eb3d58cd509f2ec4fb9797076e0a68553ddf3d93a565f00da`다. 이 수치 결과만으로 GPU·시각·플레이·공개 배포를 통과했다고 부르지 않는다. 최종 채택은 실제 catalog/no-overrides 다섯 몸체, 정식 검사, 실제 화면·플레이·엄격 미디어와 정확한 공개 source/artifact 확인을 함께 요구한다. 실제 Android·터치·발열은 PC viewport로 대체하지 않는다.

여섯 공개 모션 JSON은 저작 원본 CRLF 바이트를 Git `-text`로 보존한다. 소스 레지스트리 JSON의 직렬화와 공개 원본 SHA는 구분한다. 런타임 모션 선택 소스는 LF로 고정한다. 플랫폼별 checkout·빌드·공개 응답에서 각각 원바이트 SHA를 확인한다.

## 이전 내부 후보03 기록

기준 HEAD는 ff16796f4dd73f12cfc40b77e5b1cd2a4aadd6a8이다. 대상은 hero_ranger_t2, hero_ranger_t3, hero_rogue_t2, hero_rogue_t3, avatar_rogue_crow다. 현재 작업 트리에는 실제 생성한 다섯 교정 GLB와 자산별 모션 패킷이 내부 QA 후보로 설치되어 있다. 다섯 기록은 GENERATED/useInGame:true이며 정확한 output SHA를 가진다. 이는 로컬 후보 경로의 활성화이고 공개 채택·배포 승인을 뜻하지 않는다. INTERNAL-CANDIDATE-03.json은 candidateOnly:true/releaseApproved:false이며, 공개 서비스는 변경하지 않았다. 생성 전의 DRAFT/useInGame:false/output.sha256:null 기록은 과거 단계로 보존한다.

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

갑옷 단계·아바타 우선순위는 기존 규칙을 따른다. 다섯 몸체는 메시 전용이며 궁수 두 몸체는 기본 궁수의 11클립, 도적 두 몸체와 까마귀는 기본 도적의 14클립을 공유한다. 승인된 몸체별 정적 모션 선택과 교체 전 검증이 구현되어 있고, 현재 모션 번들에는 실제 저작 패킷에 연결된 5개 body record가 있다. 초기 bodies:[] 단계의 기록은 실제 아트 생성 이전 이력이다.

## 저작 순서와 수용 기준

먼저 실제 Blender에서 근거 있는 몸체 외피와 승인된 국소 영향 범위만 피팅한다. Blender 원본 .blend, 저작 코드·로그, 원본·후보 GLB, 패치와 BIN/JSON 성분 차이, 각 SHA를 보존한다. 다른 몸체에 여우의 가중치 영역이나 높이 곡선을 그대로 복사하지 않는다. 궁수 3단계는 idle에서 떠 있고, 도적 일부 결함 정점은 Hips와 양쪽 UpLeg가 섞여 있으므로 일괄 상향 이동이나 기존 pure-leg 규칙만으로 해결됐다고 가정할 수 없다.

피팅 후에도 남는 실제 접촉 결함을 측정한 뒤에만 root가 별도의 자산별 offline 동작 계약을 확정한다. 고정 저작 곡선은 본의 실제 부모 좌표계를 읽어 저장해야 하며, 공유 클립 바이트를 수정하거나 게임에서 매 프레임 계산하지 않는다. 이번 런타임 확장은 실제 저작 패킷의 선택·검증만 담당하며 곡선을 생성하지 않는다.

타깃 다섯 몸체는 실제 loadHeroAsset/spawnCharacter direct 및 기존 몸체 swap 양쪽에서 모든 공유 클립을 검사한다. 301 균등 표본과 모든 원본/저작 키, 기존 실패 시점을 포함한다. Actor의 의도된 사망 후 침하를 제외한 저작 스킨 최저 y>=-.01m, 지지발 abs(y)<=.02m, death 끝 abs(y)<=.02m을 지킨다. 의도된 공중 동작과 지지 구간을 구별하며 수치만으로 의상·실루엣을 승인하지 않는다. 기본 몸체와 공개 여우 대조군은 기존 계약과 비악화를 확인한다. 대조군 비악화 기준을 타깃의 기존 관통을 허용하는 근거로 쓰지 않는다.

현재 25표본 baseline은 결함 진단 자료다. A3의 301표본+모든 키 수용 검사가 완료됐다는 뜻이 아니다. 후보 채택에는 실제 PC GPU 음소거 화면·착용 초상·무기·direct/swap·회피/사망과 모바일 viewport, strict media 검토가 필요하다. viewport는 실제 Android·터치·열 검증을 뜻하지 않는다.

## 내부 후보 활성화와 공개 채택

내부 QA는 실제 GENERATED 파일의 선택·direct/swap 경로를 측정하기 위해 useInGame:true로 실행한다. 공개 채택은 아래 수용 증거와 root 승인이 모두 갖춰진 뒤 별도로 진행한다. 내부 경로 활성화를 공개 출시 완료로 기록하지 않는다.


1. 실제 저작·패킹 산출물의 원본 SHA와 허용 성분 차이를 독립 확인한다.
2. 후보 GLB를 지정된 새 경로에 두고 실제 output SHA 및 저작 출처를 기록한다. 원본과 실패 후보는 보존한다.
3. 대상 비관통·대조군 비악화·무기·실화면과 정식 check가 통과한 근거를 남긴다.
4. root가 전체 수용 증거를 확인한 뒤 해당 내부 후보의 공개 채택을 결정한다. GENERATED/useInGame:true 자체는 아트·출시 승인 플래그가 아니다. 런타임 경로 테스트는 각 실제 파일 SHA를 확인한다.
5. 기존 공개 배포 컨트롤러·소유 잠금·정확 HEAD·rollback·공개 검증·원본 보관 계약을 유지한다.

## 자산별 정적 모션 계약

src/data/higher-body-motion-v1.json의 schema는 blade-surge.higher-body-motion.v1이며 현재 bodies는 실제 원본 패킷 SHA와 연결된 5개 record다. 대상 다섯 몸체의 고유 머리·장식 문제에서 dodge/death만 별도로 승인할 수 있다. 공격·idle·망토 리깅 결함을 골반 상승으로 덮지 않는다. 기존 fox JSON과 createBodyMotionClip 기본 API·수치 계약은 그대로다.

각 body record는 asset/heroId/revisionId, body:{path,sha256}, base:{path,sha256}, motionRevisionId, output:{path,sha256}, clipOverrides를 가진다. 활성 GENERATED 몸체 revision의 정확한 GLB 경로·SHA와 ranger V4/rogue V2 canonical GLB 경로·SHA를 검사한다. motionRevisionId는 해당 몸체 이름의 <ranger-t2|ranger-t3|rogue-t2|rogue-t3|rogue-crow>-body-motion-v1이며 output.path는 /models/heroes-next/<motionRevisionId>.json이다. output SHA는 번들 자신의 해시가 아니라 별도 보존·배포한 실제 저작 원본 패킷 파일에 결합한다. 새 패킷 없이 임시 SHA를 넣지 않는다.

각 override의 base는 clip, duration, hipsTrack, sourceTrackSha256, interpolation:LINEAR 및 실제 canonical decoded Float32 times/values snapshot을 가진다. outputTrack은 name, type:vector, interpolation:LINEAR, times, values다. authoring은 실제 profileId, parentWorldYGain, initialOffsetMeters, finalOffsetMeters, maxOffsetMeters를 가진다. 실제 본 부모의 world 행렬 축·배율과 parentWorldYGain이 일치해야 한다. 골반 X/Z는 Float32 저장값 기준 불변, Y는 승인된 비음수 높이 곡선이며 최대 .35m, 시작/끝 offset을 검사한다. 전 구간 상수 상승은 거절한다. 원본 키를 포함한 최소 120Hz 저작 표본이며 실행 중 곡선·바닥 보정은 없다.

validation.supportStartMeters/supportEndMeters는 실제 저작 지지점 결과이며 절댓값 .02m 이내다. death에는 deathEndMeters도 필요하다. 이 기록은 런타임의 스킨 검사나 최종 A3/GPU 증거를 대체하지 않는다. 저작자는 실제 Blender endpoint 측정값을 기록하며, root가 이후 전체 dense·runtime·GPU 수용 검사를 별도로 수행한다. 런타임은 원본 times/values를 canonical과 exact 비교한다. 테스트는 실제 공개 GLB·패킷 파일 SHA와 원본 track SHA를 계산한다. track SHA의 바이트 순서는 UTF8(name)+NUL+u32LE(timeCount)+u32LE(valueCount)+float32LE(times)+float32LE(values)다.

캐시는 canonical clip과 불변 전체 body/motion descriptor identity를 함께 구분한다. 인스턴스마다 canonical 및 alias의 마지막 설치 reference를 보관해 A→B→기본/fox를 복원한다. 사용자 추가 key·외부 덮어쓴 alias는 보존한다. 원본 clip 배열·다른 track reference는 수정하지 않는다. 진행 중 action의 clip/time/weight는 그대로이고 미래 lookup만 변경한다.

로더가 선택한 몸체 식별자를 캡처하고, swap은 실제 target·hero·revision과 모든 모션을 검증한 뒤 새 메시를 준비한다. 검증·최신 요청 확인에 실패하면 기존 메시·재질·skeleton·별칭을 유지한다. 검증된 계획만 설치한 후 기존 메시를 해제한다. 직접 spawn도 같은 검증을 사용하며 잘못된 활성 패킷을 조용히 원본 모션으로 대체하지 않는다.

초기 빈 bodies 테스트는 선택·복원·거절 계약을 검증한 과거 단계다. 현재 테스트는 내부 설치한 실제 파일 SHA와 canonical snapshot도 검사한다. 실제 모션 저작 성공과 전체 접지·실화면 수용은 구별하며, 아래 시점의 최종 dense03은 실패했고 GPU/정식 check/공개 채택은 미완료다.

## 내부 후보03의 실제 저작 상태

- 몸체 계보: normalized 원본 → lower03 → contact05 → contact10(5종). 도적2·도적3·crow만 contact10 → foot02이며 ranger2/3는 contact05와 contact10/내부 설치 GLB의 SHA가 동일하다.
- 고정 모션: ranger2/3는 motion01, 도적2/3·crow는 foot02 몸체 SHA에 결속한 motion03이다. dodge/death의 Hips.position 저작 트랙만 선택한다. 공격·idle의 공유 트랙이나 Actor 위치를 높이는 프레임 보상은 없다.
- 실제 root 실행: contact10 Blender26832/packer47760, foot02 Blender59772/packer15036, motion03 Blender57648, 내부 후보 설치36608 모두 exit0. 이것은 단계별 생성/검증 결과다.
- 최종 QA v3 dense PID15868은 18:27:05에 exit1로 종료했다. root가 확인한 전정점 posed parity/canonical 불변/motion identity/shared 배열은 통과했지만 native local REST 단위 판정과 rogue2 chop/stab, rogue3 stab, crow chop/stab의 실제 stance 기준이 실패하여 전체 수용은 보류다. root read-only extractor26996에서 candidate와 원본 node local은 동일하고, native local 차이는 canonical과 원본의 기존 차이로 exact 재현됐다. 승인 QA v4는 native localMax를 계속 보고하며 local 3×3/homogeneous는 1e-5, translation은 양쪽 실제 parent world 선형부로 변환한 미터 norm 1e-5로 분리한다. 기존 world/inverse1e-5와 전정점 posedXYZ1e-6는 그대로다. v4의 실제 측정 결과는 아직 없다. 실제 stance 실패를 그 단위 문제로 대체하지 않는다. GPU/게임·모바일 viewport·정식 check 및 공개 승인은 미완료다.
- after08 원본/후보 전체 Drive archive는 아직 완료되지 않았다. PC의 실패·성공 후보와 저작 원본은 보존 중이며, Drive 전송·완전성 readback 완료를 별도 증거로 남겨야 한다.
- 자세한 저작 재현과 과거 시도는 art-src/higher-bodies/README.md 및 job의 실제 보고서/원본 패킷을 따른다. .blend imported corner normal과 GLB 명시 seam normal이 다를 수 있어 실제 GLB shading을 별도 확인한다.
