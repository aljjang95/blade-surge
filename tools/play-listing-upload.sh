#!/usr/bin/env bash
# 구글 플레이 등록정보(문구·연락처·아이콘·피처 그래픽·스크린샷)를 apex 프록시(/p/play)로 올린다.
# 사용: bash tools/play-listing-upload.sh [--dry-run]
# 자격 증명은 cloud.tllhouse.com 프록시가 붙이며 이 스크립트에는 키가 없다.
set -euo pipefail
cd "$(dirname "$0")/.."
PKG=com.theluxurylord.bladesurge
BASE="${APEX_CLOUD_URL:?APEX_CLOUD_URL 필요}/p/play"
API="$BASE/androidpublisher/v3/applications/$PKG"
UP="$BASE/upload/androidpublisher/v3/applications/$PKG"
DIR=store/googleplay
DRY=${1:-}

json() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }
call() { local m=$1 u=$2; shift 2; local out; out=$(curl -sS -X "$m" "$u" "$@"); if echo "$out" | grep -q '"error"'; then echo "실패 $m $u: $out" >&2; return 1; fi; echo "$out"; }

EDIT=$(call POST "$API/edits" -H 'content-type: application/json' -d '{}' | json "['id']")
echo "edit=$EDIT"
trap '[ -n "${DONE:-}" ] || curl -sS -X DELETE "$API/edits/$EDIT" -o /dev/null' EXIT

call PUT "$API/edits/$EDIT/details" -H 'content-type: application/json' \
  -d '{"defaultLanguage":"ko-KR","contactWebsite":"https://blade.tllhouse.com","contactEmail":"aljjang95@gmail.com"}' >/dev/null

for lang in ko-KR en-US; do
  f="$DIR/listing.$lang.json"
  body=$(python3 -c "import json;d=json.load(open('$f'));print(json.dumps({'language':'$lang','title':d['title'],'shortDescription':d['shortDescription'],'fullDescription':d['fullDescription']}))")
  call PUT "$API/edits/$EDIT/listings/$lang" -H 'content-type: application/json' -d "$body" >/dev/null
  # 이미지는 종류별로 비운 뒤 다시 올린다(같은 파일을 두 번 쌓지 않게).
  for t in icon featureGraphic phoneScreenshots sevenInchScreenshots tenInchScreenshots; do
    call DELETE "$API/edits/$EDIT/listings/$lang/$t" >/dev/null
  done
  up() { call POST "$UP/edits/$EDIT/listings/$lang/$1?uploadType=media" -H 'content-type: image/png' --data-binary "@$2" >/dev/null; }
  up icon "$DIR/icon-512.png"
  up featureGraphic "$DIR/feature-1024x500.png"
  for i in 01 02 03 04 05 06 07 08; do
    up phoneScreenshots "$DIR/screenshots/phone-$i.png"
    up sevenInchScreenshots "$DIR/screenshots/tablet7-$i.png"
    up tenInchScreenshots "$DIR/screenshots/tablet10-$i.png"
  done
  echo "$lang 업로드"
done

call POST "$API/edits/$EDIT:validate" >/dev/null && echo "검증 통과"
if [ "$DRY" = "--dry-run" ]; then echo "dry-run: 커밋하지 않음"; exit 0; fi
call POST "$API/edits/$EDIT:commit" | json "['id']" && DONE=1 && echo "커밋 완료"
