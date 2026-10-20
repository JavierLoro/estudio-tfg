import { describe, expect, it } from 'vitest';
import { SECTIONS, clampRatio, panelSection, sectionLayout, validLayout, validPreset, type ViewPreset } from '../../web/src/lib/spaces.ts';

const layout = {
  grid: { width: 1400, height: 900, orientation: 'HORIZONTAL', root: { type: 'branch', data: [
    { type: 'leaf', size: 700, data: { id: 'editor', views: ['latex:tfg.tex', 'note:Nota.md', 'diagram:diagramas/ejemplo.mmd'], activeView: 'note:Nota.md' } },
    { type: 'leaf', size: 700, data: { id: 'pdf', views: ['pdf'], activeView: 'pdf' } },
  ] } },
  panels: {
    'latex:tfg.tex': { id: 'latex:tfg.tex', contentComponent: 'latex', params: { root: 'memoria', path: 'tfg.tex' } },
    'note:Nota.md': { id: 'note:Nota.md', contentComponent: 'note', params: { root: 'notes', path: 'Nota.md' } },
    'diagram:diagramas/ejemplo.mmd': { id: 'diagram:diagramas/ejemplo.mmd', contentComponent: 'diagram', params: { root: 'memoria', path: 'diagramas/ejemplo.mmd' } },
    pdf: { id: 'pdf', contentComponent: 'pdf' },
  }, activeGroup: 'editor',
} as Parameters<typeof sectionLayout>[0];

const preset: ViewPreset = {
  id: 'ficticio', name: 'Redacción y notas', pair: ['memoria', 'notes'], ratio: 55,
  sidebars: Object.fromEntries(SECTIONS.map(s => [s, { open: true, width: 220 }])) as ViewPreset['sidebars'],
  layouts: { memoria: sectionLayout(layout, 'memoria'), notes: sectionLayout(layout, 'notes') }, libraryView: true,
};

describe('espacios y vistas guardadas', () => {
  it('separa un layout antiguo sin perder documentos, orden ni la división código/PDF', () => {
    const separated = SECTIONS.map(s => sectionLayout(layout, s));
    expect(separated.flatMap(l => Object.keys(l.panels)).sort()).toEqual(Object.keys(layout.panels).sort());
    expect(separated.every(validLayout)).toBe(true);
    expect(separated[0].grid.root.data).toHaveLength(2);
    expect(JSON.stringify(separated[0].grid.root)).not.toContain('note:Nota.md');
    expect(JSON.stringify(separated[1].grid.root)).toContain('note:Nota.md');
    expect(layout.grid.root.data).toHaveLength(2);
    expect(Object.keys(layout.panels)).toHaveLength(4);
    expect(sectionLayout({ ...layout, activeGroup: 'pdf' }, 'notes').activeGroup).toBe('editor');
  });
  it('cada tipo de documento tiene un único apartado propietario', () => {
    expect(panelSection('latex', 'memoria')).toBe('memoria');
    expect(panelSection('note', 'notes')).toBe('notes');
    expect(panelSection('diagram', 'memoria')).toBe('diagramas');
    expect(panelSection('resource', 'notes')).toBe('resources');
  });
  it('valida los presets y rechaza apartados repetidos, tamaños y layouts dañados', () => {
    expect(validPreset(preset)).toBe(true);
    expect(validPreset({ ...preset, pair: ['memoria', 'memoria'] })).toBe(false);
    expect(validPreset({ ...preset, pair: ['memoria', 'desconocido'] })).toBe(false);
    expect(validPreset({ ...preset, ratio: 90 })).toBe(false);
    expect(validPreset({ ...preset, sidebars: { memoria: { open: true, width: 220 } } })).toBe(false);
    const broken = structuredClone(preset);
    broken.layouts.memoria!.grid.root = { type: 'leaf', data: { id: 'grupo', views: ['archivo-inexistente'] } };
    expect(validPreset(broken)).toBe(false);
    expect(validLayout({ ...layout, panels: { pdf: null } })).toBe(false);
    expect(validPreset(null)).toBe(false);
    expect([clampRatio(-4), clampRatio(150), clampRatio(NaN)]).toEqual([25, 75, 50]);
  });
});
