import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { setup, multipart, type TestEnv } from './helpers.ts';
import { libraryId } from '../src/libraryIdentity.ts';
import { instanceId } from '../src/settings.ts';
import { LIBRARY_MANIFEST } from '../src/libraryIntegration.ts';
import { sourceHash } from '../src/bibliography.ts';

let t: TestEnv;
beforeEach(async () => { t = await setup(); });
afterEach(async () => { await t.close(); });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGPwd3tKU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAE0y6EwonOyyAAAAAElFTkSuQmCC', 'base64');
const binding = () => ({ libraryId: libraryId(t.cfg), instanceId: instanceId(t.cfg) });
const mem = (p: string) => path.join(t.cfg.memoriaDir, p);
const apply = (p: any) => t.app.inject({ method: 'POST', url: '/api/library/integration/apply', payload: {
  ...binding(), operationId: p.operationId, revisions: p.files.map((f: any) => ({ path: f.path, baseRev: f.baseRev })),
} });

it('actualizar los bytes conserva la figura y el TeX, exige la revisión actual y guarda el archivo sustituido', async () => {
  const fd = new FormData();
  fd.set('libraryVersion', '1');
  fd.set('title', 'Imagen ficticia');
  fd.append('files', new Blob([png]), 'figura.png');
  const created = (await t.app.inject({ method: 'POST', url: '/api/capture', ...(await multipart(fd)) })).json();
  const file = (await t.app.inject(`/api/resources/file?path=${encodeURIComponent(created.path)}`)).json();
  const preview = (extra: any = {}) => t.app.inject({ method: 'POST', url: '/api/library/integration/preview', payload: {
    ...binding(), operationId: crypto.randomUUID(), resourceId: file.item.id, baseRev: file.rev,
    kind: 'figure', attachmentPath: file.attachments[0].path,
    caption: 'Pie personalizado', credit: 'Autor original', label: 'fig:original', width: 40, ...extra,
  } });
  const initial = (await preview()).json();
  expect((await apply(initial)).statusCode).toBe(200);
  await fs.appendFile(mem('tfg.tex'), '\n' + initial.result.snippet + '\n');
  const tex = await fs.readFile(mem('tfg.tex'));
  const original = JSON.parse(await fs.readFile(mem(LIBRARY_MANIFEST), 'utf8')).figures[0];
  const changed = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await fs.writeFile(path.join(t.cfg.notesDir, file.attachments[0].path), changed);
  const replacement = { replaceCopy: initial.result.figurePath, caption: 'Otro pie', credit: '', label: 'fig:predeterminada', width: 80 };
  const proposed = (await preview(replacement)).json();
  expect(proposed.result.snippet).toBe('');
  expect(proposed.files.map((f: any) => f.path).sort()).toEqual([initial.result.figurePath, LIBRARY_MANIFEST].sort());
  expect(JSON.parse(await fs.readFile(mem(LIBRARY_MANIFEST), 'utf8')).figures[0]).toEqual(original);
  const external = Buffer.concat([png, Buffer.from('Edición externa ficticia')]);
  await fs.writeFile(mem(initial.result.figurePath), external);
  expect((await apply(proposed)).statusCode).toBe(409);
  expect(await fs.readFile(mem(initial.result.figurePath))).toEqual(external);
  expect(JSON.parse(await fs.readFile(mem(LIBRARY_MANIFEST), 'utf8')).figures[0]).toEqual(original);
  const reviewed = (await preview(replacement)).json();
  expect(reviewed.warnings).toHaveLength(1);
  expect((await apply(reviewed)).statusCode).toBe(200);
  expect((await apply(reviewed)).statusCode).toBe(200);
  expect(await fs.readFile(mem(initial.result.figurePath))).toEqual(changed);
  expect(await fs.readFile(mem('tfg.tex'))).toEqual(tex);
  expect(JSON.parse(await fs.readFile(mem(LIBRARY_MANIFEST), 'utf8')).figures).toEqual([{ ...original, hash: sourceHash(changed) }]);
  const history = path.join(t.cfg.historyDir, 'memoria', initial.result.figurePath);
  const backups = await fs.readdir(history);
  expect(backups).toHaveLength(1);
  expect(await fs.readFile(path.join(history, backups[0]))).toEqual(external);
});
