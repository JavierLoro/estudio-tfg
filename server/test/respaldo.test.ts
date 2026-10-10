import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createManifest, verifyManifest } from '../../scripts/respaldo-manifest.mjs';
import { buildApp } from '../src/app.ts';
import { libraryId } from '../src/captureOperations.ts';
import { loadConfig } from '../src/config.ts';
import { multipart, setup, type TestEnv } from './helpers.ts';

let t: TestEnv;
beforeEach(async () => { t = await setup(); });
afterEach(async () => { vi.restoreAllMocks(); await t.close(); });

it('restaura una copia íntegra en otra ubicación, detecta interrupciones y abre sus documentos', async () => {
  const notes = t.cfg.notesDir;
  const memoria = t.cfg.memoriaDir;
  const data = path.dirname(t.cfg.buildDir);
  const note = '# Investigación ficticia\r\n[[Sistema/Arquitectura]]\r\n![Figura](Recursos/adjuntos/figura.svg)\r\n';
  const image = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><text x="2" y="20">Ficticio</text></svg>');
  await fs.mkdir(path.join(notes, 'Recursos/archivados'), { recursive: true });
  await fs.mkdir(path.join(notes, 'Recursos/adjuntos'), { recursive: true });
  await fs.writeFile(path.join(notes, 'Investigación.md'), note);
  await fs.writeFile(path.join(notes, 'Recursos/adjuntos/figura.svg'), image);
  const resource = '---\ntype: resource\ntitle: Figura ficticia\ncaptured: 2026-10-10\nstatus: revisado\nattachment: ../adjuntos/figura.svg\n---\n[[Investigación]]\n';
  await fs.writeFile(path.join(notes, 'Recursos/archivados/ficha.md'), resource);
  await fs.mkdir(path.join(notes, '.obsidian'));
  await fs.writeFile(path.join(notes, '.obsidian/app.json'), '{"ficticio":true}\n');
  await fs.mkdir(path.join(memoria, '.git'));
  await fs.writeFile(path.join(memoria, '.git/config'), '[core]\n\tbare = false\n');
  await fs.writeFile(path.join(memoria, 'bibliografia-prueba.bib'), '@book{ficticio,title={Libro ficticio},year={2026}}\n');
  await fs.mkdir(path.join(data, 'history/notes/Investigación.md'), { recursive: true });
  await fs.writeFile(path.join(data, 'history/notes/Investigación.md/20261010.bak'), '# Versión ficticia anterior\n');
  await fs.mkdir(path.join(notes, '.trash'));
  await fs.writeFile(path.join(notes, '.trash/borrado.md'), 'Borrado ficticio\n');
  await fs.mkdir(path.join(data, 'trash/memoria/20261010'), { recursive: true });
  await fs.writeFile(path.join(data, 'trash/memoria/20261010/borrado.tex'), 'Borrado ficticio\n');
  const settings = { notesDir: notes, memoriaDir: memoria, resourcesSubdir: 'Recursos', memoriaMain: 'tfg.tex' };
  await fs.writeFile(t.cfg.settingsFile, JSON.stringify(settings));
  const config = path.join(t.dir, '.env-ficticio');
  await fs.writeFile(config, 'AUTH_TOKEN=token-solo-ficticio\n');

  const oldId = libraryId(t.cfg);
  const done = await t.app.inject({ method: 'POST', url: '/api/capture', payload: {
    operationId: 'recibo-terminado', libraryId: oldId, title: 'Referencia ficticia', note: 'Conservar recibo',
  } });
  expect(done.statusCode).toBe(200);
  // Una captura interrumpida deja tanto el registro como el adjunto de recuperación.
  const link = fs.link.bind(fs);
  vi.spyOn(fs, 'link').mockImplementation(async (from, to) => {
    if (String(to).endsWith('Pendiente.md')) throw Object.assign(new Error('Interrupción ficticia'), { code: 'EIO' });
    return link(from, to);
  });
  const fd = new FormData();
  for (const [k, v] of Object.entries({ operationId: 'recibo-pendiente', libraryId: oldId, title: 'Pendiente', note: 'Texto por recuperar' })) fd.set(k, v);
  fd.set('file', new Blob(['Adjunto pendiente ficticio']), 'pendiente.txt');
  expect((await t.app.inject({ method: 'POST', url: '/api/capture', ...await multipart(fd) })).statusCode).toBe(500);
  vi.restoreAllMocks();
  await t.app.close();

  const backup = path.join(t.dir, 'copia-verificable');
  await fs.mkdir(backup);
  const sources = { notas: notes, memoria, datos: data, configuración: config };
  for (const [name, source] of Object.entries(sources)) {
    const manifest = path.join(backup, `${name}.json`);
    await createManifest(source, manifest); // Inventario del origen ANTES de copiar.
    await fs.cp(source, path.join(backup, name), { recursive: true, force: false, errorOnExist: true });
    await verifyManifest(path.join(backup, name), manifest);
  }

  const partial = path.join(t.dir, 'copia-interrumpida');
  await expect(fs.cp(notes, partial, { recursive: true, filter: (source) => {
    if (source.endsWith('Investigación.md')) throw new Error('Copia interrumpida');
    return true;
  } })).rejects.toThrow('Copia interrumpida');
  await expect(verifyManifest(partial, path.join(backup, 'notas.json'))).rejects.toThrow('no coincide');
  await verifyManifest(path.join(backup, 'notas'), path.join(backup, 'notas.json'));

  const restored = path.join(t.dir, 'restauración-nueva');
  await fs.mkdir(restored);
  for (const name of Object.keys(sources)) {
    await fs.cp(path.join(backup, name), path.join(restored, name), { recursive: true, force: false, errorOnExist: true });
    await verifyManifest(path.join(restored, name), path.join(backup, `${name}.json`));
  }
  const cfg = loadConfig({
    NOTES_DIR: path.join(restored, 'notas'), MEMORIA_DIR: path.join(restored, 'memoria'),
    BUILD_DIR: path.join(restored, 'datos/builds'), ALLOWED_ROOTS: restored, AUTH_TOKEN: '',
    WORKER_URL: 'http://127.0.0.1:1',
  }, t.dir);
  // settings.json manda sobre el entorno: adaptar solo la COPIA antes del primer arranque.
  await fs.writeFile(cfg.settingsFile, JSON.stringify({ ...settings, notesDir: cfg.notesDir, memoriaDir: cfg.memoriaDir }));
  const { app } = await buildApp(cfg, { serveWeb: false, watch: false });
  try {
    await app.ready();
    const openedNote = await app.inject(`/api/file?root=notes&path=${encodeURIComponent('Investigación.md')}`);
    expect(openedNote.statusCode).toBe(200);
    expect(openedNote.json().content).toBe(note);
    expect((await app.inject('/api/notes/resolve?target=Sistema%2FArquitectura')).json().path).toBe('Sistema/Arquitectura.md');
    const ficha = await app.inject('/api/resources/file?path=Recursos%2Farchivados%2Fficha.md');
    expect(ficha.statusCode).toBe(200);
    expect(ficha.json().content).toBe(resource);
    expect(ficha.json().attachmentPath).toBe('Recursos/adjuntos/figura.svg');
    const raw = await app.inject('/api/raw?root=notes&path=Recursos%2Fadjuntos%2Ffigura.svg');
    expect(raw.rawPayload).toEqual(image);
    const main = await app.inject('/api/file?root=memoria&path=tfg.tex');
    expect(main.json().content).toBe(await fs.readFile(path.join(memoria, 'tfg.tex'), 'utf8'));
    expect((await app.inject('/api/file?root=memoria&path=bibliografia-prueba.bib')).json().content).toContain('@book{ficticio');
    expect((await app.inject('/api/settings')).json().values.notesDir).toBe(cfg.notesDir);

    // Traslado: el registro antiguo se conserva, pero no se reasigna ni reenvía a otra biblioteca.
    expect(libraryId(cfg)).not.toBe(oldId);
    expect((await app.inject(`/api/capture/operation?operationId=recibo-pendiente&libraryId=${oldId}`)).statusCode).toBe(409);
    const journal = path.join(restored, 'datos/captures', oldId, 'recibo-pendiente');
    expect(JSON.parse(await fs.readFile(path.join(journal, 'operation.json'), 'utf8')).state).toBe('prepared');
    expect(await fs.readFile(path.join(journal, 'attachment'), 'utf8')).toBe('Adjunto pendiente ficticio');
    const pending = JSON.parse(await fs.readFile(path.join(journal, 'operation.json'), 'utf8'));
    await expect(fs.stat(path.join(cfg.notesDir, pending.result.path))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await app.close(); }
  // La prueba nunca sobrescribe origen ni copia verificada al configurar/abrir la restauración.
  for (const [name, source] of Object.entries(sources)) {
    await verifyManifest(source, path.join(backup, `${name}.json`));
    await verifyManifest(path.join(backup, name), path.join(backup, `${name}.json`));
  }
});
