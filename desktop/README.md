# Desarrollo de escritorio

La base Electron abre la interfaz servida por Fastify en loopback. No necesita
`tsx` en ejecución. Desde la raíz del proyecto:

```sh
npm run install:all
npm install --prefix desktop
npm run build --prefix web
npm run bundle --prefix server
npm start --prefix desktop
```

En entornos npm que bloqueen el postinstall de Electron, ejecuta
`node desktop/node_modules/electron/install.js` después de instalarlo.

Los datos internos se guardan en la carpeta de la app por sistema (G1); Chromium
usa su subcarpeta `browser/`. Las carpetas se eligen desde Ajustes. Desarrollo
puede usar `DATA_DIR` temporal y rutas `NOTES_DIR`, `MEMORIA_DIR`, `ALLOWED_ROOTS`.
La app ignora `.env`; no abre automáticamente la memoria del checkout.

El motor inicial es local. Para probar un TeX privado ya preparado, proporciona
`TEX_BIN_DIR` absoluto, fuera de notas/memoria; no se cambia el PATH global ni se
mezclan herramientas TeX de otra instalación. Sin esa variable se conserva la
detección E2 del PATH. Ajustes puede seleccionar Docker o Automático. Los paquetes
TeX completos, aprovisionamiento e instaladores offline/online llegan en G4/G5.

La ventana usa un origen HTTP estable que reenvía al puerto libre del servidor;
así borradores, preferencias e IndexedDB sobreviven a los reinicios. Token nuevo
por arranque, cookie HttpOnly, renderer sin Node/preload, sandbox, CSP y navegación
confinada. Cerrar respeta el aviso de borradores y espera el cierre del servidor.

```sh
npm test --prefix desktop
E2E_DESKTOP=1 npm run test:e2e -- --grep '@desktop'
```

`E2E_TEX_BIN` activa la compilación real del fixture; `E2E_SYSTEM_FOCUS=1`
comprueba también el foco físico del sistema en una sesión gráfica que lo permita.
Las pruebas usan carpetas temporales y datos ficticios. Windows y los instaladores
se validarán en G5; esta entrega prueba la ejecución nativa en macOS.

El asistente aparece cuando faltan carpetas o está pendiente el paquete de la
release y se repite desde Ajustes. `engine-manifest.json` fija plataforma, versión,
URL, tamaño y hash; offline añade `engine.tar.gz` junto a ese manifiesto. Ambos
archivos los genera el empaquetado G5, no el usuario. Los fallos y cancelaciones
limpian staging sin tocar el motor anterior; las fuentes permanecen externas.
