import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { REPO_ROOT } from '../src/config.ts';
import { NO_GIT_WARNING } from '../../scripts/memoria-template.mjs';

it('init sin Git termina, avisa y conserva una memoria existente al repetir', () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-tfg-init-')));
  try {
    fs.mkdirSync(path.join(repo, 'scripts'));
    for (const file of ['init.mjs', 'memoria-template.mjs', 'system-files.mjs']) fs.copyFileSync(path.join(REPO_ROOT, 'scripts', file), path.join(repo, 'scripts', file));
    fs.cpSync(path.join(REPO_ROOT, 'templates'), path.join(repo, 'templates'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.env'), 'MEMORIA_DIR=./workspace/memoria\nNOTES_DIR=./workspace/notas\n');
    const run = () => spawnSync(process.execPath, [path.join(repo, 'scripts/init.mjs'), '--perfil', 'generico'], {
      env: { ...process.env, PATH: '' }, encoding: 'utf8',
    });
    const result = run();
    expect(result.status).toBe(0);
    const first = result.stdout + result.stderr;
    expect(first).toContain(NO_GIT_WARNING);
    expect(first).not.toContain('repositorio git propio');
    const memoria = path.join(repo, 'workspace/memoria');
    expect(fs.existsSync(path.join(memoria, 'tfg.tex'))).toBe(true);
    expect(fs.existsSync(path.join(memoria, '.git'))).toBe(false);
    expect(fs.existsSync(path.join(repo, 'workspace/notas/Recursos'))).toBe(true);
    fs.writeFileSync(path.join(memoria, 'datos.tex'), 'Datos ficticios que no se sobrescriben');
    const again = run();
    expect(again.status).toBe(0);
    expect(again.stdout).toContain('no se toca');
    expect(fs.readFileSync(path.join(memoria, 'datos.tex'), 'utf8')).toBe('Datos ficticios que no se sobrescriben');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
