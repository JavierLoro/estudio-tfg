import { describe, expect, it } from 'vitest';
import { attachedScope, changedLines, contextAllowed } from '../../web/src/lib/assistant.ts';

describe('orientación de permisos del asistente', () => {
  const text = { root: 'memoria' as const, path: 'capitulo.tex' }, pdf = { ...text, path: 'fuente.pdf' };
  it('autorizar adjuntos no hereda ámbitos ni documentos vecinos y exige permiso separado de binarios', () => {
    const scope = attachedScope([text, text, pdf], false);
    expect(scope).toEqual({ memoria: false, library: false, diagrams: false, notes: [], attachments: true, prepareChanges: false, documents: [text, pdf] });
    expect(contextAllowed(scope, text, 'Recursos')).toBe(true);
    expect(contextAllowed(scope, { ...text, path: 'otro.tex' }, 'Recursos')).toBe(false);
    expect(contextAllowed({ ...scope, attachments: false }, pdf, 'Recursos')).toBe(false);
    expect(contextAllowed({ ...scope, documents: [] }, pdf, 'Recursos')).toBe(false);
  });
  it('mantiene la separación de diagramas, Biblioteca y carpetas hermanas', () => {
    const scope = { ...attachedScope([], false), memoria: true, notes: ['Ideas'] };
    expect(contextAllowed(scope, { ...text, path: 'diagrama.mmd' }, 'Recursos')).toBe(false);
    expect(contextAllowed({ ...scope, diagrams: true }, { ...text, path: 'diagrama.mmd' }, 'Recursos')).toBe(true);
    expect(contextAllowed(scope, { root: 'notes', path: 'Ideas/nota.md' }, 'Recursos')).toBe(true);
    expect(contextAllowed(scope, { root: 'notes', path: 'Ideas2/nota.md' }, 'Recursos')).toBe(false);
    expect(contextAllowed({ ...scope, notes: [''] }, { root: 'notes', path: 'Recursos/ficha.md' }, 'Recursos')).toBe(false);
    expect(contextAllowed({ ...scope, library: true }, { root: 'notes', path: 'Recursos/ficha.md' }, 'Recursos')).toBe(true);
  });
});

describe('fragmento cambiado para revisar propuestas', () => {
  it('oculta el texto común de un documento largo y conserva literalmente CRLF', () => {
    const prefix = 'Línea común\r\n'.repeat(5000), suffix = 'Última línea\r\n';
    expect(changedLines(prefix + 'Antes\r\n' + suffix, prefix + 'Después\r\n' + suffix)).toEqual({ before: 'Antes\r\n', after: 'Después\r\n', line: 5001, removed: 1, added: 1 });
  });
  it('distingue añadir, retirar y cambiar el salto final, también en archivos vacíos', () => {
    expect(changedLines('', 'Nueva\n')).toMatchObject({ before: '', after: 'Nueva\n', removed: 0, added: 1 });
    expect(changedLines('Nueva\n', '')).toMatchObject({ before: 'Nueva\n', after: '', removed: 1, added: 0 });
    expect(changedLines('Texto', 'Texto\n')).toMatchObject({ before: 'Texto', after: 'Texto\n' });
    expect(changedLines('', '')).toMatchObject({ before: '', after: '', removed: 0, added: 0 });
  });
});
