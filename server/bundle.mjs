import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'server/dist');
await build({
  entryPoints: [path.join(root, 'server/src/index.ts')],
  outfile: path.join(outDir, 'server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  packages: 'external',
  plugins: [{ name: 'shared-runtime-files', setup(build) {
    // Los módulos JS compartidos conservan su ubicación y sus archivos auxiliares.
    build.onResolve({ filter: /^\./ }, args => {
      const abs = path.resolve(args.resolveDir, args.path);
      if (!['scripts', 'worker'].some(dir => abs.startsWith(path.join(root, dir) + path.sep))) return;
      const rel = path.relative(outDir, abs).replaceAll('\\', '/');
      return { path: rel.startsWith('.') ? rel : `./${rel}`, external: true };
    });
  } }],
});
