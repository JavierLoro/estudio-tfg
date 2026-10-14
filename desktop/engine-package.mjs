import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { extractTar, safeEntryPath } from '../worker/untar.mjs';

const inside = (root, target) => target === root || target.startsWith(root + path.sep);
const problem = message => Object.assign(new Error(message), { statusCode: 409 });
export const platformId = () => `${process.platform}-${process.arch}`;

function relative(value) {
  if (typeof value !== 'string' || safeEntryPath(value) !== value || /[:\r\n]/.test(value)) throw problem('Ruta no válida en el manifiesto del motor');
  return value;
}

export function validatePackage(manifest, platform = platformId()) {
  if (!manifest || manifest.schema !== 1 || manifest.platform !== platform || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(manifest.id) || manifest.id.includes('..'))
    throw problem('El paquete TeX no corresponde a esta plataforma');
  if (!/^[a-f0-9]{64}$/.test(manifest.sha256) || !Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 0 || manifest.bytes > 1024 ** 3 ||
    !Number.isSafeInteger(manifest.unpackedBytes) || manifest.unpackedBytes <= 0 || manifest.unpackedBytes > 2 * 1024 ** 3)
    throw problem('Tamaño o hash no válido en el manifiesto del motor');
  let url;
  try { url = new URL(manifest.url); } catch { throw problem('URL no válida en el manifiesto del motor'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw problem('La descarga del motor debe utilizar HTTPS');
  relative(manifest.binDir); relative(manifest.perlDir);
  return manifest;
}

export async function atomicJson(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
}

/** El archivo verificado se publica completo; nunca se extrae sobre un motor activo. */
export class EnginePackage {
  constructor({ dataDir, manifest = null, archive = null, fetchPackage = (...args) => fetch(...args), onReady = () => {}, platform = platformId() }) {
    this.root = path.join(dataDir, 'engines');
    this.manifest = manifest ? validatePackage(manifest, platform) : null;
    this.archive = archive;
    this.fetchPackage = fetchPackage;
    this.onReady = onReady;
    this.platform = platform;
    this.state = { phase: 'idle', received: 0, total: manifest?.bytes ?? 0, message: null };
    this.paths = null;
    this.operation = null;
  }

  view() {
    return { ...this.state, available: !!this.manifest, installed: !!this.paths,
      current: !!this.paths && this.active?.sha256 === this.manifest?.sha256,
      version: this.active?.id ?? this.manifest?.id ?? null, variant: this.archive ? 'offline' : 'online' };
  }

  async check(root, manifest = this.manifest) {
    const marker = JSON.parse(await fs.readFile(path.join(root, 'installed.json'), 'utf8'));
    if (marker.sha256 !== manifest.sha256 || marker.id !== manifest.id) throw problem('La instalación TeX no coincide con el manifiesto');
    const extension = this.platform.startsWith('win32-') ? '.exe' : '';
    for (const rel of [manifest.binDir + '/latexmk' + extension, manifest.binDir + '/biber' + extension,
      manifest.binDir + '/pdflatex' + extension, manifest.perlDir + '/perl' + extension]) {
      const file = await fs.realpath(path.join(root, ...rel.split('/')));
      if (!inside(await fs.realpath(root), file) || !(await fs.stat(file)).isFile()) throw problem('Herramienta TeX fuera del paquete');
    }
    return { binDir: path.join(root, ...manifest.binDir.split('/')), perlDir: path.join(root, ...manifest.perlDir.split('/')) };
  }

  async load() {
    await fs.mkdir(this.root, { recursive: true });
    if (!this.manifest) return;
    this.root = await fs.realpath(this.root);
    const name = `${this.manifest.id}-${this.manifest.platform}-${this.manifest.sha256.slice(0, 12)}`;
    this.destination = path.join(this.root, name);
    try {
      this.paths = await this.check(this.destination);
      this.active = this.manifest;
      await this.onReady(this.paths);
      this.state.phase = 'ready';
    } catch (error) {
      if (error.code !== 'ENOENT') this.state.message = `Se debe preparar de nuevo el motor: ${error.message}`;
      try {
        const previous = JSON.parse(await fs.readFile(path.join(this.root, 'current.json'), 'utf8'));
        const previousManifest = validatePackage(previous, this.platform);
        const folder = `${previous.id}-${previous.platform}-${previous.sha256.slice(0, 12)}`;
        this.paths = await this.check(path.join(this.root, folder), previousManifest);
        this.active = previousManifest;
        await this.onReady(this.paths);
      } catch { /* Sin motor anterior válido: preparar el fijado por esta app. */ }
    }
    // Staging abandonado pertenece únicamente a este gestor, bajo el bloqueo de instancia Electron.
    for (const name of await fs.readdir(this.root)) if (name.startsWith('.staging-')) await fs.rm(path.join(this.root, name), { recursive: true, force: true });
  }

  prepare() {
    if (!this.manifest) throw problem('Esta ejecución de desarrollo no incluye un paquete TeX; utiliza los ajustes avanzados');
    if (this.operation) return this.view();
    if (this.active?.sha256 === this.manifest.sha256) return this.view();
    this.controller = new AbortController();
    this.state = { phase: this.archive ? 'copying' : 'downloading', received: 0, total: this.manifest.bytes, message: null };
    this.operation = this.install(this.controller.signal).catch(error => {
      this.state.phase = this.controller.signal.aborted ? 'cancelled' : 'error';
      this.state.message = this.controller.signal.aborted ? 'Preparación cancelada. Puedes reintentar.' : `No se pudo preparar TeX: ${error.message}`;
    }).finally(() => { this.operation = null; });
    return this.view();
  }

  async cancel() { this.controller?.abort(); await this.operation; return this.view(); }

  async install(signal) {
    signal.throwIfAborted();
    const manifest = this.manifest;
    const space = await fs.statfs(this.root);
    if (space.bavail * space.bsize < manifest.bytes + manifest.unpackedBytes + 32 * 1024 ** 2) throw problem('No hay espacio suficiente para preparar el motor');
    const staging = await fs.mkdtemp(path.join(this.root, '.staging-'));
    try {
      signal.throwIfAborted();
      const archive = path.join(staging, 'engine.tar.gz');
      let input;
      if (this.archive) input = createReadStream(this.archive);
      else {
        const response = await this.fetchPackage(manifest.url, { signal: AbortSignal.any([signal, AbortSignal.timeout(600_000)]) });
        if (!response.ok || !response.body) throw problem(`La descarga devolvió HTTP ${response.status}`);
        input = Readable.fromWeb(response.body);
      }
      const hash = crypto.createHash('sha256');
      const count = new Transform({ transform: (chunk, _encoding, callback) => {
        this.state.received += chunk.length;
        if (this.state.received > manifest.bytes) return callback(problem('El archivo supera el tamaño fijado'));
        hash.update(chunk); callback(null, chunk);
      } });
      await pipeline(input, count, createWriteStream(archive, { flags: 'wx' }), { signal });
      if (this.state.received !== manifest.bytes || hash.digest('hex') !== manifest.sha256) throw problem('El tamaño o hash de la descarga no coincide');
      signal.throwIfAborted();
      this.state.phase = 'extracting';
      const engine = path.join(staging, 'engine');
      await fs.mkdir(engine);
      const reader = createReadStream(archive);
      const uncompressed = createGunzip();
      const stream = pipeline(reader, uncompressed, { signal });
      // No se admiten enlaces: el constructor del paquete materializa solo los internos.
      const extraction = extractTar(uncompressed, engine, { maxBytes: manifest.unpackedBytes, preserveMode: true, portablePaths: true });
      try { await Promise.all([stream, extraction]); }
      finally { reader.destroy(); uncompressed.destroy(); await Promise.allSettled([stream, extraction]); }
      signal.throwIfAborted();
      await atomicJson(path.join(engine, 'installed.json'), { id: manifest.id, sha256: manifest.sha256 });
      await this.check(engine);
      this.state.phase = 'publishing';
      try { await fs.rename(engine, this.destination); }
      catch (error) {
        // Un directorio previo solo se reutiliza si ya estaba publicado y completo.
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
        try { await this.check(this.destination); }
        catch {
          await fs.rename(this.destination, path.join(this.root, `.broken-${crypto.randomUUID()}`));
          await fs.rename(engine, this.destination);
        }
      }
      this.paths = await this.check(this.destination);
      await this.onReady(this.paths);
      await atomicJson(path.join(this.root, 'current.json'), manifest);
      this.active = manifest;
      this.state.phase = 'ready';
    } finally { await fs.rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  }
}
