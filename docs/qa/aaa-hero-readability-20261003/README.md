# 혼전 영웅 가독성

중첩 additive 효과와 bloom이 영웅의 얼굴·몸을 흰색으로 씻던 문제를 기존 렌더 경로에서 수리한다. 살아 있는 실제 영웅의 투영 capsule에만 장식 FX alpha와 기존 bloom 합성 RGB를 감쇠하고, 바깥 효과·위험 예고 재질·게임 판정·카메라를 유지한다. 새 render target·actor 복제·텍스처는 만들지 않는다. Points·groundTex·불기둥·무기 trail/core도 같은 범위에 포함하며 retained clone과 focus/telegraph 양쪽 GPU variant를 실제 선형 타깃에서 사전 준비한다.

독립 코드·이미지 검토로 초기 prewarm 누락과 rest reference 비대칭을 발견·수리했다. 기존 실패와 v1 원본을 보존한다. v2는 동일 neutral rest와 고정 body ROI에서 기사/mid 0.40510, 마법사/low 0.14797, 궁수/mid/reduced 0.34727로 기존 <0.72를 통과했다. 단위/전조 회귀12개와 타입 검사를 통과했다. 전체 check는 1253 pass / 2 skip / 0 fail이다. 생성자를 건너뛴 기존 FX 자원 fixture의 missing focus 6실패 원본을 보존하고 실제 클래스를 초기화해 기존 assertion을 유지했다. PR의 최종 clean SHA와 전체 성능 증거는 별도로 봉인한다.

실제 키보드1/J입력의 프로그램141/132/141은 준비 단계 이후 늘지 않았다. 세영웅×ring/slashArc/flash/castCircle12경고를 영웅과 겹쳐 렌더했고 bloom OFF에서 direct ROI픽셀, effect age/lifetime, 기존13개RT texture UUID가 focus ON/OFF 동일함을 확인했다. 실제 enemy.startAttack8패턴은 telegraph 보호 flag와 기존 공격 deadline을 검증했다. bloom ON 캡처는 경고 색/윤곽을 독립 열람했다. bloom은 영웅 주변 경고 후광도 줄이므로 전체 최종 warning pixel 불변을 주장하지 않는다.

이 자료는 freeze 전 dirty 빌드와 source SHA256을 명시한다. clean commit의 재검증·기존 PRD/5쌍 성능 게이트·보호된 배포/라이브 확인은 별도이며, 이 자료만으로 승격하지 않는다. 실제 입력 증거는 제어된 세 영웅의 미잠금 첫 스킬/공격이고 자연 획득·보스 수동 완주·실기기 GPU/열/멀티터치/오디오 증거는 아니다. 국소 전이 경계의 최종 미술과 AAA/장기 재미 검증은 남는다.
