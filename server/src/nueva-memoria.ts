import fs from 'node:fs';
import { templateFiles } from '../../scripts/memoria-template.mjs';
import { applyChanges, escapeTex, FieldInvalid } from './datos.ts';
import { HttpError } from './errors.ts';
import { generarPortadas, PORTADAS_REL } from './portadas.ts';
import { portadasIniciales } from '../../shared/portadas.ts';
import { ESTILO_DEFAULTS } from '../../shared/estilo.ts';
import { TIPOGRAFIA_DEFAULTS } from '../../shared/tipografia.ts';
import { PAGINACION_DEFAULTS } from '../../shared/paginacion.ts';
import { INDICES_DEFAULTS, TIPOS_INDICE } from '../../shared/indices.ts';

const error = (field: string, message: string) => new HttpError(400, message, { field });
const record = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw error(field, 'La configuración no es válida');
  return value as Record<string, unknown>;
};
const EXTRAS = ['portada', 'portadaInterior', 'derechos', 'tribunal', 'resumen', 'abstract', 'agradecimientos', 'indices', 'bibliografia', 'anexo'] as const;

/** Genera únicamente fuentes nuevas; toda la configuración se valida antes de crear la carpeta. */
export function nuevaMemoria(raw: unknown, templatesDir?: string): Map<string, string | Buffer> {
  const cfg = record(raw, 'configuracion');
  for (const key of Object.keys(cfg)) if (!['datos', 'institucion', 'apartados', 'capitulos', 'portadas'].includes(key)) throw error(key, 'Opción de configuración desconocida');
  const datos = record(cfg.datos, 'datos');
  const institucion = record(cfg.institucion, 'institucion');
  if ('logo' in institucion && institucion.logo !== '') throw error('logo', 'Puedes añadir el logo desde Datos del trabajo después de crear la memoria');
  const apartados = record(cfg.apartados, 'apartados');
  const margins = ['margenInterior', 'margenExterior', 'margenSuperior', 'margenInferior'].map((key) => {
    const value = institucion[key] ?? '25mm';
    if (typeof value !== 'string' || !/^\d+(\.\d+)?mm$/.test(value) || parseFloat(value) > 80) throw error(key, 'Usa un margen entre 0 y 80 milímetros');
    return parseFloat(value);
  });
  const [width, height] = institucion.papel === 'personalizado' ? [parseFloat(String(institucion.anchoPapel ?? '210')), parseFloat(String(institucion.altoPapel ?? '297'))] : institucion.papel === 'a5' ? [148, 210] : institucion.papel === 'carta' ? [215.9, 279.4] : [210, 297];
  if (margins[0] + margins[1] > width - 80 || margins[2] + margins[3] > height - 100) throw error('margenes', 'Los márgenes dejan demasiado poco espacio para el texto');
  for (const [key, value] of Object.entries(apartados)) {
    if (!(EXTRAS as readonly string[]).includes(key) || typeof value !== 'boolean') throw error('apartados', 'Selecciona apartados válidos');
  }
  if (!Array.isArray(cfg.capitulos) || cfg.capitulos.length < 1 || cfg.capitulos.length > 30 ||
    cfg.capitulos.some((title) => typeof title !== 'string' || !title.trim() || title.trim().length > 200 || /[\r\n]/.test(title))) {
    throw error('capitulos', 'Añade entre 1 y 30 capítulos con títulos de hasta 200 caracteres');
  }
  const titles = (cfg.capitulos as string[]).map((title) => title.trim());
  if (new Set(titles.map((title) => title.toLocaleLowerCase())).size !== titles.length) throw error('capitulos', 'Hay capítulos con el mismo título');
  const ingles = datos.idioma === 'ingles';
  const archivos = new Map<string, string | Buffer>();
  archivos.set(PORTADAS_REL, generarPortadas(cfg.portadas ?? portadasIniciales()));
  const defaults = String.raw`\titulo{}
\autor{}
\idioma{espanol}
\formato{impresion}
\modo{borrador}
\estiloBibliografia{numeric}
\licencia{reservados}
\atribucion{no}
\bibliografiaOpcional{si}
`;
  try {
    archivos.set('datos.tex', applyChanges(defaults, 'datos', datos));
    const file = templateFiles('generico', templatesDir).get('estilo/institucion.tex')!;
    const source = fs.readFileSync(file, 'utf8');
    archivos.set('estilo/institucion.tex', applyChanges(source, 'institucion', { ...ESTILO_DEFAULTS, ...TIPOGRAFIA_DEFAULTS, ...PAGINACION_DEFAULTS, ...INDICES_DEFAULTS,
      ...(!apartados.indices ? Object.fromEntries(TIPOS_INDICE.map(([key]) => [key, 'no'])) : {}),
      papel: 'a4', caras: 'una',
      margenInterior: '25mm', margenExterior: '25mm', ...institucion,
      mostrarPortada: apartados.portada ? 'si' : 'no', mostrarPortadaInterior: apartados.portadaInterior ? 'si' : 'no',
      mostrarDerechos: apartados.derechos ? 'si' : 'no', mostrarTribunal: apartados.tribunal ? 'si' : 'no' }));
  } catch (e) {
    if (e instanceof FieldInvalid) throw error(e.field, e.message);
    throw e;
  }
  const template = templateFiles('generico', templatesDir);
  for (const rel of ['.gitignore', 'estilo/memoria.cls']) archivos.set(rel, fs.readFileSync(template.get(rel)!));
  const main = ['% Documento creado desde cero en Estudio TFG.', '\\documentclass{estilo/memoria}', '\\input{datos}'];
  archivos.set('bibliografia.bib', '% Añade tus referencias desde Biblioteca o desde este archivo.\n% Una cadena vacía mantiene válido el archivo aunque las citas vengan de Biblioteca.\n@string{etDocumentoVacio = ""}\n');
  if (apartados.bibliografia) {
    // shortcut: imprime referencias cuando biber ha cargado entradas; ampliar para bibliografías sin citas si se solicita.
    main.push('\\newif\\ifreferencias', '\\AtDataInput{\\global\\referenciastrue}');
  }
  main.push('', '\\begin{document}', '\\frontmatter');
  for (const cmd of ['portada', 'portadainterior', 'paginaderechos', 'tribunal']) {
    main.push('\\' + cmd);
  }
  const summaries = ingles ? ['abstract', 'resumen'] : ['resumen', 'abstract'];
  for (const key of [...summaries, 'agradecimientos']) {
    const language = key === 'abstract' ? 'english' : key === 'resumen' ? 'spanish' : ingles ? 'english' : 'spanish';
    const title = key === 'abstract' ? 'Abstract' : key === 'resumen' ? 'Resumen' : ingles ? 'Acknowledgements' : 'Agradecimientos';
    archivos.set(`0-inicio/${key}.tex`, `\\begin{otherlanguage}{${language}}\n\\chapter*{${title}}\n\n% Escribe aquí el contenido de este apartado.\n\\end{otherlanguage}\n`);
  }
  // Las dos ramas permiten cambiar después el idioma sin volver a crear los apartados.
  main.push('\\iflanguage{english}{%');
  for (const key of ['abstract', 'resumen']) main.push(`${apartados[key] ? '' : '% '}  \\input{0-inicio/${key}}`);
  main.push('}{%');
  for (const key of ['resumen', 'abstract']) main.push(`${apartados[key] ? '' : '% '}  \\input{0-inicio/${key}}`);
  main.push('}');
  main.push(`${apartados.agradecimientos ? '' : '% '}\\input{0-inicio/agradecimientos}`);
  // Mantener el bloque permite activar cualquier índice después, sin editar el principal.
  main.push('\\indices');
  main.push('', '\\mainmatter');
  titles.forEach((title, idx) => {
    const file = `1-capitulos/${String(idx + 1).padStart(2, '0')}-capitulo`;
    main.push(`\\include{${file}}`);
    archivos.set(file + '.tex', `\\chapter{${escapeTex(title)}}\\label{cap:${idx + 1}}\n\n% Escribe aquí el contenido de este capítulo.\n`);
  });
  if (apartados.bibliografia) main.push('', '\\ifreferencias', '\\bibliography{bibliografia}', '\\fi');
  if (apartados.anexo) {
    main.push('', '\\appendix', '\\include{2-anexos/a-anexo}');
    archivos.set('2-anexos/a-anexo.tex', `\\chapter{${ingles ? 'Appendix' : 'Anexo'}}\\label{anexo:a}\n\n% Escribe aquí el contenido del anexo.\n`);
  }
  main.push('', '\\end{document}', '');
  archivos.set('tfg.tex', main.join('\n'));
  return archivos;
}
