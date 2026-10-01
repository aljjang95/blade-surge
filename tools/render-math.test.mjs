import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bloomRenderSize, cameraBlend } from '../src/engine/render-math.js';

for (const [w, h] of [[1920,1080],[2560,1080],[3840,2160],[1080,1920],[844,390],[640,360],[788,693],[300,300]]) {
  test(`bloom preserves aspect and budget at ${w}x${h}`, () => {
    const s = bloomRenderSize(w,h), oldW = Math.min(320,Math.round(w/3)), oldH = Math.min(320,Math.round(h/3));
    assert.ok(s.width >= 1 && s.height >= 1 && Math.max(s.width,s.height) <= 320);
    assert.ok(Math.abs(s.width*h-s.height*w) <= (w+h)/2, 'at most half-pixel rounding per axis');
    assert.ok(s.width*s.height <= oldW*oldH, 'must not increase bloom input pixels');
  });
}
test('1080p regression: remove square bloom input', () => {
  assert.deepEqual(bloomRenderSize(1920,1080), {width:320,height:180});
  assert.notEqual(Math.min(320,1920/3)/Math.min(320,1080/3),1920/1080);
});
test('invalid and tiny dimensions remain finite, nonzero, and bounded', () => {
  for (const [w,h] of [[0,0],[-1,Infinity],[NaN,NaN],[1,1],[1,100000]]) {
    const s=bloomRenderSize(w,h);
    assert.ok(Number.isInteger(s.width) && Number.isInteger(s.height));
    assert.ok(s.width>=1 && s.height>=1 && Math.max(s.width,s.height)<=320);
  }
});
for (const fps of [30,60,120,144]) {
  test(`camera convergence independent of ${fps} FPS`, () => {
    let fov=40;
    for(let i=0;i<fps;i++) fov+=(60-fov)*cameraBlend(1/fps,3);
    assert.ok(Math.abs(fov-(60-20*Math.exp(-3))) < 1e-10);
  });
}
test('camera interpolation composes across irregular frame durations', () => {
  const a=cameraBlend(0.017,3),b=cameraBlend(0.033,3);
  assert.ok(Math.abs((1-a)*(1-b)-(1-cameraBlend(0.05,3)))<1e-14);
});
test('camera rejects invalid timing without overshoot', () => {
  for(const dt of [NaN,Infinity,-1,0]) assert.equal(cameraBlend(dt,3),0);
  for(const rate of [NaN,Infinity,-1,0]) assert.equal(cameraBlend(.016,rate),0);
  for(const dt of [1e-9,.016,.1,10,1e300]) assert.ok(cameraBlend(dt,3)>=0 && cameraBlend(dt,3)<=1);
});
