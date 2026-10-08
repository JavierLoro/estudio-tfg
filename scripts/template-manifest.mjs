#!/usr/bin/env node
// npm run template:manifest — regenera templates/manifiestos/<PLANTILLA_VERSION>.json
// (hash de cada archivo tal como lo crea la plantilla actual, por perfil cuando difieren).
//   --check   no escribe; sale con error si el manifiesto está desactualizado
//   --v0.3    regenera v0.3.json desde el historial de git (commit 2529624, templates/esi-tfg/)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  MANIFIESTOS_DIR,
  PLANTILLA_VERSION,
  REPO_ROOT,
  buildManifest,
  gitPlatformArgs,
  claseDe,
  comandosDatos,
  manifestProblems,
  mergeManifest,
  templateHash,
} from './memoria-template.mjs';

const args = process.argv.slice(2);
const write = (name, m) => {
  fs.mkdirSync(MANIFIESTOS_DIR, { recursive: true });
  const file = path.join(MANIFIESTOS_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
  console.log(`✓ ${path.relative(REPO_ROOT, file)} (${Object.keys(m.archivos).length} entradas)`);
};

if (args.includes('--check')) {
  const p = manifestProblems();
  if (p.length) {
    console.error(`El manifiesto ${PLANTILLA_VERSION} está desactualizado (npm run template:manifest):\n  ${p.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`✓ Manifiesto ${PLANTILLA_VERSION} al día`);
} else if (args.includes('--v0.3')) {
  const COMMIT = '2529624';
  const PREFIX = 'templates/esi-tfg/';
  const git = (...a) => execFileSync('git', [...gitPlatformArgs(), ...a], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
  const rutas = git('ls-tree', '-r', '--name-only', COMMIT, PREFIX).toString().split('\n').filter(Boolean);
  const archivos = {};
  // La plantilla v0.3 equivale al perfil esi-uclm: sus capítulos son propios de ese perfil
  // (con otro perfil no se cambian por los del genérico).
  for (const r of rutas) {
    const rel = r.slice(PREFIX.length);
    archivos[rel.startsWith('1-capitulos/') ? `esi-uclm:${rel}` : rel] = templateHash(git('show', `${COMMIT}:${r}`), rel);
  }
  // Variante conocida de la clase anterior al arreglo de epstopdf (memorias creadas antes de 2529624).
  archivos['estilo/esi-tfg.cls'] = [archivos['estilo/esi-tfg.cls'], 'f56acaa2f00c629cb51c35b5d9376b1956a0dbc3d14d5ad9650b1d6b8bd65a5c'];
  const clase = claseDe(git('show', `${COMMIT}:${PREFIX}estilo/esi-tfg.cls`).toString());
  const cmds = comandosDatos(git('show', `${COMMIT}:${PREFIX}datos.tex`).toString());
  write('v0.3', { version: 'v0.3', clase, comandosDatos: cmds, archivos: Object.fromEntries(Object.entries(archivos).sort()) });
} else {
  const fresh = buildManifest();
  const file = path.join(MANIFIESTOS_DIR, `${PLANTILLA_VERSION}.json`);
  const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  if (old && old.clase !== fresh.clase) {
    console.error(
      `La clase cambió de versión (${old.clase} → ${fresh.clase}): sube PLANTILLA_VERSION en scripts/memoria-template.mjs ` +
        'para crear un manifiesto nuevo sin perder el anterior.',
    );
    process.exit(1);
  }
  write(PLANTILLA_VERSION, mergeManifest(fresh, old));
}
