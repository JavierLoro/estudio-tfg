import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUpdates } from './updater.mjs';

test('desarrollo no busca actualizaciones y permite reintentar después del aviso', async () => {
  const messages = [];
  let finish;
  const options = { app: { isPackaged: false }, dialog: { showMessageBox: async (_window, message) => {
    messages.push(message); await new Promise(resolve => { finish = resolve; });
  } } };
  const first = checkUpdates(options);
  await checkUpdates(options);
  assert.equal(messages.length, 1);
  assert.match(messages[0].detail, /app instalada/);
  finish(); await first;
  const retry = checkUpdates(options);
  assert.equal(messages.length, 2);
  finish(); await retry;
});

test('la actualización manual solo abre las descargas al elegirlas', async () => {
  const previous = process.env.PORTABLE_EXECUTABLE_DIR;
  process.env.PORTABLE_EXECUTABLE_DIR = '/portable-ficticia';
  try {
    const opened = [];
    for (const response of [1, 0]) await checkUpdates({ app: { isPackaged: true },
      dialog: { showMessageBox: async () => ({ response }) }, shell: { openExternal: async url => opened.push(url) } });
    assert.deepEqual(opened, ['https://github.com/JavierLoro/estudio-tfg/releases']);
  } finally {
    if (previous === undefined) delete process.env.PORTABLE_EXECUTABLE_DIR;
    else process.env.PORTABLE_EXECUTABLE_DIR = previous;
  }
});
