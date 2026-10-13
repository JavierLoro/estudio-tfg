import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import { woffToSfnt } from '../worker/woff2sfnt.mjs';

const API_TARGET = process.env.VITE_API_TARGET ?? process.env.API_TARGET ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [
    // jsPDF necesita TTF: mismas tablas y métricas que las WOFF del navegador y del worker.
    { name: 'diagram-font-ttf', enforce: 'pre', load(id) {
      if (id.endsWith('.woff?sfnt')) return `export default ${JSON.stringify(woffToSfnt(fs.readFileSync(id.slice(0, -5))).toString('base64'))}`;
    } },
    react(), tailwindcss(),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        // SSE: no buffering/timeouts on the event stream.
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (String(proxyRes.headers['content-type'] ?? '').includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache';
              proxyRes.headers['x-accel-buffering'] = 'no';
            }
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2500,
  },
});
