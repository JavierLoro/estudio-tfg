import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable, Writable } from 'node:stream';
import { createGunzip, createGzip } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const tar = require('tar');
const repo = path.resolve(import.meta.dirname, '..');
export const lock = JSON.parse(await fs.readFile(path.join(repo, 'desktop/tex/lock.json'), 'utf8'));
const platform = `${process.platform}-${process.arch}`;

export function packagesFrom(database, architecture) {
  const entries = new Map(database.trim().split(/\n\s*\n/).map(block => {
    const values = {};
    for (const line of block.split('\n')) {
      const match = /^(\S+) (.*)$/.exec(line);
      if (match) (values[match[1]] ??= []).push(match[2]);
    }
    return [values.name?.[0], values];
  }));
  const selected = new Map();
  const visit = name => {
    const architectureDependency = name.endsWith('.ARCH');
    if (architectureDependency) name = name.replace('.ARCH', '.' + architecture);
    if (selected.has(name)) return;
    const entry = entries.get(name);
    if (!entry) {
      // TeX Live omite binarios que no existen en una arquitectura (p. ej. xdvi en Windows).
      if (architectureDependency) return;
      if (/^(setting_|opt_|release\/|minrelease\/)/.test(name)) return;
      throw new Error(`Dependencia TeX desconocida: ${name}`);
    }
    selected.set(name, entry);
    for (const dependency of entry.depend ?? []) visit(dependency);
  };
  for (const name of ['scheme-basic', 'texlive.infra', 'texlive-scripts', ...lock.packages]) visit(name);
  if (architecture === 'windows') for (const name of ['tlperl.windows', 'tlgs.windows']) visit(name);
  return selected;
}

async function digest(file, algorithm = 'sha256') {
  const hash = crypto.createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function download(url, file, hash, algorithm = 'sha256') {
  if (await digest(file, algorithm).catch(() => null) === hash) return;
  const temporary = file + '.part';
  await command(process.platform === 'win32' ? 'curl.exe' : 'curl', ['--fail', '--location', '--retry', '2', '--connect-timeout', '20', '--max-time', '180', '--output', temporary, url], path.dirname(file));
  if (await digest(temporary, algorithm) !== hash) throw new Error(`Hash incorrecto: ${url}`);
  await fs.rename(temporary, file);
}

export async function command(executable, args, cwd, env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: 'inherit', shell: false });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${executable} terminó con ${code}`)));
  });
}

async function materialize(root) {
  const realRoot = await fs.realpath(root);
  const visit = async dir => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        let target;
        try { target = await fs.realpath(file); }
        catch (error) {
          if (error.code === 'ENOENT' && ['man', 'info'].includes(entry.name)) { await fs.unlink(file); continue; }
          throw error;
        }
        if (!target.startsWith(realRoot + path.sep) || !(await fs.stat(target)).isFile()) throw new Error(`Enlace fuera del paquete: ${file}`);
        const temporary = file + '.materialized';
        await fs.copyFile(target, temporary); await fs.chmod(temporary, (await fs.stat(target)).mode & 0o777);
        await fs.unlink(file); await fs.rename(temporary, file);
      } else if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && (await fs.stat(file)).nlink > 1) {
        const temporary = file + '.materialized';
        await fs.copyFile(file, temporary); await fs.chmod(temporary, (await fs.stat(file)).mode & 0o777);
        await fs.rename(temporary, file);
      }
    }
  };
  await visit(root);
}

export async function packTex(tree, archive) {
  await materialize(tree);
  const pack = tar.c({ cwd: tree, portable: true }, await fs.readdir(tree));
  await pipeline(Readable.from(pack, { objectMode: false }), createGzip({ level: 9 }), createWriteStream(archive));
}

export async function buildTex(output, releaseTag) {
  const architecture = lock.platforms[platform];
  if (!architecture) throw new Error(`Plataforma no admitida: ${platform}`);
  output = path.resolve(output);
  await fs.mkdir(output, { recursive: true });
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-tex-build-'));
  const cache = path.join(output, 'cache'); await fs.mkdir(cache, { recursive: true });
  const tree = path.join(scratch, 'tex'); await fs.mkdir(tree);
  try {
    const databaseFile = path.join(cache, 'texlive.tlpdb');
    await download(lock.repository + '/tlpkg/texlive.tlpdb', databaseFile, lock.databaseSha256);
    const database = await fs.readFile(databaseFile, 'utf8');
    const selected = packagesFrom(database, architecture);
    const repository = path.join(cache, 'repository');
    await fs.mkdir(path.join(repository, 'archive'), { recursive: true });
    await fs.mkdir(path.join(repository, 'tlpkg'), { recursive: true });
    await fs.copyFile(databaseFile, path.join(repository, 'tlpkg/texlive.tlpdb'));
    await fs.writeFile(path.join(repository, 'tlpkg/texlive.tlpdb.sha512'), `${await digest(databaseFile, 'sha512')}  texlive.tlpdb\n`);
    const packages = [...selected].sort(([a], [b]) => a.localeCompare(b));
    // Pocos streams simultáneos: los archivos quedan fijados por el SHA-512 del snapshot.
    for (let offset = 0; offset < packages.length; offset += 6) {
      await Promise.all(packages.slice(offset, offset + 6).map(async ([name, entry]) => {
        if (!entry.containerchecksum) return;
        const file = `${name}.tar.xz`;
        await download(`${lock.repository}/archive/${file}`, path.join(repository, 'archive', file), entry.containerchecksum[0], 'sha512');
      }));
    }
    const installer = lock.installers[process.platform === 'win32' ? 'windows' : 'unix'];
    const installerFile = path.join(cache, installer.file);
    await download(lock.repository + '/' + installer.file, installerFile, installer.sha256);
    const extracted = path.join(scratch, 'installer'); await fs.mkdir(extracted);
    if (process.platform === 'win32') {
      const quote = value => "'" + value.replaceAll("'", "''") + "'";
      await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(installerFile)} -DestinationPath ${quote(extracted)}`], scratch);
    } else await tar.x({ file: installerFile, cwd: extracted });
    const installerRoot = path.join(extracted, (await fs.readdir(extracted)).find(name => name.startsWith('install-tl-')));
    const profile = path.join(scratch, 'texlive.profile');
    const destination = tree.replaceAll('\\', '/');
    await fs.writeFile(profile, `selected_scheme scheme-basic\nTEXDIR ${destination}\nTEXMFLOCAL ${destination}/texmf-local\nTEXMFSYSCONFIG ${destination}/texmf-config\nTEXMFSYSVAR ${destination}/texmf-var\nTEXMFHOME ${destination}/texmf-home\nTEXMFCONFIG ${destination}/texmf-config-user\nTEXMFVAR ${destination}/texmf-var-user\nbinary_${architecture} 1\ninstopt_portable 1\ntlpdbopt_install_docfiles 0\ntlpdbopt_install_srcfiles 0\ntlpdbopt_autobackup 0\ntlpdbopt_create_formats 0\noption_path 0\n`);
    const bootstrapPerl = process.platform === 'win32' ? path.join(installerRoot, 'tlpkg/tlperl/bin/perl.exe') : 'perl';
    await command(bootstrapPerl, [path.join(installerRoot, 'install-tl'), '-no-gui', '-profile', profile, '-repository', repository], installerRoot);
    const binDir = `bin/${architecture}`;
    const manager = process.platform === 'win32' ? 'texmf-dist/scripts/texlive/tlmgr.pl' : `${binDir}/tlmgr`;
    await command(bootstrapPerl, [path.join(tree, manager), '--verify-repo=none', '--repository', repository, 'install', ...lock.packages], tree,
      { ...process.env, PATH: [path.join(tree, binDir), path.dirname(bootstrapPerl), process.env.PATH].join(path.delimiter) });
    let perlDir = 'tlpkg/tlperl/bin';
    if (process.platform !== 'win32') {
      const perlFile = path.join(cache, 'perl.tar.gz');
      await download(lock.perl.url, perlFile, lock.perl.sha256);
      const perlSource = path.join(scratch, 'perl-source'); await fs.mkdir(perlSource);
      await tar.x({ file: perlFile, cwd: perlSource });
      const source = path.join(perlSource, `perl-${lock.perl.version}`);
      const prefix = path.join(tree, 'runtime-perl');
      const minimumMac = process.platform === 'darwin' ? (process.arch === 'arm64' ? '26.0' : '13.0') : null;
      const perlCache = path.join(cache, `perl-${platform}-${lock.perl.sha256.slice(0, 12)}${minimumMac ? '-macos-' + minimumMac : ''}`);
      if (await fs.access(path.join(perlCache, 'bin/perl')).then(() => true, () => false)) await fs.cp(perlCache, prefix, { recursive: true });
      else {
        await command('sh', ['Configure', '-des', `-Dprefix=${prefix}`, '-Duserelocatableinc', '-Dman1dir=none', '-Dman3dir=none'], source,
          { ...process.env, ...(minimumMac ? { MACOSX_DEPLOYMENT_TARGET: minimumMac } : {}) });
        await command('make', [`-j${Math.min(os.availableParallelism(), 4)}`], source);
        await command('make', ['install'], source);
        await fs.cp(prefix, perlCache, { recursive: true });
      }
      if (minimumMac && !new RegExp(`minos\\s+${minimumMac.replace('.', '\\.')}\\b`).test(execFileSync('otool', ['-l', path.join(prefix, 'bin/perl')], { encoding: 'utf8' })))
        throw new Error(`Perl no declara el mínimo macOS ${minimumMac} de la app`);
      perlDir = 'runtime-perl/bin';
      await fs.copyFile(path.join(source, 'Copying'), path.join(prefix, 'COPYING'));
      await fs.copyFile(path.join(source, 'Artistic'), path.join(prefix, 'ARTISTIC'));
    }
    const environment = { ...process.env, PATH: [path.join(tree, binDir), path.join(tree, perlDir), process.env.PATH].join(path.delimiter),
      TEXMFHOME: path.join(scratch, 'empty-home'), TEXMFCONFIG: path.join(scratch, 'empty-config'), TEXMFVAR: path.join(tree, 'texmf-var') };
    await command(path.join(tree, binDir, process.platform === 'win32' ? 'mktexlsr.exe' : 'mktexlsr'), [], tree, environment);
    await command(path.join(tree, binDir, process.platform === 'win32' ? 'updmap-sys.exe' : 'updmap-sys'), [], tree, environment);
    await command(path.join(tree, binDir, process.platform === 'win32' ? 'fmtutil-sys.exe' : 'fmtutil-sys'), ['--byfmt', 'pdflatex'], tree, environment);
    const inventory = packages.map(([name, entry]) => ({ name, revision: Number(entry.revision?.[0] ?? 0), sha512: entry.containerchecksum?.[0] ?? null,
      license: entry['catalogue-license']?.[0] ?? 'TeX Live: ver LICENSE.TL', source: entry['catalogue-ctan']?.[0] ? `https://mirrors.ctan.org${entry['catalogue-ctan'][0]}` : 'https://tug.org/texlive/svn/' }));
    await fs.writeFile(path.join(tree, 'COMPONENTS.json'), JSON.stringify({ snapshot: lock.repository, databaseSha256: lock.databaseSha256, packages: inventory, perl: process.platform === 'win32' ? { version: '5.42.0', source: 'https://github.com/Perl/perl5/tree/v5.42.0', snapshot: lock.repository } : lock.perl }, null, 2));
    for (const name of ['LICENSE.TL', 'LICENSE.CTAN']) await fs.copyFile(path.join(installerRoot, name), path.join(tree, name));
    const legal = {};
    for (const name of ['LICENSE.TL', 'LICENSE.CTAN']) legal[name] = await fs.readFile(path.join(tree, name), 'utf8');
    if (process.platform !== 'win32') {
      legal['Perl COPYING'] = await fs.readFile(path.join(tree, 'runtime-perl/COPYING'), 'utf8');
      legal['Perl ARTISTIC'] = await fs.readFile(path.join(tree, 'runtime-perl/ARTISTIC'), 'utf8');
    } else {
      legal['Perl TeX Live'] = await fs.readFile(path.join(tree, 'tlpkg/tlperl/README.TEXLIVE'), 'utf8');
      if (!legal['Perl TeX Live'].includes('Perl 5.42.0')) throw new Error('La versión de Perl Windows no coincide con sus avisos');
      for (const name of ['COPYING', 'ARTISTIC']) {
        const source = path.join(repo, `desktop/licenses/Perl-${name}.txt`);
        await fs.copyFile(source, path.join(tree, `tlpkg/tlperl/${name}`));
        legal[`Perl ${name}`] = await fs.readFile(source, 'utf8');
      }
    }
    await fs.writeFile(path.join(output, `legal-${platform}.json`), JSON.stringify(legal, null, 2));
    const name = `estudio-tfg-${releaseTag.slice(1)}-tex-${platform}.tar.gz`;
    const archive = path.join(output, name);
    await packTex(tree, archive);
    let unpackedBytes = 0;
    await pipeline(createReadStream(archive), createGunzip(), new Writable({ write(chunk, _encoding, callback) { unpackedBytes += chunk.length; callback(); } }));
    const manifest = { schema: 1, id: lock.id, platform, url: `https://github.com/JavierLoro/estudio-tfg/releases/download/${releaseTag}/${name}`,
      sha256: await digest(archive), bytes: (await fs.stat(archive)).size, unpackedBytes, binDir, perlDir,
      versions: { texlive: 2026, latexmk: '4.88', biber: '2.22', pdftex: '1.40.29', perl: process.platform === 'win32' ? '5.42.0' : lock.perl.version },
      snapshot: lock.repository, packages: inventory };
    await fs.writeFile(path.join(output, `engine-${platform}.json`), JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify({ archive, id: manifest.id, sha256: manifest.sha256, bytes: manifest.bytes, installedBytes: unpackedBytes }));
    return { archive, manifest };
  } finally { await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [output, tag] = process.argv.slice(2);
  if (!output || !/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(tag ?? '')) throw new Error('Uso: node scripts/desktop-tex.mjs <temporal> <vX.Y.Z[-prueba]>');
  await buildTex(output, tag);
}
