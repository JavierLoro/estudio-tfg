import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadConfig, type Config } from '../src/config.ts';
import { applyChanges, escapeTex, parseDatos, unescapeTex } from '../src/datos.ts';
import { rev } from '../src/fsutil.ts';
import { multipart } from './helpers.ts';

const DATOS = `%% datos.tex
\\titulo{Un título   con {llaves} anidadas}   % comentario del título
%\\autor{Comentado}
  \\autor  {Ana Pérez}
\\email{ana@x.es}
\\tutor{Dr. X}
\\fecha{Junio}{2026}  % mes y año
\\palabrasClave{a, b}
\\modo{borrador}
`;

const INST = `% institución
\\universidad{UCLM}
\\tipoTrabajo{tfg}   % tfg | tfm
\\tamanoLetra{12pt}
\\margenes{35mm}{20mm}{25mm}{25mm}
\\interlineado{1.5}
\\logo{}
`;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

let dir = '';
let cfg: Config;
let app: Awaited<ReturnType<typeof buildApp>>['app'];

async function boot(files: Record<string, string>) {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'estudio-tfg-datos-')));
  await fs.mkdir(path.join(dir, 'notes'), { recursive: true });
  await fs.mkdir(path.join(dir, 'memoria', 'estilo'), { recursive: true });
  for (const [rel, c] of Object.entries(files)) await fs.writeFile(path.join(dir, 'memoria', rel), c);
  cfg = loadConfig(
    {
      NOTES_DIR: './notes',
      MEMORIA_DIR: './memoria',
      RESOURCES_SUBDIR: 'Recursos',
      MEMORIA_MAIN: 'tfg.tex',
      BUILD_DIR: './data/builds',
      WORKER_URL: 'http://127.0.0.1:1',
      AUTH_TOKEN: '',
      ALLOWED_ROOTS: dir,
    },
    dir,
  );
  ({ app } = await buildApp(cfg, { serveWeb: false }));
  await app.ready();
}

const read = (rel: string) => fs.readFile(path.join(dir, 'memoria', rel), 'utf8');
const get = async () => (await app.inject({ url: '/api/memoria/datos' })).json();
const put = (body: unknown) => app.inject({ method: 'PUT', url: '/api/memoria/datos', payload: body as object });

afterEach(async () => {
  if (app) await app.close();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  dir = '';
});

describe('parser y escritor (puros)', () => {
  it('lee con comentarios, espacios raros y llaves anidadas; ignora líneas comentadas', () => {
    const d = parseDatos(DATOS, 'datos');
    expect(d.titulo).toBe('Un título   con {llaves} anidadas'.replace('{llaves}', '{llaves}'));
    expect(d.autor).toBe('Ana Pérez');
    expect(d.fechaMes).toBe('Junio');
    expect(d.fechaAnio).toBe('2026');
    expect(d.cotutor).toBe('');
    expect(d.modo).toBe('borrador');
  });

  it('comandos con varios argumentos', () => {
    const i = parseDatos(INST, 'institucion');
    expect(i).toMatchObject({ margenInterior: '35mm', margenExterior: '20mm', margenSuperior: '25mm', margenInferior: '25mm' });
  });

  it('no confunde comandos con el mismo prefijo', () => {
    expect(parseDatos('\\tituloLargo{x}\n\\titulo{y}\n', 'datos').titulo).toBe('y');
  });

  it('escapado: ida y vuelta', () => {
    const s = 'A & B 50% $5 #1 a_b {x} ~ ^ \\ fin';
    expect(escapeTex(s)).toBe('A \\& B 50\\% \\$5 \\#1 a\\_b \\{x\\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{} fin');
    expect(unescapeTex(escapeTex(s))).toBe(s);
    const out = applyChanges('\\titulo{x}\n', 'datos', { titulo: s });
    expect(parseDatos(out, 'datos').titulo).toBe(s);
  });

  it('reemplaza solo el argumento y conserva el comentario', () => {
    const out = applyChanges(DATOS, 'datos', { autor: 'Luis', fechaAnio: '2027' });
    expect(out).toContain('  \\autor  {Luis}');
    expect(out).toContain('\\fecha{Junio}{2027}  % mes y año');
    expect(out).toContain('%\\autor{Comentado}');
    expect(out).toContain('\\titulo{Un título   con {llaves} anidadas}   % comentario del título');
  });

  it('añade al final los comandos que faltan, bajo la marca', () => {
    const out = applyChanges(DATOS, 'datos', { cotutor: 'Dra. Y', licencia: 'cc-by' });
    expect(out).toMatch(/%% Añadido por Estudio TFG\n\\cotutor\{Dra\. Y\}\n\\licencia\{cc-by\}\n$/);
    // segunda vez: no duplica la marca
    const out2 = applyChanges(out, 'datos', { atribucion: 'no' });
    expect(out2.match(/Añadido por Estudio TFG/g)).toHaveLength(1);
    expect(parseDatos(out2, 'datos')).toMatchObject({ cotutor: 'Dra. Y', licencia: 'cc-by', atribucion: 'no' });
  });

  it('un comando comentado cuenta como ausente', () => {
    const out = applyChanges('% \\cotutor{viejo}\n', 'datos', { cotutor: 'Nuevo' });
    expect(out).toContain('% \\cotutor{viejo}');
    expect(parseDatos(out, 'datos').cotutor).toBe('Nuevo');
  });
});

describe('GET/PUT /api/memoria/datos', () => {
  beforeEach(() => boot({ 'datos.tex': DATOS, 'estilo/institucion.tex': INST }));

  it('GET devuelve valores y revisiones (sha256/16)', async () => {
    const b = await get();
    expect(b.datos.autor).toBe('Ana Pérez');
    expect(b.institucion.tamanoLetra).toBe('12pt');
    expect(b.rev.datos).toBe(rev(DATOS));
    expect(b.rev.institucion).toBe(rev(INST));
  });

  it('PUT guarda, hace copia en el historial y devuelve el estado nuevo', async () => {
    const b = await get();
    const res = await put({ datos: { autor: 'Luis & Co' }, institucion: { tamanoLetra: '11pt', margenInterior: '40mm' }, baseRev: b.rev });
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.datos.autor).toBe('Luis & Co');
    expect(r.institucion).toMatchObject({ tamanoLetra: '11pt', margenInterior: '40mm', margenExterior: '20mm' });
    expect(r.rev.datos).toBe(rev(await read('datos.tex')));
    expect(await read('datos.tex')).toContain('\\autor  {Luis \\& Co}');
    expect(await read('estilo/institucion.tex')).toContain('\\margenes{40mm}{20mm}{25mm}{25mm}');
    const hist = path.join(path.dirname(cfg.buildDir), 'history', 'memoria', 'datos.tex');
    expect(await fs.readdir(hist)).toHaveLength(1);
  });

  it('PUT sin cambios no toca el archivo ni crea copia', async () => {
    const b = await get();
    expect((await put({ datos: { autor: 'Ana Pérez' }, baseRev: b.rev })).statusCode).toBe(200);
    expect(await read('datos.tex')).toBe(DATOS);
  });

  it('409 con el estado actual si el baseRev no coincide; no escribe nada', async () => {
    const b = await get();
    await fs.writeFile(path.join(dir, 'memoria', 'datos.tex'), DATOS + '\\ciudad{Ciudad Real}\n');
    const res = await put({ datos: { autor: 'X' }, institucion: { escuela: 'ESI' }, baseRev: b.rev });
    expect(res.statusCode).toBe(409);
    const j = res.json();
    expect(j.error).toBeTruthy();
    expect(j.current.datos.ciudad).toBe('Ciudad Real');
    expect(await read('estilo/institucion.tex')).toBe(INST);
  });

  it('400 con field según el tipo de campo', async () => {
    const { rev: baseRev } = await get();
    const cases: [object, string][] = [
      [{ datos: { modo: 'otro' } }, 'modo'],
      [{ datos: { licencia: 'gpl' } }, 'licencia'],
      [{ datos: { atribucion: 'quizá' } }, 'atribucion'],
      [{ datos: { fechaAnio: '26' } }, 'fechaAnio'],
      [{ datos: { inventado: 'x' } }, 'inventado'],
      [{ datos: { titulo: 5 } }, 'titulo'],
      [{ institucion: { tipoTrabajo: 'máster' } }, 'tipoTrabajo'],
      [{ institucion: { margenSuperior: '3 metros' } }, 'margenSuperior'],
      [{ institucion: { margenSuperior: '35' } }, 'margenSuperior'],
      [{ institucion: { interlineado: '3' } }, 'interlineado'],
      [{ institucion: { logo: '../x.pdf' } }, 'logo'],
    ];
    for (const [body, field] of cases) {
      const res = await put({ ...body, baseRev });
      expect(res.statusCode, field).toBe(400);
      expect(res.json().field).toBe(field);
    }
    expect(await read('datos.tex')).toBe(DATOS);
    // Un archivo inválido no deja escrito el otro.
    const res = await put({ datos: { autor: 'Z' }, institucion: { tamanoLetra: '9pt' }, baseRev });
    expect(res.statusCode).toBe(400);
    expect(await read('datos.tex')).toBe(DATOS);
  });

  it('400 si falta el baseRev del archivo tocado', async () => {
    expect((await put({ datos: { autor: 'X' }, baseRev: {} })).statusCode).toBe(400);
  });

  it('requiere la misma autenticación que el resto de /api', async () => {
    const { app: a2 } = await buildApp({ ...cfg, authToken: 'secreto' }, { serveWeb: false });
    expect((await a2.inject({ url: '/api/memoria/datos' })).statusCode).toBe(401);
    expect((await a2.inject({ url: '/api/memoria/datos', headers: { authorization: 'Bearer secreto' } })).statusCode).toBe(200);
    await a2.close();
  });
});

describe('memoria sin institucion.tex', () => {
  beforeEach(() => boot({ 'datos.tex': DATOS }));

  it('GET: institución vacía y rev null', async () => {
    const b = await get();
    expect(b.rev.institucion).toBeNull();
    expect(b.institucion).toEqual({});
    expect(b.rev.datos).toBe(rev(DATOS));
  });

  it('400 al escribir campos de institución; los de datos siguen funcionando', async () => {
    const b = await get();
    const res = await put({ institucion: { universidad: 'X' }, baseRev: { institucion: 'x' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().field).toBe('universidad');
    expect((await put({ datos: { ciudad: 'Albacete' }, baseRev: b.rev })).statusCode).toBe(200);
  });

  it('el logo tampoco se puede subir', async () => {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(PNG)], { type: 'image/png' }), 'logo.png');
    const res = await app.inject({ method: 'POST', url: '/api/memoria/logo', ...(await multipart(fd)) });
    expect(res.statusCode).toBe(400);
  });
});

describe('logo', () => {
  beforeEach(() => boot({ 'datos.tex': DATOS, 'estilo/institucion.tex': INST }));
  const upload = async (bytes: Buffer, name: string, type = 'application/octet-stream') => {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(bytes)], { type }), name);
    return app.inject({ method: 'POST', url: '/api/memoria/logo', ...(await multipart(fd)) });
  };

  it('POST guarda estilo/logo.<ext>, fija \\logo y DELETE lo vacía', async () => {
    const res = await upload(PNG, 'mi logo.png', 'image/png');
    expect(res.statusCode).toBe(200);
    expect(res.json().institucion.logo).toBe('logo.png');
    expect(await fs.readFile(path.join(dir, 'memoria', 'estilo', 'logo.png'))).toEqual(PNG);
    expect(await read('estilo/institucion.tex')).toContain('\\logo{logo.png}');
    const del = await app.inject({ method: 'DELETE', url: '/api/memoria/logo' });
    expect(del.statusCode).toBe(200);
    expect(del.json().institucion.logo).toBe('');
    expect(await read('estilo/institucion.tex')).toContain('\\logo{}');
  });

  it('cambiar de extensión retira el logo anterior', async () => {
    await upload(PNG, 'a.png');
    const pdf = Buffer.from('%PDF-1.4\n%fake');
    expect((await upload(pdf, 'a.pdf', 'application/pdf')).statusCode).toBe(200);
    await expect(fs.access(path.join(dir, 'memoria', 'estilo', 'logo.png'))).rejects.toThrow();
    expect((await get()).institucion.logo).toBe('logo.pdf');
  });

  it('rechaza contenido que no es imagen/PDF, extensión incoherente y más de 5 MB', async () => {
    expect((await upload(Buffer.from('hola'), 'x.png')).statusCode).toBe(400);
    expect((await upload(PNG, 'x.pdf')).statusCode).toBe(400);
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    expect((await upload(big, 'big.png')).statusCode).toBe(413);
    expect(await read('estilo/institucion.tex')).toBe(INST);
  });
});
