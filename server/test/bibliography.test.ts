import { expect, it } from 'vitest';
import { normalizeDoi, parseBibDocument, parseRis, rewriteBibEntry } from '../src/bibliography.ts';

it('conserva macros, comentarios, Unicode, LaTeX y campos desconocidos al reescribir solo un valor', () => {
  const source =
    '% comentario\r\n@string{rev = "Revista"}\r\n@article{Clave,\r\n  title = {Una {API} y \\' +
    "'{a}" +
    '},\r\n  journal = rev # { de pruebas},\r\n  author = {Pérez, Ana},\r\n  year = 2026, % conservar\r\n  custom = {a,b={c}},\r\n}\r\n';
  const doc = parseBibDocument(source),
    e = doc.entries[0];
  expect(e.error).toBeUndefined();
  expect(e.fields.journal).toBe('Revista de pruebas');
  expect(rewriteBibEntry(source, e, { ...e })).toBe(e.raw);
  const out = rewriteBibEntry(source, e, { ...e, fields: { ...e.fields, year: '2027' } });
  expect(out).toBe(e.raw.replace('year = 2026', 'year = {2027}'));
  expect(doc.support).toContain('@string{rev = "Revista"}');
});
it('resuelve macros posteriores, paréntesis y concatenación, sin confundir @ dentro del título', () => {
  const text =
    '@ book (K, title={Texto\n@article{texto literal}}, author="Uno, Dos", year=2026, publisher=editorial # " SA")\n@string{editorial={Empresa}}';
  const doc = parseBibDocument(text);
  expect(doc.entries).toHaveLength(1);
  expect(doc.entries[0].error).toBeUndefined();
  expect(doc.entries[0].fields.publisher).toBe('Empresa SA');
  expect(rewriteBibEntry(text, doc.entries[0], { ...doc.entries[0], entryType: 'article' })).toContain('@ article (K,');
});
it('informa entradas inválidas y continúa con las siguientes sin inventar datos', () => {
  const doc = parseBibDocument('@article{rota,title={sin cierre\n@book{Bien,title={Bien},year=2026}\n@article{Macro,title=ausente}');
  expect(doc.entries).toHaveLength(3);
  expect(doc.entries[0].error).toBeTruthy();
  expect(doc.entries[1].title).toBe('Bien');
  expect(doc.entries[2].error).toContain('Macro sin definición');
  expect(parseBibDocument('@string{a=b}\n@string{b=a}\n@book{C,title=a}').entries[0].error).toContain('circular');
});
it('lee RIS con varios autores, continuaciones y campos originales ajenos', () => {
  const source =
    'TY  - JOUR\r\nTI  - Prueba\r\nAU  - Pérez, Ana\r\nAU  - Otro, Autor\r\nAB  - Primera línea\r\n  Segunda línea\r\nXX  - Campo desconocido\r\nDO  - 10.1234/ejemplo\r\nER  - \r\n';
  const e = parseRis(source)[0];
  expect(e.error).toBeUndefined();
  expect(e.fields.author).toBe('Pérez, Ana and Otro, Autor');
  expect(e.fields.abstract).toContain('Segunda línea');
  expect(e.raw).toBe(source);
  expect(parseRis('TY  - BOOK\nTI  - Incompleto')[0].error).toContain('ER');
});
it('normaliza DOI y rechaza destinos arbitrarios o controles', () => {
  expect(normalizeDoi('https://doi.org/10.1234/Ejemplo')).toBe('10.1234/ejemplo');
  expect(() => normalizeDoi('http://localhost/secreto')).toThrow();
  expect(() => normalizeDoi('10.1234/a\nb')).toThrow();
});
