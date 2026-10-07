# Plataformas: plan de adaptación a Windows (y diferencias en Linux)

Estado: **análisis, sin implementar**. Estudio TFG se desarrolla y prueba solo en macOS. Este documento reúne lo que habría que cambiar para que funcione en Windows (y lo que difiere en Linux): dónde está cada problema, qué se rompe, su gravedad, la propuesta de arreglo y el esfuerzo.

- Revisado sobre `73acc85` (rama `main`). Los números de línea pueden moverse un poco, sobre todo en `web/`, que se está editando en paralelo.
- Gravedad: **bloqueante** (no arranca o una función principal no se puede usar), **importante** (fallos o pérdida de trabajo en situaciones habituales de Windows), **menor** (cosmético, casos raros o solo documentación).
- Esfuerzo: **S** (< 1 h, local), **M** (unas horas, varios archivos o un cambio en el contrato), **L** (más de un día).
- «A verificar» indica un comportamiento de Windows que no se ha podido reproducir desde macOS; la sección 5 explica cómo comprobarlo.

---

## 1. Resumen y recomendación

### Qué pasa hoy en Windows

El servidor ya está escrito con bastante cuidado para ser portable: las rutas relativas viajan siempre con `/`, `isInside` usa `path.relative` (que en `path.win32` no distingue mayúsculas y rechaza otra unidad), `toPosix` convierte los eventos de chokidar, varios parsers aceptan `\r\n`, el tar del worker se genera con `portable: true` y el worker corre siempre en Linux dentro de Docker. Los problemas se concentran en unos pocos puntos:

1. **`npm run dev` no arranca bien**: npm ejecuta los scripts con `cmd.exe`, donde `a & b` ejecuta uno después del otro. Como `tsx watch` no termina, la web nunca llega a arrancar. `npm start` falla por la variable `NODE_ENV=…` puesta en línea.
2. **`ALLOWED_ROOTS` se separa con `:`**, así que cualquier ruta con letra de unidad (`D:\Datos`) se rompe. Sin esa variable, la raíz por defecto (el home) sí funciona. Los tests también la usan con la carpeta temporal (`C:\…`), así que fallarían en un CI de Windows.
3. **La interfaz de Ajustes da por hecho que las rutas absolutas son POSIX** (empiezan por `/` o `~`). Con rutas `C:\…` el selector de carpetas no muestra bien las migas ni la carpeta inicial, y el selector de la subcarpeta de recursos no llega a funcionar.
4. **Finales de línea**: Git para Windows instala por defecto `core.autocrlf=true` y el repo no tiene `.gitattributes`. La plantilla se descarga con CRLF, sus hashes dejan de coincidir con los del manifiesto y la actualización de la plantilla toma todos los archivos como «modificados por ti». Además, el editor convierte a LF cualquier archivo CRLF que se guarde.
5. **Semántica de archivos en Windows**: `rename` y `unlink` fallan con `EPERM`/`EBUSY` si otro programa (antivirus, indexador, OneDrive, Word) tiene el archivo abierto. Mover un archivo con `link` y luego `unlink` puede dejarlo duplicado. Los enlaces duros no existen en FAT/exFAT ni en muchas unidades de red. El watcher no recibe eventos desde WSL ni desde montajes de Docker.
6. **Atajos**: algunos textos tienen `⌥`/`⌘` escritos a mano, y `Ctrl+Mayús+J` / `Ctrl+Mayús+C` chocan con las DevTools de Chrome, Edge y Firefox (a verificar).

Ninguno exige rediseñar nada. Con la fase 1 del plan (sección 4, unas horas de trabajo) Windows nativo quedaría usable. La fase 2 lo hace robusto frente a OneDrive, antivirus y unidades de red.

### Comparativa: Windows nativo, WSL2 o solo Docker

| | **Windows nativo** (server y web con Node en Windows, worker en Docker Desktop) | **WSL2 completo** (repo, memoria y vault en el disco de Linux `~/…`) | **WSL2 con el vault en Windows** (`/mnt/c/…`) | **Solo Docker** (`docker compose --profile app`, montando carpetas de Windows) |
| --- | --- | --- | --- | --- |
| Scripts npm | Fallan `dev` y `start` hasta la fase 1 (hay alternativa: dos terminales) | Funcionan igual que en Linux | Funcionan | No hacen falta |
| Obsidian (en Windows) sobre el vault | Directo, sin problemas | A través de `\\wsl.localhost\…`: lento; Obsidian no vigila bien rutas de red | Directo | Directo |
| Cambios externos en vivo (watcher) | Sí (ReadDirectoryChangesW) | Sí dentro de WSL; los cambios de Obsidian llegan por 9P, sin garantía | **No**: inotify no ve los cambios hechos desde Windows en `/mnt/c` (hace falta polling) | **No**: los montajes de Windows no propagan eventos al contenedor (hace falta polling) |
| Rendimiento (árbol, búsqueda, tar de compilación) | Bueno (Defender lo ralentiza algo) | Muy bueno | Lento (9P) | Lento (montaje de Windows en la VM) |
| Rutas en Ajustes | `C:\…`: necesita la fase 1 (P2) | POSIX: ya funciona | POSIX (`/mnt/c/…`): ya funciona | Solo `/data/…` |
| git en la memoria | Git para Windows; cuidado con `autocrlf` | git de Linux | git de Linux sobre NTFS (lento; propietarios raros) | Falla «dubious ownership» (los archivos aparecen como de root) |
| Pérdida de datos | Protegida por `baseRev`/409; riesgos F1–F3 | Igual que macOS/Linux | Protegida por `baseRev`, pero sin avisos en vivo | Protegida por `baseRev`, pero sin avisos en vivo |
| Para quién | **Objetivo recomendado** a medio plazo: el estudiante típico con Obsidian en Windows | Usuarios avanzados que ya trabajan en WSL y pueden tener el vault allí | No recomendado | Despliegue «tipo servidor»; no recomendado como escritorio en Windows |

**Recomendación.** El objetivo es que Windows nativo funcione como plataforma de primera (fases 1 y 2), con el worker en Docker Desktop (backend WSL2) igual que ahora. El vault y Obsidian están en Windows, y solo en nativo el watcher ve sus cambios sin polling. WSL2 queda documentado como alternativa para quien tenga todo dentro del disco de Linux. El modo «solo Docker» en Windows necesita polling (D2) y `safe.directory` (G2) antes de poder recomendarse.

### Qué puede hacer hoy un estudiante en Windows (sin cambios de código)

1. Instalar Node 24, Git para Windows y Docker Desktop (con el backend WSL2 y unos 10 GB libres para la imagen de TeX Live).
2. Clonar **sin conversión de finales de línea**: `git clone -c core.autocrlf=false https://github.com/JavierLoro/estudio-tfg.git` (o `git config --global core.autocrlf input` antes de clonar).
3. `npm run init`, `npm run install:all` y `npm run worker`.
4. En lugar de `npm run dev`, abrir **dos terminales**: `npm run dev --prefix server` y `npm run dev --prefix web`. No usar `npm start`.
5. Tener el vault y la memoria **dentro de `C:\Users\<usuario>`** y **no definir `ALLOWED_ROOTS`**. Mejor fuera de OneDrive, Dropbox o Google Drive (ver F1–F4).
6. En Ajustes, **escribir las rutas en los campos** (`C:\Users\Ana\Documents\Vault`) en vez de usar el selector, o ponerlas en `.env`.
7. Los atajos son con `Ctrl` en lugar de `⌘` (`Ctrl+K`, `Ctrl+S`, `Ctrl+Intro`…), y «abrir al lado» es `Alt+clic`.

---

## 2. Tabla de hallazgos

| Id | Área | Severidad | Dónde | Problema | Propuesta | Esf. |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | Scripts | **bloqueante** | `package.json:8` | `dev` usa `&`: en `cmd.exe` (el shell de npm en Windows) ejecuta en serie y la web no arranca | `scripts/dev.mjs` sin dependencias que lance tsx y vite con `process.execPath` | S |
| S2 | Scripts | importante | `server/package.json:10` | `NODE_ENV=production tsx …` no es válido en `cmd.exe` | Quitar `NODE_ENV` (el código no lo usa) o fijarlo desde un script Node | S |
| S3 | Docs | menor | `worker/README.md:22-45`, `README.md`, `AGENTS.md` | Comandos solo para sh: `( cd … && … )`, `COPYFILE_DISABLE`, `$PWD`, `/tmp`; `curl` es un alias de `Invoke-WebRequest` en PowerShell 5.1 | Equivalentes en PowerShell o un `scripts/compile-template.mjs` | S |
| S4 | Scripts | menor | `.claude/launch.json` | `runtimeExecutable: "npm"`: en Windows es `npm.cmd` y Node ≥ 20.12 no lanza `.cmd` sin shell | Usar `node scripts/dev.mjs` o documentarlo | S |
| P1 | Rutas | **bloqueante** (si se usa) | `server/src/config.ts:91-92`, `.env.example:9-11`, `docs/CONTRACT.md:137`, `server/test/helpers.ts:35` | `ALLOWED_ROOTS.split(':')` rompe `C:\…` | Separar con `path.delimiter` (`;` en Windows, `:` en POSIX) | S |
| P2 | Rutas/UI | importante | `web/src/panels/SettingsPanel.tsx:61,220-224,242`, `web/src/components/DirPicker.tsx:16-33,107` | Rutas absolutas solo POSIX: `isAbs`, `joinAbs`, migas y `relToNotes` usan `/` | Helper de rutas absolutas con estilo (posix/win) y `sep` en la respuesta de ajustes | M |
| P3 | Rutas | importante | `server/src/paths.ts:22-32` (`normalizeRel`), creación y movimiento en `fileops.ts`, `routes/files.ts` | Se aceptan `:` (flujos ADS de NTFS: `nota.md:x`), `<>"\|?*`, punto o espacio al final y nombres reservados (`CON`, `aux.tex`…). Node usa rutas `\\?\` y llega a crearlos | Validar cada segmento de los nombres nuevos (en todas las plataformas) y rechazar `:` siempre en win32 | S-M |
| P4 | Rutas | menor | `server/src/capture.ts:34-45` | `sanitizeTitle` puede generar `CON.md`, `NUL.md`… | Añadir sufijo a los nombres reservados | S |
| P5 | Rutas | importante (a verificar) | `config.ts:51-63` (`realpathSync`), `routes/settings.ts:51,75`, `paths.ts:41,69` | Se mezclan `realpathSync` (implementación JS: no resuelve unidades `subst`/de red ni normaliza mayúsculas) y `fs.realpath` nativo, y se compara con `includes` | Usar `fs.realpathSync.native` en todas partes y comparar con `isInside` | S |
| P6 | Rutas | menor | `config.ts:35-40`, `settings.ts:49-55`, `scripts/init.mjs:45` | No se expande `~\` | Aceptar `~/` y `~\` | S |
| P7 | Rutas | menor | `settings.ts:84-86` (`instanceId`) | El hash cambia con `c:` frente a `C:` o con separadores distintos, y los borradores no se recuperan | Hashear la ruta canónica (realpath nativo) | S |
| P8 | Rutas | menor | `notes.ts:35-79`, `links.ts:115-151`, `search.ts`, `QuickOpen.tsx` | NFC/NFD: NTFS y ext4 no normalizan los nombres; un `[[Diagnóstico]]` en NFC no encuentra un archivo con nombre en NFD | Comparar con `.normalize('NFC')` en ambos lados y conservar el nombre del disco | S-M |
| P9 | Rutas | menor | `fsutil.ts:93` (historial), `fileops.ts:228` (`.trash`), git | MAX_PATH: Node lo soporta, pero git (`core.longpaths=false`), el Explorador y otros programas no | `-c core.longpaths=true` en git y documentarlo | S |
| P10 | Rutas | menor | `server/src/outline.ts:686` | `path.isAbsolute('/tmp/build-…')` con rutas del worker (Linux) se interpreta como `win32` | Usar `path.posix` para las rutas del worker | S |
| F1 | Archivos | importante | `server/src/fsutil.ts:42` (`atomicWrite`) | `rename` sobre un archivo abierto por otro proceso da `EPERM`/`EACCES`/`EBUSY` (Defender, indexador, OneDrive, Word): el guardado da 500 | Reintentos con espera (≈2 s) en win32 y un error en español «en uso por otro programa» | S |
| F2 | Archivos | importante | `server/src/fileops.ts:76-78` (`moveEntry`) | `link` funciona y luego `unlink` falla (origen abierto): el archivo queda **duplicado** | Si falla `unlink`, deshacer el `link` (borrar el destino) y reintentar o devolver 409 | S |
| F3 | Archivos | importante (a verificar) | `fsutil.ts:54-83` (`createExclusive`, `linkExclusive`), `fileops.ts:64` (`NO_LINK`) | Sin enlaces duros (FAT/exFAT, SMB, Google Drive) no se pueden crear archivos, capturar, crear secciones ni hacer copias; `libuv` da códigos como `EISDIR`, `EINVAL` o `ENOTSUP` que `NO_LINK` no recoge | Alternativa `open(abs,'wx')` + escribir + `fsync`, ampliar `NO_LINK` y detectarlo una vez por carpeta | M |
| F4 | Watcher | importante (a verificar) | `server/src/events.ts:58-67` | chokidar en Windows: los handles de directorio pueden impedir renombrar o borrar carpetas vigiladas (`EPERM`); en SMB, `/mnt/c` (WSL) y montajes de Docker no llegan eventos | Opción `WATCH_POLLING`, automática en UNC, `/mnt/*` y Docker; reintentos al renombrar carpetas; valorar `fs.watch(root,{recursive:true})` en win32 | M |
| F5 | Watcher | menor | `server/src/events.ts:78` | `on('error', () => {})` oculta `ENOSPC` (Linux) y `EPERM` (Windows) | Registrar el error en el log y en `/api/status` | S |
| F6 | Archivos | menor | `fsutil.ts:30-35` | Se copia el modo del archivo: en Windows `0o444` es el atributo «solo lectura», y `rename` sobre un archivo de solo lectura falla | Mensaje claro y no propagar `0o444` en win32 | S |
| F7 | Archivos | menor | `server/src/ignore.ts:16-29`, `templates/base/.gitignore`, `scripts/memoria-template.mjs:25-28` | `desktop.ini` y `Thumbs.db` aparecen en el árbol, la búsqueda y el tar, y hacen que `isEmptyDir` dé falso; `.trash` y `*.tmp` no quedan ocultos en el Explorador | Ignorarlos y añadirlos al `.gitignore` de la plantilla | S |
| F8 | Archivos | menor | `server/src/fileops.ts:138` | `ino` en Windows es un índice de 64 bits que pierde precisión en `Number` | `fs.stat(..., { bigint: true })` | S |
| F9 | Archivos | menor | `server/src/fileops.ts:90` | Al renombrar una carpeta sobre otra que existe, Windows devuelve `EPERM`, no `ENOTEMPTY`, y el usuario ve un 500 | Tratar `EPERM` con destino existente como 409 | S |
| E1 | EOL | importante | No hay `.gitattributes`; `templates/manifiestos/v0.5.json`, `scripts/memoria-template.mjs:109-211`, `server/src/plantilla.ts:300-316` | Con `autocrlf=true` la plantilla llega con CRLF: los hashes no coinciden con el manifiesto, `template:manifest --check` y los tests fallan, y las memorias creadas en Windows no reciben actualizaciones automáticas | `.gitattributes` con `* text=auto eol=lf` y binarios marcados; hash de manifiesto con CRLF→LF normalizado | S (+M) |
| E2 | EOL | importante | `web/src/components/CodeEditor.tsx:83-85,131-144` | CodeMirror lee CRLF y escribe LF: guardar convierte el archivo entero, la sincronización externa sustituye el documento entero en cada recarga y deshacer nunca vuelve a «limpio» | Detectar el EOL de cada documento y usar `EditorState.lineSeparator` | S-M |
| E3 | EOL | menor | `server/src/datos.ts:256-258`, `plantilla.ts:148-156,327-332` | Se añade `\n` en archivos CRLF (finales mezclados); `withTemplateComments` no reconoce las líneas que terminan en `\r` | Usar `eolOf` (ya existe en `sections.ts:45`) | S |
| G1 | git | importante | `scripts/memoria-template.mjs:86-104` | Sin git en el PATH se copia la plantilla y después falla `git init` (`ENOENT`): error 500 y carpeta llena («no vacía» al reintentar) | Comprobar `git --version` antes, o crear la memoria sin repositorio y avisar | S |
| G2 | git | menor (importante en Docker) | `server/src/plantilla.ts:366-374`, `Dockerfile` | «dubious ownership» (`safe.directory`) en unidades FAT o de red, carpetas creadas por el administrador y montajes de Docker en Windows: `isGitRepo` da falso y las actualizaciones no hacen commit | `git config --system --add safe.directory '*'` en la imagen de la app; mostrar el stderr de git en las comprobaciones | S |
| G3 | git | menor | `plantilla.ts:348-363`, `memoria-template.mjs:94` | Rutas largas en git de Windows | `-c core.longpaths=true` en win32 | S |
| D1 | Docker | menor | `README.md`, `worker/README.md` | No se documentan los requisitos de Docker Desktop (WSL2, virtualización, imagen de 9,2 GB, memoria de WSL) | Sección de Windows en el README | S |
| D2 | Docker | importante (modo solo Docker) | `docker-compose.yml:47-65`, `server/src/events.ts` | Montajes de Windows en el contenedor: sin eventos, lentos, propietario root (rompe git) | Polling configurable (F4), `safe.directory` (G2), documentar | M |
| D3 | Docker (Linux) | importante | `docker-compose.yml:31`, `worker/Dockerfile:41-46` | `./data/builds` lo crea Docker como root si no existe, y si el uid del host no es 1000 el worker no puede escribir (`EACCES`) | Crear `data/builds` en `init` y `worker`; documentar `chown`; opcionalmente `user:` en compose | S |
| D4 | Docker | menor | `worker/server.mjs:110-118` | En Windows, `pruneBuilds` puede no poder borrar un PDF abierto en el host (el error ya se registra) | Nada; documentarlo | — |
| D5 | Red | menor | `config.ts:118`, `.env.example:7`, `web/vite.config.ts:5` | `localhost` puede resolverse primero a `::1` y el worker solo escucha en `127.0.0.1` (funciona gracias a *happy eyeballs*) | Usar `127.0.0.1` por defecto | S |
| D6 | Docker | menor | `worker/Dockerfile`, `*.mjs`, `*.conf` | Copias con CRLF dentro de las imágenes (hoy no hay scripts sh, así que no rompe nada) | Lo cubre E1 (`eol=lf`) | — |
| U1 | UI | importante | `SearchView.tsx:103`, `Markdown.tsx:238`, `HomePanel.tsx:164`, `SettingsPanel.tsx:290`, `CaptureModal.tsx:99`, `PdfViewer.tsx:410`, `README.md` | `⌥`, `⌘`, `⇧` y `↵` escritos a mano; `MOD` da «Ctrl+⇧C» (mezclado) | Helper `kbd('Mod-Shift-C')` → «⌘⇧C» o «Ctrl+Mayús+C» | S |
| U2 | UI | importante (a verificar) | `CodeEditor.tsx:91` (`Mod-Shift-j`), `App.tsx:76` (`Ctrl+Shift+C`), `NotePanel.tsx:40` (`Ctrl+E`), `App.tsx:73` (`Ctrl+K`), `App.tsx:85` (`Ctrl+B`) | En Chrome, Edge y Firefox de Windows/Linux: `Ctrl+Mayús+J` abre la consola y `Ctrl+Mayús+C` el inspector; `Ctrl+E`/`Ctrl+K` son la búsqueda de la barra y `Ctrl+B` los marcadores en Firefox | Probarlo; si el navegador gana, usar otros atajos fuera de Mac (p. ej. `Ctrl+Alt+J`, `Ctrl+Alt+N`) | S |
| U3 | UI | menor | `e.altKey` en `FileTree`, `SearchView`, `Markdown`, `OutlineTree`, `QuickOpen`, `PdfViewer` | `Alt+clic`: en Linux (KDE, Xfce, Cinnamon) lo captura el gestor de ventanas; en Windows `Alt` solo activa el menú de Firefox | Alternativa: `Ctrl+Mayús+clic`, clic central u opción del menú contextual | S |
| U4 | UI | menor | `web/src/index.css:98-99` | Las fuentes ya incluyen Segoe UI y Consolas; los diagramas usan Source Sans incluida | Sin cambios | — |
| L1 | Ajustes | importante | `server/src/routes/settings.ts:40-77` | En Windows: solo la raíz home (otras unidades necesitan P1); se ven carpetas del sistema y ocultas (`AppData`, `$Recycle.Bin`, `System Volume Information`); los nombres con punto no son «ocultos» | Lista de exclusión en win32 y raíces por defecto = home y unidades opcionales | S |
| L2 | Ajustes | menor | Documentación | OneDrive (Known Folder Move): `Documentos` está en OneDrive; *Files On-Demand* descarga el vault entero al buscar o recorrerlo; aplican F1–F4 | Recomendar carpetas fuera de OneDrive o marcarlas como «siempre en este dispositivo» | S |
| T1 | Tests | **bloqueante** (CI de Windows) | `server/test/helpers.ts:35` | `ALLOWED_ROOTS: dir` con `C:\…` (P1) | Se arregla con P1 | — |
| T2 | Tests | importante | `compile.test.ts:188-189`, `traversal.test.ts:42-43,63`, `settings.test.ts:136` | `fs.symlink` en Windows necesita privilegio (administrador o modo desarrollador) | Helper `canSymlink()` y `it.skipIf`; usar `'junction'` para carpetas | S |
| T3 | Tests | importante | Tests de plantilla y manifiesto, fixtures | CRLF por `autocrlf` (el runner `windows-latest` lo tiene activado) | Se arregla con E1 | — |
| T4 | Tests | menor | `server/test/helpers.ts:52` | `fs.rm(dir)` del teardown puede dar `EBUSY` con handles abiertos | `{ maxRetries: 5, retryDelay: 100 }` | S |
| T5 | Tests | menor | `settings.test.ts:445-475`, `auth-events.test.ts:53-60` | Tests del watcher sensibles a la latencia (Defender) | Mantener los márgenes y vigilarlos en CI | — |
| T6 | CI | importante | No existe `.github/workflows` | No hay CI en ninguna plataforma | Workflow con matriz ubuntu/macos/windows (sección 4, fase 3) | M |

---

## 3. Detalle por área

### 3.1 Scripts npm y shell

**S1 — `npm run dev` (bloqueante).** `package.json:8`: `npm run dev --prefix server & npm run dev --prefix web`. En Windows, npm usa `cmd.exe` como `script-shell` aunque se lance desde PowerShell o Git Bash. En `cmd`, `&` encadena comandos de forma **secuencial**: arranca `tsx watch` y la web no llega nunca. En macOS y Linux funciona porque `sh` lo manda al fondo, aunque tampoco es ideal: un fallo de uno de los dos procesos no detiene el otro.

Alternativas:

| Opción | Pros | Contras |
| --- | --- | --- |
| `concurrently` (devDependency en la raíz) | Probado; prefijos de color; `--kill-others` | La raíz pasa a necesitar `npm install` y una dependencia más (AGENTS.md pide evitarlo) |
| `npm-run-all2` | Igual | Igual |
| **`scripts/dev.mjs`** (recomendado) | Sin dependencias; control total | Unas 40 líneas que mantener |

El script debería:

- Lanzar `process.execPath` con `server/node_modules/tsx/dist/cli.mjs watch src/index.ts` (cwd `server/`) y `web/node_modules/vite/bin/vite.js` (cwd `web/`). Así se evita `npm.cmd`, que desde Node 18.20.2/20.12.2 no se puede lanzar sin `shell: true` (corrección de CVE-2024-27980).
- Poner un prefijo `[api]`/`[web]` en cada línea.
- Al recibir `SIGINT` o `SIGTERM`, o si uno de los dos termina, cerrar el otro. En Windows `child.kill()` es `TerminateProcess` y no mata a los nietos: tsx watch crea un hijo, así que hay que usar `taskkill /pid <pid> /T /F`.
- Comprobar antes que existan `server/node_modules` y `web/node_modules`, y si no, sugerir `npm run install:all`.

**S2 — `npm start`.** `server/package.json:10`: `NODE_ENV=production tsx src/index.ts`. En `cmd` da «"NODE_ENV" no se reconoce como un comando…». `rg NODE_ENV server/src` no encuentra nada: el servidor no lo usa (Fastify tampoco depende de él). Basta con quitarlo. Si se quiere conservar, se puede fijar en `index.ts` (`process.env.NODE_ENV ??= …`) o con `cross-env` (otra dependencia, no recomendado).

**S3 — Documentación sh.** `worker/README.md:22-45` usa `( cd /tmp/memoria && COPYFILE_DISABLE=1 tar -cf - * ) | curl …`, `-v "$PWD/data/builds:/out"` y `/tmp/memoria`. En PowerShell 5.1, `curl` es un alias de `Invoke-WebRequest` (hay que usar `curl.exe`), no existe `/tmp` y `$PWD` se escribe `${PWD}`. Propuesta: un script `node scripts/compile-template.mjs [--perfil x]` que copie la plantilla a un temporal, haga el tar con `tar` (ya es dependencia del server) y lo envíe con `fetch`. Así funciona igual en las tres plataformas y además sirve para comprobar los «0 avisos» de AGENTS.md.

**S4 — `.claude/launch.json`.** `runtimeExecutable: "npm"`: en Windows el ejecutable es `npm.cmd`. Con S1 resuelto, se puede apuntar a `node scripts/dev.mjs`.

Lo que ya funciona: `install:all` y `build` usan `&&` (válido en cmd); `node --test worker/*.test.mjs` funciona porque Node ≥ 21 expande el glob por sí mismo; `npm run worker` es `docker compose …` y vale en todas las plataformas; `scripts/init.mjs` lee `.env` con `trim()`, que quita los `\r`.

### 3.2 Rutas

Comprobaciones con `path.win32` (Node 24, desde macOS):

```text
win32.relative('C:\Users\Ana', 'c:\users\ana\Docs')   → 'Docs'        (no distingue mayúsculas: isInside correcto)
win32.relative('C:\a', 'D:\b')                         → 'D:\b'        (absoluta: isInside = false, correcto)
win32.isAbsolute('/tmp/x')                             → true          (raíz de la unidad actual)
win32.resolve('\\srv\share\x')                         → '\\srv\share\x' (UNC)
'C:\Users\Ana:D:\Datos'.split(':')                     → ['C', '\Users\Ana', 'D', '\Datos']   ← P1
win32.join('C:\r', 'notas', 'x.md:secreto')            → 'C:\r\notas\x.md:secreto'            ← P3 (flujo ADS)
win32.resolve('C:\Users\Ana/Nueva')                    → 'C:\Users\Ana\Nueva'  (el servidor tolera rutas mezcladas)
```

- **`isInside` (`paths.ts:34-37`)** funciona en win32: distingue entre unidades, no distingue mayúsculas y admite UNC. **`normalizeRel`** ya rechaza `\` y `X:` al principio, y **`toPosix`** usa `path.sep`. **`resolveSafe`** sigue enlaces con `fs.realpath` nativo (en Windows, `GetFinalPathNameByHandleW`), así que las *junctions* y los enlaces simbólicos que salen de la raíz se rechazan igual que en macOS.
- **P1 — `ALLOWED_ROOTS`.** Hay que usar `path.delimiter` (`;` en Windows, como `PATH`). En POSIX el comportamiento no cambia. Hay que actualizar `.env.example` (ejemplo para cada sistema), `docs/CONTRACT.md:137` (versionado) y el comentario de `config.ts:90`. Sin `ALLOWED_ROOTS` funciona, porque la raíz por defecto es `os.homedir()`. Un apaño de hoy: `ALLOWED_ROOTS=\Datos` se resuelve como `C:\Datos` (unidad del repo), pero no sirve para otras unidades.
- **P2 — Interfaz con rutas absolutas POSIX.**
  - `SettingsPanel.tsx:61`: `isAbs = startsWith('/') || startsWith('~')`. Con `C:\…`, el botón de la subcarpeta de recursos queda deshabilitado («Define antes la carpeta de notas») y la carpeta inicial de «Crear memoria» no se calcula (`:242`, que además quita el último segmento con una expresión regular de `/`).
  - `SettingsPanel.tsx:220-224`: `relToNotes` compara con `base + '/'`; como el servidor devuelve `C:\…\Recursos`, la validación siempre falla («Elige una subcarpeta de la carpeta de notas»). Aunque se arreglara, el resultado llevaría `\`, que `normalizeRelative` rechaza.
  - `DirPicker.tsx:16-33`: `joinAbs` añade `/`, que el servidor tolera, pero `crumbsFor` no encuentra la raíz (`r + '/'`) y crea una única miga `'/' + 'C:\Users\…'`. En `:107`, la carpeta inicial solo se usa si empieza por `/` o `~`.
  - Propuesta: `web/src/lib/abspath.ts` con `isAbsPath` (`/^(\/|~|[A-Za-z]:[\\/]|\\\\)/`), `splitAbs` (separa por `[\\/]` conservando `C:\` o `\\srv\share\` como raíz), `joinAbs(dir, name, sep)` y `relUnder(base, p)` que devuelva siempre `/`. El separador conviene que lo diga el servidor (`GET /api/settings` → `pathSep: '\\' | '/'`, campo nuevo en el contrato) en lugar de deducirlo del navegador: con WSL o Docker, el navegador está en Windows y las rutas son POSIX.
- **P3 — Nombres válidos en Windows.** Desde la API se pueden crear (con `PUT /api/file`, `POST /api/dir`, `/api/move`):
  - `nota.md:x`: escribe un **flujo de datos alternativo** NTFS dentro de `nota.md`. Los datos quedan ocultos para el Explorador, Obsidian y git, aunque no salen de la raíz.
  - `nota.` o `nota ` (punto o espacio al final): Node usa rutas `\\?\` (`toNamespacedPath`), así que el archivo se crea con ese nombre literal y el Explorador no puede abrirlo ni borrarlo.
  - `CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9` (también con extensión, p. ej. `aux.tex`, y con `¹²³`): con `\\?\` se crean, pero Explorer, git y Obsidian no los manejan.
  - `<>:"|?*` y caracteres de control.
  - Propuesta: `validSegment(name)` en `paths.ts`, aplicada a los **nombres nuevos** (crear, mover o renombrar destino, subir, capturar, secciones, diagramas) **en todas las plataformas**. El vault se comparte entre equipos y Obsidian ya prohíbe `* " \ / < > : | ?`. Además, en win32, rechazar `:` en cualquier ruta (también al leer). Los nombres que ya existan con esos caracteres (en macOS) se siguen pudiendo leer y renombrar. Hay que añadirlo al contrato.
- **P5 — realpath.** `realpathLoose` (`config.ts:51-63`) usa `fs.realpathSync`, que en Node es una implementación JS: no resuelve unidades de red ni `subst` a su ruta UNC y conserva las mayúsculas tal como se escribieron. En cambio, `fs.realpath` (promesas, nativo) sí lo hace. Como `allowedRoots` se calcula con la primera y `/api/fs/dirs` con la segunda, con una unidad `Z:` o una ruta escrita en minúsculas el listado puede dar «Fuera de las carpetas permitidas», y `roots.includes(real)` (`routes/settings.ts:75`) no detecta la raíz y deja subir por encima de ella (a verificar). Propuesta: `fs.realpathSync.native` y comparar con `isInside(a,b) && isInside(b,a)`.
- **P6, P7, P10**: ver la tabla.
- **P8 — Unicode.** APFS conserva la forma con la que se escribió el nombre, pero la búsqueda no distingue NFC de NFD. NTFS y ext4 comparan los bytes. Si un vault llega desde un Mac (copias de HFS+, algunos sincronizadores) con nombres en NFD, en Windows `[[Diagnóstico]]` escrito en NFC no se resuelve. `notes.ts` compara con `toLowerCase()` sin normalizar. Propuesta: una función `key(s) = s.normalize('NFC').toLowerCase()` en la resolución de wikilinks, la reescritura de enlaces y QuickOpen, devolviendo siempre el nombre que hay en el disco. `capture.ts:36` ya crea los nombres en NFC.
- **Mayúsculas.** NTFS, como APFS, no distingue mayúsculas por defecto: el renombrado que solo cambia mayúsculas (`fileops.ts:138`) ya funciona igual. Hay un caso nuevo: las carpetas creadas desde WSL en `/mnt/c` pueden ser *case-sensitive* por carpeta; el código acaba haciendo lo correcto (`toSt` es null y se mueve con normalidad).

### 3.3 Semántica del sistema de archivos

- **F1 — `atomicWrite`** (`fsutil.ts:26-46`). `fs.rename(tmp, abs)` en Windows es `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`. Falla con `EPERM`/`EACCES`/`EBUSY` si otro proceso tiene abierto el destino sin `FILE_SHARE_DELETE`: Defender al analizarlo, el indexador de Windows Search, OneDrive, Dropbox o Syncthing al subirlo, Word, LibreOffice. Las lecturas del propio servidor (`createReadStream`) no bloquean, porque libuv abre con `FILE_SHARE_DELETE`. Obsidian normalmente tampoco. Son errores transitorios: `graceful-fs` reintenta hasta 60 s en win32 por este motivo. Propuesta: `renameRetry(tmp, abs)` con espera exponencial (10, 20, 40… hasta unos 2 s) solo en win32 y con esos códigos. Si no se consigue, responder 423 o 503 con «No se pudo guardar: el archivo está en uso por otro programa (reintenta)». El borrador sigue en el navegador, así que no se pierde nada, pero ahora el usuario ve un 500 sin explicación.
- **F2 — `moveEntry`** (`fileops.ts:72-97`). En archivos se hace `link(src,dst)`, se llama a `onPlaced()` y después `unlink(src)`. En macOS y Linux `unlink` de un archivo abierto siempre funciona. En Windows puede fallar, y entonces el destino ya existe, el origen sigue en su sitio y ya se han emitido los eventos `move`: queda **duplicado**. En la papelera, el siguiente intento crea `nota (2).md`. Propuesta: si `unlink` falla, hacer `unlink(dst)` (deshacer), reintentar como en F1 y, si sigue fallando, 409/423 «en uso». Emitir `onPlaced` solo cuando todo ha terminado.
- **F3 — Enlaces duros.** Se usan en `createExclusive` (crear sin sobrescribir: archivos nuevos, copias del historial, secciones, capturas), `linkExclusive` (adjuntos) y `moveEntry`. No existen en FAT32/exFAT (memorias USB), en muchos recursos SMB o NAS ni en la unidad virtual de Google Drive para escritorio. En Windows, libuv traduce `ERROR_INVALID_FUNCTION` a `EISDIR` y `ERROR_NOT_SUPPORTED` a `ENOTSUP`. `NO_LINK` (`fileops.ts:64`) no incluye `EISDIR` ni `EINVAL`, y `createExclusive`/`linkExclusive` no tienen alternativa, así que con el vault en exFAT o en red no se pueden crear archivos (a verificar; también ocurre en macOS con exFAT). Propuesta: si `link` falla con un código «no soportado», usar `fs.open(abs, 'wx')` + escribir + `fsync`. Es exclusivo (`O_EXCL` → `CREATE_NEW`) aunque no atómico: un lector podría ver el archivo a medias durante unos milisegundos, algo aceptable bajo el `KeyedLock`. Recordar el resultado por carpeta raíz.
- **F4 — chokidar.** chokidar 5 usa un `fs.watch` por directorio (sin `recursive`). En Windows:
  - Se conocen casos en que tener directorios vigilados impide renombrar o borrar carpetas (`EPERM`), tanto desde la app (`moveEntry`, rama `rename`) como desde el Explorador u Obsidian mientras el servidor corre (a verificar en CI con un test de renombrado de carpeta).
  - En unidades de red, ReadDirectoryChangesW pierde eventos o no los entrega.
  - En WSL2, los cambios hechos desde Windows en `/mnt/c` no generan inotify.
  - En Docker Desktop, los montajes de carpetas de Windows no propagan eventos al contenedor.
  - Propuesta: `WATCH_POLLING=auto|on|off`. `auto` activa el polling (`usePolling`, `interval` unos 1000 ms, `binaryInterval` mayor) si la raíz es UNC, está en `/mnt/<letra>` o el proceso corre en un contenedor (`/.dockerenv`). Además, reintentos ante `EPERM` al renombrar carpetas y probar `fs.watch(root, { recursive: true })` en win32 y macOS, que usa un solo handle.
- **F5.** Un `ENOSPC` (límite de inotify en Linux) o un `EPERM` hacen que los cambios en vivo dejen de llegar sin aviso. Conviene registrarlo y mostrar un aviso en `/api/status` (p. ej. `watcher: 'ok' | 'error'`).
- **F6–F9**: ver la tabla.
- **EXDEV.** Ya se gestiona en `moveEntry` (copia y borrado). Los temporales se crean en la misma carpeta que el destino (`fsutil.ts:22`, `capture.ts:182`), así que `rename` y `link` nunca cruzan de unidad. En Windows no hace falta nada más.
- **Permisos y chmod.** No se usa `chmod`. El modo `0o644` de `open` no tiene efecto en Windows, salvo F6.

### 3.4 Finales de línea (CRLF/LF)

- **E1 — Sin `.gitattributes`.** Git para Windows instala `core.autocrlf=true` por defecto, igual que el runner `windows-latest`. Consecuencias:
  1. Los archivos de `templates/**` se descargan con CRLF. `buildManifest()` hashea bytes, así que `manifestProblems()` y `npm run template:manifest -- --check` (y su test) fallan.
  2. Las memorias creadas en Windows copian esos CRLF. `planActualizacion` (`plantilla.ts:300-316`) compara `sha256(cur)` con los hashes LF del manifiesto, así que ningún archivo está «sin tocar», no se sustituye nada y todo acaba en «revisar».
  3. Fixtures y tests con cadenas fijas (`test/fixtures/notes/**`, logs del worker) pueden variar. `parse-log` normaliza `\r\n`, pero no todos los tests lo hacen.

  Propuesta mínima: un `.gitattributes` en la raíz.

  ```gitattributes
  * text=auto eol=lf
  *.png binary
  *.jpg binary
  *.pdf binary
  *.gz binary
  *.woff binary
  *.woff2 binary
  ```

  Propuesta robusta (además): en `sha256` del manifiesto, normalizar `\r\n`→`\n` en los archivos de texto (`isTextPath`) antes de hashear, tanto al generar como al comparar. Así una memoria que el estudiante haya pasado a CRLF (con otro editor o con git) se sigue reconociendo como «sin tocar». Exige regenerar los manifiestos conservando los hashes antiguos, algo que `mergeManifest` ya permite.

  La memoria del estudiante es otro repositorio: `createMemoriaFromTemplate` puede escribir un `.gitattributes` con `* text=auto eol=lf` en `templates/base/` (es un cambio de plantilla: manifiesto y 0 avisos).
- **E2 — CodeMirror.** `EditorState.create({ doc: content })` sin `lineSeparator` parte por `\r\n` y `doc.toString()` une con `\n`. Con un archivo CRLF, editado con el Bloc de notas o descargado con `autocrlf`:
  - Al primer cambio, todo el archivo pasa a LF. Sin `autocrlf` en la memoria, eso es un diff de todas las líneas.
  - El efecto de sincronización (`CodeEditor.tsx:131-144`) compara `cur` (LF) con `doc.content` (CRLF): siempre son distintos, así que en cada `extVersion` sustituye el documento entero. El cursor salta y el historial de deshacer se ensucia.
  - `isDirty` compara con `savedContent` (CRLF): al deshacer hasta el original, el archivo sigue sucio.
  - Propuesta: `const eol = content.includes('\r\n') ? '\r\n' : '\n'` al crear el estado y `EditorState.lineSeparator.of(eol)`. Así `toString()` conserva CRLF. Las posiciones por línea (diagnósticos, SyncTeX, outline) no cambian. Otra opción es normalizar a LF al cargar y restaurar al guardar, pero entonces habría que guardar el EOL original en `Doc`.
- **E3.** `datos.ts:256-258` añade líneas con `\n` a un `datos.tex` CRLF (finales mezclados). `plantilla.ts:148-156` separa por `\n` y la expresión `…\})+$` no reconoce `}\r`, así que no se añaden los comentarios de la plantilla. `plantilla.ts:327-332` funciona con `.gitignore`, pero mezcla finales. Usar `eolOf` en todos.
- Ya tolerante a CRLF: `frontmatter.ts`, `sections.ts`, `outline.ts` (`splitLines`), `search.ts`, `notes.ts`, `links.ts:64`, `synctex.ts:96`, `refs.ts` y `diagramas.ts:150`. Los `rev`/`baseRev` hashean bytes y no tienen problema: el cliente reenvía el `rev` que le dio el servidor.

### 3.5 git desde Node

- **G1.** `createMemoriaFromTemplate` (`memoria-template.mjs:86-104`) copia la plantilla y **después** ejecuta `git init`. Sin Git para Windows en el PATH, `execFileSync('git')` lanza `ENOENT`: `npm run init` termina con una traza de error y `POST /api/settings/init-memoria` responde 500 «spawnSync git ENOENT» con la carpeta ya llena. Al reintentar sale «La carpeta no está vacía». En macOS no se nota porque `/usr/bin/git` existe (aunque sea el *stub* que pide instalar las Command Line Tools). Propuesta: antes de copiar, `git --version`. Si falla, crear la memoria sin repositorio y devolver un aviso («Instala Git para Windows para tener historial»), o abortar sin tocar nada. Ninguna de las dos opciones deja la carpeta a medias.
- **Lo que ya funciona en Windows**: `execFile('git', …)` sin shell encuentra `git.exe` (libuv prueba `.exe`/`.com`); los argumentos van como array, sin problemas de comillas; `rev-parse --show-toplevel` devuelve `C:/…`, que `fs.realpath` normaliza; `GIT_INDEX_FILE` con ruta Windows funciona; `-b main` requiere git ≥ 2.28.
- **G2 — `safe.directory`.** git ≥ 2.35.2 se niega a trabajar en repositorios de otro propietario. Esto ocurre en unidades FAT/exFAT y de red, en carpetas creadas como administrador y **siempre** en el contenedor `app` con montajes de Windows, porque los archivos aparecen como de root. `isGitRepo` devuelve `false` y la actualización de la plantilla no hace commit, sin explicar por qué. Propuesta: en el `Dockerfile` de la app, `git config --system --add safe.directory '*'` (el contenedor solo tiene esa memoria); en nativo, mostrar el stderr de git en el aviso.
- **Identidad**: ya hay una de respaldo (`GIT_IDENTITY`) si no está configurada.
- **G3**: `core.longpaths`.

### 3.6 Docker

- **Docker Desktop en Windows** necesita virtualización y el backend WSL2. La imagen del worker ocupa unos 9,2 GB (TeX Live completo). `mem_limit: 2g` cabe en la memoria por defecto de WSL2 (50 % de la RAM del equipo). `ports: 127.0.0.1:8090` y `read_only`/`tmpfs`/`cap_drop` funcionan igual. En Windows ARM, comprobar que `texlive/texlive:latest-full` y `node:24-slim` tienen variante arm64; si no, se emula (muy lento).
- **Montaje `./data/builds:/out`.** En Windows es una carpeta de NTFS compartida con la VM. Para el worker solo hay escrituras de PDF, log y synctex por compilación, así que el rendimiento es aceptable. El uid 1000 no importa en Docker Desktop (los permisos no se aplican). El servidor nativo lee de ahí sin problema.
- **D2 — Modo «solo Docker» en Windows** (`--profile app`): las carpetas `${NOTES_DIR}` y `${MEMORIA_DIR}` de Windows se montan en `/data/…`.
  - No hay eventos (F4): no se ven en vivo los cambios hechos en Obsidian.
  - `walkFiles`, la búsqueda y el tar de cada compilación son mucho más lentos por la capa de compartición.
  - Los archivos aparecen como de root: falla `safe.directory` (G2).
  - El selector de Ajustes solo ve `/data`.
  - Las rutas de `.env` en Windows (`C:\Users\…`) las acepta Compose para el montaje, pero si el mismo `.env` lo lee el servidor nativo, cada modo necesita las suyas.
- **D3 (Linux)**: ver la sección 6.
- **WSL2 frente a nativo**: ver la comparativa de la sección 1. En resumen: WSL2 completo es la opción con **menos cambios de código** (es Linux), pero obliga a tener el vault en el disco de WSL, donde Obsidian (de Windows) trabaja peor. Con el vault en `/mnt/c` se pierde el watcher y el sistema va lento. Nativo es lo más natural para el estudiante una vez hechas las fases 1 y 2. Con WSL2, la web y la API se abren desde el navegador de Windows en `localhost` gracias al reenvío de puertos de WSL. El proxy de Vite conecta a la API desde dentro de WSL, así que la comprobación de loopback de Ajustes sigue funcionando.

### 3.7 Worker

Confirmado: no tiene nada que dependa del host.

- `createSourceTar` (`compile.ts:76-91`) pasa a node-tar las rutas relativas con `/` (de `walkFiles`) y `portable: true`. node-tar normaliza los separadores en win32. El modo de los archivos de Windows (`0o666`/`0o444`) no importa: `untar.mjs:212` crea los archivos con `0o644`. Con `follow: true` los enlaces internos se guardan como archivos.
- `safeEntryPath` (`untar.mjs:126-133`) ya rechaza `\`, `X:` y `..`. `validateMain` usa `path.posix`.
- rsvg-convert, fontconfig y Source Sans 3 están dentro de la imagen: los diagramas se generan igual en cualquier sistema.
- Los tests del worker (`node --test worker/*.test.mjs`) deberían pasar en Windows: `parse-log` trabaja con cadenas (las rutas `/tmp/…` son datos, no rutas del host), y `untar`/`svg` usan `os.tmpdir()` y `path`. Queda pendiente probar `untar.test` en Windows (comprueba que `abs.startsWith(root + path.sep)` funciona con `C:\…`, cosa que debería ocurrir).
- El worker siempre corre en Linux: compilar en Windows nativo sin Docker (MiKTeX/TeX Live para Windows) **no** está previsto ni se recomienda, porque se perdería el aislamiento de `-no-shell-escape` en el contenedor.

### 3.8 Interfaz web

- **Detección de Mac**: `ui.tsx:163` (`/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)`) funciona. `navigator.platform` está obsoleto, pero sigue disponible. `MOD` y `ALT` ya cambian a `Ctrl+`/`Alt+`.
- **U1 — Textos escritos a mano**:
  - `SearchView.tsx:103`: `{'⌥'}clic abre al lado`
  - `Markdown.tsx:238`: `(⌥clic: abrir al lado)`
  - `HomePanel.tsx:164`: `⌥clic`
  - `SettingsPanel.tsx:290`: `Guardar y aplicar (⌘S)`
  - `CaptureModal.tsx:99` y `PdfViewer.tsx:410`: `⇧↵`
  - `{MOD}⇧C` / `{MOD}⇧J` dan «Ctrl+⇧C» en Windows.
  - En la documentación: `README.md` (⌘↵, ⌘⇧J, ⌘clic) y los comentarios.
  - Propuesta: `kbd('Mod-Shift-C')` en `ui.tsx` → «⌘⇧C» en Mac y «Ctrl+Mayús+C» en el resto (`Alt`, `Intro`, `Supr`, nombres en español como en los teclados españoles). En el README, «⌘/Ctrl».
- **U2 — Conflictos con el navegador (a verificar).**
  - En Chrome y Edge de Windows/Linux: `Ctrl+Mayús+J` abre la consola de DevTools y `Ctrl+Mayús+C` el inspector. Son atajos del propio navegador que normalmente no se pueden anular con `preventDefault`. En Firefox son la consola del navegador y el inspector. En Mac, Chrome usa `⌘⌥J`, aunque `⌘⇧C` también es el inspector, así que conviene comprobar también por qué funciona hoy.
  - `Ctrl+E` y `Ctrl+K` (ir a la barra de búsqueda) y `Ctrl+B` (marcadores en Firefox) sí suelen poder anularse.
  - Propuesta: probarlo en Chrome, Edge y Firefox de Windows. Si gana el navegador, usar en «no Mac» `Ctrl+Alt+J` (Ver en PDF) y `Ctrl+Alt+N` o `Ctrl+Mayús+Y` (Capturar), dejar los de Mac y documentarlo en Inicio → Atajos. Cuidado: `Ctrl+Alt` es `AltGr` en teclados españoles (`Ctrl+Alt+2` = `@`), así que hay que evitar letras y números que produzcan caracteres con AltGr.
- **U3 — `Alt+clic`.** En Windows funciona (`preventDefault` evita la descarga de enlaces con `Alt+clic` de Chrome; a verificar), aunque soltar `Alt` activa la barra de menús de Firefox. En Linux, KDE, Xfce y Cinnamon usan `Alt+arrastrar` para mover ventanas y el clic no llega a la página. Propuesta: aceptar también `Ctrl+Mayús+clic` (o el clic central) y ofrecer «Abrir al lado» en los menús contextuales.
- **Supr y `⌘⌫`** (`FileTree.tsx:24,168`): en Windows funciona la tecla `Supr` (`e.key === 'Delete'`). Correcto.
- **Tecla Windows**: los manejadores usan `e.metaKey || e.ctrlKey`, así que `Win+K` también los activaría, pero el sistema operativo intercepta casi todos esos atajos. No hace falta cambiarlo.
- **`Ctrl+rueda`** en el PDF (`PdfViewer.tsx:165-170`, `passive: false`) sustituye el zoom del navegador, como en Mac. Correcto.
- **Fuentes y estilo**: las pilas de `index.css:98-99` ya incluyen Segoe UI y Consolas. Las barras de desplazamiento usan `scrollbar-width: thin` (Chromium ≥ 121). Arrastrar archivos desde el sistema (`CaptureModal.tsx:113-127`) usa objetos `File` y no depende del sistema. No hay `file://`.
- **Rutas que se muestran**: las relativas siempre con `/`, que es lo correcto. Las absolutas (Ajustes, avisos) se muestran como las devuelve el servidor (`C:\…`), lo que está bien una vez resuelto P2.

### 3.9 Ajustes y listado de carpetas

- **L1.** `GET /api/fs/dirs` sin `path` devuelve las `allowedRoots`, que por defecto son solo el home: `C:\Users\Ana`. Dentro aparecen `AppData` (oculta por atributo, no por punto), `OneDrive`, `Contacts`, `Saved Games`, etc. Las *junctions* antiguas (`Application Data`, `Mis documentos`) dan `EPERM` en `realpath`, así que se saltan; es correcto. Si `ALLOWED_ROOTS` incluye `C:\`, aparecen `$Recycle.Bin`, `System Volume Information`, `Recovery`, `PerfLogs`, `Windows` y `Program Files`. Propuesta: en win32, una lista de exclusión de nombres (`AppData`, `$Recycle.Bin`, `System Volume Information`, `Config.Msi`, `Recovery`, `PerfLogs`, `Windows`, `ProgramData`, `Program Files*`, `MSOCache`) y no mostrar carpetas cuyo `readdir` dé `EPERM`. Node no tiene API para leer el atributo «oculto».
- **Otras unidades** (`D:\`) solo funcionan con P1 resuelto. Opcional: si `ALLOWED_ROOTS` no está definida, ofrecer el home más las unidades fijas que existan. Mejor que no: rompería el principio de «solo el home por defecto».
- **L2 — OneDrive.** Con «Copia de seguridad de carpetas» activada, `Documentos` y `Escritorio` están en `C:\Users\Ana\OneDrive\…`. *Files On-Demand* hace que `walkFiles` y la búsqueda **descarguen** todos los archivos que solo estaban en la nube. Además, la sincronización provoca F1 y F2. Recomendación en el README: memoria y vault fuera de OneDrive, o marcados como «Mantener siempre en este dispositivo».
- **Valores por defecto**: `./workspace/notes` y `./workspace/memoria` se resuelven contra la raíz del repo y funcionan. Si el repo está fuera del home (`C:\dev\estudio-tfg`), `workspace/` queda fuera de `ALLOWED_ROOTS` y solo sale un aviso, como en macOS. `assertOutsideRepo` funciona en win32 (`path.relative` no distingue mayúsculas, `workspace${path.sep}`).

### 3.10 Tests

- **T1** — Con P1 resuelto, `helpers.ts:35` funciona.
- **T2** — Hay enlaces simbólicos en `compile.test.ts:188-189`, `traversal.test.ts:42-43,63` y `settings.test.ts:136`. En Windows, `fs.symlink` necesita `SeCreateSymbolicLinkPrivilege`, que tiene el administrador o se consigue con el «Modo de desarrollador». Los runners de GitHub ejecutan como administrador y no deberían tener problema. En un equipo normal, `EPERM`. Propuesta: `canSymlink()` en `helpers.ts` (prueba una vez en el temporal) e `it.skipIf(!canSymlink)`. Para carpetas se puede usar `'junction'` (no necesita privilegio) y así cubrir también el caso de las *junctions*, que es el más habitual en Windows.
- **T3** — Lo cubre E1.
- **T4** — El teardown `fs.rm(dir, { recursive: true, force: true })` puede dar `EBUSY` si el watcher o un stream no han cerrado: añadir `maxRetries` y `retryDelay`.
- **Lo que debería funcionar**:
  - `os.tmpdir()` en el runner es `C:\Users\RUNNER~1\AppData\Local\Temp` (nombre corto 8.3), pero `setup` hace `fs.realpath` y lo convierte en el nombre largo. Bien.
  - `config.test.ts:7` (`/tmp/otra/notas` → `C:\tmp\otra\notas`) sigue fuera del repo.
  - Los casos `notesDir: '/'` de `settings.test.ts` → `C:\`, fuera de las raíces permitidas: devuelve un error, como se espera. Comprobar los mensajes.
  - `traversal.test.ts:21` ya incluye `C:/x.md` y `a\..\b.md`.
  - `move.test.ts:145` (solo mayúsculas) funciona en NTFS y en ext4.
- **Tests que conviene añadir**:
  - Unitarios de `path.win32` (sección 5).
  - Nombres reservados y `:` (P3).
  - CRLF de punta a punta: guardar un archivo CRLF sin cambiarlo, `datos.tex` CRLF y manifiesto con CRLF.
  - `moveEntry` cuando falla `unlink` (simulado).
  - Alternativa sin enlaces duros (simular `EISDIR` o `ENOTSUP`).

### 3.11 Documentación

- `README.md:5` ya dice que el soporte para Windows se está analizando. Falta una sección «Windows» con los pasos de «qué puede hacer hoy» (sección 1) y, tras la fase 1, los requisitos (Git para Windows, Docker Desktop con WSL2, Node 24), OneDrive y atajos.
- `worker/README.md`: comandos en PowerShell o el script de S3. La medición de rendimiento es del Mac: añadir una de Windows y WSL2 cuando se haga.
- `AGENTS.md`: los bloques ` ```bash ` sirven en Git Bash. Tras S1, `npm run dev` funciona igual.
- No hay referencias a `sips`, `open`, `zsh`, `brew` ni `nohup` en el repo. Solo `COPYFILE_DISABLE=1` (variable de tar en macOS, inofensiva en otros sistemas) y `.DS_Store` (en `.gitignore` y `memoria-template.mjs:122`; añadir `Thumbs.db` y `desktop.ini`, F7).

---

## 4. Plan de adaptación por fases

### Fase 0 — Documentar y quitar lo trivial (≈1 h, sin riesgo)

1. `.gitattributes` (E1, mínimo). Comprobar que `git add --renormalize .` no cambia nada en macOS: los archivos ya son LF.
2. Sección «Windows» del README con los pasos de hoy (sección 1).
3. Quitar `NODE_ENV=production` de `server/package.json` (S2).

### Fase 1 — Mínimo para arrancar en Windows nativo (≈1 día)

| Orden | Id | Cambio |
| --- | --- | --- |
| 1 | S1 | `scripts/dev.mjs` y `"dev": "node scripts/dev.mjs"` |
| 2 | P1/T1 | `ALLOWED_ROOTS` con `path.delimiter` y actualizar `.env.example` y CONTRACT (versionado) |
| 3 | P2 | `lib/abspath.ts` en la web y `pathSep` en `GET /api/settings` (CONTRACT); arreglar `SettingsPanel` y `DirPicker` |
| 4 | G1 | `git --version` antes de crear la memoria; memoria sin git y aviso si no está instalado |
| 5 | U1 | Helper `kbd()` y sustituir los glifos escritos a mano |
| 6 | P5 | `realpathSync.native` y comparar raíces con `isInside` |
| 7 | — | Prueba manual en Windows (VM o equipo): `init`, `dev`, Ajustes, abrir, guardar, compilar, SyncTeX, capturar, mover, papelera |

### Fase 2 — Robustez (≈2-3 días)

| Id | Cambio |
| --- | --- |
| F1, F2 | Reintentos en win32 para `rename`/`unlink` y deshacer en `moveEntry`; error 423/503 en español |
| F3 | Alternativa sin enlaces duros y `NO_LINK` ampliado |
| F4, F5, D2 | `WATCH_POLLING` (auto en UNC, `/mnt/*` y contenedor); errores del watcher en `/api/status` |
| P3, P4 | `validSegment` para nombres nuevos y `:` en win32; nombres reservados en `sanitizeTitle` (CONTRACT) |
| E1 (robusto), E2, E3 | Hash de manifiesto con EOL normalizado; `lineSeparator` en CodeMirror; `eolOf` en `datos.ts` y `plantilla.ts`; `.gitattributes` en `templates/base/` (plantilla: manifiesto y 0 avisos) |
| G2, G3 | `safe.directory` en la imagen de la app; stderr de git en los avisos; `core.longpaths` |
| L1, F7 | Exclusiones de sistema en `/api/fs/dirs`; ignorar `desktop.ini` y `Thumbs.db` |
| U2, U3 | Atajos alternativos fuera de Mac si el navegador los captura; alternativa a `Alt+clic` |
| P6–P8, P10, F6, F8, F9 | Menores |

### Fase 3 — CI en Windows (≈½-1 día)

`.github/workflows/ci.yml` con una matriz:

```yaml
strategy:
  fail-fast: false
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
runs-on: ${{ matrix.os }}
steps:
  - uses: actions/checkout@v4        # en windows-latest, autocrlf=true: comprueba E1 de verdad
  - uses: actions/setup-node@v4
    with: { node-version: 24 }
  - run: npm ci --prefix server
  - run: npm ci --prefix web
  - run: npm run typecheck --prefix server
  - run: npm test
  - run: npm run build --prefix web
  - run: node --test worker/*.test.mjs
  - run: node scripts/template-manifest.mjs --check
```

- No hace falta el worker real: los tests usan `WORKER_URL=http://127.0.0.1:1` o un worker falso.
- Un job aparte, **solo en ubuntu**, que construya la imagen del worker y compile la plantilla con todos los perfiles (0 avisos). Los runners de Windows no ejecutan contenedores Linux.
- Opcional: otra variante de Windows con `git config --global core.autocrlf false` antes del checkout, para cubrir las dos configuraciones de los estudiantes.
- T2 (`canSymlink`, aunque en el runner haya privilegios) y T4 (reintentos en `fs.rm`) deben estar hechos antes de activar el job de Windows como obligatorio.

---

## 5. Cómo probarlo

### Sin máquina Windows

1. **Tests unitarios con `path.win32`.** Que las funciones puras reciban el módulo de rutas como parámetro (con `path` por defecto) y probarlas con `path.win32` desde vitest en macOS:
   - `isInside(parent, child, p = path)`, `normalizeRel`, `parseAllowedRoots(v, base, p = path)` (con `delimiter`), `expandPath`, `toPosix`, `insideRepoNotWorkspace`, `locate` (eventos con `\`).
   - Los helpers de `web/src/lib/abspath.ts` (puros; vitest del servidor puede importarlos desde `../../web/src/lib/abspath.ts`, o se añade vitest a la web).
   - Casos: `C:\`, `c:\` frente a `C:\`, `D:\` cruzado, UNC `\\srv\share`, `\\?\C:\…`, rutas mezcladas `C:\a/b`, `~\x`, `a:b`, `nota.`, `CON`, `aux.tex`, `COM¹`.
2. **CRLF en macOS**: tests que conviertan fixtures a CRLF (`content.replace(/\n/g, '\r\n')`) y comprueben outline, datos, refs, frontmatter, manifiesto y guardado sin cambios (E2, con un test de la web o de CodeMirror en vitest con jsdom).
3. **Simular errores de Windows**: `vi.spyOn(fs, 'rename' | 'unlink' | 'link')` para devolver `EPERM`, `EBUSY`, `EISDIR` o `ENOTSUP` una o varias veces y comprobar reintentos, deshacer y alternativas (F1–F3).
4. **exFAT en macOS**: una imagen de disco `hdiutil create -fs ExFAT -size 100m x.dmg` montada como vault reproduce F3 sin Windows.
5. **Linux**: un contenedor `node:24` con el repo montado, o el runner ubuntu, para la sensibilidad a mayúsculas, inotify y uid.

### GitHub Actions `windows-latest`

Es la forma más barata de tener un Windows real: NTFS, `autocrlf=true`, Defender activo, enlaces simbólicos con administrador. Se puede usar sin hacerlo obligatorio (`continue-on-error`) mientras dure la fase 2. Para F1 y F4, un test que abra un archivo con un proceso hijo **sin** `FILE_SHARE_DELETE` (p. ej. `powershell -c "$f=[IO.File]::Open(path,'Open','Read','Read'); Start-Sleep 2"`) mientras se guarda o se mueve.

### Máquina virtual o equipo con Windows

- En un Mac con Apple Silicon: Windows 11 ARM en UTM, Parallels o VMware Fusion. Docker Desktop para Windows ARM funciona con WSL2; comprobar que la imagen de TeX Live tiene arm64 o asumir la emulación.
- En un PC: Windows 11 con Docker Desktop.
- Lista de comprobación manual:
  - Clonar con `autocrlf` por defecto **y** con `autocrlf=false`.
  - `npm run init`, `install:all`, `worker` y `dev`.
  - Ajustes: elegir carpetas con el selector (home, otra unidad con `ALLOWED_ROOTS=C:\…;D:\…`, unidad de red).
  - Crear la memoria (con y sin git instalado).
  - Editar y guardar `tfg.tex` con Obsidian abierto en el vault.
  - Guardar con el archivo abierto en Word o el Bloc de notas.
  - Mover y renombrar carpetas mientras el servidor corre.
  - Papelera y deshacer.
  - Capturar con un adjunto.
  - Compilar, SyncTeX en los dos sentidos y diagramas.
  - Atajos en Chrome, Edge y Firefox.
  - Vault en OneDrive y en una memoria USB exFAT.
  - Repetir el núcleo en WSL2 (vault en `~` y en `/mnt/c`) y con `--profile app`.

---

## 6. Linux: diferencias

Linux es el sistema más parecido a lo que ya se prueba (POSIX, `sh`, `:` como separador), y la mayoría de los scripts funcionan sin cambios. Diferencias:

| Tema | Qué cambia | Gravedad | Propuesta |
| --- | --- | --- | --- |
| Mayúsculas | ext4 distingue mayúsculas: pueden convivir `Nota.md` y `nota.md`. La resolución de wikilinks (que no distingue mayúsculas, como Obsidian) puede ser ambigua; `caseOnly` nunca se activa (bien) | menor | Preferir la coincidencia exacta antes que la que ignora mayúsculas en `notes.ts` (hoy depende del orden) |
| Unicode | ext4 compara bytes: el mismo problema NFC/NFD que en Windows (P8) | menor | P8 |
| inotify | `fs.inotify.max_user_watches` (8192 en kernels antiguos; los nuevos lo calculan según la RAM): con un vault grande, chokidar da `ENOSPC` y el error se ignora (F5) | importante | F5 y documentar `sysctl fs.inotify.max_user_watches=524288` |
| Docker y uid (D3) | Docker nativo **sí** aplica permisos. Si `./data/builds` no existe, el daemon lo crea como root y el worker (uid 1000) no puede escribir: todas las compilaciones fallan con `EACCES`. Si el uid del usuario no es 1000, ocurre lo mismo. Con Docker *rootless* o Podman, los uid se mapean de otra forma | importante | `npm run init` o un `scripts/worker.mjs` que creen `data/builds` antes de `docker compose up`; documentar `sudo chown 1000:1000 data/builds` o `chmod 777`; opción `user: "${WORKER_UID:-1000}:${WORKER_GID:-1000}"` en compose (con `HOME` en tmpfs ya funciona con cualquier uid) |
| Docker y la app (`--profile app`) | El contenedor (`node`, uid 1000) escribe en el vault montado: los archivos nuevos quedan con uid 1000 y git puede dar «dubious ownership» si el host tiene otro uid (G2) | menor | G2 y `user:` configurable |
| Grupo docker | `docker compose` necesita que el usuario esté en el grupo `docker` (o usar *rootless*) | menor | Documentar |
| `Alt+clic` | KDE, Xfce y Cinnamon lo usan para mover ventanas (U3) | menor | U3 |
| Atajos del navegador | Como en Windows (U2): `Ctrl+Mayús+J/C` | importante (a verificar) | U2 |
| `ALLOWED_ROOTS` | El home por defecto no incluye `/mnt/datos` ni `/media/…`; el separador `:` ya funciona | — | Documentar |
| WSL2 | Es Linux: aplica todo lo anterior y, además, `/mnt/c` no tiene inotify (F4) y es lento; las carpetas creadas desde WSL en NTFS pueden distinguir mayúsculas por carpeta; Docker Desktop se integra con la distribución | — | Sección 1 |
| `localhost` | Igual que en macOS | — | — |
| git | Suele estar instalado; sin `autocrlf` | — | — |
