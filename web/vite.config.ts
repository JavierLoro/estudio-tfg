import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { woffToSfnt } from '../worker/woff2sfnt.mjs';

const API_TARGET = process.env.VITE_API_TARGET ?? process.env.API_TARGET ?? 'http://localhost:8787';
const excalidrawFonts = path.join(path.dirname(createRequire(import.meta.url).resolve('@excalidraw/excalidraw')), 'fonts');

export default defineConfig({
  plugins: [
    // 0.18.1 añade una CDN aun al fijar ASSET_PATH; la CSP de Electron examina también ese fallback.
    { name: 'excalidraw-offline', enforce: 'pre', transform(code, id) {
      if (!id.includes('/@excalidraw/excalidraw/') || !code.includes('https://esm.sh/')) return;
      const fallback = /"ASSETS_FALLBACK_URL",`https:\/\/esm\.sh\/.*?\/dist\/prod\/`/g;
      if ([...code.matchAll(fallback)].length !== 1) throw new Error('Revisar el fallback de fuentes al actualizar Excalidraw');
      return code.replace(fallback, '"ASSETS_FALLBACK_URL",new URL("/assets/excalidraw/",location.origin).href');
    } },
    { name: 'excalidraw-fonts', configureServer(server) {
      const base = excalidrawFonts;
      server.middlewares.use('/assets/excalidraw/fonts', (req, res, next) => {
        let name: string;
        try { name = decodeURIComponent((req.url ?? '').split('?')[0]); } catch { return next(); }
        if (!/^\/[\w/-]+\.woff2$/.test(name)) return next();
        const file = path.join(base, name);
        if (!fs.existsSync(file)) return next();
        res.setHeader('Content-Type', 'font/woff2'); res.end(fs.readFileSync(file));
      });
    }, generateBundle() {
      const base = excalidrawFonts;
      for (const entry of fs.readdirSync(base, { recursive: true })) {
        const name = String(entry).replaceAll('\\', '/');
        if (name.endsWith('.woff2')) this.emitFile({ type: 'asset', fileName: 'assets/excalidraw/fonts/' + name, source: fs.readFileSync(path.join(base, name)) });
      }
    } },
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
