import {expect,test} from 'bun:test';
import {lobbyCameraPosition,lobbyCompositionShift} from '../src/engine/lobby-camera.js';
for(const yaw of [-180,-153,-90,0,19,85,180])test(`lobby ${yaw} degree orbit preserves camera-local editorial framing`,()=>{
 const p=lobbyCameraPosition({yaw,pitch:11,zoom:100}),shift=lobbyCompositionShift(p,true);
 expect(Math.hypot(shift.x,shift.z)).toBeCloseTo(.9,10);
 expect(shift.x*p.x+shift.z*p.z).toBeCloseTo(0,10);
 expect(shift.x*p.z-shift.z*p.x).toBeGreaterThan(0);
});
test('portrait and malformed position do not introduce horizontal composition offsets',()=>{
 expect(lobbyCompositionShift(lobbyCameraPosition({yaw:19,pitch:11,zoom:100}),false)).toEqual({x:0,z:0});
 expect(lobbyCompositionShift({x:0,z:0},true)).toEqual({x:0,z:0});
 expect(lobbyCompositionShift({x:Infinity,z:0},true)).toEqual({x:0,z:0});
});
