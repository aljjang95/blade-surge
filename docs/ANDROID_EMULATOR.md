# 클라우드 Android OS 에뮬 환경

2026-10-07 환경 준비 기록이다. 모바일 브라우저 프로필의 입력 검사는 [MOBILE_EMULATION_QA.md](MOBILE_EMULATION_QA.md)를 사용한다. Android OS 기동과 게임 플레이는 별도로 판정한다.

## 설치한 환경

- SDK: `/workspace/scratch/android-emulator/sdk`
- 공식 command-line tools19.0, platform-tools37.0.1, emulator37.2.12
- AVD: `bladesurge_android15`, 공식 API35 Google APIs x86_64 r09, CPU4/RAM3072MB/960×540/160dpi
- Debian13 호스트의 CPU quota4개/RAM16GiB. `/dev/kvm`·물리 GPU가 없어 `-accel off`·SwiftShader를 사용한다.

공식 Google repository XML과 전체 archive 해시를 대조했다. SDK/이미지는 저장소에 넣지 않는다. [공식 SDK metadata](https://dl.google.com/android/repository/repository2-3.xml), [공식 system-image metadata](https://dl.google.com/android/repository/sys-img/google_apis/sys-img2-3.xml)를 사용한다.

| 이미지 | 공식 archive | 공식 SHA1 / 로컬 SHA256 |
|---|---|---|
| API35 r09 | [x86_64-35_r09.zip](https://dl.google.com/android/repository/sys-img/google_apis/x86_64-35_r09.zip), 1,738,815,903bytes | `0103e6dab21290c4b9d16550a3ce99476f884eef` / `c67b9ba0ff5bc0eb6d046871bfa228af14d4d47b02f0cdae94f048e511b7566e` |

SDK의 표준 `android-sdk-license`만 설치 과정에서 수락했다. Google/Play 계정, 유료 기기 서비스, 임의 APK 미러는 사용하지 않았다. 기존 게임 소스·Capacitor 설정·서명 파일도 변경하지 않았다.

## 실행

다른 모바일 Chromium이나 성능 측정이 끝난 뒤 AVD 하나만 실행한다. 프로젝트의 clean 빌드를 `127.0.0.1:5175`에 preview하고 `/version.json`의 SHA·dirty=false를 먼저 확인한다.

```sh
ANDROID_AVD_HOME=/workspace/scratch/android-emulator/avd ANDROID_USER_HOME=/workspace/scratch/android-emulator/user /workspace/scratch/android-emulator/sdk/emulator/emulator -list-avds
python3 /workspace/scratch/android-emulator/boot-emulator.py --avd bladesurge_android15 --cores 4 --memory 3072 --timeout 480 --evidence evidence/android15 --origin http://localhost:5175/
```

task-local controller는 기존 emulator 중복 기동을 거부하고, 각 ADB 응답을5초로 제한하여480초 boot 관측 기한을 둔다. 진행 중인 ADB 호출과 종료 대기는 별도여서 전체 실행 시간이 조금 더 길 수 있다. 실패 원본과 launch/version/OS/package/PNG 증거는 `/workspace/scratch/android-emulator/evidence/`에 보관한다. timeout 때 소유한 emulator process group을 종료한다. 부팅 뒤 OS 창·전환 애니메이션 배율을0으로 설정하며 게임 clock은 변경하지 않는다.

controller 없이 공식 CLI를 직접 사용하는 경우에도 유한 실행 기한을 둔다. 첫 번째 터미널에서 AVD를 실행한다.

```sh
ANDROID_AVD_HOME=/workspace/scratch/android-emulator/avd ANDROID_USER_HOME=/workspace/scratch/android-emulator/user timeout --kill-after=10s 480s /workspace/scratch/android-emulator/sdk/emulator/emulator -avd bladesurge_android15 -port 5570 -accel off -cores 4 -memory 3072 -gpu swiftshader -no-window -no-audio -no-boot-anim -no-snapshot -no-metrics -camera-back none -camera-front none -skin 960x540
```

AVD가 실행 중일 때 두 번째 터미널에서 확인하고, boot 완료 뒤 게임을 연다.

```sh
/workspace/scratch/android-emulator/sdk/platform-tools/adb -s emulator-5570 shell getprop sys.boot_completed
/workspace/scratch/android-emulator/sdk/platform-tools/adb -s emulator-5570 shell dumpsys package com.android.chrome
/workspace/scratch/android-emulator/sdk/platform-tools/adb -s emulator-5570 shell dumpsys webviewupdate
/workspace/scratch/android-emulator/sdk/platform-tools/adb -s emulator-5570 reverse tcp:5175 tcp:5175
/workspace/scratch/android-emulator/sdk/platform-tools/adb -s emulator-5570 shell am start -a android.intent.action.VIEW -d http://localhost:5175/
# 작업 종료
/workspace/scratch/android-emulator/sdk/platform-tools/adb -s emulator-5570 emu kill
```

새 머신에서는 공식 command-line tools로 SDK를 설치하고 같은 repository revision/해시를 확인한 뒤 `avdmanager create avd -n bladesurge_android15 -k 'system-images;android-35;google_apis;x86_64' -d pixel`로 등록한다. `ANDROID_SDK_ROOT`·`ANDROID_AVD_HOME`·`ANDROID_USER_HOME`을 작업 경로에 맞게 지정하고 기존 HOME/credential profile을 바꾸지 않는다.

## 판정과 원본

첫 API30 시도는 ADB에서 실제 Android11/API30 및 Chrome·WebView83.0.4103.106을 확인했지만 boot 완료가 당시420초 기한 내 확인되지 않았다. 종료 대기를 포함한430.7초 `boot-timeout` 원본을 보존했다. 현대 ES2022 게임의 지원·플레이 성공으로 표시하지 않는다.

API35 image 등록까지는 확인했고 이 문서 작성 시점에는 기동 결과가 없다. 후속 실제 결과는 `evidence/android15/`와 [PR #131](https://github.com/aljjang95/blade-surge/pull/131)에 따로 기록한다. OS boot, 실제 Chrome/WebView 버전, WebGL2 생성, clean 버전의 게임 화면·입력은 각각 관측 근거가 필요하다.

`-cores4` 설정의 TCG 병렬 성능 개선은 입증하지 않았다. 실제 Android OS여도 물리 휴대전화의 GPU FPS·발열·배터리·손가락 멀티터치·청음을 확인한 결과가 아니다. debug/release APK 제작·서명·스토어 배포도 이번 정적 웹 배포와 별도다. 전체 설치 provenance와 재개 기록은 `/workspace/scratch/android-emulator/evidence/ANDROID_EMULATOR.md`에 있다.
