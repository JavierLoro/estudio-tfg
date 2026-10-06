#!/usr/bin/env node
// Prepara el contenido personal a partir de la plantilla, fuera del historial de este repo.
// - Crea .env desde .env.example si no existe.
// - Si MEMORIA_DIR no existe o está vacío, copia la plantilla (templates/base + el perfil
//   de templates/perfiles/, `--perfil <id>`, por defecto esi-uclm) y le crea su propio git
//   (misma lógica que POST /api/settings/init-memoria: scripts/memoria-template.mjs).
// - Si NOTES_DIR no existe, lo crea (con la carpeta de recursos).
// Nunca sobrescribe nada que ya exista.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PERFIL, REPO_ROOT as repo, createMemoriaFromTemplate, isEmptyDir, listPerfiles } from './memoria-template.mjs';

// --perfil <id> o --perfil=<id>
const args = process.argv.slice(2);
let perfil = DEFAULT_PERFIL;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--perfil') perfil = args[++i] ?? '';
  else if (args[i].startsWith('--perfil=')) perfil = args[i].slice('--perfil='.length);
  else {
    console.error(`Argumento desconocido: ${args[i]}\nUso: npm run init -- [--perfil <id>]`);
    process.exit(2);
  }
}
const perfiles = listPerfiles();
if (!perfiles.some((p) => p.id === perfil)) {
  console.error(`Perfil de plantilla desconocido: ${perfil}\nPerfiles disponibles:`);
  for (const p of perfiles) console.error(`  ${p.id.padEnd(12)} ${p.nombre}`);
  process.exit(2);
}

const envFile = path.join(repo, '.env');

if (!fs.existsSync(envFile)) {
  fs.copyFileSync(path.join(repo, '.env.example'), envFile);
  console.log('Creado .env desde .env.example');
}

const env = Object.fromEntries(
  fs.readFileSync(envFile, 'utf8').split('\n')
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).replace(/\s+#.*$/, '').trim()]; }),
);

const resolve = (p) => path.resolve(repo, p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);
const memoria = resolve(env.MEMORIA_DIR || './workspace/memoria');
const notes = resolve(env.NOTES_DIR || './workspace/notes');

if (isEmptyDir(memoria)) {
  createMemoriaFromTemplate(memoria, { perfil });
  console.log(`Memoria creada desde la plantilla (perfil ${perfil}) en ${memoria} (repositorio git propio)`);
} else {
  console.log(`Memoria ya existe en ${memoria}: no se toca`);
}

const resources = path.join(notes, env.RESOURCES_SUBDIR || 'Recursos');
if (!fs.existsSync(resources)) {
  fs.mkdirSync(resources, { recursive: true });
  console.log(`Creada la carpeta de recursos ${resources}`);
}
console.log(`Notas en ${notes}`);
