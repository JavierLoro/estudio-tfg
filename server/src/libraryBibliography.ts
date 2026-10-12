import fs from 'node:fs/promises';
import type { Ctx } from './context.ts';
import type { ResourceItem } from './resources.ts';
import type { BibliographyOrigin } from './libraryModel.ts';
import { HttpError, badRequest } from './errors.ts';
import { resolveSafe } from './paths.ts';
import { citeKey, fieldName, namespaceBibDocument, parseBibDocument, rewriteBibEntry, sourceHash, texEscape } from './bibliography.ts';

export interface ExportedReference {
  body: string;
  support: Record<string, string>;
  auxiliary: Record<string, string>;
}
export async function renderLibraryReference(ctx: Ctx, item: ResourceItem, key: string): Promise<ExportedReference> {
  const bib = item.bibliography;
  if (bib?.authority !== 'library' || !citeKey.test(key)) throw badRequest('La ficha no contiene una referencia gestionada válida');
  if (Object.keys(bib.fields).some((k) => !fieldName.test(k))) throw badRequest('Hay nombres de campos bibliográficos no válidos');
  const support: Record<string, string> = {},
    auxiliary: Record<string, string> = {};
  const sources: (ReturnType<typeof namespaceBibDocument> & { hash: string })[] = [];
  const origins: BibliographyOrigin[] = [...(bib.source ? [bib.source] : []), ...(bib.sources ?? []).slice().reverse()];
  for (const origin of origins) {
    if (origin.format !== 'bibtex') continue;
    const r = await resolveSafe(ctx.cfg, 'notes', `${ctx.cfg.resourcesSubdir}/originales/${origin.hash}.bib`);
    if (!r.exists) throw new HttpError(409, 'Falta el original bibliográfico; restáuralo antes de exportar');
    const st = await fs.stat(r.abs);
    if (!st.isFile() || st.size > 1024 * 1024) throw badRequest('Original bibliográfico no válido');
    const text = await fs.readFile(r.abs, 'utf8');
    if (sourceHash(text) !== origin.hash)
      throw new HttpError(409, 'El original bibliográfico fue modificado; importa una copia corregida, sin sobrescribirlo');
    const prefix = `et${origin.hash}_`,
      doc = namespaceBibDocument(text, prefix);
    support[origin.hash] = doc.support;
    sources.push({ ...doc, hash: origin.hash, entries: [doc.entries[origin.index], ...doc.entries.filter((_, i) => i !== origin.index)] });
  }
  const raw: Record<string, string> = {},
    values = { ...bib.fields, title: item.title },
    fieldSources: Record<string, (typeof sources)[number]> = {};
  if (bib.source?.format === 'bibtex')
    for (const [name, value] of Object.entries(values)) raw[name] = `{${value.replace(/(?<!\\)[%&#]/g, '\\$&')}}`;
  for (const [name, value] of Object.entries(values))
    for (const doc of sources) {
      const entry = doc.entries[0];
      if (!entry) throw badRequest('La entrada original ya no existe');
      const original = name === 'title' ? entry.title : entry.fields[name];
      if (original === value && entry.values[name]) {
        raw[name] = entry.values[name].value;
        fieldSources[name] = doc;
        break;
      }
    }
  const primary = sources[0],
    entry = primary?.entries[0];
  const parentKey = (hash: string, old: string) => `et${hash.slice(0, 32)}_${sourceHash(old).slice(0, 16)}`;
  const addParent = (oldKey: string, doc: typeof primary, chain: string[] = []): string => {
    const hash = doc.hash;
    const key = parentKey(hash, oldKey);
    if (chain.includes(oldKey) || chain.length >= 16) throw badRequest('Referencias bibliográficas circulares; revisa el original');
    if (auxiliary[key]) return key;
    const matches = doc.entries.filter((e) => e?.key === oldKey);
    if (matches.length !== 1 || matches[0].error)
      throw badRequest(`La referencia auxiliar ${oldKey} falta o es inválida; corrige el original`);
    const parent = matches[0],
      overrides: Record<string, string> = {};
    for (const name of ['crossref', 'xref', 'xdata', 'entryset', 'related'])
      if (parent.fields[name]) {
        overrides[name] = `{${parent.fields[name]
          .split(',')
          .map((k) => addParent(k.trim(), doc, [...chain, oldKey]))
          .join(',')}}`;
      }
    auxiliary[key] = rewriteBibEntry(doc.text, parent, { ...parent, key }, overrides);
    return key;
  };
  for (const name of ['crossref', 'xref', 'xdata', 'entryset', 'related'])
    if (bib.fields[name]) {
      if (!primary) throw badRequest(`La referencia ${name} necesita su original BibTeX para resolver asociaciones`);
      const keys = bib.fields[name].split(',').map((k) => k.trim());
      let doc = fieldSources[name];
      if (!doc) {
        const candidates = [...new Map(sources.map((source) => [source.hash, source])).values()].filter((source) =>
          keys.every((key) => {
            const matches = source.entries.filter((e) => e?.key === key);
            return matches.length === 1 && !matches[0].error;
          }),
        );
        if (candidates.length !== 1)
          throw badRequest(`La asociación ${name} es ${candidates.length ? 'ambigua entre originales' : 'inválida'}; corrige el campo o reimporta su original`);
        doc = candidates[0];
      }
      raw[name] = `{${keys.map((key) => addParent(key, doc)).join(',')}}`;
    }
  let body: string;
  if ((entry && entry.raw.endsWith('}')) || (entry && entry.raw.endsWith(')')))
    body = rewriteBibEntry(primary.text, entry, { key, entryType: bib.entryType, title: item.title, fields: bib.fields }, raw);
  else
    body = `@${bib.entryType}{${key},\n${Object.entries(values)
      .map(([name, value]) => `  ${name} = ${raw[name] ?? `{${texEscape(value)}}`}`)
      .join(',\n')}\n}`;
  const parsed = parseBibDocument(Object.values(support).join('\n') + '\n' + body);
  if (parsed.entries.some((e) => e.error))
    throw badRequest('Quedan expresiones bibliográficas sin resolver; corrige los campos o reimporta el original antes de citar');
  return { body, support, auxiliary };
}
