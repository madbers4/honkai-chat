import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '0.0.0.0', proxy: { '/ws': { target: 'ws://localhost:3000', ws: true }, '/api': 'http://localhost:3000' } },
  build: { target: 'es2022', chunkSizeWarningLimit: 750, rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
});
