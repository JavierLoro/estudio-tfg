import { describe, expect, it } from 'vitest';
import { REPO_ROOT, loadConfig } from '../src/config.ts';


describe('config: contenido personal fuera del repo', () => {
  it('acepta carpetas externas y workspace/', () => {
    expect(() => loadConfig({ NOTES_DIR: '/tmp/otra/notas', MEMORIA_DIR: '/tmp/otra/memoria' }, REPO_ROOT)).not.toThrow();
    expect(() => loadConfig({ NOTES_DIR: './workspace/notes', MEMORIA_DIR: './workspace/memoria' }, REPO_ROOT)).not.toThrow();
    expect(() => loadConfig({}, REPO_ROOT)).not.toThrow();
  });
  it('rechaza carpetas versionadas del repo', () => {
    expect(() => loadConfig({ MEMORIA_DIR: './templates/base' }, REPO_ROOT)).toThrow(/dentro del repositorio/);
    expect(() => loadConfig({ NOTES_DIR: './docs' }, REPO_ROOT)).toThrow(/dentro del repositorio/);
    expect(() => loadConfig({ NOTES_DIR: '.' }, REPO_ROOT)).toThrow(/dentro del repositorio/);
    expect(() => loadConfig({ NOTES_DIR: './workspace-x' }, REPO_ROOT)).toThrow(/dentro del repositorio/);
  });
});
