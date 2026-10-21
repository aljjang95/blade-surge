# 클라우드(리눅스 컨테이너)에서 서명 없는 Google Play AAB 만들기

Claude 클라우드 세션 같은 리눅스 컨테이너에서 `googleplay` 채널의 릴리스 AAB를 만든다. 이 AAB는 **서명하지 않은 번들**이며, 원격 서명 서비스(`apex sign` / `apex play`)가 기존 서명을 제거한 뒤 앱 업로드 키로 서명한다. 디버그 키로는 절대 서명하지 않는다. 이 문서는 빌드까지만 다루고, 업로드·서명·출시는 다루지 않는다.

## 한 줄 실행

```sh
bun install --frozen-lockfile        # 처음 한 번
bun run build:aab:cloud              # 또는 bash tools/build-aab-cloud.sh
bun run build:aab:cloud -- --version-code 12 --version-name 1.0.12
```

- 스크립트는 커밋한 clean 소스에서만 동작한다(`tools/build-channel.mjs`가 dirty 소스를 거부한다).
- 흐름은 `tools/build-android.ps1`과 같다: `typecheck` → `node tools/build-channel.mjs googleplay` → `npx cap sync android` → `gradlew bundleGoogleplayRelease`.
- 버전은 `--version-code/--version-name` 또는 환경변수 `BLADESURGE_VERSION_CODE`(양의 정수) / `BLADESURGE_VERSION_NAME`으로 덮어쓴다. 기본값은 `1` / `"1.0"`이다. Play에 올릴 때는 이전 업로드보다 큰 versionCode를 줘야 한다.
- `BLADESURGE_SKIP_TYPECHECK=1`이면 typecheck를 건너뛴다.
- 출력: `android/app/build/outputs/bundle/googleplayRelease/app-googleplay-release.aab`, 그리고 `AAB_PATH`, `AAB_BYTES`, `AAB_SHA256`, `VERSION_CODE`, `VERSION_NAME` 줄. 서명 파일(`META-INF/*.SF|RSA|DSA|EC`)이 있으면 실패한다.

## 서명 없는 릴리스 옵트인 (`android/app/build.gradle`)

- `BLADESURGE_UNSIGNED_FOR_SIGNER=1`일 때만 키스토어 없이 릴리스를 빌드한다. 이때 `signingConfig`를 아예 붙이지 않는다(디버그 키 대체 없음).
- 옵트인이 없으면 이전과 같이 `BLADESURGE_KEYSTORE`/`BLADESURGE_KEYSTORE_PASSWORD`가 없을 때 `pre*ReleaseBuild`에서 실패한다(안내 문구에 옵트인 설명만 덧붙였다).
- 옵트인이 있어도 스토어 채널 확인과 AdMob 실제 ID 검사(테스트 ID 거부)는 그대로 동작한다.

## 설치한 도구 (2026-10-22 설치)

| 도구 | 버전 | 위치 |
|---|---|---|
| JDK | OpenJDK 21.0.12 (컨테이너 기본, apt `openjdk-21`) | `/usr/lib/jvm/java-21-openjdk-amd64` |
| Android SDK command-line tools | 19.0 (`commandlinetools-linux-13114758_latest.zip`) | `/opt/android-sdk/cmdline-tools/latest` |
| platform | `platforms;android-36` (rev 2) — `android/variables.gradle`의 compileSdk 36 | `/opt/android-sdk/platforms/android-36` |
| build-tools | `build-tools;36.0.0` (AGP 8.13.0 기본값) | `/opt/android-sdk/build-tools/36.0.0` |
| bundletool (검증용, 선택) | 1.18.1 | `/opt/android-sdk/bundletool/bundletool-all-1.18.1.jar` |
| Gradle | 8.14.3 (래퍼가 `~/.gradle`로 받음) | `~/.gradle/wrapper/dists` |
| Android Gradle Plugin | 8.13.0 (`android/build.gradle`) | Gradle 캐시 `~/.gradle/caches` |

설치 명령(다시 만들 때):

```sh
export CA=/root/.ccr/ca-bundle.crt
curl --cacert $CA -o /tmp/cmdtools.zip https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip
mkdir -p /opt/android-sdk/cmdline-tools/latest && unzip -q /tmp/cmdtools.zip -d /tmp/cmdtools
cp -r /tmp/cmdtools/cmdline-tools/* /opt/android-sdk/cmdline-tools/latest/
export ANDROID_HOME=/opt/android-sdk
yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --install "platforms;android-36" "build-tools;36.0.0"
# 검증용 bundletool (선택)
curl -L --cacert $CA -o /opt/android-sdk/bundletool/bundletool-all-1.18.1.jar https://github.com/google/bundletool/releases/download/1.18.1/bundletool-all-1.18.1.jar
```

`JAVA_HOME`, `ANDROID_HOME`은 스크립트가 기본값(`/usr/lib/jvm/java-21-openjdk-amd64`, `/opt/android-sdk`)을 쓰며 환경변수로 바꿀 수 있다.

## AAB 확인

```sh
AAB=android/app/build/outputs/bundle/googleplayRelease/app-googleplay-release.aab
unzip -l "$AAB" | grep -E 'base/manifest|base/assets/public/index.html|META-INF'   # META-INF 없음이 정상
java -jar /opt/android-sdk/bundletool/bundletool-all-1.18.1.jar dump manifest --bundle "$AAB" | head -3
```

## 알려진 문제

- 클라우드 프록시 경유 Maven Central 다운로드가 병렬 요청으로 `429 Too Many Requests`가 날 수 있어 gradle을 `--max-workers=1`로 돌리고, 실패하면 받은 캐시를 이어서 최대 5번 다시 시도한다.
- `android/gradlew`는 저장소에서 실행 권한이 없으므로 `bash android/gradlew`로 부른다.
- 이 빌드는 로컬 증거(번들 구조·매니페스트)까지다. Play 업로드, 서명 검증, 실기기 설치는 별도 단계다.

## 제거 방법

```sh
rm -rf /opt/android-sdk      # SDK, build-tools, platform, bundletool (약 650MB)
rm -rf ~/.gradle             # Gradle 배포본과 의존성 캐시 (약 1.2GB)
rm -rf <worktree>/work/store-builds <worktree>/android/app/build <worktree>/android/app/src/main/assets/public
```

JDK 21은 컨테이너 기본 설치라 지우지 않는다.
