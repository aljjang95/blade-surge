#!/usr/bin/env bash
# 승인된 원본 BGM(mp3)·입장 영상(mp4)에서 배포용 파일을 만든다.
#  · 지역 BGM 9곡: 원본 public/bgm/regions/*.mp3 는 그대로 두고, Android 스토어 빌드(googleplay·onestore)만 쓰는 Opus 96kbps(.ogg)를 옆에 만든다.
#    웹·앱인토스(iOS 사파리 포함)는 계속 원본 mp3 를 쓴다(src/data/music.js 의 bgmUrl, tools/optimize/dist-excludes.json 의 채널별 제외).
#    Opus 는 Android WebView·크롬·파이어폭스·Playwright Chromium 이 모두 재생한다(AAC 는 Playwright Chromium 이 못 푼다).
#  · 입장 영상: 원본은 art-src/original-media/video 에 보존하고 1080p H.264 High CRF 28, 소리 트랙 제거(cinematic.js 가 muted 로만 재생한다)로 public 에 만든다.
# 필요: ffmpeg(libopus, libx264). 기록: ffmpeg 6.1.1(Ubuntu 6.1.1-3ubuntu5).
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bitrate="${BGM_BITRATE:-96k}"
for mp3 in "$root"/public/bgm/regions/*.mp3; do
  out="${mp3%.mp3}.ogg"
  ffmpeg -v error -y -i "$mp3" -vn -map_metadata -1 -c:a libopus -b:a "$bitrate" -vbr on -application audio -frame_duration 20 "$out"
  echo "${mp3#"$root"/} -> ${out#"$root"/} ($(stat -c %s "$out") bytes)"
done
video="$root/art-src/original-media/video/expansion/glass-garden-intro.mp4"
out="$root/public/video/expansion/glass-garden-intro.mp4"
mkdir -p "$(dirname "$out")"
if [ -f "$video" ]; then
  ffmpeg -v error -y -i "$video" -an -map_metadata -1 -c:v libx264 -preset slow -crf 28 -pix_fmt yuv420p -profile:v high -movflags +faststart "$out"
  echo "video -> ${out#"$root"/} ($(stat -c %s "$out") bytes)"
fi
