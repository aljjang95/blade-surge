import { describe, expect, test } from 'bun:test';
import { cameraPitchSign, cameraYawSign, normalizeCameraInvert } from '../src/engine/camera-invert.js';
import { CameraControls } from '../src/engine/camera-control.js';
import { LobbyCameraControls } from '../src/engine/lobby-camera.js';
import { Economy } from '../src/game/economy.js';
import { normalizeSave } from '../src/game/save-base.js';

describe('카메라 좌우·상하 반전 설정', () => {
  test('부호 헬퍼는 기본(+1)과 반전(-1)만 돌려주고 손상된 값은 기본으로 본다', () => {
    expect(cameraYawSign({})).toBe(1); expect(cameraYawSign(undefined)).toBe(1); expect(cameraYawSign(null)).toBe(1);
    expect(cameraYawSign({ cameraInvertX: false })).toBe(1); expect(cameraYawSign({ cameraInvertX: true })).toBe(-1);
    for (const bad of ['true', 1, {}, [], null]) expect(cameraYawSign({ cameraInvertX: bad })).toBe(1);
    expect(cameraPitchSign({})).toBe(1); expect(cameraPitchSign({ cameraInvertY: true })).toBe(-1);
    // 좌우와 상하는 서로 독립이다.
    expect(cameraPitchSign({ cameraInvertX: true })).toBe(1); expect(cameraYawSign({ cameraInvertY: true })).toBe(1);
  });
  test('새 저장은 기본 false 이고 키가 없는 이전 저장은 false 로 이관되며 저장된 값은 보존된다', () => {
    const fresh = new Economy().s;
    expect(fresh.settings.cameraInvertX).toBe(false); expect(fresh.settings.cameraInvertY).toBe(false);
    const legacy = structuredClone(fresh); delete legacy.settings.cameraInvertX; delete legacy.settings.cameraInvertY; legacy.settings.music = false;
    const migrated = normalizeSave(legacy, new Economy().s);
    expect(migrated.settings.cameraInvertX).toBe(false); expect(migrated.settings.cameraInvertY).toBe(false); expect(migrated.settings.music).toBe(false);
    const kept = structuredClone(fresh); kept.settings.cameraInvertX = true;
    const reloaded = normalizeSave(kept, new Economy().s);
    expect(reloaded.settings.cameraInvertX).toBe(true); expect(reloaded.settings.cameraInvertY).toBe(false);
    for (const bad of ['yes', 1, null, {}]) {
      const raw = structuredClone(fresh); raw.settings.cameraInvertX = bad as any; raw.settings.cameraInvertY = bad as any;
      const value = normalizeSave(raw, new Economy().s).settings;
      expect(value.cameraInvertX).toBe(false); expect(value.cameraInvertY).toBe(false);
    }
    expect(normalizeCameraInvert(undefined)).toEqual({ cameraInvertX: false, cameraInvertY: false });
  });
});

// 실제 컨트롤러의 회전 계산이 설정을 즉시 따르는지 확인한다(DOM 없이 프로토타입 메서드만 호출).
describe('회전 입력이 반전 설정을 즉시 반영한다', () => {
  test('로비·마을 걷기 orbit: 왼쪽으로 끌면 기본은 yaw 감소(장면이 손가락을 따라옴), 반전하면 증가', () => {
    const settings: any = { lobbyCamera: { yaw: 19, pitch: 11, zoom: 100 } };
    const controls: any = Object.assign(Object.create(LobbyCameraControls.prototype), {
      app: { eco: { s: { settings }, save() {} } }, sync() {}, gestureChanged: false,
    });
    const base = { yaw: 19, pitch: 11, zoom: 100 };
    controls.orbit(base, -100, 0); expect(settings.lobbyCamera.yaw).toBe(-26);
    settings.cameraInvertX = true; controls.orbit(base, -100, 0); expect(settings.lobbyCamera.yaw).toBe(64);
    // 상하 반전은 pitch 만 뒤집는다.
    settings.cameraInvertX = false; controls.orbit(base, 0, 20); expect(settings.lobbyCamera.pitch).toBe(14);
    settings.cameraInvertY = true; controls.orbit(base, 0, 20); expect(settings.lobbyCamera.pitch).toBe(8);
  });
  test('전투 카메라의 settings 접근자는 eco 가 없어도 안전하다', () => {
    const controls: any = Object.create(CameraControls.prototype);
    controls.app = {}; expect(cameraYawSign(controls.settings)).toBe(1);
    controls.app = { eco: { s: { settings: { cameraInvertX: true } } } }; expect(cameraYawSign(controls.settings)).toBe(-1);
  });
});
