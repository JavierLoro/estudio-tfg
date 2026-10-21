# Desarrollo de escritorio

La base Electron abre la interfaz servida por Fastify en loopback. No necesita
`tsx` en ejecución. Para probar cambios desde la raíz:

```sh
npm run install:all
npm install --prefix desktop
npm run desktop:dev
```

En entornos npm que bloqueen el postinstall de Electron, ejecuta
`node desktop/node_modules/electron/install.js` después de instalarlo.

El comando construye web/servidor y abre **Estudio TFG (desarrollo)**. Al guardar
código de la interfaz, reconstruye y solicita recarga; cambios del servidor,
Electron o helpers reinician la app. No genera instaladores ni publica releases.
Un error de compilación deja la ventana abierta y se reintenta al guardar código.
Recarga y reinicio respetan la confirmación de borradores: si cancelas un reinicio,
guarda tu trabajo y vuelve a guardar código para reintentarlo.

El original del logo se conserva en `logo.png` en la raíz. Los iconos de
`desktop/icons/` son variantes editadas con ImageGen: macOS usa `macos.png`, con
fondo blanco redondeado y margen transparente; Windows y Linux usan `windows.png`,
con las letras sin fondo. El empaquetado genera los formatos nativos desde esos
PNG. Sustituirlos con `desktop:dev` abierto reinicia la app para actualizarlos.

El perfil persistente está en `workspace/desktop-dev/`, ignorado por Git: `data/`
para ajustes/borradores/TeX, `Notas/` y `Memoria/` con contenido ficticio inicial,
y `web/` para la interfaz reconstruida. No sobrescribe esos documentos al volver
a arrancar. Desde Ajustes puedes seleccionar notas y memoria en otras carpetas
del equipo: esas selecciones se guardan solo en este perfil, pero los documentos
elegidos se leen y modifican en su ubicación real. Ignora `.env` y las rutas
heredadas de notas/memoria/datos/motor; no comparte el perfil instalado.
Ctrl+C solicita el cierre; cancelar el aviso de borradores mantiene el entorno.

El escritorio permite por defecto las carpetas accesibles del sistema: `/` en
macOS/Linux (incluidos volúmenes montados) y las unidades disponibles al arrancar
en Windows. Respeta `ALLOWED_ROOTS` si se proporciona explícitamente; también
permite habilitar ahí rutas de red sin letra de unidad. Reinicia la app tras montar
una unidad nueva en Windows. Los permisos del sistema siguen vigentes; no se
admiten datos internos de la app ni carpetas versionadas del repo como documentos.
La versión web self-hosted conserva sus límites de `ALLOWED_ROOTS`.

La primera ejecución obtiene y verifica el manifiesto TeX de la última estable
pública (requiere red). El asistente prepara ese motor una vez en `data/engines/`;
después arranques y recompilaciones lo reutilizan sin red, sin TeX/Perl/Docker del
sistema. No se consulta una versión nueva en cada arranque. Para cambiar el motor,
con la app cerrada elimina solo `workspace/desktop-dev/data/engine-manifest.json`;
el siguiente arranque fijará la última estable, conservando el motor anterior.
Cambiar plantillas afecta a memorias nuevas, no modifica la memoria de pruebas ya
creada. Si cambias el propio lanzador, vuelve a ejecutar el comando.

El arranque manual sigue disponible: `npm run build --prefix web`,
`npm run bundle --prefix server` y `npm start --prefix desktop`. Ese arranque utiliza
las rutas por sistema (o las variables explícitas) y no activa el vigilante ni el
perfil aislado de `desktop:dev`.

La web de pruebas conserva los chunks anteriores para no romper una ventana cuya
recarga se haya cancelado. Con la app cerrada puedes borrar únicamente
`workspace/desktop-dev/web/` si se acumulan builds; se regenera al arrancar.

Las ramas de trabajo parten de `develop` y sus PR se integran allí. El PR de
entrega `develop` → `main` publica el siguiente parche solo tras CI y las pruebas
nativas de distribución; las demás ramas no publican releases. Versión base,
saltos manuales y reintentos: [DISTRIBUCION.md](../docs/DISTRIBUCION.md#ramas-y-entregas-automáticas).

El motor inicial es local. Para probar un TeX privado ya preparado, proporciona
`TEX_BIN_DIR` absoluto, fuera de notas/memoria; no se cambia el PATH global ni se
mezclan herramientas TeX de otra instalación. Sin esa variable se conserva la
detección E2 del PATH. Ajustes puede seleccionar Docker o Automático. La receta de
paquetes e instaladores offline/online está en [DISTRIBUCION.md](../docs/DISTRIBUCION.md).

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
Las pruebas usan carpetas temporales y datos ficticios. El workflow de distribución
verifica los artefactos reales en runners Mac arm64/x64, Windows x64 y Linux x64.

El asistente aparece cuando faltan carpetas o está pendiente el paquete de la
release y se repite desde Ajustes. `engine-manifest.json` fija plataforma, versión,
URL, tamaño y hash; offline añade `engine.tar.gz` junto a ese manifiesto. Ambos
archivos los genera el empaquetado G5, no el usuario. Los fallos y cancelaciones
limpian staging sin tocar el motor anterior; las fuentes permanecen externas.

## Asistente con ChatGPT

El botón **Asistente** y la sección ChatGPT de Ajustes permiten conectar una cuenta
personal elegible. La integración usa OAuth y Responses directamente; no necesita
instalar Codex ni configurar una clave API. Elige fuentes por conversación y revisa
cada propuesta antes de guardar. Credenciales e historial se separan entre el perfil
instalado y el de desarrollo. Uso, límites y recuperación: [ASISTENTE.md](../docs/ASISTENTE.md).
