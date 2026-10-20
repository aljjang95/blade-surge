// 카메라 회전 입력 방향. 기본(false)은 손가락·마우스를 끄는 쪽으로 화면이 따라오는 자연스러운 방향이다.
// 로비·마을 걷기·전투 모든 회전 입력이 이 헬퍼를 거쳐 즉시(재시작 없이) 반영된다.
const flag = (settings, key) => settings?.[key] === true;
/** 좌우 회전 부호. +1 = 기본(끄는 방향으로 화면이 따라옴), -1 = 반전. 값은 yaw 증가량에 곱한다. */
export const cameraYawSign = (settings) => flag(settings, 'cameraInvertX') ? -1 : 1;
/** 상하 회전 부호. +1 = 기본, -1 = 반전. */
export const cameraPitchSign = (settings) => flag(settings, 'cameraInvertY') ? -1 : 1;
/** 저장본 정규화: 이전 저장(키 없음)·잘못된 값은 모두 기본 false 로 이관한다. */
export const normalizeCameraInvert = (raw) => ({ cameraInvertX: flag(raw, 'cameraInvertX'), cameraInvertY: flag(raw, 'cameraInvertY') });
