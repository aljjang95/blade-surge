// optimize-dist 가 띄우는 WebP 재인코딩 작업자. 메시지 하나가 이미지 한 장이다.
import { parentPort } from 'node:worker_threads';
import sharp from 'sharp';
import { optimizeWebp } from './webp.mjs';

sharp.concurrency(1);
parentPort.on('message', async ({ id, bytes, target }) => {
  try {
    const result = await optimizeWebp(new Uint8Array(bytes), target);
    if (result.bytes) parentPort.postMessage({ id, bytes: result.bytes, meta: result.meta }, [result.bytes.buffer]);
    else parentPort.postMessage({ id, skipped: result.skipped });
  } catch (error) { parentPort.postMessage({ id, skipped: `오류: ${error.message}` }); }
});
