#!/usr/bin/env node
// Inventario de una carpeta/archivo en reposo; no copia ni restaura contenido personal.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { isMain } from './dev.mjs';

/** Incluye ocultos y carpetas vacías; no sigue enlaces ni omite errores de lectura. */
export async function inventory(root) {
  const entries = [];
  async function visit(abs, rel) {
    const stat = await fs.lstat(abs);
    if (stat.isDirectory()) {
      entries.push({ path: rel, type: 'dir' });
      for (const name of (await fs.readdir(abs)).sort()) {
        if (name.includes('\\')) throw new Error('Nombre no portable: contiene una barra inversa');
        await visit(path.join(abs, name), rel ? `${rel}/${name}` : name);
      }
    } else if (stat.isFile()) {
      const hash = crypto.createHash('sha256');
      let bytes = 0;
      for await (const chunk of createReadStream(abs)) { hash.update(chunk); bytes += chunk.length; }
      entries.push({ path: rel, type: 'file', bytes, sha256: hash.digest('hex') });
    } else {
      throw new Error(`No se admiten enlaces ni archivos especiales: ${rel || '(raíz)'}`);
    }
  }
  await visit(path.resolve(root), '');
  return { version: 1, entries };
}

/** Nunca escribe dentro del origen ni sobrescribe un manifiesto anterior. */
export async function createManifest(root, manifestFile) {
  const source = await fs.realpath(root);
  const dest = path.join(await fs.realpath(path.dirname(path.resolve(manifestFile))), path.basename(manifestFile));
  const rel = path.relative(source, dest);
  if (rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))) {
    throw new Error('Guarda el manifiesto fuera del origen');
  }
  const manifest = await inventory(root);
  const file = await fs.open(dest, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(manifest, null, 2) + '\n');
    await file.sync();
  } finally { await file.close(); }
  return manifest;
}

export async function verifyManifest(root, manifestFile) {
  let expected;
  try { expected = JSON.parse(await fs.readFile(manifestFile, 'utf8')); }
  catch (e) {
    if (e instanceof SyntaxError) throw new Error('Manifiesto incompleto o no válido; conserva la última copia verificada');
    throw e;
  }
  if (expected?.version !== 1 || !Array.isArray(expected.entries)) throw new Error('Formato de manifiesto no válido');
  const actual = await inventory(root);
  if (JSON.stringify(expected.entries) !== JSON.stringify(actual.entries)) {
    throw new Error('La copia no coincide con el manifiesto: faltan o sobran rutas, o cambiaron sus bytes');
  }
  return actual;
}

if (isMain(import.meta.url)) {
  try {
    const [command, root, manifestFile, ...extra] = process.argv.slice(2);
    if (!['crear', 'verificar'].includes(command) || !root || !manifestFile || extra.length) {
      throw new Error('Uso: node scripts/respaldo-manifest.mjs crear|verificar <carpeta-o-archivo> <manifiesto.json>');
    }
    const result = await (command === 'crear' ? createManifest : verifyManifest)(root, manifestFile);
    console.log(`✓ ${command === 'crear' ? 'Manifiesto creado' : 'Copia verificada'}: ${result.entries.length} rutas`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
