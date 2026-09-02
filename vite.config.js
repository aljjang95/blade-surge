import { defineConfig } from 'vite';
export default defineConfig({
  build: { target: 'es2020', outDir: 'dist', emptyOutDir: false, assetsInlineLimit: 0, chunkSizeWarningLimit: 1500,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
  server: { host: true, port: 5173 },
});
