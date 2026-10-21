// 빌드 산출물 전달 크기 최적화. public/ 의 원본(해시 계약 대상)은 그대로 두고, 산출물 폴더의 사본에만 적용한다.
//  1. dist-excludes.json 의 미사용 자산을 산출물에서 뺀다.
//  2. GLB 를 meshopt 로 압축한다(glb.mjs, 변환마다 디코드 검증).
//  3. 큰 WebP 를 SSIM·PSNR 기준을 지키는 가장 낮은 품질로 다시 인코딩한다(webp.mjs).
// 결과는 outDir/asset-optimization.json 에 남긴다. 같은 입력은 node_modules/.cache/blade-assets 에서 재사용한다.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { optimizeGlb, verifyOptimized, GLB_OPTIMIZER_VERSION } from './glb.mjs';
import { optimizeWebp, WEBP_OPTIMIZER_VERSION } from './webp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
/** meshopt 디코더를 붙이지 않은 로더가 읽는 폴더. 이 폴더의 GLB 는 압축하지 않는다. */
const NO_MESHOPT = ['models/armory-v1/'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

const insideOut = (outDir, target) => { const relative = path.relative(outDir, target); return relative && !relative.startsWith('..') && !path.isAbsolute(relative); };

/** 캐시 항목: 결과 바이트 파일, 또는 건너뜀 사유를 담은 .skip 파일. */
async function readCache(cacheDir, key) {
  const file = path.join(cacheDir, key);
  try { return { bytes: new Uint8Array(await fs.readFile(file)), cached: true }; } catch { /* 캐시 없음 */ }
  try { return { skipped: await fs.readFile(`${file}.skip`, 'utf8'), cached: true }; } catch { /* 캐시 없음 */ }
  return null;
}
async function writeCache(cacheDir, key, result) {
  await fs.mkdir(cacheDir, { recursive: true });
  const file = path.join(cacheDir, key);
  if (result.bytes) await fs.writeFile(file, result.bytes); else await fs.writeFile(`${file}.skip`, result.skipped);
}
async function cached(cacheDir, key, compute) {
  const hit = await readCache(cacheDir, key);
  if (hit) return hit;
  const result = await compute();
  await writeCache(cacheDir, key, result);
  return { ...result, cached: false };
}

/**
 * @param {string} outDir 빌드 산출물 폴더(절대 경로)
 * @param {{log?: (line: string) => void, cacheDir?: string, excludes?: string, images?: boolean}} [options]
 */
export async function optimizeDist(outDir, { log = console.log, cacheDir = path.join(root, 'node_modules/.cache/blade-assets'), excludes = path.join(here, 'dist-excludes.json'), images = true, channel = 'web' } = {}) {
  const started = Date.now();
  const report = { schema: 'blade-surge.asset-optimization.v1', glbVersion: GLB_OPTIMIZER_VERSION, webpVersion: WEBP_OPTIMIZER_VERSION, excluded: [], glb: [], webp: [], totals: {} };
  // 1. 제외 항목. 산출물 밖 경로·상위 폴더 탈출은 거부한다.
  const manifest = JSON.parse(await fs.readFile(excludes, 'utf8'));
  report.channel = channel;
  const targets = manifest.entries.map(entry => ({ ...entry, paths: [entry.path] }));
  for (const entry of manifest.channelExcludes?.[channel] || []) {
    // 채널별 제외는 `폴더/*.확장자` 형태만 지원한다.
    const match = /^([^*]+)\/\*(\.[A-Za-z0-9]+)$/.exec(entry.glob);
    if (!match) throw new Error(`지원하지 않는 glob: ${entry.glob}`);
    const dir = path.resolve(outDir, match[1]);
    if (!insideOut(outDir, dir)) throw new Error(`제외 경로가 산출물 밖입니다: ${entry.glob}`);
    let names = [];
    try { names = (await fs.readdir(dir)).filter(name => name.endsWith(match[2])); } catch { /* 폴더 없음 */ }
    targets.push({ path: entry.glob, reason: entry.reason, paths: names.map(name => `${match[1]}/${name}`) });
  }
  for (const entry of targets) for (const relPath of entry.paths) {
    const target = path.resolve(outDir, relPath);
    if (!insideOut(outDir, target)) throw new Error(`제외 경로가 산출물 밖입니다: ${relPath}`);
    let stat = null;
    try { stat = await fs.stat(target); } catch { /* 이미 없음 */ }
    if (!stat) continue;
    let bytes = stat.size;
    if (stat.isDirectory()) { bytes = 0; for (const file of await walk(target)) bytes += (await fs.stat(file)).size; }
    await fs.rm(target, { recursive: true, force: true });
    report.excluded.push({ path: relPath, bytes, reason: entry.reason });
  }
  const files = await walk(outDir);
  // 2. GLB
  for (const file of files.filter(f => f.endsWith('.glb')).sort()) {
    const rel = path.relative(outDir, file).split(path.sep).join('/'), source = new Uint8Array(await fs.readFile(file));
    // 해시가 고정된 로더 소스(src/engine/armory-assets.js, item-presentation-variants.json 이 SHA 를 대조)가 meshopt 디코더를 붙이지 않으므로 이 폴더는 압축하지 않는다.
    if (NO_MESHOPT.some(prefix => rel.startsWith(prefix))) { report.glb.push({ path: rel, before: source.length, after: source.length, skipped: '디코더 없는 로더 전용 폴더' }); continue; }
    const key = `${GLB_OPTIMIZER_VERSION}-${sha256(source)}.glb`;
    let result;
    try {
      result = await cached(cacheDir, key, async () => {
        const optimized = await optimizeGlb(source);
        if (optimized.skipped) return { skipped: optimized.skipped };
        const problem = await verifyOptimized(source, optimized.bytes);
        return problem ? { skipped: `검증 실패: ${problem}` } : { bytes: optimized.bytes };
      });
    } catch (error) { result = { skipped: `오류: ${error.message}` }; }
    if (result.bytes) { await fs.writeFile(file, result.bytes); report.glb.push({ path: rel, before: source.length, after: result.bytes.length, sourceSha256: sha256(source), outputSha256: sha256(result.bytes) }); }
    else report.glb.push({ path: rel, before: source.length, after: source.length, skipped: result.skipped });
  }
  // 3. WebP: 캐시에 없는 것만 작업자 스레드로 병렬 재인코딩한다.
  if (images) {
    const tasks = [];
    for (const file of files.filter(f => f.endsWith('.webp')).sort()) {
      const rel = path.relative(outDir, file).split(path.sep).join('/'), stat = await fs.stat(file);
      if (stat.size < 12 * 1024) continue;
      const source = new Uint8Array(await fs.readFile(file)), key = `${WEBP_OPTIMIZER_VERSION}-${sha256(source)}.webp`;
      tasks.push({ file, rel, source, key, row: null });
    }
    const queue = [];
    for (const task of tasks) {
      const hit = await readCache(cacheDir, task.key);
      if (hit) task.result = hit; else queue.push(task);
    }
    const threads = Math.max(1, Math.min(queue.length, +process.env.BLADE_ASSET_THREADS || Math.max(1, os.availableParallelism() - 1)));
    if (queue.length) {
      const workers = Array.from({ length: threads }, () => new Worker(new URL('./webp-worker.mjs', import.meta.url)));
      let next = 0;
      await Promise.all(workers.map(worker => new Promise((resolve, reject) => {
        const pump = () => {
          const task = queue[next++];
          if (!task) { resolve(); return; }
          worker.once('message', async (message) => {
            task.result = message.bytes ? { bytes: new Uint8Array(message.bytes), meta: message.meta } : { skipped: message.skipped };
            await writeCache(cacheDir, task.key, task.result);
            pump();
          });
          worker.postMessage({ id: task.rel, bytes: task.source.buffer.slice(task.source.byteOffset, task.source.byteOffset + task.source.byteLength) });
        };
        worker.once('error', reject);
        pump();
      })));
      await Promise.all(workers.map(worker => worker.terminate()));
    }
    for (const task of tasks) {
      const result = task.result;
      if (result.bytes) { await fs.writeFile(task.file, result.bytes); report.webp.push({ path: task.rel, before: task.source.length, after: result.bytes.length, ...(result.meta || {}) }); }
      else report.webp.push({ path: task.rel, before: task.source.length, after: task.source.length, skipped: result.skipped });
    }
  }
  const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
  report.totals = { excludedBytes: sum(report.excluded, 'bytes'), glbBefore: sum(report.glb, 'before'), glbAfter: sum(report.glb, 'after'), webpBefore: sum(report.webp, 'before'), webpAfter: sum(report.webp, 'after'), seconds: +((Date.now() - started) / 1000).toFixed(1) };
  await fs.writeFile(path.join(outDir, 'asset-optimization.json'), JSON.stringify(report, null, 1) + '\n');
  log(`[assets] 제외 ${report.excluded.length}건 ${(report.totals.excludedBytes / 1e6).toFixed(1)}MB, GLB ${(report.totals.glbBefore / 1e6).toFixed(1)}→${(report.totals.glbAfter / 1e6).toFixed(1)}MB, WebP ${(report.totals.webpBefore / 1e6).toFixed(1)}→${(report.totals.webpAfter / 1e6).toFixed(1)}MB (${report.totals.seconds}s)`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] || 'dist');
  await optimizeDist(dir, { images: process.argv.includes('--no-images') ? false : true });
}
