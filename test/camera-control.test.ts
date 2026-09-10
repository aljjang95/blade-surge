import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { battleCameraOffset, cameraRelativeMove, normalizeBattleCamera } from '../src/engine/camera-control.js';
import { Input } from '../src/engine/input.js';
import { lobbyCameraPosition, normalizeLobbyCamera } from '../src/engine/lobby-camera.js';

describe('user camera and screen movement', () => {
  test('zoom and elevation stay bounded and reset retains preset offset', () => {
    expect(normalizeBattleCamera({yaw: -720, pitch: 99, zoom: 999})).toEqual({yaw: 0, pitch: 20, zoom: 140});
    expect(normalizeBattleCamera({zoom: NaN})).toEqual({yaw:0, pitch:0, zoom:100});
    const offset = {x: 0, y:13.5, z:7.5}, reset = battleCameraOffset(offset, {});
    expect(reset.y).toBeCloseTo(offset.y); expect(reset.z).toBeCloseTo(offset.z);
    for (const zoom of [-1000, 10000]) for (const pitch of [-1000, 10000]) {
      const value = battleCameraOffset(offset, {zoom, pitch});
      expect(value.y).toBeGreaterThan(0); expect(value.z).toBeGreaterThan(0);
      expect(Math.hypot(value.x,value.y,value.z)).toBeLessThan(25);
    }
  });
  test('screen right/forward follow actual camera orientation through an orbit', () => {
    for (const yaw of [0, 90, -90, 179]) {
      const cam = new THREE.PerspectiveCamera();
      const off = battleCameraOffset({x:0,y:13.5,z:7.5}, {yaw});
      cam.position.set(off.x,off.y,off.z); cam.lookAt(0,0,0); cam.updateMatrixWorld();
      const e = cam.matrixWorld.elements, angle = Math.atan2(-e[2],e[0]);
      const right = cameraRelativeMove(1,0,angle), up = cameraRelativeMove(0,-1,angle);
      expect(right.x).toBeCloseTo(e[0]); expect(right.y).toBeCloseTo(e[2]);
      expect(up.x * off.x + up.y * off.z).toBeLessThan(0);
    }
  });
  test('held touch does not accumulate camera rotation on successive frames', () => {
    const input = Object.assign(Object.create(Input.prototype), { enabled:true, joy:{active:true}, screenMove:{x:1,y:0}, move:{x:0,y:0}, getCameraYaw:()=>Math.PI/2 });
    for(let i=0;i<20;i++) { input.update(); expect(input.move.x).toBeCloseTo(0); expect(input.move.y).toBeCloseTo(-1); }
  });
  test('lobby malformed saved view recovers and keeps independent bounds', () => {
    expect(normalizeLobbyCamera(null)).toEqual({yaw:19,pitch:11,zoom:100});
    const position = lobbyCameraPosition({yaw:999,pitch:-100,zoom:0});
    expect(Number.isFinite(position.z)).toBe(true); expect(position.y).toBeGreaterThan(1.1);
  });
});
