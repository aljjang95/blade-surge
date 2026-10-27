import { defineConfig } from 'vite';
import { existsSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { optimizeDist } from './tools/optimize/optimize-dist.mjs';
import { writeAssetManifests } from './tools/optimize/asset-split.mjs';
import { writeNews } from './tools/build-news.mjs';
const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const scratchRoot = path.resolve(projectRoot, 'work');
let assetOutDir = '', assetChannel = 'web';
export default defineConfig({
  plugins: [{
    // 소식 공개 산출물(public/news.json·public/news/**)은 gitignore 생성물이라 모든 빌드(배포 컨트롤러의 직접 vite build 포함)가 먼저 만든다.
    name: 'build-news', apply: 'build',
    buildStart() { writeNews({ bundle: false }); },
  }, {
    // 공개 소스(public/, asset-library/)는 그대로 두고 산출물 사본에서만 미사용 자산을 빼고 GLB·WebP 를 줄인다(tools/optimize).
    name: 'optimize-shipped-assets', apply: 'build', enforce: 'post',
    configResolved(config) { assetOutDir = path.resolve(config.root, config.build.outDir); assetChannel = ['googleplay', 'onestore', 'apps-in-toss'].includes(config.mode) ? config.mode : 'web'; },
    async closeBundle() {
      if (process.env.BLADE_SKIP_ASSET_OPTIMIZE !== '1') await optimizeDist(assetOutDir, { channel: assetChannel });
      // core/remote 매니페스트: 런타임(네이티브 채널)이 remote 파일의 내용 해시를 읽고, 스토어 빌드가 APK 에서 뺄 목록으로 쓴다.
      await writeAssetManifests(assetOutDir, { channel: assetChannel, full: assetChannel === 'googleplay' || assetChannel === 'onestore' });
    },
  }, {
    name: 'refresh-engraving-assets', apply: 'build',
    configResolved(config) {
      const out = path.resolve(config.root, config.build.outDir);
      const channelOutputs = ['googleplay', 'onestore', 'apps-in-toss'].map(channel => path.resolve(scratchRoot, 'store-builds', channel, 'web'));
      if (path.relative(path.resolve(projectRoot, 'dist'), out) && !channelOutputs.includes(out)) throw new Error('Artwork refresh requires an owned build directory');
      const target = path.resolve(out, 'img/ui-crafted/engraving');
      const relative = path.relative(out, target);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid engraving output directory');
      if (existsSync(target) && path.relative(target, realpathSync(target))) throw new Error('Refusing redirected engraving output directory');
      // Refresh copied artwork while preserving hashed chunks for already-open games.
      rmSync(target, { recursive: true, force: true });
    },
  }],
  define: { __BLADE_CHANNEL__: JSON.stringify('web') },
  build: { target: 'es2020', outDir: 'dist', emptyOutDir: false, assetsInlineLimit: 0, chunkSizeWarningLimit: 1500,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
  server: { host: true, port: 5173, watch: { ignored: file => {
    const relative = path.relative(scratchRoot, path.resolve(file));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  } } },
});
