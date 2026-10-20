import { defineConfig } from 'vite';
import { existsSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const scratchRoot = path.resolve(projectRoot, 'work');
export default defineConfig({
  plugins: [{
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
