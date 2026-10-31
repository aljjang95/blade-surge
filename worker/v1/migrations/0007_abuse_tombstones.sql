-- 남용 방지 묘비(docs/ACCOUNT_POLICY.md 7장): 탈퇴·정지 계정의 제공자 식별자 해시를 기한 동안만 남긴다.
-- 용도는 "계정당 1회 보상" 재수령 방지뿐이다. 가입·진행은 막지 않는다. 원문 sub는 저장하지 않고 account_links가 쓰는 해시를 그대로 쓴다.
-- 재적용해도 무해하도록 IF NOT EXISTS만 쓴다.
CREATE TABLE IF NOT EXISTS abuse_tombstones (
  provider TEXT NOT NULL CHECK (provider IN ('google','play_games','toss','kakao','chatgpt')),
  subject_hash TEXT NOT NULL CHECK (length(subject_hash) = 64),
  reason TEXT NOT NULL CHECK (reason IN ('withdrawn','banned')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject_hash)
);
CREATE INDEX IF NOT EXISTS abuse_tombstones_exp ON abuse_tombstones(expires_at);

UPDATE v1_schema SET version = 7 WHERE singleton = 1 AND version < 7;
