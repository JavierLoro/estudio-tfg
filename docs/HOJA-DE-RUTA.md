# Hoja de ruta: Windows, modo Docker, motores de compilación y app de escritorio

> Objetivo final: distribuir Estudio TFG como **app instalable y portable para Windows y Mac** (Electron), sin obligar a instalar Docker. Por el camino: que funcione en Windows nativo, ofrecer un modo Docker para usarlo en cualquier sistema (y desplegarlo como servidor), y poder compilar LaTeX con distintos motores.
>
> Cada tarea está escrita para que **un agente pueda hacerla leyendo solo su sección** (más AGENTS.md y lo que la sección enlace). Cada tarea tiene su issue en GitHub con la etiqueta `hoja-de-ruta` y la de su fase (`fase-A`…`fase-G`).
>
> Fuentes: [PLATAFORMAS.md](PLATAFORMAS.md) (50 hallazgos de portabilidad; los IDs como `S1`, `P2`, `F4` se refieren a él) y [CONTRACT.md](CONTRACT.md).

## Índice

| Fase | Qué consigue | Tareas | Issues | Depende de |
|---|---|---|---|---|
| [A](#fase-a) | Arrancar en Windows nativo (lo mínimo) | A1–A7 | #3–#9 | — |
| [B](#fase-b) | Modo Docker para usarlo en cualquier sistema y como servidor | B1–B4 | #10–#13 | A1 |
| [C](#fase-c) | Robustez en Windows (archivos en uso, nombres, saltos de línea…) | C1–C7 | #14–#20 | A |
| [D](#fase-d) | CI en Linux, macOS y Windows | D1–D2 | #21–#22 | A |
| [E](#fase-e) | Motores de compilación intercambiables (Docker / TeX del sistema / Tectonic) | E1–E4 | #23–#26 | A |
| [F](#fase-f) | Exportar diagramas sin Docker | F1 | #27 | E1 |
| [G](#fase-g) | App de escritorio con Electron | G1–G7 | #28–#34 | B1, C, D1, E1–E2, F1 |

```
A1 ─┬─ B1 ── B2 ── B3 ── B4
    │
A ──┼─ C1…C7 ──┐
    ├─ D1 ─ D2 ┤
    └─ E1 ─┬─ E2 ─ E3 ──┐
           ├─ E4        ├─ G1 ─ G2 ─ G3 ─ G4 ─ G5 ─ G6
           └─ F1 ───────┘                       └─ G7
```

Las tareas de una misma fase sin dependencia entre sí pueden ir en paralelo si tocan archivos distintos (lo dice cada tarea en «Archivos»). Ver [Cómo seguir la hoja de ruta](#cómo-seguir-la-hoja-de-ruta).

## Cómo seguir la hoja de ruta

Un agente puede recibir una tarea concreta («haz la issue #4») o simplemente **«sigue la hoja de ruta»**. En ese caso:

1. **Elige la siguiente tarea disponible**: la de fase más temprana y número más bajo que cumpla las tres condiciones:
   - su issue está abierta y **sin** la etiqueta `en-curso`;
   - todas sus dependencias («Depende de») tienen la issue **cerrada** (PR fusionado);
   - no comparte archivos («Archivos») con otra tarea `en-curso`.

   Para verlo: `gh issue list --repo JavierLoro/estudio-tfg --label hoja-de-ruta --state all --limit 60 --json number,title,state,labels`.
2. **Resérvala**: añade la etiqueta `en-curso` (`gh issue edit <n> --add-label en-curso`) y comenta «Empiezo con esta tarea». Si al ir a reservarla ya la tiene, elige otra.
3. **Hazla** siguiendo las reglas comunes de abajo, en la rama `hoja/<id>`, y abre el PR con `Closes #<n>`.
4. **Al terminar**: deja el informe final como comentario del PR y quita la etiqueta `en-curso` solo si abandonas la tarea sin PR (explicando por qué). Una tarea por agente: no encadenes otra sin que te lo pidan.

Si ninguna tarea está disponible (todo lo pendiente depende de PR sin fusionar), dilo y para.

**Mensaje para lanzar un agente**:

```text
Sigue la hoja de ruta de JavierLoro/estudio-tfg (docs/HOJA-DE-RUTA.md, sección «Cómo seguir la hoja de ruta»): elige la siguiente tarea disponible, resérvala, hazla en su rama, abre el PR y termina con el informe final.
```

## Reglas comunes para el agente

1. **Lee primero** [AGENTS.md](../AGENTS.md), la sección de la tarea y lo que enlace (hallazgos de PLATAFORMAS.md, secciones del contrato). Si algo de la tarea ya no coincide con el código (líneas movidas, algo ya hecho), adáptalo y dilo en el informe.
2. **Nunca escribas en la memoria ni en el vault reales del usuario** (las carpetas configuradas en `.env`/`data/settings.json`). Para probar en el navegador, levanta **otra instancia** con copias en el scratchpad:
   - copia una memoria de plantilla con `copyTemplate` de `scripts/memoria-template.mjs` y las notas de `test/fixtures/notes`;
   - API en otro puerto: `cd server && PORT=<p> NOTES_DIR=… MEMORIA_DIR=… BUILD_DIR=<scratch>/data/builds ALLOWED_ROOTS=<scratch> npx tsx src/index.ts`;
   - `data/settings.json` (que manda sobre `.env`) vive junto a `BUILD_DIR`, así que con `BUILD_DIR` en el scratchpad la instancia no lee los ajustes reales;
   - no uses los puertos 8787/5173: suele haber un servidor del usuario abierto en ellos;
   - web en otro puerto: `cd web && VITE_API_TARGET=http://localhost:<p> npx vite --port <q> --strictPort`;
   - al terminar, para tus servidores y cierra las pestañas que abriste (muchas pestañas abiertas agotan las conexiones SSE).
3. **Git**: nada de `git stash`, `git checkout -- …` ni `git reset` (puede haber otros agentes con cambios sin commit). **Encargarte una tarea de esta hoja de ruta («haz la issue #N») te autoriza a crear la rama `hoja/<id>` (p. ej. `hoja/a2`), hacer commits en ella, subirla y abrir un PR que cierre la issue (`Closes #<n>`)**. Nunca hagas commit ni push directamente en `main` ni fusiones el PR: eso lo decide el usuario.
4. **Antes de dar la tarea por terminada**: `npm test`, `npm run typecheck --prefix server`, `npm run build --prefix web` y `node --test worker/*.test.mjs` en verde. Si tocas la plantilla: compila todos los perfiles con el worker con **0 avisos**. Si tocas la interfaz: pruébala en el navegador (en tu instancia aparte).
5. **Contrato**: si cambia la API, los eventos o un comportamiento visible, actualiza `docs/CONTRACT.md` en una sección versionada (la siguiente libre) o en «Precisiones».
6. **No implementes Windows a ciegas**: lo que solo se puede comprobar en Windows, cúbrelo con tests (`path.win32` inyectable, errores simulados con `vi.spyOn`) y márcalo «a verificar en Windows» en el informe.
7. **Informe final**: qué hiciste, criterios de aceptación uno a uno (cumplido / no y por qué), archivos tocados, resultados de tests, qué quedó sin verificar.

**Modelo recomendado** en cada tarea: **Opus** cuando hay riesgo de perder datos del usuario o razonamiento delicado (sistema de archivos, procesos, motores); **Sonnet** cuando la tarea está bien acotada; **Haiku** para cambios mecánicos.

---

<a id="fase-a"></a>
## Fase A — Mínimo para arrancar en Windows nativo

Resultado: en Windows con Node 24, Git para Windows y Docker Desktop (worker), `npm run dev` arranca, se configuran carpetas en Ajustes, se crea la memoria y se edita, compila y navega como en macOS. Esfuerzo total ≈ 1 día.

<a id="a1"></a>
### A1 · Saltos de línea, script de arranque de producción y README para Windows

**Issue**: [#3](https://github.com/JavierLoro/estudio-tfg/issues/3)

- **Objetivo**: que un clon en Windows no convierta los archivos a CRLF, que `npm start` no use sintaxis de shell y que el README diga cómo usarlo hoy en Windows.
- **Contexto**: PLATAFORMAS.md E1 (versión mínima), S2, D1, L2 y su sección 1 «qué puede hacer hoy un usuario de Windows». `server/package.json` (`start`), `README.md`.
- **Alcance**:
  - Crear `.gitattributes` en la raíz: `* text=auto eol=lf` y marcar binarios (`*.pdf *.png *.jpg *.woff *.woff2 *.ttf *.otf *.gz binary`).
  - Comprobar que `git add --renormalize .` no cambia nada en macOS (si cambia algo, explicarlo).
  - Quitar `NODE_ENV=production` del script `start` de `server/package.json` (el código no lo usa: confírmalo con `grep`).
  - README: sección «Windows (hoy)» con los pasos de PLATAFORMAS.md §1 (requisitos, clonar, carpetas fuera de OneDrive, dos terminales mientras no exista A2) y requisitos de Docker Desktop (WSL2, ~10 GB).
  - No hace: normalizar hashes del manifiesto (eso es C4).
- **Criterios de aceptación**: `.gitattributes` existe y `git ls-files --eol` muestra `i/lf` en los textos; `npm start` funciona en macOS; el README tiene la sección y enlaza a PLATAFORMAS.md.
- **Verificación**: `git ls-files --eol | grep -v 'i/lf' | grep -v -- '-text'` vacío o explicado; `npm start` arranca y responde `/api/status`.
- **Archivos**: `.gitattributes`, `server/package.json`, `README.md`.
- **Contrato**: no. **Depende de**: —. **Modelo**: Haiku/Sonnet. **Esfuerzo**: S.

<a id="a2"></a>
### A2 · `npm run dev` multiplataforma

**Issue**: [#4](https://github.com/JavierLoro/estudio-tfg/issues/4)

- **Objetivo**: que `npm run dev` arranque API y web en Windows (hoy usa `&`, que en `cmd.exe` las ejecuta una tras otra y la web nunca arranca).
- **Contexto**: PLATAFORMAS.md S1, S4. `package.json` (raíz, script `dev`), `server/package.json` (`dev`: `tsx watch src/index.ts`), `web/package.json` (`dev`: `vite`), `.claude/launch.json`.
- **Alcance**:
  - `scripts/dev.mjs` sin dependencias: lanza `server` y `web` con `process.execPath` + el binario JS de cada herramienta (`node_modules/tsx/dist/cli.mjs`, `node_modules/vite/bin/vite.js`), sin `shell: true`; prefija cada línea con `[api]`/`[web]`; si uno termina, cierra el otro (en win32 `taskkill /pid <pid> /T /F`; en POSIX, señal al grupo); comprueba antes que existen `server/node_modules` y `web/node_modules` y si no, dice qué ejecutar.
  - Hereda el entorno (`PORT`, `VITE_API_TARGET`, `NOTES_DIR`…) y reenvía a Vite los argumentos tras `--` (`npm run dev -- --port 5180`), para poder probarlo en otros puertos con carpetas de prueba.
  - `stdin` de los hijos en `'ignore'` (en POSIX, con `detached`, un hijo que lee la terminal se queda parado); `FORCE_COLOR=1` para conservar colores.
  - Ctrl+C (SIGINT/SIGTERM) cierra ambos y sale con código 0. Si un hijo termina solo (no por Ctrl+C), cierra el otro y sale con su código (o 1).
  - Un fallo del servidor dentro de `tsx watch` **no** cuenta como «terminar»: `tsx watch` sigue esperando cambios, que es lo esperado en desarrollo.
  - `"dev": "node scripts/dev.mjs"` en `package.json`; en `.claude/launch.json`, sustituir las dos entradas que usan `npm` por una sola `dev` con `runtimeExecutable: "node"`, `runtimeArgs: ["scripts/dev.mjs"]` y `port: 5173`.
- **Criterios de aceptación** (en macOS, en puertos y carpetas de prueba: `PORT=8790 VITE_API_TARGET=http://localhost:8790 NOTES_DIR=… MEMORIA_DIR=… BUILD_DIR=<scratch>/data/builds npm run dev -- --port 5180`): arranca los dos con prefijos `[api]`/`[web]`; Ctrl+C cierra ambos sin procesos huérfanos (`lsof -i :8790 -i :5180` y `pgrep -fl 'tsx|vite'` sin restos) y sale con 0; si Vite falla (puerto ocupado) o se mata el proceso de `tsx`, el otro se cierra y el código de salida es distinto de 0; si faltan dependencias, mensaje en español y código 1.
- **Verificación**: lo anterior en macOS; revisar el código de win32 contra la documentación de Node (`child_process`, `taskkill`). Marcar «a verificar en Windows».
- **Archivos**: `scripts/dev.mjs`, `package.json`, `.claude/launch.json`.
- **Contrato**: no. **Depende de**: —. **Modelo**: Sonnet. **Esfuerzo**: S.

<a id="a3"></a>
### A3 · `ALLOWED_ROOTS` con el separador de cada sistema

**Issue**: [#5](https://github.com/JavierLoro/estudio-tfg/issues/5)

- **Objetivo**: que `ALLOWED_ROOTS=C:\Users\x;D:\TFG` funcione (hoy se separa por `:` y rompe las letras de unidad).
- **Contexto**: PLATAFORMAS.md P1, T1. `parseAllowedRoots` en `server/src/config.ts` (~línea 91), `.env.example`, `server/test/helpers.ts` (pasa `ALLOWED_ROOTS: dir`), `docs/CONTRACT.md` (sección «Configuración desde la interfaz (v0.2)», donde se describe `ALLOWED_ROOTS`).
- **Alcance**: separar con `path.delimiter` (`;` en Windows, `:` en POSIX); que la función acepte el módulo `path` como parámetro opcional para poder probar con `path.win32`; actualizar comentario, `.env.example` y contrato.
- **Criterios de aceptación**: tests nuevos con `path.win32` (`C:\a;D:\b` → dos raíces) y `path.posix` (`/a:/b`); el comportamiento en macOS no cambia.
- **Verificación**: `npm test`.
- **Archivos**: `server/src/config.ts`, `.env.example`, `docs/CONTRACT.md`, test nuevo en `server/test/config.test.ts`.
- **Contrato**: sí (precisión en v0.2). **Depende de**: —. **Modelo**: Sonnet. **Esfuerzo**: S.

<a id="a4"></a>
### A4 · Rutas absolutas de Windows en Ajustes

**Issue**: [#6](https://github.com/JavierLoro/estudio-tfg/issues/6)

- **Objetivo**: que el panel Ajustes y el selector de carpetas funcionen con `C:\…`, `\\servidor\recurso` y `~\`.
- **Contexto**: PLATAFORMAS.md P2, P6. `web/src/panels/SettingsPanel.tsx` (`isAbs`, `joinAbs`, `relToNotes`), `web/src/components/DirPicker.tsx` (migas de pan), `server/src/routes/settings.ts` (`GET /api/settings`, `/api/fs/dirs`), `expandPath` en `server/src/config.ts` y `server/src/settings.ts`, `scripts/init.mjs`.
- **Alcance**:
  - `web/src/lib/abspath.ts`: `isAbsPath` (`/^(\/|~|[A-Za-z]:[\\/]|\\\\)/`), `splitAbs` (separa por `[\\/]` conservando `C:\` o `\\srv\share\` como raíz), `joinAbs(dir, name, sep)`, `relUnder(base, p)` que devuelve siempre `/`. Usarlos en `SettingsPanel` y `DirPicker`.
  - `GET /api/settings` devuelve `pathSep: '\\' | '/'` (el del servidor, no el del navegador: con WSL o Docker el navegador está en Windows pero las rutas son POSIX).
  - `expandPath` acepta `~/` y `~\`.
- **Criterios de aceptación**: tests de `abspath.ts` con rutas POSIX, `C:\`, `c:/`, UNC y mixtas; en macOS el panel funciona igual que antes (probado en el navegador en una instancia aparte: elegir vault, subcarpeta de recursos y memoria con el selector).
- **Verificación**: tests (pueden ir en `server/test/` importando de `web/src/lib/`, como `diagramEdit.test.ts`), `npm run build --prefix web`, navegador.
- **Archivos**: `web/src/lib/abspath.ts`, `web/src/panels/SettingsPanel.tsx`, `web/src/components/DirPicker.tsx`, `web/src/api.ts`, `server/src/routes/settings.ts`, `server/src/config.ts`, `server/src/settings.ts`, `docs/CONTRACT.md`.
- **Contrato**: sí (`pathSep` en `GET /api/settings`). **Depende de**: A3 (comparten `config.ts`; hacer después). **Modelo**: Sonnet. **Esfuerzo**: M.

<a id="a5"></a>
### A5 · Crear la memoria sin git instalado

**Issue**: [#7](https://github.com/JavierLoro/estudio-tfg/issues/7)

- **Objetivo**: que crear la memoria no deje una carpeta a medias con error 500 cuando `git` no está en el PATH.
- **Contexto**: PLATAFORMAS.md G1. `createMemoriaFromTemplate` en `scripts/memoria-template.mjs` (copia y luego `git init` con `execFileSync`), `POST /api/settings/init-memoria` en `server/src/routes/settings.ts` y `server/src/settings.ts`, `scripts/init.mjs`, aviso en `web/src/panels/SettingsPanel.tsx`.
- **Alcance**: comprobar `git --version` antes de copiar; si no hay git, crear la memoria sin repositorio y devolver un aviso («La memoria se ha creado sin control de versiones: instala Git para tener historial y actualizaciones de plantilla»); `npm run init` igual. Las funciones que usan git (`server/src/plantilla.ts`) deben seguir funcionando sin repo (ya contemplan `commit: null`: confirmarlo).
- **Criterios de aceptación**: test que simula git ausente (PATH vacío o inyectando la comprobación) → memoria creada, sin `.git`, respuesta con aviso; con git, igual que ahora.
- **Verificación**: `npm test`; navegador (instancia aparte) mostrando el aviso.
- **Archivos**: `scripts/memoria-template.mjs` (+ `.d.mts`), `scripts/init.mjs`, `server/src/settings.ts`, `server/src/routes/settings.ts`, `web/src/panels/SettingsPanel.tsx`, `web/src/api.ts`, `docs/CONTRACT.md`.
- **Contrato**: sí (campo de aviso en la respuesta de `init-memoria`). **Depende de**: —. **Modelo**: Sonnet. **Esfuerzo**: S.

<a id="a6"></a>
### A6 · Atajos de teclado con el texto correcto en cada sistema

**Issue**: [#8](https://github.com/JavierLoro/estudio-tfg/issues/8)

- **Objetivo**: que los atajos se muestren como «⌘⇧C» en Mac y «Ctrl+Mayús+C» en Windows/Linux (hoy hay `⌘ ⌥ ⇧ ↵` escritos a mano y `MOD` produce «Ctrl+⇧C»).
- **Contexto**: PLATAFORMAS.md U1. `MOD` y `ALT` en `web/src/components/ui.tsx`; textos fijos en `SearchView.tsx`, `Markdown.tsx`, `HomePanel.tsx`, `SettingsPanel.tsx`, `CaptureModal.tsx`, `PdfViewer.tsx`, `DiagramPanel.tsx`/`DiagramCanvas.tsx` y otros (busca `⌘`, `⌥`, `⇧`, `↵`, `MOD}` con `grep -rn`).
- **Alcance**: helper `kbd('Mod-Shift-C')` (sintaxis de CodeMirror: `Mod`, `Alt`, `Shift`, `Enter`, `Backspace`…) en `web/src/lib/kbd.ts`; sustituir todos los textos de atajos visibles (tooltips, menús, ayuda de Inicio). No cambia qué teclas hacen qué (eso es C6).
- **Criterios de aceptación**: `grep -rn "[⌘⌥⇧]" web/src` solo encuentra el propio helper; tests del helper para Mac y no Mac.
- **Verificación**: tests; navegador en macOS (los textos siguen igual).
- **Archivos**: `web/src/lib/kbd.ts` y los componentes con atajos.
- **Contrato**: no. **Depende de**: —. **Modelo**: Sonnet. **Esfuerzo**: S.

<a id="a7"></a>
### A7 · Rutas canónicas: `realpath` nativo e identificador de instancia

**Issue**: [#9](https://github.com/JavierLoro/estudio-tfg/issues/9)

- **Objetivo**: que las comprobaciones «esta carpeta está dentro de esta otra» y el identificador de instancia no fallen por mayúsculas de unidad (`c:` vs `C:`), unidades `subst` o mapeadas.
- **Contexto**: PLATAFORMAS.md P5, P7. `realpathSync`/`realpathLoose` en `server/src/config.ts`, comparaciones con `includes` en `server/src/routes/settings.ts`, `isInside`/`resolveSafe` en `server/src/paths.ts`, `instanceId` en `server/src/settings.ts`.
- **Alcance**: usar `fs.realpathSync.native` / `fs.promises.realpath` en todas partes; comparar raíces con `isInside` en ambos sentidos en vez de `includes`; `instanceId` como hash de la ruta canónica.
- **Criterios de aceptación**: tests con `path.win32` donde `isInside('C:\\a','c:\\A\\b')` es verdadero y `isInside('C:\\a','D:\\a')` falso; en macOS los tests siguen en verde y el `instanceId` no cambia para las rutas actuales (si cambiara, los borradores locales se perderían: compruébalo y, si cambia, documenta la migración).
- **Verificación**: `npm test`.
- **Archivos**: `server/src/config.ts`, `server/src/paths.ts`, `server/src/settings.ts`, `server/src/routes/settings.ts`.
- **Contrato**: no. **Depende de**: A3, A4 (mismos archivos). **Modelo**: Sonnet. **Esfuerzo**: S.

---

<a id="fase-b"></a>
## Fase B — Modo Docker para usarlo en cualquier sistema

Resultado: con solo Docker instalado, `docker compose --profile app up -d` deja la app en `http://localhost:8787` funcionando en Windows, Mac y Linux, apta también para desplegar en un servidor (Proxmox). Esfuerzo total ≈ ½–1 día.

<a id="b1"></a>
### B1 · Carpeta de compilaciones compartida entre la app y el worker

**Issue**: [#10](https://github.com/JavierLoro/estudio-tfg/issues/10)

- **Objetivo**: arreglar el perfil `app`: hoy la app busca los PDF en `/data/app/builds` (host `./data/app/builds`) y el worker los escribe en `./data/builds`, así que nunca los encuentra.
- **Contexto**: `docker-compose.yml` (servicios `worker` y `app`), `Dockerfile` (app), `server/src/compile.ts` (`pdfExists`, `buildFile`: el server lee los artefactos de `cfg.buildDir/<id>/`), `worker/Dockerfile` (uid 1000). PLATAFORMAS.md D3.
- **Alcance**: que `BUILD_DIR` de la app y `/out` del worker sean el mismo volumen de host (p. ej. `./data/builds` montado en ambos, y el resto de `data/` de la app en otro punto); asegurar que `data/builds` existe antes de levantar (documentado o creado por `npm run init`/script) y documentar el uid en Linux.
- **Criterios de aceptación**: con `docker compose --profile app up -d --build` y una memoria de prueba: compilar da PDF, SyncTeX funciona en ambos sentidos, exportar un diagrama funciona; reiniciar los contenedores conserva la última compilación y los ajustes.
- **Verificación**: lo anterior en macOS con Docker Desktop (memoria y notas de prueba en el scratchpad montadas por `.env`, no las reales).
- **Archivos**: `docker-compose.yml`, `Dockerfile`, `README.md`, quizá `scripts/init.mjs`.
- **Contrato**: no. **Depende de**: A1. **Modelo**: Opus. **Esfuerzo**: S.

<a id="b2"></a>
### B2 · Vigilar archivos por sondeo cuando hace falta

**Issue**: [#11](https://github.com/JavierLoro/estudio-tfg/issues/11)

- **Objetivo**: que en Docker con carpetas de Windows montadas (y en WSL `/mnt/c`, unidades de red) se vean en vivo los cambios hechos con Obsidian.
- **Contexto**: PLATAFORMAS.md F4, F5, D2. `WatchManager` y chokidar en `server/src/events.ts` (el `on('error', () => {})` silencia errores), `GET /api/status` en `server/src/routes/status.ts`, tipo `Status` en `web/src/api.ts`.
- **Alcance**: variable `WATCH_POLLING=auto|on|off` (por defecto `auto`: activa `usePolling` con `interval` ~1000 ms si existe `/.dockerenv`, la raíz es UNC o empieza por `/mnt/<letra>`); registrar errores del watcher y exponer `watcher: 'ok' | 'error'` (y el mensaje) en `/api/status`; mostrar un aviso discreto en la interfaz si hay error.
- **Criterios de aceptación**: tests de la decisión `auto` (función pura con entradas simuladas); con `WATCH_POLLING=on` en macOS un cambio externo llega por SSE en < 2 s; el estado del watcher aparece en `/api/status`.
- **Verificación**: `npm test`; prueba manual con `WATCH_POLLING=on` en una instancia aparte; prueba en el perfil `app` editando un archivo montado desde el host.
- **Archivos**: `server/src/events.ts`, `server/src/config.ts`, `server/src/routes/status.ts`, `web/src/api.ts`, aviso en la UI, `.env.example`, `docker-compose.yml`, `docs/CONTRACT.md`.
- **Contrato**: sí (`watcher` en `/api/status`, `WATCH_POLLING`). **Depende de**: B1. **Modelo**: Opus. **Esfuerzo**: M.

<a id="b3"></a>
### B3 · git dentro del contenedor de la app

**Issue**: [#12](https://github.com/JavierLoro/estudio-tfg/issues/12)

- **Objetivo**: que «Actualizar plantilla» y la creación de memorias hagan commit cuando la memoria está montada desde el host (git la rechaza por «dubious ownership»).
- **Contexto**: PLATAFORMAS.md G2. `Dockerfile` (instala git), `isGitRepo` y commits en `server/src/plantilla.ts`, avisos en `web/src/panels/DatosPanel.tsx`.
- **Alcance**: `git config --system --add safe.directory '*'` en la imagen de la app (el contenedor solo ve esa memoria); cuando git falle, incluir su `stderr` resumido en el aviso al usuario en vez de tratarlo como «no es un repositorio».
- **Criterios de aceptación**: en el perfil `app`, con la memoria de prueba montada y con repo, «Actualizar plantilla» hace commit; un fallo de git muestra su mensaje.
- **Verificación**: perfil `app` en macOS; `npm test`.
- **Archivos**: `Dockerfile`, `server/src/plantilla.ts`.
- **Contrato**: no. **Depende de**: B1. **Modelo**: Sonnet. **Esfuerzo**: S.

<a id="b4"></a>
### B4 · Elegir carpetas desde Ajustes en Docker y documentar los dos modos

**Issue**: [#13](https://github.com/JavierLoro/estudio-tfg/issues/13)

- **Objetivo**: que en Docker se pueda elegir el vault y la memoria desde Ajustes sin editar `.env`, y que el README explique las dos formas de levantar el entorno.
- **Contexto**: servicio `app` de `docker-compose.yml` (`ALLOWED_ROOTS=/data`, montajes `NOTES_DIR`/`MEMORIA_DIR`), Ajustes (`server/src/routes/settings.ts`, `/api/fs/dirs`), `README.md`.
- **Alcance**: montar una carpeta padre configurable (`HOST_HOME`, por defecto la de documentos del usuario) en `/data/home` e incluirla en `ALLOWED_ROOTS`; README con «Usarlo con Docker (Windows, Mac, Linux)» (requisitos, `.env`, un comando, abrir `localhost:8787`, actualizar) y «Desarrollar (server y web nativos)».
- **Criterios de aceptación**: en el perfil `app`, Ajustes lista `/data/home` y permite elegir el vault y crear la memoria ahí; el README tiene ambas secciones y cada comando existe.
- **Verificación**: perfil `app` en macOS con carpetas de prueba.
- **Archivos**: `docker-compose.yml`, `.env.example`, `README.md`.
- **Contrato**: no. **Depende de**: B1, A4. **Modelo**: Sonnet. **Esfuerzo**: S.

---

<a id="fase-c"></a>
## Fase C — Robustez en Windows

Resultado: en Windows no se pierden ni duplican archivos aunque Obsidian, OneDrive o el antivirus los tengan abiertos; no se crean nombres inválidos; los saltos de línea CRLF no rompen nada. Esfuerzo total ≈ 2–3 días. Depende de la fase A.

<a id="c1"></a>
### C1 · Archivos en uso: reintentos y movimientos seguros

**Issue**: [#14](https://github.com/JavierLoro/estudio-tfg/issues/14)

- **Objetivo**: que guardar y mover no fallen ni dupliquen archivos cuando otro programa los tiene abiertos.
- **Contexto**: PLATAFORMAS.md F1, F2, F9. `atomicWrite` en `server/src/fsutil.ts` (temporal + `rename`), `moveEntry` en `server/src/fileops.ts` (`link` + `unlink`; si falla el `unlink` queda duplicado), errores en `server/src/errors.ts`.
- **Alcance**: en win32, reintentos con espera exponencial (~2 s en total) ante `EPERM`/`EACCES`/`EBUSY` en `rename`/`unlink`; en `moveEntry`, si el `unlink` del origen falla tras reintentar, borrar el destino recién enlazado y devolver error; nuevo error 423 «El archivo está en uso por otro programa; ciérralo y vuelve a intentarlo»; `EPERM` con destino existente al renombrar carpetas → 409. La interfaz muestra ese mensaje.
- **Criterios de aceptación**: tests con `vi.spyOn(fs, 'rename' | 'unlink')` que fallan N veces y luego funcionan (reintento OK) o siempre (423, sin duplicado, origen intacto); en POSIX no hay reintentos.
- **Verificación**: `npm test`. Marcar «a verificar en Windows» (PLATAFORMAS.md §5 tiene la receta con PowerShell para mantener un archivo abierto).
- **Archivos**: `server/src/fsutil.ts`, `server/src/fileops.ts`, `server/src/errors.ts`, cliente `web/src/state/files.ts`/`docs.ts` si hace falta el mensaje, `docs/CONTRACT.md`.
- **Contrato**: sí (423 en escrituras y movimientos). **Depende de**: A. **Modelo**: Opus. **Esfuerzo**: M.

<a id="c2"></a>
### C2 · Sistemas de archivos sin enlaces duros

**Issue**: [#15](https://github.com/JavierLoro/estudio-tfg/issues/15)

- **Objetivo**: que crear archivos, capturar, crear apartados y copias de historial funcionen en exFAT, FAT, unidades de red y Google Drive.
- **Contexto**: PLATAFORMAS.md F3. `createExclusive`/`linkExclusive` en `server/src/fsutil.ts`, `NO_LINK` en `server/src/fileops.ts`.
- **Alcance**: alternativa `open(abs, 'wx')` + escribir + `fsync` cuando `link` falla con `EPERM`/`EXDEV`/`ENOTSUP`/`EISDIR`/`EINVAL`; ampliar `NO_LINK`; detectar una vez por raíz y recordarlo.
- **Criterios de aceptación**: tests simulando cada código de error; en macOS se puede probar de verdad con una imagen exFAT (`hdiutil create -fs ExFAT -size 100m x.dmg`, montarla y usarla como vault en una instancia aparte): crear, capturar, mover y borrar funcionan.
- **Verificación**: `npm test` y la prueba con exFAT.
- **Archivos**: `server/src/fsutil.ts`, `server/src/fileops.ts`.
- **Contrato**: no. **Depende de**: C1 (mismos archivos). **Modelo**: Opus. **Esfuerzo**: M.

<a id="c3"></a>
### C3 · Nombres de archivo válidos en todos los sistemas

**Issue**: [#16](https://github.com/JavierLoro/estudio-tfg/issues/16)

- **Objetivo**: no crear nombres que Windows, el Explorador, git u Obsidian no pueden manejar.
- **Contexto**: PLATAFORMAS.md P3, P4. `normalizeRel` en `server/src/paths.ts`, creación y movimiento en `server/src/fileops.ts` y `server/src/routes/files.ts`, `sanitizeTitle` en `server/src/capture.ts`, `sanitizeDiagramName` en `web/src/state/diagramas.ts`.
- **Alcance**: `validSegment()` aplicado a nombres **nuevos** (crear, renombrar, mover, capturar) en todos los sistemas: rechazar `:`, `<>"|?*`, caracteres de control, punto o espacio final y nombres reservados (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`, con o sin extensión: `aux.tex`, `con.md`), con mensaje en español (400 con `field`); `sanitizeTitle` añade un sufijo a los reservados. Los nombres existentes se siguen leyendo.
- **Criterios de aceptación**: tests de `validSegment` con todos los casos; crear `aux.md` o `nota:x.md` desde la API da 400 con el motivo; capturar con título «CON» crea `CON (recurso).md` o similar.
- **Verificación**: `npm test`; navegador (instancia aparte) intentando renombrar a un nombre inválido.
- **Archivos**: `server/src/paths.ts`, `server/src/fileops.ts`, `server/src/routes/files.ts`, `server/src/capture.ts`, `docs/CONTRACT.md`.
- **Contrato**: sí (validación de nombres). **Depende de**: A. **Modelo**: Sonnet. **Esfuerzo**: S.

<a id="c4"></a>
### C4 · Saltos de línea CRLF

**Issue**: [#17](https://github.com/JavierLoro/estudio-tfg/issues/17)

- **Objetivo**: que los archivos con CRLF (editados en Windows) no se conviertan enteros al guardar, no parezcan «modificados» para la plantilla y no rompan los analizadores.
- **Contexto**: PLATAFORMAS.md E1 (versión robusta), E2, E3. Hash de manifiestos en `scripts/memoria-template.mjs` y `server/src/plantilla.ts`; `templates/manifiestos/*.json`; CodeMirror en `web/src/components/CodeEditor.tsx`; `server/src/datos.ts`; `eolOf` existente en `server/src/sections.ts`.
- **Alcance**: hashear los archivos de texto de la plantilla normalizando CRLF→LF (y regenerar manifiestos con `npm run template:manifest` si cambia el algoritmo, manteniendo compatibilidad con memorias existentes); CodeMirror con `EditorState.lineSeparator` igual al del documento (detectado al cargar) para que guardar conserve CRLF y deshacer vuelva a «limpio»; usar `eolOf` en `datos.ts` y `plantilla.ts` al añadir líneas; `.gitattributes` en `templates/base/` para las memorias nuevas.
- **Criterios de aceptación**: tests con variantes CRLF de los fixtures (outline, datos, refs, frontmatter, manifiesto); abrir y guardar sin cambios un archivo CRLF lo deja idéntico byte a byte; la plantilla sigue compilando con 0 avisos.
- **Verificación**: `npm test`, `node scripts/template-manifest.mjs --check`, compilación de perfiles con el worker, navegador (instancia aparte) con un `.tex` CRLF.
- **Archivos**: `scripts/memoria-template.mjs`, `scripts/template-manifest.mjs`, `server/src/plantilla.ts`, `server/src/datos.ts`, `web/src/components/CodeEditor.tsx`, `templates/base/.gitattributes`, `templates/manifiestos/`.
- **Contrato**: no (salvo precisión sobre el hash en v0.6). **Depende de**: A1. **Modelo**: Opus. **Esfuerzo**: M.

<a id="c5"></a>
### C5 · Carpetas y archivos de sistema de Windows

**Issue**: [#18](https://github.com/JavierLoro/estudio-tfg/issues/18)

- **Objetivo**: que el selector de carpetas no muestre `AppData`, `$Recycle.Bin`, etc., y que `desktop.ini`/`Thumbs.db` no aparezcan en el árbol, la búsqueda ni la compilación.
- **Contexto**: PLATAFORMAS.md L1, F7. `/api/fs/dirs` en `server/src/routes/settings.ts`, `server/src/ignore.ts`, `isEmptyDir` en `scripts/memoria-template.mjs`, `templates/base/.gitignore`.
- **Alcance**: lista de exclusión en win32 para el listado de carpetas y saltar las que dan `EPERM`; ignorar `desktop.ini`, `Thumbs.db`, `*.tmp` en `ignore.ts` e `isEmptyDir`; añadirlos al `.gitignore` de la plantilla (regenerar manifiesto).
- **Criterios de aceptación**: tests de `ignore.ts` y del listado con nombres de sistema simulados; plantilla con 0 avisos y manifiesto al día.
- **Verificación**: `npm test`, `template-manifest --check`.
- **Archivos**: `server/src/routes/settings.ts`, `server/src/ignore.ts`, `scripts/memoria-template.mjs`, `templates/base/.gitignore`, `templates/manifiestos/`.
- **Contrato**: no. **Depende de**: A. **Modelo**: Sonnet. **Esfuerzo**: S.

<a id="c6"></a>
### C6 · Atajos que chocan con el navegador fuera de Mac

**Issue**: [#19](https://github.com/JavierLoro/estudio-tfg/issues/19)

- **Objetivo**: que en Windows y Linux los atajos no abran las herramientas de desarrollo ni la barra de búsqueda del navegador, y que «abrir al lado» no dependa de Alt+clic.
- **Contexto**: PLATAFORMAS.md U2, U3. `Mod-Shift-j` en `web/src/components/CodeEditor.tsx`, atajos globales en `web/src/App.tsx` (Ctrl+K, Ctrl+Shift+C, Ctrl+B), `web/src/panels/NotePanel.tsx` (Ctrl+E), usos de `e.altKey` en `FileTree`, `SearchView`, `Markdown`, `OutlineTree`, `QuickOpen`, `PdfViewer`. Helper de A6.
- **Alcance**: comprobar con `preventDefault` cuáles gana la página en Chrome, Edge y Firefox (documentar en la tarea o en «a verificar»); para los que no se puedan capturar, atajo alternativo fuera de Mac (p. ej. Ctrl+Alt+J), evitando combinaciones de AltGr; además de Alt+clic, aceptar Ctrl+Mayús+clic y clic central, y que «Abrir al lado» esté en el menú contextual. Actualizar textos con `kbd()`.
- **Criterios de aceptación**: tabla en el informe atajo × navegador; en macOS todo sigue igual; los atajos alternativos funcionan en un Chrome con user agent de Windows (o marcados «a verificar»).
- **Verificación**: navegador (instancia aparte).
- **Archivos**: los citados en Contexto.
- **Contrato**: no. **Depende de**: A6. **Modelo**: Sonnet. **Esfuerzo**: S.

<a id="c7"></a>
### C7 · Detalles menores de portabilidad

**Issue**: [#20](https://github.com/JavierLoro/estudio-tfg/issues/20)

- **Objetivo**: cerrar los hallazgos menores de PLATAFORMAS.md.
- **Contexto**: P8 (normalizar Unicode a NFC al comparar nombres: `notes.ts`, `links.ts`, `search.ts`, `QuickOpen.tsx`), P10 (`path.posix` en `server/src/outline.ts` para rutas del worker), F6 (no propagar modo de solo lectura en win32: `fsutil.ts`), F8 (`fs.stat` con `bigint` en `fileops.ts`), G3/P9 (`-c core.longpaths=true` en llamadas a git en win32: `plantilla.ts`, `memoria-template.mjs`), T2 (`canSymlink()` y `it.skipIf` en tests con enlaces simbólicos), T4 (`fs.rm` con `maxRetries` en `server/test/helpers.ts`).
- **Alcance**: exactamente esos puntos; cada uno con su test cuando sea posible.
- **Criterios de aceptación**: cada ID resuelto o justificado en el informe; tests en verde.
- **Verificación**: `npm test`.
- **Archivos**: los citados.
- **Contrato**: no. **Depende de**: A. **Modelo**: Sonnet. **Esfuerzo**: S.

---

<a id="fase-d"></a>
## Fase D — CI en Linux, macOS y Windows

<a id="d1"></a>
### D1 · Integración continua con GitHub Actions

**Issue**: [#21](https://github.com/JavierLoro/estudio-tfg/issues/21)

- **Objetivo**: que cada push y PR se pruebe en Linux, macOS y Windows, y que la plantilla se compile con 0 avisos.
- **Contexto**: PLATAFORMAS.md T6 y §4 fase 3. No existe `.github/`. Tests: `npm test` (vitest, usa `WORKER_URL=http://127.0.0.1:1` y un worker falso en `server/test/compile.test.ts`), `node --test worker/*.test.mjs`, `node scripts/template-manifest.mjs --check`.
- **Alcance**: `.github/workflows/ci.yml` con matriz `[ubuntu-latest, macos-latest, windows-latest]`, `fail-fast: false`, Node 24: `npm ci` en server y web, typecheck, tests del server, build web, tests del worker, comprobación del manifiesto. Windows con `continue-on-error: true` hasta cerrar la fase C. Job aparte solo en ubuntu: construir la imagen del worker y compilar cada perfil (`esi-uclm`, `generico`) comprobando 0 avisos (script reutilizable, p. ej. `scripts/compile-template.mjs`).
- **Criterios de aceptación**: el workflow se ejecuta en un PR y los jobs de ubuntu y macOS pasan; el de Windows ejecuta y su resultado está documentado en el informe; badge en el README.
- **Verificación**: ejecutar en una rama y enlazar la ejecución.
- **Archivos**: `.github/workflows/ci.yml`, `scripts/compile-template.mjs`, `README.md`.
- **Contrato**: no. **Depende de**: A (y A1 para CRLF). **Modelo**: Sonnet. **Esfuerzo**: M.

<a id="d2"></a>
### D2 · Tests de Windows sin Windows

**Issue**: [#22](https://github.com/JavierLoro/estudio-tfg/issues/22)

- **Objetivo**: cubrir con tests lo que no podemos probar a mano en Windows.
- **Contexto**: PLATAFORMAS.md §5 «Sin máquina Windows».
- **Alcance**: hacer que las funciones de rutas acepten el módulo `path` (`isInside`, `normalizeRel`, `parseAllowedRoots`, `expandPath`, `toPosix`, el guardia del repo, `abspath.ts`) y probarlas con `path.win32` (`C:\`, `c:\`, `D:\`, UNC, `\\?\`, mixtas, `~\`, reservados); fixtures CRLF; simulación de `EPERM`/`EBUSY`/`EISDIR`/`ENOTSUP` con `vi.spyOn`.
- **Criterios de aceptación**: nuevos tests en verde en macOS y en el CI de Windows.
- **Verificación**: `npm test`; CI.
- **Archivos**: `server/src/paths.ts`, `server/src/config.ts`, tests nuevos.
- **Contrato**: no. **Depende de**: D1; se amplía a la vez que C. **Modelo**: Sonnet. **Esfuerzo**: M.

---

<a id="fase-e"></a>
## Fase E — Motores de compilación intercambiables

Resultado: el servidor compila con el motor que elija el usuario: **Docker** (el worker actual), **TeX del sistema** (MacTeX, TeX Live, MiKTeX) o, si se valida, **Tectonic**. Imprescindible para la app de escritorio sin Docker. Esfuerzo ≈ 2–3 días.

<a id="e1"></a>
### E1 · Contrato e interfaz de motor de compilación

**Issue**: [#23](https://github.com/JavierLoro/estudio-tfg/issues/23)

- **Objetivo**: que el servidor no dependa de «un worker HTTP» sino de una interfaz de motor, con el worker actual como primera implementación.
- **Contexto**: hoy todo pasa por `cfg.workerUrl`: `fetch(.../compile)` en `server/src/compile.ts` (tar de fuentes + cabecera `x-main`; respuesta `{ ok, buildId, durationMs, pdf, log, diagnostics }`; artefactos en `buildDir/<id>/main.{pdf,log,synctex.gz}` porque el worker escribe en la carpeta compartida), `fetch(.../svg2pdf)` en `server/src/diagramas.ts`, `/health` en `server/src/routes/status.ts`. Worker: `worker/server.mjs`. Worker falso de tests en `server/test/compile.test.ts`.
- **Alcance**:
  - Contrato v0.9 «Motores»: `health() → { ok, version, capacidades }`, `compile(fuentes, main) → resultado` con artefactos en `buildDir/<id>/`, `svg2pdf(svg) → pdf`.
  - `server/src/engine/` con el tipo `Engine` y la implementación `docker` (HTTP al worker, exactamente lo que se hace hoy); `compile.ts`, `diagramas.ts` y `status.ts` pasan a usarla.
  - `/api/status` añade `motor: { tipo, estado, version }` (manteniendo `worker` por compatibilidad hasta que la interfaz lo use).
  - No hace: el motor local (E2).
- **Criterios de aceptación**: comportamiento idéntico (todos los tests existentes en verde sin tocarlos, salvo imports); tests nuevos de la interfaz con el worker falso; compilar y exportar diagramas funcionan en el navegador (instancia aparte).
- **Verificación**: `npm test`, typecheck, navegador.
- **Archivos**: `server/src/engine/*`, `server/src/compile.ts`, `server/src/diagramas.ts`, `server/src/routes/status.ts`, `server/src/config.ts`, `web/src/api.ts`, `docs/CONTRACT.md`.
- **Contrato**: sí (v0.9). **Depende de**: A. **Modelo**: Opus. **Esfuerzo**: M.

<a id="e2"></a>
### E2 · Motor «TeX del sistema»

**Issue**: [#24](https://github.com/JavierLoro/estudio-tfg/issues/24)

- **Objetivo**: compilar con el `latexmk` instalado en el equipo, sin Docker.
- **Contexto**: `worker/server.mjs` (función `compile`: `latexmk -pdf -interaction=nonstopmode -file-line-error -synctex=1 -no-shell-escape`, variables `max_print_line` etc., `copySynctex`, `parse-log.mjs`, cola de una compilación; `run()` mata el grupo de procesos con `process.kill(-pid)`, que no existe en Windows), `worker/untar.mjs`, `worker/svg.mjs` (`rsvg-convert`). Interfaz de E1.
- **Alcance**:
  - Extraer de `worker/server.mjs` un módulo importable (p. ej. `worker/engine.mjs`: `compile({ main, workDir, outDir })`, `svgToPdf`) que usen tanto el servidor HTTP del worker (sin cambiar su comportamiento en Docker) como el motor `local` del servidor.
  - Matar procesos de forma portable (grupo en POSIX, `taskkill /pid <pid> /T /F` en win32).
  - Motor `local` en `server/src/engine/`: escribe directamente en `buildDir/<id>/`; detecta `latexmk`, `biber` y `rsvg-convert` en el PATH y su versión.
  - Ajustes: selector de motor (Automático / Docker / TeX del sistema) con el resultado de la detección; «Automático» prefiere Docker si responde y si no TeX del sistema.
  - `-no-shell-escape` siempre.
- **Criterios de aceptación**: con TeX Live/MacTeX instalado, la plantilla compila con el motor local con los mismos diagnósticos que en Docker; SyncTeX funciona; el worker Docker sigue pasando sus tests y compilando; si falta `latexmk`, Ajustes lo dice con un mensaje claro.
- **Verificación**: `npm test`, `node --test worker/*.test.mjs`, compilación real con ambos motores (si el equipo no tiene TeX instalado, usar el worker como referencia y marcar el local «a verificar»).
- **Archivos**: `worker/server.mjs`, `worker/engine.mjs` (nuevo), `server/src/engine/local.ts`, Ajustes (server y web), `docs/CONTRACT.md`.
- **Contrato**: sí. **Depende de**: E1; en Windows también C1. **Modelo**: Opus. **Esfuerzo**: L.

<a id="e3"></a>
### E3 · Validar la plantilla con TeX del sistema

**Issue**: [#25](https://github.com/JavierLoro/estudio-tfg/issues/25)

- **Objetivo**: garantizar que la plantilla compila con 0 avisos con las distribuciones habituales, y documentar qué instalar.
- **Contexto**: plantilla en `templates/base/` y `templates/perfiles/`; necesita pdfLaTeX, biber y los paquetes de `templates/base/estilo/memoria.cls`. Motor local de E2.
- **Alcance**: compilar ambos perfiles con MacTeX/TeX Live (y MiKTeX si hay acceso: instalación de paquetes al vuelo) con el motor local; corregir lo que dependa de TeX Live completo; documentar requisitos (distribución mínima, paquetes) en el README y en la ayuda de Ajustes.
- **Criterios de aceptación**: tabla distribución × perfil con avisos = 0 (o justificados); requisitos documentados.
- **Verificación**: compilaciones reales; `template-manifest --check` si cambia la plantilla.
- **Archivos**: `templates/` (solo si hace falta), `README.md`, textos de Ajustes.
- **Contrato**: no. **Depende de**: E2. **Modelo**: Sonnet. **Esfuerzo**: M.

<a id="e4"></a>
### E4 · Exploración: Tectonic como motor autocontenido

**Issue**: [#26](https://github.com/JavierLoro/estudio-tfg/issues/26)

- **Objetivo**: decidir si Tectonic (motor XeTeX de ~30 MB que descarga paquetes según los necesita) puede ser el motor por defecto de la app de escritorio.
- **Contexto**: la clase `templates/base/estilo/memoria.cls` está pensada para pdfLaTeX (`fontenc` T1, newtx, microtype, biber). Tectonic usa XeTeX y gestiona biber aparte.
- **Alcance**: **solo informe**, sin cambios en la plantilla principal: compilar una copia de la plantilla con Tectonic, listar qué cambios necesitaría la clase (fuentes con `fontspec`, microtype, biber), tamaño de descarga y caché, licencia y soporte en Windows/macOS; recomendación sí/no y coste estimado.
- **Criterios de aceptación**: informe en `docs/MOTORES.md` con resultados reproducibles (comandos).
- **Verificación**: los comandos del informe.
- **Archivos**: `docs/MOTORES.md`.
- **Contrato**: no. **Depende de**: E1. **Modelo**: Opus. **Esfuerzo**: M.

---

<a id="fase-f"></a>
## Fase F — Diagramas sin Docker

<a id="f1"></a>
### F1 · Exportar diagramas a PDF sin `rsvg-convert`

**Issue**: [#27](https://github.com/JavierLoro/estudio-tfg/issues/27)

- **Objetivo**: que exportar un diagrama a PDF vectorial funcione con el motor local (sin el worker de Docker).
- **Contexto**: hoy el navegador dibuja el SVG (`web/src/lib/diagram.ts`, fuente Source Sans 3 cargada para medir) y el worker lo convierte con `rsvg-convert` (`worker/svg.mjs`, `fontconfig-diagramas.conf`); `server/src/diagramas.ts` guarda PDF y SVG. Precisiones v0.8 en `docs/CONTRACT.md` (`xml:space="preserve"`, sin sombras, etiquetas opacas).
- **Alcance**: implementar `svg2pdf` del motor local con una conversión en JavaScript (evaluar primero `svg2pdf.js` + jsPDF, MIT, en el navegador o en el servidor) incrustando Source Sans 3; si el motor tiene `rsvg-convert`, seguir usándolo.
- **Criterios de aceptación**: las 6 plantillas de diagrama exportadas con el nuevo camino se ven igual que con rsvg (comparar a 200 dpi), texto como texto y fuente incrustada (`/BaseFont SourceSans3`), y una memoria con esas figuras compila con 0 avisos.
- **Verificación**: exportar en una instancia aparte con el motor local; rasterizar y comparar; compilar.
- **Archivos**: `server/src/engine/local.ts` o `web/src/lib/diagram.ts`, `server/src/diagramas.ts`, `docs/CONTRACT.md`.
- **Contrato**: sí si cambia el flujo de exportación. **Depende de**: E1 (E2 para probar con el motor local). **Modelo**: Opus. **Esfuerzo**: M.

---

<a id="fase-g"></a>
## Fase G — App de escritorio con Electron

Resultado: instaladores y versión portable para Windows y Mac (y AppImage para Linux), publicados en GitHub Releases. Se elige **Electron** porque el servidor es Node y corre dentro de la app sin reescribirlo, y `electron-builder` genera .dmg, instalador NSIS y .exe portable desde los runners de GitHub Actions. Esfuerzo ≈ 1–2 semanas. Depende de B1, C, D1, E1–E2 y F1.

<a id="g1"></a>
### G1 · Desacoplar el servidor del checkout del repo

**Issue**: [#28](https://github.com/JavierLoro/estudio-tfg/issues/28)

- **Objetivo**: que el servidor pueda arrancar desde una app empaquetada, sin `.env` ni carpetas del repo.
- **Contexto**: `REPO_ROOT` en `server/src/config.ts` (de él salen `.env`, rutas relativas, `webDist = web/dist`, `data/`), `assertOutsideRepo`/`repoGuardError`, `server/src/index.ts` (carga `.env` de la raíz), `scripts/memoria-template.mjs` (`TEMPLATES_DIR`), carpeta de datos (`data/builds`, `data/history`, `data/settings.json`, `data/trash`).
- **Alcance**: variables `DATA_DIR`, `TEMPLATES_DIR`, `WEB_DIST` (por defecto, lo de hoy); `.env` opcional; guardia del repo solo si se ejecuta desde un checkout; función que da la carpeta de datos por sistema (`~/Library/Application Support/Estudio TFG`, `%APPDATA%\Estudio TFG`, `~/.local/share/estudio-tfg`) para usarla desde la app.
- **Criterios de aceptación**: con esas variables apuntando fuera del repo, el servidor arranca, sirve la web y crea memorias; sin ellas, todo igual que hoy; tests.
- **Verificación**: `npm test`; arrancar con `DATA_DIR`, `TEMPLATES_DIR` y `WEB_DIST` en el scratchpad.
- **Archivos**: `server/src/config.ts`, `server/src/index.ts`, `scripts/memoria-template.mjs`, `docs/CONTRACT.md` si cambia `/api/status`.
- **Contrato**: solo si cambia la API. **Depende de**: A. **Modelo**: Opus. **Esfuerzo**: M.

<a id="g2"></a>
### G2 · Servidor compilado a JavaScript

**Issue**: [#29](https://github.com/JavierLoro/estudio-tfg/issues/29)

- **Objetivo**: no depender de `tsx` en ejecución dentro de la app empaquetada.
- **Contexto**: `server/package.json` (`start`: `tsx src/index.ts`), `Dockerfile` (usa `tsx`), imports de `scripts/*.mjs` desde el servidor.
- **Alcance**: script `npm run bundle --prefix server` con esbuild que genera `server/dist/server.mjs` (dependencias nativas o con archivos externos marcadas como externas); `npm start` y la imagen Docker pueden seguir con `tsx` o pasar al bundle (decidir y justificar); el modo desarrollo no cambia.
- **Criterios de aceptación**: `node server/dist/server.mjs` arranca con las variables de G1 y pasa una prueba de humo (status, abrir archivo, compilar con el worker).
- **Verificación**: prueba de humo; `npm test`.
- **Archivos**: `server/package.json`, configuración de esbuild, quizá `Dockerfile`.
- **Contrato**: no. **Depende de**: G1. **Modelo**: Sonnet. **Esfuerzo**: M.

<a id="g3"></a>
### G3 · Esqueleto de la app Electron

**Issue**: [#30](https://github.com/JavierLoro/estudio-tfg/issues/30)

- **Objetivo**: una app que arranca el servidor y muestra la interfaz en su ventana.
- **Contexto**: la web usa URLs relativas `/api/...`, `EventSource('/api/events')` y la cookie `et_token` (`web/src/api.ts`, `web/src/state/events.ts`, `server/src/auth.ts`), así que debe cargarse desde el servidor HTTP, **no** con `file://`. Servidor de G1/G2.
- **Alcance**: carpeta `desktop/` con `package.json` propio; el proceso principal arranca el servidor (en el mismo proceso o con `utilityProcess`) en `127.0.0.1` con puerto libre y `AUTH_TOKEN` aleatorio, fija la cookie `et_token` en la sesión y abre la ventana en esa URL; una sola instancia; cierre limpio del servidor; carpeta de datos por sistema (G1).
- **Criterios de aceptación**: `npm start --prefix desktop` en macOS abre la app, que funciona como en el navegador (abrir, editar, compilar con el motor elegido); cerrar la ventana para el servidor; una segunda instancia enfoca la primera.
- **Verificación**: manual en macOS; «a verificar en Windows» hasta G5.
- **Archivos**: `desktop/*`.
- **Contrato**: no. **Depende de**: G1, G2. **Modelo**: Opus. **Esfuerzo**: M.

<a id="g4"></a>
### G4 · Asistente de primer arranque

**Issue**: [#31](https://github.com/JavierLoro/estudio-tfg/issues/31)

- **Objetivo**: que alguien sin conocimientos técnicos deje la app lista en pocos pasos.
- **Contexto**: Ajustes (carpetas, crear memoria desde perfil: `web/src/panels/SettingsPanel.tsx`), detección de motor (E2), perfiles (`GET /api/templates/perfiles`).
- **Alcance**: asistente en la interfaz cuando la app no está configurada: elegir vault de Obsidian (o crear carpeta de notas), crear la memoria desde un perfil, detectar motor TeX (si no hay, explicar las opciones: instalar MacTeX/MiKTeX con enlace, usar Docker o Tectonic si E4 lo valida) y compilar una primera vez.
- **Criterios de aceptación**: con datos vacíos, el asistente lleva hasta un PDF compilado; se puede repetir desde Ajustes.
- **Verificación**: navegador y app (instancia aparte / datos limpios).
- **Archivos**: componentes nuevos en `web/src/`, quizá endpoints de detección.
- **Contrato**: sí si hay endpoints nuevos. **Depende de**: E2, G3. **Modelo**: Sonnet. **Esfuerzo**: M.

<a id="g5"></a>
### G5 · Empaquetado y publicación

**Issue**: [#32](https://github.com/JavierLoro/estudio-tfg/issues/32)

- **Objetivo**: generar instaladores y versión portable automáticamente al publicar una versión.
- **Contexto**: app de G3.
- **Alcance**: `electron-builder` con: macOS `.dmg` (arm64 y x64), Windows instalador NSIS y `.exe` portable (x64), Linux AppImage; incluir `templates/`, `scripts/` necesarios, `web/dist` y el servidor de G2; workflow `.github/workflows/release.yml` que, al crear un tag `v*`, construye en `macos-latest` y `windows-latest` (y ubuntu) y sube a GitHub Releases; actualización automática con `electron-updater` desde Releases; **sin firmar** al principio, con instrucciones en el README para abrirla (macOS: clic derecho → Abrir; Windows: «Más información → Ejecutar de todas formas»).
- **Criterios de aceptación**: un tag de prueba genera los artefactos en una release borrador; el .dmg se instala y abre en macOS; el .exe se marca «a verificar en Windows» si no hay equipo.
- **Verificación**: ejecución del workflow enlazada; prueba del .dmg.
- **Archivos**: `desktop/electron-builder.yml` (o en `package.json`), `.github/workflows/release.yml`, `README.md`.
- **Contrato**: no. **Depende de**: G3. **Modelo**: Sonnet. **Esfuerzo**: M.

<a id="g6"></a>
### G6 · Firma y notarización

**Issue**: [#33](https://github.com/JavierLoro/estudio-tfg/issues/33)

- **Objetivo**: que macOS y Windows no avisen de «app no verificada».
- **Contexto**: requiere una cuenta de Apple Developer (99 $/año) y un certificado de firma de código para Windows. **Las credenciales y el pago los gestiona el usuario**; nunca se guardan en el repo.
- **Alcance**: el agente prepara el workflow de G5 para firmar y notarizar usando secretos de GitHub (`APPLE_ID`, `APPLE_TEAM_ID`, certificado en base64, contraseña…) y documenta qué secretos crear y cómo; si los secretos no existen, el build sigue sin firmar.
- **Criterios de aceptación**: workflow que firma cuando hay secretos y no falla cuando no; guía paso a paso para el usuario.
- **Verificación**: ejecución sin secretos (sin firmar) y revisión de la configuración.
- **Archivos**: `.github/workflows/release.yml`, configuración de electron-builder, `docs/` (guía).
- **Contrato**: no. **Depende de**: G5. **Modelo**: Sonnet. **Esfuerzo**: S.

<a id="g7"></a>
### G7 · «Acerca de», licencia y guía de instalación

**Issue**: [#34](https://github.com/JavierLoro/estudio-tfg/issues/34)

- **Objetivo**: cumplir la AGPL al distribuir binarios y explicar la instalación.
- **Contexto**: licencia en `LICENSE` y README (AGPL-3.0, plantilla derivada de ARCO GPL-2.0+, fuentes y componentes de terceros).
- **Alcance**: ventana o panel «Acerca de» con versión, licencia, enlace al código fuente y créditos de terceros; guía de instalación en el README (descargar, abrir sin firmar, primer arranque).
- **Criterios de aceptación**: el enlace al código y la licencia son visibles en la app; la guía cubre macOS y Windows.
- **Verificación**: revisión en la app.
- **Archivos**: componente en `web/src/` o menú de `desktop/`, `README.md`.
- **Contrato**: no. **Depende de**: G3. **Modelo**: Haiku. **Esfuerzo**: S.
