#!/usr/bin/env bash
# 리눅스 클라우드 컨테이너에서 서명 없는 Google Play 릴리스 AAB를 만든다.
# 만든 AAB는 원격 서명 서비스(apex sign/play)가 기존 서명을 제거하고 업로드 키로 서명한다.
# 사용법: tools/build-aab-cloud.sh [--version-code N] [--version-name X.Y]
#   환경변수 BLADESURGE_VERSION_CODE / BLADESURGE_VERSION_NAME 으로도 지정할 수 있다(기본 1 / "1.0").
#   JAVA_HOME / ANDROID_HOME 기본값은 /usr/lib/jvm/java-21-openjdk-amd64 와 /opt/android-sdk.
#   BLADESURGE_SKIP_TYPECHECK=1 이면 typecheck를 건너뛴다.
set -euo pipefail

channel=googleplay
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

while [ $# -gt 0 ]; do
  case "$1" in
    --version-code) export BLADESURGE_VERSION_CODE="${2:?--version-code 값이 필요합니다}"; shift 2 ;;
    --version-name) export BLADESURGE_VERSION_NAME="${2:?--version-name 값이 필요합니다}"; shift 2 ;;
    -h|--help) sed -n '2,8p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "알 수 없는 인자: $1" >&2; exit 2 ;;
  esac
done

export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$PATH"
[ -x "$JAVA_HOME/bin/java" ] || { echo "JDK(17/21)를 찾지 못했습니다: $JAVA_HOME" >&2; exit 1; }
[ -f "$ANDROID_HOME/platforms/android-36/android.jar" ] || { echo "Android SDK platform 36이 없습니다: $ANDROID_HOME (docs/CLOUD_AAB_BUILD.md 참고)" >&2; exit 1; }

# 서명 없는 빌드 옵트인. 키스토어 값은 일부러 비워 디버그/업로드 키가 섞이지 않게 한다.
export BLADESURGE_UNSIGNED_FOR_SIGNER=1
unset BLADESURGE_KEYSTORE BLADESURGE_KEYSTORE_PASSWORD
export BLADE_STORE_WEB_DIR="$repo/work/store-builds/$channel/web"

cd "$repo"
[ -d node_modules ] || bun install --frozen-lockfile

if [ "${BLADESURGE_SKIP_TYPECHECK:-0}" != 1 ]; then bun run typecheck; fi
node tools/build-channel.mjs "$channel"
npx cap sync android

# 이전 산출물이 섞이지 않게 같은 변형의 번들만 지우고 다시 만든다.
rm -rf android/app/build/outputs/bundle/googleplayRelease
bash android/gradlew -p android bundleGoogleplayRelease --no-daemon --console=plain

aab="$(find android/app/build/outputs/bundle/googleplayRelease -maxdepth 1 -name '*.aab' | head -n 1)"
[ -n "$aab" ] || { echo "AAB 산출물을 찾지 못했습니다." >&2; exit 1; }

# 서명 파일(META-INF/*.SF|RSA|DSA|EC)이 없어야 서명 없는 번들이다.
if unzip -Z1 "$aab" | grep -Eq '^META-INF/.*\.(SF|RSA|DSA|EC)$'; then
  echo "AAB에 서명 파일이 들어 있습니다: $aab" >&2
  exit 1
fi

abs="$(cd "$(dirname "$aab")" && pwd)/$(basename "$aab")"
echo "AAB_PATH=$abs"
echo "AAB_BYTES=$(stat -c %s "$abs")"
echo "AAB_SHA256=$(sha256sum "$abs" | cut -d' ' -f1)"
echo "VERSION_CODE=${BLADESURGE_VERSION_CODE:-1}"
echo "VERSION_NAME=${BLADESURGE_VERSION_NAME:-1.0}"
