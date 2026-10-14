import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let checking = false, listening = false;

export async function checkUpdates({ app, dialog, shell, window, variant }) {
  if (checking) return;
  checking = true;
  const releases = 'https://github.com/JavierLoro/estudio-tfg/releases';
  try {
    if (!app.isPackaged) throw new Error('Las actualizaciones se comprueban desde la app instalada');
    if (process.platform === 'darwin' || process.env.PORTABLE_EXECUTABLE_DIR) {
      const choice = await dialog.showMessageBox(window, { type: 'info', title: 'Actualizaciones',
        message: process.platform === 'darwin' ? 'Esta versión de prueba no está firmada. Las actualizaciones automáticas de macOS se habilitarán con la firma.' : 'La versión portable se actualiza descargando la nueva app.',
        buttons: ['Ver descargas', 'Cerrar'], cancelId: 1 });
      if (choice.response === 0) await shell.openExternal(releases);
      return;
    }
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.channel = variant;
    if (!listening) { autoUpdater.on('error', error => console.error('No se pudo actualizar:', error.message)); listening = true; }
    const update = await autoUpdater.checkForUpdates();
    if (!update?.isUpdateAvailable) {
      await dialog.showMessageBox(window, { type: 'info', title: 'Actualizaciones', message: 'No hay una versión nueva disponible.' });
      return;
    }
    const choice = await dialog.showMessageBox(window, { type: 'question', title: 'Actualizar Estudio TFG',
      message: `Está disponible la versión ${update.updateInfo.version}.`, detail: 'La memoria y las notas se conservan. El motor TeX de la nueva release se preparará completo antes de activarlo.',
      buttons: ['Descargar', 'Más tarde'], cancelId: 1 });
    if (choice.response !== 0) return;
    await autoUpdater.downloadUpdate();
    const install = await dialog.showMessageBox(window, { type: 'question', title: 'Actualización descargada',
      message: 'Guarda tus cambios antes de salir para actualizar.', buttons: ['Salir y actualizar', 'Más tarde'], cancelId: 1 });
    if (install.response === 0) { autoUpdater.autoInstallOnAppQuit = true; app.quit(); }
  } catch (error) {
    await dialog.showMessageBox(window, { type: 'error', title: 'Actualizaciones', message: 'No se pudo comprobar o descargar la actualización.', detail: error.message });
  } finally { checking = false; }
}
